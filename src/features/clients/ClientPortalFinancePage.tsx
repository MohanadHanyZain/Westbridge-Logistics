import {useCallback, useEffect, useMemo, useState} from 'react';
import {getClientAccountStatement} from '@/features/clients/clientPortalService';
import {listClients} from '@/features/clients/clientsService';
import {listClientUnsettledShipments} from '@/features/finance/financeService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {ClientAccountStatement} from '@/types/clientPortal';
import type {ClientUnsettledShipmentItem} from '@/types/finance';
import type {ClientRecord} from '@/types/pricing';
import {PAYMENT_TERM_LABELS, SHIPMENT_STATUS_LABELS, type ShipmentOperationalStatus} from '@/types/shipments';
import {Printer} from 'lucide-react';

export function ClientPortalFinancePage() {
  const {tenant, boundClientId} = useTenantWorkspace();

  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [selectedClientId, setSelectedClientId] = useState(boundClientId ?? '');
  const [tab, setTab] = useState<'unsettled' | 'statement'>('unsettled');

  const [unsettled, setUnsettled] = useState<readonly ClientUnsettledShipmentItem[]>([]);
  const [statement, setStatement] = useState<ClientAccountStatement | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (boundClientId) {
      setSelectedClientId(boundClientId);
      return;
    }
    let active = true;
    listClients(tenant.id)
      .then((rows) => {
        if (!active) return;
        const activeRows = rows.filter((c) => c.is_active);
        setClients(activeRows);
        setSelectedClientId((curr) => curr || activeRows[0]?.id || '');
      })
      .catch(() => {
        // Ignore
      });
    return () => {
      active = false;
    };
  }, [tenant.id, boundClientId]);

  const targetClientId = boundClientId ?? selectedClientId;

  const loadFinance = useCallback(async () => {
    if (!targetClientId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [unsettledRows, stmt] = await Promise.all([
        listClientUnsettledShipments(tenant.id, targetClientId),
        getClientAccountStatement(tenant.id, targetClientId, dateFrom || null, dateTo || null),
      ]);
      setUnsettled(unsettledRows);
      setStatement(stmt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل البيانات المالية للتاجر.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id, targetClientId, dateFrom, dateTo]);

  useEffect(() => {
    void loadFinance();
  }, [loadFinance]);

  const unsettledTotal = useMemo(
    () => unsettled.reduce((sum, item) => sum + Number(item.net_client_amount ?? 0), 0),
    [unsettled],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">المالية: قيد التسوية وكشف الحساب</h1>
          <p className="mt-1 text-xs text-slate-500">
            متابعة الشحنات المستحقة للتسوية، التسويات المعتمدة، الرصيد المسبق، وكشف الحساب التفصيلي.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {!boundClientId && clients.length > 0 && (
            <select
              aria-label="اختيار التاجر"
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setTab('unsettled')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                tab === 'unsettled' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              قيد التسوية ({unsettled.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('statement')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                tab === 'statement' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              كشف الحساب والتسويات
            </button>
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Printer className="h-3.5 w-3.5" />
            طباعة كشف الحساب
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Key Financial Strip */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">صافي جاهز للتسوية الآن</p>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-slate-900">
            {Number(statement?.ready_unsettled_net ?? unsettledTotal).toFixed(2)} {tenant.default_currency}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">COD قيد التوريد من المناديب</p>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-amber-700">
            {Number(statement?.in_flight_cod_amount ?? 0).toFixed(2)} {tenant.default_currency}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">الرصيد الافتتاحي للفترة</p>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-slate-700">
            {Number(statement?.opening_balance ?? 0).toFixed(2)} {tenant.default_currency}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">الرصيد الختامي بالحساب</p>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-emerald-700">
            {Number(statement?.closing_balance ?? 0).toFixed(2)} {tenant.default_currency}
          </p>
        </div>
      </section>

      {tab === 'unsettled' ? (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">رقم الشحنة</th>
                <th className="px-4 py-3 font-medium">الحالة</th>
                <th className="px-4 py-3 font-medium">طريقة الدفع</th>
                <th className="px-4 py-3 font-medium">المبلغ المحصل (COD)</th>
                <th className="px-4 py-3 font-medium">رسوم الشحن</th>
                <th className="px-4 py-3 font-medium">رسوم الإرجاع</th>
                <th className="px-4 py-3 font-medium">صافي مستحق التاجر</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {unsettled.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    {loading ? 'جاري تحميل الشحنات قيد التسوية...' : 'لا توجد شحنات مستحقة للتسوية حاليًا.'}
                  </td>
                </tr>
              ) : (
                unsettled.map((item) => (
                  <tr key={item.shipment_id}>
                    <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">
                      {item.shipment_number}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      {SHIPMENT_STATUS_LABELS[item.operational_status as ShipmentOperationalStatus] ?? item.operational_status}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {PAYMENT_TERM_LABELS[item.payment_term_code as keyof typeof PAYMENT_TERM_LABELS] ?? item.payment_term_code}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-slate-900">
                      {Number(item.cod_collected_amount).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-slate-700">
                      {Number(item.shipping_fee_deducted).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-slate-700">
                      {Number(item.return_fee_deducted).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular font-bold text-slate-900">
                      {Number(item.net_client_amount).toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
            <div>
              <label htmlFor="stmt-from" className="block text-xs font-medium text-slate-700">
                من تاريخ
              </label>
              <input
                id="stmt-from"
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="mt-1 rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
              />
            </div>
            <div>
              <label htmlFor="stmt-to" className="block text-xs font-medium text-slate-700">
                إلى تاريخ
              </label>
              <input
                id="stmt-to"
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="mt-1 rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
              />
            </div>
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => {
                  setDateFrom('');
                  setDateTo('');
                }}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                مسح الفلتر
              </button>
            )}

            <div className="mr-auto flex items-center gap-6 text-xs">
              <span>
                إجمالي دائن:{' '}
                <strong className="font-mono-tabular text-emerald-700">
                  {Number(statement?.total_credits ?? 0).toFixed(2)}
                </strong>
              </span>
              <span>
                إجمالي مدين:{' '}
                <strong className="font-mono-tabular text-slate-900">
                  {Number(statement?.total_debits ?? 0).toFixed(2)}
                </strong>
              </span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">التاريخ</th>
                  <th className="px-4 py-3 font-medium">المرجع</th>
                  <th className="px-4 py-3 font-medium">البيان</th>
                  <th className="px-4 py-3 font-medium">دائن (مستحق للتاجر)</th>
                  <th className="px-4 py-3 font-medium">مدين (سداد / خصم)</th>
                  <th className="px-4 py-3 font-medium">الرصيد التراكمي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!statement || statement.entries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                      {loading ? 'جاري تحميل كشف الحساب...' : 'لا توجد حركات مالية معتمدة خلال الفترة المحددة.'}
                    </td>
                  </tr>
                ) : (
                  statement.entries.map((row) => (
                    <tr key={row.row_id}>
                      <td className="px-4 py-3 font-mono-tabular text-slate-600 whitespace-nowrap">
                        {row.entry_date}
                      </td>
                      <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900 whitespace-nowrap">
                        {row.reference_code}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {row.description}
                        {row.payout_reference ? ` · مرجع: ${row.payout_reference}` : ''}
                      </td>
                      <td className="px-4 py-3 font-mono-tabular text-emerald-700">
                        {Number(row.credit_amount).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 font-mono-tabular text-slate-900">
                        {Number(row.debit_amount).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 font-mono-tabular font-bold text-slate-900">
                        {Number(row.running_balance).toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
