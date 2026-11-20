import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {listClients} from '@/features/clients/clientsService';
import {listCourierRoutes, listCouriers} from '@/features/couriers/couriersService';
import {
  listBranches,
  listGovernorates,
  listMovementTypes,
  listRegions,
} from '@/features/definitions/definitionsService';
import {
  BarcodeScanModal,
  MultiSelectShipmentsModal,
} from '@/features/operations/ShipmentAttachmentModals';
import {
  addShipmentsToPickupList,
  approvePickupList,
  createPickupList,
  getPickupListDetail,
  listEligibleShipmentsForOperation,
  listPickupLists,
  removeShipmentFromPickupList,
} from '@/features/operations/operationsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {formatDateTime} from '@/lib/formatters';
import type {CourierRecord, CourierRouteRecord} from '@/types/couriers';
import type {
  BranchRecord,
  GovernorateRecord,
  MovementTypeRecord,
  RegionRecord,
} from '@/types/definitions';
import {
  PICKUP_STATUS_LABELS,
  type PickupListDetail,
  type PickupListRecord,
  type PickupListStatus,
} from '@/types/operations';
import type {ClientRecord} from '@/types/pricing';
import {SHIPMENT_TYPE_LABELS, type ShipmentListItem} from '@/types/shipments';
import {
  ArrowRight,
  Barcode,
  CheckCircle2,
  ClipboardList,
  Filter,
  Plus,
  Printer,
  Search,
  Trash2,
  X,
} from 'lucide-react';

function getPickupStatusClass(status: PickupListStatus): string {
  if (status === 'approved' || status === 'completed') return 'text-emerald-700';
  if (status === 'cancelled') return 'text-red-700';
  return 'text-amber-700';
}

