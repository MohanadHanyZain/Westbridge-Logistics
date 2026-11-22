import type {AccountSubjectType, TimestampUtc} from '@/types/common';

export type TenantStatus = 'active' | 'suspended' | 'archived';

export interface TenantRecord {
  readonly id: string;
  readonly code: string;
  readonly slug: string;
  readonly name: string;
  readonly status: TenantStatus;
  readonly default_timezone: string;
  readonly default_currency: string;
  readonly default_locale: string;
  readonly created_at: TimestampUtc;
  readonly updated_at: TimestampUtc;
}

export interface PublicTenantInfo {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: TenantStatus;
  readonly default_timezone: string;
  readonly default_currency: string;
  readonly default_locale: string;
  readonly allow_client_self_registration: boolean;
  readonly auto_approve_clients?: boolean;
  readonly brand_logo_path: string | null;
  readonly public_tagline?: string | null;
  readonly public_support_phone?: string | null;
  readonly public_support_email?: string | null;
}

export interface TenantSettingsRecord {
  readonly tenant_id: string;
  readonly allow_client_self_registration: boolean;
  readonly auto_approve_clients: boolean;
  readonly brand_logo_path: string | null;
  readonly public_tagline?: string | null;
  readonly public_support_phone?: string | null;
  readonly public_support_email?: string | null;
  readonly updated_at: TimestampUtc;
}

export interface TenantRegistrationSettings {
  readonly tenant_id: string;
  readonly allow_client_self_registration: boolean;
  readonly auto_approve_clients: boolean;
  readonly public_tagline: string | null;
  readonly public_support_phone: string | null;
  readonly public_support_email: string | null;
}

export interface PublicStorefrontService {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly estimated_days_min: number;
  readonly estimated_days_max: number;
}

export interface PublicStorefrontGov {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface PublicStorefrontRegion {
  readonly id: string;
  readonly governorate_id: string;
  readonly code: string;
  readonly name: string;
}

export interface PublicStorefrontPayload {
  readonly tenant: PublicTenantInfo;
  readonly services: readonly PublicStorefrontService[];
  readonly governorates: readonly PublicStorefrontGov[];
  readonly regions: readonly PublicStorefrontRegion[];
}

export interface SubmitClientRegistrationInput {
  readonly company_name: string;
  readonly contact_name?: string;
  readonly email: string;
  readonly phone: string;
  readonly mobile?: string;
  readonly governorate_id: string;
  readonly region_id: string;
  readonly address_line: string;
  readonly payout_method: 'cash' | 'bank_transfer' | 'vodafone_cash';
  readonly bank_name?: string;
  readonly bank_account_number?: string;
  readonly wallet_phone?: string;
}

export interface SubmitClientRegistrationResult {
  readonly request_id: string;
  readonly status: 'pending' | 'approved';
  readonly auto_approved: boolean;
  readonly client_id: string | null;
  readonly client_code: string | null;
}

export interface ProfileRecord {
  readonly id: string;
  readonly display_name: string;
  readonly avatar_path: string | null;
  readonly is_platform_user: boolean;
  readonly is_active: boolean;
}

export interface PlatformAdminRecord {
  readonly user_id: string;
  readonly role_key: 'platform_super_admin' | 'platform_support';
  readonly username: string;
  readonly is_active: boolean;
}

export interface TenantMembershipRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly username: string;
  readonly account_subject_type: AccountSubjectType;
  readonly role_key: string;
  readonly is_active: boolean;
  readonly must_change_password: boolean;
  readonly tenants?: TenantRecord | null;
}

export interface OnboardTenantInput {
  readonly idempotencyKey: string;
  readonly code: string;
  readonly slug: string;
  readonly name: string;
  readonly ownerEmail: string;
  readonly ownerUsername: string;
  readonly ownerDisplayName: string;
}

export interface OnboardTenantResponse {
  readonly tenant_id: string;
  readonly membership_id?: string;
  readonly already_existed: boolean;
}

export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled';
export type BillingCycle = 'monthly' | 'annual';
export type DomainType = 'subdomain' | 'custom';
export type DomainVerificationStatus = 'pending' | 'verified' | 'failed';
export type SslStatus = 'pending' | 'active' | 'error';
export type SupportAccessMode = 'read_only' | 'diagnostic_assist';

export interface SubscriptionPlanRecord {
  readonly id: string;
  readonly code: string;
  readonly name_ar: string;
  readonly description_ar: string | null;
  readonly monthly_price_egp: number;
  readonly annual_price_egp: number;
  readonly max_branches: number | null;
  readonly max_users: number | null;
  readonly max_couriers: number | null;
  readonly max_monthly_shipments: number | null;
  readonly allow_custom_domain: boolean;
  readonly allow_api_access: boolean;
  readonly is_active: boolean;
  readonly sort_order: number;
  readonly created_at: TimestampUtc;
  readonly updated_at: TimestampUtc;
}

