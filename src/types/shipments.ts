import type {PriceMode, ShipmentPriceSnapshotRecord} from '@/types/pricing';

export type ShipmentOperationalStatus =
  | 'created'
  | 'pickup_scheduled'
  | 'picked_up'
  | 'in_warehouse'
  | 'in_transit_branch'
  | 'out_for_delivery'
  | 'rescheduled'
  | 'partially_delivered'
  | 'delivered'
  | 'delivery_failed'
  | 'return_to_sender'
  | 'returned'
  | 'cancelled';

export type ShipmentTypeCode = 'FDP' | 'PDP' | 'PTP' | 'CLC' | 'RTS';
export type PaymentTermCode = 'COD' | 'PREPAID' | 'POSTPAID' | 'CASH_PAID';
export type ReturnCustodyStatus = 'none' | 'with_courier' | 'in_warehouse' | 'returned_to_client';
export type ExchangeCustodyStatus = 'none' | 'pending_exchange' | 'with_courier' | 'in_warehouse' | 'returned_to_client';
export type ShipmentNoteType = 'internal' | 'client_visible' | 'courier_note' | 'system';
export type ShipmentListPreset = 'all' | 'warehouse' | 'out-for-delivery' | 'rescheduled' | 'returns' | 'tracking';

export const SHIPMENT_STATUS_LABELS: Record<ShipmentOperationalStatus, string> = {
  created: 'تم الإنشاء',
  pickup_scheduled: 'قيد الالتقاط',
  picked_up: 'تم الالتقاط من العميل',
  in_warehouse: 'بالمخزن',
  in_transit_branch: 'تحويل بين الفروع',
  out_for_delivery: 'جاري التوصيل',
  rescheduled: 'انتظار إعادة التوصيل',
  partially_delivered: 'تسليم جزئي (PDP)',
  delivered: 'تم التسليم',
  delivery_failed: 'تعذر التسليم',
  return_to_sender: 'قيد الإرجاع للراسل',
  returned: 'مرتجع للراسل',
  cancelled: 'ملغاة',
};

export const PAYMENT_TERM_LABELS: Record<PaymentTermCode, string> = {
  COD: 'واجبة التحصيل (COD)',
  PREPAID: 'مدفوعة مسبقًا (Prepaid)',
  POSTPAID: 'آجلة - بريد',
  CASH_PAID: 'مسددة نقدًا',
};

export const SHIPMENT_TYPE_LABELS: Record<ShipmentTypeCode, string> = {
  FDP: 'تسليم كامل للطرد (FDP)',
  PDP: 'تسليم جزء من الطرد (PDP)',
  PTP: 'طرد مقابل طرد - استبدال (PTP)',
  CLC: 'تحصيل أموال فقط (CLC)',
  RTS: 'استرجاع طرد (RTS)',
};

export const RETURN_CUSTODY_LABELS: Record<ReturnCustodyStatus | ExchangeCustodyStatus, string> = {
  none: 'لا يوجد',
  pending_exchange: 'بانتظار استلام الطرد البديل',
  with_courier: 'في عهدة المندوب',
  in_warehouse: 'مستلم بالمخزن',
  returned_to_client: 'مُسلَّم للراسل',
};

