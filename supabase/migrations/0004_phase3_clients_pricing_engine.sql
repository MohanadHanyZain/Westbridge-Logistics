-- ============================================================================
-- Migration 0004: Phase 3 - Clients, Price Lists & Server-Side Pricing Engine
-- ============================================================================
-- Implements approved decisions:
-- - ADR-007 (OQ-01): Volumetric weight (L*W*H / divisor, default 5000),
--   chargeable = GREATEST(actual, volumetric), CEIL(1kg) default rounding.
-- - ADR-008 (OQ-02): Pickup-linked Delivery Rules with 4-level hierarchical
--   region/governorate fallback.
-- - ADR-009 (OQ-03): Tax profiles (none default, exclusive, inclusive) applied
--   strictly to shipping/service fees, never COD goods principal.
-- - ADR-010 (OQ-04): Immutable versioned shipment_price_snapshots + audit-logged
--   weight/dimension re-snapshotting & admin-only override_price.
-- - ADR-011 (OQ-05): shipping_included vs shipping_excluded COD/payout math.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Harden Composite FKs on Phase 2 Reference Tables & Enhance tax_profiles
-- ----------------------------------------------------------------------------
ALTER TABLE public.tax_profiles
  ADD COLUMN IF NOT EXISTS tax_mode text NOT NULL DEFAULT 'none'
    CHECK (tax_mode IN ('none', 'exclusive', 'inclusive'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_tax_profiles_tenant_id_id'
  ) THEN
    ALTER TABLE public.tax_profiles
      ADD CONSTRAINT uq_tax_profiles_tenant_id_id UNIQUE (tenant_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_payment_terms_tenant_id_id'
  ) THEN
    ALTER TABLE public.payment_terms
      ADD CONSTRAINT uq_payment_terms_tenant_id_id UNIQUE (tenant_id, id);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Client Price Lists & Versions
-- ----------------------------------------------------------------------------
CREATE TABLE public.client_price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  description text,
  is_system_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_client_price_lists_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_client_price_lists_tenant_id_id UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX uq_client_price_lists_one_default
  ON public.client_price_lists (tenant_id)
  WHERE is_system_default = true;

CREATE TRIGGER trg_client_price_lists_updated_at
  BEFORE UPDATE ON public.client_price_lists
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- Prevent archiving or unmarking the protected system default list (code = '0')
CREATE OR REPLACE FUNCTION app_private.protect_default_price_list()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system_default THEN
      RAISE EXCEPTION 'Cannot delete protected system default price list (code 0)';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_system_default AND (NEW.archived_at IS NOT NULL OR NEW.is_system_default = false) THEN
    RAISE EXCEPTION 'Cannot archive or unset system default price list (code 0)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_default_price_list
  BEFORE UPDATE OR DELETE ON public.client_price_lists
  FOR EACH ROW EXECUTE FUNCTION app_private.protect_default_price_list();

CREATE TABLE public.price_list_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  price_list_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number >= 1),
  label text NOT NULL DEFAULT 'الإصدار 1',
  volumetric_divisor numeric(10,2) NOT NULL DEFAULT 5000 CHECK (volumetric_divisor > 0),
  weight_rounding_rule text NOT NULL DEFAULT 'ceil_1kg'
    CHECK (weight_rounding_rule IN ('ceil_1kg', 'ceil_half_kg', 'exact')),
  effective_from timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  is_published boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_plv_tenant_list_ver UNIQUE (tenant_id, price_list_id, version_number),
  CONSTRAINT uq_plv_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_plv_price_list
    FOREIGN KEY (tenant_id, price_list_id) REFERENCES public.client_price_lists(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_plv_one_active_per_list
  ON public.price_list_versions (tenant_id, price_list_id)
  WHERE is_active = true;

CREATE TRIGGER trg_plv_updated_at
  BEFORE UPDATE ON public.price_list_versions
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Pickup Price Rules & Linked Delivery Price Rules (ADR-008)
-- ----------------------------------------------------------------------------
CREATE TABLE public.pickup_price_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  price_list_version_id uuid NOT NULL,
  service_id uuid NOT NULL,
  pickup_governorate_id uuid NOT NULL,
  pickup_region_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_ppr_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_ppr_version
    FOREIGN KEY (tenant_id, price_list_version_id) REFERENCES public.price_list_versions(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_ppr_service
    FOREIGN KEY (tenant_id, service_id) REFERENCES public.shipping_services(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ppr_pickup_gov
    FOREIGN KEY (tenant_id, pickup_governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ppr_pickup_reg
    FOREIGN KEY (tenant_id, pickup_region_id) REFERENCES public.regions(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_ppr_unique_scope
  ON public.pickup_price_rules (
    tenant_id,
    price_list_version_id,
    service_id,
    pickup_governorate_id,
    COALESCE(pickup_region_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX idx_ppr_lookup ON public.pickup_price_rules (tenant_id, price_list_version_id, service_id, pickup_governorate_id);

CREATE TRIGGER trg_ppr_updated_at
  BEFORE UPDATE ON public.pickup_price_rules
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.delivery_price_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  pickup_rule_id uuid NOT NULL,
  delivery_governorate_id uuid NOT NULL,
  delivery_region_id uuid,
  base_weight_kg numeric(10,3) NOT NULL DEFAULT 1 CHECK (base_weight_kg > 0),
  base_delivery_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (base_delivery_fee >= 0),
  extra_weight_step_kg numeric(10,3) NOT NULL DEFAULT 1 CHECK (extra_weight_step_kg > 0),
  extra_weight_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (extra_weight_fee >= 0),
  return_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (return_fee >= 0),
  collection_threshold_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (collection_threshold_amount >= 0),
  collection_fee_base numeric(12,2) NOT NULL DEFAULT 0 CHECK (collection_fee_base >= 0),
  collection_extra_step_amount numeric(14,2) NOT NULL DEFAULT 1000 CHECK (collection_extra_step_amount > 0),
  collection_extra_fee numeric(12,2) NOT NULL DEFAULT 0 CHECK (collection_extra_fee >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_dpr_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_dpr_pickup_rule
    FOREIGN KEY (tenant_id, pickup_rule_id) REFERENCES public.pickup_price_rules(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_dpr_del_gov
    FOREIGN KEY (tenant_id, delivery_governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_dpr_del_reg
    FOREIGN KEY (tenant_id, delivery_region_id) REFERENCES public.regions(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_dpr_unique_dest
  ON public.delivery_price_rules (
    tenant_id,
    pickup_rule_id,
    delivery_governorate_id,
    COALESCE(delivery_region_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE INDEX idx_dpr_lookup ON public.delivery_price_rules (tenant_id, pickup_rule_id, delivery_governorate_id);

CREATE TRIGGER trg_dpr_updated_at
  BEFORE UPDATE ON public.delivery_price_rules
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.price_surcharges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  price_list_version_id uuid NOT NULL,
  service_id uuid,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  charge_type text NOT NULL CHECK (charge_type IN ('fixed', 'percent_of_delivery', 'percent_of_cod')),
  amount numeric(12,3) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_price_surcharges_tenant_ver_code UNIQUE (tenant_id, price_list_version_id, code),
  CONSTRAINT fk_ps_version
    FOREIGN KEY (tenant_id, price_list_version_id) REFERENCES public.price_list_versions(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_ps_service
    FOREIGN KEY (tenant_id, service_id) REFERENCES public.shipping_services(tenant_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_price_surcharges_updated_at
  BEFORE UPDATE ON public.price_surcharges
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Clients, Contacts, Pickup Addresses, Terms & Registration Requests
-- ----------------------------------------------------------------------------
CREATE TABLE public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  branch_id uuid,
  ledger_account_id uuid,
  country_id uuid,
  governorate_id uuid NOT NULL,
  city_id uuid,
  region_id uuid NOT NULL,
  price_list_id uuid NOT NULL,
  tax_profile_id uuid NOT NULL,
  default_payment_term_id uuid,
  default_shipment_type_id uuid,
  default_price_mode text NOT NULL DEFAULT 'shipping_excluded'
    CHECK (default_price_mode IN ('shipping_included', 'shipping_excluded')),
  allow_package_opening boolean NOT NULL DEFAULT false,
  client_category text NOT NULL DEFAULT 'standard'
    CHECK (client_category IN ('standard', 'vip', 'corporate', 'ecommerce')),
  activity_type text,
  trade_direction text NOT NULL DEFAULT 'b2c'
    CHECK (trade_direction IN ('b2c', 'b2b', 'all')),
  payout_method text NOT NULL DEFAULT 'cash'
    CHECK (payout_method IN ('cash', 'bank_transfer', 'vodafone_cash')),
  bank_name text,
  bank_account_number text,
  wallet_phone text,
  phone text NOT NULL CHECK (char_length(trim(phone)) >= 4),
  mobile text NOT NULL CHECK (char_length(trim(mobile)) >= 4),
  po_box text,
  postal_code text,
  address_line text NOT NULL CHECK (char_length(trim(address_line)) >= 3),
  email text,
  approval_status text NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('approved', 'pending_approval', 'rejected')),
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_clients_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_clients_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_clients_branch
    FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_clients_ledger
    FOREIGN KEY (tenant_id, ledger_account_id) REFERENCES public.chart_of_accounts(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_clients_country
    FOREIGN KEY (tenant_id, country_id) REFERENCES public.countries(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_clients_gov
    FOREIGN KEY (tenant_id, governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_clients_city
    FOREIGN KEY (tenant_id, city_id) REFERENCES public.cities(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_clients_region
    FOREIGN KEY (tenant_id, region_id) REFERENCES public.regions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_clients_price_list
    FOREIGN KEY (tenant_id, price_list_id) REFERENCES public.client_price_lists(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_clients_tax_profile
    FOREIGN KEY (tenant_id, tax_profile_id) REFERENCES public.tax_profiles(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_clients_payment_term
    FOREIGN KEY (tenant_id, default_payment_term_id) REFERENCES public.payment_terms(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_clients_shipment_type
    FOREIGN KEY (tenant_id, default_shipment_type_id) REFERENCES public.shipment_types(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_clients_tenant_active ON public.clients (tenant_id, is_active) WHERE archived_at IS NULL;
CREATE INDEX idx_clients_tenant_gov_reg ON public.clients (tenant_id, governorate_id, region_id);

CREATE TRIGGER trg_clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.price_exemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL,
  price_list_version_id uuid,
  exemption_target text NOT NULL CHECK (exemption_target IN ('extra_weight', 'collection_fee', 'return_fee')),
  discount_percent numeric(6,2) NOT NULL DEFAULT 100 CHECK (discount_percent >= 0 AND discount_percent <= 100),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pe_client
    FOREIGN KEY (tenant_id, client_id) REFERENCES public.clients(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_pe_version
    FOREIGN KEY (tenant_id, price_list_version_id) REFERENCES public.price_list_versions(tenant_id, id) ON DELETE CASCADE
);

CREATE TRIGGER trg_price_exemptions_updated_at
  BEFORE UPDATE ON public.price_exemptions
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  role_title text,
  phone text,
  mobile text,
  email text,
  is_primary boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cc_client
    FOREIGN KEY (tenant_id, client_id) REFERENCES public.clients(tenant_id, id) ON DELETE CASCADE
);

CREATE TRIGGER trg_client_contacts_updated_at
  BEFORE UPDATE ON public.client_contacts
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.client_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL,
  label text NOT NULL CHECK (char_length(trim(label)) >= 2),
  governorate_id uuid NOT NULL,
  city_id uuid,
  region_id uuid,
  address_line text NOT NULL CHECK (char_length(trim(address_line)) >= 3),
  phone text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ca_client
    FOREIGN KEY (tenant_id, client_id) REFERENCES public.clients(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_ca_gov
    FOREIGN KEY (tenant_id, governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ca_city
    FOREIGN KEY (tenant_id, city_id) REFERENCES public.cities(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ca_region
    FOREIGN KEY (tenant_id, region_id) REFERENCES public.regions(tenant_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_client_addresses_updated_at
  BEFORE UPDATE ON public.client_addresses
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.client_contract_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  client_id uuid NOT NULL,
  term_code text NOT NULL CHECK (term_code ~ '^[A-Z0-9_-]{2,24}$'),
  title text NOT NULL CHECK (char_length(trim(title)) >= 2),
  settlement_cycle_days integer NOT NULL DEFAULT 7 CHECK (settlement_cycle_days >= 0 AND settlement_cycle_days <= 180),
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_cct_tenant_client_code UNIQUE (tenant_id, client_id, term_code),
  CONSTRAINT fk_cct_client
    FOREIGN KEY (tenant_id, client_id) REFERENCES public.clients(tenant_id, id) ON DELETE CASCADE
);

CREATE TRIGGER trg_client_contract_terms_updated_at
  BEFORE UPDATE ON public.client_contract_terms
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.client_registration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  company_name text NOT NULL CHECK (char_length(trim(company_name)) >= 2),
  contact_name text,
  email text NOT NULL,
  phone text NOT NULL,
  mobile text,
  governorate_id uuid NOT NULL,
  region_id uuid NOT NULL,
  address_line text NOT NULL,
  payout_method text NOT NULL DEFAULT 'cash'
    CHECK (payout_method IN ('cash', 'bank_transfer', 'vodafone_cash')),
  bank_name text,
  bank_account_number text,
  wallet_phone text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  rejection_reason text,
  approved_client_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_crr_gov
    FOREIGN KEY (tenant_id, governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_crr_reg
    FOREIGN KEY (tenant_id, region_id) REFERENCES public.regions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_crr_client
    FOREIGN KEY (tenant_id, approved_client_id) REFERENCES public.clients(tenant_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_client_registration_requests_updated_at
  BEFORE UPDATE ON public.client_registration_requests
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 5. Immutable Shipment Price Snapshots (ADR-010)
-- ----------------------------------------------------------------------------
CREATE TABLE public.shipment_price_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  shipment_id uuid, -- bound to public.shipments in Phase 6
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number >= 1),
  client_id uuid NOT NULL,
  price_list_id uuid NOT NULL,
  price_list_version_id uuid NOT NULL,
  service_id uuid NOT NULL,
  pickup_rule_id uuid,
  delivery_rule_id uuid,
  tax_profile_id uuid NOT NULL,
  actual_weight_kg numeric(10,3) NOT NULL CHECK (actual_weight_kg >= 0),
  length_cm numeric(10,2) NOT NULL DEFAULT 0 CHECK (length_cm >= 0),
  width_cm numeric(10,2) NOT NULL DEFAULT 0 CHECK (width_cm >= 0),
  height_cm numeric(10,2) NOT NULL DEFAULT 0 CHECK (height_cm >= 0),
  volumetric_divisor numeric(10,2) NOT NULL CHECK (volumetric_divisor > 0),
  volumetric_weight_kg numeric(10,3) NOT NULL CHECK (volumetric_weight_kg >= 0),
  chargeable_weight_kg numeric(10,3) NOT NULL CHECK (chargeable_weight_kg >= 0),
  rounding_rule text NOT NULL CHECK (rounding_rule IN ('ceil_1kg', 'ceil_half_kg', 'exact')),
  price_mode text NOT NULL CHECK (price_mode IN ('shipping_included', 'shipping_excluded')),
  entered_amount numeric(14,2) NOT NULL DEFAULT 0,
  base_delivery_fee numeric(12,2) NOT NULL DEFAULT 0,
  extra_weight_fee numeric(12,2) NOT NULL DEFAULT 0,
  collection_fee numeric(12,2) NOT NULL DEFAULT 0,
  surcharges_total numeric(12,2) NOT NULL DEFAULT 0,
  exemptions_total numeric(12,2) NOT NULL DEFAULT 0,
  tax_mode text NOT NULL CHECK (tax_mode IN ('none', 'exclusive', 'inclusive')),
  tax_rate_percent numeric(6,3) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_shipping_fee numeric(12,2) NOT NULL DEFAULT 0,
  return_fee numeric(12,2) NOT NULL DEFAULT 0,
  recipient_collect_amount numeric(14,2) NOT NULL DEFAULT 0,
  client_net_payout numeric(14,2) NOT NULL DEFAULT 0,
  is_manual_override boolean NOT NULL DEFAULT false,
  override_reason text,
  calculation_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  engine_version text NOT NULL DEFAULT 'v3.0',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_sps_client
    FOREIGN KEY (tenant_id, client_id) REFERENCES public.clients(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sps_price_list
    FOREIGN KEY (tenant_id, price_list_id) REFERENCES public.client_price_lists(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sps_plv
    FOREIGN KEY (tenant_id, price_list_version_id) REFERENCES public.price_list_versions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sps_service
    FOREIGN KEY (tenant_id, service_id) REFERENCES public.shipping_services(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_sps_tax_profile
    FOREIGN KEY (tenant_id, tax_profile_id) REFERENCES public.tax_profiles(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_sps_tenant_client ON public.shipment_price_snapshots (tenant_id, client_id, created_at DESC);

CREATE OR REPLACE FUNCTION app_private.forbid_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'shipment_price_snapshots is immutable; create a new snapshot version instead';
END;
$$;

CREATE TRIGGER trg_sps_immutable
  BEFORE UPDATE OR DELETE ON public.shipment_price_snapshots
  FOR EACH ROW EXECUTE FUNCTION app_private.forbid_snapshot_mutation();

-- ----------------------------------------------------------------------------
-- 6. Enable & Force Row Level Security on All Phase 3 Tables
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'client_price_lists', 'price_list_versions', 'pickup_price_rules',
    'delivery_price_rules', 'price_surcharges', 'clients', 'price_exemptions',
    'client_contacts', 'client_addresses', 'client_contract_terms',
    'client_registration_requests', 'shipment_price_snapshots'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (app_private.current_user_is_platform_admin() OR app_private.user_belongs_to_tenant(tenant_id))',
      v_table || '_select_policy', v_table
    );

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(tenant_id))',
      v_table || '_insert_policy', v_table
    );

    IF v_table <> 'shipment_price_snapshots' THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(tenant_id)) WITH CHECK (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(tenant_id))',
        v_table || '_update_policy', v_table
      );
    END IF;
  END LOOP;
END $$;

-- Allow tenant admins to delete rule/child rows when editing pricing matrices or contacts
CREATE POLICY pickup_price_rules_delete_policy ON public.pickup_price_rules
  FOR DELETE TO authenticated
  USING (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(tenant_id));

CREATE POLICY delivery_price_rules_delete_policy ON public.delivery_price_rules
  FOR DELETE TO authenticated
  USING (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(tenant_id));

CREATE POLICY price_surcharges_delete_policy ON public.price_surcharges
  FOR DELETE TO authenticated
  USING (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(tenant_id));

CREATE POLICY price_exemptions_delete_policy ON public.price_exemptions
  FOR DELETE TO authenticated
  USING (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(tenant_id));

CREATE POLICY client_contacts_delete_policy ON public.client_contacts
  FOR DELETE TO authenticated
  USING (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(tenant_id));

CREATE POLICY client_addresses_delete_policy ON public.client_addresses
  FOR DELETE TO authenticated
  USING (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(tenant_id));

-- ----------------------------------------------------------------------------
-- 7. Server-Side Atomic Cloning & Pricing Engine RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.clone_price_list(
  p_tenant_id uuid,
  p_source_price_list_id uuid,
  p_new_code text,
  p_new_name text,
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_src_version public.price_list_versions%ROWTYPE;
  v_new_list_id uuid;
  v_new_version_id uuid;
  v_pickup_rec record;
  v_new_pickup_id uuid;
  v_clean_code text := upper(trim(p_new_code));
BEGIN
  IF NOT (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(p_tenant_id)) THEN
    RAISE EXCEPTION 'Forbidden: tenant admin privileges required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.client_price_lists
    WHERE id = p_source_price_list_id AND tenant_id = p_tenant_id AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Source price list not found';
  END IF;

  SELECT * INTO v_src_version
  FROM public.price_list_versions
  WHERE tenant_id = p_tenant_id AND price_list_id = p_source_price_list_id AND is_active = true
  ORDER BY version_number DESC
  LIMIT 1;

  INSERT INTO public.client_price_lists (
    tenant_id, code, name, description, is_system_default, is_active, created_by, updated_by
  )
  VALUES (
    p_tenant_id, v_clean_code, trim(p_new_name), NULLIF(trim(COALESCE(p_description, '')), ''),
    false, true, auth.uid(), auth.uid()
  )
  RETURNING id INTO v_new_list_id;

  INSERT INTO public.price_list_versions (
    tenant_id, price_list_id, version_number, label,
    volumetric_divisor, weight_rounding_rule, is_active, is_published, created_by, updated_by
  )
  VALUES (
    p_tenant_id,
    v_new_list_id,
    1,
    'الإصدار 1 (منسوخ)',
    COALESCE(v_src_version.volumetric_divisor, 5000),
    COALESCE(v_src_version.weight_rounding_rule, 'ceil_1kg'),
    true,
    true,
    auth.uid(),
    auth.uid()
  )
  RETURNING id INTO v_new_version_id;

  IF v_src_version.id IS NOT NULL THEN
    FOR v_pickup_rec IN
      SELECT * FROM public.pickup_price_rules
      WHERE tenant_id = p_tenant_id AND price_list_version_id = v_src_version.id
    LOOP
      INSERT INTO public.pickup_price_rules (
        tenant_id, price_list_version_id, service_id, pickup_governorate_id, pickup_region_id,
        is_active, notes, created_by, updated_by
      )
      VALUES (
        p_tenant_id, v_new_version_id, v_pickup_rec.service_id, v_pickup_rec.pickup_governorate_id,
        v_pickup_rec.pickup_region_id, v_pickup_rec.is_active, v_pickup_rec.notes, auth.uid(), auth.uid()
      )
      RETURNING id INTO v_new_pickup_id;

      INSERT INTO public.delivery_price_rules (
        tenant_id, pickup_rule_id, delivery_governorate_id, delivery_region_id,
        base_weight_kg, base_delivery_fee, extra_weight_step_kg, extra_weight_fee,
        return_fee, collection_threshold_amount, collection_fee_base,
        collection_extra_step_amount, collection_extra_fee, is_active, created_by, updated_by
      )
      SELECT
        p_tenant_id, v_new_pickup_id, d.delivery_governorate_id, d.delivery_region_id,
        d.base_weight_kg, d.base_delivery_fee, d.extra_weight_step_kg, d.extra_weight_fee,
        d.return_fee, d.collection_threshold_amount, d.collection_fee_base,
        d.collection_extra_step_amount, d.collection_extra_fee, d.is_active, auth.uid(), auth.uid()
      FROM public.delivery_price_rules d
      WHERE d.tenant_id = p_tenant_id AND d.pickup_rule_id = v_pickup_rec.id;
    END LOOP;

    INSERT INTO public.price_surcharges (
      tenant_id, price_list_version_id, service_id, code, name, charge_type, amount, is_active, created_by, updated_by
    )
    SELECT
      p_tenant_id, v_new_version_id, s.service_id, s.code, s.name, s.charge_type, s.amount, s.is_active, auth.uid(), auth.uid()
    FROM public.price_surcharges s
    WHERE s.tenant_id = p_tenant_id AND s.price_list_version_id = v_src_version.id;
  END IF;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id,
    auth.uid(),
    'price_list.cloned',
    'client_price_lists',
    v_new_list_id,
    jsonb_build_object('source_price_list_id', p_source_price_list_id, 'new_code', v_clean_code),
    'rpc'
  );

  RETURN v_new_list_id;
END;
$$;

REVOKE ALL ON FUNCTION public.clone_price_list(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clone_price_list(uuid, uuid, text, text, text) TO authenticated;

-- Clone a client record cleanly (spec: copy existing client record)
CREATE OR REPLACE FUNCTION public.clone_client_record(
  p_tenant_id uuid,
  p_source_client_id uuid,
  p_new_code text,
  p_new_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_src public.clients%ROWTYPE;
  v_new_client_id uuid;
BEGIN
  IF NOT (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(p_tenant_id)) THEN
    RAISE EXCEPTION 'Forbidden: tenant admin privileges required';
  END IF;

  SELECT * INTO v_src
  FROM public.clients
  WHERE id = p_source_client_id AND tenant_id = p_tenant_id AND archived_at IS NULL;

  IF v_src.id IS NULL THEN
    RAISE EXCEPTION 'Source client not found';
  END IF;

  INSERT INTO public.clients (
    tenant_id, code, name, branch_id, ledger_account_id, country_id, governorate_id, city_id, region_id,
    price_list_id, tax_profile_id, default_payment_term_id, default_shipment_type_id,
    default_price_mode, allow_package_opening, client_category, activity_type, trade_direction,
    payout_method, bank_name, bank_account_number, wallet_phone, phone, mobile, po_box, postal_code,
    address_line, email, approval_status, is_active, created_by, updated_by
  )
  VALUES (
    p_tenant_id, upper(trim(p_new_code)), trim(p_new_name), v_src.branch_id, v_src.ledger_account_id,
    v_src.country_id, v_src.governorate_id, v_src.city_id, v_src.region_id,
    v_src.price_list_id, v_src.tax_profile_id, v_src.default_payment_term_id, v_src.default_shipment_type_id,
    v_src.default_price_mode, v_src.allow_package_opening, v_src.client_category, v_src.activity_type,
    v_src.trade_direction, v_src.payout_method, v_src.bank_name, v_src.bank_account_number,
    v_src.wallet_phone, v_src.phone, v_src.mobile, v_src.po_box, v_src.postal_code,
    v_src.address_line, v_src.email, 'approved', true, auth.uid(), auth.uid()
  )
  RETURNING id INTO v_new_client_id;

  INSERT INTO public.client_addresses (
    tenant_id, client_id, label, governorate_id, city_id, region_id, address_line, phone, is_default, is_active, created_by
  )
  SELECT
    p_tenant_id, v_new_client_id, label, governorate_id, city_id, region_id, address_line, phone, is_default, is_active, auth.uid()
  FROM public.client_addresses
  WHERE tenant_id = p_tenant_id AND client_id = p_source_client_id AND is_active = true;

  RETURN v_new_client_id;
END;
$$;

REVOKE ALL ON FUNCTION public.clone_client_record(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clone_client_record(uuid, uuid, text, text) TO authenticated;

-- Authoritative Server-Side Pricing Engine (ADR-007 through ADR-011)
CREATE OR REPLACE FUNCTION public.calculate_shipment_price(
  p_tenant_id uuid,
  p_client_id uuid,
  p_service_id uuid,
  p_pickup_governorate_id uuid,
  p_pickup_region_id uuid,
  p_delivery_governorate_id uuid,
  p_delivery_region_id uuid,
  p_actual_weight_kg numeric,
  p_length_cm numeric DEFAULT 0,
  p_width_cm numeric DEFAULT 0,
  p_height_cm numeric DEFAULT 0,
  p_entered_amount numeric DEFAULT 0,
  p_price_mode text DEFAULT 'shipping_excluded',
  p_override_total_fee numeric DEFAULT NULL,
  p_override_reason text DEFAULT NULL,
  p_persist_snapshot boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_client public.clients%ROWTYPE;
  v_tax public.tax_profiles%ROWTYPE;
  v_version public.price_list_versions%ROWTYPE;
  v_delivery_rule public.delivery_price_rules%ROWTYPE;
  v_match_tier text := NULL;

  v_actual_kg numeric(10,3) := GREATEST(0, COALESCE(p_actual_weight_kg, 0));
  v_len numeric(10,2) := GREATEST(0, COALESCE(p_length_cm, 0));
  v_wid numeric(10,2) := GREATEST(0, COALESCE(p_width_cm, 0));
  v_hei numeric(10,2) := GREATEST(0, COALESCE(p_height_cm, 0));
  v_volumetric_kg numeric(10,3) := 0;
  v_raw_chargeable numeric(10,3) := 0;
  v_chargeable_kg numeric(10,3) := 0;

  v_base_fee numeric(12,2) := 0;
  v_extra_weight_fee numeric(12,2) := 0;
  v_collection_fee numeric(12,2) := 0;
  v_return_fee numeric(12,2) := 0;
  v_surcharges_total numeric(12,2) := 0;
  v_exemptions_total numeric(12,2) := 0;

  v_ex_weight_pct numeric(6,2) := 0;
  v_ex_coll_pct numeric(6,2) := 0;
  v_ex_ret_pct numeric(6,2) := 0;
  v_disc_amount numeric(12,2) := 0;

  v_surcharge record;
  v_surcharge_items jsonb := '[]'::jsonb;
  v_surcharge_val numeric(12,2) := 0;

  v_subtotal numeric(12,2) := 0;
  v_tax_amount numeric(12,2) := 0;
  v_total_shipping_fee numeric(12,2) := 0;
  v_entered_amt numeric(14,2) := GREATEST(0, COALESCE(p_entered_amount, 0));
  v_recipient_collect numeric(14,2) := 0;
  v_client_payout numeric(14,2) := 0;
  v_is_override boolean := false;
  v_snapshot_id uuid := NULL;
  v_breakdown jsonb;
BEGIN
  -- 1. Security verification
  IF NOT (app_private.current_user_is_platform_admin() OR app_private.user_belongs_to_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'Forbidden: tenant membership required';
  END IF;

  IF p_price_mode NOT IN ('shipping_included', 'shipping_excluded') THEN
    RAISE EXCEPTION 'Invalid price_mode: must be shipping_included or shipping_excluded';
  END IF;

  -- 2. Load client, tax profile & active price list version
  SELECT * INTO v_client
  FROM public.clients
  WHERE id = p_client_id AND tenant_id = p_tenant_id AND archived_at IS NULL;

  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'Client not found for tenant';
  END IF;

  SELECT * INTO v_tax
  FROM public.tax_profiles
  WHERE id = v_client.tax_profile_id AND tenant_id = p_tenant_id;

  IF v_tax.id IS NULL THEN
    RAISE EXCEPTION 'Client tax profile not found';
  END IF;

  SELECT * INTO v_version
  FROM public.price_list_versions
  WHERE tenant_id = p_tenant_id
    AND price_list_id = v_client.price_list_id
    AND is_active = true
  ORDER BY version_number DESC
  LIMIT 1;

  IF v_version.id IS NULL THEN
    RAISE EXCEPTION 'No active price list version configured for client';
  END IF;

  -- 3. 4-Level Hierarchical Lookup (ADR-008):
  -- Tier 1: pickup_region + delivery_region
  -- Tier 2: pickup_region + delivery_governorate (region NULL)
  -- Tier 3: pickup_governorate (region NULL) + delivery_region
  -- Tier 4: pickup_governorate (region NULL) + delivery_governorate (region NULL)
  SELECT d.*
  INTO v_delivery_rule
  FROM public.pickup_price_rules p
  JOIN public.delivery_price_rules d
    ON d.tenant_id = p.tenant_id
   AND d.pickup_rule_id = p.id
   AND d.is_active = true
  WHERE p.tenant_id = p_tenant_id
    AND p.price_list_version_id = v_version.id
    AND p.service_id = p_service_id
    AND p.is_active = true
    AND p.pickup_governorate_id = p_pickup_governorate_id
    AND d.delivery_governorate_id = p_delivery_governorate_id
    AND (p.pickup_region_id IS NULL OR p.pickup_region_id = p_pickup_region_id)
    AND (d.delivery_region_id IS NULL OR d.delivery_region_id = p_delivery_region_id)
  ORDER BY
    (CASE WHEN p.pickup_region_id IS NOT NULL THEN 0 ELSE 1 END) ASC,
    (CASE WHEN d.delivery_region_id IS NOT NULL THEN 0 ELSE 1 END) ASC
  LIMIT 1;

  IF v_delivery_rule.id IS NULL THEN
    RAISE EXCEPTION 'لم يتم العثور على قاعدة تسعير مطابقة للخدمة ومسار الالتقاط والتسليم المحدد.';
  END IF;

  IF v_delivery_rule.delivery_region_id IS NOT NULL THEN
    SELECT CASE WHEN p.pickup_region_id IS NOT NULL THEN 'exact_region' ELSE 'pickup_gov_delivery_region' END
    INTO v_match_tier
    FROM public.pickup_price_rules p
    WHERE p.id = v_delivery_rule.pickup_rule_id;
  ELSE
    SELECT CASE WHEN p.pickup_region_id IS NOT NULL THEN 'pickup_region_delivery_gov' ELSE 'gov_to_gov' END
    INTO v_match_tier
    FROM public.pickup_price_rules p
    WHERE p.id = v_delivery_rule.pickup_rule_id;
  END IF;

  -- 4. Volumetric & Chargeable Weight (ADR-007)
  IF v_len > 0 AND v_wid > 0 AND v_hei > 0 THEN
    v_volumetric_kg := ROUND((v_len * v_wid * v_hei) / v_version.volumetric_divisor, 3);
  END IF;

  v_raw_chargeable := GREATEST(v_actual_kg, v_volumetric_kg);

  IF v_raw_chargeable > 0 THEN
    IF v_version.weight_rounding_rule = 'ceil_1kg' THEN
      v_chargeable_kg := CEIL(v_raw_chargeable);
    ELSIF v_version.weight_rounding_rule = 'ceil_half_kg' THEN
      v_chargeable_kg := CEIL(v_raw_chargeable * 2.0) / 2.0;
    ELSE
      v_chargeable_kg := ROUND(v_raw_chargeable, 3);
    END IF;
  END IF;

  -- 5. Core Fee Components
  v_base_fee := ROUND(v_delivery_rule.base_delivery_fee, 2);

  IF v_chargeable_kg > v_delivery_rule.base_weight_kg AND v_delivery_rule.extra_weight_fee > 0 THEN
    v_extra_weight_fee := ROUND(
      CEIL((v_chargeable_kg - v_delivery_rule.base_weight_kg) / v_delivery_rule.extra_weight_step_kg)
      * v_delivery_rule.extra_weight_fee,
      2
    );
  END IF;

  IF v_entered_amt > 0 THEN
    v_collection_fee := ROUND(v_delivery_rule.collection_fee_base, 2);
    IF v_entered_amt > v_delivery_rule.collection_threshold_amount AND v_delivery_rule.collection_extra_fee > 0 THEN
      v_collection_fee := ROUND(
        v_collection_fee + (
          CEIL((v_entered_amt - v_delivery_rule.collection_threshold_amount) / v_delivery_rule.collection_extra_step_amount)
          * v_delivery_rule.collection_extra_fee
        ),
        2
      );
    END IF;
  END IF;

  v_return_fee := ROUND(v_delivery_rule.return_fee, 2);

  -- 6. Version Surcharges
  FOR v_surcharge IN
    SELECT code, name, charge_type, amount
    FROM public.price_surcharges
    WHERE tenant_id = p_tenant_id
      AND price_list_version_id = v_version.id
      AND is_active = true
      AND (service_id IS NULL OR service_id = p_service_id)
    ORDER BY code
  LOOP
    IF v_surcharge.charge_type = 'fixed' THEN
      v_surcharge_val := ROUND(v_surcharge.amount, 2);
    ELSIF v_surcharge.charge_type = 'percent_of_delivery' THEN
      v_surcharge_val := ROUND((v_base_fee + v_extra_weight_fee) * (v_surcharge.amount / 100.0), 2);
    ELSE
      v_surcharge_val := ROUND(v_entered_amt * (v_surcharge.amount / 100.0), 2);
    END IF;

    v_surcharges_total := ROUND(v_surcharges_total + v_surcharge_val, 2);
    v_surcharge_items := v_surcharge_items || jsonb_build_array(
      jsonb_build_object('code', v_surcharge.code, 'name', v_surcharge.name, 'amount', v_surcharge_val)
    );
  END LOOP;

  -- 7. Client Fee Exemptions
  SELECT COALESCE(MAX(discount_percent), 0) INTO v_ex_weight_pct
  FROM public.price_exemptions
  WHERE tenant_id = p_tenant_id AND client_id = p_client_id AND is_active = true
    AND exemption_target = 'extra_weight'
    AND (price_list_version_id IS NULL OR price_list_version_id = v_version.id);

  SELECT COALESCE(MAX(discount_percent), 0) INTO v_ex_coll_pct
  FROM public.price_exemptions
  WHERE tenant_id = p_tenant_id AND client_id = p_client_id AND is_active = true
    AND exemption_target = 'collection_fee'
    AND (price_list_version_id IS NULL OR price_list_version_id = v_version.id);

  SELECT COALESCE(MAX(discount_percent), 0) INTO v_ex_ret_pct
  FROM public.price_exemptions
  WHERE tenant_id = p_tenant_id AND client_id = p_client_id AND is_active = true
    AND exemption_target = 'return_fee'
    AND (price_list_version_id IS NULL OR price_list_version_id = v_version.id);

  IF v_ex_weight_pct > 0 THEN
    v_disc_amount := ROUND(v_extra_weight_fee * (v_ex_weight_pct / 100.0), 2);
    v_exemptions_total := ROUND(v_exemptions_total + v_disc_amount, 2);
  END IF;

  IF v_ex_coll_pct > 0 THEN
    v_disc_amount := ROUND(v_collection_fee * (v_ex_coll_pct / 100.0), 2);
    v_exemptions_total := ROUND(v_exemptions_total + v_disc_amount, 2);
  END IF;

  IF v_ex_ret_pct > 0 THEN
    v_return_fee := ROUND(v_return_fee * (1.0 - v_ex_ret_pct / 100.0), 2);
  END IF;

  -- 8. Tax Calculation on Shipping & Service Fees Only (ADR-009)
  v_subtotal := ROUND(GREATEST(0, v_base_fee + v_extra_weight_fee + v_collection_fee + v_surcharges_total - v_exemptions_total), 2);

  IF v_tax.tax_mode = 'exclusive' AND v_tax.rate_percent > 0 THEN
    v_tax_amount := ROUND(v_subtotal * (v_tax.rate_percent / 100.0), 2);
    v_total_shipping_fee := ROUND(v_subtotal + v_tax_amount, 2);
  ELSIF v_tax.tax_mode = 'inclusive' AND v_tax.rate_percent > 0 THEN
    v_tax_amount := ROUND(v_subtotal - (v_subtotal / (1.0 + v_tax.rate_percent / 100.0)), 2);
    v_total_shipping_fee := v_subtotal;
  ELSE
    v_tax_amount := 0;
    v_total_shipping_fee := v_subtotal;
  END IF;

  -- 9. Manual Price Override Check (ADR-010)
  IF p_override_total_fee IS NOT NULL THEN
    IF NOT (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(p_tenant_id)) THEN
      RAISE EXCEPTION 'Forbidden: override_price requires admin privileges';
    END IF;
    IF char_length(trim(COALESCE(p_override_reason, ''))) < 3 THEN
      RAISE EXCEPTION 'Override reason is required when manually overriding price';
    END IF;
    v_is_override := true;
    v_total_shipping_fee := ROUND(GREATEST(0, p_override_total_fee), 2);
  END IF;

  -- 10. Price Mode Calculation (ADR-011)
  IF p_price_mode = 'shipping_included' THEN
    v_recipient_collect := ROUND(v_entered_amt, 2);
    v_client_payout := ROUND(v_entered_amt - v_total_shipping_fee, 2);
  ELSE
    v_client_payout := ROUND(v_entered_amt, 2);
    v_recipient_collect := ROUND(v_entered_amt + v_total_shipping_fee, 2);
  END IF;

  v_breakdown := jsonb_build_object(
    'engine_version', 'v3.0',
    'match_tier', v_match_tier,
    'price_list_id', v_client.price_list_id,
    'price_list_version_id', v_version.id,
    'version_number', v_version.version_number,
    'pickup_rule_id', v_delivery_rule.pickup_rule_id,
    'delivery_rule_id', v_delivery_rule.id,
    'volumetric_divisor', v_version.volumetric_divisor,
    'rounding_rule', v_version.weight_rounding_rule,
    'actual_weight_kg', v_actual_kg,
    'volumetric_weight_kg', v_volumetric_kg,
    'chargeable_weight_kg', v_chargeable_kg,
    'base_weight_kg', v_delivery_rule.base_weight_kg,
    'base_delivery_fee', v_base_fee,
    'extra_weight_fee', v_extra_weight_fee,
    'collection_fee', v_collection_fee,
    'surcharges_total', v_surcharges_total,
    'surcharges', v_surcharge_items,
    'exemptions_total', v_exemptions_total,
    'subtotal_before_tax', v_subtotal,
    'tax_profile_code', v_tax.code,
    'tax_mode', v_tax.tax_mode,
    'tax_rate_percent', v_tax.rate_percent,
    'tax_amount', v_tax_amount,
    'total_shipping_fee', v_total_shipping_fee,
    'return_fee', v_return_fee,
    'price_mode', p_price_mode,
    'entered_amount', v_entered_amt,
    'recipient_collect_amount', v_recipient_collect,
    'client_net_payout', v_client_payout,
    'is_manual_override', v_is_override,
    'override_reason', NULLIF(trim(COALESCE(p_override_reason, '')), '')
  );

  IF p_persist_snapshot THEN
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
      p_tenant_id, NULL, 1, p_client_id, v_client.price_list_id, v_version.id,
      p_service_id, v_delivery_rule.pickup_rule_id, v_delivery_rule.id, v_tax.id,
      v_actual_kg, v_len, v_wid, v_hei, v_version.volumetric_divisor,
      v_volumetric_kg, v_chargeable_kg, v_version.weight_rounding_rule,
      p_price_mode, v_entered_amt, v_base_fee, v_extra_weight_fee, v_collection_fee,
      v_surcharges_total, v_exemptions_total, v_tax.tax_mode, v_tax.rate_percent, v_tax_amount,
      v_total_shipping_fee, v_return_fee, v_recipient_collect, v_client_payout,
      v_is_override, NULLIF(trim(COALESCE(p_override_reason, '')), ''), v_breakdown, 'v3.0', auth.uid()
    )
    RETURNING id INTO v_snapshot_id;

    IF v_is_override THEN
      INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
      VALUES (
        p_tenant_id, auth.uid(), 'pricing.manual_override', 'shipment_price_snapshots',
        v_snapshot_id, v_breakdown, 'pricing_engine'
      );
    END IF;

    v_breakdown := v_breakdown || jsonb_build_object('snapshot_id', v_snapshot_id);
  END IF;

  RETURN v_breakdown;
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_shipment_price(uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, text, numeric, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_shipment_price(uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, numeric, numeric, numeric, numeric, text, numeric, text, boolean) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Atomic & Idempotent Phase 3 Default Seeding + Backfill
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.seed_tenant_phase3_defaults(
  p_tenant_id uuid,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_default_list_id uuid;
  v_version_id uuid;
  v_srv_std_id uuid;
  v_srv_exp_id uuid;
  v_gov_cairo_id uuid;
  v_gov_giza_id uuid;
  v_gov_alex_id uuid;
  v_pickup_std_cairo uuid;
  v_pickup_exp_cairo uuid;
BEGIN
  -- 1. Tax Profiles (no-tax default for new clients + VAT 14% options)
  UPDATE public.tax_profiles
  SET tax_mode = 'none', is_default = true
  WHERE tenant_id = p_tenant_id AND code = 'TAX-EXEMPT';

  INSERT INTO public.tax_profiles (tenant_id, code, name, rate_percent, tax_mode, is_default, is_active)
  VALUES
    (p_tenant_id, 'TAX-EXEMPT', 'بدون ضريبة (الوضع الافتراضي للعملاء)', 0, 'none', true, true),
    (p_tenant_id, 'TAX-VAT14-EXC', 'ضريبة قيمة مضافة 14% (مضافة على الرسوم)', 14, 'exclusive', false, true),
    (p_tenant_id, 'TAX-VAT14-INC', 'ضريبة قيمة مضافة 14% (شاملة داخل الرسوم)', 14, 'inclusive', false, true)
  ON CONFLICT (tenant_id, code) DO UPDATE
    SET tax_mode = EXCLUDED.tax_mode;

  -- 2. Protected Default Price List (Code '0' - Mobile & Default Clients)
  INSERT INTO public.client_price_lists (
    tenant_id, code, name, description, is_system_default, is_active, created_by, updated_by
  )
  VALUES (
    p_tenant_id,
    '0',
    'أسعار عملاء الموبايل (القائمة الافتراضية)',
    'قائمة الأسعار المرجعية الأساسية المحمية من الحذف لعملاء الموبايل والعملاء الافتراضيين.',
    true,
    true,
    p_actor_user_id,
    p_actor_user_id
  )
  ON CONFLICT (tenant_id, code) DO NOTHING;

  SELECT id INTO v_default_list_id
  FROM public.client_price_lists
  WHERE tenant_id = p_tenant_id AND code = '0'
  LIMIT 1;

  INSERT INTO public.price_list_versions (
    tenant_id, price_list_id, version_number, label,
    volumetric_divisor, weight_rounding_rule, is_active, is_published, created_by, updated_by
  )
  VALUES (
    p_tenant_id, v_default_list_id, 1, 'الإصدار 1 (الافتراضي)',
    5000, 'ceil_1kg', true, true, p_actor_user_id, p_actor_user_id
  )
  ON CONFLICT (tenant_id, price_list_id, version_number) DO NOTHING;

  SELECT id INTO v_version_id
  FROM public.price_list_versions
  WHERE tenant_id = p_tenant_id AND price_list_id = v_default_list_id AND version_number = 1
  LIMIT 1;

  -- 3. Seed Starter Pickup & Delivery Matrix for Cairo/Giza/Alex if services exist
  SELECT id INTO v_srv_std_id FROM public.shipping_services WHERE tenant_id = p_tenant_id AND code = 'SRV-001' LIMIT 1;
  SELECT id INTO v_srv_exp_id FROM public.shipping_services WHERE tenant_id = p_tenant_id AND code = 'SRV-002' LIMIT 1;
  SELECT id INTO v_gov_cairo_id FROM public.governorates WHERE tenant_id = p_tenant_id AND code = 'EG-01' LIMIT 1;
  SELECT id INTO v_gov_giza_id FROM public.governorates WHERE tenant_id = p_tenant_id AND code = 'EG-02' LIMIT 1;
  SELECT id INTO v_gov_alex_id FROM public.governorates WHERE tenant_id = p_tenant_id AND code = 'EG-03' LIMIT 1;

  IF v_version_id IS NOT NULL AND v_gov_cairo_id IS NOT NULL THEN
    IF v_srv_std_id IS NOT NULL THEN
      INSERT INTO public.pickup_price_rules (
        tenant_id, price_list_version_id, service_id, pickup_governorate_id, pickup_region_id, is_active, notes, created_by, updated_by
      )
      VALUES (
        p_tenant_id, v_version_id, v_srv_std_id, v_gov_cairo_id, NULL, true, 'التقاط افتراضي من محافظة القاهرة', p_actor_user_id, p_actor_user_id
      )
      ON CONFLICT DO NOTHING;

      SELECT id INTO v_pickup_std_cairo
      FROM public.pickup_price_rules
      WHERE tenant_id = p_tenant_id AND price_list_version_id = v_version_id
        AND service_id = v_srv_std_id AND pickup_governorate_id = v_gov_cairo_id AND pickup_region_id IS NULL
      LIMIT 1;

      IF v_pickup_std_cairo IS NOT NULL THEN
        INSERT INTO public.delivery_price_rules (
          tenant_id, pickup_rule_id, delivery_governorate_id, delivery_region_id,
          base_weight_kg, base_delivery_fee, extra_weight_step_kg, extra_weight_fee,
          return_fee, collection_threshold_amount, collection_fee_base, collection_extra_step_amount, collection_extra_fee,
          is_active, created_by, updated_by
        )
        VALUES
          (p_tenant_id, v_pickup_std_cairo, v_gov_cairo_id, NULL, 2, 55, 1, 10, 35, 3000, 0, 1000, 10, true, p_actor_user_id, p_actor_user_id),
          (p_tenant_id, v_pickup_std_cairo, COALESCE(v_gov_giza_id, v_gov_cairo_id), NULL, 2, 60, 1, 10, 35, 3000, 0, 1000, 10, true, p_actor_user_id, p_actor_user_id),
          (p_tenant_id, v_pickup_std_cairo, COALESCE(v_gov_alex_id, v_gov_cairo_id), NULL, 2, 75, 1, 15, 45, 3000, 0, 1000, 15, true, p_actor_user_id, p_actor_user_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;

    IF v_srv_exp_id IS NOT NULL THEN
      INSERT INTO public.pickup_price_rules (
        tenant_id, price_list_version_id, service_id, pickup_governorate_id, pickup_region_id, is_active, notes, created_by, updated_by
      )
      VALUES (
        p_tenant_id, v_version_id, v_srv_exp_id, v_gov_cairo_id, NULL, true, 'التقاط سريع من القاهرة الكبرى', p_actor_user_id, p_actor_user_id
      )
      ON CONFLICT DO NOTHING;

      SELECT id INTO v_pickup_exp_cairo
      FROM public.pickup_price_rules
      WHERE tenant_id = p_tenant_id AND price_list_version_id = v_version_id
        AND service_id = v_srv_exp_id AND pickup_governorate_id = v_gov_cairo_id AND pickup_region_id IS NULL
      LIMIT 1;

      IF v_pickup_exp_cairo IS NOT NULL THEN
        INSERT INTO public.delivery_price_rules (
          tenant_id, pickup_rule_id, delivery_governorate_id, delivery_region_id,
          base_weight_kg, base_delivery_fee, extra_weight_step_kg, extra_weight_fee,
          return_fee, collection_threshold_amount, collection_fee_base, collection_extra_step_amount, collection_extra_fee,
          is_active, created_by, updated_by
        )
        VALUES
          (p_tenant_id, v_pickup_exp_cairo, v_gov_cairo_id, NULL, 1, 75, 1, 15, 45, 3000, 0, 1000, 10, true, p_actor_user_id, p_actor_user_id),
          (p_tenant_id, v_pickup_exp_cairo, COALESCE(v_gov_giza_id, v_gov_cairo_id), NULL, 1, 80, 1, 15, 45, 3000, 0, 1000, 10, true, p_actor_user_id, p_actor_user_id)
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, p_actor_user_id, 'tenant.phase3_defaults_seeded', 'tenants', p_tenant_id,
    jsonb_build_object('default_price_list_code', '0', 'volumetric_divisor', 5000),
    'migration_seed'
  );
END;
$$;

REVOKE ALL ON FUNCTION app_private.seed_tenant_phase3_defaults(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Hook Phase 3 defaults into app_private.onboard_tenant cleanly
CREATE OR REPLACE FUNCTION app_private.onboard_tenant(
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_code text,
  p_slug text,
  p_name text,
  p_owner_user_id uuid,
  p_owner_username text,
  p_owner_display_name text,
  p_owner_email text,
  p_owner_email_masked text
)
RETURNS TABLE (
  tenant_id uuid,
  membership_id uuid,
  already_existed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_existing_tenant_id uuid;
  v_existing_membership_id uuid;
  v_tenant_id uuid;
  v_membership_id uuid;
  v_clean_slug text := lower(trim(p_slug));
  v_clean_code text := upper(trim(p_code));
  v_clean_username text := lower(trim(p_owner_username));
  v_clean_email text := lower(trim(p_owner_email));
BEGIN
  SELECT to_rec.tenant_id INTO v_existing_tenant_id
  FROM public.tenant_onboarding to_rec
  WHERE to_rec.idempotency_key = p_idempotency_key;

  IF v_existing_tenant_id IS NOT NULL THEN
    PERFORM app_private.seed_tenant_phase2_defaults(v_existing_tenant_id, p_actor_user_id);
    PERFORM app_private.seed_tenant_phase3_defaults(v_existing_tenant_id, p_actor_user_id);

    SELECT tm.id INTO v_existing_membership_id
    FROM public.tenant_memberships tm
    WHERE tm.tenant_id = v_existing_tenant_id
      AND tm.role_key = 'company_owner'
    LIMIT 1;

    RETURN QUERY SELECT v_existing_tenant_id, v_existing_membership_id, true;
    RETURN;
  END IF;

  INSERT INTO public.tenants (code, slug, name, status, created_by, updated_by)
  VALUES (v_clean_code, v_clean_slug, trim(p_name), 'active', p_actor_user_id, p_actor_user_id)
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_settings (tenant_id, allow_client_self_registration, auto_approve_clients, updated_by)
  VALUES (v_tenant_id, false, false, p_actor_user_id);

  INSERT INTO public.tenant_onboarding (tenant_id, idempotency_key, step_status, created_by)
  VALUES (v_tenant_id, p_idempotency_key, 'phase1_initialized', p_actor_user_id);

  INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
  VALUES (p_owner_user_id, trim(p_owner_display_name), false, true)
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        is_active = true;

  INSERT INTO public.tenant_memberships (
    tenant_id, user_id, username, account_subject_type, role_key,
    is_active, must_change_password, created_by, updated_by
  )
  VALUES (
    v_tenant_id, p_owner_user_id, v_clean_username, 'staff', 'company_owner',
    true, true, p_actor_user_id, p_actor_user_id
  )
  RETURNING id INTO v_membership_id;

  INSERT INTO app_private.auth_identities (user_id, scope_type, tenant_id, username, auth_email, is_active)
  VALUES (p_owner_user_id, 'tenant', v_tenant_id, v_clean_username, v_clean_email, true);

  INSERT INTO public.invitations (
    tenant_id, user_id, username, email_masked, role_key, status, expires_at, created_by
  )
  VALUES (
    v_tenant_id, p_owner_user_id, v_clean_username, p_owner_email_masked, 'company_owner',
    'pending', now() + interval '7 days', p_actor_user_id
  );

  PERFORM app_private.seed_tenant_phase2_defaults(v_tenant_id, p_actor_user_id);
  PERFORM app_private.seed_tenant_phase3_defaults(v_tenant_id, p_actor_user_id);

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    v_tenant_id,
    p_actor_user_id,
    'tenant.onboarded',
    'tenants',
    v_tenant_id,
    jsonb_build_object('code', v_clean_code, 'slug', v_clean_slug, 'owner_username', v_clean_username),
    'edge_function'
  );

  RETURN QUERY SELECT v_tenant_id, v_membership_id, false;
END;
$$;

-- Safe Backfill for existing tenants
DO $$
DECLARE
  v_tenant record;
BEGIN
  FOR v_tenant IN SELECT id, created_by FROM public.tenants LOOP
    PERFORM app_private.seed_tenant_phase3_defaults(v_tenant.id, v_tenant.created_by);
  END LOOP;
END $$;
