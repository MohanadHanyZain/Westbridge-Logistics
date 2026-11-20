import {getSupabaseClient} from '@/lib/supabase/client';
import type {
  CashboxBalanceRecord,
  CashboxTransactionRecord,
  CashboxTransferRecord,
  CashboxVoucherRecord,
  ClientSettlementOverviewRecord,
  ClientSettlementRecord,
  ClientUnsettledShipmentItem,
  CourierCollectionVoucherRecord,
  CourierCommissionPayoutRecord,
  CourierCustodyOverviewRecord,
  PayableCommissionShipmentItem,
  TenantFinancePolicyRecord,
  UncollectedCashShipmentItem,
} from '@/types/finance';

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }
  return client;
}

// ----------------------------------------------------------------------------
// ADR-018 Finance Governance Policy & Cashboxes Overview
// ----------------------------------------------------------------------------
export async function getTenantFinancePolicy(tenantId: string): Promise<TenantFinancePolicyRecord> {
  const client = requireClient();
  const {data, error} = await client
    .from('tenant_settings')
    .select('tenant_id, enforce_four_eyes, allow_owner_self_approve, high_value_approval_threshold')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error || !data) {
    return {
      tenant_id: tenantId,
      enforce_four_eyes: true,
      allow_owner_self_approve: true,
      high_value_approval_threshold: 0,
    };
  }

  return {
    tenant_id: tenantId,
    enforce_four_eyes: Boolean((data as {enforce_four_eyes?: boolean}).enforce_four_eyes ?? true),
    allow_owner_self_approve: Boolean((data as {allow_owner_self_approve?: boolean}).allow_owner_self_approve ?? true),
    high_value_approval_threshold: Number((data as {high_value_approval_threshold?: number}).high_value_approval_threshold ?? 0),
  };
}

export async function updateTenantFinancePolicy(
  tenantId: string,
  input: {
    readonly enforce_four_eyes: boolean;
    readonly allow_owner_self_approve: boolean;
    readonly high_value_approval_threshold: number;
  },
): Promise<TenantFinancePolicyRecord> {
  const client = requireClient();
  const {data, error} = await client.rpc('update_tenant_finance_policy', {
    p_tenant_id: tenantId,
    p_enforce_four_eyes: input.enforce_four_eyes,
    p_allow_owner_self_approve: input.allow_owner_self_approve,
    p_high_value_threshold: input.high_value_approval_threshold,
  });

  if (error) {
    throw new Error(error.message || 'تعذر تحديث سياسة الرقابة المالية وحدود الاعتماد.');
  }
  return data as TenantFinancePolicyRecord;
}

export async function getCashboxesWithBalances(tenantId: string): Promise<readonly CashboxBalanceRecord[]> {
  const client = requireClient();
  const {data, error} = await client.rpc('get_cashboxes_with_balances', {
    p_tenant_id: tenantId,
  });
  if (error) throw new Error(error.message || 'تعذر تحميل أرصدة الخزائن.');
  return (Array.isArray(data) ? data : []) as CashboxBalanceRecord[];
}

