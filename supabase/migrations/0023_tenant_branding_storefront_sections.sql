-- ============================================================================
-- 0023 — Tenant Branding & Storefront Sections (Phase 2)
-- ----------------------------------------------------------------------------
-- الغرض:
--   1) جدول `tenant_branding` بهوية كل شركة (ألوان، خط، شعار، صورة غلاف،
--      عنوان رئيسي، وصف، نمط الظهور) بحسب خطة المرحلة 2.
--   2) سجل أقسام المتجر (Section registry) بترتيب وإظهار قابلين للتعديل من
--      الواجهة دون إعادة نشر.
--   3) دوال قراءة/تحديث محمية: أعضاء الشركة يقرؤون، مدير الشركة يكتب،
--      والزائر يقرأ الحقول العامة فقط عبر `get_public_tenant_storefront`.
--
-- ملاحظات:
--   - لا يُسمح بأي DML مباشر على الجدول من anon أو authenticated؛ الكتابة عبر
--     الدالة `update_tenant_branding` فقط، وكل تغيير يُسجَّل في سجل التدقيق.
--   - الألوان بصيغة `#rrggbb` فقط، والخطوط من قائمة معتمدة، ونمط الظهور
--     `light` أو `dark`، والأقسام يجب أن تطابق السجل بالكامل دون تكرار.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. سجل الأقسام المعتمد (مصدر واحد للحقيقة)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.tenant_section_catalog()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT ARRAY[
    'hero',
    'tracking',
    'services',
    'coverage',
    'stats',
    'about',
    'faq',
    'contact',
    'registration',
    'app_download'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION app_private.tenant_branding_fonts()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT ARRAY[
    'Cairo',
    'Tajawal',
    'Almarai',
    'IBM Plex Sans Arabic'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION app_private.default_tenant_sections()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_array(
    jsonb_build_object('id', 'hero', 'visible', true),
    jsonb_build_object('id', 'tracking', 'visible', true),
    jsonb_build_object('id', 'services', 'visible', true),
    jsonb_build_object('id', 'coverage', 'visible', true),
    jsonb_build_object('id', 'stats', 'visible', true),
    jsonb_build_object('id', 'about', 'visible', false),
    jsonb_build_object('id', 'faq', 'visible', false),
    jsonb_build_object('id', 'contact', 'visible', true),
    jsonb_build_object('id', 'registration', 'visible', true),
    jsonb_build_object('id', 'app_download', 'visible', false)
  );
$$;

-- تحقّق وتطبيع الأقسام: ترتيب محفوظ، لا تكرار، ولا أقسام خارج السجل.
CREATE OR REPLACE FUNCTION app_private.validate_tenant_sections(p_sections jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_catalog text[] := app_private.tenant_section_catalog();
  v_item jsonb;
  v_id text;
  v_seen text[] := ARRAY[]::text[];
  v_text text;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF p_sections IS NULL OR jsonb_typeof(p_sections) <> 'array' THEN
    RAISE EXCEPTION 'قائمة الأقسام يجب أن تكون مصفوفة JSON.';
  END IF;

  IF jsonb_array_length(p_sections) <> array_length(v_catalog, 1) THEN
    RAISE EXCEPTION 'قائمة الأقسام يجب أن تشمل كل الأقسام المعتمدة (%) دون زيادة أو نقصان.',
      array_length(v_catalog, 1);
  END IF;

  FOR v_item IN SELECT jsonb_array_elements(p_sections) LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'كل قسم يجب أن يكون كائنًا يحوي المعرف وحالة الإظهار.';
    END IF;

    v_id := v_item ->> 'id';

    IF v_id IS NULL OR NOT (v_id = ANY(v_catalog)) THEN
      RAISE EXCEPTION 'قسم غير معروف: %.', COALESCE(v_id, '(بدون معرف)');
    END IF;

    IF v_id = ANY(v_seen) THEN
      RAISE EXCEPTION 'القسم % مكرر في القائمة.', v_id;
    END IF;

    v_seen := v_seen || v_id;

    v_text := NULLIF(trim(COALESCE(v_item ->> 'text', '')), '');
    IF v_text IS NOT NULL AND char_length(v_text) > 2000 THEN
      RAISE EXCEPTION 'نص القسم % يتجاوز الحد المسموح (2000 حرف).', v_id;
    END IF;

    v_out := v_out || jsonb_build_array(
      jsonb_build_object('id', v_id, 'visible', (v_item ->> 'visible') IS DISTINCT FROM 'false')
      || CASE WHEN v_text IS NOT NULL THEN jsonb_build_object('text', v_text) ELSE '{}'::jsonb END
    );
  END LOOP;

  RETURN v_out;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. جدول هوية الشركة
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_branding (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  primary_color text NOT NULL DEFAULT '#ef6a47'
    CHECK (primary_color ~ '^#[0-9a-f]{6}$'),
  secondary_color text NOT NULL DEFAULT '#1f2937'
    CHECK (secondary_color ~ '^#[0-9a-f]{6}$'),
  accent_color text NOT NULL DEFAULT '#0f766e'
    CHECK (accent_color ~ '^#[0-9a-f]{6}$'),
  font_family text NOT NULL DEFAULT 'Cairo'
    CHECK (font_family IN ('Cairo', 'Tajawal', 'Almarai', 'IBM Plex Sans Arabic')),
  logo_path text,
  favicon_path text,
  hero_image_path text,
  hero_title text CHECK (hero_title IS NULL OR char_length(hero_title) <= 80),
  hero_subtitle text CHECK (hero_subtitle IS NULL OR char_length(hero_subtitle) <= 240),
  theme_mode text NOT NULL DEFAULT 'light' CHECK (theme_mode IN ('light', 'dark')),
  sections jsonb NOT NULL DEFAULT app_private.default_tenant_sections(),
  settings_version integer NOT NULL DEFAULT 1 CHECK (settings_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT
);

COMMENT ON TABLE public.tenant_branding IS
  'هوية كل شركة البصرية وأقسام متجرها: ألوان، خط، شعار، غلاف، عنوان رئيسي، وترتيب الأقسام.';
COMMENT ON COLUMN public.tenant_branding.sections IS
  'قائمة أقسام المتجر بترتيب العرض وحالة الإظهار، مطابقة لسجل app_private.tenant_section_catalog().';
COMMENT ON COLUMN public.tenant_branding.settings_version IS
  'يزيد تلقائيًا مع كل تحديث للهوية، ويستخدم لإبطال أي نسخة مخزّنة في المتصفح.';

DROP TRIGGER IF EXISTS trg_tenant_branding_updated_at ON public.tenant_branding;
CREATE TRIGGER trg_tenant_branding_updated_at
  BEFORE UPDATE ON public.tenant_branding
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. التعبئة الرجعية والتزويد التلقائي عند إنشاء شركة
-- ----------------------------------------------------------------------------
INSERT INTO public.tenant_branding (tenant_id, logo_path)
SELECT t.id, ts.brand_logo_path
FROM public.tenants t
LEFT JOIN public.tenant_settings ts ON ts.tenant_id = t.id
ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION app_private.provision_tenant_branding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  INSERT INTO public.tenant_branding (tenant_id, updated_by)
  VALUES (NEW.id, NEW.created_by)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tenants_default_branding ON public.tenants;
CREATE TRIGGER trg_tenants_default_branding
  AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION app_private.provision_tenant_branding();

-- ----------------------------------------------------------------------------
-- 4. الحماية: FORCE RLS وقراءة للأعضاء فقط (الكتابة عبر RPC)
-- ----------------------------------------------------------------------------
ALTER TABLE public.tenant_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_branding FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_tenant_branding_select ON public.tenant_branding;
CREATE POLICY p_tenant_branding_select
  ON public.tenant_branding
  FOR SELECT
  TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR app_private.user_belongs_to_tenant(tenant_id)
  );

REVOKE ALL ON TABLE public.tenant_branding FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tenant_branding TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. دوال القراءة والتحديث
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_tenant_branding(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  IF NOT (
    app_private.current_user_is_platform_admin()
    OR app_private.user_belongs_to_tenant(p_tenant_id)
  ) THEN
    RAISE EXCEPTION 'غير مصرح بعرض هوية هذه الشركة.';
  END IF;

  RETURN (
    SELECT to_jsonb(b) FROM public.tenant_branding b WHERE b.tenant_id = p_tenant_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_branding(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_branding(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_branding(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_primary text := lower(trim(COALESCE(p_payload ->> 'primary_color', '#ef6a47')));
  v_secondary text := lower(trim(COALESCE(p_payload ->> 'secondary_color', '#1f2937')));
  v_accent text := lower(trim(COALESCE(p_payload ->> 'accent_color', '#0f766e')));
  v_font text := trim(COALESCE(p_payload ->> 'font_family', 'Cairo'));
  v_theme text := lower(trim(COALESCE(p_payload ->> 'theme_mode', 'light')));
  v_logo text := NULLIF(trim(COALESCE(p_payload ->> 'logo_path', '')), '');
  v_favicon text := NULLIF(trim(COALESCE(p_payload ->> 'favicon_path', '')), '');
  v_hero_image text := NULLIF(trim(COALESCE(p_payload ->> 'hero_image_path', '')), '');
  v_hero_title text := NULLIF(trim(COALESCE(p_payload ->> 'hero_title', '')), '');
  v_hero_subtitle text := NULLIF(trim(COALESCE(p_payload ->> 'hero_subtitle', '')), '');
  v_sections jsonb;
  v_row public.tenant_branding%ROWTYPE;
BEGIN
  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
  ) THEN
    RAISE EXCEPTION 'تعديل هوية الشركة وأقسام المتجر مقتصر على إدارة الشركة.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'الشركة المحددة غير موجودة.';
  END IF;

  IF v_primary !~ '^#[0-9a-f]{6}$' OR v_secondary !~ '^#[0-9a-f]{6}$' OR v_accent !~ '^#[0-9a-f]{6}$' THEN
    RAISE EXCEPTION 'الألوان يجب أن تكون بصيغة #rrggbb.';
  END IF;

  IF NOT (v_font = ANY(app_private.tenant_branding_fonts())) THEN
    RAISE EXCEPTION 'الخط % غير معتمد. استخدم خطًا من القائمة المتاحة.', v_font;
  END IF;

  IF v_theme NOT IN ('light', 'dark') THEN
    RAISE EXCEPTION 'نمط الظهور يجب أن يكون light أو dark.';
  END IF;

  IF v_hero_title IS NOT NULL AND char_length(v_hero_title) > 80 THEN
    RAISE EXCEPTION 'العنوان الرئيسي يجب ألا يتجاوز 80 حرفًا.';
  END IF;

  IF v_hero_subtitle IS NOT NULL AND char_length(v_hero_subtitle) > 240 THEN
    RAISE EXCEPTION 'الوصف الرئيسي يجب ألا يتجاوز 240 حرفًا.';
  END IF;

  v_sections := app_private.validate_tenant_sections(
    COALESCE(p_payload -> 'sections', (SELECT b.sections FROM public.tenant_branding b WHERE b.tenant_id = p_tenant_id))
  );

  INSERT INTO public.tenant_branding (
    tenant_id, primary_color, secondary_color, accent_color, font_family,
    logo_path, favicon_path, hero_image_path, hero_title, hero_subtitle,
    theme_mode, sections, settings_version, updated_by
  )
  VALUES (
    p_tenant_id, v_primary, v_secondary, v_accent, v_font,
    v_logo, v_favicon, v_hero_image, v_hero_title, v_hero_subtitle,
    v_theme, v_sections, 1, auth.uid()
  )
  ON CONFLICT (tenant_id) DO UPDATE
    SET
      primary_color = EXCLUDED.primary_color,
      secondary_color = EXCLUDED.secondary_color,
      accent_color = EXCLUDED.accent_color,
      font_family = EXCLUDED.font_family,
      logo_path = EXCLUDED.logo_path,
      favicon_path = EXCLUDED.favicon_path,
      hero_image_path = EXCLUDED.hero_image_path,
      hero_title = EXCLUDED.hero_title,
      hero_subtitle = EXCLUDED.hero_subtitle,
      theme_mode = EXCLUDED.theme_mode,
      sections = EXCLUDED.sections,
      settings_version = public.tenant_branding.settings_version + 1,
      updated_by = auth.uid()
  RETURNING * INTO v_row;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    p_tenant_id, auth.uid(), 'tenant_branding_updated', 'tenant_branding', v_row.tenant_id,
    jsonb_build_object(
      'primary_color', v_row.primary_color,
      'secondary_color', v_row.secondary_color,
      'accent_color', v_row.accent_color,
      'font_family', v_row.font_family,
      'theme_mode', v_row.theme_mode,
      'settings_version', v_row.settings_version,
      'visible_sections', (
        SELECT COALESCE(jsonb_agg(s ->> 'id' ORDER BY ord), '[]'::jsonb)
        FROM jsonb_array_elements(v_row.sections) WITH ORDINALITY AS t(s, ord)
        WHERE (s ->> 'visible') IS DISTINCT FROM 'false'
      )
    ),
    'server'
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_branding(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_branding(uuid, jsonb) TO authenticated;

COMMIT;

-- ----------------------------------------------------------------------------
-- 6. توسيع المتجر العام بالهوية والأقسام
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_tenant_storefront(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant_row record;
  v_branding jsonb;
  v_services jsonb;
  v_govs jsonb;
  v_regs jsonb;
  v_stats jsonb;
BEGIN
  SELECT
    t.id,
    t.slug,
    t.name,
    t.status,
    t.default_timezone,
    t.default_currency,
    t.default_locale,
    COALESCE(ts.allow_client_self_registration, false) AS allow_client_self_registration,
    COALESCE(ts.auto_approve_clients, false) AS auto_approve_clients,
    COALESCE(b.logo_path, ts.brand_logo_path) AS brand_logo_path,
    ts.public_tagline,
    ts.public_support_phone,
    ts.public_support_email
  INTO v_tenant_row
  FROM public.tenants t
  LEFT JOIN public.tenant_settings ts ON ts.tenant_id = t.id
  LEFT JOIN public.tenant_branding b ON b.tenant_id = t.id
  WHERE t.slug = lower(trim(p_slug))
    AND t.status = 'active'
  LIMIT 1;

  IF v_tenant_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ss.id,
    'code', ss.code,
    'name', ss.name,
    'estimated_days_min', ss.estimated_days_min,
    'estimated_days_max', ss.estimated_days_max
  ) ORDER BY ss.code), '[]'::jsonb)
  INTO v_services
  FROM public.shipping_services ss
  WHERE ss.tenant_id = v_tenant_row.id
    AND ss.is_active = true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', g.id,
    'code', g.code,
    'name', g.name
  ) ORDER BY g.code), '[]'::jsonb)
  INTO v_govs
  FROM public.governorates g
  WHERE g.tenant_id = v_tenant_row.id
    AND g.is_active = true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'governorate_id', r.governorate_id,
    'code', r.code,
    'name', r.name
  ) ORDER BY r.code), '[]'::jsonb)
  INTO v_regs
  FROM public.regions r
  WHERE r.tenant_id = v_tenant_row.id
    AND r.is_active = true;

  SELECT jsonb_build_object(
    'primary_color', COALESCE(b.primary_color, '#ef6a47'),
    'secondary_color', COALESCE(b.secondary_color, '#1f2937'),
    'accent_color', COALESCE(b.accent_color, '#0f766e'),
    'font_family', COALESCE(b.font_family, 'Cairo'),
    'logo_path', b.logo_path,
    'favicon_path', b.favicon_path,
    'hero_image_path', b.hero_image_path,
    'hero_title', b.hero_title,
    'hero_subtitle', b.hero_subtitle,
    'theme_mode', COALESCE(b.theme_mode, 'light'),
    'sections', COALESCE(b.sections, app_private.default_tenant_sections()),
    'settings_version', COALESCE(b.settings_version, 1)
  )
  INTO v_branding
  FROM (SELECT 1) AS seed
  LEFT JOIN public.tenant_branding b ON b.tenant_id = v_tenant_row.id;

  v_stats := jsonb_build_object(
    'services_count', jsonb_array_length(v_services),
    'governorates_count', jsonb_array_length(v_govs),
    'regions_count', jsonb_array_length(v_regs)
  );

  RETURN jsonb_build_object(
    'tenant', to_jsonb(v_tenant_row),
    'branding', v_branding,
    'stats', v_stats,
    'services', v_services,
    'governorates', v_govs,
    'regions', v_regs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_tenant_storefront(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_storefront(text) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. استعلامات تحقق (قراءة فقط)
-- ----------------------------------------------------------------------------
-- SELECT tenant_id, primary_color, font_family, theme_mode, settings_version FROM public.tenant_branding;
-- SELECT public.get_public_tenant_storefront('cairo-express') -> 'branding';
