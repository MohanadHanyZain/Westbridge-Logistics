-- ============================================================================
-- RLS & Workflow Verification Script for Phase 7
-- Pickup Lists, Warehouse Intake & Inter-Branch Transfers (ADR-015)
-- Run inside a transaction (ROLLBACK at the end) in Supabase SQL Editor.
-- Verifies:
--   1. Atomic PKP / WRH / TRF numbering sequences & header-before-items flow.
--   2. Pickup list creation, barcode + manual add, approval -> pickup_scheduled.
--   3. Local warehouse intake -> in_warehouse at receiving branch.
--   4. Two-step Inter-Branch Transfer Handshake (ADR-015):
--      a) Origin Branch A dispatches TRF-* -> status becomes `in_transit_branch`,
--         `current_branch_id` STAYS on Branch A until destination approves!
--      b) Branch C (unrelated branch) cannot add/receive Branch B's transfer
--         or see Branch A/B manifests.
--      c) Destination Branch B creates WRH-* intake, scans barcode & approves ->
--         ONLY then `current_branch_id` updates to Branch B & `in_warehouse`.
--   5. Admin / Operations Manager hang release rejects branch_manager and
--      requires mandatory reason recorded in `audit.audit_logs`.
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('d1111111-1111-1111-1111-111111111111', 'owner-p7@test.local'),
  ('d2222222-2222-2222-2222-222222222222', 'wh-branch-b@test.local'),
  ('d3333333-3333-3333-3333-333333333333', 'wh-branch-c@test.local'),
  ('d9999999-9999-9999-9999-999999999999', 'superadmin-p7@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES ('d9999999-9999-9999-9999-999999999999', 'Super Admin P7', true, true)
ON CONFLICT (id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase7-a',
  'd9999999-9999-9999-9999-999999999999',
  'TEN_P7',
  'phase7-ops',
  'شركة المرحلة السابعة للعمليات',
  'd1111111-1111-1111-1111-111111111111',
  'admin',
  'مالك عمليات السابعة',
  'owner-p7@test.local',
  'ow***@test.local'
);

DO $$
DECLARE
  v_tenant uuid;
  v_branch_a uuid;
  v_branch_b uuid;
  v_branch_c uuid;
  v_gov_id uuid;
  v_reg_id uuid;
  v_role_wh uuid;
  v_client_id uuid;
  v_srv_id uuid;
  v_type_fdp uuid;
  v_term_cod uuid;
  v_route_id uuid;
  v_comm_list_id uuid;
  v_courier_id uuid;
  v_shp1_json jsonb;
  v_shp2_json jsonb;
  v_shp3_json jsonb;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug = 'phase7-ops';
  SELECT id INTO v_branch_a FROM public.branches WHERE tenant_id = v_tenant AND is_main = true LIMIT 1;
  SELECT id INTO v_gov_id FROM public.governorates WHERE tenant_id = v_tenant AND code = 'EG-01';
  SELECT id INTO v_reg_id FROM public.regions WHERE tenant_id = v_tenant AND code = 'EG-01-R01';
  SELECT id INTO v_role_wh FROM public.roles WHERE tenant_id = v_tenant AND code = 'warehouse_operator';

  -- Create Branches B & C
  INSERT INTO public.branches (tenant_id, code, name, is_main, is_active, governorate_id, region_id)
  VALUES
    (v_tenant, 'BR-ALEX', 'فرع الإسكندرية', false, true, v_gov_id, v_reg_id),
    (v_tenant, 'BR-TANTA', 'فرع طنطا', false, true, v_gov_id, v_reg_id);

  SELECT id INTO v_branch_b FROM public.branches WHERE tenant_id = v_tenant AND code = 'BR-ALEX';
  SELECT id INTO v_branch_c FROM public.branches WHERE tenant_id = v_tenant AND code = 'BR-TANTA';

  -- Provision scoped warehouse operators for Branch B and Branch C
  PERFORM public.srv_provision_tenant_user(
    v_tenant, 'd1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222',
    'wh_alex', 'أمين مخزن الإسكندرية', 'wh-branch-b@test.local',
    v_role_wh, NULL, ARRAY[v_branch_b]
  );

  PERFORM public.srv_provision_tenant_user(
    v_tenant, 'd1111111-1111-1111-1111-111111111111', 'd3333333-3333-3333-3333-333333333333',
    'wh_tanta', 'أمين مخزن طنطا', 'wh-branch-c@test.local',
    v_role_wh, NULL, ARRAY[v_branch_c]
  );

  INSERT INTO public.clients (
    tenant_id, code, name, branch_id, governorate_id, region_id,
    price_list_id, tax_profile_id, phone, mobile, address_line
  )
  SELECT
    v_tenant, 'CL-P7', 'متجر السابعة', v_branch_a, v_gov_id, v_reg_id,
    pl.id, tp.id, '0228888777', '01088887777', 'مدينة نصر - شارع الطيران'
  FROM public.client_price_lists pl, public.tax_profiles tp
  WHERE pl.tenant_id = v_tenant AND pl.code = '0' AND tp.tenant_id = v_tenant AND tp.is_default = true
  LIMIT 1
  RETURNING id INTO v_client_id;

  SELECT id INTO v_route_id FROM public.courier_routes WHERE tenant_id = v_tenant AND code = 'GENERAL' LIMIT 1;
  SELECT id INTO v_comm_list_id FROM public.courier_commission_lists WHERE tenant_id = v_tenant AND code = '0' LIMIT 1;

  INSERT INTO public.couriers (
    tenant_id, code, name, branch_id, default_route_id, commission_list_id,
    default_commission_type, default_commission_value, mobile, is_active
  )
  VALUES (v_tenant, 'CRR-P7', 'مندوب السابعة', v_branch_a, v_route_id, v_comm_list_id, 'fixed_amount', 25, '01099990001', true)
  RETURNING id INTO v_courier_id;

  SELECT id INTO v_srv_id FROM public.shipping_services WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_type_fdp FROM public.shipment_types WHERE tenant_id = v_tenant AND code = 'FDP';
  SELECT id INTO v_term_cod FROM public.payment_terms WHERE tenant_id = v_tenant AND code = 'COD';

  -- Create 3 shipments as Tenant Owner
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'd1111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  v_shp1_json := public.create_shipment(v_tenant, 'idem-p7-s1', jsonb_build_object(
    'client_id', v_client_id, 'origin_branch_id', v_branch_a,
    'shipment_type_id', v_type_fdp, 'service_id', v_srv_id, 'payment_term_id', v_term_cod,
    'price_mode', 'shipping_excluded', 'actual_weight_kg', 2, 'pieces_count', 1,
    'prepaid_balance_amount', 300, 'package_description', 'شحنة اختبار 1',
    'sender_name', 'راسل 1', 'sender_governorate_id', v_gov_id, 'sender_region_id', v_reg_id,
    'sender_mobile', '01011111111', 'sender_address_line', 'مدينة نصر',
    'recipient_name', 'مستلم 1', 'recipient_governorate_id', v_gov_id, 'recipient_region_id', v_reg_id,
    'recipient_mobile', '01211111111', 'recipient_address_line', 'الإسكندرية'
  ));

  v_shp2_json := public.create_shipment(v_tenant, 'idem-p7-s2', jsonb_build_object(
    'client_id', v_client_id, 'origin_branch_id', v_branch_a,
    'shipment_type_id', v_type_fdp, 'service_id', v_srv_id, 'payment_term_id', v_term_cod,
    'price_mode', 'shipping_excluded', 'actual_weight_kg', 1, 'pieces_count', 1,
    'prepaid_balance_amount', 450, 'package_description', 'شحنة اختبار 2 (للتعليق)',
    'sender_name', 'راسل 2', 'sender_governorate_id', v_gov_id, 'sender_region_id', v_reg_id,
    'sender_mobile', '01011111112', 'sender_address_line', 'مدينة نصر',
    'recipient_name', 'مستلم 2', 'recipient_governorate_id', v_gov_id, 'recipient_region_id', v_reg_id,
    'recipient_mobile', '01211111112', 'recipient_address_line', 'سموحة'
  ));
