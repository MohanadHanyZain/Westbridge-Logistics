export type WeightRoundingRule = 'ceil_1kg' | 'ceil_half_kg' | 'exact';
export type TaxMode = 'none' | 'exclusive' | 'inclusive';
export type PriceMode = 'shipping_included' | 'shipping_excluded';
export type ClientCategory = 'standard' | 'vip' | 'corporate' | 'ecommerce';
export type TradeDirection = 'b2c' | 'b2b' | 'all';
export type PayoutMethod = 'cash' | 'bank_transfer' | 'vodafone_cash';
export type SurchargeType = 'fixed' | 'percent_of_delivery' | 'percent_of_cod';
export type ExemptionTarget = 'extra_weight' | 'collection_fee' | 'return_fee';

export const EGYPTIAN_BANKS = [
  'البنك التجاري الدولي (CIB)',
  'البنك الأهلي المصري',
  'بنك الإسكان والتعمير',
  'بنك الإسكندرية',
  'البنك العربي الأفريقي الدولي',
  'بنك عودة',
  'بنك مصر',
] as const;

export interface TaxProfileRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly rate_percent: number;
  readonly tax_mode: TaxMode;
  readonly is_default: boolean;
  readonly is_active: boolean;
}

export interface ClientPriceListRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly is_system_default: boolean;
  readonly is_active: boolean;
  readonly archived_at: string | null;
  readonly created_at: string;
}

export interface PriceListVersionRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly price_list_id: string;
  readonly version_number: number;
  readonly label: string;
  readonly volumetric_divisor: number;
  readonly weight_rounding_rule: WeightRoundingRule;
  readonly effective_from: string;
  readonly is_active: boolean;
  readonly is_published: boolean;
  readonly notes: string | null;
}

export interface PickupPriceRuleRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly price_list_version_id: string;
  readonly service_id: string;
  readonly pickup_governorate_id: string;
  readonly pickup_region_id: string | null;
  readonly is_active: boolean;
  readonly notes: string | null;
}

export interface DeliveryPriceRuleRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly pickup_rule_id: string;
  readonly delivery_governorate_id: string;
  readonly delivery_region_id: string | null;
  readonly base_weight_kg: number;
  readonly base_delivery_fee: number;
  readonly extra_weight_step_kg: number;
  readonly extra_weight_fee: number;
  readonly return_fee: number;
  readonly collection_threshold_amount: number;
  readonly collection_fee_base: number;
  readonly collection_extra_step_amount: number;
  readonly collection_extra_fee: number;
  readonly is_active: boolean;
}

export interface PriceSurchargeRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly price_list_version_id: string;
  readonly service_id: string | null;
  readonly code: string;
  readonly name: string;
  readonly charge_type: SurchargeType;
  readonly amount: number;
  readonly is_active: boolean;
}

export interface ClientRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly branch_id: string | null;
  readonly ledger_account_id: string | null;
  readonly country_id: string | null;
  readonly governorate_id: string;
  readonly city_id: string | null;
  readonly region_id: string;
  readonly price_list_id: string;
  readonly tax_profile_id: string;
  readonly default_payment_term_id: string | null;
  readonly default_shipment_type_id: string | null;
  readonly default_price_mode: PriceMode;
  readonly allow_package_opening: boolean;
  readonly client_category: ClientCategory;
  readonly activity_type: string | null;
  readonly trade_direction: TradeDirection;
  readonly payout_method: PayoutMethod;
  readonly bank_name: string | null;
  readonly bank_account_number: string | null;
  readonly wallet_phone: string | null;
  readonly phone: string;
  readonly mobile: string;
  readonly po_box: string | null;
  readonly postal_code: string | null;
  readonly address_line: string;
  readonly email: string | null;
  readonly approval_status: 'approved' | 'pending_approval' | 'rejected';
  readonly is_active: boolean;
  readonly archived_at: string | null;
  readonly created_at: string;
}

export interface ClientAddressRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly client_id: string;
  readonly label: string;
  readonly governorate_id: string;
  readonly city_id: string | null;
  readonly region_id: string | null;
  readonly address_line: string;
  readonly phone: string | null;
  readonly is_default: boolean;
  readonly is_active: boolean;
}

export interface ClientContactRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly client_id: string;
  readonly name: string;
  readonly role_title: string | null;
  readonly phone: string | null;
  readonly mobile: string | null;
  readonly email: string | null;
  readonly is_primary: boolean;
  readonly is_active: boolean;
}

export interface ClientContractTermRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly client_id: string;
  readonly term_code: string;
  readonly title: string;
  readonly settlement_cycle_days: number;
  readonly notes: string | null;
  readonly is_active: boolean;
}

export interface PriceExemptionRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly client_id: string;
  readonly price_list_version_id: string | null;
  readonly exemption_target: ExemptionTarget;
  readonly discount_percent: number;
  readonly notes: string | null;
  readonly is_active: boolean;
}

export interface ClientRegistrationRequestRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly company_name: string;
  readonly contact_name: string | null;
  readonly email: string;
  readonly phone: string;
  readonly mobile: string | null;
  readonly governorate_id: string;
  readonly region_id: string;
  readonly address_line: string;
  readonly payout_method: PayoutMethod;
  readonly bank_name: string | null;
  readonly bank_account_number: string | null;
  readonly wallet_phone: string | null;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly rejection_reason: string | null;
  readonly approved_client_id: string | null;
  readonly created_at: string;
}

export interface PriceCalculationBreakdown {
  readonly engine_version: string;
  readonly match_tier: 'exact_region' | 'pickup_region_delivery_gov' | 'pickup_gov_delivery_region' | 'gov_to_gov';
  readonly price_list_id: string;
  readonly price_list_version_id: string;
  readonly version_number: number;
  readonly volumetric_divisor: number;
  readonly rounding_rule: WeightRoundingRule;
  readonly actual_weight_kg: number;
  readonly volumetric_weight_kg: number;
  readonly chargeable_weight_kg: number;
  readonly base_weight_kg: number;
  readonly base_delivery_fee: number;
  readonly extra_weight_fee: number;
  readonly collection_fee: number;
  readonly surcharges_total: number;
  readonly exemptions_total: number;
  readonly subtotal_before_tax: number;
  readonly tax_profile_code: string;
  readonly tax_mode: TaxMode;
  readonly tax_rate_percent: number;
  readonly tax_amount: number;
  readonly total_shipping_fee: number;
  readonly return_fee: number;
  readonly price_mode: PriceMode;
  readonly entered_amount: number;
  readonly recipient_collect_amount: number;
  readonly client_net_payout: number;
  readonly is_manual_override: boolean;
  readonly override_reason: string | null;
  readonly snapshot_id?: string;
}

export interface ShipmentPriceSnapshotRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly client_id: string;
  readonly service_id: string;
  readonly version_number: number;
  readonly chargeable_weight_kg: number;
  readonly price_mode: PriceMode;
  readonly entered_amount: number;
  readonly tax_mode: TaxMode;
  readonly tax_amount: number;
  readonly total_shipping_fee: number;
  readonly recipient_collect_amount: number;
  readonly client_net_payout: number;
  readonly is_manual_override: boolean;
  readonly override_reason: string | null;
  readonly created_at: string;
}
