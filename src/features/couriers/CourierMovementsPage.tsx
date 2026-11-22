import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {CourierMapCanvas, type CourierMapMarkerItem} from '@/features/couriers/CourierMapCanvas';
import {
  getLiveCouriersPositions,
  listCourierMovementsTimeline,
  listCouriers,
  recordCourierLocationEvent,
} from '@/features/couriers/couriersService';
import {listBranches} from '@/features/definitions/definitionsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {
  buildExternalMapPinUrl,
  computeRouteTotalDistanceKm,
  formatCoordinatesLabel,
  getBrowserDeviceFingerprint,
  isValidCoordinatePair,
} from '@/lib/maps';
import {
  LOCATION_EVENT_TYPE_LABELS,
  LOCATION_SOURCE_LABELS,
  type CourierLivePosition,
  type CourierMovementsTimelineResult,
  type CourierRecord,
  type LocationEventType,
} from '@/types/couriers';
import type {BranchRecord} from '@/types/definitions';
import {
  Clock,
  ExternalLink,
  LocateFixed,
  MapPin,
  Navigation,
  RefreshCw,
  Route as RouteIcon,
  Truck,
} from 'lucide-react';

type ViewMode = 'live' | 'timeline';

function mapEventTypeToTone(type: LocationEventType): CourierMapMarkerItem['tone'] {
  switch (type) {
    case 'shift_start':
      return 'start';
    case 'delivery_attempt':
      return 'delivery';
    case 'pickup_stop':
      return 'pickup';
    case 'shift_end':
      return 'end';
    default:
      return 'ping';
  }
}

