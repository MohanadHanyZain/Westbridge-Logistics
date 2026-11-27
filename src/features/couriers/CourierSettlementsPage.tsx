import {LoadingState} from '@/components/ui/LoadingState';
import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {FilterBar} from '@/components/ui/FilterBar';
import {buildTenantBasePath} from '@/config/brand';
import {listCommissionLists, listCourierRoutes, listCouriers} from '@/features/couriers/couriersService';
import {listBranches} from '@/features/definitions/definitionsService';
import {
  approveCourierCommissionPayout,
  createCourierCommissionPayout,
  getCashboxesWithBalances,
  getCourierCustodyOverview,
  getTenantFinancePolicy,
  listCourierCommissionPayouts,
  listCourierPayableCommissions,
} from '@/features/finance/financeService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {useAuth} from '@/lib/auth';
import {formatCurrency} from '@/lib/formatters';
import type {CourierCommissionListRecord, CourierRecord, CourierRouteRecord} from '@/types/couriers';
import type {BranchRecord} from '@/types/definitions';
import {
  FINANCE_DOC_STATUS_LABELS,
  type CashboxBalanceRecord,
  type CourierCommissionPayoutRecord,
  type CourierCustodyOverviewRecord,
  type PayableCommissionShipmentItem,
  type TenantFinancePolicyRecord,
} from '@/types/finance';
import {AlertCircle, CheckCircle2, Coins, Wallet} from 'lucide-react';

