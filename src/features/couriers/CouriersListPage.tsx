import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {ConfirmDialog} from '@/components/ui/ConfirmDialog';
import {DataTable, type DataTableColumn} from '@/components/ui/DataTable';
import {FilterBar} from '@/components/ui/FilterBar';
import {buildTenantBasePath} from '@/config/brand';
import {
  archiveCourier,
  listCommissionLists,
  listCourierRoutes,
  listCouriers,
  saveCourier,
  type SaveCourierInput,
} from '@/features/couriers/couriersService';
import {
  generateNextCode,
  listBranches,
  listChartOfAccounts,
  listCities,
  listCountries,
  listGovernorates,
  listRegions,
} from '@/features/definitions/definitionsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {
  CommissionType,
  CourierCommissionListRecord,
  CourierRecord,
  CourierRouteRecord,
} from '@/types/couriers';
import type {
  BranchRecord,
  ChartOfAccountRecord,
  CityRecord,
  CountryRecord,
  GovernorateRecord,
  RegionRecord,
} from '@/types/definitions';
import {Archive, Edit3, Plus, UserPlus, X} from 'lucide-react';

const COMMISSION_TYPE_LABELS: Record<CommissionType, string> = {
  delivery_percent: 'نسبة من التوصيل (%)',
  delivery_plus_collection_percent: 'نسبة من التوصيل + التحصيل (%)',
  fixed_amount: 'مبلغ ثابت (ج.م)',
};

export interface CouriersListPageProps {
  readonly initialMode?: 'list' | 'create';
}

