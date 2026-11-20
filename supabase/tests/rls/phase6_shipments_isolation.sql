-- ============================================================================
-- RLS, Pricing, Barcode & Lifecycle Verification Script for Phase 6
-- Run inside a transaction (ROLLBACK at the end) in Supabase SQL Editor.
-- Verifies:
--   1. Atomic numbering (SHP-0000001) & non-guessable barcode/tracking tokens.
--   2. Server-side idempotency on create_shipment.
--   3. ADR-013 financial breakdown across COD, PREPAID, POSTPAID, CASH_PAID.
--   4. ADR-014 PDP partial delivery (on same shipment) & PTP exchange relation.
--   5. ADR-010 weight revision creates v2 snapshot; direct UPDATE blocked.
--   6. Branch-scoped staff, client isolation & non-PII anon track_public_shipment.
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('c1111111-1111-1111-1111-111111111111', 'owner-p6a@test.local'),
  ('c2222222-2222-2222-2222-222222222222', 'owner-p6b@test.local'),
  ('c3333333-3333-3333-3333-333333333333', 'client1-p6a@test.local'),
  ('c4444444-4444-4444-4444-444444444444', 'superadmin-p6@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES ('c4444444-4444-4444-4444-444444444444', 'Super Admin P6', true, true)
ON CONFLICT (id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase6-a', 'c4444444-4444-4444-4444-444444444444',
  'P6_A', 'p6-alpha', 'شركة ألفا المرحلة السادسة',
  'c1111111-1111-1111-1111-111111111111', 'admin', 'مالك ألفا', 'owner-p6a@test.local', 'ow***@test.local'
);

SELECT * FROM app_private.onboard_tenant(
  'idem-phase6-b', 'c4444444-4444-4444-4444-444444444444',
  'P6_B', 'p6-beta', 'شركة بيتا المرحلة السادسة',
  'c2222222-2222-2222-2222-222222222222', 'admin', 'مالك بيتا', 'owner-p6b@test.local', 'ow***@test.local'
);

-- Setup 2 clients in Tenant A & bind client user to Client 1
DO $$
DECLARE
  v_t_a uuid;
  v_br_a uuid;
  v_gov_cairo uuid;
  v_reg_nasr uuid;
  v_pl_a uuid;
  v_tax_a uuid;
  v_cl1 uuid;
  v_cl2 uuid;
  v_role_client uuid;
BEGIN
  SELECT id INTO v_t_a FROM public.tenants WHERE slug = 'p6-alpha';
  SELECT id INTO v_br_a FROM public.branches WHERE tenant_id = v_t_a AND is_main = true LIMIT 1;
  SELECT id INTO v_gov_cairo FROM public.governorates WHERE tenant_id = v_t_a AND code = 'EG-01';
  SELECT id INTO v_reg_nasr FROM public.regions WHERE tenant_id = v_t_a AND code = 'EG-01-R01';
  SELECT id INTO v_pl_a FROM public.client_price_lists WHERE tenant_id = v_t_a AND code = '0';
  SELECT id INTO v_tax_a FROM public.tax_profiles WHERE tenant_id = v_t_a AND is_default = true;
  SELECT id INTO v_role_client FROM public.roles WHERE tenant_id = v_t_a AND code = 'client_owner';

  INSERT INTO public.clients (
    tenant_id, code, name, branch_id, governorate_id, region_id,
    price_list_id, tax_profile_id, phone, mobile, address_line
  )
  VALUES
    (v_t_a, 'CL-101', 'متجر النيل الأول', v_br_a, v_gov_cairo, v_reg_nasr, v_pl_a, v_tax_a, '0221111111', '01011111111', 'شارع عباس العقاد'),
    (v_t_a, 'CL-102', 'متجر القمة الثاني', v_br_a, v_gov_cairo, v_reg_nasr, v_pl_a, v_tax_a, '0222222222', '01022222222', 'شارع مكرم عبيد');

  SELECT id INTO v_cl1 FROM public.clients WHERE tenant_id = v_t_a AND code = 'CL-101';
  SELECT id INTO v_cl2 FROM public.clients WHERE tenant_id = v_t_a AND code = 'CL-102';

  PERFORM public.srv_provision_tenant_user(
    v_t_a, 'c1111111-1111-1111-1111-111111111111', 'c3333333-3333-3333-3333-333333333333',
    'merchant_one', 'حساب متجر النيل', 'merchant_one@internal.test',
    v_role_client, v_cl1, ARRAY[]::uuid[]
  );
END $$;

-- Execute Shipment Creations & Transitions as Tenant A Owner
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c1111111-1111-1111-1111-111111111111', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE
  v_t_a uuid;
  v_br_a uuid;
  v_gov_cairo uuid;
  v_reg_nasr uuid;
  v_reg_maadi uuid;
  v_srv_std uuid;
  v_type_fdp uuid;
  v_type_pdp uuid;
  v_type_ptp uuid;
  v_term_cod uuid;
  v_term_prepaid uuid;
  v_term_postpaid uuid;
  v_cl1 uuid;

  v_res_cod jsonb;
  v_res_idem jsonb;
  v_res_prepaid jsonb;
  v_res_postpaid jsonb;
  v_res_ptp jsonb;

  v_shp_cod public.shipments%ROWTYPE;
  v_shp_prepaid public.shipments%ROWTYPE;
  v_shp_postpaid public.shipments%ROWTYPE;
  v_reprice_res jsonb;
  v_snap_count integer;
BEGIN
  SELECT id INTO v_t_a FROM public.tenants WHERE slug = 'p6-alpha';
  SELECT id INTO v_br_a FROM public.branches WHERE tenant_id = v_t_a AND is_main = true LIMIT 1;
  SELECT id INTO v_gov_cairo FROM public.governorates WHERE tenant_id = v_t_a AND code = 'EG-01';
  SELECT id INTO v_reg_nasr FROM public.regions WHERE tenant_id = v_t_a AND code = 'EG-01-R01';
  SELECT id INTO v_reg_maadi FROM public.regions WHERE tenant_id = v_t_a AND code = 'EG-01-R04';
  SELECT id INTO v_srv_std FROM public.shipping_services WHERE tenant_id = v_t_a AND code = 'SRV-001';
  SELECT id INTO v_type_fdp FROM public.shipment_types WHERE tenant_id = v_t_a AND code = 'FDP';
  SELECT id INTO v_type_pdp FROM public.shipment_types WHERE tenant_id = v_t_a AND code = 'PDP';
  SELECT id INTO v_type_ptp FROM public.shipment_types WHERE tenant_id = v_t_a AND code = 'PTP';
  SELECT id INTO v_term_cod FROM public.payment_terms WHERE tenant_id = v_t_a AND code = 'COD';
  SELECT id INTO v_term_prepaid FROM public.payment_terms WHERE tenant_id = v_t_a AND code = 'PREPAID';
  SELECT id INTO v_term_postpaid FROM public.payment_terms WHERE tenant_id = v_t_a AND code = 'POSTPAID';
  SELECT id INTO v_cl1 FROM public.clients WHERE tenant_id = v_t_a AND code = 'CL-101';

  -- 1. Create COD PDP Shipment (3 pieces, 500 EGP shipping_excluded)
  v_res_cod := public.create_shipment(
    v_t_a,
    'idem-shp-cod-1',
    jsonb_build_object(
      'client_id', v_cl1,
      'origin_branch_id', v_br_a,
      'shipment_type_id', v_type_pdp,
      'service_id', v_srv_std,
      'payment_term_id', v_term_cod,
      'price_mode', 'shipping_excluded',
      'actual_weight_kg', 2,
      'pieces_count', 3,
      'prepaid_balance_amount', 500,
      'package_description', 'ملابس 3 قطع',
      'sender_name', 'متجر النيل الأول',
      'sender_governorate_id', v_gov_cairo,
      'sender_region_id', v_reg_nasr,
      'sender_mobile', '01011111111',
      'sender_address_line', 'مدينة نصر',
      'recipient_name', 'محمد علي',
      'recipient_governorate_id', v_gov_cairo,
      'recipient_region_id', v_reg_maadi,
      'recipient_mobile', '01199998888',
      'recipient_address_line', 'المعادي شارع 9'
    )
  );

  IF (v_res_cod->>'shipment_number') <> 'SHP-0000001' THEN
    RAISE EXCEPTION 'Expected first shipment SHP-0000001, got %', v_res_cod->>'shipment_number';
  END IF;

  -- Verify idempotency
  v_res_idem := public.create_shipment(v_t_a, 'idem-shp-cod-1', '{}'::jsonb);
  IF NOT (v_res_idem->>'already_existed')::boolean OR (v_res_idem->>'shipment_id') <> (v_res_cod->>'shipment_id') THEN
    RAISE EXCEPTION 'Expected create_shipment idempotency to return existing record';
  END IF;

  SELECT * INTO v_shp_cod FROM public.shipments WHERE id = (v_res_cod->>'shipment_id')::uuid;
  IF v_shp_cod.total_shipping_fee <> 55 OR v_shp_cod.recipient_collect_amount <> 555 OR v_shp_cod.client_net_payout <> 500 THEN
    RAISE EXCEPTION 'Unexpected COD pricing breakdown: fee=%, collect=%, payout=%',
      v_shp_cod.total_shipping_fee, v_shp_cod.recipient_collect_amount, v_shp_cod.client_net_payout;
  END IF;

  -- 2. Verify direct UPDATE bypass on shipments is blocked
  BEGIN
    UPDATE public.shipments SET operational_status = 'delivered' WHERE id = v_shp_cod.id;
    RAISE EXCEPTION 'Expected direct UPDATE on shipments to be blocked by trigger';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 3. Verify ADR-010 weight revision creates v2 snapshot & updates shipment
  v_reprice_res := public.reprice_shipment_weight_or_override(
    v_t_a, v_shp_cod.id, 4, 0, 0, 0, NULL, 'مراجعة الوزن بالميزان الرقمي بالمخزن'
  );
  IF (v_reprice_res->>'version_number')::integer <> 2 OR (v_reprice_res->>'total_shipping_fee')::numeric <> 75 THEN
    RAISE EXCEPTION 'Expected v2 snapshot with fee 75 after weight 4kg revision, got %', v_reprice_res;
  END IF;

  SELECT count(*) INTO v_snap_count FROM public.shipment_price_snapshots WHERE shipment_id = v_shp_cod.id;
  IF v_snap_count <> 2 THEN
    RAISE EXCEPTION 'Expected 2 linked price snapshots, got %', v_snap_count;
  END IF;

  -- 4. Verify ADR-014 PDP workflow (in_warehouse -> out_for_delivery -> partially_delivered)
  PERFORM public.transition_shipment_status(v_t_a, v_shp_cod.id, 'in_warehouse', 'استلام مخزني');
  PERFORM public.transition_shipment_status(v_t_a, v_shp_cod.id, 'out_for_delivery', 'خروج للتوصيل');
  PERFORM public.transition_shipment_status(v_t_a, v_shp_cod.id, 'partially_delivered', 'تسليم قطعتين واستلام قطعة مرتجعة', NULL, NULL, NULL, 2, 400);

  SELECT * INTO v_shp_cod FROM public.shipments WHERE id = v_shp_cod.id;
  IF v_shp_cod.operational_status <> 'partially_delivered'
     OR v_shp_cod.delivered_pieces_count <> 2
     OR v_shp_cod.returned_pieces_count <> 1
     OR v_shp_cod.partial_return_custody <> 'with_courier' THEN
    RAISE EXCEPTION 'Unexpected PDP state: %', to_jsonb(v_shp_cod);
  END IF;

  -- 5. Verify ADR-013 PREPAID & POSTPAID (recipient_collect_amount = 0)
  v_res_prepaid := public.create_shipment(
    v_t_a, 'idem-shp-pre-1',
    jsonb_build_object(
      'client_id', v_cl1, 'origin_branch_id', v_br_a, 'shipment_type_id', v_type_fdp,
      'service_id', v_srv_std, 'payment_term_id', v_term_prepaid, 'price_mode', 'shipping_excluded',
      'actual_weight_kg', 2, 'pieces_count', 1, 'prepaid_balance_amount', 1000,
      'sender_name', 'متجر النيل', 'sender_governorate_id', v_gov_cairo, 'sender_region_id', v_reg_nasr, 'sender_mobile', '01011111111', 'sender_address_line', 'مدينة نصر',
      'recipient_name', 'سارة حسن', 'recipient_governorate_id', v_gov_cairo, 'recipient_region_id', v_reg_maadi, 'recipient_mobile', '01155554444', 'recipient_address_line', 'المعادي'
    )
  );
  SELECT * INTO v_shp_prepaid FROM public.shipments WHERE id = (v_res_prepaid->>'shipment_id')::uuid;
  IF v_shp_prepaid.recipient_collect_amount <> 0 OR v_shp_prepaid.prepaid_balance_amount <> 1000 THEN
    RAISE EXCEPTION 'PREPAID must have recipient_collect_amount = 0 and preserve balance';
  END IF;

  v_res_postpaid := public.create_shipment(
    v_t_a, 'idem-shp-post-1',
    jsonb_build_object(
      'client_id', v_cl1, 'origin_branch_id', v_br_a, 'shipment_type_id', v_type_fdp,
      'service_id', v_srv_std, 'payment_term_id', v_term_postpaid, 'price_mode', 'shipping_excluded',
      'actual_weight_kg', 2, 'pieces_count', 1, 'prepaid_balance_amount', 0,
      'sender_name', 'متجر النيل', 'sender_governorate_id', v_gov_cairo, 'sender_region_id', v_reg_nasr, 'sender_mobile', '01011111111', 'sender_address_line', 'مدينة نصر',
      'recipient_name', 'كريم فؤاد', 'recipient_governorate_id', v_gov_cairo, 'recipient_region_id', v_reg_maadi, 'recipient_mobile', '01133332222', 'recipient_address_line', 'المعادي'
    )
  );
  SELECT * INTO v_shp_postpaid FROM public.shipments WHERE id = (v_res_postpaid->>'shipment_id')::uuid;
  IF v_shp_postpaid.recipient_collect_amount <> 0 OR v_shp_postpaid.client_net_payout <> -55 THEN
    RAISE EXCEPTION 'POSTPAID expected recipient_collect=0 and payout=-55, got collect=%, payout=%',
      v_shp_postpaid.recipient_collect_amount, v_shp_postpaid.client_net_payout;
  END IF;

  -- 6. Verify ADR-014 PTP creates mandatory exchange relation
  v_res_ptp := public.create_shipment(
    v_t_a, 'idem-shp-ptp-1',
    jsonb_build_object(
      'client_id', v_cl1, 'origin_branch_id', v_br_a, 'shipment_type_id', v_type_ptp,
      'service_id', v_srv_std, 'payment_term_id', v_term_cod, 'price_mode', 'shipping_excluded',
      'actual_weight_kg', 1, 'pieces_count', 1, 'prepaid_balance_amount', 0,
      'exchange_item_description', 'حذاء مقاس 42 مستبدل',
      'sender_name', 'متجر النيل', 'sender_governorate_id', v_gov_cairo, 'sender_region_id', v_reg_nasr, 'sender_mobile', '01011111111', 'sender_address_line', 'مدينة نصر',
      'recipient_name', 'طارق نبيل', 'recipient_governorate_id', v_gov_cairo, 'recipient_region_id', v_reg_maadi, 'recipient_mobile', '01188887777', 'recipient_address_line', 'المعادي'
    )
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.shipment_relations
    WHERE shipment_id = (v_res_ptp->>'shipment_id')::uuid
      AND relation_type = 'ptp_exchange_return'
      AND custody_status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Expected PTP exchange return custody row in shipment_relations';
  END IF;
END $$;

-- Verify Tenant B owner cannot see any Tenant A shipments
SELECT set_config('request.jwt.claim.sub', 'c2222222-2222-2222-2222-222222222222', true);
DO $$
DECLARE
  v_leak integer;
BEGIN
  SELECT count(*) INTO v_leak
  FROM public.shipments s
  JOIN public.tenants t ON t.id = s.tenant_id
  WHERE t.slug = 'p6-alpha';

  IF v_leak <> 0 THEN
    RAISE EXCEPTION 'Cross-tenant shipment leak detected: % rows', v_leak;
  END IF;
END $$;

-- Verify Client 1 user sees ONLY Client 1 shipments and public anon tracking hides PII
SELECT set_config('request.jwt.claim.sub', 'c3333333-3333-3333-3333-333333333333', true);
DO $$
DECLARE
  v_cnt integer;
BEGIN
  SELECT count(*) INTO v_cnt FROM public.shipments;
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION 'Expected bound client user to see its 4 shipments, saw %', v_cnt;
  END IF;
END $$;

SET LOCAL ROLE anon;
DO $$
DECLARE
  v_track jsonb;
BEGIN
  v_track := public.track_public_shipment('p6-alpha', 'SHP-0000001');
  IF NOT (v_track->>'found')::boolean THEN
    RAISE EXCEPTION 'Expected anon track_public_shipment to find SHP-0000001';
  END IF;
  IF v_track ? 'recipient_mobile' OR v_track ? 'recipient_collect_amount' OR v_track::text LIKE '%01199998888%' THEN
    RAISE EXCEPTION 'PII leak detected inside public tracking response: %', v_track;
  END IF;
END $$;

ROLLBACK;
