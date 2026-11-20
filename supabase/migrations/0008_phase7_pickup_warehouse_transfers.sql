-- ============================================================================
-- Migration 0008: Phase 7 - Pickup Lists, Warehouse Intake & Inter-Branch Transfers
-- ============================================================================
-- Implements approved decision ADR-015 (OQ-10):
-- 1. Two-Step Inter-Branch Transfer Handshake:
--    - Origin dispatch (`transfer_out` / TRF-* / MOV-003) transitions eligible
--      in_warehouse shipments to `in_transit_branch` while keeping
--      `current_branch_id` locked at origin until physical destination receipt.
--    - Destination Warehouse Intake (`intake` / WRH-* / MOV-002 / MOV-004)
--      updates `current_branch_id` to destination branch and `operational_status`
--      to `in_warehouse` ONLY upon destination approval.
-- 2. Branch-Scoped Approval + Admin/Operations Manager Unhang Override:
--    - Branch/warehouse operators with `operations.pickup.approve` operate strictly
--      within their assigned `membership_branches`.
--    - Admin unhang/release (`admin_release_stuck_transfer_or_manifest`) requires
--      `company_owner` / `company_admin` / `operations_manager` and mandatory
--      audit reason recorded in `audit.audit_logs` & `shipment_status_events`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Update Document Numbering Helper & Seed WRH / TRF Sequences
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

