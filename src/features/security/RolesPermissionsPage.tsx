import {LoadingState} from '@/components/ui/LoadingState';
import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {
  createCustomRole,
  listPermissionsCatalog,
  listRolePermissions,
  listTenantRoles,
  saveRolePermissions,
} from '@/features/security/securityService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {PERMISSION_MODULE_LABELS} from '@/lib/permissions';
import {PermissionScope} from '@/types/common';
import type {PermissionCatalogRecord, RoleRecord} from '@/types/security';
import {Plus, Save, ShieldCheck} from 'lucide-react';

export function RolesPermissionsPage() {
  const {tenant, isAdmin, can} = useTenantWorkspace();
  const canManageRoles = isAdmin || can('roles.manage');

  const [roles, setRoles] = useState<readonly RoleRecord[]>([]);
  const [catalog, setCatalog] = useState<readonly PermissionCatalogRecord[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [grantedMap, setGrantedMap] = useState<Record<string, PermissionScope>>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Create custom role
  const [showCreateRole, setShowCreateRole] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newSubject, setNewSubject] = useState<'staff' | 'client' | 'courier'>('staff');
  const [newScope, setNewScope] = useState<PermissionScope>(PermissionScope.BRANCH);

  const loadRoleGrants = useCallback(
    async (roleId: string) => {
      if (!roleId) return;
      try {
        const grants = await listRolePermissions(tenant.id, roleId);
        const map: Record<string, PermissionScope> = {};
        for (const g of grants) {
          map[g.permission_key] = g.scope;
        }
        setGrantedMap(map);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر تحميل صلاحيات الدور.');
      }
    },
    [tenant.id],
  );

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rRows, catRows] = await Promise.all([
        listTenantRoles(tenant.id),
        listPermissionsCatalog(),
      ]);
      setRoles(rRows);
      setCatalog(catRows);
      const targetId = selectedRoleId && rRows.some((r) => r.id === selectedRoleId)
        ? selectedRoleId
        : (rRows[0]?.id ?? '');
      setSelectedRoleId(targetId);
      if (targetId) {
        await loadRoleGrants(targetId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل الأدوار والصلاحيات.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id, selectedRoleId, loadRoleGrants]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) ?? null,
    [roles, selectedRoleId],
  );

  const groupedCatalog = useMemo(() => {
    const groups = new Map<string, PermissionCatalogRecord[]>();
    for (const item of catalog) {
      const arr = groups.get(item.module) ?? [];
      arr.push(item);
      groups.set(item.module, arr);
    }
    return Array.from(groups.entries());
  }, [catalog]);

  const togglePermission = (perm: PermissionCatalogRecord) => {
    if (!canManageRoles || selectedRole?.code === 'company_owner') return;
    setGrantedMap((prev) => {
      const next = {...prev};
      if (next[perm.key]) {
        delete next[perm.key];
      } else {
        next[perm.key] = perm.default_scope;
      }
      return next;
    });
  };

  const changePermissionScope = (key: string, scope: PermissionScope) => {
    if (!canManageRoles || selectedRole?.code === 'company_owner') return;
    setGrantedMap((prev) => ({...prev, [key]: scope}));
  };

  const handleSaveGrants = async () => {
    if (!selectedRole) return;
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      const grants = Object.entries(grantedMap).map(([permission_key, scope]) => ({
        permission_key,
        scope,
      }));
      await saveRolePermissions(tenant.id, selectedRole.id, grants);
      setFeedback(`تم حفظ مصفوفة الصلاحيات لدور «${selectedRole.name}» بنجاح.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ الصلاحيات.');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateRole = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const createdId = await createCustomRole(tenant.id, {
        code: newCode,
        name: newName,
        description: null,
        default_subject_type: newSubject,
        default_scope: newScope,
      });
      setShowCreateRole(false);
      setNewCode('');
      setNewName('');
      setSelectedRoleId(createdId);
      setFeedback('تم إنشاء الدور المخصص بنجاح. يمكنك الآن تحديد صلاحياته.');
      await loadInitial();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الدور.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-500"><LoadingState className="py-10" label="جارٍ تحميل الأدوار ومصفوفة الصلاحيات" /></p>;
  }

  const isOwnerRole = selectedRole?.code === 'company_owner';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">الأدوار ومصفوفة الصلاحيات</h1>
          <p className="mt-1 text-xs text-slate-500">
            تخصيص الصلاحيات ونطاقها (الشركة، الفروع، السجلات الخاصة، أو المهام المسندة) لكل دور وظيفي.
          </p>
        </div>

        {canManageRoles && (
          <button
            type="button"
            onClick={() => setShowCreateRole((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            إضافة دور مخصص
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

      {showCreateRole && (
        <form onSubmit={handleCreateRole} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-5 items-end">
          <div>
            <label htmlFor="role-code" className="block text-xs font-medium text-slate-700">
              كود الدور (إنجليزي)
            </label>
            <input
              id="role-code"
              required
              dir="ltr"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toLowerCase())}
              placeholder="branch_auditor"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
            />
          </div>
          <div>
            <label htmlFor="role-name" className="block text-xs font-medium text-slate-700">
              اسم الدور
            </label>
            <input
              id="role-name"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="مراجع فروع"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label htmlFor="role-subject" className="block text-xs font-medium text-slate-700">
              طبيعة الحساب
            </label>
            <select
              id="role-subject"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value as 'staff' | 'client' | 'courier')}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <option value="staff">موظف</option>
              <option value="client">عميل</option>
              <option value="courier">مندوب توصيل</option>
            </select>
          </div>
          <div>
            <label htmlFor="role-scope" className="block text-xs font-medium text-slate-700">
              النطاق الافتراضي
            </label>
            <select
              id="role-scope"
              value={newScope}
              onChange={(e) => setNewScope(e.target.value as PermissionScope)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <option value={PermissionScope.TENANT}>كل الشركة</option>
              <option value={PermissionScope.BRANCH}>الفروع المسندة</option>
              <option value={PermissionScope.OWN}>سجلاته فقط</option>
              <option value={PermissionScope.ASSIGNED}>المسندة إليه فقط</option>
            </select>
          </div>
          <button type="submit" disabled={saving} className="rounded-lg bg-slate-900 py-2 text-xs font-medium text-white">
            حفظ الدور
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <aside className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-4">
          <h2 className="border-b border-slate-100 pb-2.5 text-sm font-semibold text-slate-900">
            أدوار الشركة ({roles.length})
          </h2>
          <div className="space-y-1.5">
            {roles.map((r) => {
              const active = r.id === selectedRoleId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setSelectedRoleId(r.id);
                    setFeedback(null);
                    void loadRoleGrants(r.id);
                  }}
                  className={`flex w-full items-center justify-between rounded-lg border p-3 text-right text-xs transition-colors ${
                    active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div>
                    <p className="font-semibold">{r.name}</p>
                    <p className={`font-mono-tabular ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                      {r.code} · {r.default_subject_type}
                    </p>
                  </div>
                  {r.is_system && <ShieldCheck className="h-4 w-4 shrink-0 opacity-70" />}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                صلاحيات: {selectedRole?.name ?? '—'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {selectedRole?.description ?? 'حدد الصلاحيات ونطاق تنفيذ كل صلاحية.'}
              </p>
            </div>
            {canManageRoles && !isOwnerRole && selectedRole && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveGrants()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'جاري الحفظ...' : 'حفظ مصفوفة الصلاحيات'}
              </button>
            )}
          </div>

          {isOwnerRole && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              دور «مالك الشركة» محمي على مستوى قاعدة البيانات ويمتلك الصلاحيات الكاملة بشكل دائم.
            </div>
          )}

          <div className="space-y-5">
            {groupedCatalog.map(([moduleKey, perms]) => (
              <div key={moduleKey} className="space-y-2">
                <h3 className="border-b border-slate-100 pb-1.5 text-xs font-bold text-slate-800">
                  {PERMISSION_MODULE_LABELS[moduleKey] ?? moduleKey}
                </h3>
                <div className="divide-y divide-slate-100">
                  {perms.map((p) => {
                    const enabledScope = grantedMap[p.key];
                    const isChecked = Boolean(enabledScope);
                    return (
                      <div key={p.key} className="flex flex-wrap items-center justify-between gap-3 py-2 text-xs">
                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={!canManageRoles || isOwnerRole}
                            onChange={() => togglePermission(p)}
                            className="mt-0.5"
                          />
                          <div>
                            <p className="font-medium text-slate-900">{p.label_ar}</p>
                            <p className="font-mono-tabular text-[11px] text-slate-400">{p.key}</p>
                          </div>
                        </label>

                        {isChecked && (
                          <select
                            aria-label={`نطاق صلاحية ${p.key}`}
                            disabled={!canManageRoles || isOwnerRole}
                            value={enabledScope}
                            onChange={(e) => changePermissionScope(p.key, e.target.value as PermissionScope)}
                            className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs"
                          >
                            <option value={PermissionScope.TENANT}>كل الشركة</option>
                            <option value={PermissionScope.BRANCH}>الفروع المسندة</option>
                            <option value={PermissionScope.OWN}>سجلاته فقط</option>
                            <option value={PermissionScope.ASSIGNED}>المسندة إليه فقط</option>
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
