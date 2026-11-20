-- ============================================================================
-- Migration 0001: Phase 1 - Multi-Tenant, Auth, RLS, Memberships & Audit
-- ============================================================================
-- Rules enforced:
-- - Zero passwords stored in application tables (Supabase Auth owns credentials).
-- - Zero authorization via user_metadata (RLS checks membership/admin tables).
-- - Username uniqueness: per-tenant (tenant_id, username) for company users;
--   platform-wide unique username for platform_admins.
-- - Cross-tenant isolation via composite FKs and FORCE ROW LEVEL SECURITY.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app_private;
CREATE SCHEMA IF NOT EXISTS audit;

REVOKE ALL ON SCHEMA app_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA audit FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Shared trigger helper for updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 1. Platform & Tenant Core Tables
-- ----------------------------------------------------------------------------
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 2 AND 48),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  default_timezone text NOT NULL DEFAULT 'Africa/Cairo',
  default_currency text NOT NULL DEFAULT 'EGP' CHECK (default_currency ~ '^[A-Z]{3}$'),
  default_locale text NOT NULL DEFAULT 'ar-EG',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE RESTRICT,
  allow_client_self_registration boolean NOT NULL DEFAULT false,
  auto_approve_clients boolean NOT NULL DEFAULT false,
  brand_logo_path text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_tenant_settings_updated_at
  BEFORE UPDATE ON public.tenant_settings
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.tenant_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  step_status text NOT NULL DEFAULT 'phase1_initialized'
    CHECK (step_status IN ('phase1_initialized', 'phase2_seeded', 'completed')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT
);

-- ----------------------------------------------------------------------------
-- 2. Profiles, Platform Admins & Tenant Memberships
-- ----------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(trim(display_name)) >= 2),
  avatar_path text,
  is_platform_user boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- Prevent non-service-role callers from self-escalating is_platform_user
CREATE OR REPLACE FUNCTION app_private.guard_profile_escalation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.role() = 'authenticated' AND NEW.is_platform_user IS DISTINCT FROM OLD.is_platform_user THEN
    RAISE EXCEPTION 'Cannot modify is_platform_user directly';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_guard_escalation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_profile_escalation();

CREATE TABLE public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
  role_key text NOT NULL CHECK (role_key IN ('platform_super_admin', 'platform_support')),
  username text NOT NULL CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_platform_admins_username ON public.platform_admins (lower(username));

CREATE TRIGGER trg_platform_admins_updated_at
  BEFORE UPDATE ON public.platform_admins
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.platform_support_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  support_user_id uuid NOT NULL REFERENCES public.platform_admins(user_id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(trim(reason)) >= 5),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT
);

CREATE TABLE public.tenant_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  username text NOT NULL CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
  account_subject_type text NOT NULL
    CHECK (account_subject_type IN ('staff', 'client', 'courier', 'platform_support')),
  role_key text NOT NULL
    CHECK (role_key IN (
      'company_owner', 'company_admin', 'branch_manager', 'accountant',
      'cashier', 'operations_manager', 'data_entry', 'customer_support',
      'warehouse_operator', 'delivery_agent', 'client_owner', 'client_staff'
    )),
  is_active boolean NOT NULL DEFAULT true,
  must_change_password boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_tenant_memberships_tenant_user UNIQUE (tenant_id, user_id),
  CONSTRAINT uq_tenant_memberships_tenant_username UNIQUE (tenant_id, username),
  CONSTRAINT uq_tenant_memberships_tenant_id_id UNIQUE (tenant_id, id)
);

CREATE INDEX idx_tenant_memberships_user_id ON public.tenant_memberships (user_id) WHERE is_active = true;
CREATE INDEX idx_tenant_memberships_tenant_role ON public.tenant_memberships (tenant_id, role_key) WHERE is_active = true;

CREATE TRIGGER trg_tenant_memberships_updated_at
  BEFORE UPDATE ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  username text NOT NULL CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
  email_masked text NOT NULL,
  role_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT
);

CREATE INDEX idx_invitations_tenant_status ON public.invitations (tenant_id, status);

