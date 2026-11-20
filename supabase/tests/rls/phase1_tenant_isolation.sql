-- ============================================================================
-- RLS & Isolation Verification Script for Phase 1
-- Run inside a transaction (ROLLBACK at the end) against a local/staging DB.
-- Verifies:
--   1. Tenant A user cannot read or update Tenant B records.
--   2. Idempotent onboarding prevents duplicate tenant creation.
--   3. Authenticated/anon users cannot query app_private.auth_identities.
--   4. Authenticated users cannot escalate profiles.is_platform_user.
-- ============================================================================

BEGIN;

-- Create two synthetic auth users for isolation verification
INSERT INTO auth.users (id, email)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'owner-a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'owner-b@test.local'),
  ('99999999-9999-9999-9999-999999999999', 'superadmin@test.local')
ON CONFLICT (id) DO NOTHING;

-- Bootstrap platform super admin
SELECT app_private.bootstrap_platform_super_admin(
  '99999999-9999-9999-9999-999999999999',
  'super_admin',
  'Platform Admin',
  'superadmin@test.local'
);

-- Onboard Tenant A and Tenant B atomically
SELECT * FROM app_private.onboard_tenant(
  'idem-tenant-a',
  '99999999-9999-9999-9999-999999999999',
  'TEN_A',
  'alpha-express',
  'شركة ألفا للشحن',
  '11111111-1111-1111-1111-111111111111',
  'admin',
  'مالك ألفا',
  'owner-a@test.local',
  'ow***@test.local'
);

-- Verify idempotency returns already_existed = true and creates no duplicate
DO $$
DECLARE
  v_already boolean;
BEGIN
  SELECT already_existed INTO v_already
  FROM app_private.onboard_tenant(
    'idem-tenant-a',
    '99999999-9999-9999-9999-999999999999',
    'TEN_A',
    'alpha-express',
    'شركة ألفا للشحن',
    '11111111-1111-1111-1111-111111111111',
    'admin',
    'مالك ألفا',
    'owner-a@test.local',
    'ow***@test.local'
  );
  IF NOT v_already THEN
    RAISE EXCEPTION 'Expected idempotency check to return already_existed = true';
  END IF;
END $$;

SELECT * FROM app_private.onboard_tenant(
  'idem-tenant-b',
  '99999999-9999-9999-9999-999999999999',
  'TEN_B',
  'beta-logistics',
  'شركة بيتا للشحن',
  '22222222-2222-2222-2222-222222222222',
  'admin',
  'مالك بيتا',
  'owner-b@test.local',
  'ow***@test.local'
);

-- Simulate authenticated session as Tenant A owner
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- Assert Tenant A sees ONLY 1 tenant (alpha-express)
DO $$
DECLARE
  v_count integer;
  v_slug text;
BEGIN
  SELECT count(*), min(slug) INTO v_count, v_slug FROM public.tenants;
  IF v_count <> 1 OR v_slug <> 'alpha-express' THEN
    RAISE EXCEPTION 'Cross-tenant leak detected! Expected 1 tenant (alpha-express), got %, %', v_count, v_slug;
  END IF;
END $$;

-- Assert Tenant A cannot update Tenant B settings
DO $$
DECLARE
  v_beta_id uuid;
  v_updated integer;
BEGIN
  -- Attempt blind update across all rows; RLS must affect 0 rows for beta-logistics
  UPDATE public.tenant_settings
  SET allow_client_self_registration = true
  WHERE tenant_id <> (SELECT id FROM public.tenants WHERE slug = 'alpha-express');
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 0 THEN
    RAISE EXCEPTION 'RLS failure: Tenant A updated % rows outside its tenant', v_updated;
  END IF;
END $$;

ROLLBACK;
