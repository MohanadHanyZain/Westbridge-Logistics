import {useEffect, useMemo, useRef, useState} from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  DEFAULT_EGYPT_MAP_CENTER,
  buildExternalMapPinUrl,
  computeRouteTotalDistanceKm,
  formatCoordinatesLabel,
  getMapboxAccessToken,
  isValidCoordinatePair,
  toMapboxLngLat,
} from '@/lib/maps';
import {ExternalLink, MapPinned, Navigation, Route as RouteIcon} from 'lucide-react';

export interface CourierMapMarkerItem {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly title: string;
  readonly subtitle: string;
  readonly badgeText?: string;
  readonly accuracyMeters?: number | null;
  readonly recordedAt?: string | null;
  readonly shipmentNumber?: string | null;
  readonly tone: 'live' | 'start' | 'delivery' | 'pickup' | 'end' | 'ping';
  readonly orderNumber?: number;
}

interface CourierMapCanvasProps {
  readonly markers: readonly CourierMapMarkerItem[];
  readonly drawRouteLine?: boolean;
  readonly selectedMarkerId?: string | null;
  readonly onSelectMarker?: (id: string) => void;
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
}

const ROUTE_SOURCE_ID = 'courier-route-source';
const ROUTE_LAYER_ID = 'courier-route-layer';

const PIN_TONE_STYLES: Record<
  CourierMapMarkerItem['tone'],
  {readonly bg: string; readonly border: string; readonly label: string}
> = {
  live: {bg: '#0f172a', border: '#020617', label: 'موقع حي'},
  start: {bg: '#047857', border: '#064e3b', label: 'بدء الوردية'},
  delivery: {bg: '#0369a1', border: '#0c4a6e', label: 'نقطة توصيل'},
  pickup: {bg: '#7c3aed', border: '#4c1d95', label: 'نقطة التقاط'},
  end: {bg: '#b91c1c', border: '#7f1d1d', label: 'نهاية الوردية'},
  ping: {bg: '#475569', border: '#1e293b', label: 'تحديث مسار'},
};

function createMarkerElement(item: CourierMapMarkerItem, isSelected: boolean): HTMLButtonElement {
  const palette = PIN_TONE_STYLES[item.tone];
  const el = document.createElement('button');
  el.type = 'button';
  el.setAttribute('aria-label', item.title);
  el.title = item.title;
  el.style.width = isSelected ? '34px' : '28px';
  el.style.height = isSelected ? '34px' : '28px';
  el.style.borderRadius = '9999px';
  el.style.backgroundColor = palette.bg;
  el.style.border = isSelected ? '3px solid #ffffff' : `2px solid ${palette.border}`;
  el.style.boxShadow = isSelected
    ? '0 0 0 3px rgba(15, 23, 42, 0.35), 0 4px 10px rgba(0,0,0,0.28)'
    : '0 2px 6px rgba(0,0,0,0.28)';
  el.style.color = '#ffffff';
  el.style.fontSize = '11px';
  el.style.fontWeight = '700';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.cursor = 'pointer';
  el.style.transition = 'transform 120ms ease';
  el.textContent = item.orderNumber !== undefined ? String(item.orderNumber) : '•';
  return el;
}

function createPopupDom(item: CourierMapMarkerItem): HTMLDivElement {
  const root = document.createElement('div');
  root.dir = 'rtl';
  root.style.textAlign = 'right';
  root.style.fontSize = '12px';
  root.style.lineHeight = '1.5';
  root.style.minWidth = '180px';
  root.style.maxWidth = '250px';
  root.style.color = '#1e293b';

  const titleEl = document.createElement('p');
  titleEl.style.fontWeight = '700';
  titleEl.style.color = '#0f172a';
  titleEl.style.margin = '0 0 2px';
  titleEl.textContent = item.title;
  root.appendChild(titleEl);

  const subEl = document.createElement('p');
  subEl.style.color = '#475569';
  subEl.style.margin = '0 0 4px';
  subEl.textContent = item.subtitle;
  root.appendChild(subEl);

  if (item.shipmentNumber) {
    const shpEl = document.createElement('p');
    shpEl.style.fontFamily = 'monospace';
    shpEl.style.fontSize = '11px';
    shpEl.style.fontWeight = '600';
    shpEl.style.color = '#0369a1';
    shpEl.style.margin = '0 0 2px';
    shpEl.textContent = `الشحنة: ${item.shipmentNumber}`;
    root.appendChild(shpEl);
  }

  const coordsEl = document.createElement('p');
  coordsEl.style.fontFamily = 'monospace';
  coordsEl.style.fontSize = '11px';
  coordsEl.style.color = '#64748b';
  coordsEl.style.margin = '0';
  coordsEl.textContent = `${formatCoordinatesLabel(item.lat, item.lng)}${
    item.accuracyMeters !== null && item.accuracyMeters !== undefined
      ? ` · دقة ${Math.round(item.accuracyMeters)} م`
      : ''
  }`;
  root.appendChild(coordsEl);

  if (item.recordedAt) {
    const timeEl = document.createElement('p');
    timeEl.style.fontFamily = 'monospace';
    timeEl.style.fontSize = '11px';
    timeEl.style.color = '#64748b';
    timeEl.style.margin = '2px 0 0';
    timeEl.textContent = new Date(item.recordedAt).toLocaleString('ar-EG');
    root.appendChild(timeEl);
  }

  return root;
}

