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
  readonly brand_logo_path: string | null;
}

export interface TenantSettingsRecord {
  readonly tenant_id: string;
  readonly allow_client_self_registration: boolean;
  readonly auto_approve_clients: boolean;
  readonly brand_logo_path: string | null;
  readonly updated_at: TimestampUtc;
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
