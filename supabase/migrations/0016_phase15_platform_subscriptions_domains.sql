-- ============================================================================
-- Migration 0016: Phase 15 - Central Platform, Subscriptions, Quotas, Domains
--                 & Audited Support Access (ADR-023)
-- ============================================================================
-- Implements ADR-023 & MASTER_SPEC Sections 01 / 02 / 04:
-- 1. `subscription_plans` & `tenant_subscriptions`: SaaS plans, limits/quotas,
--    overrides, billing status, and automatic trigger assignment on onboarding.
-- 2. `app_private.assert_tenant_quota`: server-side quota enforcement on
--    branches, tenant_memberships, couriers, and monthly shipments.
-- 3. `tenant_domains`: subdomains & custom domains with DNS TXT verification
--    challenges, SSL status, and safe public storefront resolution.
-- 4. `platform_support_access`: timed, reason-mandatory, revocable support
--    sessions with read-only diagnostic snapshots & full audit logging.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Subscription Plans & Tenant Subscriptions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_-]{2,32}$'),
  name_ar text NOT NULL CHECK (char_length(trim(name_ar)) >= 2),
  description_ar text,
  monthly_price_egp numeric(12, 2) NOT NULL DEFAULT 0 CHECK (monthly_price_egp >= 0),
  annual_price_egp numeric(12, 2) NOT NULL DEFAULT 0 CHECK (annual_price_egp >= 0),
  max_branches integer CHECK (max_branches IS NULL OR max_branches >= 1),
  max_users integer CHECK (max_users IS NULL OR max_users >= 1),
  max_couriers integer CHECK (max_couriers IS NULL OR max_couriers >= 1),
  max_monthly_shipments integer CHECK (max_monthly_shipments IS NULL OR max_monthly_shipments >= 10),
  allow_custom_domain boolean NOT NULL DEFAULT false,
  allow_api_access boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_subscription_plans_updated_at ON public.subscription_plans;
CREATE TRIGGER trg_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

INSERT INTO public.subscription_plans (
  code, name_ar, description_ar, monthly_price_egp, annual_price_egp,
  max_branches, max_users, max_couriers, max_monthly_shipments,
  allow_custom_domain, allow_api_access, is_active, sort_order
)
VALUES
  (
    'STARTER',
    'باقة البداية',
    'مناسبة لشركات الشحن الناشئة حتى 3 فروع و1,000 شحنة شهريًا.',
    950.00, 9500.00,
    3, 10, 10, 1000,
    false, false, true, 10
  ),
  (
    'GROWTH',
    'باقة النمو الاحترافية',
    'مناسبة للشركات المتنامية مع نطاق مخصص وتكامل API حتى 10,000 شحنة شهريًا.',
    2450.00, 24500.00,
    15, 50, 50, 10000,
    true, true, true, 20
  ),
  (
    'ENTERPRISE',
    'باقة المؤسسات',
    'سعة مفتوحة للفروع والشحنات والمستخدمين مع أولوية الدعم والنطاقات المخصصة.',
    6500.00, 65000.00,
    NULL, NULL, NULL, NULL,
    true, true, true, 30
  )
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE RESTRICT,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('trial', 'active', 'past_due', 'suspended', 'cancelled')),
  billing_cycle text NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'annual')),
  current_period_start date NOT NULL DEFAULT CURRENT_DATE,
  current_period_end date NOT NULL DEFAULT (CURRENT_DATE + 30),
  trial_ends_at timestamptz,
  override_max_branches integer CHECK (override_max_branches IS NULL OR override_max_branches >= 1),
  override_max_users integer CHECK (override_max_users IS NULL OR override_max_users >= 1),
  override_max_couriers integer CHECK (override_max_couriers IS NULL OR override_max_couriers >= 1),
  override_max_monthly_shipments integer CHECK (override_max_monthly_shipments IS NULL OR override_max_monthly_shipments >= 10),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT
);