export function PickupListsPage() {
  const {tenant, branchIds, can} = useTenantWorkspace();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  // Reference master lists
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [couriers, setCouriers] = useState<readonly CourierRecord[]>([]);
  const [routes, setRoutes] = useState<readonly CourierRouteRecord[]>([]);
  const [movementTypes, setMovementTypes] = useState<readonly MovementTypeRecord[]>([]);
  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [governorates, setGovernorates] = useState<readonly GovernorateRecord[]>([]);
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);

  // View state
  const [mode, setMode] = useState<'list' | 'workbench'>('list');
  const [pickupLists, setPickupLists] = useState<readonly PickupListRecord[]>([]);
  const [activeDetail, setActiveDetail] = useState<PickupListDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  // List filter states (MASTER_SPEC lines 1052-1062)
  const [search, setSearch] = useState('');
  const [filterCode, setFilterCode] = useState('');
  const [filterBranchId, setFilterBranchId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterCourierId, setFilterCourierId] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterOriginGovId, setFilterOriginGovId] = useState('');
  const [filterOriginRegionId, setFilterOriginRegionId] = useState('');
  const [filterDestGovId, setFilterDestGovId] = useState('');
  const [filterDestRegionId, setFilterDestRegionId] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Header creation form state
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formBranchId, setFormBranchId] = useState('');
  const [formCourierId, setFormCourierId] = useState('');
  const [formRouteId, setFormRouteId] = useState('');
  const [formMovementTypeId, setFormMovementTypeId] = useState('');
  const [formClientId, setFormClientId] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Attachment modals
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [showSelectModal, setShowSelectModal] = useState(false);
  const [eligibleShipments, setEligibleShipments] = useState<readonly ShipmentListItem[]>([]);
  const [loadingEligible, setLoadingEligible] = useState(false);

  const loadRefs = useCallback(async () => {
    try {
      const [br, cr, rt, mov, cl, gov, reg] = await Promise.all([
        listBranches(tenant.id),
        listCouriers(tenant.id),
        listCourierRoutes(tenant.id),
        listMovementTypes(tenant.id),
        listClients(tenant.id),
        listGovernorates(tenant.id),
        listRegions(tenant.id),
      ]);
      setBranches(br);
      setCouriers(cr);
      setRoutes(rt);
      setMovementTypes(mov);
      setClients(cl);
      setGovernorates(gov);
      setRegions(reg);

      const defaultBranch =
        (branchIds.length > 0 ? br.find((b) => branchIds.includes(b.id)) : br.find((b) => b.is_main)) ??
        br[0];
      if (defaultBranch) {
        setFormBranchId((curr) => curr || defaultBranch.id);
      }
      const movPickup = mov.find((m) => m.code === 'MOV-001') ?? mov[0];
      if (movPickup) {
        setFormMovementTypeId((curr) => curr || movPickup.id);
      }
      const generalRoute = rt.find((r) => r.code === 'GENERAL') ?? rt[0];
      if (generalRoute) {
        setFormRouteId((curr) => curr || generalRoute.id);
      }
    } catch {
      // Non-blocking refs
    }
  }, [tenant.id, branchIds]);

  const loadLists = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPickupLists(tenant.id, {
        search,
        code: filterCode,
        branchId: filterBranchId,
        status: filterStatus,
        courierId: filterCourierId,
        dateFrom: filterDateFrom,
        dateTo: filterDateTo,
        originGovId: filterOriginGovId,
        originRegionId: filterOriginRegionId,
        destGovId: filterDestGovId,
        destRegionId: filterDestRegionId,
      });
      setPickupLists(data);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحميل قوائم الالتقاط.',
      });
    } finally {
      setLoading(false);
    }
  }, [
    tenant.id,
    search,
    filterCode,
    filterBranchId,
    filterStatus,
    filterCourierId,
    filterDateFrom,
    filterDateTo,
    filterOriginGovId,
    filterOriginRegionId,
    filterDestGovId,
    filterDestRegionId,
  ]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  const branchNameMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const courierNameMap = useMemo(() => new Map(couriers.map((c) => [c.id, c.name])), [couriers]);
  const routeNameMap = useMemo(() => new Map(routes.map((r) => [r.id, r.name])), [routes]);
  const movementNameMap = useMemo(
    () => new Map(movementTypes.map((m) => [m.id, m.name])),
    [movementTypes],
  );
  const clientNameMap = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const govNameMap = useMemo(() => new Map(governorates.map((g) => [g.id, g.name])), [governorates]);
  const regNameMap = useMemo(() => new Map(regions.map((r) => [r.id, r.name])), [regions]);

  const openNewWorkbench = () => {
    setActiveDetail(null);
    setFeedback(null);
    setFormNotes('');
    setFormClientId('');
    setMode('workbench');
  };

  const openExistingWorkbench = async (id: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      const detail = await getPickupListDetail(tenant.id, id);
      if (detail) {
        setActiveDetail(detail);
        setMode('workbench');
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر فتح تفاصيل القائمة.',
      });
    } finally {
      setBusy(false);
    }
  };

  const refreshActiveDetail = async (id: string) => {
    const detail = await getPickupListDetail(tenant.id, id);
    if (detail) setActiveDetail(detail);
  };

  const handleSaveHeader = async (e: FormEvent) => {
    e.preventDefault();
    if (!formBranchId) return;
    setBusy(true);
    setFeedback(null);
    try {
      const created = await createPickupList(tenant.id, {
        list_date: formDate,
        branch_id: formBranchId,
        courier_id: formCourierId || null,
        route_id: formRouteId || null,
        movement_type_id: formMovementTypeId || null,
        client_id: formClientId || null,
        notes: formNotes.trim() || null,
      });
      await refreshActiveDetail(created.id);
      await loadLists();
      setFeedback({
        type: 'success',
        text: `تم حفظ رأس قائمة الالتقاط ${created.list_code}. يمكنك الآن إضافة الشحنات بالباركود أو الاختيار المجمع.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حفظ رأس القائمة.',
      });
    } finally {
      setBusy(false);
    }
  };

  const openMultiSelectPicker = async () => {
    if (!activeDetail) return;
    setShowSelectModal(true);
    setLoadingEligible(true);
    try {
      const rows = await listEligibleShipmentsForOperation(tenant.id, 'pickup', {
        clientId: activeDetail.list.client_id,
      });
      setEligibleShipments(rows);
    } catch {
      setEligibleShipments([]);
    } finally {
      setLoadingEligible(false);
    }
  };

  const handleBarcodeSubmit = async (query: string) => {
    if (!activeDetail) return;
    await addShipmentsToPickupList(tenant.id, activeDetail.list.id, {
      barcodeQuery: query,
    });
    await refreshActiveDetail(activeDetail.list.id);
    await loadLists();
  };

  const handleConfirmMultiSelect = async (shipmentIds: readonly string[]) => {
    if (!activeDetail) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await addShipmentsToPickupList(tenant.id, activeDetail.list.id, {
        shipmentIds,
      });
      setShowSelectModal(false);
      await refreshActiveDetail(activeDetail.list.id);
      await loadLists();
      setFeedback({
        type: 'success',
        text: `تمت إضافة ${res.added_count} شحنة إلى قائمة الالتقاط${res.skipped_count > 0 ? ` (تجاوز ${res.skipped_count})` : ''}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إضافة الشحنات المحددة.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveItem = async (shipmentId: string) => {
    if (!activeDetail) return;
    setBusy(true);
    try {
      await removeShipmentFromPickupList(tenant.id, activeDetail.list.id, shipmentId);
      await refreshActiveDetail(activeDetail.list.id);
      await loadLists();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إزالة الشحنة.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleApproveList = async () => {
    if (!activeDetail) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await approvePickupList(tenant.id, activeDetail.list.id);
      await refreshActiveDetail(activeDetail.list.id);
      await loadLists();
      setFeedback({
        type: 'success',
        text: `تم اعتماد قائمة الالتقاط ${res.list_code} وتحويل ${res.shipments_count} شحنة إلى قيد الالتقاط وإسنادها للمندوب.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر اعتماد قائمة الالتقاط.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleResetFilters = () => {
    setSearch('');
    setFilterCode('');
    setFilterBranchId('');
    setFilterStatus('');
    setFilterCourierId('');
    setFilterDateFrom('');
    setFilterDateTo('');
    setFilterOriginGovId('');
    setFilterOriginRegionId('');
    setFilterDestGovId('');
    setFilterDestRegionId('');
  };

  const originFilteredRegions = useMemo(
    () => (filterOriginGovId ? regions.filter((r) => r.governorate_id === filterOriginGovId) : regions),
    [regions, filterOriginGovId],
  );
  const destFilteredRegions = useMemo(
    () => (filterDestGovId ? regions.filter((r) => r.governorate_id === filterDestGovId) : regions),
    [regions, filterDestGovId],
  );

  // ============================================================================
  // Workbench Mode (Create Header -> Save -> Attach Shipments -> Approve -> Print)
  // ============================================================================
  if (mode === 'workbench') {
    const listHeader = activeDetail?.list ?? null;
    const isDraft = listHeader?.status === 'draft';
    const items = activeDetail?.items ?? [];

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
          <div>
            <button
              type="button"
              onClick={() => {
                setMode('list');
                setFeedback(null);
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              العودة إلى قوائم الالتقاط
            </button>
            <h1 className="mt-1.5 text-xl font-bold text-slate-900">
              {listHeader ? `قائمة الالتقاط ${listHeader.list_code}` : 'إنشاء قائمة التقاط جديدة'}
            </h1>
            <p className="mt-0.5 text-xs text-slate-600">
              تُحفظ بيانات رأس القائمة أولًا ثم تُضاف الشحنات بالباركود أو الاختيار المجمع قبل الاعتماد.
            </p>
          </div>

          {listHeader && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Printer className="h-3.5 w-3.5" />
                طباعة أمر الشغل
              </button>

              {isDraft && can('operations.pickup.approve', listHeader.branch_id) && (
                <button
                  type="button"
                  disabled={busy || items.length === 0}
                  onClick={() => void handleApproveList()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  اعتماد القائمة ({items.length})
                </button>
              )}
            </div>
          )}
        </div>

        {feedback && (
          <div
            role={feedback.type === 'error' ? 'alert' : 'status'}
            className={`rounded-xl border px-4 py-3 text-xs font-medium print:hidden ${
              feedback.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {/* Step 1: Header Form or Locked Header Summary */}
        {!listHeader ? (
          <form
            onSubmit={(e) => void handleSaveHeader(e)}
            className="space-y-4 rounded-xl border border-slate-200 bg-white p-6"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-semibold text-slate-900">بيانات رأس قائمة الالتقاط</h2>
              <span className="font-mono-tabular text-xs text-slate-500">
                كود القائمة: يُولد تلقائيًا (PKP-XXXXXX)
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label htmlFor="pkp-date" className="block text-xs font-medium text-slate-700">
                  تاريخ القائمة
                </label>
                <input
                  id="pkp-date"
                  type="date"
                  required
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>

              <div>
                <label htmlFor="pkp-branch" className="block text-xs font-medium text-slate-700">
                  الفرع
                </label>
                <select
                  id="pkp-branch"
                  required
                  value={formBranchId}
                  onChange={(e) => setFormBranchId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
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
                <label htmlFor="pkp-courier" className="block text-xs font-medium text-slate-700">
                  مندوب الشحن
                </label>
                <select
                  id="pkp-courier"
                  required
                  value={formCourierId}
                  onChange={(e) => setFormCourierId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="">اختر المندوب...</option>
                  {couriers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="pkp-route" className="block text-xs font-medium text-slate-700">
                  خط السير
                </label>
                <select
                  id="pkp-route"
                  value={formRouteId}
                  onChange={(e) => setFormRouteId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="">خط السير الافتراضي</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} · {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="pkp-movement" className="block text-xs font-medium text-slate-700">
                  نوع الحركة
                </label>
                <select
                  id="pkp-movement"
                  value={formMovementTypeId}
                  onChange={(e) => setFormMovementTypeId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="">التقاط من مقر العميل (افتراضي)</option>
                  {movementTypes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} · {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="pkp-client" className="block text-xs font-medium text-slate-700">
                  العميل / التاجر (اختياري)
                </label>
                <select
                  id="pkp-client"
                  value={formClientId}
                  onChange={(e) => setFormClientId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="">كل العملاء</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label htmlFor="pkp-notes" className="block text-xs font-medium text-slate-700">
                  ملاحظات
                </label>
                <input
                  id="pkp-notes"
                  type="text"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="تعليمات الالتقاط أو نافذة الاستلام"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-500">
                يجب حفظ رأس القائمة أولًا لتفعيل إضافة الشحنات بالباركود أو الاختيار المجمع.
              </p>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {busy ? 'جاري الحفظ...' : 'حفظ رأس القائمة'}
              </button>
            </div>
          </form>
        ) : (
          <>
            {/* Saved Header Strip */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-3 lg:grid-cols-6">
                <div>
                  <span className="text-slate-500">كود القائمة</span>
                  <div className="mt-1 font-mono-tabular font-bold text-slate-900">
                    {listHeader.list_code}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">الحالة</span>
                  <div className={`mt-1 font-semibold ${getPickupStatusClass(listHeader.status)}`}>
                    {PICKUP_STATUS_LABELS[listHeader.status]}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">التاريخ</span>
                  <div className="mt-1 font-mono-tabular text-slate-900">{listHeader.list_date}</div>
                </div>
                <div>
                  <span className="text-slate-500">الفرع</span>
                  <div className="mt-1 text-slate-900">
                    {branchNameMap.get(listHeader.branch_id) ?? '—'}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">المندوب / خط السير</span>
                  <div className="mt-1 text-slate-900">
                    {listHeader.courier_id ? courierNameMap.get(listHeader.courier_id) ?? '—' : 'غير محدد'}
                    {listHeader.route_id ? ` · ${routeNameMap.get(listHeader.route_id) ?? ''}` : ''}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">الحركة والعميل</span>
                  <div className="mt-1 text-slate-900">
                    {listHeader.movement_type_id ? movementNameMap.get(listHeader.movement_type_id) ?? '—' : '—'}
                    {listHeader.client_id ? ` · ${clientNameMap.get(listHeader.client_id) ?? ''}` : ''}
                  </div>
                </div>
              </div>
              {listHeader.notes && (
                <p className="mt-3 border-t border-slate-100 pt-2.5 text-xs text-slate-600">
                  ملاحظات: {listHeader.notes}
                </p>
              )}
            </section>

            {/* Step 2: Shipments Attachment Section */}
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    شحنات قائمة الالتقاط{' '}
                    <span className="font-mono-tabular text-slate-600">({items.length})</span>
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    أضف الشحنات المؤهلة عبر ماسح الباركود أو الاختيار المجمع قبل الاعتماد.
                  </p>
                </div>

                {isDraft && can('operations.pickup.approve', listHeader.branch_id) && (
                  <div className="flex flex-wrap items-center gap-2 print:hidden">
                    <button
                      type="button"
                      onClick={() => setShowBarcodeModal(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
                    >
                      <Barcode className="h-3.5 w-3.5" />
                      إضافة بالباركود / السكانر
                    </button>
                    <button
                      type="button"
                      onClick={() => void openMultiSelectPicker()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      اختيار شحنات
                    </button>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2.5 font-medium">رقم الشحنة</th>
                      <th className="px-3 py-2.5 font-medium">اسم الراسل</th>
                      <th className="px-3 py-2.5 font-medium">المصدر</th>
                      <th className="px-3 py-2.5 font-medium">رقم الموبايل</th>
                      <th className="px-3 py-2.5 font-medium">نوع الطلب ووصف الطرد</th>
                      <th className="px-3 py-2.5 font-medium">القطع والوزن</th>
                      <th className="px-3 py-2.5 font-medium">المبلغ الواجب تحصيله</th>
                      <th className="px-3 py-2.5 font-medium print:hidden">الإجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-xs text-slate-500">
                          لا توجد شحنات مضافة بعد. استخدم «إضافة بالباركود» أو «اختيار شحنات».
                        </td>
                      </tr>
                    ) : (
                      items.map((item) => {
                        const s = item.shipment;
                        if (!s) return null;
                        const srcGov = govNameMap.get(s.sender_governorate_id) ?? '—';
                        const srcReg = regNameMap.get(s.sender_region_id) ?? '—';
                        return (
                          <tr key={item.id} className="hover:bg-slate-50/70">
                            <td className="px-3 py-2.5 font-mono-tabular">
                              <Link
                                to={`${basePath}/shipments/${s.id}`}
                                className="font-semibold text-slate-900 hover:underline"
                              >
                                {s.shipment_number}
                              </Link>
                              <div className="text-[11px] text-slate-500">{s.barcode_token}</div>
                            </td>
                            <td className="px-3 py-2.5 text-slate-900">{s.sender_name ?? '—'}</td>
                            <td className="px-3 py-2.5 text-slate-600">
                              {srcGov} · {srcReg}
                            </td>
                            <td className="px-3 py-2.5 font-mono-tabular text-slate-700">
                              {s.sender_mobile ?? '—'}
                            </td>
                            <td className="px-3 py-2.5 text-slate-700">
                              <div>{SHIPMENT_TYPE_LABELS[s.shipment_type_code]}</div>
                              <div className="text-[11px] text-slate-500">
                                {s.package_description ?? '—'}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 font-mono-tabular text-slate-700 whitespace-nowrap">
                              {s.pieces_count} ق · {s.chargeable_weight_kg} كجم
                            </td>
                            <td className="px-3 py-2.5 font-mono-tabular font-semibold text-slate-900">
                              {Number(s.recipient_collect_amount).toFixed(2)} ج.م
                            </td>
                            <td className="px-3 py-2.5 print:hidden">
                              {isDraft && (
                                <button
                                  type="button"
                                  aria-label={`إزالة ${s.shipment_number}`}
                                  onClick={() => void handleRemoveItem(s.id)}
                                  className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  إزالة
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Signature block shown on print work order */}
              <div className="hidden border-t border-slate-200 pt-6 text-xs text-slate-700 print:grid print:grid-cols-3 print:gap-6">
                <div>توقيع موظف التشغيل: __________________</div>
                <div>توقيع مندوب الالتقاط: __________________</div>
                <div>التاريخ والوقت: __________________</div>
              </div>
            </section>
          </>
        )}

        <BarcodeScanModal
          open={showBarcodeModal}
          title="إضافة شحنة لقائمة الالتقاط بالباركود"
          busy={busy}
          onClose={() => setShowBarcodeModal(false)}
          onSubmitBarcode={handleBarcodeSubmit}
        />

        <MultiSelectShipmentsModal
          open={showSelectModal}
          title="اختيار شحنات لقائمة الالتقاط"
          loading={loadingEligible}
          busy={busy}
          shipments={eligibleShipments}
          alreadyAttachedIds={items.map((i) => i.shipment_id)}
          branches={branches}
          onClose={() => setShowSelectModal(false)}
          onConfirmAdd={handleConfirmMultiSelect}
        />
      </div>
    );
  }

  // ============================================================================
  // List Mode (Search, Filters, Table)
  // ============================================================================
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">قوائم الالتقاط</h1>
          <p className="mt-1 text-sm text-slate-600">
            إعداد واعتماد أوامر التقاط الشحنات من مقرات العملاء وإسنادها للمناديب.
          </p>
        </div>

        {can('operations.pickup.approve') && (
          <button
            type="button"
            onClick={openNewWorkbench}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            قائمة التقاط جديدة
          </button>
        )}
      </div>

      {/* Filters (MASTER_SPEC lines 1052-1062) */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void loadLists();
        }}
        className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث بالكود أو الملاحظات..."
              aria-label="بحث في قوائم الالتقاط"
              className="w-full rounded-lg border border-slate-200 py-2 pr-9 pl-3 text-xs focus:border-slate-400 focus:outline-none"
            />
          </div>

          <select
            aria-label="الفرع"
            value={filterBranchId}
            onChange={(e) => setFilterBranchId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <option value="">كل الفروع</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <select
            aria-label="حالة القائمة"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <option value="">كل الحالات</option>
            {Object.entries(PICKUP_STATUS_LABELS).map(([k, lbl]) => (
              <option key={k} value={k}>
                {lbl}
              </option>
            ))}
          </select>

          <select
            aria-label="مندوب الشحن"
            value={filterCourierId}
            onChange={(e) => setFilterCourierId(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <option value="">كل المناديب</option>
            {couriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setShowAdvancedFilters((p) => !p)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Filter className="h-3.5 w-3.5" />
            فلاتر متقدمة
          </button>

          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            تطبيق
          </button>

          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
          >
            <X className="h-3.5 w-3.5" />
            مسح
          </button>
        </div>

        {showAdvancedFilters && (
          <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs text-slate-500">الكود</label>
              <input
                type="text"
                value={filterCode}
                onChange={(e) => setFilterCode(e.target.value)}
                placeholder="PKP-000001"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">من تاريخ</label>
              <input
                type="date"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">إلى تاريخ</label>
              <input
                type="date"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500">من إقليم / محافظة</label>
              <select
                value={filterOriginGovId}
                onChange={(e) => {
                  setFilterOriginGovId(e.target.value);
                  setFilterOriginRegionId('');
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
              >
                <option value="">الكل</option>
                {governorates.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500">من منطقة</label>
              <select
                value={filterOriginRegionId}
                onChange={(e) => setFilterOriginRegionId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
              >
                <option value="">الكل</option>
                {originFilteredRegions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500">إلى إقليم / محافظة</label>
              <select
                value={filterDestGovId}
                onChange={(e) => {
                  setFilterDestGovId(e.target.value);
                  setFilterDestRegionId('');
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
              >
                <option value="">الكل</option>
                {governorates.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-500">إلى منطقة</label>
              <select
                value={filterDestRegionId}
                onChange={(e) => setFilterDestRegionId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
              >
                <option value="">الكل</option>
                {destFilteredRegions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </form>

      {feedback && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700"
        >
          {feedback.text}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">الكود</th>
              <th className="px-4 py-3 font-medium">التاريخ</th>
              <th className="px-4 py-3 font-medium">الفرع</th>
              <th className="px-4 py-3 font-medium">مندوب الشحن</th>
              <th className="px-4 py-3 font-medium">الشحنات</th>
              <th className="px-4 py-3 font-medium">الحالة</th>
              <th className="px-4 py-3 font-medium">الإنشاء</th>
              <th className="px-4 py-3 font-medium">الإجراء</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  جاري تحميل قوائم الالتقاط...
                </td>
              </tr>
            ) : pickupLists.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                  <ClipboardList className="mx-auto mb-2 h-6 w-6 text-slate-400" />
                  <p>لا توجد قوائم التقاط مسجلة حتى الآن.</p>
                </td>
              </tr>
            ) : (
              pickupLists.map((pl) => (
                <tr key={pl.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">
                    {pl.list_code}
                  </td>
                  <td className="px-4 py-3 font-mono-tabular text-slate-700">{pl.list_date}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {branchNameMap.get(pl.branch_id) ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {pl.courier_id ? courierNameMap.get(pl.courier_id) ?? '—' : 'غير محدد'}
                  </td>
                  <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">
                    {pl.shipments_count ?? 0} شحنة
                  </td>
                  <td className={`px-4 py-3 font-semibold ${getPickupStatusClass(pl.status)}`}>
                    {PICKUP_STATUS_LABELS[pl.status]}
                  </td>
                  <td className="px-4 py-3 font-mono-tabular text-slate-500">
                    {formatDateTime(pl.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => void openExistingWorkbench(pl.id)}
                      className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      {pl.status === 'draft' ? 'تجهيز واعتماد' : 'عرض التفاصيل'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
