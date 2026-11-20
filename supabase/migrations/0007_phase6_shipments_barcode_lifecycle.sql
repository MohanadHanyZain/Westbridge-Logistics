-- ============================================================================
-- Migration 0007: Phase 6 - Shipments, Non-Guessable Barcode, Lifecycle & Tracking
-- ============================================================================
-- Implements approved decisions:
-- - ADR-010 (OQ-04): Pre-delivery weight/dimension revision creates a new
--   immutable version in shipment_price_snapshots + shipment_dimensions + audit log;
--   manual override_price gated behind pricing.override/admin with mandatory reason.
-- - ADR-011 (OQ-05): shipping_included vs shipping_excluded payout math.
-- - ADR-013 (OQ-06): COD (courier cash custody), PREPAID (prepaid balance, 0 collect),
--   POSTPAID (deferred client ledger, 0 collect), CASH_PAID (cash at creation, 0 collect).
-- - ADR-014 (OQ-07): PDP on same shipment (delivered/returned pieces & actual
--   delivered amount + partial_return_custody); PTP links mandatory return parcel
--   custody in shipment_relations (ptp_exchange_return) & exchange_status lifecycle.
-- - Non-bypassable workflow transitions protected by DB mutation guard trigger.
-- - Sanitized non-PII public tracking lookup (anon & authenticated).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Pre-requisite Composite Unique Constraints on Reference Tables
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_movement_types_tenant_id_id'
  ) THEN
    ALTER TABLE public.movement_types
      ADD CONSTRAINT uq_movement_types_tenant_id_id UNIQUE (tenant_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_exception_reasons_tenant_id_id'
  ) THEN
    ALTER TABLE public.delivery_exception_reasons
      ADD CONSTRAINT uq_exception_reasons_tenant_id_id UNIQUE (tenant_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_sps_tenant_id_id'
  ) THEN
    ALTER TABLE public.shipment_price_snapshots
      ADD CONSTRAINT uq_sps_tenant_id_id UNIQUE (tenant_id, id);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Atomic Document Numbering Helper (tenant_id + entity_key)
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
BEGIN
  SELECT * INTO v_seq
  FROM public.numbering_sequences
  WHERE tenant_id = p_tenant_id
    AND entity_key = p_entity_key
  FOR UPDATE;

  IF v_seq.id IS NULL THEN
    INSERT INTO public.numbering_sequences (tenant_id, entity_key, label, prefix, next_number, padding_length)
    VALUES (p_tenant_id, p_entity_key, p_entity_key, upper(left(p_entity_key, 3)), 1, 7)
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