export interface UpsertSubscriptionPlanInput {
  readonly id?: string;
  readonly code: string;
  readonly name_ar: string;
  readonly description_ar?: string | null;
  readonly monthly_price_egp: number;
  readonly annual_price_egp: number;
  readonly max_branches: number | null;
  readonly max_users: number | null;
  readonly max_couriers: number | null;
  readonly max_monthly_shipments: number | null;
  readonly allow_custom_domain: boolean;
  readonly allow_api_access: boolean;
  readonly is_active: boolean;
  readonly sort_order?: number;
}

export interface TenantSubscriptionSummary {
  readonly id: string;
  readonly plan_id: string;
  readonly plan_code: string;
  readonly plan_name_ar: string;
  readonly status: SubscriptionStatus;
  readonly billing_cycle: BillingCycle;
  readonly current_period_start: string;
  readonly current_period_end: string;
  readonly trial_ends_at: TimestampUtc | null;
  readonly effective_max_branches: number | null;
  readonly effective_max_users: number | null;
  readonly effective_max_couriers: number | null;
  readonly effective_max_monthly_shipments: number | null;
  readonly override_max_branches?: number | null;
  readonly override_max_users?: number | null;
  readonly override_max_couriers?: number | null;
  readonly override_max_monthly_shipments?: number | null;
  readonly allow_custom_domain: boolean;
  readonly allow_api_access: boolean;
  readonly notes?: string | null;
}

export interface AssignTenantSubscriptionInput {
  readonly plan_id?: string;
  readonly plan_code?: string;
  readonly status: SubscriptionStatus;
  readonly billing_cycle: BillingCycle;
  readonly current_period_start?: string;
  readonly current_period_end?: string;
  readonly override_max_branches?: number | null;
  readonly override_max_users?: number | null;
  readonly override_max_couriers?: number | null;
  readonly override_max_monthly_shipments?: number | null;
  readonly notes?: string | null;
}

export interface TenantUsageMetrics {
  readonly active_branches: number;
  readonly active_users: number;
  readonly active_couriers: number;
  readonly month_shipments: number;
}

export interface TenantDomainRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly tenant_name?: string;
  readonly tenant_slug?: string;
  readonly domain: string;
  readonly domain_type: DomainType;
  readonly is_primary: boolean;
  readonly verification_status: DomainVerificationStatus;
  readonly verification_token: string;
  readonly verified_at: TimestampUtc | null;
  readonly ssl_status: SslStatus;
  readonly created_at: TimestampUtc;
  readonly updated_at: TimestampUtc;
}

export interface UpsertTenantDomainInput {
  readonly domain: string;
  readonly domain_type: DomainType;
  readonly is_primary: boolean;
}

export interface PlatformSupportAccessRecord {
  readonly id: string;
  readonly support_user_id: string;
  readonly support_username?: string;
  readonly tenant_id: string;
  readonly tenant_name?: string;
  readonly tenant_slug?: string;
  readonly reason: string;
  readonly access_mode: SupportAccessMode;
  readonly expires_at: TimestampUtc;
  readonly revoked_at: TimestampUtc | null;
  readonly last_entered_at: TimestampUtc | null;
  readonly created_at: TimestampUtc;
}

export interface PlatformTenantDirectoryItem {
  readonly tenant: TenantRecord;
  readonly subscription: TenantSubscriptionSummary | null;
  readonly usage: TenantUsageMetrics;
  readonly primary_domain: string | null;
  readonly domains_count: number;
  readonly active_support_sessions_count: number;
}

export interface TenantSubscriptionOverview {
  readonly tenant_id: string;
  readonly subscription: TenantSubscriptionSummary | null;
  readonly usage: TenantUsageMetrics;
  readonly domains: readonly TenantDomainRecord[];
  readonly support_sessions: readonly PlatformSupportAccessRecord[];
}

export interface PlatformSupportSnapshot {
  readonly support_session: {
    readonly id: string;
    readonly reason: string;
    readonly access_mode: SupportAccessMode;
    readonly expires_at: TimestampUtc;
  };
  readonly tenant: {
    readonly id: string;
    readonly code: string;
    readonly slug: string;
    readonly name: string;
    readonly status: TenantStatus;
  };
  readonly metrics: {
    readonly branches_count: number;
    readonly active_users_count: number;
    readonly clients_count: number;
    readonly couriers_count: number;
    readonly total_shipments_count: number;
    readonly delivered_shipments_count: number;
    readonly failed_shipments_count: number;
  };
  readonly recent_audit_events: readonly {
    readonly id: string;
    readonly action: string;
    readonly entity_type: string;
    readonly source: string;
    readonly created_at: TimestampUtc;
  }[];
}

