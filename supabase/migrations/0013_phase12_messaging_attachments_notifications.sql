-- ============================================================================
-- Migration 0013: Phase 12 - Messaging, Private Storage Attachments & Notifications
-- ============================================================================
-- Implements ADR-020 & MASTER_SPEC Sections 01/02/03/05:
-- 1. Extend tenant_settings with messaging retention, max attachment size, and
--    notification trigger preferences.
-- 2. Add messaging permissions and backfill default role permissions.
-- 3. Create conversations, conversation_participants, messages (append-only +
--    idempotency_key), storage_objects_metadata, message_attachments,
--    shipment_attachments, notifications, and notification_deliveries.
-- 4. Enable & FORCE ROW LEVEL SECURITY across all Phase 12 tables with strict
--    tenant, client, courier, branch, and visibility ('internal' vs 'external') isolation.
-- 5. Provision private Supabase Storage buckets ('shipment-attachments',
--    'message-attachments', 'delivery-proof') and tenant-isolated storage RLS.
-- 6. Server-side atomic RPCs for conversations, messaging, attachments,
--    notifications, and automatic shipment-event notifications trigger.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extend tenant_settings with Retention, Upload Limits & Notification Prefs
-- ----------------------------------------------------------------------------
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS message_retention_days integer NOT NULL DEFAULT 365
    CHECK (message_retention_days BETWEEN 30 AND 3650),
  ADD COLUMN IF NOT EXISTS attachment_max_size_mb integer NOT NULL DEFAULT 5
    CHECK (attachment_max_size_mb BETWEEN 1 AND 25),
  ADD COLUMN IF NOT EXISTS notify_on_shipment_status boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_on_new_message boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_on_settlement boolean NOT NULL DEFAULT true;

-- ----------------------------------------------------------------------------
-- 2. Messaging Permissions Catalog & Role Backfill
-- ----------------------------------------------------------------------------
ALTER TABLE public.permissions
  DROP CONSTRAINT IF EXISTS permissions_module_check;

ALTER TABLE public.permissions
  ADD CONSTRAINT permissions_module_check
    CHECK (module IN (
      'dashboard', 'definitions', 'clients', 'pricing', 'couriers',
      'shipments', 'operations', 'finance', 'accounting', 'security',
      'integrations', 'messaging'
    ));

INSERT INTO public.permissions (key, module, label_ar, description_ar, default_scope, is_sensitive)
VALUES
  ('messaging.read', 'messaging', 'عرض الرسائل والإشعارات', 'استعراض المحادثات وسجل الإشعارات ضمن النطاق المصرح به.', 'tenant', false),
  ('messaging.send', 'messaging', 'إرسال الرسائل والمرفقات', 'إرسال رسائل ومرفقات مرتبطة بالشحنات والتجار.', 'tenant', false),
  ('messaging.internal', 'messaging', 'إرسال رسائل فريق داخلية', 'كتابة وقراءة ملاحظات ورسائل داخلية لا يراها التاجر أو المندوب.', 'tenant', false),
  ('attachments.manage', 'messaging', 'إدارة مرفقات الشحنات والملفات', 'رفع وإدارة المستندات والمرفقات في حاويات التخزين الخاصة.', 'branch', false)
ON CONFLICT (key) DO UPDATE
  SET module = EXCLUDED.module,
      label_ar = EXCLUDED.label_ar,
      description_ar = EXCLUDED.description_ar,
      default_scope = EXCLUDED.default_scope,
      is_sensitive = EXCLUDED.is_sensitive;

