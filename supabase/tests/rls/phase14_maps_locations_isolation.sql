-- ============================================================================
-- RLS & Workflow Verification Script for Phase 14
-- Google Maps Courier Locations, GPS Event Capture, Retention Policy &
-- Multi-Tenant / Courier-Self / Client-Block Isolation
-- Run inside a transaction (ROLLBACK at the end) in Supabase SQL Editor.
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('f1111111-1111-1111-1111-111111111111', 'owner-p14@test.local'),
  ('f2222222-2222-2222-2222-222222222222', 'courier1-p14@test.local'),
  ('f3333333-3333-3333-3333-333333333333', 'courier2-p14@test.local'),
  ('f4444444-4444-4444-4444-444444444444', 'client-p14@test.local'),
  ('f5555555-5555-5555-5555-555555555555', 'owner-other-p14@test.local'),
  ('f9999999-9999-9999-9999-999999999999', 'superadmin-p14@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES ('f9999999-9999-9999-9999-999999999999', 'Super Admin P14', true, true)
ON CONFLICT (id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase14-a',
  'f9999999-9999-9999-9999-999999999999',
  'TEN_P14_A',
  'phase14-alpha',
  'شركة المرحلة الرابعة عشرة أ',
  'f1111111-1111-1111-1111-111111111111',
  'admin_p14_a',
  'مالك شركة 14 أ',
  'owner-p14@test.local',
  'ow***@test.local'
);

SELECT * FROM app_private.onboard_tenant(
  'idem-phase14-b',
  'f9999999-9999-9999-9999-999999999999',
  'TEN_P14_B',
  'phase14-beta',
  'شركة المرحلة الرابعة عشرة ب',
  'f5555555-5555-5555-5555-555555555555',
  'admin_p14_b',
  'مالك شركة 14 ب',
  'owner-other-p14@test.local',
  'ob***@test.local'
);

DO $$
DECLARE
  v_tenant_a uuid;
  v_tenant_b uuid;
  v_branch_a uuid;
  v_gov_a uuid;
  v_reg_a uuid;
  v_route_a uuid;
  v_comm_list_a uuid;
  v_price_list_a uuid;
  v_tax_a uuid;
  v_service_a uuid;
  v_shp_type_a uuid;
  v_term_cod_a uuid;
  v_role_courier_a uuid;
  v_role_client_a uuid;
  v_courier_1 uuid;
  v_courier_2 uuid;
  v_client_a uuid;
  v_ev_res1 jsonb;
  v_ev_res2 jsonb;
  v_timeline jsonb;
  v_live jsonb;
  v_settings jsonb;
  v_cnt integer;
  v_failed boolean := false;
BEGIN
  SELECT id INTO v_tenant_a FROM public.tenants WHERE slug = 'phase14-alpha';
  SELECT id INTO v_tenant_b FROM public.tenants WHERE slug = 'phase14-beta';
  SELECT id INTO v_branch_a FROM public.branches WHERE tenant_id = v_tenant_a AND is_main = true LIMIT 1;
  SELECT id INTO v_gov_a FROM public.governorates WHERE tenant_id = v_tenant_a AND is_active = true LIMIT 1;
  SELECT id INTO v_reg_a FROM public.regions WHERE tenant_id = v_tenant_a AND governorate_id = v_gov_a LIMIT 1;
  SELECT id INTO v_route_a FROM public.courier_routes WHERE tenant_id = v_tenant_a LIMIT 1;
  SELECT id INTO v_comm_list_a FROM public.courier_commission_lists WHERE tenant_id = v_tenant_a LIMIT 1;
  SELECT id INTO v_price_list_a FROM public.client_price_lists WHERE tenant_id = v_tenant_a LIMIT 1;
  SELECT id INTO v_tax_a FROM public.tax_profiles WHERE tenant_id = v_tenant_a LIMIT 1;
  SELECT id INTO v_service_a FROM public.shipping_services WHERE tenant_id = v_tenant_a LIMIT 1;
  SELECT id INTO v_shp_type_a FROM public.shipment_types WHERE tenant_id = v_tenant_a AND code = 'FDP' LIMIT 1;
  SELECT id INTO v_term_cod_a FROM public.payment_terms WHERE tenant_id = v_tenant_a AND code = 'COD' LIMIT 1;
  SELECT id INTO v_role_courier_a FROM public.roles WHERE tenant_id = v_tenant_a AND code = 'delivery_agent' LIMIT 1;
  SELECT id INTO v_role_client_a FROM public.roles WHERE tenant_id = v_tenant_a AND code = 'client_owner' LIMIT 1;

  INSERT INTO public.couriers (
    tenant_id, code, name, branch_id, default_route_id, commission_list_id,
    default_commission_type, default_commission_value, mobile
  )
  VALUES
    (v_tenant_a, 'CR-P14-01', 'مندوب أول خرائط', v_branch_a, v_route_a, v_comm_list_a, 'fixed_amount', 20, '01011111111'),
    (v_tenant_a, 'CR-P14-02', 'مندوب ثان خرائط', v_branch_a, v_route_a, v_comm_list_a, 'fixed_amount', 20, '01022222222');

  SELECT id INTO v_courier_1 FROM public.couriers WHERE tenant_id = v_tenant_a AND code = 'CR-P14-01';
  SELECT id INTO v_courier_2 FROM public.couriers WHERE tenant_id = v_tenant_a AND code = 'CR-P14-02';

  INSERT INTO public.clients (
    tenant_id, code, name, branch_id, governorate_id, region_id,
    price_list_id, tax_profile_id, default_payment_term_id, default_shipment_type_id,
    phone, mobile, address_line
  )
  VALUES (
    v_tenant_a, 'C-P14-01', 'عميل خرائط', v_branch_a, v_gov_a, v_reg_a,
    v_price_list_a, v_tax_a, v_term_cod_a, v_shp_type_a,
    '01033333333', '01033333333', 'المعادي'
  )
  RETURNING id INTO v_client_a;

  PERFORM public.srv_provision_tenant_user(
    v_tenant_a,
    'f1111111-1111-1111-1111-111111111111',
    'f2222222-2222-2222-2222-222222222222',
    'courier1_p14',
    'مندوب أول',
    'courier1-p14@test.local',
    'courier',
    v_role_courier_a,
    ARRAY[v_branch_a],
    NULL,
    v_courier_1
  );

  PERFORM public.srv_provision_tenant_user(
    v_tenant_a,
    'f1111111-1111-1111-1111-111111111111',
    'f3333333-3333-3333-3333-333333333333',
    'courier2_p14',
    'مندوب ثان',
    'courier2-p14@test.local',
    'courier',
    v_role_courier_a,
    ARRAY[v_branch_a],
    NULL,
    v_courier_2
  );

  PERFORM public.srv_provision_tenant_user(
    v_tenant_a,
    'f1111111-1111-1111-1111-111111111111',
    'f4444444-4444-4444-4444-444444444444',
    'client_p14',
    'عميل محظور عن المواقع',
    'client-p14@test.local',
    'client',
    v_role_client_a,
    ARRAY[v_branch_a],
    v_client_a,
    NULL
  );

  -- Switch to Supabase authenticated role so RLS is strictly enforced (no BYPASSRLS)
  EXECUTE 'SET LOCAL ROLE authenticated';

  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'Role switch failed: current_user is %', current_user;
  END IF;

  -- 1. Owner updates retention & GPS settings
  PERFORM set_config('request.jwt.claim.sub', 'f1111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"f1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  v_settings := public.update_tenant_maps_settings(
    v_tenant_a,
    jsonb_build_object(
      'location_retention_days', 45,
      'gps_ping_interval_seconds', 30,
      'require_gps_on_delivery', true
    )
  );
  IF (v_settings->>'location_retention_days')::integer <> 45 THEN
    RAISE EXCEPTION 'Expected updated retention days = 45';
  END IF;

  -- 2. Courier 1 records own shift_start & ping
  PERFORM set_config('request.jwt.claim.sub', 'f2222222-2222-2222-2222-222222222222', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"f2222222-2222-2222-2222-222222222222","role":"authenticated"}', true);

  v_ev_res1 := public.record_courier_location_event(
    v_tenant_a,
    jsonb_build_object(
      'event_type', 'shift_start',
      'lat', 30.044420,
      'lng', 31.235712,
      'accuracy_meters', 12.5,
      'source', 'gps_browser',
      'device_fingerprint', 'web-c1-device-1',
      'device_label', 'هاتف المندوب الأول'
    )
  );
  IF (v_ev_res1->>'courier_id')::uuid <> v_courier_1 THEN
    RAISE EXCEPTION 'Courier 1 location event should bind to Courier 1';
  END IF;

  -- Courier 1 MUST NOT be able to forge a location for Courier 2
  BEGIN
    v_failed := false;
    PERFORM public.record_courier_location_event(
      v_tenant_a,
      jsonb_build_object(
        'courier_id', v_courier_2,
        'event_type', 'ping',
        'lat', 30.050000,
        'lng', 31.240000
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Courier 1 should be blocked from recording location for Courier 2';
  END IF;

  -- 3. Courier 2 records own location event
  PERFORM set_config('request.jwt.claim.sub', 'f3333333-3333-3333-3333-333333333333', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"f3333333-3333-3333-3333-333333333333","role":"authenticated"}', true);

  v_ev_res2 := public.record_courier_location_event(
    v_tenant_a,
    jsonb_build_object(
      'event_type', 'delivery_attempt',
      'lat', 30.062630,
      'lng', 31.249670,
      'accuracy_meters', 8.0,
      'source', 'delivery_pod'
    )
  );

  -- Courier 2 sees ONLY Courier 2 in direct RLS select & get_live_couriers_positions
  SELECT count(*) INTO v_cnt
  FROM public.courier_location_events
  WHERE tenant_id = v_tenant_a AND courier_id = v_courier_1;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'RLS leak: Courier 2 read Courier 1 location events';
  END IF;

  SELECT count(*) INTO v_cnt
  FROM public.courier_location_events
  WHERE tenant_id = v_tenant_a AND courier_id = v_courier_2;
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'Courier 2 should see own location event';
  END IF;

  -- 4. Client account is STRICTLY blocked from reading internal courier locations
  PERFORM set_config('request.jwt.claim.sub', 'f4444444-4444-4444-4444-444444444444', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"f4444444-4444-4444-4444-444444444444","role":"authenticated"}', true);

  SELECT count(*) INTO v_cnt FROM public.courier_location_events WHERE tenant_id = v_tenant_a;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'RLS leak: Client user read courier_location_events';
  END IF;

  BEGIN
    v_failed := false;
    PERFORM public.get_live_couriers_positions(v_tenant_a, NULL);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Client user should be denied get_live_couriers_positions';
  END IF;

  -- 5. Tenant A Owner sees both couriers & timeline
  PERFORM set_config('request.jwt.claim.sub', 'f1111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"f1111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

  v_live := public.get_live_couriers_positions(v_tenant_a, NULL);
  IF jsonb_array_length(v_live) < 2 THEN
    RAISE EXCEPTION 'Tenant A Owner should see both couriers in live positions';
  END IF;

  v_timeline := public.list_courier_movements_timeline(v_tenant_a, v_courier_1, CURRENT_DATE - 1, CURRENT_DATE + 1);
  IF jsonb_array_length(v_timeline->'events') <> 1 THEN
    RAISE EXCEPTION 'Expected 1 movement event in Courier 1 timeline';
  END IF;

  -- 6. Cross-Tenant Isolation: Tenant B Owner MUST NOT read Tenant A location events
  PERFORM set_config('request.jwt.claim.sub', 'f5555555-5555-5555-5555-555555555555', true);
  PERFORM set_config('request.jwt.claims', '{"sub":"f5555555-5555-5555-5555-555555555555","role":"authenticated"}', true);

  SELECT count(*) INTO v_cnt FROM public.courier_location_events WHERE tenant_id = v_tenant_a;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'RLS isolation failure: Tenant B read Tenant A courier_location_events';
  END IF;

  SELECT count(*) INTO v_cnt FROM public.courier_devices WHERE tenant_id = v_tenant_a;
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'RLS isolation failure: Tenant B read Tenant A courier_devices';
  END IF;

  BEGIN
    v_failed := false;
    PERFORM public.list_courier_movements_timeline(v_tenant_a, v_courier_1, CURRENT_DATE, CURRENT_DATE);
  EXCEPTION WHEN OTHERS THEN
    v_failed := true;
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'Cross-tenant access to list_courier_movements_timeline should fail';
  END IF;
END $$;

ROLLBACK;