export function CourierSettlementsPage() {
  const {user} = useAuth();
  const {tenant, membership, can} = useTenantWorkspace();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const [couriers, setCouriers] = useState<readonly CourierRecord[]>([]);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [routes, setRoutes] = useState<readonly CourierRouteRecord[]>([]);
  const [commLists, setCommLists] = useState<readonly CourierCommissionListRecord[]>([]);
  const [overview, setOverview] = useState<readonly CourierCustodyOverviewRecord[]>([]);
  const [payouts, setPayouts] = useState<readonly CourierCommissionPayoutRecord[]>([]);
  const [cashboxes, setCashboxes] = useState<readonly CashboxBalanceRecord[]>([]);
  const [policy, setPolicy] = useState<TenantFinancePolicyRecord>({
    tenant_id: tenant.id,
    enforce_four_eyes: true,
    allow_owner_self_approve: true,
    high_value_approval_threshold: 0,
  });

  const [search, setSearch] = useState('');
  const [selectedCourierId, setSelectedCourierId] = useState('');
  const [commissions, setCommissions] = useState<readonly PayableCommissionShipmentItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const [branchId, setBranchId] = useState('');
  const [cashboxId, setCashboxId] = useState('');
  const [bonusAmount, setBonusAmount] = useState('0');
  const [deductionAmount, setDeductionAmount] = useState('0');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(true);
  const [loadingCommissions, setLoadingCommissions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  const isAdmin = membership.role_key === 'company_owner' || membership.role_key === 'company_admin';
  const canCreate = can('finance.settlements.create') || can('finance.payouts.approve') || isAdmin;
  const canApprove = can('finance.payouts.approve') || isAdmin;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cRows, bRows, rRows, clRows, ovRows, payRows, boxRows, pol] = await Promise.all([
        listCouriers(tenant.id),
        listBranches(tenant.id),
        listCourierRoutes(tenant.id),
        listCommissionLists(tenant.id),
        getCourierCustodyOverview(tenant.id).catch(() => [] as CourierCustodyOverviewRecord[]),
        listCourierCommissionPayouts(tenant.id).catch(() => [] as CourierCommissionPayoutRecord[]),
        getCashboxesWithBalances(tenant.id).catch(() => [] as CashboxBalanceRecord[]),
        getTenantFinancePolicy(tenant.id).catch(() => ({
          tenant_id: tenant.id,
          enforce_four_eyes: true,
          allow_owner_self_approve: true,
          high_value_approval_threshold: 0,
        })),
      ]);
      setCouriers(cRows);
      setBranches(bRows);
      setRoutes(rRows);
      setCommLists(clRows);
      setOverview(ovRows);
      setPayouts(payRows);
      setCashboxes(boxRows);
      setPolicy(pol);

      if (!branchId && bRows[0]) setBranchId(bRows[0].id);
      if (!cashboxId && boxRows[0]) setCashboxId(boxRows[0].id);
      if (!selectedCourierId) {
        const ready = ovRows.find((o) => o.payable_commission_amount > 0) ?? ovRows[0];
        if (ready) setSelectedCourierId(ready.courier_id);
        else if (cRows[0]) setSelectedCourierId(cRows[0].id);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحميل بيانات تسوية المناديب وعمولاتهم.',
      });
    } finally {
      setLoading(false);
    }
  }, [tenant.id, branchId, cashboxId, selectedCourierId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const loadCourierCommissions = useCallback(async () => {
    if (!selectedCourierId) {
      setCommissions([]);
      setSelectedIds(new Set());
      return;
    }
    setLoadingCommissions(true);
    try {
      const rows = await listCourierPayableCommissions(tenant.id, selectedCourierId);
      setCommissions(rows);
      setSelectedIds(new Set(rows.filter((r) => r.eligible_for_payout).map((r) => r.shipment_id)));
    } catch {
      setCommissions([]);
      setSelectedIds(new Set());
    } finally {
      setLoadingCommissions(false);
    }
  }, [tenant.id, selectedCourierId]);

  useEffect(() => {
    void loadCourierCommissions();
  }, [loadCourierCommissions]);

  const courierMap = useMemo(() => new Map(couriers.map((c) => [c.id, c])), [couriers]);
  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const routeMap = useMemo(() => new Map(routes.map((r) => [r.id, r.name])), [routes]);
  const commMap = useMemo(() => new Map(commLists.map((c) => [c.id, c.name])), [commLists]);
  const cashboxMap = useMemo(() => new Map(cashboxes.map((b) => [b.id, `${b.code} — ${b.name}`])), [cashboxes]);

  const mergedRows = useMemo(() => {
    const baseList: readonly CourierCustodyOverviewRecord[] =
      overview.length > 0
        ? overview
        : couriers.map((c) => ({
            courier_id: c.id,
            code: c.code,
            name: c.name,
            mobile: c.mobile,
            branch_id: c.branch_id,
            shipment_custody_count: 0,
            uncollected_cash_shipments_count: 0,
            uncollected_cash_amount: 0,
            total_accrued_commission: 0,
            payable_commission_amount: 0,
          }));

    const q = search.trim().toLowerCase();
    if (!q) return baseList;
    return baseList.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        r.mobile.toLowerCase().includes(q),
    );
  }, [overview, couriers, search]);

  const toggleShipment = (item: PayableCommissionShipmentItem) => {
    if (!item.eligible_for_payout) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.shipment_id)) next.delete(item.shipment_id);
      else next.add(item.shipment_id);
      return next;
    });
  };

  const payoutCalc = useMemo(() => {
    const selected = commissions.filter((c) => selectedIds.has(c.shipment_id));
    const commSum = selected.reduce((sum, c) => sum + Number(c.accrued_courier_commission || 0), 0);
    const bonus = Number(bonusAmount || 0);
    const ded = Number(deductionAmount || 0);
    const net = Math.max(0, commSum + (Number.isFinite(bonus) ? bonus : 0) - (Number.isFinite(ded) ? ded : 0));
    return {count: selected.length, commSum, bonus, ded, net};
  }, [commissions, selectedIds, bonusAmount, deductionAmount]);

  const handleCreatePayout = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCourierId || selectedIds.size === 0 || !cashboxId) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const courierRec = courierMap.get(selectedCourierId);
      const res = await createCourierCommissionPayout(tenant.id, {
        branch_id: branchId || courierRec?.branch_id || branches[0]?.id || '',
        courier_id: selectedCourierId,
        cashbox_id: cashboxId,
        shipment_ids: Array.from(selectedIds),
        bonus_amount: Number(bonusAmount || 0),
        deduction_amount: Number(deductionAmount || 0),
        notes: notes.trim() || undefined,
      });
      setBonusAmount('0');
      setDeductionAmount('0');
      setNotes('');
      setFeedback({
        type: 'success',
        text: `تم إنشاء سند صرف العمولات ${res.payout_code} بصافي ${formatCurrency(res.net_payout_amount, tenant.default_currency)} وبانتظار الاعتماد.`,
      });
      await Promise.all([loadData(), loadCourierCommissions()]);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر إنشاء سند صرف العمولات.'});
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprovePayout = async (payoutId: string) => {
    setSubmitting(true);
    setFeedback(null);
    try {
      await approveCourierCommissionPayout(tenant.id, payoutId);
      setFeedback({type: 'success', text: 'تم اعتماد سند صرف العمولات وخصمه من الخزينة.'});
      await Promise.all([loadData(), loadCourierCommissions()]);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر اعتماد سند صرف العمولات.'});
    } finally {
      setSubmitting(false);
    }
  };

  const isFourEyesBlocked = (createdBy: string | null) => {
    if (!policy.enforce_four_eyes || !createdBy || createdBy !== user?.id) return false;
    if (membership.role_key === 'company_owner' && policy.allow_owner_self_approve) return false;
    return true;
  };

  const kpiTotals = useMemo(
    () => ({
      uncollectedCash: overview.reduce((s, r) => s + Number(r.uncollected_cash_amount || 0), 0),
      totalAccrued: overview.reduce((s, r) => s + Number(r.total_accrued_commission || 0), 0),
      totalPayable: overview.reduce((s, r) => s + Number(r.payable_commission_amount || 0), 0),
    }),
    [overview],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">قيد التسوية مع المندوبين</h1>
          <p className="mt-1 text-xs text-slate-500">
            فصل المبالغ المحصلة من العملاء عن العمولات المستحقة للمندوبين.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2">
            <span className="text-slate-500">عهدة نقدية غير موردة: </span>
            <strong className="font-mono-tabular text-amber-700">
              {formatCurrency(kpiTotals.uncollectedCash, tenant.default_currency)}
            </strong>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-2">
            <span className="text-slate-500">عمولات جاهزة للصرف: </span>
            <strong className="font-mono-tabular text-emerald-700">
              {formatCurrency(kpiTotals.totalPayable, tenant.default_currency)}
            </strong>
          </div>
          <Link
            to={`${basePath}/finance/collections`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 font-medium text-slate-800 hover:bg-slate-50"
          >
            <Wallet className="h-3.5 w-3.5" />
            توريد عهدة النقدية (COL)
          </Link>
        </div>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-lg border px-4 py-2.5 text-xs ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث باسم المندوب أو الكود أو الموبايل..."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Couriers List */}
        <div className="space-y-3 lg:col-span-5">
          <h2 className="text-sm font-semibold text-slate-900">ملخص عهد وعمولات المناديب</h2>
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {loading ? (
              <p className="p-4 text-xs text-slate-500"><LoadingState className="p-4" label="جارٍ تحميل بيانات المناديب" /></p>
            ) : mergedRows.length === 0 ? (
              <p className="p-4 text-xs text-slate-500">لا يوجد مناديب مسجلون بعد.</p>
            ) : (
              mergedRows.map((row) => {
                const isSelected = row.courier_id === selectedCourierId;
                const rec = courierMap.get(row.courier_id);
                return (
                  <button
                    key={row.courier_id}
                    type="button"
                    onClick={() => setSelectedCourierId(row.courier_id)}
                    className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-right transition-colors ${
                      isSelected ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold">
                        <span className="font-mono-tabular opacity-75">{row.code}</span> · {row.name}
                      </p>
                      <p className={`mt-0.5 text-[11px] ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {row.branch_id ? branchMap.get(row.branch_id) ?? '—' : 'غير محدد'} ·{' '}
                        {rec ? routeMap.get(rec.default_route_id) ?? '—' : '—'}
                      </p>
                      <p className={`mt-0.5 text-[11px] ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {rec ? commMap.get(rec.commission_list_id) ?? '—' : '—'} · {row.shipment_custody_count} طرد بالعهدة
                      </p>
                    </div>
                    <div className="shrink-0 text-left">
                      <p className={`font-mono-tabular text-xs font-bold ${isSelected ? 'text-emerald-300' : 'text-emerald-700'}`}>
                        عمولة: {formatCurrency(row.payable_commission_amount, tenant.default_currency)}
                      </p>
                      <p className={`mt-0.5 font-mono-tabular text-[11px] ${isSelected ? 'text-amber-300' : 'text-amber-700'}`}>
                        نقدية غير موردة: {formatCurrency(row.uncollected_cash_amount, tenant.default_currency)}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Commission Payout Workbench */}
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Coins className="h-4 w-4 text-slate-600" />
              صرف عمولات المندوب {selectedCourierId ? courierMap.get(selectedCourierId)?.name : ''} (CMP)
            </h2>
            <span className="font-mono-tabular text-xs font-bold text-slate-900">
              الصافي للصرف: {formatCurrency(payoutCalc.net, tenant.default_currency)}
            </span>
          </div>

          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <p>
              لا يُسمح بصرف عمولة أي شحنة{' '}
              <strong className="font-mono-tabular">COD</strong> قبل توريد نقديتها إلى الخزينة عبر{' '}
              <Link to={`${basePath}/finance/collections`} className="font-semibold underline">
                سند التحصيل من المندوب (COL)
              </Link>
              .
            </p>
          </div>

          <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-right">تحديد</th>
                  <th className="px-3 py-2 text-right">الشحنة</th>
                  <th className="px-3 py-2 text-right">الدفع</th>
                  <th className="px-3 py-2 text-right">حالة الاستحقاق</th>
                  <th className="px-3 py-2 text-right">العمولة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingCommissions ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-5 text-center text-slate-500">
                      جارٍ فحص عمولات المندوب...
                    </td>
                  </tr>
                ) : commissions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-5 text-center text-slate-500">
                      لا توجد عمولات مستحقة غير مصروفة لهذا المندوب.
                    </td>
                  </tr>
                ) : (
                  commissions.map((item) => {
                    const locked = !item.eligible_for_payout;
                    return (
                      <tr key={item.shipment_id} className={locked ? 'bg-amber-50/50 text-slate-500' : ''}>
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            disabled={locked}
                            checked={selectedIds.has(item.shipment_id)}
                            onChange={() => toggleShipment(item)}
                          />
                        </td>
                        <td className="px-3 py-2 font-mono-tabular font-semibold text-slate-900">
                          {item.shipment_number}
                        </td>
                        <td className="px-3 py-2 font-mono-tabular">{item.payment_term_code}</td>
                        <td className="px-3 py-2">
                          {locked ? (
                            <span className="text-[11px] font-medium text-amber-700">
                              معلّقة لحين توريد المبلغ المحصل
                            </span>
                          ) : (
                            <span className="text-[11px] font-medium text-emerald-700">جاهزة للصرف</span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono-tabular font-bold text-slate-900">
                          {formatCurrency(item.accrued_courier_commission, tenant.default_currency)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {canCreate && (
            <form onSubmit={handleCreatePayout} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="cmp-branch" className="block text-xs font-medium text-slate-700">
                  الفرع
                </label>
                <select
                  id="cmp-branch"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="cmp-cashbox" className="block text-xs font-medium text-slate-700">
                  الخزينة الصادرة
                </label>
                <select
                  id="cmp-cashbox"
                  value={cashboxId}
                  onChange={(e) => setCashboxId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  {cashboxes.map((cb) => (
                    <option key={cb.id} value={cb.id}>
                      {cb.code} — {cb.name} ({formatCurrency(cb.current_balance, tenant.default_currency)})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="cmp-bonus" className="block text-xs font-medium text-slate-700">
                  حافز إضافي (+)
                </label>
                <input
                  id="cmp-bonus"
                  type="number"
                  min={0}
                  step="0.01"
                  value={bonusAmount}
                  onChange={(e) => setBonusAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular"
                />
              </div>
              <div>
                <label htmlFor="cmp-deduction" className="block text-xs font-medium text-slate-700">
                  خصم / سلفة (-)
                </label>
                <input
                  id="cmp-deduction"
                  type="number"
                  min={0}
                  step="0.01"
                  value={deductionAmount}
                  onChange={(e) => setDeductionAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor="cmp-notes" className="block text-xs font-medium text-slate-700">
                  ملاحظات الصرف
                </label>
                <input
                  id="cmp-notes"
                  type="text"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <div className="sm:col-span-2">
                <button
                  type="submit"
                  disabled={submitting || selectedIds.size === 0 || !cashboxId}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <Coins className="h-3.5 w-3.5" />
                  إنشاء سند صرف عمولات (CMP)
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Commission Payouts History */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">سجل سندات صرف عمولات المناديب (CMP)</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 text-right font-semibold">رقم السند</th>
                <th className="px-3 py-3 text-right font-semibold">المندوب</th>
                <th className="px-3 py-3 text-right font-semibold">الخزينة</th>
                <th className="px-3 py-3 text-right font-semibold">إجمالي العمولات</th>
                <th className="px-3 py-3 text-right font-semibold">حافز / خصم</th>
                <th className="px-3 py-3 text-right font-semibold">الصافي المصروف</th>
                <th className="px-3 py-3 text-right font-semibold">الحالة</th>
                <th className="px-3 py-3 text-right font-semibold">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payouts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                    لا توجد سندات صرف عمولات مسجلة بعد.
                  </td>
                </tr>
              ) : (
                payouts.map((p) => {
                  const blocked = isFourEyesBlocked(p.created_by);
                  return (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-mono-tabular font-semibold">{p.payout_code}</td>
                      <td className="px-3 py-2.5">{courierMap.get(p.courier_id)?.name ?? p.courier_id}</td>
                      <td className="px-3 py-2.5">{cashboxMap.get(p.cashbox_id) ?? p.cashbox_id}</td>
                      <td className="px-3 py-2.5 font-mono-tabular">
                        {formatCurrency(p.total_commission_amount, tenant.default_currency)}
                      </td>
                      <td className="px-3 py-2.5 font-mono-tabular text-slate-600">
                        +{formatCurrency(p.bonus_amount, tenant.default_currency)} / -
                        {formatCurrency(p.deduction_amount, tenant.default_currency)}
                      </td>
                      <td className="px-3 py-2.5 font-mono-tabular font-bold text-emerald-700">
                        {formatCurrency(p.net_payout_amount, tenant.default_currency)}
                      </td>
                      <td className="px-3 py-2.5">{FINANCE_DOC_STATUS_LABELS[p.status]}</td>
                      <td className="px-3 py-2.5">
                        {p.status === 'draft' && canApprove ? (
                          blocked ? (
                            <span className="text-[11px] text-amber-700">بانتظار اعتماد مراجع آخر</span>
                          ) : (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => handleApprovePayout(p.id)}
                              className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-800"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              اعتماد وصرف
                            </button>
                          )
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
