import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link, useParams} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {
  listGovernorates,
  listRegions,
  listShippingServices,
} from '@/features/definitions/definitionsService';
import {
  deleteDeliveryPriceRule,
  deletePickupPriceRule,
  deletePriceSurcharge,
  listClientPriceLists,
  listDeliveryPriceRules,
  listPickupPriceRules,
  listPriceListVersions,
  listPriceSurcharges,
  saveDeliveryPriceRule,
  savePickupPriceRule,
  savePriceSurcharge,
  updatePriceListVersionSettings,
} from '@/features/pricing/pricingService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {GovernorateRecord, RegionRecord, ShippingServiceRecord} from '@/types/definitions';
import type {
  ClientPriceListRecord,
  DeliveryPriceRuleRecord,
  PickupPriceRuleRecord,
  PriceListVersionRecord,
  PriceSurchargeRecord,
  SurchargeType,
  WeightRoundingRule,
} from '@/types/pricing';
import {ArrowRight, Plus, Trash2} from 'lucide-react';

export function PriceListDetailPage() {
  const {priceListId = ''} = useParams();
  const {tenant, isAdmin} = useTenantWorkspace();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const [priceList, setPriceList] = useState<ClientPriceListRecord | null>(null);
  const [versions, setVersions] = useState<readonly PriceListVersionRecord[]>([]);
  const [activeVersion, setActiveVersion] = useState<PriceListVersionRecord | null>(null);
  const [pickupRules, setPickupRules] = useState<readonly PickupPriceRuleRecord[]>([]);
  const [selectedPickupId, setSelectedPickupId] = useState<string>('');
  const [deliveryRules, setDeliveryRules] = useState<readonly DeliveryPriceRuleRecord[]>([]);
  const [surcharges, setSurcharges] = useState<readonly PriceSurchargeRecord[]>([]);

  const [services, setServices] = useState<readonly ShippingServiceRecord[]>([]);
  const [governorates, setGovernorates] = useState<readonly GovernorateRecord[]>([]);
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Version settings form
  const [volDivisor, setVolDivisor] = useState(5000);
  const [roundingRule, setRoundingRule] = useState<WeightRoundingRule>('ceil_1kg');
  const [versionLabel, setVersionLabel] = useState('');

  // Add Pickup Rule form
  const [pickupSrvId, setPickupSrvId] = useState('');
  const [pickupGovId, setPickupGovId] = useState('');
  const [pickupRegId, setPickupRegId] = useState('');

  // Add Delivery Rule form
  const [delGovId, setDelGovId] = useState('');
  const [delRegId, setDelRegId] = useState('');
  const [baseWeight, setBaseWeight] = useState(1);
  const [baseFee, setBaseFee] = useState(55);
  const [extraStepWeight, setExtraStepWeight] = useState(1);
  const [extraWeightFee, setExtraWeightFee] = useState(10);
  const [returnFee, setReturnFee] = useState(35);
  const [collThreshold, setCollThreshold] = useState(3000);
  const [collBaseFee, setCollBaseFee] = useState(0);
  const [collExtraStep, setCollExtraStep] = useState(1000);
  const [collExtraFee, setCollExtraFee] = useState(10);

  // Surcharge form
  const [surCode, setSurCode] = useState('SUR-01');
  const [surName, setSurName] = useState('');
  const [surType, setSurType] = useState<SurchargeType>('fixed');
  const [surAmount, setSurAmount] = useState(0);

  const loadDeliveryForPickup = useCallback(
    async (pickupId: string) => {
      if (!pickupId) {
        setDeliveryRules([]);
        return;
      }
      try {
        const dRows = await listDeliveryPriceRules(tenant.id, pickupId);
        setDeliveryRules(dRows);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'تعذر تحميل قواعد التسليم.');
      }
    },
    [tenant.id],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [allLists, vers, srvRows, govRows, regRows] = await Promise.all([
        listClientPriceLists(tenant.id),
        listPriceListVersions(tenant.id, priceListId),
        listShippingServices(tenant.id),
        listGovernorates(tenant.id),
        listRegions(tenant.id),
      ]);

      const foundList = allLists.find((l) => l.id === priceListId) ?? null;
      const activeVer = vers.find((v) => v.is_active) ?? vers[0] ?? null;

      setPriceList(foundList);
      setVersions(vers);
      setActiveVersion(activeVer);
      setServices(srvRows);
      setGovernorates(govRows);
      setRegions(regRows);

      if (srvRows[0] && !pickupSrvId) setPickupSrvId(srvRows[0].id);
      if (govRows[0] && !pickupGovId) setPickupGovId(govRows[0].id);
      if (govRows[0] && !delGovId) setDelGovId(govRows[0].id);

      if (activeVer) {
        setVolDivisor(activeVer.volumetric_divisor);
        setRoundingRule(activeVer.weight_rounding_rule);
        setVersionLabel(activeVer.label);

        const [pRows, sRows] = await Promise.all([
          listPickupPriceRules(tenant.id, activeVer.id),
          listPriceSurcharges(tenant.id, activeVer.id),
        ]);
        setPickupRules(pRows);
        setSurcharges(sRows);

        const targetPickup =
          pRows.find((p) => p.id === selectedPickupId)?.id ?? pRows[0]?.id ?? '';
        setSelectedPickupId(targetPickup);
        await loadDeliveryForPickup(targetPickup);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل تفاصيل قائمة الأسعار.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id, priceListId, selectedPickupId, pickupSrvId, pickupGovId, delGovId, loadDeliveryForPickup]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const srvMap = useMemo(() => new Map(services.map((s) => [s.id, s.name])), [services]);
  const govMap = useMemo(() => new Map(governorates.map((g) => [g.id, g.name])), [governorates]);
  const regMap = useMemo(() => new Map(regions.map((r) => [r.id, r.name])), [regions]);

  const handleSaveVersionSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeVersion) return;
    try {
      await updatePriceListVersionSettings(tenant.id, activeVersion.id, {
        volumetric_divisor: volDivisor,
        weight_rounding_rule: roundingRule,
        label: versionLabel,
      });
      setFeedback('تم تحديث معامل الوزن الحجمي وسياسة التقريب لإصدار القائمة.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ إعدادات الإصدار.');
    }
  };

  const handleAddPickupRule = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeVersion) return;
    try {
      await savePickupPriceRule(tenant.id, {
        price_list_version_id: activeVersion.id,
        service_id: pickupSrvId,
        pickup_governorate_id: pickupGovId,
        pickup_region_id: pickupRegId || null,
        is_active: true,
        notes: null,
      });
      setFeedback('تمت إضافة قاعدة الالتقاط.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة قاعدة الالتقاط.');
    }
  };

  const handleAddDeliveryRule = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedPickupId) return;
    try {
      await saveDeliveryPriceRule(tenant.id, {
        pickup_rule_id: selectedPickupId,
        delivery_governorate_id: delGovId,
        delivery_region_id: delRegId || null,
        base_weight_kg: baseWeight,
        base_delivery_fee: baseFee,
        extra_weight_step_kg: extraStepWeight,
        extra_weight_fee: extraWeightFee,
        return_fee: returnFee,
        collection_threshold_amount: collThreshold,
        collection_fee_base: collBaseFee,
        collection_extra_step_amount: collExtraStep,
        collection_extra_fee: collExtraFee,
        is_active: true,
      });
      setFeedback('تم حفظ قاعدة التسليم المرتبطة بنجاح.');
      await loadDeliveryForPickup(selectedPickupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ قاعدة التسليم.');
    }
  };

  const handleAddSurcharge = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeVersion) return;
    try {
      await savePriceSurcharge(tenant.id, {
        price_list_version_id: activeVersion.id,
        service_id: null,
        code: surCode,
        name: surName,
        charge_type: surType,
        amount: surAmount,
      });
      setSurName('');
      setFeedback('تمت إضافة الرسم الإضافي.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة الرسم الإضافي.');
    }
  };

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-500">جاري تحميل مصفوفة الأسعار...</p>;
  }

  if (!priceList) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center">
        <p className="text-sm text-slate-700">قائمة الأسعار غير موجودة.</p>
        <Link to={`${basePath}/pricing/price-lists`} className="mt-2 inline-block text-xs underline">
          العودة لقوائم الأسعار
        </Link>
      </div>
    );
  }

  const selectedPickup = pickupRules.find((p) => p.id === selectedPickupId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link to={`${basePath}/pricing/price-lists`} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">
            <ArrowRight className="h-3.5 w-3.5" />
            العودة لقوائم الأسعار
          </Link>
          <h1 className="mt-1 text-xl font-bold text-slate-900">
            {priceList.name} · <span className="font-mono-tabular text-base text-slate-600">{priceList.code}</span>
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            الإصدار النشط: {activeVersion?.version_number ?? 1} · عدد الإصدارات: {versions.length}
          </p>
        </div>

        <Link
          to={`${basePath}/pricing/calculator`}
          className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
        >
          اختبار الحاسبة الخادمية
        </Link>
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

      {/* Version Volumetric & Rounding Settings */}
      {activeVersion && (
        <form onSubmit={handleSaveVersionSettings} className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-4 items-end">
          <div>
            <label htmlFor="ver-label" className="block text-xs font-medium text-slate-700">
              وصف الإصدار
            </label>
            <input
              id="ver-label"
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              disabled={!isAdmin}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
            />
          </div>
          <div>
            <label htmlFor="ver-div" className="block text-xs font-medium text-slate-700">
              معامل الوزن الحجمي (سم³/كجم)
            </label>
            <input
              id="ver-div"
              type="number"
              min={100}
              value={volDivisor}
              onChange={(e) => setVolDivisor(Number(e.target.value))}
              disabled={!isAdmin}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
            />
          </div>
          <div>
            <label htmlFor="ver-round" className="block text-xs font-medium text-slate-700">
              قاعدة تقريب الوزن المفوتر
            </label>
            <select
              id="ver-round"
              value={roundingRule}
              onChange={(e) => setRoundingRule(e.target.value as WeightRoundingRule)}
              disabled={!isAdmin}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <option value="ceil_1kg">أقرب 1 كجم للأعلى (CEIL)</option>
              <option value="ceil_half_kg">أقرب 0.5 كجم للأعلى</option>
              <option value="exact">دون تقريب (دقيق)</option>
            </select>
          </div>
          {isAdmin && (
            <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800">
              حفظ قواعد الوزن الحجمي
            </button>
          )}
        </form>
      )}

      {/* Master-Detail: Pickup Rules -> Delivery Rules */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Pickup Rules Pane */}
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-4">
          <h2 className="text-sm font-semibold text-slate-900">1. أماكن التقاط الطرود</h2>
          {isAdmin && (
            <form onSubmit={handleAddPickupRule} className="space-y-2.5 border-b border-slate-100 pb-4">
              <select
                aria-label="خدمة الشحن"
                value={pickupSrvId}
                onChange={(e) => setPickupSrvId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="محافظة الالتقاط"
                value={pickupGovId}
                onChange={(e) => {
                  setPickupGovId(e.target.value);
                  setPickupRegId('');
                }}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
              >
                {governorates.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="منطقة الالتقاط"
                value={pickupRegId}
                onChange={(e) => setPickupRegId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
              >
                <option value="">كل مناطق المحافظة (قاعدة عامة)</option>
                {regions.filter((r) => r.governorate_id === pickupGovId).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-slate-900 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                <Plus className="h-3.5 w-3.5" />
                إضافة مكان التقاط
              </button>
            </form>
          )}

          <div className="space-y-1.5">
            {pickupRules.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">أضف مكان التقاط لبدء ربط وجهات التسليم.</p>
            ) : (
              pickupRules.map((p) => {
                const active = p.id === selectedPickupId;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between rounded-lg border p-3 text-xs transition-colors ${
                      active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPickupId(p.id);
                        void loadDeliveryForPickup(p.id);
                      }}
                      className="flex-1 text-right"
                    >
                      <p className="font-semibold">{srvMap.get(p.service_id) ?? 'خدمة'}</p>
                      <p className={active ? 'text-slate-300' : 'text-slate-500'}>
                        {govMap.get(p.pickup_governorate_id) ?? '—'} ·{' '}
                        {p.pickup_region_id ? regMap.get(p.pickup_region_id) : 'كامل المحافظة'}
                      </p>
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => void deletePickupPriceRule(tenant.id, p.id).then(loadData)}
                        className={`rounded p-1 ${active ? 'text-slate-300 hover:text-white' : 'text-red-600 hover:bg-red-50'}`}
                        title="حذف قاعدة الالتقاط"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Linked Delivery Rules Pane */}
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-8">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-sm font-semibold text-slate-900">2. أماكن تسليم الطرود المرتبطة بالالتقاط المحدد</h2>
            {selectedPickup ? (
              <p className="mt-0.5 text-xs text-slate-500">
                الخدمة: {srvMap.get(selectedPickup.service_id)} · الالتقاط من:{' '}
                {govMap.get(selectedPickup.pickup_governorate_id)}{' '}
                {selectedPickup.pickup_region_id ? `(${regMap.get(selectedPickup.pickup_region_id)})` : '(كامل المحافظة)'}
              </p>
            ) : (
              <p className="mt-0.5 text-xs text-slate-500">اختر نقطة التقاط من القائمة الجانبية.</p>
            )}
          </div>

          {selectedPickup && isAdmin && (
            <form onSubmit={handleAddDeliveryRule} className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-5">
              <div>
                <label className="block text-[11px] font-medium text-slate-600">محافظة التسليم</label>
                <select
                  value={delGovId}
                  onChange={(e) => {
                    setDelGovId(e.target.value);
                    setDelRegId('');
                  }}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs"
                >
                  {governorates.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">منطقة التسليم</label>
                <select
                  value={delRegId}
                  onChange={(e) => setDelRegId(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 text-xs"
                >
                  <option value="">كامل المحافظة</option>
                  {regions.filter((r) => r.governorate_id === delGovId).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">حتى وزن (كجم)</label>
                <input
                  type="number"
                  step="0.5"
                  min={0.5}
                  value={baseWeight}
                  onChange={(e) => setBaseWeight(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 font-mono-tabular text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">سعر التوصيل</label>
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  value={baseFee}
                  onChange={(e) => setBaseFee(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 font-mono-tabular text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">رسوم الإرجاع</label>
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  value={returnFee}
                  onChange={(e) => setReturnFee(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 font-mono-tabular text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">الوزن الإضافي (كجم)</label>
                <input
                  type="number"
                  step="0.5"
                  min={0.5}
                  value={extraStepWeight}
                  onChange={(e) => setExtraStepWeight(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 font-mono-tabular text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">سعر الوزن الإضافي</label>
                <input
                  type="number"
                  step="0.5"
                  min={0}
                  value={extraWeightFee}
                  onChange={(e) => setExtraWeightFee(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-slate-200 bg-white px-2 py-1.5 font-mono-tabular text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">عمولة التحصيل / حتى مبلغ</label>
                <div className="mt-1 flex gap-1">
                  <input
                    type="number"
                    min={0}
                    value={collBaseFee}
                    onChange={(e) => setCollBaseFee(Number(e.target.value))}
                    title="عمولة التحصيل الأساسية"
                    className="w-1/2 rounded border border-slate-200 bg-white px-1.5 py-1.5 font-mono-tabular text-xs"
                  />
                  <input
                    type="number"
                    min={0}
                    value={collThreshold}
                    onChange={(e) => setCollThreshold(Number(e.target.value))}
                    title="حتى مبلغ"
                    className="w-1/2 rounded border border-slate-200 bg-white px-1.5 py-1.5 font-mono-tabular text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-600">المبلغ / العمولة الإضافية</label>
                <div className="mt-1 flex gap-1">
                  <input
                    type="number"
                    min={1}
                    value={collExtraStep}
                    onChange={(e) => setCollExtraStep(Number(e.target.value))}
                    title="لكل مبلغ إضافي"
                    className="w-1/2 rounded border border-slate-200 bg-white px-1.5 py-1.5 font-mono-tabular text-xs"
                  />
                  <input
                    type="number"
                    min={0}
                    value={collExtraFee}
                    onChange={(e) => setCollExtraFee(Number(e.target.value))}
                    title="العمولة الإضافية"
                    className="w-1/2 rounded border border-slate-200 bg-white px-1.5 py-1.5 font-mono-tabular text-xs"
                  />
                </div>
              </div>
              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full rounded-lg bg-slate-900 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                >
                  إضافة وجهة
                </button>
              </div>
            </form>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                  <th className="px-3 py-2 font-medium">الوجهة</th>
                  <th className="px-3 py-2 font-medium">حتى وزن</th>
                  <th className="px-3 py-2 font-medium">التوصيل</th>
                  <th className="px-3 py-2 font-medium">الوزن الإضافي</th>
                  <th className="px-3 py-2 font-medium">الإرجاع</th>
                  <th className="px-3 py-2 font-medium">عمولة التحصيل</th>
                  <th className="px-3 py-2 font-medium">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deliveryRules.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      لا توجد قواعد تسليم مرتبطة بهذه النقطة بعد.
                    </td>
                  </tr>
                ) : (
                  deliveryRules.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-medium text-slate-900">
                        {govMap.get(d.delivery_governorate_id)} ·{' '}
                        {d.delivery_region_id ? regMap.get(d.delivery_region_id) : 'كامل المحافظة'}
                      </td>
                      <td className="px-3 py-2.5 font-mono-tabular">{d.base_weight_kg} كجم</td>
                      <td className="px-3 py-2.5 font-mono-tabular font-semibold">{d.base_delivery_fee}</td>
                      <td className="px-3 py-2.5 font-mono-tabular">
                        +{d.extra_weight_fee} / {d.extra_weight_step_kg} كجم
                      </td>
                      <td className="px-3 py-2.5 font-mono-tabular">{d.return_fee}</td>
                      <td className="px-3 py-2.5 font-mono-tabular">
                        {d.collection_fee_base} (فوق {d.collection_threshold_amount}: +{d.collection_extra_fee} لكل{' '}
                        {d.collection_extra_step_amount})
                      </td>
                      <td className="px-3 py-2.5">
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => void deleteDeliveryPriceRule(tenant.id, d.id).then(() => loadDeliveryForPickup(selectedPickupId))}
                            className="text-red-600 hover:underline"
                          >
                            حذف
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Version Surcharges */}
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">الرسوم الإضافية على إصدار القائمة (Surcharges)</h2>
        {isAdmin && (
          <form onSubmit={handleAddSurcharge} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
            <input
              required
              dir="ltr"
              value={surCode}
              onChange={(e) => setSurCode(e.target.value.toUpperCase())}
              placeholder="الكود"
              className="rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
            />
            <input
              required
              value={surName}
              onChange={(e) => setSurName(e.target.value)}
              placeholder="اسم الرسم الإضافي (مثلاً تغليف خاص)"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
            />
            <select
              value={surType}
              onChange={(e) => setSurType(e.target.value as SurchargeType)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
            >
              <option value="fixed">مبلغ ثابت</option>
              <option value="percent_of_delivery">نسبة من رسوم التوصيل %</option>
              <option value="percent_of_cod">نسبة من مبلغ التحصيل %</option>
            </select>
            <input
              type="number"
              step="0.5"
              min={0}
              value={surAmount}
              onChange={(e) => setSurAmount(Number(e.target.value))}
              className="rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
            />
            <button type="submit" className="rounded-lg bg-slate-900 py-1.5 text-xs font-medium text-white">
              إضافة رسم
            </button>
          </form>
        )}
        <div className="divide-y divide-slate-100 text-xs">
          {surcharges.length === 0 ? (
            <p className="text-slate-500">لا توجد رسوم إضافية مسجلة على هذا الإصدار.</p>
          ) : (
            surcharges.map((s) => (
              <div key={s.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-mono-tabular font-semibold">{s.code}</span> · {s.name} ({s.charge_type})
                </span>
                <div className="flex items-center gap-3">
                  <span className="font-mono-tabular font-semibold">{s.amount}</span>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => void deletePriceSurcharge(tenant.id, s.id).then(loadData)}
                      className="text-red-600 hover:underline"
                    >
                      حذف
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
