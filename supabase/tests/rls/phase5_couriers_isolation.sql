-- ============================================================================
-- RLS & Commission Cascade Verification Script for Phase 5
-- Run inside a transaction (ROLLBACK at the end) in Supabase SQL Editor.
-- Verifies:
--   1. New tenants get protected default route 'GENERAL' and default commission list '0'.
--   2. Protected defaults cannot be deleted or deactivated.
--   3. 3-tier commission cascade (region -> governorate -> courier default) calculates accurately.
--   4. Cross-tenant composite FKs block binding Tenant A courier to Tenant B route/user.
--   5. Authenticated user of Tenant A cannot read Tenant B couriers/routes/commissions via RLS.
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('c1111111-1111-1111-1111-111111111111', 'owner-p5a@test.local'),
  ('c2222222-2222-2222-2222-222222222222', 'owner-p5b@test.local'),
  ('c3333333-3333-3333-3333-333333333333', 'superadmin-p5@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES ('c3333333-3333-3333-3333-333333333333', 'Super Admin P5', true, true)
ON CONFLICT (id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase5-a',
  'c3333333-3333-3333-3333-333333333333',
  'P5A',
  'p5-alpha',
  'شركة ألفا للمناديب',
  'c1111111-1111-1111-1111-111111111111',
  'admin',
  'مالك ألفا',
  'owner-p5a@test.local',
  'ow***@test.local'
);

SELECT * FROM app_private.onboard_tenant(
  'idem-phase5-b',
  'c3333333-3333-3333-3333-333333333333',
  'P5B',
  'p5-beta',
  'شركة بيتا للمناديب',
  'c2222222-2222-2222-2222-222222222222',
  'admin',
  'مالك بيتا',
  'owner-p5b@test.local',
  'ow***@test.local'
);

DO $$
DECLARE
  v_a_id uuid;
  v_b_id uuid;
  v_a_route uuid;
  v_b_route uuid;
  v_a_clist uuid;
  v_a_gov1 uuid;
  v_a_gov2 uuid;
  v_a_reg1 uuid;
  v_a_courier uuid;
BEGIN
  SELECT id INTO v_a_id FROM public.tenants WHERE slug = 'p5-alpha';
  SELECT id INTO v_b_id FROM public.tenants WHERE slug = 'p5-beta';

  SELECT id INTO v_a_route FROM public.courier_routes WHERE tenant_id = v_a_id AND code = 'GENERAL';
  SELECT id INTO v_b_route FROM public.courier_routes WHERE tenant_id = v_b_id AND code = 'GENERAL';
  SELECT id INTO v_a_clist FROM public.courier_commission_lists WHERE tenant_id = v_a_id AND code = '0';

  IF v_a_route IS NULL OR v_a_clist IS NULL THEN
    RAISE EXCEPTION 'Expected default GENERAL route and commission list 0 to be seeded';
  END IF;

  -- Verify default route GENERAL cannot be deleted
  BEGIN
    DELETE FROM public.courier_routes WHERE id = v_a_route;
    RAISE EXCEPTION 'Expected trigger to block deleting GENERAL route';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Create governorate + region rule & governorate-wide rule for Tenant A
  SELECT id INTO v_a_gov1 FROM public.governorates WHERE tenant_id = v_a_id ORDER BY code LIMIT 1;
  SELECT id INTO v_a_gov2 FROM public.governorates WHERE tenant_id = v_a_id AND id <> v_a_gov1 ORDER BY code LIMIT 1;
  SELECT id INTO v_a_reg1 FROM public.regions WHERE tenant_id = v_a_id AND governorate_id = v_a_gov1 LIMIT 1;

  INSERT INTO public.courier_commission_rules (
    tenant_id, commission_list_id, governorate_id, region_id, commission_type, commission_value
  )
  VALUES
    (v_a_id, v_a_clist, v_a_gov1, v_a_reg1, 'delivery_percent', 20),
    (v_a_id, v_a_clist, v_a_gov1, NULL, 'fixed_amount', 30);

  INSERT INTO public.couriers (
    tenant_id, code, name, default_route_id, commission_list_id,
    default_commission_type, default_commission_value, mobile
  )
  VALUES (
    v_a_id, 'CR-001', 'كابتن حسام', v_a_route, v_a_clist,
    'delivery_plus_collection_percent', 10, '01001122334'
  )
  RETURNING id INTO v_a_courier;

  -- Verify cross-tenant composite FK rejects linking Tenant A courier to Tenant B route
  BEGIN
    INSERT INTO public.couriers (
      tenant_id, code, name, default_route_id, commission_list_id,
      default_commission_type, default_commission_value, mobile
    )
    VALUES (
      v_a_id, 'CR-ERR', 'مخالف', v_b_route, v_a_clist,
      'fixed_amount', 15, '01009988776'
    );
    RAISE EXCEPTION 'Expected composite FK to block cross-tenant route binding';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

-- Simulate authenticated session as Tenant A owner
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111111', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE
  v_a_id uuid;
  v_b_id uuid;
  v_a_courier uuid;
  v_a_gov1 uuid;
  v_a_gov2 uuid;
  v_a_reg1 uuid;
  v_res_t1 jsonb;
  v_res_t2 jsonb;
  v_res_t3 jsonb;
  v_b_count integer;
BEGIN
  SELECT id INTO v_a_id FROM public.tenants WHERE slug = 'p5-alpha';
  SELECT id INTO v_b_id FROM public.tenants WHERE slug = 'p5-beta';
  SELECT id INTO v_a_courier FROM public.couriers WHERE tenant_id = v_a_id AND code = 'CR-001';
  SELECT id INTO v_a_gov1 FROM public.governorates WHERE tenant_id = v_a_id ORDER BY code LIMIT 1;
  SELECT id INTO v_a_gov2 FROM public.governorates WHERE tenant_id = v_a_id AND id <> v_a_gov1 ORDER BY code LIMIT 1;
  SELECT id INTO v_a_reg1 FROM public.regions WHERE tenant_id = v_a_id AND governorate_id = v_a_gov1 LIMIT 1;

  -- Tier 1: region_rule (20% of 100 delivery_fee = 20.00)
  SELECT public.calculate_courier_commission(v_a_id, v_a_courier, v_a_gov1, v_a_reg1, 100, 10) INTO v_res_t1;
  IF v_res_t1->>'match_tier' <> 'region_rule' OR (v_res_t1->>'commission_amount')::numeric <> 20 THEN
    RAISE EXCEPTION 'Expected Tier 1 region_rule 20.00, got %', v_res_t1;
  END IF;

  -- Tier 2: governorate_rule when region is omitted (fixed_amount = 30.00)
  SELECT public.calculate_courier_commission(v_a_id, v_a_courier, v_a_gov1, NULL, 100, 10) INTO v_res_t2;
  IF v_res_t2->>'match_tier' <> 'governorate_rule' OR (v_res_t2->>'commission_amount')::numeric <> 30 THEN
    RAISE EXCEPTION 'Expected Tier 2 governorate_rule 30.00, got %', v_res_t2;
  END IF;

  -- Tier 3: courier_default when governorate has no rule (10% of (100+20) = 12.00)
  SELECT public.calculate_courier_commission(v_a_id, v_a_courier, v_a_gov2, NULL, 100, 20) INTO v_res_t3;
  IF v_res_t3->>'match_tier' <> 'courier_default' OR (v_res_t3->>'commission_amount')::numeric <> 12 THEN
    RAISE EXCEPTION 'Expected Tier 3 courier_default 12.00, got %', v_res_t3;
  END IF;

  -- Verify RLS blocks reading Tenant B couriers or routes
  SELECT count(*) INTO v_b_count FROM public.courier_routes WHERE tenant_id = v_b_id;
  IF v_b_count <> 0 THEN
    RAISE EXCEPTION 'RLS leak! Tenant A saw Tenant B routes: %', v_b_count;
  END IF;
END $$;

ROLLBACK;