-- Backfill Phase 7 numbering sequences for all existing tenants
INSERT INTO public.numbering_sequences (tenant_id, entity_key, label, prefix, next_number, padding_length)
SELECT t.id, s.entity_key, s.label, s.prefix, 1, 6
FROM public.tenants t
CROSS JOIN (
  VALUES
    ('warehouse_manifests', 'قوائم الاستلام بالمخزن', 'WRH'),
    ('transfer_lists', 'قوائم النقل بين الفروع', 'TRF')
) AS s(entity_key, label, prefix)
ON CONFLICT (tenant_id, entity_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Phase 7 Core Operational Manifest Tables
-- ----------------------------------------------------------------------------
CREATE TABLE public.pickup_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  list_code text NOT NULL CHECK (char_length(trim(list_code)) >= 4),
  list_date date NOT NULL DEFAULT current_date,
  branch_id uuid NOT NULL,
  courier_id uuid,
  route_id uuid,
  movement_type_id uuid,
  client_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'completed', 'cancelled')),
  notes text,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_pickup_lists_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_pickup_lists_tenant_code UNIQUE (tenant_id, list_code),
  CONSTRAINT fk_pkp_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_pkp_courier FOREIGN KEY (tenant_id, courier_id) REFERENCES public.couriers(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_pkp_route FOREIGN KEY (tenant_id, route_id) REFERENCES public.courier_routes(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_pkp_movement FOREIGN KEY (tenant_id, movement_type_id) REFERENCES public.movement_types(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_pkp_client FOREIGN KEY (tenant_id, client_id) REFERENCES public.clients(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_pickup_lists_tenant_branch_date ON public.pickup_lists (tenant_id, branch_id, list_date DESC);
CREATE INDEX idx_pickup_lists_tenant_status ON public.pickup_lists (tenant_id, status, created_at DESC);

CREATE TRIGGER trg_pickup_lists_updated_at
  BEFORE UPDATE ON public.pickup_lists
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.pickup_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  pickup_list_id uuid NOT NULL,
  shipment_id uuid NOT NULL,
  added_via text NOT NULL DEFAULT 'manual' CHECK (added_via IN ('manual', 'barcode')),
  pickup_completed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_pickup_list_items_pair UNIQUE (tenant_id, pickup_list_id, shipment_id),
  CONSTRAINT fk_pkpi_list FOREIGN KEY (tenant_id, pickup_list_id) REFERENCES public.pickup_lists(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_pkpi_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_pickup_list_items_list ON public.pickup_list_items (tenant_id, pickup_list_id);
CREATE INDEX idx_pickup_list_items_shipment ON public.pickup_list_items (tenant_id, shipment_id);

CREATE TABLE public.warehouse_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  manifest_code text NOT NULL CHECK (char_length(trim(manifest_code)) >= 4),
  manifest_type text NOT NULL CHECK (manifest_type IN ('intake', 'transfer_out')),
  manifest_date date NOT NULL DEFAULT current_date,
  branch_id uuid NOT NULL,
  target_branch_id uuid,
  source_transfer_manifest_id uuid,
  courier_id uuid,
  movement_type_id uuid,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_transit', 'approved', 'partially_received', 'cancelled')),
  notes text,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  released_at timestamptz,
  released_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_wh_manifests_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_wh_manifests_tenant_code UNIQUE (tenant_id, manifest_code),
  CONSTRAINT chk_wh_transfer_target CHECK (
    manifest_type <> 'transfer_out'
    OR (target_branch_id IS NOT NULL AND target_branch_id <> branch_id)
  ),
  CONSTRAINT fk_whm_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_whm_target_branch FOREIGN KEY (tenant_id, target_branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_whm_source_transfer FOREIGN KEY (tenant_id, source_transfer_manifest_id) REFERENCES public.warehouse_manifests(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_whm_courier FOREIGN KEY (tenant_id, courier_id) REFERENCES public.couriers(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_whm_movement FOREIGN KEY (tenant_id, movement_type_id) REFERENCES public.movement_types(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_wh_manifests_tenant_type_branch ON public.warehouse_manifests (tenant_id, manifest_type, branch_id, manifest_date DESC);
CREATE INDEX idx_wh_manifests_tenant_target ON public.warehouse_manifests (tenant_id, target_branch_id, status) WHERE target_branch_id IS NOT NULL;

CREATE TRIGGER trg_wh_manifests_updated_at
  BEFORE UPDATE ON public.warehouse_manifests
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.warehouse_manifest_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  manifest_id uuid NOT NULL,
  shipment_id uuid NOT NULL,
  added_via text NOT NULL DEFAULT 'manual' CHECK (added_via IN ('manual', 'barcode')),
  receive_status text NOT NULL DEFAULT 'pending'
    CHECK (receive_status IN ('pending', 'received', 'missing_discrepancy', 'released')),
  verified_weight_kg numeric(10,3),
  notes text,
  received_at timestamptz,
  received_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_wh_manifest_items_pair UNIQUE (tenant_id, manifest_id, shipment_id),
  CONSTRAINT fk_whmi_manifest FOREIGN KEY (tenant_id, manifest_id) REFERENCES public.warehouse_manifests(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_whmi_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_wh_manifest_items_manifest ON public.warehouse_manifest_items (tenant_id, manifest_id);
CREATE INDEX idx_wh_manifest_items_shipment ON public.warehouse_manifest_items (tenant_id, shipment_id);

-- ----------------------------------------------------------------------------
-- 3. Authorization Helpers & Strict Forced RLS Policies
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.user_can_override_operations(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR EXISTS (
      SELECT 1
      FROM public.tenant_memberships tm
      JOIN public.profiles pr ON pr.id = tm.user_id AND pr.is_active = true
      JOIN public.tenants t ON t.id = tm.tenant_id AND t.status = 'active'
      WHERE tm.tenant_id = p_tenant_id
        AND tm.user_id = auth.uid()
        AND tm.is_active = true
        AND tm.role_key IN ('company_owner', 'company_admin', 'operations_manager')
    );
$$;

REVOKE ALL ON FUNCTION app_private.user_can_override_operations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.user_can_override_operations(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.user_can_access_pickup_list(
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
    OR app_private.user_has_permission(p_tenant_id, 'operations.pickup.approve', p_branch_id)
    OR app_private.user_has_permission(p_tenant_id, 'shipments.read', p_branch_id)
    OR EXISTS (
      SELECT 1
      FROM public.tenant_memberships tm
      JOIN public.account_subjects asub ON asub.tenant_id = tm.tenant_id AND asub.membership_id = tm.id AND asub.is_active = true
      WHERE tm.tenant_id = p_tenant_id
        AND tm.user_id = auth.uid()
        AND tm.is_active = true
        AND tm.account_subject_type = 'courier'
        AND p_courier_id IS NOT NULL
        AND asub.courier_id = p_courier_id
    );
$$;

REVOKE ALL ON FUNCTION app_private.user_can_access_pickup_list(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.user_can_access_pickup_list(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.user_can_access_wh_manifest(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_target_branch_id uuid
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
    OR app_private.user_has_permission(p_tenant_id, 'operations.pickup.approve', p_branch_id)
    OR app_private.user_has_permission(p_tenant_id, 'shipments.read', p_branch_id)
    OR (
      p_target_branch_id IS NOT NULL
      AND (
        app_private.user_has_permission(p_tenant_id, 'operations.pickup.approve', p_target_branch_id)
        OR app_private.user_has_permission(p_tenant_id, 'shipments.read', p_target_branch_id)
      )
    );
$$;

REVOKE ALL ON FUNCTION app_private.user_can_access_wh_manifest(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.user_can_access_wh_manifest(uuid, uuid, uuid) TO authenticated;

DO $$
DECLARE
  v_tbl text;
  v_tables text[] := ARRAY['pickup_lists', 'pickup_list_items', 'warehouse_manifests', 'warehouse_manifest_items'];
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_tbl);
  END LOOP;
END $$;

CREATE POLICY pickup_lists_select_policy ON public.pickup_lists
  FOR SELECT TO authenticated
  USING (app_private.user_can_access_pickup_list(tenant_id, branch_id, courier_id));

CREATE POLICY pickup_list_items_select_policy ON public.pickup_list_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.pickup_lists pl
      WHERE pl.id = pickup_list_items.pickup_list_id
        AND pl.tenant_id = pickup_list_items.tenant_id
        AND app_private.user_can_access_pickup_list(pl.tenant_id, pl.branch_id, pl.courier_id)
    )
  );

CREATE POLICY warehouse_manifests_select_policy ON public.warehouse_manifests
  FOR SELECT TO authenticated
  USING (app_private.user_can_access_wh_manifest(tenant_id, branch_id, target_branch_id));

CREATE POLICY warehouse_manifest_items_select_policy ON public.warehouse_manifest_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.warehouse_manifests wm
      WHERE wm.id = warehouse_manifest_items.manifest_id
        AND wm.tenant_id = warehouse_manifest_items.tenant_id
        AND app_private.user_can_access_wh_manifest(wm.tenant_id, wm.branch_id, wm.target_branch_id)
    )
  );

-- ----------------------------------------------------------------------------
-- 4. Server-Side RPCs: Pickup Lists Workflow
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_pickup_list(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_branch_id uuid := (p_payload->>'branch_id')::uuid;
  v_courier_id uuid := NULLIF(p_payload->>'courier_id', '')::uuid;
  v_route_id uuid := NULLIF(p_payload->>'route_id', '')::uuid;
  v_movement_type_id uuid := NULLIF(p_payload->>'movement_type_id', '')::uuid;
  v_client_id uuid := NULLIF(p_payload->>'client_id', '')::uuid;
  v_list_date date := COALESCE(NULLIF(p_payload->>'list_date', '')::date, current_date);
  v_notes text := NULLIF(trim(COALESCE(p_payload->>'notes', '')), '');
  v_list_code text;
  v_list_id uuid;
BEGIN
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد الفرع لإنشاء قائمة الالتقاط.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'operations.pickup.approve', v_branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: operations.pickup.approve permission on selected branch required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.branches WHERE tenant_id = p_tenant_id AND id = v_branch_id AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'الفرع المحدد غير موجود أو مؤرشف.';
  END IF;

  IF v_movement_type_id IS NULL THEN
    SELECT id INTO v_movement_type_id
    FROM public.movement_types
    WHERE tenant_id = p_tenant_id AND code = 'MOV-001'
    LIMIT 1;
  END IF;

  v_list_code := app_private.next_document_number(p_tenant_id, 'pickup_lists');

  INSERT INTO public.pickup_lists (
    tenant_id, list_code, list_date, branch_id, courier_id, route_id,
    movement_type_id, client_id, status, notes, created_by, updated_by
  )
  VALUES (
    p_tenant_id, v_list_code, v_list_date, v_branch_id, v_courier_id, v_route_id,
    v_movement_type_id, v_client_id, 'draft', v_notes, auth.uid(), auth.uid()
  )
  RETURNING id INTO v_list_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'pickup_list.created', 'pickup_lists', v_list_id,
    jsonb_build_object('list_code', v_list_code, 'branch_id', v_branch_id, 'courier_id', v_courier_id),
    'rpc'
  );

  RETURN jsonb_build_object('id', v_list_id, 'list_code', v_list_code, 'status', 'draft');
END;
$$;

REVOKE ALL ON FUNCTION public.create_pickup_list(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_pickup_list(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_shipments_to_pickup_list(
  p_tenant_id uuid,
  p_pickup_list_id uuid,
  p_shipment_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_barcode_query text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_list public.pickup_lists%ROWTYPE;
  v_clean_q text := trim(COALESCE(p_barcode_query, ''));
  v_via text := CASE WHEN char_length(trim(COALESCE(p_barcode_query, ''))) > 0 THEN 'barcode' ELSE 'manual' END;
  v_target_ids uuid[] := ARRAY[]::uuid[];
  v_shp public.shipments%ROWTYPE;
  v_sid uuid;
  v_added integer := 0;
  v_skipped integer := 0;
BEGIN
  SELECT * INTO v_list
  FROM public.pickup_lists
  WHERE tenant_id = p_tenant_id AND id = p_pickup_list_id
  FOR UPDATE;

  IF v_list.id IS NULL THEN
    RAISE EXCEPTION 'قائمة الالتقاط غير موجودة.';
  END IF;

  IF v_list.status <> 'draft' THEN
    RAISE EXCEPTION 'لا يمكن تعديل شحنات قائمة التقاط بعد اعتمادها أو إغلاقها.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'operations.pickup.approve', v_list.branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: operations.pickup.approve permission on list branch required';
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
      IF v_via = 'barcode' THEN
        RAISE EXCEPTION 'الشحنة غير موجودة.';
      END IF;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_shp.operational_status NOT IN ('created', 'pickup_scheduled') THEN
      IF v_via = 'barcode' THEN
        RAISE EXCEPTION 'حالة الشحنة (%) هي (%) ولا تقبل الإضافة لقائمة التقاط.', v_shp.shipment_number, v_shp.operational_status;
      END IF;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_list.client_id IS NOT NULL AND v_shp.client_id <> v_list.client_id THEN
      IF v_via = 'barcode' THEN
        RAISE EXCEPTION 'الشحنة (%) لا تتبع العميل المحدد في رأس قائمة الالتقاط.', v_shp.shipment_number;
      END IF;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.pickup_list_items pli
      JOIN public.pickup_lists pl ON pl.id = pli.pickup_list_id AND pl.tenant_id = pli.tenant_id
      WHERE pli.tenant_id = p_tenant_id
        AND pli.shipment_id = v_sid
        AND pl.status IN ('draft', 'approved')
        AND pl.id <> v_list.id
    ) THEN
      IF v_via = 'barcode' THEN
        RAISE EXCEPTION 'الشحنة (%) مدرجة بالفعل في قائمة التقاط نشطة أخرى.', v_shp.shipment_number;
      END IF;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.pickup_list_items (tenant_id, pickup_list_id, shipment_id, added_via, created_by)
    VALUES (p_tenant_id, v_list.id, v_sid, v_via, auth.uid())
    ON CONFLICT (tenant_id, pickup_list_id, shipment_id) DO NOTHING;

    IF FOUND THEN
      v_added := v_added + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('added_count', v_added, 'skipped_count', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.add_shipments_to_pickup_list(uuid, uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_shipments_to_pickup_list(uuid, uuid, uuid[], text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_shipment_from_pickup_list(
  p_tenant_id uuid,
  p_pickup_list_id uuid,
  p_shipment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_list public.pickup_lists%ROWTYPE;
BEGIN
  SELECT * INTO v_list
  FROM public.pickup_lists
  WHERE tenant_id = p_tenant_id AND id = p_pickup_list_id
  FOR UPDATE;

  IF v_list.id IS NULL THEN
    RAISE EXCEPTION 'قائمة الالتقاط غير موجودة.';
  END IF;

  IF v_list.status <> 'draft' THEN
    RAISE EXCEPTION 'لا يمكن إزالة شحنات من قائمة التقاط معتمدة.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'operations.pickup.approve', v_list.branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: operations.pickup.approve permission on list branch required';
  END IF;

  DELETE FROM public.pickup_list_items
  WHERE tenant_id = p_tenant_id
    AND pickup_list_id = p_pickup_list_id
    AND shipment_id = p_shipment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_shipment_from_pickup_list(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_shipment_from_pickup_list(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_pickup_list(
  p_tenant_id uuid,
  p_pickup_list_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_list public.pickup_lists%ROWTYPE;
  v_item_count integer;
  v_actor_name text;
  v_rec record;
BEGIN
  SELECT * INTO v_list
  FROM public.pickup_lists
  WHERE tenant_id = p_tenant_id AND id = p_pickup_list_id
  FOR UPDATE;

  IF v_list.id IS NULL THEN
    RAISE EXCEPTION 'قائمة الالتقاط غير موجودة.';
  END IF;

  IF v_list.status <> 'draft' THEN
    RAISE EXCEPTION 'قائمة الالتقاط معتمدة أو مغلقة بالفعل.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'operations.pickup.approve', v_list.branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: operations.pickup.approve permission on branch required';
  END IF;

  IF v_list.courier_id IS NULL THEN
    RAISE EXCEPTION 'يجب تعيين مندوب الشحن قبل اعتماد قائمة الالتقاط.';
  END IF;

  SELECT count(*) INTO v_item_count
  FROM public.pickup_list_items
  WHERE tenant_id = p_tenant_id AND pickup_list_id = v_list.id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'لا يمكن اعتماد قائمة التقاط فارغة. أضف شحنة واحدة على الأقل.';
  END IF;

  SELECT COALESCE(display_name, 'مستخدم النظام') INTO v_actor_name
  FROM public.profiles WHERE id = auth.uid();

  PERFORM set_config('app_private.allow_shipment_mutation', 'on', true);

  FOR v_rec IN
    SELECT s.*
    FROM public.pickup_list_items pli
    JOIN public.shipments s ON s.tenant_id = pli.tenant_id AND s.id = pli.shipment_id
    WHERE pli.tenant_id = p_tenant_id AND pli.pickup_list_id = v_list.id
    FOR UPDATE OF s
  LOOP
    IF v_rec.operational_status NOT IN ('created', 'pickup_scheduled') THEN
      RAISE EXCEPTION 'الشحنة (%) تغيرت حالتها إلى (%) ولا يمكن اعتماد التقاطها.', v_rec.shipment_number, v_rec.operational_status;
    END IF;

    UPDATE public.shipments
    SET operational_status = 'pickup_scheduled',
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
      p_tenant_id, v_rec.id, 'pickup.list_approved', v_rec.operational_status, 'pickup_scheduled',
      v_list.branch_id, v_list.courier_id, v_list.movement_type_id, 'pickup_list', v_list.list_code,
      v_rec.total_shipping_fee,
      COALESCE(v_list.notes, 'تم إسناد الشحنة في قائمة الالتقاط ' || v_list.list_code),
      auth.uid(), v_actor_name
    );
  END LOOP;

  PERFORM set_config('app_private.allow_shipment_mutation', 'off', true);

  UPDATE public.pickup_lists
  SET status = 'approved',
      approved_at = now(),
      approved_by = auth.uid(),
      updated_by = auth.uid()
  WHERE id = v_list.id AND tenant_id = p_tenant_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'pickup_list.approved', 'pickup_lists', v_list.id,
    jsonb_build_object('list_code', v_list.list_code, 'shipments_count', v_item_count, 'courier_id', v_list.courier_id),
    'rpc'
  );

  RETURN jsonb_build_object('id', v_list.id, 'list_code', v_list.list_code, 'status', 'approved', 'shipments_count', v_item_count);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_pickup_list(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_pickup_list(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Server-Side RPCs: Warehouse Intake & Inter-Branch Transfers (ADR-015)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_warehouse_manifest(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_type text := COALESCE(NULLIF(trim(p_payload->>'manifest_type'), ''), 'intake');
  v_branch_id uuid := (p_payload->>'branch_id')::uuid;
  v_target_branch_id uuid := NULLIF(p_payload->>'target_branch_id', '')::uuid;
  v_source_transfer_id uuid := NULLIF(p_payload->>'source_transfer_manifest_id', '')::uuid;
  v_courier_id uuid := NULLIF(p_payload->>'courier_id', '')::uuid;
  v_movement_type_id uuid := NULLIF(p_payload->>'movement_type_id', '')::uuid;
  v_manifest_date date := COALESCE(NULLIF(p_payload->>'manifest_date', '')::date, current_date);
  v_notes text := NULLIF(trim(COALESCE(p_payload->>'notes', '')), '');
  v_code text;
  v_manifest_id uuid;
BEGIN
  IF v_type NOT IN ('intake', 'transfer_out') THEN
    RAISE EXCEPTION 'نوع القائمة غير صالح.';
  END IF;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد الفرع المنفذ للحركة.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'operations.pickup.approve', v_branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: operations.pickup.approve permission on branch required';
  END IF;

  IF v_type = 'transfer_out' THEN
    IF v_target_branch_id IS NULL OR v_target_branch_id = v_branch_id THEN
      RAISE EXCEPTION 'يجب تحديد فرع وجهة مختلف عن فرع المنشأ لقائمة النقل بين الفروع.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.branches WHERE tenant_id = p_tenant_id AND id = v_target_branch_id AND archived_at IS NULL) THEN
      RAISE EXCEPTION 'فرع الوجهة المحدد غير موجود أو مؤرشف.';
    END IF;
  END IF;

  IF v_movement_type_id IS NULL THEN
    SELECT id INTO v_movement_type_id
    FROM public.movement_types
    WHERE tenant_id = p_tenant_id
      AND code = CASE
        WHEN v_type = 'transfer_out' THEN 'MOV-003'
        WHEN v_source_transfer_id IS NOT NULL THEN 'MOV-004'
        ELSE 'MOV-002'
      END
    LIMIT 1;
  END IF;

  v_code := app_private.next_document_number(
    p_tenant_id,
    CASE WHEN v_type = 'transfer_out' THEN 'transfer_lists' ELSE 'warehouse_manifests' END
  );

  INSERT INTO public.warehouse_manifests (
    tenant_id, manifest_code, manifest_type, manifest_date, branch_id,
    target_branch_id, source_transfer_manifest_id, courier_id, movement_type_id,
    status, notes, created_by, updated_by
  )
  VALUES (
    p_tenant_id, v_code, v_type, v_manifest_date, v_branch_id,
    v_target_branch_id, v_source_transfer_id, v_courier_id, v_movement_type_id,
    'draft', v_notes, auth.uid(), auth.uid()
  )
  RETURNING id INTO v_manifest_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(),
    CASE WHEN v_type = 'transfer_out' THEN 'transfer_list.created' ELSE 'warehouse_manifest.created' END,
    'warehouse_manifests', v_manifest_id,
    jsonb_build_object('manifest_code', v_code, 'manifest_type', v_type, 'branch_id', v_branch_id, 'target_branch_id', v_target_branch_id),
    'rpc'
  );

  RETURN jsonb_build_object('id', v_manifest_id, 'manifest_code', v_code, 'manifest_type', v_type, 'status', 'draft');
END;
$$;

REVOKE ALL ON FUNCTION public.create_warehouse_manifest(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_warehouse_manifest(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_shipments_to_warehouse_manifest(
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
  v_manifest public.warehouse_manifests%ROWTYPE;
  v_clean_q text := trim(COALESCE(p_barcode_query, ''));
  v_via text := CASE WHEN char_length(trim(COALESCE(p_barcode_query, ''))) > 0 THEN 'barcode' ELSE 'manual' END;
  v_target_ids uuid[] := ARRAY[]::uuid[];
  v_shp public.shipments%ROWTYPE;
  v_sid uuid;
  v_added integer := 0;
  v_skipped integer := 0;
BEGIN
  SELECT * INTO v_manifest
  FROM public.warehouse_manifests
  WHERE tenant_id = p_tenant_id AND id = p_manifest_id
  FOR UPDATE;

  IF v_manifest.id IS NULL THEN
    RAISE EXCEPTION 'القائمة المخزنية غير موجودة.';
  END IF;

  IF v_manifest.status <> 'draft' THEN
    RAISE EXCEPTION 'لا يمكن تعديل شحنات قائمة بعد اعتمادها.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'operations.pickup.approve', v_manifest.branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: operations.pickup.approve permission on branch required';
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
      IF v_via = 'barcode' THEN
        RAISE EXCEPTION 'الشحنة غير موجودة.';
      END IF;
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    IF v_manifest.manifest_type = 'transfer_out' THEN
      -- Outgoing inter-branch transfer: must be in_warehouse at origin branch
      IF v_shp.operational_status <> 'in_warehouse' THEN
        IF v_via = 'barcode' THEN
          RAISE EXCEPTION 'النقل الصادر يتطلب أن تكون الشحنة في حالة بالمخزن (الحالة الحالية: %).', v_shp.operational_status;
        END IF;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      IF v_shp.current_branch_id <> v_manifest.branch_id THEN
        IF v_via = 'barcode' THEN
          RAISE EXCEPTION 'الشحنة (%) ليست في عهدة فرع المنشأ المحدد لقائمة النقل.', v_shp.shipment_number;
        END IF;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM public.warehouse_manifest_items wmi
        JOIN public.warehouse_manifests wm ON wm.id = wmi.manifest_id AND wm.tenant_id = wmi.tenant_id
        WHERE wmi.tenant_id = p_tenant_id
          AND wmi.shipment_id = v_sid
          AND wm.manifest_type = 'transfer_out'
          AND wm.status IN ('draft', 'in_transit', 'partially_received')
          AND wm.id <> v_manifest.id
      ) THEN
        IF v_via = 'barcode' THEN
          RAISE EXCEPTION 'الشحنة (%) مدرجة بالفعل في قائمة نقل نشطة.', v_shp.shipment_number;
        END IF;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;
    ELSE
      -- Warehouse intake (local receiving OR incoming inter-branch receiving)
      IF v_shp.operational_status NOT IN (
        'created', 'pickup_scheduled', 'picked_up', 'in_transit_branch',
        'out_for_delivery', 'delivery_failed', 'partially_delivered', 'return_to_sender'
      ) THEN
        IF v_via = 'barcode' THEN
          RAISE EXCEPTION 'حالة الشحنة (%) هي (%) ولا تقبل الاستلام بالمخزن حاليًا.', v_shp.shipment_number, v_shp.operational_status;
        END IF;
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      -- For in_transit_branch, enforce destination branch handshake unless tenant admin/ops_mgr
      IF v_shp.operational_status = 'in_transit_branch'
         AND NOT app_private.user_can_override_operations(p_tenant_id)
      THEN
        IF NOT EXISTS (
          SELECT 1
          FROM public.warehouse_manifest_items wmi
          JOIN public.warehouse_manifests wm ON wm.id = wmi.manifest_id AND wm.tenant_id = wmi.tenant_id
          WHERE wmi.tenant_id = p_tenant_id
            AND wmi.shipment_id = v_sid
            AND wm.manifest_type = 'transfer_out'
            AND wm.status IN ('in_transit', 'partially_received')
            AND wm.target_branch_id = v_manifest.branch_id
        ) THEN
          IF v_via = 'barcode' THEN
            RAISE EXCEPTION 'الشحنة (%) قيد النقل بين الفروع لكنها موجهة إلى فرع آخر.', v_shp.shipment_number;
          END IF;
          v_skipped := v_skipped + 1;
          CONTINUE;
        END IF;
      END IF;
    END IF;

    INSERT INTO public.warehouse_manifest_items (
      tenant_id, manifest_id, shipment_id, added_via, verified_weight_kg, created_by
    )
    VALUES (
      p_tenant_id, v_manifest.id, v_sid, v_via, v_shp.actual_weight_kg, auth.uid()
    )
    ON CONFLICT (tenant_id, manifest_id, shipment_id) DO NOTHING;

    IF FOUND THEN
      v_added := v_added + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('added_count', v_added, 'skipped_count', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.add_shipments_to_warehouse_manifest(uuid, uuid, uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_shipments_to_warehouse_manifest(uuid, uuid, uuid[], text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_shipment_from_warehouse_manifest(
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
  v_manifest public.warehouse_manifests%ROWTYPE;
BEGIN
  SELECT * INTO v_manifest
  FROM public.warehouse_manifests
  WHERE tenant_id = p_tenant_id AND id = p_manifest_id
  FOR UPDATE;

  IF v_manifest.id IS NULL THEN
    RAISE EXCEPTION 'القائمة غير موجودة.';
  END IF;

  IF v_manifest.status <> 'draft' THEN
    RAISE EXCEPTION 'لا يمكن إزالة شحنات من قائمة معتمدة.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'operations.pickup.approve', v_manifest.branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: operations.pickup.approve permission on branch required';
  END IF;

  DELETE FROM public.warehouse_manifest_items
  WHERE tenant_id = p_tenant_id
    AND manifest_id = p_manifest_id
    AND shipment_id = p_shipment_id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_shipment_from_warehouse_manifest(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_shipment_from_warehouse_manifest(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_warehouse_manifest(
  p_tenant_id uuid,
  p_manifest_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_manifest public.warehouse_manifests%ROWTYPE;
  v_item_count integer;
  v_actor_name text;
  v_rec record;
  v_src_id uuid;
  v_pending_cnt integer;
  v_received_cnt integer;
  v_next_status text;
  v_new_partial_custody text;
  v_new_exchange_status text;
BEGIN
  SELECT * INTO v_manifest
  FROM public.warehouse_manifests
  WHERE tenant_id = p_tenant_id AND id = p_manifest_id
  FOR UPDATE;

  IF v_manifest.id IS NULL THEN
    RAISE EXCEPTION 'القائمة المخزنية غير موجودة.';
  END IF;

  IF v_manifest.status <> 'draft' THEN
    RAISE EXCEPTION 'القائمة معتمدة أو مغلقة بالفعل.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'operations.pickup.approve', v_manifest.branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: operations.pickup.approve permission on branch required';
  END IF;

  SELECT count(*) INTO v_item_count
  FROM public.warehouse_manifest_items
  WHERE tenant_id = p_tenant_id AND manifest_id = v_manifest.id;

  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'لا يمكن اعتماد قائمة فارغة. أضف شحنة واحدة على الأقل.';
  END IF;

  SELECT COALESCE(display_name, 'مستخدم النظام') INTO v_actor_name
  FROM public.profiles WHERE id = auth.uid();

  PERFORM set_config('app_private.allow_shipment_mutation', 'on', true);

  IF v_manifest.manifest_type = 'transfer_out' THEN
    -- STEP 1 OF ADR-015: Outgoing dispatch moves status -> in_transit_branch, keeping current_branch_id at origin
    FOR v_rec IN
      SELECT s.*, wmi.id AS item_id
      FROM public.warehouse_manifest_items wmi
      JOIN public.shipments s ON s.tenant_id = wmi.tenant_id AND s.id = wmi.shipment_id
      WHERE wmi.tenant_id = p_tenant_id AND wmi.manifest_id = v_manifest.id
      FOR UPDATE OF s
    LOOP
      IF v_rec.operational_status <> 'in_warehouse' OR v_rec.current_branch_id <> v_manifest.branch_id THEN
        RAISE EXCEPTION 'الشحنة (%) ليست في المخزن بفرع المنشأ (%).', v_rec.shipment_number, v_rec.operational_status;
      END IF;

      UPDATE public.shipments
      SET operational_status = 'in_transit_branch',
          movement_type_id = COALESCE(v_manifest.movement_type_id, movement_type_id),
          updated_by = auth.uid()
      WHERE id = v_rec.id AND tenant_id = p_tenant_id;

      INSERT INTO public.shipment_status_events (
        tenant_id, shipment_id, event_code, from_status, to_status,
        branch_id, movement_type_id, list_type, list_code,
        fees_snapshot, notes, actor_user_id, actor_display_name
      )
      VALUES (
        p_tenant_id, v_rec.id, 'transfer.dispatched', v_rec.operational_status, 'in_transit_branch',
        v_manifest.branch_id, v_manifest.movement_type_id, 'branch_transfer_out', v_manifest.manifest_code,
        v_rec.total_shipping_fee,
        COALESCE(v_manifest.notes, 'نقل صادر بين الفروع عبر القائمة ' || v_manifest.manifest_code),
        auth.uid(), v_actor_name
      );
    END LOOP;

    v_next_status := 'in_transit';

    UPDATE public.warehouse_manifests
    SET status = v_next_status,
        approved_at = now(),
        approved_by = auth.uid(),
        updated_by = auth.uid()
    WHERE id = v_manifest.id AND tenant_id = p_tenant_id;

    INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
    VALUES (
      p_tenant_id, auth.uid(), 'transfer_list.dispatched', 'warehouse_manifests', v_manifest.id,
      jsonb_build_object(
        'manifest_code', v_manifest.manifest_code,
        'origin_branch_id', v_manifest.branch_id,
        'target_branch_id', v_manifest.target_branch_id,
        'shipments_count', v_item_count
      ),
      'rpc'
    );
  ELSE
    -- STEP 2 OF ADR-015 / Warehouse Intake: moves status -> in_warehouse AND updates current_branch_id -> manifest.branch_id
    FOR v_rec IN
      SELECT s.*, wmi.id AS item_id
      FROM public.warehouse_manifest_items wmi
      JOIN public.shipments s ON s.tenant_id = wmi.tenant_id AND s.id = wmi.shipment_id
      WHERE wmi.tenant_id = p_tenant_id AND wmi.manifest_id = v_manifest.id
      FOR UPDATE OF s
    LOOP
      v_new_partial_custody := CASE
        WHEN v_rec.partial_return_custody = 'with_courier' THEN 'in_warehouse'
        ELSE v_rec.partial_return_custody
      END;
      v_new_exchange_status := CASE
        WHEN v_rec.exchange_status = 'with_courier' THEN 'in_warehouse'
        ELSE v_rec.exchange_status
      END;

      UPDATE public.shipments
      SET operational_status = 'in_warehouse',
          current_branch_id = v_manifest.branch_id,
          movement_type_id = COALESCE(v_manifest.movement_type_id, movement_type_id),
          partial_return_custody = v_new_partial_custody,
          exchange_status = v_new_exchange_status,
          updated_by = auth.uid()
      WHERE id = v_rec.id AND tenant_id = p_tenant_id;

      IF v_new_exchange_status = 'in_warehouse' AND v_rec.exchange_status = 'with_courier' THEN
        UPDATE public.shipment_relations
        SET custody_status = 'in_warehouse'
        WHERE tenant_id = p_tenant_id AND shipment_id = v_rec.id AND relation_type = 'ptp_exchange_return';
      END IF;

      UPDATE public.warehouse_manifest_items
      SET receive_status = 'received',
          received_at = now(),
          received_by = auth.uid()
      WHERE id = v_rec.item_id AND tenant_id = p_tenant_id;

      -- Mark matching open transfer_out item as received
      UPDATE public.warehouse_manifest_items wmi_src
      SET receive_status = 'received',
          received_at = now(),
          received_by = auth.uid()
      FROM public.warehouse_manifests wm_src
      WHERE wmi_src.tenant_id = p_tenant_id
        AND wm_src.tenant_id = p_tenant_id
        AND wm_src.id = wmi_src.manifest_id
        AND wm_src.manifest_type = 'transfer_out'
        AND wm_src.status IN ('in_transit', 'partially_received')
        AND wm_src.target_branch_id = v_manifest.branch_id
        AND wmi_src.shipment_id = v_rec.id
        AND wmi_src.receive_status = 'pending';

      -- Mark pickup_list_items completed if arriving from a pickup list
      UPDATE public.pickup_list_items pli
      SET pickup_completed_at = COALESCE(pli.pickup_completed_at, now())
      WHERE pli.tenant_id = p_tenant_id
        AND pli.shipment_id = v_rec.id
        AND pli.pickup_completed_at IS NULL;

      INSERT INTO public.shipment_status_events (
        tenant_id, shipment_id, event_code, from_status, to_status,
        branch_id, courier_id, movement_type_id, list_type, list_code,
        fees_snapshot, notes, actor_user_id, actor_display_name
      )
      VALUES (
        p_tenant_id, v_rec.id,
        CASE WHEN v_rec.operational_status = 'in_transit_branch' THEN 'transfer.received_destination' ELSE 'warehouse.intake_approved' END,
        v_rec.operational_status, 'in_warehouse',
        v_manifest.branch_id, COALESCE(v_manifest.courier_id, v_rec.assigned_courier_id),
        v_manifest.movement_type_id,
        CASE WHEN v_rec.operational_status = 'in_transit_branch' THEN 'branch_transfer_in' ELSE 'warehouse_intake' END,
        v_manifest.manifest_code,
        v_rec.total_shipping_fee,
        COALESCE(v_manifest.notes, 'تم الاستلام بمخزن الفرع عبر القائمة ' || v_manifest.manifest_code),
        auth.uid(), v_actor_name
      );
    END LOOP;

    -- Refresh parent transfer_out manifests whose target_branch_id = v_manifest.branch_id
    FOR v_src_id IN
      SELECT DISTINCT wm_src.id
      FROM public.warehouse_manifests wm_src
      JOIN public.warehouse_manifest_items wmi_src ON wmi_src.manifest_id = wm_src.id AND wmi_src.tenant_id = wm_src.tenant_id
      WHERE wm_src.tenant_id = p_tenant_id
        AND wm_src.manifest_type = 'transfer_out'
        AND wm_src.status IN ('in_transit', 'partially_received')
        AND wm_src.target_branch_id = v_manifest.branch_id
        AND EXISTS (
          SELECT 1 FROM public.warehouse_manifest_items wmi_in
          WHERE wmi_in.manifest_id = v_manifest.id AND wmi_in.shipment_id = wmi_src.shipment_id
        )
    LOOP
      SELECT
        count(*) FILTER (WHERE receive_status = 'pending'),
        count(*) FILTER (WHERE receive_status IN ('received', 'released'))
      INTO v_pending_cnt, v_received_cnt
      FROM public.warehouse_manifest_items
      WHERE tenant_id = p_tenant_id AND manifest_id = v_src_id;

      UPDATE public.warehouse_manifests
      SET status = CASE
            WHEN v_pending_cnt = 0 THEN 'approved'
            WHEN v_received_cnt > 0 THEN 'partially_received'
            ELSE status
          END,
          updated_by = auth.uid()
      WHERE id = v_src_id AND tenant_id = p_tenant_id;
    END LOOP;

    v_next_status := 'approved';

    UPDATE public.warehouse_manifests
    SET status = v_next_status,
        approved_at = now(),
        approved_by = auth.uid(),
        updated_by = auth.uid()
    WHERE id = v_manifest.id AND tenant_id = p_tenant_id;

    INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
    VALUES (
      p_tenant_id, auth.uid(), 'warehouse_manifest.approved', 'warehouse_manifests', v_manifest.id,
      jsonb_build_object('manifest_code', v_manifest.manifest_code, 'branch_id', v_manifest.branch_id, 'shipments_count', v_item_count),
      'rpc'
    );
  END IF;

  PERFORM set_config('app_private.allow_shipment_mutation', 'off', true);

  RETURN jsonb_build_object(
    'id', v_manifest.id,
    'manifest_code', v_manifest.manifest_code,
    'status', v_next_status,
    'shipments_count', v_item_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_warehouse_manifest(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_warehouse_manifest(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Server-Side RPC: Admin / Operations Manager Hang Release & Override (ADR-015)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_release_stuck_transfer_or_manifest(
  p_tenant_id uuid,
  p_manifest_id uuid,
  p_shipment_id uuid,
  p_action text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_manifest public.warehouse_manifests%ROWTYPE;
  v_item public.warehouse_manifest_items%ROWTYPE;
  v_shp public.shipments%ROWTYPE;
  v_clean_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_target_branch uuid;
  v_pending_cnt integer;
  v_actor_name text;
BEGIN
  IF NOT app_private.user_can_override_operations(p_tenant_id) THEN
    RAISE EXCEPTION 'Forbidden: فك التعليق أو التعديل الإداري يقتصر على الأدمن ومدير العمليات (ADR-015).';
  END IF;

  IF p_action NOT IN ('return_to_origin', 'force_receive_destination') THEN
    RAISE EXCEPTION 'إجراء فك التعليق غير معروف.';
  END IF;

  IF v_clean_reason IS NULL OR char_length(v_clean_reason) < 5 THEN
    RAISE EXCEPTION 'يجب إدخال سبب واضح لا يقل عن 5 أحرف لتسجيله في سجل التدقيق (ADR-015).';
  END IF;

  SELECT * INTO v_manifest
  FROM public.warehouse_manifests
  WHERE tenant_id = p_tenant_id AND id = p_manifest_id
  FOR UPDATE;

  IF v_manifest.id IS NULL OR v_manifest.manifest_type <> 'transfer_out' THEN
    RAISE EXCEPTION 'قائمة النقل المحددة غير موجودة.';
  END IF;

  SELECT * INTO v_item
  FROM public.warehouse_manifest_items
  WHERE tenant_id = p_tenant_id AND manifest_id = p_manifest_id AND shipment_id = p_shipment_id
  FOR UPDATE;

  IF v_item.id IS NULL THEN
    RAISE EXCEPTION 'الشحنة غير مدرجة ضمن قائمة النقل المحددة.';
  END IF;

  SELECT * INTO v_shp
  FROM public.shipments
  WHERE tenant_id = p_tenant_id AND id = p_shipment_id
  FOR UPDATE;

  IF v_shp.operational_status <> 'in_transit_branch' THEN
    RAISE EXCEPTION 'الشحنة ليست عالقة في حالة قيد النقل بين الفروع.';
  END IF;

  v_target_branch := CASE
    WHEN p_action = 'force_receive_destination' THEN v_manifest.target_branch_id
    ELSE v_manifest.branch_id
  END;

  SELECT COALESCE(display_name, 'مدير النظام') INTO v_actor_name
  FROM public.profiles WHERE id = auth.uid();

  PERFORM set_config('app_private.allow_shipment_mutation', 'on', true);

  UPDATE public.shipments
  SET operational_status = 'in_warehouse',
      current_branch_id = v_target_branch,
      updated_by = auth.uid()
  WHERE id = v_shp.id AND tenant_id = p_tenant_id;

  PERFORM set_config('app_private.allow_shipment_mutation', 'off', true);

  UPDATE public.warehouse_manifest_items
  SET receive_status = CASE WHEN p_action = 'force_receive_destination' THEN 'received' ELSE 'released' END,
      received_at = now(),
      received_by = auth.uid(),
      notes = v_clean_reason
  WHERE id = v_item.id AND tenant_id = p_tenant_id;

  SELECT count(*) FILTER (WHERE receive_status = 'pending') INTO v_pending_cnt
  FROM public.warehouse_manifest_items
  WHERE tenant_id = p_tenant_id AND manifest_id = v_manifest.id;

  UPDATE public.warehouse_manifests
  SET status = CASE WHEN v_pending_cnt = 0 THEN 'approved' ELSE 'partially_received' END,
      released_at = now(),
      released_by = auth.uid(),
      release_reason = v_clean_reason,
      updated_by = auth.uid()
  WHERE id = v_manifest.id AND tenant_id = p_tenant_id;

  INSERT INTO public.shipment_status_events (
    tenant_id, shipment_id, event_code, from_status, to_status,
    branch_id, list_type, list_code, fees_snapshot, notes, actor_user_id, actor_display_name
  )
  VALUES (
    p_tenant_id, v_shp.id,
    CASE WHEN p_action = 'force_receive_destination' THEN 'transfer.admin_force_received' ELSE 'transfer.admin_released' END,
    v_shp.operational_status, 'in_warehouse',
    v_target_branch, 'branch_transfer_override', v_manifest.manifest_code,
    v_shp.total_shipping_fee,
    'فك تعليق إداري (' || p_action || '): ' || v_clean_reason,
    auth.uid(), v_actor_name
  );

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, source
  )
  VALUES (
    p_tenant_id, auth.uid(), 'transfer.admin_override', 'warehouse_manifests', v_manifest.id,
    jsonb_build_object('shipment_id', v_shp.id, 'from_status', v_shp.operational_status, 'from_branch_id', v_shp.current_branch_id),
    jsonb_build_object('shipment_id', v_shp.id, 'action', p_action, 'target_branch_id', v_target_branch, 'reason', v_clean_reason),
    'rpc'
  );

  RETURN jsonb_build_object(
    'manifest_id', v_manifest.id,
    'shipment_id', v_shp.id,
    'new_status', 'in_warehouse',
    'new_branch_id', v_target_branch
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_release_stuck_transfer_or_manifest(uuid, uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_release_stuck_transfer_or_manifest(uuid, uuid, uuid, text, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Helper Query RPC: Incoming In-Transit Shipments Destined to a Branch
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_branch_inbound_transfer_shipments(
  p_tenant_id uuid,
  p_branch_id uuid
)
RETURNS TABLE (
  shipment_id uuid,
  shipment_number text,
  barcode_token text,
  origin_branch_id uuid,
  target_branch_id uuid,
  transfer_manifest_id uuid,
  transfer_manifest_code text,
  recipient_name text,
  recipient_mobile text,
  chargeable_weight_kg numeric,
  pieces_count integer,
  recipient_collect_amount numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  IF NOT (
    app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'operations.pickup.approve', p_branch_id)
    OR app_private.user_has_permission(p_tenant_id, 'shipments.read', p_branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: branch access required';
  END IF;

  RETURN QUERY
  SELECT
    s.id AS shipment_id,
    s.shipment_number,
    s.barcode_token,
    wm.branch_id AS origin_branch_id,
    wm.target_branch_id,
    wm.id AS transfer_manifest_id,
    wm.manifest_code AS transfer_manifest_code,
    sp.name AS recipient_name,
    sp.mobile AS recipient_mobile,
    s.chargeable_weight_kg,
    s.pieces_count,
    s.recipient_collect_amount
  FROM public.warehouse_manifests wm
  JOIN public.warehouse_manifest_items wmi ON wmi.manifest_id = wm.id AND wmi.tenant_id = wm.tenant_id
  JOIN public.shipments s ON s.id = wmi.shipment_id AND s.tenant_id = wmi.tenant_id
  LEFT JOIN public.shipment_parties sp ON sp.shipment_id = s.id AND sp.tenant_id = s.tenant_id AND sp.party_type = 'recipient'
  WHERE wm.tenant_id = p_tenant_id
    AND wm.manifest_type = 'transfer_out'
    AND wm.status IN ('in_transit', 'partially_received')
    AND wm.target_branch_id = p_branch_id
    AND wmi.receive_status = 'pending'
    AND s.operational_status = 'in_transit_branch'
  ORDER BY wm.created_at DESC, s.shipment_number ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_branch_inbound_transfer_shipments(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_branch_inbound_transfer_shipments(uuid, uuid) TO authenticated;
