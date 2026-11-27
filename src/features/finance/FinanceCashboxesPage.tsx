import {LoadingState} from '@/components/ui/LoadingState';
import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {listClients} from '@/features/clients/clientsService';
import {
  approveCashboxTransfer,
  approveCashboxVoucher,
  createCashboxTransfer,
  createCashboxVoucher,
  getCashboxesWithBalances,
  getTenantFinancePolicy,
  listCashboxTransactions,
  listCashboxTransfers,
  listCashboxVouchers,
  updateTenantFinancePolicy,
} from '@/features/finance/financeService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {useAuth} from '@/lib/auth';
import {formatCurrency, formatDateTime} from '@/lib/formatters';
import {
  CASHBOX_TX_TYPE_LABELS,
  FINANCE_DOC_STATUS_LABELS,
  type CashboxBalanceRecord,
  type CashboxTransactionRecord,
  type CashboxTransferRecord,
  type CashboxVoucherRecord,
  type TenantFinancePolicyRecord,
} from '@/types/finance';
import type {ClientRecord} from '@/types/pricing';
import {ArrowLeftRight, CheckCircle2, FileText, ShieldCheck, Wallet} from 'lucide-react';

export function FinanceCashboxesPage() {
  const {user} = useAuth();
  const {tenant, membership, can} = useTenantWorkspace();

  const [tab, setTab] = useState<'ledger' | 'transfers' | 'vouchers'>('ledger');
  const [cashboxes, setCashboxes] = useState<readonly CashboxBalanceRecord[]>([]);
  const [transactions, setTransactions] = useState<readonly CashboxTransactionRecord[]>([]);
  const [transfers, setTransfers] = useState<readonly CashboxTransferRecord[]>([]);
  const [vouchers, setVouchers] = useState<readonly CashboxVoucherRecord[]>([]);
  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [policy, setPolicy] = useState<TenantFinancePolicyRecord>({
    tenant_id: tenant.id,
    enforce_four_eyes: true,
    allow_owner_self_approve: true,
    high_value_approval_threshold: 0,
  });

  // Policy form
  const [showPolicy, setShowPolicy] = useState(false);
  const [enforceFourEyes, setEnforceFourEyes] = useState(true);
  const [allowOwnerSelf, setAllowOwnerSelf] = useState(true);
  const [thresholdInput, setThresholdInput] = useState('0');
  const [savingPolicy, setSavingPolicy] = useState(false);

  // Filter
  const [selectedCashboxId, setSelectedCashboxId] = useState('');

  // Transfer form
  const [fromBoxId, setFromBoxId] = useState('');
  const [toBoxId, setToBoxId] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [transferNotes, setTransferNotes] = useState('');

  // Voucher form
  const [voucherType, setVoucherType] = useState<'receipt' | 'payment' | 'prepaid_deposit'>('receipt');
  const [voucherBoxId, setVoucherBoxId] = useState('');
  const [voucherClientId, setVoucherClientId] = useState('');
  const [voucherAmount, setVoucherAmount] = useState('');
  const [voucherParty, setVoucherParty] = useState('');
  const [voucherNotes, setVoucherNotes] = useState('');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  const canManagePolicy = membership.role_key === 'company_owner' || membership.role_key === 'company_admin';
  const canCreate = can('finance.collections.create') || can('finance.collections.approve') || canManagePolicy;
  const canApproveCollection = can('finance.collections.approve') || canManagePolicy;
  const canApprovePayout = can('finance.payouts.approve') || canManagePolicy;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [boxes, tx, tr, vc, pol, cl] = await Promise.all([
        getCashboxesWithBalances(tenant.id),
        listCashboxTransactions(tenant.id, selectedCashboxId || undefined),
        listCashboxTransfers(tenant.id),
        listCashboxVouchers(tenant.id),
        getTenantFinancePolicy(tenant.id),
        listClients(tenant.id).catch(() => []),
      ]);
      setCashboxes(boxes);
      setTransactions(tx);
      setTransfers(tr);
      setVouchers(vc);
      setPolicy(pol);
      setEnforceFourEyes(pol.enforce_four_eyes);
      setAllowOwnerSelf(pol.allow_owner_self_approve);
      setThresholdInput(String(pol.high_value_approval_threshold));
      setClients(cl);

      if (!fromBoxId && boxes[0]) setFromBoxId(boxes[0].id);
      if (!toBoxId && boxes[1]) setToBoxId(boxes[1].id);
      if (!voucherBoxId && boxes[0]) setVoucherBoxId(boxes[0].id);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحميل بيانات الخزائن.'});
    } finally {
      setLoading(false);
    }
  }, [tenant.id, selectedCashboxId, fromBoxId, toBoxId, voucherBoxId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const cashboxNameMap = useMemo(() => new Map(cashboxes.map((b) => [b.id, `${b.code} — ${b.name}`])), [cashboxes]);
  const totalBalance = useMemo(() => cashboxes.reduce((acc, b) => acc + Number(b.current_balance || 0), 0), [cashboxes]);

  const isBlockedByFourEyes = (createdBy: string | null) => {
    if (!policy.enforce_four_eyes || !createdBy || createdBy !== user?.id) return false;
    if (membership.role_key === 'company_owner' && policy.allow_owner_self_approve) return false;
    return true;
  };

  const handleSavePolicy = async (e: FormEvent) => {
    e.preventDefault();
    setSavingPolicy(true);
    setFeedback(null);
    try {
      const updated = await updateTenantFinancePolicy(tenant.id, {
        enforce_four_eyes: enforceFourEyes,
        allow_owner_self_approve: allowOwnerSelf,
        high_value_approval_threshold: Number(thresholdInput) || 0,
      });
      setPolicy(updated);
      setFeedback({type: 'success', text: 'تم تحديث سياسة الرقابة المالية وحدود الاعتماد بنجاح.'});
      setShowPolicy(false);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر حفظ السياسة المالية.'});
    } finally {
      setSavingPolicy(false);
    }
  };

  const handleCreateTransfer = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await createCashboxTransfer(tenant.id, {
        from_cashbox_id: fromBoxId,
        to_cashbox_id: toBoxId,
        amount: Number(transferAmount),
        notes: transferNotes.trim() || undefined,
      });
      setTransferAmount('');
      setTransferNotes('');
      setFeedback({type: 'success', text: `تم إنشاء تحويل الخزينة ${res.transfer_code} وبانتظار الاعتماد.`});
      await loadData();
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر إنشاء التحويل.'});
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveTransfer = async (id: string) => {
    setSubmitting(true);
    setFeedback(null);
    try {
      await approveCashboxTransfer(tenant.id, id);
      setFeedback({type: 'success', text: 'تم اعتماد التحويل وتحديث أرصدة الخزائن.'});
      await loadData();
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر اعتماد التحويل.'});
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateVoucher = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await createCashboxVoucher(tenant.id, {
        voucher_type: voucherType,
        cashbox_id: voucherBoxId,
        client_id: voucherType === 'prepaid_deposit' ? voucherClientId || null : null,
        amount: Number(voucherAmount),
        party_name: voucherParty.trim() || undefined,
        notes: voucherNotes.trim() || undefined,
      });
      setVoucherAmount('');
      setVoucherParty('');
      setVoucherNotes('');
      setFeedback({type: 'success', text: `تم إنشاء السند المالي ${res.voucher_code} كمسودة.`});
      await loadData();
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر إنشاء السند المالي.'});
    } finally {
      setSubmitting(false);
    }
  };

  const handleApproveVoucher = async (id: string) => {
    setSubmitting(true);
    setFeedback(null);
    try {
      await approveCashboxVoucher(tenant.id, id);
      setFeedback({type: 'success', text: 'تم اعتماد السند وتقييده في دفتر حركة الخزينة.'});
      await loadData();
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر اعتماد السند.'});
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">إدارة الخزائن وحركات النقدية</h1>
          <p className="mt-1 text-xs text-slate-500">
            أرصدة الخزائن اللحظية، دفتر الحركات الثابت، التحويلات بين الخزائن (CTR)، وسندات القبض والصرف (RCV / PAY).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canManagePolicy && (
            <button
              type="button"
              onClick={() => setShowPolicy((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
            >
              <ShieldCheck className="h-4 w-4 text-slate-600" />
              ضبط سياسة العينين الأربع ({policy.enforce_four_eyes ? 'مفعّلة' : 'معطّلة'})
            </button>
          )}
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

      {showPolicy && canManagePolicy && (
        <form onSubmit={handleSavePolicy} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-semibold text-slate-900">سياسة الرقابة المالية وحدود الاعتماد</h2>
            <button type="button" onClick={() => setShowPolicy(false)} className="text-xs text-slate-500 hover:text-slate-900">
              إغلاق
            </button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-xs">
              <input
                type="checkbox"
                checked={enforceFourEyes}
                onChange={(e) => setEnforceFourEyes(e.target.checked)}
                className="mt-0.5 rounded border-slate-300"
              />
              <span>
                <strong className="block text-slate-900">تفعيل مبدأ العينين الأربع (Four-Eyes)</strong>
                <span className="text-slate-500">منع منشئ المستند المالي من اعتماده بنفسه.</span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 text-xs">
              <input
                type="checkbox"
                checked={allowOwnerSelf}
                onChange={(e) => setAllowOwnerSelf(e.target.checked)}
                className="mt-0.5 rounded border-slate-300"
              />
              <span>
                <strong className="block text-slate-900">استثناء مالك الشركة</strong>
                <span className="text-slate-500">السماح لمالك الشركة بالاعتماد عند عمل حساب واحد فقط.</span>
              </span>
            </label>
            <div>
              <label htmlFor="fin-threshold" className="block text-xs font-medium text-slate-700">
                حد المبلغ الذي يتطلب اعتماد المالك/الأدمن (0 = معطل)
              </label>
              <input
                id="fin-threshold"
                type="number"
                min={0}
                step="0.01"
                value={thresholdInput}
                onChange={(e) => setThresholdInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={savingPolicy}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {savingPolicy ? 'جارٍ الحفظ...' : 'حفظ السياسة المالية'}
          </button>
        </form>
      )}

      {/* Cashboxes Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-900 bg-slate-900 p-4 text-white">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span>إجمالي النقدية بالخزائن</span>
            <Wallet className="h-4 w-4" />
          </div>
          <p className="mt-2 font-mono-tabular text-2xl font-bold">{formatCurrency(totalBalance, tenant.default_currency)}</p>
          <p className="mt-1 text-[11px] text-slate-400">{cashboxes.length} خزينة نشطة بالشركة</p>
        </div>

        {cashboxes.map((cb) => (
          <div
            key={cb.id}
            className={`rounded-xl border p-4 transition-colors ${
              selectedCashboxId === cb.id ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono-tabular text-xs font-semibold text-slate-500">{cb.code}</span>
              <span className="text-[11px] text-slate-500">{cb.branch_name ?? '—'}</span>
            </div>
            <p className="mt-1 text-sm font-bold text-slate-900">{cb.name}</p>
            <p className="mt-2 font-mono-tabular text-lg font-bold text-emerald-700">
              {formatCurrency(cb.current_balance, tenant.default_currency)}
            </p>
            <button
              type="button"
              onClick={() => setSelectedCashboxId((prev) => (prev === cb.id ? '' : cb.id))}
              className="mt-2 text-[11px] font-medium text-slate-600 underline hover:text-slate-900"
            >
              {selectedCashboxId === cb.id ? 'عرض كل الخزائن' : 'تصفية الحركات لهذه الخزينة'}
            </button>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 w-fit">
        <button
          type="button"
          onClick={() => setTab('ledger')}
          className={`rounded-md px-4 py-2 text-xs font-medium ${tab === 'ledger' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
        >
          دفتر حركة الخزائن ({transactions.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('transfers')}
          className={`rounded-md px-4 py-2 text-xs font-medium ${tab === 'transfers' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
        >
          التحويلات بين الخزائن ({transfers.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('vouchers')}
          className={`rounded-md px-4 py-2 text-xs font-medium ${tab === 'vouchers' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}
        >
          سندات القبض والصرف ({vouchers.length})
        </button>
      </div>

      {tab === 'ledger' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-3 text-right font-semibold">رقم الحركة</th>
                <th className="px-3 py-3 text-right font-semibold">الخزينة</th>
                <th className="px-3 py-3 text-right font-semibold">نوع الحركة</th>
                <th className="px-3 py-3 text-right font-semibold">المرجع</th>
                <th className="px-3 py-3 text-right font-semibold">المبلغ</th>
                <th className="px-3 py-3 text-right font-semibold">ملاحظات</th>
                <th className="px-3 py-3 text-right font-semibold">التاريخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    <LoadingState label="جارٍ تحميل سجل الحركات" />
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    لا توجد حركات مالية مسجلة بالخزائن بعد.
                  </td>
                </tr>
              ) : (
                transactions.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono-tabular font-semibold text-slate-900">{t.transaction_code}</td>
                    <td className="px-3 py-2.5 text-slate-700">{cashboxNameMap.get(t.cashbox_id) ?? t.cashbox_id}</td>
                    <td className="px-3 py-2.5 text-slate-800">{CASHBOX_TX_TYPE_LABELS[t.transaction_type]}</td>
                    <td className="px-3 py-2.5 font-mono-tabular text-slate-600">{t.reference_code}</td>
                    <td
                      className={`px-3 py-2.5 font-mono-tabular font-bold ${
                        t.direction === 'in' ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {t.direction === 'in' ? '+' : '-'} {formatCurrency(t.amount, tenant.default_currency)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">{t.notes ?? '—'}</td>
                    <td className="px-3 py-2.5 font-mono-tabular text-slate-500">{formatDateTime(t.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'transfers' && (
        <div className="space-y-4">
          {canCreate && (
            <form onSubmit={handleCreateTransfer} className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-5 items-end">
              <div>
                <label htmlFor="ctr-from" className="block text-xs font-medium text-slate-700">من خزينة</label>
                <select
                  id="ctr-from"
                  value={fromBoxId}
                  onChange={(e) => setFromBoxId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  {cashboxes.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ctr-to" className="block text-xs font-medium text-slate-700">إلى خزينة</label>
                <select
                  id="ctr-to"
                  value={toBoxId}
                  onChange={(e) => setToBoxId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  {cashboxes.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ctr-amt" className="block text-xs font-medium text-slate-700">المبلغ</label>
                <input
                  id="ctr-amt"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular"
                />
              </div>
              <div>
                <label htmlFor="ctr-notes" className="block text-xs font-medium text-slate-700">ملاحظات</label>
                <input
                  id="ctr-notes"
                  type="text"
                  value={transferNotes}
                  onChange={(e) => setTransferNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || cashboxes.length < 2}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <ArrowLeftRight className="h-3.5 w-3.5" />
                إنشاء تحويل
              </button>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-3 text-right font-semibold">الكود</th>
                  <th className="px-3 py-3 text-right font-semibold">من خزينة</th>
                  <th className="px-3 py-3 text-right font-semibold">إلى خزينة</th>
                  <th className="px-3 py-3 text-right font-semibold">المبلغ</th>
                  <th className="px-3 py-3 text-right font-semibold">الحالة</th>
                  <th className="px-3 py-3 text-right font-semibold">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transfers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-500">لا توجد تحويلات مسجلة.</td>
                  </tr>
                ) : (
                  transfers.map((tr) => {
                    const blocked = isBlockedByFourEyes(tr.created_by);
                    return (
                      <tr key={tr.id}>
                        <td className="px-3 py-2.5 font-mono-tabular font-semibold">{tr.transfer_code}</td>
                        <td className="px-3 py-2.5">{cashboxNameMap.get(tr.from_cashbox_id) ?? tr.from_cashbox_id}</td>
                        <td className="px-3 py-2.5">{cashboxNameMap.get(tr.to_cashbox_id) ?? tr.to_cashbox_id}</td>
                        <td className="px-3 py-2.5 font-mono-tabular font-bold">{formatCurrency(tr.amount, tenant.default_currency)}</td>
                        <td className="px-3 py-2.5">{FINANCE_DOC_STATUS_LABELS[tr.status]}</td>
                        <td className="px-3 py-2.5">
                          {tr.status === 'draft' && canApproveCollection ? (
                            blocked ? (
                              <span className="text-[11px] text-amber-700">بانتظار اعتماد مراجع آخر</span>
                            ) : (
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => handleApproveTransfer(tr.id)}
                                className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-800"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                اعتماد التحويل
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
      )}

      {tab === 'vouchers' && (
        <div className="space-y-4">
          {canCreate && (
            <form onSubmit={handleCreateVoucher} className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-6 items-end">
              <div>
                <label htmlFor="vch-type" className="block text-xs font-medium text-slate-700">نوع السند</label>
                <select
                  id="vch-type"
                  value={voucherType}
                  onChange={(e) => setVoucherType(e.target.value as 'receipt' | 'payment' | 'prepaid_deposit')}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  <option value="receipt">سند قبض (إيداع)</option>
                  <option value="payment">سند صرف (مصروف)</option>
                  <option value="prepaid_deposit">إيداع رصيد مقدم لعميل</option>
                </select>
              </div>
              <div>
                <label htmlFor="vch-box" className="block text-xs font-medium text-slate-700">الخزينة</label>
                <select
                  id="vch-box"
                  value={voucherBoxId}
                  onChange={(e) => setVoucherBoxId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                >
                  {cashboxes.map((b) => (
                    <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
                  ))}
                </select>
              </div>
              {voucherType === 'prepaid_deposit' ? (
                <div>
                  <label htmlFor="vch-client" className="block text-xs font-medium text-slate-700">العميل</label>
                  <select
                    id="vch-client"
                    value={voucherClientId}
                    onChange={(e) => setVoucherClientId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  >
                    <option value="">اختر العميل</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label htmlFor="vch-party" className="block text-xs font-medium text-slate-700">الجهة / البيان</label>
                  <input
                    id="vch-party"
                    type="text"
                    value={voucherParty}
                    onChange={(e) => setVoucherParty(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                  />
                </div>
              )}
              <div>
                <label htmlFor="vch-amt" className="block text-xs font-medium text-slate-700">المبلغ</label>
                <input
                  id="vch-amt"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={voucherAmount}
                  onChange={(e) => setVoucherAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular"
                />
              </div>
              <div>
                <label htmlFor="vch-notes" className="block text-xs font-medium text-slate-700">ملاحظات</label>
                <input
                  id="vch-notes"
                  type="text"
                  value={voucherNotes}
                  onChange={(e) => setVoucherNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !voucherBoxId}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <FileText className="h-3.5 w-3.5" />
                إنشاء سند
              </button>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-3 text-right font-semibold">رقم السند</th>
                  <th className="px-3 py-3 text-right font-semibold">النوع</th>
                  <th className="px-3 py-3 text-right font-semibold">الخزينة</th>
                  <th className="px-3 py-3 text-right font-semibold">المبلغ</th>
                  <th className="px-3 py-3 text-right font-semibold">الحالة</th>
                  <th className="px-3 py-3 text-right font-semibold">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vouchers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-slate-500">لا توجد سندات مسجلة.</td>
                  </tr>
                ) : (
                  vouchers.map((vc) => {
                    const blocked = isBlockedByFourEyes(vc.created_by);
                    const canApp = vc.voucher_type === 'payment' ? canApprovePayout : canApproveCollection;
                    return (
                      <tr key={vc.id}>
                        <td className="px-3 py-2.5 font-mono-tabular font-semibold">{vc.voucher_code}</td>
                        <td className="px-3 py-2.5">
                          {vc.voucher_type === 'payment'
                            ? 'سند صرف'
                            : vc.voucher_type === 'prepaid_deposit'
                              ? 'إيداع مقدم'
                              : 'سند قبض'}
                        </td>
                        <td className="px-3 py-2.5">{cashboxNameMap.get(vc.cashbox_id) ?? vc.cashbox_id}</td>
                        <td className="px-3 py-2.5 font-mono-tabular font-bold">{formatCurrency(vc.amount, tenant.default_currency)}</td>
                        <td className="px-3 py-2.5">{FINANCE_DOC_STATUS_LABELS[vc.status]}</td>
                        <td className="px-3 py-2.5">
                          {vc.status === 'draft' && canApp ? (
                            blocked ? (
                              <span className="text-[11px] text-amber-700">بانتظار اعتماد مراجع آخر</span>
                            ) : (
                              <button
                                type="button"
                                disabled={submitting}
                                onClick={() => handleApproveVoucher(vc.id)}
                                className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-800"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                اعتماد السند
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
      )}
    </div>
  );
}