-- Backfill role_permissions across existing tenants cleanly
INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, scope)
SELECT r.tenant_id, r.id, p.key,
  CASE
    WHEN r.code = 'company_owner' THEN 'tenant'
    WHEN r.code IN ('client_owner', 'client_staff') THEN 'own'
    WHEN r.code = 'delivery_agent' THEN 'assigned'
    WHEN r.code IN ('branch_manager', 'warehouse_operator') THEN 'branch'
    ELSE p.default_scope
  END
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.key IN ('messaging.read', 'messaging.send', 'messaging.internal', 'attachments.manage')
  AND (
    r.code IN ('company_owner', 'company_admin', 'operations_manager', 'customer_support', 'branch_manager', 'warehouse_operator', 'accountant', 'data_entry')
    OR (r.code IN ('delivery_agent', 'client_owner', 'client_staff') AND p.key IN ('messaging.read', 'messaging.send', 'attachments.manage'))
  )
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Phase 12 Tables: Conversations, Messages, Attachments & Notifications
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK (entity_type IN ('shipment', 'client', 'pickup_request', 'general')),
  entity_id uuid,
  shipment_id uuid,
  client_id uuid,
  courier_id uuid,
  branch_id uuid,
  subject text NOT NULL CHECK (char_length(trim(subject)) >= 2),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'archived')),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message_preview text,
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_conversations_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT chk_conversations_entity_id CHECK (
    (entity_type = 'general' AND entity_id IS NULL)
    OR (entity_type <> 'general' AND entity_id IS NOT NULL)
  ),
  CONSTRAINT fk_conv_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_conv_client FOREIGN KEY (tenant_id, client_id) REFERENCES public.clients(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_conv_courier FOREIGN KEY (tenant_id, courier_id) REFERENCES public.couriers(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_conv_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_entity
  ON public.conversations (tenant_id, entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_recent
  ON public.conversations (tenant_id, status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_client
  ON public.conversations (tenant_id, client_id, last_message_at DESC)
  WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_courier
  ON public.conversations (tenant_id, courier_id, last_message_at DESC)
  WHERE courier_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_conversations_updated_at ON public.conversations;
CREATE TRIGGER trg_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE IF NOT EXISTS public.conversation_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  is_muted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_conv_part_unique UNIQUE (tenant_id, conversation_id, user_id),
  CONSTRAINT fk_conv_part_conv FOREIGN KEY (tenant_id, conversation_id) REFERENCES public.conversations(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conv_part_user
  ON public.conversation_participants (tenant_id, user_id, last_read_at DESC);

DROP TRIGGER IF EXISTS trg_conv_part_updated_at ON public.conversation_participants;
CREATE TRIGGER trg_conv_part_updated_at
  BEFORE UPDATE ON public.conversation_participants
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  conversation_id uuid NOT NULL,
  sender_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  sender_display_name text NOT NULL CHECK (char_length(trim(sender_display_name)) >= 1),
  sender_subject_type text NOT NULL CHECK (sender_subject_type IN ('staff', 'client', 'courier', 'platform_support')),
  visibility text NOT NULL DEFAULT 'external' CHECK (visibility IN ('external', 'internal')),
  body text NOT NULL DEFAULT '',
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_messages_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_messages_conv FOREIGN KEY (tenant_id, conversation_id) REFERENCES public.conversations(tenant_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_idempotency
  ON public.messages (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON public.messages (tenant_id, conversation_id, created_at ASC);

CREATE OR REPLACE FUNCTION app_private.forbid_message_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'الرسائل المرسلة غير قابلة للتعديل أو الحذف للحفاظ على سجل التدقيق.';
END;
$$;

DROP TRIGGER IF EXISTS trg_forbid_message_mutation ON public.messages;
CREATE TRIGGER trg_forbid_message_mutation
  BEFORE UPDATE OR DELETE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION app_private.forbid_message_mutation();

CREATE TABLE IF NOT EXISTS public.storage_objects_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  bucket_id text NOT NULL CHECK (bucket_id IN ('shipment-attachments', 'message-attachments', 'delivery-proof')),
  object_path text NOT NULL CHECK (object_path LIKE (tenant_id::text || '/%')),
  entity_type text NOT NULL CHECK (entity_type IN ('shipment', 'message', 'delivery_proof', 'pickup_request')),
  entity_id uuid NOT NULL,
  shipment_id uuid,
  client_id uuid,
  file_name text NOT NULL CHECK (char_length(trim(file_name)) >= 1),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  visibility text NOT NULL DEFAULT 'external' CHECK (visibility IN ('external', 'internal')),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  uploaded_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_storage_meta_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_storage_meta_bucket_path UNIQUE (bucket_id, object_path),
  CONSTRAINT fk_storage_meta_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_storage_meta_client FOREIGN KEY (tenant_id, client_id) REFERENCES public.clients(tenant_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_storage_meta_tenant_entity
  ON public.storage_objects_metadata (tenant_id, entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  message_id uuid NOT NULL,
  storage_object_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_msg_att_pair UNIQUE (tenant_id, message_id, storage_object_id),
  CONSTRAINT fk_msg_att_msg FOREIGN KEY (tenant_id, message_id) REFERENCES public.messages(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_att_obj FOREIGN KEY (tenant_id, storage_object_id) REFERENCES public.storage_objects_metadata(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.shipment_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL,
  storage_object_id uuid NOT NULL,
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('general', 'waybill', 'damage_photo', 'delivery_proof', 'exception_photo')),
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_shp_att_pair UNIQUE (tenant_id, shipment_id, storage_object_id),
  CONSTRAINT fk_shp_att_shp FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_shp_att_obj FOREIGN KEY (tenant_id, storage_object_id) REFERENCES public.storage_objects_metadata(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shp_att_shipment
  ON public.shipment_attachments (tenant_id, shipment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('shipment_status', 'new_message', 'pickup_request', 'settlement', 'delivery_exception', 'system')),
  title text NOT NULL CHECK (char_length(trim(title)) >= 2),
  body text NOT NULL CHECK (char_length(trim(body)) >= 2),
  entity_type text,
  entity_id uuid,
  action_path text CHECK (action_path IS NULL OR action_path LIKE '/%'),
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_notifications_tenant_id_id UNIQUE (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON public.notifications (tenant_id, recipient_user_id, is_read, created_at DESC);

CREATE TABLE IF NOT EXISTS public.notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  notification_id uuid NOT NULL,
  channel text NOT NULL CHECK (channel IN ('in_app', 'email', 'sms', 'whatsapp')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  provider_ref text,
  error_message text,
  attempted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_nd_notification FOREIGN KEY (tenant_id, notification_id) REFERENCES public.notifications(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_notif
  ON public.notification_deliveries (tenant_id, notification_id);

-- ----------------------------------------------------------------------------
-- 4. Access Helper Functions & FORCE ROW LEVEL SECURITY Policies
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.try_parse_uuid(p_text text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN p_text::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.user_is_staff_member(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships tm
    JOIN public.profiles pr ON pr.id = tm.user_id AND pr.is_active = true
    JOIN public.tenants t ON t.id = tm.tenant_id AND t.status = 'active'
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.is_active = true
      AND tm.account_subject_type IN ('staff', 'platform_support')
  );
$$;

REVOKE ALL ON FUNCTION app_private.user_is_staff_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.user_is_staff_member(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.user_can_access_conversation(
  p_tenant_id uuid,
  p_conversation_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = p_conversation_id
      AND c.tenant_id = p_tenant_id
      AND app_private.user_belongs_to_tenant(p_tenant_id)
      AND (
        -- Client users see ONLY conversations belonging to their bound client_id
        (app_private.user_get_bound_client_id(p_tenant_id) IS NOT NULL AND c.client_id = app_private.user_get_bound_client_id(p_tenant_id))
        -- Courier users see ONLY conversations assigned to their courier_id or accessible shipment
        OR (
          app_private.user_get_bound_courier_id(p_tenant_id) IS NOT NULL
          AND (
            c.courier_id = app_private.user_get_bound_courier_id(p_tenant_id)
            OR (c.shipment_id IS NOT NULL AND app_private.user_can_access_shipment_id(p_tenant_id, c.shipment_id))
          )
        )
        -- Staff members see conversations within their tenant/branch/shipment access
        OR (
          app_private.user_get_bound_client_id(p_tenant_id) IS NULL
          AND app_private.user_get_bound_courier_id(p_tenant_id) IS NULL
          AND (
            c.shipment_id IS NULL
            OR app_private.user_can_access_shipment_id(p_tenant_id, c.shipment_id)
          )
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION app_private.user_can_access_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.user_can_access_conversation(uuid, uuid) TO authenticated;

DO $$
DECLARE
  v_tbl text;
  v_tables text[] := ARRAY[
    'conversations', 'conversation_participants', 'messages',
    'storage_objects_metadata', 'message_attachments', 'shipment_attachments',
    'notifications', 'notification_deliveries'
  ];
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_tbl);
  END LOOP;
END $$;

DROP POLICY IF EXISTS conversations_select_policy ON public.conversations;
CREATE POLICY conversations_select_policy ON public.conversations
  FOR SELECT TO authenticated
  USING (app_private.user_can_access_conversation(tenant_id, id));

DROP POLICY IF EXISTS conversation_participants_select_policy ON public.conversation_participants;
CREATE POLICY conversation_participants_select_policy ON public.conversation_participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND app_private.user_can_access_conversation(tenant_id, conversation_id)
  );

DROP POLICY IF EXISTS messages_select_policy ON public.messages;
CREATE POLICY messages_select_policy ON public.messages
  FOR SELECT TO authenticated
  USING (
    app_private.user_can_access_conversation(tenant_id, conversation_id)
    AND (
      visibility = 'external'
      OR app_private.user_is_staff_member(tenant_id)
    )
  );

DROP POLICY IF EXISTS storage_objects_metadata_select_policy ON public.storage_objects_metadata;
CREATE POLICY storage_objects_metadata_select_policy ON public.storage_objects_metadata
  FOR SELECT TO authenticated
  USING (
    app_private.user_belongs_to_tenant(tenant_id)
    AND (
      visibility = 'external'
      OR app_private.user_is_staff_member(tenant_id)
    )
    AND (
      (shipment_id IS NOT NULL AND app_private.user_can_access_shipment_id(tenant_id, shipment_id))
      OR (
        shipment_id IS NULL
        AND (
          app_private.user_is_staff_member(tenant_id)
          OR (client_id IS NOT NULL AND client_id = app_private.user_get_bound_client_id(tenant_id))
        )
      )
    )
  );

DROP POLICY IF EXISTS message_attachments_select_policy ON public.message_attachments;
CREATE POLICY message_attachments_select_policy ON public.message_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_attachments.message_id
        AND m.tenant_id = message_attachments.tenant_id
        AND app_private.user_can_access_conversation(m.tenant_id, m.conversation_id)
        AND (m.visibility = 'external' OR app_private.user_is_staff_member(m.tenant_id))
    )
  );

DROP POLICY IF EXISTS shipment_attachments_select_policy ON public.shipment_attachments;
CREATE POLICY shipment_attachments_select_policy ON public.shipment_attachments
  FOR SELECT TO authenticated
  USING (
    app_private.user_can_access_shipment_id(tenant_id, shipment_id)
    AND EXISTS (
      SELECT 1 FROM public.storage_objects_metadata som
      WHERE som.id = shipment_attachments.storage_object_id
        AND som.tenant_id = shipment_attachments.tenant_id
        AND (som.visibility = 'external' OR app_private.user_is_staff_member(som.tenant_id))
    )
  );

DROP POLICY IF EXISTS notifications_select_policy ON public.notifications;
CREATE POLICY notifications_select_policy ON public.notifications
  FOR SELECT TO authenticated
  USING (
    recipient_user_id = auth.uid()
    AND app_private.user_belongs_to_tenant(tenant_id)
  );

DROP POLICY IF EXISTS notifications_update_policy ON public.notifications;
CREATE POLICY notifications_update_policy ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    recipient_user_id = auth.uid()
    AND app_private.user_belongs_to_tenant(tenant_id)
  )
  WITH CHECK (
    recipient_user_id = auth.uid()
    AND app_private.user_belongs_to_tenant(tenant_id)
  );

DROP POLICY IF EXISTS notification_deliveries_select_policy ON public.notification_deliveries;
CREATE POLICY notification_deliveries_select_policy ON public.notification_deliveries
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.id = notification_deliveries.notification_id
        AND n.tenant_id = notification_deliveries.tenant_id
        AND n.recipient_user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 5. Private Supabase Storage Buckets & Tenant-Isolated Storage Policies
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('shipment-attachments', 'shipment-attachments', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('message-attachments', 'message-attachments', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('delivery-proof', 'delivery-proof', false, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS shipflow_private_storage_select ON storage.objects;
CREATE POLICY shipflow_private_storage_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id IN ('shipment-attachments', 'message-attachments', 'delivery-proof')
    AND app_private.try_parse_uuid((storage.foldername(name))[1]) IS NOT NULL
    AND app_private.user_belongs_to_tenant(app_private.try_parse_uuid((storage.foldername(name))[1]))
    AND EXISTS (
      SELECT 1 FROM public.storage_objects_metadata som
      WHERE som.bucket_id = storage.objects.bucket_id
        AND som.object_path = storage.objects.name
        AND som.tenant_id = app_private.try_parse_uuid((storage.foldername(name))[1])
        AND (som.visibility = 'external' OR app_private.user_is_staff_member(som.tenant_id))
        AND (
          (som.shipment_id IS NOT NULL AND app_private.user_can_access_shipment_id(som.tenant_id, som.shipment_id))
          OR (
            som.shipment_id IS NULL
            AND (
              app_private.user_is_staff_member(som.tenant_id)
              OR (som.client_id IS NOT NULL AND som.client_id = app_private.user_get_bound_client_id(som.tenant_id))
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS shipflow_private_storage_insert ON storage.objects;
CREATE POLICY shipflow_private_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id IN ('shipment-attachments', 'message-attachments', 'delivery-proof')
    AND app_private.try_parse_uuid((storage.foldername(name))[1]) IS NOT NULL
    AND app_private.user_belongs_to_tenant(app_private.try_parse_uuid((storage.foldername(name))[1]))
  );

DROP POLICY IF EXISTS shipflow_private_storage_delete ON storage.objects;
CREATE POLICY shipflow_private_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id IN ('shipment-attachments', 'message-attachments', 'delivery-proof')
    AND app_private.try_parse_uuid((storage.foldername(name))[1]) IS NOT NULL
    AND (
      app_private.user_is_tenant_admin(app_private.try_parse_uuid((storage.foldername(name))[1]))
      OR owner = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 6. Internal Notification Dispatch Helper + Shipment Status Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.dispatch_notification(
  p_tenant_id uuid,
  p_recipient_user_id uuid,
  p_category text,
  p_title text,
  p_body text,
  p_entity_type text DEFAULT NULL,
  p_entity_id uuid DEFAULT NULL,
  p_action_path text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_notif_id uuid;
BEGIN
  IF p_recipient_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.notifications (
    tenant_id, recipient_user_id, category, title, body,
    entity_type, entity_id, action_path
  )
  VALUES (
    p_tenant_id, p_recipient_user_id, p_category, p_title, p_body,
    p_entity_type, p_entity_id, p_action_path
  )
  RETURNING id INTO v_notif_id;

  INSERT INTO public.notification_deliveries (
    tenant_id, notification_id, channel, status, attempted_at
  )
  VALUES (
    p_tenant_id, v_notif_id, 'in_app', 'sent', now()
  );

  RETURN v_notif_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.dispatch_notification(uuid, uuid, text, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.notify_on_shipment_status_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_shp public.shipments%ROWTYPE;
  v_slug text;
  v_notify_enabled boolean := true;
  v_rec record;
  v_title text;
  v_body text;
BEGIN
  SELECT * INTO v_shp
  FROM public.shipments
  WHERE id = NEW.shipment_id AND tenant_id = NEW.tenant_id;

  IF v_shp.id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(ts.notify_on_shipment_status, true), t.slug
  INTO v_notify_enabled, v_slug
  FROM public.tenants t
  LEFT JOIN public.tenant_settings ts ON ts.tenant_id = t.id
  WHERE t.id = NEW.tenant_id;

  IF NOT v_notify_enabled THEN
    RETURN NEW;
  END IF;

  v_title := 'تحديث حالة الشحنة ' || v_shp.shipment_number;
  v_body := 'انتقلت الشحنة ' || v_shp.shipment_number || ' إلى الحالة: ' || NEW.to_status
    || COALESCE(' · ' || NULLIF(trim(NEW.notes), ''), '');

  -- Notify bound merchant users for this shipment's client
  FOR v_rec IN
    SELECT DISTINCT tm.user_id
    FROM public.account_subjects asub
    JOIN public.tenant_memberships tm ON tm.id = asub.membership_id AND tm.tenant_id = asub.tenant_id
    WHERE asub.tenant_id = NEW.tenant_id
      AND asub.client_id = v_shp.client_id
      AND asub.is_active = true
      AND tm.is_active = true
      AND tm.user_id <> COALESCE(NEW.actor_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LOOP
    PERFORM app_private.dispatch_notification(
      NEW.tenant_id,
      v_rec.user_id,
      CASE WHEN NEW.to_status IN ('delivery_failed', 'return_to_sender', 'returned') THEN 'delivery_exception' ELSE 'shipment_status' END,
      v_title,
      v_body,
      'shipment',
      v_shp.id,
      '/c/' || v_slug || '/app/shipments/' || v_shp.id::text
    );
  END LOOP;

  -- Notify assigned courier user if assigned & not the actor
  IF v_shp.assigned_courier_id IS NOT NULL THEN
    FOR v_rec IN
      SELECT DISTINCT tm.user_id
      FROM public.account_subjects asub
      JOIN public.tenant_memberships tm ON tm.id = asub.membership_id AND tm.tenant_id = asub.tenant_id
      WHERE asub.tenant_id = NEW.tenant_id
        AND asub.courier_id = v_shp.assigned_courier_id
        AND asub.is_active = true
        AND tm.is_active = true
        AND tm.user_id <> COALESCE(NEW.actor_user_id, '00000000-0000-0000-0000-000000000000'::uuid)
    LOOP
      PERFORM app_private.dispatch_notification(
        NEW.tenant_id,
        v_rec.user_id,
        'shipment_status',
        v_title,
        v_body,
        'shipment',
        v_shp.id,
        '/c/' || v_slug || '/app/operations/courier-portal'
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipment_status_event_notify ON public.shipment_status_events;
CREATE TRIGGER trg_shipment_status_event_notify
  AFTER INSERT ON public.shipment_status_events
  FOR EACH ROW EXECUTE FUNCTION app_private.notify_on_shipment_status_event();

-- ----------------------------------------------------------------------------
-- 7. Server-Side RPCs: Conversations, Messages, Attachments & Notifications
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.open_or_get_conversation(
  p_tenant_id uuid,
  p_entity_type text,
  p_entity_id uuid DEFAULT NULL,
  p_subject text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_conv_id uuid;
  v_shp public.shipments%ROWTYPE;
  v_client_id uuid := app_private.user_get_bound_client_id(p_tenant_id);
  v_courier_id uuid := app_private.user_get_bound_courier_id(p_tenant_id);
  v_branch_id uuid;
  v_target_client_id uuid;
  v_target_courier_id uuid;
  v_target_shipment_id uuid;
  v_clean_subject text;
  v_req public.client_pickup_requests%ROWTYPE;
  v_client_row public.clients%ROWTYPE;
BEGIN
  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'غير مصرح بالوصول إلى محادثات هذه الشركة.';
  END IF;

  IF p_entity_type NOT IN ('shipment', 'client', 'pickup_request', 'general') THEN
    RAISE EXCEPTION 'نوع الكيان المرتبط بالمحادثة غير صالح.';
  END IF;

  IF p_entity_type = 'shipment' THEN
    IF p_entity_id IS NULL OR NOT app_private.user_can_access_shipment_id(p_tenant_id, p_entity_id) THEN
      RAISE EXCEPTION 'الشحنة غير موجودة أو لا تملك صلاحية فتح محادثتها.';
    END IF;
    SELECT * INTO v_shp FROM public.shipments WHERE id = p_entity_id AND tenant_id = p_tenant_id;
    v_target_shipment_id := v_shp.id;
    v_target_client_id := v_shp.client_id;
    v_target_courier_id := v_shp.assigned_courier_id;
    v_branch_id := v_shp.current_branch_id;
    v_clean_subject := COALESCE(nullif(trim(COALESCE(p_subject, '')), ''), 'محادثة الشحنة ' || v_shp.shipment_number);

  ELSIF p_entity_type = 'client' THEN
    IF v_client_id IS NOT NULL THEN
      v_target_client_id := v_client_id;
    ELSIF p_entity_id IS NOT NULL AND app_private.user_is_staff_member(p_tenant_id) THEN
      v_target_client_id := p_entity_id;
    ELSE
      RAISE EXCEPTION 'غير مصرح بفتح محادثة هذا التاجر.';
    END IF;
    SELECT * INTO v_client_row FROM public.clients WHERE id = v_target_client_id AND tenant_id = p_tenant_id;
    IF v_client_row.id IS NULL THEN
      RAISE EXCEPTION 'ملف العميل غير موجود.';
    END IF;
    v_branch_id := v_client_row.branch_id;
    v_clean_subject := COALESCE(nullif(trim(COALESCE(p_subject, '')), ''), 'تواصل التاجر · ' || v_client_row.name);
    p_entity_id := v_client_row.id;

  ELSIF p_entity_type = 'pickup_request' THEN
    SELECT * INTO v_req FROM public.client_pickup_requests WHERE id = p_entity_id AND tenant_id = p_tenant_id;
    IF v_req.id IS NULL THEN
      RAISE EXCEPTION 'طلب الالتقاط غير موجود.';
    END IF;
    IF v_client_id IS NOT NULL AND v_req.client_id <> v_client_id THEN
      RAISE EXCEPTION 'غير مصرح بفتح محادثة طلب التقاط لعميل آخر.';
    END IF;
    IF v_courier_id IS NOT NULL THEN
      RAISE EXCEPTION 'غير مصرح بفتح محادثة طلب الالتقاط.';
    END IF;
    v_target_client_id := v_req.client_id;
    v_branch_id := v_req.branch_id;
    v_clean_subject := COALESCE(nullif(trim(COALESCE(p_subject, '')), ''), 'طلب الالتقاط ' || v_req.request_code);

  ELSE
    IF NOT app_private.user_is_staff_member(p_tenant_id) THEN
      RAISE EXCEPTION 'المحادثات العامة مخصصة لفريق الشركة الداخلي فقط.';
    END IF;
    v_clean_subject := COALESCE(nullif(trim(COALESCE(p_subject, '')), ''), 'تواصل داخلي بين الفروع');
  END IF;

  IF p_entity_id IS NOT NULL THEN
    SELECT id INTO v_conv_id
    FROM public.conversations
    WHERE tenant_id = p_tenant_id
      AND entity_type = p_entity_type
      AND entity_id = p_entity_id
    LIMIT 1;
  END IF;

  IF v_conv_id IS NULL THEN
    INSERT INTO public.conversations (
      tenant_id, entity_type, entity_id, shipment_id, client_id, courier_id,
      branch_id, subject, status, created_by, updated_by
    )
    VALUES (
      p_tenant_id, p_entity_type, p_entity_id, v_target_shipment_id, v_target_client_id, v_target_courier_id,
      v_branch_id, v_clean_subject, 'open', auth.uid(), auth.uid()
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_conv_id;

    IF v_conv_id IS NULL AND p_entity_id IS NOT NULL THEN
      SELECT id INTO v_conv_id
      FROM public.conversations
      WHERE tenant_id = p_tenant_id
        AND entity_type = p_entity_type
        AND entity_id = p_entity_id
      LIMIT 1;
    END IF;
  END IF;

  INSERT INTO public.conversation_participants (tenant_id, conversation_id, user_id, last_read_at)
  VALUES (p_tenant_id, v_conv_id, auth.uid(), now())
  ON CONFLICT (tenant_id, conversation_id, user_id) DO NOTHING;

  RETURN v_conv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.open_or_get_conversation(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_or_get_conversation(uuid, text, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.send_conversation_message(
  p_tenant_id uuid,
  p_conversation_id uuid,
  p_body text,
  p_visibility text DEFAULT 'external',
  p_idempotency_key text DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_conv public.conversations%ROWTYPE;
  v_tm public.tenant_memberships%ROWTYPE;
  v_display_name text;
  v_clean_body text := trim(COALESCE(p_body, ''));
  v_clean_idem text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_vis text := COALESCE(nullif(trim(COALESCE(p_visibility, '')), ''), 'external');
  v_msg_id uuid;
  v_existing public.messages%ROWTYPE;
  v_att jsonb;
  v_obj_id uuid;
  v_att_count integer := 0;
  v_max_mb integer := 5;
  v_slug text;
  v_notify_msg boolean := true;
  v_rec record;
  v_preview text;
BEGIN
  IF NOT app_private.user_can_access_conversation(p_tenant_id, p_conversation_id) THEN
    RAISE EXCEPTION 'غير مصرح بإرسال رسائل في هذه المحادثة.';
  END IF;

  SELECT * INTO v_conv
  FROM public.conversations
  WHERE id = p_conversation_id AND tenant_id = p_tenant_id;

  IF v_conv.id IS NULL THEN
    RAISE EXCEPTION 'المحادثة غير موجودة.';
  END IF;

  SELECT tm.*, p.display_name AS profile_name INTO v_tm
  FROM public.tenant_memberships tm
  JOIN public.profiles p ON p.id = tm.user_id
  WHERE tm.tenant_id = p_tenant_id AND tm.user_id = auth.uid() AND tm.is_active = true
  LIMIT 1;

  SELECT display_name INTO v_display_name FROM public.profiles WHERE id = auth.uid();
  v_display_name := COALESCE(nullif(trim(v_display_name), ''), v_tm.username, 'مستخدم');

  IF v_vis NOT IN ('external', 'internal') THEN
    RAISE EXCEPTION 'نوع الرؤية غير صالح.';
  END IF;

  -- Non-staff users (clients/couriers) cannot create internal staff-only messages
  IF v_tm.account_subject_type IN ('client', 'courier') THEN
    v_vis := 'external';
  END IF;

  -- Idempotency check to avoid duplicate messages on network retry
  IF v_clean_idem IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.messages
    WHERE tenant_id = p_tenant_id AND idempotency_key = v_clean_idem
    LIMIT 1;
    IF v_existing.id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'message_id', v_existing.id,
        'conversation_id', v_existing.conversation_id,
        'deduplicated', true
      );
    END IF;
  END IF;

  IF v_clean_body = '' AND (p_attachments IS NULL OR jsonb_array_length(p_attachments) = 0) THEN
    RAISE EXCEPTION 'يجب كتابة نص الرسالة أو إرفاق ملف واحد على الأقل.';
  END IF;

  SELECT COALESCE(ts.attachment_max_size_mb, 5), COALESCE(ts.notify_on_new_message, true), t.slug
  INTO v_max_mb, v_notify_msg, v_slug
  FROM public.tenants t
  LEFT JOIN public.tenant_settings ts ON ts.tenant_id = t.id
  WHERE t.id = p_tenant_id;

  INSERT INTO public.messages (
    tenant_id, conversation_id, sender_user_id, sender_display_name,
    sender_subject_type, visibility, body, idempotency_key
  )
  VALUES (
    p_tenant_id, p_conversation_id, auth.uid(), v_display_name,
    v_tm.account_subject_type, v_vis, v_clean_body, v_clean_idem
  )
  RETURNING id INTO v_msg_id;

  IF p_attachments IS NOT NULL AND jsonb_typeof(p_attachments) = 'array' THEN
    FOR v_att IN SELECT * FROM jsonb_array_elements(p_attachments) LOOP
      IF (v_att->>'size_bytes')::bigint > (v_max_mb::bigint * 1024 * 1024) THEN
        RAISE EXCEPTION 'حجم الملف المرفق يتجاوز الحد المسموح (% ميجابايت).', v_max_mb;
      END IF;

      INSERT INTO public.storage_objects_metadata (
        tenant_id, bucket_id, object_path, entity_type, entity_id,
        shipment_id, client_id, file_name, mime_type, size_bytes,
        visibility, uploaded_by, uploaded_by_name
      )
      VALUES (
        p_tenant_id,
        COALESCE(nullif(v_att->>'bucket_id', ''), 'message-attachments'),
        v_att->>'object_path',
        'message',
        v_msg_id,
        v_conv.shipment_id,
        v_conv.client_id,
        v_att->>'file_name',
        v_att->>'mime_type',
        (v_att->>'size_bytes')::bigint,
        v_vis,
        auth.uid(),
        v_display_name
      )
      RETURNING id INTO v_obj_id;

      INSERT INTO public.message_attachments (tenant_id, message_id, storage_object_id)
      VALUES (p_tenant_id, v_msg_id, v_obj_id);

      IF v_conv.shipment_id IS NOT NULL THEN
        INSERT INTO public.shipment_attachments (
          tenant_id, shipment_id, storage_object_id, category, notes, created_by
        )
        VALUES (
          p_tenant_id, v_conv.shipment_id, v_obj_id, 'general',
          'مرفق محادثة · ' || v_display_name, auth.uid()
        )
        ON CONFLICT DO NOTHING;
      END IF;

      v_att_count := v_att_count + 1;
    END LOOP;
  END IF;

  v_preview := left(
    CASE
      WHEN v_clean_body <> '' THEN v_clean_body
      ELSE 'مرفق (' || v_att_count::text || ')'
    END,
    120
  );

  UPDATE public.conversations
  SET
    last_message_at = now(),
    last_message_preview = CASE WHEN v_vis = 'internal' THEN '[داخلي] ' || v_preview ELSE v_preview END,
    status = 'open',
    updated_by = auth.uid(),
    updated_at = now()
  WHERE id = p_conversation_id;

  INSERT INTO public.conversation_participants (tenant_id, conversation_id, user_id, last_read_at)
  VALUES (p_tenant_id, p_conversation_id, auth.uid(), now())
  ON CONFLICT (tenant_id, conversation_id, user_id) DO UPDATE
    SET last_read_at = now(), updated_at = now();

  -- Notify participants when notifications are enabled
  IF v_notify_msg THEN
    -- 1. If external message and conversation has a client, notify bound client users
    IF v_vis = 'external' AND v_conv.client_id IS NOT NULL THEN
      FOR v_rec IN
        SELECT DISTINCT tm.user_id
        FROM public.account_subjects asub
        JOIN public.tenant_memberships tm ON tm.id = asub.membership_id AND tm.tenant_id = asub.tenant_id
        WHERE asub.tenant_id = p_tenant_id
          AND asub.client_id = v_conv.client_id
          AND asub.is_active = true
          AND tm.is_active = true
          AND tm.user_id <> auth.uid()
      LOOP
        PERFORM app_private.dispatch_notification(
          p_tenant_id,
          v_rec.user_id,
          'new_message',
          'رسالة جديدة · ' || v_conv.subject,
          v_display_name || ': ' || v_preview,
          v_conv.entity_type,
          COALESCE(v_conv.entity_id, v_conv.id),
          CASE WHEN v_conv.shipment_id IS NOT NULL
            THEN '/c/' || v_slug || '/app/shipments/' || v_conv.shipment_id::text
            ELSE '/c/' || v_slug || '/app/messaging'
          END
        );
      END LOOP;
    END IF;

    -- 2. If sender is client or courier, notify active tenant admins & support staff
    IF v_tm.account_subject_type IN ('client', 'courier') THEN
      FOR v_rec IN
        SELECT DISTINCT tm.user_id
        FROM public.tenant_memberships tm
        WHERE tm.tenant_id = p_tenant_id
          AND tm.is_active = true
          AND tm.account_subject_type = 'staff'
          AND tm.role_key IN ('company_owner', 'company_admin', 'customer_support', 'operations_manager')
          AND tm.user_id <> auth.uid()
      LOOP
        PERFORM app_private.dispatch_notification(
          p_tenant_id,
          v_rec.user_id,
          'new_message',
          'رسالة واردة · ' || v_conv.subject,
          v_display_name || ': ' || v_preview,
          v_conv.entity_type,
          COALESCE(v_conv.entity_id, v_conv.id),
          CASE WHEN v_conv.shipment_id IS NOT NULL
            THEN '/c/' || v_slug || '/app/shipments/' || v_conv.shipment_id::text
            ELSE '/c/' || v_slug || '/app/messaging'
          END
        );
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'message_id', v_msg_id,
    'conversation_id', p_conversation_id,
    'attachments_count', v_att_count,
    'deduplicated', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.send_conversation_message(uuid, uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.send_conversation_message(uuid, uuid, text, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(
  p_tenant_id uuid,
  p_conversation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_conv public.conversations%ROWTYPE;
BEGIN
  IF NOT app_private.user_can_access_conversation(p_tenant_id, p_conversation_id) THEN
    RAISE EXCEPTION 'غير مصرح بالوصول لهذه المحادثة.';
  END IF;

  INSERT INTO public.conversation_participants (tenant_id, conversation_id, user_id, last_read_at)
  VALUES (p_tenant_id, p_conversation_id, auth.uid(), now())
  ON CONFLICT (tenant_id, conversation_id, user_id) DO UPDATE
    SET last_read_at = now(), updated_at = now();

  SELECT * INTO v_conv FROM public.conversations WHERE id = p_conversation_id;

  UPDATE public.notifications
  SET is_read = true, read_at = now()
  WHERE tenant_id = p_tenant_id
    AND recipient_user_id = auth.uid()
    AND category = 'new_message'
    AND is_read = false
    AND entity_id = COALESCE(v_conv.entity_id, v_conv.id);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_shipment_attachment(
  p_tenant_id uuid,
  p_shipment_id uuid,
  p_bucket_id text,
  p_object_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_category text DEFAULT 'general',
  p_visibility text DEFAULT 'external',
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_shp public.shipments%ROWTYPE;
  v_max_mb integer := 5;
  v_display_name text;
  v_vis text := COALESCE(nullif(trim(COALESCE(p_visibility, '')), ''), 'external');
  v_obj_id uuid;
  v_att_id uuid;
BEGIN
  IF NOT app_private.user_can_access_shipment_id(p_tenant_id, p_shipment_id) THEN
    RAISE EXCEPTION 'غير مصرح بإرفاق ملفات لهذه الشحنة.';
  END IF;

  SELECT * INTO v_shp FROM public.shipments WHERE id = p_shipment_id AND tenant_id = p_tenant_id;
  IF v_shp.id IS NULL THEN
    RAISE EXCEPTION 'الشحنة غير موجودة.';
  END IF;

  IF NOT app_private.user_is_staff_member(p_tenant_id) THEN
    v_vis := 'external';
  END IF;

  SELECT COALESCE(attachment_max_size_mb, 5) INTO v_max_mb
  FROM public.tenant_settings WHERE tenant_id = p_tenant_id;

  IF p_size_bytes <= 0 OR p_size_bytes > (v_max_mb::bigint * 1024 * 1024) THEN
    RAISE EXCEPTION 'حجم الملف يتجاوز الحد الأقصى المسموح (% ميجابايت).', v_max_mb;
  END IF;

  IF p_object_path NOT LIKE (p_tenant_id::text || '/%') THEN
    RAISE EXCEPTION 'مسار التخزين غير متوافق مع عزل الشركة.';
  END IF;

  SELECT COALESCE(nullif(trim(display_name), ''), 'مستخدم النظام') INTO v_display_name
  FROM public.profiles WHERE id = auth.uid();

  INSERT INTO public.storage_objects_metadata (
    tenant_id, bucket_id, object_path, entity_type, entity_id,
    shipment_id, client_id, file_name, mime_type, size_bytes,
    visibility, uploaded_by, uploaded_by_name
  )
  VALUES (
    p_tenant_id, p_bucket_id, p_object_path,
    CASE WHEN p_category = 'delivery_proof' THEN 'delivery_proof' ELSE 'shipment' END,
    p_shipment_id,
    p_shipment_id, v_shp.client_id, p_file_name, p_mime_type, p_size_bytes,
    v_vis, auth.uid(), v_display_name
  )
  RETURNING id INTO v_obj_id;

  INSERT INTO public.shipment_attachments (
    tenant_id, shipment_id, storage_object_id, category, notes, created_by
  )
  VALUES (
    p_tenant_id, p_shipment_id, v_obj_id,
    COALESCE(nullif(trim(COALESCE(p_category, '')), ''), 'general'),
    nullif(trim(COALESCE(p_notes, '')), ''),
    auth.uid()
  )
  RETURNING id INTO v_att_id;

  RETURN v_att_id;
END;
$$;

REVOKE ALL ON FUNCTION public.register_shipment_attachment(uuid, uuid, text, text, text, text, bigint, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_shipment_attachment(uuid, uuid, text, text, text, text, bigint, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_shipment_attachment(
  p_tenant_id uuid,
  p_attachment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_row public.shipment_attachments%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.shipment_attachments
  WHERE id = p_attachment_id AND tenant_id = p_tenant_id;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'المرفق غير موجود.';
  END IF;

  IF NOT (
    app_private.user_is_tenant_admin(p_tenant_id)
    OR (v_row.created_by = auth.uid() AND app_private.user_can_access_shipment_id(p_tenant_id, v_row.shipment_id))
  ) THEN
    RAISE EXCEPTION 'غير مصرح بحذف هذا المرفق.';
  END IF;

  DELETE FROM public.shipment_attachments WHERE id = v_row.id;
  DELETE FROM public.storage_objects_metadata
  WHERE id = v_row.storage_object_id
    AND tenant_id = p_tenant_id
    AND NOT EXISTS (
      SELECT 1 FROM public.message_attachments ma
      WHERE ma.storage_object_id = v_row.storage_object_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_shipment_attachment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_shipment_attachment(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_notifications_read(
  p_tenant_id uuid,
  p_notification_ids uuid[] DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'غير مصرح بالوصول لإشعارات هذه الشركة.';
  END IF;

  IF p_notification_ids IS NULL OR array_length(p_notification_ids, 1) IS NULL THEN
    UPDATE public.notifications
    SET is_read = true, read_at = now()
    WHERE tenant_id = p_tenant_id
      AND recipient_user_id = auth.uid()
      AND is_read = false;
  ELSE
    UPDATE public.notifications
    SET is_read = true, read_at = now()
    WHERE tenant_id = p_tenant_id
      AND recipient_user_id = auth.uid()
      AND id = ANY(p_notification_ids)
      AND is_read = false;
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_tenant_messaging_settings(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_row public.tenant_settings%ROWTYPE;
BEGIN
  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'غير مصرح بعرض إعدادات الرسائل والملفات.';
  END IF;

  SELECT * INTO v_row FROM public.tenant_settings WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'tenant_id', p_tenant_id,
    'message_retention_days', COALESCE(v_row.message_retention_days, 365),
    'attachment_max_size_mb', COALESCE(v_row.attachment_max_size_mb, 5),
    'notify_on_shipment_status', COALESCE(v_row.notify_on_shipment_status, true),
    'notify_on_new_message', COALESCE(v_row.notify_on_new_message, true),
    'notify_on_settlement', COALESCE(v_row.notify_on_settlement, true)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_messaging_settings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_messaging_settings(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_messaging_settings(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_row public.tenant_settings%ROWTYPE;
BEGIN
  IF NOT app_private.user_is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'تعديل إعدادات الرسائل والملفات مقتصر على إدارة الشركة.';
  END IF;

  UPDATE public.tenant_settings
  SET
    message_retention_days = COALESCE((p_payload->>'message_retention_days')::integer, message_retention_days),
    attachment_max_size_mb = COALESCE((p_payload->>'attachment_max_size_mb')::integer, attachment_max_size_mb),
    notify_on_shipment_status = COALESCE((p_payload->>'notify_on_shipment_status')::boolean, notify_on_shipment_status),
    notify_on_new_message = COALESCE((p_payload->>'notify_on_new_message')::boolean, notify_on_new_message),
    notify_on_settlement = COALESCE((p_payload->>'notify_on_settlement')::boolean, notify_on_settlement),
    updated_at = now()
  WHERE tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'tenant_id', p_tenant_id,
    'message_retention_days', v_row.message_retention_days,
    'attachment_max_size_mb', v_row.attachment_max_size_mb,
    'notify_on_shipment_status', v_row.notify_on_shipment_status,
    'notify_on_new_message', v_row.notify_on_new_message,
    'notify_on_settlement', v_row.notify_on_settlement
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_messaging_settings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_messaging_settings(uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Enable Supabase Realtime on messages & notifications when available
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;