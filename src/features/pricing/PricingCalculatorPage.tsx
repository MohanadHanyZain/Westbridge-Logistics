import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {listClients} from '@/features/clients/clientsService';
import {
  listGovernorates,
  listRegions,
  listShippingServices,
} from '@/features/definitions/definitionsService';
import {calculateShipmentPrice, listPriceSnapshots} from '@/features/pricing/pricingService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {formatCurrency, formatDateTime, formatWeightKg} from '@/lib/formatters';
import type {GovernorateRecord, RegionRecord, ShippingServiceRecord} from '@/types/definitions';
import type {
  ClientRecord,
  PriceCalculationBreakdown,
  PriceMode,
  ShipmentPriceSnapshotRecord,
} from '@/types/pricing';
import {Calculator, Save} from 'lucide-react';

const MATCH_TIER_LABELS: Record<PriceCalculationBreakdown['match_tier'], string> = {
  exact_region: 'تطابق دقيق (منطقة التقاط × منطقة تسليم)',
  pickup_region_delivery_gov: 'تدرج هرمي (منطقة التقاط × محافظة تسليم)',
  pickup_gov_delivery_region: 'تدرج هرمي (محافظة التقاط × منطقة تسليم)',
  gov_to_gov: 'تدرج هرمي (محافظة التقاط × محافظة تسليم)',
};

