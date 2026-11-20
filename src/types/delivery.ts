import type {AddedViaMode} from '@/types/operations';
import type {ShipmentListItem, ShipmentOperationalStatus} from '@/types/shipments';

export type DeliveryListType = 'delivery' | 'redelivery';
export type DeliveryListStatus = 'draft' | 'approved' | 'closed' | 'cancelled';
export type DeliveryExecutionOutcome =
  | 'pending'
  | 'delivered'
  | 'partially_delivered'
  | 'rescheduled'
  | 'delivery_failed'
  | 'return_to_sender';

export type ReturnLiabilityType = 'no_charge' | 'sender_partial_fee' | 'recipient_paid_fee';
export type ProofOfDeliveryMethod = 'signature' | 'otp' | 'photo' | 'none';

export type ReturnManifestType =
  | 'courier_return_inbound'
  | 'client_return_dispatch'
  | 'client_return_handover';
export type ReturnManifestStatus = 'draft' | 'approved' | 'cancelled';
export type ReturnHandoverStatus = 'pending' | 'completed';

export const DELIVERY_LIST_STATUS_LABELS: Record<DeliveryListStatus, string> = {
  draft: 'مسودة قيد التجهيز',
  approved: 'معتمدة وجاري التوصيل',
  closed: 'مغلقة ومنتهية التنفيذ',
  cancelled: 'ملغاة',
};

export const DELIVERY_OUTCOME_LABELS: Record<DeliveryExecutionOutcome, string> = {
  pending: 'بانتظار التنفيذ',
  delivered: 'تم التسليم بالكامل',
  partially_delivered: 'تسليم جزئي (PDP)',
  rescheduled: 'تأجيل / إعادة توصيل',
  delivery_failed: 'تعذر التسليم',
  return_to_sender: 'تحويل للمرتجع (للراسل)',
};

export const RETURN_TYPE_LABELS: Record<ReturnLiabilityType, string> = {
  no_charge: '1 - بدون تحصيل (رسوم المرتجع على الراسل)',
  sender_partial_fee: '2 - جزء على الراسل (رسوم مرتجع محددة)',
  recipient_paid_fee: '3 - تحصيل من المستلم عند الباب (عهدة على المندوب)',
};

export const RETURN_MANIFEST_TYPE_LABELS: Record<ReturnManifestType, string> = {
  courier_return_inbound: 'استلام المرتجعات من المندوبين (RTH)',
  client_return_dispatch: 'قوائم توصيل المرتجعات للعملاء (RTD)',
  client_return_handover: 'قوائم تسليم المرتجعات للعملاء (RTN)',
};

export const RETURN_MANIFEST_STATUS_LABELS: Record<ReturnManifestStatus, string> = {
  draft: 'مسودة قيد التجهيز',
  approved: 'معتمدة ومنفذة',
  cancelled: 'ملغاة',
};

export interface TenantDeliveryPolicyRecord {
  readonly tenant_id: string;
  readonly max_delivery_attempts: number;
  readonly retry_extra_fee: number;
  readonly require_pod_on_delivery: boolean;
}

export interface DeliveryListRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly list_code: string;
  readonly list_type: DeliveryListType;
  readonly list_date: string;
  readonly branch_id: string;
  readonly courier_id: string;
  readonly route_id: string | null;
  readonly movement_type_id: string | null;
  readonly status: DeliveryListStatus;
  readonly notes: string | null;
  readonly approved_at: string | null;
  readonly closed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly shipments_count?: number;
  readonly pending_count?: number;
}

export interface DeliveryListItemRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly delivery_list_id: string;
  readonly shipment_id: string;
  readonly added_via: AddedViaMode;
  readonly execution_outcome: DeliveryExecutionOutcome;
  readonly delivered_amount: number | null;
  readonly delivered_pieces_count: number | null;
  readonly exception_reason_id: string | null;
  readonly return_type_code: ReturnLiabilityType | null;
  readonly applied_return_fee: number;
  readonly return_collected_amount: number;
  readonly attempt_overridden: boolean;
  readonly outcome_notes: string | null;
  readonly executed_at: string | null;
  readonly created_at: string;
  readonly shipment?: ShipmentListItem;
}

export interface DeliveryListDetail {
  readonly list: DeliveryListRecord;
  readonly items: readonly DeliveryListItemRecord[];
}

