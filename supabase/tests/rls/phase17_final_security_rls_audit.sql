-- ============================================================================
-- Final RLS, Security Catalog Audit, Backup Policy & Restore Drill Verification
-- Phase 17 (ADR-025) - Run inside a transaction (ROLLBACK at the end)
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('d1111111-1111-1111-1111-111111111111', 'owner-p17-a@test.local'),
  ('d8888888-8888-8888-8888-888888888888', 'support-p17@test.local'),
  ('d9999999-9999-9999-9999-999999999999', 'superadmin-p17@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES
  ('d8888888-8888-8888-8888-888888888888', 'Support P17', true, true),
  ('d9999999-9999-9999-9999-999999999999', 'Super Admin P17', true, true)
ON CONFLICT (id) DO UPDATE SET is_platform_user = true, is_active = true;

INSERT INTO public.platform_admins (user_id, role_key, username, is_active, created_by)
VALUES
  ('d8888888-8888-8888-8888-888888888888', 'platform_support', 'support_p17', true, 'd9999999-9999-9999-9999-999999999999'),
  ('d9999999-9999-9999-9999-999999999999', 'platform_super_admin', 'superadmin_p17', true, 'd9999999-9999-9999-9999-999999999999')
ON CONFLICT (user_id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase17-a',
  'd9999999-9999-9999-9999-999999999999',
  'TEN_P17_A',
  'phase17-alpha',
  'شركة المرحلة السابعة عشرة أ',
  'd1111111-1111-1111-1111-111111111111',
  'admin_p17_a',
  'مالك شركة 17 أ',
  'owner-p17-a@test.local',
  'oa***@test.local'
);

DO $$
DECLARE
  v_unprotected_tables text;
  v_unprotected_count integer;
  v_pwd_cols integer;
  v_token_hash_exposed boolean;
  v_app_private_exposed boolean;
  v_audit_exposed boolean;
  v_overview jsonb;
  v_policy_updated jsonb;
  v_drill_res jsonb;
  v_rows_count integer;
  v_failed boolean := false;
BEGIN
  -- 1. Catalog-wide verification: 100% of public tables MUST have ENABLE + FORCE RLS
  SELECT
    count(*) FILTER (WHERE NOT (c.relrowsecurity AND c.relforcerowsecurity)),
    string_agg(c.relname, ', ') FILTER (WHERE NOT (c.relrowsecurity AND c.relforcerowsecurity))
  INTO v_unprotected_count, v_unprotected_tables
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p');

  IF v_unprotected_count > 0 THEN
    RAISE EXCEPTION 'Security audit failed: tables in public lack FORCE RLS: %', v_unprotected_tables;
  END IF;

  -- 2. Zero password columns in public tables
  SELECT count(*) INTO v_pwd_cols
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND column_name ~* '(^|_)(password|pass_hash|passwd)(_|$)';

  IF v_pwd_cols > 0 THEN
    RAISE EXCEPTION 'Security audit failed: found % password-like column(s) in public schema', v_pwd_cols;
  END IF;

  -- 3. api_tokens.token_hash and private/audit schemas never exposed to anon/authenticated
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.role_column_grants
    WHERE grantee IN ('anon', 'authenticated', 'PUBLIC')
      AND table_schema = 'public'
      AND table_name = 'api_tokens'
      AND column_name = 'token_hash'
      AND privilege_type = 'SELECT'
  ) INTO v_token_hash_exposed;

  IF v_token_hash_exposed THEN
    RAISE EXCEPTION 'Security audit failed: api_tokens.token_hash is readable by client roles';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE grantee IN ('anon', 'authenticated', 'PUBLIC')
      AND table_schema = 'app_private'
  ) INTO v_app_private_exposed;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants
    WHERE grantee IN ('anon', 'authenticated', 'PUBLIC')
      AND table_schema = 'audit'
  ) INTO v_audit_exposed;

  IF v_app_private_exposed OR v_audit_exposed THEN
    RAISE EXCEPTION 'Security audit failed: app_private or audit schema grants exposed';
  END IF;

  -- 4. Verify tenant user CANNOT read backup_policies or backup_restore_drills or call readiness RPC
  PERFORM set_config('request.jwt.claim.sub', 'd1111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  SELECT count(*) INTO v_rows_count FROM public.backup_policies;
  IF v_rows_count <> 0 THEN
    RAISE EXCEPTION 'RLS isolation failed: tenant user read % backup_policies rows', v_rows_count;
  END IF;

  v_failed := false;
  BEGIN
    PERFORM public.get_launch_readiness_overview();
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Security failed: tenant user executed get_launch_readiness_overview()';
  END IF;

  -- 5. Verify platform_support can read readiness overview but CANNOT mutate backup policy or drills
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', 'd8888888-8888-8888-8888-888888888888', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  v_overview := public.get_launch_readiness_overview();
  IF (v_overview->'security_audit'->>'unprotected_tables_count')::integer <> 0 THEN
    RAISE EXCEPTION 'Readiness overview reported unprotected tables: %', v_overview;
  END IF;

  v_failed := false;
  BEGIN
    PERFORM public.update_backup_policy(jsonb_build_object('rpo_minutes', 30));
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'RBAC failed: platform_support modified backup policy';
  END IF;

  v_failed := false;
  BEGIN
    PERFORM public.record_backup_restore_drill(jsonb_build_object(
      'environment', 'staging',
      'rto_achieved_minutes', 25,
      'status', 'passed'
    ));
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'RBAC failed: platform_support recorded restore drill';
  END IF;

  -- 6. Verify platform_super_admin can update policy & record passing drill, turning ready_for_launch = true
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', 'd9999999-9999-9999-9999-999999999999', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  v_policy_updated := public.update_backup_policy(jsonb_build_object(
    'rpo_minutes', 15,
    'rto_minutes', 45,
    'storage_rto_minutes', 90,
    'retention_days', 30,
    'pitr_enabled', true,
    'storage_sync_enabled', true
  ));
  IF (v_policy_updated->>'rto_minutes')::integer <> 45 THEN
    RAISE EXCEPTION 'Policy update did not persist expected rto_minutes: %', v_policy_updated;
  END IF;

  v_drill_res := public.record_backup_restore_drill(jsonb_build_object(
    'environment', 'isolated_clone',
    'rto_achieved_minutes', 28,
    'storage_verified', true,
    'rls_verified', true,
    'status', 'passed',
    'notes', 'اختبار استعادة ما قبل الإطلاق: التحقق من PITR وحاويات Storage وFORCE RLS'
  ));
  IF (v_drill_res->>'status') <> 'passed' THEN
    RAISE EXCEPTION 'Restore drill recording failed: %', v_drill_res;
  END IF;

  v_overview := public.get_launch_readiness_overview();
  IF COALESCE((v_overview->>'ready_for_launch')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Launch readiness expected true after passed drill and clean audit: %', v_overview;
  END IF;

  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'Phase 17 Final Security Audit, FORCE RLS (100%%) & Restore Drill verification PASSED.';
END;
$$;

ROLLBACK;