export async function listCashboxTransactions(
  tenantId: string,
  cashboxId?: string,
): Promise<readonly CashboxTransactionRecord[]> {
  const client = requireClient();
  let query = client
    .from('cashbox_transactions')
    .select(
      'id, tenant_id, transaction_code, cashbox_id, branch_id, transaction_date, transaction_type, direction, amount, reference_type, reference_id, reference_code, notes, actor_user_id, created_at',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', {ascending: false})
    .limit(200);

  if (cashboxId) {
    query = query.eq('cashbox_id', cashboxId);
  }

  const {data, error} = await query;
  if (error) throw new Error('تعذر تحميل سجل حركات الخزينة.');
  return (data ?? []) as CashboxTransactionRecord[];
}

export async function listCashboxTransfers(tenantId: string): Promise<readonly CashboxTransferRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('cashbox_transfers')
    .select(
      'id, tenant_id, transfer_code, transfer_date, from_cashbox_id, to_cashbox_id, amount, status, notes, approved_at, approved_by, created_at, created_by',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', {ascending: false})
    .limit(100);
  if (error) throw new Error('تعذر تحميل تحويلات الخزائن.');
  return (data ?? []) as CashboxTransferRecord[];
}

export async function createCashboxTransfer(
  tenantId: string,
  payload: {
    readonly from_cashbox_id: string;
    readonly to_cashbox_id: string;
    readonly amount: number;
    readonly transfer_date?: string;
    readonly notes?: string;
  },
): Promise<{readonly id: string; readonly transfer_code: string}> {
  const client = requireClient();
  const {data, error} = await client.rpc('create_cashbox_transfer', {
    p_tenant_id: tenantId,
    p_payload: payload,
  });
  if (error) throw new Error(error.message || 'تعذر إنشاء طلب التحويل بين الخزائن.');
  return data as {id: string; transfer_code: string};
}

export async function approveCashboxTransfer(tenantId: string, transferId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('approve_cashbox_transfer', {
    p_tenant_id: tenantId,
    p_transfer_id: transferId,
  });
  if (error) throw new Error(error.message || 'تعذر اعتماد التحويل بين الخزائن.');
}

export async function listCashboxVouchers(tenantId: string): Promise<readonly CashboxVoucherRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('cashbox_vouchers')
    .select(
      'id, tenant_id, voucher_code, voucher_type, voucher_date, branch_id, cashbox_id, client_id, amount, party_name, status, notes, approved_at, approved_by, created_at, created_by',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', {ascending: false})
    .limit(100);
  if (error) throw new Error('تعذر تحميل سندات القبض والصرف.');
  return (data ?? []) as CashboxVoucherRecord[];
}

export async function createCashboxVoucher(
  tenantId: string,
  payload: {
    readonly voucher_type: 'receipt' | 'payment' | 'prepaid_deposit';
    readonly cashbox_id: string;
    readonly client_id?: string | null;
    readonly amount: number;
    readonly voucher_date?: string;
    readonly party_name?: string;
    readonly notes?: string;
  },
): Promise<{readonly id: string; readonly voucher_code: string}> {
  const client = requireClient();
  const {data, error} = await client.rpc('create_cashbox_voucher', {
    p_tenant_id: tenantId,
    p_payload: payload,
  });
  if (error) throw new Error(error.message || 'تعذر إنشاء السند المالي.');
  return data as {id: string; voucher_code: string};
}

export async function approveCashboxVoucher(tenantId: string, voucherId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('approve_cashbox_voucher', {
    p_tenant_id: tenantId,
    p_voucher_id: voucherId,
  });
  if (error) throw new Error(error.message || 'تعذر اعتماد السند المالي.');
}

// ----------------------------------------------------------------------------
// Courier Collections & Custody (COL-*)
// ----------------------------------------------------------------------------
export async function getCourierCustodyOverview(
  tenantId: string,
  courierId?: string | null,
): Promise<readonly CourierCustodyOverviewRecord[]> {
  const client = requireClient();
  const {data, error} = await client.rpc('get_courier_custody_overview', {
    p_tenant_id: tenantId,
    p_courier_id: courierId ?? null,
  });
  if (error) throw new Error(error.message || 'تعذر تحميل ملخص عهد المناديب.');
  return (Array.isArray(data) ? data : []) as CourierCustodyOverviewRecord[];
}

export async function listCourierUncollectedCashShipments(
  tenantId: string,
  courierId: string,
): Promise<readonly UncollectedCashShipmentItem[]> {
  const client = requireClient();
  const {data, error} = await client.rpc('list_courier_uncollected_cash_shipments', {
    p_tenant_id: tenantId,
    p_courier_id: courierId,
  });
  if (error) throw new Error(error.message || 'تعذر تحميل شحنات التحصيل غير الموردة.');
  return (Array.isArray(data) ? data : []) as UncollectedCashShipmentItem[];
}

export async function listCourierCollectionVouchers(
  tenantId: string,
): Promise<readonly CourierCollectionVoucherRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('courier_collection_vouchers')
    .select(
      'id, tenant_id, voucher_code, voucher_date, branch_id, courier_id, cashbox_id, total_expected_amount, total_collected_amount, variance_amount, status, notes, approved_at, approved_by, created_at, created_by',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', {ascending: false})
    .limit(120);
  if (error) throw new Error('تعذر تحميل سندات التحصيل من المناديب.');
  return (data ?? []) as CourierCollectionVoucherRecord[];
}

export async function createCourierCollectionVoucher(
  tenantId: string,
  payload: {
    readonly branch_id: string;
    readonly courier_id: string;
    readonly cashbox_id: string;
    readonly shipment_ids: readonly string[];
    readonly collected_amount?: number;
    readonly voucher_date?: string;
    readonly notes?: string;
  },
): Promise<{readonly id: string; readonly voucher_code: string; readonly total_collected_amount: number}> {
  const client = requireClient();
  const {data, error} = await client.rpc('create_courier_collection_voucher', {
    p_tenant_id: tenantId,
    p_payload: payload,
  });
  if (error) throw new Error(error.message || 'تعذر إنشاء سند التحصيل من المندوب.');
  return data as {id: string; voucher_code: string; total_collected_amount: number};
}

export async function approveCourierCollectionVoucher(tenantId: string, voucherId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('approve_courier_collection_voucher', {
    p_tenant_id: tenantId,
    p_voucher_id: voucherId,
  });
  if (error) throw new Error(error.message || 'تعذر اعتماد سند التحصيل.');
}

// ----------------------------------------------------------------------------
// Client Settlements (CST-*)
// ----------------------------------------------------------------------------
export async function getClientsSettlementOverview(
  tenantId: string,
  clientId?: string | null,
): Promise<readonly ClientSettlementOverviewRecord[]> {
  const client = requireClient();
  const {data, error} = await client.rpc('get_clients_settlement_overview', {
    p_tenant_id: tenantId,
    p_client_id: clientId ?? null,
  });
  if (error) throw new Error(error.message || 'تعذر تحميل ملخص تسويات العملاء.');
  return (Array.isArray(data) ? data : []) as ClientSettlementOverviewRecord[];
}

export async function listClientUnsettledShipments(
  tenantId: string,
  clientId: string,
): Promise<readonly ClientUnsettledShipmentItem[]> {
  const client = requireClient();
  const {data, error} = await client.rpc('list_client_unsettled_shipments', {
    p_tenant_id: tenantId,
    p_client_id: clientId,
  });
  if (error) throw new Error(error.message || 'تعذر تحميل الشحنات الجاهزة للتسوية.');
  return (Array.isArray(data) ? data : []) as ClientUnsettledShipmentItem[];
}

export async function listClientSettlements(tenantId: string): Promise<readonly ClientSettlementRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('client_settlements')
    .select(
      'id, tenant_id, settlement_code, settlement_date, branch_id, client_id, cashbox_id, payout_method, payout_reference, gross_cod_collected, shipping_fees_deducted, return_fees_deducted, adjustment_amount, net_payable_amount, cash_direction, status, notes, approved_at, approved_by, created_at, created_by',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', {ascending: false})
    .limit(120);
  if (error) throw new Error('تعذر تحميل كشوف تسويات العملاء.');
  return (data ?? []) as ClientSettlementRecord[];
}

export async function createClientSettlement(
  tenantId: string,
  payload: {
    readonly client_id: string;
    readonly branch_id: string;
    readonly cashbox_id?: string | null;
    readonly payout_method?: string;
    readonly payout_reference?: string;
    readonly adjustment_amount?: number;
    readonly include_uncollected_cod?: boolean;
    readonly shipment_ids: readonly string[];
    readonly notes?: string;
  },
): Promise<{readonly id: string; readonly settlement_code: string; readonly net_payable_amount: number}> {
  const client = requireClient();
  const {data, error} = await client.rpc('create_client_settlement', {
    p_tenant_id: tenantId,
    p_payload: payload,
  });
  if (error) throw new Error(error.message || 'تعذر إنشاء كشف تسوية العميل.');
  return data as {id: string; settlement_code: string; net_payable_amount: number};
}

export async function approveClientSettlement(tenantId: string, settlementId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('approve_client_settlement', {
    p_tenant_id: tenantId,
    p_settlement_id: settlementId,
  });
  if (error) throw new Error(error.message || 'تعذر اعتماد كشف تسوية العميل.');
}

// ----------------------------------------------------------------------------
// Courier Commission Payouts (CMP-*)
// ----------------------------------------------------------------------------
export async function listCourierPayableCommissions(
  tenantId: string,
  courierId: string,
): Promise<readonly PayableCommissionShipmentItem[]> {
  const client = requireClient();
  const {data, error} = await client.rpc('list_courier_payable_commissions', {
    p_tenant_id: tenantId,
    p_courier_id: courierId,
  });
  if (error) throw new Error(error.message || 'تعذر تحميل عمولات المندوب المستحقة.');
  return (Array.isArray(data) ? data : []) as PayableCommissionShipmentItem[];
}

export async function listCourierCommissionPayouts(
  tenantId: string,
): Promise<readonly CourierCommissionPayoutRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('courier_commission_payouts')
    .select(
      'id, tenant_id, payout_code, payout_date, branch_id, courier_id, cashbox_id, total_commission_amount, bonus_amount, deduction_amount, net_payout_amount, status, notes, approved_at, approved_by, created_at, created_by',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', {ascending: false})
    .limit(120);
  if (error) throw new Error('تعذر تحميل سندات صرف عمولات المناديب.');
  return (data ?? []) as CourierCommissionPayoutRecord[];
}

export async function createCourierCommissionPayout(
  tenantId: string,
  payload: {
    readonly branch_id: string;
    readonly courier_id: string;
    readonly cashbox_id: string;
    readonly shipment_ids: readonly string[];
    readonly bonus_amount?: number;
    readonly deduction_amount?: number;
    readonly notes?: string;
  },
): Promise<{readonly id: string; readonly payout_code: string; readonly net_payout_amount: number}> {
  const client = requireClient();
  const {data, error} = await client.rpc('create_courier_commission_payout', {
    p_tenant_id: tenantId,
    p_payload: payload,
  });
  if (error) throw new Error(error.message || 'تعذر إنشاء سند صرف العمولات.');
  return data as {id: string; payout_code: string; net_payout_amount: number};
}

export async function approveCourierCommissionPayout(tenantId: string, payoutId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('approve_courier_commission_payout', {
    p_tenant_id: tenantId,
    p_payout_id: payoutId,
  });
  if (error) throw new Error(error.message || 'تعذر اعتماد صرف العمولات.');
}