export function CouriersListPage({initialMode = 'list'}: CouriersListPageProps) {
  const {tenant, isAdmin, can} = useTenantWorkspace();
  const canManageCouriers = isAdmin || can('couriers.manage');
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const [couriers, setCouriers] = useState<readonly CourierRecord[]>([]);
  const [routes, setRoutes] = useState<readonly CourierRouteRecord[]>([]);
  const [commissionLists, setCommissionLists] = useState<readonly CourierCommissionListRecord[]>([]);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [accounts, setAccounts] = useState<readonly ChartOfAccountRecord[]>([]);
  const [countries, setCountries] = useState<readonly CountryRecord[]>([]);
  const [governorates, setGovernorates] = useState<readonly GovernorateRecord[]>([]);
  const [cities, setCities] = useState<readonly CityRecord[]>([]);
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formState, setFormState] = useState<SaveCourierInput | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<CourierRecord | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        cRows,
        rtRows,
        clRows,
        brRows,
        accRows,
        cntRows,
        govRows,
        ctyRows,
        regRows,
      ] = await Promise.all([
        listCouriers(tenant.id),
        listCourierRoutes(tenant.id),
        listCommissionLists(tenant.id),
        listBranches(tenant.id),
        listChartOfAccounts(tenant.id),
        listCountries(tenant.id),
        listGovernorates(tenant.id),
        listCities(tenant.id),
        listRegions(tenant.id),
      ]);
      setCouriers(cRows);
      setRoutes(rtRows);
      setCommissionLists(clRows);
      setBranches(brRows);
      setAccounts(accRows.filter((a) => !a.is_group && a.is_active));
      setCountries(cntRows);
      setGovernorates(govRows);
      setCities(ctyRows);
      setRegions(regRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات المناديب.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const defaultRouteId = useMemo(
    () => routes.find((r) => r.is_system_default || r.code === 'GENERAL')?.id ?? routes[0]?.id ?? '',
    [routes],
  );
  const defaultCommListId = useMemo(
    () => commissionLists.find((l) => l.is_system_default || l.code === '0')?.id ?? commissionLists[0]?.id ?? '',
    [commissionLists],
  );
  const defaultCountryId = useMemo(
    () => countries.find((c) => c.is_default)?.id ?? countries[0]?.id ?? null,
    [countries],
  );

  const openCreateForm = useCallback(() => {
    setFormState({
      code: generateNextCode(
        'CR',
        couriers.map((c) => c.code),
      ),
      name: '',
      branch_id: branches[0]?.id ?? null,
      ledger_account_id: null,
      custody_account_id: null,
      default_route_id: defaultRouteId,
      commission_list_id: defaultCommListId,
      default_commission_type: 'fixed_amount',
      default_commission_value: 25,
      country_id: defaultCountryId,
      governorate_id: governorates[0]?.id ?? null,
      city_id: null,
      region_id: null,
      phone: '',
      mobile: '',
      po_box: '',
      postal_code: '',
      address_line: '',
      email: '',
      is_active: true,
    });
    setShowForm(true);
    setFeedback(null);
    setError(null);
  }, [couriers, branches, defaultRouteId, defaultCommListId, defaultCountryId, governorates]);

  useEffect(() => {
    if (initialMode === 'create' && !loading && !showForm && defaultRouteId && defaultCommListId) {
      openCreateForm();
    }
  }, [initialMode, loading, showForm, defaultRouteId, defaultCommListId, openCreateForm]);

  const openEditForm = (row: CourierRecord) => {
    setFormState({
      id: row.id,
      code: row.code,
      name: row.name,
      branch_id: row.branch_id,
      ledger_account_id: row.ledger_account_id,
      custody_account_id: row.custody_account_id,
      default_route_id: row.default_route_id,
      commission_list_id: row.commission_list_id,
      default_commission_type: row.default_commission_type,
      default_commission_value: Number(row.default_commission_value),
      country_id: row.country_id,
      governorate_id: row.governorate_id,
      city_id: row.city_id,
      region_id: row.region_id,
      phone: row.phone ?? '',
      mobile: row.mobile,
      po_box: row.po_box ?? '',
      postal_code: row.postal_code ?? '',
      address_line: row.address_line ?? '',
      email: row.email ?? '',
      is_active: row.is_active,
    });
    setShowForm(true);
    setFeedback(null);
    setError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!formState) return;
    setSaving(true);
    setError(null);
    try {
      await saveCourier(tenant.id, formState);
      setFeedback(
        formState.id
          ? 'تم تحديث ملف المندوب بنجاح.'
          : 'تم إنشاء ملف المندوب بنجاح. لمنحه صلاحية الدخول للبوابة اربطه بمستخدم من شاشة الأمان ← المستخدمون.',
      );
      setShowForm(false);
      setFormState(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ بيانات المندوب.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget) return;
    try {
      await archiveCourier(tenant.id, archiveTarget.id);
      setFeedback(`تمت أرشفة المندوب «${archiveTarget.name}».`);
      setArchiveTarget(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر أرشفة المندوب.');
      setArchiveTarget(null);
    }
  };

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const routeMap = useMemo(() => new Map(routes.map((r) => [r.id, r.name])), [routes]);
  const commListMap = useMemo(() => new Map(commissionLists.map((l) => [l.id, l.name])), [commissionLists]);

  const filteredCouriers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return couriers.filter((c) => {
      if (branchFilter && c.branch_id !== branchFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.mobile.toLowerCase().includes(q)
      );
    });
  }, [couriers, search, branchFilter]);

  const filteredRegions = useMemo(
    () => regions.filter((r) => !formState?.governorate_id || r.governorate_id === formState.governorate_id),
    [regions, formState?.governorate_id],
  );

  const filteredCities = useMemo(
    () => cities.filter((c) => !formState?.governorate_id || c.governorate_id === formState.governorate_id),
    [cities, formState?.governorate_id],
  );

  const columns: readonly DataTableColumn<CourierRecord>[] = [
    {
      key: 'code',
      header: 'الكود',
      render: (r) => <span className="font-mono-tabular font-semibold text-slate-900">{r.code}</span>,
    },
    {
      key: 'name',
      header: 'المندوب',
      render: (r) => (
        <div>
          <p className="font-medium text-slate-900">{r.name}</p>
          <p className="font-mono-tabular text-xs text-slate-500">{r.mobile}</p>
        </div>
      ),
    },
    {
      key: 'branch',
      header: 'الفرع',
      render: (r) => <span className="text-xs text-slate-700">{r.branch_id ? branchMap.get(r.branch_id) ?? '—' : 'كل الفروع'}</span>,
    },
    {
      key: 'route',
      header: 'خط السير',
      render: (r) => <span className="text-xs text-slate-700">{routeMap.get(r.default_route_id) ?? '—'}</span>,
    },
    {
      key: 'commission',
      header: 'قائمة العمولة والافتراضي',
      render: (r) => (
        <div className="text-xs">
          <p className="font-medium text-slate-800">{commListMap.get(r.commission_list_id) ?? '—'}</p>
          <p className="font-mono-tabular text-slate-500">
            {COMMISSION_TYPE_LABELS[r.default_commission_type]}: {Number(r.default_commission_value).toFixed(2)}
          </p>
        </div>
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
        canManageCouriers ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="تعديل بيانات المندوب"
              onClick={() => openEditForm(r)}
              className="rounded border border-slate-200 p-1 text-slate-700 hover:bg-slate-50"
            >
              <Edit3 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="أرشفة المندوب"
              onClick={() => setArchiveTarget(r)}
              className="rounded border border-red-200 p-1 text-red-700 hover:bg-red-50"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">مناديب التوصيل والالتقاط</h1>
          <p className="mt-1 text-xs text-slate-500">
            إدارة ملفات المناديب وخطوط السير وقوائم العمولات. إنشاء المندوب لا ينشئ حساب دخول تلقائيًا؛ يُربط الحساب من{' '}
            <Link to={`${basePath}/security/users`} className="font-semibold text-slate-900 underline">
              الأمان ← المستخدمون
            </Link>
            .
          </p>
        </div>

        {canManageCouriers && (
          <div className="flex items-center gap-2">
            <Link
              to={`${basePath}/security/users`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <UserPlus className="h-3.5 w-3.5" />
              ربط مستخدم لمندوب
            </Link>
            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
            >
              <Plus className="h-4 w-4" />
              إنشاء مندوب جديد
            </button>
          </div>
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

      {showForm && formState && (
        <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-semibold text-slate-900">
              {formState.id ? `تعديل ملف المندوب (${formState.code})` : 'إنشاء مندوب توصيل جديد'}
            </h2>
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setFormState(null);
              }}
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="cr-code" className="block text-xs font-medium text-slate-700">
                كود المندوب *
              </label>
              <input
                id="cr-code"
                required
                dir="ltr"
                value={formState.code}
                onChange={(e) => setFormState({...formState, code: e.target.value.toUpperCase()})}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>

            <div>
              <label htmlFor="cr-name" className="block text-xs font-medium text-slate-700">
                اسم المندوب *
              </label>
              <input
                id="cr-name"
                required
                value={formState.name}
                onChange={(e) => setFormState({...formState, name: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="cr-mobile" className="block text-xs font-medium text-slate-700">
                رقم الموبايل *
              </label>
              <input
                id="cr-mobile"
                required
                dir="ltr"
                value={formState.mobile}
                onChange={(e) => setFormState({...formState, mobile: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>

            <div>
              <label htmlFor="cr-branch" className="block text-xs font-medium text-slate-700">
                الفرع التابع له
              </label>
              <select
                id="cr-branch"
                value={formState.branch_id ?? ''}
                onChange={(e) => setFormState({...formState, branch_id: e.target.value || null})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">غير مقيد بفرع</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="cr-route" className="block text-xs font-medium text-slate-700">
                  خط السير *
                </label>
                <Link to={`${basePath}/couriers/routes`} className="text-[11px] font-medium text-slate-600 hover:underline">
                  + خطوط السير
                </Link>
              </div>
              <select
                id="cr-route"
                required
                value={formState.default_route_id}
                onChange={(e) => setFormState({...formState, default_route_id: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {routes.map((rt) => (
                  <option key={rt.id} value={rt.id}>
                    {rt.code} — {rt.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="cr-comm-list" className="block text-xs font-medium text-slate-700">
                  قائمة العمولات *
                </label>
                <Link to={`${basePath}/couriers/commissions`} className="text-[11px] font-medium text-slate-600 hover:underline">
                  + قوائم العمولات
                </Link>
              </div>
              <select
                id="cr-comm-list"
                required
                value={formState.commission_list_id}
                onChange={(e) => setFormState({...formState, commission_list_id: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {commissionLists.map((cl) => (
                  <option key={cl.id} value={cl.id}>
                    {cl.code} — {cl.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cr-comm-type" className="block text-xs font-medium text-slate-700">
                نوع العمولة الافتراضي للمندوب *
              </label>
              <select
                id="cr-comm-type"
                value={formState.default_commission_type}
                onChange={(e) =>
                  setFormState({...formState, default_commission_type: e.target.value as CommissionType})
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="delivery_percent">نسبة من التوصيل (%)</option>
                <option value="delivery_plus_collection_percent">نسبة من التوصيل + التحصيل (%)</option>
                <option value="fixed_amount">مبلغ ثابت (ج.م)</option>
              </select>
            </div>

            <div>
              <label htmlFor="cr-comm-val" className="block text-xs font-medium text-slate-700">
                مقدار العمولة الافتراضي *
              </label>
              <input
                id="cr-comm-val"
                type="number"
                step="0.01"
                min="0"
                required
                dir="ltr"
                value={formState.default_commission_value}
                onChange={(e) => setFormState({...formState, default_commission_value: Number(e.target.value)})}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="cr-ledger" className="block text-xs font-medium text-slate-700">
                حساب الأستاذ (اختياري)
              </label>
              <select
                id="cr-ledger"
                value={formState.ledger_account_id ?? ''}
                onChange={(e) => setFormState({...formState, ledger_account_id: e.target.value || null})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">بدون تحديد حاليًا</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cr-custody" className="block text-xs font-medium text-slate-700">
                حساب العهدة (اختياري)
              </label>
              <select
                id="cr-custody"
                value={formState.custody_account_id ?? ''}
                onChange={(e) => setFormState({...formState, custody_account_id: e.target.value || null})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">بدون تحديد حاليًا</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cr-gov" className="block text-xs font-medium text-slate-700">
                المحافظة
              </label>
              <select
                id="cr-gov"
                value={formState.governorate_id ?? ''}
                onChange={(e) =>
                  setFormState({
                    ...formState,
                    governorate_id: e.target.value || null,
                    city_id: null,
                    region_id: null,
                  })
                }
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {governorates.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cr-region" className="block text-xs font-medium text-slate-700">
                المنطقة
              </label>
              <select
                id="cr-region"
                value={formState.region_id ?? ''}
                onChange={(e) => setFormState({...formState, region_id: e.target.value || null})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {filteredRegions.map((rg) => (
                  <option key={rg.id} value={rg.id}>
                    {rg.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="cr-city" className="block text-xs font-medium text-slate-700">
                المدينة
              </label>
              <select
                id="cr-city"
                value={formState.city_id ?? ''}
                onChange={(e) => setFormState({...formState, city_id: e.target.value || null})}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">—</option>
                {filteredCities.map((ct) => (
                  <option key={ct.id} value={ct.id}>
                    {ct.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cr-phone" className="block text-xs font-medium text-slate-700">
                رقم التليفون
              </label>
              <input
                id="cr-phone"
                dir="ltr"
                value={formState.phone ?? ''}
                onChange={(e) => setFormState({...formState, phone: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>

            <div>
              <label htmlFor="cr-email" className="block text-xs font-medium text-slate-700">
                البريد الإلكتروني
              </label>
              <input
                id="cr-email"
                type="email"
                dir="ltr"
                value={formState.email ?? ''}
                onChange={(e) => setFormState({...formState, email: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label htmlFor="cr-address" className="block text-xs font-medium text-slate-700">
                العنوان
              </label>
              <input
                id="cr-address"
                value={formState.address_line ?? ''}
                onChange={(e) => setFormState({...formState, address_line: e.target.value})}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-4">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={formState.is_active}
                onChange={(e) => setFormState({...formState, is_active: e.target.checked})}
              />
              <span>المندوب فعال ومتاح لإسناد المهام</span>
            </label>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {saving ? 'جاري الحفظ...' : formState.id ? 'حفظ التعديلات' : 'حفظ المندوب'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setFormState(null);
                }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                إلغاء
              </button>
            </div>
          </div>
        </form>
      )}

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="بحث باسم المندوب أو الكود أو رقم الموبايل..."
        extraControls={
          <select
            aria-label="تصفية بالفرع"
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <option value="">كل الفروع</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        }
      />

      <DataTable
        columns={columns}
        rows={filteredCouriers}
        rowKey={(r) => r.id}
        loading={loading}
        emptyMessage="لا يوجد مناديب مسجلون بعد."
      />

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="تأكيد أرشفة المندوب"
        description={`هل تريد أرشفة ملف المندوب «${archiveTarget?.name}» (${archiveTarget?.code})؟ سيُحفظ السجل تاريخيًا ويتوقف إسناده للمهام الجديدة.`}
        confirmLabel="أرشفة المندوب"
        onConfirm={() => void handleConfirmArchive()}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  );
}
