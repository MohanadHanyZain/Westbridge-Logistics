import {useCallback, useEffect, useState} from 'react';
import {DataTable, type DataTableColumn} from '@/components/ui/DataTable';
import {listTenantSessionAudit} from '@/features/security/securityService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {formatDateTime} from '@/lib/formatters';
import type {SessionAuditRecord} from '@/types/security';

const EVENT_LABELS: Record<SessionAuditRecord['event_type'], string> = {
  login_success: 'تسجيل دخول ناجح',
  login_failed: 'محاولة دخول فاشلة',
  logout: 'تسجيل خروج',
  password_changed: 'تغيير كلمة المرور',
  credentials_updated: 'تحديث بيانات الدخول',
};

export function SessionAuditPage() {
  const {tenant} = useTenantWorkspace();
  const [rows, setRows] = useState<readonly SessionAuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listTenantSessionAudit(tenant.id, 100);
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل سجل الجلسات.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const columns: readonly DataTableColumn<SessionAuditRecord>[] = [
    {
      key: 'created_at',
      header: 'التوقيت',
      render: (r) => <span className="font-mono-tabular text-xs text-slate-600">{formatDateTime(r.created_at)}</span>,
    },
    {
      key: 'user',
      header: 'المستخدم',
      render: (r) => (
        <div>
          <p className="font-mono-tabular text-xs font-semibold text-slate-900">
            {r.username ? `@${r.username}` : 'غير محدد'}
          </p>
          {r.display_name && <p className="text-xs text-slate-500">{r.display_name}</p>}
        </div>
      ),
    },
    {
      key: 'event',
      header: 'الحدث',
      render: (r) => (
        <span
          className={`text-xs font-medium ${
            r.event_type === 'login_failed' ? 'text-red-700' : 'text-slate-900'
          }`}
        >
          {EVENT_LABELS[r.event_type] ?? r.event_type}
        </span>
      ),
    },
    {
      key: 'details',
      header: 'التفاصيل',
      render: (r) => (
        <span className="font-mono-tabular text-xs text-slate-500">
          {Object.keys(r.metadata ?? {}).length > 0 ? JSON.stringify(r.metadata) : '—'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">سجل الدخول والجلسات</h1>
        <p className="mt-1 text-xs text-slate-500">
          سجل أمني غير قابل للتعديل لعمليات الدخول، المحاولات الفاشلة، وتحديث كلمات المرور داخل الشركة.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          {error}
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        loading={loading}
        emptyMessage="لا توجد أحداث تسجيل دخول أو جلسات مسجلة بعد."
      />
    </div>
  );
}