export interface ShipmentRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly shipment_number: string;
  readonly barcode_token: string;
  readonly client_id: string;
  readonly origin_branch_id: string;
  readonly current_branch_id: string;
  readonly destination_branch_id: string | null;
  readonly assigned_courier_id: string | null;
  readonly movement_type_id: string | null;
  readonly shipment_type_id: string;
  readonly shipment_type_code: ShipmentTypeCode;
  readonly service_id: string;
  readonly payment_term_id: string;
  readonly payment_term_code: PaymentTermCode;
  readonly price_mode: PriceMode;
  readonly operational_status: ShipmentOperationalStatus;
  readonly is_created_confirmed: boolean;
  readonly is_collected_from_courier: boolean;
  readonly is_settled_to_client: boolean;
  readonly is_courier_commission_paid: boolean;
  readonly entered_amount: number;
  readonly prepaid_balance_amount: number;
  readonly total_shipping_fee: number;
  readonly return_fee: number;
  readonly recipient_collect_amount: number;
  readonly client_net_payout: number;
  readonly delivered_amount: number | null;
  readonly pieces_count: number;
  readonly delivered_pieces_count: number;
  readonly returned_pieces_count: number;
  readonly partial_return_custody: ReturnCustodyStatus;
  readonly exchange_status: ExchangeCustodyStatus;
  readonly actual_weight_kg: number;
  readonly chargeable_weight_kg: number;
  readonly allow_package_opening: boolean;
  readonly package_description: string | null;
  readonly external_reference: string | null;
  readonly notes: string | null;
  readonly pickup_date: string;
  readonly pickup_time_from: string | null;
  readonly pickup_time_to: string | null;
  readonly current_snapshot_id: string | null;
  readonly sender_governorate_id: string;
  readonly sender_region_id: string;
  readonly recipient_governorate_id: string;
  readonly recipient_region_id: string;
  readonly delivery_attempts_count: number;
  readonly last_exception_reason_id: string | null;
  readonly delivered_at: string | null;
  readonly returned_at: string | null;
  readonly cancelled_at: string | null;
  readonly return_liability?: 'none' | 'no_charge' | 'sender_partial_fee' | 'recipient_paid_fee';
  readonly applied_return_fee?: number;
  readonly return_collected_from_recipient?: number;
  readonly accrued_courier_commission?: number;
  readonly rescheduled_for_date?: string | null;
  readonly proof_of_delivery_method?: 'signature' | 'otp' | 'photo' | 'none' | null;
  readonly proof_recipient_name?: string | null;
  readonly proof_signature_data?: string | null;
  readonly proof_otp_verified?: boolean;
  readonly pod_captured_at?: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ShipmentPartyRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly shipment_id: string;
  readonly party_type: 'sender' | 'recipient';
  readonly name: string;
  readonly phone: string | null;
  readonly mobile: string;
  readonly governorate_id: string;
  readonly city_id: string | null;
  readonly region_id: string;
  readonly address_line: string;
}

export interface ShipmentPackageRecord {
  readonly id: string;
  readonly shipment_id: string;
  readonly package_index: number;
  readonly description: string | null;
  readonly pieces_count: number;
  readonly weight_kg: number;
  readonly declared_value: number;
  readonly barcode: string | null;
}

export interface ShipmentDimensionRecord {
  readonly id: string;
  readonly shipment_id: string;
  readonly snapshot_id: string | null;
  readonly version_number: number;
  readonly actual_weight_kg: number;
  readonly length_cm: number;
  readonly width_cm: number;
  readonly height_cm: number;
  readonly volumetric_divisor: number;
  readonly volumetric_weight_kg: number;
  readonly chargeable_weight_kg: number;
  readonly reason: string | null;
  readonly created_at: string;
}

export interface ShipmentStatusEventRecord {
  readonly id: string;
  readonly shipment_id: string;
  readonly event_code: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly branch_id: string | null;
  readonly courier_id: string | null;
  readonly movement_type_id: string | null;
  readonly exception_reason_id: string | null;
  readonly list_type: string | null;
  readonly list_code: string | null;
  readonly delivered_amount: number | null;
  readonly return_type: string | null;
  readonly fees_snapshot: number | null;
  readonly notes: string | null;
  readonly actor_user_id: string | null;
  readonly actor_display_name: string | null;
  readonly created_at: string;
}

export interface ShipmentRelationRecord {
  readonly id: string;
  readonly shipment_id: string;
  readonly related_shipment_id: string | null;
  readonly relation_type: 'ptp_exchange_return' | 'pdp_return_custody' | 'reshipment' | 'split_child';
  readonly exchange_item_description: string | null;
  readonly custody_status: 'pending' | 'with_courier' | 'in_warehouse' | 'returned_to_client' | 'closed';
  readonly notes: string | null;
  readonly created_at: string;
}

export interface ShipmentTrackingTokenRecord {
  readonly id: string;
  readonly shipment_id: string;
  readonly token: string;
  readonly is_active: boolean;
  readonly created_at: string;
}

