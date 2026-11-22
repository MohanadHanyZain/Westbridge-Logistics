import {useCallback, useEffect, useMemo, useState} from 'react';
import {listBranches} from '@/features/definitions/definitionsService';
import {getTrialBalance} from '@/features/accounting/accountingService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {formatCurrency} from '@/lib/formatters';
import type {BranchRecord} from '@/types/definitions';
import type {TrialBalanceRow} from '@/types/accounting';
import {Scale} from 'lucide-react';

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: 'أصول',
  liability: 'التزامات',
  equity: 'حقوق ملكية',
  revenue: 'إيرادات',
  expense: 'مصروفات',
};

export function TrialBalancePage() {
  const {tenant} = useTenantWorkspace();

  const [rows, setRows] = useState<readonly TrialBalanceRow[]>([]);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [branchId, setBranchId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tbRows, bRows] = await Promise.all([
        getTrialBalance(tenant.id, branchId === 'all' ? null : branchId),
        listBranches(tenant.id),
      ]);
      setRows(tbRows);
      setBranches(bRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل ميزان المراجعة.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id, branchId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const r of rows) {
      if (!r.is_group) {
        debit += Number(r.total_debit || 0);
        credit += Number(r.total_credit || 0);
      }
    }
    return {debit, credit, balanced: Math.abs(debit - credit) < 0.01};
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">ميزان المراجعة (Trial Balance)</h1>
          <p className="mt-1 text-xs text-slate-500">
            مراجعة أرصدة الحسابات والأستاذ العام والتحقق من تساوي المجاميع والأرصدة.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <div>
            <label htmlFor="tb-branch" className="block text-[11px] font-medium text-slate-500">تصفية حسب الفرع</label>
            <select
              id="tb-branch"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="mt-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
            >
              <option value="all">كافة الفروع</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Totals Summary Card */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500">إجمالي المدين</span>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-slate-900">
            {formatCurrency(totals.debit, tenant.default_currency)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs text-slate-500">إجمالي الدائن</span>
          <p className="mt-1 font-mono-tabular text-xl font-bold text-slate-900">
            {formatCurrency(totals.credit, tenant.default_currency)}
          </p>
        </div>
        <div className={`rounded-xl border p-4 ${totals.balanced ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
          <span className="text-xs font-semibold">حالة الميزان</span>
          <p className="mt-1 text-sm font-bold flex items-center gap-1.5">
            <Scale className="h-4 w-4" />
            {totals.balanced ? 'الميزان متوازن تمامًا ✓' : 'الميزان غير متوازن ✗'}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-3 text-right font-semibold">رقم الحساب</th>
              <th className="px-3 py-3 text-right font-semibold">اسم الحساب</th>
              <th className="px-3 py-3 text-right font-semibold">التصنيف</th>
              <th className="px-3 py-3 text-right font-semibold">إجمالي المدين</th>
              <th className="px-3 py-3 text-right font-semibold">إجمالي الدائن</th>
              <th className="px-3 py-3 text-right font-semibold">الرصيد الصافي</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  جاري حساب ميزان المراجعة...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  لا توجد أرصدة مسجلة في دليل الحسابات.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.account_id} className={row.is_group ? 'bg-slate-50/70 font-semibold' : 'hover:bg-slate-50'}>
                  <td className="px-3 py-2.5 font-mono-tabular">{row.account_code}</td>
                  <td className="px-3 py-2.5 text-slate-900">{row.account_name}</td>
                  <td className="px-3 py-2.5 text-slate-600">{ACCOUNT_TYPE_LABELS[row.account_type] ?? row.account_type}</td>
                  <td className="px-3 py-2.5 font-mono-tabular">{formatCurrency(row.total_debit, tenant.default_currency)}</td>
                  <td className="px-3 py-2.5 font-mono-tabular">{formatCurrency(row.total_credit, tenant.default_currency)}</td>
                  <td className="px-3 py-2.5 font-mono-tabular font-bold text-slate-900">
                    {formatCurrency(row.net_balance, tenant.default_currency)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
