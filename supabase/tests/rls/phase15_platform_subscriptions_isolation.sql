-- ============================================================================
-- RLS & Workflow Verification Script for Phase 15
-- Central Platform Subscriptions, Quota Enforcement, Tenant Domains &
-- Timed Audited Support Access Isolation
-- Run inside a transaction (ROLLBACK at the end) in Supabase SQL Editor.
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('a1111111-1111-1111-1111-111111111111', 'owner-p15-a@test.local'),
  ('a2222222-2222-2222-2222-222222222222', 'owner-p15-b@test.local'),
  ('a3333333-3333-3333-3333-333333333333', 'staff-p15-a@test.local'),
  ('a8888888-8888-8888-8888-888888888888', 'support-p15@test.local'),
  ('a9999999-9999-9999-9999-999999999999', 'superadmin-p15@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES
  ('a9999999-9999-9999-9999-999999999999', 'Super Admin P15', true, true),
  ('a8888888-8888-8888-8888-888888888888', 'Platform Support P15', true, true)
ON CONFLICT (id) DO UPDATE
  SET is_platform_user = true, is_active = true;

INSERT INTO public.platform_admins (user_id, role_key, username, is_active, created_by)
VALUES
  ('a9999999-9999-9999-9999-999999999999', 'platform_super_admin', 'superadmin_p15', true, 'a9999999-9999-9999-9999-999999999999'),
  ('a8888888-8888-8888-8888-888888888888', 'platform_support', 'support_p15', true, 'a9999999-9999-9999-9999-999999999999')
ON CONFLICT (user_id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase15-a',
  'a9999999-9999-9999-9999-999999999999',
  'TEN_P15_A',
  'phase15-alpha',
  'شركة المرحلة الخامسة عشرة أ',
  'a1111111-1111-1111-1111-111111111111',
  'admin_p15_a',
  'مالك شركة 15 أ',
  'owner-p15-a@test.local',
  'oa***@test.local'
);

SELECT * FROM app_private.onboard_tenant(
  'idem-phase15-b',
  'a9999999-9999-9999-9999-999999999999',
  'TEN_P15_B',
  'phase15-beta',
  'شركة المرحلة الخامسة عشرة ب',
  'a2222222-2222-2222-2222-222222222222',
  'admin_p15_b',
  'مالك شركة 15 ب',
  'owner-p15-b@test.local',
  'ob***@test.local'
);

DO $$
DECLARE
  v_tenant_a uuid;
  v_tenant_b uuid;
  v_branch_a uuid;
  v_role_ops_a uuid;
  v_sub jsonb;
  v_dom jsonb;
  v_grant jsonb;
  v_snap jsonb;
  v_cnt integer;
  v_failed boolean := false;
BEGIN
  SELECT id INTO v_tenant_a FROM public.tenants WHERE slug = 'phase15-alpha';
  SELECT id INTO v_tenant_b FROM public.tenants WHERE slug = 'phase15-beta';
  SELECT id INTO v_branch_a FROM public.branches WHERE tenant_id = v_tenant_a AND is_main = true LIMIT 1;
  SELECT id INTO v_role_ops_a FROM public.roles WHERE tenant_id = v_tenant_a AND code = 'operations_manager' LIMIT 1;

  PERFORM public.srv_provision_tenant_user(
    v_tenant_a,
    'a1111111-1111-1111-1111-111111111111',
    'a3333333-3333-3333-3333-333333333333',
    'ops_p15_a',
    'مدير تشغيل 15 أ',
    'staff-p15-a@test.local',
    v_role_ops_a,
    NULL,
    ARRAY[v_branch_a],
    NULL
  );

  -- Switch to Supabase authenticated role
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- 1. Verify automatic onboarding provisioned STARTER trial subscription & primary subdomain
  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  v_sub := public.get_tenant_subscription_overview(v_tenant_a);
  IF (v_sub->'subscription'->>'plan_code') <> 'STARTER' THEN
    RAISE EXCEPTION 'Expected onboarded tenant to auto-provision STARTER plan, got %', v_sub->'subscription'->>'plan_code';
  END IF;
  IF (v_sub->'domains'->0->>'domain') <> 'phase15-alpha.shipflow.app' THEN
    RAISE EXCEPTION 'Expected primary subdomain phase15-alpha.shipflow.app';
  END IF;

  -- Tenant A Admin MUST NOT view Tenant B subscription or call platform directory
  BEGIN
    v_failed := false;
    PERFORM public.get_tenant_subscription_overview(v_tenant_b);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Tenant A Admin should be blocked from Tenant B subscription overview';
  END IF;

  BEGIN
    v_failed := false;
    PERFORM public.list_platform_tenants_directory();
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Tenant Admin should be blocked from list_platform_tenants_directory';
  END IF;

  -- Non-admin staff member MUST NOT read tenant_subscriptions
  PERFORM set_config('request.jwt.claim.sub', 'a3333333-3333-3333-3333-333333333333', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"a3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  SELECT count(*) INTO v_cnt FROM public.tenant_subscriptions WHERE tenant_id = v_tenant_a;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'Non-admin staff should not read tenant_subscriptions';
  END IF;

  -- 2. Platform Super Admin upgrades Tenant A to GROWTH, sets branch quota override = 1, adds & verifies custom domain
  PERFORM set_config('request.jwt.claim.sub', 'a9999999-9999-9999-9999-999999999999', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"a9999999-9999-9999-9999-999999999999","role":"authenticated"}', true);

  PERFORM public.assign_tenant_subscription(
    v_tenant_a,
    jsonb_build_object(
      'plan_code', 'GROWTH',
      'status', 'active',
      'billing_cycle', 'annual',
      'override_max_branches', 1
    )
  );

  v_dom := public.upsert_tenant_domain(
    v_tenant_a,
    jsonb_build_object(
      'domain', 'portal.phase15-alpha.com',
      'domain_type', 'custom',
      'is_primary', false
    )
  );
  IF (v_dom->>'verification_status') <> 'pending' THEN
    RAISE EXCEPTION 'Custom domain should start as pending verification';
  END IF;

  PERFORM public.verify_tenant_domain(v_tenant_a, (v_dom->>'id')::uuid, true);

  IF NOT EXISTS (
    SELECT 1 FROM public.resolve_tenant_by_domain('portal.phase15-alpha.com:3000') WHERE id = v_tenant_a
  ) THEN
    RAISE EXCEPTION 'Verified custom domain should resolve Tenant A';
  END IF;

  -- 3. Quota enforcement: Tenant A has 1 active branch and override_max_branches = 1 -> inserting 2nd branch must fail
  BEGIN
    v_failed := false;
    PERFORM app_private.assert_tenant_quota(v_tenant_a, 'branches');
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Expected assert_tenant_quota to block exceeding max_branches = 1';
  END IF;

  -- 4. Platform Support Access: viewing snapshot without active session fails, succeeds with reason, blocks after revoke
  PERFORM set_config('request.jwt.claim.sub', 'a8888888-8888-8888-8888-888888888888', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"a8888888-8888-8888-8888-888888888888","role":"authenticated"}', true);

  BEGIN
    v_failed := false;
    PERFORM public.get_platform_tenant_support_snapshot(v_tenant_a);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Support snapshot should require an active granted support session';
  END IF;

  v_grant := public.request_platform_support_access(
    v_tenant_a,
    'مراجعة عطل تسعير شحنة التاجر رقم 104',
    60,
    'read_only'
  );
  v_snap := public.get_platform_tenant_support_snapshot(v_tenant_a);
  IF (v_snap->'tenant'->>'id')::uuid <> v_tenant_a THEN
    RAISE EXCEPTION 'Support snapshot returned wrong tenant';
  END IF;

  PERFORM public.revoke_platform_support_access((v_grant->>'id')::uuid);

  BEGIN
    v_failed := false;
    PERFORM public.get_platform_tenant_support_snapshot(v_tenant_a);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Support snapshot should be blocked after session revocation';
  END IF;
END $$;

ROLLBACK;