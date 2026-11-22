export type RestoreDrillEnvironment = 'staging' | 'isolated_clone' | 'production_readonly';
export type RestoreDrillStatus = 'passed' | 'failed' | 'scheduled';

export interface BackupPolicyRecord {
  readonly id: string;
  readonly policy_code: 'DEFAULT';
  readonly rpo_minutes: number;
  readonly rto_minutes: number;
  readonly storage_rto_minutes: number;
  readonly retention_days: number;
  readonly pitr_enabled: boolean;
  readonly daily_snapshot_enabled: boolean;
  readonly storage_sync_enabled: boolean;
  readonly drill_cadence_days: number;
  readonly last_verified_drill_at: string | null;
  readonly notes: string | null;
  readonly updated_at: string;
}

export interface BackupRestoreDrillRecord {
  readonly id: string;
  readonly environment: RestoreDrillEnvironment;
  readonly backup_point_at: string;
  readonly started_at: string;
  readonly completed_at: string | null;
  readonly rto_achieved_minutes: number;
  readonly storage_verified: boolean;
  readonly rls_verified: boolean;
  readonly status: RestoreDrillStatus;
  readonly notes: string | null;
  readonly executed_by: string | null;
  readonly created_at: string;
}

export interface SecurityCatalogAuditSummary {
  readonly checked_at: string;
  readonly total_public_tables: number;
  readonly rls_enabled_count: number;
  readonly rls_forced_count: number;
  readonly unprotected_tables_count: number;
  readonly unprotected_tables: readonly string[];
  readonly password_columns_count: number;
  readonly token_hash_exposed: boolean;
  readonly app_private_exposed: boolean;
  readonly audit_schema_exposed: boolean;
  readonly private_storage_buckets_count: number;
  readonly public_exposed_buckets_count: number;
  readonly performance_indexes_count: number;
}

export interface PlatformOperationalMetrics {
  readonly total_tenants: number;
  readonly active_tenants: number;
  readonly active_plans: number;
  readonly active_api_tokens: number;
  readonly active_webhooks: number;
  readonly pending_webhooks: number;
  readonly total_shipments: number;
  readonly passed_drills_count: number;
}

export interface LaunchReadinessOverview {
  readonly policy: BackupPolicyRecord;
  readonly drills: readonly BackupRestoreDrillRecord[];
  readonly security_audit: SecurityCatalogAuditSummary;
  readonly operational_metrics: PlatformOperationalMetrics;
  readonly ready_for_launch: boolean;
}

export interface UpdateBackupPolicyInput {
  readonly rpo_minutes: number;
  readonly rto_minutes: number;
  readonly storage_rto_minutes: number;
  readonly retention_days: number;
  readonly pitr_enabled: boolean;
  readonly daily_snapshot_enabled: boolean;
  readonly storage_sync_enabled: boolean;
  readonly drill_cadence_days: number;
  readonly notes?: string | null;
}

export interface RecordRestoreDrillInput {
  readonly environment: RestoreDrillEnvironment;
  readonly rto_achieved_minutes: number;
  readonly storage_verified: boolean;
  readonly rls_verified: boolean;
  readonly status: RestoreDrillStatus;
  readonly notes?: string | null;
}
