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
