import type {PayoutMethod} from '@/types/pricing';

export type FinanceDocumentStatus = 'draft' | 'approved' | 'cancelled';

export interface TenantFinancePolicyRecord {
  readonly tenant_id: string;
  readonly enforce_four_eyes: boolean;
  readonly allow_owner_self_approve: boolean;
  readonly high_value_approval_threshold: number;
}

export interface CashboxBalanceRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly branch_id: string;
  readonly branch_name: string | null;
  readonly ledger_account_id: string;
  readonly is_active: boolean;
  readonly allow_deposit: boolean;
  readonly allow_withdraw: boolean;
  readonly allow_transfer_in: boolean;
  readonly allow_transfer_out: boolean;
  readonly current_balance: number;
}

export type CashboxTransactionType =
  | 'courier_collection_in'
  | 'client_settlement_out'
  | 'client_settlement_in'
  | 'commission_payout_out'
  | 'transfer_in'
  | 'transfer_out'
  | 'manual_receipt_in'
  | 'manual_payment_out'
  | 'prepaid_deposit_in';

export interface CashboxTransactionRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly transaction_code: string;
  readonly cashbox_id: string;
  readonly branch_id: string;
  readonly transaction_date: string;
  readonly transaction_type: CashboxTransactionType;
  readonly direction: 'in' | 'out';
  readonly amount: number;
  readonly reference_type: string;
  readonly reference_id: string;
  readonly reference_code: string;
  readonly notes: string | null;
  readonly actor_user_id: string | null;
  readonly created_at: string;
}

export interface CourierCustodyOverviewRecord {
  readonly courier_id: string;
  readonly code: string;
  readonly name: string;
  readonly mobile: string;
  readonly branch_id: string | null;
  readonly shipment_custody_count: number;
  readonly uncollected_cash_shipments_count: number;
  readonly uncollected_cash_amount: number;
  readonly total_accrued_commission: number;
  readonly payable_commission_amount: number;
}

export interface UncollectedCashShipmentItem {
  readonly shipment_id: string;
  readonly shipment_number: string;
  readonly barcode_token: string;
  readonly operational_status: string;
  readonly payment_term_code: string;
  readonly return_liability: string;
  readonly delivered_at: string | null;
  readonly cash_source_type: 'cod_delivery' | 'return_recipient_fee';
  readonly expected_amount: number;
  readonly client_name: string | null;
}

export interface CourierCollectionVoucherRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly voucher_code: string;
  readonly voucher_date: string;
  readonly branch_id: string;
  readonly courier_id: string;
  readonly cashbox_id: string;
  readonly total_expected_amount: number;
  readonly total_collected_amount: number;
  readonly variance_amount: number;
  readonly status: FinanceDocumentStatus;
  readonly notes: string | null;
  readonly approved_at: string | null;
  readonly approved_by: string | null;
  readonly created_at: string;
  readonly created_by: string | null;
}

export interface ClientSettlementOverviewRecord {
  readonly client_id: string;
  readonly code: string;
  readonly name: string;
  readonly mobile: string;
  readonly branch_id: string | null;
  readonly payout_method: PayoutMethod;
  readonly bank_name: string | null;
  readonly bank_account_number: string | null;
  readonly wallet_phone: string | null;
  readonly default_price_mode: 'shipping_included' | 'shipping_excluded';
  readonly unsettled_shipments_count: number;
  readonly awaiting_courier_collection_count: number;
  readonly gross_cod_amount: number;
  readonly shipping_fees_deductible: number;
  readonly return_fees_deductible: number;
  readonly ready_net_balance: number;
}

export interface ClientUnsettledShipmentItem {
  readonly shipment_id: string;
  readonly shipment_number: string;
  readonly operational_status: string;
  readonly payment_term_code: string;
  readonly price_mode: string;
  readonly is_collected_from_courier: boolean;
  readonly return_liability: string;
  readonly cod_collected_amount: number;
  readonly shipping_fee_deducted: number;
  readonly return_fee_deducted: number;
  readonly net_client_amount: number;
  readonly awaiting_courier_cash: boolean;
}

export interface ClientSettlementRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly settlement_code: string;
  readonly settlement_date: string;
  readonly branch_id: string;
  readonly client_id: string;
  readonly cashbox_id: string | null;
  readonly payout_method: PayoutMethod;
  readonly payout_reference: string | null;
  readonly gross_cod_collected: number;
  readonly shipping_fees_deducted: number;
  readonly return_fees_deducted: number;
  readonly adjustment_amount: number;
  readonly net_payable_amount: number;
  readonly cash_direction: 'payout_to_client' | 'receipt_from_client' | 'zero_balance';
  readonly status: FinanceDocumentStatus;
  readonly notes: string | null;
  readonly approved_at: string | null;
  readonly approved_by: string | null;
  readonly created_at: string;
  readonly created_by: string | null;
}

export interface PayableCommissionShipmentItem {
  readonly shipment_id: string;
  readonly shipment_number: string;
  readonly operational_status: string;
  readonly payment_term_code: string;
  readonly is_collected_from_courier: boolean;
  readonly accrued_courier_commission: number;
  readonly eligible_for_payout: boolean;
}

export interface CourierCommissionPayoutRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly payout_code: string;
  readonly payout_date: string;
  readonly branch_id: string;
  readonly courier_id: string;
  readonly cashbox_id: string;
  readonly total_commission_amount: number;
  readonly bonus_amount: number;
  readonly deduction_amount: number;
  readonly net_payout_amount: number;
  readonly status: FinanceDocumentStatus;
  readonly notes: string | null;
  readonly approved_at: string | null;
  readonly approved_by: string | null;
  readonly created_at: string;
  readonly created_by: string | null;
}

export interface CashboxTransferRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly transfer_code: string;
  readonly transfer_date: string;
  readonly from_cashbox_id: string;
  readonly to_cashbox_id: string;
  readonly amount: number;
  readonly status: FinanceDocumentStatus;
  readonly notes: string | null;
  readonly approved_at: string | null;
  readonly approved_by: string | null;
  readonly created_at: string;
  readonly created_by: string | null;
}

export interface CashboxVoucherRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly voucher_code: string;
  readonly voucher_type: 'receipt' | 'payment' | 'prepaid_deposit';
  readonly voucher_date: string;
  readonly branch_id: string;
  readonly cashbox_id: string;
  readonly client_id: string | null;
  readonly amount: number;
  readonly party_name: string | null;
  readonly status: FinanceDocumentStatus;
  readonly notes: string | null;
  readonly approved_at: string | null;
  readonly approved_by: string | null;
  readonly created_at: string;
  readonly created_by: string | null;
}

export const FINANCE_DOC_STATUS_LABELS: Record<FinanceDocumentStatus, string> = {
  draft: 'مسودة (بانتظار الاعتماد)',
  approved: 'معتمد ومُرحّل',
  cancelled: 'ملغى',
};

export const CASHBOX_TX_TYPE_LABELS: Record<CashboxTransactionType, string> = {
  courier_collection_in: 'توريد تحصيل من مندوب',
  client_settlement_out: 'سداد تسوية عميل',
  client_settlement_in: 'تحصيل مستحق من عميل',
  commission_payout_out: 'صرف عمولات مندوب',
  transfer_in: 'تحويل وارد بين الخزائن',
  transfer_out: 'تحويل صادر بين الخزائن',
  manual_receipt_in: 'سند قبض نقدي',
  manual_payment_out: 'سند صرف نقدي',
  prepaid_deposit_in: 'إيداع رصيد مقدم لعميل',
};
