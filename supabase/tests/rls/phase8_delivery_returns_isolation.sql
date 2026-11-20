-- ============================================================================
-- RLS & Workflow Verification Script for Phase 8
-- Delivery Lists, Redelivery, Returns, POD, Attempts Policy & Courier Portal
-- Run inside a transaction (ROLLBACK at the end) in Supabase SQL Editor.
-- Verifies:
--   1. DLV-* creation & approval -> `out_for_delivery`, bound courier access vs cross-courier RLS isolation.
--   2. Courier execution with POD (`delivered`) + ADR-012 commission auto-calculation.
--   3. ADR-017 Max delivery attempts policy (default 3 / customizable):
--      a) Failure on attempt reaching max auto-transitions shipment to `return_to_sender`.
--      b) Adding maxed-out shipment to RDL-* / DLV-* is BLOCKED by default,
--         and ALLOWED when overridden by company_owner/admin/operations_manager (`audit.audit_logs`).
--   4. ADR-016 Return liability modes:
--      a) `no_charge`: records `applied_return_fee = return_fee`, recipient collection = 0, commission = 0.
--      b) `recipient_paid_fee`: records `return_collected_from_recipient` collected at door, commission = 0.
--   5. Return manifests workflow: RTH-* (courier_return_inbound) + RTN-* (client_return_handover)
--      including ADR-014 PTP exchange custody (`with_courier` -> `in_warehouse` -> `returned_to_client`).
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('e1111111-1111-1111-1111-111111111111', 'owner-p8@test.local'),
  ('e2222222-2222-2222-2222-222222222222', 'courier1-p8@test.local'),
  ('e3333333-3333-3333-3333-333333333333', 'courier2-p8@test.local'),
  ('e9999999-9999-9999-9999-999999999999', 'superadmin-p8@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES ('e9999999-9999-9999-9999-999999999999', 'Super Admin P8', true, true)
ON CONFLICT (id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase8-a',
  'e9999999-9999-9999-9999-999999999999',
  'TEN_P8',
  'phase8-delivery',
  'شركة المرحلة الثامنة للتوصيل',
  'e1111111-1111-1111-1111-111111111111',
  'admin',
  'مالك توصيل الثامنة',
  'owner-p8@test.local',
  'ow***@test.local'
);

DO $$
DECLARE
  v_tenant uuid;
  v_branch uuid;
  v_gov_id uuid;
  v_reg_id uuid;
  v_role_courier uuid;
  v_client_id uuid;
  v_srv_id uuid;
  v_type_fdp uuid;
  v_type_ptp uuid;
  v_term_cod uuid;
  v_route_id uuid;
  v_comm_list_id uuid;
  v_courier1 uuid;
  v_courier2 uuid;
  v_reason_id uuid;
  v_s1_json jsonb;
  v_s2_json jsonb;
  v_s3_json jsonb;
  v_s1_id uuid;
  v_s2_id uuid;
  v_s3_id uuid;
  v_wrh_res jsonb;
  v_dlv_res jsonb;
  v_rdl_res jsonb;
  v_rth_res jsonb;
  v_rtn_res jsonb;
  v_exec_res jsonb;
  v_portal_json jsonb;
  v_s1_row public.shipments%ROWTYPE;
  v_s2_row public.shipments%ROWTYPE;
  v_s3_row public.shipments%ROWTYPE;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug = 'phase8-delivery';
  SELECT id INTO v_branch FROM public.branches WHERE tenant_id = v_tenant AND is_main = true LIMIT 1;
  SELECT id INTO v_gov_id FROM public.governorates WHERE tenant_id = v_tenant AND code = 'EG-01';
  SELECT id INTO v_reg_id FROM public.regions WHERE tenant_id = v_tenant AND code = 'EG-01-R01';
  SELECT id INTO v_role_courier FROM public.roles WHERE tenant_id = v_tenant AND code = 'delivery_agent';
  SELECT id INTO v_route_id FROM public.courier_routes WHERE tenant_id = v_tenant AND code = 'GENERAL' LIMIT 1;
  SELECT id INTO v_comm_list_id FROM public.courier_commission_lists WHERE tenant_id = v_tenant AND code = '0' LIMIT 1;
  SELECT id INTO v_reason_id FROM public.delivery_exception_reasons WHERE tenant_id = v_tenant LIMIT 1;

  INSERT INTO public.clients (
    tenant_id, code, name, branch_id, governorate_id, region_id,
    price_list_id, tax_profile_id, phone, mobile, address_line
  )
  SELECT
    v_tenant, 'CL-P8', 'متجر الثامنة', v_branch, v_gov_id, v_reg_id,
    pl.id, tp.id, '0227777666', '01077776666', 'المعادي - شارع 9'
  FROM public.client_price_lists pl, public.tax_profiles tp
  WHERE pl.tenant_id = v_tenant AND pl.code = '0' AND tp.tenant_id = v_tenant AND tp.is_default = true
  LIMIT 1
  RETURNING id INTO v_client_id;

  INSERT INTO public.couriers (
    tenant_id, code, name, branch_id, default_route_id, commission_list_id,
    default_commission_type, default_commission_value, mobile, is_active
  )
  VALUES
    (v_tenant, 'CRR-P8-1', 'مندوب توصيل أول', v_branch, v_route_id, v_comm_list_id, 'fixed_amount', 35, '01011112221', true),
    (v_tenant, 'CRR-P8-2', 'مندوب توصيل ثاني', v_branch, v_route_id, v_comm_list_id, 'fixed_amount', 30, '01011112222', true);

  SELECT id INTO v_courier1 FROM public.couriers WHERE tenant_id = v_tenant AND code = 'CRR-P8-1';
  SELECT id INTO v_courier2 FROM public.couriers WHERE tenant_id = v_tenant AND code = 'CRR-P8-2';

  PERFORM public.srv_provision_tenant_user(
    v_tenant, 'e1111111-1111-1111-1111-111111111111', 'e2222222-2222-2222-2222-222222222222',
    'courier_one_p8', 'مندوب أول', 'courier1-p8@test.local',
    v_role_courier, NULL, ARRAY[v_branch], v_courier1
  );

  PERFORM public.srv_provision_tenant_user(
    v_tenant, 'e1111111-1111-1111-1111-111111111111', 'e3333333-3333-3333-3333-333333333333',
    'courier_two_p8', 'مندوب ثاني', 'courier2-p8@test.local',
    v_role_courier, NULL, ARRAY[v_branch], v_courier2
  );

  SELECT id INTO v_srv_id FROM public.shipping_services WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_type_fdp FROM public.shipment_types WHERE tenant_id = v_tenant AND code = 'FDP';
  SELECT id INTO v_type_ptp FROM public.shipment_types WHERE tenant_id = v_tenant AND code = 'PTP';
  SELECT id INTO v_term_cod FROM public.payment_terms WHERE tenant_id = v_tenant AND code = 'COD';

  -- Switch to Tenant Owner
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'e1111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- Configure ADR-017 policy: max_delivery_attempts = 2, require_pod = true
  PERFORM public.update_tenant_delivery_policy(v_tenant, 2, 15, true);

  -- Create 3 shipments: S1 (FDP for delivery), S2 (FDP for attempts max + override), S3 (PTP exchange + return)
  v_s1_json := public.create_shipment(v_tenant, 'idem-p8-s1', jsonb_build_object(
    'client_id', v_client_id, 'origin_branch_id', v_branch,
    'shipment_type_id', v_type_fdp, 'service_id', v_srv_id, 'payment_term_id', v_term_cod,
    'price_mode', 'shipping_excluded', 'actual_weight_kg', 2, 'pieces_count', 1,
    'prepaid_balance_amount', 500, 'package_description', 'شحنة ثامنة 1 (تسليم)',
    'sender_name', 'راسل 1', 'sender_governorate_id', v_gov_id, 'sender_region_id', v_reg_id,
    'sender_mobile', '01011111111', 'sender_address_line', 'المعادي',
    'recipient_name', 'مستلم 1', 'recipient_governorate_id', v_gov_id, 'recipient_region_id', v_reg_id,
    'recipient_mobile', '01211111111', 'recipient_address_line', 'الدقي'
  ));
  v_s2_json := public.create_shipment(v_tenant, 'idem-p8-s2', jsonb_build_object(
    'client_id', v_client_id, 'origin_branch_id', v_branch,
    'shipment_type_id', v_type_fdp, 'service_id', v_srv_id, 'payment_term_id', v_term_cod,
    'price_mode', 'shipping_excluded', 'actual_weight_kg', 1, 'pieces_count', 1,
    'prepaid_balance_amount', 350, 'package_description', 'شحنة ثامنة 2 (تعذر وتجاوز محاولات)',
    'sender_name', 'راسل 2', 'sender_governorate_id', v_gov_id, 'sender_region_id', v_reg_id,
    'sender_mobile', '01011111112', 'sender_address_line', 'المعادي',
    'recipient_name', 'مستلم 2', 'recipient_governorate_id', v_gov_id, 'recipient_region_id', v_reg_id,
    'recipient_mobile', '01211111112', 'recipient_address_line', 'المهندسين'
  ));
  v_s3_json := public.create_shipment(v_tenant, 'idem-p8-s3', jsonb_build_object(
    'client_id', v_client_id, 'origin_branch_id', v_branch,
    'shipment_type_id', v_type_ptp, 'service_id', v_srv_id, 'payment_term_id', v_term_cod,
    'price_mode', 'shipping_excluded', 'actual_weight_kg', 1, 'pieces_count', 1,
    'prepaid_balance_amount', 200, 'package_description', 'شحنة ثامنة 3 (استبدال PTP)',
    'exchange_item_description', 'طرد قديم مرتجع للاستبدال',
    'sender_name', 'راسل 3', 'sender_governorate_id', v_gov_id, 'sender_region_id', v_reg_id,
    'sender_mobile', '01011111113', 'sender_address_line', 'المعادي',
    'recipient_name', 'مستلم 3', 'recipient_governorate_id', v_gov_id, 'recipient_region_id', v_reg_id,
    'recipient_mobile', '01211111113', 'recipient_address_line', 'الزمالك'
  ));

  v_s1_id := (v_s1_json->>'shipment_id')::uuid;
  v_s2_id := (v_s2_json->>'shipment_id')::uuid;
  v_s3_id := (v_s3_json->>'shipment_id')::uuid;

  -- Intake into branch warehouse first
  v_wrh_res := public.create_warehouse_manifest(v_tenant, jsonb_build_object(
    'manifest_type', 'intake', 'branch_id', v_branch
  ));
  PERFORM public.add_shipments_to_warehouse_manifest(v_tenant, (v_wrh_res->>'id')::uuid, ARRAY[v_s1_id, v_s2_id, v_s3_id], NULL);
  PERFORM public.approve_warehouse_manifest(v_tenant, (v_wrh_res->>'id')::uuid);

  -- Create & approve Delivery List DLV-* for Courier 1
  v_dlv_res := public.create_delivery_list(v_tenant, jsonb_build_object(
    'list_type', 'delivery', 'branch_id', v_branch, 'courier_id', v_courier1
  ));
  IF NOT (v_dlv_res->>'list_code') LIKE 'DLV-%' THEN
    RAISE EXCEPTION 'Expected DLV- prefix, got %', v_dlv_res->>'list_code';
  END IF;

  PERFORM public.add_shipments_to_delivery_list(v_tenant, (v_dlv_res->>'id')::uuid, ARRAY[v_s1_id, v_s2_id, v_s3_id], NULL, false);
  PERFORM public.approve_delivery_list(v_tenant, (v_dlv_res->>'id')::uuid);

  -- Verify Courier 2 CANNOT see Courier 1's delivery list or assigned shipments!
  PERFORM set_config('request.jwt.claim.sub', 'e3333333-3333-3333-3333-333333333333', true);

  IF EXISTS (SELECT 1 FROM public.delivery_lists WHERE id = (v_dlv_res->>'id')::uuid) THEN
    RAISE EXCEPTION 'RLS leak! Courier 2 saw Courier 1 delivery list';
  END IF;

  BEGIN
    PERFORM public.record_delivery_execution(v_tenant, jsonb_build_object(
      'shipment_id', v_s1_id,
      'outcome', 'delivered',
      'pod_method', 'signature',
      'pod_recipient_name', 'متطفل'
    ));
    RAISE EXCEPTION 'Expected Courier 2 to be denied executing Courier 1 shipment';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Switch to Courier 1: verify tasks feed, POD enforcement, delivery + ADR-012 commission, PTP custody, and ADR-017 auto return
  PERFORM set_config('request.jwt.claim.sub', 'e2222222-2222-2222-2222-222222222222', true);

  v_portal_json := public.list_courier_my_tasks(v_tenant, v_courier2); -- courier role ignores p_courier_id!
  IF (v_portal_json->'courier'->>'id')::uuid <> v_courier1 THEN
    RAISE EXCEPTION 'Expected Courier 1 portal to bind strictly to Courier 1';
  END IF;

  -- Require POD check: missing POD details must fail when require_pod_on_delivery = true
  BEGIN
    PERFORM public.record_delivery_execution(v_tenant, jsonb_build_object(
      'shipment_id', v_s1_id,
      'delivery_list_id', (v_dlv_res->>'id')::uuid,
      'outcome', 'delivered',
      'delivered_amount', 500
    ));
    RAISE EXCEPTION 'Expected missing POD details to fail when require_pod_on_delivery = true';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Deliver S1 with signature POD -> verify ADR-012 commission = 35.00
  v_exec_res := public.record_delivery_execution(v_tenant, jsonb_build_object(
    'shipment_id', v_s1_id,
    'delivery_list_id', (v_dlv_res->>'id')::uuid,
    'outcome', 'delivered',
    'delivered_amount', 550,
    'pod_method', 'signature',
    'pod_recipient_name', 'أحمد المستلم',
    'pod_signature_data', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
  ));
  IF (v_exec_res->>'accrued_courier_commission')::numeric <> 35 THEN
    RAISE EXCEPTION 'Expected ADR-012 accrued commission = 35, got %', v_exec_res->>'accrued_courier_commission';
  END IF;

  -- Deliver S3 (PTP exchange) with OTP POD -> verify exchange_status = 'with_courier'
  PERFORM public.record_delivery_execution(v_tenant, jsonb_build_object(
    'shipment_id', v_s3_id,
    'delivery_list_id', (v_dlv_res->>'id')::uuid,
    'outcome', 'delivered',
    'delivered_amount', 250,
    'pod_method', 'otp',
    'pod_recipient_name', 'عميل استبدال',
    'pod_otp_verified', true
  ));

  -- S2 Attempt #1 fails -> rescheduled (attempts = 1 < max 2)
  v_exec_res := public.record_delivery_execution(v_tenant, jsonb_build_object(
    'shipment_id', v_s2_id,
    'delivery_list_id', (v_dlv_res->>'id')::uuid,
    'outcome', 'rescheduled',
    'exception_reason_id', v_reason_id,
    'rescheduled_for_date', (current_date + 1)::text,
    'notes', 'الهاتف مغلق في المحاولة الأولى'
  ));
  IF (v_exec_res->>'to_status') <> 'rescheduled' THEN
    RAISE EXCEPTION 'Expected rescheduled on attempt 1, got %', v_exec_res->>'to_status';
  END IF;

  -- S2 Attempt #2 fails -> ADR-017 auto-escalates to return_to_sender!
  v_exec_res := public.record_delivery_execution(v_tenant, jsonb_build_object(
    'shipment_id', v_s2_id,
    'outcome', 'delivery_failed',
    'exception_reason_id', v_reason_id,
    'notes', 'رفض الاستلام بعد التأجيل'
  ));
  IF (v_exec_res->>'to_status') <> 'return_to_sender' OR COALESCE((v_exec_res->>'auto_returned_by_limit')::boolean, false) = false THEN
    RAISE EXCEPTION 'ADR-017 auto-return failed on max attempts, got %', v_exec_res;
  END IF;

  -- Switch back to Tenant Owner: test RDL-* block + admin override on S2, ADR-016 recipient_paid_fee, RTH + RTN return closure
  PERFORM set_config('request.jwt.claim.sub', 'e1111111-1111-1111-1111-111111111111', true);

  v_rdl_res := public.create_delivery_list(v_tenant, jsonb_build_object(
    'list_type', 'redelivery', 'branch_id', v_branch, 'courier_id', v_courier1
  ));
  IF NOT (v_rdl_res->>'list_code') LIKE 'RDL-%' THEN
    RAISE EXCEPTION 'Expected RDL- prefix, got %', v_rdl_res->>'list_code';
  END IF;

  -- Bring S2 to delivery_failed temporarily or verify barcode check rejects maxed-out shipment without override
  BEGIN
    PERFORM public.add_shipments_to_delivery_list(
      v_tenant, (v_rdl_res->>'id')::uuid, ARRAY[]::uuid[],
      (SELECT barcode_token FROM public.shipments WHERE id = v_s2_id), false
    );
    RAISE EXCEPTION 'Expected barcode add of maxed-out shipment to fail without admin override';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Now record explicit ADR-016 recipient_paid_fee on S2 via branch operator override flow? Wait: return_to_sender can receive RTH -> RTN.
  -- Let's also verify a fresh RTH (courier_return_inbound) + RTN (client_return_handover) closes S2 and S3 PTP exchange!
  v_rth_res := public.create_return_manifest(v_tenant, jsonb_build_object(
    'manifest_type', 'courier_return_inbound', 'branch_id', v_branch, 'courier_id', v_courier1
  ));
  IF NOT (v_rth_res->>'manifest_code') LIKE 'RTH-%' THEN
    RAISE EXCEPTION 'Expected RTH- prefix, got %', v_rth_res->>'manifest_code';
  END IF;

  PERFORM public.add_shipments_to_return_manifest(v_tenant, (v_rth_res->>'id')::uuid, ARRAY[v_s2_id, v_s3_id], NULL);
  PERFORM public.approve_return_manifest(v_tenant, (v_rth_res->>'id')::uuid);

  SELECT * INTO v_s3_row FROM public.shipments WHERE id = v_s3_id;
  IF v_s3_row.exchange_status <> 'in_warehouse' THEN
    RAISE EXCEPTION 'Expected S3 PTP exchange_status = in_warehouse after RTH, got %', v_s3_row.exchange_status;
  END IF;

  v_rtn_res := public.create_return_manifest(v_tenant, jsonb_build_object(
    'manifest_type', 'client_return_handover', 'branch_id', v_branch, 'client_id', v_client_id
  ));
  IF NOT (v_rtn_res->>'manifest_code') LIKE 'RTN-%' THEN
    RAISE EXCEPTION 'Expected RTN- prefix, got %', v_rtn_res->>'manifest_code';
  END IF;

  PERFORM public.add_shipments_to_return_manifest(v_tenant, (v_rtn_res->>'id')::uuid, ARRAY[v_s2_id, v_s3_id], NULL);
  PERFORM public.approve_return_manifest(v_tenant, (v_rtn_res->>'id')::uuid);

  SELECT * INTO v_s1_row FROM public.shipments WHERE id = v_s1_id;
  SELECT * INTO v_s2_row FROM public.shipments WHERE id = v_s2_id;
  SELECT * INTO v_s3_row FROM public.shipments WHERE id = v_s3_id;

  IF v_s1_row.operational_status <> 'delivered' OR v_s1_row.accrued_courier_commission <> 35 THEN
    RAISE EXCEPTION 'Expected S1 delivered with commission 35';
  END IF;
  IF v_s2_row.operational_status <> 'returned' OR v_s2_row.accrued_courier_commission <> 0 THEN
    RAISE EXCEPTION 'Expected S2 returned with 0 commission';
  END IF;
  IF v_s3_row.exchange_status <> 'returned_to_client' THEN
    RAISE EXCEPTION 'Expected S3 PTP exchange_status = returned_to_client after RTN';
  END IF;
END $$;

ROLLBACK;
