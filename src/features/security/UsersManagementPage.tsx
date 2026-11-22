import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {ConfirmDialog} from '@/components/ui/ConfirmDialog';
import {DataTable, type DataTableColumn} from '@/components/ui/DataTable';
import {FilterBar} from '@/components/ui/FilterBar';
import {listClients} from '@/features/clients/clientsService';
import {listCouriers} from '@/features/couriers/couriersService';
import {listBranches} from '@/features/definitions/definitionsService';
import {
  createTenantUser,
  listTenantRoles,
  listTenantUsersDirectory,
  resetTenantUserPassword,
  toggleTenantUserActive,
  updateTenantUserAssignment,
} from '@/features/security/securityService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {AccountSubjectType} from '@/types/common';
import type {CourierRecord} from '@/types/couriers';
import type {BranchRecord} from '@/types/definitions';
import type {ClientRecord} from '@/types/pricing';
import type {RoleRecord, TenantUserDirectoryItem} from '@/types/security';
import {Edit3, KeyRound, Plus, Power} from 'lucide-react';

const SUBJECT_TYPE_LABELS: Record<AccountSubjectType, string> = {
  [AccountSubjectType.STAFF]: 'موظف',
  [AccountSubjectType.CLIENT]: 'عميل (تاجر)',
  [AccountSubjectType.COURIER]: 'مندوب توصيل',
  [AccountSubjectType.PLATFORM_SUPPORT]: 'دعم المنصة',
};

