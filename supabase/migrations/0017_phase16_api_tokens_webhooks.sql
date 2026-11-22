-- ============================================================================
-- Migration 0017: Phase 16 - API Tokens, External REST Integrations & Webhooks
--                 (ADR-024)
-- ============================================================================
-- Implements ADR-024 & MASTER_SPEC Sections 02 / 04 / 05:
-- 1. Permissions (`api_tokens.read`, `api_tokens.revoke`, `webhooks.manage`) +
--    idempotent backfill to company_owner, company_admin, and client_owner.
-- 2. `public.api_tokens`: SHA-256 hashed bearer tokens (`sf_live_*`), one-time
--    reveal on creation, tenant or client-scoped isolation, expiry & IP CIDR
--    allowlists, gated by `subscription_plans.allow_api_access`.
-- 3. `public.webhook_endpoints` + isolated `app_private.webhook_secrets`:
--    HTTPS-only public endpoints (blocks localhost/loopback/private/link-local
--    IPs & hostnames), HMAC-SHA256 signing secrets never readable from client.
-- 4. `public.webhook_deliveries` & `public.api_request_logs` + automatic domain
--    event queue triggers (`shipment.created`, `shipment.status_changed`,
--    `pickup_request.updated`, `settlement.approved`).
-- 5. Server-side atomic RPCs for UI & `service_role` wrappers for Edge
--    Function `public-api-v1`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Permissions Registration & Default Role Backfill
-- ----------------------------------------------------------------------------
INSERT INTO public.permissions (key, module, label_ar, description_ar, default_scope, is_sensitive)
VALUES
  ('api_tokens.read', 'integrations', 'استعراض رموز API والتكاملات', 'عرض رموز التكامل ونقاط Webhooks وسجلات التسليم والطلبات.', 'tenant', false),
  ('api_tokens.revoke', 'integrations', 'إبطال رموز API', 'إلغاء وتجميد مفاتيح التكامل البرمجي فورًا.', 'tenant', true),
  ('webhooks.manage', 'integrations', 'إدارة نقاط Webhooks وسجل التسليم', 'إضافة وتعديل نقاط استقبال Webhooks وتدوير أسرار التوقيع.', 'tenant', true)
ON CONFLICT (key) DO UPDATE
  SET module = EXCLUDED.module,
      label_ar = EXCLUDED.label_ar,
      description_ar = EXCLUDED.description_ar,
      default_scope = EXCLUDED.default_scope,
      is_sensitive = EXCLUDED.is_sensitive;

-- Backfill new integration permissions onto existing system roles cleanly
INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, scope)
SELECT
  r.tenant_id,
  r.id,
  p.key,
  CASE
    WHEN r.code = 'client_owner' THEN 'own'
    ELSE 'tenant'
  END
FROM public.roles r
JOIN public.permissions p
  ON p.key IN ('api_tokens.read', 'api_tokens.create', 'api_tokens.revoke', 'webhooks.manage')
WHERE r.code IN ('company_owner', 'company_admin', 'client_owner')
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

