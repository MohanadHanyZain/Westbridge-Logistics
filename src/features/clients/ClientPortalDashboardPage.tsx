import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {getClientPortalSummary} from '@/features/clients/clientPortalService';
import {listShipments} from '@/features/shipments/shipmentsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {updateMyCredentials, useAuth} from '@/lib/auth';
import {formatDateTime, isValidUsername} from '@/lib/formatters';
import type {ClientPortalPeriod, ClientPortalSummary} from '@/types/clientPortal';
import {SHIPMENT_STATUS_LABELS, type ShipmentListItem} from '@/types/shipments';
import {
  Check,
  Copy,
  FileSpreadsheet,
  Package,
  PackageCheck,
  PackagePlus,
  RotateCcw,
  ShieldCheck,
  Truck,
  Wallet,
} from 'lucide-react';

const PERIOD_OPTIONS: ReadonlyArray<{readonly key: ClientPortalPeriod; readonly label: string}> = [
  {key: 'all', label: 'كل الفترات'},
  {key: '7d', label: 'آخر 7 أيام'},
  {key: '30d', label: 'آخر 30 يومًا'},
  {key: '90d', label: 'آخر 90 يومًا'},
];

export function ClientPortalDashboardPage() {
  const {tenant, membership, boundClientId, can} = useTenantWorkspace();
  const {profile, refreshContext} = useAuth();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const [period, setPeriod] = useState<ClientPortalPeriod>('all');
  const [summary, setSummary] = useState<ClientPortalSummary | null>(null);
  const [recentShipments, setRecentShipments] = useState<readonly ShipmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Credentials update
  const [newUsername, setNewUsername] = useState(membership.username);
  const [newPassword, setNewPassword] = useState('');
  const [savingCreds, setSavingCreds] = useState(false);
  const [credsFeedback, setCredsFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  const targetClientId = boundClientId;

  const loadDashboard = useCallback(async () => {
    if (!targetClientId) {
      setError('حساب التاجر غير مربوط بسجل تجاري. تواصل مع إدارة الشركة.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [sum, shp] = await Promise.all([
        getClientPortalSummary(tenant.id, targetClientId, period),
        listShipments(tenant.id, {preset: 'all', clientId: targetClientId}),
      ]);
      setSummary(sum);
      setRecentShipments(shp.slice(0, 8));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات لوحة التاجر.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id, targetClientId, period]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleCopyTrack = async (id: string, token: string | null) => {
    if (!token) return;
    try {
      const url = `${window.location.origin}${buildTenantBasePath(tenant.slug)}/track/${token}`;
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      // Ignore clipboard failures in headless test environments
    }
  };

  const handleCredentialsSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setCredsFeedback(null);
    if (newUsername && !isValidUsername(newUsername)) {
      setCredsFeedback({type: 'error', text: 'صيغة اسم المستخدم غير صالحة (3–32 حرفًا إنجليزيًا/رقميًا).'});
      return;
    }
    if (newPassword && newPassword.length < 8) {
      setCredsFeedback({type: 'error', text: 'كلمة المرور يجب أن لا تقل عن 8 أحرف.'});
      return;
    }
    setSavingCreds(true);
    try {
      await updateMyCredentials({
        tenantId: tenant.id,
        newUsername: newUsername !== membership.username ? newUsername : undefined,
        newPassword: newPassword || undefined,
      });
      setNewPassword('');
      await refreshContext();
      setCredsFeedback({type: 'success', text: 'تم تحديث بيانات الحساب بنجاح.'});
    } catch (err) {
      setCredsFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحديث بيانات الدخول.',
      });
    } finally {
      setSavingCreds(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Period Filter */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-slate-500">
              بوابة التاجر · {tenant.name}
            </p>
            <h1 className="mt-1 text-xl font-bold text-slate-900">
              مرحبًا، {summary?.client?.name ?? profile?.display_name ?? membership.username}
            </h1>
            {summary?.client && (
              <p className="mt-1 font-mono-tabular text-xs text-slate-500">
                كود التاجر: {summary.client.code}
                {summary.client.governorate_name ? ` · ${summary.client.governorate_name}` : ''}
                {summary.client.region_name ? ` · ${summary.client.region_name}` : ''}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setPeriod(opt.key)}
                  className={`rounded-md px-3 py-1 text-xs font-medium whitespace-nowrap ${
                    period === opt.key
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          {can('shipments.create') && (
            <Link
              to={`${basePath}/shipments/new`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
            >
              <PackagePlus className="h-3.5 w-3.5" />
              إنشاء شحنة جديدة
            </Link>
          )}
          <Link
            to={`${basePath}/portal/pickups`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Truck className="h-3.5 w-3.5" />
            طلب التقاط مندوب
          </Link>
          <Link
            to={`${basePath}/portal/finance`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            كشف الحساب والمستحقات
          </Link>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Operational & Financial KPIs */}
      <section aria-label="مؤشرات أداء التاجر">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>إجمالي الشحنات</span>
              <Package className="h-4 w-4 text-slate-400" />
            </div>
            <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900">
              {loading ? '—' : summary?.total_shipments ?? 0}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              قيد التنفيذ: <span className="font-mono-tabular font-semibold">{summary?.in_progress_count ?? 0}</span>
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>شحنات مسلمة</span>
              <PackageCheck className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="mt-2 font-mono-tabular text-2xl font-bold text-emerald-700">
              {loading ? '—' : summary?.delivered_count ?? 0}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              مرتجعات: <span className="font-mono-tabular font-semibold">{summary?.returned_count ?? 0}</span>
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>صافي جاهز للتسوية</span>
              <Wallet className="h-4 w-4 text-slate-500" />
            </div>
            <p className="mt-2 font-mono-tabular text-2xl font-bold text-slate-900">
              {loading ? '—' : `${Number(summary?.ready_net_settlement_amount ?? 0).toFixed(2)} ${tenant.default_currency}`}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              عدد الشحنات الجاهزة: <span className="font-mono-tabular font-semibold">{summary?.ready_unsettled_count ?? 0}</span>
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>COD قيد التوريد</span>
              <RotateCcw className="h-4 w-4 text-amber-600" />
            </div>
            <p className="mt-2 font-mono-tabular text-2xl font-bold text-amber-700">
              {loading ? '—' : `${Number(summary?.in_flight_cod_amount ?? 0).toFixed(2)} ${tenant.default_currency}`}
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              طلبات التقاط مفتوحة: <span className="font-mono-tabular font-semibold">{summary?.pending_pickup_requests_count ?? 0}</span>
            </p>
          </div>
        </div>
      </section>

      {/* Financial Totals Strip */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">إجمالي تحصيلات COD خلال الفترة</p>
          <p className="mt-1 font-mono-tabular text-lg font-bold text-slate-900">
            {Number(summary?.cod_collected_amount ?? 0).toFixed(2)} {tenant.default_currency}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">إجمالي رسوم الشحن خلال الفترة</p>
          <p className="mt-1 font-mono-tabular text-lg font-bold text-slate-900">
            {Number(summary?.total_shipping_fees ?? 0).toFixed(2)} {tenant.default_currency}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">إجمالي التسويات المعتمدة</p>
          <p className="mt-1 font-mono-tabular text-lg font-bold text-emerald-700">
            {Number(summary?.total_settled_payout_amount ?? 0).toFixed(2)} {tenant.default_currency}
          </p>
        </div>
      </section>

      {/* Recent Shipments Table */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">أحدث الشحنات</h2>
          <Link
            to={`${basePath}/shipments`}
            className="text-xs font-medium text-slate-700 underline underline-offset-4 hover:text-slate-900"
          >
            عرض كل الشحنات
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">رقم الشحنة</th>
                <th className="px-4 py-3 font-medium">المرسل إليه</th>
                <th className="px-4 py-3 font-medium">الحالة</th>
                <th className="px-4 py-3 font-medium">مبلغ التحصيل</th>
                <th className="px-4 py-3 font-medium">رسوم الشحن</th>
                <th className="px-4 py-3 font-medium">التاريخ</th>
                <th className="px-4 py-3 font-medium">التتبع العام</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentShipments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {loading ? 'جاري تحميل الشحنات...' : 'لا توجد شحنات مسجلة لهذا التاجر بعد.'}
                  </td>
                </tr>
              ) : (
                recentShipments.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-mono-tabular font-semibold">
                      <Link to={`${basePath}/shipments/${s.id}`} className="text-slate-900 underline-offset-4 hover:underline">
                        {s.shipment_number}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      <p className="font-medium text-slate-900">{s.recipient_name ?? '—'}</p>
                      <p className="font-mono-tabular text-[11px] text-slate-500">{s.recipient_mobile ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {SHIPMENT_STATUS_LABELS[s.operational_status]}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-slate-900">
                      {Number(s.recipient_collect_amount).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-slate-700">
                      {Number(s.total_shipping_fee).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-slate-500 whitespace-nowrap">
                      {formatDateTime(s.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      {s.tracking_token ? (
                        <button
                          type="button"
                          onClick={() => void handleCopyTrack(s.id, s.tracking_token ?? null)}
                          className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
                        >
                          {copiedId === s.id ? (
                            <Check className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                          نسخ الرابط
                        </button>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Account Credentials Update */}
      {membership.account_subject_type === 'client' && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-slate-700" />
            <h2 className="text-base font-semibold text-slate-900">تحديث بيانات الدخول</h2>
          </div>
          {membership.must_change_password && (
            <p className="mt-2 text-xs font-medium text-amber-700">
              يُرجى تعيين كلمة مرور شخصية جديدة لاستكمال تفعيل حسابك.
            </p>
          )}
          <form onSubmit={handleCredentialsSubmit} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="portal-username" className="block text-xs font-medium text-slate-700">
                اسم المستخدم
              </label>
              <input
                id="portal-username"
                type="text"
                dir="ltr"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value.toLowerCase())}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>
            <div>
              <label htmlFor="portal-password" className="block text-xs font-medium text-slate-700">
                كلمة المرور الجديدة (8 أحرف على الأقل)
              </label>
              <input
                id="portal-password"
                type="password"
                dir="ltr"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="اتركه فارغًا إن لم ترغب بالتغيير"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={savingCreds}
                className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {savingCreds ? 'جاري الحفظ...' : 'حفظ التعديلات'}
              </button>
            </div>
          </form>
          {credsFeedback && (
            <p
              role="status"
              className={`mt-3 text-xs font-medium ${
                credsFeedback.type === 'error' ? 'text-red-700' : 'text-emerald-700'
              }`}
            >
              {credsFeedback.text}
            </p>
          )}
        </section>
      )}
    </div>
  );
}