function InteractiveMapboxViewport({
  accessToken,
  markers,
  drawRouteLine,
  selectedId,
  onSelect,
}: {
  readonly accessToken: string;
  readonly markers: readonly CourierMapMarkerItem[];
  readonly drawRouteLine: boolean;
  readonly selectedId: string | null;
  readonly onSelect: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setMapError(null);
    setMapLoaded(false);

    mapboxgl.accessToken = accessToken;

    const initialTarget = markers.length > 0 ? markers[markers.length - 1] : DEFAULT_EGYPT_MAP_CENTER;
    const [initialLng, initialLat] = toMapboxLngLat(initialTarget);

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container,
        style: 'mapbox://styles/mapbox/streets-v12',
        // Mapbox GL JS strictly uses [lng, lat] order
        center: [initialLng, initialLat],
        zoom: markers.length > 0 ? 12 : 11,
        attributionControl: true,
      });
    } catch {
      setMapError('تعذر تهيئة محرك Mapbox GL JS في المتصفح.');
      return;
    }

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({visualizePitch: true}), 'top-left');

    map.on('load', () => {
      setMapLoaded(true);
    });

    map.on('error', (event) => {
      const status = (event as {error?: {status?: number}})?.error?.status;
      if (status === 401 || status === 403) {
        setMapError('تعذر التحقق من رمز Mapbox العام (VITE_MAPBOX_ACCESS_TOKEN).');
      }
    });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        map.resize();
      });
      resizeObserver.observe(container);
    }

    return () => {
      resizeObserver?.disconnect();
      for (const marker of markersRef.current) {
        marker.remove();
      }
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      setMapLoaded(false);
    };
    // Initialize map once per accessToken change; markers & route updates are synced below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear previous markers
    for (const existing of markersRef.current) {
      existing.remove();
    }
    markersRef.current = [];

    // Re-create markers strictly with [lng, lat] order
    for (const item of markers) {
      const isSelected = selectedId === item.id;
      const el = createMarkerElement(item, isSelected);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectRef.current(item.id);
      });

      const popup = new mapboxgl.Popup({offset: 20, closeButton: true}).setDOMContent(
        createPopupDom(item),
      );
      popup.on('close', () => {
        if (selectedId === item.id) {
          onSelectRef.current(null);
        }
      });

      const [lng, lat] = toMapboxLngLat(item);
      const marker = new mapboxgl.Marker({element: el})
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(map);

      if (isSelected) {
        marker.togglePopup();
      }

      markersRef.current.push(marker);
    }

    // Sync GeoJSON route polyline strictly in [lng, lat] order once style is loaded
    if (mapLoaded) {
      const routeCoordinates =
        drawRouteLine && markers.length >= 2
          ? markers.map((m) => toMapboxLngLat(m) as [number, number])
          : [];

      const featureCollection = {
        type: 'FeatureCollection' as const,
        features:
          routeCoordinates.length >= 2
            ? [
                {
                  type: 'Feature' as const,
                  properties: {},
                  geometry: {
                    type: 'LineString' as const,
                    coordinates: routeCoordinates,
                  },
                },
              ]
            : [],
      };

      const existingSource = map.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      if (existingSource) {
        existingSource.setData(featureCollection);
      } else {
        map.addSource(ROUTE_SOURCE_ID, {
          type: 'geojson',
          data: featureCollection,
        });
        map.addLayer({
          id: ROUTE_LAYER_ID,
          type: 'line',
          source: ROUTE_SOURCE_ID,
          layout: {
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#0369a1',
            'line-width': 4,
            'line-opacity': 0.85,
          },
        });
      }
    }

    // Frame camera around markers using [lng, lat]
    if (markers.length === 1) {
      const [lng, lat] = toMapboxLngLat(markers[0]);
      map.flyTo({center: [lng, lat], zoom: 14, duration: 400});
    } else if (markers.length > 1) {
      const bounds = new mapboxgl.LngLatBounds();
      for (const m of markers) {
        const [lng, lat] = toMapboxLngLat(m);
        bounds.extend([lng, lat]);
      }
      map.fitBounds(bounds, {padding: 52, maxZoom: 15, duration: 400});
    }
  }, [mapLoaded, markers, drawRouteLine, selectedId]);

  if (mapError) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-xs text-amber-900"
      >
        <p className="font-semibold">تعذر تحميل خرائط Mapbox GL التفاعلية</p>
        <p className="mt-1 leading-relaxed text-amber-800">
          {mapError} تحقق من صلاحية الرمز{' '}
          <span dir="ltr" className="font-mono font-semibold">
            VITE_MAPBOX_ACCESS_TOKEN
          </span>{' '}
          في إعدادات البيئة.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      dir="ltr"
      data-testid="mapbox-canvas-container"
      className="h-[460px] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100"
    />
  );
}