export function UsersManagementPage() {
  const {tenant, membership, isAdmin, can} = useTenantWorkspace();
  const canManageUsers = isAdmin || can('users.manage');

  const [users, setUsers] = useState<readonly TenantUserDirectoryItem[]>([]);
  const [roles, setRoles] = useState<readonly RoleRecord[]>([]);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [couriers, setCouriers] = useState<readonly CourierRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [subjectFilter, setSubjectFilter] = useState<'all' | AccountSubjectType>('all');

  // Create / Edit User form state
  const [showForm, setShowForm] = useState(false);
  const [editingMembershipId, setEditingMembershipId] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [roleId, setRoleId] = useState('');
  const [clientId, setClientId] = useState('');
  const [courierId, setCourierId] = useState('');
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Reset password & toggle active state
  const [resetTarget, setResetTarget] = useState<TenantUserDirectoryItem | null>(null);
  const [newTempPassword, setNewTempPassword] = useState('');
  const [toggleTarget, setToggleTarget] = useState<TenantUserDirectoryItem | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [uRows, rRows, bRows, cRows, crRows] = await Promise.all([
        listTenantUsersDirectory(tenant.id),
        listTenantRoles(tenant.id),
        listBranches(tenant.id),
        listClients(tenant.id),
        listCouriers(tenant.id),
      ]);
      setUsers(uRows);
      setRoles(rRows);
      setBranches(bRows);
      setClients(cRows);
      setCouriers(crRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل قائمة المستخدمين.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const assignableRoles = useMemo(
    () =>
      roles.filter(
        (r) =>
          r.is_active &&
          r.code !== 'company_owner' &&
          (membership.role_key === 'company_owner' || r.code !== 'company_admin'),
      ),
    [roles, membership.role_key],
  );

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === roleId) ?? null,
    [roles, roleId],
  );

  const openCreateForm = () => {
    setEditingMembershipId(null);
    setUsername('');
    setDisplayName('');
    setPassword('');
    const defaultRole = assignableRoles[0]?.id ?? '';
    setRoleId(defaultRole);
    setClientId(clients[0]?.id ?? '');
    setCourierId(couriers[0]?.id ?? '');
    setSelectedBranchIds([]);
    setShowForm(true);
    setFeedback(null);
    setError(null);
  };

  const openEditForm = (row: TenantUserDirectoryItem) => {
    setEditingMembershipId(row.membership_id);
    setUsername(row.username);
    setDisplayName(row.display_name);
    setPassword('');
    setRoleId(row.role_id ?? roles.find((r) => r.code === row.role_key)?.id ?? '');
    setClientId(row.client_id ?? clients[0]?.id ?? '');
    setCourierId(row.courier_id ?? couriers[0]?.id ?? '');
    setSelectedBranchIds([...row.branch_ids]);
    setShowForm(true);
    setFeedback(null);
    setError(null);
  };

  const toggleBranchSelection = (branchId: string) => {
    setSelectedBranchIds((prev) =>
      prev.includes(branchId) ? prev.filter((id) => id !== branchId) : [...prev, branchId],
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!roleId) return;
    setSaving(true);
    setError(null);
    try {
      const boundClientId = selectedRole?.default_subject_type === 'client' ? clientId : null;
      const boundCourierId = selectedRole?.default_subject_type === 'courier' ? courierId : null;
      if (editingMembershipId) {
        await updateTenantUserAssignment({
          tenantId: tenant.id,
          membershipId: editingMembershipId,
          displayName,
          roleId,
          clientId: boundClientId,
          courierId: boundCourierId,
          branchIds: selectedBranchIds,
        });
        setFeedback('تم تحديث صلاحيات وربط المستخدم بنجاح.');
      } else {
        await createTenantUser({
          tenantId: tenant.id,
          username,
          displayName,
          password,
          roleId,
          clientId: boundClientId,
          courierId: boundCourierId,
          branchIds: selectedBranchIds,
        });
        setFeedback(`تم إنشاء المستخدم @${username.toLowerCase()} وربطه بالدور بنجاح.`);
      }
      setShowForm(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ بيانات المستخدم.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmToggle = async () => {
    if (!toggleTarget) return;
    try {
      await toggleTenantUserActive(tenant.id, toggleTarget.membership_id, !toggleTarget.is_active);
      setFeedback(toggleTarget.is_active ? 'تم إيقاف حساب المستخدم وإبطال جلسته.' : 'تم تفعيل حساب المستخدم.');
      setToggleTarget(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تغيير حالة المستخدم.');
      setToggleTarget(null);
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetTarget) return;
    setSaving(true);
    setError(null);
    try {
      await resetTenantUserPassword(tenant.id, resetTarget.membership_id, newTempPassword);
      setFeedback(`تم تعيين كلمة مرور مؤقتة جديدة للمستخدم @${resetTarget.username}.`);
      setResetTarget(null);
      setNewTempPassword('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث كلمة المرور.');
    } finally {
      setSaving(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (subjectFilter !== 'all' && u.account_subject_type !== subjectFilter) return false;
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.display_name.toLowerCase().includes(q) ||
        u.role_name.toLowerCase().includes(q) ||
        (u.client_name ?? '').toLowerCase().includes(q)
      );
    });
  }, [users, search, subjectFilter]);

  const columns: readonly DataTableColumn<TenantUserDirectoryItem>[] = [
    {
      key: 'username',
      header: 'اسم المستخدم',
      render: (r) => (
        <div>
          <p className="font-mono-tabular font-semibold text-slate-900">@{r.username}</p>
          <p className="text-xs text-slate-500">{r.display_name}</p>
        </div>
      ),
    },
    {
      key: 'subject',
      header: 'طبيعة الحساب',
      render: (r) => (
        <span className="text-xs text-slate-700">{SUBJECT_TYPE_LABELS[r.account_subject_type]}</span>
      ),
    },
    {
      key: 'linkedSubject',
      header: 'الحساب المرتبط',
      render: (r) =>
        r.client_name ? (
          <span className="text-xs font-medium text-slate-900">
            <span className="font-mono-tabular text-slate-500">{r.client_code}</span> · {r.client_name}
          </span>
        ) : r.courier_name ? (
          <span className="text-xs font-medium text-slate-900">
            <span className="font-mono-tabular text-slate-500">{r.courier_code}</span> · {r.courier_name}
          </span>
        ) : r.account_subject_type === AccountSubjectType.COURIER ? (
          <span className="text-xs text-amber-700">مندوب غير مربوط بعد</span>
        ) : (
          <span className="text-xs text-slate-400">حساب داخلي</span>
        ),
    },
    {
      key: 'role',
      header: 'الدور',
      render: (r) => (
        <div>
          <p className="text-xs font-medium text-slate-900">{r.role_name}</p>
          <p className="font-mono-tabular text-[11px] text-slate-500">{r.role_key}</p>
        </div>
      ),
    },
    {
      key: 'branches',
      header: 'نطاق الفروع',
      render: (r) => (
        <span className="text-xs text-slate-600">
          {r.branch_names.length === 0 ? 'كل الفروع' : r.branch_names.join('، ')}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (r) => (
        <span className={`text-xs font-medium ${r.is_active ? 'text-emerald-700' : 'text-red-700'}`}>
          {r.is_active ? 'فعال' : 'موقوف'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'الإجراءات',
      render: (r) =>
        canManageUsers && r.role_key !== 'company_owner' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="تعديل الدور والفروع"
              onClick={() => openEditForm(r)}
              className="rounded border border-slate-200 p-1 text-slate-700 hover:bg-slate-50"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="تعيين كلمة مرور مؤقتة"
              onClick={() => {
                setResetTarget(r);
                setNewTempPassword('');
              }}
              className="rounded border border-slate-200 p-1 text-slate-700 hover:bg-slate-50"
            >
              <KeyRound className="h-3.5 w-3.5" />
            </button>
            {r.membership_id !== membership.id && (
              <button
                type="button"
                title={r.is_active ? 'تعطيل الحساب' : 'تفعيل الحساب'}
                onClick={() => setToggleTarget(r)}
                className={`rounded border p-1 ${
                  r.is_active
                    ? 'border-red-200 text-red-700 hover:bg-red-50'
                    : 'border-emerald-200 text-emerald-700 hover:bg-emerald-50'
                }`}
              >
                <Power className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-400">{r.role_key === 'company_owner' ? 'حساب المالك' : '—'}</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">إدارة المستخدمين والصلاحيات والنطاق</h1>
          <p className="mt-1 text-xs text-slate-500">
            إنشاء حسابات الموظفين والعملاء والمناديب، وتعيين الدور ونطاق الفروع، دون تخزين كلمات المرور في جداول التطبيق.
          </p>
        </div>

        {canManageUsers && (
          <button
            type="button"
            onClick={openCreateForm}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            إضافة مستخدم جديد
          </button>
        )}
      </div>

      {feedback && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          {feedback}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-semibold text-slate-900">
              {editingMembershipId ? `تعديل صلاحيات @${username}` : 'إنشاء مستخدم جديد بالشركة'}
            </h2>
            <button type="button" onClick={() => setShowForm(false)} className="text-xs text-slate-500 hover:text-slate-900">
              إغلاق
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="usr-username" className="block text-xs font-medium text-slate-700">
                اسم المستخدم للدخول *
              </label>
              <input
                id="usr-username"
                required
                dir="ltr"
                disabled={Boolean(editingMembershipId)}
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="ahmed.sales"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm disabled:bg-slate-100"
              />
            </div>

            <div>
              <label htmlFor="usr-display" className="block text-xs font-medium text-slate-700">
                الاسم الكامل / الظاهر *
              </label>
              <input
                id="usr-display"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            {!editingMembershipId && (
              <div>
                <label htmlFor="usr-password" className="block text-xs font-medium text-slate-700">
                  كلمة المرور المؤقتة *
                </label>
                <input
                  id="usr-password"
                  type="password"
                  required
                  minLength={8}
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8 أحرف على الأقل"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            )}

            <div>
              <label htmlFor="usr-role" className="block text-xs font-medium text-slate-700">
                الدور الوظيفي *
              </label>
              <select
                id="usr-role"
                required
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {assignableRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedRole?.default_subject_type === 'client' && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <label htmlFor="usr-client" className="block text-xs font-semibold text-slate-800">
                ربط الحساب بملف العميل (التاجر) *
              </label>
              <select
                id="usr-client"
                required
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm sm:max-w-md"
              >
                {clients.length === 0 ? (
                  <option value="">لا يوجد عملاء مسجلون بعد — أنشئ العميل أولًا</option>
                ) : (
                  clients.map((cl) => (
                    <option key={cl.id} value={cl.id}>
                      {cl.code} — {cl.name}
                    </option>
                  ))
                )}
              </select>
            </div>
          )}

          {selectedRole?.default_subject_type === 'courier' && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <label htmlFor="usr-courier" className="block text-xs font-semibold text-slate-800">
                ربط الحساب بملف المندوب *
              </label>
              <select
                id="usr-courier"
                required
                value={courierId}
                onChange={(e) => setCourierId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm sm:max-w-md"
              >
                {couriers.length === 0 ? (
                  <option value="">لا يوجد مناديب مسجلون بعد — أنشئ المندوب أولًا</option>
                ) : (
                  couriers.map((cr) => (
                    <option key={cr.id} value={cr.id}>
                      {cr.code} — {cr.name}
                    </option>
                  ))
                )}
              </select>
            </div>
          )}

          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-medium text-slate-700">
              نطاق الفروع المسموح بها (اتركه بدون تحديد للسماح بكامل فروع الشركة حسب صلاحية الدور):
            </p>
            <div className="flex flex-wrap gap-3">
              {branches.map((br) => (
                <label
                  key={br.id}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={selectedBranchIds.includes(br.id)}
                    onChange={() => toggleBranchSelection(br.id)}
                  />
                  <span>
                    {br.code} — {br.name}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={
                saving ||
                (selectedRole?.default_subject_type === 'client' && !clientId) ||
                (selectedRole?.default_subject_type === 'courier' && !courierId)
              }
              className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? 'جاري الحفظ...' : editingMembershipId ? 'حفظ التعديلات' : 'إنشاء المستخدم'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {resetTarget && (
        <form onSubmit={handleResetPassword} className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">
            تعيين كلمة مرور مؤقتة جديدة للمستخدم @{resetTarget.username}
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="password"
              required
              minLength={8}
              dir="ltr"
              value={newTempPassword}
              onChange={(e) => setNewTempPassword(e.target.value)}
              placeholder="كلمة المرور المؤقتة (8 أحرف على الأقل)"
              className="w-72 rounded-lg border border-slate-200 px-3 py-2 text-xs"
            />
            <button type="submit" disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white">
              تحديث كلمة المرور
            </button>
            <button
              type="button"
              onClick={() => setResetTarget(null)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-700"
            >
              إلغاء
            </button>
          </div>
        </form>
      )}

      {!showForm && <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث باسم المستخدم أو الاسم أو الدور أو العميل..."
        extraControls={
          <select
            aria-label="تصفية بنوع الحساب"
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value as 'all' | AccountSubjectType)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <option value="all">كل أنواع الحسابات</option>
            <option value={AccountSubjectType.STAFF}>موظف</option>
            <option value={AccountSubjectType.CLIENT}>عميل (تاجر)</option>
            <option value={AccountSubjectType.COURIER}>مندوب توصيل</option>
          </select>
        }
      />}

      {!showForm && <DataTable
        columns={columns}
        rows={filteredUsers}
        rowKey={(r) => r.membership_id}
        loading={loading}
        emptyMessage="لا يوجد مستخدمون مطابقون للبحث."
      />}

      <ConfirmDialog
        open={Boolean(toggleTarget)}
        title={toggleTarget?.is_active ? 'تأكيد إيقاف المستخدم' : 'تأكيد تفعيل المستخدم'}
        description={
          toggleTarget?.is_active
            ? `هل تريد إيقاف حساب @${toggleTarget?.username}؟ سيتم منعه من الدخول فورًا.`
            : `هل تريد إعادة تفعيل حساب @${toggleTarget?.username}؟`
        }
        confirmLabel={toggleTarget?.is_active ? 'إيقاف الحساب' : 'تفعيل الحساب'}
        onConfirm={() => void handleConfirmToggle()}
        onCancel={() => setToggleTarget(null)}
      />
    </div>
  );
}
