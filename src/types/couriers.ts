import type {TimestampUtc} from '@/types/common';

export type VehicleType = 'motorcycle' | 'car' | 'van' | 'truck';
export type CommissionType = 'delivery_percent' | 'delivery_plus_collection_percent' | 'fixed_amount';

export interface VehicleRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly plate_number: string | null;
  readonly vehicle_type: VehicleType;
  readonly capacity_kg: number | null;
  readonly is_active: boolean;
  readonly archived_at: TimestampUtc | null;
}

export interface DriverRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly mobile: string | null;
  readonly license_number: string | null;
  readonly is_active: boolean;
  readonly archived_at: TimestampUtc | null;
}

export interface CourierRouteRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly vehicle_id: string | null;
  readonly driver_id: string | null;
  readonly is_system_default: boolean;
  readonly is_active: boolean;
  readonly archived_at: TimestampUtc | null;
  readonly created_at: TimestampUtc;
}

export interface CourierRouteStopRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly route_id: string;
  readonly stop_order: number;
  readonly governorate_id: string;
  readonly region_id: string | null;
  readonly notes: string | null;
}

export interface CourierCommissionListRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly is_system_default: boolean;
  readonly is_active: boolean;
  readonly archived_at: TimestampUtc | null;
  readonly created_at: TimestampUtc;
}

export interface CourierCommissionRuleRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly commission_list_id: string;
  readonly governorate_id: string;
  readonly region_id: string | null;
  readonly commission_type: CommissionType;
  readonly commission_value: number;
  readonly valid_from: string | null;
  readonly valid_to: string | null;
  readonly is_active: boolean;
  readonly notes: string | null;
}

export interface CourierRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly branch_id: string | null;
  readonly ledger_account_id: string | null;
  readonly custody_account_id: string | null;
  readonly default_route_id: string;
  readonly commission_list_id: string;
  readonly default_commission_type: CommissionType;
  readonly default_commission_value: number;
  readonly country_id: string | null;
  readonly governorate_id: string | null;
  readonly city_id: string | null;
  readonly region_id: string | null;
  readonly phone: string | null;
  readonly mobile: string;
  readonly po_box: string | null;
  readonly postal_code: string | null;
  readonly address_line: string | null;
  readonly email: string | null;
  readonly is_active: boolean;
  readonly archived_at: TimestampUtc | null;
  readonly created_at: TimestampUtc;
}

export interface CourierCommissionCalculationResult {
  readonly accrual_trigger: 'on_delivery';
  readonly match_tier: 'region_rule' | 'governorate_rule' | 'courier_default';
  readonly courier_id: string;
  readonly courier_code: string;
  readonly courier_name: string;
  readonly commission_list_id: string;
  readonly rule_id: string | null;
  readonly commission_type: CommissionType;
  readonly commission_value: number;
  readonly delivery_fee_base: number;
  readonly collection_fee_base: number;
  readonly commission_base_amount: number;
  readonly commission_amount: number;
}

// ----------------------------------------------------------------------------
// Phase 14: Maps, Live Courier Positions & GPS Location Events (ADR-022)
// ----------------------------------------------------------------------------
export type LocationEventType =
  | 'shift_start'
  | 'ping'
  | 'delivery_attempt'
  | 'pickup_stop'
  | 'shift_end';

export type LocationCaptureSource =
  | 'gps_browser'
  | 'device_sdk'
  | 'manual_pin'
  | 'delivery_pod';

export const LOCATION_EVENT_TYPE_LABELS: Record<LocationEventType, string> = {
  shift_start: 'بدء الوردية الميدانية',
  ping: 'تحديث موقع حي',
  delivery_attempt: 'نقطة تنفيذ / محاولة توصيل',
  pickup_stop: 'نقطة التقاط شحنة',
  shift_end: 'إنهاء الوردية',
};

export const LOCATION_SOURCE_LABELS: Record<LocationCaptureSource, string> = {
  gps_browser: 'GPS المتصفح',
  device_sdk: 'تطبيق الجهاز',
  manual_pin: 'تثبيت يدوي',
  delivery_pod: 'مرفق إثبات التسليم',
};

export interface CourierLocationEventRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly courier_id: string;
  readonly device_id: string | null;
  readonly shipment_id: string | null;
  readonly shipment_number?: string | null;
  readonly shipment_status?: string | null;
  readonly recipient_name?: string | null;
  readonly recipient_address?: string | null;
  readonly delivery_list_id: string | null;
  readonly delivery_list_code?: string | null;
  readonly event_type: LocationEventType;
  readonly lat: number;
  readonly lng: number;
  readonly accuracy_meters: number | null;
  readonly speed_mps: number | null;
  readonly heading_deg: number | null;
  readonly source: LocationCaptureSource;
  readonly notes: string | null;
  readonly recorded_at: TimestampUtc;
}

export interface CourierLivePosition {
  readonly courier_id: string;
  readonly courier_code: string;
  readonly courier_name: string;
  readonly courier_mobile: string;
  readonly branch_id: string | null;
  readonly branch_name: string | null;
  readonly is_active: boolean;
  readonly last_event_id: string | null;
  readonly event_type: LocationEventType | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly accuracy_meters: number | null;
  readonly speed_mps: number | null;
  readonly heading_deg: number | null;
  readonly source: LocationCaptureSource | null;
  readonly last_recorded_at: TimestampUtc | null;
  readonly last_shipment_id: string | null;
  readonly last_shipment_number: string | null;
  readonly active_shipments_count: number;
  readonly today_events_count: number;
}

export interface CourierTimelineShipmentStop {
  readonly id: string;
  readonly shipment_number: string;
  readonly operational_status: string;
  readonly recipient_name: string | null;
  readonly recipient_address: string | null;
  readonly recipient_collect_amount: number;
}

export interface CourierMovementsTimelineResult {
  readonly courier: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly mobile: string;
    readonly branch_id: string | null;
    readonly branch_name: string | null;
    readonly is_active: boolean;
  };
  readonly date_from: string;
  readonly date_to: string;
  readonly events: readonly CourierLocationEventRecord[];
  readonly active_shipments: readonly CourierTimelineShipmentStop[];
}

export interface TenantMapsSettingsRecord {
  readonly tenant_id: string;
  readonly location_retention_days: number;
  readonly gps_ping_interval_seconds: number;
  readonly require_gps_on_delivery: boolean;
}

