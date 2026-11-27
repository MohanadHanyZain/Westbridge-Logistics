import {LoadingState} from '@/components/ui/LoadingState';
import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {
  generateNextCode,
  listBranches,
  listCities,
  listCountries,
  listGovernorates,
  listRegions,
  saveCity,
  saveGovernorate,
  saveRegion,
} from '@/features/definitions/definitionsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {
  BranchRecord,
  CityRecord,
  CountryRecord,
  GovernorateRecord,
  RegionRecord,
} from '@/types/definitions';
import {CheckCircle2, Edit3, MapPin, Plus, Search, XCircle} from 'lucide-react';
import {translateUi, useLocale} from '@/lib/i18n';

export function GeographyPage() {
  const {tenant, isAdmin} = useTenantWorkspace();
  const locale = useLocale();
  const t = (text: string) => translateUi(text, locale);
  const [countries, setCountries] = useState<readonly CountryRecord[]>([]);
  const [governorates, setGovernorates] = useState<readonly GovernorateRecord[]>([]);
  const [cities, setCities] = useState<readonly CityRecord[]>([]);
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);

  const [selectedGovId, setSelectedGovId] = useState<string>('');
  const [showGovernorateList, setShowGovernorateList] = useState(true);
  const [govSearch, setGovSearch] = useState('');
  const [regionSearch, setRegionSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Governorate inline editor
  const [showGovForm, setShowGovForm] = useState(false);
  const [editingGov, setEditingGov] = useState<GovernorateRecord | null>(null);
  const [govCode, setGovCode] = useState('');
  const [govName, setGovName] = useState('');
  const [govBranchId, setGovBranchId] = useState('');
  const [govActive, setGovActive] = useState(true);

  // Region inline editor
  const [showRegionForm, setShowRegionForm] = useState(false);
  const [editingRegion, setEditingRegion] = useState<RegionRecord | null>(null);
  const [regCode, setRegCode] = useState('');
  const [regName, setRegName] = useState('');
  const [regCityId, setRegCityId] = useState('');
  const [regBranchId, setRegBranchId] = useState('');
  const [regActive, setRegActive] = useState(true);

  // Quick add City
  const [newCityName, setNewCityName] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cData, gData, ciData, rData, bData] = await Promise.all([
        listCountries(tenant.id),
        listGovernorates(tenant.id),
        listCities(tenant.id),
        listRegions(tenant.id),
        listBranches(tenant.id),
      ]);
      setCountries(cData);
      setGovernorates(gData);
      setCities(ciData);
      setRegions(rData);
      setBranches(bData);
      setSelectedGovId((prev) => (prev && gData.some((g) => g.id === prev) ? prev : gData[0]?.id ?? ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل البيانات الجغرافية.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const selectedGov = useMemo(
    () => governorates.find((g) => g.id === selectedGovId) ?? null,
    [governorates, selectedGovId],
  );

  const filteredGovernorates = useMemo(() => {
    const q = govSearch.trim().toLowerCase();
    if (!q) return governorates;
    return governorates.filter(
      (g) => g.name.toLowerCase().includes(q) || g.code.toLowerCase().includes(q),
    );
  }, [governorates, govSearch]);

  const govCities = useMemo(
    () => cities.filter((c) => c.governorate_id === selectedGovId),
    [cities, selectedGovId],
  );

  const govRegions = useMemo(() => {
    const q = regionSearch.trim().toLowerCase();
    return regions.filter((r) => {
      if (r.governorate_id !== selectedGovId) return false;
      if (!q) return true;
      return r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q);
    });
  }, [regions, selectedGovId, regionSearch]);

  const openCreateGov = () => {
    setEditingGov(null);
    setGovCode(generateNextCode('EG', governorates.map((g) => g.code)));
    setGovName('');
    setGovBranchId(branches.find((b) => b.is_main)?.id ?? branches[0]?.id ?? '');
    setGovActive(true);
    setShowGovForm(true);
  };

  const openEditGov = (gov: GovernorateRecord) => {
    setEditingGov(gov);
    setGovCode(gov.code);
    setGovName(gov.name);
    setGovBranchId(gov.default_branch_id ?? '');
    setGovActive(gov.is_active);
    setShowGovForm(true);
  };

  const handleSaveGov = async (e: FormEvent) => {
    e.preventDefault();
    const defaultCountryId = editingGov?.country_id ?? countries.find((c) => c.is_default)?.id ?? countries[0]?.id;
    if (!defaultCountryId) return;
    setSaving(true);
    setError(null);
    try {
      await saveGovernorate(tenant.id, {
        id: editingGov?.id,
        country_id: defaultCountryId,
        code: govCode,
        name: govName,
        default_branch_id: govBranchId || null,
        is_active: govActive,
      });
      setShowGovForm(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ المحافظة.');
    } finally {
      setSaving(false);
    }
  };

  const openCreateRegion = () => {
    if (!selectedGov) return;
    setEditingRegion(null);
    setRegCode(generateNextCode(`${selectedGov.code}-R`, regions.map((r) => r.code)));
    setRegName('');
    setRegCityId(govCities[0]?.id ?? '');
    setRegBranchId(selectedGov.default_branch_id ?? branches.find((b) => b.is_main)?.id ?? '');
    setRegActive(true);
    setShowRegionForm(true);
  };

  const openEditRegion = (reg: RegionRecord) => {
    setEditingRegion(reg);
    setRegCode(reg.code);
    setRegName(reg.name);
    setRegCityId(reg.city_id ?? '');
    setRegBranchId(reg.default_branch_id ?? '');
    setRegActive(reg.is_active);
    setShowRegionForm(true);
  };

  const handleSaveRegion = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedGov) return;
    setSaving(true);
    setError(null);
    try {
      await saveRegion(tenant.id, {
        id: editingRegion?.id,
        governorate_id: selectedGov.id,
        city_id: regCityId || null,
        code: regCode,
        name: regName,
        default_branch_id: regBranchId || null,
        is_active: regActive,
      });
      setShowRegionForm(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ المنطقة.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleRegionActive = async (reg: RegionRecord) => {
    if (!isAdmin) return;
    try {
      await saveRegion(tenant.id, {
        id: reg.id,
        governorate_id: reg.governorate_id,
        city_id: reg.city_id,
        code: reg.code,
        name: reg.name,
        default_branch_id: reg.default_branch_id,
        is_active: !reg.is_active,
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تغيير حالة المنطقة.');
    }
  };

  const handleQuickAddCity = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedGov || !newCityName.trim()) return;
    setSaving(true);
    try {
      await saveCity(tenant.id, {
        governorate_id: selectedGov.id,
        code: generateNextCode(`${selectedGov.code}-C`, cities.map((c) => c.code)),
        name: newCityName.trim(),
        is_active: true,
      });
      setNewCityName('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة المدينة.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-medium text-slate-500">{t('التعريفات الأساسية')} · {t('الأقاليم والجغرافيا')}</p>
          <h1 className="mt-1 text-xl font-bold text-slate-900">{t('المحافظات والمدن والمناطق')}</h1>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={openCreateGov}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('إضافة محافظة')}
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {showGovForm && (
        <div role="dialog" aria-modal="true" aria-labelledby="gov-form-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
        <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
          <h2 id="gov-form-title" className="text-sm font-semibold text-slate-900">
            {editingGov ? `${t('تعديل محافظة')}: ${editingGov.name}` : t('إضافة محافظة جديدة')}
          </h2>
          <form onSubmit={handleSaveGov} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label htmlFor="gov-code" className="block text-xs font-medium text-slate-700">{t('الكود')}</label>
              <input
                id="gov-code"
                type="text"
                required
                dir="ltr"
                value={govCode}
                onChange={(e) => setGovCode(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
              />
            </div>
            <div>
              <label htmlFor="gov-name" className="block text-xs font-medium text-slate-700">{t('اسم المحافظة')}</label>
              <input
                id="gov-name"
                type="text"
                required
                value={govName}
                onChange={(e) => setGovName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor="gov-branch" className="block text-xs font-medium text-slate-700">{t('الفرع الافتراضي')}</label>
              <select
                id="gov-branch"
                value={govBranchId}
                onChange={(e) => setGovBranchId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">{t('بدون فرع محدد')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="gov-active" className="block text-xs font-medium text-slate-700">{t('الحالة')}</label>
              <select
                id="gov-active"
                value={govActive ? '1' : '0'}
                onChange={(e) => setGovActive(e.target.value === '1')}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="1">{t('فعال')}</option>
                <option value="0">{t('غير فعال')}</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 md:col-span-4">
              <button
                type="button"
                onClick={() => setShowGovForm(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
              >
                {t('إلغاء')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
              >
                {t('حفظ المحافظة')}
              </button>
            </div>
          </form>
        </section>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {/* Master List: Governorates */}
        {showGovernorateList && <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
            <input
              type="search"
              value={govSearch}
              onChange={(e) => setGovSearch(e.target.value)}
              placeholder={`${t('ابحث في المحافظات')}...`}
              aria-label={t('بحث في المحافظات')}
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm focus:border-slate-400 focus:outline-none"
            />
          </div>

          <div className="max-h-[34rem] overflow-y-auto rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {loading ? (
              <p className="p-4 text-center text-xs text-slate-500"><LoadingState label={t('جارٍ التحميل')} /></p>
            ) : filteredGovernorates.length === 0 ? (
              <p className="p-4 text-center text-xs text-slate-500">{t('لا توجد محافظات مطابقة.')}</p>
            ) : (
              filteredGovernorates.map((gov) => {
                const selected = gov.id === selectedGovId;
                return (
                  <button
                    key={gov.id}
                    type="button"
                    onClick={() => {
                      setSelectedGovId(gov.id);
                      setShowGovernorateList(false);
                    }}
                    className={`flex w-full items-center justify-between px-4 py-3 text-right transition-colors ${
                      selected ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 text-slate-900'
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium">{gov.name}</p>
                      <p className={`mt-0.5 font-mono-tabular text-xs ${selected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {gov.code} · {gov.default_branch_id ? branchMap.get(gov.default_branch_id) : t('بدون فرع')}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-medium ${
                        gov.is_active
                          ? selected
                            ? 'text-emerald-300'
                            : 'text-emerald-700'
                          : selected
                            ? 'text-slate-400'
                            : 'text-slate-400'
                      }`}
                    >
                      {t(gov.is_active ? 'فعال' : 'معطل')}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>}

        {/* Detail Panel: Selected Governorate + Regions */}
        {!showGovernorateList && <div className="space-y-4">
          {selectedGov ? (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <button
                  type="button"
                  onClick={() => setShowGovernorateList(true)}
                  className="mb-4 inline-flex items-center gap-2 rounded-lg px-2 py-1 text-xs font-bold text-slate-600 hover:bg-orange-50 hover:text-[#d95537]"
                >
                  <span aria-hidden="true">←</span>
                  {t('رجوع إلى المحافظات')}
                </button>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-slate-500" />
                      <h2 className="text-base font-bold text-slate-900">
                        {t('محافظة')} {selectedGov.name}
                      </h2>
                      <span className="font-mono-tabular text-xs text-slate-500">({selectedGov.code})</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      {t('الفرع الافتراضي')}: {selectedGov.default_branch_id ? branchMap.get(selectedGov.default_branch_id) : t('غير محدد')} ·
                      {t('عدد المدن')}: <span className="font-mono-tabular">{govCities.length}</span> ·
                      {t('عدد المناطق')}: <span className="font-mono-tabular">{govRegions.length}</span>
                    </p>
                  </div>

                  {isAdmin && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditGov(selectedGov)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        {t('تعديل المحافظة')}
                      </button>
                      <button
                        type="button"
                        onClick={openCreateRegion}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        {t('إضافة منطقة')}
                      </button>
                    </div>
                  )}
                </div>

                {isAdmin && (
                  <form onSubmit={handleQuickAddCity} className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                    <input
                      type="text"
                      value={newCityName}
                      onChange={(e) => setNewCityName(e.target.value)}
                      placeholder={t('أضف مدينة داخل المحافظة')}
                      aria-label={t('اسم المدينة الجديدة')}
                      className="w-60 rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-slate-400 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={saving || !newCityName.trim()}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                    >
                      + {t('إضافة مدينة')}
                    </button>
                  </form>
                )}
              </div>

              {showRegionForm && (
                <div role="dialog" aria-modal="true" aria-labelledby="region-form-title" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
                <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
                  <h3 id="region-form-title" className="text-sm font-semibold text-slate-900">
                    {editingRegion
                      ? `${t('تعديل منطقة')}: ${editingRegion.name}`
                      : `${t('إضافة منطقة داخل')} ${selectedGov.name}`}
                  </h3>
                  <form onSubmit={handleSaveRegion} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div>
                      <label htmlFor="reg-code" className="block text-xs font-medium text-slate-700">{t('كود المنطقة')}</label>
                      <input
                        id="reg-code"
                        type="text"
                        required
                        dir="ltr"
                        value={regCode}
                        onChange={(e) => setRegCode(e.target.value.toUpperCase())}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="reg-name" className="block text-xs font-medium text-slate-700">{t('اسم المنطقة')}</label>
                      <input
                        id="reg-name"
                        type="text"
                        required
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label htmlFor="reg-city" className="block text-xs font-medium text-slate-700">{t('المدينة')}</label>
                      <select
                        id="reg-city"
                        value={regCityId}
                        onChange={(e) => setRegCityId(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="">{t('غير محددة')}</option>
                        {govCities.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="reg-branch" className="block text-xs font-medium text-slate-700">{t('الفرع المختص')}</label>
                      <select
                        id="reg-branch"
                        value={regBranchId}
                        onChange={(e) => setRegBranchId(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="">{t('نفس فرع المحافظة')}</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="reg-active" className="block text-xs font-medium text-slate-700">{t('الحالة')}</label>
                      <select
                        id="reg-active"
                        value={regActive ? '1' : '0'}
                        onChange={(e) => setRegActive(e.target.value === '1')}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="1">{t('فعال')}</option>
                        <option value="0">{t('غير فعال')}</option>
                      </select>
                    </div>
                    <div className="flex items-end justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowRegionForm(false)}
                        className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
                      >
                        {t('إلغاء')}
                      </button>
                      <button
                        type="submit"
                        disabled={saving}
                        className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
                      >
                        {t('حفظ المنطقة')}
                      </button>
                    </div>
                  </form>
                </section>
                </div>
              )}

              <div className="space-y-3">
                <div className="relative max-w-sm">
                  <Search className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
                  <input
                    type="search"
                    value={regionSearch}
                    onChange={(e) => setRegionSearch(e.target.value)}
                    placeholder={`${t('بحث')} ${t('داخل مناطق المحافظة')}...`}
                    aria-label={`${t('بحث')} ${t('داخل مناطق المحافظة')}`}
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm focus:border-slate-400 focus:outline-none"
                  />
                </div>

                <div className="safe-mobile-table overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <table className="w-full border-collapse text-right text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <th className="px-4 py-3">{t('الكود')}</th>
                        <th className="px-4 py-3">{t('المنطقة')}</th>
                        <th className="px-4 py-3">{t('الفرع')}</th>
                        <th className="px-4 py-3">{t('الحالة')}</th>
                        <th className="px-4 py-3">{t('الإجراءات')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {govRegions.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                            {t('لا توجد مناطق مسجلة مطابقة في هذه المحافظة.')}
                          </td>
                        </tr>
                      ) : (
                        govRegions.map((reg) => (
                          <tr key={reg.id} className="hover:bg-slate-50/70">
                            <td data-label="الكود" className="px-4 py-3 font-mono-tabular text-xs font-medium text-slate-900">
                              {reg.code}
                            </td>
                            <td data-label="المنطقة" className="px-4 py-3 font-medium text-slate-900">{reg.name}</td>
                            <td data-label="الفرع" className="px-4 py-3 text-xs text-slate-600">
                              {reg.default_branch_id ? branchMap.get(reg.default_branch_id) : '—'}
                            </td>
                            <td data-label="الحالة" className="px-4 py-3">
                              <span
                                className={`inline-flex items-center gap-1 text-xs font-medium ${
                                  reg.is_active ? 'text-emerald-700' : 'text-slate-500'
                                }`}
                              >
                                {reg.is_active ? (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                ) : (
                                  <XCircle className="h-3.5 w-3.5" />
                                )}
                                {t(reg.is_active ? 'فعال' : 'غير فعال')}
                              </span>
                            </td>
                            <td data-label="الإجراءات" className="px-4 py-3">
                              {isAdmin && (
                                <div className="flex items-center gap-3">
                                  <button
                                    type="button"
                                    onClick={() => openEditRegion(reg)}
                                    className="text-xs font-medium text-slate-700 hover:text-slate-900"
                                  >
                                    {t('تعديل')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleToggleRegionActive(reg)}
                                    className="text-xs font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900"
                                  >
                                    {t(reg.is_active ? 'تعطيل' : 'تفعيل')}
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              {t('اختر محافظة من القائمة لعرض المدن والمناطق التابعة لها.')}
            </div>
          )}
        </div>}
      </div>
    </div>
  );
}