export function CourierMapCanvas({
  markers,
  drawRouteLine = false,
  selectedMarkerId = null,
  onSelectMarker,
  emptyTitle = 'لا توجد إحداثيات مسجلة في النطاق المحدد',
  emptyDescription = 'تبدأ النقاط بالظهور تلقائيًا بمجرد إرسال المندوب لموقعه أثناء المهام النشطة أو عند تسجيل التسليم.',
}: CourierMapCanvasProps) {
  const accessToken = getMapboxAccessToken();
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(selectedMarkerId);

  const activeSelectedId = selectedMarkerId ?? internalSelectedId;
  const handleSelect = (id: string | null) => {
    setInternalSelectedId(id);
    if (id && onSelectMarker) {
      onSelectMarker(id);
    }
  };

  const validMarkers = useMemo(
    () => markers.filter((m) => isValidCoordinatePair(m.lat, m.lng)),
    [markers],
  );

  const totalDistanceKm = useMemo(
    () =>
      drawRouteLine
        ? computeRouteTotalDistanceKm(validMarkers.map((m) => ({lat: m.lat, lng: m.lng})))
        : 0,
    [drawRouteLine, validMarkers],
  );

  return (
    <div className="space-y-4">
      {accessToken ? (
        <InteractiveMapboxViewport
          accessToken={accessToken}
          markers={validMarkers}
          drawRouteLine={drawRouteLine}
          selectedId={activeSelectedId}
          onSelect={handleSelect}
        />
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-slate-700">
                <MapPinned className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  لوحة التتبع والإحداثيات (وضع التهيئة الميدانية لـ Mapbox GL JS)
                </h2>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-600">
                  لعرض الخريطة التفاعلية من Mapbox GL JS مباشرة هنا، أضف رمز المتصفح العام{' '}
                  <span dir="ltr" className="font-mono font-semibold text-slate-800">
                    VITE_MAPBOX_ACCESS_TOKEN
                  </span>{' '}
                  (يبدأ بـ <span dir="ltr" className="font-mono">pk.</span>) في إعدادات البيئة. تبقى جميع
                  الإحداثيات وروابط الفتح المباشر في الخرائط متاحة أدناه دون توقف.
                </p>
              </div>
            </div>

            {drawRouteLine && validMarkers.length >= 2 && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                <span className="text-slate-500">المسافة التقديرية للمسار: </span>
                <span className="font-mono-tabular font-bold text-slate-900">
                  {totalDistanceKm.toFixed(2)} كم
                </span>
              </div>
            )}
          </div>

          {validMarkers.length === 0 ? (
            <div className="py-12 text-center">
              <Navigation className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-800">{emptyTitle}</p>
              <p className="mt-1 text-xs text-slate-500">{emptyDescription}</p>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {validMarkers.map((item) => {
                const palette = PIN_TONE_STYLES[item.tone];
                const isSelected = activeSelectedId === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => handleSelect(item.id)}
                    className={`cursor-pointer rounded-lg border p-3.5 transition-colors ${
                      isSelected
                        ? 'border-slate-900 bg-slate-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono-tabular text-[11px] font-bold text-white"
                          style={{backgroundColor: palette.bg}}
                        >
                          {item.orderNumber !== undefined ? item.orderNumber : '•'}
                        </span>
                        <div>
                          <p className="text-xs font-semibold text-slate-900">{item.title}</p>
                          <p className="text-[11px] text-slate-500">{palette.label}</p>
                        </div>
                      </div>

                      <a
                        href={buildExternalMapPinUrl(item.lat, item.lng)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <ExternalLink className="h-3 w-3" />
                        <span>خريطة</span>
                      </a>
                    </div>

                    <p className="mt-2 text-xs text-slate-700">{item.subtitle}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 font-mono-tabular text-[11px] text-slate-500">
                      <span dir="ltr">{formatCoordinatesLabel(item.lat, item.lng)}</span>
                      {item.accuracyMeters !== null && item.accuracyMeters !== undefined && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>دقة {Math.round(item.accuracyMeters)}م</span>
                        </>
                      )}
                      {item.shipmentNumber && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-sky-700">{item.shipmentNumber}</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {validMarkers.length > 0 && drawRouteLine && accessToken && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-600">
          <div className="flex items-center gap-2">
            <RouteIcon className="h-4 w-4 text-sky-700" />
            <span>
              إجمالي النقاط المرصودة:{' '}
              <strong className="font-mono-tabular text-slate-900">{validMarkers.length}</strong>
            </span>
          </div>
          <div className="font-mono-tabular">
            المسافة التقديرية بين النقاط: <strong className="text-slate-900">{totalDistanceKm.toFixed(2)} كم</strong>
          </div>
        </div>
      )}
    </div>
  );
}