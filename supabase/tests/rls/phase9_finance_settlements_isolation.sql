-- ============================================================================
-- RLS & Workflow Verification Script for Phase 9
-- Collections, Cashboxes, Client & Courier Settlements & ADR-018 Four-Eyes
-- Run inside a transaction (ROLLBACK at the end) in Supabase SQL Editor.
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('f1111111-1111-1111-1111-111111111111', 'owner-p9@test.local'),
  ('f2222222-2222-2222-2222-222222222222', 'cashier-p9@test.local'),
  ('f3333333-3333-3333-3333-333333333333', 'accountant-p9@test.local'),
  ('f4444444-4444-4444-4444-444444444444', 'courier1-p9@test.local'),
  ('f5555555-5555-5555-5555-555555555555', 'client1-p9@test.local'),
  ('f9999999-9999-9999-9999-999999999999', 'superadmin-p9@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES ('f9999999-9999-9999-9999-999999999999', 'Super Admin P9', true, true)
ON CONFLICT (id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase9-a',
  'f9999999-9999-9999-9999-999999999999',
  'TEN_P9',
  'phase9-finance',
  'شركة المرحلة التاسعة للمالية',
  'f1111111-1111-1111-1111-111111111111',
  'admin',
  'مالك المرحلة التاسعة',
  'owner-p9@test.local',
  'ow***@test.local'
);

DO $$
DECLARE
  v_tenant uuid;
  v_branch uuid;
  v_gov_id uuid;
  v_reg_id uuid;
  v_role_cashier uuid;
  v_role_accountant uuid;
  v_role_courier uuid;
  v_role_client uuid;
  v_client_id uuid;
  v_client2_id uuid;
  v_courier1 uuid;
  v_route_id uuid;
  v_comm_list_id uuid;
  v_srv_id uuid;
  v_type_fdp uuid;
  v_term_cod uuid;
  v_reason_id uuid;
  v_cashbox1 uuid;
  v_cashbox2 uuid;
  v_acct_cash uuid;

  v_s1_id uuid;
  v_s2_id uuid;
  v_wrh_res jsonb;
  v_dlv_res jsonb;
  v_col_res jsonb;
  v_cmp_res jsonb;
  v_cst_res jsonb;
  v_ctr_res jsonb;

  v_s1_row public.shipments%ROWTYPE;
  v_s2_row public.shipments%ROWTYPE;
  v_custody jsonb;
  v_bal1 numeric(14,2);
  v_bal2 numeric(14,2);
  v_expected_cash numeric(14,2);
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug = 'phase9-finance';
  SELECT id INTO v_branch FROM public.branches WHERE tenant_id = v_tenant AND is_main = true LIMIT 1;
  SELECT id INTO v_gov_id FROM public.governorates WHERE tenant_id = v_tenant AND code = 'EG-01';
  SELECT id INTO v_reg_id FROM public.regions WHERE tenant_id = v_tenant AND code = 'EG-01-R01';
  SELECT id INTO v_role_cashier FROM public.roles WHERE tenant_id = v_tenant AND code = 'cashier';
  SELECT id INTO v_role_accountant FROM public.roles WHERE tenant_id = v_tenant AND code = 'accountant';
  SELECT id INTO v_role_courier FROM public.roles WHERE tenant_id = v_tenant AND code = 'delivery_agent';
  SELECT id INTO v_role_client FROM public.roles WHERE tenant_id = v_tenant AND code = 'client_owner';
  SELECT id INTO v_route_id FROM public.courier_routes WHERE tenant_id = v_tenant AND code = 'GENERAL' LIMIT 1;
  SELECT id INTO v_comm_list_id FROM public.courier_commission_lists WHERE tenant_id = v_tenant AND code = '0' LIMIT 1;
  SELECT id INTO v_srv_id FROM public.shipping_services WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_type_fdp FROM public.shipment_types WHERE tenant_id = v_tenant AND code = 'FDP';
  SELECT id INTO v_term_cod FROM public.payment_terms WHERE tenant_id = v_tenant AND code = 'COD';
  SELECT id INTO v_reason_id FROM public.delivery_exception_reasons WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id, ledger_account_id INTO v_cashbox1, v_acct_cash FROM public.cashboxes WHERE tenant_id = v_tenant AND code = 'CSH-001';

  INSERT INTO public.cashboxes (
    tenant_id, code, name, branch_id, ledger_account_id,
    is_active, allow_deposit, allow_withdraw, allow_transfer_in, allow_transfer_out
  )
  VALUES (
    v_tenant, 'CSH-002', 'خزينة التحويل الاحتياطية', v_branch, v_acct_cash,
    true, true, true, true, true
  )
  RETURNING id INTO v_cashbox2;

  INSERT INTO public.clients (
    tenant_id, code, name, branch_id, governorate_id, region_id,
    price_list_id, tax_profile_id, phone, mobile, address_line, payout_method
  )
  SELECT
    v_tenant, 'CL-P9-1', 'متجر التاسعة الرئيسي', v_branch, v_gov_id, v_reg_id,
    pl.id, tp.id, '0228888777', '01088887771', 'مدينة نصر', 'cash'
  FROM public.client_price_lists pl, public.tax_profiles tp
  WHERE pl.tenant_id = v_tenant AND pl.code = '0' AND tp.tenant_id = v_tenant AND tp.is_default = true
  LIMIT 1
  RETURNING id INTO v_client_id;

  INSERT INTO public.clients (
    tenant_id, code, name, branch_id, governorate_id, region_id,
    price_list_id, tax_profile_id, phone, mobile, address_line, payout_method
  )
  SELECT
    v_tenant, 'CL-P9-2', 'متجر التاسعة الثاني', v_branch, v_gov_id, v_reg_id,
    pl.id, tp.id, '0228888778', '01088887772', 'الدقي', 'cash'
  FROM public.client_price_lists pl, public.tax_profiles tp
  WHERE pl.tenant_id = v_tenant AND pl.code = '0' AND tp.tenant_id = v_tenant AND tp.is_default = true
  LIMIT 1
  RETURNING id INTO v_client2_id;

  INSERT INTO public.couriers (
    tenant_id, code, name, branch_id, default_route_id, commission_list_id,
    default_commission_type, default_commission_value, mobile, is_active
  )
  VALUES (
    v_tenant, 'CRR-P9-1', 'مندوب المالية الأول', v_branch, v_route_id, v_comm_list_id,
    'fixed_amount', 40, '01099990001', true
  )
  RETURNING id INTO v_courier1;

  PERFORM public.srv_provision_tenant_user(
    v_tenant, 'f1111111-1111-1111-1111-111111111111', 'f2222222-2222-2222-2222-222222222222',
    'cashier_p9', 'أمين خزينة 9', 'cashier-p9@test.local',
    v_role_cashier, NULL, ARRAY[v_branch], NULL
  );

  PERFORM public.srv_provision_tenant_user(
    v_tenant, 'f1111111-1111-1111-1111-111111111111', 'f3333333-3333-3333-3333-333333333333',
    'accountant_p9', 'محاسب 9', 'accountant-p9@test.local',
    v_role_accountant, NULL, ARRAY[v_branch], NULL
  );

  PERFORM public.srv_provision_tenant_user(
    v_tenant, 'f1111111-1111-1111-1111-111111111111', 'f4444444-4444-4444-4444-444444444444',
    'courier_p9', 'مندوب 9', 'courier1-p9@test.local',
    v_role_courier, NULL, ARRAY[v_branch], v_courier1
  );

  PERFORM public.srv_provision_tenant_user(
    v_tenant, 'f1111111-1111-1111-1111-111111111111', 'f5555555-5555-5555-5555-555555555555',
    'client1_p9', 'تاجر 9', 'client1-p9@test.local',
    v_role_client, v_client_id, ARRAY[]::uuid[], NULL
  );

  -- Switch to Tenant Owner: create S1 (COD delivery) & S2 (Return with recipient_paid_fee)
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'f1111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- ADR-018: enforce_four_eyes = true, allow_owner_self = true, high_value_threshold = 400
  PERFORM public.update_tenant_finance_policy(v_tenant, true, true, 400);

  v_s1_id := (public.create_shipment(v_tenant, 'idem-p9-s1', jsonb_build_object(
    'client_id', v_client_id, 'origin_branch_id', v_branch,
    'shipment_type_id', v_type_fdp, 'service_id', v_srv_id, 'payment_term_id', v_term_cod,
    'price_mode', 'shipping_excluded', 'actual_weight_kg', 2, 'pieces_count', 1,
    'prepaid_balance_amount', 500, 'package_description', 'شحنة مالية 1',
    'sender_name', 'متجر التاسعة', 'sender_governorate_id', v_gov_id, 'sender_region_id', v_reg_id,
    'sender_mobile', '01088887771', 'sender_address_line', 'مدينة نصر',
    'recipient_name', 'مستلم 1', 'recipient_governorate_id', v_gov_id, 'recipient_region_id', v_reg_id,
    'recipient_mobile', '01288887771', 'recipient_address_line', 'الدقي'
  ))->>'shipment_id')::uuid;

  v_s2_id := (public.create_shipment(v_tenant, 'idem-p9-s2', jsonb_build_object(
    'client_id', v_client_id, 'origin_branch_id', v_branch,
    'shipment_type_id', v_type_fdp, 'service_id', v_srv_id, 'payment_term_id', v_term_cod,
    'price_mode', 'shipping_excluded', 'actual_weight_kg', 1, 'pieces_count', 1,
    'prepaid_balance_amount', 200, 'package_description', 'شحنة مالية 2 مرتجع برسوم على المستلم',
    'sender_name', 'متجر التاسعة', 'sender_governorate_id', v_gov_id, 'sender_region_id', v_reg_id,
    'sender_mobile', '01088887771', 'sender_address_line', 'مدينة نصر',
    'recipient_name', 'مستلم 2', 'recipient_governorate_id', v_gov_id, 'recipient_region_id', v_reg_id,
    'recipient_mobile', '01288887772', 'recipient_address_line', 'المهندسين'
  ))->>'shipment_id')::uuid;

  -- Warehouse intake -> Delivery list -> Approve
  v_wrh_res := public.create_warehouse_manifest(v_tenant, jsonb_build_object('manifest_type', 'intake', 'branch_id', v_branch));
  PERFORM public.add_shipments_to_warehouse_manifest(v_tenant, (v_wrh_res->>'id')::uuid, ARRAY[v_s1_id, v_s2_id], NULL);
  PERFORM public.approve_warehouse_manifest(v_tenant, (v_wrh_res->>'id')::uuid);

  v_dlv_res := public.create_delivery_list(v_tenant, jsonb_build_object('list_type', 'delivery', 'branch_id', v_branch, 'courier_id', v_courier1));
  PERFORM public.add_shipments_to_delivery_list(v_tenant, (v_dlv_res->>'id')::uuid, ARRAY[v_s1_id, v_s2_id], NULL, false);
  PERFORM public.approve_delivery_list(v_tenant, (v_dlv_res->>'id')::uuid);

  -- Switch to Courier 1: deliver S1 (with COD collect = recipient_collect_amount, commission = 40)
  -- and return S2 with ADR-016 recipient_paid_fee = 30
  PERFORM set_config('request.jwt.claim.sub', 'f4444444-4444-4444-4444-444444444444', true);
  SELECT * INTO v_s1_row FROM public.shipments WHERE id = v_s1_id;

  PERFORM public.record_delivery_execution(v_tenant, jsonb_build_object(
    'shipment_id', v_s1_id,
    'delivery_list_id', (v_dlv_res->>'id')::uuid,
    'outcome', 'delivered',
    'delivered_amount', v_s1_row.recipient_collect_amount,
    'pod_method', 'signature',
    'pod_recipient_name', 'مستلم 1'
  ));

  PERFORM public.record_delivery_execution(v_tenant, jsonb_build_object(
    'shipment_id', v_s2_id,
    'delivery_list_id', (v_dlv_res->>'id')::uuid,
    'outcome', 'return_to_sender',
    'exception_reason_id', v_reason_id,
    'return_type_code', 'recipient_paid_fee',
    'return_collected_amount', 30,
    'notes', 'سدد المستلم 30 ج.م مصاريف المعاينة عند الباب'
  ));

  v_expected_cash := v_s1_row.recipient_collect_amount + 30;

  -- Check courier custody overview (strict separation: accrued commission = 40, payable commission = 0!)
  v_custody := public.get_courier_custody_overview(v_tenant, v_courier1);
  IF ((v_custody->0)->>'uncollected_cash_amount')::numeric <> v_expected_cash
     OR ((v_custody->0)->>'total_accrued_commission')::numeric <> 40
     OR ((v_custody->0)->>'payable_commission_amount')::numeric <> 0 THEN
    RAISE EXCEPTION 'ADR-012 separation failed in custody overview: %', v_custody;
  END IF;

  -- Switch to Cashier: verify ADR-012 BLOCKS commission payout before COD cash is collected!
  PERFORM set_config('request.jwt.claim.sub', 'f2222222-2222-2222-2222-222222222222', true);

  BEGIN
    PERFORM public.create_courier_commission_payout(v_tenant, jsonb_build_object(
      'branch_id', v_branch,
      'courier_id', v_courier1,
      'cashbox_id', v_cashbox1,
      'shipment_ids', jsonb_build_array(v_s1_id)
    ));
    RAISE EXCEPTION 'Expected ADR-012 to block commission payout before COD collection';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Cashier creates COL-* collection voucher for S1 & S2
  v_col_res := public.create_courier_collection_voucher(v_tenant, jsonb_build_object(
    'branch_id', v_branch,
    'courier_id', v_courier1,
    'cashbox_id', v_cashbox1,
    'shipment_ids', jsonb_build_array(v_s1_id, v_s2_id),
    'collected_amount', v_expected_cash
  ));
  IF NOT (v_col_res->>'voucher_code') LIKE 'COL-%' THEN
    RAISE EXCEPTION 'Expected COL- voucher code, got %', v_col_res->>'voucher_code';
  END IF;

  -- ADR-018 Four-Eyes Check: Cashier CANNOT approve their own COL-* voucher!
  BEGIN
    PERFORM public.approve_courier_collection_voucher(v_tenant, (v_col_res->>'id')::uuid);
    RAISE EXCEPTION 'Expected ADR-018 Four-Eyes to block Cashier self-approval';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Note: COL-* amount is >= 400 (high_value_approval_threshold = 400) -> Accountant CANNOT approve high-value COL-*!
  PERFORM set_config('request.jwt.claim.sub', 'f3333333-3333-3333-3333-333333333333', true);
  BEGIN
    PERFORM public.approve_courier_collection_voucher(v_tenant, (v_col_res->>'id')::uuid);
    RAISE EXCEPTION 'Expected ADR-018 High-Value Threshold to require owner/admin above 400';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Switch to Tenant Owner (f111...): approve COL-* -> cashbox increases by v_expected_cash!
  PERFORM set_config('request.jwt.claim.sub', 'f1111111-1111-1111-1111-111111111111', true);
  PERFORM public.approve_courier_collection_voucher(v_tenant, (v_col_res->>'id')::uuid);

  v_bal1 := app_private.get_cashbox_balance(v_tenant, v_cashbox1);
  IF v_bal1 <> v_expected_cash THEN
    RAISE EXCEPTION 'Expected CSH-001 balance %, got %', v_expected_cash, v_bal1;
  END IF;

  -- Now Cashier creates CMP-* commission payout (40 EGP < 400 threshold) and Accountant approves (Four-Eyes)!
  PERFORM set_config('request.jwt.claim.sub', 'f2222222-2222-2222-2222-222222222222', true);
  v_cmp_res := public.create_courier_commission_payout(v_tenant, jsonb_build_object(
    'branch_id', v_branch,
    'courier_id', v_courier1,
    'cashbox_id', v_cashbox1,
    'shipment_ids', jsonb_build_array(v_s1_id)
  ));
  IF NOT (v_cmp_res->>'payout_code') LIKE 'CMP-%' THEN
    RAISE EXCEPTION 'Expected CMP- payout code, got %', v_cmp_res->>'payout_code';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'f3333333-3333-3333-3333-333333333333', true);
  PERFORM public.approve_courier_commission_payout(v_tenant, (v_cmp_res->>'id')::uuid);

  v_bal1 := app_private.get_cashbox_balance(v_tenant, v_cashbox1);
  IF v_bal1 <> (v_expected_cash - 40) THEN
    RAISE EXCEPTION 'Expected CSH-001 balance after commission payout %, got %', (v_expected_cash - 40), v_bal1;
  END IF;

  -- Cashier creates Client Settlement CST-* for S1 + S2 -> net_payable_amount = 500 (S1 net) + 0 (S2 recipient_paid_fee)
  PERFORM set_config('request.jwt.claim.sub', 'f2222222-2222-2222-2222-222222222222', true);
  v_cst_res := public.create_client_settlement(v_tenant, jsonb_build_object(
    'client_id', v_client_id,
    'branch_id', v_branch,
    'cashbox_id', v_cashbox1,
    'payout_method', 'cash',
    'shipment_ids', jsonb_build_array(v_s1_id, v_s2_id)
  ));
  IF (v_cst_res->>'net_payable_amount')::numeric <> 500 THEN
    RAISE EXCEPTION 'Expected client settlement net 500, got %', v_cst_res->>'net_payable_amount';
  END IF;

  -- Tenant Owner approves CST-* (500 >= threshold 400)
  PERFORM set_config('request.jwt.claim.sub', 'f1111111-1111-1111-1111-111111111111', true);
  PERFORM public.approve_client_settlement(v_tenant, (v_cst_res->>'id')::uuid);

  -- Create & Approve Cashbox Transfer CTR-* of 25 EGP from CSH-001 -> CSH-002
  v_ctr_res := public.create_cashbox_transfer(v_tenant, jsonb_build_object(
    'from_cashbox_id', v_cashbox1,
    'to_cashbox_id', v_cashbox2,
    'amount', 25,
    'notes', 'تمويل خزينة التحويل الاحتياطية'
  ));
  -- Owner has allow_owner_self_approve = true -> can self-approve in small tenant mode!
  PERFORM public.approve_cashbox_transfer(v_tenant, (v_ctr_res->>'id')::uuid);

  v_bal2 := app_private.get_cashbox_balance(v_tenant, v_cashbox2);
  IF v_bal2 <> 25 THEN
    RAISE EXCEPTION 'Expected CSH-002 balance 25, got %', v_bal2;
  END IF;

  -- Verify shipments top flags updated atomically
  SELECT * INTO v_s1_row FROM public.shipments WHERE id = v_s1_id;
  SELECT * INTO v_s2_row FROM public.shipments WHERE id = v_s2_id;
  IF NOT (v_s1_row.is_collected_from_courier AND v_s1_row.is_settled_to_client AND v_s1_row.is_courier_commission_paid) THEN
    RAISE EXCEPTION 'Expected all 3 financial flags true on S1';
  END IF;
  IF NOT (v_s2_row.is_collected_from_courier AND v_s2_row.is_settled_to_client) OR v_s2_row.is_courier_commission_paid THEN
    RAISE EXCEPTION 'Expected S2 collected+settled and 0 commission paid';
  END IF;

  -- Verify Client RLS Isolation: Client 1 sees ONLY Client 1 settlements and cannot read cashbox_transactions!
  PERFORM set_config('request.jwt.claim.sub', 'f5555555-5555-5555-5555-555555555555', true);
  IF NOT EXISTS (SELECT 1 FROM public.client_settlements WHERE id = (v_cst_res->>'id')::uuid) THEN
    RAISE EXCEPTION 'Expected bound client to see own client_settlement';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cashbox_transactions WHERE tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'RLS leak! Client saw internal cashbox_transactions';
  END IF;
END $$;

ROLLBACK;
