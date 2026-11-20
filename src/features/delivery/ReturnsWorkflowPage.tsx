import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {listClients} from '@/features/clients/clientsService';
import {listCouriers} from '@/features/couriers/couriersService';
import {listBranches, listMovementTypes} from '@/features/definitions/definitionsService';
import {
  addShipmentsToReturnManifest,
  approveReturnManifest,
  createReturnManifest,
  getReturnManifestDetail,
  listEligibleShipmentsForReturns,
  listReturnManifests,
  removeShipmentFromReturnManifest,
} from '@/features/delivery/deliveryService';
import {
  BarcodeScanModal,
  MultiSelectShipmentsModal,
} from '@/features/operations/ShipmentAttachmentModals';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {CourierRecord} from '@/types/couriers';
import type {BranchRecord, MovementTypeRecord} from '@/types/definitions';
import {
  RETURN_MANIFEST_STATUS_LABELS,
  RETURN_MANIFEST_TYPE_LABELS,
  type ReturnManifestDetail,
  type ReturnManifestRecord,
  type ReturnManifestStatus,
  type ReturnManifestType,
} from '@/types/delivery';
import type {ClientRecord} from '@/types/pricing';
import {RETURN_CUSTODY_LABELS, SHIPMENT_STATUS_LABELS, type ShipmentListItem} from '@/types/shipments';
import {
  ArrowRight,
  Barcode,
  CheckCircle2,
  ClipboardList,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';

function getManifestStatusClass(status: ReturnManifestStatus): string {
  if (status === 'approved') return 'text-emerald-700';
  if (status === 'cancelled') return 'text-red-700';
  return 'text-amber-700';
}

export function ReturnsWorkflowPage() {
  const {tenant, branchIds, can} = useTenantWorkspace();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const [activeTab, setActiveTab] = useState<ReturnManifestType>('courier_return_inbound');
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [couriers, setCouriers] = useState<readonly CourierRecord[]>([]);
  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [movementTypes, setMovementTypes] = useState<readonly MovementTypeRecord[]>([]);

  const [mode, setMode] = useState<'list' | 'workbench'>('list');
  const [manifests, setManifests] = useState<readonly ReturnManifestRecord[]>([]);
  const [activeDetail, setActiveDetail] = useState<ReturnManifestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBranchId, setNewBranchId] = useState(branchIds[0] ?? '');
  const [newCourierId, setNewCourierId] = useState('');
  const [newClientId, setNewClientId] = useState('');
  const [newMovementTypeId, setNewMovementTypeId] = useState('');
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newNotes, setNewNotes] = useState('');

  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [showMultiSelectModal, setShowMultiSelectModal] = useState(false);
  const [eligibleShipments, setEligibleShipments] = useState<readonly ShipmentListItem[]>([]);
  const [loadingEligible, setLoadingEligible] = useState(false);

  const canManageReturns = can('operations.pickup.approve') || can('operations.delivery.execute');

  const loadRefs = useCallback(async () => {
    try {
      const [br, crr, cl, mov] = await Promise.all([
        listBranches(tenant.id),
        listCouriers(tenant.id),
        listClients(tenant.id),
        listMovementTypes(tenant.id),
      ]);
      setBranches(br);
      setCouriers(crr.filter((c) => c.is_active));
      setClients(cl);
      setMovementTypes(mov);
      if (!newBranchId && br[0]) setNewBranchId(br[0].id);
    } catch {
      // Non-blocking
    }
  }, [tenant.id, newBranchId]);

  const loadManifests = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listReturnManifests(tenant.id, activeTab);
      setManifests(data);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحميل قوائم المرتجعات.'});
    } finally {
      setLoading(false);
    }
  }, [tenant.id, activeTab]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    setMode('list');
    setActiveDetail(null);
    setShowCreateForm(false);
    setFeedback(null);
    void loadManifests();
  }, [activeTab, loadManifests]);

  useEffect(() => {
    const targetCode = activeTab === 'courier_return_inbound' ? 'MOV-007' : 'MOV-008';
    const match = movementTypes.find((m) => m.code === targetCode);
    if (match) setNewMovementTypeId(match.id);
  }, [activeTab, movementTypes]);

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const courierMap = useMemo(() => new Map(couriers.map((c) => [c.id, c.name])), [couriers]);
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);

  const refreshDetail = async (id: string) => {
    const detail = await getReturnManifestDetail(tenant.id, id);
    setActiveDetail(detail);
  };

  const handleOpenWorkbench = async (id: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await refreshDetail(id);
      setMode('workbench');
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر فتح قائمة المرتجعات.'});
    } finally {
      setBusy(false);
    }
  };

  const handleCreateManifest = async (e: FormEvent) => {
    e.preventDefault();
    if (!newBranchId) {
      setFeedback({type: 'error', text: 'يجب تحديد الفرع المنفذ لقائمة المرتجعات.'});
      return;
    }
    if (activeTab === 'client_return_dispatch' && !newCourierId) {
      setFeedback({type: 'error', text: 'يجب اختيار المندوب لتوصيل المرتجعات للعميل.'});
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      const res = await createReturnManifest(tenant.id, {
        manifest_type: activeTab,
        manifest_date: newDate,
        branch_id: newBranchId,
        courier_id: newCourierId || null,
        client_id: newClientId || null,
        movement_type_id: newMovementTypeId || null,
        notes: newNotes.trim() || null,
      });
      setShowCreateForm(false);
      setNewNotes('');
      await Promise.all([loadManifests(), refreshDetail(res.id)]);
      setMode('workbench');
      setFeedback({type: 'success', text: `تم إنشاء قائمة المرتجعات (${res.manifest_code}) بنجاح.`});
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر إنشاء القائمة.'});
    } finally {
      setBusy(false);
    }
  };

  const handleOpenMultiSelect = async () => {
    if (!activeDetail) return;
    setShowMultiSelectModal(true);
    setLoadingEligible(true);
    try {
      const data = await listEligibleShipmentsForReturns(tenant.id, activeDetail.manifest.manifest_type, {
        clientId: activeDetail.manifest.client_id,
      });
      setEligibleShipments(data);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحميل الشحنات المرتجعة.'});
    } finally {
      setLoadingEligible(false);
    }
  };

  const handleAddByBarcode = async (query: string) => {
    if (!activeDetail) return;
    await addShipmentsToReturnManifest(tenant.id, activeDetail.manifest.id, [], query);
    await refreshDetail(activeDetail.manifest.id);
    await loadManifests();
  };

  const handleAddMultiSelect = async (ids: readonly string[]) => {
    if (!activeDetail) return;
    const res = await addShipmentsToReturnManifest(tenant.id, activeDetail.manifest.id, ids);
    await refreshDetail(activeDetail.manifest.id);
    await loadManifests();
    setFeedback({
      type: 'success',
      text: `تمت إضافة ${res.added_count} شحنة لقائمة المرتجعات${res.skipped_count > 0 ? ` (وتخطي ${res.skipped_count})` : ''}.`,
    });
  };

  const handleRemoveItem = async (shipmentId: string) => {
    if (!activeDetail) return;
    setBusy(true);
    try {
      await removeShipmentFromReturnManifest(tenant.id, activeDetail.manifest.id, shipmentId);
      await refreshDetail(activeDetail.manifest.id);
      await loadManifests();
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر إزالة الشحنة.'});
    } finally {
      setBusy(false);
    }
  };

  const handleApproveManifest = async () => {
    if (!activeDetail) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await approveReturnManifest(tenant.id, activeDetail.manifest.id);
      await Promise.all([refreshDetail(activeDetail.manifest.id), loadManifests()]);
      setFeedback({
        type: 'success',
        text: `تم اعتماد قائمة المرتجعات (${res.manifest_code}) وتحديث حالة ${res.shipments_count} شحنة وعهدة الاستبدال/الارتجاع الجزئي.`,
      });
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر اعتماد قائمة المرتجعات.'});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">دورة المرتجعات والاستلام للعميل</h1>
          <p className="mt-1 text-sm text-slate-600">
            استلام المرتجعات من المناديب للمخزن، إسناد تسليم المرتجعات للعملاء، وإغلاق عهدة طرود PDP وPTP.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {mode === 'workbench' ? (
            <button
              type="button"
              onClick={() => {
                setMode('list');
                setActiveDetail(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              العودة للقوائم
            </button>
          ) : (
            canManageReturns && (
              <button
                type="button"
                onClick={() => setShowCreateForm((p) => !p)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
              >
                <Plus className="h-4 w-4" />
                إنشاء قائمة مرتجع جديدة
              </button>
            )
          )}
        </div>
      </div>

      {/* 3-stage Segmented Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5">
        {(
          [
            {key: 'courier_return_inbound', label: '1. استلام المرتجعات من المناديب (RTH)'},
            {key: 'client_return_dispatch', label: '2. توصيل المرتجعات للعملاء (RTD)'},
            {key: 'client_return_handover', label: '3. تسليم المرتجعات للعميل النهائي (RTN)'},
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === tab.key
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
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

      {/* Create Header Form */}
      {mode === 'list' && showCreateForm && (
        <form
          onSubmit={(e) => void handleCreateManifest(e)}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-4"
        >
          <h2 className="text-sm font-bold text-slate-900">{RETURN_MANIFEST_TYPE_LABELS[activeTab]}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label htmlFor="rtn-date" className="block text-xs text-slate-600">
                التاريخ
              </label>
              <input
                id="rtn-date"
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
              />
            </div>

            <div>
              <label htmlFor="rtn-branch" className="block text-xs text-slate-600">
                الفرع *
              </label>
              <select
                id="rtn-branch"
                required
                value={newBranchId}
                onChange={(e) => setNewBranchId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              >
                <option value="">اختر الفرع...</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="rtn-courier" className="block text-xs text-slate-600">
                المندوب {activeTab === 'client_return_dispatch' ? '*' : '(اختياري)'}
              </label>
              <select
                id="rtn-courier"
                value={newCourierId}
                onChange={(e) => setNewCourierId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              >
                <option value="">الكل / غير محدد</option>
                {couriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="rtn-client" className="block text-xs text-slate-600">
                العميل (اختياري للتصفية)
              </label>
              <select
                id="rtn-client"
                value={newClientId}
                onChange={(e) => setNewClientId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              >
                <option value="">كل العملاء</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="rtn-mov" className="block text-xs text-slate-600">
                نوع الحركة
              </label>
              <select
                id="rtn-mov"
                value={newMovementTypeId}
                onChange={(e) => setNewMovementTypeId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              >
                {movementTypes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <input
              type="text"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="ملاحظات قائمة المرتجعات..."
              className="min-w-[260px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                إنشاء القائمة
              </button>
            </div>
          </div>
        </form>
      )}

      {/* List Mode */}
      {mode === 'list' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">رقم القائمة</th>
                <th className="px-4 py-3 font-medium">التاريخ</th>
                <th className="px-4 py-3 font-medium">الفرع</th>
                <th className="px-4 py-3 font-medium">المندوب / العميل</th>
                <th className="px-4 py-3 font-medium">الشحنات</th>
                <th className="px-4 py-3 font-medium">الحالة</th>
                <th className="px-4 py-3 font-medium">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                    جاري تحميل قوائم المرتجعات...
                  </td>
                </tr>
              ) : manifests.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm text-slate-500">
                    لا توجد قوائم مسجلة تحت هذا التبويب بعد.
                  </td>
                </tr>
              ) : (
                manifests.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">{m.manifest_code}</td>
                    <td className="px-4 py-3 font-mono-tabular text-slate-600">{m.manifest_date}</td>
                    <td className="px-4 py-3 text-slate-800">{branchMap.get(m.branch_id) ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-700">
                      {m.courier_id ? `المندوب: ${courierMap.get(m.courier_id) ?? '—'}` : ''}
                      {m.courier_id && m.client_id ? ' · ' : ''}
                      {m.client_id ? `العميل: ${clientMap.get(m.client_id) ?? '—'}` : ''}
                      {!m.courier_id && !m.client_id ? 'شامل الفرع' : ''}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-slate-700">{m.shipments_count ?? 0} شحنة</td>
                    <td className="px-4 py-3">
                      <span className={`font-semibold ${getManifestStatusClass(m.status)}`}>
                        {RETURN_MANIFEST_STATUS_LABELS[m.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => void handleOpenWorkbench(m.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        <ClipboardList className="h-3.5 w-3.5" />
                        {m.status === 'draft' ? 'تجهيز واعتماد' : 'عرض التفاصيل'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Workbench Mode */}
      {mode === 'workbench' && activeDetail && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
            <div>
              <div className="flex items-center gap-2 text-sm">
                <RotateCcw className="h-4 w-4 text-slate-700" />
                <span className="font-mono-tabular font-bold text-slate-900">
                  {activeDetail.manifest.manifest_code}
                </span>
                <span aria-hidden="true">·</span>
                <span className={`font-semibold ${getManifestStatusClass(activeDetail.manifest.status)}`}>
                  {RETURN_MANIFEST_STATUS_LABELS[activeDetail.manifest.status]}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {RETURN_MANIFEST_TYPE_LABELS[activeDetail.manifest.manifest_type]} · الفرع:{' '}
                {branchMap.get(activeDetail.manifest.branch_id) ?? '—'} · عدد الشحنات:{' '}
                <span className="font-mono-tabular font-semibold">{activeDetail.items.length}</span>
              </p>
            </div>

            {activeDetail.manifest.status === 'draft' && canManageReturns && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowBarcodeModal(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Barcode className="h-3.5 w-3.5" />
                  مسح بالباركود
                </button>
                <button
                  type="button"
                  onClick={() => void handleOpenMultiSelect()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  اختيار شحنات مؤهلة
                </button>
                <button
                  type="button"
                  disabled={busy || activeDetail.items.length === 0}
                  onClick={() => void handleApproveManifest()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  اعتماد قائمة المرتجعات
                </button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">رقم الشحنة</th>
                  <th className="px-4 py-3 font-medium">العميل / المستلم</th>
                  <th className="px-4 py-3 font-medium">حالة الشحنة وعهدة المرتجع</th>
                  <th className="px-4 py-3 font-medium">رسوم المرتجع / التحصيل</th>
                  <th className="px-4 py-3 font-medium">حالة التسليم في القائمة</th>
                  <th className="px-4 py-3 font-medium">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeDetail.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-500">
                      لا توجد شحنات مضافة في قائمة المرتجعات بعد.
                    </td>
                  </tr>
                ) : (
                  activeDetail.items.map((item) => {
                    const shp = item.shipment;
                    return (
                      <tr key={item.id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3 align-top">
                          <Link
                            to={`${basePath}/shipments/${item.shipment_id}`}
                            className="font-mono-tabular font-semibold text-slate-900 hover:underline"
                          >
                            {shp?.shipment_number ?? item.shipment_id}
                          </Link>
                          <div className="mt-0.5 text-[11px] text-slate-500">{shp?.shipment_type_code ?? ''}</div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium text-slate-900">
                            {shp ? clientMap.get(shp.client_id) ?? '—' : '—'}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            المستلم: {shp?.recipient_name ?? '—'} · {shp?.recipient_mobile ?? '—'}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium text-slate-800">
                            {shp ? SHIPMENT_STATUS_LABELS[shp.operational_status] : '—'}
                          </div>
                          {shp && shp.partial_return_custody !== 'none' && (
                            <div className="mt-0.5 text-[11px] text-amber-700">
                              عهدة جزئية (PDP): {RETURN_CUSTODY_LABELS[shp.partial_return_custody]}
                            </div>
                          )}
                          {shp && shp.exchange_status !== 'none' && (
                            <div className="mt-0.5 text-[11px] text-sky-700">
                              عهدة استبدال (PTP): {RETURN_CUSTODY_LABELS[shp.exchange_status]}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top font-mono-tabular text-slate-700">
                          <div>رسوم مرتجع: {Number(shp?.applied_return_fee ?? shp?.return_fee ?? 0).toFixed(2)} ج.م</div>
                          {Number(shp?.return_collected_from_recipient ?? 0) > 0 && (
                            <div className="mt-0.5 text-[11px] text-emerald-700">
                              محصل من المستلم: {Number(shp?.return_collected_from_recipient ?? 0).toFixed(2)} ج.م
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`font-semibold ${
                              item.handover_status === 'completed' ? 'text-emerald-700' : 'text-amber-700'
                            }`}
                          >
                            {item.handover_status === 'completed' ? 'مكتمل التسليم' : 'قيد الانتظار'}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {activeDetail.manifest.status === 'draft' && canManageReturns ? (
                            <button
                              type="button"
                              onClick={() => void handleRemoveItem(item.shipment_id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              إزالة
                            </button>
                          ) : (
                            <Link
                              to={`${basePath}/shipments/${item.shipment_id}`}
                              className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-100"
                            >
                              التفاصيل
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <BarcodeScanModal
        open={showBarcodeModal}
        title="إضافة شحنة مرتجعة بالباركود"
        busy={busy}
        onClose={() => setShowBarcodeModal(false)}
        onSubmitBarcode={handleAddByBarcode}
      />

      <MultiSelectShipmentsModal
        open={showMultiSelectModal}
        title="اختيار الشحنات المرتجعة أو المتعثرة"
        loading={loadingEligible}
        busy={busy}
        shipments={eligibleShipments}
        alreadyAttachedIds={(activeDetail?.items ?? []).map((i) => i.shipment_id)}
        branches={branches}
        onClose={() => setShowMultiSelectModal(false)}
        onConfirmAdd={handleAddMultiSelect}
      />
    </div>
  );
}
