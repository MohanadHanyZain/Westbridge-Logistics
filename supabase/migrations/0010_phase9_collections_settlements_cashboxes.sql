-- ============================================================================
-- Migration 0010: Phase 9 - Collections, Cashboxes, Client & Courier Settlements
-- ============================================================================
-- Implements approved decisions:
-- - ADR-012: Courier commissions are accrued on delivery, strictly separated from
--   cash custody, and BLOCKED from payout until all shipment cash custody is
--   collected into a cashbox and approved (`is_collected_from_courier = true`).
-- - ADR-013: COD cash custody (`delivered_amount` or `recipient_collect_amount`),
--   POSTPAID shipping fee receivables, PREPAID & CASH_PAID treatment.
-- - ADR-016: Return liability deductions (`no_charge` / `sender_partial_fee`) on
--   client settlements and `recipient_paid_fee` courier cash custody collection.
-- - ADR-018 (OQ-11 Option A): Four-Eyes Principle (`enforce_four_eyes = true`,
--   `allow_owner_self_approve = true` configurable per tenant) + configurable
--   `high_value_approval_threshold` requiring owner/admin approval.
-- ============================================================================

-- Grant schema usage on app_private to authenticated and anon roles
GRANT USAGE ON SCHEMA app_private TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- 1. Extend tenant_settings with ADR-018 Finance Governance Policy
-- ----------------------------------------------------------------------------
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS enforce_four_eyes boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_owner_self_approve boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS high_value_approval_threshold numeric(14,2) NOT NULL DEFAULT 0
    CHECK (high_value_approval_threshold >= 0);

