import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {
  listBranches,
  listMovementTypes,
} from '@/features/definitions/definitionsService';
import {
  BarcodeScanModal,
  MultiSelectShipmentsModal,
} from '@/features/operations/ShipmentAttachmentModals';
import {
  addShipmentsToWarehouseManifest,
  adminReleaseStuckTransfer,
  approveWarehouseManifest,
  createWarehouseManifest,
  getWarehouseManifestDetail,
  listBranchInboundTransferShipments,
  listEligibleShipmentsForOperation,
  listWarehouseManifests,
  removeShipmentFromWarehouseManifest,
} from '@/features/operations/operationsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {formatDateTime} from '@/lib/formatters';
import type {BranchRecord, MovementTypeRecord} from '@/types/definitions';
import {
  MANIFEST_ITEM_STATUS_LABELS,
  MANIFEST_STATUS_LABELS,
  type AdminHangReleaseAction,
  type InboundTransferShipmentRecord,
  type WarehouseManifestDetail,
  type WarehouseManifestItemRecord,
  type WarehouseManifestRecord,
  type WarehouseManifestStatus,
} from '@/types/operations';
import type {ShipmentListItem} from '@/types/shipments';
import {
  ArrowLeftRight,
  ArrowRight,
  Barcode,
  CheckCircle2,
  PackageCheck,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
  Truck,
  X,
} from 'lucide-react';

function getTransferStatusClass(status: WarehouseManifestStatus): string {
  if (status === 'approved') return 'text-emerald-700';
  if (status === 'in_transit' || status === 'partially_received') return 'text-sky-700';
  if (status === 'cancelled') return 'text-red-700';
  return 'text-amber-700';
}

