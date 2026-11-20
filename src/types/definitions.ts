export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type ExceptionCategory = 'delivery_failed' | 'refused' | 'return' | 'cancellation' | 'exception';
export type MovementDirection = 'inbound' | 'outbound' | 'internal' | 'return';
export type JournalCategory = 'cash' | 'operations' | 'settlements' | 'general';

export interface CountryRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly iso2: string | null;
  readonly is_default: boolean;
  readonly is_active: boolean;
}

export interface GovernorateRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly country_id: string;
  readonly code: string;
  readonly name: string;
  readonly default_branch_id: string | null;
  readonly is_active: boolean;
}

export interface CityRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly governorate_id: string;
  readonly code: string;
  readonly name: string;
  readonly is_active: boolean;
}

export interface RegionRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly governorate_id: string;
  readonly city_id: string | null;
  readonly code: string;
  readonly name: string;
  readonly default_branch_id: string | null;
  readonly is_active: boolean;
}

export interface BranchRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly is_main: boolean;
  readonly is_active: boolean;
  readonly country_id: string | null;
  readonly governorate_id: string | null;
  readonly city_id: string | null;
  readonly region_id: string | null;
  readonly phone: string | null;
  readonly fax: string | null;
  readonly address_line: string | null;
  readonly archived_at: string | null;
  readonly created_at: string;
}

export interface ChartOfAccountRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly account_type: AccountType;
  readonly parent_id: string | null;
  readonly is_group: boolean;
  readonly is_system: boolean;
  readonly is_active: boolean;
}

export interface ShipmentTypeRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly is_system: boolean;
  readonly is_active: boolean;
}

export interface ShippingServiceRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly estimated_days_min: number;
  readonly estimated_days_max: number;
  readonly branch_id: string | null;
  readonly delivery_revenue_account_id: string | null;
  readonly collection_revenue_account_id: string | null;
  readonly courier_commission_account_id: string | null;
  readonly is_active: boolean;
  readonly archived_at: string | null;
  readonly shipment_type_ids: readonly string[];
}

export interface DeliveryExceptionReasonRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly category: ExceptionCategory;
  readonly requires_note: boolean;
  readonly is_system: boolean;
  readonly is_active: boolean;
}

export interface MovementTypeRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly direction: MovementDirection;
  readonly is_system: boolean;
  readonly is_active: boolean;
}

export interface AuxiliaryJournalRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly journal_category: JournalCategory;
  readonly is_system: boolean;
  readonly is_active: boolean;
}

export interface JournalEntryTypeRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly is_reversal_type: boolean;
  readonly is_system: boolean;
  readonly is_active: boolean;
}

export interface CashboxRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly branch_id: string;
  readonly ledger_account_id: string;
  readonly is_active: boolean;
  readonly allow_deposit: boolean;
  readonly allow_withdraw: boolean;
  readonly allow_transfer_in: boolean;
  readonly allow_transfer_out: boolean;
  readonly archived_at: string | null;
}

export interface CashboxCustodianRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly cashbox_id: string;
  readonly membership_id: string;
  readonly is_active: boolean;
  readonly created_at: string;
}

export interface TenantMemberOption {
  readonly id: string;
  readonly username: string;
  readonly role_key: string;
  readonly is_active: boolean;
  readonly display_name: string;
}

export interface PaymentMethodRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly is_active: boolean;
}

export interface PaymentTermRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly is_active: boolean;
}

export interface DeliveryTypeRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly is_active: boolean;
}

export interface NumberingSequenceRecord {
  readonly id: string;
  readonly entity_key: string;
  readonly label: string;
  readonly prefix: string;
  readonly next_number: number;
  readonly padding_length: number;
  readonly is_active: boolean;
}

export interface Phase2SummaryCounts {
  readonly branchesCount: number;
  readonly activeGovernoratesCount: number;
  readonly activeRegionsCount: number;
  readonly activeServicesCount: number;
  readonly activeCashboxesCount: number;
  readonly activeExceptionReasonsCount: number;
}