-- ----------------------------------------------------------------------------
-- 2. Extend Document Numbering Sequences for Phase 9 Documents
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.next_document_number(
  p_tenant_id uuid,
  p_entity_key text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_seq public.numbering_sequences%ROWTYPE;
  v_formatted text;
  v_default_prefix text;
  v_default_padding integer;
BEGIN
  SELECT * INTO v_seq
  FROM public.numbering_sequences
  WHERE tenant_id = p_tenant_id
    AND entity_key = p_entity_key
  FOR UPDATE;

  IF v_seq.id IS NULL THEN
    v_default_prefix := CASE p_entity_key
      WHEN 'shipments' THEN 'SHP'
      WHEN 'pickup_lists' THEN 'PKP'
      WHEN 'warehouse_manifests' THEN 'WRH'
      WHEN 'transfer_lists' THEN 'TRF'
      WHEN 'delivery_lists' THEN 'DLV'
      WHEN 'redelivery_lists' THEN 'RDL'
      WHEN 'courier_return_handovers' THEN 'RTH'
      WHEN 'return_dispatch_lists' THEN 'RTD'
      WHEN 'return_lists' THEN 'RTN'
      WHEN 'courier_collections' THEN 'COL'
      WHEN 'client_settlements' THEN 'CST'
      WHEN 'courier_commission_payouts' THEN 'CMP'
      WHEN 'cashbox_transfers' THEN 'CTR'
      WHEN 'cashbox_transactions' THEN 'CTX'
      WHEN 'receipt_vouchers' THEN 'RCV'
      WHEN 'payment_vouchers' THEN 'PAY'
      ELSE upper(left(p_entity_key, 3))
    END;

    v_default_padding := CASE WHEN p_entity_key = 'shipments' THEN 7 ELSE 6 END;

    INSERT INTO public.numbering_sequences (tenant_id, entity_key, label, prefix, next_number, padding_length)
    VALUES (p_tenant_id, p_entity_key, p_entity_key, v_default_prefix, 1, v_default_padding)
    RETURNING * INTO v_seq;
  END IF;

  v_formatted := v_seq.prefix || '-' || lpad(v_seq.next_number::text, v_seq.padding_length, '0');

  UPDATE public.numbering_sequences
  SET next_number = v_seq.next_number + 1
  WHERE id = v_seq.id;

  RETURN v_formatted;
END;
$$;

REVOKE ALL ON FUNCTION app_private.next_document_number(uuid, text) FROM PUBLIC, anon, authenticated;

INSERT INTO public.numbering_sequences (tenant_id, entity_key, label, prefix, next_number, padding_length)
SELECT t.id, s.entity_key, s.label, s.prefix, 1, 6
FROM public.tenants t
CROSS JOIN (
  VALUES
    ('courier_collections', 'سندات تحصيل النقدية من المناديب', 'COL'),
    ('client_settlements', 'تسويات حسابات العملاء', 'CST'),
    ('courier_commission_payouts', 'صرف عمولات المناديب', 'CMP'),
    ('cashbox_transfers', 'تحويلات بين الخزائن', 'CTR'),
    ('cashbox_transactions', 'حركات الخزينة', 'CTX'),
    ('receipt_vouchers', 'سندات القبض', 'RCV'),
    ('payment_vouchers', 'سندات الصرف', 'PAY')
) AS s(entity_key, label, prefix)
ON CONFLICT (tenant_id, entity_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Phase 9 Tables: Cashbox Ledger, Transfers, Vouchers & Settlements
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cashbox_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  transaction_code text NOT NULL CHECK (char_length(trim(transaction_code)) >= 4),
  cashbox_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  transaction_date date NOT NULL DEFAULT current_date,
  transaction_type text NOT NULL CHECK (
    transaction_type IN (
      'courier_collection_in',
      'client_settlement_out',
      'client_settlement_in',
      'commission_payout_out',
      'transfer_in',
      'transfer_out',
      'manual_receipt_in',
      'manual_payment_out',
      'prepaid_deposit_in'
    )
  ),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method_code text,
  reference_type text NOT NULL,
  reference_id uuid NOT NULL,
  reference_code text NOT NULL,
  notes text,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cashbox_transactions_tenant_code UNIQUE (tenant_id, transaction_code),
  CONSTRAINT fk_ctx_cashbox FOREIGN KEY (tenant_id, cashbox_id) REFERENCES public.cashboxes(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ctx_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_cashbox_transactions_cashbox ON public.cashbox_transactions (tenant_id, cashbox_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cashbox_transactions_ref ON public.cashbox_transactions (tenant_id, reference_type, reference_id);

CREATE OR REPLACE FUNCTION app_private.block_cashbox_transaction_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'حركات الخزينة دفتر مالي ثابت غير قابل للتعديل أو الحذف.';
END;
$$;

DROP TRIGGER IF EXISTS trg_cashbox_transactions_immutable ON public.cashbox_transactions;
CREATE TRIGGER trg_cashbox_transactions_immutable
  BEFORE UPDATE OR DELETE ON public.cashbox_transactions
  FOR EACH ROW EXECUTE FUNCTION app_private.block_cashbox_transaction_mutation();

-- Courier Collection Vouchers (COL-*)
CREATE TABLE IF NOT EXISTS public.courier_collection_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  voucher_code text NOT NULL CHECK (char_length(trim(voucher_code)) >= 4),
  voucher_date date NOT NULL DEFAULT current_date,
  branch_id uuid NOT NULL,
  courier_id uuid NOT NULL,
  cashbox_id uuid NOT NULL,
  payment_method_id uuid,
  total_expected_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_expected_amount >= 0),
  total_collected_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_collected_amount >= 0),
  variance_amount numeric(14,2) GENERATED ALWAYS AS (total_collected_amount - total_expected_amount) STORED,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
  notes text,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_courier_coll_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_courier_coll_tenant_code UNIQUE (tenant_id, voucher_code),
  CONSTRAINT fk_ccv_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ccv_courier FOREIGN KEY (tenant_id, courier_id) REFERENCES public.couriers(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ccv_cashbox FOREIGN KEY (tenant_id, cashbox_id) REFERENCES public.cashboxes(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_ccv_tenant_courier ON public.courier_collection_vouchers (tenant_id, courier_id, status);
CREATE INDEX IF NOT EXISTS idx_ccv_tenant_date ON public.courier_collection_vouchers (tenant_id, voucher_date DESC);

DROP TRIGGER IF EXISTS trg_ccv_updated_at ON public.courier_collection_vouchers;
CREATE TRIGGER trg_ccv_updated_at
  BEFORE UPDATE ON public.courier_collection_vouchers
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE IF NOT EXISTS public.courier_collection_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  voucher_id uuid NOT NULL,
  shipment_id uuid NOT NULL,
  cash_source_type text NOT NULL CHECK (cash_source_type IN ('cod_delivery', 'return_recipient_fee')),
  expected_amount numeric(14,2) NOT NULL CHECK (expected_amount >= 0),
  collected_amount numeric(14,2) NOT NULL CHECK (collected_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cci_pair UNIQUE (tenant_id, voucher_id, shipment_id),
  CONSTRAINT fk_cci_voucher FOREIGN KEY (tenant_id, voucher_id) REFERENCES public.courier_collection_vouchers(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_cci_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_cci_voucher ON public.courier_collection_items (tenant_id, voucher_id);
CREATE INDEX IF NOT EXISTS idx_cci_shipment ON public.courier_collection_items (tenant_id, shipment_id);

-- Client Settlements (CST-*)
CREATE TABLE IF NOT EXISTS public.client_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  settlement_code text NOT NULL CHECK (char_length(trim(settlement_code)) >= 4),
  settlement_date date NOT NULL DEFAULT current_date,
  branch_id uuid NOT NULL,
  client_id uuid NOT NULL,
  cashbox_id uuid,
  payment_method_id uuid,
  payout_method text NOT NULL CHECK (payout_method IN ('cash', 'bank_transfer', 'vodafone_cash')),
  payout_reference text,
  gross_cod_collected numeric(14,2) NOT NULL DEFAULT 0,
  shipping_fees_deducted numeric(14,2) NOT NULL DEFAULT 0,
  return_fees_deducted numeric(14,2) NOT NULL DEFAULT 0,
  adjustment_amount numeric(14,2) NOT NULL DEFAULT 0,
  net_payable_amount numeric(14,2) NOT NULL DEFAULT 0,
  cash_direction text NOT NULL CHECK (cash_direction IN ('payout_to_client', 'receipt_from_client', 'zero_balance')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
  notes text,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_client_stl_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_client_stl_tenant_code UNIQUE (tenant_id, settlement_code),
  CONSTRAINT fk_cs_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cs_client FOREIGN KEY (tenant_id, client_id) REFERENCES public.clients(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cs_cashbox FOREIGN KEY (tenant_id, cashbox_id) REFERENCES public.cashboxes(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_cs_tenant_client ON public.client_settlements (tenant_id, client_id, status);
CREATE INDEX IF NOT EXISTS idx_cs_tenant_date ON public.client_settlements (tenant_id, settlement_date DESC);

DROP TRIGGER IF EXISTS trg_cs_updated_at ON public.client_settlements;
CREATE TRIGGER trg_cs_updated_at
  BEFORE UPDATE ON public.client_settlements
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE IF NOT EXISTS public.client_settlement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  settlement_id uuid NOT NULL,
  shipment_id uuid NOT NULL,
  payment_term_code text NOT NULL,
  shipment_status text NOT NULL,
  cod_collected_amount numeric(14,2) NOT NULL DEFAULT 0,
  shipping_fee_deducted numeric(14,2) NOT NULL DEFAULT 0,
  return_fee_deducted numeric(14,2) NOT NULL DEFAULT 0,
  net_client_amount numeric(14,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_csi_pair UNIQUE (tenant_id, settlement_id, shipment_id),
  CONSTRAINT fk_csi_settlement FOREIGN KEY (tenant_id, settlement_id) REFERENCES public.client_settlements(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_csi_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_csi_settlement ON public.client_settlement_items (tenant_id, settlement_id);
CREATE INDEX IF NOT EXISTS idx_csi_shipment ON public.client_settlement_items (tenant_id, shipment_id);

-- Courier Commission Payouts (CMP-*)
CREATE TABLE IF NOT EXISTS public.courier_commission_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  payout_code text NOT NULL CHECK (char_length(trim(payout_code)) >= 4),
  payout_date date NOT NULL DEFAULT current_date,
  branch_id uuid NOT NULL,
  courier_id uuid NOT NULL,
  cashbox_id uuid NOT NULL,
  payment_method_id uuid,
  total_commission_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_commission_amount >= 0),
  bonus_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
  deduction_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  net_payout_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (net_payout_amount >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
  notes text,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_cmp_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_cmp_tenant_code UNIQUE (tenant_id, payout_code),
  CONSTRAINT fk_cmp_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cmp_courier FOREIGN KEY (tenant_id, courier_id) REFERENCES public.couriers(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cmp_cashbox FOREIGN KEY (tenant_id, cashbox_id) REFERENCES public.cashboxes(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_cmp_tenant_courier ON public.courier_commission_payouts (tenant_id, courier_id, status);

DROP TRIGGER IF EXISTS trg_cmp_updated_at ON public.courier_commission_payouts;
CREATE TRIGGER trg_cmp_updated_at
  BEFORE UPDATE ON public.courier_commission_payouts
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE IF NOT EXISTS public.courier_commission_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  payout_id uuid NOT NULL,
  shipment_id uuid NOT NULL,
  commission_amount numeric(12,2) NOT NULL CHECK (commission_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cmpi_pair UNIQUE (tenant_id, payout_id, shipment_id),
  CONSTRAINT fk_cmpi_payout FOREIGN KEY (tenant_id, payout_id) REFERENCES public.courier_commission_payouts(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_cmpi_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT
);

-- Cashbox Transfers (CTR-*) & General Vouchers (RCV-* / PAY-*)
CREATE TABLE IF NOT EXISTS public.cashbox_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  transfer_code text NOT NULL CHECK (char_length(trim(transfer_code)) >= 4),
  transfer_date date NOT NULL DEFAULT current_date,
  from_cashbox_id uuid NOT NULL,
  to_cashbox_id uuid NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
  notes text,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ctr_different_boxes CHECK (from_cashbox_id <> to_cashbox_id),
  CONSTRAINT uq_ctr_tenant_code UNIQUE (tenant_id, transfer_code),
  CONSTRAINT fk_ctr_from FOREIGN KEY (tenant_id, from_cashbox_id) REFERENCES public.cashboxes(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_ctr_to FOREIGN KEY (tenant_id, to_cashbox_id) REFERENCES public.cashboxes(tenant_id, id) ON DELETE RESTRICT
);

DROP TRIGGER IF EXISTS trg_ctr_updated_at ON public.cashbox_transfers;
CREATE TRIGGER trg_ctr_updated_at
  BEFORE UPDATE ON public.cashbox_transfers
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE IF NOT EXISTS public.cashbox_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  voucher_code text NOT NULL CHECK (char_length(trim(voucher_code)) >= 4),
  voucher_type text NOT NULL CHECK (voucher_type IN ('receipt', 'payment', 'prepaid_deposit')),
  voucher_date date NOT NULL DEFAULT current_date,
  branch_id uuid NOT NULL,
  cashbox_id uuid NOT NULL,
  client_id uuid,
  payment_method_id uuid,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  party_name text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'cancelled')),
  notes text,
  approved_at timestamptz,
  approved_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_cv_tenant_code UNIQUE (tenant_id, voucher_code),
  CONSTRAINT fk_cv_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cv_cashbox FOREIGN KEY (tenant_id, cashbox_id) REFERENCES public.cashboxes(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cv_client FOREIGN KEY (tenant_id, client_id) REFERENCES public.clients(tenant_id, id) ON DELETE RESTRICT
);

DROP TRIGGER IF EXISTS trg_cv_updated_at ON public.cashbox_vouchers;
CREATE TRIGGER trg_cv_updated_at
  BEFORE UPDATE ON public.cashbox_vouchers
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- Link references onto shipments
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS courier_collection_voucher_id uuid,
  ADD COLUMN IF NOT EXISTS client_settlement_id uuid,
  ADD COLUMN IF NOT EXISTS courier_commission_payout_id uuid;

-- ----------------------------------------------------------------------------
-- 4. Authorization Helpers, Four-Eyes Policy & Forced RLS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.user_get_bound_client_id(p_tenant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT asub.client_id
  FROM public.tenant_memberships tm
  JOIN public.profiles pr ON pr.id = tm.user_id AND pr.is_active = true
  JOIN public.tenants t ON t.id = tm.tenant_id AND t.status = 'active'
  JOIN public.account_subjects asub
    ON asub.tenant_id = tm.tenant_id AND asub.membership_id = tm.id AND asub.is_active = true
  WHERE tm.tenant_id = p_tenant_id
    AND tm.user_id = auth.uid()
    AND tm.is_active = true
    AND tm.account_subject_type = 'client'
    AND asub.client_id IS NOT NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app_private.user_get_bound_client_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.user_get_bound_client_id(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.get_cashbox_balance(
  p_tenant_id uuid,
  p_cashbox_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    SUM(CASE WHEN direction = 'in' THEN amount ELSE -amount END),
    0
  )::numeric(14,2)
  FROM public.cashbox_transactions
  WHERE tenant_id = p_tenant_id
    AND cashbox_id = p_cashbox_id;
$$;

REVOKE ALL ON FUNCTION app_private.get_cashbox_balance(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.get_cashbox_balance(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.user_can_access_finance_branch(
  p_tenant_id uuid,
  p_branch_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT
    app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.create', p_branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.approve', p_branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.payouts.approve', p_branch_id);
$$;

REVOKE ALL ON FUNCTION app_private.user_can_access_finance_branch(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.user_can_access_finance_branch(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app_private.assert_finance_approval_policy(
  p_tenant_id uuid,
  p_created_by uuid,
  p_amount numeric,
  p_permission_key text,
  p_branch_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_is_super boolean := app_private.current_user_is_platform_super_admin();
  v_role_key text;
  v_enforce_four_eyes boolean := true;
  v_allow_owner_self boolean := true;
  v_threshold numeric(14,2) := 0;
BEGIN
  IF NOT v_is_super THEN
    SELECT tm.role_key INTO v_role_key
    FROM public.tenant_memberships tm
    JOIN public.profiles pr ON pr.id = tm.user_id AND pr.is_active = true
    JOIN public.tenants t ON t.id = tm.tenant_id AND t.status = 'active'
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.is_active = true
    LIMIT 1;

    IF v_role_key IS NULL THEN
      RAISE EXCEPTION 'Forbidden: عضوية الشركة غير نشطة أو غير مصرح لها.';
    END IF;

    IF NOT (
      app_private.user_is_tenant_admin(p_tenant_id)
      OR app_private.user_is_staff_with_permission(p_tenant_id, p_permission_key, p_branch_id)
    ) THEN
      RAISE EXCEPTION 'Forbidden: صلاحية الاعتماد المالي (%) غير متوفرة لهذا الفرع.', p_permission_key;
    END IF;
  END IF;

  SELECT
    COALESCE(enforce_four_eyes, true),
    COALESCE(allow_owner_self_approve, true),
    COALESCE(high_value_approval_threshold, 0)
  INTO v_enforce_four_eyes, v_allow_owner_self, v_threshold
  FROM public.tenant_settings
  WHERE tenant_id = p_tenant_id;

  v_enforce_four_eyes := COALESCE(v_enforce_four_eyes, true);
  v_allow_owner_self := COALESCE(v_allow_owner_self, true);
  v_threshold := COALESCE(v_threshold, 0);

  -- ADR-018 Four-Eyes Enforcement
  IF v_enforce_four_eyes AND p_created_by IS NOT NULL AND p_created_by = auth.uid() THEN
    IF NOT (v_is_super OR (v_role_key = 'company_owner' AND v_allow_owner_self)) THEN
      RAISE EXCEPTION 'Forbidden: تطبيقًا لمبدأ العينين الأربع (ADR-018)، لا يُسمح لمنشئ المستند المالي باعتماده بنفسه.';
    END IF;
  END IF;

  -- ADR-018 High-Value Approval Threshold
  IF v_threshold > 0 AND ABS(COALESCE(p_amount, 0)) >= v_threshold THEN
    IF NOT (v_is_super OR v_role_key IN ('company_owner', 'company_admin')) THEN
      RAISE EXCEPTION 'Forbidden: مبلغ المستند (% ج.م) يبلغ أو يتجاوز حد الاعتماد الأعلى (% ج.م) ويتطلب اعتماد مالك الشركة أو الأدمن (ADR-018).',
        round(ABS(COALESCE(p_amount, 0)), 2), round(v_threshold, 2);
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION app_private.assert_finance_approval_policy(uuid, uuid, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.assert_finance_approval_policy(uuid, uuid, numeric, text, uuid) TO authenticated;

DO $$
DECLARE
  v_tbl text;
  v_tables text[] := ARRAY[
    'cashbox_transactions',
    'courier_collection_vouchers',
    'courier_collection_items',
    'client_settlements',
    'client_settlement_items',
    'courier_commission_payouts',
    'courier_commission_items',
    'cashbox_transfers',
    'cashbox_vouchers'
  ];
BEGIN
  FOREACH v_tbl IN ARRAY v_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_tbl);
  END LOOP;
END $$;

DROP POLICY IF EXISTS cashbox_transactions_select_policy ON public.cashbox_transactions;
CREATE POLICY cashbox_transactions_select_policy ON public.cashbox_transactions
  FOR SELECT TO authenticated
  USING (app_private.user_can_access_finance_branch(tenant_id, branch_id));

DROP POLICY IF EXISTS ccv_select_policy ON public.courier_collection_vouchers;
CREATE POLICY ccv_select_policy ON public.courier_collection_vouchers
  FOR SELECT TO authenticated
  USING (
    app_private.user_can_access_finance_branch(tenant_id, branch_id)
    OR app_private.user_get_bound_courier_id(tenant_id) = courier_id
  );

DROP POLICY IF EXISTS cci_select_policy ON public.courier_collection_items;
CREATE POLICY cci_select_policy ON public.courier_collection_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.courier_collection_vouchers v
      WHERE v.id = courier_collection_items.voucher_id
        AND v.tenant_id = courier_collection_items.tenant_id
        AND (
          app_private.user_can_access_finance_branch(v.tenant_id, v.branch_id)
          OR app_private.user_get_bound_courier_id(v.tenant_id) = v.courier_id
        )
    )
  );

DROP POLICY IF EXISTS cs_select_policy ON public.client_settlements;
CREATE POLICY cs_select_policy ON public.client_settlements
  FOR SELECT TO authenticated
  USING (
    app_private.user_can_access_finance_branch(tenant_id, branch_id)
    OR app_private.user_get_bound_client_id(tenant_id) = client_id
  );

DROP POLICY IF EXISTS csi_select_policy ON public.client_settlement_items;
CREATE POLICY csi_select_policy ON public.client_settlement_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.client_settlements s
      WHERE s.id = client_settlement_items.settlement_id
        AND s.tenant_id = client_settlement_items.tenant_id
        AND (
          app_private.user_can_access_finance_branch(s.tenant_id, s.branch_id)
          OR app_private.user_get_bound_client_id(s.tenant_id) = s.client_id
        )
    )
  );

DROP POLICY IF EXISTS cmp_select_policy ON public.courier_commission_payouts;
CREATE POLICY cmp_select_policy ON public.courier_commission_payouts
  FOR SELECT TO authenticated
  USING (
    app_private.user_can_access_finance_branch(tenant_id, branch_id)
    OR app_private.user_get_bound_courier_id(tenant_id) = courier_id
  );

DROP POLICY IF EXISTS cmpi_select_policy ON public.courier_commission_items;
CREATE POLICY cmpi_select_policy ON public.courier_commission_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.courier_commission_payouts p
      WHERE p.id = courier_commission_items.payout_id
        AND p.tenant_id = courier_commission_items.tenant_id
        AND (
          app_private.user_can_access_finance_branch(p.tenant_id, p.branch_id)
          OR app_private.user_get_bound_courier_id(p.tenant_id) = p.courier_id
        )
    )
  );

DROP POLICY IF EXISTS ctr_select_policy ON public.cashbox_transfers;
CREATE POLICY ctr_select_policy ON public.cashbox_transfers
  FOR SELECT TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_is_staff_with_permission(tenant_id, 'finance.collections.create', NULL)
    OR app_private.user_is_staff_with_permission(tenant_id, 'finance.collections.approve', NULL)
    OR app_private.user_is_staff_with_permission(tenant_id, 'finance.payouts.approve', NULL)
  );

DROP POLICY IF EXISTS cv_select_policy ON public.cashbox_vouchers;
CREATE POLICY cv_select_policy ON public.cashbox_vouchers
  FOR SELECT TO authenticated
  USING (
    app_private.user_can_access_finance_branch(tenant_id, branch_id)
    OR (client_id IS NOT NULL AND app_private.user_get_bound_client_id(tenant_id) = client_id)
  );

-- ----------------------------------------------------------------------------
-- 5. Finance Policy & Cashbox Overview RPCs (ADR-018)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_tenant_finance_policy(
  p_tenant_id uuid,
  p_enforce_four_eyes boolean,
  p_allow_owner_self_approve boolean,
  p_high_value_threshold numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_threshold numeric(14,2) := GREATEST(COALESCE(p_high_value_threshold, 0), 0);
BEGIN
  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: تعديل سياسة الرقابة المالية وحدود الاعتماد يقتصر على مالك الشركة أو الأدمن.';
  END IF;

  INSERT INTO public.tenant_settings (
    tenant_id, enforce_four_eyes, allow_owner_self_approve, high_value_approval_threshold, updated_by
  )
  VALUES (
    p_tenant_id, COALESCE(p_enforce_four_eyes, true), COALESCE(p_allow_owner_self_approve, true), v_threshold, auth.uid()
  )
  ON CONFLICT (tenant_id) DO UPDATE
    SET enforce_four_eyes = EXCLUDED.enforce_four_eyes,
        allow_owner_self_approve = EXCLUDED.allow_owner_self_approve,
        high_value_approval_threshold = EXCLUDED.high_value_approval_threshold,
        updated_by = auth.uid();

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'tenant_settings.finance_policy_updated', 'tenant_settings', p_tenant_id,
    jsonb_build_object(
      'enforce_four_eyes', COALESCE(p_enforce_four_eyes, true),
      'allow_owner_self_approve', COALESCE(p_allow_owner_self_approve, true),
      'high_value_approval_threshold', v_threshold
    ),
    'rpc'
  );

  RETURN jsonb_build_object(
    'tenant_id', p_tenant_id,
    'enforce_four_eyes', COALESCE(p_enforce_four_eyes, true),
    'allow_owner_self_approve', COALESCE(p_allow_owner_self_approve, true),
    'high_value_approval_threshold', v_threshold
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_finance_policy(uuid, boolean, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_finance_policy(uuid, boolean, boolean, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_cashboxes_with_balances(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT CASE
    WHEN NOT (
      app_private.current_user_is_platform_admin()
      OR app_private.user_is_tenant_admin(p_tenant_id)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.create', NULL)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.approve', NULL)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.payouts.approve', NULL)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'definitions.read', NULL)
    ) THEN '[]'::jsonb
    ELSE COALESCE((
      SELECT jsonb_agg(row_to_json(q) ORDER BY q.code)
      FROM (
        SELECT
          cb.id,
          cb.tenant_id,
          cb.code,
          cb.name,
          cb.branch_id,
          b.name AS branch_name,
          cb.ledger_account_id,
          cb.is_active,
          cb.allow_deposit,
          cb.allow_withdraw,
          cb.allow_transfer_in,
          cb.allow_transfer_out,
          app_private.get_cashbox_balance(cb.tenant_id, cb.id) AS current_balance
        FROM public.cashboxes cb
        LEFT JOIN public.branches b ON b.id = cb.branch_id AND b.tenant_id = cb.tenant_id
        WHERE cb.tenant_id = p_tenant_id
          AND cb.archived_at IS NULL
      ) q
    ), '[]'::jsonb)
  END;
$$;

REVOKE ALL ON FUNCTION public.get_cashboxes_with_balances(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cashboxes_with_balances(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Courier Collection Vouchers (COL-*): Cash Custody -> Cashbox
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_courier_custody_overview(
  p_tenant_id uuid,
  p_courier_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_bound_courier uuid := app_private.user_get_bound_courier_id(p_tenant_id);
  v_filter_courier uuid := COALESCE(v_bound_courier, p_courier_id);
  v_rows jsonb;
BEGIN
  IF v_bound_courier IS NULL AND NOT (
    app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.create', NULL)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.approve', NULL)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.payouts.approve', NULL)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'couriers.read', NULL)
  ) THEN
    RAISE EXCEPTION 'Forbidden: صلاحية متابعة عهد المناديب غير متوفرة.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(q) ORDER BY q.code), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      c.id AS courier_id,
      c.code,
      c.name,
      c.mobile,
      c.branch_id,
      -- Physical shipment custody currently held by courier
      COALESCE((
        SELECT count(*)
        FROM public.shipments s
        WHERE s.tenant_id = p_tenant_id
          AND s.assigned_courier_id = c.id
          AND (
            s.operational_status IN ('pickup_scheduled', 'out_for_delivery', 'rescheduled', 'delivery_failed', 'return_to_sender')
            OR s.partial_return_custody = 'with_courier'
            OR s.exchange_status = 'with_courier'
          )
      ), 0)::integer AS shipment_custody_count,
      -- Uncollected COD & recipient return fee cash custody
      COALESCE((
        SELECT count(*)
        FROM public.shipments s
        WHERE s.tenant_id = p_tenant_id
          AND s.assigned_courier_id = c.id
          AND s.is_collected_from_courier = false
          AND (
            (s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'COD'
              AND COALESCE(s.delivered_amount, s.recipient_collect_amount, 0) > 0)
            OR (s.operational_status IN ('return_to_sender', 'returned')
              AND s.return_liability = 'recipient_paid_fee'
              AND s.return_collected_from_recipient > 0)
          )
      ), 0)::integer AS uncollected_cash_shipments_count,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'COD'
              THEN COALESCE(s.delivered_amount, s.recipient_collect_amount, 0)
            WHEN s.operational_status IN ('return_to_sender', 'returned') AND s.return_liability = 'recipient_paid_fee'
              THEN COALESCE(s.return_collected_from_recipient, 0)
            ELSE 0
          END
        )
        FROM public.shipments s
        WHERE s.tenant_id = p_tenant_id
          AND s.assigned_courier_id = c.id
          AND s.is_collected_from_courier = false
      ), 0)::numeric(14,2) AS uncollected_cash_amount,
      -- Accrued commissions strictly separated from cash (ADR-012)
      COALESCE((
        SELECT SUM(s.accrued_courier_commission)
        FROM public.shipments s
        WHERE s.tenant_id = p_tenant_id
          AND s.assigned_courier_id = c.id
          AND s.operational_status IN ('delivered', 'partially_delivered')
          AND s.accrued_courier_commission > 0
          AND s.is_courier_commission_paid = false
      ), 0)::numeric(14,2) AS total_accrued_commission,
      -- Eligible payable commission (only on shipments where cash custody was already collected!)
      COALESCE((
        SELECT SUM(s.accrued_courier_commission)
        FROM public.shipments s
        WHERE s.tenant_id = p_tenant_id
          AND s.assigned_courier_id = c.id
          AND s.operational_status IN ('delivered', 'partially_delivered')
          AND s.accrued_courier_commission > 0
          AND s.is_courier_commission_paid = false
          AND (
            s.payment_term_code <> 'COD'
            OR COALESCE(s.delivered_amount, s.recipient_collect_amount, 0) <= 0
            OR s.is_collected_from_courier = true
          )
      ), 0)::numeric(14,2) AS payable_commission_amount
    FROM public.couriers c
    WHERE c.tenant_id = p_tenant_id
      AND c.archived_at IS NULL
      AND (v_filter_courier IS NULL OR c.id = v_filter_courier)
  ) q;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.get_courier_custody_overview(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_courier_custody_overview(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_courier_uncollected_cash_shipments(
  p_tenant_id uuid,
  p_courier_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT CASE
    WHEN NOT (
      app_private.current_user_is_platform_admin()
      OR app_private.user_is_tenant_admin(p_tenant_id)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.create', NULL)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.approve', NULL)
      OR app_private.user_get_bound_courier_id(p_tenant_id) = p_courier_id
    ) THEN '[]'::jsonb
    ELSE COALESCE((
      SELECT jsonb_agg(row_to_json(q) ORDER BY q.delivered_at DESC NULLS LAST, q.created_at DESC)
      FROM (
        SELECT
          s.id AS shipment_id,
          s.shipment_number,
          s.barcode_token,
          s.operational_status,
          s.payment_term_code,
          s.return_liability,
          s.delivered_at,
          s.created_at,
          CASE
            WHEN s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'COD'
              THEN 'cod_delivery'
            ELSE 'return_recipient_fee'
          END AS cash_source_type,
          CASE
            WHEN s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'COD'
              THEN COALESCE(s.delivered_amount, s.recipient_collect_amount, 0)
            ELSE COALESCE(s.return_collected_from_recipient, 0)
          END AS expected_amount,
          c.name AS client_name
        FROM public.shipments s
        LEFT JOIN public.clients c ON c.id = s.client_id AND c.tenant_id = s.tenant_id
        WHERE s.tenant_id = p_tenant_id
          AND s.assigned_courier_id = p_courier_id
          AND s.is_collected_from_courier = false
          AND (
            (s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'COD'
              AND COALESCE(s.delivered_amount, s.recipient_collect_amount, 0) > 0)
            OR (s.operational_status IN ('return_to_sender', 'returned')
              AND s.return_liability = 'recipient_paid_fee'
              AND s.return_collected_from_recipient > 0)
          )
          AND NOT EXISTS (
            SELECT 1
            FROM public.courier_collection_items cci
            JOIN public.courier_collection_vouchers ccv
              ON ccv.id = cci.voucher_id AND ccv.tenant_id = cci.tenant_id
            WHERE cci.tenant_id = p_tenant_id
              AND cci.shipment_id = s.id
              AND ccv.status IN ('draft', 'approved')
          )
      ) q
    ), '[]'::jsonb)
  END;
$$;

REVOKE ALL ON FUNCTION public.list_courier_uncollected_cash_shipments(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_courier_uncollected_cash_shipments(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_courier_collection_voucher(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_branch_id uuid := (p_payload->>'branch_id')::uuid;
  v_courier_id uuid := (p_payload->>'courier_id')::uuid;
  v_cashbox_id uuid := (p_payload->>'cashbox_id')::uuid;
  v_payment_method_id uuid := NULLIF(p_payload->>'payment_method_id', '')::uuid;
  v_voucher_date date := COALESCE(NULLIF(p_payload->>'voucher_date', '')::date, current_date);
  v_notes text := NULLIF(trim(COALESCE(p_payload->>'notes', '')), '');
  v_shipment_ids uuid[];
  v_sid uuid;
  v_shp public.shipments%ROWTYPE;
  v_cashbox public.cashboxes%ROWTYPE;
  v_source_type text;
  v_expected numeric(14,2);
  v_total_expected numeric(14,2) := 0;
  v_total_collected numeric(14,2);
  v_voucher_id uuid;
  v_voucher_code text;
BEGIN
  IF v_branch_id IS NULL OR v_courier_id IS NULL OR v_cashbox_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد الفرع والمندوب والخزينة المستلمة.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.create', v_branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.approve', v_branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: صلاحية إنشاء سند تحصيل من المندوب غير متوفرة.';
  END IF;

  SELECT * INTO v_cashbox
  FROM public.cashboxes
  WHERE tenant_id = p_tenant_id AND id = v_cashbox_id AND archived_at IS NULL AND is_active = true;

  IF v_cashbox.id IS NULL OR NOT v_cashbox.allow_deposit THEN
    RAISE EXCEPTION 'الخزينة المحددة غير نشطة أو لا تسمح بالإيداع.';
  END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'shipment_ids', '[]'::jsonb))::uuid)
  INTO v_shipment_ids;

  IF COALESCE(array_length(v_shipment_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'يجب اختيار شحنة واحدة على الأقل لتوريد نقديتها.';
  END IF;

  v_voucher_code := app_private.next_document_number(p_tenant_id, 'courier_collections');

  INSERT INTO public.courier_collection_vouchers (
    tenant_id, voucher_code, voucher_date, branch_id, courier_id, cashbox_id,
    payment_method_id, total_expected_amount, total_collected_amount, status, notes,
    created_by, updated_by
  )
  VALUES (
    p_tenant_id, v_voucher_code, v_voucher_date, v_branch_id, v_courier_id, v_cashbox_id,
    v_payment_method_id, 0, 0, 'draft', v_notes, auth.uid(), auth.uid()
  )
  RETURNING id INTO v_voucher_id;

  FOREACH v_sid IN ARRAY v_shipment_ids LOOP
    SELECT * INTO v_shp
    FROM public.shipments
    WHERE tenant_id = p_tenant_id AND id = v_sid
    FOR UPDATE;

    IF v_shp.id IS NULL OR v_shp.assigned_courier_id <> v_courier_id THEN
      RAISE EXCEPTION 'إحدى الشحنات المحددة غير موجودة أو غير مسندة لهذا المندوب.';
    END IF;

    IF v_shp.is_collected_from_courier THEN
      RAISE EXCEPTION 'الشحنة (%) تم تحصيل عهدتها النقدية بالفعل.', v_shp.shipment_number;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.courier_collection_items cci
      JOIN public.courier_collection_vouchers ccv ON ccv.id = cci.voucher_id AND ccv.tenant_id = cci.tenant_id
      WHERE cci.tenant_id = p_tenant_id AND cci.shipment_id = v_sid AND ccv.status IN ('draft', 'approved')
    ) THEN
      RAISE EXCEPTION 'الشحنة (%) مدرجة بالفعل في سند تحصيل نشط.', v_shp.shipment_number;
    END IF;

    IF v_shp.operational_status IN ('delivered', 'partially_delivered') AND v_shp.payment_term_code = 'COD' THEN
      v_source_type := 'cod_delivery';
      v_expected := COALESCE(v_shp.delivered_amount, v_shp.recipient_collect_amount, 0);
    ELSIF v_shp.operational_status IN ('return_to_sender', 'returned') AND v_shp.return_liability = 'recipient_paid_fee' THEN
      v_source_type := 'return_recipient_fee';
      v_expected := COALESCE(v_shp.return_collected_from_recipient, 0);
    ELSE
      RAISE EXCEPTION 'الشحنة (%) لا تحمل عهدة نقدية واجبة التحصيل من المندوب.', v_shp.shipment_number;
    END IF;

    IF v_expected <= 0 THEN
      RAISE EXCEPTION 'قيمة التحصيل المتوقعة للشحنة (%) تساوي صفر.', v_shp.shipment_number;
    END IF;

    INSERT INTO public.courier_collection_items (
      tenant_id, voucher_id, shipment_id, cash_source_type, expected_amount, collected_amount
    )
    VALUES (
      p_tenant_id, v_voucher_id, v_sid, v_source_type, v_expected, v_expected
    );

    v_total_expected := v_total_expected + v_expected;
  END LOOP;

  v_total_collected := COALESCE(NULLIF(p_payload->>'collected_amount', '')::numeric, v_total_expected);
  IF v_total_collected < 0 THEN
    RAISE EXCEPTION 'المبلغ المحصل لا يمكن أن يكون سالبًا.';
  END IF;

  UPDATE public.courier_collection_vouchers
  SET total_expected_amount = v_total_expected,
      total_collected_amount = v_total_collected,
      updated_by = auth.uid()
  WHERE id = v_voucher_id AND tenant_id = p_tenant_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'courier_collection.created', 'courier_collection_vouchers', v_voucher_id,
    jsonb_build_object(
      'voucher_code', v_voucher_code,
      'courier_id', v_courier_id,
      'cashbox_id', v_cashbox_id,
      'expected_amount', v_total_expected,
      'collected_amount', v_total_collected
    ),
    'rpc'
  );

  RETURN jsonb_build_object(
    'id', v_voucher_id,
    'voucher_code', v_voucher_code,
    'total_expected_amount', v_total_expected,
    'total_collected_amount', v_total_collected,
    'status', 'draft'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_courier_collection_voucher(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_courier_collection_voucher(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_courier_collection_voucher(
  p_tenant_id uuid,
  p_voucher_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_voucher public.courier_collection_vouchers%ROWTYPE;
  v_cashbox public.cashboxes%ROWTYPE;
  v_rec record;
  v_actor_name text;
  v_tx_code text;
BEGIN
  SELECT * INTO v_voucher
  FROM public.courier_collection_vouchers
  WHERE tenant_id = p_tenant_id AND id = p_voucher_id
  FOR UPDATE;

  IF v_voucher.id IS NULL THEN
    RAISE EXCEPTION 'سند التحصيل غير موجود.';
  END IF;

  IF v_voucher.status <> 'draft' THEN
    RAISE EXCEPTION 'سند التحصيل معتمد أو ملغى بالفعل.';
  END IF;

  -- Enforce ADR-018 Four-Eyes + High-Value Threshold
  PERFORM app_private.assert_finance_approval_policy(
    p_tenant_id,
    v_voucher.created_by,
    v_voucher.total_collected_amount,
    'finance.collections.approve',
    v_voucher.branch_id
  );

  SELECT * INTO v_cashbox
  FROM public.cashboxes
  WHERE tenant_id = p_tenant_id AND id = v_voucher.cashbox_id AND archived_at IS NULL AND is_active = true;

  IF v_cashbox.id IS NULL OR NOT v_cashbox.allow_deposit THEN
    RAISE EXCEPTION 'الخزينة المرتبطة غير نشطة أو لا تقبل الإيداع.';
  END IF;

  SELECT COALESCE(display_name, 'مستخدم النظام') INTO v_actor_name
  FROM public.profiles WHERE id = auth.uid();

  PERFORM set_config('app_private.allow_shipment_mutation', 'on', true);

  FOR v_rec IN
    SELECT s.*, cci.collected_amount
    FROM public.courier_collection_items cci
    JOIN public.shipments s ON s.tenant_id = cci.tenant_id AND s.id = cci.shipment_id
    WHERE cci.tenant_id = p_tenant_id AND cci.voucher_id = v_voucher.id
    FOR UPDATE OF s
  LOOP
    IF v_rec.is_collected_from_courier THEN
      RAISE EXCEPTION 'الشحنة (%) تم تحصيلها مسبقًا في سند آخر.', v_rec.shipment_number;
    END IF;

    UPDATE public.shipments
    SET is_collected_from_courier = true,
        courier_collection_voucher_id = v_voucher.id,
        updated_by = auth.uid()
    WHERE id = v_rec.id AND tenant_id = p_tenant_id;

    INSERT INTO public.shipment_status_events (
      tenant_id, shipment_id, event_code, from_status, to_status,
      branch_id, courier_id, list_type, list_code, fees_snapshot, notes,
      actor_user_id, actor_display_name
    )
    VALUES (
      p_tenant_id, v_rec.id, 'finance.courier_cash_collected',
      v_rec.operational_status, v_rec.operational_status,
      v_voucher.branch_id, v_voucher.courier_id, 'courier_collection_voucher', v_voucher.voucher_code,
      v_rec.collected_amount,
      'توريد نقدية الشحنة من المندوب للخزينة بسند ' || v_voucher.voucher_code,
      auth.uid(), v_actor_name
    );
  END LOOP;

  PERFORM set_config('app_private.allow_shipment_mutation', 'off', true);

  IF v_voucher.total_collected_amount > 0 THEN
    v_tx_code := app_private.next_document_number(p_tenant_id, 'cashbox_transactions');
    INSERT INTO public.cashbox_transactions (
      tenant_id, transaction_code, cashbox_id, branch_id, transaction_date,
      transaction_type, direction, amount, reference_type, reference_id, reference_code,
      notes, actor_user_id
    )
    VALUES (
      p_tenant_id, v_tx_code, v_cashbox.id, v_voucher.branch_id, v_voucher.voucher_date,
      'courier_collection_in', 'in', v_voucher.total_collected_amount,
      'courier_collection_vouchers', v_voucher.id, v_voucher.voucher_code,
      COALESCE(v_voucher.notes, 'تحصيل نقدية من المندوب بسند ' || v_voucher.voucher_code),
      auth.uid()
    );
  END IF;

  UPDATE public.courier_collection_vouchers
  SET status = 'approved',
      approved_at = now(),
      approved_by = auth.uid(),
      updated_by = auth.uid()
  WHERE id = v_voucher.id AND tenant_id = p_tenant_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'courier_collection.approved', 'courier_collection_vouchers', v_voucher.id,
    jsonb_build_object(
      'voucher_code', v_voucher.voucher_code,
      'cashbox_id', v_voucher.cashbox_id,
      'collected_amount', v_voucher.total_collected_amount
    ),
    'rpc'
  );

  RETURN jsonb_build_object(
    'id', v_voucher.id,
    'voucher_code', v_voucher.voucher_code,
    'status', 'approved',
    'total_collected_amount', v_voucher.total_collected_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_courier_collection_voucher(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_courier_collection_voucher(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Client Settlements (CST-*): Cod Payouts, Shipping & Return Fee Deductions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_clients_settlement_overview(
  p_tenant_id uuid,
  p_client_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_bound_client uuid := app_private.user_get_bound_client_id(p_tenant_id);
  v_filter_client uuid := COALESCE(v_bound_client, p_client_id);
  v_rows jsonb;
BEGIN
  IF v_bound_client IS NULL AND NOT (
    app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.payouts.approve', NULL)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.approve', NULL)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'clients.read', NULL)
  ) THEN
    RAISE EXCEPTION 'Forbidden: صلاحية الاطلاع على تسويات العملاء غير متوفرة.';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(q) ORDER BY q.code), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      cl.id AS client_id,
      cl.code,
      cl.name,
      cl.mobile,
      cl.branch_id,
      cl.payout_method,
      cl.bank_name,
      cl.bank_account_number,
      cl.wallet_phone,
      cl.default_price_mode,
      COALESCE((
        SELECT count(*)
        FROM public.shipments s
        WHERE s.tenant_id = p_tenant_id
          AND s.client_id = cl.id
          AND s.is_settled_to_client = false
          AND s.operational_status IN ('delivered', 'partially_delivered', 'returned', 'return_to_sender')
      ), 0)::integer AS unsettled_shipments_count,
      COALESCE((
        SELECT count(*)
        FROM public.shipments s
        WHERE s.tenant_id = p_tenant_id
          AND s.client_id = cl.id
          AND s.is_settled_to_client = false
          AND s.operational_status IN ('delivered', 'partially_delivered')
          AND s.payment_term_code = 'COD'
          AND s.is_collected_from_courier = false
          AND COALESCE(s.delivered_amount, s.recipient_collect_amount, 0) > 0
      ), 0)::integer AS awaiting_courier_collection_count,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'COD'
              THEN COALESCE(s.delivered_amount, s.recipient_collect_amount, 0)
            ELSE 0
          END
        )
        FROM public.shipments s
        WHERE s.tenant_id = p_tenant_id
          AND s.client_id = cl.id
          AND s.is_settled_to_client = false
          AND s.operational_status IN ('delivered', 'partially_delivered', 'returned', 'return_to_sender')
      ), 0)::numeric(14,2) AS gross_cod_amount,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code IN ('COD', 'POSTPAID')
              THEN s.total_shipping_fee
            ELSE 0
          END
        )
        FROM public.shipments s
        WHERE s.tenant_id = p_tenant_id
          AND s.client_id = cl.id
          AND s.is_settled_to_client = false
          AND s.operational_status IN ('delivered', 'partially_delivered')
      ), 0)::numeric(14,2) AS shipping_fees_deductible,
      COALESCE((
        SELECT SUM(
          CASE
            WHEN s.operational_status IN ('returned', 'return_to_sender') AND s.return_liability = 'recipient_paid_fee' THEN 0
            WHEN s.operational_status IN ('returned', 'return_to_sender') AND s.return_liability = 'sender_partial_fee' THEN s.applied_return_fee
            WHEN s.operational_status IN ('returned', 'return_to_sender') THEN COALESCE(NULLIF(s.applied_return_fee, 0), s.return_fee, 0)
            ELSE 0
          END
        )
        FROM public.shipments s
        WHERE s.tenant_id = p_tenant_id
          AND s.client_id = cl.id
          AND s.is_settled_to_client = false
          AND s.operational_status IN ('returned', 'return_to_sender')
      ), 0)::numeric(14,2) AS return_fees_deductible,
      -- Net ready to settle NOW (excluding COD shipments awaiting courier cash turn-in)
      COALESCE((
        SELECT SUM(
          CASE
            WHEN s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'COD' AND s.is_collected_from_courier = true
              THEN COALESCE(s.delivered_amount, s.recipient_collect_amount, 0) - s.total_shipping_fee
            WHEN s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'POSTPAID'
              THEN 0 - s.total_shipping_fee
            WHEN s.operational_status IN ('returned', 'return_to_sender') AND s.return_liability = 'recipient_paid_fee'
              THEN 0
            WHEN s.operational_status IN ('returned', 'return_to_sender') AND s.return_liability = 'sender_partial_fee'
              THEN 0 - s.applied_return_fee
            WHEN s.operational_status IN ('returned', 'return_to_sender')
              THEN 0 - COALESCE(NULLIF(s.applied_return_fee, 0), s.return_fee, 0)
            ELSE 0
          END
        )
        FROM public.shipments s
        WHERE s.tenant_id = p_tenant_id
          AND s.client_id = cl.id
          AND s.is_settled_to_client = false
          AND s.operational_status IN ('delivered', 'partially_delivered', 'returned', 'return_to_sender')
      ), 0)::numeric(14,2) AS ready_net_balance
    FROM public.clients cl
    WHERE cl.tenant_id = p_tenant_id
      AND cl.archived_at IS NULL
      AND (v_filter_client IS NULL OR cl.id = v_filter_client)
  ) q;

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.get_clients_settlement_overview(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_clients_settlement_overview(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_client_unsettled_shipments(
  p_tenant_id uuid,
  p_client_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT CASE
    WHEN NOT (
      app_private.current_user_is_platform_admin()
      OR app_private.user_is_tenant_admin(p_tenant_id)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.payouts.approve', NULL)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.approve', NULL)
      OR app_private.user_get_bound_client_id(p_tenant_id) = p_client_id
    ) THEN '[]'::jsonb
    ELSE COALESCE((
      SELECT jsonb_agg(row_to_json(q) ORDER BY q.created_at DESC)
      FROM (
        SELECT
          s.id AS shipment_id,
          s.shipment_number,
          s.operational_status,
          s.payment_term_code,
          s.price_mode,
          s.is_collected_from_courier,
          s.return_liability,
          s.delivered_at,
          s.returned_at,
          s.created_at,
          CASE
            WHEN s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'COD'
              THEN COALESCE(s.delivered_amount, s.recipient_collect_amount, 0)
            ELSE 0
          END AS cod_collected_amount,
          CASE
            WHEN s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code IN ('COD', 'POSTPAID')
              THEN s.total_shipping_fee
            ELSE 0
          END AS shipping_fee_deducted,
          CASE
            WHEN s.operational_status IN ('returned', 'return_to_sender') AND s.return_liability = 'recipient_paid_fee' THEN 0
            WHEN s.operational_status IN ('returned', 'return_to_sender') AND s.return_liability = 'sender_partial_fee' THEN s.applied_return_fee
            WHEN s.operational_status IN ('returned', 'return_to_sender') THEN COALESCE(NULLIF(s.applied_return_fee, 0), s.return_fee, 0)
            ELSE 0
          END AS return_fee_deducted,
          (
            CASE
              WHEN s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'COD'
                THEN COALESCE(s.delivered_amount, s.recipient_collect_amount, 0) - s.total_shipping_fee
              WHEN s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'POSTPAID'
                THEN 0 - s.total_shipping_fee
              WHEN s.operational_status IN ('returned', 'return_to_sender') AND s.return_liability = 'recipient_paid_fee'
                THEN 0
              WHEN s.operational_status IN ('returned', 'return_to_sender') AND s.return_liability = 'sender_partial_fee'
                THEN 0 - s.applied_return_fee
              WHEN s.operational_status IN ('returned', 'return_to_sender')
                THEN 0 - COALESCE(NULLIF(s.applied_return_fee, 0), s.return_fee, 0)
              ELSE 0
            END
          ) AS net_client_amount,
          (
            s.operational_status IN ('delivered', 'partially_delivered')
            AND s.payment_term_code = 'COD'
            AND COALESCE(s.delivered_amount, s.recipient_collect_amount, 0) > 0
            AND s.is_collected_from_courier = false
          ) AS awaiting_courier_cash
        FROM public.shipments s
        WHERE s.tenant_id = p_tenant_id
          AND s.client_id = p_client_id
          AND s.is_settled_to_client = false
          AND s.operational_status IN ('delivered', 'partially_delivered', 'returned', 'return_to_sender')
          AND NOT EXISTS (
            SELECT 1
            FROM public.client_settlement_items csi
            JOIN public.client_settlements cs ON cs.id = csi.settlement_id AND cs.tenant_id = csi.tenant_id
            WHERE csi.tenant_id = p_tenant_id
              AND csi.shipment_id = s.id
              AND cs.status IN ('draft', 'approved')
          )
      ) q
    ), '[]'::jsonb)
  END;
$$;

REVOKE ALL ON FUNCTION public.list_client_unsettled_shipments(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_client_unsettled_shipments(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_client_settlement(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_client_id uuid := (p_payload->>'client_id')::uuid;
  v_branch_id uuid := (p_payload->>'branch_id')::uuid;
  v_cashbox_id uuid := NULLIF(p_payload->>'cashbox_id', '')::uuid;
  v_payment_method_id uuid := NULLIF(p_payload->>'payment_method_id', '')::uuid;
  v_payout_method text := NULLIF(trim(COALESCE(p_payload->>'payout_method', '')), '');
  v_payout_ref text := NULLIF(trim(COALESCE(p_payload->>'payout_reference', '')), '');
  v_adjustment numeric(14,2) := COALESCE(NULLIF(p_payload->>'adjustment_amount', '')::numeric, 0);
  v_include_uncollected boolean := COALESCE((p_payload->>'include_uncollected_cod')::boolean, false);
  v_settlement_date date := COALESCE(NULLIF(p_payload->>'settlement_date', '')::date, current_date);
  v_notes text := NULLIF(trim(COALESCE(p_payload->>'notes', '')), '');

  v_client public.clients%ROWTYPE;
  v_shipment_ids uuid[];
  v_sid uuid;
  v_shp public.shipments%ROWTYPE;
  v_cod numeric(14,2);
  v_ship_ded numeric(14,2);
  v_ret_ded numeric(14,2);
  v_item_net numeric(14,2);

  v_sum_cod numeric(14,2) := 0;
  v_sum_ship numeric(14,2) := 0;
  v_sum_ret numeric(14,2) := 0;
  v_net_payable numeric(14,2) := 0;
  v_direction text;
  v_stl_id uuid;
  v_stl_code text;
BEGIN
  IF v_client_id IS NULL OR v_branch_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد العميل والفرع لإنشاء تسوية العميل.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.payouts.approve', NULL)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.create', v_branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.approve', v_branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: صلاحية إنشاء تسوية عميل غير متوفرة.';
  END IF;

  SELECT * INTO v_client
  FROM public.clients
  WHERE tenant_id = p_tenant_id AND id = v_client_id AND archived_at IS NULL;

  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'العميل المحدد غير موجود.';
  END IF;

  v_payout_method := COALESCE(v_payout_method, v_client.payout_method, 'cash');
  IF v_payout_method NOT IN ('cash', 'bank_transfer', 'vodafone_cash') THEN
    RAISE EXCEPTION 'وسيلة السداد غير صالحة.';
  END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'shipment_ids', '[]'::jsonb))::uuid)
  INTO v_shipment_ids;

  IF COALESCE(array_length(v_shipment_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'يجب اختيار شحنة واحدة على الأقل للتسوية.';
  END IF;

  v_stl_code := app_private.next_document_number(p_tenant_id, 'client_settlements');

  INSERT INTO public.client_settlements (
    tenant_id, settlement_code, settlement_date, branch_id, client_id,
    cashbox_id, payment_method_id, payout_method, payout_reference,
    adjustment_amount, net_payable_amount, cash_direction, status, notes,
    created_by, updated_by
  )
  VALUES (
    p_tenant_id, v_stl_code, v_settlement_date, v_branch_id, v_client_id,
    v_cashbox_id, v_payment_method_id, v_payout_method, v_payout_ref,
    v_adjustment, 0, 'zero_balance', 'draft', v_notes, auth.uid(), auth.uid()
  )
  RETURNING id INTO v_stl_id;

  FOREACH v_sid IN ARRAY v_shipment_ids LOOP
    SELECT * INTO v_shp
    FROM public.shipments
    WHERE tenant_id = p_tenant_id AND id = v_sid
    FOR UPDATE;

    IF v_shp.id IS NULL OR v_shp.client_id <> v_client_id THEN
      RAISE EXCEPTION 'إحدى الشحنات المحددة غير تابعة لهذا العميل.';
    END IF;

    IF v_shp.is_settled_to_client THEN
      RAISE EXCEPTION 'الشحنة (%) تمت تسويتها مسبقًا.', v_shp.shipment_number;
    END IF;

    IF v_shp.operational_status NOT IN ('delivered', 'partially_delivered', 'returned', 'return_to_sender') THEN
      RAISE EXCEPTION 'الشحنة (%) حالتها (%) وليست جاهزة للتسوية النهائية.', v_shp.shipment_number, v_shp.operational_status;
    END IF;

    IF NOT v_include_uncollected
       AND v_shp.operational_status IN ('delivered', 'partially_delivered')
       AND v_shp.payment_term_code = 'COD'
       AND COALESCE(v_shp.delivered_amount, v_shp.recipient_collect_amount, 0) > 0
       AND NOT v_shp.is_collected_from_courier THEN
      RAISE EXCEPTION 'الشحنة (%) لم يتم توريد نقديتها من المندوب للخزينة بعد (يجب التحصيل من المندوب أولاً).', v_shp.shipment_number;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.client_settlement_items csi
      JOIN public.client_settlements cs ON cs.id = csi.settlement_id AND cs.tenant_id = csi.tenant_id
      WHERE csi.tenant_id = p_tenant_id AND csi.shipment_id = v_sid AND cs.status IN ('draft', 'approved')
    ) THEN
      RAISE EXCEPTION 'الشحنة (%) مدرجة بالفعل في كشف تسوية نشط.', v_shp.shipment_number;
    END IF;

    v_cod := 0;
    v_ship_ded := 0;
    v_ret_ded := 0;

    IF v_shp.operational_status IN ('delivered', 'partially_delivered') THEN
      IF v_shp.payment_term_code = 'COD' THEN
        v_cod := COALESCE(v_shp.delivered_amount, v_shp.recipient_collect_amount, 0);
        v_ship_ded := v_shp.total_shipping_fee;
      ELSIF v_shp.payment_term_code = 'POSTPAID' THEN
        v_ship_ded := v_shp.total_shipping_fee;
      END IF;
    ELSE
      IF v_shp.return_liability = 'recipient_paid_fee' THEN
        v_ret_ded := 0;
      ELSIF v_shp.return_liability = 'sender_partial_fee' THEN
        v_ret_ded := COALESCE(v_shp.applied_return_fee, 0);
      ELSE
        v_ret_ded := COALESCE(NULLIF(v_shp.applied_return_fee, 0), v_shp.return_fee, 0);
      END IF;
    END IF;

    v_item_net := round(v_cod - v_ship_ded - v_ret_ded, 2);

    INSERT INTO public.client_settlement_items (
      tenant_id, settlement_id, shipment_id, payment_term_code, shipment_status,
      cod_collected_amount, shipping_fee_deducted, return_fee_deducted, net_client_amount
    )
    VALUES (
      p_tenant_id, v_stl_id, v_sid, v_shp.payment_term_code, v_shp.operational_status,
      v_cod, v_ship_ded, v_ret_ded, v_item_net
    );

    v_sum_cod := v_sum_cod + v_cod;
    v_sum_ship := v_sum_ship + v_ship_ded;
    v_sum_ret := v_sum_ret + v_ret_ded;
  END LOOP;

  v_net_payable := round(v_sum_cod - v_sum_ship - v_sum_ret + v_adjustment, 2);
  v_direction := CASE
    WHEN v_net_payable > 0 THEN 'payout_to_client'
    WHEN v_net_payable < 0 THEN 'receipt_from_client'
    ELSE 'zero_balance'
  END;

  UPDATE public.client_settlements
  SET gross_cod_collected = v_sum_cod,
      shipping_fees_deducted = v_sum_ship,
      return_fees_deducted = v_sum_ret,
      net_payable_amount = v_net_payable,
      cash_direction = v_direction,
      updated_by = auth.uid()
  WHERE id = v_stl_id AND tenant_id = p_tenant_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'client_settlement.created', 'client_settlements', v_stl_id,
    jsonb_build_object(
      'settlement_code', v_stl_code,
      'client_id', v_client_id,
      'gross_cod', v_sum_cod,
      'shipping_deducted', v_sum_ship,
      'return_deducted', v_sum_ret,
      'net_payable_amount', v_net_payable
    ),
    'rpc'
  );

  RETURN jsonb_build_object(
    'id', v_stl_id,
    'settlement_code', v_stl_code,
    'net_payable_amount', v_net_payable,
    'cash_direction', v_direction,
    'status', 'draft'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_client_settlement(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_client_settlement(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_client_settlement(
  p_tenant_id uuid,
  p_settlement_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_stl public.client_settlements%ROWTYPE;
  v_cashbox public.cashboxes%ROWTYPE;
  v_rec record;
  v_actor_name text;
  v_tx_code text;
  v_bal numeric(14,2);
BEGIN
  SELECT * INTO v_stl
  FROM public.client_settlements
  WHERE tenant_id = p_tenant_id AND id = p_settlement_id
  FOR UPDATE;

  IF v_stl.id IS NULL THEN
    RAISE EXCEPTION 'كشف تسوية العميل غير موجود.';
  END IF;

  IF v_stl.status <> 'draft' THEN
    RAISE EXCEPTION 'تم اعتماد أو إلغاء كشف التسوية بالفعل.';
  END IF;

  PERFORM app_private.assert_finance_approval_policy(
    p_tenant_id,
    v_stl.created_by,
    ABS(v_stl.net_payable_amount),
    'finance.payouts.approve',
    NULL
  );

  IF v_stl.cash_direction <> 'zero_balance' AND v_stl.cashbox_id IS NOT NULL THEN
    SELECT * INTO v_cashbox
    FROM public.cashboxes
    WHERE tenant_id = p_tenant_id AND id = v_stl.cashbox_id AND archived_at IS NULL AND is_active = true;

    IF v_cashbox.id IS NULL THEN
      RAISE EXCEPTION 'الخزينة المحددة للتسوية غير نشطة أو غير موجودة.';
    END IF;

    IF v_stl.cash_direction = 'payout_to_client' THEN
      IF NOT v_cashbox.allow_withdraw THEN
        RAISE EXCEPTION 'الخزينة المحددة لا تسمح بالصرف النقدي.';
      END IF;
      v_bal := app_private.get_cashbox_balance(p_tenant_id, v_cashbox.id);
      IF v_bal < v_stl.net_payable_amount THEN
        RAISE EXCEPTION 'رصيد الخزينة الحالي (% ج.م) غير كافٍ لصرف التسوية (% ج.م).',
          round(v_bal, 2), round(v_stl.net_payable_amount, 2);
      END IF;
    ELSIF v_stl.cash_direction = 'receipt_from_client' AND NOT v_cashbox.allow_deposit THEN
      RAISE EXCEPTION 'الخزينة المحددة لا تسمح بالإيداع.';
    END IF;
  END IF;

  SELECT COALESCE(display_name, 'مستخدم النظام') INTO v_actor_name
  FROM public.profiles WHERE id = auth.uid();

  PERFORM set_config('app_private.allow_shipment_mutation', 'on', true);

  FOR v_rec IN
    SELECT s.*, csi.net_client_amount
    FROM public.client_settlement_items csi
    JOIN public.shipments s ON s.tenant_id = csi.tenant_id AND s.id = csi.shipment_id
    WHERE csi.tenant_id = p_tenant_id AND csi.settlement_id = v_stl.id
    FOR UPDATE OF s
  LOOP
    IF v_rec.is_settled_to_client THEN
      RAISE EXCEPTION 'الشحنة (%) تمت تسويتها مسبقًا.', v_rec.shipment_number;
    END IF;

    UPDATE public.shipments
    SET is_settled_to_client = true,
        client_settlement_id = v_stl.id,
        updated_by = auth.uid()
    WHERE id = v_rec.id AND tenant_id = p_tenant_id;

    INSERT INTO public.shipment_status_events (
      tenant_id, shipment_id, event_code, from_status, to_status,
      branch_id, list_type, list_code, fees_snapshot, notes,
      actor_user_id, actor_display_name
    )
    VALUES (
      p_tenant_id, v_rec.id, 'finance.client_settled',
      v_rec.operational_status, v_rec.operational_status,
      v_stl.branch_id, 'client_settlement', v_stl.settlement_code,
      v_rec.net_client_amount,
      'تسوية مالية مع العميل عبر كشف ' || v_stl.settlement_code,
      auth.uid(), v_actor_name
    );
  END LOOP;

  PERFORM set_config('app_private.allow_shipment_mutation', 'off', true);

  IF v_stl.cash_direction <> 'zero_balance' AND v_stl.cashbox_id IS NOT NULL THEN
    v_tx_code := app_private.next_document_number(p_tenant_id, 'cashbox_transactions');
    INSERT INTO public.cashbox_transactions (
      tenant_id, transaction_code, cashbox_id, branch_id, transaction_date,
      transaction_type, direction, amount, reference_type, reference_id, reference_code,
      notes, actor_user_id
    )
    VALUES (
      p_tenant_id, v_tx_code, v_cashbox.id, v_stl.branch_id, v_stl.settlement_date,
      CASE WHEN v_stl.cash_direction = 'payout_to_client' THEN 'client_settlement_out' ELSE 'client_settlement_in' END,
      CASE WHEN v_stl.cash_direction = 'payout_to_client' THEN 'out' ELSE 'in' END,
      ABS(v_stl.net_payable_amount),
      'client_settlements', v_stl.id, v_stl.settlement_code,
      COALESCE(v_stl.notes, 'تسوية حساب العميل بكشف ' || v_stl.settlement_code),
      auth.uid()
    );
  END IF;

  UPDATE public.client_settlements
  SET status = 'approved',
      approved_at = now(),
      approved_by = auth.uid(),
      updated_by = auth.uid()
  WHERE id = v_stl.id AND tenant_id = p_tenant_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'client_settlement.approved', 'client_settlements', v_stl.id,
    jsonb_build_object(
      'settlement_code', v_stl.settlement_code,
      'net_payable_amount', v_stl.net_payable_amount,
      'cash_direction', v_stl.cash_direction
    ),
    'rpc'
  );

  RETURN jsonb_build_object(
    'id', v_stl.id,
    'settlement_code', v_stl.settlement_code,
    'status', 'approved',
    'net_payable_amount', v_stl.net_payable_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_client_settlement(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_client_settlement(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Courier Commission Payouts (CMP-*): Strictly Enforces ADR-012 Cash-First Rule
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_courier_payable_commissions(
  p_tenant_id uuid,
  p_courier_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT CASE
    WHEN NOT (
      app_private.current_user_is_platform_admin()
      OR app_private.user_is_tenant_admin(p_tenant_id)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.payouts.approve', NULL)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.approve', NULL)
      OR app_private.user_get_bound_courier_id(p_tenant_id) = p_courier_id
    ) THEN '[]'::jsonb
    ELSE COALESCE((
      SELECT jsonb_agg(row_to_json(q) ORDER BY q.delivered_at DESC NULLS LAST, q.created_at DESC)
      FROM (
        SELECT
          s.id AS shipment_id,
          s.shipment_number,
          s.operational_status,
          s.payment_term_code,
          s.is_collected_from_courier,
          s.accrued_courier_commission,
          s.delivered_at,
          s.created_at,
          (
            s.payment_term_code <> 'COD'
            OR COALESCE(s.delivered_amount, s.recipient_collect_amount, 0) <= 0
            OR s.is_collected_from_courier = true
          ) AS eligible_for_payout
        FROM public.shipments s
        WHERE s.tenant_id = p_tenant_id
          AND s.assigned_courier_id = p_courier_id
          AND s.operational_status IN ('delivered', 'partially_delivered')
          AND s.accrued_courier_commission > 0
          AND s.is_courier_commission_paid = false
          AND NOT EXISTS (
            SELECT 1
            FROM public.courier_commission_items cmpi
            JOIN public.courier_commission_payouts cmp
              ON cmp.id = cmpi.payout_id AND cmp.tenant_id = cmpi.tenant_id
            WHERE cmpi.tenant_id = p_tenant_id
              AND cmpi.shipment_id = s.id
              AND cmp.status IN ('draft', 'approved')
          )
      ) q
    ), '[]'::jsonb)
  END;
$$;

REVOKE ALL ON FUNCTION public.list_courier_payable_commissions(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_courier_payable_commissions(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_courier_commission_payout(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_branch_id uuid := (p_payload->>'branch_id')::uuid;
  v_courier_id uuid := (p_payload->>'courier_id')::uuid;
  v_cashbox_id uuid := (p_payload->>'cashbox_id')::uuid;
  v_payment_method_id uuid := NULLIF(p_payload->>'payment_method_id', '')::uuid;
  v_bonus numeric(14,2) := GREATEST(COALESCE(NULLIF(p_payload->>'bonus_amount', '')::numeric, 0), 0);
  v_deduction numeric(14,2) := GREATEST(COALESCE(NULLIF(p_payload->>'deduction_amount', '')::numeric, 0), 0);
  v_payout_date date := COALESCE(NULLIF(p_payload->>'payout_date', '')::date, current_date);
  v_notes text := NULLIF(trim(COALESCE(p_payload->>'notes', '')), '');
  v_shipment_ids uuid[];
  v_sid uuid;
  v_shp public.shipments%ROWTYPE;
  v_total_comm numeric(14,2) := 0;
  v_net numeric(14,2);
  v_payout_id uuid;
  v_payout_code text;
BEGIN
  IF v_branch_id IS NULL OR v_courier_id IS NULL OR v_cashbox_id IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد الفرع والمندوب وخزينة الصرف.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.payouts.approve', NULL)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.create', v_branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.approve', v_branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: صلاحية إعداد صرف عمولات المناديب غير متوفرة.';
  END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->'shipment_ids', '[]'::jsonb))::uuid)
  INTO v_shipment_ids;

  IF COALESCE(array_length(v_shipment_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'يجب اختيار شحنة واحدة على الأقل مستحقة العمولة.';
  END IF;

  v_payout_code := app_private.next_document_number(p_tenant_id, 'courier_commission_payouts');

  INSERT INTO public.courier_commission_payouts (
    tenant_id, payout_code, payout_date, branch_id, courier_id, cashbox_id,
    payment_method_id, total_commission_amount, bonus_amount, deduction_amount,
    net_payout_amount, status, notes, created_by, updated_by
  )
  VALUES (
    p_tenant_id, v_payout_code, v_payout_date, v_branch_id, v_courier_id, v_cashbox_id,
    v_payment_method_id, 0, v_bonus, v_deduction, 0, 'draft', v_notes, auth.uid(), auth.uid()
  )
  RETURNING id INTO v_payout_id;

  FOREACH v_sid IN ARRAY v_shipment_ids LOOP
    SELECT * INTO v_shp
    FROM public.shipments
    WHERE tenant_id = p_tenant_id AND id = v_sid
    FOR UPDATE;

    IF v_shp.id IS NULL OR v_shp.assigned_courier_id <> v_courier_id THEN
      RAISE EXCEPTION 'إحدى الشحنات المحددة غير تابعة لهذا المندوب.';
    END IF;

    IF v_shp.is_courier_commission_paid THEN
      RAISE EXCEPTION 'عمولة الشحنة (%) تم صرفها مسبقًا.', v_shp.shipment_number;
    END IF;

    IF v_shp.operational_status NOT IN ('delivered', 'partially_delivered') OR v_shp.accrued_courier_commission <= 0 THEN
      RAISE EXCEPTION 'الشحنة (%) لا تستحق عمولة تسليم معتمدة.', v_shp.shipment_number;
    END IF;

    -- ADR-012 Critical Rule: COD Cash Custody MUST be collected before Commission Payout!
    IF v_shp.payment_term_code = 'COD'
       AND COALESCE(v_shp.delivered_amount, v_shp.recipient_collect_amount, 0) > 0
       AND NOT v_shp.is_collected_from_courier THEN
      RAISE EXCEPTION 'لا يمكن صرف عمولة الشحنة (%) قبل توريد نقدية الـ COD للخزينة واعتماد التحصيل أولًا (ADR-012).', v_shp.shipment_number;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.courier_commission_items cmpi
      JOIN public.courier_commission_payouts cmp ON cmp.id = cmpi.payout_id AND cmp.tenant_id = cmpi.tenant_id
      WHERE cmpi.tenant_id = p_tenant_id AND cmpi.shipment_id = v_sid AND cmp.status IN ('draft', 'approved')
    ) THEN
      RAISE EXCEPTION 'عمولة الشحنة (%) مدرجة في سند صرف نشط.', v_shp.shipment_number;
    END IF;

    INSERT INTO public.courier_commission_items (
      tenant_id, payout_id, shipment_id, commission_amount
    )
    VALUES (
      p_tenant_id, v_payout_id, v_sid, v_shp.accrued_courier_commission
    );

    v_total_comm := v_total_comm + v_shp.accrued_courier_commission;
  END LOOP;

  v_net := GREATEST(round(v_total_comm + v_bonus - v_deduction, 2), 0);

  UPDATE public.courier_commission_payouts
  SET total_commission_amount = v_total_comm,
      net_payout_amount = v_net,
      updated_by = auth.uid()
  WHERE id = v_payout_id AND tenant_id = p_tenant_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'courier_commission_payout.created', 'courier_commission_payouts', v_payout_id,
    jsonb_build_object(
      'payout_code', v_payout_code,
      'courier_id', v_courier_id,
      'total_commission', v_total_comm,
      'net_payout_amount', v_net
    ),
    'rpc'
  );

  RETURN jsonb_build_object(
    'id', v_payout_id,
    'payout_code', v_payout_code,
    'total_commission_amount', v_total_comm,
    'net_payout_amount', v_net,
    'status', 'draft'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_courier_commission_payout(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_courier_commission_payout(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_courier_commission_payout(
  p_tenant_id uuid,
  p_payout_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_payout public.courier_commission_payouts%ROWTYPE;
  v_cashbox public.cashboxes%ROWTYPE;
  v_rec record;
  v_actor_name text;
  v_tx_code text;
  v_bal numeric(14,2);
BEGIN
  SELECT * INTO v_payout
  FROM public.courier_commission_payouts
  WHERE tenant_id = p_tenant_id AND id = p_payout_id
  FOR UPDATE;

  IF v_payout.id IS NULL THEN
    RAISE EXCEPTION 'سند صرف العمولات غير موجود.';
  END IF;

  IF v_payout.status <> 'draft' THEN
    RAISE EXCEPTION 'سند صرف العمولات معتمد أو ملغى بالفعل.';
  END IF;

  PERFORM app_private.assert_finance_approval_policy(
    p_tenant_id,
    v_payout.created_by,
    v_payout.net_payout_amount,
    'finance.payouts.approve',
    NULL
  );

  SELECT * INTO v_cashbox
  FROM public.cashboxes
  WHERE tenant_id = p_tenant_id AND id = v_payout.cashbox_id AND archived_at IS NULL AND is_active = true;

  IF v_cashbox.id IS NULL OR NOT v_cashbox.allow_withdraw THEN
    RAISE EXCEPTION 'الخزينة غير نشطة أو لا تسمح بالصرف النقدي.';
  END IF;

  IF v_payout.net_payout_amount > 0 THEN
    v_bal := app_private.get_cashbox_balance(p_tenant_id, v_cashbox.id);
    IF v_bal < v_payout.net_payout_amount THEN
      RAISE EXCEPTION 'رصيد الخزينة (% ج.م) غير كافٍ لصرف العمولات (% ج.م).',
        round(v_bal, 2), round(v_payout.net_payout_amount, 2);
    END IF;
  END IF;

  SELECT COALESCE(display_name, 'مستخدم النظام') INTO v_actor_name
  FROM public.profiles WHERE id = auth.uid();

  PERFORM set_config('app_private.allow_shipment_mutation', 'on', true);

  FOR v_rec IN
    SELECT s.*, cmpi.commission_amount
    FROM public.courier_commission_items cmpi
    JOIN public.shipments s ON s.tenant_id = cmpi.tenant_id AND s.id = cmpi.shipment_id
    WHERE cmpi.tenant_id = p_tenant_id AND cmpi.payout_id = v_payout.id
    FOR UPDATE OF s
  LOOP
    IF v_rec.is_courier_commission_paid THEN
      RAISE EXCEPTION 'تم صرف عمولة الشحنة (%) مسبقًا.', v_rec.shipment_number;
    END IF;

    UPDATE public.shipments
    SET is_courier_commission_paid = true,
        courier_commission_payout_id = v_payout.id,
        updated_by = auth.uid()
    WHERE id = v_rec.id AND tenant_id = p_tenant_id;

    INSERT INTO public.shipment_status_events (
      tenant_id, shipment_id, event_code, from_status, to_status,
      branch_id, courier_id, list_type, list_code, fees_snapshot, notes,
      actor_user_id, actor_display_name
    )
    VALUES (
      p_tenant_id, v_rec.id, 'finance.courier_commission_paid',
      v_rec.operational_status, v_rec.operational_status,
      v_payout.branch_id, v_payout.courier_id, 'courier_commission_payout', v_payout.payout_code,
      v_rec.commission_amount,
      'صرف عمولة المندوب بسند ' || v_payout.payout_code,
      auth.uid(), v_actor_name
    );
  END LOOP;

  PERFORM set_config('app_private.allow_shipment_mutation', 'off', true);

  IF v_payout.net_payout_amount > 0 THEN
    v_tx_code := app_private.next_document_number(p_tenant_id, 'cashbox_transactions');
    INSERT INTO public.cashbox_transactions (
      tenant_id, transaction_code, cashbox_id, branch_id, transaction_date,
      transaction_type, direction, amount, reference_type, reference_id, reference_code,
      notes, actor_user_id
    )
    VALUES (
      p_tenant_id, v_tx_code, v_cashbox.id, v_payout.branch_id, v_payout.payout_date,
      'commission_payout_out', 'out', v_payout.net_payout_amount,
      'courier_commission_payouts', v_payout.id, v_payout.payout_code,
      COALESCE(v_payout.notes, 'صرف عمولات المندوب بسند ' || v_payout.payout_code),
      auth.uid()
    );
  END IF;

  UPDATE public.courier_commission_payouts
  SET status = 'approved',
      approved_at = now(),
      approved_by = auth.uid(),
      updated_by = auth.uid()
  WHERE id = v_payout.id AND tenant_id = p_tenant_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'courier_commission_payout.approved', 'courier_commission_payouts', v_payout.id,
    jsonb_build_object(
      'payout_code', v_payout.payout_code,
      'net_payout_amount', v_payout.net_payout_amount
    ),
    'rpc'
  );

  RETURN jsonb_build_object(
    'id', v_payout.id,
    'payout_code', v_payout.payout_code,
    'status', 'approved',
    'net_payout_amount', v_payout.net_payout_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_courier_commission_payout(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_courier_commission_payout(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Cashbox Transfers (CTR-*) & General Cashbox Vouchers (RCV-* / PAY-*)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_cashbox_transfer(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_from_id uuid := (p_payload->>'from_cashbox_id')::uuid;
  v_to_id uuid := (p_payload->>'to_cashbox_id')::uuid;
  v_amount numeric(14,2) := COALESCE(NULLIF(p_payload->>'amount', '')::numeric, 0);
  v_date date := COALESCE(NULLIF(p_payload->>'transfer_date', '')::date, current_date);
  v_notes text := NULLIF(trim(COALESCE(p_payload->>'notes', '')), '');
  v_from public.cashboxes%ROWTYPE;
  v_to public.cashboxes%ROWTYPE;
  v_code text;
  v_id uuid;
BEGIN
  IF v_from_id IS NULL OR v_to_id IS NULL OR v_from_id = v_to_id THEN
    RAISE EXCEPTION 'يجب اختيار خزينتين مختلفتين للتحويل.';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'مبلغ التحويل يجب أن يكون أكبر من صفر.';
  END IF;

  SELECT * INTO v_from FROM public.cashboxes WHERE tenant_id = p_tenant_id AND id = v_from_id AND archived_at IS NULL AND is_active = true;
  SELECT * INTO v_to FROM public.cashboxes WHERE tenant_id = p_tenant_id AND id = v_to_id AND archived_at IS NULL AND is_active = true;

  IF v_from.id IS NULL OR NOT v_from.allow_transfer_out THEN
    RAISE EXCEPTION 'الخزينة المصدر غير نشطة أو لا تسمح بالتحويل الصادر.';
  END IF;

  IF v_to.id IS NULL OR NOT v_to.allow_transfer_in THEN
    RAISE EXCEPTION 'الخزينة الوجهة غير نشطة أو لا تسمح بالتحويل الوارد.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.create', v_from.branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.approve', v_from.branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: صلاحية إنشاء تحويل خزينة غير متوفرة.';
  END IF;

  v_code := app_private.next_document_number(p_tenant_id, 'cashbox_transfers');

  INSERT INTO public.cashbox_transfers (
    tenant_id, transfer_code, transfer_date, from_cashbox_id, to_cashbox_id,
    amount, status, notes, created_by, updated_by
  )
  VALUES (
    p_tenant_id, v_code, v_date, v_from_id, v_to_id,
    v_amount, 'draft', v_notes, auth.uid(), auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'cashbox_transfer.created', 'cashbox_transfers', v_id,
    jsonb_build_object('transfer_code', v_code, 'from_cashbox_id', v_from_id, 'to_cashbox_id', v_to_id, 'amount', v_amount),
    'rpc'
  );

  RETURN jsonb_build_object('id', v_id, 'transfer_code', v_code, 'amount', v_amount, 'status', 'draft');
END;
$$;

REVOKE ALL ON FUNCTION public.create_cashbox_transfer(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_cashbox_transfer(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_cashbox_transfer(
  p_tenant_id uuid,
  p_transfer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_tr public.cashbox_transfers%ROWTYPE;
  v_from public.cashboxes%ROWTYPE;
  v_to public.cashboxes%ROWTYPE;
  v_bal numeric(14,2);
  v_tx_out text;
  v_tx_in text;
BEGIN
  SELECT * INTO v_tr
  FROM public.cashbox_transfers
  WHERE tenant_id = p_tenant_id AND id = p_transfer_id
  FOR UPDATE;

  IF v_tr.id IS NULL OR v_tr.status <> 'draft' THEN
    RAISE EXCEPTION 'سند التحويل غير موجود أو غير متاح للاعتماد.';
  END IF;

  SELECT * INTO v_from FROM public.cashboxes WHERE tenant_id = p_tenant_id AND id = v_tr.from_cashbox_id;
  SELECT * INTO v_to FROM public.cashboxes WHERE tenant_id = p_tenant_id AND id = v_tr.to_cashbox_id;

  PERFORM app_private.assert_finance_approval_policy(
    p_tenant_id,
    v_tr.created_by,
    v_tr.amount,
    'finance.collections.approve',
    v_from.branch_id
  );

  v_bal := app_private.get_cashbox_balance(p_tenant_id, v_from.id);
  IF v_bal < v_tr.amount THEN
    RAISE EXCEPTION 'رصيد الخزينة المصدر (% ج.م) غير كافٍ لإتمام التحويل (% ج.م).', round(v_bal, 2), round(v_tr.amount, 2);
  END IF;

  v_tx_out := app_private.next_document_number(p_tenant_id, 'cashbox_transactions');
  INSERT INTO public.cashbox_transactions (
    tenant_id, transaction_code, cashbox_id, branch_id, transaction_date,
    transaction_type, direction, amount, reference_type, reference_id, reference_code,
    notes, actor_user_id
  )
  VALUES (
    p_tenant_id, v_tx_out, v_from.id, v_from.branch_id, v_tr.transfer_date,
    'transfer_out', 'out', v_tr.amount, 'cashbox_transfers', v_tr.id, v_tr.transfer_code,
    COALESCE(v_tr.notes, 'تحويل صادر إلى ' || v_to.name), auth.uid()
  );

  v_tx_in := app_private.next_document_number(p_tenant_id, 'cashbox_transactions');
  INSERT INTO public.cashbox_transactions (
    tenant_id, transaction_code, cashbox_id, branch_id, transaction_date,
    transaction_type, direction, amount, reference_type, reference_id, reference_code,
    notes, actor_user_id
  )
  VALUES (
    p_tenant_id, v_tx_in, v_to.id, v_to.branch_id, v_tr.transfer_date,
    'transfer_in', 'in', v_tr.amount, 'cashbox_transfers', v_tr.id, v_tr.transfer_code,
    COALESCE(v_tr.notes, 'تحويل وارد من ' || v_from.name), auth.uid()
  );

  UPDATE public.cashbox_transfers
  SET status = 'approved',
      approved_at = now(),
      approved_by = auth.uid(),
      updated_by = auth.uid()
  WHERE id = v_tr.id AND tenant_id = p_tenant_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'cashbox_transfer.approved', 'cashbox_transfers', v_tr.id,
    jsonb_build_object('transfer_code', v_tr.transfer_code, 'amount', v_tr.amount),
    'rpc'
  );

  RETURN jsonb_build_object('id', v_tr.id, 'transfer_code', v_tr.transfer_code, 'status', 'approved');
END;
$$;

REVOKE ALL ON FUNCTION public.approve_cashbox_transfer(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_cashbox_transfer(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_cashbox_voucher(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_type text := COALESCE(NULLIF(trim(p_payload->>'voucher_type'), ''), 'receipt');
  v_cashbox_id uuid := (p_payload->>'cashbox_id')::uuid;
  v_client_id uuid := NULLIF(p_payload->>'client_id', '')::uuid;
  v_amount numeric(14,2) := COALESCE(NULLIF(p_payload->>'amount', '')::numeric, 0);
  v_date date := COALESCE(NULLIF(p_payload->>'voucher_date', '')::date, current_date);
  v_party text := NULLIF(trim(COALESCE(p_payload->>'party_name', '')), '');
  v_notes text := NULLIF(trim(COALESCE(p_payload->>'notes', '')), '');
  v_cashbox public.cashboxes%ROWTYPE;
  v_code text;
  v_id uuid;
BEGIN
  IF v_type NOT IN ('receipt', 'payment', 'prepaid_deposit') THEN
    RAISE EXCEPTION 'نوع السند غير صالح.';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'مبلغ السند يجب أن يكون أكبر من صفر.';
  END IF;

  SELECT * INTO v_cashbox FROM public.cashboxes WHERE tenant_id = p_tenant_id AND id = v_cashbox_id AND archived_at IS NULL AND is_active = true;
  IF v_cashbox.id IS NULL THEN
    RAISE EXCEPTION 'الخزينة المحددة غير موجودة أو غير نشطة.';
  END IF;

  IF v_type IN ('receipt', 'prepaid_deposit') AND NOT v_cashbox.allow_deposit THEN
    RAISE EXCEPTION 'الخزينة لا تسمح بالإيداع.';
  END IF;

  IF v_type = 'payment' AND NOT v_cashbox.allow_withdraw THEN
    RAISE EXCEPTION 'الخزينة لا تسمح بالصرف.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.create', v_cashbox.branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.collections.approve', v_cashbox.branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'finance.payouts.approve', NULL)
  ) THEN
    RAISE EXCEPTION 'Forbidden: صلاحية إنشاء السند النقدي غير متوفرة.';
  END IF;

  v_code := app_private.next_document_number(
    p_tenant_id,
    CASE WHEN v_type = 'payment' THEN 'payment_vouchers' ELSE 'receipt_vouchers' END
  );

  INSERT INTO public.cashbox_vouchers (
    tenant_id, voucher_code, voucher_type, voucher_date, branch_id, cashbox_id,
    client_id, amount, party_name, status, notes, created_by, updated_by
  )
  VALUES (
    p_tenant_id, v_code, v_type, v_date, v_cashbox.branch_id, v_cashbox.id,
    v_client_id, v_amount, v_party, 'draft', v_notes, auth.uid(), auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'cashbox_voucher.created', 'cashbox_vouchers', v_id,
    jsonb_build_object('voucher_code', v_code, 'voucher_type', v_type, 'amount', v_amount),
    'rpc'
  );

  RETURN jsonb_build_object('id', v_id, 'voucher_code', v_code, 'voucher_type', v_type, 'status', 'draft');
END;
$$;

REVOKE ALL ON FUNCTION public.create_cashbox_voucher(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_cashbox_voucher(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_cashbox_voucher(
  p_tenant_id uuid,
  p_voucher_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_cv public.cashbox_vouchers%ROWTYPE;
  v_bal numeric(14,2);
  v_tx_code text;
BEGIN
  SELECT * INTO v_cv
  FROM public.cashbox_vouchers
  WHERE tenant_id = p_tenant_id AND id = p_voucher_id
  FOR UPDATE;

  IF v_cv.id IS NULL OR v_cv.status <> 'draft' THEN
    RAISE EXCEPTION 'السند غير موجود أو غير متاح للاعتماد.';
  END IF;

  PERFORM app_private.assert_finance_approval_policy(
    p_tenant_id,
    v_cv.created_by,
    v_cv.amount,
    CASE WHEN v_cv.voucher_type = 'payment' THEN 'finance.payouts.approve' ELSE 'finance.collections.approve' END,
    CASE WHEN v_cv.voucher_type = 'payment' THEN NULL ELSE v_cv.branch_id END
  );

  IF v_cv.voucher_type = 'payment' THEN
    v_bal := app_private.get_cashbox_balance(p_tenant_id, v_cv.cashbox_id);
    IF v_bal < v_cv.amount THEN
      RAISE EXCEPTION 'رصيد الخزينة (% ج.م) غير كافٍ لصرف السند (% ج.م).', round(v_bal, 2), round(v_cv.amount, 2);
    END IF;
  END IF;

  v_tx_code := app_private.next_document_number(p_tenant_id, 'cashbox_transactions');

  INSERT INTO public.cashbox_transactions (
    tenant_id, transaction_code, cashbox_id, branch_id, transaction_date,
    transaction_type, direction, amount, reference_type, reference_id, reference_code,
    notes, actor_user_id
  )
  VALUES (
    p_tenant_id, v_tx_code, v_cv.cashbox_id, v_cv.branch_id, v_cv.voucher_date,
    CASE v_cv.voucher_type
      WHEN 'payment' THEN 'manual_payment_out'
      WHEN 'prepaid_deposit' THEN 'prepaid_deposit_in'
      ELSE 'manual_receipt_in'
    END,
    CASE WHEN v_cv.voucher_type = 'payment' THEN 'out' ELSE 'in' END,
    v_cv.amount, 'cashbox_vouchers', v_cv.id, v_cv.voucher_code,
    COALESCE(v_cv.notes, v_cv.party_name, 'اعتماد سند ' || v_cv.voucher_code),
    auth.uid()
  );

  UPDATE public.cashbox_vouchers
  SET status = 'approved',
      approved_at = now(),
      approved_by = auth.uid(),
      updated_by = auth.uid()
  WHERE id = v_cv.id AND tenant_id = p_tenant_id;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, auth.uid(), 'cashbox_voucher.approved', 'cashbox_vouchers', v_cv.id,
    jsonb_build_object('voucher_code', v_cv.voucher_code, 'voucher_type', v_cv.voucher_type, 'amount', v_cv.amount),
    'rpc'
  );

  RETURN jsonb_build_object('id', v_cv.id, 'voucher_code', v_cv.voucher_code, 'status', 'approved');
END;
$$;

REVOKE ALL ON FUNCTION public.approve_cashbox_voucher(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_cashbox_voucher(uuid, uuid) TO authenticated;
