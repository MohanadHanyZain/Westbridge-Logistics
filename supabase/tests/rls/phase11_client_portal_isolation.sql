-- ============================================================================
-- RLS & Workflow Verification Script for Phase 11
-- Run inside a transaction (ROLLBACK at the end) in Supabase SQL Editor.
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('c1111111-1111-1111-1111-111111111111', 'owner-p11@test.local'),
  ('c2222222-2222-2222-2222-222222222222', 'client-a1@test.local'),
  ('c3333333-3333-3333-3333-333333333333', 'client-a2@test.local'),
  ('c9999999-9999-9999-9999-999999999999', 'superadmin-p11@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES ('c9999999-9999-9999-9999-999999999999', 'Super Admin P11', true, true)
ON CONFLICT (id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase11-a',
  'c9999999-9999-9999-9999-999999999999',
  'TEN_P11',
  'phase11-portal',
  'شركة المرحلة الحادية عشرة للشحن',
  'c1111111-1111-1111-1111-111111111111',
  'admin',
  'مالك شركة 11',
  'owner-p11@test.local',
  'ow***@test.local'
);

DO $$
DECLARE
  v_tenant uuid;
  v_branch uuid;
  v_gov uuid;
  v_reg uuid;
  v_price_list uuid;
  v_tax_profile uuid;
  v_service uuid;
  v_shp_type uuid;
  v_mov_type uuid;
  v_term_cod uuid;
  v_role_client uuid;
  v_client1 uuid;
  v_client2 uuid;
  v_addr1 uuid;
  v_req1 uuid;
  v_shp1_res jsonb;
  v_shp2_res jsonb;
  v_summary jsonb;
  v_stmt jsonb;
  v_storefront jsonb;
  v_reg_res jsonb;
  v_count integer;
  v_blocked boolean;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug = 'phase11-portal';
  SELECT id INTO v_branch FROM public.branches WHERE tenant_id = v_tenant AND is_main = true LIMIT 1;
  SELECT id INTO v_gov FROM public.governorates WHERE tenant_id = v_tenant AND is_active = true LIMIT 1;
  SELECT id INTO v_reg FROM public.regions WHERE tenant_id = v_tenant AND governorate_id = v_gov AND is_active = true LIMIT 1;
  SELECT id INTO v_price_list FROM public.client_price_lists WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_tax_profile FROM public.tax_profiles WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_service FROM public.shipping_services WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_shp_type FROM public.shipment_types WHERE tenant_id = v_tenant AND code = 'FDP' LIMIT 1;
  SELECT id INTO v_mov_type FROM public.movement_types WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_term_cod FROM public.payment_terms WHERE tenant_id = v_tenant AND code = 'COD' LIMIT 1;
  SELECT id INTO v_role_client FROM public.roles WHERE tenant_id = v_tenant AND code = 'client_owner' LIMIT 1;

  -- Seed two distinct merchants inside the same tenant
  INSERT INTO public.clients (
    tenant_id, code, name, governorate_id, region_id, price_list_id, tax_profile_id,
    default_payment_term_id, default_shipment_type_id, phone, mobile, address_line
  ) VALUES (
    v_tenant, 'CL-A1', 'متجر ألفا الأول', v_gov, v_reg, v_price_list, v_tax_profile,
    v_term_cod, v_shp_type, '01000000001', '01000000001', 'مدينة نصر شارع 1'
  ) RETURNING id INTO v_client1;

  INSERT INTO public.clients (
    tenant_id, code, name, governorate_id, region_id, price_list_id, tax_profile_id,
    default_payment_term_id, default_shipment_type_id, phone, mobile, address_line
  ) VALUES (
    v_tenant, 'CL-A2', 'متجر بيتا المنافس', v_gov, v_reg, v_price_list, v_tax_profile,
    v_term_cod, v_shp_type, '01000000002', '01000000002', 'المعادي شارع 9'
  ) RETURNING id INTO v_client2;

  -- Bind two separate client users
  PERFORM public.srv_provision_tenant_user(
    v_tenant, 'c1111111-1111-1111-1111-111111111111', 'c2222222-2222-2222-2222-222222222222',
    'merchant_a1', 'تاجر 1', 'client-a1@test.local',
    v_role_client, v_client1, ARRAY[]::uuid[], NULL
  );
  PERFORM public.srv_provision_tenant_user(
    v_tenant, 'c1111111-1111-1111-1111-111111111111', 'c3333333-3333-3333-3333-333333333333',
    'merchant_a2', 'تاجر 2', 'client-a2@test.local',
    v_role_client, v_client2, ARRAY[]::uuid[], NULL
  );

  -- Owner creates a shipment for Client 2
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_shp2_res := public.create_shipment(v_tenant, 'p11-shp-2', jsonb_build_object(
    'client_id', v_client2,
    'origin_branch_id', v_branch,
    'service_id', v_service,
    'shipment_type_id', v_shp_type,
    'movement_type_id', v_mov_type,
    'payment_term_id', v_term_cod,
    'actual_weight_kg', 1,
    'entered_amount', 350,
    'sender_name', 'متجر بيتا المنافس',
    'sender_governorate_id', v_gov,
    'sender_region_id', v_reg,
    'sender_mobile', '01000000002',
    'sender_address_line', 'المعادي شارع 9',
    'recipient_name', 'مستلم ب',
    'recipient_governorate_id', v_gov,
    'recipient_region_id', v_reg,
    'recipient_mobile', '01111111112',
    'recipient_address_line', 'الدقي'
  ));

  -- 1. Client A1: create_shipment with spoofed client_id (must force-bind to Client 1)
  PERFORM set_config('request.jwt.claim.sub', 'c2222222-2222-2222-2222-222222222222', true);

  v_shp1_res := public.create_shipment(v_tenant, 'p11-shp-1', jsonb_build_object(
    'client_id', v_client1,
    'origin_branch_id', v_branch,
    'service_id', v_service,
    'shipment_type_id', v_shp_type,
    'movement_type_id', v_mov_type,
    'payment_term_id', v_term_cod,
    'actual_weight_kg', 1,
    'entered_amount', 500,
    'sender_name', 'متجر ألفا الأول',
    'sender_governorate_id', v_gov,
    'sender_region_id', v_reg,
    'sender_mobile', '01000000001',
    'sender_address_line', 'مدينة نصر شارع 1',
    'recipient_name', 'مستلم أ',
    'recipient_governorate_id', v_gov,
    'recipient_region_id', v_reg,
    'recipient_mobile', '01111111111',
    'recipient_address_line', 'المهندسين'
  ));

  -- Client A1 must see ONLY its own client row and shipment


    -- Spoofing test: A1 tries to create a shipment for A2 -> must be rejected
  v_blocked := false;
  BEGIN
    PERFORM public.create_shipment(v_tenant, 'p11-shp-spoof', jsonb_build_object(
      'client_id', v_client2,
      'origin_branch_id', v_branch,
      'service_id', v_service,
      'shipment_type_id', v_shp_type,
      'movement_type_id', v_mov_type,
      'payment_term_id', v_term_cod,
      'actual_weight_kg', 1,
      'entered_amount', 100,
      'sender_name', 'spoof',
      'sender_governorate_id', v_gov,
      'sender_region_id', v_reg,
      'sender_mobile', '01000000002',
      'sender_address_line', 'spoof',
      'recipient_name', 'spoof',
      'recipient_governorate_id', v_gov,
      'recipient_region_id', v_reg,
      'recipient_mobile', '01111111113',
      'recipient_address_line', 'spoof'
    ));
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Expected spoofed client_id to be rejected by create_shipment';
  END IF;

  
  SELECT COUNT(*) INTO v_count FROM public.clients WHERE tenant_id = v_tenant;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected Client A1 to see only 1 client row, saw %', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.shipments WHERE tenant_id = v_tenant;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected Client A1 to see only 1 shipment row (its own), saw %', v_count;
  END IF;

  -- Self-service address & pickup request
  v_addr1 := public.save_my_client_address(v_tenant, jsonb_build_object(
    'label', 'مخزن مدينة نصر',
    'governorate_id', v_gov,
    'region_id', v_reg,
    'address_line', 'شارع عباس العقاد 25',
    'phone', '01000000001',
    'is_default', true
  ));

  v_req1 := public.create_client_pickup_request(v_tenant, jsonb_build_object(
    'address_id', v_addr1,
    'governorate_id', v_gov,
    'region_id', v_reg,
    'pickup_address', 'شارع عباس العقاد 25',
    'contact_phone', '01000000001',
    'estimated_shipments_count', 5
  ));

  SELECT COUNT(*) INTO v_count FROM public.client_pickup_requests WHERE tenant_id = v_tenant;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected Client A1 to see its pickup request, count=%', v_count;
  END IF;

  -- Summary & Statement must ignore spoofed p_client_id = v_client2
  v_summary := public.get_client_portal_summary(v_tenant, v_client2, 'all');
  IF (v_summary->'client'->>'id')::uuid <> v_client1 THEN
    RAISE EXCEPTION 'Expected portal summary to force-scope to Client A1';
  END IF;

  v_stmt := public.get_client_account_statement(v_tenant, v_client2, NULL, NULL);
  IF (v_stmt->'client'->>'id')::uuid <> v_client1 THEN
    RAISE EXCEPTION 'Expected account statement to force-scope to Client A1';
  END IF;

  -- Client A1 CANNOT toggle tenant registration settings
  v_blocked := false;
  BEGIN
    PERFORM public.update_tenant_registration_settings(v_tenant, jsonb_build_object(
      'allow_client_self_registration', true
    ));
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Expected Client A1 to be blocked from update_tenant_registration_settings';
  END IF;

  -- 2. Client A2: cannot see or cancel Client A1 pickup request
  PERFORM set_config('request.jwt.claim.sub', 'c3333333-3333-3333-3333-333333333333', true);

  SELECT COUNT(*) INTO v_count FROM public.client_pickup_requests WHERE tenant_id = v_tenant;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Expected Client A2 to see 0 pickup requests of Client A1, saw %', v_count;
  END IF;

  v_blocked := false;
  BEGIN
    PERFORM public.cancel_client_pickup_request(v_tenant, v_req1);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Expected Client A2 to be blocked from cancelling Client A1 pickup request';
  END IF;

  -- 3. Owner: add internal note on Client A1 shipment
  PERFORM set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111111', true);
  INSERT INTO public.shipment_notes (tenant_id, shipment_id, note_type, body, created_by_name)
  VALUES (v_tenant, (v_shp1_res->>'shipment_id')::uuid, 'internal', 'ملاحظة داخلية سرية', 'مدير التشغيل');

  -- Client A1 must NOT see internal note
  PERFORM set_config('request.jwt.claim.sub', 'c2222222-2222-2222-2222-222222222222', true);
  SELECT COUNT(*) INTO v_count
  FROM public.shipment_notes
  WHERE shipment_id = (v_shp1_res->>'shipment_id')::uuid
    AND note_type = 'internal';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Expected Client A1 NOT to see internal shipment_notes, saw %', v_count;
  END IF;

  -- 4. Anon storefront + self-registration
  SET LOCAL ROLE anon;
  v_storefront := public.get_public_tenant_storefront('phase11-portal');
  IF v_storefront IS NULL OR (v_storefront->'tenant'->>'slug') <> 'phase11-portal' THEN
    RAISE EXCEPTION 'Expected anon get_public_tenant_storefront to succeed';
  END IF;

  -- Self-registration disabled initially -> must reject
  v_blocked := false;
  BEGIN
    PERFORM public.submit_client_registration_request('phase11-portal', jsonb_build_object(
      'company_name', 'متجر التجربة',
      'email', 'merchant@example.com',
      'phone', '01099887766',
      'governorate_id', v_gov,
      'region_id', v_reg,
      'address_line', 'الزمالك 15'
    ));
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Expected disabled self registration to reject anon request';
  END IF;

  -- Owner enables self-registration + auto-approve
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111111', true);
  PERFORM public.update_tenant_registration_settings(v_tenant, jsonb_build_object(
    'allow_client_self_registration', true,
    'auto_approve_clients', true,
    'public_tagline', 'شحن سريع لجميع محافظات مصر'
  ));

  -- Anon submits registration -> auto approved
  SET LOCAL ROLE anon;
  v_reg_res := public.submit_client_registration_request('phase11-portal', jsonb_build_object(
    'company_name', 'متجر النيل الحديث',
    'contact_name', 'أحمد حسن',
    'email', 'nile-store@example.com',
    'phone', '01099887766',
    'governorate_id', v_gov,
    'region_id', v_reg,
    'address_line', 'مدينة نصر 10',
    'payout_method', 'cash'
  ));

  IF COALESCE((v_reg_res->>'auto_approved')::boolean, false) <> true OR (v_reg_res->>'client_id') IS NULL THEN
    RAISE EXCEPTION 'Expected auto-approved registration to return client_id, got %', v_reg_res;
  END IF;

  RAISE NOTICE 'All Phase 11 checks passed.';
END $$;

ROLLBACK;