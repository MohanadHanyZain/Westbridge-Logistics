import {LoadingState} from '@/components/ui/LoadingState';
import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {
  calculateCourierCommission,
  deleteCommissionRule,
  listCommissionLists,
  listCommissionRules,
  listCouriers,
  saveCommissionList,
  saveCommissionRule,
} from '@/features/couriers/couriersService';
import {generateNextCode, listGovernorates, listRegions} from '@/features/definitions/definitionsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {
  CommissionType,
  CourierCommissionCalculationResult,
  CourierCommissionListRecord,
  CourierCommissionRuleRecord,
  CourierRecord,
} from '@/types/couriers';
import type {GovernorateRecord, RegionRecord} from '@/types/definitions';
import {Calculator, Plus, ShieldCheck, Trash2} from 'lucide-react';

const COMMISSION_LABELS: Record<CommissionType, string> = {
  delivery_percent: 'نسبة من التوصيل (%)',
  delivery_plus_collection_percent: 'نسبة من التوصيل + التحصيل (%)',
  fixed_amount: 'مبلغ ثابت (ج.م)',
};

const TIER_LABELS: Record<CourierCommissionCalculationResult['match_tier'], string> = {
  region_rule: 'المستوى 1: قاعدة المنطقة المحددة',
  governorate_rule: 'المستوى 2: قاعدة المحافظة كاملة',
  courier_default: 'المستوى 3: الإعداد الافتراضي بملف المندوب',
};

