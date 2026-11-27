import {LoadingState} from '@/components/ui/LoadingState';
import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {
  createChartAccount,
  generateNextCode,
  listAuxiliaryJournals,
  listChartOfAccounts,
  listJournalEntryTypes,
  listMovementTypes,
  listOperationalRefs,
  saveAuxiliaryJournal,
  saveJournalEntryType,
  saveMovementType,
} from '@/features/definitions/definitionsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {
  AccountType,
  AuxiliaryJournalRecord,
  ChartOfAccountRecord,
  DeliveryTypeRecord,
  JournalCategory,
  JournalEntryTypeRecord,
  MovementDirection,
  MovementTypeRecord,
  NumberingSequenceRecord,
  PaymentMethodRecord,
  PaymentTermRecord,
} from '@/types/definitions';
import {Plus} from 'lucide-react';

type RefTab = 'movements' | 'journals' | 'entry_types' | 'coa' | 'payments_sequences';

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: 'أصول',
  liability: 'التزامات',
  equity: 'حقوق ملكية',
  revenue: 'إيرادات',
  expense: 'مصروفات',
};

const DIRECTION_LABELS: Record<MovementDirection, string> = {
  inbound: 'وارد',
  outbound: 'صادر',
  internal: 'تحويل داخلي',
  return: 'مرتجع',
};

const JOURNAL_CAT_LABELS: Record<JournalCategory, string> = {
  cash: 'نقدية وخزينة',
  operations: 'تشغيل وشحن',
  settlements: 'تسويات',
  general: 'عامة',
};

