-- ============================================================================
-- Migration 0002: Service-Role-Only RPC Wrappers for Edge Functions
-- ============================================================================
-- Rationale:
-- Keeps `app_private` and `audit` schemas completely unexposed in PostgREST
-- Data API while allowing Edge Functions (running exclusively with service_role)
-- to execute identity resolution, tenant onboarding, and session auditing via
-- default `public` RPC endpoints.
-- Access to all functions below is REVOKED from PUBLIC, anon, and authenticated.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.srv_resolve_login_identity(
  p_scope text,
  p_tenant_id uuid,
  p_username text
)
RETURNS TABLE (
  user_id uuid,
  auth_email text,
  is_active boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT ai.user_id, ai.auth_email, ai.is_active
  FROM app_private.auth_identities ai
  WHERE ai.scope_type = p_scope
    AND lower(ai.username) = lower(trim(p_username))
    AND (
      (p_scope = 'platform' AND ai.tenant_id IS NULL)
      OR (p_scope = 'tenant' AND ai.tenant_id = p_tenant_id)
    )
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.srv_resolve_login_identity(text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_resolve_login_identity(text, uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.srv_onboard_tenant(
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
  SELECT * FROM app_private.onboard_tenant(
    p_idempotency_key,
    p_actor_user_id,
    p_code,
    p_slug,
    p_name,
    p_owner_user_id,
    p_owner_username,
    p_owner_display_name,
    p_owner_email,
    p_owner_email_masked
  );
$$;

REVOKE ALL ON FUNCTION public.srv_onboard_tenant(text, uuid, text, text, text, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_onboard_tenant(text, uuid, text, text, text, uuid, text, text, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.srv_update_auth_identity_username(
  p_user_id uuid,
  p_scope text,
  p_tenant_id uuid,
  p_new_username text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  UPDATE app_private.auth_identities
  SET username = lower(trim(p_new_username))
  WHERE user_id = p_user_id
    AND scope_type = p_scope
    AND (
      (p_scope = 'platform' AND tenant_id IS NULL)
      OR (p_scope = 'tenant' AND tenant_id = p_tenant_id)
    );
$$;

REVOKE ALL ON FUNCTION public.srv_update_auth_identity_username(uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_update_auth_identity_username(uuid, text, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.srv_log_session_audit(
  p_tenant_id uuid,
  p_user_id uuid,
  p_event_type text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, audit
AS $$
  INSERT INTO audit.user_sessions_audit (tenant_id, user_id, event_type, metadata)
  VALUES (p_tenant_id, p_user_id, p_event_type, COALESCE(p_metadata, '{}'::jsonb));
$$;

REVOKE ALL ON FUNCTION public.srv_log_session_audit(uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_log_session_audit(uuid, uuid, text, jsonb)
  TO service_role;
