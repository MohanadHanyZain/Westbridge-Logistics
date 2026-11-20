-- ============================================================================
-- Migration 0006: Phase 5 - Couriers, Commission Lists, Routes & User Binding
-- ============================================================================
-- Implements ADR-012 (OQ-13):
-- - Accrual timing: accrued upon confirmed shipment delivery, separated from
--   cash ledger, and settled only after cash handover & admin approval (Phase 9).
-- - Priority cascade: specific (governorate + region) rule -> governorate-wide
--   rule -> courier profile default type & value.
-- - Links account_subjects.courier_id to public.couriers with tenant-locked
--   composite FK, without auto-creating login accounts when creating a courier.
-- - Seeds protected default route ('GENERAL') and default commission list ('0')
--   on onboarding & backfills existing tenants.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Fleet Vehicles & Drivers (Supporting Route Definitions)
-- ----------------------------------------------------------------------------
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  plate_number text,
  vehicle_type text NOT NULL DEFAULT 'van'
    CHECK (vehicle_type IN ('motorcycle', 'car', 'van', 'truck')),
  capacity_kg numeric(10,2) CHECK (capacity_kg IS NULL OR capacity_kg > 0),
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_vehicles_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_vehicles_tenant_id_id UNIQUE (tenant_id, id)
);

CREATE INDEX idx_vehicles_tenant_active ON public.vehicles (tenant_id, is_active) WHERE archived_at IS NULL;

CREATE TRIGGER trg_vehicles_updated_at
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  mobile text,
  license_number text,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_drivers_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_drivers_tenant_id_id UNIQUE (tenant_id, id)
);

CREATE INDEX idx_drivers_tenant_active ON public.drivers (tenant_id, is_active) WHERE archived_at IS NULL;

CREATE TRIGGER trg_drivers_updated_at
  BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Courier Routes & Ordered Stops
