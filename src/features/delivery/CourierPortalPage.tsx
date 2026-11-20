import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {listCouriers} from '@/features/couriers/couriersService';
import {listExceptionReasons} from '@/features/definitions/definitionsService';
import {DeliveryExecutionModal} from '@/features/delivery/DeliveryExecutionModal';
import {
  getTenantDeliveryPolicy,
  listCourierMyTasks,
} from '@/features/delivery/deliveryService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {CourierRecord} from '@/types/couriers';
import type {DeliveryExceptionReasonRecord} from '@/types/definitions';
import {
  DELIVERY_LIST_STATUS_LABELS,
  type CourierPortalTasksFeed,
  type TenantDeliveryPolicyRecord,
} from '@/types/delivery';
import {SHIPMENT_STATUS_LABELS, type ShipmentListItem} from '@/types/shipments';
import {Barcode, CheckCircle2, MapPin, Phone, Truck} from 'lucide-react';

export function CourierPortalPage() {
  const {tenant, membership} = useTenantWorkspace();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const isBoundCourierAccount = membership.account_subject_type === 'courier';

  const [couriers, setCouriers] = useState<readonly CourierRecord[]>([]);
  const [selectedCourierId, setSelectedCourierId] = useState('');
  const [exceptionReasons, setExceptionReasons] = useState<readonly DeliveryExceptionReasonRecord[]>([]);
  const [policy, setPolicy] = useState<TenantDeliveryPolicyRecord>({
    tenant_id: tenant.id,
    max_delivery_attempts: 3,
    retry_extra_fee: 0,
    require_pod_on_delivery: false,
  });

  const [feed, setFeed] = useState<CourierPortalTasksFeed | null>(null);
  const [activeTab, setActiveTab] = useState<'shipments' | 'delivery_lists' | 'pickup_lists'>('shipments');
  const [barcodeQuery, setBarcodeQuery] = useState('');
  const [execShipment, setExecShipment] = useState<ShipmentListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  const loadRefsAndInit = useCallback(async () => {
    try {
      const [reasons, pol] = await Promise.all([
        listExceptionReasons(tenant.id),
        getTenantDeliveryPolicy(tenant.id),
      ]);
      setExceptionReasons(reasons.filter((r) => r.is_active));
      setPolicy(pol);

      if (!isBoundCourierAccount) {
        const crr = await listCouriers(tenant.id);
        const activeCouriers = crr.filter((c) => c.is_active);
        setCouriers(activeCouriers);
        if (!selectedCourierId && activeCouriers[0]) {
          setSelectedCourierId(activeCouriers[0].id);
        }
      }
    } catch {
      // Non-blocking
    }
  }, [tenant.id, isBoundCourierAccount, selectedCourierId]);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listCourierMyTasks(
        tenant.id,
        isBoundCourierAccount ? null : selectedCourierId || null,
      );
      setFeed(data);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحميل مهام المندوب.'});
    } finally {
      setLoading(false);
    }
  }, [tenant.id, isBoundCourierAccount, selectedCourierId]);

  useEffect(() => {
    void loadRefsAndInit();
  }, [loadRefsAndInit]);

  useEffect(() => {
    if (isBoundCourierAccount || selectedCourierId) {
      void loadTasks();
    } else {
      setLoading(false);
    }
  }, [isBoundCourierAccount, selectedCourierId, loadTasks]);

  const metrics = useMemo(() => {
    const shps = feed?.shipments ?? [];
    const activeCount = shps.filter(
      (s) => s.operational_status === 'out_for_delivery' || s.operational_status === 'pickup_scheduled',
    ).length;
    const deliveredCash = shps
      .filter((s) => s.operational_status === 'delivered' || s.operational_status === 'partially_delivered')
      .reduce((sum, s) => sum + Number(s.delivered_amount ?? 0), 0);
    const returnCash = shps.reduce((sum, s) => sum + Number(s.return_collected_from_recipient ?? 0), 0);
    const commissionTotal = shps.reduce((sum, s) => sum + Number(s.accrued_courier_commission ?? 0), 0);
    return {
      totalCount: shps.length,
      activeCount,
      collectedCashTotal: deliveredCash + returnCash,
      commissionTotal,
    };
  }, [feed]);

  const handleBarcodeLookup = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = barcodeQuery.trim().toLowerCase();
    if (!cleaned || !feed) return;
    const match = feed.shipments.find(
      (s) =>
        s.barcode_token.toLowerCase() === cleaned ||
        s.shipment_number.toLowerCase() === cleaned,
    );
    if (!match) {
      setFeedback({
        type: 'error',
        text: `لم يتم العثور على شحنة مسندة للمندوب تطابق الرمز (${barcodeQuery.trim()}).`,
      });
      return;
    }
    setFeedback(null);
    setExecShipment(match);
    setBarcodeQuery('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">بوابة المندوب والمهام الميدانية</h1>
          <p className="mt-1 text-sm text-slate-600">
            {feed?.courier
              ? `المندوب: ${feed.courier.name} · كود: ${feed.courier.code} · ${feed.courier.mobile}`
              : 'متابعة الشحنات المسندة للتوصيل أو الالتقاط وتسجيل إثبات التسليم الميداني.'}
          </p>
        </div>

        {!isBoundCourierAccount && couriers.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="portal-courier-select" className="text-xs font-medium text-slate-600">
              معاينة مهام المندوب:
            </label>
            <select
              id="portal-courier-select"
              value={selectedCourierId}
              onChange={(e) => setSelectedCourierId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              {couriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">مهام قيد التنفيذ</div>
          <div className="mt-1 font-mono-tabular text-2xl font-bold text-slate-900">{metrics.activeCount}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">إجمالي الشحنات المسندة</div>
          <div className="mt-1 font-mono-tabular text-2xl font-bold text-slate-900">{metrics.totalCount}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">عهدة النقدية المحصلة</div>
          <div className="mt-1 font-mono-tabular text-2xl font-bold text-emerald-700">
            {metrics.collectedCashTotal.toFixed(2)} ج.م
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">العمولات المستحقة المبدئية</div>
          <div className="mt-1 font-mono-tabular text-2xl font-bold text-sky-700">
            {metrics.commissionTotal.toFixed(2)} ج.م
          </div>
        </div>
      </div>

      {/* Quick Barcode Scanner for Instant Field Action */}
      <form
        onSubmit={handleBarcodeLookup}
        className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <div className="relative min-w-[240px] flex-1">
          <Barcode className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={barcodeQuery}
            onChange={(e) => setBarcodeQuery(e.target.value)}
            placeholder="امسح باركود الشحنة أو أدخل رقمها لتسجيل التسليم / التعذر فورًا..."
            aria-label="مسح باركود الشحنة"
            className="w-full rounded-lg border border-slate-200 py-2 pr-9 pl-3 font-mono-tabular text-xs"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          فتح تنفيذ الشحنة
        </button>
      </form>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-xs ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Portal Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5">
        <button
          type="button"
          onClick={() => setActiveTab('shipments')}
          className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'shipments' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          شحنات المهام المسندة ({feed?.shipments.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('delivery_lists')}
          className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'delivery_lists' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          قوائم التوصيل ({feed?.delivery_lists.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('pickup_lists')}
          className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'pickup_lists' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          قوائم الالتقاط ({feed?.pickup_lists.length ?? 0})
        </button>
      </div>

      {/* Shipments Cards Grid (Touch-Friendly) */}
      {activeTab === 'shipments' && (
        <div className="space-y-3">
          {loading ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
              جاري تحميل مهام المندوب...
            </div>
          ) : !feed || feed.shipments.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
              لا توجد شحنات مسندة حاليًا لهذا المندوب.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {feed.shipments.map((shp) => {
                const canExecute =
                  shp.operational_status === 'out_for_delivery' ||
                  shp.operational_status === 'rescheduled' ||
                  shp.operational_status === 'delivery_failed';

                return (
                  <div
                    key={shp.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Link
                          to={`${basePath}/shipments/${shp.id}`}
                          className="font-mono-tabular text-sm font-bold text-slate-900 hover:underline"
                        >
                          {shp.shipment_number}
                        </Link>
                        <span className="text-xs font-semibold text-sky-700">
                          {SHIPMENT_STATUS_LABELS[shp.operational_status]}
                        </span>
                      </div>

                      <div className="text-xs text-slate-700">
                        <span className="font-semibold">{shp.recipient_name ?? 'مستلم'}</span>
                        {shp.client_name ? ` · التاجر: ${shp.client_name}` : ''}
                      </div>

                      <div className="flex items-center gap-2 text-xs text-slate-600">
                        <Phone className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span className="font-mono-tabular">{shp.recipient_mobile ?? '—'}</span>
                      </div>

                      <div className="flex items-start gap-2 text-xs text-slate-600">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 text-slate-400 shrink-0" />
                        <span>{shp.recipient_address ?? '—'}</span>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                      <div className="font-mono-tabular text-xs">
                        <span className="font-bold text-slate-900">
                          تحصيل: {Number(shp.recipient_collect_amount).toFixed(2)} ج.م
                        </span>
                        <span className="mx-1.5 text-slate-400" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-slate-500">
                          محاولة {shp.delivery_attempts_count} / {policy.max_delivery_attempts}
                        </span>
                      </div>

                      {canExecute ? (
                        <button
                          type="button"
                          onClick={() => setExecShipment(shp)}
                          className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                        >
                          تسجيل التسليم / التعذر
                        </button>
                      ) : (
                        <span className="font-mono-tabular text-[11px] text-emerald-700">
                          {shp.accrued_courier_commission && shp.accrued_courier_commission > 0
                            ? `عمولة: ${Number(shp.accrued_courier_commission).toFixed(2)} ج.م`
                            : 'مكتملة'}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Delivery Lists Tab */}
      {activeTab === 'delivery_lists' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">رقم القائمة</th>
                <th className="px-4 py-3 font-medium">النوع</th>
                <th className="px-4 py-3 font-medium">التاريخ</th>
                <th className="px-4 py-3 font-medium">الشحنات / المعلق</th>
                <th className="px-4 py-3 font-medium">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(feed?.delivery_lists ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-slate-500">
                    لا توجد قوائم توصيل مسندة.
                  </td>
                </tr>
              ) : (
                (feed?.delivery_lists ?? []).map((dl) => (
                  <tr key={dl.id}>
                    <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">
                      <span className="inline-flex items-center gap-1.5">
                        <Truck className="h-3.5 w-3.5 text-slate-500" />
                        {dl.list_code}
                      </span>
                    </td>
                    <td className="px-4 py-3">{dl.list_type === 'redelivery' ? 'إعادة توصيل' : 'توصيل'}</td>
                    <td className="px-4 py-3 font-mono-tabular text-slate-600">{dl.list_date}</td>
                    <td className="px-4 py-3 font-mono-tabular">
                      {dl.shipments_count} · معلق: {dl.pending_count}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700">
                      {DELIVERY_LIST_STATUS_LABELS[dl.status]}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Pickup Lists Tab */}
      {activeTab === 'pickup_lists' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">رقم قائمة الالتقاط</th>
                <th className="px-4 py-3 font-medium">التاريخ</th>
                <th className="px-4 py-3 font-medium">عدد الشحنات</th>
                <th className="px-4 py-3 font-medium">ملاحظات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(feed?.pickup_lists ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-slate-500">
                    لا توجد قوائم التقاط مسندة.
                  </td>
                </tr>
              ) : (
                (feed?.pickup_lists ?? []).map((pl) => (
                  <tr key={pl.id}>
                    <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">{pl.list_code}</td>
                    <td className="px-4 py-3 font-mono-tabular text-slate-600">{pl.list_date}</td>
                    <td className="px-4 py-3 font-mono-tabular">{pl.shipments_count} شحنة</td>
                    <td className="px-4 py-3 text-slate-600">{pl.notes ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <DeliveryExecutionModal
        open={execShipment !== null}
        tenantId={tenant.id}
        shipment={execShipment}
        requirePod={policy.require_pod_on_delivery}
        maxAttempts={policy.max_delivery_attempts}
        exceptionReasons={exceptionReasons}
        onClose={() => setExecShipment(null)}
        onExecuted={async (res) => {
          await loadTasks();
          setFeedback({
            type: 'success',
            text: res.auto_returned_by_limit
              ? 'تم تحويل الشحنة للمرتجع لاستنفاد الحد الأقصى لمحاولات التوصيل.'
              : `تم تسجيل النتيجة بنجاح${res.accrued_courier_commission > 0 ? ` · العمولة المستحقة: ${res.accrued_courier_commission.toFixed(2)} ج.م` : ''}.`,
          });
        }}
      />
    </div>
  );
}