DROP TRIGGER IF EXISTS trg_tenant_subscriptions_updated_at ON public.tenant_subscriptions;
CREATE TRIGGER trg_tenant_subscriptions_updated_at
  BEFORE UPDATE ON public.tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Tenant Domains (Subdomains & Custom Domains)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  domain text NOT NULL
    CHECK (
      domain = lower(trim(domain))
      AND char_length(domain) BETWEEN 4 AND 253
      AND domain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
    ),
  domain_type text NOT NULL DEFAULT 'custom' CHECK (domain_type IN ('subdomain', 'custom')),
  is_primary boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'pending'
    CHECK (verification_status IN ('pending', 'verified', 'failed')),
  verification_token text NOT NULL DEFAULT ('shipflow-verify-' || encode(gen_random_bytes(12), 'hex')),
  verified_at timestamptz,
  ssl_status text NOT NULL DEFAULT 'pending'
    CHECK (ssl_status IN ('pending', 'active', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_tenant_domains_domain UNIQUE (domain),
  CONSTRAINT uq_tenant_domains_tenant_id_id UNIQUE (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_domains_single_primary
  ON public.tenant_domains (tenant_id)
  WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_tenant_domains_tenant_status
  ON public.tenant_domains (tenant_id, verification_status);

DROP TRIGGER IF EXISTS trg_tenant_domains_updated_at ON public.tenant_domains;
CREATE TRIGGER trg_tenant_domains_updated_at
  BEFORE UPDATE ON public.tenant_domains
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Extend platform_support_access for Audited Support Modes
-- ----------------------------------------------------------------------------
ALTER TABLE public.platform_support_access
  ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'read_only'
    CHECK (access_mode IN ('read_only', 'diagnostic_assist')),
  ADD COLUMN IF NOT EXISTS last_entered_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_platform_support_access_tenant_active
  ON public.platform_support_access (tenant_id, support_user_id, expires_at)
  WHERE revoked_at IS NULL;

-- ----------------------------------------------------------------------------
-- 4. Backfill Existing Tenants & Auto-Provision Trigger on New Tenants
-- ----------------------------------------------------------------------------
INSERT INTO public.tenant_subscriptions (
  tenant_id, plan_id, status, billing_cycle, current_period_start, current_period_end, notes
)
SELECT
  t.id,
  p.id,
  CASE WHEN t.status = 'active' THEN 'active' ELSE 'suspended' END,
  'monthly',
  CURRENT_DATE,
  CURRENT_DATE + 30,
  'تعيين افتراضي تلقائي عند تفعيل المرحلة 15'
FROM public.tenants t
JOIN public.subscription_plans p ON p.code = 'GROWTH'
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO public.tenant_domains (
  tenant_id, domain, domain_type, is_primary, verification_status, verified_at, ssl_status
)
SELECT
  t.id,
  lower(t.slug) || '.shipflow.app',
  'subdomain',
  true,
  'verified',
  now(),
  'active'
FROM public.tenants t
ON CONFLICT (domain) DO NOTHING;

CREATE OR REPLACE FUNCTION app_private.provision_tenant_phase15_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_starter_plan_id uuid;
BEGIN
  SELECT id INTO v_starter_plan_id
  FROM public.subscription_plans
  WHERE code = 'STARTER' AND is_active = true
  ORDER BY sort_order ASC
  LIMIT 1;

  IF v_starter_plan_id IS NOT NULL THEN
    INSERT INTO public.tenant_subscriptions (
      tenant_id, plan_id, status, billing_cycle,
      current_period_start, current_period_end, trial_ends_at, updated_by
    )
    VALUES (
      NEW.id, v_starter_plan_id, 'trial', 'monthly',
      CURRENT_DATE, CURRENT_DATE + 14, now() + interval '14 days', NEW.created_by
    )
    ON CONFLICT (tenant_id) DO NOTHING;
  END IF;

  INSERT INTO public.tenant_domains (
    tenant_id, domain, domain_type, is_primary,
    verification_status, verified_at, ssl_status, created_by, updated_by
  )
  VALUES (
    NEW.id, lower(NEW.slug) || '.shipflow.app', 'subdomain', true,
    'verified', now(), 'active', NEW.created_by, NEW.created_by
  )
  ON CONFLICT (domain) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenants_phase15_defaults ON public.tenants;
CREATE TRIGGER trg_tenants_phase15_defaults
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION app_private.provision_tenant_phase15_defaults();

-- ----------------------------------------------------------------------------
-- 5. Server-Side Quota Enforcement Helpers & Triggers (ADR-023)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.assert_tenant_quota(
  p_tenant_id uuid,
  p_resource text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_sub public.tenant_subscriptions%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
  v_limit integer;
  v_current integer := 0;
BEGIN
  SELECT * INTO v_sub
  FROM public.tenant_subscriptions
  WHERE tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_sub.status IN ('suspended', 'cancelled') THEN
    RAISE EXCEPTION 'اشتراك الشركة غير نشط حاليًا (%). يرجى مراجعة المنصة المركزية.', v_sub.status;
  END IF;

  SELECT * INTO v_plan
  FROM public.subscription_plans
  WHERE id = v_sub.plan_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF p_resource = 'branches' THEN
    v_limit := COALESCE(v_sub.override_max_branches, v_plan.max_branches);
    IF v_limit IS NOT NULL THEN
      SELECT count(*) INTO v_current
      FROM public.branches
      WHERE tenant_id = p_tenant_id AND is_active = true;
      IF v_current >= v_limit THEN
        RAISE EXCEPTION 'تم بلوغ الحد الأقصى للفروع المسموح بها في باقة الاشتراك (% / %).', v_current, v_limit;
      END IF;
    END IF;
  ELSIF p_resource = 'users' THEN
    v_limit := COALESCE(v_sub.override_max_users, v_plan.max_users);
    IF v_limit IS NOT NULL THEN
      SELECT count(*) INTO v_current
      FROM public.tenant_memberships
      WHERE tenant_id = p_tenant_id AND is_active = true;
      IF v_current >= v_limit THEN
        RAISE EXCEPTION 'تم بلوغ الحد الأقصى لحسابات المستخدمين في باقة الاشتراك (% / %).', v_current, v_limit;
      END IF;
    END IF;
  ELSIF p_resource = 'couriers' THEN
    v_limit := COALESCE(v_sub.override_max_couriers, v_plan.max_couriers);
    IF v_limit IS NOT NULL THEN
      SELECT count(*) INTO v_current
      FROM public.couriers
      WHERE tenant_id = p_tenant_id AND archived_at IS NULL;
      IF v_current >= v_limit THEN
        RAISE EXCEPTION 'تم بلوغ الحد الأقصى للمناديب في باقة الاشتراك (% / %).', v_current, v_limit;
      END IF;
    END IF;
  ELSIF p_resource = 'shipments' THEN
    v_limit := COALESCE(v_sub.override_max_monthly_shipments, v_plan.max_monthly_shipments);
    IF v_limit IS NOT NULL THEN
      SELECT count(*) INTO v_current
      FROM public.shipments
      WHERE tenant_id = p_tenant_id
        AND created_at >= date_trunc('month', now())
        AND operational_status <> 'cancelled';
      IF v_current >= v_limit THEN
        RAISE EXCEPTION 'تم بلوغ الحد الأقصى الشهري للشحنات في باقة الاشتراك (% / %).', v_current, v_limit;
      END IF;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.trg_enforce_tenant_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_resource text := TG_ARGV[0];
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    PERFORM app_private.assert_tenant_quota(NEW.tenant_id, v_resource);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_branches_enforce_quota ON public.branches;
CREATE TRIGGER trg_branches_enforce_quota
  BEFORE INSERT ON public.branches
  FOR EACH ROW EXECUTE FUNCTION app_private.trg_enforce_tenant_quota('branches');

DROP TRIGGER IF EXISTS trg_memberships_enforce_quota ON public.tenant_memberships;
CREATE TRIGGER trg_memberships_enforce_quota
  BEFORE INSERT ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION app_private.trg_enforce_tenant_quota('users');

DROP TRIGGER IF EXISTS trg_couriers_enforce_quota ON public.couriers;
CREATE TRIGGER trg_couriers_enforce_quota
  BEFORE INSERT ON public.couriers
  FOR EACH ROW EXECUTE FUNCTION app_private.trg_enforce_tenant_quota('couriers');

DROP TRIGGER IF EXISTS trg_shipments_enforce_quota ON public.shipments;
CREATE TRIGGER trg_shipments_enforce_quota
  BEFORE INSERT ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION app_private.trg_enforce_tenant_quota('shipments');

-- ----------------------------------------------------------------------------
-- 6. Forced RLS & Table Grants for Phase 15 Tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_subscription_plans_select ON public.subscription_plans;
CREATE POLICY p_subscription_plans_select
  ON public.subscription_plans
  FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE public.tenant_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_tenant_subscriptions_select ON public.tenant_subscriptions;
CREATE POLICY p_tenant_subscriptions_select
  ON public.tenant_subscriptions
  FOR SELECT
  TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
  );

ALTER TABLE public.tenant_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_domains FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_tenant_domains_select ON public.tenant_domains;
CREATE POLICY p_tenant_domains_select
  ON public.tenant_domains
  FOR SELECT
  TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR app_private.user_belongs_to_tenant(tenant_id)
  );

REVOKE ALL ON TABLE public.subscription_plans, public.tenant_subscriptions, public.tenant_domains
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.subscription_plans, public.tenant_subscriptions, public.tenant_domains
  TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Server-Side RPCs: Platform Plans, Subscriptions, Quotas & Domains
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_subscription_plans()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول لعرض باقات الاشتراك.';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', sp.id,
      'code', sp.code,
      'name_ar', sp.name_ar,
      'description_ar', sp.description_ar,
      'monthly_price_egp', sp.monthly_price_egp,
      'annual_price_egp', sp.annual_price_egp,
      'max_branches', sp.max_branches,
      'max_users', sp.max_users,
      'max_couriers', sp.max_couriers,
      'max_monthly_shipments', sp.max_monthly_shipments,
      'allow_custom_domain', sp.allow_custom_domain,
      'allow_api_access', sp.allow_api_access,
      'is_active', sp.is_active,
      'sort_order', sp.sort_order,
      'created_at', sp.created_at,
      'updated_at', sp.updated_at
    ) ORDER BY sp.sort_order ASC, sp.code ASC)
    FROM public.subscription_plans sp
    WHERE app_private.current_user_is_platform_admin() OR sp.is_active = true
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.list_subscription_plans() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_subscription_plans() TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_subscription_plan(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_id uuid;
  v_code text;
  v_name_ar text;
  v_desc text;
  v_monthly numeric(12, 2);
  v_annual numeric(12, 2);
  v_max_branches integer;
  v_max_users integer;
  v_max_couriers integer;
  v_max_shipments integer;
  v_allow_domain boolean;
  v_allow_api boolean;
  v_is_active boolean;
  v_sort integer;
  v_row public.subscription_plans%ROWTYPE;
BEGIN
  IF NOT app_private.current_user_is_platform_super_admin() THEN
    RAISE EXCEPTION 'تعديل باقات الاشتراك مقتصر على مدير المنصة الرئيسي.';
  END IF;

  v_id := NULLIF(trim(COALESCE(p_payload->>'id', '')), '')::uuid;
  v_code := upper(trim(COALESCE(p_payload->>'code', '')));
  v_name_ar := trim(COALESCE(p_payload->>'name_ar', ''));
  v_desc := NULLIF(trim(COALESCE(p_payload->>'description_ar', '')), '');
  v_monthly := COALESCE((p_payload->>'monthly_price_egp')::numeric(12, 2), 0);
  v_annual := COALESCE((p_payload->>'annual_price_egp')::numeric(12, 2), 0);
  v_max_branches := NULLIF(trim(COALESCE(p_payload->>'max_branches', '')), '')::integer;
  v_max_users := NULLIF(trim(COALESCE(p_payload->>'max_users', '')), '')::integer;
  v_max_couriers := NULLIF(trim(COALESCE(p_payload->>'max_couriers', '')), '')::integer;
  v_max_shipments := NULLIF(trim(COALESCE(p_payload->>'max_monthly_shipments', '')), '')::integer;
  v_allow_domain := COALESCE((p_payload->>'allow_custom_domain')::boolean, false);
  v_allow_api := COALESCE((p_payload->>'allow_api_access')::boolean, false);
  v_is_active := COALESCE((p_payload->>'is_active')::boolean, true);
  v_sort := COALESCE((p_payload->>'sort_order')::integer, 50);

  IF v_code !~ '^[A-Z0-9_-]{2,32}$' OR char_length(v_name_ar) < 2 THEN
    RAISE EXCEPTION 'كود الباقة واسمها العربي مطلوبان بصيغة صالحة.';
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE public.subscription_plans
    SET
      name_ar = v_name_ar,
      description_ar = v_desc,
      monthly_price_egp = v_monthly,
      annual_price_egp = v_annual,
      max_branches = v_max_branches,
      max_users = v_max_users,
      max_couriers = v_max_couriers,
      max_monthly_shipments = v_max_shipments,
      allow_custom_domain = v_allow_domain,
      allow_api_access = v_allow_api,
      is_active = v_is_active,
      sort_order = v_sort
    WHERE id = v_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'الباقة المحددة غير موجودة.';
    END IF;
  ELSE
    INSERT INTO public.subscription_plans (
      code, name_ar, description_ar, monthly_price_egp, annual_price_egp,
      max_branches, max_users, max_couriers, max_monthly_shipments,
      allow_custom_domain, allow_api_access, is_active, sort_order
    )
    VALUES (
      v_code, v_name_ar, v_desc, v_monthly, v_annual,
      v_max_branches, v_max_users, v_max_couriers, v_max_shipments,
      v_allow_domain, v_allow_api, v_is_active, v_sort
    )
    ON CONFLICT (code) DO UPDATE
      SET
        name_ar = EXCLUDED.name_ar,
        description_ar = EXCLUDED.description_ar,
        monthly_price_egp = EXCLUDED.monthly_price_egp,
        annual_price_egp = EXCLUDED.annual_price_egp,
        max_branches = EXCLUDED.max_branches,
        max_users = EXCLUDED.max_users,
        max_couriers = EXCLUDED.max_couriers,
        max_monthly_shipments = EXCLUDED.max_monthly_shipments,
        allow_custom_domain = EXCLUDED.allow_custom_domain,
        allow_api_access = EXCLUDED.allow_api_access,
        is_active = EXCLUDED.is_active,
        sort_order = EXCLUDED.sort_order
    RETURNING * INTO v_row;
  END IF;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    NULL, auth.uid(), 'subscription_plan_upserted', 'subscription_plans', v_row.id,
    jsonb_build_object('code', v_row.code, 'monthly_price_egp', v_row.monthly_price_egp),
    'server'
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_subscription_plan(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_subscription_plan(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_tenant_subscription(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_plan public.subscription_plans%ROWTYPE;
  v_status text;
  v_cycle text;
  v_start date;
  v_end date;
  v_ov_branches integer;
  v_ov_users integer;
  v_ov_couriers integer;
  v_ov_shipments integer;
  v_notes text;
  v_sub public.tenant_subscriptions%ROWTYPE;
BEGIN
  IF NOT app_private.current_user_is_platform_super_admin() THEN
    RAISE EXCEPTION 'تعديل اشتراك وحدود الشركة مقتصر على مدير المنصة الرئيسي.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'الشركة المحددة غير موجودة.';
  END IF;

  SELECT * INTO v_plan
  FROM public.subscription_plans
  WHERE id = NULLIF(trim(COALESCE(p_payload->>'plan_id', '')), '')::uuid
     OR code = upper(trim(COALESCE(p_payload->>'plan_code', '')))
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'باقة الاشتراك المحددة غير موجودة.';
  END IF;

  v_status := COALESCE(NULLIF(trim(p_payload->>'status'), ''), 'active');
  IF v_status NOT IN ('trial', 'active', 'past_due', 'suspended', 'cancelled') THEN
    RAISE EXCEPTION 'حالة الاشتراك غير صالحة.';
  END IF;

  v_cycle := COALESCE(NULLIF(trim(p_payload->>'billing_cycle'), ''), 'monthly');
  IF v_cycle NOT IN ('monthly', 'annual') THEN
    RAISE EXCEPTION 'دورة الفوترة غير صالحة.';
  END IF;

  v_start := COALESCE(NULLIF(trim(COALESCE(p_payload->>'current_period_start', '')), '')::date, CURRENT_DATE);
  v_end := COALESCE(
    NULLIF(trim(COALESCE(p_payload->>'current_period_end', '')), '')::date,
    CASE WHEN v_cycle = 'annual' THEN v_start + 365 ELSE v_start + 30 END
  );
  v_ov_branches := NULLIF(trim(COALESCE(p_payload->>'override_max_branches', '')), '')::integer;
  v_ov_users := NULLIF(trim(COALESCE(p_payload->>'override_max_users', '')), '')::integer;
  v_ov_couriers := NULLIF(trim(COALESCE(p_payload->>'override_max_couriers', '')), '')::integer;
  v_ov_shipments := NULLIF(trim(COALESCE(p_payload->>'override_max_monthly_shipments', '')), '')::integer;
  v_notes := NULLIF(trim(COALESCE(p_payload->>'notes', '')), '');

  INSERT INTO public.tenant_subscriptions (
    tenant_id, plan_id, status, billing_cycle, current_period_start, current_period_end,
    override_max_branches, override_max_users, override_max_couriers, override_max_monthly_shipments,
    notes, updated_by
  )
  VALUES (
    p_tenant_id, v_plan.id, v_status, v_cycle, v_start, v_end,
    v_ov_branches, v_ov_users, v_ov_couriers, v_ov_shipments,
    v_notes, auth.uid()
  )
  ON CONFLICT (tenant_id) DO UPDATE
    SET
      plan_id = EXCLUDED.plan_id,
      status = EXCLUDED.status,
      billing_cycle = EXCLUDED.billing_cycle,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      override_max_branches = EXCLUDED.override_max_branches,
      override_max_users = EXCLUDED.override_max_users,
      override_max_couriers = EXCLUDED.override_max_couriers,
      override_max_monthly_shipments = EXCLUDED.override_max_monthly_shipments,
      notes = EXCLUDED.notes,
      updated_by = auth.uid()
  RETURNING * INTO v_sub;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    p_tenant_id, auth.uid(), 'tenant_subscription_assigned', 'tenant_subscriptions', v_sub.id,
    jsonb_build_object('plan_code', v_plan.code, 'status', v_sub.status, 'billing_cycle', v_sub.billing_cycle),
    'server'
  );

  RETURN to_jsonb(v_sub);
END;
$$;

REVOKE ALL ON FUNCTION public.assign_tenant_subscription(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_tenant_subscription(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_tenants_directory()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  IF NOT app_private.current_user_is_platform_admin() THEN
    RAISE EXCEPTION 'استعراض دليل شركات المنصة مقتصر على مسؤولي المنصة المركزية.';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'tenant', jsonb_build_object(
        'id', t.id,
        'code', t.code,
        'slug', t.slug,
        'name', t.name,
        'status', t.status,
        'default_timezone', t.default_timezone,
        'default_currency', t.default_currency,
        'default_locale', t.default_locale,
        'created_at', t.created_at,
        'updated_at', t.updated_at
      ),
      'subscription', CASE WHEN ts.id IS NOT NULL THEN jsonb_build_object(
        'id', ts.id,
        'plan_id', ts.plan_id,
        'plan_code', sp.code,
        'plan_name_ar', sp.name_ar,
        'status', ts.status,
        'billing_cycle', ts.billing_cycle,
        'current_period_start', ts.current_period_start,
        'current_period_end', ts.current_period_end,
        'trial_ends_at', ts.trial_ends_at,
        'effective_max_branches', COALESCE(ts.override_max_branches, sp.max_branches),
        'effective_max_users', COALESCE(ts.override_max_users, sp.max_users),
        'effective_max_couriers', COALESCE(ts.override_max_couriers, sp.max_couriers),
        'effective_max_monthly_shipments', COALESCE(ts.override_max_monthly_shipments, sp.max_monthly_shipments),
        'override_max_branches', ts.override_max_branches,
        'override_max_users', ts.override_max_users,
        'override_max_couriers', ts.override_max_couriers,
        'override_max_monthly_shipments', ts.override_max_monthly_shipments,
        'allow_custom_domain', sp.allow_custom_domain,
        'allow_api_access', sp.allow_api_access,
        'notes', ts.notes
      ) ELSE NULL END,
      'usage', jsonb_build_object(
        'active_branches', (SELECT count(*) FROM public.branches b WHERE b.tenant_id = t.id AND b.is_active = true),
        'active_users', (SELECT count(*) FROM public.tenant_memberships tm WHERE tm.tenant_id = t.id AND tm.is_active = true),
        'active_couriers', (SELECT count(*) FROM public.couriers c WHERE c.tenant_id = t.id AND c.archived_at IS NULL),
        'month_shipments', (SELECT count(*) FROM public.shipments s WHERE s.tenant_id = t.id AND s.created_at >= date_trunc('month', now()) AND s.operational_status <> 'cancelled')
      ),
      'primary_domain', (
        SELECT td.domain
        FROM public.tenant_domains td
        WHERE td.tenant_id = t.id AND td.is_primary = true
        LIMIT 1
      ),
      'domains_count', (SELECT count(*) FROM public.tenant_domains td WHERE td.tenant_id = t.id),
      'active_support_sessions_count', (
        SELECT count(*)
        FROM public.platform_support_access psa
        WHERE psa.tenant_id = t.id
          AND psa.revoked_at IS NULL
          AND psa.expires_at > now()
      )
    ) ORDER BY t.created_at DESC)
    FROM public.tenants t
    LEFT JOIN public.tenant_subscriptions ts ON ts.tenant_id = t.id
    LEFT JOIN public.subscription_plans sp ON sp.id = ts.plan_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.list_platform_tenants_directory() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_platform_tenants_directory() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_tenant_subscription_overview(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_sub public.tenant_subscriptions%ROWTYPE;
  v_plan public.subscription_plans%ROWTYPE;
  v_domains jsonb := '[]'::jsonb;
  v_support jsonb := '[]'::jsonb;
BEGIN
  IF NOT (
    app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
  ) THEN
    RAISE EXCEPTION 'استعراض تفاصيل الاشتراك والنطاقات مقتصر على إدارة الشركة أو المنصة.';
  END IF;

  SELECT * INTO v_sub FROM public.tenant_subscriptions WHERE tenant_id = p_tenant_id;
  IF FOUND THEN
    SELECT * INTO v_plan FROM public.subscription_plans WHERE id = v_sub.plan_id;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(td) ORDER BY td.is_primary DESC, td.created_at ASC), '[]'::jsonb)
  INTO v_domains
  FROM public.tenant_domains td
  WHERE td.tenant_id = p_tenant_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'support_user_id', s.support_user_id,
    'support_username', s.support_username,
    'tenant_id', s.tenant_id,
    'reason', s.reason,
    'access_mode', s.access_mode,
    'expires_at', s.expires_at,
    'revoked_at', s.revoked_at,
    'last_entered_at', s.last_entered_at,
    'created_at', s.created_at
  ) ORDER BY s.created_at DESC), '[]'::jsonb)
  INTO v_support
  FROM (
    SELECT
      psa.id,
      psa.support_user_id,
      pa.username AS support_username,
      psa.tenant_id,
      psa.reason,
      psa.access_mode,
      psa.expires_at,
      psa.revoked_at,
      psa.last_entered_at,
      psa.created_at
    FROM public.platform_support_access psa
    JOIN public.platform_admins pa ON pa.user_id = psa.support_user_id
    WHERE psa.tenant_id = p_tenant_id
    ORDER BY psa.created_at DESC
    LIMIT 25
  ) s;

  RETURN jsonb_build_object(
    'tenant_id', p_tenant_id,
    'subscription', CASE WHEN v_sub.id IS NOT NULL THEN jsonb_build_object(
      'id', v_sub.id,
      'plan_id', v_sub.plan_id,
      'plan_code', v_plan.code,
      'plan_name_ar', v_plan.name_ar,
      'status', v_sub.status,
      'billing_cycle', v_sub.billing_cycle,
      'current_period_start', v_sub.current_period_start,
      'current_period_end', v_sub.current_period_end,
      'trial_ends_at', v_sub.trial_ends_at,
      'effective_max_branches', COALESCE(v_sub.override_max_branches, v_plan.max_branches),
      'effective_max_users', COALESCE(v_sub.override_max_users, v_plan.max_users),
      'effective_max_couriers', COALESCE(v_sub.override_max_couriers, v_plan.max_couriers),
      'effective_max_monthly_shipments', COALESCE(v_sub.override_max_monthly_shipments, v_plan.max_monthly_shipments),
      'allow_custom_domain', COALESCE(v_plan.allow_custom_domain, false),
      'allow_api_access', COALESCE(v_plan.allow_api_access, false)
    ) ELSE NULL END,
    'usage', jsonb_build_object(
      'active_branches', (SELECT count(*) FROM public.branches b WHERE b.tenant_id = p_tenant_id AND b.is_active = true),
      'active_users', (SELECT count(*) FROM public.tenant_memberships tm WHERE tm.tenant_id = p_tenant_id AND tm.is_active = true),
      'active_couriers', (SELECT count(*) FROM public.couriers c WHERE c.tenant_id = p_tenant_id AND c.archived_at IS NULL),
      'month_shipments', (SELECT count(*) FROM public.shipments s WHERE s.tenant_id = p_tenant_id AND s.created_at >= date_trunc('month', now()) AND s.operational_status <> 'cancelled')
    ),
    'domains', v_domains,
    'support_sessions', v_support
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_subscription_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_subscription_overview(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Server-Side RPCs: Tenant Domains & Public Host Resolution
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_tenant_domains(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  IF p_tenant_id IS NULL THEN
    IF NOT app_private.current_user_is_platform_admin() THEN
      RAISE EXCEPTION 'عرض جميع نطاقات المنصة مقتصر على إدارة المنصة.';
    END IF;
  ELSE
    IF NOT (
      app_private.current_user_is_platform_admin()
      OR app_private.user_is_tenant_admin(p_tenant_id)
    ) THEN
      RAISE EXCEPTION 'غير مصرح بعرض نطاقات هذه الشركة.';
    END IF;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', td.id,
      'tenant_id', td.tenant_id,
      'tenant_name', t.name,
      'tenant_slug', t.slug,
      'domain', td.domain,
      'domain_type', td.domain_type,
      'is_primary', td.is_primary,
      'verification_status', td.verification_status,
      'verification_token', td.verification_token,
      'verified_at', td.verified_at,
      'ssl_status', td.ssl_status,
      'created_at', td.created_at,
      'updated_at', td.updated_at
    ) ORDER BY td.is_primary DESC, td.created_at DESC)
    FROM public.tenant_domains td
    JOIN public.tenants t ON t.id = td.tenant_id
    WHERE (p_tenant_id IS NULL OR td.tenant_id = p_tenant_id)
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.list_tenant_domains(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tenant_domains(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_tenant_domain(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_domain text;
  v_type text;
  v_is_primary boolean;
  v_allow_custom boolean := false;
  v_row public.tenant_domains%ROWTYPE;
BEGIN
  IF NOT app_private.current_user_is_platform_super_admin() THEN
    RAISE EXCEPTION 'إضافة وتخصيص النطاقات مقتصر على مدير المنصة الرئيسي.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'الشركة المحددة غير موجودة.';
  END IF;

  v_domain := lower(trim(COALESCE(p_payload->>'domain', '')));
  v_type := COALESCE(NULLIF(trim(p_payload->>'domain_type'), ''), 'custom');
  v_is_primary := COALESCE((p_payload->>'is_primary')::boolean, false);

  IF v_type NOT IN ('subdomain', 'custom') THEN
    RAISE EXCEPTION 'نوع النطاق غير صالح.';
  END IF;

  IF v_domain !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' THEN
    RAISE EXCEPTION 'صيغة اسم النطاق (Hostname) غير صالحة.';
  END IF;

  IF v_type = 'custom' THEN
    SELECT COALESCE(sp.allow_custom_domain, false) INTO v_allow_custom
    FROM public.tenant_subscriptions ts
    JOIN public.subscription_plans sp ON sp.id = ts.plan_id
    WHERE ts.tenant_id = p_tenant_id;

    IF NOT v_allow_custom THEN
      RAISE EXCEPTION 'باقة الاشتراك الحالية لهذه الشركة لا تدعم ربط نطاق مخصص.';
    END IF;
  END IF;

  IF v_is_primary THEN
    UPDATE public.tenant_domains
    SET is_primary = false, updated_by = auth.uid()
    WHERE tenant_id = p_tenant_id AND is_primary = true;
  END IF;

  INSERT INTO public.tenant_domains (
    tenant_id, domain, domain_type, is_primary,
    verification_status, verified_at, ssl_status, created_by, updated_by
  )
  VALUES (
    p_tenant_id,
    v_domain,
    v_type,
    v_is_primary,
    CASE WHEN v_type = 'subdomain' THEN 'verified' ELSE 'pending' END,
    CASE WHEN v_type = 'subdomain' THEN now() ELSE NULL END,
    CASE WHEN v_type = 'subdomain' THEN 'active' ELSE 'pending' END,
    auth.uid(),
    auth.uid()
  )
  ON CONFLICT (domain) DO UPDATE
    SET
      is_primary = EXCLUDED.is_primary,
      updated_by = auth.uid()
    WHERE public.tenant_domains.tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'هذا النطاق مسجل بالفعل لشركة أخرى.';
  END IF;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    p_tenant_id, auth.uid(), 'tenant_domain_upserted', 'tenant_domains', v_row.id,
    jsonb_build_object('domain', v_row.domain, 'domain_type', v_row.domain_type, 'is_primary', v_row.is_primary),
    'server'
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_tenant_domain(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_tenant_domain(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.verify_tenant_domain(
  p_tenant_id uuid,
  p_domain_id uuid,
  p_mark_verified boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_row public.tenant_domains%ROWTYPE;
BEGIN
  IF NOT app_private.current_user_is_platform_super_admin() THEN
    RAISE EXCEPTION 'توثيق النطاقات مقتصر على مدير المنصة الرئيسي.';
  END IF;

  UPDATE public.tenant_domains
  SET
    verification_status = CASE WHEN p_mark_verified THEN 'verified' ELSE 'failed' END,
    verified_at = CASE WHEN p_mark_verified THEN now() ELSE NULL END,
    ssl_status = CASE WHEN p_mark_verified THEN 'active' ELSE 'error' END,
    updated_by = auth.uid()
  WHERE tenant_id = p_tenant_id AND id = p_domain_id
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'النطاق المطلوب غير موجود لهذه الشركة.';
  END IF;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    p_tenant_id, auth.uid(), 'tenant_domain_verified', 'tenant_domains', v_row.id,
    jsonb_build_object('domain', v_row.domain, 'verification_status', v_row.verification_status),
    'server'
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_tenant_domain(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_tenant_domain(uuid, uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_tenant_domain(
  p_tenant_id uuid,
  p_domain_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_row public.tenant_domains%ROWTYPE;
BEGIN
  IF NOT app_private.current_user_is_platform_super_admin() THEN
    RAISE EXCEPTION 'حذف النطاقات مقتصر على مدير المنصة الرئيسي.';
  END IF;

  SELECT * INTO v_row
  FROM public.tenant_domains
  WHERE tenant_id = p_tenant_id AND id = p_domain_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'النطاق المطلوب غير موجود.';
  END IF;

  IF v_row.is_primary THEN
    RAISE EXCEPTION 'لا يمكن حذف النطاق الرئيسي النشط للشركة؛ عيّن نطاقًا رئيسيًا آخر أولاً.';
  END IF;

  DELETE FROM public.tenant_domains
  WHERE tenant_id = p_tenant_id AND id = p_domain_id;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, before_data, source
  )
  VALUES (
    p_tenant_id, auth.uid(), 'tenant_domain_deleted', 'tenant_domains', p_domain_id,
    jsonb_build_object('domain', v_row.domain),
    'server'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_tenant_domain(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_tenant_domain(uuid, uuid) TO authenticated;

-- Public storefront resolution by verified hostname (exposes minimal branding only)
CREATE OR REPLACE FUNCTION public.resolve_tenant_by_domain(p_host text)
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
  FROM public.tenant_domains td
  JOIN public.tenants t ON t.id = td.tenant_id
  LEFT JOIN public.tenant_settings ts ON ts.tenant_id = t.id
  WHERE td.domain = lower(split_part(trim(p_host), ':', 1))
    AND td.verification_status = 'verified'
    AND t.status = 'active'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_tenant_by_domain(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tenant_by_domain(text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 9. Server-Side RPCs: Audited Platform Support Access (Timed & Reason-Bound)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_platform_support_access(
  p_tenant_id uuid,
  p_reason text,
  p_duration_minutes integer DEFAULT 60,
  p_access_mode text DEFAULT 'read_only'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_clean_reason text := trim(COALESCE(p_reason, ''));
  v_duration integer := COALESCE(p_duration_minutes, 60);
  v_mode text := COALESCE(NULLIF(trim(p_access_mode), ''), 'read_only');
  v_row public.platform_support_access%ROWTYPE;
BEGIN
  IF NOT app_private.current_user_is_platform_admin() THEN
    RAISE EXCEPTION 'طلب جلسة دخول الدعم مقتصر على فريق المنصة المركزية.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'الشركة المحددة غير موجودة.';
  END IF;

  IF char_length(v_clean_reason) < 5 THEN
    RAISE EXCEPTION 'يجب كتابة سبب واضح لا يقل عن 5 أحرف قبل بدء جلسة الدعم.';
  END IF;

  IF v_duration < 15 OR v_duration > 480 THEN
    RAISE EXCEPTION 'مدة جلسة الدعم المسموحة بين 15 و 480 دقيقة.';
  END IF;

  IF v_mode NOT IN ('read_only', 'diagnostic_assist') THEN
    RAISE EXCEPTION 'نمط دخول الدعم غير صالح.';
  END IF;

  INSERT INTO public.platform_support_access (
    support_user_id, tenant_id, reason, access_mode, expires_at, created_by
  )
  VALUES (
    auth.uid(),
    p_tenant_id,
    v_clean_reason,
    v_mode,
    now() + make_interval(mins => v_duration),
    auth.uid()
  )
  RETURNING * INTO v_row;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    p_tenant_id, auth.uid(), 'platform_support_access_granted', 'platform_support_access', v_row.id,
    jsonb_build_object(
      'reason', v_row.reason,
      'access_mode', v_row.access_mode,
      'duration_minutes', v_duration,
      'expires_at', v_row.expires_at
    ),
    'server'
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.request_platform_support_access(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_platform_support_access(uuid, text, integer, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_platform_support_access(p_access_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_row public.platform_support_access%ROWTYPE;
BEGIN
  IF NOT app_private.current_user_is_platform_admin() THEN
    RAISE EXCEPTION 'إنهاء جلسات الدعم مقتصر على مسؤولي المنصة.';
  END IF;

  SELECT * INTO v_row
  FROM public.platform_support_access
  WHERE id = p_access_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'جلسة الدعم المطلوبة غير موجودة.';
  END IF;

  IF NOT app_private.current_user_is_platform_super_admin() AND v_row.support_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'لا يمكنك إنهاء جلسة دعم لموظف آخر.';
  END IF;

  UPDATE public.platform_support_access
  SET revoked_at = COALESCE(revoked_at, now())
  WHERE id = p_access_id
  RETURNING * INTO v_row;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    v_row.tenant_id, auth.uid(), 'platform_support_access_revoked', 'platform_support_access', v_row.id,
    jsonb_build_object('revoked_at', v_row.revoked_at),
    'server'
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_platform_support_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_platform_support_access(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_platform_support_sessions(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  IF p_tenant_id IS NULL THEN
    IF NOT app_private.current_user_is_platform_admin() THEN
      RAISE EXCEPTION 'استعراض سجل جلسات الدعم الكامل مقتصر على إدارة المنصة.';
    END IF;
  ELSE
    IF NOT (
      app_private.current_user_is_platform_admin()
      OR app_private.user_is_tenant_admin(p_tenant_id)
    ) THEN
      RAISE EXCEPTION 'غير مصرح بعرض سجل جلسات الدعم لهذه الشركة.';
    END IF;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', psa.id,
      'support_user_id', psa.support_user_id,
      'support_username', pa.username,
      'tenant_id', psa.tenant_id,
      'tenant_name', t.name,
      'tenant_slug', t.slug,
      'reason', psa.reason,
      'access_mode', psa.access_mode,
      'expires_at', psa.expires_at,
      'revoked_at', psa.revoked_at,
      'last_entered_at', psa.last_entered_at,
      'created_at', psa.created_at
    ) ORDER BY psa.created_at DESC)
    FROM public.platform_support_access psa
    JOIN public.platform_admins pa ON pa.user_id = psa.support_user_id
    JOIN public.tenants t ON t.id = psa.tenant_id
    WHERE (p_tenant_id IS NULL OR psa.tenant_id = p_tenant_id)
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.list_platform_support_sessions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_platform_support_sessions(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_platform_tenant_support_snapshot(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_grant public.platform_support_access%ROWTYPE;
  v_tenant public.tenants%ROWTYPE;
BEGIN
  IF NOT app_private.current_user_is_platform_admin() THEN
    RAISE EXCEPTION 'المعاينة التشخيصية مقتصرة على مسؤولي المنصة.';
  END IF;

  SELECT * INTO v_grant
  FROM public.platform_support_access
  WHERE tenant_id = p_tenant_id
    AND support_user_id = auth.uid()
    AND revoked_at IS NULL
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'يجب فتح جلسة دعم نشطة ومسببة قبل الدخول إلى لوحة التشخيص.';
  END IF;

  SELECT * INTO v_tenant FROM public.tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الشركة غير موجودة.';
  END IF;

  UPDATE public.platform_support_access
  SET last_entered_at = now()
  WHERE id = v_grant.id;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    p_tenant_id, auth.uid(), 'platform_support_snapshot_viewed', 'platform_support_access', v_grant.id,
    jsonb_build_object('reason', v_grant.reason, 'access_mode', v_grant.access_mode),
    'server'
  );

  RETURN jsonb_build_object(
    'support_session', jsonb_build_object(
      'id', v_grant.id,
      'reason', v_grant.reason,
      'access_mode', v_grant.access_mode,
      'expires_at', v_grant.expires_at
    ),
    'tenant', jsonb_build_object(
      'id', v_tenant.id,
      'code', v_tenant.code,
      'slug', v_tenant.slug,
      'name', v_tenant.name,
      'status', v_tenant.status
    ),
    'metrics', jsonb_build_object(
      'branches_count', (SELECT count(*) FROM public.branches b WHERE b.tenant_id = p_tenant_id),
      'active_users_count', (SELECT count(*) FROM public.tenant_memberships tm WHERE tm.tenant_id = p_tenant_id AND tm.is_active = true),
      'clients_count', (SELECT count(*) FROM public.clients cl WHERE cl.tenant_id = p_tenant_id AND cl.archived_at IS NULL),
      'couriers_count', (SELECT count(*) FROM public.couriers cr WHERE cr.tenant_id = p_tenant_id AND cr.archived_at IS NULL),
      'total_shipments_count', (SELECT count(*) FROM public.shipments s WHERE s.tenant_id = p_tenant_id),
      'delivered_shipments_count', (SELECT count(*) FROM public.shipments s WHERE s.tenant_id = p_tenant_id AND s.operational_status = 'delivered'),
      'failed_shipments_count', (SELECT count(*) FROM public.shipments s WHERE s.tenant_id = p_tenant_id AND s.operational_status = 'delivery_failed')
    ),
    'recent_audit_events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', al.id,
        'action', al.action,
        'entity_type', al.entity_type,
        'source', al.source,
        'created_at', al.created_at
      ) ORDER BY al.created_at DESC)
      FROM (
        SELECT id, action, entity_type, source, created_at
        FROM audit.audit_logs
        WHERE tenant_id = p_tenant_id
        ORDER BY created_at DESC
        LIMIT 10
      ) al
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_platform_tenant_support_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_platform_tenant_support_snapshot(uuid) TO authenticated;
