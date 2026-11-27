import {LoadingState} from '@/components/ui/LoadingState';
import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {
  addCashboxCustodian,
  generateNextCode,
  listBranches,
  listCashboxCustodians,
  listCashboxes,
  listChartOfAccounts,
  listTenantStaffMemberships,
  saveCashbox,
  toggleCashboxCustodian,
} from '@/features/definitions/definitionsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {
  BranchRecord,
  CashboxCustodianRecord,
  CashboxRecord,
  ChartOfAccountRecord,
  TenantMemberOption,
} from '@/types/definitions';
import {CheckCircle2, Edit3, Plus, UserCheck, Wallet, XCircle} from 'lucide-react';

export function CashboxesPage() {
  const {tenant, isAdmin} = useTenantWorkspace();
  const [cashboxes, setCashboxes] = useState<readonly CashboxRecord[]>([]);
  const [custodians, setCustodians] = useState<readonly CashboxCustodianRecord[]>([]);
  const [staffMembers, setStaffMembers] = useState<readonly TenantMemberOption[]>([]);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [accounts, setAccounts] = useState<readonly ChartOfAccountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedCashboxId, setSelectedCashboxId] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [editingBox, setEditingBox] = useState<CashboxRecord | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [branchId, setBranchId] = useState('');
  const [ledgerAccountId, setLedgerAccountId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [allowDeposit, setAllowDeposit] = useState(true);
  const [allowWithdraw, setAllowWithdraw] = useState(true);
  const [allowTransferIn, setAllowTransferIn] = useState(true);
  const [allowTransferOut, setAllowTransferOut] = useState(true);
  const [newCustodianMembershipId, setNewCustodianMembershipId] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [boxData, custData, staffData, bData, aData] = await Promise.all([
        listCashboxes(tenant.id),
        listCashboxCustodians(tenant.id),
        listTenantStaffMemberships(tenant.id),
        listBranches(tenant.id),
        listChartOfAccounts(tenant.id),
      ]);
      setCashboxes(boxData);
      setCustodians(custData);
      setStaffMembers(staffData);
      setBranches(bData);
      setAccounts(aData);
      setSelectedCashboxId((prev) => (prev && boxData.some((b) => b.id === prev) ? prev : boxData[0]?.id ?? ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات الخزائن.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const accountMap = useMemo(() => new Map(accounts.map((a) => [a.id, `${a.code} — ${a.name}`])), [accounts]);
  const staffMap = useMemo(() => new Map(staffMembers.map((m) => [m.id, m])), [staffMembers]);
  const assetAccounts = useMemo(
    () => accounts.filter((a) => !a.is_group && a.account_type === 'asset' && a.is_active),
    [accounts],
  );

  const selectedCashbox = useMemo(
    () => cashboxes.find((b) => b.id === selectedCashboxId) ?? null,
    [cashboxes, selectedCashboxId],
  );

  const selectedCustodians = useMemo(
    () => custodians.filter((c) => c.cashbox_id === selectedCashboxId),
    [custodians, selectedCashboxId],
  );

  const openCreateForm = () => {
    setEditingBox(null);
    setCode(generateNextCode('CSH', cashboxes.map((b) => b.code)));
    setName('');
    setBranchId(branches.find((b) => b.is_main)?.id ?? branches[0]?.id ?? '');
    setLedgerAccountId(assetAccounts.find((a) => a.code === '1101')?.id ?? assetAccounts[0]?.id ?? '');
    setIsActive(true);
    setAllowDeposit(true);
    setAllowWithdraw(true);
    setAllowTransferIn(true);
    setAllowTransferOut(true);
    setShowForm(true);
  };

  const openEditForm = (box: CashboxRecord) => {
    setEditingBox(box);
    setCode(box.code);
    setName(box.name);
    setBranchId(box.branch_id);
    setLedgerAccountId(box.ledger_account_id);
    setIsActive(box.is_active);
    setAllowDeposit(box.allow_deposit);
    setAllowWithdraw(box.allow_withdraw);
    setAllowTransferIn(box.allow_transfer_in);
    setAllowTransferOut(box.allow_transfer_out);
    setShowForm(true);
  };

  const handleSaveCashbox = async (e: FormEvent) => {
    e.preventDefault();
    if (!branchId || !ledgerAccountId) return;
    setSaving(true);
    setError(null);
    try {
      await saveCashbox(tenant.id, {
        id: editingBox?.id,
        code,
        name,
        branch_id: branchId,
        ledger_account_id: ledgerAccountId,
        is_active: isActive,
        allow_deposit: allowDeposit,
        allow_withdraw: allowWithdraw,
        allow_transfer_in: allowTransferIn,
        allow_transfer_out: allowTransferOut,
      });
      setShowForm(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ الخزينة.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustodian = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCashbox || !newCustodianMembershipId) return;
    setSaving(true);
    try {
      await addCashboxCustodian(tenant.id, selectedCashbox.id, newCustodianMembershipId);
      setNewCustodianMembershipId('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة أمين الخزينة.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500">التعريفات الأساسية · الخزينة</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900">الخزائن وأمناء الخزائن وصلاحيات الحركة</h1>
        </div>
        {isAdmin && !showForm && (
          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" />
            إضافة خزينة جديدة
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {showForm && (
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">
            {editingBox ? `تعديل الخزينة: ${editingBox.name}` : 'إضافة خزينة جديدة'}
          </h2>
          <form onSubmit={handleSaveCashbox} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="box-name" className="block text-xs font-medium text-slate-700">اسم الخزينة</label>
              <input
                id="box-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="box-code" className="block text-xs font-medium text-slate-700">الكود</label>
              <input
                id="box-code"
                type="text"
                required
                dir="ltr"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>
            <div>
              <label htmlFor="box-branch" className="block text-xs font-medium text-slate-700">الفرع</label>
              <select
                id="box-branch"
                required
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="box-acct" className="block text-xs font-medium text-slate-700">حساب الأستاذ العام</label>
              <select
                id="box-acct"
                required
                value={ledgerAccountId}
                onChange={(e) => setLedgerAccountId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {assetAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3 md:col-span-2 sm:grid-cols-5">
              {[
                {label: 'فعال؟', val: isActive, set: setIsActive},
                {label: 'الإيداع؟', val: allowDeposit, set: setAllowDeposit},
                {label: 'السحب؟', val: allowWithdraw, set: setAllowWithdraw},
                {label: 'تحويل وارد؟', val: allowTransferIn, set: setAllowTransferIn},
                {label: 'تحويل صادر؟', val: allowTransferOut, set: setAllowTransferOut},
              ].map((flag) => (
                <label key={flag.label} className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={flag.val}
                    onChange={(e) => flag.set(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  {flag.label}
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-2 md:col-span-2">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white"
              >
                حفظ الخزينة
              </button>
            </div>
          </form>
        </section>
      )}

      {!showForm && <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white lg:col-span-7">
          <table className="w-full border-collapse text-right text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="px-4 py-3">الكود</th>
                <th className="px-4 py-3">الخزينة</th>
                <th className="px-4 py-3">الفرع / الحساب</th>
                <th className="px-4 py-3">الصلاحيات</th>
                <th className="px-4 py-3">الإجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500"><LoadingState label="جارٍ التحميل" /></td>
                </tr>
              ) : (
                cashboxes.map((box) => {
                  const selected = box.id === selectedCashboxId;
                  return (
                    <tr
                      key={box.id}
                      onClick={() => setSelectedCashboxId(box.id)}
                      className={`cursor-pointer transition-colors ${selected ? 'bg-slate-50' : 'hover:bg-slate-50/70'}`}
                    >
                      <td className="px-4 py-3 font-mono-tabular text-xs font-medium text-slate-900">{box.code}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{box.name}</p>
                        <span className={`inline-flex items-center gap-1 text-xs ${box.is_active ? 'text-emerald-700' : 'text-slate-400'}`}>
                          {box.is_active ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                          {box.is_active ? 'فعالة' : 'معطلة'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <p>{branchMap.get(box.branch_id) ?? '—'}</p>
                        <p className="font-mono-tabular text-slate-500">{accountMap.get(box.ledger_account_id) ?? '—'}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {[
                          box.allow_deposit && 'إيداع',
                          box.allow_withdraw && 'سحب',
                          box.allow_transfer_in && 'وارد',
                          box.allow_transfer_out && 'صادر',
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'مقيدة'}
                      </td>
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => openEditForm(box)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                            تعديل
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Custodians Panel */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 lg:col-span-5">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Wallet className="h-4 w-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">
              أمناء الخزينة: {selectedCashbox?.name ?? '—'}
            </h2>
          </div>

          {selectedCashbox && isAdmin && (
            <form onSubmit={handleAddCustodian} className="mt-4 flex gap-2">
              <select
                aria-label="اختيار موظف لتعيينه أمين خزينة"
                value={newCustodianMembershipId}
                onChange={(e) => setNewCustodianMembershipId(e.target.value)}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <option value="">اختر موظفًا لتعيينه أمين خزينة...</option>
                {staffMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name} ({m.username})
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={saving || !newCustodianMembershipId}
                className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
              >
                تعيين
              </button>
            </form>
          )}

          <div className="mt-4 divide-y divide-slate-100">
            {selectedCustodians.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">لا يوجد أمناء معينون لهذه الخزينة.</p>
            ) : (
              selectedCustodians.map((c) => {
                const member = staffMap.get(c.membership_id);
                return (
                  <div key={c.id} className="flex items-center justify-between py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4 text-slate-500" />
                      <div>
                        <p className="font-medium text-slate-900">{member?.display_name ?? 'موظف'}</p>
                        <p className="font-mono-tabular text-xs text-slate-500">
                          {member?.username ?? c.membership_id.slice(0, 8)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium ${c.is_active ? 'text-emerald-700' : 'text-slate-400'}`}>
                        {c.is_active ? 'فعال' : 'معطل'}
                      </span>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={() => void toggleCashboxCustodian(tenant.id, c.id, !c.is_active).then(loadData)}
                          className="text-xs font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900"
                        >
                          {c.is_active ? 'إيقاف' : 'تفعيل'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>}
    </div>
  );
}
