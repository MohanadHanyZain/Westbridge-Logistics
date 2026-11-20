import type {AccountSubjectType, PermissionScope, TimestampUtc} from '@/types/common';

export type PermissionModule =
  | 'dashboard'
  | 'definitions'
  | 'clients'
  | 'pricing'
  | 'couriers'
  | 'shipments'
  | 'operations'
  | 'finance'
  | 'accounting'
  | 'security'
  | 'integrations';

export interface PermissionCatalogRecord {
  readonly key: string;
  readonly module: PermissionModule;
  readonly label_ar: string;
  readonly description_ar: string | null;
  readonly default_scope: PermissionScope;
  readonly is_sensitive: boolean;
}

export interface RoleRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly default_subject_type: 'staff' | 'client' | 'courier';
  readonly default_scope: PermissionScope;
  readonly is_system: boolean;
  readonly is_active: boolean;
  readonly created_at: TimestampUtc;
}

export interface RolePermissionRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly role_id: string;
  readonly permission_key: string;
  readonly scope: PermissionScope;
}

export interface TenantUserDirectoryItem {
  readonly membership_id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly username: string;
  readonly display_name: string;
  readonly account_subject_type: AccountSubjectType;
  readonly role_key: string;
  readonly role_id: string | null;
  readonly role_name: string;
  readonly is_active: boolean;
  readonly must_change_password: boolean;
  readonly client_id: string | null;
  readonly client_code: string | null;
  readonly client_name: string | null;
  readonly courier_id: string | null;
  readonly courier_code?: string | null;
  readonly courier_name?: string | null;
  readonly branch_ids: readonly string[];
  readonly branch_names: readonly string[];
  readonly created_at: TimestampUtc;
}

export interface SessionAuditRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string | null;
  readonly username: string | null;
  readonly display_name: string | null;
  readonly event_type:
    | 'login_success'
    | 'login_failed'
    | 'logout'
    | 'password_changed'
    | 'credentials_updated';
  readonly metadata: Record<string, unknown>;
  readonly created_at: TimestampUtc;
}

export interface EffectivePermissionGrant {
  readonly permission_key: string;
  readonly scope: PermissionScope;
}

export interface MyTenantPermissionsBundle {
  readonly membership_id?: string;
  readonly role_key?: string;
  readonly account_subject_type?: AccountSubjectType;
  readonly client_id: string | null;
  readonly courier_id?: string | null;
  readonly branch_ids: readonly string[];
  readonly permissions: readonly EffectivePermissionGrant[];
}
