import {LoadingState} from '@/components/ui/LoadingState';
import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link, useSearchParams} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {listCouriers} from '@/features/couriers/couriersService';
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
  addShipmentsToWarehouseManifest,
  approveWarehouseManifest,
  createWarehouseManifest,
  getWarehouseManifestDetail,
  listBranchInboundTransferShipments,
  listEligibleShipmentsForOperation,
  listWarehouseManifests,
  removeShipmentFromWarehouseManifest,
} from '@/features/operations/operationsService';
import {repriceShipment} from '@/features/shipments/shipmentsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {formatDateTime} from '@/lib/formatters';
import type {CourierRecord} from '@/types/couriers';
import type {
  BranchRecord,
  GovernorateRecord,
  MovementTypeRecord,
  RegionRecord,
} from '@/types/definitions';
import {
  MANIFEST_STATUS_LABELS,
  WAREHOUSE_PRINT_LAYOUT_LABELS,
  type InboundTransferShipmentRecord,
  type WarehouseManifestDetail,
  type WarehouseManifestRecord,
  type WarehouseManifestStatus,
  type WarehousePrintLayoutMode,
} from '@/types/operations';
import {PAYMENT_TERM_LABELS, type ShipmentListItem} from '@/types/shipments';
import {
  ArrowRight,
  Barcode,
  CheckCircle2,
  Filter,
  PackageCheck,
  Plus,
  Printer,
  Scale,
  Search,
  Trash2,
  X,
} from 'lucide-react';

function getManifestStatusClass(status: WarehouseManifestStatus): string {
  if (status === 'approved') return 'text-emerald-700';
  if (status === 'cancelled') return 'text-red-700';
  if (status === 'in_transit' || status === 'partially_received') return 'text-sky-700';
  return 'text-amber-700';
}

