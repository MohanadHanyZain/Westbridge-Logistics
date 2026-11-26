-- ============================================================================
-- 0022 — Optional Platform Base Domain (Path-Only Mode)
-- ----------------------------------------------------------------------------
-- الغرض:
--   1) السماح بأن يكون `platform_settings.base_domain` فارغًا (NULL) إلى حين
--      امتلاك نطاق فعلي، فتعمل المنصة بوضع المسار `/c/{slug}` فقط.
--   2) إلغاء القيمة المؤقتة `westbridge-logistics.com` التي لم تكن مملوكة للمنصة
--      وتعطيل النطاقات الفرعية المولّدة منها دون حذف أي صف.
--   3) منع أي نطاق فرعي لا يقع تحت النطاق الأساسي الحالي (حماية على مستوى الجدول).
--
-- الأثر على التشغيل:
--   - تشغيل هذا الترحيل لا يتلف أي بيانات: لا حذف لأي صف، ولا حذف لأي نطاق
--     مخصص أضافه عميل.
--   - بعد التشغيل يعمل وضع المسار فقط حتى يتم ضبط النطاق الأساسي مرة واحدة:
--       UPDATE public.platform_settings SET base_domain = 'your-domain.com' WHERE id = true;
--     ثم ضبط VITE_PLATFORM_BASE_DOMAIN في Vercel وإضافة الدومين و*.الدومين هناك.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. `base_domain` يصبح اختياريًا (NULL = وضع المسار فقط)
-- ----------------------------------------------------------------------------
ALTER TABLE public.platform_settings
  ALTER COLUMN base_domain DROP NOT NULL;

-- إزالة أي قيد تحقّق قديم يشير إلى base_domain، ثم إعادة تعريفه بصيغة تسمح بـ NULL.
DO $$
DECLARE
  v_constraint text;
BEGIN
  FOR v_constraint IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'public'
      AND rel.relname = 'platform_settings'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%base_domain%'
  LOOP
    EXECUTE format('ALTER TABLE public.platform_settings DROP CONSTRAINT %I', v_constraint);
  END LOOP;
END;
$$;

ALTER TABLE public.platform_settings
  ADD CONSTRAINT platform_settings_base_domain_shape
  CHECK (
    base_domain IS NULL
    OR (
      base_domain = lower(trim(base_domain))
      AND char_length(base_domain) BETWEEN 4 AND 253
      AND base_domain ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'
    )
  );

COMMENT ON COLUMN public.platform_settings.base_domain IS
  'النطاق الأساسي لنطاقات الشركات ({slug}.{base_domain}). القيمة NULL تعني تعطيل النطاقات الفرعية والعمل بوضع المسار /c/{slug} فقط.';

COMMENT ON TABLE public.platform_settings IS
  'إعدادات المنصة العامة في صف واحد: النطاق الأساسي للنطاقات الفرعية (اختياري)، وإتاحة النطاقات المخصصة.';

-- ----------------------------------------------------------------------------
-- 2. إلغاء القيمة المؤقتة غير المملوكة
-- ----------------------------------------------------------------------------
UPDATE public.platform_settings
SET base_domain = NULL
WHERE id = true
  AND base_domain = 'westbridge-logistics.com';

-- ----------------------------------------------------------------------------
-- 3. تعطيل النطاقات الفرعية المولّدة من القيمة المؤقتة (بدون حذف)
--    resolve_tenant_by_domain لا يعمل إلا على verification_status = 'verified'،
--    فتحويلها إلى pending يمنع الوصول عبر نطاق لا نملكه مع الاحتفاظ بالسجل.
-- ----------------------------------------------------------------------------
UPDATE public.tenant_domains td
SET verification_status = 'pending',
    verified_at = NULL,
    ssl_status = 'pending'
WHERE td.domain_type = 'subdomain'
  AND td.domain LIKE '%.westbridge-logistics.com'
  AND (
    td.verification_status <> 'pending'
    OR td.verified_at IS NOT NULL
    OR td.ssl_status <> 'pending'
  );

-- ----------------------------------------------------------------------------
-- 4. منع أي نطاق فرعي خارج النطاق الأساسي الحالي
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.enforce_tenant_domain_shape()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_base text := app_private.platform_base_domain();
BEGIN
  IF NEW.domain_type <> 'subdomain' THEN
    RETURN NEW;
  END IF;

  IF v_base IS NULL OR char_length(v_base) = 0 THEN
    RAISE EXCEPTION 'النطاقات الفرعية معطّلة حتى يتم ضبط النطاق الأساسي للمنصة في platform_settings.base_domain.';
  END IF;

  IF NEW.domain = v_base
     OR right(NEW.domain, char_length(v_base) + 1) <> '.' || v_base THEN
    RAISE EXCEPTION 'النطاق الفرعي (%) يجب أن ينتهي بالنطاق الأساسي للمنصة (%).', NEW.domain, v_base;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenant_domains_shape ON public.tenant_domains;
CREATE TRIGGER trg_tenant_domains_shape
  BEFORE INSERT OR UPDATE OF domain, domain_type ON public.tenant_domains
  FOR EACH ROW EXECUTE FUNCTION app_private.enforce_tenant_domain_shape();

COMMIT;

-- ----------------------------------------------------------------------------
-- 5. استعلامات تحقق (قراءة فقط، آمنة بعد الترحيل)
-- ----------------------------------------------------------------------------
-- SELECT base_domain, allow_custom_domains, updated_at FROM public.platform_settings;
-- SELECT t.slug, td.domain, td.domain_type, td.verification_status, td.ssl_status
-- FROM public.tenants t
-- LEFT JOIN public.tenant_domains td ON td.tenant_id = t.id
-- ORDER BY t.slug;