export interface CreateDeliveryListInput {
  readonly list_type: DeliveryListType;
  readonly list_date: string;
  readonly branch_id: string;
  readonly courier_id: string;
  readonly route_id: string | null;
  readonly movement_type_id: string | null;
  readonly notes: string | null;
}

export interface DeliveryExecutionInput {
  readonly shipment_id: string;
  readonly delivery_list_id?: string | null;
  readonly outcome: Exclude<DeliveryExecutionOutcome, 'pending'>;
  readonly delivered_amount?: number | null;
  readonly delivered_pieces?: number | null;
  readonly exception_reason_id?: string | null;
  readonly rescheduled_for_date?: string | null;
  readonly return_type_code?: ReturnLiabilityType | null;
  readonly applied_return_fee?: number | null;
  readonly return_collected_amount?: number | null;
  readonly pod_method?: ProofOfDeliveryMethod | null;
  readonly pod_recipient_name?: string | null;
  readonly pod_signature_data?: string | null;
  readonly pod_otp_verified?: boolean;
  readonly notes?: string | null;
}

export interface DeliveryExecutionResult {
  readonly shipment_id: string;
  readonly from_status: ShipmentOperationalStatus;
  readonly to_status: ShipmentOperationalStatus;
  readonly delivery_attempts_count: number;
  readonly max_delivery_attempts: number;
  readonly auto_returned_by_limit: boolean;
  readonly accrued_courier_commission: number;
  readonly return_liability: string;
  readonly applied_return_fee: number;
  readonly return_collected_from_recipient: number;
}

export interface ReturnManifestRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly manifest_code: string;
  readonly manifest_type: ReturnManifestType;
  readonly manifest_date: string;
  readonly branch_id: string;
  readonly courier_id: string | null;
  readonly client_id: string | null;
  readonly movement_type_id: string | null;
  readonly status: ReturnManifestStatus;
  readonly notes: string | null;
  readonly approved_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly shipments_count?: number;
}

export interface ReturnManifestItemRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly return_manifest_id: string;
  readonly shipment_id: string;
  readonly added_via: AddedViaMode;
  readonly handover_status: ReturnHandoverStatus;
  readonly notes: string | null;
  readonly completed_at: string | null;
  readonly created_at: string;
  readonly shipment?: ShipmentListItem;
}

export interface ReturnManifestDetail {
  readonly manifest: ReturnManifestRecord;
  readonly items: readonly ReturnManifestItemRecord[];
}

export interface CreateReturnManifestInput {
  readonly manifest_type: ReturnManifestType;
  readonly manifest_date: string;
  readonly branch_id: string;
  readonly courier_id: string | null;
  readonly client_id: string | null;
  readonly movement_type_id: string | null;
  readonly notes: string | null;
}

export interface CourierPortalPickupSummary {
  readonly id: string;
  readonly list_code: string;
  readonly list_date: string;
  readonly branch_id: string;
  readonly status: string;
  readonly notes: string | null;
  readonly shipments_count: number;
}

export interface CourierPortalDeliverySummary {
  readonly id: string;
  readonly list_code: string;
  readonly list_type: DeliveryListType;
  readonly list_date: string;
  readonly branch_id: string;
  readonly status: DeliveryListStatus;
  readonly notes: string | null;
  readonly shipments_count: number;
  readonly pending_count: number;
}

export interface CourierPortalTasksFeed {
  readonly courier: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly branch_id: string;
    readonly mobile: string;
  } | null;
  readonly pickup_lists: readonly CourierPortalPickupSummary[];
  readonly delivery_lists: readonly CourierPortalDeliverySummary[];
  readonly shipments: readonly ShipmentListItem[];
}

export interface DeliveryFilter {
  readonly branchId?: string;
  readonly courierId?: string;
  readonly status?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly code?: string;
}

export const DELIVERY_ELIGIBLE_STATUSES: readonly ShipmentOperationalStatus[] = [
  'in_warehouse',
  'picked_up',
  'rescheduled',
  'delivery_failed',
];

export const REDELIVERY_ELIGIBLE_STATUSES: readonly ShipmentOperationalStatus[] = [
  'rescheduled',
  'delivery_failed',
  'in_warehouse',
];
