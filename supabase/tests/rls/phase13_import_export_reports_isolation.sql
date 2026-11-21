-- ============================================================================
-- RLS & Workflow Verification Script for Phase 13
-- Bulk Shipment Import Dry-Run, Idempotent Commit, Export Audit &
-- Multi-Tenant / Client-Bound Executive Report Isolation
-- Run inside a transaction (ROLLBACK at the end) in Supabase SQL Editor.
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('e1111111-1111-1111-1111-111111111111', 'owner-p13@test.local'),
  ('e2222222-2222-2222-2222-222222222222', 'client-a1-p13@test.local'),
  ('e3333333-3333-3333-3333-333333333333', 'owner-other-p13@test.local'),
  ('e9999999-9999-9999-9999-999999999999', 'superadmin-p13@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES ('e9999999-9999-9999-9999-999999999999', 'Super Admin P13', true, true)
ON CONFLICT (id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase13-a',
  'e9999999-9999-9999-9999-999999999999',
  'TEN_P13_A',
  'phase13-alpha',
  'شركة المرحلة الثالثة عشرة أ',
  'e1111111-1111-1111-1111-111111111111',
  'admin_p13_a',
  'مالك شركة 13 أ',
  'owner-p13@test.local',
  'ow***@test.local'
);

SELECT * FROM app_private.onboard_tenant(
  'idem-phase13-b',
  'e9999999-9999-9999-9999-999999999999',
  'TEN_P13_B',
  'phase13-beta',
  'شركة المرحلة الثالثة عشرة ب',
  'e3333333-3333-3333-3333-333333333333',
  'admin_p13_b',
  'مالك شركة 13 ب',
  'owner-other-p13@test.local',
  'ob***@test.local'
);

DO $$
DECLARE
  v_tenant_a uuid;
  v_tenant_b uuid;
  v_branch_a uuid;
  v_gov_a uuid;
  v_reg_a uuid;
  v_price_list_a uuid;
  v_tax_a uuid;
  v_service_a uuid;
  v_shp_type_a uuid;
  v_term_cod_a uuid;
  v_role_client_a uuid;
  v_client_a uuid;
  v_gov_name text;
  v_reg_name text;
  v_srv_code text;

  v_dry_res jsonb;
  v_commit_res1 jsonb;
  v_commit_res2 jsonb;
  v_report_a jsonb;
  v_report_client jsonb;
  v_export_res jsonb;
  v_cross_count integer;
BEGIN
  SELECT id INTO v_tenant_a FROM public.tenants WHERE slug = 'phase13-alpha';
  SELECT id INTO v_tenant_b FROM public.tenants WHERE slug = 'phase13-beta';
  SELECT id INTO v_branch_a FROM public.branches WHERE tenant_id = v_tenant_a AND is_main = true LIMIT 1;
  SELECT id, name INTO v_gov_a, v_gov_name FROM public.governorates WHERE tenant_id = v_tenant_a AND is_active = true LIMIT 1;
  SELECT id, name INTO v_reg_a, v_reg_name FROM public.regions WHERE tenant_id = v_tenant_a AND governorate_id = v_gov_a AND is_active = true LIMIT 1;
  SELECT id INTO v_price_list_a FROM public.client_price_lists WHERE tenant_id = v_tenant_a LIMIT 1;
  SELECT id INTO v_tax_a FROM public.tax_profiles WHERE tenant_id = v_tenant_a LIMIT 1;
  SELECT id, code INTO v_service_a, v_srv_code FROM public.shipping_services WHERE tenant_id = v_tenant_a LIMIT 1;
  SELECT id INTO v_shp_type_a FROM public.shipment_types WHERE tenant_id = v_tenant_a AND code = 'FDP' LIMIT 1;
  SELECT id INTO v_term_cod_a FROM public.payment_terms WHERE tenant_id = v_tenant_a AND code = 'COD' LIMIT 1;
  SELECT id INTO v_role_client_a FROM public.roles WHERE tenant_id = v_tenant_a AND code = 'client_owner' LIMIT 1;

  INSERT INTO public.clients (
    tenant_id, code, name, branch_id, governorate_id, region_id,
    price_list_id, tax_profile_id, default_payment_term_id, default_shipment_type_id,
    phone, mobile, address_line
  )
  VALUES (
    v_tenant_a, 'C-P13-01', 'متجر النخبة', v_branch_a, v_gov_a, v_reg_a,
    v_price_list_a, v_tax_a, v_term_cod_a, v_shp_type_a,
    '01099988877', '01099988877', 'القاهرة الجديدة'
  )
  RETURNING id INTO v_client_a;

  PERFORM public.srv_provision_tenant_user(
    v_tenant_a,
    'e1111111-1111-1111-1111-111111111111',
    'e2222222-2222-2222-2222-222222222222',
    'client_p13_a1',
    'تاجر النخبة',
    'client-a1-p13@test.local',
    v_role_client_a,
    v_client_a,
    ARRAY[]::uuid[],
    NULL
  );

  -- IMPORTANT: Drop superuser/BYPASSRLS privileges in SQL Editor by switching to `authenticated`
  SET LOCAL ROLE authenticated;
  IF current_user <> 'authenticated' THEN
    RAISE EXCEPTION 'Test harness error: expected role authenticated, got %', current_user;
  END IF;

  -- Simulate Tenant A Owner session
  PERFORM set_config('request.jwt.claim.sub', 'e1111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', 'e1111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

  -- 1. Dry-run with 1 valid row and 1 invalid row (missing recipient_mobile + invalid governorate)
  v_dry_res := public.run_shipment_import_batch(
    v_tenant_a,
    'SHIPMENTS_V1',
    'batch_test.csv',
    'batch-p13-dry-1',
    'dry_run',
    v_client_a,
    v_branch_a,
    jsonb_build_array(
      jsonb_build_object(
        'row_number', 1,
        'client_code', 'C-P13-01',
        'service_code', v_srv_code,
        'shipment_type_code', 'FDP',
        'payment_term_code', 'COD',
        'price_mode', 'no',
        'recipient_name', 'أحمد سالم',
        'recipient_mobile', '01012345678',
        'governorate', v_gov_name,
        'region', v_reg_name,
        'recipient_address', 'شارع التحرير رقم 5',
        'weight_kg', 2,
        'pieces_count', 1,
        'cod_amount', 350,
        'external_reference', 'EXT-P13-01'
      ),
      jsonb_build_object(
        'row_number', 2,
        'client_code', 'C-P13-01',
        'service_code', v_srv_code,
        'shipment_type_code', 'PTP',
        'payment_term_code', 'COD',
        'recipient_name', 'عميل ناقص',
        'recipient_mobile', '12',
        'governorate', 'محافظة_غير_موجودة',
        'region', v_reg_name,
        'recipient_address', 'عنوان',
        'weight_kg', 1,
        'pieces_count', 1,
        'cod_amount', 100
      )
    )
  );

  IF (v_dry_res->>'valid_rows')::integer <> 1 OR (v_dry_res->>'error_rows')::integer <> 1 THEN
    RAISE EXCEPTION 'Expected 1 valid and 1 error row in dry-run, got: %', v_dry_res;
  END IF;

  -- 2. Atomic Commit with clean row + Idempotent replay check
  v_commit_res1 := public.run_shipment_import_batch(
    v_tenant_a,
    'SHIPMENTS_V1',
    'batch_commit.csv',
    'batch-p13-commit-1',
    'commit',
    v_client_a,
    v_branch_a,
    jsonb_build_array(
      jsonb_build_object(
        'row_number', 1,
        'client_code', 'C-P13-01',
        'service_code', v_srv_code,
        'shipment_type_code', 'FDP',
        'payment_term_code', 'COD',
        'price_mode', 'no',
        'recipient_name', 'سارة محمد',
        'recipient_mobile', '01122334455',
        'governorate', v_gov_name,
        'region', v_reg_name,
        'recipient_address', 'شارع النصر 18',
        'weight_kg', 1.5,
        'pieces_count', 2,
        'cod_amount', 450,
        'external_reference', 'EXT-P13-COMMIT-1'
      )
    )
  );

  IF (v_commit_res1->>'status') <> 'completed' OR (v_commit_res1->>'created_shipments_count')::integer <> 1 THEN
    RAISE EXCEPTION 'Expected committed batch with 1 shipment, got: %', v_commit_res1;
  END IF;

  -- Replay same idempotency key must return already_existed = true and NOT duplicate shipment
  v_commit_res2 := public.run_shipment_import_batch(
    v_tenant_a,
    'SHIPMENTS_V1',
    'batch_commit.csv',
    'batch-p13-commit-1',
    'commit',
    v_client_a,
    v_branch_a,
    jsonb_build_array(
      jsonb_build_object(
        'row_number', 1,
        'client_code', 'C-P13-01',
        'service_code', v_srv_code,
        'shipment_type_code', 'FDP',
        'payment_term_code', 'COD',
        'recipient_name', 'سارة محمد',
        'recipient_mobile', '01122334455',
        'governorate', v_gov_name,
        'region', v_reg_name,
        'recipient_address', 'شارع النصر 18',
        'weight_kg', 1.5,
        'pieces_count', 2,
        'cod_amount', 450,
        'external_reference', 'EXT-P13-COMMIT-1'
      )
    )
  );

  IF COALESCE((v_commit_res2->>'already_existed')::boolean, false) <> true THEN
    RAISE EXCEPTION 'Expected idempotent replay on batch_idempotency_key, got: %', v_commit_res2;
  END IF;

  -- 3. Record export job & read executive report as Tenant A Owner
  v_export_res := public.record_export_job(
    v_tenant_a,
    'shipments_csv',
    'csv',
    jsonb_build_object('preset', 'all'),
    1
  );

  v_report_a := public.get_executive_operations_report(v_tenant_a, NULL, NULL, NULL, NULL);
  IF ((v_report_a->'kpis'->>'total_shipments')::integer) < 1 THEN
    RAISE EXCEPTION 'Expected >= 1 shipment in executive report, got: %', v_report_a;
  END IF;

  -- 4. Same-tenant Client A1 isolation: cannot see Owner A import_jobs/export_jobs & report hides by_courier
  PERFORM set_config('request.jwt.claim.sub', 'e2222222-2222-2222-2222-222222222222', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', 'e2222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

  SELECT COUNT(*) INTO v_cross_count FROM public.import_jobs WHERE tenant_id = v_tenant_a;
  IF v_cross_count <> 0 THEN
    RAISE EXCEPTION 'Client isolation failure: Client A1 read Owner A import_jobs (% rows)', v_cross_count;
  END IF;

  SELECT COUNT(*) INTO v_cross_count FROM public.export_jobs WHERE tenant_id = v_tenant_a;
  IF v_cross_count <> 0 THEN
    RAISE EXCEPTION 'Client isolation failure: Client A1 read Owner A export_jobs (% rows)', v_cross_count;
  END IF;

  v_report_client := public.get_executive_operations_report(v_tenant_a, NULL, NULL, NULL, NULL);
  IF jsonb_array_length(COALESCE(v_report_client->'by_courier', '[]'::jsonb)) <> 0 THEN
    RAISE EXCEPTION 'Client isolation failure: Client report exposed courier metrics';
  END IF;

  -- 5. Cross-tenant RLS isolation: Tenant B Owner must see 0 rows of Tenant A across all Phase 13 tables
  PERFORM set_config('request.jwt.claim.sub', 'e3333333-3333-3333-3333-333333333333', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', 'e3333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text, true);

  SELECT COUNT(*) INTO v_cross_count FROM public.import_templates WHERE tenant_id = v_tenant_a;
  IF v_cross_count <> 0 THEN
    RAISE EXCEPTION 'RLS isolation failure: Tenant B read Tenant A import_templates';
  END IF;

  SELECT COUNT(*) INTO v_cross_count FROM public.import_jobs WHERE tenant_id = v_tenant_a;
  IF v_cross_count <> 0 THEN
    RAISE EXCEPTION 'RLS isolation failure: Tenant B read Tenant A import_jobs';
  END IF;

  SELECT COUNT(*) INTO v_cross_count FROM public.import_job_rows WHERE tenant_id = v_tenant_a;
  IF v_cross_count <> 0 THEN
    RAISE EXCEPTION 'RLS isolation failure: Tenant B read Tenant A import_job_rows';
  END IF;

  SELECT COUNT(*) INTO v_cross_count FROM public.export_jobs WHERE tenant_id = v_tenant_a;
  IF v_cross_count <> 0 THEN
    RAISE EXCEPTION 'RLS isolation failure: Tenant B read Tenant A export_jobs';
  END IF;

  BEGIN
    PERFORM public.list_import_jobs(v_tenant_a);
    RAISE EXCEPTION 'RLS isolation failure: Tenant B called list_import_jobs for Tenant A';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    PERFORM public.get_executive_operations_report(v_tenant_a, NULL, NULL, NULL, NULL);
    RAISE EXCEPTION 'RLS isolation failure: Tenant B called get_executive_operations_report for Tenant A';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

ROLLBACK;