export function CommissionListsPage() {
  const {tenant, isAdmin, can} = useTenantWorkspace();
  const canManage = isAdmin || can('couriers.manage');

  const [lists, setLists] = useState<readonly CourierCommissionListRecord[]>([]);
  const [selectedListId, setSelectedListId] = useState('');
  const [rules, setRules] = useState<readonly CourierCommissionRuleRecord[]>([]);
  const [couriers, setCouriers] = useState<readonly CourierRecord[]>([]);
  const [governorates, setGovernorates] = useState<readonly GovernorateRecord[]>([]);
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Create commission list
  const [showListForm, setShowListForm] = useState(false);
  const [listCode, setListCode] = useState('');
  const [listName, setListName] = useState('');
  const [listDesc, setListDesc] = useState('');

  // Add commission rule
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleGovId, setRuleGovId] = useState('');
  const [ruleRegionId, setRuleRegionId] = useState('');
  const [ruleType, setRuleType] = useState<CommissionType>('fixed_amount');
  const [ruleValue, setRuleValue] = useState(25);
  const [ruleActive, setRuleActive] = useState(true);

  // Commission preview simulator
  const [simCourierId, setSimCourierId] = useState('');
  const [simGovId, setSimGovId] = useState('');
  const [simRegionId, setSimRegionId] = useState('');
  const [simDeliveryFee, setSimDeliveryFee] = useState(70);
  const [simCollectionFee, setSimCollectionFee] = useState(15);
  const [simResult, setSimResult] = useState<CourierCommissionCalculationResult | null>(null);

  const loadRules = useCallback(
    async (listId: string) => {
      if (!listId) {
        setRules([]);
        return;
      }
      const rows = await listCommissionRules(tenant.id, listId);
      setRules(rows);
    },
    [tenant.id],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lRows, cRows, gRows, rRows] = await Promise.all([
        listCommissionLists(tenant.id),
        listCouriers(tenant.id),
        listGovernorates(tenant.id),
        listRegions(tenant.id),
      ]);
      setLists(lRows);
      setCouriers(cRows);
      setGovernorates(gRows);
      setRegions(rRows);

      setSelectedListId((current) =>
        current && lRows.some((list) => list.id === current) ? current : (lRows[0]?.id ?? ''),
      );
      setSimCourierId((current) => current || cRows[0]?.id || '');
      setSimGovId((current) => current || gRows[0]?.id || '');
      setRuleGovId((current) => current || gRows[0]?.id || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل قوائم العمولات.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    let active = true;
    setRules([]);
    if (selectedListId) {
      void listCommissionRules(tenant.id, selectedListId)
        .then((rows) => {
          if (active) setRules(rows);
        })
        .catch((err: unknown) => {
          if (active) setError(err instanceof Error ? err.message : 'تعذر تحميل بنود قائمة العمولات.');
        });
    }
    return () => {
      active = false;
    };
  }, [tenant.id, selectedListId]);

  const selectedList = useMemo(
    () => lists.find((l) => l.id === selectedListId) ?? null,
    [lists, selectedListId],
  );

  const govMap = useMemo(() => new Map(governorates.map((g) => [g.id, g.name])), [governorates]);
  const regMap = useMemo(() => new Map(regions.map((r) => [r.id, r.name])), [regions]);

  const ruleRegions = useMemo(
    () => regions.filter((r) => !ruleGovId || r.governorate_id === ruleGovId),
    [regions, ruleGovId],
  );

  const simRegions = useMemo(
    () => regions.filter((r) => !simGovId || r.governorate_id === simGovId),
    [regions, simGovId],
  );

  const handleOpenCreateList = () => {
    setListCode(
      generateNextCode(
        'COM',
        lists.map((l) => l.code),
      ),
    );
    setListName('');
    setListDesc('');
    setShowListForm(true);
    setFeedback(null);
    setError(null);
  };

  const handleCreateList = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const createdId = await saveCommissionList(tenant.id, {
        code: listCode,
        name: listName,
        description: listDesc || null,
        is_active: true,
      });
      setShowListForm(false);
      setSelectedListId(createdId);
      setFeedback('تم إنشاء قائمة العمولات بنجاح.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء قائمة العمولات.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddRule = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedListId || !ruleGovId) return;
    setSaving(true);
    setError(null);
    try {
      await saveCommissionRule(tenant.id, {
        commission_list_id: selectedListId,
        governorate_id: ruleGovId,
        region_id: ruleRegionId || null,
        commission_type: ruleType,
        commission_value: ruleValue,
        valid_from: null,
        valid_to: null,
        is_active: ruleActive,
        notes: null,
      });
      setShowRuleForm(false);
      setFeedback('تمت إضافة قاعدة العمولة بنجاح.');
      await loadRules(selectedListId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة قاعدة العمولة.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await deleteCommissionRule(tenant.id, ruleId);
      setFeedback('تم حذف قاعدة العمولة.');
      await loadRules(selectedListId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حذف قاعدة العمولة.');
    }
  };

  const handleSimulateCommission = async (e: FormEvent) => {
    e.preventDefault();
    if (!simCourierId || !simGovId) return;
    setError(null);
    try {
      const res = await calculateCourierCommission({
        tenantId: tenant.id,
        courierId: simCourierId,
        governorateId: simGovId,
        regionId: simRegionId || null,
        deliveryFee: simDeliveryFee,
        collectionFee: simCollectionFee,
      });
      setSimResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر معاينة عمولة المندوب.');
    }
  };

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-500"><LoadingState className="py-10" label="جارٍ تحميل قوائم عمولات المناديب" /></p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">قوائم عمولات المناديب</h1>
          <p className="mt-1 text-xs text-slate-500">
            تستحق العمولة عند إتمام التسليم، وتُطبّق حسب المنطقة ثم المحافظة ثم الإعداد الافتراضي للمندوب.
          </p>
        </div>

        {canManage && (
          <button
            type="button"
            onClick={handleOpenCreateList}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            إنشاء قائمة عمولات جديدة
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

      {showListForm && (
        <form onSubmit={handleCreateList} className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-4 items-end">
          <div>
            <label htmlFor="ccl-code" className="block text-xs font-medium text-slate-700">
              كود القائمة *
            </label>
            <input
              id="ccl-code"
              required
              dir="ltr"
              value={listCode}
              onChange={(e) => setListCode(e.target.value.toUpperCase())}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
            />
          </div>
          <div>
            <label htmlFor="ccl-name" className="block text-xs font-medium text-slate-700">
              اسم قائمة العمولات *
            </label>
            <input
              id="ccl-name"
              required
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              placeholder="عمولات مناديب القاهرة والجيزة"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label htmlFor="ccl-desc" className="block text-xs font-medium text-slate-700">
              الوصف
            </label>
            <input
              id="ccl-desc"
              value={listDesc}
              onChange={(e) => setListDesc(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white">
              حفظ القائمة
            </button>
            <button type="button" onClick={() => setShowListForm(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700">
              إلغاء
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <aside className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-4">
          <h2 className="border-b border-slate-100 pb-2 text-sm font-semibold text-slate-900">
            قوائم العمولات ({lists.length})
          </h2>
          <div className="space-y-1.5">
            {lists.map((item) => {
              const active = item.id === selectedListId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedListId(item.id)}
                  className={`flex w-full items-center justify-between rounded-lg border p-3 text-right text-xs transition-colors ${
                    active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div>
                    <p className="font-semibold">{item.name}</p>
                    <p className={`font-mono-tabular ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                      {item.code} {item.is_system_default ? '· افتراضية محمية' : ''}
                    </p>
                  </div>
                  {item.is_system_default && <ShieldCheck className="h-4 w-4 shrink-0 opacity-75" />}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                بنود جهات العمولة: {selectedList?.name ?? '—'}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                اترك المنطقة فارغة لتطبيق القاعدة على مستوى المحافظة بالكامل.
              </p>
            </div>
            {canManage && selectedList && (
              <button
                type="button"
                onClick={() => setShowRuleForm((prev) => !prev)}
                className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                إضافة جهة / قاعدة عمولة
              </button>
            )}
          </div>

          {showRuleForm && (
            <form onSubmit={handleAddRule} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-5 items-end">
              <div>
                <label htmlFor="ccr-gov" className="block text-xs font-medium text-slate-700">
                  المحافظة / الإقليم *
                </label>
                <select
                  id="ccr-gov"
                  required
                  value={ruleGovId}
                  onChange={(e) => {
                    setRuleGovId(e.target.value);
                    setRuleRegionId('');
                  }}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                >
                  {governorates.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ccr-reg" className="block text-xs font-medium text-slate-700">
                  المنطقة (اختياري)
                </label>
                <select
                  id="ccr-reg"
                  value={ruleRegionId}
                  onChange={(e) => setRuleRegionId(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="">كل مناطق المحافظة</option>
                  {ruleRegions.map((rg) => (
                    <option key={rg.id} value={rg.id}>
                      {rg.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ccr-type" className="block text-xs font-medium text-slate-700">
                  نوع العمولة *
                </label>
                <select
                  id="ccr-type"
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value as CommissionType)}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                >
                  <option value="delivery_percent">نسبة من التوصيل</option>
                  <option value="delivery_plus_collection_percent">نسبة من التوصيل + التحصيل</option>
                  <option value="fixed_amount">مبلغ ثابت</option>
                </select>
              </div>
              <div>
                <label htmlFor="ccr-val" className="block text-xs font-medium text-slate-700">
                  مقدار العمولة *
                </label>
                <input
                  id="ccr-val"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  dir="ltr"
                  value={ruleValue}
                  onChange={(e) => setRuleValue(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 font-mono-tabular text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-1 text-xs">
                  <input type="checkbox" checked={ruleActive} onChange={(e) => setRuleActive(e.target.checked)} />
                  <span>فعال</span>
                </label>
                <button type="submit" disabled={saving} className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">
                  حفظ البند
                </button>
              </div>
            </form>
          )}

          {rules.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-500">
              لا توجد قواعد مناطق مخصصة في هذه القائمة بعد — سيتم الرجوع للإعداد الافتراضي بملف المندوب.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">المحافظة</th>
                    <th className="px-4 py-2.5 font-semibold">المنطقة</th>
                    <th className="px-4 py-2.5 font-semibold">نوع العمولة</th>
                    <th className="px-4 py-2.5 font-semibold">المقدار</th>
                    <th className="px-4 py-2.5 font-semibold">الحالة</th>
                    <th className="px-4 py-2.5 font-semibold">حذف</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {rules.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{govMap.get(r.governorate_id) ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        {r.region_id ? regMap.get(r.region_id) ?? '—' : 'كل المناطق'}
                      </td>
                      <td className="px-4 py-2.5 text-slate-700">{COMMISSION_LABELS[r.commission_type]}</td>
                      <td className="px-4 py-2.5 font-mono-tabular font-semibold text-slate-900">
                        {Number(r.commission_value).toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={r.is_active ? 'text-emerald-700' : 'text-red-700'}>
                          {r.is_active ? 'فعال' : 'موقوف'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteRule(r.id)}
                            className="rounded border border-red-200 p-1 text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {/* Commission calculator preview */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
          <Calculator className="h-4 w-4 text-slate-700" />
          <h2 className="text-sm font-semibold text-slate-900">معاينة احتساب عمولة المندوب</h2>
        </div>

        <form onSubmit={handleSimulateCommission} className="grid grid-cols-1 gap-4 sm:grid-cols-6 items-end">
          <div>
            <label htmlFor="sim-courier" className="block text-xs font-medium text-slate-700">
              المندوب *
            </label>
            <select
              id="sim-courier"
              value={simCourierId}
              onChange={(e) => setSimCourierId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              {couriers.length === 0 ? (
                <option value="">أضف مندوبًا أولًا للمعاينة</option>
              ) : (
                couriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label htmlFor="sim-gov" className="block text-xs font-medium text-slate-700">
              محافظة التسليم *
            </label>
            <select
              id="sim-gov"
              value={simGovId}
              onChange={(e) => {
                setSimGovId(e.target.value);
                setSimRegionId('');
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              {governorates.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sim-reg" className="block text-xs font-medium text-slate-700">
              منطقة التسليم
            </label>
            <select
              id="sim-reg"
              value={simRegionId}
              onChange={(e) => setSimRegionId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <option value="">غير محددة / المحافظة</option>
              {simRegions.map((rg) => (
                <option key={rg.id} value={rg.id}>
                  {rg.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sim-del-fee" className="block text-xs font-medium text-slate-700">
              رسوم التوصيل (ج.م)
            </label>
            <input
              id="sim-del-fee"
              type="number"
              step="0.01"
              min="0"
              dir="ltr"
              value={simDeliveryFee}
              onChange={(e) => setSimDeliveryFee(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
            />
          </div>
          <div>
            <label htmlFor="sim-col-fee" className="block text-xs font-medium text-slate-700">
              عمولة التحصيل (ج.م)
            </label>
            <input
              id="sim-col-fee"
              type="number"
              step="0.01"
              min="0"
              dir="ltr"
              value={simCollectionFee}
              onChange={(e) => setSimCollectionFee(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={!simCourierId}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            احتساب العمولة من الخادم
          </button>
        </form>

        {simResult && (
          <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-4 text-xs">
            <div>
              <p className="text-slate-500">أولوية التطابق المطبقة</p>
              <p className="mt-1 font-semibold text-slate-900">{TIER_LABELS[simResult.match_tier]}</p>
            </div>
            <div>
              <p className="text-slate-500">توقيت الاستحقاق</p>
              <p className="mt-1 font-semibold text-slate-900">عند نجاح التسليم (مفصولة عن النقدية)</p>
            </div>
            <div>
              <p className="text-slate-500">القاعدة المحتسبة</p>
              <p className="mt-1 font-semibold text-slate-900">
                {COMMISSION_LABELS[simResult.commission_type]} ({Number(simResult.commission_value).toFixed(2)})
              </p>
            </div>
            <div>
              <p className="text-slate-500">صافي عمولة المندوب المستحقة</p>
              <p className="mt-1 font-mono-tabular text-base font-bold text-emerald-700">
                {Number(simResult.commission_amount).toFixed(2)} ج.م
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
