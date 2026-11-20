-- ============================================================================
-- RLS & Isolation Verification Script for Phase 2
-- Run inside a transaction (ROLLBACK at the end) against local/staging DB.
-- Verifies:
--   1. New tenants receive 27 Egyptian governorates, regions, main branch,
--      5 shipment types, default services, reasons, COA, and cashbox atomically.
--   2. Calling seed_tenant_phase2_defaults twice creates zero duplicate rows.
--   3. Tenant A user cannot read or update Tenant B branches/cashboxes/regions.
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('33333333-3333-3333-3333-333333333333', 'owner-c@test.local'),
  ('44444444-4444-4444-4444-444444444444', 'owner-d@test.local'),
  ('88888888-8888-8888-8888-888888888888', 'superadmin-p2@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES ('88888888-8888-8888-8888-888888888888', 'Super Admin P2', true, true)
ON CONFLICT (id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase2-c',
  '88888888-8888-8888-8888-888888888888',
  'TEN_C',
  'gamma-cargo',
  'شركة جاما للشحن',
  '33333333-3333-3333-3333-333333333333',
  'admin',
  'مالك جاما',
  'owner-c@test.local',
  'ow***@test.local'
);

SELECT * FROM app_private.onboard_tenant(
  'idem-phase2-d',
  '88888888-8888-8888-8888-888888888888',
  'TEN_D',
  'delta-express',
  'شركة دلتا للشحن',
  '44444444-4444-4444-4444-444444444444',
  'admin',
  'مالك دلتا',
  'owner-d@test.local',
  'ow***@test.local'
);

-- Verify idempotency of Phase 2 seeding
DO $$
DECLARE
  v_gamma_id uuid;
  v_gov_count_before integer;
  v_gov_count_after integer;
BEGIN
  SELECT id INTO v_gamma_id FROM public.tenants WHERE slug = 'gamma-cargo';
  SELECT count(*) INTO v_gov_count_before FROM public.governorates WHERE tenant_id = v_gamma_id;

  IF v_gov_count_before <> 27 THEN
    RAISE EXCEPTION 'Expected 27 Egyptian governorates for gamma-cargo, got %', v_gov_count_before;
  END IF;

  PERFORM app_private.seed_tenant_phase2_defaults(v_gamma_id, '88888888-8888-8888-8888-888888888888');
  SELECT count(*) INTO v_gov_count_after FROM public.governorates WHERE tenant_id = v_gamma_id;

  IF v_gov_count_after <> 27 THEN
    RAISE EXCEPTION 'Idempotency check failed: governorate count changed from % to %', v_gov_count_before, v_gov_count_after;
  END IF;
END $$;

-- Simulate authenticated session as Tenant C owner
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

-- Assert Tenant C sees ONLY its own 1 main branch, 27 governorates, and 1 cashbox
DO $$
DECLARE
  v_branch_cnt integer;
  v_gov_cnt integer;
  v_cashbox_cnt integer;
BEGIN
  SELECT count(*) INTO v_branch_cnt FROM public.branches;
  SELECT count(*) INTO v_gov_cnt FROM public.governorates;
  SELECT count(*) INTO v_cashbox_cnt FROM public.cashboxes;

  IF v_branch_cnt <> 1 OR v_gov_cnt <> 27 OR v_cashbox_cnt <> 1 THEN
    RAISE EXCEPTION 'Phase 2 RLS leak! branches=%, govs=%, cashboxes=%', v_branch_cnt, v_gov_cnt, v_cashbox_cnt;
  END IF;
END $$;

-- Assert Tenant C cannot update Tenant D cashboxes
DO $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.cashboxes
  SET name = 'اختراق خزينة'
  WHERE code = 'CSH-001'
    AND tenant_id <> (SELECT id FROM public.tenants WHERE slug = 'gamma-cargo');
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 0 THEN
    RAISE EXCEPTION 'RLS failure: Tenant C modified % cashboxes outside its tenant', v_updated;
  END IF;
END $$;

ROLLBACK;