export function AccountingRefsPage() {
  const {tenant, isAdmin} = useTenantWorkspace();
  const [activeTab, setActiveTab] = useState<RefTab>('movements');
  const [movements, setMovements] = useState<readonly MovementTypeRecord[]>([]);
  const [journals, setJournals] = useState<readonly AuxiliaryJournalRecord[]>([]);
  const [entryTypes, setEntryTypes] = useState<readonly JournalEntryTypeRecord[]>([]);
  const [accounts, setAccounts] = useState<readonly ChartOfAccountRecord[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<readonly PaymentMethodRecord[]>([]);
  const [paymentTerms, setPaymentTerms] = useState<readonly PaymentTermRecord[]>([]);
  const [deliveryTypes, setDeliveryTypes] = useState<readonly DeliveryTypeRecord[]>([]);
  const [sequences, setSequences] = useState<readonly NumberingSequenceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quick-add form states
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newDirection, setNewDirection] = useState<MovementDirection>('inbound');
  const [newJournalCat, setNewJournalCat] = useState<JournalCategory>('operations');
  const [newReversal, setNewReversal] = useState(false);
  const [newAcctType, setNewAcctType] = useState<AccountType>('expense');
  const [newAcctParent, setNewAcctParent] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mData, jData, eData, cData, opsData] = await Promise.all([
        listMovementTypes(tenant.id),
        listAuxiliaryJournals(tenant.id),
        listJournalEntryTypes(tenant.id),
        listChartOfAccounts(tenant.id),
        listOperationalRefs(tenant.id),
      ]);
      setMovements(mData);
      setJournals(jData);
      setEntryTypes(eData);
      setAccounts(cData);
      setPaymentMethods(opsData.paymentMethods);
      setPaymentTerms(opsData.paymentTerms);
      setDeliveryTypes(opsData.deliveryTypes);
      setSequences(opsData.sequences);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل التعريفات المرجعية.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleAddMovement = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveMovementType(tenant.id, {
        code: newCode || generateNextCode('MOV', movements.map((m) => m.code)),
        name: newName,
        direction: newDirection,
        is_active: true,
      });
      setNewCode('');
      setNewName('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة نوع الحركة.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddJournal = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveAuxiliaryJournal(tenant.id, {
        code: newCode || generateNextCode('JRN', journals.map((j) => j.code)),
        name: newName,
        journal_category: newJournalCat,
        is_active: true,
      });
      setNewCode('');
      setNewName('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة اليومية.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddEntryType = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveJournalEntryType(tenant.id, {
        code: newCode || generateNextCode('ENT', entryTypes.map((t) => t.code)),
        name: newName,
        is_reversal_type: newReversal,
        is_active: true,
      });
      setNewCode('');
      setNewName('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة نوع القيد.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddAccount = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createChartAccount(tenant.id, {
        code: newCode,
        name: newName,
        account_type: newAcctType,
        parent_id: newAcctParent || null,
        is_group: false,
      });
      setNewCode('');
      setNewName('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة الحساب.');
    } finally {
      setSaving(false);
    }
  };

  const groupAccounts = accounts.filter((a) => a.is_group);

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <p className="text-xs font-medium text-slate-500">التعريفات الأساسية · الحركات واليوميات والحسابات</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">الحركات واليوميات المساعدة ودليل الحسابات</h1>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
        {[
          {id: 'movements', label: `أنواع الحركات (${movements.length})`},
          {id: 'journals', label: `اليوميات المساعدة (${journals.length})`},
          {id: 'entry_types', label: `أنواع القيد (${entryTypes.length})`},
          {id: 'coa', label: `دليل الحسابات (${accounts.length})`},
          {id: 'payments_sequences', label: 'الدفع والترقيم'},
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveTab(tab.id as RefTab);
              setNewCode('');
              setNewName('');
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          <LoadingState className="py-4" label="جارٍ تحميل التعريفات" />
        </div>
      ) : (
        <>
          {activeTab === 'movements' && (
            <div className="space-y-4">
              {isAdmin && (
                <form onSubmit={handleAddMovement} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">الكود</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                      placeholder={generateNextCode('MOV', movements.map((m) => m.code))}
                      className="mt-1 w-32 rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
                    />
                  </div>
                  <div className="flex-1 min-w-48">
                    <label className="block text-xs font-medium text-slate-700">اسم الحركة</label>
                    <input
                      type="text"
                      required
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">الاتجاه</label>
                    <select
                      value={newDirection}
                      onChange={(e) => setNewDirection(e.target.value as MovementDirection)}
                      className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
                    >
                      {Object.entries(DIRECTION_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    إضافة
                  </button>
                </form>
              )}
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full border-collapse text-right text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                      <th className="px-4 py-3">الكود</th>
                      <th className="px-4 py-3">الحركة</th>
                      <th className="px-4 py-3">الاتجاه</th>
                      <th className="px-4 py-3">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {movements.map((m) => (
                      <tr key={m.id}>
                        <td className="px-4 py-3 font-mono-tabular text-xs font-medium">{m.code}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{m.name}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{DIRECTION_LABELS[m.direction]}</td>
                        <td className="px-4 py-3 text-xs text-emerald-700">{m.is_active ? 'فعال' : 'معطل'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'journals' && (
            <div className="space-y-4">
              {isAdmin && (
                <form onSubmit={handleAddJournal} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">الكود</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                      placeholder="JRN-NEW"
                      className="mt-1 w-32 rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
                    />
                  </div>
                  <div className="flex-1 min-w-48">
                    <label className="block text-xs font-medium text-slate-700">اسم اليومية</label>
                    <input
                      type="text"
                      required
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">التصنيف</label>
                    <select
                      value={newJournalCat}
                      onChange={(e) => setNewJournalCat(e.target.value as JournalCategory)}
                      className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
                    >
                      {Object.entries(JOURNAL_CAT_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white">
                    <Plus className="h-3.5 w-3.5" />
                    إضافة
                  </button>
                </form>
              )}
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full border-collapse text-right text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                      <th className="px-4 py-3">الكود</th>
                      <th className="px-4 py-3">اليومية المساعدة</th>
                      <th className="px-4 py-3">التصنيف</th>
                      <th className="px-4 py-3">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {journals.map((j) => (
                      <tr key={j.id}>
                        <td className="px-4 py-3 font-mono-tabular text-xs font-medium">{j.code}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{j.name}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{JOURNAL_CAT_LABELS[j.journal_category]}</td>
                        <td className="px-4 py-3 text-xs text-emerald-700">{j.is_active ? 'فعال' : 'معطل'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'entry_types' && (
            <div className="space-y-4">
              {isAdmin && (
                <form onSubmit={handleAddEntryType} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">الكود</label>
                    <input
                      type="text"
                      dir="ltr"
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                      placeholder="ENT-NEW"
                      className="mt-1 w-32 rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
                    />
                  </div>
                  <div className="flex-1 min-w-48">
                    <label className="block text-xs font-medium text-slate-700">اسم نوع القيد</label>
                    <input
                      type="text"
                      required
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                    />
                  </div>
                  <label className="flex items-center gap-2 pb-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={newReversal}
                      onChange={(e) => setNewReversal(e.target.checked)}
                    />
                    قيد عكسي؟
                  </label>
                  <button type="submit" disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white">
                    <Plus className="h-3.5 w-3.5" />
                    إضافة
                  </button>
                </form>
              )}
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full border-collapse text-right text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                      <th className="px-4 py-3">الكود</th>
                      <th className="px-4 py-3">نوع القيد المحاسبي</th>
                      <th className="px-4 py-3">طبيعة القيد</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {entryTypes.map((t) => (
                      <tr key={t.id}>
                        <td className="px-4 py-3 font-mono-tabular text-xs font-medium">{t.code}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{t.name}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {t.is_reversal_type ? 'قيد عكسي لتصحيح مستند معتمد' : 'قيد تشغيلي/مالي قياسي'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'coa' && (
            <div className="space-y-4">
              {isAdmin && (
                <form onSubmit={handleAddAccount} className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700">رقم الحساب</label>
                    <input
                      type="text"
                      required
                      dir="ltr"
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                      placeholder="5105"
                      className="mt-1 w-28 rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
                    />
                  </div>
                  <div className="flex-1 min-w-48">
                    <label className="block text-xs font-medium text-slate-700">اسم الحساب</label>
                    <input
                      type="text"
                      required
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">التصنيف</label>
                    <select
                      value={newAcctType}
                      onChange={(e) => setNewAcctType(e.target.value as AccountType)}
                      className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
                    >
                      {Object.entries(ACCOUNT_TYPE_LABELS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700">الحساب الأب</label>
                    <select
                      value={newAcctParent}
                      onChange={(e) => setNewAcctParent(e.target.value)}
                      className="mt-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
                    >
                      <option value="">حساب رئيسي</option>
                      {groupAccounts.map((g) => (
                        <option key={g.id} value={g.id}>{g.code} — {g.name}</option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" disabled={saving} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white">
                    <Plus className="h-3.5 w-3.5" />
                    إضافة حساب
                  </button>
                </form>
              )}
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full border-collapse text-right text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                      <th className="px-4 py-3">رقم الحساب</th>
                      <th className="px-4 py-3">اسم الحساب</th>
                      <th className="px-4 py-3">التصنيف</th>
                      <th className="px-4 py-3">المستوى</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {accounts.map((a) => (
                      <tr key={a.id} className={a.is_group ? 'bg-slate-50/70' : ''}>
                        <td className="px-4 py-3 font-mono-tabular text-xs font-medium text-slate-900">{a.code}</td>
                        <td className={`px-4 py-3 ${a.is_group ? 'font-bold text-slate-900' : 'text-slate-800'}`}>
                          {a.name}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">{ACCOUNT_TYPE_LABELS[a.account_type]}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">
                          {a.is_group ? 'حساب تجميعي (لا يرحل إليه)' : 'حساب فرعي قابل للترحيل'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'payments_sequences' && (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-semibold text-slate-900">طرق وشروط الدفع وأنواع التسليم</h2>
                <div className="mt-4 space-y-4 text-xs">
                  <div>
                    <p className="font-medium text-slate-500">وسائل الدفع المعتمدة</p>
                    <ul className="mt-1.5 divide-y divide-slate-100 border-t border-slate-100">
                      {paymentMethods.map((p) => (
                        <li key={p.id} className="flex justify-between py-2">
                          <span className="font-medium text-slate-900">{p.name}</span>
                          <span className="font-mono-tabular text-slate-500">{p.code}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-slate-500">شروط الدفع</p>
                    <ul className="mt-1.5 divide-y divide-slate-100 border-t border-slate-100">
                      {paymentTerms.map((p) => (
                        <li key={p.id} className="flex justify-between py-2">
                          <span className="font-medium text-slate-900">{p.name}</span>
                          <span className="font-mono-tabular text-slate-500">{p.code}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium text-slate-500">أنواع التسليم</p>
                    <ul className="mt-1.5 divide-y divide-slate-100 border-t border-slate-100">
                      {deliveryTypes.map((p) => (
                        <li key={p.id} className="flex justify-between py-2">
                          <span className="font-medium text-slate-900">{p.name}</span>
                          <span className="font-mono-tabular text-slate-500">{p.code}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-semibold text-slate-900">تسلسل ترقيم المستندات التلقائي</h2>
                <table className="mt-4 w-full border-collapse text-right text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2">المستند</th>
                      <th className="py-2">البادئة</th>
                      <th className="py-2">الرقم التالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sequences.map((seq) => (
                      <tr key={seq.id}>
                        <td className="py-2.5 font-medium text-slate-900">{seq.label}</td>
                        <td className="py-2.5 font-mono-tabular text-slate-700">{seq.prefix}</td>
                        <td className="py-2.5 font-mono-tabular text-slate-600">
                          {seq.prefix}-{String(seq.next_number).padStart(seq.padding_length, '0')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
