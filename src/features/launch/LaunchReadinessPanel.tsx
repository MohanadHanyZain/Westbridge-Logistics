import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {formatDateTime} from '@/lib/formatters';
import * as launchService from '@/features/launch/launchService';
import type {
  LaunchReadinessOverview,
  RestoreDrillEnvironment,
  RestoreDrillStatus,
} from '@/types/launch';
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseBackup,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

interface LaunchReadinessPanelProps {
  readonly isSuperAdmin: boolean;
}

function getEnvironmentLabel(env: RestoreDrillEnvironment): string {
  switch (env) {
    case 'staging':
      return 'بيئة الاختبار (Staging)';
    case 'isolated_clone':
      return 'نسخة معزولة (Isolated Clone)';
    case 'production_readonly':
      return 'فحص قراءة للإنتاج';
  }
}

function getDrillStatusInfo(status: RestoreDrillStatus): {label: string; className: string} {
  switch (status) {
    case 'passed':
      return {label: 'ناجح', className: 'text-emerald-700'};
    case 'failed':
      return {label: 'فشل', className: 'text-red-700'};
    case 'scheduled':
      return {label: 'مجدول', className: 'text-amber-700'};
  }
}

export function LaunchReadinessPanel({isSuperAdmin}: LaunchReadinessPanelProps) {
  const [overview, setOverview] = useState<LaunchReadinessOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  // Policy form state
  const [rpoMinutes, setRpoMinutes] = useState(15);
  const [rtoMinutes, setRtoMinutes] = useState(60);
  const [storageRtoMinutes, setStorageRtoMinutes] = useState(120);
  const [retentionDays, setRetentionDays] = useState(30);
  const [drillCadenceDays, setDrillCadenceDays] = useState(30);
  const [pitrEnabled, setPitrEnabled] = useState(true);
  const [dailySnapshotEnabled, setDailySnapshotEnabled] = useState(true);
  const [storageSyncEnabled, setStorageSyncEnabled] = useState(true);
  const [policyNotes, setPolicyNotes] = useState('');
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Drill form state
  const [drillEnv, setDrillEnv] = useState<RestoreDrillEnvironment>('isolated_clone');
  const [drillRtoMinutes, setDrillRtoMinutes] = useState(25);
  const [drillStatus, setDrillStatus] = useState<RestoreDrillStatus>('passed');
  const [drillStorageVerified, setDrillStorageVerified] = useState(true);
  const [drillRlsVerified, setDrillRlsVerified] = useState(true);
  const [drillNotes, setDrillNotes] = useState('');
  const [savingDrill, setSavingDrill] = useState(false);

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await launchService.getLaunchReadinessOverview();
      setOverview(data);
      setRpoMinutes(data.policy.rpo_minutes);
      setRtoMinutes(data.policy.rto_minutes);
      setStorageRtoMinutes(data.policy.storage_rto_minutes);
      setRetentionDays(data.policy.retention_days);
      setDrillCadenceDays(data.policy.drill_cadence_days);
      setPitrEnabled(data.policy.pitr_enabled);
      setDailySnapshotEnabled(data.policy.daily_snapshot_enabled);
      setStorageSyncEnabled(data.policy.storage_sync_enabled);
      setPolicyNotes(data.policy.notes ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات جاهزية الإطلاق.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const handleSavePolicy = async (e: FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) return;
    setSavingPolicy(true);
    setFeedback(null);
    try {
      await launchService.updateBackupPolicy({
        rpo_minutes: rpoMinutes,
        rto_minutes: rtoMinutes,
        storage_rto_minutes: storageRtoMinutes,
        retention_days: retentionDays,
        drill_cadence_days: drillCadenceDays,
        pitr_enabled: pitrEnabled,
        daily_snapshot_enabled: dailySnapshotEnabled,
        storage_sync_enabled: storageSyncEnabled,
        notes: policyNotes.trim() || null,
      });
      setFeedback({type: 'success', text: 'تم تحديث سياسة النسخ الاحتياطي (RPO/RTO) وتوثيقها في التدقيق.'});
      await loadOverview();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حفظ سياسة النسخ الاحتياطي.',
      });
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleRecordDrill = async (e: FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) return;
    setSavingDrill(true);
    setFeedback(null);
    try {
      await launchService.recordBackupRestoreDrill({
        environment: drillEnv,
        rto_achieved_minutes: drillRtoMinutes,
        storage_verified: drillStorageVerified,
        rls_verified: drillRlsVerified,
        status: drillStatus,
        notes: drillNotes.trim() || null,
      });
      setDrillNotes('');
      setFeedback({type: 'success', text: 'تم تسجيل اختبار الاستعادة وتحديث حالة الجاهزية للإطلاق.'});
      await loadOverview();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تسجيل اختبار الاستعادة.',
      });
    } finally {
      setSavingDrill(false);
    }
  };

  if (loading && !overview) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        جاري فحص كتالوج قاعدة البيانات وسياسات النسخ الاحتياطي...
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        <p className="font-semibold">تعذر إجراء الفحص الأمني الحي</p>
        <p className="mt-1 text-xs">{error}</p>
      </div>
    );
  }

  if (!overview) {
    return null;
  }

  const audit = overview.security_audit;
  const metrics = overview.operational_metrics;

  const auditChecks = [
    {
      label: 'إلزام FORCE ROW LEVEL SECURITY على جميع جداول public',
      passed: audit.unprotected_tables_count === 0,
      detail:
        audit.unprotected_tables_count === 0
          ? `${audit.rls_forced_count} / ${audit.total_public_tables} جدول محمي بالكامل`
          : `جداول غير محمية: ${audit.unprotected_tables.join(', ')}`,
    },
    {
      label: 'خلو جداول التطبيق من أعمدة كلمات المرور',
      passed: audit.password_columns_count === 0,
      detail: `${audit.password_columns_count} عمود مشبوه في مخطط public`,
    },
    {
      label: 'حجب token_hash ومخططات app_private و audit عن المتصفح',
      passed: !audit.token_hash_exposed && !audit.app_private_exposed && !audit.audit_schema_exposed,
      detail:
        !audit.token_hash_exposed && !audit.app_private_exposed && !audit.audit_schema_exposed
          ? 'معزولة بالكامل عن anon و authenticated'
          : 'رُصد تسرب صلاحيات على عمود أو مخطط خاص',
    },
    {
      label: 'خصوصية الملفات المرفوعة',
      passed: audit.public_exposed_buckets_count === 0,
      detail: `${audit.private_storage_buckets_count} حاويات خاصة · ${audit.public_exposed_buckets_count} مكشوفة`,
    },
    {
      label: 'تفعيل Point-in-Time Recovery (PITR) ومؤشر الأداء',
      passed: overview.policy.pitr_enabled && audit.performance_indexes_count > 0,
      detail: `PITR ${overview.policy.pitr_enabled ? 'مفعل' : 'متوقف'} · ${audit.performance_indexes_count} فهرس أداء نشط`,
    },
    {
      label: 'اجتياز اختبار استعادة موثق (Restore Drill)',
      passed: metrics.passed_drills_count >= 1,
      detail: `${metrics.passed_drills_count} اختبار ناجح مسجل`,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header & Launch Verdict */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">
              مراجعة الأمان والنسخ الاحتياطي وجاهزية الإطلاق
            </p>
            <div className="mt-1.5 flex items-center gap-2.5">
              {overview.ready_for_launch ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-700" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-amber-700" />
              )}
              <h2 className="text-lg font-bold text-slate-900">
                {overview.ready_for_launch
                  ? 'النظام مستوفٍ لشروط الإطلاق الإنتاجي'
                  : 'مطلوب استكمال متطلبات الإطلاق قبل التفعيل'}
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              آخر فحص حي للكتالوج: <span className="font-mono-tabular">{formatDateTime(audit.checked_at)}</span>
              {' · '}
              آخر اختبار استعادة ناجح:{' '}
              <span className="font-mono-tabular">
                {overview.policy.last_verified_drill_at
                  ? formatDateTime(overview.policy.last_verified_drill_at)
                  : 'لم يسجل بعد'}
              </span>
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadOverview()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            إعادة الفحص الأمني الآن
          </button>
        </div>

        {/* Operational Snapshot */}
        <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-5 md:grid-cols-4">
          <div>
            <p className="text-xs text-slate-500">الشركات النشطة / الإجمالي</p>
            <p className="mt-1 font-mono-tabular text-base font-bold text-slate-900">
              {metrics.active_tenants} / {metrics.total_tenants}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">الشحنات المسجلة</p>
            <p className="mt-1 font-mono-tabular text-base font-bold text-slate-900">
              {metrics.total_shipments}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">رموز API / Webhooks النشطة</p>
            <p className="mt-1 font-mono-tabular text-base font-bold text-slate-900">
              {metrics.active_api_tokens} / {metrics.active_webhooks}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">إشعارات Webhook المعلقة</p>
            <p className="mt-1 font-mono-tabular text-base font-bold text-slate-900">
              {metrics.pending_webhooks}
            </p>
          </div>
        </div>
      </section>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-xs font-medium ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Automated Security Checklist */}
      <section aria-label="المراجعة الأمنية الحية" className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <ShieldCheck className="h-4 w-4 text-slate-700" />
          <h3 className="text-sm font-semibold text-slate-900">فحوصات العزل والأمان والأداء (PostgreSQL Catalog)</h3>
        </div>

        <div className="divide-y divide-slate-100">
          {auditChecks.map((item) => (
            <div key={item.label} className="flex flex-col gap-1 py-3 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-2.5">
                {item.passed ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
                ) : (
                  <ShieldAlert className="h-4 w-4 shrink-0 text-red-700" />
                )}
                <span className="text-xs font-medium text-slate-900">{item.label}</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono-tabular text-slate-600">{item.detail}</span>
                <span className={`font-semibold ${item.passed ? 'text-emerald-700' : 'text-red-700'}`}>
                  {item.passed ? 'سليم' : 'يتطلب معالجة'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Policy + Restore Drill Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* RPO / RTO Backup Policy */}
        <section aria-label="سياسة النسخ الاحتياطي RPO و RTO" className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <DatabaseBackup className="h-4 w-4 text-slate-700" />
            <h3 className="text-sm font-semibold text-slate-900">سياسة النسخ الاحتياطي (RPO / RTO)</h3>
          </div>

          {!isSuperAdmin && (
            <p className="mt-3 text-xs text-amber-700">
              عرض فقط: تعديل سياسة النسخ الاحتياطي متاح حصريًا لـ platform_super_admin.
            </p>
          )}

          <form onSubmit={handleSavePolicy} className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="policy-rpo" className="block text-xs font-medium text-slate-700">
                  مستهدف RPO (دقيقة)
                </label>
                <input
                  id="policy-rpo"
                  type="number"
                  min={1}
                  max={1440}
                  disabled={!isSuperAdmin}
                  value={rpoMinutes}
                  onChange={(e) => setRpoMinutes(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm disabled:bg-slate-50"
                />
              </div>
              <div>
                <label htmlFor="policy-rto" className="block text-xs font-medium text-slate-700">
                  مستهدف RTO لقاعدة البيانات (دقيقة)
                </label>
                <input
                  id="policy-rto"
                  type="number"
                  min={5}
                  max={1440}
                  disabled={!isSuperAdmin}
                  value={rtoMinutes}
                  onChange={(e) => setRtoMinutes(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm disabled:bg-slate-50"
                />
              </div>
              <div>
                <label htmlFor="policy-storage-rto" className="block text-xs font-medium text-slate-700">
                  مستهدف RTO لحاويات Storage (دقيقة)
                </label>
                <input
                  id="policy-storage-rto"
                  type="number"
                  min={5}
                  max={2880}
                  disabled={!isSuperAdmin}
                  value={storageRtoMinutes}
                  onChange={(e) => setStorageRtoMinutes(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm disabled:bg-slate-50"
                />
              </div>
              <div>
                <label htmlFor="policy-retention" className="block text-xs font-medium text-slate-700">
                  مدة الاحتفاظ (يوم)
                </label>
                <input
                  id="policy-retention"
                  type="number"
                  min={7}
                  max={365}
                  disabled={!isSuperAdmin}
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm disabled:bg-slate-50"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  disabled={!isSuperAdmin}
                  checked={pitrEnabled}
                  onChange={(e) => setPitrEnabled(e.target.checked)}
                />
                تفعيل PITR
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  disabled={!isSuperAdmin}
                  checked={dailySnapshotEnabled}
                  onChange={(e) => setDailySnapshotEnabled(e.target.checked)}
                />
                نسخة يومية مشفرة
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  disabled={!isSuperAdmin}
                  checked={storageSyncEnabled}
                  onChange={(e) => setStorageSyncEnabled(e.target.checked)}
                />
                مزامنة حاويات Storage
              </label>
            </div>

            <div>
              <label htmlFor="policy-cadence" className="block text-xs font-medium text-slate-700">
                دورية اختبار الاستعادة الإلزامي (أيام)
              </label>
              <input
                id="policy-cadence"
                type="number"
                min={7}
                max={90}
                disabled={!isSuperAdmin}
                value={drillCadenceDays}
                onChange={(e) => setDrillCadenceDays(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm disabled:bg-slate-50"
              />
            </div>

            <div>
              <label htmlFor="policy-notes" className="block text-xs font-medium text-slate-700">
                ملاحظات التشغيل والتعافي
              </label>
              <textarea
                id="policy-notes"
                rows={2}
                disabled={!isSuperAdmin}
                value={policyNotes}
                onChange={(e) => setPolicyNotes(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50"
              />
            </div>

            {isSuperAdmin && (
              <button
                type="submit"
                disabled={savingPolicy}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {savingPolicy ? 'جاري الحفظ...' : 'حفظ سياسة النسخ الاحتياطي'}
              </button>
            )}
          </form>
        </section>

        {/* Record Restore Drill */}
        <section aria-label="توثيق اختبار استعادة جديد" className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <ShieldCheck className="h-4 w-4 text-slate-700" />
            <h3 className="text-sm font-semibold text-slate-900">تسجيل اختبار استعادة (Restore Drill)</h3>
          </div>

          <form onSubmit={handleRecordDrill} className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="drill-env" className="block text-xs font-medium text-slate-700">
                  بيئة الاختبار المعزولة
                </label>
                <select
                  id="drill-env"
                  disabled={!isSuperAdmin}
                  value={drillEnv}
                  onChange={(e) => setDrillEnv(e.target.value as RestoreDrillEnvironment)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs disabled:bg-slate-50"
                >
                  <option value="isolated_clone">نسخة معزولة (Isolated Clone)</option>
                  <option value="staging">بيئة الاختبار (Staging)</option>
                  <option value="production_readonly">فحص قراءة للإنتاج</option>
                </select>
              </div>
              <div>
                <label htmlFor="drill-status" className="block text-xs font-medium text-slate-700">
                  نتيجة الاختبار
                </label>
                <select
                  id="drill-status"
                  disabled={!isSuperAdmin}
                  value={drillStatus}
                  onChange={(e) => setDrillStatus(e.target.value as RestoreDrillStatus)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs disabled:bg-slate-50"
                >
                  <option value="passed">ناجح (Passed)</option>
                  <option value="failed">فشل (Failed)</option>
                  <option value="scheduled">مجدول (Scheduled)</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="drill-rto" className="block text-xs font-medium text-slate-700">
                زمن الاستعادة الفعلي المحقق (دقيقة)
              </label>
              <input
                id="drill-rto"
                type="number"
                min={1}
                max={10080}
                disabled={!isSuperAdmin}
                value={drillRtoMinutes}
                onChange={(e) => setDrillRtoMinutes(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm disabled:bg-slate-50"
              />
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  disabled={!isSuperAdmin}
                  checked={drillStorageVerified}
                  onChange={(e) => setDrillStorageVerified(e.target.checked)}
                />
                تم التحقق من حاويات Storage
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  disabled={!isSuperAdmin}
                  checked={drillRlsVerified}
                  onChange={(e) => setDrillRlsVerified(e.target.checked)}
                />
                تم التحقق من FORCE RLS والعزل
              </label>
            </div>

            <div>
              <label htmlFor="drill-notes" className="block text-xs font-medium text-slate-700">
                تقرير / ملاحظات الاستعادة
              </label>
              <textarea
                id="drill-notes"
                rows={3}
                disabled={!isSuperAdmin}
                value={drillNotes}
                onChange={(e) => setDrillNotes(e.target.value)}
                placeholder="مثال: استعادة نقطة PITR في مشروع Staging ومطابقة أرصدة الخزائن والمرفقات"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50"
              />
            </div>

            {isSuperAdmin && (
              <button
                type="submit"
                disabled={savingDrill}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {savingDrill ? 'جاري التسجيل...' : 'توثيق اختبار الاستعادة'}
              </button>
            )}
          </form>
        </section>
      </div>

      {/* Restore Drills History Table */}
      <section aria-label="سجل اختبارات الاستعادة" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-sm font-semibold text-slate-900">سجل اختبارات الاستعادة الموثقة</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="px-4 py-3">البيئة</th>
                <th className="px-4 py-3">الحالة</th>
                <th className="px-4 py-3">RTO الفعلي</th>
                <th className="px-4 py-3">تطابق Storage / RLS</th>
                <th className="px-4 py-3">الملاحظات</th>
                <th className="px-4 py-3">تاريخ التنفيذ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {overview.drills.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    لا توجد اختبارات استعادة مسجلة بعد. سجّل أول اختبار في بيئة معزولة لاعتماد الجاهزية.
                  </td>
                </tr>
              ) : (
                overview.drills.map((drill) => {
                  const statusMeta = getDrillStatusInfo(drill.status);
                  return (
                    <tr key={drill.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {getEnvironmentLabel(drill.environment)}
                      </td>
                      <td className={`px-4 py-3 font-semibold ${statusMeta.className}`}>
                        <span className="inline-flex items-center gap-1">
                          {drill.status === 'passed' ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : drill.status === 'failed' ? (
                            <XCircle className="h-3.5 w-3.5" />
                          ) : (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          )}
                          {statusMeta.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono-tabular text-slate-700">
                        {drill.rto_achieved_minutes} دقيقة
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        Storage: {drill.storage_verified ? 'نعم' : 'لا'} · RLS: {drill.rls_verified ? 'نعم' : 'لا'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{drill.notes ?? '—'}</td>
                      <td className="px-4 py-3 font-mono-tabular text-slate-600">
                        {formatDateTime(drill.created_at)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