export interface ShipmentNoteRecord {
  readonly id: string;
  readonly shipment_id: string;
  readonly note_type: ShipmentNoteType;
  readonly body: string;
  readonly created_by_name: string | null;
  readonly created_at: string;
}

export interface ShipmentReferenceRecord {
  readonly id: string;
  readonly shipment_id: string;
  readonly ref_type: string;
  readonly ref_value: string;
}

export interface ShipmentListItem extends ShipmentRecord {
  readonly client_name?: string;
  readonly client_code?: string;
  readonly service_name?: string;
  readonly origin_branch_name?: string;
  readonly current_branch_name?: string;
  readonly sender_name?: string;
  readonly sender_mobile?: string;
  readonly sender_geo_label?: string;
  readonly recipient_name?: string;
  readonly recipient_mobile?: string;
  readonly recipient_address?: string;
  readonly recipient_geo_label?: string;
  readonly tracking_token?: string;
}

export interface ShipmentFullDetail {
  readonly shipment: ShipmentRecord;
  readonly parties: readonly ShipmentPartyRecord[];
  readonly packages: readonly ShipmentPackageRecord[];
  readonly dimensions: readonly ShipmentDimensionRecord[];
  readonly snapshots: readonly ShipmentPriceSnapshotRecord[];
  readonly events: readonly ShipmentStatusEventRecord[];
  readonly relations: readonly ShipmentRelationRecord[];
  readonly trackingTokens: readonly ShipmentTrackingTokenRecord[];
  readonly notes: readonly ShipmentNoteRecord[];
  readonly references: readonly ShipmentReferenceRecord[];
}

export interface CreateShipmentInput {
  readonly client_id: string;
  readonly origin_branch_id: string;
  readonly movement_type_id: string | null;
  readonly shipment_type_id: string;
  readonly service_id: string;
  readonly payment_term_id: string;
  readonly price_mode: PriceMode;
  readonly actual_weight_kg: number;
  readonly length_cm: number;
  readonly width_cm: number;
  readonly height_cm: number;
  readonly pieces_count: number;
  readonly prepaid_balance_amount: number;
  readonly package_description: string | null;
  readonly external_reference: string | null;
  readonly allow_package_opening: boolean;
  readonly notes: string | null;
  readonly pickup_date: string;
  readonly exchange_item_description?: string | null;
  readonly sender_name: string;
  readonly sender_governorate_id: string;
  readonly sender_region_id: string;
  readonly sender_phone: string | null;
  readonly sender_mobile: string;
  readonly sender_address_line: string;
  readonly recipient_name: string;
  readonly recipient_governorate_id: string;
  readonly recipient_region_id: string;
  readonly recipient_phone: string | null;
  readonly recipient_mobile: string;
  readonly recipient_address_line: string;
  readonly override_total_fee?: number | null;
  readonly override_reason?: string | null;
}

export interface CreateShipmentResult {
  readonly shipment_id: string;
  readonly shipment_number: string;
  readonly barcode_token: string;
  readonly tracking_token: string;
  readonly snapshot_id?: string;
  readonly already_existed: boolean;
}

export interface PublicTrackingEvent {
  readonly event_code: string;
  readonly to_status: ShipmentOperationalStatus;
  readonly branch_name: string | null;
  readonly created_at: string;
}

export interface PublicTrackingResult {
  readonly found: boolean;
  readonly tenant_name?: string;
  readonly shipment_number?: string;
  readonly operational_status?: ShipmentOperationalStatus;
  readonly service_name?: string | null;
  readonly shipment_type_name?: string | null;
  readonly pieces_count?: number;
  readonly origin_label?: string;
  readonly destination_label?: string;
  readonly created_at?: string;
  readonly delivered_at?: string | null;
  readonly events?: readonly PublicTrackingEvent[];
}

export interface ShipmentDashboardCounts {
  readonly totalCount: number;
  readonly inWarehouseCount: number;
  readonly outForDeliveryCount: number;
  readonly deliveredCount: number;
  readonly returnsCount: number;
}