-- ----------------------------------------------------------------------------
-- 3. Core Shipments Aggregate & Bind Snapshots
-- ----------------------------------------------------------------------------
CREATE TABLE public.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  idempotency_key text,
  shipment_number text NOT NULL CHECK (char_length(trim(shipment_number)) >= 4),
  barcode_token text NOT NULL CHECK (char_length(trim(barcode_token)) >= 12),
  client_id uuid NOT NULL,
  origin_branch_id uuid NOT NULL,
  current_branch_id uuid NOT NULL,
  destination_branch_id uuid,
  assigned_courier_id uuid,
  movement_type_id uuid,
  shipment_type_id uuid NOT NULL,
  shipment_type_code text NOT NULL CHECK (shipment_type_code IN ('FDP', 'PDP', 'PTP', 'CLC', 'RTS')),
  service_id uuid NOT NULL,
  payment_term_id uuid NOT NULL,
  payment_term_code text NOT NULL CHECK (payment_term_code IN ('COD', 'PREPAID', 'POSTPAID', 'CASH_PAID')),
  price_mode text NOT NULL CHECK (price_mode IN ('shipping_included', 'shipping_excluded')),
  operational_status text NOT NULL DEFAULT 'created' CHECK (
    operational_status IN (
      'created', 'pickup_scheduled', 'picked_up', 'in_warehouse',
      'in_transit_branch', 'out_for_delivery', 'rescheduled',
      'partially_delivered', 'delivered', 'delivery_failed',
      'return_to_sender', 'returned', 'cancelled'
    )
  ),
  -- Top 4 lifecycle/financial flags (MASTER_SPEC)
  is_created_confirmed boolean NOT NULL DEFAULT true,
  is_collected_from_courier boolean NOT NULL DEFAULT false,
  is_settled_to_client boolean NOT NULL DEFAULT false,
  is_courier_commission_paid boolean NOT NULL DEFAULT false,
  -- Authoritative pricing & ADR-013 financial breakdown
  entered_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (entered_amount >= 0),
  prepaid_balance_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (prepaid_balance_amount >= 0),
  total_shipping_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (total_shipping_fee >= 0),
  return_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (return_fee >= 0),
  recipient_collect_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (recipient_collect_amount >= 0),
  client_net_payout numeric(14,2) NOT NULL DEFAULT 0,
  delivered_amount numeric(14,2) CHECK (delivered_amount IS NULL OR delivered_amount >= 0),
  -- Pieces & ADR-014 PDP / PTP custody tracking
  pieces_count integer NOT NULL DEFAULT 1 CHECK (pieces_count >= 1 AND pieces_count <= 999),
  delivered_pieces_count integer NOT NULL DEFAULT 0 CHECK (delivered_pieces_count >= 0),
  returned_pieces_count integer NOT NULL DEFAULT 0 CHECK (returned_pieces_count >= 0),
  partial_return_custody text NOT NULL DEFAULT 'none'
    CHECK (partial_return_custody IN ('none', 'with_courier', 'in_warehouse', 'returned_to_client')),
  exchange_status text NOT NULL DEFAULT 'none'
    CHECK (exchange_status IN ('none', 'pending_exchange', 'with_courier', 'in_warehouse', 'returned_to_client')),
  -- Weight & package metadata
  actual_weight_kg numeric(10,3) NOT NULL DEFAULT 1 CHECK (actual_weight_kg >= 0),
  chargeable_weight_kg numeric(10,3) NOT NULL DEFAULT 1 CHECK (chargeable_weight_kg >= 0),
  allow_package_opening boolean NOT NULL DEFAULT false,
  package_description text,
  external_reference text,
  notes text,
  pickup_date date NOT NULL DEFAULT current_date,
  pickup_time_from time,
  pickup_time_to time,
  current_snapshot_id uuid,
  sender_governorate_id uuid NOT NULL,
  sender_region_id uuid NOT NULL,
  recipient_governorate_id uuid NOT NULL,
  recipient_region_id uuid NOT NULL,
  delivery_attempts_count integer NOT NULL DEFAULT 0 CHECK (delivery_attempts_count >= 0),
  last_exception_reason_id uuid,
  delivered_at timestamptz,
  returned_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_shipments_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_shipments_tenant_number UNIQUE (tenant_id, shipment_number),
  CONSTRAINT uq_shipments_tenant_barcode UNIQUE (tenant_id, barcode_token),
  CONSTRAINT chk_shipments_pieces_balance CHECK (delivered_pieces_count + returned_pieces_count <= pieces_count),
  CONSTRAINT fk_shp_client FOREIGN KEY (tenant_id, client_id) REFERENCES public.clients(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shp_origin_branch FOREIGN KEY (tenant_id, origin_branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shp_current_branch FOREIGN KEY (tenant_id, current_branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shp_dest_branch FOREIGN KEY (tenant_id, destination_branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shp_courier FOREIGN KEY (tenant_id, assigned_courier_id) REFERENCES public.couriers(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shp_movement FOREIGN KEY (tenant_id, movement_type_id) REFERENCES public.movement_types(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shp_type FOREIGN KEY (tenant_id, shipment_type_id) REFERENCES public.shipment_types(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shp_service FOREIGN KEY (tenant_id, service_id) REFERENCES public.shipping_services(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shp_pay_term FOREIGN KEY (tenant_id, payment_term_id) REFERENCES public.payment_terms(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shp_snd_gov FOREIGN KEY (tenant_id, sender_governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shp_snd_reg FOREIGN KEY (tenant_id, sender_region_id) REFERENCES public.regions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shp_rcv_gov FOREIGN KEY (tenant_id, recipient_governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shp_rcv_reg FOREIGN KEY (tenant_id, recipient_region_id) REFERENCES public.regions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_shp_exc_reason FOREIGN KEY (tenant_id, last_exception_reason_id) REFERENCES public.delivery_exception_reasons(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_shipments_tenant_idempotency
  ON public.shipments (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_shipments_tenant_status_created ON public.shipments (tenant_id, operational_status, created_at DESC);
CREATE INDEX idx_shipments_tenant_client ON public.shipments (tenant_id, client_id, created_at DESC);
CREATE INDEX idx_shipments_tenant_branch ON public.shipments (tenant_id, current_branch_id, operational_status);
CREATE INDEX idx_shipments_tenant_courier ON public.shipments (tenant_id, assigned_courier_id) WHERE assigned_courier_id IS NOT NULL;

CREATE TRIGGER trg_shipments_updated_at
  BEFORE UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- Guard against direct client UPDATE/DELETE on shipments outside server workflow RPCs
CREATE OR REPLACE FUNCTION app_private.guard_shipment_direct_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Forbidden: shipments cannot be deleted; use cancel workflow instead';
  END IF;

  IF current_setting('app_private.allow_shipment_mutation', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Forbidden: direct mutation of shipments is blocked; use server workflow RPCs';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shipments_guard_mutation
  BEFORE UPDATE OR DELETE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_shipment_direct_mutation();

-- Bind shipment_price_snapshots.shipment_id and shipments.current_snapshot_id
ALTER TABLE public.shipment_price_snapshots
  DROP CONSTRAINT IF EXISTS fk_sps_shipment,
  ADD CONSTRAINT fk_sps_shipment
    FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE public.shipments
  ADD CONSTRAINT fk_shp_current_snapshot
    FOREIGN KEY (tenant_id, current_snapshot_id) REFERENCES public.shipment_price_snapshots(tenant_id, id) ON DELETE RESTRICT;

-- ----------------------------------------------------------------------------
-- 4. Shipment Parties, Packages, Dimensions, Events, Relations, Tokens, Notes
-- ----------------------------------------------------------------------------
CREATE TABLE public.shipment_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL,
  party_type text NOT NULL CHECK (party_type IN ('sender', 'recipient')),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  phone text,
  mobile text NOT NULL CHECK (char_length(trim(mobile)) >= 4),
  governorate_id uuid NOT NULL,
  city_id uuid,
  region_id uuid NOT NULL,
  address_line text NOT NULL CHECK (char_length(trim(address_line)) >= 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_shipment_parties_type UNIQUE (tenant_id, shipment_id, party_type),
  CONSTRAINT fk_sp_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sp_gov FOREIGN KEY (tenant_id, governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sp_city FOREIGN KEY (tenant_id, city_id) REFERENCES public.cities(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sp_reg FOREIGN KEY (tenant_id, region_id) REFERENCES public.regions(tenant_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_shipment_parties_updated_at
  BEFORE UPDATE ON public.shipment_parties
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.shipment_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL,
  package_index integer NOT NULL DEFAULT 1 CHECK (package_index >= 1),
  description text,
  pieces_count integer NOT NULL DEFAULT 1 CHECK (pieces_count >= 1),
  weight_kg numeric(10,3) NOT NULL DEFAULT 1 CHECK (weight_kg >= 0),
  declared_value numeric(14,2) NOT NULL DEFAULT 0 CHECK (declared_value >= 0),
  barcode text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_shipment_packages_idx UNIQUE (tenant_id, shipment_id, package_index),
  CONSTRAINT fk_spkg_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.shipment_dimensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL,
  snapshot_id uuid,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number >= 1),
  actual_weight_kg numeric(10,3) NOT NULL CHECK (actual_weight_kg >= 0),
  length_cm numeric(10,2) NOT NULL DEFAULT 0 CHECK (length_cm >= 0),
  width_cm numeric(10,2) NOT NULL DEFAULT 0 CHECK (width_cm >= 0),
  height_cm numeric(10,2) NOT NULL DEFAULT 0 CHECK (height_cm >= 0),
  volumetric_divisor numeric(10,2) NOT NULL DEFAULT 5000 CHECK (volumetric_divisor > 0),
  volumetric_weight_kg numeric(10,3) NOT NULL DEFAULT 0 CHECK (volumetric_weight_kg >= 0),
  chargeable_weight_kg numeric(10,3) NOT NULL DEFAULT 0 CHECK (chargeable_weight_kg >= 0),
  reason text,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_shipment_dimensions_ver UNIQUE (tenant_id, shipment_id, version_number),
  CONSTRAINT fk_sdim_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sdim_snapshot FOREIGN KEY (tenant_id, snapshot_id) REFERENCES public.shipment_price_snapshots(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.shipment_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL,
  event_code text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  branch_id uuid,
  courier_id uuid,
  movement_type_id uuid,
  exception_reason_id uuid,
  list_type text,
  list_code text,
  delivered_amount numeric(14,2),
  return_type text,
  fees_snapshot numeric(12,2),
  notes text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_sse_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sse_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sse_courier FOREIGN KEY (tenant_id, courier_id) REFERENCES public.couriers(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sse_movement FOREIGN KEY (tenant_id, movement_type_id) REFERENCES public.movement_types(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sse_exception FOREIGN KEY (tenant_id, exception_reason_id) REFERENCES public.delivery_exception_reasons(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_sse_shipment_created ON public.shipment_status_events (tenant_id, shipment_id, created_at DESC);

CREATE OR REPLACE FUNCTION app_private.forbid_event_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'shipment_status_events is append-only and immutable';
END;
$$;

CREATE TRIGGER trg_sse_immutable
  BEFORE UPDATE OR DELETE ON public.shipment_status_events
  FOR EACH ROW EXECUTE FUNCTION app_private.forbid_event_log_mutation();

CREATE TABLE public.shipment_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL,
  related_shipment_id uuid,
  relation_type text NOT NULL CHECK (
    relation_type IN ('ptp_exchange_return', 'pdp_return_custody', 'reshipment', 'split_child')
  ),
  exchange_item_description text,
  custody_status text NOT NULL DEFAULT 'pending' CHECK (
    custody_status IN ('pending', 'with_courier', 'in_warehouse', 'returned_to_client', 'closed')
  ),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_srel_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_srel_related FOREIGN KEY (tenant_id, related_shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_shipment_relations_updated_at
  BEFORE UPDATE ON public.shipment_relations
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.shipment_tracking_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL,
  token text NOT NULL UNIQUE CHECK (char_length(trim(token)) >= 16),
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_stt_shipment_active UNIQUE (tenant_id, shipment_id, token),
  CONSTRAINT fk_stt_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE public.shipment_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL,
  note_type text NOT NULL DEFAULT 'internal' CHECK (
    note_type IN ('internal', 'client_visible', 'courier_note', 'system')
  ),
  body text NOT NULL CHECK (char_length(trim(body)) >= 1),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_snote_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_snote_shipment ON public.shipment_notes (tenant_id, shipment_id, created_at DESC);

CREATE TABLE public.shipment_reference_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  shipment_id uuid NOT NULL,
  ref_type text NOT NULL DEFAULT 'merchant_order' CHECK (
    ref_type IN ('merchant_order', 'invoice', 'waybill_ext', 'other')
  ),
  ref_value text NOT NULL CHECK (char_length(trim(ref_value)) >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sref_unique UNIQUE (tenant_id, shipment_id, ref_type, ref_value),
  CONSTRAINT fk_sref_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT
);

-- ----------------------------------------------------------------------------
-- 5. Shipment Scoped RLS Access Helper & Policies
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.user_can_access_shipment(
  p_tenant_id uuid,
  p_client_id uuid,
  p_origin_branch_id uuid,
  p_current_branch_id uuid,
  p_destination_branch_id uuid,
  p_assigned_courier_id uuid
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
    OR EXISTS (
      SELECT 1
      FROM public.tenant_memberships tm
      JOIN public.profiles pr ON pr.id = tm.user_id AND pr.is_active = true
      JOIN public.tenants t ON t.id = tm.tenant_id AND t.status = 'active'
      LEFT JOIN public.account_subjects asub
        ON asub.tenant_id = tm.tenant_id AND asub.membership_id = tm.id AND asub.is_active = true
      WHERE tm.tenant_id = p_tenant_id
        AND tm.user_id = auth.uid()
        AND tm.is_active = true
        AND (
          (tm.account_subject_type = 'client' AND asub.client_id = p_client_id)
          OR (tm.account_subject_type = 'courier' AND p_assigned_courier_id IS NOT NULL AND asub.courier_id = p_assigned_courier_id)
          OR (
            tm.account_subject_type IN ('staff', 'platform_support')
            AND (
              app_private.user_has_permission(p_tenant_id, 'shipments.read', p_origin_branch_id)
              OR app_private.user_has_permission(p_tenant_id, 'shipments.read', p_current_branch_id)
              OR (p_destination_branch_id IS NOT NULL AND app_private.user_has_permission(p_tenant_id, 'shipments.read', p_destination_branch_id))
            )
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION app_private.user_can_access_shipment(uuid, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.user_can_access_shipment(uuid, uuid, uuid, uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.user_can_access_shipment_id(
  p_tenant_id uuid,
  p_shipment_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shipments s
    WHERE s.tenant_id = p_tenant_id
      AND s.id = p_shipment_id
      AND app_private.user_can_access_shipment(
        s.tenant_id, s.client_id, s.origin_branch_id, s.current_branch_id, s.destination_branch_id, s.assigned_courier_id
      )
  );
$$;

REVOKE ALL ON FUNCTION app_private.user_can_access_shipment_id(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.user_can_access_shipment_id(uuid, uuid) TO authenticated;

-- Enable & Force RLS across all Phase 6 tables
DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'shipments', 'shipment_parties', 'shipment_packages', 'shipment_dimensions',
    'shipment_status_events', 'shipment_relations', 'shipment_tracking_tokens',
    'shipment_notes', 'shipment_reference_numbers'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
  END LOOP;
END $$;

CREATE POLICY shipments_select_policy ON public.shipments
  FOR SELECT TO authenticated
  USING (
    app_private.user_can_access_shipment(
      tenant_id, client_id, origin_branch_id, current_branch_id, destination_branch_id, assigned_courier_id
    )
  );

-- Restrict shipment_price_snapshots & child tables cleanly
CREATE POLICY shipment_parties_select_policy ON public.shipment_parties
  FOR SELECT TO authenticated
  USING (app_private.user_can_access_shipment_id(tenant_id, shipment_id));

CREATE POLICY shipment_packages_select_policy ON public.shipment_packages
  FOR SELECT TO authenticated
  USING (app_private.user_can_access_shipment_id(tenant_id, shipment_id));

CREATE POLICY shipment_dimensions_select_policy ON public.shipment_dimensions
  FOR SELECT TO authenticated
  USING (app_private.user_can_access_shipment_id(tenant_id, shipment_id));

CREATE POLICY shipment_status_events_select_policy ON public.shipment_status_events
  FOR SELECT TO authenticated
  USING (app_private.user_can_access_shipment_id(tenant_id, shipment_id));

CREATE POLICY shipment_relations_select_policy ON public.shipment_relations
  FOR SELECT TO authenticated
  USING (app_private.user_can_access_shipment_id(tenant_id, shipment_id));

CREATE POLICY shipment_tracking_tokens_select_policy ON public.shipment_tracking_tokens
  FOR SELECT TO authenticated
  USING (app_private.user_can_access_shipment_id(tenant_id, shipment_id));

CREATE POLICY shipment_notes_select_policy ON public.shipment_notes
  FOR SELECT TO authenticated
  USING (
    app_private.user_can_access_shipment_id(tenant_id, shipment_id)
    AND (
      note_type = 'client_visible'
      OR NOT EXISTS (
        SELECT 1 FROM public.tenant_memberships tm
        WHERE tm.tenant_id = shipment_notes.tenant_id
          AND tm.user_id = auth.uid()
          AND tm.account_subject_type = 'client'
      )
    )
  );

CREATE POLICY shipment_notes_insert_policy ON public.shipment_notes
  FOR INSERT TO authenticated
  WITH CHECK (app_private.user_can_access_shipment_id(tenant_id, shipment_id));

CREATE POLICY shipment_reference_numbers_select_policy ON public.shipment_reference_numbers
  FOR SELECT TO authenticated
  USING (app_private.user_can_access_shipment_id(tenant_id, shipment_id));

CREATE POLICY shipment_reference_numbers_insert_policy ON public.shipment_reference_numbers
  FOR INSERT TO authenticated
  WITH CHECK (
    app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_can_access_shipment_id(tenant_id, shipment_id)
  );

-- ----------------------------------------------------------------------------
-- 6. Server-Side RPC: Atomic Shipment Creation
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_shipment(
  p_tenant_id uuid,
  p_idempotency_key text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_clean_idem text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_existing public.shipments%ROWTYPE;
  v_existing_token text;

  v_client_id uuid := (p_payload->>'client_id')::uuid;
  v_origin_branch_id uuid := (p_payload->>'origin_branch_id')::uuid;
  v_movement_type_id uuid := NULLIF(p_payload->>'movement_type_id', '')::uuid;
  v_shipment_type_id uuid := (p_payload->>'shipment_type_id')::uuid;
  v_service_id uuid := (p_payload->>'service_id')::uuid;
  v_payment_term_id uuid := (p_payload->>'payment_term_id')::uuid;
  v_price_mode text := COALESCE(NULLIF(trim(p_payload->>'price_mode'), ''), 'shipping_excluded');

  v_actual_weight numeric(10,3) := GREATEST(0, COALESCE((p_payload->>'actual_weight_kg')::numeric, 1));
  v_length_cm numeric(10,2) := GREATEST(0, COALESCE((p_payload->>'length_cm')::numeric, 0));
  v_width_cm numeric(10,2) := GREATEST(0, COALESCE((p_payload->>'width_cm')::numeric, 0));
  v_height_cm numeric(10,2) := GREATEST(0, COALESCE((p_payload->>'height_cm')::numeric, 0));
  v_pieces_count integer := GREATEST(1, COALESCE((p_payload->>'pieces_count')::integer, 1));
  v_raw_balance numeric(14,2) := GREATEST(0, COALESCE((p_payload->>'prepaid_balance_amount')::numeric, 0));

  v_sender_name text := trim(COALESCE(p_payload->>'sender_name', ''));
  v_sender_gov_id uuid := (p_payload->>'sender_governorate_id')::uuid;
  v_sender_reg_id uuid := (p_payload->>'sender_region_id')::uuid;
  v_sender_phone text := NULLIF(trim(COALESCE(p_payload->>'sender_phone', '')), '');
  v_sender_mobile text := trim(COALESCE(p_payload->>'sender_mobile', ''));
  v_sender_address text := trim(COALESCE(p_payload->>'sender_address_line', ''));

  v_rec_name text := trim(COALESCE(p_payload->>'recipient_name', ''));
  v_rec_gov_id uuid := (p_payload->>'recipient_governorate_id')::uuid;
  v_rec_reg_id uuid := (p_payload->>'recipient_region_id')::uuid;
  v_rec_phone text := NULLIF(trim(COALESCE(p_payload->>'recipient_phone', '')), '');
  v_rec_mobile text := trim(COALESCE(p_payload->>'recipient_mobile', ''));
  v_rec_address text := trim(COALESCE(p_payload->>'recipient_address_line', ''));

  v_package_desc text := NULLIF(trim(COALESCE(p_payload->>'package_description', '')), '');
  v_external_ref text := NULLIF(trim(COALESCE(p_payload->>'external_reference', '')), '');
  v_notes text := NULLIF(trim(COALESCE(p_payload->>'notes', '')), '');
  v_allow_open boolean := COALESCE((p_payload->>'allow_package_opening')::boolean, false);
  v_pickup_date date := COALESCE(NULLIF(p_payload->>'pickup_date', '')::date, current_date);
  v_exchange_desc text := NULLIF(trim(COALESCE(p_payload->>'exchange_item_description', '')), '');

  v_override_fee numeric(12,2) := NULLIF(p_payload->>'override_total_fee', '')::numeric;
  v_override_reason text := NULLIF(trim(COALESCE(p_payload->>'override_reason', '')), '');

  v_membership public.tenant_memberships%ROWTYPE;
  v_bound_client_id uuid;
  v_client public.clients%ROWTYPE;
  v_shp_type public.shipment_types%ROWTYPE;
  v_pay_term public.payment_terms%ROWTYPE;
  v_dest_branch_id uuid;
  v_actor_name text;

  v_pricing_entered_amt numeric(14,2) := 0;
  v_breakdown jsonb;
  v_total_shipping_fee numeric(12,2);
  v_return_fee numeric(12,2);
  v_volumetric_weight numeric(10,3);
  v_chargeable_weight numeric(10,3);
  v_recipient_collect numeric(14,2);
  v_client_payout numeric(14,2);
  v_stored_entered_amt numeric(14,2);
  v_stored_prepaid_amt numeric(14,2);

  v_shipment_id uuid;
  v_shipment_number text;
  v_barcode_token text;
  v_tracking_token text;
  v_snapshot_id uuid;
BEGIN
  -- 1. Idempotency check first
  IF v_clean_idem IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.shipments
    WHERE tenant_id = p_tenant_id AND idempotency_key = v_clean_idem
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      SELECT token INTO v_existing_token
      FROM public.shipment_tracking_tokens
      WHERE tenant_id = p_tenant_id AND shipment_id = v_existing.id AND is_active = true
      ORDER BY created_at DESC LIMIT 1;

      RETURN jsonb_build_object(
        'shipment_id', v_existing.id,
        'shipment_number', v_existing.shipment_number,
        'barcode_token', v_existing.barcode_token,
        'tracking_token', v_existing_token,
        'already_existed', true
      );
    END IF;
  END IF;

  -- 2. Authorization & Client Subject Scoping
  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'shipments.create', v_origin_branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: shipments.create permission on origin branch required';
  END IF;

  SELECT * INTO v_membership
  FROM public.tenant_memberships
  WHERE tenant_id = p_tenant_id AND user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF v_membership.account_subject_type = 'client' THEN
    SELECT client_id INTO v_bound_client_id
    FROM public.account_subjects
    WHERE tenant_id = p_tenant_id AND membership_id = v_membership.id AND is_active = true;

    IF v_bound_client_id IS DISTINCT FROM v_client_id THEN
      RAISE EXCEPTION 'Forbidden: client users may only create shipments for their bound client account';
    END IF;
  END IF;

  -- 3. Validate Mandatory Master Records
  SELECT * INTO v_client FROM public.clients
  WHERE id = v_client_id AND tenant_id = p_tenant_id AND archived_at IS NULL AND is_active = true;
  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'العميل المحدد غير موجود أو غير نشط.';
  END IF;

  SELECT * INTO v_shp_type FROM public.shipment_types
  WHERE id = v_shipment_type_id AND tenant_id = p_tenant_id AND is_active = true;
  IF v_shp_type.id IS NULL THEN
    RAISE EXCEPTION 'نوع الطلب المحدد غير صالح.';
  END IF;

  SELECT * INTO v_pay_term FROM public.payment_terms
  WHERE id = v_payment_term_id AND tenant_id = p_tenant_id AND is_active = true;
  IF v_pay_term.id IS NULL THEN
    RAISE EXCEPTION 'نوع الدفع المحدد غير صالح.';
  END IF;

  IF char_length(v_sender_name) < 2 OR char_length(v_sender_mobile) < 4 OR char_length(v_sender_address) < 3 THEN
    RAISE EXCEPTION 'بيانات الراسل غير مكتملة (الاسم، الموبايل، العنوان).';
  END IF;

  IF char_length(v_rec_name) < 2 OR char_length(v_rec_mobile) < 4 OR char_length(v_rec_address) < 3 THEN
    RAISE EXCEPTION 'بيانات المرسل إليه غير مكتملة (الاسم، الموبايل، العنوان).';
  END IF;

  IF v_shp_type.code = 'PTP' AND v_exchange_desc IS NULL THEN
    RAISE EXCEPTION 'يجب إدخال وصف طرد الاستبدال المرتجع عند اختيار نوع الطلب PTP (ADR-014).';
  END IF;

  IF v_override_fee IS NOT NULL THEN
    IF NOT (
      app_private.current_user_is_platform_super_admin()
      OR app_private.user_is_tenant_admin(p_tenant_id)
      OR app_private.user_has_permission(p_tenant_id, 'pricing.override', NULL)
    ) THEN
      RAISE EXCEPTION 'Forbidden: pricing.override permission required for manual fee override';
    END IF;
    IF char_length(COALESCE(v_override_reason, '')) < 3 THEN
      RAISE EXCEPTION 'Override reason is required when manually setting shipping fee';
    END IF;
  END IF;

  -- Resolve destination branch from region or governorate default
  SELECT COALESCE(r.default_branch_id, g.default_branch_id, v_origin_branch_id)
  INTO v_dest_branch_id
  FROM public.regions r
  JOIN public.governorates g ON g.id = r.governorate_id AND g.tenant_id = r.tenant_id
  WHERE r.tenant_id = p_tenant_id AND r.id = v_rec_reg_id;

  -- 4. Authoritative Server-Side Pricing Engine (ADR-007..011 & ADR-013)
  -- Collection fees apply strictly on COD amount; PREPAID/POSTPAID/CASH_PAID pass 0 to engine.
  v_pricing_entered_amt := CASE WHEN v_pay_term.code = 'COD' THEN v_raw_balance ELSE 0 END;

  v_breakdown := public.calculate_shipment_price(
    p_tenant_id,
    v_client_id,
    v_service_id,
    v_sender_gov_id,
    v_sender_reg_id,
    v_rec_gov_id,
    v_rec_reg_id,
    v_actual_weight,
    v_length_cm,
    v_width_cm,
    v_height_cm,
    v_pricing_entered_amt,
    v_price_mode,
    v_override_fee,
    v_override_reason,
    false
  );

  v_total_shipping_fee := (v_breakdown->>'total_shipping_fee')::numeric;
  v_return_fee := (v_breakdown->>'return_fee')::numeric;
  v_volumetric_weight := (v_breakdown->>'volumetric_weight_kg')::numeric;
  v_chargeable_weight := (v_breakdown->>'chargeable_weight_kg')::numeric;

  -- ADR-013 Financial Effect per Payment Term
  IF v_pay_term.code = 'COD' THEN
    v_stored_entered_amt := v_raw_balance;
    v_stored_prepaid_amt := v_raw_balance;
    v_recipient_collect := (v_breakdown->>'recipient_collect_amount')::numeric;
    v_client_payout := (v_breakdown->>'client_net_payout')::numeric;
  ELSIF v_pay_term.code = 'PREPAID' THEN
    v_stored_entered_amt := 0;
    v_stored_prepaid_amt := v_raw_balance;
    v_recipient_collect := 0;
    v_client_payout := 0;
  ELSIF v_pay_term.code = 'POSTPAID' THEN
    v_stored_entered_amt := 0;
    v_stored_prepaid_amt := 0;
    v_recipient_collect := 0;
    v_client_payout := ROUND(0 - v_total_shipping_fee, 2);
  ELSE -- CASH_PAID
    v_stored_entered_amt := 0;
    v_stored_prepaid_amt := 0;
    v_recipient_collect := 0;
    v_client_payout := 0;
  END IF;

  -- 5. Atomic Sequential Numbering & Non-Guessable Tokens
  v_shipment_number := app_private.next_document_number(p_tenant_id, 'shipments');
  v_barcode_token := 'SFB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 14));
  v_tracking_token := lower(replace(gen_random_uuid()::text || substr(gen_random_uuid()::text, 1, 8), '-', ''));

  SELECT COALESCE(p.display_name, v_membership.username, 'مستخدم النظام')
  INTO v_actor_name
  FROM public.profiles p
  WHERE p.id = auth.uid();

  PERFORM set_config('app_private.allow_shipment_mutation', 'on', true);

  INSERT INTO public.shipments (
    tenant_id, idempotency_key, shipment_number, barcode_token,
    client_id, origin_branch_id, current_branch_id, destination_branch_id,
    movement_type_id, shipment_type_id, shipment_type_code, service_id,
    payment_term_id, payment_term_code, price_mode, operational_status,
    is_created_confirmed, is_collected_from_courier, is_settled_to_client, is_courier_commission_paid,
    entered_amount, prepaid_balance_amount, total_shipping_fee, return_fee,
    recipient_collect_amount, client_net_payout,
    pieces_count, delivered_pieces_count, returned_pieces_count,
    partial_return_custody, exchange_status,
    actual_weight_kg, chargeable_weight_kg, allow_package_opening,
    package_description, external_reference, notes, pickup_date,
    sender_governorate_id, sender_region_id, recipient_governorate_id, recipient_region_id,
    created_by, updated_by
  )
  VALUES (
    p_tenant_id, v_clean_idem, v_shipment_number, v_barcode_token,
    v_client_id, v_origin_branch_id, v_origin_branch_id, v_dest_branch_id,
    v_movement_type_id, v_shipment_type_id, v_shp_type.code, v_service_id,
    v_payment_term_id, v_pay_term.code, v_price_mode, 'created',
    true, false, false, false,
    v_stored_entered_amt, v_stored_prepaid_amt, v_total_shipping_fee, v_return_fee,
    v_recipient_collect, v_client_payout,
    v_pieces_count, 0, 0,
    'none', CASE WHEN v_shp_type.code = 'PTP' THEN 'pending_exchange' ELSE 'none' END,
    v_actual_weight, v_chargeable_weight, v_allow_open,
    v_package_desc, v_external_ref, v_notes, v_pickup_date,
    v_sender_gov_id, v_sender_reg_id, v_rec_gov_id, v_rec_reg_id,
    auth.uid(), auth.uid()
  )
  RETURNING id INTO v_shipment_id;

  -- 6. Insert Immutable Initial Price Snapshot (v1) bound directly to v_shipment_id
  INSERT INTO public.shipment_price_snapshots (
    tenant_id, shipment_id, version_number, client_id, price_list_id, price_list_version_id,
    service_id, pickup_rule_id, delivery_rule_id, tax_profile_id,
    actual_weight_kg, length_cm, width_cm, height_cm, volumetric_divisor,
    volumetric_weight_kg, chargeable_weight_kg, rounding_rule,
    price_mode, entered_amount, base_delivery_fee, extra_weight_fee, collection_fee,
    surcharges_total, exemptions_total, tax_mode, tax_rate_percent, tax_amount,
    total_shipping_fee, return_fee, recipient_collect_amount, client_net_payout,
    is_manual_override, override_reason, calculation_breakdown, engine_version, created_by
  )
  VALUES (
    p_tenant_id,
    v_shipment_id,
    1,
    v_client_id,
    (v_breakdown->>'price_list_id')::uuid,
    (v_breakdown->>'price_list_version_id')::uuid,
    v_service_id,
    NULLIF(v_breakdown->>'pickup_rule_id', '')::uuid,
    NULLIF(v_breakdown->>'delivery_rule_id', '')::uuid,
    v_client.tax_profile_id,
    v_actual_weight,
    v_length_cm,
    v_width_cm,
    v_height_cm,
    (v_breakdown->>'volumetric_divisor')::numeric,
    v_volumetric_weight,
    v_chargeable_weight,
    v_breakdown->>'rounding_rule',
    v_price_mode,
    v_stored_entered_amt,
    (v_breakdown->>'base_delivery_fee')::numeric,
    (v_breakdown->>'extra_weight_fee')::numeric,
    (v_breakdown->>'collection_fee')::numeric,
    (v_breakdown->>'surcharges_total')::numeric,
    (v_breakdown->>'exemptions_total')::numeric,
    v_breakdown->>'tax_mode',
    (v_breakdown->>'tax_rate_percent')::numeric,
    (v_breakdown->>'tax_amount')::numeric,
    v_total_shipping_fee,
    v_return_fee,
    v_recipient_collect,
    v_client_payout,
    (v_breakdown->>'is_manual_override')::boolean,
    v_override_reason,
    v_breakdown || jsonb_build_object(
      'payment_term_code', v_pay_term.code,
      'prepaid_balance_amount', v_stored_prepaid_amt,
      'effective_recipient_collect', v_recipient_collect,
      'effective_client_net_payout', v_client_payout
    ),
    'v6.0',
    auth.uid()
  )
  RETURNING id INTO v_snapshot_id;

  UPDATE public.shipments
  SET current_snapshot_id = v_snapshot_id
  WHERE id = v_shipment_id;

  PERFORM set_config('app_private.allow_shipment_mutation', 'off', true);

  -- 7. Parties, Packages, Dimensions, Token, Relations, Reference & Initial Event
  INSERT INTO public.shipment_parties (
    tenant_id, shipment_id, party_type, name, phone, mobile, governorate_id, region_id, address_line
  )
  VALUES
    (p_tenant_id, v_shipment_id, 'sender', v_sender_name, v_sender_phone, v_sender_mobile, v_sender_gov_id, v_sender_reg_id, v_sender_address),
    (p_tenant_id, v_shipment_id, 'recipient', v_rec_name, v_rec_phone, v_rec_mobile, v_rec_gov_id, v_rec_reg_id, v_rec_address);

  INSERT INTO public.shipment_packages (
    tenant_id, shipment_id, package_index, description, pieces_count, weight_kg, declared_value, barcode
  )
  VALUES (
    p_tenant_id, v_shipment_id, 1, COALESCE(v_package_desc, 'طرد قياسي'), v_pieces_count, v_actual_weight, v_raw_balance, v_barcode_token
  );

  INSERT INTO public.shipment_dimensions (
    tenant_id, shipment_id, snapshot_id, version_number,
    actual_weight_kg, length_cm, width_cm, height_cm,
    volumetric_divisor, volumetric_weight_kg, chargeable_weight_kg,
    reason, recorded_by
  )
  VALUES (
    p_tenant_id, v_shipment_id, v_snapshot_id, 1,
    v_actual_weight, v_length_cm, v_width_cm, v_height_cm,
    (v_breakdown->>'volumetric_divisor')::numeric, v_volumetric_weight, v_chargeable_weight,
    'القياسات الابتدائية عند إنشاء الشحنة', auth.uid()
  );

  INSERT INTO public.shipment_tracking_tokens (tenant_id, shipment_id, token, is_active)
  VALUES (p_tenant_id, v_shipment_id, v_tracking_token, true);

  IF v_shp_type.code = 'PTP' THEN
    INSERT INTO public.shipment_relations (
      tenant_id, shipment_id, relation_type, exchange_item_description, custody_status, notes, created_by
    )
    VALUES (
      p_tenant_id, v_shipment_id, 'ptp_exchange_return', v_exchange_desc, 'pending',
      'التزام استلام طرد الاستبدال من المستلم وإعادته للراسل (ADR-014)', auth.uid()
    );
  END IF;

  IF v_external_ref IS NOT NULL THEN
    INSERT INTO public.shipment_reference_numbers (tenant_id, shipment_id, ref_type, ref_value)
    VALUES (p_tenant_id, v_shipment_id, 'merchant_order', v_external_ref);
  END IF;

  IF v_notes IS NOT NULL THEN
    INSERT INTO public.shipment_notes (tenant_id, shipment_id, note_type, body, created_by, created_by_name)
    VALUES (p_tenant_id, v_shipment_id, 'internal', v_notes, auth.uid(), v_actor_name);
  END IF;

  INSERT INTO public.shipment_status_events (
    tenant_id, shipment_id, event_code, from_status, to_status,
    branch_id, movement_type_id, fees_snapshot, notes, actor_user_id, actor_display_name
  )
  VALUES (
    p_tenant_id, v_shipment_id, 'shipment.created', NULL, 'created',
    v_origin_branch_id, v_movement_type_id, v_total_shipping_fee,
    'طلب شحن جديد - ' || v_shp_type.code || ' (' || v_pay_term.code || ')',
    auth.uid(), v_actor_name
  );

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id,
    auth.uid(),
    'shipment.created',
    'shipments',
    v_shipment_id,
    jsonb_build_object(
      'shipment_number', v_shipment_number,
      'barcode_token', v_barcode_token,
      'payment_term_code', v_pay_term.code,
      'shipment_type_code', v_shp_type.code,
      'total_shipping_fee', v_total_shipping_fee,
      'recipient_collect_amount', v_recipient_collect
    ),
    'rpc'
  );

  RETURN jsonb_build_object(
    'shipment_id', v_shipment_id,
    'shipment_number', v_shipment_number,
    'barcode_token', v_barcode_token,
    'tracking_token', v_tracking_token,
    'snapshot_id', v_snapshot_id,
    'already_existed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_shipment(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_shipment(uuid, text, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Server-Side RPC: Authoritative Lifecycle Status Transition (incl. PDP/PTP)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transition_shipment_status(
  p_tenant_id uuid,
  p_shipment_id uuid,
  p_to_status text,
  p_notes text DEFAULT NULL,
  p_exception_reason_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_courier_id uuid DEFAULT NULL,
  p_delivered_pieces integer DEFAULT NULL,
  p_delivered_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_shp public.shipments%ROWTYPE;
  v_from text;
  v_allowed boolean := false;
  v_new_branch_id uuid;
  v_new_courier_id uuid;
  v_delivered_pcs integer;
  v_returned_pcs integer;
  v_partial_custody text;
  v_exchange_status text;
  v_delivered_amt numeric(14,2);
  v_actor_name text;
  v_reason_name text;
BEGIN
  SELECT * INTO v_shp
  FROM public.shipments
  WHERE id = p_shipment_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_shp.id IS NULL THEN
    RAISE EXCEPTION 'الشحنة غير موجودة.';
  END IF;

  v_from := v_shp.operational_status;
  v_new_branch_id := COALESCE(p_branch_id, v_shp.current_branch_id);
  v_new_courier_id := COALESCE(p_courier_id, v_shp.assigned_courier_id);
  v_delivered_pcs := v_shp.delivered_pieces_count;
  v_returned_pcs := v_shp.returned_pieces_count;
  v_partial_custody := v_shp.partial_return_custody;
  v_exchange_status := v_shp.exchange_status;
  v_delivered_amt := v_shp.delivered_amount;

  -- Permission checks based on action type
  IF p_to_status = 'cancelled' THEN
    IF NOT (
      app_private.current_user_is_platform_super_admin()
      OR app_private.user_is_tenant_admin(p_tenant_id)
      OR app_private.user_has_permission(p_tenant_id, 'shipments.cancel', v_shp.current_branch_id)
    ) THEN
      RAISE EXCEPTION 'Forbidden: shipments.cancel permission required';
    END IF;
  ELSIF p_to_status IN ('out_for_delivery', 'delivered', 'partially_delivered', 'delivery_failed', 'rescheduled') THEN
    IF NOT (
      app_private.current_user_is_platform_super_admin()
      OR app_private.user_is_tenant_admin(p_tenant_id)
      OR app_private.user_has_permission(p_tenant_id, 'operations.delivery.execute', v_shp.current_branch_id)
      OR app_private.user_has_permission(p_tenant_id, 'operations.pickup.approve', v_shp.current_branch_id)
      OR app_private.user_has_permission(p_tenant_id, 'shipments.update_draft', v_shp.current_branch_id)
    ) THEN
      RAISE EXCEPTION 'Forbidden: delivery execution or operations permission required';
    END IF;
  ELSE
    IF NOT (
      app_private.current_user_is_platform_super_admin()
      OR app_private.user_is_tenant_admin(p_tenant_id)
      OR app_private.user_has_permission(p_tenant_id, 'operations.pickup.approve', v_shp.current_branch_id)
      OR app_private.user_has_permission(p_tenant_id, 'shipments.update_draft', v_shp.current_branch_id)
    ) THEN
      RAISE EXCEPTION 'Forbidden: operations or shipments permission required';
    END IF;
  END IF;

  -- Strict State Machine Validation
  v_allowed := CASE v_from
    WHEN 'created' THEN p_to_status IN ('pickup_scheduled', 'picked_up', 'in_warehouse', 'cancelled')
    WHEN 'pickup_scheduled' THEN p_to_status IN ('picked_up', 'in_warehouse', 'cancelled')
    WHEN 'picked_up' THEN p_to_status IN ('in_warehouse', 'in_transit_branch', 'out_for_delivery', 'cancelled')
    WHEN 'in_warehouse' THEN p_to_status IN ('in_transit_branch', 'out_for_delivery', 'return_to_sender', 'cancelled')
    WHEN 'in_transit_branch' THEN p_to_status IN ('in_warehouse', 'out_for_delivery', 'return_to_sender')
    WHEN 'out_for_delivery' THEN p_to_status IN ('delivered', 'partially_delivered', 'delivery_failed', 'rescheduled', 'return_to_sender', 'in_warehouse')
    WHEN 'delivery_failed' THEN p_to_status IN ('rescheduled', 'in_warehouse', 'out_for_delivery', 'return_to_sender')
    WHEN 'rescheduled' THEN p_to_status IN ('out_for_delivery', 'in_warehouse', 'delivered', 'partially_delivered', 'delivery_failed', 'return_to_sender')
    WHEN 'partially_delivered' THEN p_to_status IN ('return_to_sender', 'returned')
    WHEN 'return_to_sender' THEN p_to_status IN ('in_warehouse', 'returned')
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'انتقال الحالة غير مسموح من (%) إلى (%).', v_from, p_to_status;
  END IF;

  IF p_to_status IN ('delivery_failed', 'return_to_sender', 'cancelled') AND p_exception_reason_id IS NULL AND char_length(trim(COALESCE(p_notes, ''))) < 3 THEN
    RAISE EXCEPTION 'يجب تحديد سبب أو ملاحظة واضحة عند الإلغاء أو التعذر أو الإرجاع.';
  END IF;

  -- ADR-014 PDP Partial Delivery Validation
  IF p_to_status = 'partially_delivered' THEN
    IF v_shp.pieces_count < 2 THEN
      RAISE EXCEPTION 'التسليم الجزئي يتطلب أن تكون الشحنة أكثر من قطعة واحدة، أو استخدم الإجراء الإداري لتسوية القطع.';
    END IF;
    v_delivered_pcs := COALESCE(p_delivered_pieces, 1);
    IF v_delivered_pcs <= 0 OR v_delivered_pcs >= v_shp.pieces_count THEN
      RAISE EXCEPTION 'عدد القطع المسلمة جزئيًا يجب أن يكون بين 1 و (%).', v_shp.pieces_count - 1;
    END IF;
    v_returned_pcs := v_shp.pieces_count - v_delivered_pcs;
    v_partial_custody := 'with_courier';
    v_delivered_amt := COALESCE(p_delivered_amount, v_shp.recipient_collect_amount);
  ELSIF p_to_status = 'delivered' THEN
    v_delivered_pcs := v_shp.pieces_count;
    v_returned_pcs := 0;
    v_delivered_amt := COALESCE(p_delivered_amount, v_shp.recipient_collect_amount);
    IF v_shp.shipment_type_code = 'PTP' THEN
      v_exchange_status := 'with_courier';
      UPDATE public.shipment_relations
      SET custody_status = 'with_courier'
      WHERE tenant_id = p_tenant_id AND shipment_id = p_shipment_id AND relation_type = 'ptp_exchange_return';
    END IF;
  ELSIF p_to_status = 'return_to_sender' THEN
    IF v_partial_custody = 'with_courier' THEN
      v_partial_custody := 'in_warehouse';
    END IF;
  ELSIF p_to_status = 'returned' THEN
    IF v_from = 'partially_delivered' OR v_partial_custody IN ('with_courier', 'in_warehouse') THEN
      v_partial_custody := 'returned_to_client';
    END IF;
    IF v_shp.shipment_type_code = 'PTP' THEN
      v_exchange_status := 'returned_to_client';
      UPDATE public.shipment_relations
      SET custody_status = 'returned_to_client'
      WHERE tenant_id = p_tenant_id AND shipment_id = p_shipment_id AND relation_type = 'ptp_exchange_return';
    END IF;
  END IF;

  SELECT COALESCE(p.display_name, 'مستخدم النظام') INTO v_actor_name
  FROM public.profiles p WHERE p.id = auth.uid();

  IF p_exception_reason_id IS NOT NULL THEN
    SELECT name INTO v_reason_name FROM public.delivery_exception_reasons
    WHERE tenant_id = p_tenant_id AND id = p_exception_reason_id;
  END IF;

  PERFORM set_config('app_private.allow_shipment_mutation', 'on', true);

  UPDATE public.shipments
  SET operational_status = p_to_status,
      current_branch_id = v_new_branch_id,
      assigned_courier_id = v_new_courier_id,
      delivered_pieces_count = v_delivered_pcs,
      returned_pieces_count = v_returned_pcs,
      partial_return_custody = v_partial_custody,
      exchange_status = v_exchange_status,
      delivered_amount = v_delivered_amt,
      delivery_attempts_count = CASE
        WHEN p_to_status IN ('delivery_failed', 'delivered', 'partially_delivered')
        THEN delivery_attempts_count + 1
        ELSE delivery_attempts_count
      END,
      last_exception_reason_id = COALESCE(p_exception_reason_id, last_exception_reason_id),
      delivered_at = CASE WHEN p_to_status IN ('delivered', 'partially_delivered') THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
      returned_at = CASE WHEN p_to_status = 'returned' THEN now() ELSE returned_at END,
      cancelled_at = CASE WHEN p_to_status = 'cancelled' THEN now() ELSE cancelled_at END,
      updated_by = auth.uid()
  WHERE id = p_shipment_id;

  PERFORM set_config('app_private.allow_shipment_mutation', 'off', true);

  INSERT INTO public.shipment_status_events (
    tenant_id, shipment_id, event_code, from_status, to_status,
    branch_id, courier_id, exception_reason_id, delivered_amount,
    fees_snapshot, notes, actor_user_id, actor_display_name
  )
  VALUES (
    p_tenant_id, p_shipment_id, 'status.' || p_to_status, v_from, p_to_status,
    v_new_branch_id, v_new_courier_id, p_exception_reason_id, v_delivered_amt,
    v_shp.total_shipping_fee,
    COALESCE(NULLIF(trim(COALESCE(p_notes, '')), ''), v_reason_name),
    auth.uid(), v_actor_name
  );

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'shipment.status_changed', 'shipments', p_shipment_id,
    jsonb_build_object('status', v_from),
    jsonb_build_object('status', p_to_status, 'delivered_pieces', v_delivered_pcs, 'returned_pieces', v_returned_pcs, 'delivered_amount', v_delivered_amt),
    'rpc'
  );

  RETURN jsonb_build_object(
    'shipment_id', p_shipment_id,
    'from_status', v_from,
    'to_status', p_to_status,
    'partial_return_custody', v_partial_custody,
    'exchange_status', v_exchange_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transition_shipment_status(uuid, uuid, text, text, uuid, uuid, uuid, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_shipment_status(uuid, uuid, text, text, uuid, uuid, uuid, integer, numeric) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Server-Side RPC: Weight/Dimension Revision & Manual Override (ADR-010)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reprice_shipment_weight_or_override(
  p_tenant_id uuid,
  p_shipment_id uuid,
  p_actual_weight_kg numeric,
  p_length_cm numeric DEFAULT 0,
  p_width_cm numeric DEFAULT 0,
  p_height_cm numeric DEFAULT 0,
  p_override_total_fee numeric DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_shp public.shipments%ROWTYPE;
  v_client public.clients%ROWTYPE;
  v_clean_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_next_ver integer;
  v_pricing_entered_amt numeric(14,2);
  v_breakdown jsonb;
  v_total_fee numeric(12,2);
  v_return_fee numeric(12,2);
  v_volumetric numeric(10,3);
  v_chargeable numeric(10,3);
  v_recipient_collect numeric(14,2);
  v_client_payout numeric(14,2);
  v_snapshot_id uuid;
  v_actor_name text;
BEGIN
  SELECT * INTO v_shp
  FROM public.shipments
  WHERE id = p_shipment_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_shp.id IS NULL THEN
    RAISE EXCEPTION 'الشحنة غير موجودة.';
  END IF;

  IF v_shp.operational_status IN ('out_for_delivery', 'delivered', 'partially_delivered', 'returned', 'cancelled') THEN
    RAISE EXCEPTION 'لا يمكن تعديل الوزن أو السعر بعد خروج الشحنة للتوصيل أو إغلاقها (ADR-010).';
  END IF;

  IF v_clean_reason IS NULL OR char_length(v_clean_reason) < 3 THEN
    RAISE EXCEPTION 'يجب ذكر سبب التعديل لتوثيق لقطة السعر الجديدة وسجل التدقيق (ADR-010).';
  END IF;

  IF p_override_total_fee IS NOT NULL THEN
    IF NOT (
      app_private.current_user_is_platform_super_admin()
      OR app_private.user_is_tenant_admin(p_tenant_id)
      OR app_private.user_has_permission(p_tenant_id, 'pricing.override', NULL)
    ) THEN
      RAISE EXCEPTION 'Forbidden: pricing.override permission required for manual override';
    END IF;
  ELSE
    IF NOT (
      app_private.current_user_is_platform_super_admin()
      OR app_private.user_is_tenant_admin(p_tenant_id)
      OR app_private.user_has_permission(p_tenant_id, 'shipments.update_draft', v_shp.current_branch_id)
      OR app_private.user_has_permission(p_tenant_id, 'operations.pickup.approve', v_shp.current_branch_id)
    ) THEN
      RAISE EXCEPTION 'Forbidden: warehouse or shipments.update_draft permission required';
    END IF;
  END IF;

  SELECT * INTO v_client FROM public.clients WHERE id = v_shp.client_id AND tenant_id = p_tenant_id;

  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next_ver
  FROM public.shipment_price_snapshots
  WHERE tenant_id = p_tenant_id AND shipment_id = p_shipment_id;

  v_pricing_entered_amt := CASE WHEN v_shp.payment_term_code = 'COD' THEN v_shp.entered_amount ELSE 0 END;

  -- Compute core engine fees first without override so we bypass 0004's narrower admin-only check when user has pricing.override
  v_breakdown := public.calculate_shipment_price(
    p_tenant_id,
    v_shp.client_id,
    v_shp.service_id,
    v_shp.sender_governorate_id,
    v_shp.sender_region_id,
    v_shp.recipient_governorate_id,
    v_shp.recipient_region_id,
    p_actual_weight_kg,
    COALESCE(p_length_cm, 0),
    COALESCE(p_width_cm, 0),
    COALESCE(p_height_cm, 0),
    v_pricing_entered_amt,
    v_shp.price_mode,
    NULL,
    NULL,
    false
  );

  v_total_fee := CASE
    WHEN p_override_total_fee IS NOT NULL THEN ROUND(GREATEST(0, p_override_total_fee), 2)
    ELSE (v_breakdown->>'total_shipping_fee')::numeric
  END;
  v_return_fee := (v_breakdown->>'return_fee')::numeric;
  v_volumetric := (v_breakdown->>'volumetric_weight_kg')::numeric;
  v_chargeable := (v_breakdown->>'chargeable_weight_kg')::numeric;

  IF v_shp.payment_term_code = 'COD' THEN
    IF v_shp.price_mode = 'shipping_included' THEN
      v_recipient_collect := ROUND(v_shp.entered_amount, 2);
      v_client_payout := ROUND(v_shp.entered_amount - v_total_fee, 2);
    ELSE
      v_client_payout := ROUND(v_shp.entered_amount, 2);
      v_recipient_collect := ROUND(v_shp.entered_amount + v_total_fee, 2);
    END IF;
  ELSIF v_shp.payment_term_code = 'POSTPAID' THEN
    v_recipient_collect := 0;
    v_client_payout := ROUND(0 - v_total_fee, 2);
  ELSE
    v_recipient_collect := 0;
    v_client_payout := 0;
  END IF;

  INSERT INTO public.shipment_price_snapshots (
    tenant_id, shipment_id, version_number, client_id, price_list_id, price_list_version_id,
    service_id, pickup_rule_id, delivery_rule_id, tax_profile_id,
    actual_weight_kg, length_cm, width_cm, height_cm, volumetric_divisor,
    volumetric_weight_kg, chargeable_weight_kg, rounding_rule,
    price_mode, entered_amount, base_delivery_fee, extra_weight_fee, collection_fee,
    surcharges_total, exemptions_total, tax_mode, tax_rate_percent, tax_amount,
    total_shipping_fee, return_fee, recipient_collect_amount, client_net_payout,
    is_manual_override, override_reason, calculation_breakdown, engine_version, created_by
  )
  VALUES (
    p_tenant_id, p_shipment_id, v_next_ver, v_shp.client_id,
    (v_breakdown->>'price_list_id')::uuid,
    (v_breakdown->>'price_list_version_id')::uuid,
    v_shp.service_id,
    NULLIF(v_breakdown->>'pickup_rule_id', '')::uuid,
    NULLIF(v_breakdown->>'delivery_rule_id', '')::uuid,
    v_client.tax_profile_id,
    GREATEST(0, p_actual_weight_kg),
    GREATEST(0, COALESCE(p_length_cm, 0)),
    GREATEST(0, COALESCE(p_width_cm, 0)),
    GREATEST(0, COALESCE(p_height_cm, 0)),
    (v_breakdown->>'volumetric_divisor')::numeric,
    v_volumetric,
    v_chargeable,
    v_breakdown->>'rounding_rule',
    v_shp.price_mode,
    v_shp.entered_amount,
    (v_breakdown->>'base_delivery_fee')::numeric,
    (v_breakdown->>'extra_weight_fee')::numeric,
    (v_breakdown->>'collection_fee')::numeric,
    (v_breakdown->>'surcharges_total')::numeric,
    (v_breakdown->>'exemptions_total')::numeric,
    v_breakdown->>'tax_mode',
    (v_breakdown->>'tax_rate_percent')::numeric,
    (v_breakdown->>'tax_amount')::numeric,
    v_total_fee,
    v_return_fee,
    v_recipient_collect,
    v_client_payout,
    p_override_total_fee IS NOT NULL,
    v_clean_reason,
    v_breakdown || jsonb_build_object(
      'is_manual_override', p_override_total_fee IS NOT NULL,
      'override_reason', v_clean_reason,
      'total_shipping_fee', v_total_fee,
      'recipient_collect_amount', v_recipient_collect,
      'client_net_payout', v_client_payout
    ),
    'v6.0',
    auth.uid()
  )
  RETURNING id INTO v_snapshot_id;

  INSERT INTO public.shipment_dimensions (
    tenant_id, shipment_id, snapshot_id, version_number,
    actual_weight_kg, length_cm, width_cm, height_cm,
    volumetric_divisor, volumetric_weight_kg, chargeable_weight_kg,
    reason, recorded_by
  )
  VALUES (
    p_tenant_id, p_shipment_id, v_snapshot_id, v_next_ver,
    GREATEST(0, p_actual_weight_kg), GREATEST(0, COALESCE(p_length_cm, 0)),
    GREATEST(0, COALESCE(p_width_cm, 0)), GREATEST(0, COALESCE(p_height_cm, 0)),
    (v_breakdown->>'volumetric_divisor')::numeric, v_volumetric, v_chargeable,
    v_clean_reason, auth.uid()
  );

  PERFORM set_config('app_private.allow_shipment_mutation', 'on', true);

  UPDATE public.shipments
  SET current_snapshot_id = v_snapshot_id,
      actual_weight_kg = GREATEST(0, p_actual_weight_kg),
      chargeable_weight_kg = v_chargeable,
      total_shipping_fee = v_total_fee,
      return_fee = v_return_fee,
      recipient_collect_amount = v_recipient_collect,
      client_net_payout = v_client_payout,
      updated_by = auth.uid()
  WHERE id = p_shipment_id;

  PERFORM set_config('app_private.allow_shipment_mutation', 'off', true);

  SELECT COALESCE(p.display_name, 'مستخدم النظام') INTO v_actor_name
  FROM public.profiles p WHERE p.id = auth.uid();

  INSERT INTO public.shipment_status_events (
    tenant_id, shipment_id, event_code, from_status, to_status,
    branch_id, fees_snapshot, notes, actor_user_id, actor_display_name
  )
  VALUES (
    p_tenant_id, p_shipment_id,
    CASE WHEN p_override_total_fee IS NOT NULL THEN 'pricing.manual_override' ELSE 'pricing.weight_revised' END,
    v_shp.operational_status, v_shp.operational_status,
    v_shp.current_branch_id, v_total_fee,
    'تحديث التسعير (إصدار ' || v_next_ver || '): ' || v_clean_reason,
    auth.uid(), v_actor_name
  );

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'shipment.repriced', 'shipments', p_shipment_id,
    jsonb_build_object('actual_weight_kg', v_shp.actual_weight_kg, 'total_shipping_fee', v_shp.total_shipping_fee),
    jsonb_build_object('snapshot_version', v_next_ver, 'actual_weight_kg', p_actual_weight_kg, 'chargeable_weight_kg', v_chargeable, 'total_shipping_fee', v_total_fee, 'reason', v_clean_reason),
    'rpc'
  );

  RETURN jsonb_build_object(
    'snapshot_id', v_snapshot_id,
    'version_number', v_next_ver,
    'chargeable_weight_kg', v_chargeable,
    'total_shipping_fee', v_total_fee,
    'recipient_collect_amount', v_recipient_collect,
    'client_net_payout', v_client_payout
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reprice_shipment_weight_or_override(uuid, uuid, numeric, numeric, numeric, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reprice_shipment_weight_or_override(uuid, uuid, numeric, numeric, numeric, numeric, numeric, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Sanitized Public Non-PII Tracking RPC (anon & authenticated)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.track_public_shipment(
  p_tenant_slug text,
  p_query text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_clean_slug text := lower(trim(COALESCE(p_tenant_slug, '')));
  v_clean_q text := trim(COALESCE(p_query, ''));
  v_tenant public.tenants%ROWTYPE;
  v_shp public.shipments%ROWTYPE;
  v_origin_gov text;
  v_origin_reg text;
  v_dest_gov text;
  v_dest_reg text;
  v_service_name text;
  v_type_name text;
  v_events jsonb;
BEGIN
  IF char_length(v_clean_slug) < 2 OR char_length(v_clean_q) < 4 THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT * INTO v_tenant
  FROM public.tenants
  WHERE slug = v_clean_slug AND status = 'active'
  LIMIT 1;

  IF v_tenant.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT s.* INTO v_shp
  FROM public.shipments s
  LEFT JOIN public.shipment_tracking_tokens t
    ON t.tenant_id = s.tenant_id AND t.shipment_id = s.id AND t.is_active = true
  WHERE s.tenant_id = v_tenant.id
    AND (
      upper(s.shipment_number) = upper(v_clean_q)
      OR upper(s.barcode_token) = upper(v_clean_q)
      OR lower(t.token) = lower(v_clean_q)
    )
  LIMIT 1;

  IF v_shp.id IS NULL THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  SELECT g.name, r.name INTO v_origin_gov, v_origin_reg
  FROM public.governorates g
  JOIN public.regions r ON r.id = v_shp.sender_region_id AND r.tenant_id = g.tenant_id
  WHERE g.tenant_id = v_tenant.id AND g.id = v_shp.sender_governorate_id;

  SELECT g.name, r.name INTO v_dest_gov, v_dest_reg
  FROM public.governorates g
  JOIN public.regions r ON r.id = v_shp.recipient_region_id AND r.tenant_id = g.tenant_id
  WHERE g.tenant_id = v_tenant.id AND g.id = v_shp.recipient_governorate_id;

  SELECT name INTO v_service_name FROM public.shipping_services WHERE id = v_shp.service_id AND tenant_id = v_tenant.id;
  SELECT name INTO v_type_name FROM public.shipment_types WHERE id = v_shp.shipment_type_id AND tenant_id = v_tenant.id;

  -- Sanitize events: omit actor names, monetary amounts, courier PII, or internal notes
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'event_code', e.event_code,
        'to_status', e.to_status,
        'branch_name', b.name,
        'created_at', e.created_at
      )
      ORDER BY e.created_at ASC
    ),
    '[]'::jsonb
  )
  INTO v_events
  FROM public.shipment_status_events e
  LEFT JOIN public.branches b ON b.id = e.branch_id AND b.tenant_id = e.tenant_id
  WHERE e.tenant_id = v_tenant.id
    AND e.shipment_id = v_shp.id
    AND e.event_code NOT LIKE 'pricing.%';

  RETURN jsonb_build_object(
    'found', true,
    'tenant_name', v_tenant.name,
    'shipment_number', v_shp.shipment_number,
    'operational_status', v_shp.operational_status,
    'service_name', v_service_name,
    'shipment_type_name', v_type_name,
    'pieces_count', v_shp.pieces_count,
    'origin_label', COALESCE(v_origin_gov, '') || ' · ' || COALESCE(v_origin_reg, ''),
    'destination_label', COALESCE(v_dest_gov, '') || ' · ' || COALESCE(v_dest_reg, ''),
    'created_at', v_shp.created_at,
    'delivered_at', v_shp.delivered_at,
    'events', v_events
  );
END;
$$;

REVOKE ALL ON FUNCTION public.track_public_shipment(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_public_shipment(text, text) TO anon, authenticated;
