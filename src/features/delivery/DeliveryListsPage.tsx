import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {listCourierRoutes, listCouriers} from '@/features/couriers/couriersService';
import {
  listBranches,
  listExceptionReasons,
  listMovementTypes,
} from '@/features/definitions/definitionsService';
import {DeliveryExecutionModal} from '@/features/delivery/DeliveryExecutionModal';
import {
  addShipmentsToDeliveryList,
  approveDeliveryList,
  createDeliveryList,
  getDeliveryListDetail,
  getTenantDeliveryPolicy,
  listDeliveryLists,
  listEligibleShipmentsForDelivery,
  removeShipmentFromDeliveryList,
  updateTenantDeliveryPolicy,
} from '@/features/delivery/deliveryService';
import {
  BarcodeScanModal,
  MultiSelectShipmentsModal,
} from '@/features/operations/ShipmentAttachmentModals';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {formatDateTime} from '@/lib/formatters';
import type {CourierRecord, CourierRouteRecord} from '@/types/couriers';
import type {
  BranchRecord,
  DeliveryExceptionReasonRecord,
  MovementTypeRecord,
} from '@/types/definitions';
import {
  DELIVERY_LIST_STATUS_LABELS,
  DELIVERY_OUTCOME_LABELS,
  type DeliveryListDetail,
  type DeliveryListRecord,
  type DeliveryListStatus,
  type DeliveryListType,
  type TenantDeliveryPolicyRecord,
} from '@/types/delivery';
import type {ShipmentListItem} from '@/types/shipments';
import {
  ArrowRight,
  Barcode,
  CheckCircle2,
  ClipboardList,
  Plus,
  Printer,
  Search,
  Settings,
  ShieldAlert,
  Trash2,
  Truck,
} from 'lucide-react';

interface DeliveryListsPageProps {
  readonly listType?: DeliveryListType;
}

function getListStatusClass(status: DeliveryListStatus): string {
  if (status === 'approved' || status === 'closed') return 'text-emerald-700';
  if (status === 'cancelled') return 'text-red-700';
  return 'text-amber-700';
}

