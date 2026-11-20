-- ============================================================================
-- Migration 0003: Phase 2 - Branches, Geography, Definitions & Default Seeds
-- ============================================================================
-- Rules enforced:
-- - Multi-tenant isolation via mandatory tenant_id + composite FKs + FORCE RLS.
-- - Archive-first lifecycle (is_active / archived_at) rather than hard-deleting
--   referenced master records.
-- - Single atomic & idempotent default seeding per tenant (ADR-003).
-- - Zero invented tax/pricing formulas (deferred to Phase 3 & Open Questions).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Geography Hierarchy (Countries -> Governorates -> Cities -> Regions)
-- ----------------------------------------------------------------------------
CREATE TABLE public.countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,16}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  iso2 text CHECK (iso2 IS NULL OR iso2 ~ '^[A-Z]{2}$'),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_countries_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_countries_tenant_id_id UNIQUE (tenant_id, id)
);

CREATE TRIGGER trg_countries_updated_at
  BEFORE UPDATE ON public.countries
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.governorates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  country_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_governorates_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_governorates_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_governorates_country
    FOREIGN KEY (tenant_id, country_id) REFERENCES public.countries(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_governorates_tenant_country ON public.governorates (tenant_id, country_id);

CREATE TRIGGER trg_governorates_updated_at
  BEFORE UPDATE ON public.governorates
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  governorate_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,32}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_cities_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_cities_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_cities_governorate
    FOREIGN KEY (tenant_id, governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_cities_tenant_gov ON public.cities (tenant_id, governorate_id);

CREATE TRIGGER trg_cities_updated_at
  BEFORE UPDATE ON public.cities
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.regions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  governorate_id uuid NOT NULL,
  city_id uuid,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,32}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_regions_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_regions_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_regions_governorate
    FOREIGN KEY (tenant_id, governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_regions_city
    FOREIGN KEY (tenant_id, city_id) REFERENCES public.cities(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_regions_tenant_gov ON public.regions (tenant_id, governorate_id);
CREATE INDEX idx_regions_tenant_city ON public.regions (tenant_id, city_id);

CREATE TRIGGER trg_regions_updated_at
  BEFORE UPDATE ON public.regions
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Branches & Geography Branch Assignment
-- ----------------------------------------------------------------------------
CREATE TABLE public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  is_main boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  country_id uuid,
  governorate_id uuid,
  city_id uuid,
  region_id uuid,
  phone text,
  fax text,
  address_line text,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_branches_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_branches_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_branches_country
    FOREIGN KEY (tenant_id, country_id) REFERENCES public.countries(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_branches_governorate
    FOREIGN KEY (tenant_id, governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_branches_city
    FOREIGN KEY (tenant_id, city_id) REFERENCES public.cities(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_branches_region
    FOREIGN KEY (tenant_id, region_id) REFERENCES public.regions(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_branches_one_main_per_tenant
  ON public.branches (tenant_id)
  WHERE is_main = true AND archived_at IS NULL;

CREATE INDEX idx_branches_tenant_active ON public.branches (tenant_id, is_active) WHERE archived_at IS NULL;

CREATE TRIGGER trg_branches_updated_at
  BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- Add default_branch_id to governorates & regions after branches table exists
ALTER TABLE public.governorates
  ADD COLUMN default_branch_id uuid,
  ADD CONSTRAINT fk_governorates_default_branch
    FOREIGN KEY (tenant_id, default_branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT;

ALTER TABLE public.regions
  ADD COLUMN default_branch_id uuid,
  ADD CONSTRAINT fk_regions_default_branch
    FOREIGN KEY (tenant_id, default_branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT;

CREATE TABLE public.branch_service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  branch_id uuid NOT NULL,
  governorate_id uuid NOT NULL,
  region_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_bsa_branch
    FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_bsa_governorate
    FOREIGN KEY (tenant_id, governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_bsa_region
    FOREIGN KEY (tenant_id, region_id) REFERENCES public.regions(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_branch_service_areas_unique
  ON public.branch_service_areas (tenant_id, branch_id, governorate_id, COALESCE(region_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ----------------------------------------------------------------------------
-- 3. Default Chart of Accounts & Accounting Reference Tables
-- ----------------------------------------------------------------------------
CREATE TABLE public.chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  account_type text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id uuid,
  is_group boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_coa_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_coa_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_coa_parent
    FOREIGN KEY (tenant_id, parent_id) REFERENCES public.chart_of_accounts(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_coa_tenant_type ON public.chart_of_accounts (tenant_id, account_type);

CREATE TRIGGER trg_coa_updated_at
  BEFORE UPDATE ON public.chart_of_accounts
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.auxiliary_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  journal_category text NOT NULL CHECK (journal_category IN ('cash', 'operations', 'settlements', 'general')),
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_aux_journals_tenant_code UNIQUE (tenant_id, code)
);

CREATE TRIGGER trg_aux_journals_updated_at
  BEFORE UPDATE ON public.auxiliary_journals
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.journal_entry_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  is_reversal_type boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_entry_types_tenant_code UNIQUE (tenant_id, code)
);

CREATE TRIGGER trg_entry_types_updated_at
  BEFORE UPDATE ON public.journal_entry_types
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Shipping Services & Shipment Types
-- ----------------------------------------------------------------------------
CREATE TABLE public.shipment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,16}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  description text,
  is_system boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_shipment_types_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_shipment_types_tenant_id_id UNIQUE (tenant_id, id)
);

CREATE TABLE public.shipping_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  estimated_days_min integer NOT NULL DEFAULT 1 CHECK (estimated_days_min >= 0 AND estimated_days_min <= 90),
  estimated_days_max integer NOT NULL DEFAULT 3 CHECK (estimated_days_max >= estimated_days_min AND estimated_days_max <= 120),
  branch_id uuid,
  delivery_revenue_account_id uuid,
  collection_revenue_account_id uuid,
  courier_commission_account_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_shipping_services_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_shipping_services_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_services_branch
    FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_services_del_rev_acct
    FOREIGN KEY (tenant_id, delivery_revenue_account_id) REFERENCES public.chart_of_accounts(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_services_col_rev_acct
    FOREIGN KEY (tenant_id, collection_revenue_account_id) REFERENCES public.chart_of_accounts(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_services_comm_acct
    FOREIGN KEY (tenant_id, courier_commission_account_id) REFERENCES public.chart_of_accounts(tenant_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_shipping_services_updated_at
  BEFORE UPDATE ON public.shipping_services
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.shipping_service_types (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL,
  shipment_type_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, service_id, shipment_type_id),
  CONSTRAINT fk_sst_service
    FOREIGN KEY (tenant_id, service_id) REFERENCES public.shipping_services(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_sst_type
    FOREIGN KEY (tenant_id, shipment_type_id) REFERENCES public.shipment_types(tenant_id, id) ON DELETE RESTRICT
);

-- ----------------------------------------------------------------------------
-- 5. Delivery Exception Reasons & Movement Types
-- ----------------------------------------------------------------------------
CREATE TABLE public.delivery_exception_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  category text NOT NULL CHECK (category IN ('delivery_failed', 'refused', 'return', 'cancellation', 'exception')),
  requires_note boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_exception_reasons_tenant_code UNIQUE (tenant_id, code)
);

CREATE TRIGGER trg_exception_reasons_updated_at
  BEFORE UPDATE ON public.delivery_exception_reasons
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.movement_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal', 'return')),
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_movement_types_tenant_code UNIQUE (tenant_id, code)
);

CREATE TRIGGER trg_movement_types_updated_at
  BEFORE UPDATE ON public.movement_types
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 6. Cashboxes & Cashbox Custodians
-- ----------------------------------------------------------------------------
CREATE TABLE public.cashboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  branch_id uuid NOT NULL,
  ledger_account_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  allow_deposit boolean NOT NULL DEFAULT true,
  allow_withdraw boolean NOT NULL DEFAULT true,
  allow_transfer_in boolean NOT NULL DEFAULT true,
  allow_transfer_out boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_cashboxes_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_cashboxes_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_cashboxes_branch
    FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cashboxes_account
    FOREIGN KEY (tenant_id, ledger_account_id) REFERENCES public.chart_of_accounts(tenant_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_cashboxes_updated_at
  BEFORE UPDATE ON public.cashboxes
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.cashbox_custodians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  cashbox_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_cashbox_custodian_pair UNIQUE (tenant_id, cashbox_id, membership_id),
  CONSTRAINT fk_custodian_cashbox
    FOREIGN KEY (tenant_id, cashbox_id) REFERENCES public.cashboxes(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_custodian_membership
    FOREIGN KEY (tenant_id, membership_id) REFERENCES public.tenant_memberships(tenant_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_cashbox_custodians_updated_at
  BEFORE UPDATE ON public.cashbox_custodians
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 7. Payment Reference, Tax Profiles, Units & Numbering Sequences
-- ----------------------------------------------------------------------------
CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  is_system boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payment_methods_tenant_code UNIQUE (tenant_id, code)
);

CREATE TABLE public.payment_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  is_system boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_payment_terms_tenant_code UNIQUE (tenant_id, code)
);

CREATE TABLE public.delivery_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  is_system boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_delivery_types_tenant_code UNIQUE (tenant_id, code)
);

CREATE TABLE public.tax_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  rate_percent numeric(6,3) NOT NULL DEFAULT 0 CHECK (rate_percent >= 0 AND rate_percent <= 100),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_tax_profiles_tenant_code UNIQUE (tenant_id, code)
);

CREATE TABLE public.units_of_measure (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,16}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 1),
  unit_category text NOT NULL CHECK (unit_category IN ('weight', 'dimension', 'count')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_uom_tenant_code UNIQUE (tenant_id, code)
);

CREATE TABLE public.numbering_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  entity_key text NOT NULL CHECK (entity_key ~ '^[a-z0-9_]{2,40}$'),
  label text NOT NULL,
  prefix text NOT NULL CHECK (prefix ~ '^[A-Z0-9-]{1,12}$'),
  next_number bigint NOT NULL DEFAULT 1 CHECK (next_number >= 1),
  padding_length integer NOT NULL DEFAULT 6 CHECK (padding_length BETWEEN 3 AND 12),
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_numbering_tenant_entity UNIQUE (tenant_id, entity_key)
);

CREATE TRIGGER trg_numbering_sequences_updated_at
  BEFORE UPDATE ON public.numbering_sequences
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 8. Enable & Force Row Level Security on All Phase 2 Tables
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'countries', 'governorates', 'cities', 'regions',
    'branches', 'branch_service_areas',
    'chart_of_accounts', 'auxiliary_journals', 'journal_entry_types',
    'shipment_types', 'shipping_services', 'shipping_service_types',
    'delivery_exception_reasons', 'movement_types',
    'cashboxes', 'cashbox_custodians',
    'payment_methods', 'payment_terms', 'delivery_types',
    'tax_profiles', 'units_of_measure', 'numbering_sequences'
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

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(tenant_id)) WITH CHECK (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(tenant_id))',
      v_table || '_update_policy', v_table
    );
  END LOOP;
END $$;

-- Allow tenant admins to delete join links in shipping_service_types and branch_service_areas only
CREATE POLICY shipping_service_types_delete_policy ON public.shipping_service_types
  FOR DELETE TO authenticated
  USING (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(tenant_id));

CREATE POLICY branch_service_areas_delete_policy ON public.branch_service_areas
  FOR DELETE TO authenticated
  USING (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(tenant_id));

-- Atomic helper for switching main branch without violating unique index mid-transaction
CREATE OR REPLACE FUNCTION public.set_main_branch(
  p_tenant_id uuid,
  p_branch_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  IF NOT (app_private.current_user_is_platform_super_admin() OR app_private.user_is_tenant_admin(p_tenant_id)) THEN
    RAISE EXCEPTION 'Forbidden: tenant admin privileges required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches
    WHERE id = p_branch_id AND tenant_id = p_tenant_id AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Branch not found or archived';
  END IF;

  UPDATE public.branches
  SET is_main = false, updated_by = auth.uid()
  WHERE tenant_id = p_tenant_id AND is_main = true AND id <> p_branch_id;

  UPDATE public.branches
  SET is_main = true, is_active = true, updated_by = auth.uid()
  WHERE id = p_branch_id AND tenant_id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_main_branch(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_main_branch(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Atomic & Idempotent Phase 2 Default Seeding Function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.seed_tenant_phase2_defaults(
  p_tenant_id uuid,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_country_id uuid;
  v_main_branch_id uuid;
  v_cairo_gov_id uuid;
  v_cairo_city_id uuid;
  v_cairo_region_id uuid;
  v_owner_membership_id uuid;
  v_acct_assets uuid;
  v_acct_cash_group uuid;
  v_acct_main_cash uuid;
  v_acct_liabilities uuid;
  v_acct_revenue uuid;
  v_acct_expenses uuid;
  v_acct_del_rev uuid;
  v_acct_col_rev uuid;
  v_acct_comm_exp uuid;
  v_srv_std_id uuid;
  v_srv_exp_id uuid;
  v_cashbox_id uuid;
  v_gov record;
  v_gov_id uuid;
  v_city_id uuid;
  v_region record;
BEGIN
  -- 1. Country: Egypt (default)
  INSERT INTO public.countries (tenant_id, code, name, iso2, is_default, is_active, created_by, updated_by)
  VALUES (p_tenant_id, 'EG', 'جمهورية مصر العربية', 'EG', true, true, p_actor_user_id, p_actor_user_id)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  SELECT id INTO v_country_id
  FROM public.countries
  WHERE tenant_id = p_tenant_id AND code = 'EG'
  LIMIT 1;

  -- 2. Main Branch (created first so governorates & regions bind to it cleanly)
  INSERT INTO public.branches (
    tenant_id, code, name, is_main, is_active, country_id, address_line, created_by, updated_by
  )
  VALUES (
    p_tenant_id, 'BR-001', 'الفرع الرئيسي', true, true, v_country_id, 'المقر الرئيسي للشركة', p_actor_user_id, p_actor_user_id
  )
  ON CONFLICT (tenant_id, code) DO NOTHING;

  SELECT id INTO v_main_branch_id
  FROM public.branches
  WHERE tenant_id = p_tenant_id AND is_main = true AND archived_at IS NULL
  LIMIT 1;

  IF v_main_branch_id IS NULL THEN
    SELECT id INTO v_main_branch_id
    FROM public.branches
    WHERE tenant_id = p_tenant_id AND code = 'BR-001'
    LIMIT 1;
  END IF;

  -- 3. All 27 Egyptian Governorates + Default Cities & Regions
  FOR v_gov IN
    SELECT * FROM (VALUES
      ('EG-01', 'القاهرة'),
      ('EG-02', 'الجيزة'),
      ('EG-03', 'الإسكندرية'),
      ('EG-04', 'القليوبية'),
      ('EG-05', 'الدقهلية'),
      ('EG-06', 'الشرقية'),
      ('EG-07', 'الغربية'),
      ('EG-08', 'المنوفية'),
      ('EG-09', 'البحيرة'),
      ('EG-10', 'كفر الشيخ'),
      ('EG-11', 'دمياط'),
      ('EG-12', 'بورسعيد'),
      ('EG-13', 'الإسماعيلية'),
      ('EG-14', 'السويس'),
      ('EG-15', 'الفيوم'),
      ('EG-16', 'بني سويف'),
      ('EG-17', 'المنيا'),
      ('EG-18', 'أسيوط'),
      ('EG-19', 'سوهاج'),
      ('EG-20', 'قنا'),
      ('EG-21', 'الأقصر'),
      ('EG-22', 'أسوان'),
      ('EG-23', 'البحر الأحمر'),
      ('EG-24', 'الوادي الجديد'),
      ('EG-25', 'مطروح'),
      ('EG-26', 'شمال سيناء'),
      ('EG-27', 'جنوب سيناء')
    ) AS t(code, name)
  LOOP
    INSERT INTO public.governorates (
      tenant_id, country_id, code, name, default_branch_id, is_active, created_by, updated_by
    )
    VALUES (
      p_tenant_id, v_country_id, v_gov.code, v_gov.name, v_main_branch_id, true, p_actor_user_id, p_actor_user_id
    )
    ON CONFLICT (tenant_id, code) DO NOTHING;

    SELECT id INTO v_gov_id
    FROM public.governorates
    WHERE tenant_id = p_tenant_id AND code = v_gov.code;

    -- Default central city for every governorate
    INSERT INTO public.cities (
      tenant_id, governorate_id, code, name, is_active, created_by, updated_by
    )
    VALUES (
      p_tenant_id, v_gov_id, v_gov.code || '-C01', 'مدينة ' || v_gov.name, true, p_actor_user_id, p_actor_user_id
    )
    ON CONFLICT (tenant_id, code) DO NOTHING;

    SELECT id INTO v_city_id
    FROM public.cities
    WHERE tenant_id = p_tenant_id AND code = v_gov.code || '-C01';

    -- Default central region for every governorate
    INSERT INTO public.regions (
      tenant_id, governorate_id, city_id, code, name, default_branch_id, is_active, created_by, updated_by
    )
    VALUES (
      p_tenant_id, v_gov_id, v_city_id, v_gov.code || '-R00', 'وسط ' || v_gov.name, v_main_branch_id, true, p_actor_user_id, p_actor_user_id
    )
    ON CONFLICT (tenant_id, code) DO NOTHING;
  END LOOP;

  -- Rich Districts / Regions for major Egyptian Governorates
  FOR v_region IN
    SELECT * FROM (VALUES
      -- القاهرة
      ('EG-01', 'EG-01-R01', 'مدينة نصر'),
      ('EG-01', 'EG-01-R02', 'مصر الجديدة'),
      ('EG-01', 'EG-01-R03', 'التجمع الخامس - القاهرة الجديدة'),
      ('EG-01', 'EG-01-R04', 'المعادي'),
      ('EG-01', 'EG-01-R05', 'شبرا'),
      ('EG-01', 'EG-01-R06', 'حلوان'),
      ('EG-01', 'EG-01-R07', 'العباسية'),
      ('EG-01', 'EG-01-R08', 'المقطم'),
      ('EG-01', 'EG-01-R09', 'عين شمس'),
      ('EG-01', 'EG-01-R10', 'الشروق ومدينتي'),
      -- الجيزة
      ('EG-02', 'EG-02-R01', 'الدقي'),
      ('EG-02', 'EG-02-R02', 'المهندسين'),
      ('EG-02', 'EG-02-R03', 'الهرم'),
      ('EG-02', 'EG-02-R04', 'فيصل'),
      ('EG-02', 'EG-02-R05', 'مدينة 6 أكتوبر'),
      ('EG-02', 'EG-02-R06', 'الشيخ زايد'),
      ('EG-02', 'EG-02-R07', 'حدائق الأهرام'),
      ('EG-02', 'EG-02-R08', 'إمبابة'),
      -- الإسكندرية
      ('EG-03', 'EG-03-R01', 'سموحة'),
      ('EG-03', 'EG-03-R02', 'سيدي جابر'),
      ('EG-03', 'EG-03-R03', 'المنتزه'),
      ('EG-03', 'EG-03-R04', 'محطة الرمل'),
      ('EG-03', 'EG-03-R05', 'العجمي'),
      ('EG-03', 'EG-03-R06', 'برج العرب'),
      -- القليوبية
      ('EG-04', 'EG-04-R01', 'بنها'),
      ('EG-04', 'EG-04-R02', 'شبرا الخيمة'),
      ('EG-04', 'EG-04-R03', 'العبور'),
      -- الدقهلية
      ('EG-05', 'EG-05-R01', 'المنصورة'),
      ('EG-05', 'EG-05-R02', 'طلخا'),
      ('EG-05', 'EG-05-R03', 'ميت غمر'),
      -- الشرقية
      ('EG-06', 'EG-06-R01', 'الزقازيق'),
      ('EG-06', 'EG-06-R02', 'العاشر من رمضان'),
      ('EG-06', 'EG-06-R03', 'بلبيس'),
      -- الغربية
      ('EG-07', 'EG-07-R01', 'طنطا'),
      ('EG-07', 'EG-07-R02', 'المحلة الكبرى'),
      -- المنوفية
      ('EG-08', 'EG-08-R01', 'شبين الكوم'),
      ('EG-08', 'EG-08-R02', 'مدينة السادات'),
      -- البحيرة
      ('EG-09', 'EG-09-R01', 'دمنهور'),
      ('EG-09', 'EG-09-R02', 'كفر الدوار'),
      -- القناة والصعيد والبحر الأحمر
      ('EG-10', 'EG-10-R01', 'كفر الشيخ'),
      ('EG-11', 'EG-11-R01', 'دمياط الجديدة'),
      ('EG-12', 'EG-12-R01', 'حي الشرق بورسعيد'),
      ('EG-13', 'EG-13-R01', 'الشيخ زايد الإسماعيلية'),
      ('EG-14', 'EG-14-R01', 'حي السويس'),
      ('EG-15', 'EG-15-R01', 'مدينة الفيوم'),
      ('EG-16', 'EG-16-R01', 'مدينة بني سويف'),
      ('EG-17', 'EG-17-R01', 'المنيا الجديدة'),
      ('EG-18', 'EG-18-R01', 'مدينة أسيوط'),
      ('EG-19', 'EG-19-R01', 'مدينة سوهاج'),
      ('EG-20', 'EG-20-R01', 'مدينة قنا'),
      ('EG-21', 'EG-21-R01', 'مدينة الأقصر'),
      ('EG-22', 'EG-22-R01', 'مدينة أسوان'),
      ('EG-23', 'EG-23-R01', 'الغردقة'),
      ('EG-24', 'EG-24-R01', 'الخارجة'),
      ('EG-25', 'EG-25-R01', 'مرسى مطروح'),
      ('EG-26', 'EG-26-R01', 'العريش'),
      ('EG-27', 'EG-27-R01', 'شرم الشيخ')
    ) AS r(gov_code, reg_code, reg_name)
  LOOP
    SELECT g.id INTO v_gov_id FROM public.governorates g WHERE g.tenant_id = p_tenant_id AND g.code = v_region.gov_code;
    SELECT c.id INTO v_city_id FROM public.cities c WHERE c.tenant_id = p_tenant_id AND c.governorate_id = v_gov_id LIMIT 1;

    INSERT INTO public.regions (
      tenant_id, governorate_id, city_id, code, name, default_branch_id, is_active, created_by, updated_by
    )
    VALUES (
      p_tenant_id, v_gov_id, v_city_id, v_region.reg_code, v_region.reg_name, v_main_branch_id, true, p_actor_user_id, p_actor_user_id
    )
    ON CONFLICT (tenant_id, code) DO NOTHING;
  END LOOP;

  -- Link main branch geographic address if empty
  SELECT id INTO v_cairo_gov_id FROM public.governorates WHERE tenant_id = p_tenant_id AND code = 'EG-01' LIMIT 1;
  SELECT id INTO v_cairo_city_id FROM public.cities WHERE tenant_id = p_tenant_id AND governorate_id = v_cairo_gov_id LIMIT 1;
  SELECT id INTO v_cairo_region_id FROM public.regions WHERE tenant_id = p_tenant_id AND code = 'EG-01-R01' LIMIT 1;

  UPDATE public.branches
  SET governorate_id = COALESCE(governorate_id, v_cairo_gov_id),
      city_id = COALESCE(city_id, v_cairo_city_id),
      region_id = COALESCE(region_id, v_cairo_region_id)
  WHERE id = v_main_branch_id AND tenant_id = p_tenant_id;

  -- 4. Default Hierarchical Chart of Accounts
  INSERT INTO public.chart_of_accounts (tenant_id, code, name, account_type, is_group, is_system, created_by, updated_by)
  VALUES
    (p_tenant_id, '1000', 'الأصول', 'asset', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, '2000', 'الالتزامات', 'liability', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, '4000', 'الإيرادات', 'revenue', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, '5000', 'المصروفات', 'expense', true, true, p_actor_user_id, p_actor_user_id)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  SELECT id INTO v_acct_assets FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '1000';
  SELECT id INTO v_acct_liabilities FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '2000';
  SELECT id INTO v_acct_revenue FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '4000';
  SELECT id INTO v_acct_expenses FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '5000';

  INSERT INTO public.chart_of_accounts (tenant_id, code, name, account_type, parent_id, is_group, is_system, created_by, updated_by)
  VALUES (p_tenant_id, '1100', 'النقدية والخزائن', 'asset', v_acct_assets, true, true, p_actor_user_id, p_actor_user_id)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  SELECT id INTO v_acct_cash_group FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '1100';

  INSERT INTO public.chart_of_accounts (tenant_id, code, name, account_type, parent_id, is_group, is_system, created_by, updated_by)
  VALUES
    (p_tenant_id, '1101', 'الخزينة الرئيسية', 'asset', v_acct_cash_group, false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, '1201', 'قيمة شحنات بالمخزن', 'asset', v_acct_assets, false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, '2101', 'ضريبة القيمة المضافة', 'liability', v_acct_liabilities, false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, '2102', 'مستحقات عملاء التحصيل (COD)', 'liability', v_acct_liabilities, false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, '4101', 'إيرادات النقل والتوصيل', 'revenue', v_acct_revenue, false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, '4102', 'إيرادات التحصيل للغير', 'revenue', v_acct_revenue, false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, '5101', 'عمولات المناديب على الأوردرات', 'expense', v_acct_expenses, false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, '5102', 'عمولة البريد المصري', 'expense', v_acct_expenses, false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, '5103', 'إيجار المكتب', 'expense', v_acct_expenses, false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, '5104', 'مصروفات سفر وانتقالات', 'expense', v_acct_expenses, false, true, p_actor_user_id, p_actor_user_id)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  SELECT id INTO v_acct_main_cash FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '1101';
  SELECT id INTO v_acct_del_rev FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '4101';
  SELECT id INTO v_acct_col_rev FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '4102';
  SELECT id INTO v_acct_comm_exp FROM public.chart_of_accounts WHERE tenant_id = p_tenant_id AND code = '5101';

  -- 5. Shipment Types (5 canonical types from MASTER_SPEC)
  INSERT INTO public.shipment_types (tenant_id, code, name, description, is_system, is_active)
  VALUES
    (p_tenant_id, 'FDP', 'تسليم كامل للطرد', 'تسليم كامل محتويات الشحنة للمستلم.', true, true),
    (p_tenant_id, 'PDP', 'تسليم جزء من الطرد', 'تسليم جزئي لعدد من القطع وإرجاع الباقي.', true, true),
    (p_tenant_id, 'PTP', 'طرد مقابل طرد - استبدال', 'تسليم طرد بديل واستلام الطرد المرتجع في نفس المهمة.', true, true),
    (p_tenant_id, 'CLC', 'تحصيل أموال', 'مهمة تحصيل نقدي من المستلم.', true, true),
    (p_tenant_id, 'RTS', 'استرجاع طرد', 'إرجاع شحنة من المستلم أو المخزن إلى الراسل.', true, true)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- 6. Default Shipping Services
  INSERT INTO public.shipping_services (
    tenant_id, code, name, estimated_days_min, estimated_days_max, branch_id,
    delivery_revenue_account_id, collection_revenue_account_id, courier_commission_account_id,
    is_active, created_by, updated_by
  )
  VALUES
    (p_tenant_id, 'SRV-001', 'التوصيل القياسي (محافظات)', 2, 4, v_main_branch_id, v_acct_del_rev, v_acct_col_rev, v_acct_comm_exp, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'SRV-002', 'التوصيل السريع (القاهرة الكبرى)', 1, 1, v_main_branch_id, v_acct_del_rev, v_acct_col_rev, v_acct_comm_exp, true, p_actor_user_id, p_actor_user_id)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  SELECT id INTO v_srv_std_id FROM public.shipping_services WHERE tenant_id = p_tenant_id AND code = 'SRV-001';
  SELECT id INTO v_srv_exp_id FROM public.shipping_services WHERE tenant_id = p_tenant_id AND code = 'SRV-002';

  INSERT INTO public.shipping_service_types (tenant_id, service_id, shipment_type_id)
  SELECT p_tenant_id, v_srv_std_id, st.id
  FROM public.shipment_types st
  WHERE st.tenant_id = p_tenant_id
  ON CONFLICT DO NOTHING;

  INSERT INTO public.shipping_service_types (tenant_id, service_id, shipment_type_id)
  SELECT p_tenant_id, v_srv_exp_id, st.id
  FROM public.shipment_types st
  WHERE st.tenant_id = p_tenant_id AND st.code IN ('FDP', 'CLC', 'PTP')
  ON CONFLICT DO NOTHING;

  -- 7. Default Delivery Exception, Refusal, Return & Cancellation Reasons
  INSERT INTO public.delivery_exception_reasons (tenant_id, code, name, category, requires_note, is_system, created_by, updated_by)
  VALUES
    (p_tenant_id, 'RSN-001', 'المستلم غير متاح في الموقع', 'delivery_failed', false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'RSN-002', 'الهاتف مغلق أو لا يرد', 'delivery_failed', false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'RSN-003', 'العنوان غير واضح أو خاطئ', 'delivery_failed', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'RSN-004', 'طلب المستلم تأجيل التسليم', 'delivery_failed', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'RSN-005', 'طلب المستلم تغيير عنوان التسليم', 'exception', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'RSN-006', 'رفض المستلم استلام الشحنة', 'refused', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'RSN-007', 'اختلاف المواصفات أو رفض جزء من الطرد', 'refused', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'RSN-008', 'عدم توفر مبلغ التحصيل لدى المستلم', 'delivery_failed', false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'RSN-009', 'وجود تلف ظاهر بالطرد', 'return', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'RSN-010', 'منطقة خارج نطاق التغطية الحالي', 'exception', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'RSN-011', 'إلغاء الطلب من التاجر قبل الالتقاط', 'cancellation', false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'RSN-012', 'استنفاد محاولات التوصيل وإرجاع للراسل', 'return', false, true, p_actor_user_id, p_actor_user_id)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- 8. Movement Types, Auxiliary Journals & Journal Entry Types
  INSERT INTO public.movement_types (tenant_id, code, name, direction, is_system, created_by, updated_by)
  VALUES
    (p_tenant_id, 'MOV-001', 'التقاط من مقر العميل', 'inbound', true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'MOV-002', 'استلام بمخزن الفرع', 'inbound', true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'MOV-003', 'نقل صادر بين الفروع', 'internal', true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'MOV-004', 'نقل وارد بين الفروع', 'internal', true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'MOV-005', 'خروج للتوصيل مع المندوب', 'outbound', true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'MOV-006', 'تسليم للمستلم', 'outbound', true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'MOV-007', 'إعادة للمخزن بعد التعذر', 'return', true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'MOV-008', 'تسليم المرتجع للراسل', 'return', true, p_actor_user_id, p_actor_user_id)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO public.auxiliary_journals (tenant_id, code, name, journal_category, is_system, created_by, updated_by)
  VALUES
    (p_tenant_id, 'JRN-CASH', 'يومية الخزينة والنقدية', 'cash', true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'JRN-OPS', 'يومية إيرادات الشحن والتشغيل', 'operations', true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'JRN-STL', 'يومية تسويات العملاء والمناديب', 'settlements', true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'JRN-GEN', 'يومية القيود العامة والتسوية', 'general', true, p_actor_user_id, p_actor_user_id)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO public.journal_entry_types (tenant_id, code, name, is_reversal_type, is_system, created_by, updated_by)
  VALUES
    (p_tenant_id, 'ENT-COLL', 'قيد تحصيل نقدية', false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'ENT-PAY', 'قيد سداد عميل أو عمولة', false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'ENT-EXP', 'قيد مصروف تشغيلي', false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'ENT-TRN', 'قيد تحويل بين الخزائن', false, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'ENT-REV', 'قيد عكسي لتصحيح مستند معتمد', true, true, p_actor_user_id, p_actor_user_id)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- 9. Default Cashbox & Owner Custodian
  INSERT INTO public.cashboxes (
    tenant_id, code, name, branch_id, ledger_account_id,
    is_active, allow_deposit, allow_withdraw, allow_transfer_in, allow_transfer_out,
    created_by, updated_by
  )
  VALUES (
    p_tenant_id, 'CSH-001', 'الخزينة الرئيسية', v_main_branch_id, v_acct_main_cash,
    true, true, true, true, true, p_actor_user_id, p_actor_user_id
  )
  ON CONFLICT (tenant_id, code) DO NOTHING;

  SELECT id INTO v_cashbox_id FROM public.cashboxes WHERE tenant_id = p_tenant_id AND code = 'CSH-001';

  SELECT id INTO v_owner_membership_id
  FROM public.tenant_memberships
  WHERE tenant_id = p_tenant_id AND role_key = 'company_owner' AND is_active = true
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_cashbox_id IS NOT NULL AND v_owner_membership_id IS NOT NULL THEN
    INSERT INTO public.cashbox_custodians (tenant_id, cashbox_id, membership_id, is_active, created_by)
    VALUES (p_tenant_id, v_cashbox_id, v_owner_membership_id, true, p_actor_user_id)
    ON CONFLICT (tenant_id, cashbox_id, membership_id) DO NOTHING;
  END IF;

  -- 10. Payment Methods, Payment Terms, Delivery Types, Units, Tax Profile & Sequences
  INSERT INTO public.payment_methods (tenant_id, code, name)
  VALUES
    (p_tenant_id, 'CASH', 'نقدي (Cash)'),
    (p_tenant_id, 'BANK_TRANSFER', 'تحويل بنكي'),
    (p_tenant_id, 'VODAFONE_CASH', 'فودافون كاش / محفظة إلكترونية'),
    (p_tenant_id, 'POST', 'البريد المصري')
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO public.payment_terms (tenant_id, code, name)
  VALUES
    (p_tenant_id, 'COD', 'واجبة التحصيل عند التسليم'),
    (p_tenant_id, 'PREPAID', 'مدفوعة مسبقًا (Prepaid)'),
    (p_tenant_id, 'POSTPAID', 'آجلة / تسوية دورية'),
    (p_tenant_id, 'CASH_PAID', 'مسددة نقدًا عند الإنشاء')
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO public.delivery_types (tenant_id, code, name)
  VALUES
    (p_tenant_id, 'DOOR_TO_DOOR', 'من الباب إلى الباب'),
    (p_tenant_id, 'BRANCH_PICKUP', 'استلام من مقر الفرع'),
    (p_tenant_id, 'POST_OFFICE', 'تسليم مكتب بريد')
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO public.units_of_measure (tenant_id, code, name, unit_category)
  VALUES
    (p_tenant_id, 'KG', 'كيلوجرام', 'weight'),
    (p_tenant_id, 'CM', 'سنتيمتر', 'dimension'),
    (p_tenant_id, 'PCS', 'قطعة', 'count')
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO public.tax_profiles (tenant_id, code, name, rate_percent, is_default)
  VALUES (p_tenant_id, 'TAX-EXEMPT', 'ملف ضريبي مبدئي (0% لحين اعتماد السياسة)', 0, true)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO public.numbering_sequences (tenant_id, entity_key, label, prefix, next_number, padding_length)
  VALUES
    (p_tenant_id, 'shipments', 'بوالص الشحن', 'SHP', 1, 7),
    (p_tenant_id, 'pickup_lists', 'قوائم الالتقاط', 'PKP', 1, 6),
    (p_tenant_id, 'delivery_lists', 'قوائم التوصيل', 'DLV', 1, 6),
    (p_tenant_id, 'return_lists', 'قوائم المرتجعات', 'RTN', 1, 6),
    (p_tenant_id, 'receipt_vouchers', 'سندات القبض', 'RCV', 1, 6),
    (p_tenant_id, 'payment_vouchers', 'سندات الصرف', 'PAY', 1, 6),
    (p_tenant_id, 'journal_entries', 'القيود المحاسبية', 'JRN', 1, 6)
  ON CONFLICT (tenant_id, entity_key) DO NOTHING;

  -- Mark Phase 2 onboarding milestone
  UPDATE public.tenant_onboarding
  SET step_status = 'phase2_seeded'
  WHERE tenant_id = p_tenant_id AND step_status = 'phase1_initialized';

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id,
    p_actor_user_id,
    'tenant.phase2_defaults_seeded',
    'tenants',
    p_tenant_id,
    jsonb_build_object('governorates', 27, 'main_branch_code', 'BR-001', 'cashbox_code', 'CSH-001'),
    'migration_seed'
  );
END;
$$;

REVOKE ALL ON FUNCTION app_private.seed_tenant_phase2_defaults(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 10. Hook Phase 2 Seeding into app_private.onboard_tenant (without editing 0001)
-- ----------------------------------------------------------------------------
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

  -- Seed Phase 2 defaults atomically within the same transaction
  PERFORM app_private.seed_tenant_phase2_defaults(v_tenant_id, p_actor_user_id);

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

-- ----------------------------------------------------------------------------
-- 11. Safe Backfill for Any Tenants Created During Phase 1
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant record;
BEGIN
  FOR v_tenant IN SELECT id, created_by FROM public.tenants LOOP
    PERFORM app_private.seed_tenant_phase2_defaults(v_tenant.id, v_tenant.created_by);
  END LOOP;
END $$;
