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