-- ----------------------------------------------------------------------------
-- 3. Private Auth Identity Mapping (NEVER exposed to anon or authenticated)
-- ----------------------------------------------------------------------------
CREATE TABLE app_private.auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('platform', 'tenant')),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
  username text NOT NULL CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
  auth_email text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_auth_identities_scope CHECK (
    (scope_type = 'platform' AND tenant_id IS NULL) OR
    (scope_type = 'tenant' AND tenant_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX uq_auth_identities_platform_username
  ON app_private.auth_identities (lower(username))
  WHERE scope_type = 'platform';

CREATE UNIQUE INDEX uq_auth_identities_tenant_username
  ON app_private.auth_identities (tenant_id, lower(username))
  WHERE scope_type = 'tenant';

CREATE TRIGGER trg_auth_identities_updated_at
  BEFORE UPDATE ON app_private.auth_identities
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Audit Tables (Append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE audit.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  source text NOT NULL DEFAULT 'server',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_tenant_created ON audit.audit_logs (tenant_id, created_at DESC);

CREATE TABLE audit.user_sessions_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,
  user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('login_success', 'login_failed', 'logout', 'password_changed', 'credentials_updated')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_user_sessions_audit_tenant_created ON audit.user_sessions_audit (tenant_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 5. RLS Helper Functions (Documented SECURITY DEFINER necessity:
--    avoids infinite RLS recursion when evaluating policies on membership/admin tables)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.current_user_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    JOIN public.profiles p ON p.id = pa.user_id
    WHERE pa.user_id = auth.uid()
      AND pa.is_active = true
      AND p.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION app_private.current_user_is_platform_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins pa
    JOIN public.profiles p ON p.id = pa.user_id
    WHERE pa.user_id = auth.uid()
      AND pa.role_key = 'platform_super_admin'
      AND pa.is_active = true
      AND p.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION app_private.user_belongs_to_tenant(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships tm
    JOIN public.profiles p ON p.id = tm.user_id
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.is_active = true
      AND p.is_active = true
      AND t.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION app_private.user_is_tenant_admin(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships tm
    JOIN public.profiles p ON p.id = tm.user_id
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.role_key IN ('company_owner', 'company_admin')
      AND tm.is_active = true
      AND p.is_active = true
      AND t.status = 'active'
  );
$$;

-- Safe public storefront lookup (exposes ONLY minimal branding fields for active tenants)
CREATE OR REPLACE FUNCTION public.get_public_tenant_by_slug(p_slug text)
RETURNS TABLE (
  id uuid,
  slug text,
  name text,
  status text,
  default_timezone text,
  default_currency text,
  default_locale text,
  allow_client_self_registration boolean,
  brand_logo_path text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    t.id,
    t.slug,
    t.name,
    t.status,
    t.default_timezone,
    t.default_currency,
    t.default_locale,
    COALESCE(ts.allow_client_self_registration, false) AS allow_client_self_registration,
    ts.brand_logo_path
  FROM public.tenants t
  LEFT JOIN public.tenant_settings ts ON ts.tenant_id = t.id
  WHERE t.slug = lower(trim(p_slug))
    AND t.status = 'active'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_tenant_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_by_slug(text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6. Server-Only Bootstrap & Idempotent Tenant Onboarding Functions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.bootstrap_platform_super_admin(
  p_user_id uuid,
  p_username text,
  p_display_name text,
  p_auth_email text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_clean_username text := lower(trim(p_username));
  v_clean_email text := lower(trim(p_auth_email));
BEGIN
  IF EXISTS (SELECT 1 FROM public.platform_admins WHERE role_key = 'platform_super_admin') THEN
    RAISE EXCEPTION 'Platform Super Admin already initialized';
  END IF;

  INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
  VALUES (p_user_id, trim(p_display_name), true, true)
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        is_platform_user = true,
        is_active = true;

  INSERT INTO public.platform_admins (user_id, role_key, username, is_active, created_by)
  VALUES (p_user_id, 'platform_super_admin', v_clean_username, true, p_user_id);

  INSERT INTO app_private.auth_identities (user_id, scope_type, tenant_id, username, auth_email, is_active)
  VALUES (p_user_id, 'platform', NULL, v_clean_username, v_clean_email, true);

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    NULL,
    p_user_id,
    'platform_super_admin.bootstrapped',
    'platform_admins',
    p_user_id,
    jsonb_build_object('username', v_clean_username),
    'bootstrap'
  );

  RETURN p_user_id;
END;
$$;

REVOKE ALL ON FUNCTION app_private.bootstrap_platform_super_admin(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

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
  -- 1. Idempotency check
  SELECT to_rec.tenant_id INTO v_existing_tenant_id
  FROM public.tenant_onboarding to_rec
  WHERE to_rec.idempotency_key = p_idempotency_key;

  IF v_existing_tenant_id IS NOT NULL THEN
    SELECT tm.id INTO v_existing_membership_id
    FROM public.tenant_memberships tm
    WHERE tm.tenant_id = v_existing_tenant_id
      AND tm.role_key = 'company_owner'
    LIMIT 1;

    RETURN QUERY SELECT v_existing_tenant_id, v_existing_membership_id, true;
    RETURN;
  END IF;

  -- 2. Create tenant & default settings atomically
  INSERT INTO public.tenants (code, slug, name, status, created_by, updated_by)
  VALUES (v_clean_code, v_clean_slug, trim(p_name), 'active', p_actor_user_id, p_actor_user_id)
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_settings (tenant_id, allow_client_self_registration, auto_approve_clients, updated_by)
  VALUES (v_tenant_id, false, false, p_actor_user_id);

  INSERT INTO public.tenant_onboarding (tenant_id, idempotency_key, step_status, created_by)
  VALUES (v_tenant_id, p_idempotency_key, 'phase1_initialized', p_actor_user_id);

  -- 3. Create single owner profile, membership, identity mapping & invitation record
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

REVOKE ALL ON FUNCTION app_private.onboard_tenant(text, uuid, text, text, text, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. Enable & Force Row Level Security on ALL public tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants FORCE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_settings FORCE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_onboarding FORCE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins FORCE ROW LEVEL SECURITY;

ALTER TABLE public.platform_support_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_support_access FORCE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_memberships FORCE ROW LEVEL SECURITY;

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations FORCE ROW LEVEL SECURITY;

-- tenants policies
CREATE POLICY tenants_select_policy ON public.tenants
  FOR SELECT TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR app_private.user_belongs_to_tenant(id)
  );

CREATE POLICY tenants_insert_platform_only ON public.tenants
  FOR INSERT TO authenticated
  WITH CHECK (app_private.current_user_is_platform_super_admin());

CREATE POLICY tenants_update_platform_only ON public.tenants
  FOR UPDATE TO authenticated
  USING (app_private.current_user_is_platform_super_admin())
  WITH CHECK (app_private.current_user_is_platform_super_admin());

-- tenant_settings policies
CREATE POLICY tenant_settings_select_policy ON public.tenant_settings
  FOR SELECT TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR app_private.user_belongs_to_tenant(tenant_id)
  );

CREATE POLICY tenant_settings_update_policy ON public.tenant_settings
  FOR UPDATE TO authenticated
  USING (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
  )
  WITH CHECK (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
  );

-- tenant_onboarding policies
CREATE POLICY tenant_onboarding_select_policy ON public.tenant_onboarding
  FOR SELECT TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
  );

-- profiles policies
CREATE POLICY profiles_select_policy ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR app_private.current_user_is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.tenant_memberships tm_self
      JOIN public.tenant_memberships tm_other ON tm_other.tenant_id = tm_self.tenant_id
      WHERE tm_self.user_id = auth.uid()
        AND tm_self.is_active = true
        AND tm_other.user_id = public.profiles.id
    )
  );

CREATE POLICY profiles_update_self_policy ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- platform_admins policies
CREATE POLICY platform_admins_select_policy ON public.platform_admins
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR app_private.current_user_is_platform_super_admin()
  );

CREATE POLICY platform_admins_insert_policy ON public.platform_admins
  FOR INSERT TO authenticated
  WITH CHECK (app_private.current_user_is_platform_super_admin());

CREATE POLICY platform_admins_update_policy ON public.platform_admins
  FOR UPDATE TO authenticated
  USING (app_private.current_user_is_platform_super_admin())
  WITH CHECK (app_private.current_user_is_platform_super_admin());

-- platform_support_access policies
CREATE POLICY platform_support_access_select_policy ON public.platform_support_access
  FOR SELECT TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
  );

CREATE POLICY platform_support_access_insert_policy ON public.platform_support_access
  FOR INSERT TO authenticated
  WITH CHECK (app_private.current_user_is_platform_super_admin());

CREATE POLICY platform_support_access_update_policy ON public.platform_support_access
  FOR UPDATE TO authenticated
  USING (app_private.current_user_is_platform_super_admin())
  WITH CHECK (app_private.current_user_is_platform_super_admin());

-- tenant_memberships policies
CREATE POLICY tenant_memberships_select_policy ON public.tenant_memberships
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
  );

CREATE POLICY tenant_memberships_update_policy ON public.tenant_memberships
  FOR UPDATE TO authenticated
  USING (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
  )
  WITH CHECK (
    app_private.current_user_is_platform_super_admin()
    OR (
      app_private.user_is_tenant_admin(tenant_id)
      AND role_key <> 'company_owner'
    )
  );

-- invitations policies
CREATE POLICY invitations_select_policy ON public.invitations
  FOR SELECT TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
  );
