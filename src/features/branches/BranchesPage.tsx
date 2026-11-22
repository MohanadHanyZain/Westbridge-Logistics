import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {ConfirmDialog} from '@/components/ui/ConfirmDialog';
import {DataTable, type DataTableColumn} from '@/components/ui/DataTable';
import {FilterBar} from '@/components/ui/FilterBar';
import {
  archiveBranch,
  generateNextCode,
  listBranches,
  listCities,
  listCountries,
  listGovernorates,
  listRegions,
  saveBranch,
} from '@/features/definitions/definitionsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {
  BranchRecord,
  CityRecord,
  CountryRecord,
  GovernorateRecord,
  RegionRecord,
} from '@/types/definitions';
import {Archive, CheckCircle2, Edit3, Plus, Star, XCircle} from 'lucide-react';

export function BranchesPage() {
  const {tenant, isAdmin} = useTenantWorkspace();
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [countries, setCountries] = useState<readonly CountryRecord[]>([]);
  const [governorates, setGovernorates] = useState<readonly GovernorateRecord[]>([]);
  const [cities, setCities] = useState<readonly CityRecord[]>([]);
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  const [editingBranch, setEditingBranch] = useState<BranchRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [isMain, setIsMain] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [countryId, setCountryId] = useState('');
  const [governorateId, setGovernorateId] = useState('');
  const [cityId, setCityId] = useState('');
  const [regionId, setRegionId] = useState('');
  const [phone, setPhone] = useState('');
  const [fax, setFax] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<BranchRecord | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bData, cData, gData, ciData, rData] = await Promise.all([
        listBranches(tenant.id),
        listCountries(tenant.id),
        listGovernorates(tenant.id),
        listCities(tenant.id),
        listRegions(tenant.id),
      ]);
      setBranches(bData);
      setCountries(cData);
      setGovernorates(gData);
      setCities(ciData);
      setRegions(rData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل الفروع.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const govMap = useMemo(() => new Map(governorates.map((g) => [g.id, g.name])), [governorates]);
  const regionMap = useMemo(() => new Map(regions.map((r) => [r.id, r.name])), [regions]);

  const filteredCities = useMemo(
    () => (governorateId ? cities.filter((c) => c.governorate_id === governorateId) : cities),
    [cities, governorateId],
  );
  const filteredRegions = useMemo(
    () => (governorateId ? regions.filter((r) => r.governorate_id === governorateId) : regions),
    [regions, governorateId],
  );

  const filteredBranches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return branches.filter((b) => {
      if (statusFilter === 'active' && !b.is_active) return false;
      if (statusFilter === 'inactive' && b.is_active) return false;
      if (!q) return true;
      return b.name.toLowerCase().includes(q) || b.code.toLowerCase().includes(q);
    });
  }, [branches, searchQuery, statusFilter]);

  const openCreateForm = () => {
    setEditingBranch(null);
    setCode(generateNextCode('BR', branches.map((b) => b.code)));
    setName('');
    setIsMain(false);
    setIsActive(true);
    setCountryId(countries.find((c) => c.is_default)?.id ?? countries[0]?.id ?? '');
    setGovernorateId('');
    setCityId('');
    setRegionId('');
    setPhone('');
    setFax('');
    setAddressLine('');
    setFormError(null);
    setShowForm(true);
  };

  const openEditForm = (branch: BranchRecord) => {
    setEditingBranch(branch);
    setCode(branch.code);
    setName(branch.name);
    setIsMain(branch.is_main);
    setIsActive(branch.is_active);
    setCountryId(branch.country_id ?? '');
    setGovernorateId(branch.governorate_id ?? '');
    setCityId(branch.city_id ?? '');
    setRegionId(branch.region_id ?? '');
    setPhone(branch.phone ?? '');
    setFax(branch.fax ?? '');
    setAddressLine(branch.address_line ?? '');
    setFormError(null);
    setShowForm(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await saveBranch(tenant.id, {
        id: editingBranch?.id,
        code,
        name,
        is_main: isMain,
        is_active: isActive,
        country_id: countryId || null,
        governorate_id: governorateId || null,
        city_id: cityId || null,
        region_id: regionId || null,
        phone: phone || null,
        fax: fax || null,
        address_line: addressLine || null,
      });
      setShowForm(false);
      await loadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'تعذر حفظ الفرع.');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmArchive = async () => {
    if (!archiveTarget) return;
    setSaving(true);
    try {
      await archiveBranch(tenant.id, archiveTarget.id);
      setArchiveTarget(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر أرشفة الفرع.');
      setArchiveTarget(null);
    } finally {
      setSaving(false);
    }
  };

  const columns: readonly DataTableColumn<BranchRecord>[] = [
    {
      key: 'code',
      header: 'الكود',
      className: 'font-mono-tabular font-medium text-slate-900',
      render: (b) => b.code,
    },
    {
      key: 'name',
      header: 'اسم الفرع',
      render: (b) => (
        <div className="flex items-center gap-2 font-medium text-slate-900">
          <span>{b.name}</span>
          {b.is_main && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
              <Star className="h-3.5 w-3.5" />
              رئيسي
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'location',
      header: 'المحافظة / المنطقة',
      className: 'text-slate-600',
      render: (b) => {
        const gov = b.governorate_id ? govMap.get(b.governorate_id) : null;
        const reg = b.region_id ? regionMap.get(b.region_id) : null;
        return [gov, reg].filter(Boolean).join(' · ') || '—';
      },
    },
    {
      key: 'phone',
      header: 'الهاتف',
      className: 'font-mono-tabular text-xs text-slate-600',
      render: (b) => b.phone || '—',
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (b) => (
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium ${
            b.is_active ? 'text-emerald-700' : 'text-slate-500'
          }`}
        >
          {b.is_active ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
          {b.is_active ? 'فعال' : 'غير فعال'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'الإجراءات',
      render: (b) =>
        isAdmin ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => openEditForm(b)}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900"
            >
              <Edit3 className="h-3.5 w-3.5" />
              تعديل
            </button>
            {!b.is_main && (
              <button
                type="button"
                onClick={() => setArchiveTarget(b)}
                className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:text-red-900"
              >
                <Archive className="h-3.5 w-3.5" />
                أرشفة
              </button>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-400">عرض فقط</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-200 pb-4">
        <p className="text-xs font-medium text-slate-500">التعريفات الأساسية · الفروع</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">إدارة الفروع والمقرات</h1>
      </div>

      {!showForm && <FilterBar
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="ابحث باسم أو كود الفرع..."
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        primaryAction={
          isAdmin ? (
            <button
              type="button"
              onClick={openCreateForm}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              إضافة فرع جديد
            </button>
          ) : null
        }
      />}

      {showForm && (
        <section aria-label="نموذج بيانات الفرع" className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-base font-semibold text-slate-900">
              {editingBranch ? `تعديل الفرع: ${editingBranch.name}` : 'إضافة فرع جديد'}
            </h2>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              إلغاء
            </button>
          </div>

          <form onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="branch-name" className="block text-xs font-medium text-slate-700">
                اسم الفرع
              </label>
              <input
                id="branch-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="branch-code" className="block text-xs font-medium text-slate-700">
                كود الفرع
              </label>
              <input
                id="branch-code"
                type="text"
                required
                dir="ltr"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="branch-active" className="block text-xs font-medium text-slate-700">
                الحالة التشغيلية
              </label>
              <select
                id="branch-active"
                value={isActive ? '1' : '0'}
                disabled={isMain}
                onChange={(e) => setIsActive(e.target.value === '1')}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              >
                <option value="1">فعال</option>
                <option value="0">غير فعال</option>
              </select>
            </div>

            <div>
              <label htmlFor="branch-country" className="block text-xs font-medium text-slate-700">
                الدولة
              </label>
              <select
                id="branch-country"
                value={countryId}
                onChange={(e) => setCountryId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              >
                <option value="">اختر الدولة</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="branch-gov" className="block text-xs font-medium text-slate-700">
                المحافظة
              </label>
              <select
                id="branch-gov"
                value={governorateId}
                onChange={(e) => {
                  setGovernorateId(e.target.value);
                  setCityId('');
                  setRegionId('');
                }}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              >
                <option value="">اختر المحافظة</option>
                {governorates.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="branch-city" className="block text-xs font-medium text-slate-700">
                المدينة
              </label>
              <select
                id="branch-city"
                value={cityId}
                onChange={(e) => setCityId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              >
                <option value="">اختر المدينة</option>
                {filteredCities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="branch-region" className="block text-xs font-medium text-slate-700">
                المنطقة
              </label>
              <select
                id="branch-region"
                value={regionId}
                onChange={(e) => setRegionId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              >
                <option value="">اختر المنطقة</option>
                {filteredRegions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="branch-phone" className="block text-xs font-medium text-slate-700">
                رقم الهاتف
              </label>
              <input
                id="branch-phone"
                type="text"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="branch-fax" className="block text-xs font-medium text-slate-700">
                الفاكس
              </label>
              <input
                id="branch-fax"
                type="text"
                dir="ltr"
                value={fax}
                onChange={(e) => setFax(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="branch-address" className="block text-xs font-medium text-slate-700">
                العنوان التفصيلي
              </label>
              <input
                id="branch-address"
                type="text"
                value={addressLine}
                onChange={(e) => setAddressLine(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="branch-is-main" className="block text-xs font-medium text-slate-700">
                هل هو الفرع الرئيسي؟
              </label>
              <select
                id="branch-is-main"
                value={isMain ? '1' : '0'}
                onChange={(e) => setIsMain(e.target.value === '1')}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              >
                <option value="0">لا (فرع تشغيلي)</option>
                <option value="1">نعم (الفرع الرئيسي للشركة)</option>
              </select>
            </div>

            {formError && (
              <p role="alert" className="text-xs font-medium text-red-700 md:col-span-3">
                {formError}
              </p>
            )}

            <div className="flex justify-end gap-3 pt-2 md:col-span-3">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {saving ? 'جاري الحفظ...' : 'حفظ بيانات الفرع'}
              </button>
            </div>
          </form>
        </section>
      )}

      {!showForm && <DataTable
        columns={columns}
        rows={filteredBranches}
        rowKey={(b) => b.id}
        loading={loading}
        error={error}
        emptyMessage="لا توجد فروع مطابقة لمعايير البحث."
      />}

      <ConfirmDialog
        open={Boolean(archiveTarget)}
        title="أرشفة الفرع"
        description={`سيتم تعطيل الفرع «${archiveTarget?.name ?? ''}» وأرشفته مع الحفاظ على كافة السجلات التاريخية المرتبطة به.`}
        confirmLabel="أرشفة الفرع"
        busy={saving}
        onCancel={() => setArchiveTarget(null)}
        onConfirm={() => void handleConfirmArchive()}
      />
    </div>
  );
}
