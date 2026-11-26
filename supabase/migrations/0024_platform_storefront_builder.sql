-- ============================================================================
-- Migration 0024: Platform-Controlled Tenant Storefront Builder
-- - Super admins own every public-site setting for every tenant.
-- - Tenant branding remains isolated, but tenant settings no longer edit it.
-- - Storefront content is an extensible validated JSON document.
-- - Public assets use an isolated public bucket for uploads.
-- ============================================================================

ALTER TABLE public.tenant_branding
  ADD COLUMN IF NOT EXISTS storefront_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tenant_branding.storefront_config IS
  'Bilingual storefront builder configuration: locale, hero layout, navigation, features, pricing rows, CTAs, social links, custom sections, footer and contact accounts.';

-- Platform-super-admin-only public storefront asset bucket.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'tenant-storefront-assets',
  'tenant-storefront-assets',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS tenant_storefront_asset_insert ON storage.objects;
CREATE POLICY tenant_storefront_asset_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-storefront-assets'
    AND app_private.try_parse_uuid((storage.foldername(name))[1]) IS NOT NULL
    AND app_private.current_user_is_platform_super_admin()
  );

DROP POLICY IF EXISTS tenant_storefront_asset_update ON storage.objects;
CREATE POLICY tenant_storefront_asset_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'tenant-storefront-assets'
    AND app_private.current_user_is_platform_super_admin()
  )
  WITH CHECK (
    bucket_id = 'tenant-storefront-assets'
    AND app_private.current_user_is_platform_super_admin()
  );

DROP POLICY IF EXISTS tenant_storefront_asset_delete ON storage.objects;
CREATE POLICY tenant_storefront_asset_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'tenant-storefront-assets'
    AND app_private.current_user_is_platform_super_admin()
  );

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
  v_config jsonb;
  v_row public.tenant_branding%ROWTYPE;
BEGIN
  IF NOT app_private.current_user_is_platform_super_admin() THEN
    RAISE EXCEPTION 'تعديل إعدادات الموقع العام للشركة مقتصر على المدير الأعلى للمنصة.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'الشركة المحددة غير موجودة.';
  END IF;

  IF v_primary !~ '^#[0-9a-f]{6}$'
    OR v_secondary !~ '^#[0-9a-f]{6}$'
    OR v_accent !~ '^#[0-9a-f]{6}$' THEN
    RAISE EXCEPTION 'الألوان يجب أن تكون بصيغة #rrggbb.';
  END IF;

  IF NOT (v_font = ANY(app_private.tenant_branding_fonts())) THEN
    RAISE EXCEPTION 'الخط % غير معتمد.', v_font;
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
    COALESCE(
      p_payload -> 'sections',
      (SELECT b.sections FROM public.tenant_branding b WHERE b.tenant_id = p_tenant_id)
    )
  );

  v_config := COALESCE(
    p_payload -> 'storefront_config',
    (SELECT b.storefront_config FROM public.tenant_branding b WHERE b.tenant_id = p_tenant_id),
    '{}'::jsonb
  );

  IF jsonb_typeof(v_config) <> 'object' THEN
    RAISE EXCEPTION 'تهيئة متجر الشركة يجب أن تكون كائن JSON.';
  END IF;
  IF char_length(v_config::text) > 500000 THEN
    RAISE EXCEPTION 'تهيئة متجر الشركة تجاوزت الحد المسموح.';
  END IF;

  INSERT INTO public.tenant_branding (
    tenant_id, primary_color, secondary_color, accent_color, font_family,
    logo_path, favicon_path, hero_image_path, hero_title, hero_subtitle,
    theme_mode, sections, storefront_config, settings_version, updated_by
  )
  VALUES (
    p_tenant_id, v_primary, v_secondary, v_accent, v_font,
    v_logo, v_favicon, v_hero_image, v_hero_title, v_hero_subtitle,
    v_theme, v_sections, v_config, 1, auth.uid()
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
      storefront_config = EXCLUDED.storefront_config,
      settings_version = public.tenant_branding.settings_version + 1,
      updated_by = auth.uid()
  RETURNING * INTO v_row;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    p_tenant_id, auth.uid(), 'tenant_storefront_updated', 'tenant_branding', v_row.tenant_id,
    jsonb_build_object(
      'primary_color', v_row.primary_color,
      'secondary_color', v_row.secondary_color,
      'accent_color', v_row.accent_color,
      'font_family', v_row.font_family,
      'theme_mode', v_row.theme_mode,
      'settings_version', v_row.settings_version
    ),
    'server'
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_branding(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_branding(uuid, jsonb) TO authenticated;

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
    'logo_path', COALESCE(b.logo_path, ts.brand_logo_path),
    'favicon_path', b.favicon_path,
    'hero_image_path', b.hero_image_path,
    'hero_title', b.hero_title,
    'hero_subtitle', b.hero_subtitle,
    'theme_mode', COALESCE(b.theme_mode, 'light'),
    'sections', COALESCE(b.sections, app_private.default_tenant_sections()),
    'storefront_config', COALESCE(b.storefront_config, '{}'::jsonb),
    'settings_version', COALESCE(b.settings_version, 1)
  )
  INTO v_branding
  FROM (SELECT 1) AS seed
  LEFT JOIN public.tenant_branding b ON b.tenant_id = v_tenant_row.id
  LEFT JOIN public.tenant_settings ts ON ts.tenant_id = v_tenant_row.id;

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
