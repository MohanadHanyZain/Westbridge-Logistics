import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {
  deleteRouteStop,
  listCourierRoutes,
  listDrivers,
  listRouteStops,
  listVehicles,
  saveCourierRoute,
  saveDriver,
  saveRouteStop,
  saveVehicle,
} from '@/features/couriers/couriersService';
import {generateNextCode, listGovernorates, listRegions} from '@/features/definitions/definitionsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {
  CourierRouteRecord,
  CourierRouteStopRecord,
  DriverRecord,
  VehicleRecord,
  VehicleType,
} from '@/types/couriers';
import type {GovernorateRecord, RegionRecord} from '@/types/definitions';
import {MapPin, Plus, ShieldCheck, Trash2, Truck, UserCheck} from 'lucide-react';

const VEHICLE_LABELS: Record<VehicleType, string> = {
  motorcycle: 'دراجة نارية (موتوسيكل)',
  car: 'سيارة ملاكي',
  van: 'فان / ميكروباص شحن',
  truck: 'شاحنة نقل',
};

export function CourierRoutesPage() {
  const {tenant, isAdmin, can} = useTenantWorkspace();
  const canManage = isAdmin || can('couriers.manage');

  const [tab, setTab] = useState<'routes' | 'vehicles' | 'drivers'>('routes');
  const [routes, setRoutes] = useState<readonly CourierRouteRecord[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [stops, setStops] = useState<readonly CourierRouteStopRecord[]>([]);
  const [vehicles, setVehicles] = useState<readonly VehicleRecord[]>([]);
  const [drivers, setDrivers] = useState<readonly DriverRecord[]>([]);
  const [governorates, setGovernorates] = useState<readonly GovernorateRecord[]>([]);
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Route form
  const [showRouteForm, setShowRouteForm] = useState(false);
  const [rtCode, setRtCode] = useState('');
  const [rtName, setRtName] = useState('');
  const [rtVehicleId, setRtVehicleId] = useState('');
  const [rtDriverId, setRtDriverId] = useState('');

  // Stop form
  const [stopOrder, setStopOrder] = useState(1);
  const [stopGovId, setStopGovId] = useState('');
  const [stopRegionId, setStopRegionId] = useState('');

  // Vehicle form
  const [vhCode, setVhCode] = useState('');
  const [vhName, setVhName] = useState('');
  const [vhPlate, setVhPlate] = useState('');
  const [vhType, setVhType] = useState<VehicleType>('van');

  // Driver form
  const [drCode, setDrCode] = useState('');
  const [drName, setDrName] = useState('');
  const [drMobile, setDrMobile] = useState('');
  const [drLicense, setDrLicense] = useState('');

  const loadStops = useCallback(
    async (routeId: string) => {
      if (!routeId) {
        setStops([]);
        return;
      }
      const rows = await listRouteStops(tenant.id, routeId);
      setStops(rows);
      const maxOrder = rows.reduce((max, s) => Math.max(max, s.stop_order), 0);
      setStopOrder(maxOrder + 1);
    },
    [tenant.id],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rtRows, vhRows, drRows, gRows, rRows] = await Promise.all([
        listCourierRoutes(tenant.id),
        listVehicles(tenant.id),
        listDrivers(tenant.id),
        listGovernorates(tenant.id),
        listRegions(tenant.id),
      ]);
      setRoutes(rtRows);
      setVehicles(vhRows);
      setDrivers(drRows);
      setGovernorates(gRows);
      setRegions(rRows);

      const targetRoute = selectedRouteId && rtRows.some((r) => r.id === selectedRouteId)
        ? selectedRouteId
        : (rtRows[0]?.id ?? '');
      setSelectedRouteId(targetRoute);
      if (targetRoute) {
        await loadStops(targetRoute);
      }

      if (!stopGovId && gRows.length > 0) setStopGovId(gRows[0].id);
      setVhCode(generateNextCode('VH', vhRows.map((v) => v.code)));
      setDrCode(generateNextCode('DR', drRows.map((d) => d.code)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل خطوط السير والمركبات.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id, selectedRouteId, loadStops, stopGovId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === selectedRouteId) ?? null,
    [routes, selectedRouteId],
  );

  const vehicleMap = useMemo(() => new Map(vehicles.map((v) => [v.id, v])), [vehicles]);
  const driverMap = useMemo(() => new Map(drivers.map((d) => [d.id, d])), [drivers]);
  const govMap = useMemo(() => new Map(governorates.map((g) => [g.id, g.name])), [governorates]);
  const regMap = useMemo(() => new Map(regions.map((r) => [r.id, r.name])), [regions]);

  const stopRegions = useMemo(
    () => regions.filter((r) => !stopGovId || r.governorate_id === stopGovId),
    [regions, stopGovId],
  );

  const handleOpenRouteForm = () => {
    setRtCode(generateNextCode('RT', routes.map((r) => r.code)));
    setRtName('');
    setRtVehicleId('');
    setRtDriverId('');
    setShowRouteForm(true);
    setFeedback(null);
    setError(null);
  };

  const handleSaveRoute = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const createdId = await saveCourierRoute(tenant.id, {
        code: rtCode,
        name: rtName,
        description: null,
        vehicle_id: rtVehicleId || null,
        driver_id: rtDriverId || null,
        is_active: true,
      });
      setShowRouteForm(false);
      setSelectedRouteId(createdId);
      setFeedback('تم إنشاء خط السير بنجاح.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ خط السير.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddStop = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedRouteId || !stopGovId) return;
    setSaving(true);
    setError(null);
    try {
      await saveRouteStop(tenant.id, {
        route_id: selectedRouteId,
        stop_order: stopOrder,
        governorate_id: stopGovId,
        region_id: stopRegionId || null,
        notes: null,
      });
      setFeedback('تمت إضافة المحطة إلى خط السير.');
      await loadStops(selectedRouteId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إضافة المحطة.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStop = async (stopId: string) => {
    try {
      await deleteRouteStop(tenant.id, stopId);
      setFeedback('تم حذف المحطة من خط السير.');
      await loadStops(selectedRouteId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حذف المحطة.');
    }
  };

  const handleSaveVehicle = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveVehicle(tenant.id, {
        code: vhCode,
        name: vhName,
        plate_number: vhPlate || null,
        vehicle_type: vhType,
        capacity_kg: null,
        is_active: true,
      });
      setVhName('');
      setVhPlate('');
      setFeedback('تمت إضافة السيارة بنجاح.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ السيارة.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveDriver = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveDriver(tenant.id, {
        code: drCode,
        name: drName,
        mobile: drMobile || null,
        license_number: drLicense || null,
        is_active: true,
      });
      setDrName('');
      setDrMobile('');
      setDrLicense('');
      setFeedback('تمت إضافة السائق بنجاح.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ السائق.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="py-10 text-center text-sm text-slate-500">جاري تحميل خطوط السير والسيارات والسائقين...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">خطوط سير المندوبين والسيارات والسائقون</h1>
          <p className="mt-1 text-xs text-slate-500">
            إدارة خطوط السير والمحطات المرتبة، وتعريف مركبات الشركة وسائقيها.
          </p>
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-1 text-xs">
          <button
            type="button"
            onClick={() => setTab('routes')}
            className={`inline-flex items-center gap-1 rounded px-3 py-1.5 font-medium ${
              tab === 'routes' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            <MapPin className="h-3.5 w-3.5" />
            خطوط السير ({routes.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('vehicles')}
            className={`inline-flex items-center gap-1 rounded px-3 py-1.5 font-medium ${
              tab === 'vehicles' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Truck className="h-3.5 w-3.5" />
            السيارات ({vehicles.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('drivers')}
            className={`inline-flex items-center gap-1 rounded px-3 py-1.5 font-medium ${
              tab === 'drivers' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
            }`}
          >
            <UserCheck className="h-3.5 w-3.5" />
            السائقون ({drivers.length})
          </button>
        </div>
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

      {tab === 'routes' && (
        <div className="space-y-4">
          {canManage && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleOpenRouteForm}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                <Plus className="h-4 w-4" />
                إضافة خط سير جديد
              </button>
            </div>
          )}

          {showRouteForm && (
            <form onSubmit={handleSaveRoute} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-5 items-end">
              <div>
                <label htmlFor="rt-code" className="block text-xs font-medium text-slate-700">
                  كود خط السير *
                </label>
                <input
                  id="rt-code"
                  required
                  dir="ltr"
                  value={rtCode}
                  onChange={(e) => setRtCode(e.target.value.toUpperCase())}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>
              <div>
                <label htmlFor="rt-name" className="block text-xs font-medium text-slate-700">
                  اسم خط السير *
                </label>
                <input
                  id="rt-name"
                  required
                  value={rtName}
                  onChange={(e) => setRtName(e.target.value)}
                  placeholder="خط شرق القاهرة"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label htmlFor="rt-veh" className="block text-xs font-medium text-slate-700">
                  السيارة (اختياري)
                </label>
                <select
                  id="rt-veh"
                  value={rtVehicleId}
                  onChange={(e) => setRtVehicleId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="">بدون سيارة محددة</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.code} — {v.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="rt-drv" className="block text-xs font-medium text-slate-700">
                  السائق (اختياري)
                </label>
                <select
                  id="rt-drv"
                  value={rtDriverId}
                  onChange={(e) => setRtDriverId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="">بدون سائق محدد</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.code} — {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={saving} className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white">
                  حفظ الخط
                </button>
                <button type="button" onClick={() => setShowRouteForm(false)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700">
                  إلغاء
                </button>
              </div>
            </form>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <aside className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 lg:col-span-4">
              <h2 className="border-b border-slate-100 pb-2 text-sm font-semibold text-slate-900">
                خطوط السير المتاحة ({routes.length})
              </h2>
              <div className="space-y-1.5">
                {routes.map((r) => {
                  const active = r.id === selectedRouteId;
                  const veh = r.vehicle_id ? vehicleMap.get(r.vehicle_id) : null;
                  const drv = r.driver_id ? driverMap.get(r.driver_id) : null;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        setSelectedRouteId(r.id);
                        void loadStops(r.id);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg border p-3 text-right text-xs transition-colors ${
                        active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <div>
                        <p className="font-semibold">{r.name}</p>
                        <p className={`font-mono-tabular ${active ? 'text-slate-300' : 'text-slate-500'}`}>
                          {r.code}
                          {veh ? ` · ${veh.name}` : ''}
                          {drv ? ` · ${drv.name}` : ''}
                        </p>
                      </div>
                      {r.is_system_default && <ShieldCheck className="h-4 w-4 shrink-0 opacity-75" />}
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 lg:col-span-8">
              <div className="border-b border-slate-100 pb-3">
                <h2 className="text-sm font-semibold text-slate-900">
                  محطات خط السير: {selectedRoute?.name ?? '—'}
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  أضف المحطات بالترتيب (رقم السطر 1، 2، 3...) وحدد المحافظة والمنطقة لكل محطة.
                </p>
              </div>

              {canManage && selectedRoute && (
                <form onSubmit={handleAddStop} className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 sm:grid-cols-4 items-end">
                  <div>
                    <label htmlFor="st-order" className="block text-xs font-medium text-slate-700">
                      رقم السطر / الترتيب *
                    </label>
                    <input
                      id="st-order"
                      type="number"
                      min="1"
                      required
                      dir="ltr"
                      value={stopOrder}
                      onChange={(e) => setStopOrder(Number(e.target.value))}
                      className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 font-mono-tabular text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="st-gov" className="block text-xs font-medium text-slate-700">
                      الإقليم / المحافظة *
                    </label>
                    <select
                      id="st-gov"
                      required
                      value={stopGovId}
                      onChange={(e) => {
                        setStopGovId(e.target.value);
                        setStopRegionId('');
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
                    <label htmlFor="st-reg" className="block text-xs font-medium text-slate-700">
                      المنطقة (اختياري)
                    </label>
                    <select
                      id="st-reg"
                      value={stopRegionId}
                      onChange={(e) => setStopRegionId(e.target.value)}
                      className="mt-1 w-full rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs"
                    >
                      <option value="">كامل المحافظة</option>
                      {stopRegions.map((rg) => (
                        <option key={rg.id} value={rg.id}>
                          {rg.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" disabled={saving} className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white">
                    + إضافة محطة
                  </button>
                </form>
              )}

              {stops.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">لا توجد محطات مسجلة على هذا الخط بعد.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">رقم السطر</th>
                        <th className="px-4 py-2.5 font-semibold">المحافظة</th>
                        <th className="px-4 py-2.5 font-semibold">المنطقة</th>
                        <th className="px-4 py-2.5 font-semibold">حذف</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {stops.map((st) => (
                        <tr key={st.id}>
                          <td className="px-4 py-2.5 font-mono-tabular font-semibold text-slate-900">{st.stop_order}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-900">{govMap.get(st.governorate_id) ?? '—'}</td>
                          <td className="px-4 py-2.5 text-slate-600">
                            {st.region_id ? regMap.get(st.region_id) ?? '—' : 'كامل المحافظة'}
                          </td>
                          <td className="px-4 py-2.5">
                            {canManage && (
                              <button
                                type="button"
                                onClick={() => void handleDeleteStop(st.id)}
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
        </div>
      )}

      {tab === 'vehicles' && (
        <div className="space-y-4">
          {canManage && (
            <form onSubmit={handleSaveVehicle} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-5 items-end">
              <div>
                <label htmlFor="vh-code" className="block text-xs font-medium text-slate-700">الكود *</label>
                <input
                  id="vh-code"
                  required
                  dir="ltr"
                  value={vhCode}
                  onChange={(e) => setVhCode(e.target.value.toUpperCase())}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>
              <div>
                <label htmlFor="vh-name" className="block text-xs font-medium text-slate-700">اسم / موديل السيارة *</label>
                <input
                  id="vh-name"
                  required
                  value={vhName}
                  onChange={(e) => setVhName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label htmlFor="vh-plate" className="block text-xs font-medium text-slate-700">رقم اللوحة</label>
                <input
                  id="vh-plate"
                  value={vhPlate}
                  onChange={(e) => setVhPlate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label htmlFor="vh-type" className="block text-xs font-medium text-slate-700">النوع</label>
                <select
                  id="vh-type"
                  value={vhType}
                  onChange={(e) => setVhType(e.target.value as VehicleType)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="motorcycle">دراجة نارية</option>
                  <option value="car">سيارة ملاكي</option>
                  <option value="van">فان شحن</option>
                  <option value="truck">شاحنة نقل</option>
                </select>
              </div>
              <button type="submit" disabled={saving} className="rounded-lg bg-slate-900 py-2 text-xs font-medium text-white">
                + إضافة سيارة
              </button>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">الكود</th>
                  <th className="px-4 py-3 font-semibold">المركبة</th>
                  <th className="px-4 py-3 font-semibold">اللوحة</th>
                  <th className="px-4 py-3 font-semibold">النوع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vehicles.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500">لا توجد مركبات مضافة بعد.</td>
                  </tr>
                ) : (
                  vehicles.map((v) => (
                    <tr key={v.id}>
                      <td className="px-4 py-2.5 font-mono-tabular font-semibold">{v.code}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{v.name}</td>
                      <td className="px-4 py-2.5 font-mono-tabular text-slate-600">{v.plate_number ?? '—'}</td>
                      <td className="px-4 py-2.5 text-slate-600">{VEHICLE_LABELS[v.vehicle_type]}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'drivers' && (
        <div className="space-y-4">
          {canManage && (
            <form onSubmit={handleSaveDriver} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-5 items-end">
              <div>
                <label htmlFor="dr-code" className="block text-xs font-medium text-slate-700">الكود *</label>
                <input
                  id="dr-code"
                  required
                  dir="ltr"
                  value={drCode}
                  onChange={(e) => setDrCode(e.target.value.toUpperCase())}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>
              <div>
                <label htmlFor="dr-name" className="block text-xs font-medium text-slate-700">اسم السائق *</label>
                <input
                  id="dr-name"
                  required
                  value={drName}
                  onChange={(e) => setDrName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label htmlFor="dr-mobile" className="block text-xs font-medium text-slate-700">رقم الموبايل</label>
                <input
                  id="dr-mobile"
                  dir="ltr"
                  value={drMobile}
                  onChange={(e) => setDrMobile(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>
              <div>
                <label htmlFor="dr-lic" className="block text-xs font-medium text-slate-700">رقم الرخصة</label>
                <input
                  id="dr-lic"
                  dir="ltr"
                  value={drLicense}
                  onChange={(e) => setDrLicense(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>
              <button type="submit" disabled={saving} className="rounded-lg bg-slate-900 py-2 text-xs font-medium text-white">
                + إضافة سائق
              </button>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-semibold">الكود</th>
                  <th className="px-4 py-3 font-semibold">الاسم</th>
                  <th className="px-4 py-3 font-semibold">الموبايل</th>
                  <th className="px-4 py-3 font-semibold">رقم الرخصة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {drivers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-slate-500">لا يوجد سائقون مضافون بعد.</td>
                  </tr>
                ) : (
                  drivers.map((d) => (
                    <tr key={d.id}>
                      <td className="px-4 py-2.5 font-mono-tabular font-semibold">{d.code}</td>
                      <td className="px-4 py-2.5 font-medium text-slate-900">{d.name}</td>
                      <td className="px-4 py-2.5 font-mono-tabular text-slate-600">{d.mobile ?? '—'}</td>
                      <td className="px-4 py-2.5 font-mono-tabular text-slate-600">{d.license_number ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