-- Ensure future tenants seeded via seed_tenant_phase4_defaults inherit all permissions
CREATE OR REPLACE FUNCTION app_private.seed_tenant_phase16_defaults(
  p_tenant_id uuid,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, scope, created_by)
  SELECT
    r.tenant_id,
    r.id,
    p.key,
    CASE WHEN r.code = 'client_owner' THEN 'own' ELSE 'tenant' END,
    p_actor_user_id
  FROM public.roles r
  JOIN public.permissions p
    ON p.key IN ('api_tokens.read', 'api_tokens.create', 'api_tokens.revoke', 'webhooks.manage')
  WHERE r.tenant_id = p_tenant_id
    AND r.code IN ('company_owner', 'company_admin', 'client_owner')
  ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION app_private.seed_tenant_phase16_defaults(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Tables: api_tokens, webhook_endpoints, webhook_secrets, deliveries, logs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 80),
  token_prefix text NOT NULL CHECK (char_length(token_prefix) BETWEEN 8 AND 24),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  account_scope text NOT NULL CHECK (account_scope IN ('tenant', 'client')),
  client_id uuid,
  scopes text[] NOT NULL
    CHECK (
      cardinality(scopes) >= 1
      AND scopes <@ ARRAY['shipments:read', 'shipments:write', 'tracking:read']::text[]
    ),
  allowed_ips text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_api_tokens_scope_client CHECK (
    (account_scope = 'client' AND client_id IS NOT NULL)
    OR (account_scope = 'tenant' AND client_id IS NULL)
  ),
  CONSTRAINT uq_api_tokens_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_api_tokens_client FOREIGN KEY (tenant_id, client_id)
    REFERENCES public.clients(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_tenant_active
  ON public.api_tokens (tenant_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_tokens_client
  ON public.api_tokens (tenant_id, client_id)
  WHERE client_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_api_tokens_updated_at ON public.api_tokens;
CREATE TRIGGER trg_api_tokens_updated_at
  BEFORE UPDATE ON public.api_tokens
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE IF NOT EXISTS public.webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  client_id uuid,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 80),
  target_url text NOT NULL
    CHECK (target_url ~* '^https://[a-z0-9.-]+(:[0-9]{1,5})?(/.*)?$'),
  events text[] NOT NULL
    CHECK (
      cardinality(events) >= 1
      AND events <@ ARRAY[
        'shipment.created',
        'shipment.status_changed',
        'pickup_request.updated',
        'settlement.approved',
        'webhook.test'
      ]::text[]
    ),
  signing_secret_prefix text NOT NULL CHECK (char_length(signing_secret_prefix) BETWEEN 8 AND 24),
  is_active boolean NOT NULL DEFAULT true,
  failure_count integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  last_triggered_at timestamptz,
  last_status_code integer,
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_webhook_endpoints_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_webhook_endpoints_client FOREIGN KEY (tenant_id, client_id)
    REFERENCES public.clients(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_tenant_active
  ON public.webhook_endpoints (tenant_id, is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_client
  ON public.webhook_endpoints (tenant_id, client_id)
  WHERE client_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_webhook_endpoints_updated_at ON public.webhook_endpoints;
CREATE TRIGGER trg_webhook_endpoints_updated_at
  BEFORE UPDATE ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- Isolated internal table for Webhook HMAC signing secrets (zero grants to client roles)
CREATE TABLE IF NOT EXISTS app_private.webhook_secrets (
  endpoint_id uuid PRIMARY KEY REFERENCES public.webhook_endpoints(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  signing_secret text NOT NULL CHECK (char_length(signing_secret) >= 24),
  rotated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE app_private.webhook_secrets FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  endpoint_id uuid NOT NULL,
  event_type text NOT NULL
    CHECK (event_type IN (
      'shipment.created',
      'shipment.status_changed',
      'pickup_request.updated',
      'settlement.approved',
      'webhook.test'
    )),
  entity_type text NOT NULL,
  entity_id uuid,
  idempotency_key text NOT NULL CHECK (char_length(trim(idempotency_key)) >= 4),
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_status integer,
  response_excerpt text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed', 'dead_letter')),
  next_retry_at timestamptz DEFAULT now(),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_webhook_deliveries_endpoint_idem UNIQUE (endpoint_id, idempotency_key),
  CONSTRAINT fk_webhook_deliveries_endpoint FOREIGN KEY (tenant_id, endpoint_id)
    REFERENCES public.webhook_endpoints(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_tenant_created
  ON public.webhook_deliveries (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
  ON public.webhook_deliveries (status, next_retry_at)
  WHERE status IN ('pending', 'failed');

DROP TRIGGER IF EXISTS trg_webhook_deliveries_updated_at ON public.webhook_deliveries;
CREATE TRIGGER trg_webhook_deliveries_updated_at
  BEFORE UPDATE ON public.webhook_deliveries
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE IF NOT EXISTS public.api_request_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  token_id uuid,
  method text NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  path text NOT NULL CHECK (char_length(trim(path)) >= 1),
  status_code integer NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  ip_address text,
  idempotency_key text,
  duration_ms integer NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_api_request_logs_token FOREIGN KEY (tenant_id, token_id)
    REFERENCES public.api_tokens(tenant_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_api_request_logs_tenant_created
  ON public.api_request_logs (tenant_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. Server-Side URL & Plan Validation Helpers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.validate_public_webhook_url(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean text := trim(COALESCE(p_url, ''));
  v_authority text;
  v_host text;
  v_octets text[];
  v_o1 integer;
  v_o2 integer;
BEGIN
  IF v_clean !~* '^https://' THEN
    RAISE EXCEPTION 'يجب أن يبدأ رابط Webhook ببروتوكول https:// الآمن فقط.';
  END IF;

  IF position(' ' IN v_clean) > 0 OR position(E'\n' IN v_clean) > 0 OR position(E'\r' IN v_clean) > 0 THEN
    RAISE EXCEPTION 'رابط Webhook يحتوي على مسافات أو محارف غير مسموح بها.';
  END IF;

  -- Extract authority after https:// up to first / ? #
  v_authority := split_part(split_part(split_part(substring(v_clean FROM 9), '/', 1), '?', 1), '#', 1);

  IF v_authority = '' THEN
    RAISE EXCEPTION 'رابط Webhook غير مكتمل ولا يحتوي على اسم نطاق صالح.';
  END IF;

  IF position('@' IN v_authority) > 0 THEN
    RAISE EXCEPTION 'يُمنع تضمين بيانات دخول (user:pass@) داخل رابط Webhook.';
  END IF;

  -- Strip optional :port (or handle bracketed IPv6)
  IF left(v_authority, 1) = '[' THEN
    v_host := lower(split_part(substring(v_authority FROM 2), ']', 1));
    -- Reject IPv6 loopback / ULA / link-local
    IF v_host = '::1'
       OR v_host LIKE '::ffff:%'
       OR v_host LIKE 'fc%'
       OR v_host LIKE 'fd%'
       OR v_host LIKE 'fe80%'
       OR v_host = '::' THEN
      RAISE EXCEPTION 'يُحظر توجيه Webhook إلى عناوين IPv6 محلية أو داخلية.';
    END IF;
    RETURN v_clean;
  ELSE
    v_host := lower(split_part(v_authority, ':', 1));
  END IF;

  IF v_host = '' OR position('.' IN v_host) = 0 THEN
    RAISE EXCEPTION 'يجب استخدام اسم نطاق عام كامل وصالح في رابط Webhook.';
  END IF;

  IF v_host IN ('localhost', 'localhost.localdomain', 'metadata.google.internal')
     OR v_host LIKE '%.local'
     OR v_host LIKE '%.internal'
     OR v_host LIKE '%.localhost'
     OR v_host LIKE '%.localdomain' THEN
    RAISE EXCEPTION 'يُحظر استخدام النطاقات المحلية أو الداخلية كوجهة Webhook.';
  END IF;

  -- Block numeric IPv4 private, loopback, link-local, CGNAT, and 0.0.0.0/8 ranges
  IF v_host ~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' THEN
    v_octets := string_to_array(v_host, '.');
    v_o1 := v_octets[1]::integer;
    v_o2 := v_octets[2]::integer;
    IF v_o1 IN (0, 10, 127)
       OR (v_o1 = 169 AND v_o2 = 254)
       OR (v_o1 = 172 AND v_o2 BETWEEN 16 AND 31)
       OR (v_o1 = 192 AND v_o2 = 168)
       OR (v_o1 = 100 AND v_o2 BETWEEN 64 AND 127)
       OR v_o1 >= 224 THEN
      RAISE EXCEPTION 'يُحظر استخدام عناوين IP الخاصة أو المحلية كوجهة Webhook.';
    END IF;
  END IF;

  RETURN v_clean;
END;
$$;

CREATE OR REPLACE FUNCTION app_private.guard_webhook_endpoint_url()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.target_url := app_private.validate_public_webhook_url(NEW.target_url);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_webhook_endpoint_url ON public.webhook_endpoints;
CREATE TRIGGER trg_guard_webhook_endpoint_url
  BEFORE INSERT OR UPDATE OF target_url ON public.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION app_private.guard_webhook_endpoint_url();

CREATE OR REPLACE FUNCTION app_private.assert_tenant_api_access(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_tenant_status text;
  v_sub_status text;
  v_allow_api boolean;
  v_plan_name text;
BEGIN
  SELECT status INTO v_tenant_status
  FROM public.tenants
  WHERE id = p_tenant_id;

  IF v_tenant_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'الشركة غير نشطة حاليًا ولا يمكن استخدام واجهة التكامل البرمجي.';
  END IF;

  SELECT ts.status, sp.allow_api_access, sp.name_ar
  INTO v_sub_status, v_allow_api, v_plan_name
  FROM public.tenant_subscriptions ts
  JOIN public.subscription_plans sp ON sp.id = ts.plan_id
  WHERE ts.tenant_id = p_tenant_id;

  IF v_sub_status IS NULL THEN
    RAISE EXCEPTION 'لا يوجد اشتراك مفعّل لهذه الشركة.';
  END IF;

  IF v_sub_status NOT IN ('trial', 'active') THEN
    RAISE EXCEPTION 'اشتراك الشركة (% ) لا يسمح بتشغيل مفاتيح API أو Webhooks.', v_sub_status;
  END IF;

  IF COALESCE(v_allow_api, false) = false THEN
    RAISE EXCEPTION 'باقة الشركة الحالية (%) لا تتضمن الوصول إلى API والتكاملات الخارجية. يرجى الترقية إلى باقة النمو أو المؤسسات.', COALESCE(v_plan_name, 'الحالية');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION app_private.assert_tenant_api_access(uuid) FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Row Level Security & Column-Level Least-Privilege Grants
-- ----------------------------------------------------------------------------
ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_tokens FORCE ROW LEVEL SECURITY;

ALTER TABLE public.webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_endpoints FORCE ROW LEVEL SECURITY;

ALTER TABLE public.webhook_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_deliveries FORCE ROW LEVEL SECURITY;

ALTER TABLE public.api_request_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_request_logs FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.api_tokens FROM PUBLIC, anon, authenticated;
-- Never allow authenticated clients to SELECT `token_hash` directly
GRANT SELECT (
  id, tenant_id, name, token_prefix, account_scope, client_id, scopes,
  allowed_ips, is_active, expires_at, last_used_at, revoked_at, revoked_by,
  created_by, created_at, updated_at
) ON public.api_tokens TO authenticated;

REVOKE ALL ON TABLE public.webhook_endpoints FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.webhook_endpoints TO authenticated;

REVOKE ALL ON TABLE public.webhook_deliveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.webhook_deliveries TO authenticated;

REVOKE ALL ON TABLE public.api_request_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.api_request_logs TO authenticated;

DROP POLICY IF EXISTS api_tokens_select_policy ON public.api_tokens;
CREATE POLICY api_tokens_select_policy ON public.api_tokens
  FOR SELECT TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR (
      app_private.user_belongs_to_tenant(tenant_id)
      AND (
        app_private.user_is_tenant_admin(tenant_id)
        OR (
          app_private.user_get_bound_client_id(tenant_id) IS NULL
          AND (
            app_private.user_has_permission(tenant_id, 'api_tokens.read', NULL)
            OR app_private.user_has_permission(tenant_id, 'api_tokens.create', NULL)
          )
        )
        OR (
          app_private.user_get_bound_client_id(tenant_id) IS NOT NULL
          AND account_scope = 'client'
          AND client_id = app_private.user_get_bound_client_id(tenant_id)
          AND (
            app_private.user_has_permission(tenant_id, 'api_tokens.read', NULL)
            OR app_private.user_has_permission(tenant_id, 'api_tokens.create', NULL)
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS webhook_endpoints_select_policy ON public.webhook_endpoints;
CREATE POLICY webhook_endpoints_select_policy ON public.webhook_endpoints
  FOR SELECT TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR (
      app_private.user_belongs_to_tenant(tenant_id)
      AND (
        app_private.user_is_tenant_admin(tenant_id)
        OR (
          app_private.user_get_bound_client_id(tenant_id) IS NULL
          AND (
            app_private.user_has_permission(tenant_id, 'webhooks.manage', NULL)
            OR app_private.user_has_permission(tenant_id, 'api_tokens.read', NULL)
          )
        )
        OR (
          app_private.user_get_bound_client_id(tenant_id) IS NOT NULL
          AND client_id = app_private.user_get_bound_client_id(tenant_id)
          AND (
            app_private.user_has_permission(tenant_id, 'webhooks.manage', NULL)
            OR app_private.user_has_permission(tenant_id, 'api_tokens.create', NULL)
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS webhook_deliveries_select_policy ON public.webhook_deliveries;
CREATE POLICY webhook_deliveries_select_policy ON public.webhook_deliveries
  FOR SELECT TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR EXISTS (
      SELECT 1
      FROM public.webhook_endpoints we
      WHERE we.id = webhook_deliveries.endpoint_id
        AND we.tenant_id = webhook_deliveries.tenant_id
        AND app_private.user_belongs_to_tenant(we.tenant_id)
        AND (
          app_private.user_is_tenant_admin(we.tenant_id)
          OR (
            app_private.user_get_bound_client_id(we.tenant_id) IS NULL
            AND (
              app_private.user_has_permission(we.tenant_id, 'webhooks.manage', NULL)
              OR app_private.user_has_permission(we.tenant_id, 'api_tokens.read', NULL)
            )
          )
          OR (
            app_private.user_get_bound_client_id(we.tenant_id) IS NOT NULL
            AND we.client_id = app_private.user_get_bound_client_id(we.tenant_id)
          )
        )
    )
  );

DROP POLICY IF EXISTS api_request_logs_select_policy ON public.api_request_logs;
CREATE POLICY api_request_logs_select_policy ON public.api_request_logs
  FOR SELECT TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR (
      app_private.user_belongs_to_tenant(tenant_id)
      AND (
        app_private.user_is_tenant_admin(tenant_id)
        OR (
          app_private.user_get_bound_client_id(tenant_id) IS NULL
          AND (
            app_private.user_has_permission(tenant_id, 'api_tokens.read', NULL)
            OR app_private.user_has_permission(tenant_id, 'api_tokens.create', NULL)
          )
        )
        OR (
          app_private.user_get_bound_client_id(tenant_id) IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.api_tokens tok
            WHERE tok.id = api_request_logs.token_id
              AND tok.tenant_id = api_request_logs.tenant_id
              AND tok.account_scope = 'client'
              AND tok.client_id = app_private.user_get_bound_client_id(api_request_logs.tenant_id)
          )
        )
      )
    )
  );

-- ----------------------------------------------------------------------------
-- 5. Automatic Webhook Queue Enqueue Triggers
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.enqueue_webhook_event(
  p_tenant_id uuid,
  p_client_id uuid,
  p_event_type text,
  p_entity_type text,
  p_entity_id uuid,
  p_idempotency_key text,
  p_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_sub_ok boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_subscriptions ts
    JOIN public.subscription_plans sp ON sp.id = ts.plan_id
    JOIN public.tenants t ON t.id = ts.tenant_id
    WHERE ts.tenant_id = p_tenant_id
      AND t.status = 'active'
      AND ts.status IN ('trial', 'active')
      AND sp.allow_api_access = true
  ) INTO v_sub_ok;

  IF NOT v_sub_ok THEN
    RETURN;
  END IF;

  INSERT INTO public.webhook_deliveries (
    tenant_id, endpoint_id, event_type, entity_type, entity_id,
    idempotency_key, request_payload, status, next_retry_at
  )
  SELECT
    p_tenant_id,
    we.id,
    p_event_type,
    p_entity_type,
    p_entity_id,
    p_idempotency_key || ':' || we.id::text,
    jsonb_build_object(
      'event', p_event_type,
      'tenant_id', p_tenant_id,
      'entity_type', p_entity_type,
      'entity_id', p_entity_id,
      'occurred_at', now(),
      'data', COALESCE(p_payload, '{}'::jsonb)
    ),
    'pending',
    now()
  FROM public.webhook_endpoints we
  WHERE we.tenant_id = p_tenant_id
    AND we.is_active = true
    AND p_event_type = ANY(we.events)
    AND (we.client_id IS NULL OR (p_client_id IS NOT NULL AND we.client_id = p_client_id))
  ON CONFLICT (endpoint_id, idempotency_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION app_private.enqueue_webhook_event(uuid, uuid, text, text, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app_private.webhook_on_shipment_status_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_shp public.shipments%ROWTYPE;
  v_event text;
BEGIN
  SELECT * INTO v_shp
  FROM public.shipments
  WHERE id = NEW.shipment_id AND tenant_id = NEW.tenant_id;

  IF v_shp.id IS NULL THEN
    RETURN NEW;
  END IF;

  v_event := CASE
    WHEN NEW.event_code = 'shipment.created' THEN 'shipment.created'
    ELSE 'shipment.status_changed'
  END;

  PERFORM app_private.enqueue_webhook_event(
    NEW.tenant_id,
    v_shp.client_id,
    v_event,
    'shipment',
    v_shp.id,
    'shp_evt_' || NEW.id::text,
    jsonb_build_object(
      'shipment_id', v_shp.id,
      'shipment_number', v_shp.shipment_number,
      'barcode_token', v_shp.barcode_token,
      'client_id', v_shp.client_id,
      'external_reference', v_shp.external_reference,
      'from_status', NEW.from_status,
      'to_status', NEW.to_status,
      'event_code', NEW.event_code,
      'total_shipping_fee', v_shp.total_shipping_fee,
      'recipient_collect_amount', v_shp.recipient_collect_amount
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shipment_status_event_webhook ON public.shipment_status_events;
CREATE TRIGGER trg_shipment_status_event_webhook
  AFTER INSERT ON public.shipment_status_events
  FOR EACH ROW EXECUTE FUNCTION app_private.webhook_on_shipment_status_event();

CREATE OR REPLACE FUNCTION app_private.webhook_on_pickup_request_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM app_private.enqueue_webhook_event(
      NEW.tenant_id,
      NEW.client_id,
      'pickup_request.updated',
      'pickup_request',
      NEW.id,
      'pr_upd_' || NEW.id::text || '_' || NEW.status,
      jsonb_build_object(
        'request_id', NEW.id,
        'request_code', NEW.request_code,
        'client_id', NEW.client_id,
        'from_status', OLD.status,
        'to_status', NEW.status,
        'preferred_date', NEW.preferred_date
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pickup_request_webhook ON public.client_pickup_requests;
CREATE TRIGGER trg_pickup_request_webhook
  AFTER UPDATE OF status ON public.client_pickup_requests
  FOR EACH ROW EXECUTE FUNCTION app_private.webhook_on_pickup_request_update();

CREATE OR REPLACE FUNCTION app_private.webhook_on_client_settlement_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  IF NEW.status = 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
    PERFORM app_private.enqueue_webhook_event(
      NEW.tenant_id,
      NEW.client_id,
      'settlement.approved',
      'client_settlement',
      NEW.id,
      'cstl_app_' || NEW.id::text,
      jsonb_build_object(
        'settlement_id', NEW.id,
        'settlement_code', NEW.settlement_code,
        'client_id', NEW.client_id,
        'net_payable_amount', NEW.net_payable_amount,
        'payout_method', NEW.payout_method,
        'approved_at', NEW.approved_at
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_settlement_webhook ON public.client_settlements;
CREATE TRIGGER trg_client_settlement_webhook
  AFTER UPDATE OF status ON public.client_settlements
  FOR EACH ROW EXECUTE FUNCTION app_private.webhook_on_client_settlement_approved();

-- ----------------------------------------------------------------------------
-- 6. Authenticated Tenant/Client RPCs: API Tokens & Webhooks Management
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_integrations_overview(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_bound_client_id uuid := app_private.user_get_bound_client_id(p_tenant_id);
  v_is_admin boolean := app_private.user_is_tenant_admin(p_tenant_id) OR app_private.current_user_is_platform_admin();
  v_plan_code text := 'STARTER';
  v_plan_name text := 'باقة البداية';
  v_allow_api boolean := false;
  v_sub_status text := 'trial';
BEGIN
  IF NOT (
    app_private.current_user_is_platform_admin()
    OR (
      app_private.user_belongs_to_tenant(p_tenant_id)
      AND (
        v_is_admin
        OR app_private.user_has_permission(p_tenant_id, 'api_tokens.read', NULL)
        OR app_private.user_has_permission(p_tenant_id, 'api_tokens.create', NULL)
        OR app_private.user_has_permission(p_tenant_id, 'webhooks.manage', NULL)
      )
    )
  ) THEN
    RAISE EXCEPTION 'غير مصرح باستعراض رموز API والتكاملات لهذه الشركة.';
  END IF;

  SELECT
    sp.code,
    sp.name_ar,
    sp.allow_api_access,
    ts.status
  INTO v_plan_code, v_plan_name, v_allow_api, v_sub_status
  FROM public.tenant_subscriptions ts
  JOIN public.subscription_plans sp ON sp.id = ts.plan_id
  WHERE ts.tenant_id = p_tenant_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'api_access', jsonb_build_object(
      'allow_api_access', COALESCE(v_allow_api, false) AND COALESCE(v_sub_status, 'suspended') IN ('trial', 'active'),
      'plan_allow_api_access', COALESCE(v_allow_api, false),
      'plan_code', COALESCE(v_plan_code, 'STARTER'),
      'plan_name_ar', COALESCE(v_plan_name, 'باقة البداية'),
      'subscription_status', COALESCE(v_sub_status, 'trial'),
      'bound_client_id', v_bound_client_id
    ),
    'tokens', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', tok.id,
        'tenant_id', tok.tenant_id,
        'name', tok.name,
        'token_prefix', tok.token_prefix,
        'account_scope', tok.account_scope,
        'client_id', tok.client_id,
        'client_code', cl.code,
        'client_name', cl.name,
        'scopes', to_jsonb(tok.scopes),
        'allowed_ips', to_jsonb(tok.allowed_ips),
        'is_active', tok.is_active,
        'expires_at', tok.expires_at,
        'last_used_at', tok.last_used_at,
        'revoked_at', tok.revoked_at,
        'created_at', tok.created_at
      ) ORDER BY tok.created_at DESC)
      FROM public.api_tokens tok
      LEFT JOIN public.clients cl ON cl.tenant_id = tok.tenant_id AND cl.id = tok.client_id
      WHERE tok.tenant_id = p_tenant_id
        AND (
          v_bound_client_id IS NULL
          OR (tok.account_scope = 'client' AND tok.client_id = v_bound_client_id)
        )
    ), '[]'::jsonb),
    'endpoints', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', we.id,
        'tenant_id', we.tenant_id,
        'client_id', we.client_id,
        'client_code', cl.code,
        'client_name', cl.name,
        'name', we.name,
        'target_url', we.target_url,
        'events', to_jsonb(we.events),
        'signing_secret_prefix', we.signing_secret_prefix,
        'is_active', we.is_active,
        'failure_count', we.failure_count,
        'last_triggered_at', we.last_triggered_at,
        'last_status_code', we.last_status_code,
        'created_at', we.created_at,
        'updated_at', we.updated_at
      ) ORDER BY we.created_at DESC)
      FROM public.webhook_endpoints we
      LEFT JOIN public.clients cl ON cl.tenant_id = we.tenant_id AND cl.id = we.client_id
      WHERE we.tenant_id = p_tenant_id
        AND (v_bound_client_id IS NULL OR we.client_id = v_bound_client_id)
    ), '[]'::jsonb),
    'deliveries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id,
        'tenant_id', d.tenant_id,
        'endpoint_id', d.endpoint_id,
        'endpoint_name', d.endpoint_name,
        'target_url', d.target_url,
        'event_type', d.event_type,
        'entity_type', d.entity_type,
        'entity_id', d.entity_id,
        'response_status', d.response_status,
        'response_excerpt', d.response_excerpt,
        'attempt_count', d.attempt_count,
        'status', d.status,
        'next_retry_at', d.next_retry_at,
        'delivered_at', d.delivered_at,
        'created_at', d.created_at
      ) ORDER BY d.created_at DESC)
      FROM (
        SELECT
          wd.id, wd.tenant_id, wd.endpoint_id, we.name AS endpoint_name, we.target_url,
          wd.event_type, wd.entity_type, wd.entity_id, wd.response_status, wd.response_excerpt,
          wd.attempt_count, wd.status, wd.next_retry_at, wd.delivered_at, wd.created_at
        FROM public.webhook_deliveries wd
        JOIN public.webhook_endpoints we ON we.id = wd.endpoint_id AND we.tenant_id = wd.tenant_id
        WHERE wd.tenant_id = p_tenant_id
          AND (v_bound_client_id IS NULL OR we.client_id = v_bound_client_id)
        ORDER BY wd.created_at DESC
        LIMIT 50
      ) d
    ), '[]'::jsonb),
    'request_logs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', l.id,
        'tenant_id', l.tenant_id,
        'token_id', l.token_id,
        'token_name', l.token_name,
        'token_prefix', l.token_prefix,
        'method', l.method,
        'path', l.path,
        'status_code', l.status_code,
        'ip_address', l.ip_address,
        'idempotency_key', l.idempotency_key,
        'duration_ms', l.duration_ms,
        'created_at', l.created_at
      ) ORDER BY l.created_at DESC)
      FROM (
        SELECT
          arl.id, arl.tenant_id, arl.token_id,
          tok.name AS token_name, tok.token_prefix,
          arl.method, arl.path, arl.status_code, arl.ip_address,
          arl.idempotency_key, arl.duration_ms, arl.created_at
        FROM public.api_request_logs arl
        LEFT JOIN public.api_tokens tok ON tok.id = arl.token_id AND tok.tenant_id = arl.tenant_id
        WHERE arl.tenant_id = p_tenant_id
          AND (
            v_bound_client_id IS NULL
            OR (tok.account_scope = 'client' AND tok.client_id = v_bound_client_id)
          )
        ORDER BY arl.created_at DESC
        LIMIT 50
      ) l
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_integrations_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_integrations_overview(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_api_token(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_bound_client_id uuid := app_private.user_get_bound_client_id(p_tenant_id);
  v_name text := trim(COALESCE(p_payload->>'name', ''));
  v_req_scope text := COALESCE(NULLIF(trim(p_payload->>'account_scope'), ''), 'tenant');
  v_req_client_id uuid := NULLIF(trim(COALESCE(p_payload->>'client_id', '')), '')::uuid;
  v_scopes text[];
  v_allowed_ips text[] := ARRAY[]::text[];
  v_expires_in_days integer := NULLIF(trim(COALESCE(p_payload->>'expires_in_days', '')), '')::integer;
  v_expires_at timestamptz := NULL;
  v_raw_secret text;
  v_prefix text;
  v_hash text;
  v_row public.api_tokens%ROWTYPE;
  v_ip text;
  v_dummy inet;
  v_client_code text;
  v_client_name text;
BEGIN
  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'api_tokens.create', NULL)
  ) THEN
    RAISE EXCEPTION 'غير مصرح بإصدار رموز API في هذه الشركة.';
  END IF;

  PERFORM app_private.assert_tenant_api_access(p_tenant_id);

  IF char_length(v_name) < 2 OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'اسم الرمز يجب أن يكون بين حرفين و80 حرفًا.';
  END IF;

  -- Enforce client isolation: bound clients can only create tokens for themselves
  IF v_bound_client_id IS NOT NULL THEN
    IF v_req_scope = 'tenant' OR (v_req_client_id IS NOT NULL AND v_req_client_id <> v_bound_client_id) THEN
      RAISE EXCEPTION 'حساب التاجر يمكنه إصدار رموز API لحسابه فقط.';
    END IF;
    v_req_scope := 'client';
    v_req_client_id := v_bound_client_id;
  ELSE
    IF v_req_scope NOT IN ('tenant', 'client') THEN
      RAISE EXCEPTION 'نطاق الرمز غير صالح (tenant أو client).';
    END IF;
    IF v_req_scope = 'client' THEN
      IF v_req_client_id IS NULL THEN
        RAISE EXCEPTION 'يجب اختيار العميل المرتبط عند إنشاء رمز بنطاق التاجر.';
      END IF;
      SELECT code, name INTO v_client_code, v_client_name
      FROM public.clients
      WHERE id = v_req_client_id AND tenant_id = p_tenant_id AND archived_at IS NULL;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'ملف العميل المحدد غير موجود داخل هذه الشركة.';
      END IF;
    ELSE
      v_req_client_id := NULL;
    END IF;
  END IF;

  IF v_req_scope = 'client' AND v_client_code IS NULL THEN
    SELECT code, name INTO v_client_code, v_client_name
    FROM public.clients
    WHERE id = v_req_client_id AND tenant_id = p_tenant_id;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT s), ARRAY[]::text[])
  INTO v_scopes
  FROM jsonb_array_elements_text(COALESCE(p_payload->'scopes', '[]'::jsonb)) AS s
  WHERE s IN ('shipments:read', 'shipments:write', 'tracking:read');

  IF cardinality(v_scopes) = 0 THEN
    RAISE EXCEPTION 'يجب اختيار نطاق صلاحية واحد على الأقل للرمز.';
  END IF;

  IF jsonb_typeof(p_payload->'allowed_ips') = 'array' THEN
    FOR v_ip IN
      SELECT trim(val) FROM jsonb_array_elements_text(p_payload->'allowed_ips') AS val
      WHERE trim(val) <> ''
    LOOP
      BEGIN
        v_dummy := v_ip::inet;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'عنوان أو نطاق IP غير صالح في القائمة المسموحة: %', v_ip;
      END;
      v_allowed_ips := array_append(v_allowed_ips, v_ip);
    END LOOP;
  END IF;

  IF v_expires_in_days IS NOT NULL THEN
    IF v_expires_in_days < 1 OR v_expires_in_days > 1095 THEN
      RAISE EXCEPTION 'مدة صلاحية الرمز بالأيام يجب أن تكون بين 1 و 1095 يومًا.';
    END IF;
    v_expires_at := now() + make_interval(days => v_expires_in_days);
  END IF;

  -- Generate CSPRNG secret (`sf_live_` + 40 hex chars); store ONLY prefix + SHA-256 hash
  v_raw_secret := 'sf_live_' || substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 40);
  v_prefix := substr(v_raw_secret, 1, 16);
  v_hash := encode(pg_catalog.sha256(convert_to(v_raw_secret, 'UTF8')), 'hex');

  INSERT INTO public.api_tokens (
    tenant_id, name, token_prefix, token_hash, account_scope, client_id,
    scopes, allowed_ips, is_active, expires_at, created_by
  )
  VALUES (
    p_tenant_id, v_name, v_prefix, v_hash, v_req_scope, v_req_client_id,
    v_scopes, v_allowed_ips, true, v_expires_at, auth.uid()
  )
  RETURNING * INTO v_row;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    p_tenant_id, auth.uid(), 'api_token_created', 'api_tokens', v_row.id,
    jsonb_build_object(
      'name', v_row.name,
      'token_prefix', v_row.token_prefix,
      'account_scope', v_row.account_scope,
      'client_id', v_row.client_id,
      'scopes', v_row.scopes,
      'expires_at', v_row.expires_at
    ),
    'server'
  );

  RETURN jsonb_build_object(
    'token', jsonb_build_object(
      'id', v_row.id,
      'tenant_id', v_row.tenant_id,
      'name', v_row.name,
      'token_prefix', v_row.token_prefix,
      'account_scope', v_row.account_scope,
      'client_id', v_row.client_id,
      'client_code', v_client_code,
      'client_name', v_client_name,
      'scopes', to_jsonb(v_row.scopes),
      'allowed_ips', to_jsonb(v_row.allowed_ips),
      'is_active', v_row.is_active,
      'expires_at', v_row.expires_at,
      'last_used_at', v_row.last_used_at,
      'revoked_at', v_row.revoked_at,
      'created_at', v_row.created_at
    ),
    'plaintext_token', v_raw_secret
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_api_token(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_api_token(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_api_token(
  p_tenant_id uuid,
  p_token_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_bound_client_id uuid := app_private.user_get_bound_client_id(p_tenant_id);
  v_row public.api_tokens%ROWTYPE;
BEGIN
  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'api_tokens.revoke', NULL)
    OR app_private.user_has_permission(p_tenant_id, 'api_tokens.create', NULL)
  ) THEN
    RAISE EXCEPTION 'غير مصرح بإبطال رموز API لهذه الشركة.';
  END IF;

  SELECT * INTO v_row
  FROM public.api_tokens
  WHERE id = p_token_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'رمز API المطلوب غير موجود.';
  END IF;

  IF v_bound_client_id IS NOT NULL AND (v_row.account_scope <> 'client' OR v_row.client_id <> v_bound_client_id) THEN
    RAISE EXCEPTION 'غير مصرح بإبطال رمز لا يخص حسابك.';
  END IF;

  UPDATE public.api_tokens
  SET is_active = false,
      revoked_at = COALESCE(revoked_at, now()),
      revoked_by = COALESCE(revoked_by, auth.uid())
  WHERE id = p_token_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    p_tenant_id, auth.uid(), 'api_token_revoked', 'api_tokens', v_row.id,
    jsonb_build_object('token_prefix', v_row.token_prefix, 'revoked_at', v_row.revoked_at),
    'server'
  );

  RETURN jsonb_build_object(
    'id', v_row.id,
    'is_active', v_row.is_active,
    'revoked_at', v_row.revoked_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_api_token(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_api_token(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.upsert_webhook_endpoint(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_bound_client_id uuid := app_private.user_get_bound_client_id(p_tenant_id);
  v_id uuid := NULLIF(trim(COALESCE(p_payload->>'id', '')), '')::uuid;
  v_name text := trim(COALESCE(p_payload->>'name', ''));
  v_target_url text := app_private.validate_public_webhook_url(p_payload->>'target_url');
  v_req_client_id uuid := NULLIF(trim(COALESCE(p_payload->>'client_id', '')), '')::uuid;
  v_is_active boolean := COALESCE((p_payload->>'is_active')::boolean, true);
  v_events text[];
  v_secret text := NULL;
  v_prefix text;
  v_row public.webhook_endpoints%ROWTYPE;
  v_client_code text;
  v_client_name text;
BEGIN
  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'webhooks.manage', NULL)
    OR (v_bound_client_id IS NOT NULL AND app_private.user_has_permission(p_tenant_id, 'api_tokens.create', NULL))
  ) THEN
    RAISE EXCEPTION 'غير مصرح بإدارة نقاط Webhooks لهذه الشركة.';
  END IF;

  PERFORM app_private.assert_tenant_api_access(p_tenant_id);

  IF char_length(v_name) < 2 OR char_length(v_name) > 80 THEN
    RAISE EXCEPTION 'اسم نقطة Webhook يجب أن يكون بين حرفين و80 حرفًا.';
  END IF;

  IF v_bound_client_id IS NOT NULL THEN
    IF v_req_client_id IS NOT NULL AND v_req_client_id <> v_bound_client_id THEN
      RAISE EXCEPTION 'لا يمكنك ربط نقطة Webhook بتاجر آخر.';
    END IF;
    v_req_client_id := v_bound_client_id;
  ELSIF v_req_client_id IS NOT NULL THEN
    SELECT code, name INTO v_client_code, v_client_name
    FROM public.clients
    WHERE id = v_req_client_id AND tenant_id = p_tenant_id AND archived_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'ملف العميل المحدد غير موجود داخل هذه الشركة.';
    END IF;
  END IF;

  IF v_req_client_id IS NOT NULL AND v_client_code IS NULL THEN
    SELECT code, name INTO v_client_code, v_client_name
    FROM public.clients
    WHERE id = v_req_client_id AND tenant_id = p_tenant_id;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT e), ARRAY[]::text[])
  INTO v_events
  FROM jsonb_array_elements_text(COALESCE(p_payload->'events', '[]'::jsonb)) AS e
  WHERE e IN ('shipment.created', 'shipment.status_changed', 'pickup_request.updated', 'settlement.approved', 'webhook.test');

  IF cardinality(v_events) = 0 THEN
    RAISE EXCEPTION 'يجب اختيار حدث واحد على الأقل للاشتراك في Webhook.';
  END IF;

  IF v_id IS NULL THEN
    v_secret := 'whsec_' || substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 40);
    v_prefix := substr(v_secret, 1, 14);

    INSERT INTO public.webhook_endpoints (
      tenant_id, client_id, name, target_url, events,
      signing_secret_prefix, is_active, created_by, updated_by
    )
    VALUES (
      p_tenant_id, v_req_client_id, v_name, v_target_url, v_events,
      v_prefix, v_is_active, auth.uid(), auth.uid()
    )
    RETURNING * INTO v_row;

    INSERT INTO app_private.webhook_secrets (endpoint_id, tenant_id, signing_secret)
    VALUES (v_row.id, p_tenant_id, v_secret);
  ELSE
    SELECT * INTO v_row
    FROM public.webhook_endpoints
    WHERE id = v_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'نقطة Webhook المطلوبة غير موجودة.';
    END IF;

    IF v_bound_client_id IS NOT NULL AND v_row.client_id IS DISTINCT FROM v_bound_client_id THEN
      RAISE EXCEPTION 'غير مصرح بتعديل نقطة Webhook لا تخص حسابك.';
    END IF;

    UPDATE public.webhook_endpoints
    SET client_id = v_req_client_id,
        name = v_name,
        target_url = v_target_url,
        events = v_events,
        is_active = v_is_active,
        failure_count = CASE WHEN v_is_active THEN 0 ELSE failure_count END,
        updated_by = auth.uid()
    WHERE id = v_id AND tenant_id = p_tenant_id
    RETURNING * INTO v_row;
  END IF;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    p_tenant_id, auth.uid(),
    CASE WHEN v_id IS NULL THEN 'webhook_endpoint_created' ELSE 'webhook_endpoint_updated' END,
    'webhook_endpoints', v_row.id,
    jsonb_build_object(
      'name', v_row.name,
      'target_url', v_row.target_url,
      'events', v_row.events,
      'is_active', v_row.is_active
    ),
    'server'
  );

  RETURN jsonb_build_object(
    'endpoint', jsonb_build_object(
      'id', v_row.id,
      'tenant_id', v_row.tenant_id,
      'client_id', v_row.client_id,
      'client_code', v_client_code,
      'client_name', v_client_name,
      'name', v_row.name,
      'target_url', v_row.target_url,
      'events', to_jsonb(v_row.events),
      'signing_secret_prefix', v_row.signing_secret_prefix,
      'is_active', v_row.is_active,
      'failure_count', v_row.failure_count,
      'last_triggered_at', v_row.last_triggered_at,
      'last_status_code', v_row.last_status_code,
      'created_at', v_row.created_at,
      'updated_at', v_row.updated_at
    ),
    'plaintext_signing_secret', v_secret
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_webhook_endpoint(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_webhook_endpoint(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rotate_webhook_secret(
  p_tenant_id uuid,
  p_endpoint_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_bound_client_id uuid := app_private.user_get_bound_client_id(p_tenant_id);
  v_row public.webhook_endpoints%ROWTYPE;
  v_secret text;
  v_prefix text;
BEGIN
  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'webhooks.manage', NULL)
    OR (v_bound_client_id IS NOT NULL AND app_private.user_has_permission(p_tenant_id, 'api_tokens.create', NULL))
  ) THEN
    RAISE EXCEPTION 'غير مصرح بتدوير سر التوقيع.';
  END IF;

  SELECT * INTO v_row
  FROM public.webhook_endpoints
  WHERE id = p_endpoint_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'نقطة Webhook المطلوبة غير موجودة.';
  END IF;

  IF v_bound_client_id IS NOT NULL AND v_row.client_id IS DISTINCT FROM v_bound_client_id THEN
    RAISE EXCEPTION 'غير مصرح بتعديل نقطة لا تخص حسابك.';
  END IF;

  v_secret := 'whsec_' || substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 40);
  v_prefix := substr(v_secret, 1, 14);

  UPDATE public.webhook_endpoints
  SET signing_secret_prefix = v_prefix,
      updated_by = auth.uid()
  WHERE id = p_endpoint_id AND tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  INSERT INTO app_private.webhook_secrets (endpoint_id, tenant_id, signing_secret, rotated_at)
  VALUES (v_row.id, p_tenant_id, v_secret, now())
  ON CONFLICT (endpoint_id) DO UPDATE
    SET signing_secret = EXCLUDED.signing_secret,
        rotated_at = now();

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    p_tenant_id, auth.uid(), 'webhook_secret_rotated', 'webhook_endpoints', v_row.id,
    jsonb_build_object('signing_secret_prefix', v_prefix),
    'server'
  );

  RETURN jsonb_build_object(
    'endpoint_id', v_row.id,
    'signing_secret_prefix', v_row.signing_secret_prefix,
    'plaintext_signing_secret', v_secret
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rotate_webhook_secret(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rotate_webhook_secret(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_webhook_endpoint(
  p_tenant_id uuid,
  p_endpoint_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_bound_client_id uuid := app_private.user_get_bound_client_id(p_tenant_id);
  v_row public.webhook_endpoints%ROWTYPE;
BEGIN
  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'webhooks.manage', NULL)
    OR (v_bound_client_id IS NOT NULL AND app_private.user_has_permission(p_tenant_id, 'api_tokens.create', NULL))
  ) THEN
    RAISE EXCEPTION 'غير مصرح بحذف نقاط Webhooks.';
  END IF;

  SELECT * INTO v_row
  FROM public.webhook_endpoints
  WHERE id = p_endpoint_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'نقطة Webhook المطلوبة غير موجودة.';
  END IF;

  IF v_bound_client_id IS NOT NULL AND v_row.client_id IS DISTINCT FROM v_bound_client_id THEN
    RAISE EXCEPTION 'غير مصرح بحذف نقطة لا تخص حسابك.';
  END IF;

  DELETE FROM public.webhook_endpoints
  WHERE id = p_endpoint_id AND tenant_id = p_tenant_id;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    p_tenant_id, auth.uid(), 'webhook_endpoint_deleted', 'webhook_endpoints', p_endpoint_id,
    jsonb_build_object('name', v_row.name, 'target_url', v_row.target_url),
    'server'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_webhook_endpoint(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_webhook_endpoint(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.trigger_test_webhook_event(
  p_tenant_id uuid,
  p_endpoint_id uuid,
  p_event_type text DEFAULT 'webhook.test'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_bound_client_id uuid := app_private.user_get_bound_client_id(p_tenant_id);
  v_ep public.webhook_endpoints%ROWTYPE;
  v_evt text := COALESCE(NULLIF(trim(p_event_type), ''), 'webhook.test');
  v_delivery public.webhook_deliveries%ROWTYPE;
BEGIN
  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'webhooks.manage', NULL)
    OR (v_bound_client_id IS NOT NULL AND app_private.user_has_permission(p_tenant_id, 'api_tokens.create', NULL))
  ) THEN
    RAISE EXCEPTION 'غير مصرح بإرسال حدث تجريبي.';
  END IF;

  PERFORM app_private.assert_tenant_api_access(p_tenant_id);

  IF v_evt NOT IN ('shipment.created', 'shipment.status_changed', 'pickup_request.updated', 'settlement.approved', 'webhook.test') THEN
    RAISE EXCEPTION 'نوع الحدث التجريبي غير صالح.';
  END IF;

  SELECT * INTO v_ep
  FROM public.webhook_endpoints
  WHERE id = p_endpoint_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'نقطة Webhook غير موجودة.';
  END IF;

  IF v_bound_client_id IS NOT NULL AND v_ep.client_id IS DISTINCT FROM v_bound_client_id THEN
    RAISE EXCEPTION 'غير مصرح بإرسال حدث لنقطة لا تخص حسابك.';
  END IF;

  INSERT INTO public.webhook_deliveries (
    tenant_id, endpoint_id, event_type, entity_type, entity_id,
    idempotency_key, request_payload, status, next_retry_at
  )
  VALUES (
    p_tenant_id,
    v_ep.id,
    v_evt,
    'webhook_test',
    v_ep.id,
    'test_' || gen_random_uuid()::text,
    jsonb_build_object(
      'event', v_evt,
      'tenant_id', p_tenant_id,
      'endpoint_id', v_ep.id,
      'is_test', true,
      'occurred_at', now(),
      'data', jsonb_build_object('message', 'اختبار اتصال ShipFlow Webhook بنجاح')
    ),
    'pending',
    now()
  )
  RETURNING * INTO v_delivery;

  RETURN jsonb_build_object(
    'id', v_delivery.id,
    'tenant_id', v_delivery.tenant_id,
    'endpoint_id', v_delivery.endpoint_id,
    'endpoint_name', v_ep.name,
    'target_url', v_ep.target_url,
    'event_type', v_delivery.event_type,
    'entity_type', v_delivery.entity_type,
    'entity_id', v_delivery.entity_id,
    'response_status', v_delivery.response_status,
    'response_excerpt', v_delivery.response_excerpt,
    'attempt_count', v_delivery.attempt_count,
    'status', v_delivery.status,
    'next_retry_at', v_delivery.next_retry_at,
    'delivered_at', v_delivery.delivered_at,
    'created_at', v_delivery.created_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_test_webhook_event(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trigger_test_webhook_event(uuid, uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Service-Role Wrappers for Edge Function `public-api-v1`
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.srv_authenticate_api_token(
  p_token_hash text,
  p_required_scope text DEFAULT NULL,
  p_client_ip text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_tok public.api_tokens%ROWTYPE;
  v_sub_status text;
  v_allow_api boolean;
  v_tenant_status text;
  v_ip inet;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'invalid_token_format');
  END IF;

  SELECT * INTO v_tok
  FROM public.api_tokens
  WHERE token_hash = p_token_hash
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'token_not_found');
  END IF;

  IF NOT v_tok.is_active OR v_tok.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'token_revoked');
  END IF;

  IF v_tok.expires_at IS NOT NULL AND v_tok.expires_at <= now() THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'token_expired');
  END IF;

  SELECT t.status, ts.status, sp.allow_api_access
  INTO v_tenant_status, v_sub_status, v_allow_api
  FROM public.tenants t
  JOIN public.tenant_subscriptions ts ON ts.tenant_id = t.id
  JOIN public.subscription_plans sp ON sp.id = ts.plan_id
  WHERE t.id = v_tok.tenant_id;

  IF v_tenant_status IS DISTINCT FROM 'active' OR v_sub_status NOT IN ('trial', 'active') OR COALESCE(v_allow_api, false) = false THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'api_access_disabled');
  END IF;

  IF p_required_scope IS NOT NULL AND NOT (p_required_scope = ANY(v_tok.scopes)) THEN
    RETURN jsonb_build_object('valid', false, 'reason', 'insufficient_scope');
  END IF;

  IF cardinality(v_tok.allowed_ips) > 0 THEN
    BEGIN
      v_ip := NULLIF(trim(COALESCE(p_client_ip, '')), '')::inet;
    EXCEPTION WHEN OTHERS THEN
      v_ip := NULL;
    END;

    IF v_ip IS NULL OR NOT (v_ip <<= ANY(v_tok.allowed_ips::inet[])) THEN
      RETURN jsonb_build_object('valid', false, 'reason', 'ip_not_allowed');
    END IF;
  END IF;

  UPDATE public.api_tokens
  SET last_used_at = now()
  WHERE id = v_tok.id;

  RETURN jsonb_build_object(
    'valid', true,
    'token_id', v_tok.id,
    'tenant_id', v_tok.tenant_id,
    'account_scope', v_tok.account_scope,
    'client_id', v_tok.client_id,
    'scopes', to_jsonb(v_tok.scopes),
    'created_by', v_tok.created_by
  );
END;
$$;

REVOKE ALL ON FUNCTION public.srv_authenticate_api_token(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_authenticate_api_token(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.srv_record_api_request_log(
  p_tenant_id uuid,
  p_token_id uuid,
  p_method text,
  p_path text,
  p_status_code integer,
  p_ip_address text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_duration_ms integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.api_request_logs (
    tenant_id, token_id, method, path, status_code, ip_address, idempotency_key, duration_ms
  )
  VALUES (
    p_tenant_id, p_token_id, upper(COALESCE(NULLIF(trim(p_method), ''), 'GET')),
    COALESCE(NULLIF(trim(p_path), ''), '/'),
    LEAST(GREATEST(COALESCE(p_status_code, 200), 100), 599),
    NULLIF(trim(COALESCE(p_ip_address, '')), ''),
    NULLIF(trim(COALESCE(p_idempotency_key, '')), ''),
    GREATEST(COALESCE(p_duration_ms, 0), 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.srv_record_api_request_log(uuid, uuid, text, text, integer, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_record_api_request_log(uuid, uuid, text, text, integer, text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.srv_api_create_shipment(
  p_token_id uuid,
  p_idempotency_key text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_tok public.api_tokens%ROWTYPE;
  v_clean_idem text := NULLIF(trim(COALESCE(p_idempotency_key, '')), '');
  v_existing public.shipments%ROWTYPE;
  v_existing_token text;
  v_client_id uuid := NULLIF(trim(COALESCE(p_payload->>'client_id', '')), '')::uuid;
  v_origin_branch_id uuid := NULLIF(trim(COALESCE(p_payload->>'origin_branch_id', '')), '')::uuid;
  v_movement_type_id uuid := NULLIF(trim(COALESCE(p_payload->>'movement_type_id', '')), '')::uuid;
  v_shipment_type_id uuid := NULLIF(trim(COALESCE(p_payload->>'shipment_type_id', '')), '')::uuid;
  v_service_id uuid := NULLIF(trim(COALESCE(p_payload->>'service_id', '')), '')::uuid;
  v_payment_term_id uuid := NULLIF(trim(COALESCE(p_payload->>'payment_term_id', '')), '')::uuid;
  v_price_mode text := COALESCE(NULLIF(trim(p_payload->>'price_mode'), ''), 'shipping_excluded');
  v_actual_weight numeric(10,3) := GREATEST(0, COALESCE((p_payload->>'actual_weight_kg')::numeric, 1));
  v_length_cm numeric(10,2) := GREATEST(0, COALESCE((p_payload->>'length_cm')::numeric, 0));
  v_width_cm numeric(10,2) := GREATEST(0, COALESCE((p_payload->>'width_cm')::numeric, 0));
  v_height_cm numeric(10,2) := GREATEST(0, COALESCE((p_payload->>'height_cm')::numeric, 0));
  v_pieces_count integer := GREATEST(1, COALESCE((p_payload->>'pieces_count')::integer, 1));
  v_raw_balance numeric(14,2) := GREATEST(0, COALESCE((p_payload->>'prepaid_balance_amount')::numeric, 0));

  v_sender_name text;
  v_sender_gov_id uuid := NULLIF(trim(COALESCE(p_payload->>'sender_governorate_id', '')), '')::uuid;
  v_sender_reg_id uuid := NULLIF(trim(COALESCE(p_payload->>'sender_region_id', '')), '')::uuid;
  v_sender_phone text := NULLIF(trim(COALESCE(p_payload->>'sender_phone', '')), '');
  v_sender_mobile text;
  v_sender_address text;

  v_rec_name text := trim(COALESCE(p_payload->>'recipient_name', ''));
  v_rec_gov_id uuid := NULLIF(trim(COALESCE(p_payload->>'recipient_governorate_id', '')), '')::uuid;
  v_rec_reg_id uuid := NULLIF(trim(COALESCE(p_payload->>'recipient_region_id', '')), '')::uuid;
  v_rec_phone text := NULLIF(trim(COALESCE(p_payload->>'recipient_phone', '')), '');
  v_rec_mobile text := trim(COALESCE(p_payload->>'recipient_mobile', ''));
  v_rec_address text := trim(COALESCE(p_payload->>'recipient_address_line', ''));

  v_package_desc text := NULLIF(trim(COALESCE(p_payload->>'package_description', '')), '');
  v_external_ref text := NULLIF(trim(COALESCE(p_payload->>'external_reference', '')), '');
  v_notes text := NULLIF(trim(COALESCE(p_payload->>'notes', '')), '');
  v_allow_open boolean := COALESCE((p_payload->>'allow_package_opening')::boolean, false);
  v_pickup_date date := COALESCE(NULLIF(p_payload->>'pickup_date', '')::date, current_date);
  v_exchange_desc text := NULLIF(trim(COALESCE(p_payload->>'exchange_item_description', '')), '');

  v_client public.clients%ROWTYPE;
  v_shp_type public.shipment_types%ROWTYPE;
  v_pay_term public.payment_terms%ROWTYPE;
  v_dest_branch_id uuid;

  v_pricing_entered_amt numeric(14,2) := 0;
  v_breakdown jsonb;
  v_total_shipping_fee numeric(12,2);
  v_return_fee numeric(12,2);
  v_volumetric_weight numeric(10,3);
  v_chargeable_weight numeric(10,3);
  v_recipient_collect numeric(14,2);
  v_client_payout numeric(14,2);
  v_stored_entered_amt numeric(14,2);
  v_stored_prepaid_amt numeric(14,2);

  v_shipment_id uuid;
  v_shipment_number text;
  v_barcode_token text;
  v_tracking_token text;
  v_snapshot_id uuid;
BEGIN
  SELECT * INTO v_tok
  FROM public.api_tokens
  WHERE id = p_token_id
    AND is_active = true
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now());

  IF NOT FOUND THEN
    RAISE EXCEPTION 'رمز API غير صالح أو موقوف.';
  END IF;

  IF NOT ('shipments:write' = ANY(v_tok.scopes)) THEN
    RAISE EXCEPTION 'الرمز لا يملك صلاحية shipments:write لإنشاء الشحنات.';
  END IF;

  PERFORM app_private.assert_tenant_api_access(v_tok.tenant_id);

  IF v_tok.account_scope = 'client' THEN
    IF v_client_id IS NOT NULL AND v_client_id <> v_tok.client_id THEN
      RAISE EXCEPTION 'الرمز مقيد بتاجر محدد ولا يمكنه إنشاء شحنات لتاجر آخر.';
    END IF;
    v_client_id := v_tok.client_id;
  END IF;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'معرّف العميل (client_id) مطلوب.';
  END IF;

  IF v_clean_idem IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.shipments
    WHERE tenant_id = v_tok.tenant_id AND idempotency_key = v_clean_idem
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      SELECT token INTO v_existing_token
      FROM public.shipment_tracking_tokens
      WHERE tenant_id = v_tok.tenant_id AND shipment_id = v_existing.id AND is_active = true
      ORDER BY created_at DESC LIMIT 1;

      RETURN jsonb_build_object(
        'shipment_id', v_existing.id,
        'shipment_number', v_existing.shipment_number,
        'barcode_token', v_existing.barcode_token,
        'tracking_token', v_existing_token,
        'total_shipping_fee', v_existing.total_shipping_fee,
        'recipient_collect_amount', v_existing.recipient_collect_amount,
        'client_net_payout', v_existing.client_net_payout,
        'already_existed', true
      );
    END IF;
  END IF;

  SELECT * INTO v_client
  FROM public.clients
  WHERE id = v_client_id AND tenant_id = v_tok.tenant_id AND archived_at IS NULL AND is_active = true;
  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'العميل المحدد غير موجود أو غير نشط.';
  END IF;

  IF v_origin_branch_id IS NULL THEN
    SELECT COALESCE(v_client.branch_id, b.id)
    INTO v_origin_branch_id
    FROM public.branches b
    WHERE b.tenant_id = v_tok.tenant_id AND b.is_active = true
    ORDER BY b.is_main DESC, b.created_at ASC
    LIMIT 1;
  END IF;

  IF v_service_id IS NULL THEN
    SELECT id INTO v_service_id
    FROM public.shipping_services
    WHERE tenant_id = v_tok.tenant_id AND is_active = true
    ORDER BY code ASC LIMIT 1;
  END IF;

  IF v_shipment_type_id IS NULL THEN
    SELECT id INTO v_shipment_type_id
    FROM public.shipment_types
    WHERE tenant_id = v_tok.tenant_id AND is_active = true
    ORDER BY CASE WHEN code = 'DELIVERY' THEN 0 ELSE 1 END, code ASC LIMIT 1;
  END IF;

  IF v_payment_term_id IS NULL THEN
    SELECT id INTO v_payment_term_id
    FROM public.payment_terms
    WHERE tenant_id = v_tok.tenant_id AND is_active = true
    ORDER BY CASE WHEN code = 'COD' THEN 0 ELSE 1 END, code ASC LIMIT 1;
  END IF;

  SELECT * INTO v_shp_type FROM public.shipment_types
  WHERE id = v_shipment_type_id AND tenant_id = v_tok.tenant_id AND is_active = true;
  IF v_shp_type.id IS NULL THEN
    RAISE EXCEPTION 'نوع الشحنة غير صالح.';
  END IF;

  SELECT * INTO v_pay_term FROM public.payment_terms
  WHERE id = v_payment_term_id AND tenant_id = v_tok.tenant_id AND is_active = true;
  IF v_pay_term.id IS NULL THEN
    RAISE EXCEPTION 'طريقة الدفع غير صالحة.';
  END IF;

  v_sender_name := COALESCE(NULLIF(trim(COALESCE(p_payload->>'sender_name', '')), ''), v_client.name);
  v_sender_mobile := COALESCE(NULLIF(trim(COALESCE(p_payload->>'sender_mobile', '')), ''), v_client.phone, '0000000000');
  v_sender_address := COALESCE(NULLIF(trim(COALESCE(p_payload->>'sender_address_line', '')), ''), 'عنوان العميل المسجل');

  IF v_sender_gov_id IS NULL THEN
    SELECT governorate_id, region_id INTO v_sender_gov_id, v_sender_reg_id
    FROM public.client_addresses
    WHERE tenant_id = v_tok.tenant_id AND client_id = v_client.id AND is_active = true
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1;
  END IF;

  IF char_length(v_rec_name) < 2 OR char_length(v_rec_mobile) < 4 OR char_length(v_rec_address) < 3 THEN
    RAISE EXCEPTION 'بيانات المستلم غير مكتملة (recipient_name, recipient_mobile, recipient_address_line).';
  END IF;

  SELECT COALESCE(r.default_branch_id, g.default_branch_id, v_origin_branch_id)
  INTO v_dest_branch_id
  FROM public.regions r
  JOIN public.governorates g ON g.id = r.governorate_id AND g.tenant_id = r.tenant_id
  WHERE r.tenant_id = v_tok.tenant_id AND r.id = v_rec_reg_id;

  v_dest_branch_id := COALESCE(v_dest_branch_id, v_origin_branch_id);

  v_pricing_entered_amt := CASE WHEN v_pay_term.code = 'COD' THEN v_raw_balance ELSE 0 END;

  v_breakdown := public.calculate_shipment_price(
    v_tok.tenant_id,
    v_client_id,
    v_service_id,
    v_sender_gov_id,
    v_sender_reg_id,
    v_rec_gov_id,
    v_rec_reg_id,
    v_actual_weight,
    v_length_cm,
    v_width_cm,
    v_height_cm,
    v_pricing_entered_amt,
    v_price_mode,
    NULL,
    NULL,
    false
  );

  v_total_shipping_fee := (v_breakdown->>'total_shipping_fee')::numeric;
  v_return_fee := (v_breakdown->>'return_fee')::numeric;
  v_volumetric_weight := (v_breakdown->>'volumetric_weight_kg')::numeric;
  v_chargeable_weight := (v_breakdown->>'chargeable_weight_kg')::numeric;

  IF v_pay_term.code = 'COD' THEN
    v_stored_entered_amt := v_raw_balance;
    v_stored_prepaid_amt := v_raw_balance;
    v_recipient_collect := (v_breakdown->>'recipient_collect_amount')::numeric;
    v_client_payout := (v_breakdown->>'client_net_payout')::numeric;
  ELSIF v_pay_term.code = 'PREPAID' THEN
    v_stored_entered_amt := 0;
    v_stored_prepaid_amt := v_raw_balance;
    v_recipient_collect := 0;
    v_client_payout := 0;
  ELSIF v_pay_term.code = 'POSTPAID' THEN
    v_stored_entered_amt := 0;
    v_stored_prepaid_amt := 0;
    v_recipient_collect := 0;
    v_client_payout := ROUND(0 - v_total_shipping_fee, 2);
  ELSE
    v_stored_entered_amt := 0;
    v_stored_prepaid_amt := 0;
    v_recipient_collect := 0;
    v_client_payout := 0;
  END IF;

  v_shipment_number := app_private.next_document_number(v_tok.tenant_id, 'shipments');
  v_barcode_token := 'SFB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 14));
  v_tracking_token := lower(replace(gen_random_uuid()::text || substr(gen_random_uuid()::text, 1, 8), '-', ''));

  PERFORM set_config('app_private.allow_shipment_mutation', 'on', true);

  INSERT INTO public.shipments (
    tenant_id, idempotency_key, shipment_number, barcode_token,
    client_id, origin_branch_id, current_branch_id, destination_branch_id,
    movement_type_id, shipment_type_id, shipment_type_code, service_id,
    payment_term_id, payment_term_code, price_mode, operational_status,
    is_created_confirmed, is_collected_from_courier, is_settled_to_client, is_courier_commission_paid,
    entered_amount, prepaid_balance_amount, total_shipping_fee, return_fee,
    recipient_collect_amount, client_net_payout,
    pieces_count, delivered_pieces_count, returned_pieces_count,
    partial_return_custody, exchange_status,
    actual_weight_kg, chargeable_weight_kg, allow_package_opening,
    package_description, external_reference, notes, pickup_date,
    sender_governorate_id, sender_region_id, recipient_governorate_id, recipient_region_id,
    created_by, updated_by
  )
  VALUES (
    v_tok.tenant_id, v_clean_idem, v_shipment_number, v_barcode_token,
    v_client_id, v_origin_branch_id, v_origin_branch_id, v_dest_branch_id,
    v_movement_type_id, v_shipment_type_id, v_shp_type.code, v_service_id,
    v_payment_term_id, v_pay_term.code, v_price_mode, 'created',
    true, false, false, false,
    v_stored_entered_amt, v_stored_prepaid_amt, v_total_shipping_fee, v_return_fee,
    v_recipient_collect, v_client_payout,
    v_pieces_count, 0, 0,
    'none', CASE WHEN v_shp_type.code = 'PTP' THEN 'pending_exchange' ELSE 'none' END,
    v_actual_weight, v_chargeable_weight, v_allow_open,
    v_package_desc, v_external_ref, v_notes, v_pickup_date,
    v_sender_gov_id, v_sender_reg_id, v_rec_gov_id, v_rec_reg_id,
    v_tok.created_by, v_tok.created_by
  )
  RETURNING id INTO v_shipment_id;

  INSERT INTO public.shipment_price_snapshots (
    tenant_id, shipment_id, version_number, client_id, price_list_id, price_list_version_id,
    service_id, pickup_rule_id, delivery_rule_id, tax_profile_id,
    actual_weight_kg, length_cm, width_cm, height_cm, volumetric_divisor,
    volumetric_weight_kg, chargeable_weight_kg, rounding_rule,
    price_mode, entered_amount, base_delivery_fee, extra_weight_fee, collection_fee,
    surcharges_total, exemptions_total, tax_mode, tax_rate_percent, tax_amount,
    total_shipping_fee, return_fee, recipient_collect_amount, client_net_payout,
    is_manual_override, override_reason, calculation_breakdown, engine_version, created_by
  )
  VALUES (
    v_tok.tenant_id, v_shipment_id, 1, v_client_id,
    (v_breakdown->>'price_list_id')::uuid,
    (v_breakdown->>'price_list_version_id')::uuid,
    v_service_id,
    NULLIF(v_breakdown->>'pickup_rule_id', '')::uuid,
    NULLIF(v_breakdown->>'delivery_rule_id', '')::uuid,
    v_client.tax_profile_id,
    v_actual_weight, v_length_cm, v_width_cm, v_height_cm,
    (v_breakdown->>'volumetric_divisor')::numeric, v_volumetric_weight, v_chargeable_weight,
    v_breakdown->>'rounding_rule', v_price_mode, v_stored_entered_amt,
    (v_breakdown->>'base_delivery_fee')::numeric,
    (v_breakdown->>'extra_weight_fee')::numeric,
    (v_breakdown->>'collection_fee')::numeric,
    (v_breakdown->>'surcharges_total')::numeric,
    (v_breakdown->>'exemptions_total')::numeric,
    v_breakdown->>'tax_mode',
    (v_breakdown->>'tax_rate_percent')::numeric,
    (v_breakdown->>'tax_amount')::numeric,
    v_total_shipping_fee, v_return_fee, v_recipient_collect, v_client_payout,
    false, NULL,
    v_breakdown || jsonb_build_object(
      'payment_term_code', v_pay_term.code,
      'prepaid_balance_amount', v_stored_prepaid_amt,
      'api_token_id', v_tok.id
    ),
    'v6.0', v_tok.created_by
  )
  RETURNING id INTO v_snapshot_id;

  UPDATE public.shipments
  SET current_snapshot_id = v_snapshot_id
  WHERE id = v_shipment_id;

  PERFORM set_config('app_private.allow_shipment_mutation', 'off', true);

  INSERT INTO public.shipment_parties (
    tenant_id, shipment_id, party_type, name, phone, mobile, governorate_id, region_id, address_line
  )
  VALUES
    (v_tok.tenant_id, v_shipment_id, 'sender', v_sender_name, v_sender_phone, v_sender_mobile, v_sender_gov_id, v_sender_reg_id, v_sender_address),
    (v_tok.tenant_id, v_shipment_id, 'recipient', v_rec_name, v_rec_phone, v_rec_mobile, v_rec_gov_id, v_rec_reg_id, v_rec_address);

  INSERT INTO public.shipment_packages (
    tenant_id, shipment_id, package_index, description, pieces_count, weight_kg, declared_value, barcode
  )
  VALUES (
    v_tok.tenant_id, v_shipment_id, 1, COALESCE(v_package_desc, 'طرد قياسي'), v_pieces_count, v_actual_weight, v_raw_balance, v_barcode_token
  );

  INSERT INTO public.shipment_dimensions (
    tenant_id, shipment_id, snapshot_id, version_number,
    actual_weight_kg, length_cm, width_cm, height_cm,
    volumetric_divisor, volumetric_weight_kg, chargeable_weight_kg,
    reason, recorded_by
  )
  VALUES (
    v_tok.tenant_id, v_shipment_id, v_snapshot_id, 1,
    v_actual_weight, v_length_cm, v_width_cm, v_height_cm,
    (v_breakdown->>'volumetric_divisor')::numeric, v_volumetric_weight, v_chargeable_weight,
    'القياسات الابتدائية عبر API الخارجي', v_tok.created_by
  );

  INSERT INTO public.shipment_tracking_tokens (tenant_id, shipment_id, token, is_active)
  VALUES (v_tok.tenant_id, v_shipment_id, v_tracking_token, true);

  IF v_shp_type.code = 'PTP' AND v_exchange_desc IS NOT NULL THEN
    INSERT INTO public.shipment_relations (
      tenant_id, shipment_id, relation_type, exchange_item_description, custody_status, notes, created_by
    )
    VALUES (
      v_tok.tenant_id, v_shipment_id, 'ptp_exchange_return', v_exchange_desc, 'pending',
      'التزام استلام طرد الاستبدال من المستلم وإعادته للراسل (ADR-014)', v_tok.created_by
    );
  END IF;

  IF v_external_ref IS NOT NULL THEN
    INSERT INTO public.shipment_reference_numbers (tenant_id, shipment_id, ref_type, ref_value)
    VALUES (v_tok.tenant_id, v_shipment_id, 'merchant_order', v_external_ref);
  END IF;

  INSERT INTO public.shipment_status_events (
    tenant_id, shipment_id, event_code, from_status, to_status,
    branch_id, movement_type_id, fees_snapshot, notes, actor_user_id, actor_display_name
  )
  VALUES (
    v_tok.tenant_id, v_shipment_id, 'shipment.created', NULL, 'created',
    v_origin_branch_id, v_movement_type_id, v_total_shipping_fee,
    'إنشاء عبر API (' || v_tok.token_prefix || ')',
    v_tok.created_by, 'API: ' || v_tok.name
  );

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    v_tok.tenant_id, v_tok.created_by, 'shipment.created', 'shipments', v_shipment_id,
    jsonb_build_object('shipment_number', v_shipment_number, 'api_token_id', v_tok.id),
    'public_api_v1'
  );

  RETURN jsonb_build_object(
    'shipment_id', v_shipment_id,
    'shipment_number', v_shipment_number,
    'barcode_token', v_barcode_token,
    'tracking_token', v_tracking_token,
    'total_shipping_fee', v_total_shipping_fee,
    'recipient_collect_amount', v_recipient_collect,
    'client_net_payout', v_client_payout,
    'already_existed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.srv_api_create_shipment(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_api_create_shipment(uuid, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.srv_claim_pending_webhook_deliveries(
  p_tenant_id uuid DEFAULT NULL,
  p_endpoint_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'delivery_id', wd.id,
      'tenant_id', wd.tenant_id,
      'endpoint_id', wd.endpoint_id,
      'target_url', we.target_url,
      'signing_secret', ws.signing_secret,
      'event_type', wd.event_type,
      'idempotency_key', wd.idempotency_key,
      'attempt_count', wd.attempt_count,
      'request_payload', wd.request_payload
    ) ORDER BY wd.created_at ASC)
    FROM (
      SELECT id, tenant_id, endpoint_id, event_type, idempotency_key, attempt_count, request_payload, created_at
      FROM public.webhook_deliveries
      WHERE status IN ('pending', 'failed')
        AND (next_retry_at IS NULL OR next_retry_at <= now())
        AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id)
        AND (p_endpoint_id IS NULL OR endpoint_id = p_endpoint_id)
      ORDER BY created_at ASC
      LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100)
    ) wd
    JOIN public.webhook_endpoints we
      ON we.id = wd.endpoint_id AND we.tenant_id = wd.tenant_id AND we.is_active = true
    JOIN app_private.webhook_secrets ws
      ON ws.endpoint_id = we.id AND ws.tenant_id = we.tenant_id
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.srv_claim_pending_webhook_deliveries(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_claim_pending_webhook_deliveries(uuid, uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.srv_complete_webhook_delivery(
  p_delivery_id uuid,
  p_success boolean,
  p_response_status integer DEFAULT NULL,
  p_response_excerpt text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_del public.webhook_deliveries%ROWTYPE;
  v_next_attempts integer;
  v_new_status text;
BEGIN
  SELECT * INTO v_del
  FROM public.webhook_deliveries
  WHERE id = p_delivery_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_next_attempts := v_del.attempt_count + 1;
  IF p_success THEN
    v_new_status := 'delivered';
  ELSIF v_next_attempts >= 5 THEN
    v_new_status := 'dead_letter';
  ELSE
    v_new_status := 'failed';
  END IF;

  UPDATE public.webhook_deliveries
  SET attempt_count = v_next_attempts,
      status = v_new_status,
      response_status = p_response_status,
      response_excerpt = left(COALESCE(p_response_excerpt, ''), 500),
      delivered_at = CASE WHEN p_success THEN now() ELSE delivered_at END,
      next_retry_at = CASE
        WHEN p_success OR v_new_status = 'dead_letter' THEN NULL
        ELSE now() + make_interval(mins => POWER(2, v_next_attempts)::integer)
      END
  WHERE id = p_delivery_id;

  UPDATE public.webhook_endpoints
  SET last_triggered_at = now(),
      last_status_code = p_response_status,
      failure_count = CASE WHEN p_success THEN 0 ELSE failure_count + 1 END
  WHERE id = v_del.endpoint_id AND tenant_id = v_del.tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.srv_complete_webhook_delivery(uuid, boolean, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_complete_webhook_delivery(uuid, boolean, integer, text) TO service_role;
