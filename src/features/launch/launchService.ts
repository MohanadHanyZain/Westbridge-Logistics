import {getSupabaseClient} from '@/lib/supabase/client';
import type {
  BackupPolicyRecord,
  BackupRestoreDrillRecord,
  LaunchReadinessOverview,
  RecordRestoreDrillInput,
  UpdateBackupPolicyInput,
} from '@/types/launch';

export async function getLaunchReadinessOverview(): Promise<LaunchReadinessOverview> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('عميل Supabase غير مهيأ بعد.');
  }

  const {data, error} = await client.rpc('get_launch_readiness_overview');
  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر تحميل تقرير الجاهزية الأمنية والنسخ الاحتياطي.');
  }

  return data as LaunchReadinessOverview;
}

export async function updateBackupPolicy(input: UpdateBackupPolicyInput): Promise<BackupPolicyRecord> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('عميل Supabase غير مهيأ بعد.');
  }

  const {data, error} = await client.rpc('update_backup_policy', {
    p_payload: {
      rpo_minutes: input.rpo_minutes,
      rto_minutes: input.rto_minutes,
      storage_rto_minutes: input.storage_rto_minutes,
      retention_days: input.retention_days,
      pitr_enabled: input.pitr_enabled,
      daily_snapshot_enabled: input.daily_snapshot_enabled,
      storage_sync_enabled: input.storage_sync_enabled,
      drill_cadence_days: input.drill_cadence_days,
      notes: input.notes ?? null,
    },
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر تحديث سياسة النسخ الاحتياطي.');
  }

  return data as BackupPolicyRecord;
}

export async function recordBackupRestoreDrill(
  input: RecordRestoreDrillInput,
): Promise<BackupRestoreDrillRecord> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('عميل Supabase غير مهيأ بعد.');
  }

  const {data, error} = await client.rpc('record_backup_restore_drill', {
    p_payload: {
      environment: input.environment,
      rto_achieved_minutes: input.rto_achieved_minutes,
      storage_verified: input.storage_verified,
      rls_verified: input.rls_verified,
      status: input.status,
      notes: input.notes ?? null,
    },
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر تسجيل اختبار الاستعادة.');
  }

  return data as BackupRestoreDrillRecord;
}