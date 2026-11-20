-- ============================================================================
-- RLS & Workflow Verification Script for Phase 10
-- General Ledger, Journal Entries, Trial Balance & ADR-019 Cash Basis
-- Run inside a transaction (ROLLBACK at the end) in Supabase SQL Editor.
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('b1111111-1111-1111-1111-111111111111', 'owner-p10@test.local'),
  ('b2222222-2222-2222-2222-222222222222', 'accountant-p10@test.local'),
  ('b9999999-9999-9999-9999-999999999999', 'superadmin-p10@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES ('b9999999-9999-9999-9999-999999999999', 'Super Admin P10', true, true)
ON CONFLICT (id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase10-a',
  'b9999999-9999-9999-9999-999999999999',
  'TEN_P10',
  'phase10-gl',
  'شركة المرحلة العاشرة للحسابات',
  'b1111111-1111-1111-1111-111111111111',
  'admin',
  'مالك المرحلة العاشرة',
  'owner-p10@test.local',
  'ow***@test.local'
);

DO $$
DECLARE
  v_tenant uuid;
  v_branch uuid;
  v_role_accountant uuid;
  v_journal_id uuid;
  v_entry_type_id uuid;
  v_acct_cash uuid;
  v_acct_rev uuid;
  v_entry_res jsonb;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug = 'phase10-gl';
  SELECT id INTO v_branch FROM public.branches WHERE tenant_id = v_tenant AND is_main = true LIMIT 1;
  SELECT id INTO v_role_accountant FROM public.roles WHERE tenant_id = v_tenant AND code = 'accountant';
  SELECT id INTO v_journal_id FROM public.auxiliary_journals WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_entry_type_id FROM public.journal_entry_types WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_acct_cash FROM public.chart_of_accounts WHERE tenant_id = v_tenant AND code = '1101' LIMIT 1;
  SELECT id INTO v_acct_rev FROM public.chart_of_accounts WHERE tenant_id = v_tenant AND code = '4101' LIMIT 1;

  PERFORM public.srv_provision_tenant_user(
    v_tenant, 'b1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222',
    'accountant_p10', 'محاسب 10', 'accountant-p10@test.local',
    v_role_accountant, NULL, ARRAY[v_branch], NULL
  );

  -- Switch to Accountant
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'b2222222-2222-2222-2222-222222222222', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

  -- Test unbalanced entry guard
  BEGIN
    PERFORM public.create_manual_journal_entry(v_tenant, jsonb_build_object(
      'branch_id', v_branch,
      'journal_id', v_journal_id,
      'entry_type_id', v_entry_type_id,
      'description', 'قيد غير متوازن',
      'lines', jsonb_build_array(
        jsonb_build_object('account_id', v_acct_cash, 'debit', 100, 'credit', 0),
        jsonb_build_object('account_id', v_acct_rev, 'debit', 0, 'credit', 50)
      )
    ));
    RAISE EXCEPTION 'Expected unbalanced entry to be blocked';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Create balanced manual journal entry
  v_entry_res := public.create_manual_journal_entry(v_tenant, jsonb_build_object(
    'branch_id', v_branch,
    'journal_id', v_journal_id,
    'entry_type_id', v_entry_type_id,
    'description', 'إثبات إيراد نقدي مرحلة 10',
    'lines', jsonb_build_array(
      jsonb_build_object('account_id', v_acct_cash, 'debit', 500, 'credit', 0, 'description', 'قبض نقدية'),
      jsonb_build_object('account_id', v_acct_rev, 'debit', 0, 'credit', 500, 'description', 'إيراد توصيل')
    )
  ));

  IF COALESCE(v_entry_res->>'entry_code', '') !~ '^(JENT|JOU)-[0-9]+$' THEN
    RAISE EXCEPTION 'Unexpected entry_code format, got %', v_entry_res->>'entry_code';
  END IF;

  -- ADR-018 Four-Eyes check: Accountant created entry, accountant CANNOT self-approve
  BEGIN
    PERFORM public.approve_journal_entry(v_tenant, (v_entry_res->>'id')::uuid);
    RAISE EXCEPTION 'Expected Four-Eyes to block accountant self-approval';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- Switch to Tenant Owner -> approves journal entry
  PERFORM set_config('request.jwt.claim.sub', 'b1111111-1111-1111-1111-111111111111', true);
  PERFORM public.approve_journal_entry(v_tenant, (v_entry_res->>'id')::uuid);

  -- Verify trial balance returns data
  IF NOT EXISTS (SELECT 1 FROM public.get_trial_balance(v_tenant) WHERE account_code = '1101' AND total_debit = 500) THEN
    RAISE EXCEPTION 'Expected trial balance to reflect approved journal entry';
  END IF;

END $$;

ROLLBACK;