-- ----------------------------------------------------------------------------
CREATE TABLE public.courier_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  description text,
  vehicle_id uuid,
  driver_id uuid,
  is_system_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_courier_routes_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_courier_routes_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_cr_vehicle FOREIGN KEY (tenant_id, vehicle_id) REFERENCES public.vehicles(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cr_driver FOREIGN KEY (tenant_id, driver_id) REFERENCES public.drivers(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_courier_routes_one_default
  ON public.courier_routes (tenant_id)
  WHERE is_system_default = true;

CREATE TRIGGER trg_courier_routes_updated_at
  BEFORE UPDATE ON public.courier_routes
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE OR REPLACE FUNCTION app_private.protect_default_courier_route()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system_default OR OLD.code = 'GENERAL' THEN
      RAISE EXCEPTION 'Cannot delete protected default courier route GENERAL';
    END IF;
    RETURN OLD;
  END IF;

  IF (OLD.is_system_default OR OLD.code = 'GENERAL') AND (NEW.is_active = false OR NEW.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot deactivate or archive protected default courier route GENERAL';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_default_courier_route
  BEFORE UPDATE OR DELETE ON public.courier_routes
  FOR EACH ROW EXECUTE FUNCTION app_private.protect_default_courier_route();

CREATE TABLE public.courier_route_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  route_id uuid NOT NULL,
  stop_order integer NOT NULL CHECK (stop_order >= 1),
  governorate_id uuid NOT NULL,
  region_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_courier_route_stops_order UNIQUE (tenant_id, route_id, stop_order),
  CONSTRAINT fk_crs_route FOREIGN KEY (tenant_id, route_id) REFERENCES public.courier_routes(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_crs_gov FOREIGN KEY (tenant_id, governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_crs_region FOREIGN KEY (tenant_id, region_id) REFERENCES public.regions(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_courier_route_stops_route ON public.courier_route_stops (tenant_id, route_id, stop_order);

CREATE TRIGGER trg_courier_route_stops_updated_at
  BEFORE UPDATE ON public.courier_route_stops
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Courier Commission Lists & Geographic Rules
-- ----------------------------------------------------------------------------
CREATE TABLE public.courier_commission_lists (
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
  CONSTRAINT uq_ccl_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_ccl_tenant_id_id UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX uq_ccl_one_default
  ON public.courier_commission_lists (tenant_id)
  WHERE is_system_default = true;

CREATE TRIGGER trg_courier_commission_lists_updated_at
  BEFORE UPDATE ON public.courier_commission_lists
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE OR REPLACE FUNCTION app_private.protect_default_commission_list()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system_default OR OLD.code = '0' THEN
      RAISE EXCEPTION 'Cannot delete protected default commission list';
    END IF;
    RETURN OLD;
  END IF;

  IF (OLD.is_system_default OR OLD.code = '0') AND (NEW.is_active = false OR NEW.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Cannot deactivate or archive protected default commission list';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_default_commission_list
  BEFORE UPDATE OR DELETE ON public.courier_commission_lists
  FOR EACH ROW EXECUTE FUNCTION app_private.protect_default_commission_list();

CREATE TABLE public.courier_commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  commission_list_id uuid NOT NULL,
  governorate_id uuid NOT NULL,
  region_id uuid,
  commission_type text NOT NULL
    CHECK (commission_type IN ('delivery_percent', 'delivery_plus_collection_percent', 'fixed_amount')),
  commission_value numeric(12,2) NOT NULL CHECK (commission_value >= 0),
  valid_from date,
  valid_to date,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ccr_dates CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  CONSTRAINT chk_ccr_percent CHECK (
    commission_type = 'fixed_amount' OR commission_value <= 100
  ),
  CONSTRAINT fk_ccr_list FOREIGN KEY (tenant_id, commission_list_id) REFERENCES public.courier_commission_lists(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_ccr_gov FOREIGN KEY (tenant_id, governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ccr_region FOREIGN KEY (tenant_id, region_id) REFERENCES public.regions(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_ccr_active_gov_region
  ON public.courier_commission_rules (
    tenant_id,
    commission_list_id,
    governorate_id,
    COALESCE(region_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE is_active = true;

CREATE INDEX idx_ccr_list_gov ON public.courier_commission_rules (tenant_id, commission_list_id, governorate_id);

CREATE TRIGGER trg_courier_commission_rules_updated_at
  BEFORE UPDATE ON public.courier_commission_rules
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Couriers Master Table & Account Subject Composite Foreign Key
-- ----------------------------------------------------------------------------
CREATE TABLE public.couriers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  branch_id uuid,
  ledger_account_id uuid,
  custody_account_id uuid,
  default_route_id uuid NOT NULL,
  commission_list_id uuid NOT NULL,
  default_commission_type text NOT NULL DEFAULT 'fixed_amount'
    CHECK (default_commission_type IN ('delivery_percent', 'delivery_plus_collection_percent', 'fixed_amount')),
  default_commission_value numeric(12,2) NOT NULL DEFAULT 0 CHECK (default_commission_value >= 0),
  country_id uuid,
  governorate_id uuid,
  city_id uuid,
  region_id uuid,
  phone text,
  mobile text NOT NULL CHECK (char_length(trim(mobile)) >= 6),
  po_box text,
  postal_code text,
  address_line text,
  email text,
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_couriers_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_couriers_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT chk_couriers_default_pct CHECK (
    default_commission_type = 'fixed_amount' OR default_commission_value <= 100
  ),
  CONSTRAINT fk_couriers_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_couriers_ledger_acc FOREIGN KEY (tenant_id, ledger_account_id) REFERENCES public.chart_of_accounts(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_couriers_custody_acc FOREIGN KEY (tenant_id, custody_account_id) REFERENCES public.chart_of_accounts(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_couriers_route FOREIGN KEY (tenant_id, default_route_id) REFERENCES public.courier_routes(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_couriers_comm_list FOREIGN KEY (tenant_id, commission_list_id) REFERENCES public.courier_commission_lists(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_couriers_country FOREIGN KEY (tenant_id, country_id) REFERENCES public.countries(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_couriers_gov FOREIGN KEY (tenant_id, governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_couriers_city FOREIGN KEY (tenant_id, city_id) REFERENCES public.cities(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_couriers_region FOREIGN KEY (tenant_id, region_id) REFERENCES public.regions(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_couriers_tenant_active ON public.couriers (tenant_id, is_active) WHERE archived_at IS NULL;
CREATE INDEX idx_couriers_branch ON public.couriers (tenant_id, branch_id);

CREATE TRIGGER trg_couriers_updated_at
  BEFORE UPDATE ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- Enforce tenant-locked composite FK from account_subjects.courier_id to couriers
ALTER TABLE public.account_subjects
  ADD CONSTRAINT fk_as_courier
    FOREIGN KEY (tenant_id, courier_id) REFERENCES public.couriers(tenant_id, id) ON DELETE RESTRICT;

CREATE INDEX idx_account_subjects_courier
  ON public.account_subjects (tenant_id, courier_id)
  WHERE courier_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 5. Server-Side Commission Calculator RPC (ADR-012)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_courier_commission(
  p_tenant_id uuid,
  p_courier_id uuid,
  p_governorate_id uuid,
  p_region_id uuid DEFAULT NULL,
  p_delivery_fee numeric DEFAULT 0,
  p_collection_fee numeric DEFAULT 0,
  p_calc_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_courier public.couriers%ROWTYPE;
  v_rule public.courier_commission_rules%ROWTYPE;
  v_match_tier text := 'courier_default';
  v_type text;
  v_val numeric(12,2);
  v_rule_id uuid := NULL;
  v_base_amount numeric(12,2) := 0;
  v_commission_amount numeric(12,2) := 0;
  v_del_fee numeric(12,2) := GREATEST(COALESCE(p_delivery_fee, 0), 0);
  v_col_fee numeric(12,2) := GREATEST(COALESCE(p_collection_fee, 0), 0);
BEGIN
  IF NOT (
    app_private.current_user_is_platform_admin()
    OR app_private.user_belongs_to_tenant(p_tenant_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: tenant membership required';
  END IF;

  SELECT * INTO v_courier
  FROM public.couriers
  WHERE id = p_courier_id
    AND tenant_id = p_tenant_id
    AND archived_at IS NULL;

  IF v_courier.id IS NULL THEN
    RAISE EXCEPTION 'Courier not found for tenant';
  END IF;

  -- Tier 1: Specific governorate + specific region
  IF p_region_id IS NOT NULL THEN
    SELECT * INTO v_rule
    FROM public.courier_commission_rules
    WHERE tenant_id = p_tenant_id
      AND commission_list_id = v_courier.commission_list_id
      AND governorate_id = p_governorate_id
      AND region_id = p_region_id
      AND is_active = true
      AND (valid_from IS NULL OR p_calc_date >= valid_from)
      AND (valid_to IS NULL OR p_calc_date <= valid_to)
    LIMIT 1;
  END IF;

  IF v_rule.id IS NOT NULL THEN
    v_match_tier := 'region_rule';
    v_type := v_rule.commission_type;
    v_val := v_rule.commission_value;
    v_rule_id := v_rule.id;
  ELSE
    -- Tier 2: Specific governorate + all regions (region_id IS NULL)
    SELECT * INTO v_rule
    FROM public.courier_commission_rules
    WHERE tenant_id = p_tenant_id
      AND commission_list_id = v_courier.commission_list_id
      AND governorate_id = p_governorate_id
      AND region_id IS NULL
      AND is_active = true
      AND (valid_from IS NULL OR p_calc_date >= valid_from)
      AND (valid_to IS NULL OR p_calc_date <= valid_to)
    LIMIT 1;

    IF v_rule.id IS NOT NULL THEN
      v_match_tier := 'governorate_rule';
      v_type := v_rule.commission_type;
      v_val := v_rule.commission_value;
      v_rule_id := v_rule.id;
    ELSE
      -- Tier 3: Courier default commission profile
      v_match_tier := 'courier_default';
      v_type := v_courier.default_commission_type;
      v_val := v_courier.default_commission_value;
    END IF;
  END IF;

  IF v_type = 'delivery_percent' THEN
    v_base_amount := v_del_fee;
    v_commission_amount := ROUND(v_del_fee * (v_val / 100.0), 2);
  ELSIF v_type = 'delivery_plus_collection_percent' THEN
    v_base_amount := v_del_fee + v_col_fee;
    v_commission_amount := ROUND((v_del_fee + v_col_fee) * (v_val / 100.0), 2);
  ELSE
    v_base_amount := v_del_fee + v_col_fee;
    v_commission_amount := ROUND(v_val, 2);
  END IF;

  RETURN jsonb_build_object(
    'accrual_trigger', 'on_delivery',
    'match_tier', v_match_tier,
    'courier_id', v_courier.id,
    'courier_code', v_courier.code,
    'courier_name', v_courier.name,
    'commission_list_id', v_courier.commission_list_id,
    'rule_id', v_rule_id,
    'commission_type', v_type,
    'commission_value', v_val,
    'delivery_fee_base', v_del_fee,
    'collection_fee_base', v_col_fee,
    'commission_base_amount', v_base_amount,
    'commission_amount', v_commission_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_courier_commission(uuid, uuid, uuid, uuid, numeric, numeric, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_courier_commission(uuid, uuid, uuid, uuid, numeric, numeric, date) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Upgrade Phase 4 User Directory & Provisioning RPCs for Courier Binding
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.list_tenant_users_directory(uuid);

CREATE OR REPLACE FUNCTION public.list_tenant_users_directory(p_tenant_id uuid)
RETURNS TABLE (
  membership_id uuid,
  tenant_id uuid,
  user_id uuid,
  username text,
  display_name text,
  account_subject_type text,
  role_key text,
  role_id uuid,
  role_name text,
  is_active boolean,
  must_change_password boolean,
  client_id uuid,
  client_code text,
  client_name text,
  courier_id uuid,
  courier_code text,
  courier_name text,
  branch_ids uuid[],
  branch_names text[],
  created_at timestamptz
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
    OR app_private.user_has_permission(p_tenant_id, 'users.read', NULL)
  ) THEN
    RAISE EXCEPTION 'Forbidden: users.read permission required';
  END IF;

  RETURN QUERY
  SELECT
    tm.id AS membership_id,
    tm.tenant_id,
    tm.user_id,
    tm.username,
    p.display_name,
    tm.account_subject_type,
    tm.role_key,
    r.id AS role_id,
    COALESCE(r.name, tm.role_key) AS role_name,
    tm.is_active,
    tm.must_change_password,
    asub.client_id,
    cl.code AS client_code,
    cl.name AS client_name,
    asub.courier_id,
    cr.code AS courier_code,
    cr.name AS courier_name,
    COALESCE(
      (SELECT array_agg(mb.branch_id ORDER BY mb.is_default DESC)
       FROM public.membership_branches mb
       WHERE mb.tenant_id = tm.tenant_id AND mb.membership_id = tm.id),
      ARRAY[]::uuid[]
    ) AS branch_ids,
    COALESCE(
      (SELECT array_agg(br.name ORDER BY mb.is_default DESC)
       FROM public.membership_branches mb
       JOIN public.branches br ON br.id = mb.branch_id AND br.tenant_id = mb.tenant_id
       WHERE mb.tenant_id = tm.tenant_id AND mb.membership_id = tm.id),
      ARRAY[]::text[]
    ) AS branch_names,
    tm.created_at
  FROM public.tenant_memberships tm
  JOIN public.profiles p ON p.id = tm.user_id
  LEFT JOIN public.membership_roles mr
    ON mr.tenant_id = tm.tenant_id AND mr.membership_id = tm.id AND mr.is_primary = true
  LEFT JOIN public.roles r
    ON r.tenant_id = tm.tenant_id AND r.id = mr.role_id
  LEFT JOIN public.account_subjects asub
    ON asub.tenant_id = tm.tenant_id AND asub.membership_id = tm.id
  LEFT JOIN public.clients cl
    ON cl.tenant_id = tm.tenant_id AND cl.id = asub.client_id
  LEFT JOIN public.couriers cr
    ON cr.tenant_id = tm.tenant_id AND cr.id = asub.courier_id
  WHERE tm.tenant_id = p_tenant_id
  ORDER BY
    CASE WHEN tm.role_key = 'company_owner' THEN 0 ELSE 1 END,
    tm.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_tenant_users_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tenant_users_directory(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_tenant_permissions(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_membership public.tenant_memberships%ROWTYPE;
  v_perms jsonb;
  v_branches jsonb;
  v_client_id uuid;
  v_courier_id uuid;
BEGIN
  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RETURN jsonb_build_object('permissions', '[]'::jsonb, 'branch_ids', '[]'::jsonb, 'client_id', NULL, 'courier_id', NULL);
  END IF;

  SELECT * INTO v_membership
  FROM public.tenant_memberships
  WHERE tenant_id = p_tenant_id AND user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF v_membership.role_key = 'company_owner' THEN
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('permission_key', key, 'scope', 'tenant')),
      '[]'::jsonb
    )
    INTO v_perms
    FROM public.permissions;
  ELSE
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('permission_key', rp.permission_key, 'scope', rp.scope)),
      '[]'::jsonb
    )
    INTO v_perms
    FROM public.membership_roles mr
    JOIN public.roles r ON r.id = mr.role_id AND r.tenant_id = mr.tenant_id AND r.is_active = true
    JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.tenant_id = r.tenant_id
    WHERE mr.tenant_id = p_tenant_id
      AND mr.membership_id = v_membership.id;
  END IF;

  SELECT COALESCE(jsonb_agg(branch_id), '[]'::jsonb)
  INTO v_branches
  FROM public.membership_branches
  WHERE tenant_id = p_tenant_id AND membership_id = v_membership.id;

  SELECT client_id, courier_id INTO v_client_id, v_courier_id
  FROM public.account_subjects
  WHERE tenant_id = p_tenant_id AND membership_id = v_membership.id AND is_active = true;

  RETURN jsonb_build_object(
    'membership_id', v_membership.id,
    'role_key', v_membership.role_key,
    'account_subject_type', v_membership.account_subject_type,
    'client_id', v_client_id,
    'courier_id', v_courier_id,
    'branch_ids', v_branches,
    'permissions', v_perms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_tenant_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_permissions(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.srv_provision_tenant_user(uuid, uuid, uuid, text, text, text, uuid, uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.srv_provision_tenant_user(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_new_user_id uuid,
  p_username text,
  p_display_name text,
  p_auth_email text,
  p_role_id uuid,
  p_client_id uuid DEFAULT NULL,
  p_branch_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_courier_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_clean_username text := lower(trim(p_username));
  v_clean_email text := lower(trim(p_auth_email));
  v_role public.roles%ROWTYPE;
  v_membership_id uuid;
  v_branch_id uuid;
  v_idx integer := 0;
BEGIN
  SELECT * INTO v_role
  FROM public.roles
  WHERE id = p_role_id AND tenant_id = p_tenant_id AND is_active = true;

  IF v_role.id IS NULL THEN
    RAISE EXCEPTION 'Role not found or inactive for tenant';
  END IF;

  IF v_role.default_subject_type = 'client' AND p_client_id IS NULL THEN
    RAISE EXCEPTION 'Client selection is required for client roles';
  END IF;

  IF v_role.default_subject_type = 'courier' AND p_courier_id IS NULL THEN
    RAISE EXCEPTION 'Courier selection is required for courier roles';
  END IF;

  IF p_client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients WHERE id = p_client_id AND tenant_id = p_tenant_id AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Selected client does not belong to this tenant';
  END IF;

  IF p_courier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.couriers WHERE id = p_courier_id AND tenant_id = p_tenant_id AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Selected courier does not belong to this tenant';
  END IF;

  INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
  VALUES (p_new_user_id, trim(p_display_name), false, true)
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        is_active = true;

  INSERT INTO public.tenant_memberships (
    tenant_id, user_id, username, account_subject_type, role_key,
    is_active, must_change_password, created_by, updated_by
  )
  VALUES (
    p_tenant_id, p_new_user_id, v_clean_username, v_role.default_subject_type, v_role.code,
    true, true, p_actor_user_id, p_actor_user_id
  )
  RETURNING id INTO v_membership_id;

  INSERT INTO app_private.auth_identities (user_id, scope_type, tenant_id, username, auth_email, is_active)
  VALUES (p_new_user_id, 'tenant', p_tenant_id, v_clean_username, v_clean_email, true);

  INSERT INTO public.membership_roles (tenant_id, membership_id, role_id, is_primary, created_by)
  VALUES (p_tenant_id, v_membership_id, v_role.id, true, p_actor_user_id);

  INSERT INTO public.account_subjects (
    tenant_id, membership_id, subject_type, client_id, courier_id, is_active, created_by, updated_by
  )
  VALUES (
    p_tenant_id,
    v_membership_id,
    v_role.default_subject_type,
    CASE WHEN v_role.default_subject_type = 'client' THEN p_client_id ELSE NULL END,
    CASE WHEN v_role.default_subject_type = 'courier' THEN p_courier_id ELSE NULL END,
    true,
    p_actor_user_id,
    p_actor_user_id
  );

  IF p_branch_ids IS NOT NULL THEN
    FOREACH v_branch_id IN ARRAY p_branch_ids LOOP
      v_idx := v_idx + 1;
      INSERT INTO public.membership_branches (tenant_id, membership_id, branch_id, is_default, created_by)
      VALUES (p_tenant_id, v_membership_id, v_branch_id, (v_idx = 1), p_actor_user_id)
      ON CONFLICT (tenant_id, membership_id, branch_id) DO NOTHING;
    END LOOP;
  END IF;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id,
    p_actor_user_id,
    'tenant_user.created',
    'tenant_memberships',
    v_membership_id,
    jsonb_build_object(
      'username', v_clean_username,
      'role_code', v_role.code,
      'subject_type', v_role.default_subject_type,
      'client_id', p_client_id,
      'courier_id', p_courier_id,
      'branch_count', v_idx
    ),
    'edge_function'
  );

  RETURN v_membership_id;
END;
$$;

REVOKE ALL ON FUNCTION public.srv_provision_tenant_user(uuid, uuid, uuid, text, text, text, uuid, uuid, uuid[], uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_provision_tenant_user(uuid, uuid, uuid, text, text, text, uuid, uuid, uuid[], uuid)
  TO service_role;

DROP FUNCTION IF EXISTS public.srv_update_tenant_user_assignment(uuid, uuid, uuid, text, uuid, uuid, uuid[]);

CREATE OR REPLACE FUNCTION public.srv_update_tenant_user_assignment(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_display_name text,
  p_role_id uuid,
  p_client_id uuid DEFAULT NULL,
  p_branch_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_courier_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_existing public.tenant_memberships%ROWTYPE;
  v_role public.roles%ROWTYPE;
  v_branch_id uuid;
  v_idx integer := 0;
BEGIN
  SELECT * INTO v_existing
  FROM public.tenant_memberships
  WHERE id = p_membership_id AND tenant_id = p_tenant_id;

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'Membership not found';
  END IF;

  SELECT * INTO v_role
  FROM public.roles
  WHERE id = p_role_id AND tenant_id = p_tenant_id AND is_active = true;

  IF v_role.id IS NULL THEN
    RAISE EXCEPTION 'Target role not found';
  END IF;

  IF v_existing.role_key = 'company_owner' AND v_role.code <> 'company_owner' THEN
    RAISE EXCEPTION 'Cannot downgrade company_owner role';
  END IF;

  IF v_role.default_subject_type = 'client' AND p_client_id IS NULL THEN
    RAISE EXCEPTION 'Client selection is required for client roles';
  END IF;

  IF v_role.default_subject_type = 'courier' AND p_courier_id IS NULL THEN
    RAISE EXCEPTION 'Courier selection is required for courier roles';
  END IF;

  IF p_courier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.couriers WHERE id = p_courier_id AND tenant_id = p_tenant_id AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Selected courier does not belong to this tenant';
  END IF;

  UPDATE public.profiles
  SET display_name = trim(p_display_name)
  WHERE id = v_existing.user_id;

  UPDATE public.tenant_memberships
  SET role_key = v_role.code,
      account_subject_type = v_role.default_subject_type,
      updated_by = p_actor_user_id
  WHERE id = v_existing.id AND tenant_id = p_tenant_id;

  DELETE FROM public.membership_roles
  WHERE tenant_id = p_tenant_id AND membership_id = v_existing.id AND is_primary = true;

  INSERT INTO public.membership_roles (tenant_id, membership_id, role_id, is_primary, created_by)
  VALUES (p_tenant_id, v_existing.id, v_role.id, true, p_actor_user_id)
  ON CONFLICT (tenant_id, membership_id, role_id) DO UPDATE SET is_primary = true;

  INSERT INTO public.account_subjects (
    tenant_id, membership_id, subject_type, client_id, courier_id, is_active, created_by, updated_by
  )
  VALUES (
    p_tenant_id,
    v_existing.id,
    v_role.default_subject_type,
    CASE WHEN v_role.default_subject_type = 'client' THEN p_client_id ELSE NULL END,
    CASE WHEN v_role.default_subject_type = 'courier' THEN p_courier_id ELSE NULL END,
    true,
    p_actor_user_id,
    p_actor_user_id
  )
  ON CONFLICT (tenant_id, membership_id) DO UPDATE
    SET subject_type = EXCLUDED.subject_type,
        client_id = EXCLUDED.client_id,
        courier_id = EXCLUDED.courier_id,
        updated_by = p_actor_user_id;

  DELETE FROM public.membership_branches
  WHERE tenant_id = p_tenant_id AND membership_id = v_existing.id;

  IF p_branch_ids IS NOT NULL THEN
    FOREACH v_branch_id IN ARRAY p_branch_ids LOOP
      v_idx := v_idx + 1;
      INSERT INTO public.membership_branches (tenant_id, membership_id, branch_id, is_default, created_by)
      VALUES (p_tenant_id, v_existing.id, v_branch_id, (v_idx = 1), p_actor_user_id)
      ON CONFLICT (tenant_id, membership_id, branch_id) DO NOTHING;
    END LOOP;
  END IF;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id,
    p_actor_user_id,
    'tenant_user.updated',
    'tenant_memberships',
    v_existing.id,
    jsonb_build_object(
      'role_code', v_role.code,
      'subject_type', v_role.default_subject_type,
      'client_id', p_client_id,
      'courier_id', p_courier_id
    ),
    'edge_function'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.srv_update_tenant_user_assignment(uuid, uuid, uuid, text, uuid, uuid, uuid[], uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_update_tenant_user_assignment(uuid, uuid, uuid, text, uuid, uuid, uuid[], uuid)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 7. Row Level Security for Phase 5 Tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers FORCE ROW LEVEL SECURITY;

ALTER TABLE public.courier_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_routes FORCE ROW LEVEL SECURITY;

ALTER TABLE public.courier_route_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_route_stops FORCE ROW LEVEL SECURITY;

ALTER TABLE public.courier_commission_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_commission_lists FORCE ROW LEVEL SECURITY;

ALTER TABLE public.courier_commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_commission_rules FORCE ROW LEVEL SECURITY;

ALTER TABLE public.couriers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couriers FORCE ROW LEVEL SECURITY;

CREATE POLICY vehicles_select_policy ON public.vehicles
  FOR SELECT TO authenticated
  USING (app_private.current_user_is_platform_admin() OR app_private.user_belongs_to_tenant(tenant_id));

CREATE POLICY vehicles_write_policy ON public.vehicles
  FOR ALL TO authenticated
  USING (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'couriers.manage', NULL)
  )
  WITH CHECK (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'couriers.manage', NULL)
  );

CREATE POLICY drivers_select_policy ON public.drivers
  FOR SELECT TO authenticated
  USING (app_private.current_user_is_platform_admin() OR app_private.user_belongs_to_tenant(tenant_id));

CREATE POLICY drivers_write_policy ON public.drivers
  FOR ALL TO authenticated
  USING (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'couriers.manage', NULL)
  )
  WITH CHECK (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'couriers.manage', NULL)
  );

CREATE POLICY courier_routes_select_policy ON public.courier_routes
  FOR SELECT TO authenticated
  USING (app_private.current_user_is_platform_admin() OR app_private.user_belongs_to_tenant(tenant_id));

CREATE POLICY courier_routes_write_policy ON public.courier_routes
  FOR ALL TO authenticated
  USING (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'couriers.manage', NULL)
  )
  WITH CHECK (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'couriers.manage', NULL)
  );

CREATE POLICY courier_route_stops_select_policy ON public.courier_route_stops
  FOR SELECT TO authenticated
  USING (app_private.current_user_is_platform_admin() OR app_private.user_belongs_to_tenant(tenant_id));

CREATE POLICY courier_route_stops_write_policy ON public.courier_route_stops
  FOR ALL TO authenticated
  USING (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'couriers.manage', NULL)
  )
  WITH CHECK (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'couriers.manage', NULL)
  );

CREATE POLICY courier_commission_lists_select_policy ON public.courier_commission_lists
  FOR SELECT TO authenticated
  USING (app_private.current_user_is_platform_admin() OR app_private.user_belongs_to_tenant(tenant_id));

CREATE POLICY courier_commission_lists_write_policy ON public.courier_commission_lists
  FOR ALL TO authenticated
  USING (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'couriers.manage', NULL)
  )
  WITH CHECK (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'couriers.manage', NULL)
  );

CREATE POLICY courier_commission_rules_select_policy ON public.courier_commission_rules
  FOR SELECT TO authenticated
  USING (app_private.current_user_is_platform_admin() OR app_private.user_belongs_to_tenant(tenant_id));

CREATE POLICY courier_commission_rules_write_policy ON public.courier_commission_rules
  FOR ALL TO authenticated
  USING (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'couriers.manage', NULL)
  )
  WITH CHECK (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'couriers.manage', NULL)
  );

CREATE POLICY couriers_select_policy ON public.couriers
  FOR SELECT TO authenticated
  USING (app_private.current_user_is_platform_admin() OR app_private.user_belongs_to_tenant(tenant_id));

CREATE POLICY couriers_write_policy ON public.couriers
  FOR ALL TO authenticated
  USING (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'couriers.manage', NULL)
  )
  WITH CHECK (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'couriers.manage', NULL)
  );

-- ----------------------------------------------------------------------------
-- 8. Phase 5 Default Seeding + Onboarding Hook + Existing Tenant Backfill
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.seed_tenant_phase5_defaults(
  p_tenant_id uuid,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
BEGIN
  INSERT INTO public.courier_routes (
    tenant_id, code, name, description, is_system_default, is_active, created_by, updated_by
  )
  VALUES (
    p_tenant_id,
    'GENERAL',
    'خط السير العام — كافة أنحاء الجمهورية',
    'خط السير الافتراضي المحمي لجميع مناديب الشركة.',
    true,
    true,
    p_actor_user_id,
    p_actor_user_id
  )
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO public.courier_commission_lists (
    tenant_id, code, name, description, is_system_default, is_active, created_by, updated_by
  )
  VALUES (
    p_tenant_id,
    '0',
    'قائمة العمولات الافتراضية للمناديب',
    'قائمة العمولات القياسية المحمية من الحذف.',
    true,
    true,
    p_actor_user_id,
    p_actor_user_id
  )
  ON CONFLICT (tenant_id, code) DO NOTHING;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id,
    p_actor_user_id,
    'tenant.phase5_defaults_seeded',
    'tenants',
    p_tenant_id,
    jsonb_build_object('default_route', 'GENERAL', 'default_commission_list', '0'),
    'migration_seed'
  );
END;
$$;

REVOKE ALL ON FUNCTION app_private.seed_tenant_phase5_defaults(uuid, uuid) FROM PUBLIC, anon, authenticated;

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
    PERFORM app_private.seed_tenant_phase4_defaults(v_existing_tenant_id, p_actor_user_id);
    PERFORM app_private.seed_tenant_phase5_defaults(v_existing_tenant_id, p_actor_user_id);

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
  PERFORM app_private.seed_tenant_phase4_defaults(v_tenant_id, p_actor_user_id);
  PERFORM app_private.seed_tenant_phase5_defaults(v_tenant_id, p_actor_user_id);

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

-- Backfill Phase 5 defaults for all existing tenants
DO $$
DECLARE
  v_tenant record;
BEGIN
  FOR v_tenant IN SELECT id, created_by FROM public.tenants LOOP
    PERFORM app_private.seed_tenant_phase5_defaults(v_tenant.id, v_tenant.created_by);
  END LOOP;
END $$;