export function CourierMovementsPage() {
  const {tenant, membership, boundCourierId, can} = useTenantWorkspace();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;
  const isBoundCourier = membership.account_subject_type === 'courier';

  const [mode, setMode] = useState<ViewMode>(isBoundCourier ? 'timeline' : 'live');
  const [couriers, setCouriers] = useState<readonly CourierRecord[]>([]);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [selectedCourierId, setSelectedCourierId] = useState(boundCourierId ?? '');
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const [livePositions, setLivePositions] = useState<readonly CourierLivePosition[]>([]);
  const [timeline, setTimeline] = useState<CourierMovementsTimelineResult | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [recordingPin, setRecordingPin] = useState(false);
  const [showManualPinForm, setShowManualPinForm] = useState(false);
  const [manualLat, setManualLat] = useState('30.04442');
  const [manualLng, setManualLng] = useState('31.23571');
  const [manualEventType, setManualEventType] = useState<LocationEventType>('ping');
  const [manualNotes, setManualNotes] = useState('');
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  const canRecord =
    isBoundCourier ||
    can('couriers.locations_record') ||
    can('couriers.manage') ||
    can('operations.delivery.execute');

  const loadRefs = useCallback(async () => {
    try {
      const [cRows, bRows] = await Promise.all([
        listCouriers(tenant.id),
        listBranches(tenant.id),
      ]);
      setCouriers(cRows);
      setBranches(bRows);
      if (boundCourierId) {
        setSelectedCourierId(boundCourierId);
      } else if (!selectedCourierId && cRows[0]) {
        setSelectedCourierId(cRows[0].id);
      }
    } catch {
      // Keep UI responsive
    }
  }, [tenant.id, boundCourierId, selectedCourierId]);

  const loadLivePositions = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getLiveCouriersPositions(tenant.id, selectedBranchId || null);
      setLivePositions(rows);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحميل المواقع الحية للمناديب.'});
    } finally {
      setLoading(false);
    }
  }, [tenant.id, selectedBranchId]);

  const loadTimeline = useCallback(async () => {
    const targetId = boundCourierId ?? selectedCourierId;
    if (!targetId) {
      setTimeline(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await listCourierMovementsTimeline(tenant.id, targetId, dateFrom, dateTo);
      setTimeline(res);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحميل مسار المندوب.'});
    } finally {
      setLoading(false);
    }
  }, [tenant.id, boundCourierId, selectedCourierId, dateFrom, dateTo]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    setSelectedMarkerId(null);
    if (mode === 'live') {
      void loadLivePositions();
    } else {
      void loadTimeline();
    }
  }, [mode, loadLivePositions, loadTimeline]);

  const handleBrowserGpsPing = async () => {
    const targetId = boundCourierId ?? selectedCourierId;
    if (!targetId) {
      setFeedback({type: 'error', text: 'يرجى اختيار مندوب الشحن أولاً.'});
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setShowManualPinForm(true);
      setFeedback({
        type: 'error',
        text: 'المتصفح الحالي لا يدعم خدمة تحديد الموقع التلقائي؛ يمكنك إدخال الإحداثيات يدويًا.',
      });
      return;
    }

    setRecordingPin(true);
    setFeedback(null);
    try {
      const coords = await new Promise<GeolocationCoordinates>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos.coords),
          (err) => reject(err),
          {enableHighAccuracy: true, timeout: 10000, maximumAge: 15000},
        );
      });

      await recordCourierLocationEvent(tenant.id, {
        courier_id: targetId,
        event_type: 'ping',
        lat: Number(coords.latitude.toFixed(6)),
        lng: Number(coords.longitude.toFixed(6)),
        accuracy_meters: Number.isFinite(coords.accuracy) ? Number(coords.accuracy.toFixed(1)) : null,
        speed_mps: coords.speed !== null && Number.isFinite(coords.speed) ? Number(coords.speed.toFixed(2)) : null,
        heading_deg:
          coords.heading !== null && Number.isFinite(coords.heading) ? Number(coords.heading.toFixed(1)) : null,
        source: 'gps_browser',
        device_fingerprint: getBrowserDeviceFingerprint(),
        device_label: 'متصفح المتابعة الميدانية',
      });

      setFeedback({type: 'success', text: 'تم التقاط وتسجيل نقطة الموقع الفعلية بنجاح.'});
      if (mode === 'live') await loadLivePositions();
      else await loadTimeline();
    } catch {
      setShowManualPinForm(true);
      setFeedback({
        type: 'error',
        text: 'تعذر الحصول على إذن GPS من المتصفح. يمكنك تثبيت نقطة الموقع يدويًا من النموذج.',
      });
    } finally {
      setRecordingPin(false);
    }
  };

  const handleManualPinSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const targetId = boundCourierId ?? selectedCourierId;
    if (!targetId) {
      setFeedback({type: 'error', text: 'يرجى اختيار المندوب أولاً.'});
      return;
    }

    const latNum = Number(manualLat);
    const lngNum = Number(manualLng);
    if (!isValidCoordinatePair(latNum, lngNum)) {
      setFeedback({type: 'error', text: 'إحداثيات خط العرض والطول غير صالحة.'});
      return;
    }

    setRecordingPin(true);
    setFeedback(null);
    try {
      await recordCourierLocationEvent(tenant.id, {
        courier_id: targetId,
        event_type: manualEventType,
        lat: Number(latNum.toFixed(6)),
        lng: Number(lngNum.toFixed(6)),
        source: 'manual_pin',
        notes: manualNotes.trim() || null,
        device_fingerprint: getBrowserDeviceFingerprint(),
      });
      setManualNotes('');
      setShowManualPinForm(false);
      setFeedback({type: 'success', text: 'تم تسجيل نقطة التثبيت اليدوي على المسار بنجاح.'});
      if (mode === 'live') await loadLivePositions();
      else await loadTimeline();
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تسجيل النقطة اليدوية.'});
    } finally {
      setRecordingPin(false);
    }
  };

  const mapMarkers: readonly CourierMapMarkerItem[] = useMemo(() => {
    if (mode === 'live') {
      return livePositions
        .filter((p) => p.lat !== null && p.lng !== null && isValidCoordinatePair(p.lat, p.lng))
        .map((p) => ({
          id: p.courier_id,
          lat: p.lat!,
          lng: p.lng!,
          title: `${p.courier_name} (${p.courier_code})`,
          subtitle: `${p.branch_name ?? 'فرع عام'} · مهام نشطة: ${p.active_shipments_count}`,
          accuracyMeters: p.accuracy_meters,
          recordedAt: p.last_recorded_at,
          shipmentNumber: p.last_shipment_number,
          tone: 'live',
        }));
    }

    const events = timeline?.events ?? [];
    return events.map((ev, idx) => ({
      id: ev.id,
      lat: ev.lat,
      lng: ev.lng,
      title: LOCATION_EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type,
      subtitle: ev.recipient_name
        ? `${ev.recipient_name}${ev.recipient_address ? ` · ${ev.recipient_address}` : ''}`
        : ev.notes || LOCATION_SOURCE_LABELS[ev.source],
      accuracyMeters: ev.accuracy_meters,
      recordedAt: ev.recorded_at,
      shipmentNumber: ev.shipment_number ?? null,
      tone: mapEventTypeToTone(ev.event_type),
      orderNumber: idx + 1,
    }));
  }, [mode, livePositions, timeline]);

  const timelineDistanceKm = useMemo(() => {
    if (!timeline || timeline.events.length < 2) return 0;
    return computeRouteTotalDistanceKm(timeline.events.map((ev) => ({lat: ev.lat, lng: ev.lng})));
  }, [timeline]);

  const liveMetrics = useMemo(() => {
    const tracked = livePositions.filter((p) => p.lat !== null && p.lng !== null).length;
    const totalTodayPings = livePositions.reduce((s, p) => s + Number(p.today_events_count ?? 0), 0);
    const totalActiveShipments = livePositions.reduce((s, p) => s + Number(p.active_shipments_count ?? 0), 0);
    return {
      totalCouriers: livePositions.length,
      trackedCouriers: tracked,
      totalTodayPings,
      totalActiveShipments,
    };
  }, [livePositions]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">تحركات مندوب الشحن والخريطة الحية</h1>
          <p className="mt-1 text-xs text-slate-500">
            متابعة مواقع المناديب أثناء المهام النشطة واستعراض خط السير ونقاط التسليم والالتقاط.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canRecord && (
            <>
              <button
                type="button"
                disabled={recordingPin}
                onClick={() => void handleBrowserGpsPing()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap"
              >
                <LocateFixed className="h-3.5 w-3.5" />
                <span>{recordingPin ? 'جاري الالتقاط...' : 'تسجيل موقع GPS الآن'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowManualPinForm((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <MapPin className="h-3.5 w-3.5" />
                <span>تثبيت نقطة يدوية</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => (mode === 'live' ? void loadLivePositions() : void loadTimeline())}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5">
        {!isBoundCourier && (
          <button
            type="button"
            onClick={() => setMode('live')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
              mode === 'live' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Navigation className="h-3.5 w-3.5" />
            <span>المراقبة الحية للمناديب</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setMode('timeline')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
            mode === 'timeline' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <RouteIcon className="h-3.5 w-3.5" />
          <span>مسار مندوب محدد زمنيًا</span>
        </button>
      </div>

      {/* KPI Strip */}
      {mode === 'live' ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">إجمالي المناديب</div>
            <div className="mt-1 font-mono-tabular text-2xl font-bold text-slate-900">
              {liveMetrics.totalCouriers}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">مناديب لهم موقع مسجل</div>
            <div className="mt-1 font-mono-tabular text-2xl font-bold text-emerald-700">
              {liveMetrics.trackedCouriers}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">شحنات قيد التنفيذ الميداني</div>
            <div className="mt-1 font-mono-tabular text-2xl font-bold text-sky-700">
              {liveMetrics.totalActiveShipments}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">نقاط التتبع المرصودة اليوم</div>
            <div className="mt-1 font-mono-tabular text-2xl font-bold text-slate-900">
              {liveMetrics.totalTodayPings}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">نقاط المسار في الفترة</div>
            <div className="mt-1 font-mono-tabular text-2xl font-bold text-slate-900">
              {timeline?.events.length ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">محطات التسليم المسجلة</div>
            <div className="mt-1 font-mono-tabular text-2xl font-bold text-sky-700">
              {(timeline?.events ?? []).filter((e) => e.event_type === 'delivery_attempt').length}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">المهام النشطة حاليًا</div>
            <div className="mt-1 font-mono-tabular text-2xl font-bold text-emerald-700">
              {timeline?.active_shipments.length ?? 0}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-xs text-slate-500">المسافة التقديرية (كم)</div>
            <div className="mt-1 font-mono-tabular text-2xl font-bold text-slate-900">
              {timelineDistanceKm.toFixed(2)}
            </div>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <section className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-4 items-end">
        {mode === 'live' ? (
          <div className="sm:col-span-2">
            <label htmlFor="mv-branch" className="block text-xs font-medium text-slate-700">
              تصفية حسب الفرع
            </label>
            <select
              id="mv-branch"
              value={selectedBranchId}
              onChange={(e) => setSelectedBranchId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <option value="">جميع الفروع</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="mv-courier" className="block text-xs font-medium text-slate-700">
                مندوب الشحن
              </label>
              <select
                id="mv-courier"
                disabled={isBoundCourier}
                value={selectedCourierId}
                onChange={(e) => setSelectedCourierId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs disabled:bg-slate-50"
              >
                {couriers.length === 0 ? (
                  <option value="">لا يوجد مناديب مسجلون بعد</option>
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
              <label htmlFor="mv-from" className="block text-xs font-medium text-slate-700">
                من تاريخ
              </label>
              <input
                id="mv-from"
                type="date"
                dir="ltr"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
              />
            </div>

            <div>
              <label htmlFor="mv-to" className="block text-xs font-medium text-slate-700">
                إلى تاريخ
              </label>
              <input
                id="mv-to"
                type="date"
                dir="ltr"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
              />
            </div>

            <button
              type="button"
              onClick={() => void loadTimeline()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
            >
              عرض مسار الفترة
            </button>
          </>
        )}
      </section>

      {/* Manual Pin Form */}
      {showManualPinForm && canRecord && (
        <form
          onSubmit={(e) => void handleManualPinSubmit(e)}
          className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-5 items-end"
        >
          <div>
            <label htmlFor="pin-type" className="block text-xs font-medium text-slate-700">
              نوع النقطة
            </label>
            <select
              id="pin-type"
              value={manualEventType}
              onChange={(e) => setManualEventType(e.target.value as LocationEventType)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              {(Object.keys(LOCATION_EVENT_TYPE_LABELS) as LocationEventType[]).map((k) => (
                <option key={k} value={k}>
                  {LOCATION_EVENT_TYPE_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="pin-lat" className="block text-xs font-medium text-slate-700">
              خط العرض (Lat)
            </label>
            <input
              id="pin-lat"
              type="number"
              step="0.000001"
              dir="ltr"
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-tabular text-xs"
            />
          </div>
          <div>
            <label htmlFor="pin-lng" className="block text-xs font-medium text-slate-700">
              خط الطول (Lng)
            </label>
            <input
              id="pin-lng"
              type="number"
              step="0.000001"
              dir="ltr"
              value={manualLng}
              onChange={(e) => setManualLng(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-tabular text-xs"
            />
          </div>
          <div>
            <label htmlFor="pin-notes" className="block text-xs font-medium text-slate-700">
              ملاحظة ميدانية
            </label>
            <input
              id="pin-notes"
              type="text"
              value={manualNotes}
              onChange={(e) => setManualNotes(e.target.value)}
              placeholder="مثال: بداية خط المعادي"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            />
          </div>
          <button
            type="submit"
            disabled={recordingPin}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            حفظ النقطة
          </button>
        </form>
      )}

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-xs font-medium ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Map Canvas */}
      <CourierMapCanvas
        markers={mapMarkers}
        drawRouteLine={mode === 'timeline'}
        selectedMarkerId={selectedMarkerId}
        onSelectMarker={(id) => setSelectedMarkerId(id)}
        emptyTitle={
          mode === 'live'
            ? 'لا توجد مواقع حية مسجلة للمناديب حاليًا'
            : 'لا توجد نقاط تحرك مسجلة لهذا المندوب خلال الفترة المحددة'
        }
      />

      {/* Detailed Table */}
      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
          جاري تحميل بيانات التحركات...
        </div>
      ) : mode === 'live' ? (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">جدول الحالة المكانية للمناديب</h2>
          </div>
          <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">المندوب</th>
                <th className="px-4 py-3 font-medium">الفرع</th>
                <th className="px-4 py-3 font-medium">آخر إحداثيات</th>
                <th className="px-4 py-3 font-medium">المهام النشطة</th>
                <th className="px-4 py-3 font-medium">آخر شحنة / حدث</th>
                <th className="px-4 py-3 font-medium">آخر تحديث</th>
                <th className="px-4 py-3 font-medium">إجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {livePositions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                    لا يوجد مناديب مسجلون في النطاق المختار.
                  </td>
                </tr>
              ) : (
                livePositions.map((pos) => (
                  <tr key={pos.courier_id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Truck className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                        <div>
                          <div className="font-semibold text-slate-900">{pos.courier_name}</div>
                          <div className="font-mono-tabular text-[11px] text-slate-500">
                            {pos.courier_code} · {pos.courier_mobile}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{pos.branch_name ?? '—'}</td>
                    <td className="px-4 py-3 font-mono-tabular text-slate-700">
                      {pos.lat !== null && pos.lng !== null ? (
                        <a
                          href={buildExternalMapPinUrl(pos.lat, pos.lng)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sky-700 hover:underline"
                          dir="ltr"
                        >
                          <span>{formatCoordinatesLabel(pos.lat, pos.lng)}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-slate-400">لم يُرسل موقع بعد</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">
                      {pos.active_shipments_count}
                    </td>
                    <td className="px-4 py-3">
                      {pos.last_shipment_number ? (
                        <Link
                          to={`${basePath}/shipments/${pos.last_shipment_id}`}
                          className="font-mono-tabular font-semibold text-sky-700 hover:underline"
                        >
                          {pos.last_shipment_number}
                        </Link>
                      ) : pos.event_type ? (
                        <span className="text-slate-600">{LOCATION_EVENT_TYPE_LABELS[pos.event_type]}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-slate-500">
                      {pos.last_recorded_at
                        ? new Date(pos.last_recorded_at).toLocaleString('ar-EG')
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCourierId(pos.courier_id);
                          setMode('timeline');
                        }}
                        className="rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                      >
                        عرض المسار
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      ) : (
        <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">
              السجل الزمني لنقاط التحرك {timeline ? `· ${timeline.courier.name}` : ''}
            </h2>
            <span className="font-mono-tabular text-xs text-slate-500">
              {dateFrom} ← {dateTo}
            </span>
          </div>
          <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">التوقيت</th>
                <th className="px-4 py-3 font-medium">الحدث</th>
                <th className="px-4 py-3 font-medium">الشحنة / المستلم</th>
                <th className="px-4 py-3 font-medium">الإحداثيات</th>
                <th className="px-4 py-3 font-medium">المصدر والدقة</th>
                <th className="px-4 py-3 font-medium">ملاحظات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {!timeline || timeline.events.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                    لا توجد نقاط مسجلة للمندوب في هذه الفترة.
                  </td>
                </tr>
              ) : (
                timeline.events.map((ev, index) => (
                  <tr
                    key={ev.id}
                    onClick={() => setSelectedMarkerId(ev.id)}
                    className={`cursor-pointer hover:bg-slate-50 ${
                      selectedMarkerId === ev.id ? 'bg-slate-50' : ''
                    }`}
                  >
                    <td className="px-4 py-3 font-mono-tabular font-bold text-slate-700">{index + 1}</td>
                    <td className="px-4 py-3 font-mono-tabular text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3 text-slate-400" />
                        {new Date(ev.recorded_at).toLocaleString('ar-EG')}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {LOCATION_EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}
                    </td>
                    <td className="px-4 py-3">
                      {ev.shipment_number ? (
                        <div>
                          <Link
                            to={`${basePath}/shipments/${ev.shipment_id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono-tabular font-semibold text-sky-700 hover:underline"
                          >
                            {ev.shipment_number}
                          </Link>
                          {ev.recipient_name && (
                            <p className="text-[11px] text-slate-500">{ev.recipient_name}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular">
                      <a
                        href={buildExternalMapPinUrl(ev.lat, ev.lng)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        dir="ltr"
                        className="inline-flex items-center gap-1 text-sky-700 hover:underline"
                      >
                        <span>{formatCoordinatesLabel(ev.lat, ev.lng)}</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <span>{LOCATION_SOURCE_LABELS[ev.source] ?? ev.source}</span>
                      {ev.accuracy_meters !== null && (
                        <span className="font-mono-tabular text-[11px] text-slate-500">
                          {' '}
                          · {Math.round(ev.accuracy_meters)} م
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{ev.notes ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
