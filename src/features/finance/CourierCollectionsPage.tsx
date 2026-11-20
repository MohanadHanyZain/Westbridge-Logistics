import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {listBranches} from '@/features/definitions/definitionsService';
import {
  approveCourierCollectionVoucher,
  createCourierCollectionVoucher,
  getCashboxesWithBalances,
  getCourierCustodyOverview,
  getTenantFinancePolicy,
  listCourierCollectionVouchers,
  listCourierUncollectedCashShipments,
} from '@/features/finance/financeService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {useAuth} from '@/lib/auth';
import {formatCurrency} from '@/lib/formatters';
import type {BranchRecord} from '@/types/definitions';
import {
  FINANCE_DOC_STATUS_LABELS,
  type CashboxBalanceRecord,
  type CourierCollectionVoucherRecord,
  type CourierCustodyOverviewRecord,
  type TenantFinancePolicyRecord,
  type UncollectedCashShipmentItem,
} from '@/types/finance';
import {CheckCircle2, Coins, Wallet} from 'lucide-react';

export function CourierCollectionsPage() {
  const {user} = useAuth();
  const {tenant, membership, can} = useTenantWorkspace();

  const [overview, setOverview] = useState<readonly CourierCustodyOverviewRecord[]>([]);
  const [vouchers, setVouchers] = useState<readonly CourierCollectionVoucherRecord[]>([]);
  const [cashboxes, setCashboxes] = useState<readonly CashboxBalanceRecord[]>([]);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [policy, setPolicy] = useState<TenantFinancePolicyRecord>({
    tenant_id: tenant.id,
    enforce_four_eyes: true,
    allow_owner_self_approve: true,
    high_value_approval_threshold: 0,
  });

  const [selectedCourierId, setSelectedCourierId] = useState('');
  const [uncollectedShipments, setUncollectedShipments] = useState<readonly UncollectedCashShipmentItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [branchId, setBranchId] = useState('');
  const [cashboxId, setCashboxId] = useState('');
  const [collectedAmountInput, setCollectedAmountInput] = useState('');
  const [notes, setNotes] = useState('');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  const isAdmin = membership.role_key === 'company_owner' || membership.role_key === 'company_admin';
  const canCreate = can('finance.collections.create') || can('finance.collections.approve') || isAdmin;
  const canApprove = can('finance.collections.approve') || isAdmin;

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, vcs, boxes, br, pol] = await Promise.all([
        getCourierCustodyOverview(tenant.id),
        listCourierCollectionVouchers(tenant.id),
        getCashboxesWithBalances(tenant.id),
        listBranches(tenant.id),
        getTenantFinancePolicy(tenant.id),
      ]);
      setOverview(ov);
      setVouchers(vcs);
      setCashboxes(boxes);
      setBranches(br);
      setPolicy(pol);

      if (!branchId && br[0]) setBranchId(br[0].id);
      if (!cashboxId && boxes[0]) setCashboxId(boxes[0].id);
      if (!selectedCourierId) {
        const withCash = ov.find((c) => c.uncollected_cash_shipments_count > 0) ?? ov[0];
        if (withCash) setSelectedCourierId(withCash.courier_id);
      }
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحميل بيانات تحصيل المناديب.'});
    } finally {
      setLoading(false);
    }
  }, [tenant.id, branchId, cashboxId, selectedCourierId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const loadCourierShipments = useCallback(async () => {
    if (!selectedCourierId) {
      setUncollectedShipments([]);
      return;
    }
    try {
      const rows = await listCourierUncollectedCashShipments(tenant.id, selectedCourierId);
      setUncollectedShipments(rows);
      const allIds = new Set(rows.map((r) => r.shipment_id));
      setSelectedIds(allIds);
      const expected = rows.reduce((sum, r) => sum + Number(r.expected_amount || 0), 0);
      setCollectedAmountInput(expected > 0 ? String(expected) : '');
    } catch {
      setUncollectedShipments([]);
    }
  }, [tenant.id, selectedCourierId]);

  useEffect(() => {
    void loadCourierShipments();
  }, [loadCourierShipments]);

  const courierMap = useMemo(() => new Map(overview.map((c) => [c.courier_id, c])), [overview]);
  const cashboxMap = useMemo(() => new Map(cashboxes.map((b) => [b.id, `${b.code} — ${b.name}`])), [cashboxes]);

  const selectedExpectedTotal = useMemo(
    () =>
      uncollectedShipments
        .filter((s) => selectedIds.has(s.shipment_id))
        .reduce((sum, s) => sum + Number(s.expected_amount || 0), 0),
    [uncollectedShipments, selectedIds],
  );

  const toggleShipment = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const exp = uncollectedShipments
        .filter((s) => next.has(s.shipment_id))
        .reduce((sum, s) => sum + Number(s.expected_amount || 0), 0);
      setCollectedAmountInput(exp > 0 ? String(exp) : '0');
      return next;
    });
  };

  const handleCreateVoucher = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCourierId || selectedIds.size === 0) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await createCourierCollectionVoucher(tenant.id, {
        branch_id: branchId,
        courier_id: selectedCourierId,
        cashbox_id: cashboxId,
        shipment_ids: Array.from(selectedIds),
        collected_amount: Number(collectedAmountInput || selectedExpectedTotal),
        notes: notes.trim() || undefined,
      });
      setNotes('');
      setFeedback({
        type: 'success',
        text: `تم إصدار سند التحصيل ${res.voucher_code} بمبلغ ${formatCurrency(res.total_collected_amount, tenant.default_currency)} وبانتظار الاعتماد.`,
      });
      await Promise.all([loadAll(), loadCourierShipments()]);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر إنشاء سند التحصيل.'});
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (voucherId: string) => {
    setSubmitting(true);
    setFeedback(null);
    try {
      await approveCourierCollectionVoucher(tenant.id, voucherId);
      setFeedback({type: 'success', text: 'تم اعتماد سند التحصيل وإيداع النقدية بالخزينة وفتح عمولات الشحنات.'});
      await Promise.all([loadAll(), loadCourierShipments()]);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر اعتماد سند التحصيل.'});
    } finally {
      setSubmitting(false);
    }
  };

  const isFourEyesBlocked = (createdBy: string | null) => {
    if (!policy.enforce_four_eyes || !createdBy || createdBy !== user?.id) return false;
    if (membership.role_key === 'company_owner' && policy.allow_owner_self_approve) return false;
    return true;
  };

  const totalPendingCash = useMemo(
    () => overview.reduce((sum, c) => sum + Number(c.uncollected_cash_amount || 0), 0),
    [overview],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">التحصيل النقدي من المناديب (COL)</h1>
          <p className="mt-1 text-xs text-slate-500">
            توريد مبالغ الـ COD ورسوم المرتجع المحصلة من المستلم إلى الخزينة قبل صرف عمولات المندوب (ADR-012 / ADR-016).
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-2">
            <span className="text-slate-500">إجمالي العهدة النقدية لدى المناديب: </span>
            <strong className="font-mono-tabular text-slate-900">{formatCurrency(totalPendingCash, tenant.default_currency)}</strong>
          </div>
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Courier Selector & Custody Table */}
        <div className="space-y-3 lg:col-span-5">
          <h2 className="text-sm font-semibold text-slate-900">عهد النقدية لدى المناديب</h2>
          <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
            {loading ? (
              <p className="p-4 text-xs text-slate-500">جارٍ التحميل...</p>
            ) : overview.length === 0 ? (
              <p className="p-4 text-xs text-slate-500">لا يوجد مناديب مسجلون.</p>
            ) : (
              overview.map((c) => {
                const isSelected = c.courier_id === selectedCourierId;
                return (
                  <button
                    key={c.courier_id}
                    type="button"
                    onClick={() => setSelectedCourierId(c.courier_id)}
                    className={`flex w-full items-center justify-between px-4 py-3 text-right transition-colors ${
                      isSelected ? 'bg-slate-900 text-white' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold">
                        <span className="font-mono-tabular opacity-75">{c.code}</span> · {c.name}
                      </p>
                      <p className={`mt-0.5 text-[11px] ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {c.uncollected_cash_shipments_count} شحنة واجبة التوريد · {c.shipment_custody_count} طرد قيد التشغيل
                      </p>
                    </div>
                    <div className="text-left">
                      <p className={`font-mono-tabular text-xs font-bold ${isSelected ? 'text-emerald-300' : 'text-emerald-700'}`}>
                        {formatCurrency(c.uncollected_cash_amount, tenant.default_currency)}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Create Collection Voucher Form */}
        <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-7">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Wallet className="h-4 w-4 text-slate-600" />
              إنشاء سند توريد نقدية للمندوب {selectedCourierId ? courierMap.get(selectedCourierId)?.name : ''}
            </h2>
            <span className="font-mono-tabular text-xs font-bold text-slate-900">
              المتوقع: {formatCurrency(selectedExpectedTotal, tenant.default_currency)}
            </span>
          </div>

          <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-right">تحديد</th>
                  <th className="px-3 py-2 text-right">الشحنة</th>
                  <th className="px-3 py-2 text-right">مصدر النقدية</th>
                  <th className="px-3 py-2 text-right">المبلغ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {uncollectedShipments.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-5 text-center text-slate-500">
                      لا توجد شحنات نقدية معلقة لهذا المندوب.
                    </td>
                  </tr>
                ) : (
                  uncollectedShipments.map((s) => (
                    <tr key={s.shipment_id}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(s.shipment_id)}
                          onChange={() => toggleShipment(s.shipment_id)}
                        />
                      </td>
                      <td className="px-3 py-2 font-mono-tabular font-semibold">{s.shipment_number}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {s.cash_source_type === 'cod_delivery' ? 'تحصيل COD تسليم' : 'رسوم مرتجع من المستلم (ADR-016)'}
                      </td>
                      <td className="px-3 py-2 font-mono-tabular font-bold text-slate-900">
                        {formatCurrency(s.expected_amount, tenant.default_currency)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {canCreate && (
            <form onSubmit={handleCreateVoucher} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="col-branch" className="block text-xs font-medium text-slate-700">الفرع</label>
                <select
                  id="col-branch"
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="col-cashbox" className="block text-xs font-medium text-slate-700">الخزينة المستلمة</label>
                <select
                  id="col-cashbox"
                  value={cashboxId}
                  onChange={(e) => setCashboxId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  {cashboxes.map((cb) => (
                    <option key={cb.id} value={cb.id}>{cb.code} — {cb.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="col-amount" className="block text-xs font-medium text-slate-700">المبلغ المورد فعليًا للخزينة</label>
                <input
                  id="col-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  value={collectedAmountInput}
                  onChange={(e) => setCollectedAmountInput(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular"
                />
              </div>
              <div>
                <label htmlFor="col-notes" className="block text-xs font-medium text-slate-700">ملاحظات</label>
                <input
                  id="col-notes"
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
                  إصدار سند التحصيل (COL)
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {/* Collection Vouchers History */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">سندات التحصيل من المناديب</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 text-right font-semibold">رقم السند</th>
                <th className="px-3 py-3 text-right font-semibold">المندوب</th>
                <th className="px-3 py-3 text-right font-semibold">الخزينة</th>
                <th className="px-3 py-3 text-right font-semibold">المتوقع</th>
                <th className="px-3 py-3 text-right font-semibold">المحصّل</th>
                <th className="px-3 py-3 text-right font-semibold">الفرق</th>
                <th className="px-3 py-3 text-right font-semibold">الحالة</th>
                <th className="px-3 py-3 text-right font-semibold">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vouchers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-500">لا توجد سندات تحصيل مسجلة بعد.</td>
                </tr>
              ) : (
                vouchers.map((v) => {
                  const blocked = isFourEyesBlocked(v.created_by);
                  return (
                    <tr key={v.id}>
                      <td className="px-3 py-2.5 font-mono-tabular font-semibold">{v.voucher_code}</td>
                      <td className="px-3 py-2.5">{courierMap.get(v.courier_id)?.name ?? v.courier_id}</td>
                      <td className="px-3 py-2.5">{cashboxMap.get(v.cashbox_id) ?? v.cashbox_id}</td>
                      <td className="px-3 py-2.5 font-mono-tabular">{formatCurrency(v.total_expected_amount, tenant.default_currency)}</td>
                      <td className="px-3 py-2.5 font-mono-tabular font-bold text-emerald-700">
                        {formatCurrency(v.total_collected_amount, tenant.default_currency)}
                      </td>
                      <td className={`px-3 py-2.5 font-mono-tabular ${v.variance_amount < 0 ? 'text-red-700' : 'text-slate-600'}`}>
                        {formatCurrency(v.variance_amount, tenant.default_currency)}
                      </td>
                      <td className="px-3 py-2.5">{FINANCE_DOC_STATUS_LABELS[v.status]}</td>
                      <td className="px-3 py-2.5">
                        {v.status === 'draft' && canApprove ? (
                          blocked ? (
                            <span className="text-[11px] text-amber-700">بانتظار مراجع آخر (ADR-018)</span>
                          ) : (
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => handleApprove(v.id)}
                              className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-800"
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              اعتماد وإيداع
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