export function BranchTransfersPage() {
  const {tenant, membership, branchIds, isAdmin, can} = useTenantWorkspace();
  const navigate = useNavigate();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const canAdminUnhang =
    isAdmin || membership.role_key === 'operations_manager';

  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [movementTypes, setMovementTypes] = useState<readonly MovementTypeRecord[]>([]);

  const [tab, setTab] = useState<'transfers' | 'inbound'>('transfers');
  const [mode, setMode] = useState<'list' | 'workbench'>('list');
  const [manifests, setManifests] = useState<readonly WarehouseManifestRecord[]>([]);
  const [activeDetail, setActiveDetail] = useState<WarehouseManifestDetail | null>(null);

  // Inbound Handshake tab state
  const [inboundBranchId, setInboundBranchId] = useState('');
  const [inboundRows, setInboundRows] = useState<readonly InboundTransferShipmentRecord[]>([]);
  const [loadingInbound, setLoadingInbound] = useState(false);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [filterOriginBranchId, setFilterOriginBranchId] = useState('');
  const [filterTargetBranchId, setFilterTargetBranchId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Create header form
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [formOriginBranchId, setFormOriginBranchId] = useState('');
  const [formTargetBranchId, setFormTargetBranchId] = useState('');
  const [formMovementTypeId, setFormMovementTypeId] = useState('');
  const [formNotes, setFormNotes] = useState('');

  // Attachment modals
  const [showBarcodeModal, setShowBarcodeModal] = useState(false);
  const [showSelectModal, setShowSelectModal] = useState(false);
  const [eligibleShipments, setEligibleShipments] = useState<readonly ShipmentListItem[]>([]);
  const [loadingEligible, setLoadingEligible] = useState(false);

  // Admin Override Hang Release Modal (ADR-015)
  const [releaseTargetItem, setReleaseTargetItem] = useState<WarehouseManifestItemRecord | null>(null);
  const [releaseAction, setReleaseAction] = useState<AdminHangReleaseAction>('return_to_origin');
  const [releaseReason, setReleaseReason] = useState('');

  const loadRefs = useCallback(async () => {
    try {
      const [br, mov] = await Promise.all([
        listBranches(tenant.id),
        listMovementTypes(tenant.id),
      ]);
      setBranches(br);
      setMovementTypes(mov);

      const defaultOrigin =
        (branchIds.length > 0 ? br.find((b) => branchIds.includes(b.id)) : br.find((b) => b.is_main)) ??
        br[0];
      if (defaultOrigin) {
        setFormOriginBranchId((curr) => curr || defaultOrigin.id);
        setInboundBranchId((curr) => curr || defaultOrigin.id);
        const other = br.find((b) => b.id !== defaultOrigin.id);
        if (other) {
          setFormTargetBranchId((curr) => curr || other.id);
        }
      }
      const movTransferOut = mov.find((m) => m.code === 'MOV-003') ?? mov[0];
      if (movTransferOut) {
        setFormMovementTypeId((curr) => curr || movTransferOut.id);
      }
    } catch {
      // Non-blocking refs
    }
  }, [tenant.id, branchIds]);

  const loadManifests = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listWarehouseManifests(tenant.id, 'transfer_out', {
        search,
        branchId: filterOriginBranchId,
        targetBranchId: filterTargetBranchId,
        status: filterStatus,
      });
      setManifests(rows);
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحميل قوائم النقل بين الفروع.',
      });
    } finally {
      setLoading(false);
    }
  }, [tenant.id, search, filterOriginBranchId, filterTargetBranchId, filterStatus]);

  const loadInbound = useCallback(async () => {
    if (!inboundBranchId) return;
    setLoadingInbound(true);
    try {
      const rows = await listBranchInboundTransferShipments(tenant.id, inboundBranchId);
      setInboundRows(rows);
    } catch {
      setInboundRows([]);
    } finally {
      setLoadingInbound(false);
    }
  }, [tenant.id, inboundBranchId]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    void loadManifests();
  }, [loadManifests]);

  useEffect(() => {
    if (tab === 'inbound' && inboundBranchId) {
      void loadInbound();
    }
  }, [tab, inboundBranchId, loadInbound]);

  const branchNameMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const movementNameMap = useMemo(
    () => new Map(movementTypes.map((m) => [m.id, m.name])),
    [movementTypes],
  );

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
        text: err instanceof Error ? err.message : 'تعذر فتح قائمة النقل.',
      });
    } finally {
      setBusy(false);
    }
  };

  const refreshActiveDetail = async (id: string) => {
    const detail = await getWarehouseManifestDetail(tenant.id, id);
    if (detail) setActiveDetail(detail);
  };

  const handleSaveHeader = async (e: FormEvent) => {
    e.preventDefault();
    if (!formOriginBranchId || !formTargetBranchId || formOriginBranchId === formTargetBranchId) {
      setFeedback({
        type: 'error',
        text: 'يجب تحديد فرع منشأ وفرع وجهة مختلفين لإنشاء قائمة النقل.',
      });
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const res = await createWarehouseManifest(tenant.id, {
        manifest_type: 'transfer_out',
        manifest_date: formDate,
        branch_id: formOriginBranchId,
        target_branch_id: formTargetBranchId,
        movement_type_id: formMovementTypeId || null,
        notes: formNotes.trim() || null,
      });
      await refreshActiveDetail(res.id);
      await loadManifests();
      setFeedback({
        type: 'success',
        text: `تم حفظ رأس قائمة النقل ${res.manifest_code}. أضف الشحنات الموجودة بمخزن فرع المنشأ ثم اعتمد الإرسال.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حفظ قائمة النقل.',
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
      const rows = await listEligibleShipmentsForOperation(tenant.id, 'transfer_out', {
        branchId: activeDetail.manifest.branch_id,
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
        text: `تمت إضافة ${res.added_count} شحنة لقائمة النقل${res.skipped_count > 0 ? ` (تجاوز ${res.skipped_count})` : ''}.`,
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

  const handleDispatchTransfer = async () => {
    if (!activeDetail) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await approveWarehouseManifest(tenant.id, activeDetail.manifest.id);
      await refreshActiveDetail(activeDetail.manifest.id);
      await loadManifests();
      setFeedback({
        type: 'success',
        text: `تم اعتماد قائمة النقل الصادر ${res.manifest_code}. تحولت ${res.shipments_count} شحنة إلى «قيد النقل بين الفروع» وتنتظر اعتماد الاستلام في فرع الوجهة.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر اعتماد إرسال قائمة النقل.',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleAdminUnhangSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!activeDetail || !releaseTargetItem) return;
    setBusy(true);
    setFeedback(null);
    try {
      await adminReleaseStuckTransfer(tenant.id, {
        manifestId: activeDetail.manifest.id,
        shipmentId: releaseTargetItem.shipment_id,
        action: releaseAction,
        reason: releaseReason,
      });
      setReleaseTargetItem(null);
      setReleaseReason('');
      await refreshActiveDetail(activeDetail.manifest.id);
      await loadManifests();
      setFeedback({
        type: 'success',
        text: 'تم تنفيذ فك التعليق الإداري وتسجيل السبب في سجل التدقيق وسجل حركات الشحنة.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تنفيذ فك التعليق الإداري.',
      });
    } finally {
      setBusy(false);
    }
  };

  // ============================================================================
  // Workbench Mode
  // ============================================================================
  if (mode === 'workbench') {
    const manifest = activeDetail?.manifest ?? null;
    const isDraft = manifest?.status === 'draft';
    const items = activeDetail?.items ?? [];

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
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
              العودة إلى قوائم النقل بين الفروع
            </button>
            <h1 className="mt-1.5 text-xl font-bold text-slate-900">
              {manifest ? `قائمة نقل بين الفروع ${manifest.manifest_code}` : 'إنشاء قائمة نقل بين الفروع'}
            </h1>
            <p className="mt-0.5 text-xs text-slate-600">
              تعتمد على خطوتين: إرسال الشحنات من فرع المنشأ، ثم اعتماد استلامها في مخزن فرع الوجهة.
            </p>
          </div>

          {manifest && isDraft && can('operations.pickup.approve', manifest.branch_id) && (
            <button
              type="button"
              disabled={busy || items.length === 0}
              onClick={() => void handleDispatchTransfer()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <Truck className="h-4 w-4" />
              اعتماد وإرسال للنقل ({items.length})
            </button>
          )}
        </div>

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

        {!manifest ? (
          <form
            onSubmit={(e) => void handleSaveHeader(e)}
            className="space-y-4 rounded-xl border border-slate-200 bg-white p-6"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-semibold text-slate-900">بيانات رأس قائمة النقل</h2>
              <span className="font-mono-tabular text-xs text-slate-500">
                كود القائمة: يُولد تلقائيًا (TRF-XXXXXX)
              </span>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="trf-date" className="block text-xs font-medium text-slate-700">
                  تاريخ الإرسال
                </label>
                <input
                  id="trf-date"
                  type="date"
                  required
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>

              <div>
                <label htmlFor="trf-origin" className="block text-xs font-medium text-slate-700">
                  فرع المنشأ (المُرسل)
                </label>
                <select
                  id="trf-origin"
                  required
                  value={formOriginBranchId}
                  onChange={(e) => setFormOriginBranchId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="">اختر فرع المنشأ...</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="trf-target" className="block text-xs font-medium text-slate-700">
                  فرع الوجهة (المُستقبل)
                </label>
                <select
                  id="trf-target"
                  required
                  value={formTargetBranchId}
                  onChange={(e) => setFormTargetBranchId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="">اختر فرع الوجهة...</option>
                  {branches
                    .filter((b) => b.id !== formOriginBranchId)
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label htmlFor="trf-movement" className="block text-xs font-medium text-slate-700">
                  نوع الحركة
                </label>
                <select
                  id="trf-movement"
                  value={formMovementTypeId}
                  onChange={(e) => setFormMovementTypeId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="">نقل صادر بين الفروع (MOV-003)</option>
                  {movementTypes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} · {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2 lg:col-span-4">
                <label htmlFor="trf-notes" className="block text-xs font-medium text-slate-700">
                  ملاحظات خط النقل
                </label>
                <input
                  id="trf-notes"
                  type="text"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="رقم رحلة النقل أو السيارة أو تعليمات التسليم لفرع الوجهة"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-500">
                تُقفل قائمة النقل على فرع المنشأ والوجهة المحددين وتُضاف الشحنات الموجودة بمخزن المنشأ فقط.
              </p>
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {busy ? 'جاري الحفظ...' : 'حفظ رأس قائمة النقل'}
              </button>
            </div>
          </form>
        ) : (
          <>
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="grid grid-cols-2 gap-4 text-xs sm:grid-cols-3 lg:grid-cols-5">
                <div>
                  <span className="text-slate-500">كود قائمة النقل</span>
                  <div className="mt-1 font-mono-tabular font-bold text-slate-900">
                    {manifest.manifest_code}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">الحالة</span>
                  <div className={`mt-1 font-semibold ${getTransferStatusClass(manifest.status)}`}>
                    {MANIFEST_STATUS_LABELS[manifest.status]}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">من فرع (المنشأ)</span>
                  <div className="mt-1 font-medium text-slate-900">
                    {branchNameMap.get(manifest.branch_id) ?? '—'}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">إلى فرع (الوجهة)</span>
                  <div className="mt-1 font-medium text-slate-900">
                    {manifest.target_branch_id ? branchNameMap.get(manifest.target_branch_id) ?? '—' : '—'}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500">التاريخ ونوع الحركة</span>
                  <div className="mt-1 text-slate-800">
                    <span className="font-mono-tabular">{manifest.manifest_date}</span> ·{' '}
                    {manifest.movement_type_id
                      ? movementNameMap.get(manifest.movement_type_id) ?? 'MOV-003'
                      : 'MOV-003'}
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    الشحنات المحولة بين الفرعين{' '}
                    <span className="font-mono-tabular text-slate-600">({items.length})</span>
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    عند اعتماد الإرسال تصبح الشحنات «قيد النقل بين الفروع»، وتبقى عهدتها مسجلة بالمنشأ حتى استلام الوجهة.
                  </p>
                </div>

                {isDraft && can('operations.pickup.approve', manifest.branch_id) && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowBarcodeModal(true)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
                    >
                      <Barcode className="h-3.5 w-3.5" />
                      إضافة بالباركود
                    </button>
                    <button
                      type="button"
                      onClick={() => void openMultiSelectPicker()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      اختيار شحنات بالمخزن
                    </button>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2.5 font-medium">رقم الشحنة</th>
                      <th className="px-3 py-2.5 font-medium">المرسل إليه</th>
                      <th className="px-3 py-2.5 font-medium">الفرع الحالي للشحنة</th>
                      <th className="px-3 py-2.5 font-medium">القطع والوزن</th>
                      <th className="px-3 py-2.5 font-medium">حالة الاستلام بالوجهة</th>
                      <th className="px-3 py-2.5 font-medium">الإجراء</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-10 text-center text-xs text-slate-500">
                          لا توجد شحنات مدرجة في قائمة النقل بعد.
                        </td>
                      </tr>
                    ) : (
                      items.map((item) => {
                        const s = item.shipment;
                        if (!s) return null;
                        const isStuckPending =
                          !isDraft &&
                          item.receive_status === 'pending' &&
                          s.operational_status === 'in_transit_branch';

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
                              <div>{s.recipient_name ?? '—'}</div>
                              <div className="font-mono-tabular text-[11px] text-slate-500">
                                {s.recipient_mobile ?? '—'}
                              </div>
                            </td>
                            <td className="px-3 py-2.5 text-slate-700">
                              {branchNameMap.get(s.current_branch_id) ?? '—'}
                            </td>
                            <td className="px-3 py-2.5 font-mono-tabular text-slate-700 whitespace-nowrap">
                              {s.pieces_count} ق · {s.chargeable_weight_kg} كجم
                            </td>
                            <td className="px-3 py-2.5 font-medium text-slate-800">
                              {MANIFEST_ITEM_STATUS_LABELS[item.receive_status]}
                              {item.notes && (
                                <div className="text-[11px] text-slate-500">{item.notes}</div>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
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

                              {isStuckPending && canAdminUnhang && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setReleaseTargetItem(item);
                                    setReleaseAction('return_to_origin');
                                    setReleaseReason('');
                                  }}
                                  className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                                >
                                  <ShieldAlert className="h-3 w-3" />
                                  فك تعليق إداري
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
            </section>
          </>
        )}

        {/* Admin Hang Release Modal (ADR-015) */}
        {releaseTargetItem && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="فك تعليق شحنة قيد النقل بين الفروع"
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          >
            <form
              onSubmit={(e) => void handleAdminUnhangSubmit(e)}
              className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-amber-700" />
                  <h3 className="text-sm font-bold text-slate-900">
                    فك تعليق إداري للشحنة {releaseTargetItem.shipment?.shipment_number}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setReleaseTargetItem(null)}
                  className="rounded p-1 text-slate-400 hover:text-slate-700"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div>
                <label htmlFor="unhang-action" className="block text-xs font-medium text-slate-700">
                  إجراء المعالجة الإدارية
                </label>
                <select
                  id="unhang-action"
                  value={releaseAction}
                  onChange={(e) => setReleaseAction(e.target.value as AdminHangReleaseAction)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                >
                  <option value="return_to_origin">
                    إرجاع العهدة لمخزن فرع المنشأ (in_warehouse)
                  </option>
                  <option value="force_receive_destination">
                    اعتماد قسري للاستلام في فرع الوجهة (in_warehouse)
                  </option>
                </select>
              </div>

              <div>
                <label htmlFor="unhang-reason" className="block text-xs font-medium text-slate-700">
                  سبب فك التعليق الإداري (إلزامي لسجل التدقيق)
                </label>
                <textarea
                  id="unhang-reason"
                  rows={3}
                  required
                  minLength={5}
                  value={releaseReason}
                  onChange={(e) => setReleaseReason(e.target.value)}
                  placeholder="أدخل السبب الإداري الموثق لفك التعليق (5 أحرف على الأقل)..."
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReleaseTargetItem(null)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-xs text-slate-700"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={busy || releaseReason.trim().length < 5}
                  className="rounded-lg bg-amber-700 px-4 py-2 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-60"
                >
                  تأكيد فك التعليق وتسجيل التدقيق
                </button>
              </div>
            </form>
          </div>
        )}

        <BarcodeScanModal
          open={showBarcodeModal}
          title="إضافة شحنة لقائمة النقل بالباركود"
          busy={busy}
          onClose={() => setShowBarcodeModal(false)}
          onSubmitBarcode={handleBarcodeSubmit}
        />

        <MultiSelectShipmentsModal
          open={showSelectModal}
          title="اختيار شحنات موجودة بمخزن فرع المنشأ"
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
  // List + Inbound Handshake Queue Mode
  // ============================================================================
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">النقل بين الفروع</h1>
          <p className="mt-1 text-sm text-slate-600">
            إصدار قوائم النقل الصادر ومتابعة اعتماد استلامها في فروع الوجهة.
          </p>
        </div>

        {can('operations.pickup.approve') && (
          <button
            type="button"
            onClick={openNewWorkbench}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            قائمة نقل بين الفروع
          </button>
        )}
      </div>

      {/* Sub-navigation tabs */}
      <div className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5">
        <button
          type="button"
          onClick={() => setTab('transfers')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
            tab === 'transfers' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          قوائم النقل الصادرة (TRF)
        </button>
        <button
          type="button"
          onClick={() => setTab('inbound')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
            tab === 'inbound' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <PackageCheck className="h-3.5 w-3.5" />
          الشحنات الواردة للفرع (بانتظار الاستلام)
        </button>
      </div>

      {feedback && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {feedback.text}
        </div>
      )}

      {tab === 'transfers' ? (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void loadManifests();
            }}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4"
          >
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="بحث برقم القائمة TRF-*..."
                className="w-full rounded-lg border border-slate-200 py-2 pr-9 pl-3 text-xs"
              />
            </div>

            <select
              aria-label="من فرع"
              value={filterOriginBranchId}
              onChange={(e) => setFilterOriginBranchId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <option value="">كل فروع المنشأ</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  من: {b.name}
                </option>
              ))}
            </select>

            <select
              aria-label="إلى فرع"
              value={filterTargetBranchId}
              onChange={(e) => setFilterTargetBranchId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            >
              <option value="">كل فروع الوجهة</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  إلى: {b.name}
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

            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              تطبيق
            </button>
          </form>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">كود القائمة</th>
                  <th className="px-4 py-3 font-medium">التاريخ</th>
                  <th className="px-4 py-3 font-medium">من فرع ← إلى فرع</th>
                  <th className="px-4 py-3 font-medium">عدد الشحنات</th>
                  <th className="px-4 py-3 font-medium">الحالة</th>
                  <th className="px-4 py-3 font-medium">توقيت الإنشاء</th>
                  <th className="px-4 py-3 font-medium">الإجراء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                      جاري تحميل قوائم النقل...
                    </td>
                  </tr>
                ) : manifests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                      لا توجد قوائم نقل بين الفروع مسجلة.
                    </td>
                  </tr>
                ) : (
                  manifests.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">
                        {m.manifest_code}
                      </td>
                      <td className="px-4 py-3 font-mono-tabular text-slate-700">{m.manifest_date}</td>
                      <td className="px-4 py-3 text-slate-800">
                        {branchNameMap.get(m.branch_id) ?? '—'} ←{' '}
                        {m.target_branch_id ? branchNameMap.get(m.target_branch_id) ?? '—' : '—'}
                      </td>
                      <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">
                        {m.shipments_count ?? 0} شحنة
                      </td>
                      <td className={`px-4 py-3 font-semibold ${getTransferStatusClass(m.status)}`}>
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
                          {m.status === 'draft' ? 'تجهيز وإرسال' : 'متابعة / تفاصيل'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-3">
              <label htmlFor="inbound-branch-select" className="text-xs font-medium text-slate-700">
                عرض الشحنات الواردة لفرع:
              </label>
              <select
                id="inbound-branch-select"
                value={inboundBranchId}
                onChange={(e) => setInboundBranchId(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {inboundRows.length > 0 && can('operations.pickup.approve', inboundBranchId) && (
              <button
                type="button"
                onClick={() =>
                  navigate(
                    `${basePath}/operations/warehouse?create=1&branchId=${encodeURIComponent(inboundBranchId)}`,
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-800"
              >
                <CheckCircle2 className="h-4 w-4" />
                بدء استلام مخزني بالفرع (WRH)
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">كود النقل الصادر</th>
                  <th className="px-4 py-3 font-medium">من فرع</th>
                  <th className="px-4 py-3 font-medium">رقم الشحنة والباركود</th>
                  <th className="px-4 py-3 font-medium">المرسل إليه</th>
                  <th className="px-4 py-3 font-medium">الوزن والقطع</th>
                  <th className="px-4 py-3 font-medium">التحصيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingInbound ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                      جاري البحث عن الشحنات الواردة للفرع...
                    </td>
                  </tr>
                ) : inboundRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                      لا توجد شحنات قيد النقل موجهة إلى هذا الفرع حاليًا.
                    </td>
                  </tr>
                ) : (
                  inboundRows.map((row) => (
                    <tr key={row.shipment_id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-mono-tabular font-semibold text-sky-700">
                        {row.transfer_manifest_code}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {branchNameMap.get(row.origin_branch_id) ?? '—'}
                      </td>
                      <td className="px-4 py-3 font-mono-tabular">
                        <div className="font-semibold text-slate-900">{row.shipment_number}</div>
                        <div className="text-[11px] text-slate-500">{row.barcode_token}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-800">
                        <div>{row.recipient_name ?? '—'}</div>
                        <div className="font-mono-tabular text-[11px] text-slate-500">
                          {row.recipient_mobile ?? '—'}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono-tabular text-slate-700 whitespace-nowrap">
                        {row.pieces_count} ق · {row.chargeable_weight_kg} كجم
                      </td>
                      <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">
                        {Number(row.recipient_collect_amount).toFixed(2)} ج.م
                      </td>
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
