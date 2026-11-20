-- ============================================================================
-- Migration 0011: Phase 10 - General Ledger, Journal Entries & Financial Reports
-- ============================================================================
-- Implements approved decisions:
-- - ADR-019: Cash Basis accounting recognized upon actual cash collection / payment
--   in cashboxes (COL, RCV, PAY, CST, CMP).
-- - ADR-018: Four-Eyes Principle on journal entry approvals + high value threshold.
-- ============================================================================

GRANT USAGE ON SCHEMA app_private TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- 1. Journal Entries Header & Lines Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_code text NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  journal_id uuid REFERENCES public.auxiliary_journals(id) ON DELETE SET NULL,
  entry_type_id uuid REFERENCES public.journal_entry_types(id) ON DELETE SET NULL,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  reference_type text, -- 'courier_collection', 'client_settlement', 'commission_payout', 'cashbox_voucher', 'manual'
  reference_id uuid,
  reference_code text,
  description text NOT NULL,
  total_debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_debit >= 0),
  total_credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_credit >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
  notes text,
  approved_at timestamptz,
  approved_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id),
  CONSTRAINT unq_tenant_entry_code UNIQUE (tenant_id, entry_code)
);

CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.chart_of_accounts(id) ON DELETE RESTRICT,
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  debit numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_line_debit_or_credit CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0))
);

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entry_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_journal_entries ON public.journal_entries
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE POLICY tenant_isolation_journal_entry_lines ON public.journal_entry_lines
  FOR ALL USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_memberships
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- ----------------------------------------------------------------------------
-- 2. Numbering sequence for JENT (Journal Entries)
-- ----------------------------------------------------------------------------
INSERT INTO public.numbering_sequences (tenant_id, entity_key, label, prefix, next_number, padding_length, is_active)
SELECT t.id, 'journal_entry', 'قيود اليومية العامة', 'JENT', 1, 6, true
FROM public.tenants t
ON CONFLICT (tenant_id, entity_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Accounting Server RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_manual_journal_entry(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_branch_id uuid := (p_payload->>'branch_id')::uuid;
  v_journal_id uuid := (p_payload->>'journal_id')::uuid;
  v_entry_type_id uuid := (p_payload->>'entry_type_id')::uuid;
  v_entry_date date := coalesce((p_payload->>'entry_date')::date, CURRENT_DATE);
  v_description text := p_payload->>'description';
  v_notes text := p_payload->>'notes';
  v_lines jsonb := p_payload->'lines';
  v_entry_id uuid;
  v_entry_code text;
  v_tot_debit numeric(14,2) := 0;
  v_tot_credit numeric(14,2) := 0;
  v_line jsonb;
  v_debit numeric(14,2);
  v_credit numeric(14,2);
BEGIN
  IF NOT public.user_can_access_branch(p_tenant_id, v_branch_id) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على الفرع المختار لإنشاء القيد.';
  END IF;

  IF jsonb_array_length(v_lines) < 2 THEN
    RAISE EXCEPTION 'يجب أن يتكون القيد من سطرين متوازنين على الأقل (مدين ودائن).';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    v_debit := coalesce((v_line->>'debit')::numeric, 0);
    v_credit := coalesce((v_line->>'credit')::numeric, 0);
    v_tot_debit := v_tot_debit + v_debit;
    v_tot_credit := v_tot_credit + v_credit;
  END LOOP;

  IF v_tot_debit <> v_tot_credit THEN
    RAISE EXCEPTION 'القيد غير متوازن: إجمالي المدين (%) لا يساوي إجمالي الدائن (%).', v_tot_debit, v_tot_credit;
  END IF;

  v_entry_code := app_private.next_document_number(p_tenant_id, 'journal_entry');

  INSERT INTO public.journal_entries (
    tenant_id, entry_code, entry_date, journal_id, entry_type_id, branch_id,
    reference_type, description, total_debit, total_credit, status, notes, created_by
  )
  VALUES (
    p_tenant_id, v_entry_code, v_entry_date, v_journal_id, v_entry_type_id, v_branch_id,
    'manual', v_description, v_tot_debit, v_tot_credit, 'draft', v_notes, v_user_id
  )
  RETURNING id INTO v_entry_id;

  FOR v_line IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    INSERT INTO public.journal_entry_lines (
      tenant_id, entry_id, account_id, branch_id, debit, credit, description
    )
    VALUES (
      p_tenant_id,
      v_entry_id,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'branch_id')::uuid, v_branch_id),
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      v_line->>'description'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_entry_id,
    'entry_code', v_entry_code,
    'total_amount', v_tot_debit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_manual_journal_entry(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_manual_journal_entry(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_journal_entry(
  p_tenant_id uuid,
  p_entry_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_entry public.journal_entries%ROWTYPE;
  v_policy public.tenant_settings%ROWTYPE;
BEGIN
  SELECT * INTO v_entry FROM public.journal_entries WHERE id = p_entry_id AND tenant_id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'قيد اليومية غير موجود.';
  END IF;

  IF v_entry.status = 'approved' THEN
    RETURN;
  END IF;

  IF v_entry.status = 'cancelled' THEN
    RAISE EXCEPTION 'لا يمكن اعتماد قيد ملغى.';
  END IF;

  SELECT * INTO v_policy FROM public.tenant_settings WHERE tenant_id = p_tenant_id;

  -- ADR-018: Four-Eyes policy enforcement
  PERFORM app_private.assert_finance_approval_policy(
    p_tenant_id, v_entry.created_by, v_entry.total_debit, 'journal_entry', p_entry_id
  );

  UPDATE public.journal_entries
  SET status = 'approved',
      approved_at = now(),
      approved_by = v_user_id
  WHERE id = p_entry_id AND tenant_id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_journal_entry(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_journal_entry(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_trial_balance(
  p_tenant_id uuid,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  account_id uuid,
  account_code text,
  account_name text,
  account_type text,
  is_group boolean,
  total_debit numeric(14,2),
  total_credit numeric(14,2),
  net_balance numeric(14,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id AS account_id,
    a.code AS account_code,
    a.name AS account_name,
    a.account_type::text AS account_type,
    a.is_group,
    coalesce(sum(l.debit), 0)::numeric(14,2) AS total_debit,
    coalesce(sum(l.credit), 0)::numeric(14,2) AS total_credit,
    CASE
      WHEN a.account_type IN ('asset', 'expense') THEN (coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0))::numeric(14,2)
      ELSE (coalesce(sum(l.credit), 0) - coalesce(sum(l.debit), 0))::numeric(14,2)
    END AS net_balance
  FROM public.chart_of_accounts a
  LEFT JOIN public.journal_entry_lines l ON l.account_id = a.id AND l.tenant_id = p_tenant_id
    AND (p_branch_id IS NULL OR l.branch_id = p_branch_id)
  LEFT JOIN public.journal_entries e ON e.id = l.entry_id AND e.status = 'approved'
  WHERE a.tenant_id = p_tenant_id AND a.archived_at IS NULL
  GROUP BY a.id, a.code, a.name, a.account_type, a.is_group, a.sort_order
  ORDER BY a.code;
END;
$$;

REVOKE ALL ON FUNCTION public.get_trial_balance(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trial_balance(uuid, uuid) TO authenticated;
