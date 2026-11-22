import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {FilterBar} from '@/components/ui/FilterBar';
import {
  listAuxiliaryJournals,
  listChartOfAccounts,
  listJournalEntryTypes,
} from '@/features/definitions/definitionsService';
import {listBranches} from '@/features/definitions/definitionsService';
import {
  approveJournalEntry,
  createManualJournalEntry,
  listJournalEntries,
} from '@/features/accounting/accountingService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {useAuth} from '@/lib/auth';
import {formatCurrency} from '@/lib/formatters';
import type {AuxiliaryJournalRecord, ChartOfAccountRecord, JournalEntryTypeRecord} from '@/types/definitions';
import type {BranchRecord} from '@/types/definitions';
import {FINANCE_DOC_STATUS_LABELS} from '@/types/finance';
import type {JournalEntryRecord} from '@/types/accounting';
import {CheckCircle2, FileText, Plus} from 'lucide-react';

export function JournalEntriesPage() {
  const {user} = useAuth();
  const {tenant, membership, can} = useTenantWorkspace();

  const [entries, setEntries] = useState<readonly JournalEntryRecord[]>([]);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [journals, setJournals] = useState<readonly AuxiliaryJournalRecord[]>([]);
  const [entryTypes, setEntryTypes] = useState<readonly JournalEntryTypeRecord[]>([]);
  const [accounts, setAccounts] = useState<readonly ChartOfAccountRecord[]>([]);
  const [search, setSearch] = useState('');

  // New manual entry form
  const [showForm, setShowForm] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [journalId, setJournalId] = useState('');
  const [entryTypeId, setEntryTypeId] = useState('');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [debitAcctId, setDebitAcctId] = useState('');
  const [creditAcctId, setCreditAcctId] = useState('');
  const [amountInput, setAmountInput] = useState('');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  const isAdmin = membership.role_key === 'company_owner' || membership.role_key === 'company_admin';
  const canCreate = can('finance.collections.create') || isAdmin;
  const canApprove = can('finance.payouts.approve') || isAdmin;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [eRows, bRows, jRows, tRows, aRows] = await Promise.all([
        listJournalEntries(tenant.id),
        listBranches(tenant.id),
        listAuxiliaryJournals(tenant.id),
        listJournalEntryTypes(tenant.id),
        listChartOfAccounts(tenant.id),
      ]);
      setEntries(eRows);
      setBranches(bRows);
      setJournals(jRows);
      setEntryTypes(tRows);
      setAccounts(aRows);

      if (!branchId && bRows[0]) setBranchId(bRows[0].id);
      if (!journalId && jRows[0]) setJournalId(jRows[0].id);
      if (!entryTypeId && tRows[0]) setEntryTypeId(tRows[0].id);
      const leafAccounts = aRows.filter((a) => !a.is_group);
      if (!debitAcctId && leafAccounts[0]) setDebitAcctId(leafAccounts[0].id);
      if (!creditAcctId && leafAccounts[1]) setCreditAcctId(leafAccounts[1].id);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحميل قيود اليومية العامة.'});
    } finally {
      setLoading(false);
    }
  }, [tenant.id, branchId, journalId, entryTypeId, debitAcctId, creditAcctId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.entry_code.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.reference_code && e.reference_code.toLowerCase().includes(q)),
    );
  }, [entries, search]);

  const handleCreateEntry = async (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(amountInput);
    if (!branchId || !debitAcctId || !creditAcctId || amount <= 0) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await createManualJournalEntry(tenant.id, {
        branch_id: branchId,
        journal_id: journalId || undefined,
        entry_type_id: entryTypeId || undefined,
        description: description.trim(),
        notes: notes.trim() || undefined,
        lines: [
          {account_id: debitAcctId, debit: amount, credit: 0, description: description.trim()},
          {account_id: creditAcctId, debit: 0, credit: amount, description: description.trim()},
        ],
      });
      setDescription('');
      setNotes('');
      setAmountInput('');
      setShowForm(false);
      setFeedback({
        type: 'success',
        text: `تم إنشاء قيد اليومية ${res.entry_code} بمبلغ ${formatCurrency(res.total_amount, tenant.default_currency)} كمسودة بانتظار الاعتماد.`,
      });
      await loadData();
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر إنشاء قيد اليومية.'});
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (entryId: string) => {
    setSubmitting(true);
    setFeedback(null);
    try {
      await approveJournalEntry(tenant.id, entryId);
      setFeedback({type: 'success', text: 'تم اعتماد قيد اليومية وترحيله إلى الأستاذ العام.'});
      await loadData();
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر اعتماد قيد اليومية.'});
    } finally {
      setSubmitting(false);
    }
  };

  const isFourEyesBlocked = (createdBy: string | null) => {
    if (!createdBy || createdBy !== user?.id) return false;
    if (membership.role_key === 'company_owner') return false;
    return true;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">قيود اليومية العامة (JENT)</h1>
          <p className="mt-1 text-xs text-slate-500">
            القيود المحاسبية المتوازنة، واعتمادها من مراجع آخر، وترحيلها إلى الأستاذ وميزان المراجعة.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setShowForm((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            قيد يدوي جديد
          </button>
        )}
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

      {showForm && canCreate && (
        <form onSubmit={handleCreateEntry} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-semibold text-slate-900">إنشاء قيد محاسبي يدوي مزدوج</h2>
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-slate-500 hover:text-slate-900">
              إغلاق
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="je-branch" className="block text-xs font-medium text-slate-700">الفرع</label>
              <select
                id="je-branch"
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
              <label htmlFor="je-journal" className="block text-xs font-medium text-slate-700">اليومية المساعدة</label>
              <select
                id="je-journal"
                value={journalId}
                onChange={(e) => setJournalId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              >
                {journals.map((j) => (
                  <option key={j.id} value={j.id}>{j.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="je-type" className="block text-xs font-medium text-slate-700">نوع القيد</label>
              <select
                id="je-type"
                value={entryTypeId}
                onChange={(e) => setEntryTypeId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              >
                {entryTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="je-debit" className="block text-xs font-medium text-slate-700">الحساب المدين</label>
              <select
                id="je-debit"
                value={debitAcctId}
                onChange={(e) => setDebitAcctId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              >
                {accounts.filter((a) => !a.is_group).map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="je-credit" className="block text-xs font-medium text-slate-700">الحساب الدائن</label>
              <select
                id="je-credit"
                value={creditAcctId}
                onChange={(e) => setCreditAcctId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              >
                {accounts.filter((a) => !a.is_group).map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="je-amount" className="block text-xs font-medium text-slate-700">المبلغ</label>
              <input
                id="je-amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs font-mono-tabular"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="je-desc" className="block text-xs font-medium text-slate-700">وصف القيد / البيان</label>
              <input
                id="je-desc"
                type="text"
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label htmlFor="je-notes" className="block text-xs font-medium text-slate-700">ملاحظات</label>
              <input
                id="je-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
              />
            </div>
            <div className="sm:col-span-3">
              <button
                type="submit"
                disabled={submitting || !branchId || !debitAcctId || !creditAcctId}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <FileText className="h-3.5 w-3.5" />
                حفظ القيد كمسودة
              </button>
            </div>
          </div>
        </form>
      )}

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث برقم القيد أو الوصف أو المرجع..."
      />

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-3 text-right font-semibold">رقم القيد</th>
              <th className="px-3 py-3 text-right font-semibold">التاريخ</th>
              <th className="px-3 py-3 text-right font-semibold">الفرع</th>
              <th className="px-3 py-3 text-right font-semibold">الوصف / البيان</th>
              <th className="px-3 py-3 text-right font-semibold">المبلغ (مدين / دائن)</th>
              <th className="px-3 py-3 text-right font-semibold">الحالة</th>
              <th className="px-3 py-3 text-right font-semibold">إجراء</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  جارٍ تحميل القيود...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  لا توجد قيود يومية مسجلة بعد.
                </td>
              </tr>
            ) : (
              filtered.map((e) => {
                const blocked = isFourEyesBlocked(e.created_by);
                return (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5 font-mono-tabular font-semibold text-slate-900">{e.entry_code}</td>
                    <td className="px-3 py-2.5 font-mono-tabular text-slate-600">{e.entry_date}</td>
                    <td className="px-3 py-2.5 text-slate-700">{e.branch_id ? branchMap.get(e.branch_id) ?? '—' : '—'}</td>
                    <td className="px-3 py-2.5 font-medium text-slate-900">
                      {e.description}
                      {e.reference_code && (
                        <span className="block font-mono-tabular text-[10px] text-slate-500">
                          مرجع: {e.reference_code}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 font-mono-tabular font-bold text-slate-900">
                      {formatCurrency(e.total_debit, tenant.default_currency)}
                    </td>
                    <td className="px-3 py-2.5">{FINANCE_DOC_STATUS_LABELS[e.status]}</td>
                    <td className="px-3 py-2.5">
                      {e.status === 'draft' && canApprove ? (
                        blocked ? (
                          <span className="text-[11px] text-amber-700">بانتظار اعتماد مراجع آخر</span>
                        ) : (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleApprove(e.id)}
                            className="inline-flex items-center gap-1 rounded bg-emerald-700 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-800"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            اعتماد وترحيل
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
  );
}
