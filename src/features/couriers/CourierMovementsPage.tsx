import {useCallback, useEffect, useState} from 'react';
import {listCouriers} from '@/features/couriers/couriersService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {CourierRecord} from '@/types/couriers';
import {MapPinned} from 'lucide-react';

export function CourierMovementsPage() {
  const {tenant} = useTenantWorkspace();
  const [couriers, setCouriers] = useState<readonly CourierRecord[]>([]);
  const [selectedCourierId, setSelectedCourierId] = useState('');
  const [dateFrom, setDateFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  const loadData = useCallback(async () => {
    try {
      const rows = await listCouriers(tenant.id);
      setCouriers(rows);
      if (rows.length > 0 && !selectedCourierId) {
        setSelectedCourierId(rows[0].id);
      }
    } catch {
      // Keep filter UI responsive
    }
  }, [tenant.id, selectedCourierId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">تحركات مندوب الشحن</h1>
        <p className="mt-1 text-xs text-slate-500">
          تتبع خط سير المندوب ونقاط التوقف وتاريخ الحالات على الخريطة خلال الفترة المحددة.
        </p>
      </div>

      <section className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:grid-cols-4 items-end">
        <div>
          <label htmlFor="mv-courier" className="block text-xs font-medium text-slate-700">
            مندوب الشحن
          </label>
          <select
            id="mv-courier"
            value={selectedCourierId}
            onChange={(e) => setSelectedCourierId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
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
          disabled
          className="rounded-lg bg-slate-200 px-4 py-2 text-xs font-medium text-slate-600 cursor-not-allowed"
        >
          تفعيل الخريطة في المرحلة 14
        </button>
      </section>

      <section className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
        <MapPinned className="h-10 w-10 text-slate-400" />
        <h2 className="mt-3 text-sm font-semibold text-slate-900">خريطة التتبع وسجل التحركات الميدانية</h2>
        <p className="mt-1.5 max-w-lg text-xs leading-relaxed text-slate-500">
          تُعرض هنا مسارات المندوبين عبر Google Maps Platform ونقاط تسليم وتعذر الشحنات بالتفصيل فور تفعيل دورة
          الشحنات والمهام الميدانية (المراحل 6 و8) وربط الخرائط في المرحلة 14.
        </p>
      </section>
    </div>
  );
}
