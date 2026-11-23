import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link, Navigate} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {CourierMapCanvas, type CourierMapMarkerItem} from '@/features/couriers/CourierMapCanvas';
import {
  getTenantMapsSettings,
  listCourierMovementsTimeline,
  recordCourierLocationEvent,
} from '@/features/couriers/couriersService';
import {listExceptionReasons} from '@/features/definitions/definitionsService';
import {DeliveryExecutionModal} from '@/features/delivery/DeliveryExecutionModal';
import {
  getTenantDeliveryPolicy,
  listCourierMyTasks,
} from '@/features/delivery/deliveryService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {getBrowserDeviceFingerprint} from '@/lib/maps';
import {
  LOCATION_EVENT_TYPE_LABELS,
  LOCATION_SOURCE_LABELS,
  type CourierLocationEventRecord,
  type LocationEventType,
  type TenantMapsSettingsRecord,
} from '@/types/couriers';
import type {DeliveryExceptionReasonRecord} from '@/types/definitions';
import {
  DELIVERY_LIST_STATUS_LABELS,
  type CourierPortalTasksFeed,
  type TenantDeliveryPolicyRecord,
} from '@/types/delivery';
import {ConversationThreadPanel} from '@/features/messaging/ConversationThreadPanel';
import {SHIPMENT_STATUS_LABELS, type ShipmentListItem} from '@/types/shipments';
import {Barcode, CheckCircle2, LocateFixed, MapPin, MapPinned, MessageSquare, Phone, Truck} from 'lucide-react';

