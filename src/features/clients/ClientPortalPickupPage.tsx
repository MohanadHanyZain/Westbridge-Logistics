import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {
  cancelClientPickupRequest,
  createClientPickupRequest,
  deleteMyClientAddress,
  listClientPickupRequests,
  saveMyClientAddress,
} from '@/features/clients/clientPortalService';
import {listClientAddresses, listClients} from '@/features/clients/clientsService';
import {listGovernorates, listRegions} from '@/features/definitions/definitionsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {formatDateTime} from '@/lib/formatters';
import {
  PICKUP_REQUEST_STATUS_LABELS,
  type ClientPickupRequestRecord,
} from '@/types/clientPortal';
import type {GovernorateRecord, RegionRecord} from '@/types/definitions';
import type {ClientAddressRecord, ClientRecord} from '@/types/pricing';
import {MapPin, Plus, Trash2, Truck, X} from 'lucide-react';

const TIME_SLOTS = ['10:00-14:00', '14:00-18:00', '18:00-22:00'] as const;

export function ClientPortalPickupPage() {
  const {tenant, boundClientId} = useTenantWorkspace();

  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [selectedClientId, setSelectedClientId] = useState(boundClientId ?? '');
  const [governorates, setGovernorates] = useState<readonly GovernorateRecord[]>([]);
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);
  const [addresses, setAddresses] = useState<readonly ClientAddressRecord[]>([]);
  const [requests, setRequests] = useState<readonly ClientPickupRequestRecord[]>([]);
  const [tab, setTab] = useState<'requests' | 'addresses'>('requests');

  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  // New Pickup Request Form
  const [reqAddressId, setReqAddressId] = useState('');
  const [reqGovId, setReqGovId] = useState('');
  const [reqRegId, setReqRegId] = useState('');
  const [reqAddressLine, setReqAddressLine] = useState('');
  const [reqPhone, setReqPhone] = useState('');
  const [reqDate, setReqDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reqSlot, setReqSlot] = useState<string>(TIME_SLOTS[0]);
  const [reqEstCount, setReqEstCount] = useState('3');
  const [reqNotes, setReqNotes] = useState('');
  const [submittingReq, setSubmittingReq] = useState(false);

  // New Address Form
  const [addrLabel, setAddrLabel] = useState('');
  const [addrGovId, setAddrGovId] = useState('');
  const [addrRegId, setAddrRegId] = useState('');
  const [addrLine, setAddrLine] = useState('');
  const [addrPhone, setAddrPhone] = useState('');
  const [addrDefault, setAddrDefault] = useState(false);
  const [savingAddr, setSavingAddr] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([listClients(tenant.id), listGovernorates(tenant.id), listRegions(tenant.id)])
      .then(([cl, gov, reg]) => {
        if (!active) return;
        const activeClients = cl.filter((c) => c.is_active);
        const activeGovs = gov.filter((g) => g.is_active);
        const activeRegs = reg.filter((r) => r.is_active);
        setClients(activeClients);
        setGovernorates(activeGovs);
        setRegions(activeRegs);

        const targetCl = boundClientId
          ? activeClients.find((c) => c.id === boundClientId)
          : activeClients[0];
        if (targetCl) {
          setSelectedClientId((curr) => curr || targetCl.id);
          setReqGovId((curr) => curr || targetCl.governorate_id);
          setReqRegId((curr) => curr || targetCl.region_id);
          setReqAddressLine((curr) => curr || targetCl.address_line);
          setReqPhone((curr) => curr || targetCl.mobile || targetCl.phone);
        } else if (activeGovs[0]) {
          setReqGovId(activeGovs[0].id);
          setReqRegId(activeRegs.find((r) => r.governorate_id === activeGovs[0].id)?.id ?? '');
        }
        if (activeGovs[0]) {
          setAddrGovId((curr) => curr || activeGovs[0].id);
          setAddrRegId((curr) => curr || (activeRegs.find((r) => r.governorate_id === activeGovs[0].id)?.id ?? ''));
        }
      })
      .catch(() => {
        // Non-blocking
      });
    return () => {
      active = false;
    };
  }, [tenant.id, boundClientId]);

  const targetClientId = boundClientId ?? selectedClientId;

  const loadPortalPickupData = useCallback(async () => {
    if (!targetClientId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [addrRows, reqRows] = await Promise.all([
        listClientAddresses(tenant.id, targetClientId),
        listClientPickupRequests(tenant.id, {clientId: targetClientId}),
      ]);
      setAddresses(addrRows);
      setRequests(reqRows);
      const defaultAddr = addrRows.find((a) => a.is_default) ?? addrRows[0];
      if (defaultAddr) {
        setReqAddressId(defaultAddr.id);
        setReqGovId(defaultAddr.governorate_id);
        setReqRegId(defaultAddr.region_id ?? '');
        setReqAddressLine(defaultAddr.address_line);
        if (defaultAddr.phone) setReqPhone(defaultAddr.phone);
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحميل بيانات الالتقاط والعناوين.',
      });
    } finally {
      setLoading(false);
    }
  }, [tenant.id, targetClientId]);

  useEffect(() => {
    void loadPortalPickupData();
  }, [loadPortalPickupData]);

  const govMap = useMemo(() => new Map(governorates.map((g) => [g.id, g.name])), [governorates]);
  const regMap = useMemo(() => new Map(regions.map((r) => [r.id, r.name])), [regions]);
  const reqRegions = useMemo(
    () => (reqGovId ? regions.filter((r) => r.governorate_id === reqGovId) : regions),
    [regions, reqGovId],
  );
  const addrRegions = useMemo(
    () => (addrGovId ? regions.filter((r) => r.governorate_id === addrGovId) : regions),
    [regions, addrGovId],
  );

  const handleSelectSavedAddress = (addressId: string) => {
    setReqAddressId(addressId);
    const found = addresses.find((a) => a.id === addressId);
    if (!found) return;
    setReqGovId(found.governorate_id);
    setReqRegId(found.region_id ?? '');
    setReqAddressLine(found.address_line);
    if (found.phone) setReqPhone(found.phone);
  };

  const handleCreateRequest = async (e: FormEvent) => {
    e.preventDefault();
    if (!targetClientId) return;
    setFeedback(null);
    setSubmittingReq(true);
    try {
      await createClientPickupRequest(tenant.id, {
        client_id: boundClientId ? undefined : targetClientId,
        address_id: reqAddressId || null,
        governorate_id: reqGovId,
        region_id: reqRegId || null,
        pickup_address: reqAddressLine,
        contact_phone: reqPhone,
        preferred_date: reqDate,
        preferred_time_slot: reqSlot,
        estimated_shipments_count: Math.max(1, Number(reqEstCount) || 1),
        notes: reqNotes || null,
      });
      setReqNotes('');
      setFeedback({type: 'success', text: 'تم إرسال طلب الالتقاط لفريق التشغيل بنجاح.'});
      await loadPortalPickupData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إنشاء طلب الالتقاط.',
      });
    } finally {
      setSubmittingReq(false);
    }
  };

  const handleCancelRequest = async (requestId: string) => {
    setFeedback(null);
    try {
      await cancelClientPickupRequest(tenant.id, requestId);
      setFeedback({type: 'success', text: 'تم إلغاء طلب الالتقاط.'});
      await loadPortalPickupData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إلغاء طلب الالتقاط.',
      });
    }
  };

  const handleSaveAddress = async (e: FormEvent) => {
    e.preventDefault();
    if (!targetClientId) return;
    setFeedback(null);
    setSavingAddr(true);
    try {
      await saveMyClientAddress(tenant.id, {
        client_id: boundClientId ? undefined : targetClientId,
        label: addrLabel,
        governorate_id: addrGovId,
        region_id: addrRegId || null,
        address_line: addrLine,
        phone: addrPhone || null,
        is_default: addrDefault,
      });
      setAddrLabel('');
      setAddrLine('');
      setAddrPhone('');
      setAddrDefault(false);
      setFeedback({type: 'success', text: 'تم حفظ عنوان الالتقاط بنجاح.'});
      await loadPortalPickupData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حفظ العنوان.',
      });
    } finally {
      setSavingAddr(false);
    }
  };

  const handleDeleteAddress = async (addressId: string) => {
    setFeedback(null);
    try {
      await deleteMyClientAddress(tenant.id, addressId);
      setFeedback({type: 'success', text: 'تم حذف العنوان.'});
      await loadPortalPickupData();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حذف العنوان.',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">طلبات الالتقاط وعناوين المخازن</h1>
          <p className="mt-1 text-xs text-slate-500">
            اطلب حضور مندوب لاستلام شحناتك أو أدر عناوين الالتقاط المحفوظة لمتجرك.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!boundClientId && clients.length > 0 && (
            <select
              aria-label="اختيار التاجر"
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setTab('requests')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                tab === 'requests' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              طلبات الالتقاط ({requests.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('addresses')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
                tab === 'addresses' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              عناوين الالتقاط ({addresses.length})
            </button>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-xs font-medium ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {tab === 'requests' ? (
        <div className="space-y-6">
          <form onSubmit={handleCreateRequest} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <Truck className="h-4 w-4 text-slate-700" />
              <h2 className="text-sm font-semibold text-slate-900">إنشاء طلب التقاط جديد</h2>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {addresses.length > 0 && (
                <div className="sm:col-span-2 lg:col-span-3">
                  <label htmlFor="pkreq-saved-addr" className="block text-xs font-medium text-slate-700">
                    اختيار من العناوين المحفوظة
                  </label>
                  <select
                    id="pkreq-saved-addr"
                    value={reqAddressId}
                    onChange={(e) => handleSelectSavedAddress(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value="">عنوان مخصص</option>
                    {addresses.map((addr) => (
                      <option key={addr.id} value={addr.id}>
                        {addr.label} — {addr.address_line}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="pkreq-gov" className="block text-xs font-medium text-slate-700">
                  المحافظة *
                </label>
                <select
                  id="pkreq-gov"
                  required
                  value={reqGovId}
                  onChange={(e) => {
                    const nextGov = e.target.value;
                    setReqGovId(nextGov);
                    setReqRegId(regions.find((r) => r.governorate_id === nextGov)?.id ?? '');
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
                <label htmlFor="pkreq-reg" className="block text-xs font-medium text-slate-700">
                  المنطقة *
                </label>
                <select
                  id="pkreq-reg"
                  value={reqRegId}
                  onChange={(e) => setReqRegId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  {reqRegions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="pkreq-phone" className="block text-xs font-medium text-slate-700">
                  هاتف التواصل للاستلام *
                </label>
                <input
                  id="pkreq-phone"
                  required
                  dir="ltr"
                  value={reqPhone}
                  onChange={(e) => setReqPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label htmlFor="pkreq-address" className="block text-xs font-medium text-slate-700">
                  عنوان الالتقاط بالتفصيل *
                </label>
                <input
                  id="pkreq-address"
                  required
                  value={reqAddressLine}
                  onChange={(e) => setReqAddressLine(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label htmlFor="pkreq-date" className="block text-xs font-medium text-slate-700">
                  التاريخ المفضل *
                </label>
                <input
                  id="pkreq-date"
                  type="date"
                  required
                  value={reqDate}
                  onChange={(e) => setReqDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>

              <div>
                <label htmlFor="pkreq-slot" className="block text-xs font-medium text-slate-700">
                  الفترة الزمنية
                </label>
                <select
                  id="pkreq-slot"
                  value={reqSlot}
                  onChange={(e) => setReqSlot(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-tabular text-xs"
                >
                  {TIME_SLOTS.map((slot) => (
                    <option key={slot} value={slot}>
                      {slot}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="pkreq-count" className="block text-xs font-medium text-slate-700">
                  عدد الشحنات التقديري *
                </label>
                <input
                  id="pkreq-count"
                  type="number"
                  min="1"
                  required
                  value={reqEstCount}
                  onChange={(e) => setReqEstCount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label htmlFor="pkreq-notes" className="block text-xs font-medium text-slate-700">
                  ملاحظات للمندوب (اختياري)
                </label>
                <input
                  id="pkreq-notes"
                  type="text"
                  value={reqNotes}
                  onChange={(e) => setReqNotes(e.target.value)}
                  placeholder="مثال: الشحنات جاهزة بالمخزن الدور الأرضي"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div>
              <button
                type="submit"
                disabled={submittingReq}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                <Plus className="h-3.5 w-3.5" />
                {submittingReq ? 'جاري إرسال الطلب...' : 'إرسال طلب الالتقاط'}
              </button>
            </div>
          </form>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">كود الطلب</th>
                  <th className="px-4 py-3 font-medium">الموعد المفضل</th>
                  <th className="px-4 py-3 font-medium">العنوان والهاتف</th>
                  <th className="px-4 py-3 font-medium">عدد الشحنات</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">تاريخ الإنشاء</th>
                  <th className="px-4 py-3 font-medium">إجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                      {loading ? 'جاري تحميل طلبات الالتقاط...' : 'لا توجد طلبات التقاط مسجلة حتى الآن.'}
                    </td>
                  </tr>
                ) : (
                  requests.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">
                        {r.request_code}
                      </td>
                      <td className="px-4 py-3 font-mono-tabular text-slate-700">
                        {r.preferred_date} · {r.preferred_time_slot}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <p className="font-medium text-slate-900">{r.pickup_address}</p>
                        <p className="font-mono-tabular text-[11px] text-slate-500">
                          {govMap.get(r.governorate_id) ?? '—'}
                          {r.region_id ? ` · ${regMap.get(r.region_id) ?? ''}` : ''} · {r.contact_phone}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">
                        {r.estimated_shipments_count}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {PICKUP_REQUEST_STATUS_LABELS[r.status]}
                      </td>
                      <td className="px-4 py-3 font-mono-tabular text-slate-500">
                        {formatDateTime(r.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        {r.status === 'pending' ? (
                          <button
                            type="button"
                            onClick={() => void handleCancelRequest(r.id)}
                            className="inline-flex items-center gap-1 rounded border border-red-200 px-2.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50"
                          >
                            <X className="h-3 w-3" />
                            إلغاء الطلب
                          </button>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <form onSubmit={handleSaveAddress} className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <MapPin className="h-4 w-4 text-slate-700" />
              <h2 className="text-sm font-semibold text-slate-900">إضافة عنوان التقاط محفوظ</h2>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="addr-label" className="block text-xs font-medium text-slate-700">
                  تسمية العنوان *
                </label>
                <input
                  id="addr-label"
                  required
                  value={addrLabel}
                  onChange={(e) => setAddrLabel(e.target.value)}
                  placeholder="مثال: مخزن مدينة نصر"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label htmlFor="addr-gov" className="block text-xs font-medium text-slate-700">
                  المحافظة *
                </label>
                <select
                  id="addr-gov"
                  required
                  value={addrGovId}
                  onChange={(e) => {
                    const nextGov = e.target.value;
                    setAddrGovId(nextGov);
                    setAddrRegId(regions.find((r) => r.governorate_id === nextGov)?.id ?? '');
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
                <label htmlFor="addr-reg" className="block text-xs font-medium text-slate-700">
                  المنطقة
                </label>
                <select
                  id="addr-reg"
                  value={addrRegId}
                  onChange={(e) => setAddrRegId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  {addrRegions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="addr-phone" className="block text-xs font-medium text-slate-700">
                  هاتف الموقع
                </label>
                <input
                  id="addr-phone"
                  dir="ltr"
                  value={addrPhone}
                  onChange={(e) => setAddrPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label htmlFor="addr-line" className="block text-xs font-medium text-slate-700">
                  العنوان التفصيلي *
                </label>
                <input
                  id="addr-line"
                  required
                  value={addrLine}
                  onChange={(e) => setAddrLine(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>

              <label className="flex items-center gap-2 self-end pb-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={addrDefault}
                  onChange={(e) => setAddrDefault(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                تعيين كعنوان افتراضي
              </label>
            </div>
            <div>
              <button
                type="submit"
                disabled={savingAddr}
                className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {savingAddr ? 'جاري الحفظ...' : 'حفظ العنوان'}
              </button>
            </div>
          </form>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {addresses.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-500 md:col-span-2">
                لا توجد عناوين محفوظة لهذا الحساب بعد.
              </p>
            ) : (
              addresses.map((addr) => (
                <div
                  key={addr.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-xs"
                >
                  <div>
                    <p className="font-semibold text-slate-900">
                      {addr.label}
                      {addr.is_default ? ' · افتراضي' : ''}
                    </p>
                    <p className="mt-1 text-slate-700">{addr.address_line}</p>
                    <p className="mt-1 text-slate-500">
                      {govMap.get(addr.governorate_id) ?? '—'}
                      {addr.region_id ? ` · ${regMap.get(addr.region_id) ?? ''}` : ''}
                      {addr.phone ? ` · ${addr.phone}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`حذف عنوان ${addr.label}`}
                    onClick={() => void handleDeleteAddress(addr.id)}
                    className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}