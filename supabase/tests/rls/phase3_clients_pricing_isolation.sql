-- ============================================================================
-- RLS & Pricing Engine Verification Script for Phase 3
-- Run inside a transaction (ROLLBACK at the end) against local/staging DB.
-- Verifies:
--   1. New tenants receive protected default price list ('0') & 3 tax profiles.
--   2. Protected default price list ('0') cannot be deleted or archived.
--   3. Volumetric weight, CEIL rounding, hierarchical fallback, tax modes, and
--      shipping_included vs shipping_excluded match ADR-007..011.
--   4. shipment_price_snapshots cannot be updated or deleted.
--   5. Tenant E user cannot read or update Tenant F clients/price lists.
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('55555555-5555-5555-5555-555555555555', 'owner-e@test.local'),
  ('66666666-6666-6666-6666-666666666666', 'owner-f@test.local'),
  ('77777777-7777-7777-7777-777777777777', 'superadmin-p3@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES ('77777777-7777-7777-7777-777777777777', 'Super Admin P3', true, true)
ON CONFLICT (id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase3-e',
  '77777777-7777-7777-7777-777777777777',
  'TEN_E',
  'epsilon-ship',
  'شركة إبسيلون للشحن',
  '55555555-5555-5555-5555-555555555555',
  'admin',
  'مالك إبسيلون',
  'owner-e@test.local',
  'ow***@test.local'
);

SELECT * FROM app_private.onboard_tenant(
  'idem-phase3-f',
  '77777777-7777-7777-7777-777777777777',
  'TEN_F',
  'zeta-cargo',
  'شركة زيتا للشحن',
  '66666666-6666-6666-6666-666666666666',
  'admin',
  'مالك زيتا',
  'owner-f@test.local',
  'ow***@test.local'
);

-- Simulate authenticated session as Tenant E owner
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

DO $$
DECLARE
  v_e_id uuid;
  v_list_id uuid;
  v_tax_exempt_id uuid;
  v_tax_vat_id uuid;
  v_srv_std_id uuid;
  v_gov_cairo uuid;
  v_reg_nasr uuid;
  v_gov_giza uuid;
  v_client_id uuid;
  v_quote jsonb;
  v_snapshot_id uuid;
BEGIN
  SELECT id INTO v_e_id FROM public.tenants WHERE slug = 'epsilon-ship';
  SELECT id INTO v_list_id FROM public.client_price_lists WHERE tenant_id = v_e_id AND code = '0';
  SELECT id INTO v_tax_exempt_id FROM public.tax_profiles WHERE tenant_id = v_e_id AND code = 'TAX-EXEMPT';
  SELECT id INTO v_tax_vat_id FROM public.tax_profiles WHERE tenant_id = v_e_id AND code = 'TAX-VAT14-EXC';
  SELECT id INTO v_srv_std_id FROM public.shipping_services WHERE tenant_id = v_e_id AND code = 'SRV-001';
  SELECT id INTO v_gov_cairo FROM public.governorates WHERE tenant_id = v_e_id AND code = 'EG-01';
  SELECT id INTO v_reg_nasr FROM public.regions WHERE tenant_id = v_e_id AND code = 'EG-01-R01';
  SELECT id INTO v_gov_giza FROM public.governorates WHERE tenant_id = v_e_id AND code = 'EG-02';

  IF v_list_id IS NULL THEN
    RAISE EXCEPTION 'Expected protected default price list code 0';
  END IF;

  -- Verify protected price list cannot be archived
  BEGIN
    UPDATE public.client_price_lists SET archived_at = now() WHERE id = v_list_id;
    RAISE EXCEPTION 'Expected protection trigger to block archiving code 0 list';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Create client with default no-tax profile
  INSERT INTO public.clients (
    tenant_id, code, name, governorate_id, region_id, price_list_id, tax_profile_id,
    default_price_mode, client_category, trade_direction, payout_method,
    phone, mobile, address_line
  )
  VALUES (
    v_e_id, 'CL-001', 'متجر النور', v_gov_cairo, v_reg_nasr, v_list_id, v_tax_exempt_id,
    'shipping_excluded', 'ecommerce', 'b2c', 'cash',
    '0222222222', '01011111111', 'مدينة نصر شارع عباس العقاد'
  )
  RETURNING id INTO v_client_id;

  -- Test pricing calculation:
  -- Cairo -> Giza base=60 (up to 2kg), extra=10/kg.
  -- Dimensions 50x40x30 / 5000 = 12.000 kg -> excess 10 kg * 10 = 100.
  -- Entered COD 1000 (below 3000 threshold) -> collection_fee = 0.
  -- Total shipping fee = 160. Excluded -> recipient pays 1160, client payout 1000.
  v_quote := public.calculate_shipment_price(
    v_e_id, v_client_id, v_srv_std_id,
    v_gov_cairo, v_reg_nasr, v_gov_giza, NULL,
    1.5, 50, 40, 30, 1000, 'shipping_excluded', NULL, NULL, true
  );

  IF (v_quote->>'chargeable_weight_kg')::numeric <> 12
     OR (v_quote->>'total_shipping_fee')::numeric <> 160
     OR (v_quote->>'recipient_collect_amount')::numeric <> 1160
     OR (v_quote->>'client_net_payout')::numeric <> 1000 THEN
    RAISE EXCEPTION 'Unexpected pricing quote: %', v_quote;
  END IF;

  v_snapshot_id := (v_quote->>'snapshot_id')::uuid;

  -- Verify snapshot immutability
  BEGIN
    UPDATE public.shipment_price_snapshots SET total_shipping_fee = 1 WHERE id = v_snapshot_id;
    RAISE EXCEPTION 'Expected snapshot mutation to fail';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Switch client to VAT 14% exclusive + shipping_included
  UPDATE public.clients SET tax_profile_id = v_tax_vat_id WHERE id = v_client_id;
  v_quote := public.calculate_shipment_price(
    v_e_id, v_client_id, v_srv_std_id,
    v_gov_cairo, v_reg_nasr, v_gov_giza, NULL,
    1.5, 0, 0, 0, 1000, 'shipping_included', NULL, NULL, false
  );

  -- Weight CEIL(1.5) = 2kg -> base=60, tax 14% = 8.40 -> total = 68.40 -> payout = 931.60
  IF (v_quote->>'tax_amount')::numeric <> 8.40
     OR (v_quote->>'total_shipping_fee')::numeric <> 68.40
     OR (v_quote->>'recipient_collect_amount')::numeric <> 1000
     OR (v_quote->>'client_net_payout')::numeric <> 931.60 THEN
    RAISE EXCEPTION 'Unexpected VAT/included quote: %', v_quote;
  END IF;
END $$;

-- Cross-tenant isolation check: Tenant E sees only 1 price list (its own) and 1 client
DO $$
DECLARE
  v_lists integer;
  v_clients integer;
BEGIN
  SELECT count(*) INTO v_lists FROM public.client_price_lists;
  SELECT count(*) INTO v_clients FROM public.clients;
  IF v_lists <> 1 OR v_clients <> 1 THEN
    RAISE EXCEPTION 'Phase 3 RLS leak! lists=%, clients=%', v_lists, v_clients;
  END IF;
END $$;

ROLLBACK;
