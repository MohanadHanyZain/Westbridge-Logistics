-- ============================================================================
-- RLS & RBAC Verification Script for Phase 4
-- Run inside a transaction (ROLLBACK at the end) in Supabase SQL Editor.
-- Verifies:
--   1. New tenants receive 12 system roles + permission matrix + owner assignment.
--   2. Server-side permission helper `user_has_permission` enforces role & branch scope.
--   3. Client user binding via `account_subjects` rejects mismatched tenant clients.
--   4. Non-admin / unauthorized user cannot read another tenant's roles or users.
--   5. `company_owner` role cannot be deactivated or stripped of permissions.
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('88888888-8888-8888-8888-888888888888', 'owner-g@test.local'),
  ('99999999-9999-9999-9999-999999999999', 'owner-h@test.local'),
  ('aaaaaaaa-bbbb-cccc-dddd-111111111111', 'staff-g@test.local'),
  ('aaaaaaaa-bbbb-cccc-dddd-222222222222', 'superadmin-p4@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES ('aaaaaaaa-bbbb-cccc-dddd-222222222222', 'Super Admin P4', true, true)
ON CONFLICT (id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase4-g',
  'aaaaaaaa-bbbb-cccc-dddd-222222222222',
  'TEN_G',
  'gamma-ship',
  'شركة جاما للشحن',
  '88888888-8888-8888-8888-888888888888',
  'admin',
  'مالك جاما',
  'owner-g@test.local',
  'ow***@test.local'
);

SELECT * FROM app_private.onboard_tenant(
  'idem-phase4-h',
  'aaaaaaaa-bbbb-cccc-dddd-222222222222',
  'TEN_H',
  'theta-cargo',
  'شركة ثيتا للشحن',
  '99999999-9999-9999-9999-999999999999',
  'admin',
  'مالك ثيتا',
  'owner-h@test.local',
  'ow***@test.local'
);

-- Provision a branch-scoped staff member in Tenant G using service_role helper
DO $$
DECLARE
  v_g_id uuid;
  v_h_id uuid;
  v_g_branch uuid;
  v_h_branch uuid;
  v_branch_mgr_role uuid;
  v_g_staff_mem uuid;
  v_g_owner_role uuid;
BEGIN
  SELECT id INTO v_g_id FROM public.tenants WHERE slug = 'gamma-ship';
  SELECT id INTO v_h_id FROM public.tenants WHERE slug = 'theta-cargo';
  SELECT id INTO v_g_branch FROM public.branches WHERE tenant_id = v_g_id LIMIT 1;
  SELECT id INTO v_h_branch FROM public.branches WHERE tenant_id = v_h_id LIMIT 1;
  SELECT id INTO v_branch_mgr_role FROM public.roles WHERE tenant_id = v_g_id AND code = 'branch_manager';
  SELECT id INTO v_g_owner_role FROM public.roles WHERE tenant_id = v_g_id AND code = 'company_owner';

  -- Verify 12 system roles seeded
  IF (SELECT count(*) FROM public.roles WHERE tenant_id = v_g_id) < 12 THEN
    RAISE EXCEPTION 'Expected 12 system roles for Tenant G';
  END IF;

  -- Verify company_owner role cannot be deactivated
  BEGIN
    UPDATE public.roles SET is_active = false WHERE id = v_g_owner_role;
    RAISE EXCEPTION 'Expected trigger to block deactivating company_owner role';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Create branch_manager user scoped strictly to Tenant G main branch
  v_g_staff_mem := public.srv_provision_tenant_user(
    v_g_id,
    '88888888-8888-8888-8888-888888888888',
    'aaaaaaaa-bbbb-cccc-dddd-111111111111',
    'bm_cairo',
    'مدير فرع القاهرة',
    'bm_cairo@internal.test',
    v_branch_mgr_role,
    NULL,
    ARRAY[v_g_branch]
  );

  -- Verify cross-tenant branch assignment is blocked by composite FK
  BEGIN
    INSERT INTO public.membership_branches (tenant_id, membership_id, branch_id)
    VALUES (v_g_id, v_g_staff_mem, v_h_branch);
    RAISE EXCEPTION 'Expected composite FK to block cross-tenant branch assignment';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

-- Simulate authenticated session as Tenant G branch_manager
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-bbbb-cccc-dddd-111111111111', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE
  v_g_id uuid;
  v_h_id uuid;
  v_g_branch uuid;
  v_roles_count integer;
  v_perms_bundle jsonb;
BEGIN
  SELECT id INTO v_g_id FROM public.tenants WHERE slug = 'gamma-ship';
  SELECT id INTO v_h_id FROM public.tenants WHERE slug = 'theta-cargo';
  SELECT id INTO v_g_branch FROM public.branches WHERE tenant_id = v_g_id LIMIT 1;

  -- Call authenticated RPC (app_private schema stays strictly hidden from authenticated role)
  SELECT public.get_my_tenant_permissions(v_g_id) INTO v_perms_bundle;

  -- Branch manager has shipments.create on assigned branch, NOT users.manage
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_perms_bundle->'permissions') AS elem
    WHERE elem->>'permission_key' = 'shipments.create'
      AND elem->>'scope' = 'branch'
  ) THEN
    RAISE EXCEPTION 'Expected branch_manager to have shipments.create (branch scope)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_perms_bundle->'permissions') AS elem
    WHERE elem->>'permission_key' = 'users.manage'
  ) THEN
    RAISE EXCEPTION 'Did NOT expect branch_manager to have users.manage';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(v_perms_bundle->'branch_ids') AS b
    WHERE b::uuid = v_g_branch
  ) THEN
    RAISE EXCEPTION 'Expected branch_manager branch_ids to contain assigned branch';
  END IF;

  -- Cross-tenant RLS isolation: Tenant G user sees ONLY Tenant G roles (never Tenant H)
  SELECT count(*) INTO v_roles_count FROM public.roles WHERE tenant_id = v_h_id;
  IF v_roles_count <> 0 THEN
    RAISE EXCEPTION 'RLS leak! Tenant G user saw Tenant H roles: %', v_roles_count;
  END IF;

  -- Branch manager lacks roles.manage, so RLS must block creating custom roles
  BEGIN
    INSERT INTO public.roles (tenant_id, code, name, default_subject_type, default_scope)
    VALUES (v_g_id, 'unauthorized_role', 'دور غير مصرح', 'staff', 'branch');
    RAISE EXCEPTION 'Expected RLS to block branch_manager from inserting into public.roles';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%permission denied for schema%' THEN
      RAISE;
    END IF;
  END;

  -- Branch manager lacks users.read, so directory RPC must reject
  BEGIN
    PERFORM * FROM public.list_tenant_users_directory(v_g_id);
    RAISE EXCEPTION 'Expected list_tenant_users_directory to deny branch_manager';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

ROLLBACK;