export function WarehouseIntakePage() {
  const {tenant, branchIds, can} = useTenantWorkspace();
  const [searchParams] = useSearchParams();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  // Refs
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [couriers, setCouriers] = useState<readonly CourierRecord[]>([]);
  const [movementTypes, setMovementTypes] = useState<readonly MovementTypeRecord[]>([]);
  const [governorates, setGovernorates] = useState<readonly GovernorateRecord[]>([]);
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);

  // View state
  const [mode, setMode] = useState<'list' | 'workbench'>(() =>
    searchParams.get('create') === '1' ? 'workbench' : 'list',
  );
  const [manifests, setManifests] = useState<readonly WarehouseManifestRecord[]>([]);
  const [activeDetail, setActiveDetail] = useState<WarehouseManifestDetail | null>(null);
  const [inboundPending, setInboundPending] = useState<readonly InboundTransferShipmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  // Filters (MASTER_SPEC lines 1116-1126)
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

  // Header Form
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formBranchId, setFormBranchId] = useState(() => searchParams.get('branchId') ?? '');
  const [formCourierId, setFormCourierId] = useState('');
  const [formMovementTypeId, setFormMovementTypeId] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Modals & Print Mode
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [showSelectModal, setShowSelectModal] = useState(false);
  const [eligibleShipments, setEligibleShipments] = useState<readonly ShipmentListItem[]>([]);
  const [loadingEligible, setLoadingEligible] = useState(false);
  const [printLayout, setPrintLayout] = useState<WarehousePrintLayoutMode>('two_copies_same');

  // ADR-010 Inline Weight Adjustment Modal
  const [repriceTarget, setRepriceTarget] = useState<ShipmentListItem | null>(null);
  const [revWeight, setRevWeight] = useState('1');
  const [revLength, setRevLength] = useState('0');
  const [revWidth, setRevWidth] = useState('0');
  const [revHeight, setRevHeight] = useState('0');
  const [revReason, setRevReason] = useState('');

  const loadRefs = useCallback(async () => {
    try {
      const [br, cr, mov, gov, reg] = await Promise.all([
        listBranches(tenant.id),
        listCouriers(tenant.id),
        listMovementTypes(tenant.id),
        listGovernorates(tenant.id),
        listRegions(tenant.id),
      ]);
      setBranches(br);
      setCouriers(cr);
      setMovementTypes(mov);
      setGovernorates(gov);
      setRegions(reg);

      const defaultBranch =
        (branchIds.length > 0 ? br.find((b) => branchIds.includes(b.id)) : br.find((b) => b.is_main)) ??
        br[0];
      if (defaultBranch) {
        setFormBranchId((curr) => curr || defaultBranch.id);
      }
      const movIntake = mov.find((m) => m.code === 'MOV-002') ?? mov[0];
      if (movIntake) {
        setFormMovementTypeId((curr) => curr || movIntake.id);
      }
    } catch {
      // Non-blocking refs
    }
  }, [tenant.id, branchIds]);

  const loadManifests = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listWarehouseManifests(tenant.id, 'intake', {
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
      setManifests(rows);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحميل قوائم الاستلام بالمخزن.',
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
    void loadManifests();
  }, [loadManifests]);

  const loadInboundForBranch = useCallback(
    async (branchId: string) => {
      if (!branchId) {
        setInboundPending([]);
        return;
      }
      try {
        const rows = await listBranchInboundTransferShipments(tenant.id, branchId);
        setInboundPending(rows);
      } catch {
        setInboundPending([]);
      }
    },
    [tenant.id],
  );

  useEffect(() => {
    if (activeDetail?.manifest.branch_id && activeDetail.manifest.status === 'draft') {
      void loadInboundForBranch(activeDetail.manifest.branch_id);
    } else {
      setInboundPending([]);
    }
  }, [activeDetail?.manifest.branch_id, activeDetail?.manifest.status, loadInboundForBranch]);

  const branchNameMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const courierNameMap = useMemo(() => new Map(couriers.map((c) => [c.id, c.name])), [couriers]);
  const movementNameMap = useMemo(
    () => new Map(movementTypes.map((m) => [m.id, m.name])),
    [movementTypes],
  );
  const govNameMap = useMemo(() => new Map(governorates.map((g) => [g.id, g.name])), [governorates]);
  const regNameMap = useMemo(() => new Map(regions.map((r) => [r.id, r.name])), [regions]);

  const openNewWorkbench = () => {
    setActiveDetail(null);
    setFeedback(null);
    setFormNotes('');
    setMode('workbench');
  };

  const openExistingWorkbench = async (id: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      const detail = await getWarehouseManifestDetail(tenant.id, id);
      if (detail) {
        setActiveDetail(detail);
        setMode('workbench');
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر فتح قائمة الاستلام.',
      });
    } finally {
      setBusy(false);
    }
  };

  const refreshActiveDetail = async (id: string) => {
    const detail = await getWarehouseManifestDetail(tenant.id, id);
    if (detail) {
      setActiveDetail(detail);
      if (detail.manifest.status === 'draft') {
        await loadInboundForBranch(detail.manifest.branch_id);
      }
    }
  };

  const handleSaveHeader = async (e: FormEvent) => {
    e.preventDefault();
    if (!formBranchId) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await createWarehouseManifest(tenant.id, {
        manifest_type: 'intake',
        manifest_date: formDate,
        branch_id: formBranchId,
        courier_id: formCourierId || null,
        movement_type_id: formMovementTypeId || null,
        notes: formNotes.trim() || null,
      });
      await refreshActiveDetail(res.id);
      await loadManifests();
      setFeedback({
        type: 'success',
        text: `تم حفظ رأس قائمة الاستلام بالمخزن ${res.manifest_code}. يمكنك الآن إضافة الشحنات بالباركود أو الاختيار المجمع.`,
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
      const rows = await listEligibleShipmentsForOperation(tenant.id, 'intake');
      setEligibleShipments(rows);
    } catch {
      setEligibleShipments([]);
    } finally {
      setLoadingEligible(false);
    }
  };

  const handleBarcodeSubmit = async (query: string) => {
    if (!activeDetail) return;
    await addShipmentsToWarehouseManifest(tenant.id, activeDetail.manifest.id, {
      barcodeQuery: query,
    });
    await refreshActiveDetail(activeDetail.manifest.id);
    await loadManifests();
  };

  const handleConfirmMultiSelect = async (shipmentIds: readonly string[]) => {
    if (!activeDetail) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await addShipmentsToWarehouseManifest(tenant.id, activeDetail.manifest.id, {
        shipmentIds,
      });
      setShowSelectModal(false);
      await refreshActiveDetail(activeDetail.manifest.id);
      await loadManifests();
      setFeedback({
        type: 'success',
        text: `تمت إضافة ${res.added_count} شحنة لقائمة الاستلام بالمخزن${res.skipped_count > 0 ? ` (تجاوز ${res.skipped_count})` : ''}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إضافة الشحنات.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveItem = async (shipmentId: string) => {
    if (!activeDetail) return;
    setBusy(true);
    try {
      await removeShipmentFromWarehouseManifest(tenant.id, activeDetail.manifest.id, shipmentId);
      await refreshActiveDetail(activeDetail.manifest.id);
      await loadManifests();
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إزالة الشحنة.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleApproveManifest = async () => {
    if (!activeDetail) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await approveWarehouseManifest(tenant.id, activeDetail.manifest.id);
      await refreshActiveDetail(activeDetail.manifest.id);
      await loadManifests();
      setFeedback({
        type: 'success',
        text: `تم اعتماد قائمة الاستلام بالمخزن ${res.manifest_code} وتحديث حالة وعهدة ${res.shipments_count} شحنة إلى «بالمخزن».`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر اعتماد الاستلام بالمخزن.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleQuickRepriceSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!repriceTarget || !activeDetail) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await repriceShipment({
        tenantId: tenant.id,
        shipmentId: repriceTarget.id,
        actualWeightKg: Number(revWeight),
        lengthCm: Number(revLength) || 0,
        widthCm: Number(revWidth) || 0,
        heightCm: Number(revHeight) || 0,
        reason: revReason,
      });
      setRepriceTarget(null);
      setRevReason('');
      await refreshActiveDetail(activeDetail.manifest.id);
      setFeedback({
        type: 'success',
        text: `تم تحديث الوزن وإصدار لقطة السعر رقم ${res.version_number} بإجمالي شحن ${Number(res.total_shipping_fee).toFixed(2)} ج.م.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تعديل الوزن.',
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
  // Workbench Mode
  // ============================================================================
  if (mode === 'workbench') {
    const manifest = activeDetail?.manifest ?? null;
    const isDraft = manifest?.status === 'draft';
    const items = activeDetail?.items ?? [];
    const attachedSet = new Set(items.map((i) => i.shipment_id));
    const unattachedInbound = inboundPending.filter((r) => !attachedSet.has(r.shipment_id));

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
              العودة إلى قوائم الاستلام بالمخزن
            </button>
            <h1 className="mt-1.5 text-xl font-bold text-slate-900">
              {manifest ? `قائمة الاستلام بالمخزن ${manifest.manifest_code}` : 'إنشاء قائمة استلام بالمخزن'}
            </h1>
            <p className="mt-0.5 text-xs text-slate-600">
              استلام الشحنات الملتقطة أو الواردة من الفروع وتأكيد دخولها فعليًا لمخزن الفرع.
            </p>
          </div>

          {manifest && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="نموذج الطباعة"
                value={printLayout}
                onChange={(e) => setPrintLayout(e.target.value as WarehousePrintLayoutMode)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                {Object.entries(WAREHOUSE_PRINT_LAYOUT_LABELS).map(([k, lbl]) => (
                  <option key={k} value={k}>
                    {lbl}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Printer className="h-3.5 w-3.5" />
                طباعة النموذج
              </button>

              {isDraft && can('operations.pickup.approve', manifest.branch_id) && (
                <button
                  type="button"
                  disabled={busy || items.length === 0}
                  onClick={() => void handleApproveManifest()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  اعتماد الاستلام بالمخزن ({items.length})
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

        {!manifest ? (
          <form
            onSubmit={(e) => void handleSaveHeader(e)}
            className="space-y-4 rounded-xl border border-slate-200 bg-white p-6"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-semibold text-slate-900">بيانات رأس قائمة الاستلام بالمخزن</h2>
              <span className="font-mono-tabular text-xs text-slate-500">
                كود القائمة: يُولد تلقائيًا (WRH-XXXXXX)
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="wrh-date" className="block text-xs font-medium text-slate-700">
                  تاريخ الاستلام
                </label>
                <input
                  id="wrh-date"
                  type="date"
                  required
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>

              <div>
                <label htmlFor="wrh-branch" className="block text-xs font-medium text-slate-700">
                  فرع المخزن المستلم
                </label>
                <select
                  id="wrh-branch"
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
                <label htmlFor="wrh-movement" className="block text-xs font-medium text-slate-700">
                  نوع الحركة
                </label>
                <select
                  id="wrh-movement"
                  value={formMovementTypeId}
                  onChange={(e) => setFormMovementTypeId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="">استلام بمخزن الفرع (افتراضي)</option>
                  {movementTypes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} · {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="wrh-courier" className="block text-xs font-medium text-slate-700">
                  المندوب المسلم للمخزن (اختياري)
                </label>
                <select
                  id="wrh-courier"
                  value={formCourierId}
                  onChange={(e) => setFormCourierId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="">بدون تحديد / نقل بين الفروع</option>
                  {couriers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 lg:col-span-4">
                <label htmlFor="wrh-notes" className="block text-xs font-medium text-slate-700">
                  ملاحظات الاستلام
                </label>
                <input
                  id="wrh-notes"
                  type="text"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="ملاحظات الفحص المخزني أو الوردية"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-500">
                يجب حفظ القائمة أولًا لإضافة الشحنات بالباركود أو الاختيار المجمع.
              </p>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {busy ? 'جاري الحفظ...' : 'حفظ رأس قائمة الاستلام'}
              </button>
            </div>
          </form>
        ) : (
          <>
            {/* Saved Header */}
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-3 lg:grid-cols-5">
                <div>
                  <span className="text-slate-500">كود القائمة</span>
                  <div className="mt-1 font-mono-tabular font-bold text-slate-900">
                    {manifest.manifest_code}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">الحالة</span>
                  <div className={`mt-1 font-semibold ${getManifestStatusClass(manifest.status)}`}>
                    {MANIFEST_STATUS_LABELS[manifest.status]}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">تاريخ الاستلام</span>
                  <div className="mt-1 font-mono-tabular text-slate-900">{manifest.manifest_date}</div>
                </div>
                <div>
                  <span className="text-slate-500">الفرع المستلم</span>
                  <div className="mt-1 text-slate-900">
                    {branchNameMap.get(manifest.branch_id) ?? '—'}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">الحركة / المندوب</span>
                  <div className="mt-1 text-slate-900">
                    {manifest.movement_type_id ? movementNameMap.get(manifest.movement_type_id) ?? '—' : '—'}
                    {manifest.courier_id ? ` · ${courierNameMap.get(manifest.courier_id) ?? ''}` : ''}
                  </div>
                </div>
              </div>
            </section>

            {/* ADR-015 Incoming Transfers Notification Banner */}
            {isDraft && unattachedInbound.length > 0 && (
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50/70 px-5 py-3.5 text-xs print:hidden">
                <div>
                  <p className="font-semibold text-sky-900">
                    توجد {unattachedInbound.length} شحنة واردة قيد النقل موجهة إلى{' '}
                    {branchNameMap.get(manifest.branch_id) ?? 'هذا الفرع'}
                  </p>
                  <p className="mt-0.5 text-sky-700">
                    يمكنك استيرادها دفعة واحدة لإتمام الاستلام أو مسحها بالباركود.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void handleConfirmMultiSelect(unattachedInbound.map((r) => r.shipment_id))
                  }
                  className="rounded-lg bg-sky-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-sky-800 disabled:opacity-60"
                >
                  استيراد الشحنات الواردة ({unattachedInbound.length})
                </button>
              </section>
            )}

            {/* Shipments Table */}
            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    الشحنات المدرجة للاستلام{' '}
                    <span className="font-mono-tabular text-slate-600">({items.length})</span>
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    راجع الأوزان وأضف الشحنات بالباركود أو الاختيار المجمع قبل الاعتماد.
                  </p>
                </div>

                {isDraft && can('operations.pickup.approve', manifest.branch_id) && (
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
                      <th className="px-3 py-2.5 font-medium">كود الطلب</th>
                      <th className="px-3 py-2.5 font-medium">الراسل والمرسل إليه</th>
                      <th className="px-3 py-2.5 font-medium">الوجهة</th>
                      <th className="px-3 py-2.5 font-medium">نوع الدفع</th>
                      <th className="px-3 py-2.5 font-medium">وصف الطرد</th>
                      <th className="px-3 py-2.5 font-medium">القطع والوزن</th>
                      <th className="px-3 py-2.5 font-medium">التحصيل والرسوم</th>
                      <th className="px-3 py-2.5 font-medium print:hidden">إجراءات</th>
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
                        const destGov = govNameMap.get(s.recipient_governorate_id) ?? '—';
                        const destReg = regNameMap.get(s.recipient_region_id) ?? '—';
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
                            <td className="px-3 py-2.5 text-slate-800">
                              <div>من: {s.sender_name ?? '—'}</div>
                              <div className="text-[11px] text-slate-500">
                                إلى: {s.recipient_name ?? '—'}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-slate-600">
                              {destGov} · {destReg}
                            </td>
                            <td className="px-3 py-2.5 text-slate-700">
                              {PAYMENT_TERM_LABELS[s.payment_term_code]}
                            </td>
                            <td className="px-3 py-2.5 text-slate-700">
                              {s.package_description ?? '—'}
                            </td>
                            <td className="px-3 py-2.5 font-mono-tabular text-slate-800 whitespace-nowrap">
                              {s.pieces_count} ق · {s.chargeable_weight_kg} كجم
                            </td>
                            <td className="px-3 py-2.5 font-mono-tabular whitespace-nowrap">
                              <div className="font-semibold text-slate-900">
                                تحصيل: {Number(s.recipient_collect_amount).toFixed(2)}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                رسوم: {Number(s.total_shipping_fee).toFixed(2)} · عميل:{' '}
                                {Number(s.client_net_payout).toFixed(2)}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 print:hidden">
                              <div className="flex items-center gap-1.5">
                                {isDraft && can('operations.pickup.approve', manifest.branch_id) && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setRepriceTarget(s);
                                        setRevWeight(String(s.actual_weight_kg));
                                        setRevLength('0');
                                        setRevWidth('0');
                                        setRevHeight('0');
                                        setRevReason('');
                                      }}
                                      className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100"
                                    >
                                      <Scale className="h-3 w-3" />
                                      تعديل الوزن
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={`إزالة ${s.shipment_number}`}
                                      onClick={() => void handleRemoveItem(s.id)}
                                      className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                      إزالة
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Print Preview Summary Card (visible when printing) */}
            {items.length > 0 && (
              <section className="hidden rounded-xl border border-slate-300 bg-white p-5 print:block">
                <p className="text-xs font-bold text-slate-900">
                  نموذج الطباعة المحدد: {WAREHOUSE_PRINT_LAYOUT_LABELS[printLayout]}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  {items.map((item) =>
                    item.shipment ? (
                      <div key={item.id} className="rounded-lg border border-slate-300 p-3 text-xs">
                        <div className="font-mono-tabular font-bold">
                          {item.shipment.shipment_number} · {item.shipment.barcode_token}
                        </div>
                        <div className="mt-1">
                          المستلم: {item.shipment.recipient_name ?? '—'} (
                          {item.shipment.recipient_mobile ?? '—'})
                        </div>
                        <div className="mt-0.5 font-mono-tabular">
                          تحصيل: {Number(item.shipment.recipient_collect_amount).toFixed(2)} ج.م ·{' '}
                          {item.shipment.chargeable_weight_kg} كجم
                        </div>
                      </div>
                    ) : null,
                  )}
                </div>
              </section>
            )}
          </>
        )}

        {/* Quick Weight Revision Modal (ADR-010) */}
        {repriceTarget && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="تعديل الوزن الفعلي بالمخزن"
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          >
            <form
              onSubmit={(e) => void handleQuickRepriceSubmit(e)}
              className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-sm font-bold text-slate-900">
                  مراجعة وزن الشحنة {repriceTarget.shipment_number}
                </h3>
                <button
                  type="button"
                  onClick={() => setRepriceTarget(null)}
                  className="rounded p-1 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700">الوزن (كجم)</label>
                  <input
                    type="number"
                    min="0.1"
                    step="0.1"
                    required
                    value={revWeight}
                    onChange={(e) => setRevWeight(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono-tabular text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">طول (سم)</label>
                  <input
                    type="number"
                    min="0"
                    value={revLength}
                    onChange={(e) => setRevLength(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono-tabular text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">عرض (سم)</label>
                  <input
                    type="number"
                    min="0"
                    value={revWidth}
                    onChange={(e) => setRevWidth(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono-tabular text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700">ارتفاع (سم)</label>
                  <input
                    type="number"
                    min="0"
                    value={revHeight}
                    onChange={(e) => setRevHeight(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono-tabular text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700">
                  سبب التعديل (إلزامي للتدقيق)
                </label>
                <input
                  type="text"
                  required
                  value={revReason}
                  onChange={(e) => setRevReason(e.target.value)}
                  placeholder="مثال: وزن ميزان الاستلام بالمخزن"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRepriceTarget(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  اعتماد إصدار السعر
                </button>
              </div>
            </form>
          </div>
        )}

        <BarcodeScanModal
          open={showBarcodeModal}
          title="إضافة شحنة للاستلام بالمخزن بالباركود"
          busy={busy}
          onClose={() => setShowBarcodeModal(false)}
          onSubmitBarcode={handleBarcodeSubmit}
        />

        <MultiSelectShipmentsModal
          open={showSelectModal}
          title="اختيار شحنات للاستلام بالمخزن"
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
  // List Mode
  // ============================================================================
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">قوائم الاستلام بالمخزن</h1>
          <p className="mt-1 text-sm text-slate-600">
            استلام الشحنات من المناديب أو التحويلات الواردة وإدخالها فعليًا لمخزون الفرع.
          </p>
        </div>

        {can('operations.pickup.approve') && (
          <button
            type="button"
            onClick={openNewWorkbench}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            قائمة استلام بالمخزن
          </button>
        )}
      </div>

      {/* Filters */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void loadManifests();
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
              aria-label="بحث في قوائم الاستلام بالمخزن"
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
            aria-label="الحالة"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
          >
            <option value="">كل الحالات</option>
            {Object.entries(MANIFEST_STATUS_LABELS).map(([k, lbl]) => (
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
                placeholder="WRH-000001"
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
              <label className="block text-xs text-slate-500">من إقليم</label>
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
              <label className="block text-xs text-slate-500">إلى إقليم</label>
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
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {feedback.text}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">الكود</th>
              <th className="px-4 py-3 font-medium">التاريخ</th>
              <th className="px-4 py-3 font-medium">فرع المخزن</th>
              <th className="px-4 py-3 font-medium">الحركة / المندوب</th>
              <th className="px-4 py-3 font-medium">عدد الشحنات</th>
              <th className="px-4 py-3 font-medium">الحالة</th>
              <th className="px-4 py-3 font-medium">توقيت الإنشاء</th>
              <th className="px-4 py-3 font-medium">الإجراء</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                  <LoadingState label="جارٍ تحميل قوائم الاستلام بالمخزن" />
                </td>
              </tr>
            ) : manifests.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                  <PackageCheck className="mx-auto mb-2 h-6 w-6 text-slate-400" />
                  <p>لا توجد قوائم استلام بالمخزن مطابقة للبحث.</p>
                </td>
              </tr>
            ) : (
              manifests.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">
                    {m.manifest_code}
                  </td>
                  <td className="px-4 py-3 font-mono-tabular text-slate-700">{m.manifest_date}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {branchNameMap.get(m.branch_id) ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {m.movement_type_id ? movementNameMap.get(m.movement_type_id) ?? '—' : 'استلام مخزن'}
                    {m.courier_id ? ` · ${courierNameMap.get(m.courier_id) ?? ''}` : ''}
                  </td>
                  <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">
                    {m.shipments_count ?? 0} شحنة
                  </td>
                  <td className={`px-4 py-3 font-semibold ${getManifestStatusClass(m.status)}`}>
                    {MANIFEST_STATUS_LABELS[m.status]}
                  </td>
                  <td className="px-4 py-3 font-mono-tabular text-slate-500">
                    {formatDateTime(m.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => void openExistingWorkbench(m.id)}
                      className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    >
                      {m.status === 'draft' ? 'تجهيز واعتماد' : 'عرض التفاصيل'}
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
