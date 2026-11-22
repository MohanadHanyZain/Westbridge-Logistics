-- ============================================================================
-- RLS & Workflow Verification Script for Phase 16
-- API Tokens (SHA-256 Hash Only, One-Time Secret, Plan Gating, Scope Isolation),
-- Webhook Endpoints (HTTPS + SSRF Private-IP Block + Isolated app_private
-- Secrets), Automatic Shipment Webhook Enqueue & Cross-Tenant Isolation
-- Run inside a transaction (ROLLBACK at the end) in Supabase SQL Editor.
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('c1111111-1111-1111-1111-111111111111', 'owner-p16-a@test.local'),
  ('c2222222-2222-2222-2222-222222222222', 'owner-p16-b@test.local'),
  ('c3333333-3333-3333-3333-333333333333', 'client1-p16-a@test.local'),
  ('c4444444-4444-4444-4444-444444444444', 'client2-p16-a@test.local'),
  ('c9999999-9999-9999-9999-999999999999', 'superadmin-p16@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES ('c9999999-9999-9999-9999-999999999999', 'Super Admin P16', true, true)
ON CONFLICT (id) DO UPDATE SET is_platform_user = true, is_active = true;

INSERT INTO public.platform_admins (user_id, role_key, username, is_active, created_by)
VALUES ('c9999999-9999-9999-9999-999999999999', 'platform_super_admin', 'superadmin_p16', true, 'c9999999-9999-9999-9999-999999999999')
ON CONFLICT (user_id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase16-a',
  'c9999999-9999-9999-9999-999999999999',
  'TEN_P16_A',
  'phase16-alpha',
  'شركة المرحلة السادسة عشرة أ',
  'c1111111-1111-1111-1111-111111111111',
  'admin_p16_a',
  'مالك شركة 16 أ',
  'owner-p16-a@test.local',
  'oa***@test.local'
);

SELECT * FROM app_private.onboard_tenant(
  'idem-phase16-b',
  'c9999999-9999-9999-9999-999999999999',
  'TEN_P16_B',
  'phase16-beta',
  'شركة المرحلة السادسة عشرة ب',
  'c2222222-2222-2222-2222-222222222222',
  'admin_p16_b',
  'مالك شركة 16 ب',
  'owner-p16-b@test.local',
  'ob***@test.local'
);

DO $$
DECLARE
  v_tenant_a uuid;
  v_tenant_b uuid;
  v_branch_a uuid;
  v_gov_a uuid;
  v_reg_a uuid;
  v_price_list_a uuid;
  v_tax_profile_a uuid;
  v_term_cod_a uuid;
  v_shp_type_a uuid;
  v_role_client_a uuid;
  v_client_1 uuid;
  v_client_2 uuid;
  v_growth_plan_id uuid;
  v_tok_res jsonb;
  v_tok_client_res jsonb;
  v_ep_res jsonb;
  v_ep_client_res jsonb;
  v_rot_res jsonb;
  v_test_del jsonb;
  v_auth_res jsonb;
  v_ov_b jsonb;
  v_ov_c1 jsonb;
  v_raw_token text;
  v_raw_hash text;
  v_failed boolean := false;
BEGIN
  SELECT id INTO v_tenant_a FROM public.tenants WHERE slug = 'phase16-alpha';
  SELECT id INTO v_tenant_b FROM public.tenants WHERE slug = 'phase16-beta';
  SELECT id INTO v_branch_a FROM public.branches WHERE tenant_id = v_tenant_a AND is_main = true LIMIT 1;
  SELECT id INTO v_gov_a FROM public.governorates WHERE tenant_id = v_tenant_a AND is_active = true LIMIT 1;
  SELECT id INTO v_reg_a FROM public.regions WHERE tenant_id = v_tenant_a AND governorate_id = v_gov_a AND is_active = true LIMIT 1;
  SELECT id INTO v_price_list_a FROM public.client_price_lists WHERE tenant_id = v_tenant_a LIMIT 1;
  SELECT id INTO v_tax_profile_a FROM public.tax_profiles WHERE tenant_id = v_tenant_a LIMIT 1;
  SELECT id INTO v_term_cod_a FROM public.payment_terms WHERE tenant_id = v_tenant_a AND code = 'COD' LIMIT 1;
  SELECT id INTO v_shp_type_a FROM public.shipment_types WHERE tenant_id = v_tenant_a LIMIT 1;
  SELECT id INTO v_role_client_a FROM public.roles WHERE tenant_id = v_tenant_a AND code = 'client_owner' LIMIT 1;
  SELECT id INTO v_growth_plan_id FROM public.subscription_plans WHERE code = 'GROWTH' LIMIT 1;

  PERFORM app_private.seed_tenant_phase16_defaults(v_tenant_a, 'c1111111-1111-1111-1111-111111111111'::uuid);
  PERFORM app_private.seed_tenant_phase16_defaults(v_tenant_b, 'c2222222-2222-2222-2222-222222222222'::uuid);

  INSERT INTO public.clients (
    tenant_id, code, name, branch_id, governorate_id, region_id,
    price_list_id, tax_profile_id, default_payment_term_id, default_shipment_type_id,
    phone, mobile, address_line, payout_method, default_price_mode, is_active,
    created_by, updated_by
  )
  VALUES
    (
      v_tenant_a, 'CL16-1', 'تاجر 16 الأول', v_branch_a, v_gov_a, v_reg_a,
      v_price_list_a, v_tax_profile_a, v_term_cod_a, v_shp_type_a,
      '01011111111', '01011111111', 'القاهرة - مدينة نصر', 'cash', 'shipping_excluded', true,
      'c1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111'
    ),
    (
      v_tenant_a, 'CL16-2', 'تاجر 16 الثاني', v_branch_a, v_gov_a, v_reg_a,
      v_price_list_a, v_tax_profile_a, v_term_cod_a, v_shp_type_a,
      '01022222222', '01022222222', 'الجيزة - المهندسين', 'cash', 'shipping_excluded', true,
      'c1111111-1111-1111-1111-111111111111', 'c1111111-1111-1111-1111-111111111111'
    );

  SELECT id INTO v_client_1 FROM public.clients WHERE tenant_id = v_tenant_a AND code = 'CL16-1';
  SELECT id INTO v_client_2 FROM public.clients WHERE tenant_id = v_tenant_a AND code = 'CL16-2';

  PERFORM public.srv_provision_tenant_user(
    v_tenant_a,
    'c1111111-1111-1111-1111-111111111111'::uuid,
    'c3333333-3333-3333-3333-333333333333'::uuid,
    'client1_p16',
    'تاجر أول 16',
    'client1-p16-a@test.local',
    v_role_client_a,
    v_client_1,
    ARRAY[]::uuid[],
    NULL::uuid
  );

  PERFORM public.srv_provision_tenant_user(
    v_tenant_a,
    'c1111111-1111-1111-1111-111111111111'::uuid,
    'c4444444-4444-4444-4444-444444444444'::uuid,
    'client2_p16',
    'تاجر ثان 16',
    'client2-p16-a@test.local',
    v_role_client_a,
    v_client_2,
    ARRAY[]::uuid[],
    NULL::uuid
  );

  EXECUTE 'SET LOCAL ROLE authenticated';

  -- 1. STARTER plan MUST block API token creation
  PERFORM set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"c1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  BEGIN
    v_failed := false;
    PERFORM public.create_api_token(v_tenant_a, jsonb_build_object(
      'name', 'Blocked Starter Key',
      'account_scope', 'tenant',
      'scopes', jsonb_build_array('shipments:read')
    ));
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Expected STARTER plan to block create_api_token';
  END IF;

  -- Upgrade Tenant A to GROWTH via Super Admin, keeping Tenant B on STARTER
  PERFORM set_config('request.jwt.claim.sub', 'c9999999-9999-9999-9999-999999999999', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"c9999999-9999-9999-9999-999999999999","role":"authenticated"}', true);
  PERFORM public.assign_tenant_subscription(v_tenant_a, jsonb_build_object(
    'plan_id', v_growth_plan_id,
    'status', 'active',
    'billing_cycle', 'monthly'
  ));

  -- 2. Tenant A Owner creates a tenant-wide token & validates one-time plaintext secret
  PERFORM set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"c1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  v_tok_res := public.create_api_token(v_tenant_a, jsonb_build_object(
    'name', 'ERP Production Key',
    'account_scope', 'tenant',
    'scopes', jsonb_build_array('shipments:read', 'shipments:write', 'tracking:read'),
    'allowed_ips', jsonb_build_array('198.51.100.0/24')
  ));
  v_raw_token := v_tok_res->>'plaintext_token';
  IF v_raw_token IS NULL OR left(v_raw_token, 8) <> 'sf_live_' THEN
    RAISE EXCEPTION 'Expected one-time sf_live_ plaintext token';
  END IF;

  -- Verify SSRF protection blocks http://, localhost, and private IPs
  BEGIN
    v_failed := false;
    PERFORM public.upsert_webhook_endpoint(v_tenant_a, jsonb_build_object(
      'name', 'Invalid Localhost',
      'target_url', 'https://localhost/webhook',
      'events', jsonb_build_array('shipment.created')
    ));
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Expected localhost webhook URL to be rejected';
  END IF;

  BEGIN
    v_failed := false;
    PERFORM public.upsert_webhook_endpoint(v_tenant_a, jsonb_build_object(
      'name', 'Invalid Metadata IP',
      'target_url', 'https://169.254.169.254/latest/meta-data',
      'events', jsonb_build_array('shipment.created')
    ));
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Expected 169.254.169.254 metadata IP to be rejected';
  END IF;

  BEGIN
    v_failed := false;
    PERFORM public.upsert_webhook_endpoint(v_tenant_a, jsonb_build_object(
      'name', 'Invalid Private 10.x',
      'target_url', 'https://10.0.0.5/hook',
      'events', jsonb_build_array('shipment.created')
    ));
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Expected 10.0.0.5 private IP to be rejected';
  END IF;

  -- Valid public HTTPS webhook endpoint succeeds & returns whsec_ once
  v_ep_res := public.upsert_webhook_endpoint(v_tenant_a, jsonb_build_object(
    'name', 'Main Store Webhook',
    'target_url', 'https://webhooks.merchant-example.com/shipflow',
    'events', jsonb_build_array('shipment.created', 'shipment.status_changed', 'webhook.test')
  ));
  IF left(v_ep_res->>'plaintext_signing_secret', 6) <> 'whsec_' THEN
    RAISE EXCEPTION 'Expected one-time whsec_ signing secret';
  END IF;

  v_rot_res := public.rotate_webhook_secret(v_tenant_a, (v_ep_res->'endpoint'->>'id')::uuid);
  IF left(v_rot_res->>'plaintext_signing_secret', 6) <> 'whsec_' THEN
    RAISE EXCEPTION 'Expected rotated whsec_ secret';
  END IF;

  v_test_del := public.trigger_test_webhook_event(v_tenant_a, (v_ep_res->'endpoint'->>'id')::uuid, 'webhook.test');
  IF (v_test_del->>'status') <> 'pending' THEN
    RAISE EXCEPTION 'Expected test webhook delivery status to start as pending';
  END IF;

  -- Verify authenticated CANNOT query app_private.webhook_secrets
  BEGIN
    v_failed := false;
    EXECUTE 'SELECT count(*) FROM app_private.webhook_secrets';
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'authenticated role MUST NOT access app_private.webhook_secrets';
  END IF;

  -- Verify authenticated CANNOT select token_hash column from public.api_tokens
  BEGIN
    v_failed := false;
    EXECUTE 'SELECT token_hash FROM public.api_tokens LIMIT 1';
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'authenticated role MUST NOT be able to SELECT token_hash';
  END IF;

  -- 3. Bound Client 1 can create & see ONLY Client 1 tokens/webhooks, never Tenant-wide or Client 2
  PERFORM set_config('request.jwt.claim.sub', 'c3333333-3333-3333-3333-333333333333', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"c3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

  -- Client 1 attempting to create tenant-scoped token MUST fail
  BEGIN
    v_failed := false;
    PERFORM public.create_api_token(v_tenant_a, jsonb_build_object(
      'name', 'Escalation Attempt',
      'account_scope', 'tenant',
      'scopes', jsonb_build_array('shipments:read')
    ));
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Client user MUST NOT create tenant-wide token';
  END IF;

  -- Client 1 attempting to create token for Client 2 MUST fail
  BEGIN
    v_failed := false;
    PERFORM public.create_api_token(v_tenant_a, jsonb_build_object(
      'name', 'Cross-Client Attempt',
      'account_scope', 'client',
      'client_id', v_client_2,
      'scopes', jsonb_build_array('shipments:read')
    ));
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Client 1 MUST NOT create token for Client 2';
  END IF;

  v_tok_client_res := public.create_api_token(v_tenant_a, jsonb_build_object(
    'name', 'Store 1 Integration',
    'account_scope', 'client',
    'scopes', jsonb_build_array('shipments:read', 'tracking:read')
  ));
  v_ep_client_res := public.upsert_webhook_endpoint(v_tenant_a, jsonb_build_object(
    'name', 'Store 1 Hook',
    'target_url', 'https://store1.example.com/hooks',
    'events', jsonb_build_array('shipment.created')
  ));

  v_ov_c1 := public.get_integrations_overview(v_tenant_a);
  IF jsonb_array_length(v_ov_c1->'tokens') <> 1 OR jsonb_array_length(v_ov_c1->'endpoints') <> 1 THEN
    RAISE EXCEPTION 'Client 1 must see only its own 1 token and 1 endpoint, got % / %',
      jsonb_array_length(v_ov_c1->'tokens'), jsonb_array_length(v_ov_c1->'endpoints');
  END IF;

  -- 4. Cross-Tenant Isolation: Tenant B owner MUST NOT see Tenant A tokens or webhooks
  PERFORM set_config('request.jwt.claim.sub', 'c2222222-2222-2222-2222-222222222222', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"c2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  v_ov_b := public.get_integrations_overview(v_tenant_b);
  IF jsonb_array_length(v_ov_b->'tokens') <> 0 OR jsonb_array_length(v_ov_b->'endpoints') <> 0 THEN
    RAISE EXCEPTION 'Tenant B saw Tenant A tokens or endpoints';
  END IF;

  BEGIN
    v_failed := false;
    PERFORM public.revoke_api_token(v_tenant_a, (v_tok_res->'token'->>'id')::uuid);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Tenant B MUST NOT revoke Tenant A token';
  END IF;

  -- 5. Verify service_role token authentication & IP check & revocation
  RESET ROLE;
  v_raw_hash := encode(pg_catalog.sha256(convert_to(v_raw_token, 'UTF8')), 'hex');

  v_auth_res := public.srv_authenticate_api_token(v_raw_hash, 'shipments:write', '198.51.100.42');
  IF (v_auth_res->>'valid')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'Expected valid API token authentication from allowlisted IP, got %', v_auth_res;
  END IF;

  v_auth_res := public.srv_authenticate_api_token(v_raw_hash, 'shipments:write', '203.0.113.9');
  IF (v_auth_res->>'valid')::boolean IS NOT FALSE OR (v_auth_res->>'reason') <> 'ip_not_allowed' THEN
    RAISE EXCEPTION 'Expected ip_not_allowed from non-allowlisted IP';
  END IF;

  -- Revoke token as Tenant A Owner & verify token is immediately blocked
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"c1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  PERFORM public.revoke_api_token(v_tenant_a, (v_tok_res->'token'->>'id')::uuid);

  RESET ROLE;
  v_auth_res := public.srv_authenticate_api_token(v_raw_hash, 'shipments:write', '198.51.100.42');
  IF (v_auth_res->>'valid')::boolean IS NOT FALSE OR (v_auth_res->>'reason') <> 'token_revoked' THEN
    RAISE EXCEPTION 'Expected revoked token to fail authentication';
  END IF;
END $$;

ROLLBACK;