export function PricingCalculatorPage() {
  const {tenant, isAdmin} = useTenantWorkspace();

  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [services, setServices] = useState<readonly ShippingServiceRecord[]>([]);
  const [governorates, setGovernorates] = useState<readonly GovernorateRecord[]>([]);
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);
  const [snapshots, setSnapshots] = useState<readonly ShipmentPriceSnapshotRecord[]>([]);

  const [clientId, setClientId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [pickupGovId, setPickupGovId] = useState('');
  const [pickupRegId, setPickupRegId] = useState('');
  const [delGovId, setDelGovId] = useState('');
  const [delRegId, setDelRegId] = useState('');
  const [actualWeight, setActualWeight] = useState(1.5);
  const [lengthCm, setLengthCm] = useState(0);
  const [widthCm, setWidthCm] = useState(0);
  const [heightCm, setHeightCm] = useState(0);
  const [enteredAmount, setEnteredAmount] = useState(1000);
  const [priceMode, setPriceMode] = useState<PriceMode>('shipping_excluded');

  const [useOverride, setUseOverride] = useState(false);
  const [overrideFee, setOverrideFee] = useState(0);
  const [overrideReason, setOverrideReason] = useState('');

  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<PriceCalculationBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [cRows, sRows, gRows, rRows, snapRows] = await Promise.all([
        listClients(tenant.id),
        listShippingServices(tenant.id),
        listGovernorates(tenant.id),
        listRegions(tenant.id),
        listPriceSnapshots(tenant.id),
      ]);
      setClients(cRows);
      setServices(sRows);
      setGovernorates(gRows);
      setRegions(rRows);
      setSnapshots(snapRows);

      if (cRows[0] && !clientId) {
        setClientId(cRows[0].id);
        setPickupGovId(cRows[0].governorate_id);
        setPickupRegId(cRows[0].region_id);
        setPriceMode(cRows[0].default_price_mode);
      }
      if (sRows[0] && !serviceId) setServiceId(sRows[0].id);
      if (gRows[0] && !delGovId) setDelGovId(gRows[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات الحاسبة.');
    }
  }, [tenant.id, clientId, serviceId, delGovId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const runCalculation = async (persistSnapshot: boolean) => {
    if (!clientId || !serviceId || !pickupGovId || !delGovId) {
      setError('اختر العميل والخدمة ومحافظتي الالتقاط والتسليم أولًا.');
      return;
    }
    setCalculating(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await calculateShipmentPrice({
        tenantId: tenant.id,
        clientId,
        serviceId,
        pickupGovernorateId: pickupGovId,
        pickupRegionId: pickupRegId || null,
        deliveryGovernorateId: delGovId,
        deliveryRegionId: delRegId || null,
        actualWeightKg: actualWeight,
        lengthCm,
        widthCm,
        heightCm,
        enteredAmount,
        priceMode,
        overrideTotalFee: useOverride ? overrideFee : null,
        overrideReason: useOverride ? overrideReason : null,
        persistSnapshot,
      });
      setResult(res);
      if (persistSnapshot) {
        setFeedback('تم حفظ لقطة السعر غير القابلة للتعديل (Price Snapshot) بنجاح.');
        const snapRows = await listPriceSnapshots(tenant.id);
        setSnapshots(snapRows);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر احتساب السعر.');
    } finally {
      setCalculating(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void runCalculation(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">محرك التسعير الخادمي ومعاينة Price Snapshot</h1>
        <p className="mt-1 text-xs text-slate-500">
          يتم تنفيذ جميع الحسابات (الوزن الحجمي، التدرج الهرمي، الضرائب، ومعادلة شامل/غير شامل) خادميًا داخل PostgreSQL.
        </p>
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-7">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="calc-client" className="block text-xs font-medium text-slate-700">
                العميل
              </label>
              <select
                id="calc-client"
                value={clientId}
                onChange={(e) => {
                  const next = clients.find((c) => c.id === e.target.value);
                  setClientId(e.target.value);
                  if (next) {
                    setPickupGovId(next.governorate_id);
                    setPickupRegId(next.region_id);
                    setPriceMode(next.default_price_mode);
                  }
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                {clients.length === 0 ? (
                  <option value="">أضف عميلًا أولًا من قائمة العملاء</option>
                ) : (
                  clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label htmlFor="calc-service" className="block text-xs font-medium text-slate-700">
                خدمة الشحن
              </label>
              <select
                id="calc-service"
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="calc-pgov" className="block text-xs font-medium text-slate-700">
                محافظة الالتقاط
              </label>
              <select
                id="calc-pgov"
                value={pickupGovId}
                onChange={(e) => {
                  setPickupGovId(e.target.value);
                  setPickupRegId('');
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
              <label htmlFor="calc-preg" className="block text-xs font-medium text-slate-700">
                منطقة الالتقاط
              </label>
              <select
                id="calc-preg"
                value={pickupRegId}
                onChange={(e) => setPickupRegId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <option value="">كامل المحافظة</option>
                {regions.filter((r) => r.governorate_id === pickupGovId).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="calc-dgov" className="block text-xs font-medium text-slate-700">
                محافظة التسليم
              </label>
              <select
                id="calc-dgov"
                value={delGovId}
                onChange={(e) => {
                  setDelGovId(e.target.value);
                  setDelRegId('');
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
              <label htmlFor="calc-dreg" className="block text-xs font-medium text-slate-700">
                منطقة التسليم
              </label>
              <select
                id="calc-dreg"
                value={delRegId}
                onChange={(e) => setDelRegId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <option value="">كامل المحافظة</option>
                {regions.filter((r) => r.governorate_id === delGovId).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4">
            <div>
              <label htmlFor="calc-w" className="block text-xs font-medium text-slate-700">
                الوزن الفعلي (كجم)
              </label>
              <input
                id="calc-w"
                type="number"
                step="0.1"
                min={0}
                value={actualWeight}
                onChange={(e) => setActualWeight(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
              />
            </div>
            <div>
              <label htmlFor="calc-l" className="block text-xs font-medium text-slate-700">
                الطول (سم)
              </label>
              <input
                id="calc-l"
                type="number"
                min={0}
                value={lengthCm}
                onChange={(e) => setLengthCm(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
              />
            </div>
            <div>
              <label htmlFor="calc-wid" className="block text-xs font-medium text-slate-700">
                العرض (سم)
              </label>
              <input
                id="calc-wid"
                type="number"
                min={0}
                value={widthCm}
                onChange={(e) => setWidthCm(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
              />
            </div>
            <div>
              <label htmlFor="calc-h" className="block text-xs font-medium text-slate-700">
                الارتفاع (سم)
              </label>
              <input
                id="calc-h"
                type="number"
                min={0}
                value={heightCm}
                onChange={(e) => setHeightCm(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 sm:grid-cols-2">
            <div>
              <label htmlFor="calc-amount" className="block text-xs font-medium text-slate-700">
                المبلغ المدخل (ج.م)
              </label>
              <input
                id="calc-amount"
                type="number"
                step="0.5"
                min={0}
                value={enteredAmount}
                onChange={(e) => setEnteredAmount(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
              />
            </div>

            <div>
              <label htmlFor="calc-mode" className="block text-xs font-medium text-slate-700">
                نوع السعر
              </label>
              <select
                id="calc-mode"
                value={priceMode}
                onChange={(e) => setPriceMode(e.target.value as PriceMode)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                <option value="shipping_excluded">غير شامل مصاريف الشحن (يُضاف على المستلم)</option>
                <option value="shipping_included">شامل مصاريف الشحن (يُخصم من مستحق التاجر)</option>
              </select>
            </div>
          </div>

          {isAdmin && (
            <div className="space-y-3 border-t border-slate-100 pt-4">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={useOverride}
                  onChange={(e) => setUseOverride(e.target.checked)}
                />
                تفعيل التعديل اليدوي للسعر (صلاحية إدارية override_price)
              </label>
              {useOverride && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    type="number"
                    min={0}
                    step="0.5"
                    value={overrideFee}
                    onChange={(e) => setOverrideFee(Number(e.target.value))}
                    placeholder="إجمالي رسوم الشحن اليدوية"
                    className="rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
                  />
                  <input
                    required
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="سبب التعديل اليدوي (إلزامي)"
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
                  />
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={calculating || !clientId}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <Calculator className="h-4 w-4" />
              {calculating ? 'جاري الحساب...' : 'معاينة التسعير من الخادم'}
            </button>
            <button
              type="button"
              disabled={calculating || !clientId}
              onClick={() => void runCalculation(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <Save className="h-4 w-4" />
              حفظ كلقطة سعر (Snapshot)
            </button>
          </div>
        </form>

        {/* Server Breakdown Output */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 lg:col-span-5">
          <h2 className="border-b border-slate-100 pb-3 text-sm font-semibold text-slate-900">
            تفاصيل التسعير المعتمدة من الخادم
          </h2>

          {!result ? (
            <p className="py-12 text-center text-xs text-slate-500">
              اضغط على «معاينة التسعير من الخادم» لعرض التفصيل الحسابي الدقيق.
            </p>
          ) : (
            <div className="mt-4 space-y-3 text-xs">
              <p className="text-slate-600">{MATCH_TIER_LABELS[result.match_tier]}</p>

              <div className="space-y-1.5 border-y border-slate-100 py-3">
                <div className="flex justify-between">
                  <span className="text-slate-600">الوزن الفعلي / الحجمي</span>
                  <span className="font-mono-tabular">
                    {formatWeightKg(result.actual_weight_kg)} · {formatWeightKg(result.volumetric_weight_kg)}
                  </span>
                </div>
                <div className="flex justify-between font-medium text-slate-900">
                  <span>الوزن المفوتر بعد التقريب ({result.rounding_rule})</span>
                  <span className="font-mono-tabular">{formatWeightKg(result.chargeable_weight_kg)}</span>
                </div>
              </div>

              <div className="space-y-1.5 border-b border-slate-100 pb-3">
                <div className="flex justify-between">
                  <span className="text-slate-600">سعر التوصيل الأساسي (حتى {result.base_weight_kg} كجم)</span>
                  <span className="font-mono-tabular">{formatCurrency(result.base_delivery_fee)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">رسوم الوزن الإضافي</span>
                  <span className="font-mono-tabular">{formatCurrency(result.extra_weight_fee)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">عمولة التحصيل</span>
                  <span className="font-mono-tabular">{formatCurrency(result.collection_fee)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">رسوم إضافية / إعفاءات</span>
                  <span className="font-mono-tabular">
                    +{formatCurrency(result.surcharges_total)} / -{formatCurrency(result.exemptions_total)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">
                    الضريبة ({result.tax_profile_code} · {result.tax_rate_percent}%)
                  </span>
                  <span className="font-mono-tabular">{formatCurrency(result.tax_amount)}</span>
                </div>
              </div>

              <div className="space-y-2 pt-1">
                <div className="flex justify-between text-sm font-bold text-slate-900">
                  <span>إجمالي رسوم الشحن</span>
                  <span className="font-mono-tabular">{formatCurrency(result.total_shipping_fee)}</span>
                </div>
                <div className="flex justify-between font-semibold text-emerald-700">
                  <span>المطلوب تحصيله من المستلم</span>
                  <span className="font-mono-tabular">{formatCurrency(result.recipient_collect_amount)}</span>
                </div>
                <div className="flex justify-between font-semibold text-slate-800">
                  <span>صافي المستحق للعميل (التاجر)</span>
                  <span className="font-mono-tabular">{formatCurrency(result.client_net_payout)}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>رسوم الإرجاع المرجعية</span>
                  <span className="font-mono-tabular">{formatCurrency(result.return_fee)}</span>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Recent Snapshots */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">أحدث لقطات الأسعار المحفوظة (Price Snapshots)</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-right text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="px-3 py-2 font-medium">التوقيت</th>
                <th className="px-3 py-2 font-medium">الوزن المفوتر</th>
                <th className="px-3 py-2 font-medium">نوع السعر</th>
                <th className="px-3 py-2 font-medium">الرسوم</th>
                <th className="px-3 py-2 font-medium">الضريبة</th>
                <th className="px-3 py-2 font-medium">التحصيل من المستلم</th>
                <th className="px-3 py-2 font-medium">صافي التاجر</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {snapshots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-500">
                    لم يتم حفظ أي لقطات أسعار بعد.
                  </td>
                </tr>
              ) : (
                snapshots.map((snap) => (
                  <tr key={snap.id}>
                    <td className="px-3 py-2 font-mono-tabular text-slate-600">{formatDateTime(snap.created_at)}</td>
                    <td className="px-3 py-2 font-mono-tabular">{formatWeightKg(snap.chargeable_weight_kg)}</td>
                    <td className="px-3 py-2">
                      {snap.price_mode === 'shipping_included' ? 'شامل الشحن' : 'غير شامل'}
                      {snap.is_manual_override ? ' (يدوي)' : ''}
                    </td>
                    <td className="px-3 py-2 font-mono-tabular font-semibold">{formatCurrency(snap.total_shipping_fee)}</td>
                    <td className="px-3 py-2 font-mono-tabular">{formatCurrency(snap.tax_amount)}</td>
                    <td className="px-3 py-2 font-mono-tabular text-emerald-700">
                      {formatCurrency(snap.recipient_collect_amount)}
                    </td>
                    <td className="px-3 py-2 font-mono-tabular">{formatCurrency(snap.client_net_payout)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
