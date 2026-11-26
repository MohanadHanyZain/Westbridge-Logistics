-- ============================================================================
-- Migration 0025: Platform-Controlled Tenant Identity
-- Super admins can rename a tenant and change its slug/path/primary subdomain.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_tenant_identity(
  p_tenant_id uuid,
  p_name text,
  p_slug text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_name text := trim(COALESCE(p_name, ''));
  v_slug text := lower(trim(COALESCE(p_slug, '')));
  v_old_slug text;
  v_old_name text;
  v_base_domain text;
  v_row public.tenants%ROWTYPE;
BEGIN
  IF NOT app_private.current_user_is_platform_super_admin() THEN
    RAISE EXCEPTION 'تعديل اسم الشركة ومسارها مقتصر على المدير الأعلى للمنصة.';
  END IF;

  IF char_length(v_name) < 2 OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'اسم الشركة يجب أن يتراوح بين حرفين و120 حرفًا.';
  END IF;

  IF v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' OR char_length(v_slug) < 2 OR char_length(v_slug) > 48 THEN
    RAISE EXCEPTION 'المسار النصي يجب أن يكون أحرفًا إنجليزية صغيرة وأرقامًا وشرطات مثل cairo-express.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.tenants t
    WHERE t.slug = v_slug
      AND t.id <> p_tenant_id
  ) THEN
    RAISE EXCEPTION 'المسار النصي مستخدم بالفعل لشركة أخرى.';
  END IF;

  SELECT t.slug, t.name
  INTO v_old_slug, v_old_name
  FROM public.tenants t
  WHERE t.id = p_tenant_id;

  IF v_old_slug IS NULL THEN
    RAISE EXCEPTION 'الشركة المحددة غير موجودة.';
  END IF;

  UPDATE public.tenants
  SET name = v_name,
      slug = v_slug,
      updated_by = auth.uid()
  WHERE id = p_tenant_id
  RETURNING * INTO v_row;

  SELECT app_private.platform_base_domain()
  INTO v_base_domain;

  IF v_base_domain IS NOT NULL AND char_length(v_base_domain) > 0 THEN
    UPDATE public.tenant_domains
    SET domain = v_slug || '.' || v_base_domain,
        updated_at = now()
    WHERE tenant_id = p_tenant_id
      AND domain_type = 'subdomain'
      AND is_primary = true;
  END IF;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, before_data, after_data, source
  )
  VALUES (
    p_tenant_id,
    auth.uid(),
    'tenant_identity_updated',
    'tenants',
    p_tenant_id,
    jsonb_build_object('name', v_old_name, 'slug', v_old_slug),
    jsonb_build_object('name', v_name, 'slug', v_slug),
    'server'
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_identity(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_identity(uuid, text, text) TO authenticated;