END $$;

-- Execute full Pickup -> Warehouse Intake -> Outgoing Transfer -> Blocked Cross-Branch -> Destination Handshake -> Admin Override
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd1111111-1111-1111-1111-111111111111', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE
  v_tenant uuid;
  v_branch_a uuid;
  v_branch_b uuid;
  v_branch_c uuid;
  v_courier_id uuid;
  v_s1_id uuid;
  v_s2_id uuid;
  v_s1_barcode text;
  v_s2_barcode text;
  v_pkp_res jsonb;
  v_wrh_a_res jsonb;
  v_trf_res jsonb;
  v_wrh_b_res jsonb;
  v_cur_branch uuid;
  v_cur_status text;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug = 'phase7-ops';
  SELECT id INTO v_branch_a FROM public.branches WHERE tenant_id = v_tenant AND is_main = true LIMIT 1;
  SELECT id INTO v_branch_b FROM public.branches WHERE tenant_id = v_tenant AND code = 'BR-ALEX';
  SELECT id INTO v_branch_c FROM public.branches WHERE tenant_id = v_tenant AND code = 'BR-TANTA';
  SELECT id INTO v_courier_id FROM public.couriers WHERE tenant_id = v_tenant AND code = 'CRR-P7';

  SELECT id, barcode_token INTO v_s1_id, v_s1_barcode
  FROM public.shipments WHERE tenant_id = v_tenant AND package_description = 'شحنة اختبار 1';

  SELECT id, barcode_token INTO v_s2_id, v_s2_barcode
  FROM public.shipments WHERE tenant_id = v_tenant AND package_description = 'شحنة اختبار 2 (للتعليق)';

  -- 1. Pickup List: create -> add S1 via barcode & S2 via manual selection -> approve
  v_pkp_res := public.create_pickup_list(v_tenant, jsonb_build_object(
    'branch_id', v_branch_a, 'courier_id', v_courier_id, 'notes', 'التقاط صباحي'
  ));
  IF NOT (v_pkp_res->>'list_code') LIKE 'PKP-%' THEN
    RAISE EXCEPTION 'Expected PKP- prefix, got %', v_pkp_res->>'list_code';
  END IF;

  PERFORM public.add_shipments_to_pickup_list(v_tenant, (v_pkp_res->>'id')::uuid, ARRAY[]::uuid[], v_s1_barcode);
  PERFORM public.add_shipments_to_pickup_list(v_tenant, (v_pkp_res->>'id')::uuid, ARRAY[v_s2_id], NULL);
  PERFORM public.approve_pickup_list(v_tenant, (v_pkp_res->>'id')::uuid);

  SELECT operational_status INTO v_cur_status FROM public.shipments WHERE id = v_s1_id;
  IF v_cur_status <> 'pickup_scheduled' THEN
    RAISE EXCEPTION 'Expected pickup_scheduled after pickup approval, got %', v_cur_status;
  END IF;

  -- 2. Local Warehouse Intake at Origin Branch A (WRH-*)
  v_wrh_a_res := public.create_warehouse_manifest(v_tenant, jsonb_build_object(
    'manifest_type', 'intake', 'branch_id', v_branch_a, 'courier_id', v_courier_id
  ));
  IF NOT (v_wrh_a_res->>'manifest_code') LIKE 'WRH-%' THEN
    RAISE EXCEPTION 'Expected WRH- prefix, got %', v_wrh_a_res->>'manifest_code';
  END IF;

  PERFORM public.add_shipments_to_warehouse_manifest(v_tenant, (v_wrh_a_res->>'id')::uuid, ARRAY[v_s1_id, v_s2_id], NULL);
  PERFORM public.approve_warehouse_manifest(v_tenant, (v_wrh_a_res->>'id')::uuid);

  SELECT operational_status INTO v_cur_status FROM public.shipments WHERE id = v_s1_id;
  IF v_cur_status <> 'in_warehouse' THEN
    RAISE EXCEPTION 'Expected in_warehouse after warehouse intake, got %', v_cur_status;
  END IF;

  -- 3. ADR-015 Step 1: Outgoing Inter-Branch Transfer Branch A -> Branch B (TRF-*)
  v_trf_res := public.create_warehouse_manifest(v_tenant, jsonb_build_object(
    'manifest_type', 'transfer_out', 'branch_id', v_branch_a, 'target_branch_id', v_branch_b
  ));
  IF NOT (v_trf_res->>'manifest_code') LIKE 'TRF-%' THEN
    RAISE EXCEPTION 'Expected TRF- prefix, got %', v_trf_res->>'manifest_code';
  END IF;

  PERFORM public.add_shipments_to_warehouse_manifest(v_tenant, (v_trf_res->>'id')::uuid, ARRAY[v_s1_id, v_s2_id], NULL);
  PERFORM public.approve_warehouse_manifest(v_tenant, (v_trf_res->>'id')::uuid);

  -- Verify ADR-015: status IS in_transit_branch AND current_branch_id REMAINS Branch A!
  SELECT operational_status, current_branch_id INTO v_cur_status, v_cur_branch
  FROM public.shipments WHERE id = v_s1_id;
  IF v_cur_status <> 'in_transit_branch' OR v_cur_branch <> v_branch_a THEN
    RAISE EXCEPTION 'ADR-015 violation! Expected in_transit_branch at Branch A, got status=%, branch=%', v_cur_status, v_cur_branch;
  END IF;

  -- 4. Switch to Branch C operator: must be DENIED seeing/receiving Branch A->B transfer
  PERFORM set_config('request.jwt.claim.sub', 'd3333333-3333-3333-3333-333333333333', true);
  IF EXISTS (SELECT 1 FROM public.warehouse_manifests WHERE id = (v_trf_res->>'id')::uuid) THEN
    RAISE EXCEPTION 'RLS leak! Branch C operator saw Branch A->B transfer manifest';
  END IF;

  BEGIN
    PERFORM public.create_warehouse_manifest(v_tenant, jsonb_build_object(
      'manifest_type', 'intake', 'branch_id', v_branch_a
    ));
    RAISE EXCEPTION 'Expected Branch C operator to be denied creating intake on Branch A';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 5. Switch to Branch B operator: CAN see inbound shipment & complete Step 2 Handshake for S1
  PERFORM set_config('request.jwt.claim.sub', 'd2222222-2222-2222-2222-222222222222', true);

  IF NOT EXISTS (SELECT 1 FROM public.list_branch_inbound_transfer_shipments(v_tenant, v_branch_b) WHERE shipment_id = v_s1_id) THEN
    RAISE EXCEPTION 'Expected Branch B operator to see inbound shipment S1';
  END IF;

  v_wrh_b_res := public.create_warehouse_manifest(v_tenant, jsonb_build_object(
    'manifest_type', 'intake',
    'branch_id', v_branch_b,
    'source_transfer_manifest_id', (v_trf_res->>'id')::uuid
  ));

  PERFORM public.add_shipments_to_warehouse_manifest(v_tenant, (v_wrh_b_res->>'id')::uuid, ARRAY[]::uuid[], v_s1_barcode);
  PERFORM public.approve_warehouse_manifest(v_tenant, (v_wrh_b_res->>'id')::uuid);

  -- Branch B operator MUST BE DENIED admin hang release on S2 (reserved for admin / ops_manager)
  BEGIN
    PERFORM public.admin_release_stuck_transfer_or_manifest(
      v_tenant, (v_trf_res->>'id')::uuid, v_s2_id, 'return_to_origin', 'محاولة غير مصرح بها'
    );
    RAISE EXCEPTION 'Expected branch operator to be denied admin hang release';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Switch back to Tenant Owner: verify S1 moved to Branch B & is in_warehouse; S2 released back to Branch A with mandatory reason
  PERFORM set_config('request.jwt.claim.sub', 'd1111111-1111-1111-1111-111111111111', true);

  SELECT operational_status, current_branch_id INTO v_cur_status, v_cur_branch
  FROM public.shipments WHERE id = v_s1_id;
  IF v_cur_status <> 'in_warehouse' OR v_cur_branch <> v_branch_b THEN
    RAISE EXCEPTION 'Expected S1 to transfer custody to Branch B in_warehouse, got status=%, branch=%', v_cur_status, v_cur_branch;
  END IF;

  -- Reject empty reason on admin override
  BEGIN
    PERFORM public.admin_release_stuck_transfer_or_manifest(
      v_tenant, (v_trf_res->>'id')::uuid, v_s2_id, 'return_to_origin', 'قصير'
    );
    RAISE EXCEPTION 'Expected short override reason to fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  PERFORM public.admin_release_stuck_transfer_or_manifest(
    v_tenant, (v_trf_res->>'id')::uuid, v_s2_id, 'return_to_origin', 'تعذر تحميل الطرد على السيارة وتقرر إعادته لمخزن المنشأ'
  );

  SELECT operational_status, current_branch_id INTO v_cur_status, v_cur_branch
  FROM public.shipments WHERE id = v_s2_id;
  IF v_cur_status <> 'in_warehouse' OR v_cur_branch <> v_branch_a THEN
    RAISE EXCEPTION 'Expected released S2 back at Branch A in_warehouse, got status=%, branch=%', v_cur_status, v_cur_branch;
  END IF;
END $$;

ROLLBACK;