export function CourierPortalPage() {
  const {tenant, membership, boundCourierId} = useTenantWorkspace();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const hasCourierIdentity =
    membership.account_subject_type === 'courier' ||
    membership.role_key === 'delivery_agent' ||
    Boolean(boundCourierId);
  const isBoundCourierAccount = hasCourierIdentity && Boolean(boundCourierId);

  const [exceptionReasons, setExceptionReasons] = useState<readonly DeliveryExceptionReasonRecord[]>([]);
  const [policy, setPolicy] = useState<TenantDeliveryPolicyRecord>({
    tenant_id: tenant.id,
    max_delivery_attempts: 3,
    retry_extra_fee: 0,
    require_pod_on_delivery: false,
  });
  const [mapsPolicy, setMapsPolicy] = useState<TenantMapsSettingsRecord>({
    tenant_id: tenant.id,
    location_retention_days: 90,
    gps_ping_interval_seconds: 60,
    require_gps_on_delivery: false,
  });

  const [feed, setFeed] = useState<CourierPortalTasksFeed | null>(null);
  const [routeEvents, setRouteEvents] = useState<readonly CourierLocationEventRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'shipments' | 'delivery_lists' | 'pickup_lists' | 'route_map' | 'messaging'>('shipments');
  const [selectedChatShipmentId, setSelectedChatShipmentId] = useState('');
  const [barcodeQuery, setBarcodeQuery] = useState('');
  const [execShipment, setExecShipment] = useState<ShipmentListItem | null>(null);
  const [sharingGps, setSharingGps] = useState(false);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  const loadRefsAndInit = useCallback(async () => {
    if (!isBoundCourierAccount) return;
    try {
      const [reasons, pol, mPol] = await Promise.all([
        listExceptionReasons(tenant.id),
        getTenantDeliveryPolicy(tenant.id),
        getTenantMapsSettings(tenant.id).catch(() => ({
          tenant_id: tenant.id,
          location_retention_days: 90,
          gps_ping_interval_seconds: 60,
          require_gps_on_delivery: false,
        })),
      ]);
      setExceptionReasons(reasons.filter((r) => r.is_active));
      setPolicy(pol);
      setMapsPolicy(mPol);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحميل إعدادات مهام المندوب.',
      });
    }
  }, [tenant.id, isBoundCourierAccount]);

  const loadTasks = useCallback(async () => {
    if (!isBoundCourierAccount) return;
    setLoading(true);
    try {
      const data = await listCourierMyTasks(tenant.id, boundCourierId);
      setFeed(data);
      const targetCourierId = data?.courier?.id ?? null;
      if (targetCourierId) {
        const today = new Date().toISOString().slice(0, 10);
        try {
          const tl = await listCourierMovementsTimeline(tenant.id, targetCourierId, today, today);
          setRouteEvents(tl.events ?? []);
        } catch {
          setRouteEvents([]);
        }
      }
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحميل مهام المندوب.'});
    } finally {
      setLoading(false);
    }
  }, [tenant.id, isBoundCourierAccount, boundCourierId]);

  useEffect(() => {
    void loadRefsAndInit();
  }, [loadRefsAndInit]);

  useEffect(() => {
    if (isBoundCourierAccount) {
      void loadTasks();
    } else {
      setLoading(false);
    }
  }, [isBoundCourierAccount, loadTasks]);

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

  const handleFieldLocationCheckin = async (eventType: LocationEventType) => {
    const targetCourierId = feed?.courier?.id ?? null;
    if (!targetCourierId) {
      setFeedback({type: 'error', text: 'تعذر تحديد حساب المندوب الحالي.'});
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setFeedback({type: 'error', text: 'المتصفح الحالي لا يدعم خدمة تحديد الموقع GPS.'});
      return;
    }

    setSharingGps(true);
    setFeedback(null);
    try {
      const coords = await new Promise<GeolocationCoordinates>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos.coords),
          (err) => reject(err),
          {enableHighAccuracy: true, timeout: 10000, maximumAge: 15000},
        );
      });

      const saved = await recordCourierLocationEvent(tenant.id, {
        courier_id: targetCourierId,
        event_type: eventType,
        lat: Number(coords.latitude.toFixed(6)),
        lng: Number(coords.longitude.toFixed(6)),
        accuracy_meters: Number.isFinite(coords.accuracy) ? Number(coords.accuracy.toFixed(1)) : null,
        source: 'gps_browser',
        device_fingerprint: getBrowserDeviceFingerprint(),
        device_label: 'بوابة المندوب الميدانية',
      });

      setRouteEvents((prev) => [...prev, saved]);
      setFeedback({
        type: 'success',
        text: `تم تسجيل نقطة الموقع (${LOCATION_EVENT_TYPE_LABELS[eventType]}) بدقة GPS.`,
      });
    } catch {
      setFeedback({type: 'error', text: 'تعذر الحصول على إحداثيات الموقع من الجهاز.'});
    } finally {
      setSharingGps(false);
    }
  };

  const portalMapMarkers: readonly CourierMapMarkerItem[] = useMemo(
    () =>
      routeEvents.map((ev, idx) => ({
        id: ev.id,
        lat: ev.lat,
        lng: ev.lng,
        title: LOCATION_EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type,
        subtitle: ev.notes || LOCATION_SOURCE_LABELS[ev.source],
        accuracyMeters: ev.accuracy_meters,
        recordedAt: ev.recorded_at,
        shipmentNumber: ev.shipment_number ?? null,
        tone:
          ev.event_type === 'shift_start'
            ? 'start'
            : ev.event_type === 'delivery_attempt'
              ? 'delivery'
              : ev.event_type === 'shift_end'
                ? 'end'
                : 'ping',
        orderNumber: idx + 1,
      })),
    [routeEvents],
  );

  if (!isBoundCourierAccount) {
    if (hasCourierIdentity) {
      return (
        <div role="alert" className="m-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          حساب المندوب غير مربوط بملف مندوب. اطلب من مسؤول الشركة تصحيح ربط الحساب.
        </div>
      );
    }
    return <Navigate to={basePath} replace />;
  }

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

      {/* Quick Barcode Scanner & GPS Shift Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <form onSubmit={handleBarcodeLookup} className="flex flex-1 flex-wrap items-center gap-3">
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

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 sm:border-t-0 sm:pt-0">
          <button
            type="button"
            disabled={sharingGps}
            onClick={() => void handleFieldLocationCheckin('shift_start')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60 whitespace-nowrap"
          >
            <LocateFixed className="h-3.5 w-3.5" />
            <span>بدء الوردية (GPS)</span>
          </button>
          <button
            type="button"
            disabled={sharingGps}
            onClick={() => void handleFieldLocationCheckin('ping')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap"
          >
            <LocateFixed className="h-3.5 w-3.5" />
            <span>مشاركة موقعي الآن</span>
          </button>
        </div>
      </div>

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
        <button
          type="button"
          onClick={() => setActiveTab('route_map')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'route_map' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <MapPinned className="h-3.5 w-3.5" />
          <span>خريطة مساري ({routeEvents.length})</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('messaging');
            if (!selectedChatShipmentId && feed?.shipments[0]) {
              setSelectedChatShipmentId(feed.shipments[0].id);
            }
          }}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
            activeTab === 'messaging' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span>الرسائل والتواصل</span>
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

      {/* Route Map Tab */}
      {activeTab === 'route_map' && (
        <div className="space-y-4">
          <CourierMapCanvas
            markers={portalMapMarkers}
            drawRouteLine={true}
            emptyTitle="لم تسجل أي نقاط موقع خلال وردية اليوم"
            emptyDescription="اضغط «بدء الوردية (GPS)» أو «مشاركة موقعي الآن» أو وثّق الموقع عند تسجيل التسليم لتتبع خط السير هنا."
          />
        </div>
      )}

      {/* Messaging Tab */}
      {activeTab === 'messaging' && (
        <div className="space-y-4">
          {!feed || feed.shipments.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
              لا توجد شحنات مسندة لبدء محادثة ميدانية حولها.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <label htmlFor="courier-chat-shipment" className="text-xs font-medium text-slate-700">
                  الشحنة محل التواصل:
                </label>
                <select
                  id="courier-chat-shipment"
                  value={selectedChatShipmentId || feed.shipments[0].id}
                  onChange={(e) => setSelectedChatShipmentId(e.target.value)}
                  className="min-w-[260px] rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  {feed.shipments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.shipment_number} · {s.recipient_name ?? 'مستلم'}
                    </option>
                  ))}
                </select>
              </div>

              <ConversationThreadPanel
                key={selectedChatShipmentId || feed.shipments[0].id}
                tenantId={tenant.id}
                entityType="shipment"
                entityId={selectedChatShipmentId || feed.shipments[0].id}
                defaultSubject={`تواصل ميداني · ${(feed.shipments.find((s) => s.id === (selectedChatShipmentId || feed.shipments[0].id)) ?? feed.shipments[0]).shipment_number}`}
              />
            </>
          )}
        </div>
      )}

      <DeliveryExecutionModal
        open={execShipment !== null}
        tenantId={tenant.id}
        shipment={execShipment}
        courierId={feed?.courier?.id ?? null}
        requirePod={policy.require_pod_on_delivery}
        requireGps={mapsPolicy.require_gps_on_delivery}
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