export function DeliveryListsPage({listType = 'delivery'}: DeliveryListsPageProps) {
  const {tenant, branchIds, membership, can} = useTenantWorkspace();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [couriers, setCouriers] = useState<readonly CourierRecord[]>([]);
  const [routes, setRoutes] = useState<readonly CourierRouteRecord[]>([]);
  const [movementTypes, setMovementTypes] = useState<readonly MovementTypeRecord[]>([]);
  const [exceptionReasons, setExceptionReasons] = useState<readonly DeliveryExceptionReasonRecord[]>([]);
  const [policy, setPolicy] = useState<TenantDeliveryPolicyRecord>({
    tenant_id: tenant.id,
    max_delivery_attempts: 3,
    retry_extra_fee: 0,
    require_pod_on_delivery: false,
  });

  const [mode, setMode] = useState<'list' | 'workbench'>('list');
  const [lists, setLists] = useState<readonly DeliveryListRecord[]>([]);
  const [activeDetail, setActiveDetail] = useState<DeliveryListDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  // Filters
  const [filterCode, setFilterCode] = useState('');
  const [filterBranchId, setFilterBranchId] = useState('');
  const [filterCourierId, setFilterCourierId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Create header form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newBranchId, setNewBranchId] = useState(branchIds[0] ?? '');
  const [newCourierId, setNewCourierId] = useState('');
  const [newRouteId, setNewRouteId] = useState('');
  const [newMovementTypeId, setNewMovementTypeId] = useState('');
  const [newListDate, setNewListDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newNotes, setNewNotes] = useState('');

  // Policy modal/panel state
  const [showPolicyPanel, setShowPolicyPanel] = useState(false);
  const [policyMaxAttempts, setPolicyMaxAttempts] = useState('3');
  const [policyRetryFee, setPolicyRetryFee] = useState('0');
  const [policyRequirePod, setPolicyRequirePod] = useState(false);

  // Attachment & Execution modals
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [showMultiSelectModal, setShowMultiSelectModal] = useState(false);
  const [adminOverrideAttempts, setAdminOverrideAttempts] = useState(false);
  const [eligibleShipments, setEligibleShipments] = useState<readonly ShipmentListItem[]>([]);
  const [loadingEligible, setLoadingEligible] = useState(false);
  const [execShipment, setExecShipment] = useState<ShipmentListItem | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);

  const canManageLists = can('operations.pickup.approve') || can('operations.delivery.execute');
  const canOverrideAttempts =
    membership.role_key === 'company_owner' ||
    membership.role_key === 'company_admin' ||
    membership.role_key === 'operations_manager';

  const loadRefs = useCallback(async () => {
    try {
      const [br, crr, rt, mov, reasons, pol] = await Promise.all([
        listBranches(tenant.id),
        listCouriers(tenant.id),
        listCourierRoutes(tenant.id),
        listMovementTypes(tenant.id),
        listExceptionReasons(tenant.id),
        getTenantDeliveryPolicy(tenant.id),
      ]);
      setBranches(br);
      setCouriers(crr.filter((c) => c.is_active));
      setRoutes(rt);
      setMovementTypes(mov);
      setExceptionReasons(reasons.filter((r) => r.is_active));
      setPolicy(pol);
      setPolicyMaxAttempts(String(pol.max_delivery_attempts));
      setPolicyRetryFee(String(pol.retry_extra_fee));
      setPolicyRequirePod(pol.require_pod_on_delivery);

      if (!newBranchId && br[0]) setNewBranchId(br[0].id);
      if (!newCourierId && crr[0]) setNewCourierId(crr[0].id);
      const defaultMov = mov.find((m) => m.code === 'MOV-005');
      if (defaultMov && !newMovementTypeId) setNewMovementTypeId(defaultMov.id);
    } catch {
      // Non-blocking reference loaders
    }
  }, [tenant.id, newBranchId, newCourierId, newMovementTypeId]);

  const loadLists = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listDeliveryLists(tenant.id, listType, {
        code: filterCode,
        branchId: filterBranchId,
        courierId: filterCourierId,
        status: filterStatus,
      });
      setLists(data);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحميل قوائم التوصيل.'});
    } finally {
      setLoading(false);
    }
  }, [tenant.id, listType, filterCode, filterBranchId, filterCourierId, filterStatus]);

  useEffect(() => {
    setMode('list');
    setActiveDetail(null);
    setFeedback(null);
  }, [listType]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const courierMap = useMemo(() => new Map(couriers.map((c) => [c.id, c.name])), [couriers]);
  const routeMap = useMemo(() => new Map(routes.map((r) => [r.id, r.name])), [routes]);

  const refreshActiveDetail = async (id: string) => {
    const detail = await getDeliveryListDetail(tenant.id, id);
    setActiveDetail(detail);
  };

  const handleOpenWorkbench = async (id: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await refreshActiveDetail(id);
      setAdminOverrideAttempts(false);
      setMode('workbench');
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر فتح القائمة.'});
    } finally {
      setBusy(false);
    }
  };

  const handleCreateHeader = async (e: FormEvent) => {
    e.preventDefault();
    if (!newBranchId || !newCourierId) {
      setFeedback({type: 'error', text: 'يجب اختيار الفرع والمندوب قبل إنشاء القائمة.'});
      return;
    }

    setBusy(true);
    setFeedback(null);
    try {
      const res = await createDeliveryList(tenant.id, {
        list_type: listType,
        list_date: newListDate,
        branch_id: newBranchId,
        courier_id: newCourierId,
        route_id: newRouteId || null,
        movement_type_id: newMovementTypeId || null,
        notes: newNotes.trim() || null,
      });
      setShowCreateForm(false);
      setNewNotes('');
      await Promise.all([loadLists(), refreshActiveDetail(res.id)]);
      setMode('workbench');
      setFeedback({type: 'success', text: `تم إنشاء القائمة (${res.list_code}) بنجاح. أضف الشحنات ثم اعتمدها.`});
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر إنشاء قائمة التوصيل.'});
    } finally {
      setBusy(false);
    }
  };

  const handleSavePolicy = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFeedback(null);
    try {
      const updated = await updateTenantDeliveryPolicy(
        tenant.id,
        Number(policyMaxAttempts || 3),
        Number(policyRetryFee || 0),
        policyRequirePod,
      );
      setPolicy(updated);
      setShowPolicyPanel(false);
      setFeedback({
        type: 'success',
        text: `تم حفظ سياسة التوصيل: الحد الأقصى للمحاولات (${updated.max_delivery_attempts})، وإثبات التسليم ${updated.require_pod_on_delivery ? 'إلزامي' : 'اختياري'}.`,
      });
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحديث السياسة.'});
    } finally {
      setBusy(false);
    }
  };

  const handleOpenMultiSelect = async () => {
    if (!activeDetail) return;
    setShowMultiSelectModal(true);
    setLoadingEligible(true);
    try {
      const eligible = await listEligibleShipmentsForDelivery(
        tenant.id,
        listType,
        activeDetail.list.branch_id,
      );
      setEligibleShipments(eligible);
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحميل الشحنات المؤهلة.'});
    } finally {
      setLoadingEligible(false);
    }
  };

  const handleAddByBarcode = async (query: string) => {
    if (!activeDetail) return;
    await addShipmentsToDeliveryList(tenant.id, activeDetail.list.id, [], query, adminOverrideAttempts);
    await refreshActiveDetail(activeDetail.list.id);
    await loadLists();
  };

  const handleAddMultiSelect = async (ids: readonly string[]) => {
    if (!activeDetail) return;
    const res = await addShipmentsToDeliveryList(
      tenant.id,
      activeDetail.list.id,
      ids,
      undefined,
      adminOverrideAttempts,
    );
    await refreshActiveDetail(activeDetail.list.id);
    await loadLists();
    setFeedback({
      type: 'success',
      text: `تمت إضافة ${res.added_count} شحنة${res.skipped_count > 0 ? ` (وتخطي ${res.skipped_count} شحنة مستنفدة للمحاولات أو غير مطابقة)` : ''}.`,
    });
  };

  const handleRemoveItem = async (shipmentId: string) => {
    if (!activeDetail) return;
    setBusy(true);
    setFeedback(null);
    try {
      await removeShipmentFromDeliveryList(tenant.id, activeDetail.list.id, shipmentId);
      await refreshActiveDetail(activeDetail.list.id);
      await loadLists();
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر إزالة الشحنة.'});
    } finally {
      setBusy(false);
    }
  };

  const handleApproveList = async () => {
    if (!activeDetail) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await approveDeliveryList(tenant.id, activeDetail.list.id);
      await Promise.all([refreshActiveDetail(activeDetail.list.id), loadLists()]);
      setFeedback({
        type: 'success',
        text: `تم اعتماد القائمة (${res.list_code}) وإخراج ${res.shipments_count} شحنة للتوصيل مع المندوب.`,
      });
    } catch (err) {
      setFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر اعتماد القائمة.'});
    } finally {
      setBusy(false);
    }
  };

  const pageTitle = listType === 'redelivery' ? 'قوائم إعادة التوصيل (RDL)' : 'قوائم التوصيل (DLV)';
  const pageSubtitle =
    listType === 'redelivery'
      ? 'إعادة جدولة الشحنات المؤجلة والمتعثرة للخروج مع المناديب وفق سقف المحاولات المعتمد.'
      : 'تجهيز واعتماد خروج الشحنات للتوصيل مع المناديب ومتابعة نتائج التسليم الميداني وإثبات الاستلام.';

  const totalCodInWorkbench = useMemo(
    () =>
      (activeDetail?.items ?? []).reduce(
        (sum, item) => sum + Number(item.shipment?.recipient_collect_amount ?? 0),
        0,
      ),
    [activeDetail],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{pageTitle}</h1>
          <p className="mt-1 text-sm text-slate-600">{pageSubtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canOverrideAttempts && (
            <button
              type="button"
              onClick={() => setShowPolicyPanel((p) => !p)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Settings className="h-3.5 w-3.5" />
              سياسة المحاولات ({policy.max_delivery_attempts})
            </button>
          )}

          {mode === 'workbench' ? (
            <button
              type="button"
              onClick={() => {
                setMode('list');
                setActiveDetail(null);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <ArrowRight className="h-3.5 w-3.5" />
              العودة إلى قائمة القوائم
            </button>
          ) : (
            canManageLists && (
              <button
                type="button"
                onClick={() => setShowCreateForm((p) => !p)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                <Plus className="h-4 w-4" />
                {listType === 'redelivery' ? 'إنشاء قائمة إعادة توصيل' : 'إنشاء قائمة توصيل جديدة'}
              </button>
            )
          )}
        </div>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`rounded-xl border px-4 py-3 text-xs print:hidden ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Configurable Delivery & Retry Policy Panel (ADR-017) */}
      {showPolicyPanel && canOverrideAttempts && (
        <form
          onSubmit={(e) => void handleSavePolicy(e)}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 print:hidden"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">سياسة محاولات التوصيل وإثبات التسليم</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                عند وصول الشحنة للحد الأقصى يتم تحويلها تلقائيًا للمرتجع، وتُمنع الإضافة لقوائم جديدة إلا باستثناء إداري.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="pol-max-attempts" className="block text-xs font-medium text-slate-700">
                الحد الأقصى لمحاولات التوصيل
              </label>
              <input
                id="pol-max-attempts"
                type="number"
                min={1}
                max={10}
                value={policyMaxAttempts}
                onChange={(e) => setPolicyMaxAttempts(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
              />
            </div>

            <div>
              <label htmlFor="pol-retry-fee" className="block text-xs font-medium text-slate-700">
                رسوم إضافية عند الاستثناء الإداري (ج.م)
              </label>
              <input
                id="pol-retry-fee"
                type="number"
                min={0}
                step="0.01"
                value={policyRetryFee}
                onChange={(e) => setPolicyRetryFee(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
              />
            </div>

            <div className="flex items-end pb-2">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800">
                <input
                  type="checkbox"
                  checked={policyRequirePod}
                  onChange={(e) => setPolicyRequirePod(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                إلزام التوقيع أو رمز OTP عند التسليم (POD)
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowPolicyPanel(false)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              حفظ السياسة
            </button>
          </div>
        </form>
      )}

      {/* Header Creation Form */}
      {mode === 'list' && showCreateForm && (
        <form
          onSubmit={(e) => void handleCreateHeader(e)}
          className="rounded-xl border border-slate-200 bg-white p-5 space-y-4 print:hidden"
        >
          <h2 className="text-sm font-bold text-slate-900">
            رأس {listType === 'redelivery' ? 'قائمة إعادة التوصيل (RDL)' : 'قائمة التوصيل (DLV)'}
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <div>
              <label htmlFor="dlv-date" className="block text-xs text-slate-600">
                تاريخ القائمة
              </label>
              <input
                id="dlv-date"
                type="date"
                value={newListDate}
                onChange={(e) => setNewListDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
              />
            </div>

            <div>
              <label htmlFor="dlv-branch" className="block text-xs text-slate-600">
                الفرع *
              </label>
              <select
                id="dlv-branch"
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
              <label htmlFor="dlv-courier" className="block text-xs text-slate-600">
                المندوب *
              </label>
              <select
                id="dlv-courier"
                required
                value={newCourierId}
                onChange={(e) => setNewCourierId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              >
                <option value="">اختر المندوب...</option>
                {couriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="dlv-route" className="block text-xs text-slate-600">
                خط السير
              </label>
              <select
                id="dlv-route"
                value={newRouteId}
                onChange={(e) => setNewRouteId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              >
                <option value="">خط السير الافتراضي</option>
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="dlv-mov" className="block text-xs text-slate-600">
                نوع الحركة
              </label>
              <select
                id="dlv-mov"
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
              placeholder="ملاحظات اختيارية حول القائمة..."
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
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {busy ? 'جاري الحفظ...' : 'حفظ رأس القائمة وإضافة شحنات'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* List Mode */}
      {mode === 'list' && (
        <>
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4">
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={filterCode}
                onChange={(e) => setFilterCode(e.target.value)}
                placeholder="بحث برقم القائمة..."
                aria-label="بحث برقم القائمة"
                className="w-full rounded-lg border border-slate-200 py-2 pr-9 pl-3 font-mono-tabular text-xs"
              />
            </div>

            <select
              aria-label="الفرع"
              value={filterBranchId}
              onChange={(e) => setFilterBranchId(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
            >
              <option value="">كل الفروع</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>

            <select
              aria-label="المندوب"
              value={filterCourierId}
              onChange={(e) => setFilterCourierId(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
            >
              <option value="">كل المناديب</option>
              {couriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            <select
              aria-label="حالة القائمة"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs"
            >
              <option value="">كل الحالات</option>
              {Object.entries(DELIVERY_LIST_STATUS_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">رقم القائمة</th>
                  <th className="px-4 py-3 font-medium">التاريخ</th>
                  <th className="px-4 py-3 font-medium">الفرع</th>
                  <th className="px-4 py-3 font-medium">المندوب وخط السير</th>
                  <th className="px-4 py-3 font-medium">الشحنات / المعلق</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-slate-500">
                      جاري تحميل القوائم...
                    </td>
                  </tr>
                ) : lists.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-sm text-slate-500">
                      لا توجد قوائم مسجلة بعد.
                    </td>
                  </tr>
                ) : (
                  lists.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">{l.list_code}</td>
                      <td className="px-4 py-3 font-mono-tabular text-slate-600">{l.list_date}</td>
                      <td className="px-4 py-3 text-slate-800">{branchMap.get(l.branch_id) ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-800">
                        {courierMap.get(l.courier_id) ?? '—'}
                        {l.route_id ? ` · ${routeMap.get(l.route_id) ?? ''}` : ''}
                      </td>
                      <td className="px-4 py-3 font-mono-tabular text-slate-700">
                        {l.shipments_count ?? 0} شحنة · معلق: {l.pending_count ?? 0}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-semibold ${getListStatusClass(l.status)}`}>
                          {DELIVERY_LIST_STATUS_LABELS[l.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => void handleOpenWorkbench(l.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          <ClipboardList className="h-3.5 w-3.5" />
                          {l.status === 'draft' ? 'تجهيز واعتماد' : 'عرض ومتابعة التسليم'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Workbench Mode */}
      {mode === 'workbench' && activeDetail && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm">
                  <Truck className="h-4 w-4 text-slate-700" />
                  <span className="font-mono-tabular font-bold text-slate-900">{activeDetail.list.list_code}</span>
                  <span aria-hidden="true">·</span>
                  <span className={`font-semibold ${getListStatusClass(activeDetail.list.status)}`}>
                    {DELIVERY_LIST_STATUS_LABELS[activeDetail.list.status]}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-slate-600">
                  الفرع: {branchMap.get(activeDetail.list.branch_id) ?? '—'} · المندوب:{' '}
                  {courierMap.get(activeDetail.list.courier_id) ?? '—'} · التاريخ:{' '}
                  <span className="font-mono-tabular">{activeDetail.list.list_date}</span> · إجمالي التحصيل المطلوب:{' '}
                  <span className="font-mono-tabular font-semibold text-slate-900">
                    {totalCodInWorkbench.toFixed(2)} ج.م
                  </span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 print:hidden">
                {activeDetail.list.status === 'draft' && canManageLists && (
                  <>
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
                      اختيار شحنات
                    </button>
                    <button
                      type="button"
                      disabled={busy || activeDetail.items.length === 0}
                      onClick={() => void handleApproveList()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      اعتماد القائمة وخروج للتوصيل
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setShowPrintPreview((p) => !p);
                    if (typeof window !== 'undefined' && typeof window.print === 'function') {
                      setTimeout(() => window.print(), 100);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Printer className="h-3.5 w-3.5" />
                  طباعة بيان التوصيل
                </button>
              </div>
            </div>

            {activeDetail.list.status === 'draft' && canOverrideAttempts && (
              <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-700 print:hidden">
                <ShieldAlert className="h-4 w-4 text-amber-600 shrink-0" />
                <label className="inline-flex items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    checked={adminOverrideAttempts}
                    onChange={(e) => setAdminOverrideAttempts(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  تجاوز إداري لحد محاولات التوصيل ({policy.max_delivery_attempts}) للشحنات المضافة (يُسجل في سجل التدقيق)
                </label>
              </div>
            )}
          </div>

          {showPrintPreview && (
            <div className="rounded-xl border border-slate-200 bg-white p-5 print:border-0 print:p-0">
              <div className="mb-3 flex items-center justify-between border-b border-slate-200 pb-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    مانيفست خروج للتوصيل — {activeDetail.list.list_code}
                  </h3>
                  <p className="text-xs text-slate-500">
                    المندوب: {courierMap.get(activeDetail.list.courier_id) ?? '—'} · عدد الشحنات:{' '}
                    {activeDetail.items.length} · إجمالي التحصيل: {totalCodInWorkbench.toFixed(2)} ج.م
                  </p>
                </div>
                <span className="font-mono-tabular text-xs text-slate-500">
                  تاريخ الطباعة: {formatDateTime(new Date().toISOString())}
                </span>
              </div>
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">رقم الشحنة</th>
                  <th className="px-4 py-3 font-medium">المستلم والهاتف والعنوان</th>
                  <th className="px-4 py-3 font-medium">التحصيل المطلوب</th>
                  <th className="px-4 py-3 font-medium">المحاولات</th>
                  <th className="px-4 py-3 font-medium">النتيجة التنفيذية</th>
                  <th className="px-4 py-3 font-medium print:hidden">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeDetail.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-500">
                      لا توجد شحنات مضافة في هذه القائمة بعد.
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
                          <div className="mt-0.5 font-mono-tabular text-[11px] text-slate-500">
                            {shp?.barcode_token ?? ''}
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium text-slate-900">{shp?.recipient_name ?? '—'}</div>
                          <div className="mt-0.5 font-mono-tabular text-[11px] text-slate-600">
                            {shp?.recipient_mobile ?? '—'}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">{shp?.recipient_address ?? '—'}</div>
                        </td>
                        <td className="px-4 py-3 align-top font-mono-tabular font-semibold text-slate-900">
                          {Number(shp?.recipient_collect_amount ?? 0).toFixed(2)} ج.م
                          {item.delivered_amount !== null && (
                            <div className="mt-0.5 text-[11px] font-normal text-emerald-700">
                              محصل: {Number(item.delivered_amount).toFixed(2)}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top font-mono-tabular text-slate-700">
                          {shp?.delivery_attempts_count ?? 0} / {policy.max_delivery_attempts}
                          {item.attempt_overridden && (
                            <div className="mt-0.5 text-[11px] text-amber-700">استثناء إداري</div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <span
                            className={`font-semibold ${
                              item.execution_outcome === 'delivered'
                                ? 'text-emerald-700'
                                : item.execution_outcome === 'pending'
                                  ? 'text-slate-600'
                                  : 'text-amber-700'
                            }`}
                          >
                            {DELIVERY_OUTCOME_LABELS[item.execution_outcome]}
                          </span>
                          {item.outcome_notes && (
                            <div className="mt-0.5 text-[11px] text-slate-500">{item.outcome_notes}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 align-top print:hidden">
                          {activeDetail.list.status === 'draft' && canManageLists ? (
                            <button
                              type="button"
                              onClick={() => void handleRemoveItem(item.shipment_id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-700 hover:bg-red-50"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              إزالة
                            </button>
                          ) : (
                            shp &&
                            (activeDetail.list.status === 'approved' || activeDetail.list.status === 'closed') &&
                            item.execution_outcome === 'pending' && (
                              <button
                                type="button"
                                onClick={() => setExecShipment(shp)}
                                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
                              >
                                تسجيل النتيجة
                              </button>
                            )
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
        title="إضافة شحنة بالباركود لقائمة التوصيل"
        busy={busy}
        onClose={() => setShowBarcodeModal(false)}
        onSubmitBarcode={handleAddByBarcode}
      />

      <MultiSelectShipmentsModal
        open={showMultiSelectModal}
        title={listType === 'redelivery' ? 'اختيار شحنات لإعادة التوصيل' : 'اختيار شحنات للتوصيل'}
        loading={loadingEligible}
        busy={busy}
        shipments={eligibleShipments}
        alreadyAttachedIds={(activeDetail?.items ?? []).map((i) => i.shipment_id)}
        branches={branches}
        onClose={() => setShowMultiSelectModal(false)}
        onConfirmAdd={handleAddMultiSelect}
      />

      <DeliveryExecutionModal
        open={execShipment !== null}
        tenantId={tenant.id}
        shipment={execShipment}
        deliveryListId={activeDetail?.list.id ?? null}
        requirePod={policy.require_pod_on_delivery}
        maxAttempts={policy.max_delivery_attempts}
        exceptionReasons={exceptionReasons}
        onClose={() => setExecShipment(null)}
        onExecuted={async (res) => {
          if (activeDetail) {
            await Promise.all([refreshActiveDetail(activeDetail.list.id), loadLists()]);
          }
          setFeedback({
            type: 'success',
            text: res.auto_returned_by_limit
              ? 'تم تحويل الشحنة تلقائيًا للمرتجع بعد استنفاد الحد الأقصى لمحاولات التوصيل.'
              : 'تم تسجيل نتيجة التوصيل وتحديث حالة الشحنة والقائمة.',
          });
        }}
      />
    </div>
  );
}
