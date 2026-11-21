import {useCallback, useEffect, useState} from 'react';
import {listClients} from '@/features/clients/clientsService';
import {listBranches} from '@/features/definitions/definitionsService';
import {downloadCsvFile} from '@/features/reports/exportUtils';
import {
  getExecutiveOperationsReport,
  recordExportJob,
} from '@/features/reports/reportsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {formatCurrency, formatNumber} from '@/lib/formatters';
import type {BranchRecord} from '@/types/definitions';
import type {ClientRecord} from '@/types/pricing';
import type {ExecutiveOperationsReport} from '@/types/reports';
import {BarChart3, Download, Printer, RefreshCw} from 'lucide-react';

function getDaysAgoIso(days: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() - days);
  return dt.toISOString().slice(0, 10);
}

export function ExecutiveReportsPage() {
  const {tenant, boundClientId} = useTenantWorkspace();

  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [branchId, setBranchId] = useState('');
  const [clientId, setClientId] = useState(boundClientId ?? '');
  const [periodPreset, setPeriodPreset] = useState<'all' | '7d' | '30d'>('all');

  const [report, setReport] = useState<ExecutiveOperationsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadRefs = useCallback(async () => {
    const [br, cl] = await Promise.all([
      listBranches(tenant.id).catch(() => []),
      listClients(tenant.id).catch(() => []),
    ]);
    setBranches(br);
    setClients(cl);
  }, [tenant.id]);

  const loadReport = useCallback(
    async (overrides?: {dateFrom?: string; dateTo?: string}) => {
      setLoading(true);
      setError(null);
      try {
        const res = await getExecutiveOperationsReport({
          tenantId: tenant.id,
          dateFrom: overrides?.dateFrom !== undefined ? overrides.dateFrom : dateFrom || null,
          dateTo: overrides?.dateTo !== undefined ? overrides.dateTo : dateTo || null,
          branchId: branchId || null,
          clientId: boundClientId || clientId || null,
        });
        setReport(res);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر تحميل التقرير التنفيذي.');
      } finally {
        setLoading(false);
      }
    },
    [tenant.id, dateFrom, dateTo, branchId, clientId, boundClientId],
  );

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const applyPeriodPreset = (preset: 'all' | '7d' | '30d') => {
    setPeriodPreset(preset);
    if (preset === 'all') {
      setDateFrom('');
      setDateTo('');
      void loadReport({dateFrom: '', dateTo: ''});
      return;
    }
    const days = preset === '7d' ? 7 : 30;
    const from = getDaysAgoIso(days);
    const to = new Date().toISOString().slice(0, 10);
    setDateFrom(from);
    setDateTo(to);
    void loadReport({dateFrom: from, dateTo: to});
  };

  const handleExportCsv = async () => {
    if (!report) return;
    const headers = ['القسم', 'البند / الجهة', 'إجمالي الشحنات', 'تم التسليم', 'المرتجع', 'القيمة المالية'];
    const rows: (string | number)[][] = [
      ['المؤشرات العامة', 'إجمالي الشحنات', report.kpis.total_shipments, report.kpis.delivered_count, report.kpis.returned_count, report.kpis.total_shipping_revenue],
      ['المؤشرات العامة', 'نسبة النجاح من المحاولة الأولى %', report.kpis.first_attempt_success_rate, '', '', ''],
      ['المؤشرات العامة', 'نسبة المرتجعات %', report.kpis.return_rate, '', '', ''],
      ['المؤشرات العامة', 'COD المحصل', '', '', '', report.kpis.total_cod_collected],
      ...report.by_branch.map((b) => [
        'أداء الفروع',
        b.branch_name,
        b.total_count,
        b.delivered_count,
        b.returned_count,
        b.shipping_revenue,
      ]),
      ...report.by_governorate.map((g) => [
        'التوزيع الجغرافي',
        g.governorate_name,
        g.total_count,
        g.delivered_count,
        g.returned_count,
        g.cod_collected,
      ]),
      ...report.by_courier.map((cr) => [
        'أداء المناديب',
        cr.courier_name,
        cr.assigned_count,
        cr.delivered_count,
        cr.failed_or_returned_count,
        cr.accrued_commission,
      ]),
    ];

    downloadCsvFile(
      `executive_report_${tenant.code}_${new Date().toISOString().slice(0, 10)}.csv`,
      headers,
      rows,
    );

    await recordExportJob({
      tenantId: tenant.id,
      exportType: 'executive_report_csv',
      format: 'csv',
      filters: {dateFrom, dateTo, branchId, clientId: boundClientId || clientId},
      rowCount: rows.length,
    }).catch(() => undefined);
  };

  const handlePrint = async () => {
    await recordExportJob({
      tenantId: tenant.id,
      exportType: 'executive_report_print',
      format: 'print_a4',
      filters: {dateFrom, dateTo, branchId, clientId: boundClientId || clientId},
      rowCount: report?.kpis.total_shipments ?? 0,
    }).catch(() => undefined);

    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    }
  };

  const kpis = report?.kpis;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-slate-700" />
            <h1 className="text-xl font-bold text-slate-900">التقارير التنفيذية والتشغيلية</h1>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            تحليل حركة الشحنات، الالتزام بوقت التسليم (SLA)، أداء الفروع والمحافظات والمناديب، والتدفقات المالية.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!report}
            onClick={() => void handleExportCsv()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            تصدير CSV/Excel
          </button>
          <button
            type="button"
            disabled={!report}
            onClick={() => void handlePrint()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            <Printer className="h-3.5 w-3.5" />
            طباعة التقرير
          </button>
        </div>
      </div>

      {/* Filters */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <span className="block text-xs font-medium text-slate-600">الفترة السريعة</span>
            <div className="mt-1.5 inline-flex rounded-lg border border-slate-200 p-0.5">
              {(
                [
                  {id: 'all', label: 'الكل'},
                  {id: '7d', label: 'آخر 7 أيام'},
                  {id: '30d', label: 'آخر 30 يومًا'},
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyPeriodPreset(item.id)}
                  className={`rounded-md px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    periodPreset === item.id
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="rep-from" className="block text-xs text-slate-600">من تاريخ</label>
            <input
              id="rep-from"
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setPeriodPreset('all');
                setDateFrom(e.target.value);
              }}
              className="mt-1 rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
            />
          </div>

          <div>
            <label htmlFor="rep-to" className="block text-xs text-slate-600">إلى تاريخ</label>
            <input
              id="rep-to"
              type="date"
              value={dateTo}
              onChange={(e) => {
                setPeriodPreset('all');
                setDateTo(e.target.value);
              }}
              className="mt-1 rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
            />
          </div>

          {!boundClientId && (
            <>
              <div>
                <label htmlFor="rep-branch" className="block text-xs text-slate-600">الفرع</label>
                <select
                  id="rep-branch"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
                >
                  <option value="">كل الفروع</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="rep-client" className="block text-xs text-slate-600">العميل</label>
                <select
                  id="rep-client"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
                >
                  <option value="">كل العملاء</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <button
            type="button"
            onClick={() => void loadReport()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            تحديث التقرير
          </button>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Operational & SLA KPIs */}
      <section aria-label="ملخص مؤشرات الأداء">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[
            {label: 'إجمالي الشحنات', val: kpis ? formatNumber(kpis.total_shipments) : '—'},
            {label: 'بانتظار الالتقاط', val: kpis ? formatNumber(kpis.pending_pickup_count) : '—'},
            {label: 'بالمخزن والنقل', val: kpis ? formatNumber(kpis.in_warehouse_count) : '—'},
            {label: 'قيد التوصيل', val: kpis ? formatNumber(kpis.out_for_delivery_count) : '—'},
            {label: 'تم التسليم', val: kpis ? formatNumber(kpis.delivered_count) : '—'},
            {label: 'تسليم جزئي', val: kpis ? formatNumber(kpis.partially_delivered_count) : '—'},
            {label: 'مرتجعات', val: kpis ? formatNumber(kpis.returned_count) : '—'},
            {label: 'نجاح المحاولة الأولى', val: kpis ? `${kpis.first_attempt_success_rate}%` : '—'},
            {label: 'معدل المرتجعات', val: kpis ? `${kpis.return_rate}%` : '—'},
            {label: 'متأخرة > 72 ساعة', val: kpis ? formatNumber(kpis.sla_delayed_count) : '—'},
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">{item.label}</p>
              <p className="mt-1.5 font-mono-tabular text-xl font-bold text-slate-900">{item.val}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Financial Snapshot */}
      <section aria-label="الملخص المالي للتقرير">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {label: 'إجمالي إيرادات الشحن', val: kpis ? formatCurrency(kpis.total_shipping_revenue) : '—'},
            {label: 'إجمالي مبالغ COD المحصلة', val: kpis ? formatCurrency(kpis.total_cod_collected) : '—'},
            {label: 'مستحقات التجار المعلقة', val: kpis ? formatCurrency(kpis.pending_client_payouts) : '—'},
            ...(!boundClientId
              ? [
                  {label: 'نقدية معلقة بعهدة المناديب', val: kpis ? formatCurrency(kpis.pending_courier_cash) : '—'},
                  {label: 'عمولات المناديب المستحقة', val: kpis ? formatCurrency(kpis.total_accrued_commissions) : '—'},
                  {label: 'صافي رصيد الخزائن الفعلي', val: kpis ? formatCurrency(kpis.total_cashbox_balance) : '—'},
                ]
              : [{label: 'متوسط مدة دورة التسليم', val: kpis ? `${kpis.avg_cycle_hours} ساعة` : '—'}]),
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-medium text-slate-500">{item.label}</p>
              <p className="mt-1.5 font-mono-tabular text-lg font-bold text-slate-900">{item.val}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">توزيع الشحنات حسب الفرع</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">الفرع</th>
                  <th className="px-3 py-2 font-medium">الإجمالي</th>
                  <th className="px-3 py-2 font-medium">المسلمة</th>
                  <th className="px-3 py-2 font-medium">المرتجعة</th>
                  <th className="px-3 py-2 font-medium">رسوم الشحن</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(report?.by_branch ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-500">لا توجد بيانات فروع.</td>
                  </tr>
                ) : (
                  (report?.by_branch ?? []).map((b) => (
                    <tr key={b.branch_id}>
                      <td className="px-3 py-2 font-medium text-slate-900">{b.branch_name}</td>
                      <td className="px-3 py-2 font-mono-tabular">{b.total_count}</td>
                      <td className="px-3 py-2 font-mono-tabular text-emerald-700">{b.delivered_count}</td>
                      <td className="px-3 py-2 font-mono-tabular text-red-700">{b.returned_count}</td>
                      <td className="px-3 py-2 font-mono-tabular">{formatCurrency(b.shipping_revenue)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">توزيع المحافظات والتحصيل</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">المحافظة</th>
                  <th className="px-3 py-2 font-medium">الإجمالي</th>
                  <th className="px-3 py-2 font-medium">المسلمة</th>
                  <th className="px-3 py-2 font-medium">المرتجعة</th>
                  <th className="px-3 py-2 font-medium">COD محصل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(report?.by_governorate ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-500">لا توجد بيانات محافظات.</td>
                  </tr>
                ) : (
                  (report?.by_governorate ?? []).map((g) => (
                    <tr key={g.governorate_id}>
                      <td className="px-3 py-2 font-medium text-slate-900">{g.governorate_name}</td>
                      <td className="px-3 py-2 font-mono-tabular">{g.total_count}</td>
                      <td className="px-3 py-2 font-mono-tabular text-emerald-700">{g.delivered_count}</td>
                      <td className="px-3 py-2 font-mono-tabular text-red-700">{g.returned_count}</td>
                      <td className="px-3 py-2 font-mono-tabular">{formatCurrency(g.cod_collected)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {!boundClientId && (
          <>
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">أعلى التجار والعملاء حجمًا</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">العميل</th>
                      <th className="px-3 py-2 font-medium">الشحنات</th>
                      <th className="px-3 py-2 font-medium">المسلمة</th>
                      <th className="px-3 py-2 font-medium">إيراد الشحن</th>
                      <th className="px-3 py-2 font-medium">معلق للتسوية</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(report?.by_client ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-slate-500">لا توجد بيانات عملاء.</td>
                      </tr>
                    ) : (
                      (report?.by_client ?? []).map((c) => (
                        <tr key={c.client_id}>
                          <td className="px-3 py-2 font-medium text-slate-900">{c.client_name}</td>
                          <td className="px-3 py-2 font-mono-tabular">{c.total_count}</td>
                          <td className="px-3 py-2 font-mono-tabular text-emerald-700">{c.delivered_count}</td>
                          <td className="px-3 py-2 font-mono-tabular">{formatCurrency(c.shipping_revenue)}</td>
                          <td className="px-3 py-2 font-mono-tabular">{formatCurrency(c.net_payable)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">أداء المناديب والعهدة والعمولات</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 font-medium">المندوب</th>
                      <th className="px-3 py-2 font-medium">المسند</th>
                      <th className="px-3 py-2 font-medium">المسلم</th>
                      <th className="px-3 py-2 font-medium">نقدية بالعهدة</th>
                      <th className="px-3 py-2 font-medium">العمولة المستحقة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(report?.by_courier ?? []).length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-slate-500">لا توجد بيانات مناديب.</td>
                      </tr>
                    ) : (
                      (report?.by_courier ?? []).map((cr) => (
                        <tr key={cr.courier_id}>
                          <td className="px-3 py-2 font-medium text-slate-900">{cr.courier_name}</td>
                          <td className="px-3 py-2 font-mono-tabular">{cr.assigned_count}</td>
                          <td className="px-3 py-2 font-mono-tabular text-emerald-700">{cr.delivered_count}</td>
                          <td className="px-3 py-2 font-mono-tabular">{formatCurrency(cr.cod_held_amount)}</td>
                          <td className="px-3 py-2 font-mono-tabular">{formatCurrency(cr.accrued_commission)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
