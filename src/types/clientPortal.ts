import type {TimestampUtc} from '@/types/common';
import type {PayoutMethod} from '@/types/pricing';

export type ClientPickupRequestStatus = 'pending' | 'scheduled' | 'picked_up' | 'cancelled';

export const PICKUP_REQUEST_STATUS_LABELS: Record<ClientPickupRequestStatus, string> = {
  pending: 'قيد الانتظار',
  scheduled: 'مجدول مع مندوب',
  picked_up: 'تم الالتقاط',
  cancelled: 'ملغي',
};

export interface ClientPickupRequestRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly request_code: string;
  readonly client_id: string;
  readonly address_id: string | null;
  readonly branch_id: string | null;
  readonly governorate_id: string;
  readonly region_id: string | null;
  readonly pickup_address: string;
  readonly contact_phone: string;
  readonly preferred_date: string;
  readonly preferred_time_slot: string;
  readonly estimated_shipments_count: number;
  readonly notes: string | null;
  readonly status: ClientPickupRequestStatus;
  readonly pickup_list_id: string | null;
  readonly created_at: TimestampUtc;
  readonly updated_at: TimestampUtc;
}

export type ClientPortalPeriod = 'all' | '7d' | '30d' | '90d';

export interface ClientPortalSummary {
  readonly client: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly payout_method: PayoutMethod;
    readonly default_price_mode: string;
    readonly governorate_name?: string | null;
    readonly region_name?: string | null;
  };
  readonly period: ClientPortalPeriod;
  readonly total_shipments: number;
  readonly in_progress_count: number;
  readonly delivered_count: number;
  readonly returned_count: number;
  readonly total_shipping_fees: number;
  readonly cod_collected_amount: number;
  readonly in_flight_cod_amount: number;
  readonly ready_unsettled_count: number;
  readonly ready_net_settlement_amount: number;
  readonly total_settled_payout_amount: number;
  readonly pending_pickup_requests_count: number;
}

export interface ClientStatementEntry {
  readonly row_id: string;
  readonly entry_date: string;
  readonly reference_code: string;
  readonly entry_type: string;
  readonly description: string;
  readonly credit_amount: number;
  readonly debit_amount: number;
  readonly running_balance: number;
  readonly payout_method: string | null;
  readonly payout_reference: string | null;
}

export interface ClientAccountStatement {
  readonly client: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly payout_method: PayoutMethod;
  };
  readonly currency: string;
  readonly date_from: string | null;
  readonly date_to: string | null;
  readonly opening_balance: number;
  readonly total_credits: number;
  readonly total_debits: number;
  readonly closing_balance: number;
  readonly ready_unsettled_net: number;
  readonly in_flight_cod_amount: number;
  readonly entries: readonly ClientStatementEntry[];
}