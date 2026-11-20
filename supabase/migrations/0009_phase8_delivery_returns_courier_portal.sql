-- ============================================================================
-- Migration 0009: Phase 8 - Delivery Lists, Redelivery, Returns, POD & Courier Portal
-- ============================================================================
-- Implements approved decisions:
-- - ADR-016 (OQ-08): Return fee liability modes:
--     1) `no_charge`: sender bears `shipments.return_fee` in Phase 9 settlement
--     2) `sender_partial_fee`: sender bears specified `applied_return_fee`
--     3) `recipient_paid_fee`: recipient pays at door -> `return_collected_from_recipient` (courier cash custody)
--     Default courier commission on returned shipments = 0.
-- - ADR-017 (OQ-09): Configurable delivery attempts limit (`max_delivery_attempts`, default 3)
--     & optional `retry_extra_fee` in `tenant_settings`. Automatically transitions
--     shipments hitting the limit to `return_to_sender`; blocks adding maxed-out
--     shipments to delivery/redelivery lists unless overridden by admin/ops manager.
-- - ADR-012 / ADR-014 Continuity: Calculates accrued courier commission on `delivered`
--     via `calculate_courier_commission`, and routes PDP partial returns & PTP exchange
--     returns cleanly through `courier_return_inbound` (RTH) -> `client_return_handover` (RTN).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extend tenant_settings (ADR-017) & shipments (ADR-016 / POD / Commission)
-- ----------------------------------------------------------------------------
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS max_delivery_attempts integer NOT NULL DEFAULT 3
    CHECK (max_delivery_attempts BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS retry_extra_fee numeric(12,2) NOT NULL DEFAULT 0
    CHECK (retry_extra_fee >= 0),
  ADD COLUMN IF NOT EXISTS require_pod_on_delivery boolean NOT NULL DEFAULT false;

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS return_liability text NOT NULL DEFAULT 'none'
    CHECK (return_liability IN ('none', 'no_charge', 'sender_partial_fee', 'recipient_paid_fee')),
  ADD COLUMN IF NOT EXISTS applied_return_fee numeric(12,2) NOT NULL DEFAULT 0
    CHECK (applied_return_fee >= 0),
  ADD COLUMN IF NOT EXISTS return_collected_from_recipient numeric(12,2) NOT NULL DEFAULT 0
    CHECK (return_collected_from_recipient >= 0),
  ADD COLUMN IF NOT EXISTS accrued_courier_commission numeric(12,2) NOT NULL DEFAULT 0
    CHECK (accrued_courier_commission >= 0),
  ADD COLUMN IF NOT EXISTS rescheduled_for_date date,
  ADD COLUMN IF NOT EXISTS proof_of_delivery_method text
    CHECK (proof_of_delivery_method IS NULL OR proof_of_delivery_method IN ('signature', 'otp', 'photo', 'none')),
  ADD COLUMN IF NOT EXISTS proof_recipient_name text,
  ADD COLUMN IF NOT EXISTS proof_signature_data text,
  ADD COLUMN IF NOT EXISTS proof_otp_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pod_captured_at timestamptz;

-- ----------------------------------------------------------------------------
-- 2. Update Document Numbering Helper & Backfill Phase 8 Sequences
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.next_document_number(
  p_tenant_id uuid,
  p_entity_key text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_seq public.numbering_sequences%ROWTYPE;
  v_formatted text;
  v_default_prefix text;
  v_default_padding integer;
BEGIN
  SELECT * INTO v_seq
  FROM public.numbering_sequences
  WHERE tenant_id = p_tenant_id
    AND entity_key = p_entity_key
  FOR UPDATE;

  IF v_seq.id IS NULL THEN
    v_default_prefix := CASE p_entity_key
      WHEN 'shipments' THEN 'SHP'
      WHEN 'pickup_lists' THEN 'PKP'
      WHEN 'warehouse_manifests' THEN 'WRH'
      WHEN 'transfer_lists' THEN 'TRF'
      WHEN 'delivery_lists' THEN 'DLV'
      WHEN 'redelivery_lists' THEN 'RDL'
      WHEN 'courier_return_handovers' THEN 'RTH'
      WHEN 'return_dispatch_lists' THEN 'RTD'
      WHEN 'return_lists' THEN 'RTN'
      ELSE upper(left(p_entity_key, 3))
    END;

    v_default_padding := CASE WHEN p_entity_key = 'shipments' THEN 7 ELSE 6 END;

    INSERT INTO public.numbering_sequences (tenant_id, entity_key, label, prefix, next_number, padding_length)
    VALUES (p_tenant_id, p_entity_key, p_entity_key, v_default_prefix, 1, v_default_padding)
    RETURNING * INTO v_seq;
  END IF;

  v_formatted := v_seq.prefix || '-' || lpad(v_seq.next_number::text, v_seq.padding_length, '0');

  UPDATE public.numbering_sequences
  SET next_number = v_seq.next_number + 1
  WHERE id = v_seq.id;

  RETURN v_formatted;
END;
$$;

REVOKE ALL ON FUNCTION app_private.next_document_number(uuid, text) FROM PUBLIC, anon, authenticated;

INSERT INTO public.numbering_sequences (tenant_id, entity_key, label, prefix, next_number, padding_length)
SELECT t.id, s.entity_key, s.label, s.prefix, 1, 6
FROM public.tenants t
CROSS JOIN (
  VALUES
    ('delivery_lists', 'قوائم التوصيل', 'DLV'),
    ('redelivery_lists', 'قوائم إعادة التوصيل', 'RDL'),
    ('courier_return_handovers', 'استلام المرتجع من المناديب', 'RTH'),
    ('return_dispatch_lists', 'قوائم توصيل المرتجعات', 'RTD'),
    ('return_lists', 'قوائم تسليم المرتجعات للعملاء', 'RTN')
) AS s(entity_key, label, prefix)
ON CONFLICT (tenant_id, entity_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Phase 8 Tables: Delivery Lists, Redelivery Lists & Return Manifests
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.delivery_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  list_code text NOT NULL CHECK (char_length(trim(list_code)) >= 4),
  list_type text NOT NULL DEFAULT 'delivery' CHECK (list_type IN ('delivery', 'redelivery')),
  list_date date NOT NULL DEFAULT current_date,
  branch_id uuid NOT NULL,
  courier_id uuid NOT NULL,
  route_id uuid,
  movement_type_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'closed', 'cancelled')),
  notes text,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_delivery_lists_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_delivery_lists_tenant_code UNIQUE (tenant_id, list_code),
  CONSTRAINT fk_dlv_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_dlv_courier FOREIGN KEY (tenant_id, courier_id) REFERENCES public.couriers(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_dlv_route FOREIGN KEY (tenant_id, route_id) REFERENCES public.courier_routes(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_dlv_movement FOREIGN KEY (tenant_id, movement_type_id) REFERENCES public.movement_types(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_delivery_lists_tenant_type_date ON public.delivery_lists (tenant_id, list_type, branch_id, list_date DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_lists_tenant_courier ON public.delivery_lists (tenant_id, courier_id, status);

DROP TRIGGER IF EXISTS trg_delivery_lists_updated_at ON public.delivery_lists;
CREATE TRIGGER trg_delivery_lists_updated_at
  BEFORE UPDATE ON public.delivery_lists
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE IF NOT EXISTS public.delivery_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  delivery_list_id uuid NOT NULL,
  shipment_id uuid NOT NULL,
  added_via text NOT NULL DEFAULT 'manual' CHECK (added_via IN ('manual', 'barcode')),
  execution_outcome text NOT NULL DEFAULT 'pending'
    CHECK (execution_outcome IN ('pending', 'delivered', 'partially_delivered', 'rescheduled', 'delivery_failed', 'return_to_sender')),
  delivered_amount numeric(14,2),
  delivered_pieces_count integer,
  exception_reason_id uuid,
  return_type_code text CHECK (return_type_code IS NULL OR return_type_code IN ('no_charge', 'sender_partial_fee', 'recipient_paid_fee')),
  applied_return_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (applied_return_fee >= 0),
  return_collected_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (return_collected_amount >= 0),
  attempt_overridden boolean NOT NULL DEFAULT false,
  outcome_notes text,
  executed_at timestamptz,
  executed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_delivery_list_items_pair UNIQUE (tenant_id, delivery_list_id, shipment_id),
  CONSTRAINT fk_dlvi_list FOREIGN KEY (tenant_id, delivery_list_id) REFERENCES public.delivery_lists(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_dlvi_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_dlvi_reason FOREIGN KEY (tenant_id, exception_reason_id) REFERENCES public.delivery_exception_reasons(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_delivery_list_items_list ON public.delivery_list_items (tenant_id, delivery_list_id);
CREATE INDEX IF NOT EXISTS idx_delivery_list_items_shipment ON public.delivery_list_items (tenant_id, shipment_id);

CREATE TABLE IF NOT EXISTS public.return_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  manifest_code text NOT NULL CHECK (char_length(trim(manifest_code)) >= 4),
  manifest_type text NOT NULL CHECK (manifest_type IN ('courier_return_inbound', 'client_return_dispatch', 'client_return_handover')),
  manifest_date date NOT NULL DEFAULT current_date,
  branch_id uuid NOT NULL,
  courier_id uuid,
  client_id uuid,
  movement_type_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
  notes text,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_return_manifests_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_return_manifests_tenant_code UNIQUE (tenant_id, manifest_code),
  CONSTRAINT fk_rtnm_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rtnm_courier FOREIGN KEY (tenant_id, courier_id) REFERENCES public.couriers(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rtnm_client FOREIGN KEY (tenant_id, client_id) REFERENCES public.clients(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rtnm_movement FOREIGN KEY (tenant_id, movement_type_id) REFERENCES public.movement_types(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_return_manifests_tenant_type_date ON public.return_manifests (tenant_id, manifest_type, branch_id, manifest_date DESC);

DROP TRIGGER IF EXISTS trg_return_manifests_updated_at ON public.return_manifests;
CREATE TRIGGER trg_return_manifests_updated_at
  BEFORE UPDATE ON public.return_manifests
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE IF NOT EXISTS public.return_manifest_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  return_manifest_id uuid NOT NULL,
  shipment_id uuid NOT NULL,
  added_via text NOT NULL DEFAULT 'manual' CHECK (added_via IN ('manual', 'barcode')),
  handover_status text NOT NULL DEFAULT 'pending' CHECK (handover_status IN ('pending', 'completed')),
  notes text,
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_return_manifest_items_pair UNIQUE (tenant_id, return_manifest_id, shipment_id),
  CONSTRAINT fk_rtnmi_manifest FOREIGN KEY (tenant_id, return_manifest_id) REFERENCES public.return_manifests(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_rtnmi_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_return_manifest_items_manifest ON public.return_manifest_items (tenant_id, return_manifest_id);
CREATE INDEX IF NOT EXISTS idx_return_manifest_items_shipment ON public.return_manifest_items (tenant_id, shipment_id);

-- ----------------------------------------------------------------------------
-- 4. Authorization Helpers & Forced RLS (with explicit GRANT EXECUTE TO authenticated)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.user_get_bound_courier_id(p_tenant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT asub.courier_id
  FROM public.tenant_memberships tm
  JOIN public.profiles pr ON pr.id = tm.user_id AND pr.is_active = true
  JOIN public.tenants t ON t.id = tm.tenant_id AND t.status = 'active'
  JOIN public.account_subjects asub
    ON asub.tenant_id = tm.tenant_id AND asub.membership_id = tm.id AND asub.is_active = true
  WHERE tm.tenant_id = p_tenant_id
    AND tm.user_id = auth.uid()
    AND tm.is_active = true
    AND tm.account_subject_type = 'courier'
    AND asub.courier_id IS NOT NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app_private.user_get_bound_courier_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.user_get_bound_courier_id(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.user_is_staff_with_permission(
  p_tenant_id uuid,
  p_permission_key text,
  p_branch_id uuid DEFAULT NULL
)
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
  )
  AND app_private.user_has_permission(p_tenant_id, p_permission_key, p_branch_id);
$$;

REVOKE ALL ON FUNCTION app_private.user_is_staff_with_permission(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.user_is_staff_with_permission(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.user_can_access_delivery_list(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_courier_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT
    app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.delivery.execute', p_branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.pickup.approve', p_branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'shipments.read', p_branch_id)
    OR (p_courier_id IS NOT NULL AND app_private.user_get_bound_courier_id(p_tenant_id) = p_courier_id);
$$;

REVOKE ALL ON FUNCTION app_private.user_can_access_delivery_list(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.user_can_access_delivery_list(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.user_can_access_return_manifest(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_courier_id uuid,
  p_client_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT
    app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.delivery.execute', p_branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.pickup.approve', p_branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'shipments.read', p_branch_id)
    OR (p_courier_id IS NOT NULL AND app_private.user_get_bound_courier_id(p_tenant_id) = p_courier_id)
    OR (
      p_client_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.tenant_memberships tm
        JOIN public.account_subjects asub
          ON asub.tenant_id = tm.tenant_id AND asub.membership_id = tm.id AND asub.is_active = true
        WHERE tm.tenant_id = p_tenant_id
          AND tm.user_id = auth.uid()
          AND tm.is_active = true
          AND tm.account_subject_type = 'client'
          AND asub.client_id = p_client_id
      )
    );
$$;

REVOKE ALL ON FUNCTION app_private.user_can_access_return_manifest(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.user_can_access_return_manifest(uuid, uuid, uuid, uuid) TO authenticated;

DO $$
DECLARE
  v_tbl text;
  v_tables text[] := ARRAY['delivery_lists', 'delivery_list_items', 'return_manifests', 'return_manifest_items'];
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_tbl);
  END LOOP;
END $$;

DROP POLICY IF EXISTS delivery_lists_select_policy ON public.delivery_lists;
CREATE POLICY delivery_lists_select_policy ON public.delivery_lists
  FOR SELECT TO authenticated
  USING (app_private.user_can_access_delivery_list(tenant_id, branch_id, courier_id));

DROP POLICY IF EXISTS delivery_list_items_select_policy ON public.delivery_list_items;
CREATE POLICY delivery_list_items_select_policy ON public.delivery_list_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.delivery_lists dl
      WHERE dl.id = delivery_list_items.delivery_list_id
        AND dl.tenant_id = delivery_list_items.tenant_id
        AND app_private.user_can_access_delivery_list(dl.tenant_id, dl.branch_id, dl.courier_id)
    )
  );

DROP POLICY IF EXISTS return_manifests_select_policy ON public.return_manifests;
CREATE POLICY return_manifests_select_policy ON public.return_manifests
  FOR SELECT TO authenticated
  USING (app_private.user_can_access_return_manifest(tenant_id, branch_id, courier_id, client_id));

DROP POLICY IF EXISTS return_manifest_items_select_policy ON public.return_manifest_items;
CREATE POLICY return_manifest_items_select_policy ON public.return_manifest_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.return_manifests rm
      WHERE rm.id = return_manifest_items.return_manifest_id
        AND rm.tenant_id = return_manifest_items.tenant_id
        AND app_private.user_can_access_return_manifest(rm.tenant_id, rm.branch_id, rm.courier_id, rm.client_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 5. Server-Side RPC: Update Tenant Delivery & Retry Policy (ADR-017)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_tenant_delivery_policy(
  p_tenant_id uuid,
  p_max_attempts integer,
  p_retry_extra_fee numeric DEFAULT 0,
  p_require_pod boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_attempts integer := COALESCE(p_max_attempts, 3);
  v_extra numeric(12,2) := GREATEST(COALESCE(p_retry_extra_fee, 0), 0);
  v_pod boolean := COALESCE(p_require_pod, false);
BEGIN
  IF NOT app_private.user_can_override_operations(p_tenant_id) THEN
    RAISE EXCEPTION 'Forbidden: تعديل سياسة محاولات التوصيل يقتصر على مالك الشركة أو مدير العمليات.';
  END IF;

  IF v_attempts < 1 OR v_attempts > 10 THEN
    RAISE EXCEPTION 'الحد الأقصى لمحاولات التوصيل يجب أن يكون بين 1 و 10 محاولات.';
  END IF;

  INSERT INTO public.tenant_settings (
    tenant_id, max_delivery_attempts, retry_extra_fee, require_pod_on_delivery, updated_by
  )
  VALUES (
    p_tenant_id, v_attempts, v_extra, v_pod, auth.uid()
  )
  ON CONFLICT (tenant_id) DO UPDATE
    SET max_delivery_attempts = EXCLUDED.max_delivery_attempts,
        retry_extra_fee = EXCLUDED.retry_extra_fee,
        require_pod_on_delivery = EXCLUDED.require_pod_on_delivery,
        updated_by = auth.uid();

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'tenant_settings.delivery_policy_updated', 'tenant_settings', p_tenant_id,
    jsonb_build_object('max_delivery_attempts', v_attempts, 'retry_extra_fee', v_extra, 'require_pod_on_delivery', v_pod),
    'rpc'
  );

  RETURN jsonb_build_object(
    'max_delivery_attempts', v_attempts,
    'retry_extra_fee', v_extra,
    'require_pod_on_delivery', v_pod
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_delivery_policy(uuid, integer, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_delivery_policy(uuid, integer, numeric, boolean) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Server-Side RPCs: Delivery & Redelivery Lists Workflow (DLV-* / RDL-*)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_delivery_list(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_list_type text := COALESCE(NULLIF(trim(p_payload->>'list_type'), ''), 'delivery');
  v_branch_id uuid := (p_payload->>'branch_id')::uuid;
  v_courier_id uuid := NULLIF(p_payload->>'courier_id', '')::uuid;
  v_route_id uuid := NULLIF(p_payload->>'route_id', '')::uuid;
  v_movement_type_id uuid := NULLIF(p_payload->>'movement_type_id', '')::uuid;
  v_list_date date := COALESCE(NULLIF(p_payload->>'list_date', '')::date, current_date);
  v_notes text := NULLIF(trim(COALESCE(p_payload->>'notes', '')), '');
  v_list_code text;
  v_list_id uuid;
BEGIN
  IF v_list_type NOT IN ('delivery', 'redelivery') THEN
    RAISE EXCEPTION 'نوع قائمة التوصيل غير صالح.';
  END IF;

  IF v_branch_id IS NULL OR v_courier_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد الفرع ومندوب التوصيل لإنشاء القائمة.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.pickup.approve', v_branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.delivery.execute', v_branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: branch delivery list permission required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE tenant_id = p_tenant_id AND id = v_branch_id AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'الفرع المحدد غير موجود أو مؤرشف.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.couriers WHERE tenant_id = p_tenant_id AND id = v_courier_id AND archived_at IS NULL AND is_active = true) THEN
    RAISE EXCEPTION 'المندوب المحدد غير موجود أو غير نشط.';
  END IF;

  IF v_movement_type_id IS NULL THEN
    SELECT id INTO v_movement_type_id
    FROM public.movement_types
    WHERE tenant_id = p_tenant_id AND code = 'MOV-005'
    LIMIT 1;
  END IF;

  v_list_code := app_private.next_document_number(
    p_tenant_id,
    CASE WHEN v_list_type = 'redelivery' THEN 'redelivery_lists' ELSE 'delivery_lists' END
  );

  INSERT INTO public.delivery_lists (
    tenant_id, list_code, list_type, list_date, branch_id, courier_id,
    route_id, movement_type_id, status, notes, created_by, updated_by
  )
  VALUES (
    p_tenant_id, v_list_code, v_list_type, v_list_date, v_branch_id, v_courier_id,
    v_route_id, v_movement_type_id, 'draft', v_notes, auth.uid(), auth.uid()
  )
  RETURNING id INTO v_list_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(),
    CASE WHEN v_list_type = 'redelivery' THEN 'redelivery_list.created' ELSE 'delivery_list.created' END,
    'delivery_lists', v_list_id,
    jsonb_build_object('list_code', v_list_code, 'list_type', v_list_type, 'branch_id', v_branch_id, 'courier_id', v_courier_id),
    'rpc'
  );

  RETURN jsonb_build_object('id', v_list_id, 'list_code', v_list_code, 'list_type', v_list_type, 'status', 'draft');
END;
$$;

REVOKE ALL ON FUNCTION public.create_delivery_list(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_delivery_list(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_shipments_to_delivery_list(
  p_tenant_id uuid,
  p_delivery_list_id uuid,
  p_shipment_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_barcode_query text DEFAULT NULL,
  p_admin_override_attempts boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_list public.delivery_lists%ROWTYPE;
  v_clean_q text := trim(COALESCE(p_barcode_query, ''));
  v_via text := CASE WHEN char_length(trim(COALESCE(p_barcode_query, ''))) > 0 THEN 'barcode' ELSE 'manual' END;
  v_target_ids uuid[] := ARRAY[]::uuid[];
  v_max_attempts integer := 3;
  v_can_override boolean := false;
  v_shp public.shipments%ROWTYPE;
  v_sid uuid;
  v_added integer := 0;
  v_skipped integer := 0;
  v_overridden boolean := false;
BEGIN
  SELECT * INTO v_list
  FROM public.delivery_lists
  WHERE tenant_id = p_tenant_id AND id = p_delivery_list_id
  FOR UPDATE;

  IF v_list.id IS NULL THEN
    RAISE EXCEPTION 'قائمة التوصيل غير موجودة.';
  END IF;

  IF v_list.status <> 'draft' THEN
    RAISE EXCEPTION 'لا يمكن تعديل شحنات قائمة توصيل بعد اعتمادها أو إغلاقها.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.pickup.approve', v_list.branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.delivery.execute', v_list.branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: branch delivery list permission required';
  END IF;

  SELECT COALESCE(max_delivery_attempts, 3) INTO v_max_attempts
  FROM public.tenant_settings
  WHERE tenant_id = p_tenant_id;

  v_max_attempts := COALESCE(v_max_attempts, 3);
  v_can_override := app_private.user_can_override_operations(p_tenant_id);

  IF COALESCE(p_admin_override_attempts, false) AND NOT v_can_override THEN
    RAISE EXCEPTION 'Forbidden: تجاوز الحد الأقصى لمحاولات التوصيل يقتصر على الأدمن ومدير العمليات (ADR-017).';
  END IF;

  IF char_length(v_clean_q) > 0 THEN
    SELECT s.id INTO v_sid
    FROM public.shipments s
    WHERE s.tenant_id = p_tenant_id
      AND (upper(s.shipment_number) = upper(v_clean_q) OR upper(s.barcode_token) = upper(v_clean_q))
    LIMIT 1;

    IF v_sid IS NULL THEN
      RAISE EXCEPTION 'لم يتم العثور على شحنة مطابقة للباركود أو الرقم المدخل (%).', v_clean_q;
    END IF;

    v_target_ids := ARRAY[v_sid];
  ELSE
    v_target_ids := COALESCE(p_shipment_ids, ARRAY[]::uuid[]);
  END IF;

  IF COALESCE(array_length(v_target_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'لم يتم تحديد أي شحنات للإضافة.';
  END IF;

  FOREACH v_sid IN ARRAY v_target_ids LOOP
    SELECT * INTO v_shp
    FROM public.shipments
    WHERE tenant_id = p_tenant_id AND id = v_sid;

    IF v_shp.id IS NULL THEN
      IF v_via = 'barcode' THEN RAISE EXCEPTION 'الشحنة غير موجودة.'; END IF;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_shp.current_branch_id <> v_list.branch_id THEN
      IF v_via = 'barcode' THEN
        RAISE EXCEPTION 'الشحنة (%) ليست في عهدة فرع قائمة التوصيل الحالي.', v_shp.shipment_number;
      END IF;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_list.list_type = 'delivery' THEN
      IF v_shp.operational_status NOT IN ('in_warehouse', 'picked_up', 'rescheduled', 'delivery_failed') THEN
        IF v_via = 'barcode' THEN
          RAISE EXCEPTION 'حالة الشحنة (%) هي (%) ولا تقبل الإضافة لقائمة توصيل.', v_shp.shipment_number, v_shp.operational_status;
        END IF;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
    ELSE
      IF v_shp.operational_status NOT IN ('rescheduled', 'delivery_failed', 'in_warehouse') THEN
        IF v_via = 'barcode' THEN
          RAISE EXCEPTION 'حالة الشحنة (%) هي (%) ولا تقبل الإضافة لقائمة إعادة التوصيل.', v_shp.shipment_number, v_shp.operational_status;
        END IF;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
    END IF;

    v_overridden := false;
    IF v_shp.delivery_attempts_count >= v_max_attempts THEN
      IF COALESCE(p_admin_override_attempts, false) AND v_can_override THEN
        v_overridden := true;
      ELSE
        IF v_via = 'barcode' THEN
          RAISE EXCEPTION 'الشحنة (%) استنفدت الحد الأقصى لمحاولات التوصيل (%/%). استخدم استثناء الإدارة أو حوّلها للمرتجع (ADR-017).',
            v_shp.shipment_number, v_shp.delivery_attempts_count, v_max_attempts;
        END IF;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.delivery_list_items dli
      JOIN public.delivery_lists dl ON dl.id = dli.delivery_list_id AND dl.tenant_id = dli.tenant_id
      WHERE dli.tenant_id = p_tenant_id
        AND dli.shipment_id = v_sid
        AND dl.status IN ('draft', 'approved')
        AND dl.id <> v_list.id
    ) THEN
      IF v_via = 'barcode' THEN
        RAISE EXCEPTION 'الشحنة (%) مدرجة بالفعل في قائمة توصيل نشطة أخرى.', v_shp.shipment_number;
      END IF;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.delivery_list_items (
      tenant_id, delivery_list_id, shipment_id, added_via, attempt_overridden, created_by
    )
    VALUES (
      p_tenant_id, v_list.id, v_sid, v_via, v_overridden, auth.uid()
    )
    ON CONFLICT (tenant_id, delivery_list_id, shipment_id) DO NOTHING;

    IF FOUND THEN
      v_added := v_added + 1;
      IF v_overridden THEN
        INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
        VALUES (
          p_tenant_id, auth.uid(), 'delivery_list.attempts_limit_overridden', 'shipments', v_sid,
          jsonb_build_object(
            'delivery_list_id', v_list.id,
            'list_code', v_list.list_code,
            'attempts_count', v_shp.delivery_attempts_count,
            'max_attempts', v_max_attempts
          ),
          'rpc'
        );
      END IF;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('added_count', v_added, 'skipped_count', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.add_shipments_to_delivery_list(uuid, uuid, uuid[], text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_shipments_to_delivery_list(uuid, uuid, uuid[], text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_shipment_from_delivery_list(
  p_tenant_id uuid,
  p_delivery_list_id uuid,
  p_shipment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_list public.delivery_lists%ROWTYPE;
BEGIN
  SELECT * INTO v_list
  FROM public.delivery_lists
  WHERE tenant_id = p_tenant_id AND id = p_delivery_list_id
  FOR UPDATE;

  IF v_list.id IS NULL THEN
    RAISE EXCEPTION 'قائمة التوصيل غير موجودة.';
  END IF;

  IF v_list.status <> 'draft' THEN
    RAISE EXCEPTION 'لا يمكن إزالة شحنات من قائمة توصيل معتمدة.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.pickup.approve', v_list.branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.delivery.execute', v_list.branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: branch delivery list permission required';
  END IF;

  DELETE FROM public.delivery_list_items
  WHERE tenant_id = p_tenant_id
    AND delivery_list_id = p_delivery_list_id
    AND shipment_id = p_shipment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_shipment_from_delivery_list(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_shipment_from_delivery_list(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_delivery_list(
  p_tenant_id uuid,
  p_delivery_list_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_list public.delivery_lists%ROWTYPE;
  v_item_count integer;
  v_actor_name text;
  v_rec record;
  v_max_attempts integer := 3;
  v_retry_extra_fee numeric(12,2) := 0;
  v_can_override boolean := false;
BEGIN
  SELECT * INTO v_list
  FROM public.delivery_lists
  WHERE tenant_id = p_tenant_id AND id = p_delivery_list_id
  FOR UPDATE;

  IF v_list.id IS NULL THEN
    RAISE EXCEPTION 'قائمة التوصيل غير موجودة.';
  END IF;

  IF v_list.status <> 'draft' THEN
    RAISE EXCEPTION 'قائمة التوصيل معتمدة أو مغلقة بالفعل.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.pickup.approve', v_list.branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.delivery.execute', v_list.branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: branch delivery list permission required';
  END IF;

  SELECT count(*) INTO v_item_count
  FROM public.delivery_list_items
  WHERE tenant_id = p_tenant_id AND delivery_list_id = v_list.id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'لا يمكن اعتماد قائمة توصيل فارغة. أضف شحنة واحدة على الأقل.';
  END IF;

  SELECT COALESCE(max_delivery_attempts, 3), COALESCE(retry_extra_fee, 0)
  INTO v_max_attempts, v_retry_extra_fee
  FROM public.tenant_settings
  WHERE tenant_id = p_tenant_id;

  v_max_attempts := COALESCE(v_max_attempts, 3);
  v_retry_extra_fee := COALESCE(v_retry_extra_fee, 0);
  v_can_override := app_private.user_can_override_operations(p_tenant_id);

  SELECT COALESCE(display_name, 'مستخدم النظام') INTO v_actor_name
  FROM public.profiles WHERE id = auth.uid();

  PERFORM set_config('app_private.allow_shipment_mutation', 'on', true);

  FOR v_rec IN
    SELECT s.*, dli.attempt_overridden
    FROM public.delivery_list_items dli
    JOIN public.shipments s ON s.tenant_id = dli.tenant_id AND s.id = dli.shipment_id
    WHERE dli.tenant_id = p_tenant_id AND dli.delivery_list_id = v_list.id
    FOR UPDATE OF s
  LOOP
    IF v_rec.operational_status NOT IN ('in_warehouse', 'picked_up', 'rescheduled', 'delivery_failed') THEN
      RAISE EXCEPTION 'الشحنة (%) تغيرت حالتها إلى (%) ولا يمكن إخراجها للتوصيل.', v_rec.shipment_number, v_rec.operational_status;
    END IF;

    IF v_rec.delivery_attempts_count >= v_max_attempts AND NOT (v_rec.attempt_overridden AND v_can_override) THEN
      RAISE EXCEPTION 'الشحنة (%) تجاوزت الحد الأقصى للمحاولات المسموحة (%).', v_rec.shipment_number, v_max_attempts;
    END IF;

    UPDATE public.shipments
    SET operational_status = 'out_for_delivery',
        current_branch_id = v_list.branch_id,
        assigned_courier_id = v_list.courier_id,
        movement_type_id = COALESCE(v_list.movement_type_id, movement_type_id),
        updated_by = auth.uid()
    WHERE id = v_rec.id AND tenant_id = p_tenant_id;

    INSERT INTO public.shipment_status_events (
      tenant_id, shipment_id, event_code, from_status, to_status,
      branch_id, courier_id, movement_type_id, list_type, list_code,
      fees_snapshot, notes, actor_user_id, actor_display_name
    )
    VALUES (
      p_tenant_id, v_rec.id,
      CASE WHEN v_list.list_type = 'redelivery' THEN 'redelivery.list_approved' ELSE 'delivery.list_approved' END,
      v_rec.operational_status, 'out_for_delivery',
      v_list.branch_id, v_list.courier_id, v_list.movement_type_id,
      CASE WHEN v_list.list_type = 'redelivery' THEN 'redelivery_list' ELSE 'delivery_list' END,
      v_list.list_code,
      v_rec.total_shipping_fee,
      COALESCE(
        v_list.notes,
        CASE WHEN v_list.list_type = 'redelivery'
          THEN 'خروج لإعادة التوصيل مع المندوب في القائمة ' || v_list.list_code
          ELSE 'خروج للتوصيل مع المندوب في القائمة ' || v_list.list_code
        END
      ),
      auth.uid(), v_actor_name
    );
  END LOOP;

  PERFORM set_config('app_private.allow_shipment_mutation', 'off', true);

  UPDATE public.delivery_lists
  SET status = 'approved',
      approved_at = now(),
      approved_by = auth.uid(),
      updated_by = auth.uid()
  WHERE id = v_list.id AND tenant_id = p_tenant_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(),
    CASE WHEN v_list.list_type = 'redelivery' THEN 'redelivery_list.approved' ELSE 'delivery_list.approved' END,
    'delivery_lists', v_list.id,
    jsonb_build_object('list_code', v_list.list_code, 'shipments_count', v_item_count, 'courier_id', v_list.courier_id),
    'rpc'
  );

  RETURN jsonb_build_object(
    'id', v_list.id,
    'list_code', v_list.list_code,
    'list_type', v_list.list_type,
    'status', 'approved',
    'shipments_count', v_item_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_delivery_list(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_delivery_list(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Server-Side RPC: Record Delivery Execution, POD, Return Liability & Commission
--    Callable by branch ops staff OR the bound assigned courier!
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_delivery_execution(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_shipment_id uuid := (p_payload->>'shipment_id')::uuid;
  v_delivery_list_id uuid := NULLIF(p_payload->>'delivery_list_id', '')::uuid;
  v_req_outcome text := NULLIF(trim(COALESCE(p_payload->>'outcome', '')), '');
  v_effective_outcome text;
  v_delivered_amount numeric(14,2) := NULLIF(p_payload->>'delivered_amount', '')::numeric;
  v_delivered_pieces integer := NULLIF(p_payload->>'delivered_pieces', '')::integer;
  v_exception_reason_id uuid := NULLIF(p_payload->>'exception_reason_id', '')::uuid;
  v_rescheduled_for_date date := NULLIF(p_payload->>'rescheduled_for_date', '')::date;
  v_return_type text := NULLIF(trim(COALESCE(p_payload->>'return_type_code', '')), '');
  v_input_return_fee numeric(12,2) := COALESCE(NULLIF(p_payload->>'applied_return_fee', '')::numeric, 0);
  v_input_return_collected numeric(12,2) := COALESCE(NULLIF(p_payload->>'return_collected_amount', '')::numeric, 0);
  v_pod_method text := NULLIF(trim(COALESCE(p_payload->>'pod_method', '')), '');
  v_pod_recipient_name text := NULLIF(trim(COALESCE(p_payload->>'pod_recipient_name', '')), '');
  v_pod_signature_data text := NULLIF(p_payload->>'pod_signature_data', '');
  v_pod_otp_verified boolean := COALESCE((p_payload->>'pod_otp_verified')::boolean, false);
  v_notes text := NULLIF(trim(COALESCE(p_payload->>'notes', '')), '');

  v_shp public.shipments%ROWTYPE;
  v_snap public.shipment_price_snapshots%ROWTYPE;
  v_bound_courier_id uuid;
  v_max_attempts integer := 3;
  v_require_pod boolean := false;
  v_new_attempts integer;
  v_delivered_pcs integer;
  v_returned_pcs integer;
  v_partial_custody text;
  v_exchange_status text;
  v_stored_delivered_amt numeric(14,2);
  v_return_liability text;
  v_applied_ret_fee numeric(12,2);
  v_ret_collected numeric(12,2);
  v_commission_amt numeric(12,2) := 0;
  v_comm_json jsonb;
  v_actor_name text;
  v_reason_name text;
  v_list_item_id uuid;
  v_parent_list_id uuid;
  v_list_code text;
  v_list_type text;
  v_pending_items integer;
BEGIN
  IF v_shipment_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد الشحنة لتسجيل نتيجة التوصيل.';
  END IF;

  IF v_req_outcome NOT IN ('delivered', 'partially_delivered', 'rescheduled', 'delivery_failed', 'return_to_sender') THEN
    RAISE EXCEPTION 'نتيجة التوصيل المطلوبة غير صالحة.';
  END IF;

  SELECT * INTO v_shp
  FROM public.shipments
  WHERE id = v_shipment_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_shp.id IS NULL THEN
    RAISE EXCEPTION 'الشحنة غير موجودة.';
  END IF;

  v_bound_courier_id := app_private.user_get_bound_courier_id(p_tenant_id);

  -- Strict authorization: admin/ops staff OR bound assigned courier
  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.delivery.execute', v_shp.current_branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.pickup.approve', v_shp.current_branch_id)
    OR (
      v_bound_courier_id IS NOT NULL
      AND v_shp.assigned_courier_id = v_bound_courier_id
    )
  ) THEN
    RAISE EXCEPTION 'Forbidden: لا تملك صلاحية تنفيذ التوصيل لهذه الشحنة أو أنها غير مسندة لك.';
  END IF;

  IF v_shp.operational_status NOT IN ('out_for_delivery', 'rescheduled', 'delivery_failed', 'in_warehouse', 'picked_up') THEN
    RAISE EXCEPTION 'لا يمكن تسجيل نتيجة التوصيل للشحنة (%) في حالتها الحالية (%).', v_shp.shipment_number, v_shp.operational_status;
  END IF;

  SELECT COALESCE(max_delivery_attempts, 3), COALESCE(require_pod_on_delivery, false)
  INTO v_max_attempts, v_require_pod
  FROM public.tenant_settings
  WHERE tenant_id = p_tenant_id;

  v_max_attempts := COALESCE(v_max_attempts, 3);
  v_require_pod := COALESCE(v_require_pod, false);

  v_effective_outcome := v_req_outcome;
  v_new_attempts := v_shp.delivery_attempts_count;
  v_delivered_pcs := v_shp.delivered_pieces_count;
  v_returned_pcs := v_shp.returned_pieces_count;
  v_partial_custody := v_shp.partial_return_custody;
  v_exchange_status := v_shp.exchange_status;
  v_stored_delivered_amt := v_shp.delivered_amount;
  v_return_liability := v_shp.return_liability;
  v_applied_ret_fee := v_shp.applied_return_fee;
  v_ret_collected := v_shp.return_collected_from_recipient;
  v_commission_amt := v_shp.accrued_courier_commission;

  IF v_exception_reason_id IS NOT NULL THEN
    SELECT name INTO v_reason_name
    FROM public.delivery_exception_reasons
    WHERE tenant_id = p_tenant_id AND id = v_exception_reason_id;
  END IF;

  IF v_req_outcome IN ('delivered', 'partially_delivered') THEN
    IF v_require_pod AND v_pod_recipient_name IS NULL AND v_pod_signature_data IS NULL AND NOT v_pod_otp_verified THEN
      RAISE EXCEPTION 'سياسة الشركة تلزم إدخال إثبات التسليم (اسم المستلم أو التوقيع أو OTP).';
    END IF;

    v_new_attempts := v_shp.delivery_attempts_count + 1;
    v_return_liability := 'none';
    v_applied_ret_fee := 0;
    v_ret_collected := 0;

    IF v_req_outcome = 'partially_delivered' THEN
      IF v_shp.pieces_count < 2 THEN
        RAISE EXCEPTION 'التسليم الجزئي (PDP) يتطلب شحنة من قطعتين على الأقل.';
      END IF;
      v_delivered_pcs := COALESCE(v_delivered_pieces, 1);
      IF v_delivered_pcs <= 0 OR v_delivered_pcs >= v_shp.pieces_count THEN
        RAISE EXCEPTION 'عدد القطع المسلمة جزئيًا يجب أن يكون بين 1 و (%).', v_shp.pieces_count - 1;
      END IF;
      v_returned_pcs := v_shp.pieces_count - v_delivered_pcs;
      v_partial_custody := 'with_courier';
      v_stored_delivered_amt := COALESCE(v_delivered_amount, v_shp.recipient_collect_amount);
    ELSE
      v_delivered_pcs := v_shp.pieces_count;
      v_returned_pcs := 0;
      v_stored_delivered_amt := COALESCE(v_delivered_amount, v_shp.recipient_collect_amount);
      IF v_shp.shipment_type_code = 'PTP' THEN
        v_exchange_status := 'with_courier';
        UPDATE public.shipment_relations
        SET custody_status = 'with_courier'
        WHERE tenant_id = p_tenant_id AND shipment_id = v_shp.id AND relation_type = 'ptp_exchange_return';
      END IF;
    END IF;

    -- ADR-012: Calculate accrued courier commission automatically on delivery
    IF v_shp.assigned_courier_id IS NOT NULL THEN
      SELECT * INTO v_snap
      FROM public.shipment_price_snapshots
      WHERE id = v_shp.current_snapshot_id AND tenant_id = p_tenant_id;

      v_comm_json := public.calculate_courier_commission(
        p_tenant_id,
        v_shp.assigned_courier_id,
        v_shp.recipient_governorate_id,
        v_shp.recipient_region_id,
        COALESCE(v_snap.base_delivery_fee, v_shp.total_shipping_fee),
        COALESCE(v_snap.collection_fee, 0),
        current_date
      );
      v_commission_amt := COALESCE((v_comm_json->>'commission_amount')::numeric, 0);
    ELSE
      v_commission_amt := 0;
    END IF;

  ELSIF v_req_outcome IN ('rescheduled', 'delivery_failed') THEN
    IF v_exception_reason_id IS NULL AND char_length(COALESCE(v_notes, '')) < 3 THEN
      RAISE EXCEPTION 'يجب تحديد سبب التعذر أو التأجيل أو كتابة ملاحظة توضيحية.';
    END IF;

    v_new_attempts := v_shp.delivery_attempts_count + 1;
    v_commission_amt := 0;

    -- ADR-017: Auto-escalate to return_to_sender when attempts reach max_delivery_attempts
    IF v_new_attempts >= v_max_attempts THEN
      v_effective_outcome := 'return_to_sender';
      v_return_liability := 'no_charge';
      v_applied_ret_fee := COALESCE(v_shp.return_fee, 0);
      v_ret_collected := 0;
      v_notes := COALESCE(v_notes || ' · ', '') ||
        'تحويل تلقائي للمرتجع بعد استنفاد الحد الأقصى لمحاولات التوصيل (' || v_new_attempts || '/' || v_max_attempts || ')';
    END IF;

  ELSIF v_req_outcome = 'return_to_sender' THEN
    IF v_exception_reason_id IS NULL AND char_length(COALESCE(v_notes, '')) < 3 THEN
      RAISE EXCEPTION 'يجب تحديد سبب الإرجاع أو كتابة ملاحظة توضيحية.';
    END IF;

    v_new_attempts := v_shp.delivery_attempts_count + 1;
    v_return_type := COALESCE(v_return_type, 'no_charge');
    IF v_return_type NOT IN ('no_charge', 'sender_partial_fee', 'recipient_paid_fee') THEN
      RAISE EXCEPTION 'نوع تحمل رسوم المرتجع غير صالح.';
    END IF;

    v_return_liability := v_return_type;
    -- ADR-016: Default courier commission on returns = 0
    v_commission_amt := 0;

    IF v_return_type = 'no_charge' THEN
      v_applied_ret_fee := COALESCE(v_shp.return_fee, 0);
      v_ret_collected := 0;
    ELSIF v_return_type = 'sender_partial_fee' THEN
      IF v_input_return_fee < 0 THEN
        RAISE EXCEPTION 'رسوم المرتجع الجزئية على الراسل لا يمكن أن تكون سالبة.';
      END IF;
      v_applied_ret_fee := v_input_return_fee;
      v_ret_collected := 0;
    ELSE
      -- recipient_paid_fee: courier collected shipping/inspection fee from recipient at door
      IF v_input_return_collected <= 0 THEN
        RAISE EXCEPTION 'يجب إدخال المبلغ المحصل من المستلم عند الباب عند اختيار تحصيل من المستلم (ADR-016).';
      END IF;
      v_applied_ret_fee := 0;
      v_ret_collected := v_input_return_collected;
    END IF;
  END IF;

  SELECT COALESCE(p.display_name, 'مستخدم النظام') INTO v_actor_name
  FROM public.profiles p WHERE p.id = auth.uid();

  PERFORM set_config('app_private.allow_shipment_mutation', 'on', true);

  UPDATE public.shipments
  SET operational_status = v_effective_outcome,
      delivered_pieces_count = v_delivered_pcs,
      returned_pieces_count = v_returned_pcs,
      partial_return_custody = v_partial_custody,
      exchange_status = v_exchange_status,
      delivered_amount = v_stored_delivered_amt,
      delivery_attempts_count = v_new_attempts,
      last_exception_reason_id = COALESCE(v_exception_reason_id, last_exception_reason_id),
      rescheduled_for_date = CASE WHEN v_effective_outcome = 'rescheduled' THEN COALESCE(v_rescheduled_for_date, current_date + 1) ELSE NULL END,
      return_liability = v_return_liability,
      applied_return_fee = v_applied_ret_fee,
      return_collected_from_recipient = v_ret_collected,
      accrued_courier_commission = v_commission_amt,
      proof_of_delivery_method = CASE
        WHEN v_effective_outcome IN ('delivered', 'partially_delivered') THEN COALESCE(v_pod_method, 'none')
        ELSE proof_of_delivery_method
      END,
      proof_recipient_name = CASE
        WHEN v_effective_outcome IN ('delivered', 'partially_delivered') THEN COALESCE(v_pod_recipient_name, proof_recipient_name)
        ELSE proof_recipient_name
      END,
      proof_signature_data = CASE
        WHEN v_effective_outcome IN ('delivered', 'partially_delivered') AND v_pod_signature_data IS NOT NULL THEN v_pod_signature_data
        ELSE proof_signature_data
      END,
      proof_otp_verified = CASE
        WHEN v_effective_outcome IN ('delivered', 'partially_delivered') THEN (proof_otp_verified OR v_pod_otp_verified)
        ELSE proof_otp_verified
      END,
      pod_captured_at = CASE
        WHEN v_effective_outcome IN ('delivered', 'partially_delivered') THEN COALESCE(pod_captured_at, now())
        ELSE pod_captured_at
      END,
      delivered_at = CASE
        WHEN v_effective_outcome IN ('delivered', 'partially_delivered') THEN COALESCE(delivered_at, now())
        ELSE delivered_at
      END,
      updated_by = auth.uid()
  WHERE id = v_shp.id AND tenant_id = p_tenant_id;

  PERFORM set_config('app_private.allow_shipment_mutation', 'off', true);

  -- Sync active delivery_list_item if present
  IF v_delivery_list_id IS NOT NULL THEN
    SELECT dli.id, dl.id, dl.list_code, dl.list_type
    INTO v_list_item_id, v_parent_list_id, v_list_code, v_list_type
    FROM public.delivery_list_items dli
    JOIN public.delivery_lists dl ON dl.id = dli.delivery_list_id AND dl.tenant_id = dli.tenant_id
    WHERE dli.tenant_id = p_tenant_id
      AND dli.delivery_list_id = v_delivery_list_id
      AND dli.shipment_id = v_shp.id
    LIMIT 1;
  ELSE
    SELECT dli.id, dl.id, dl.list_code, dl.list_type
    INTO v_list_item_id, v_parent_list_id, v_list_code, v_list_type
    FROM public.delivery_list_items dli
    JOIN public.delivery_lists dl ON dl.id = dli.delivery_list_id AND dl.tenant_id = dli.tenant_id
    WHERE dli.tenant_id = p_tenant_id
      AND dli.shipment_id = v_shp.id
      AND dl.status = 'approved'
      AND dli.execution_outcome = 'pending'
    ORDER BY dl.created_at DESC
    LIMIT 1;
  END IF;

  IF v_list_item_id IS NOT NULL THEN
    UPDATE public.delivery_list_items
    SET execution_outcome = v_effective_outcome,
        delivered_amount = v_stored_delivered_amt,
        delivered_pieces_count = v_delivered_pcs,
        exception_reason_id = v_exception_reason_id,
        return_type_code = CASE WHEN v_effective_outcome = 'return_to_sender' THEN v_return_liability ELSE NULL END,
        applied_return_fee = v_applied_ret_fee,
        return_collected_amount = v_ret_collected,
        outcome_notes = COALESCE(v_notes, v_reason_name),
        executed_at = now(),
        executed_by = auth.uid()
    WHERE id = v_list_item_id AND tenant_id = p_tenant_id;

    SELECT count(*) INTO v_pending_items
    FROM public.delivery_list_items
    WHERE tenant_id = p_tenant_id
      AND delivery_list_id = v_parent_list_id
      AND execution_outcome = 'pending';

    IF v_pending_items = 0 THEN
      UPDATE public.delivery_lists
      SET status = 'closed',
          closed_at = now(),
          closed_by = auth.uid(),
          updated_by = auth.uid()
      WHERE id = v_parent_list_id AND tenant_id = p_tenant_id AND status = 'approved';
    END IF;
  END IF;

  INSERT INTO public.shipment_status_events (
    tenant_id, shipment_id, event_code, from_status, to_status,
    branch_id, courier_id, exception_reason_id, list_type, list_code,
    delivered_amount, return_type, fees_snapshot, notes, actor_user_id, actor_display_name
  )
  VALUES (
    p_tenant_id, v_shp.id, 'delivery.' || v_effective_outcome,
    v_shp.operational_status, v_effective_outcome,
    v_shp.current_branch_id, v_shp.assigned_courier_id, v_exception_reason_id,
    CASE WHEN v_list_type = 'redelivery' THEN 'redelivery_list' ELSE 'delivery_list' END,
    v_list_code,
    v_stored_delivered_amt,
    CASE WHEN v_effective_outcome = 'return_to_sender' THEN v_return_liability ELSE NULL END,
    v_shp.total_shipping_fee,
    COALESCE(v_notes, v_reason_name, 'تسجيل نتيجة التوصيل'),
    auth.uid(), v_actor_name
  );

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'delivery.outcome_recorded', 'shipments', v_shp.id,
    jsonb_build_object('status', v_shp.operational_status, 'attempts', v_shp.delivery_attempts_count),
    jsonb_build_object(
      'status', v_effective_outcome,
      'attempts', v_new_attempts,
      'delivered_amount', v_stored_delivered_amt,
      'accrued_courier_commission', v_commission_amt,
      'return_liability', v_return_liability,
      'applied_return_fee', v_applied_ret_fee,
      'return_collected_from_recipient', v_ret_collected,
      'pod_method', v_pod_method
    ),
    'rpc'
  );

  RETURN jsonb_build_object(
    'shipment_id', v_shp.id,
    'from_status', v_shp.operational_status,
    'to_status', v_effective_outcome,
    'delivery_attempts_count', v_new_attempts,
    'max_delivery_attempts', v_max_attempts,
    'auto_returned_by_limit', (v_req_outcome <> v_effective_outcome),
    'accrued_courier_commission', v_commission_amt,
    'return_liability', v_return_liability,
    'applied_return_fee', v_applied_ret_fee,
    'return_collected_from_recipient', v_ret_collected
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_delivery_execution(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_delivery_execution(uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Server-Side RPCs: Return Manifests Workflow (RTH / RTD / RTN)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_return_manifest(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_type text := COALESCE(NULLIF(trim(p_payload->>'manifest_type'), ''), 'courier_return_inbound');
  v_branch_id uuid := (p_payload->>'branch_id')::uuid;
  v_courier_id uuid := NULLIF(p_payload->>'courier_id', '')::uuid;
  v_client_id uuid := NULLIF(p_payload->>'client_id', '')::uuid;
  v_movement_type_id uuid := NULLIF(p_payload->>'movement_type_id', '')::uuid;
  v_manifest_date date := COALESCE(NULLIF(p_payload->>'manifest_date', '')::date, current_date);
  v_notes text := NULLIF(trim(COALESCE(p_payload->>'notes', '')), '');
  v_entity_key text;
  v_code text;
  v_manifest_id uuid;
BEGIN
  IF v_type NOT IN ('courier_return_inbound', 'client_return_dispatch', 'client_return_handover') THEN
    RAISE EXCEPTION 'نوع قائمة المرتجع غير صالح.';
  END IF;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد الفرع المنفذ لقائمة المرتجعات.';
  END IF;

  IF v_type = 'client_return_dispatch' AND v_courier_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد المندوب المكلف بتوصيل المرتجع للعميل.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.pickup.approve', v_branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.delivery.execute', v_branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: branch return manifest permission required';
  END IF;

  IF v_movement_type_id IS NULL THEN
    SELECT id INTO v_movement_type_id
    FROM public.movement_types
    WHERE tenant_id = p_tenant_id
      AND code = CASE WHEN v_type = 'courier_return_inbound' THEN 'MOV-007' ELSE 'MOV-008' END
    LIMIT 1;
  END IF;

  v_entity_key := CASE v_type
    WHEN 'courier_return_inbound' THEN 'courier_return_handovers'
    WHEN 'client_return_dispatch' THEN 'return_dispatch_lists'
    ELSE 'return_lists'
  END;

  v_code := app_private.next_document_number(p_tenant_id, v_entity_key);

  INSERT INTO public.return_manifests (
    tenant_id, manifest_code, manifest_type, manifest_date,
    branch_id, courier_id, client_id, movement_type_id,
    status, notes, created_by, updated_by
  )
  VALUES (
    p_tenant_id, v_code, v_type, v_manifest_date,
    v_branch_id, v_courier_id, v_client_id, v_movement_type_id,
    'draft', v_notes, auth.uid(), auth.uid()
  )
  RETURNING id INTO v_manifest_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'return_manifest.created', 'return_manifests', v_manifest_id,
    jsonb_build_object('manifest_code', v_code, 'manifest_type', v_type, 'branch_id', v_branch_id, 'courier_id', v_courier_id, 'client_id', v_client_id),
    'rpc'
  );

  RETURN jsonb_build_object('id', v_manifest_id, 'manifest_code', v_code, 'manifest_type', v_type, 'status', 'draft');
END;
$$;

REVOKE ALL ON FUNCTION public.create_return_manifest(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_return_manifest(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_shipments_to_return_manifest(
  p_tenant_id uuid,
  p_manifest_id uuid,
  p_shipment_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_barcode_query text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_manifest public.return_manifests%ROWTYPE;
  v_clean_q text := trim(COALESCE(p_barcode_query, ''));
  v_via text := CASE WHEN char_length(trim(COALESCE(p_barcode_query, ''))) > 0 THEN 'barcode' ELSE 'manual' END;
  v_target_ids uuid[] := ARRAY[]::uuid[];
  v_shp public.shipments%ROWTYPE;
  v_sid uuid;
  v_added integer := 0;
  v_skipped integer := 0;
  v_eligible boolean;
BEGIN
  SELECT * INTO v_manifest
  FROM public.return_manifests
  WHERE tenant_id = p_tenant_id AND id = p_manifest_id
  FOR UPDATE;

  IF v_manifest.id IS NULL THEN
    RAISE EXCEPTION 'قائمة المرتجع غير موجودة.';
  END IF;

  IF v_manifest.status <> 'draft' THEN
    RAISE EXCEPTION 'لا يمكن تعديل شحنات قائمة مرتجع بعد اعتمادها.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.pickup.approve', v_manifest.branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.delivery.execute', v_manifest.branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: branch return manifest permission required';
  END IF;

  IF char_length(v_clean_q) > 0 THEN
    SELECT s.id INTO v_sid
    FROM public.shipments s
    WHERE s.tenant_id = p_tenant_id
      AND (upper(s.shipment_number) = upper(v_clean_q) OR upper(s.barcode_token) = upper(v_clean_q))
    LIMIT 1;

    IF v_sid IS NULL THEN
      RAISE EXCEPTION 'لم يتم العثور على شحنة مطابقة للباركود أو الرقم المدخل (%).', v_clean_q;
    END IF;

    v_target_ids := ARRAY[v_sid];
  ELSE
    v_target_ids := COALESCE(p_shipment_ids, ARRAY[]::uuid[]);
  END IF;

  IF COALESCE(array_length(v_target_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'لم يتم تحديد أي شحنات للإضافة.';
  END IF;

  FOREACH v_sid IN ARRAY v_target_ids LOOP
    SELECT * INTO v_shp
    FROM public.shipments
    WHERE tenant_id = p_tenant_id AND id = v_sid;

    IF v_shp.id IS NULL THEN
      IF v_via = 'barcode' THEN RAISE EXCEPTION 'الشحنة غير موجودة.'; END IF;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_manifest.client_id IS NOT NULL AND v_shp.client_id <> v_manifest.client_id THEN
      IF v_via = 'barcode' THEN
        RAISE EXCEPTION 'الشحنة (%) لا تتبع العميل المحدد في رأس القائمة.', v_shp.shipment_number;
      END IF;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_manifest.manifest_type = 'courier_return_inbound' THEN
      v_eligible :=
        v_shp.operational_status IN ('return_to_sender', 'delivery_failed')
        OR (v_shp.operational_status = 'partially_delivered' AND v_shp.partial_return_custody = 'with_courier')
        OR (v_shp.operational_status = 'delivered' AND v_shp.shipment_type_code = 'PTP' AND v_shp.exchange_status = 'with_courier');
    ELSE
      v_eligible :=
        v_shp.operational_status IN ('return_to_sender', 'in_warehouse', 'delivery_failed')
        OR (v_shp.operational_status = 'partially_delivered' AND v_shp.partial_return_custody IN ('with_courier', 'in_warehouse'))
        OR (v_shp.operational_status = 'delivered' AND v_shp.shipment_type_code = 'PTP' AND v_shp.exchange_status IN ('with_courier', 'in_warehouse'));
    END IF;

    IF NOT v_eligible THEN
      IF v_via = 'barcode' THEN
        RAISE EXCEPTION 'حالة الشحنة (%) هي (%) ولا تقبل الإضافة لهذا النوع من قوائم المرتجعات.', v_shp.shipment_number, v_shp.operational_status;
      END IF;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.return_manifest_items (tenant_id, return_manifest_id, shipment_id, added_via, created_by)
    VALUES (p_tenant_id, v_manifest.id, v_sid, v_via, auth.uid())
    ON CONFLICT (tenant_id, return_manifest_id, shipment_id) DO NOTHING;

    IF FOUND THEN
      v_added := v_added + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('added_count', v_added, 'skipped_count', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.add_shipments_to_return_manifest(uuid, uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_shipments_to_return_manifest(uuid, uuid, uuid[], text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_shipment_from_return_manifest(
  p_tenant_id uuid,
  p_manifest_id uuid,
  p_shipment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_manifest public.return_manifests%ROWTYPE;
BEGIN
  SELECT * INTO v_manifest
  FROM public.return_manifests
  WHERE tenant_id = p_tenant_id AND id = p_manifest_id
  FOR UPDATE;

  IF v_manifest.id IS NULL THEN
    RAISE EXCEPTION 'قائمة المرتجع غير موجودة.';
  END IF;

  IF v_manifest.status <> 'draft' THEN
    RAISE EXCEPTION 'لا يمكن إزالة شحنات من قائمة مرتجع معتمدة.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.pickup.approve', v_manifest.branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.delivery.execute', v_manifest.branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: branch return manifest permission required';
  END IF;

  DELETE FROM public.return_manifest_items
  WHERE tenant_id = p_tenant_id
    AND return_manifest_id = p_manifest_id
    AND shipment_id = p_shipment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_shipment_from_return_manifest(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_shipment_from_return_manifest(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_return_manifest(
  p_tenant_id uuid,
  p_manifest_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_manifest public.return_manifests%ROWTYPE;
  v_item_count integer;
  v_actor_name text;
  v_rec record;
  v_next_status text;
  v_next_partial text;
  v_next_exchange text;
  v_event_code text;
BEGIN
  SELECT * INTO v_manifest
  FROM public.return_manifests
  WHERE tenant_id = p_tenant_id AND id = p_manifest_id
  FOR UPDATE;

  IF v_manifest.id IS NULL THEN
    RAISE EXCEPTION 'قائمة المرتجع غير موجودة.';
  END IF;

  IF v_manifest.status <> 'draft' THEN
    RAISE EXCEPTION 'قائمة المرتجع معتمدة أو ملغاة بالفعل.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.pickup.approve', v_manifest.branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.delivery.execute', v_manifest.branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: branch return manifest permission required';
  END IF;

  SELECT count(*) INTO v_item_count
  FROM public.return_manifest_items
  WHERE tenant_id = p_tenant_id AND return_manifest_id = v_manifest.id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'لا يمكن اعتماد قائمة مرتجع فارغة. أضف شحنة واحدة على الأقل.';
  END IF;

  SELECT COALESCE(display_name, 'مستخدم النظام') INTO v_actor_name
  FROM public.profiles WHERE id = auth.uid();

  PERFORM set_config('app_private.allow_shipment_mutation', 'on', true);

  FOR v_rec IN
    SELECT s.*, rmi.id AS item_id
    FROM public.return_manifest_items rmi
    JOIN public.shipments s ON s.tenant_id = rmi.tenant_id AND s.id = rmi.shipment_id
    WHERE rmi.tenant_id = p_tenant_id AND rmi.return_manifest_id = v_manifest.id
    FOR UPDATE OF s
  LOOP
    v_next_status := v_rec.operational_status;
    v_next_partial := v_rec.partial_return_custody;
    v_next_exchange := v_rec.exchange_status;

    IF v_manifest.manifest_type = 'courier_return_inbound' THEN
      v_event_code := 'return.courier_inbound_received';
      IF v_rec.operational_status IN ('delivery_failed', 'return_to_sender') THEN
        v_next_status := 'return_to_sender';
      END IF;
      IF v_rec.partial_return_custody = 'with_courier' THEN
        v_next_partial := 'in_warehouse';
      END IF;
      IF v_rec.exchange_status = 'with_courier' THEN
        v_next_exchange := 'in_warehouse';
        UPDATE public.shipment_relations
        SET custody_status = 'in_warehouse'
        WHERE tenant_id = p_tenant_id AND shipment_id = v_rec.id AND relation_type = 'ptp_exchange_return';
      END IF;

      UPDATE public.shipments
      SET operational_status = v_next_status,
          current_branch_id = v_manifest.branch_id,
          partial_return_custody = v_next_partial,
          exchange_status = v_next_exchange,
          movement_type_id = COALESCE(v_manifest.movement_type_id, movement_type_id),
          updated_by = auth.uid()
      WHERE id = v_rec.id AND tenant_id = p_tenant_id;

    ELSIF v_manifest.manifest_type = 'client_return_dispatch' THEN
      v_event_code := 'return.client_dispatch_assigned';
      IF v_rec.operational_status IN ('in_warehouse', 'delivery_failed') THEN
        v_next_status := 'return_to_sender';
      END IF;
      UPDATE public.shipments
      SET operational_status = v_next_status,
          current_branch_id = v_manifest.branch_id,
          assigned_courier_id = v_manifest.courier_id,
          movement_type_id = COALESCE(v_manifest.movement_type_id, movement_type_id),
          updated_by = auth.uid()
      WHERE id = v_rec.id AND tenant_id = p_tenant_id;

    ELSE
      -- client_return_handover (RTN-*) -> Finalizes custody return to client (MOV-008)
      v_event_code := 'return.handed_over_to_client';
      IF v_rec.operational_status IN ('return_to_sender', 'delivery_failed', 'in_warehouse') THEN
        v_next_status := 'returned';
      END IF;
      IF v_rec.partial_return_custody IN ('with_courier', 'in_warehouse') THEN
        v_next_partial := 'returned_to_client';
      END IF;
      IF v_rec.exchange_status IN ('with_courier', 'in_warehouse') THEN
        v_next_exchange := 'returned_to_client';
        UPDATE public.shipment_relations
        SET custody_status = 'returned_to_client'
        WHERE tenant_id = p_tenant_id AND shipment_id = v_rec.id AND relation_type = 'ptp_exchange_return';
      END IF;

      UPDATE public.shipments
      SET operational_status = v_next_status,
          partial_return_custody = v_next_partial,
          exchange_status = v_next_exchange,
          returned_at = COALESCE(returned_at, now()),
          movement_type_id = COALESCE(v_manifest.movement_type_id, movement_type_id),
          updated_by = auth.uid()
      WHERE id = v_rec.id AND tenant_id = p_tenant_id;
    END IF;

    UPDATE public.return_manifest_items
    SET handover_status = 'completed',
        completed_at = now(),
        completed_by = auth.uid()
    WHERE id = v_rec.item_id AND tenant_id = p_tenant_id;

    INSERT INTO public.shipment_status_events (
      tenant_id, shipment_id, event_code, from_status, to_status,
      branch_id, courier_id, movement_type_id, list_type, list_code,
      return_type, fees_snapshot, notes, actor_user_id, actor_display_name
    )
    VALUES (
      p_tenant_id, v_rec.id, v_event_code, v_rec.operational_status, v_next_status,
      v_manifest.branch_id, COALESCE(v_manifest.courier_id, v_rec.assigned_courier_id),
      v_manifest.movement_type_id, v_manifest.manifest_type, v_manifest.manifest_code,
      NULLIF(v_rec.return_liability, 'none'),
      v_rec.total_shipping_fee,
      COALESCE(v_manifest.notes, 'حركة مرتجع عبر القائمة ' || v_manifest.manifest_code),
      auth.uid(), v_actor_name
    );
  END LOOP;

  PERFORM set_config('app_private.allow_shipment_mutation', 'off', true);

  UPDATE public.return_manifests
  SET status = 'approved',
      approved_at = now(),
      approved_by = auth.uid(),
      updated_by = auth.uid()
  WHERE id = v_manifest.id AND tenant_id = p_tenant_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'return_manifest.approved', 'return_manifests', v_manifest.id,
    jsonb_build_object('manifest_code', v_manifest.manifest_code, 'manifest_type', v_manifest.manifest_type, 'shipments_count', v_item_count),
    'rpc'
  );

  RETURN jsonb_build_object(
    'id', v_manifest.id,
    'manifest_code', v_manifest.manifest_code,
    'manifest_type', v_manifest.manifest_type,
    'status', 'approved',
    'shipments_count', v_item_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_return_manifest(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_return_manifest(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Server-Side RPC: Courier Portal My Tasks Feed (Role-Bound & Admin Preview)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_courier_my_tasks(
  p_tenant_id uuid,
  p_courier_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_bound_courier uuid;
  v_target_courier uuid;
  v_courier public.couriers%ROWTYPE;
  v_pickups jsonb;
  v_deliveries jsonb;
  v_shipments jsonb;
BEGIN
  v_bound_courier := app_private.user_get_bound_courier_id(p_tenant_id);

  IF v_bound_courier IS NOT NULL THEN
    -- Courier accounts strictly see ONLY their own bound courier tasks
    v_target_courier := v_bound_courier;
  ELSE
    IF NOT (
      app_private.current_user_is_platform_admin()
      OR app_private.user_is_tenant_admin(p_tenant_id)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.delivery.execute', NULL)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.pickup.approve', NULL)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'couriers.read', NULL)
    ) THEN
      RAISE EXCEPTION 'Forbidden: courier binding or delivery permission required';
    END IF;
    v_target_courier := p_courier_id;
  END IF;

  IF v_target_courier IS NULL THEN
    RETURN jsonb_build_object(
      'courier', NULL,
      'pickup_lists', '[]'::jsonb,
      'delivery_lists', '[]'::jsonb,
      'shipments', '[]'::jsonb
    );
  END IF;

  SELECT * INTO v_courier
  FROM public.couriers
  WHERE tenant_id = p_tenant_id AND id = v_target_courier AND archived_at IS NULL;

  SELECT COALESCE(jsonb_agg(row_to_json(pl_q)), '[]'::jsonb)
  INTO v_pickups
  FROM (
    SELECT pl.id, pl.list_code, pl.list_date, pl.branch_id, pl.status, pl.notes,
      (SELECT count(*) FROM public.pickup_list_items pli WHERE pli.pickup_list_id = pl.id) AS shipments_count
    FROM public.pickup_lists pl
    WHERE pl.tenant_id = p_tenant_id
      AND pl.courier_id = v_target_courier
      AND pl.status IN ('approved', 'completed')
    ORDER BY pl.created_at DESC
    LIMIT 25
  ) pl_q;

  SELECT COALESCE(jsonb_agg(row_to_json(dl_q)), '[]'::jsonb)
  INTO v_deliveries
  FROM (
    SELECT dl.id, dl.list_code, dl.list_type, dl.list_date, dl.branch_id, dl.status, dl.notes,
      (SELECT count(*) FROM public.delivery_list_items dli WHERE dli.delivery_list_id = dl.id) AS shipments_count,
      (SELECT count(*) FROM public.delivery_list_items dli WHERE dli.delivery_list_id = dl.id AND dli.execution_outcome = 'pending') AS pending_count
    FROM public.delivery_lists dl
    WHERE dl.tenant_id = p_tenant_id
      AND dl.courier_id = v_target_courier
      AND dl.status IN ('approved', 'closed')
    ORDER BY dl.created_at DESC
    LIMIT 25
  ) dl_q;

  SELECT COALESCE(jsonb_agg(row_to_json(s_q)), '[]'::jsonb)
  INTO v_shipments
  FROM (
    SELECT
      s.*,
      c.name AS client_name,
      sp_snd.name AS sender_name,
      sp_snd.mobile AS sender_mobile,
      sp_rec.name AS recipient_name,
      sp_rec.mobile AS recipient_mobile,
      sp_rec.address_line AS recipient_address
    FROM public.shipments s
    LEFT JOIN public.clients c ON c.id = s.client_id AND c.tenant_id = s.tenant_id
    LEFT JOIN public.shipment_parties sp_snd ON sp_snd.shipment_id = s.id AND sp_snd.tenant_id = s.tenant_id AND sp_snd.party_type = 'sender'
    LEFT JOIN public.shipment_parties sp_rec ON sp_rec.shipment_id = s.id AND sp_rec.tenant_id = s.tenant_id AND sp_rec.party_type = 'recipient'
    WHERE s.tenant_id = p_tenant_id
      AND s.assigned_courier_id = v_target_courier
      AND s.operational_status IN (
        'pickup_scheduled', 'out_for_delivery', 'rescheduled',
        'delivery_failed', 'partially_delivered', 'return_to_sender', 'delivered'
      )
    ORDER BY
      CASE s.operational_status
        WHEN 'out_for_delivery' THEN 1
        WHEN 'pickup_scheduled' THEN 2
        WHEN 'rescheduled' THEN 3
        ELSE 4
      END,
      s.updated_at DESC
    LIMIT 150
  ) s_q;

  RETURN jsonb_build_object(
    'courier', CASE WHEN v_courier.id IS NOT NULL THEN jsonb_build_object(
      'id', v_courier.id,
      'code', v_courier.code,
      'name', v_courier.name,
      'branch_id', v_courier.branch_id,
      'mobile', v_courier.mobile
    ) ELSE NULL END,
    'pickup_lists', v_pickups,
    'delivery_lists', v_deliveries,
    'shipments', v_shipments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_courier_my_tasks(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_courier_my_tasks(uuid, uuid) TO authenticated;
