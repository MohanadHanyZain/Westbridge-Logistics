-- ============================================================================
-- 0021 — Platform Base Domain & Host Routing Preparation
-- ----------------------------------------------------------------------------
-- الغرض:
--   1) مصدر واحد للنطاق الأساسي للمنصة بدل القيمة المثبتة داخل المشغّل.
--   2) إعادة توليد النطاقات الفرعية للشركات من هذا المصدر.
--   3) السماح للواجهة بتوجيه الطلبات حسب النطاق (host-based routing).
--
-- ملاحظة تشغيلية:
--   قيمة base_domain أدناه قيمة مبدئية قابلة للتغيير بجملة UPDATE واحدة:
--     UPDATE public.platform_settings SET base_domain = 'example.com' WHERE id = true;
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Platform Settings (single row)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  base_domain text NOT NULL
    CHECK (
      base_domain = lower(trim(base_domain))
      AND char_length(base_domain) BETWEEN 4 AND 253
      AND base_domain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
    ),
  support_email text,
  allow_custom_domains boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.platform_settings IS
  'إعدادات المنصة العامة في صف واحد: النطاق الأساسي للنطاقات الفرعية، وإتاحة النطاقات المخصصة.';

INSERT INTO public.platform_settings (base_domain, allow_custom_domains)
VALUES ('westbridge-logistics.com', false)
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_platform_settings_updated_at ON public.platform_settings;
CREATE TRIGGER trg_platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_settings_public_read ON public.platform_settings;
CREATE POLICY platform_settings_public_read ON public.platform_settings
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS platform_settings_platform_admin_update ON public.platform_settings;
CREATE POLICY platform_settings_platform_admin_update ON public.platform_settings
  FOR UPDATE TO authenticated
  USING (app_private.current_user_is_platform_super_admin())
  WITH CHECK (app_private.current_user_is_platform_super_admin());

REVOKE INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.platform_settings FROM anon, authenticated;
GRANT SELECT ON public.platform_settings TO anon, authenticated;
GRANT UPDATE ON public.platform_settings TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Base domain accessor
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.platform_base_domain()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT lower(trim(base_domain))
  FROM public.platform_settings
  WHERE id = true
  LIMIT 1;
$$;

-- ----------------------------------------------------------------------------
-- 3. Re-provision trigger without the hardcoded '.shipflow.app' suffix
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.provision_tenant_phase15_defaults()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_starter_plan_id uuid;
  v_base_domain text;
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

  SELECT app_private.platform_base_domain() INTO v_base_domain;

  IF v_base_domain IS NOT NULL AND char_length(v_base_domain) > 0 THEN
    INSERT INTO public.tenant_domains (
      tenant_id, domain, domain_type, is_primary,
      verification_status, verified_at, ssl_status, created_by, updated_by
    )
    VALUES (
      NEW.id, lower(NEW.slug) || '.' || v_base_domain, 'subdomain', true,
      'verified', now(), 'active', NEW.created_by, NEW.created_by
    )
    ON CONFLICT (domain) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenants_phase15_defaults ON public.tenants;
CREATE TRIGGER trg_tenants_phase15_defaults
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION app_private.provision_tenant_phase15_defaults();

-- ----------------------------------------------------------------------------
-- 4. Backfill: move existing subdomains from *.shipflow.app to the base domain
-- ----------------------------------------------------------------------------
WITH settings AS (
  SELECT lower(trim(base_domain)) AS base_domain
  FROM public.platform_settings
  WHERE id = true
),
candidates AS (
  SELECT
    td.id,
    lower(t.slug) || '.' || s.base_domain AS target_domain
  FROM public.tenant_domains td
  JOIN public.tenants t ON t.id = td.tenant_id
  CROSS JOIN settings s
  WHERE td.domain_type = 'subdomain'
    AND td.domain LIKE '%.shipflow.app'
    AND td.domain <> lower(t.slug) || '.' || s.base_domain
)
UPDATE public.tenant_domains td
SET domain = c.target_domain,
    updated_at = now()
FROM candidates c
WHERE td.id = c.id
  AND NOT EXISTS (
    SELECT 1
    FROM public.tenant_domains existing
    WHERE existing.domain = c.target_domain
  );

-- ----------------------------------------------------------------------------
-- 5. Provision a subdomain for tenants that have none (and no primary domain)
-- ----------------------------------------------------------------------------
INSERT INTO public.tenant_domains (
  tenant_id, domain, domain_type, is_primary, verification_status, verified_at, ssl_status
)
SELECT
  t.id,
  lower(t.slug) || '.' || s.base_domain,
  'subdomain',
  true,
  'verified',
  now(),
  'active'
FROM public.tenants t
CROSS JOIN (
  SELECT lower(trim(base_domain)) AS base_domain
  FROM public.platform_settings
  WHERE id = true
) s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.tenant_domains td
  WHERE td.tenant_id = t.id
    AND (td.domain_type = 'subdomain' OR td.is_primary = true)
)
ON CONFLICT (domain) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 6. Verification queries (read-only, safe to run after the migration)
-- ----------------------------------------------------------------------------
-- SELECT * FROM public.platform_settings;
-- SELECT t.slug, td.domain, td.domain_type, td.is_primary, td.verification_status
-- FROM public.tenants t
-- LEFT JOIN public.tenant_domains td ON td.tenant_id = t.id
-- ORDER BY t.slug;
