import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link, useParams} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {listClients} from '@/features/clients/clientsService';
import {listCouriers} from '@/features/couriers/couriersService';
import {
  listBranches,
  listExceptionReasons,
  listGovernorates,
  listRegions,
  listShippingServices,
} from '@/features/definitions/definitionsService';
import {
  addShipmentNote,
  getShipmentDetail,
  repriceShipment,
  transitionShipmentStatus,
} from '@/features/shipments/shipmentsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {useAuth} from '@/lib/auth';
import {formatDateTime} from '@/lib/formatters';
import {AccountSubjectType} from '@/types/common';
import type {CourierRecord} from '@/types/couriers';
import type {
  BranchRecord,
  DeliveryExceptionReasonRecord,
  GovernorateRecord,
  RegionRecord,
  ShippingServiceRecord,
} from '@/types/definitions';
import type {ClientRecord} from '@/types/pricing';
import {
  PAYMENT_TERM_LABELS,
  RETURN_CUSTODY_LABELS,
  SHIPMENT_STATUS_LABELS,
  SHIPMENT_TYPE_LABELS,
  type ShipmentFullDetail,
  type ShipmentNoteType,
  type ShipmentOperationalStatus,
} from '@/types/shipments';
import {AttachmentPreviewList, AttachmentUploader} from '@/components/ui/AttachmentUploader';
import {ConversationThreadPanel} from '@/features/messaging/ConversationThreadPanel';
import {
  deleteShipmentAttachment,
  getTenantMessagingSettings,
  listShipmentAttachments,
  registerShipmentAttachment,
} from '@/features/messaging/messagingService';
import {
  SHIPMENT_ATTACHMENT_CATEGORY_LABELS,
  type AttachmentDraftPayload,
  type MessageVisibility,
  type ShipmentAttachmentCategory,
  type ShipmentAttachmentRecord,
} from '@/types/messaging';
import {
  ArrowRight,
  Barcode,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Printer,
  RefreshCw,
  Scale,
} from 'lucide-react';

type DetailTab = 'description' | 'movements' | 'finance' | 'notes' | 'tracking' | 'attachments' | 'messages';

const WORKFLOW_OPTIONS: Record<ShipmentOperationalStatus, readonly ShipmentOperationalStatus[]> = {
  created: ['pickup_scheduled', 'picked_up', 'in_warehouse', 'cancelled'],
  pickup_scheduled: ['picked_up', 'in_warehouse', 'cancelled'],
  picked_up: ['in_warehouse', 'in_transit_branch', 'out_for_delivery', 'cancelled'],
  in_warehouse: ['in_transit_branch', 'out_for_delivery', 'return_to_sender', 'cancelled'],
  in_transit_branch: ['in_warehouse', 'out_for_delivery', 'return_to_sender'],
  out_for_delivery: ['delivered', 'partially_delivered', 'delivery_failed', 'rescheduled', 'return_to_sender', 'in_warehouse'],
  delivery_failed: ['rescheduled', 'in_warehouse', 'out_for_delivery', 'return_to_sender'],
  rescheduled: ['out_for_delivery', 'in_warehouse', 'delivered', 'partially_delivered', 'delivery_failed', 'return_to_sender'],
  partially_delivered: ['return_to_sender', 'returned'],
  return_to_sender: ['in_warehouse', 'returned'],
  delivered: [],
  returned: [],
  cancelled: [],
};

const REPRICE_LOCKED_STATUSES: readonly ShipmentOperationalStatus[] = [
  'out_for_delivery',
  'delivered',
  'partially_delivered',
  'returned',
  'cancelled',
];

export function ShipmentDetailPage() {
  const {shipmentId = ''} = useParams();
  const {tenant, membership, can} = useTenantWorkspace();
  const {profile} = useAuth();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;
  const isClientUser = membership.account_subject_type === AccountSubjectType.CLIENT;

  const [detail, setDetail] = useState<ShipmentFullDetail | null>(null);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [services, setServices] = useState<readonly ShippingServiceRecord[]>([]);
  const [governorates, setGovernorates] = useState<readonly GovernorateRecord[]>([]);
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);
  const [couriers, setCouriers] = useState<readonly CourierRecord[]>([]);
  const [exceptionReasons, setExceptionReasons] = useState<readonly DeliveryExceptionReasonRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{type: 'error' | 'success'; text: string} | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('description');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Transition Form State
  const [targetStatus, setTargetStatus] = useState<ShipmentOperationalStatus | ''>('');
  const [transitionBranchId, setTransitionBranchId] = useState('');
  const [transitionCourierId, setTransitionCourierId] = useState('');
  const [exceptionReasonId, setExceptionReasonId] = useState('');
  const [transitionNotes, setTransitionNotes] = useState('');
  const [deliveredPieces, setDeliveredPieces] = useState('1');
  const [deliveredAmount, setDeliveredAmount] = useState('');
  const [submittingTransition, setSubmittingTransition] = useState(false);

  // Weight / Price Revision (ADR-010)
  const [revWeight, setRevWeight] = useState('');
  const [revLength, setRevLength] = useState('0');
  const [revWidth, setRevWidth] = useState('0');
  const [revHeight, setRevHeight] = useState('0');
  const [revOverrideFee, setRevOverrideFee] = useState('');
  const [revReason, setRevReason] = useState('');
  const [submittingReprice, setSubmittingReprice] = useState(false);

  // Notes Form
  const [noteType, setNoteType] = useState<ShipmentNoteType>(isClientUser ? 'client_visible' : 'internal');
  const [noteBody, setNoteBody] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Attachments State (Phase 12)
  const [attachments, setAttachments] = useState<readonly ShipmentAttachmentRecord[]>([]);
  const [maxAttachmentMb, setMaxAttachmentMb] = useState(5);
  const [attachmentCategory, setAttachmentCategory] = useState<ShipmentAttachmentCategory>('general');
  const [attachmentVisibility, setAttachmentVisibility] = useState<MessageVisibility>('external');
  const [attachmentNotes, setAttachmentNotes] = useState('');

  const loadData = useCallback(async () => {
    if (!shipmentId) return;
    setLoading(true);
    setError(null);
    try {
      const [full, br, cl, srv, gov, reg, cr, rsn, atts, msgSettings] = await Promise.all([
        getShipmentDetail(tenant.id, shipmentId),
        listBranches(tenant.id),
        listClients(tenant.id),
        listShippingServices(tenant.id),
        listGovernorates(tenant.id),
        listRegions(tenant.id),
        listCouriers(tenant.id),
        listExceptionReasons(tenant.id),
        listShipmentAttachments(tenant.id, shipmentId).catch(() => []),
        getTenantMessagingSettings(tenant.id).catch(() => ({attachment_max_size_mb: 5})),
      ]);

      setDetail(full);
      setBranches(br);
      setClients(cl);
      setServices(srv);
      setGovernorates(gov);
      setRegions(reg);
      setCouriers(cr);
      setExceptionReasons(rsn);
      setAttachments(atts);
      setMaxAttachmentMb(msgSettings.attachment_max_size_mb);

      if (full) {
        const s = full.shipment;
        const allowed = WORKFLOW_OPTIONS[s.operational_status];
        setTargetStatus(allowed[0] ?? '');
        setTransitionBranchId(s.current_branch_id);
        setTransitionCourierId(s.assigned_courier_id ?? '');
        setDeliveredAmount(String(s.recipient_collect_amount));
        setRevWeight(String(s.actual_weight_kg));
        const latestDim = full.dimensions[0];
        if (latestDim) {
          setRevLength(String(latestDim.length_cm));
          setRevWidth(String(latestDim.width_cm));
          setRevHeight(String(latestDim.height_cm));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل تفاصيل الشحنة.');
    } finally {
      setLoading(false);
    }
  }, [tenant.id, shipmentId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const branchNameMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const clientNameMap = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const serviceNameMap = useMemo(() => new Map(services.map((s) => [s.id, s.name])), [services]);
  const govNameMap = useMemo(() => new Map(governorates.map((g) => [g.id, g.name])), [governorates]);
  const regNameMap = useMemo(() => new Map(regions.map((r) => [r.id, r.name])), [regions]);
  const courierNameMap = useMemo(() => new Map(couriers.map((c) => [c.id, c.name])), [couriers]);
  const reasonNameMap = useMemo(() => new Map(exceptionReasons.map((r) => [r.id, r.name])), [exceptionReasons]);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((curr) => (curr === key ? null : curr)), 1500);
    } catch {
      // Ignore clipboard failures
    }
  };

  const handleTransitionSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail || !targetStatus) return;
    setActionMessage(null);
    setSubmittingTransition(true);
    try {
      await transitionShipmentStatus({
        tenantId: tenant.id,
        shipmentId: detail.shipment.id,
        toStatus: targetStatus,
        notes: transitionNotes,
        exceptionReasonId: exceptionReasonId || null,
        branchId: transitionBranchId || null,
        courierId: transitionCourierId || null,
        deliveredPieces: targetStatus === 'partially_delivered' ? Number(deliveredPieces) : null,
        deliveredAmount:
          targetStatus === 'delivered' || targetStatus === 'partially_delivered'
            ? Number(deliveredAmount || detail.shipment.recipient_collect_amount)
            : null,
      });
      setTransitionNotes('');
      setExceptionReasonId('');
      setActionMessage({type: 'success', text: 'تم تحديث حالة الشحنة وتسجيل الحركة بنجاح.'});
      await loadData();
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تنفيذ تحديث الحالة.',
      });
    } finally {
      setSubmittingTransition(false);
    }
  };

  const handleRepriceSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setActionMessage(null);
    setSubmittingReprice(true);
    try {
      const res = await repriceShipment({
        tenantId: tenant.id,
        shipmentId: detail.shipment.id,
        actualWeightKg: Number(revWeight),
        lengthCm: Number(revLength) || 0,
        widthCm: Number(revWidth) || 0,
        heightCm: Number(revHeight) || 0,
        overrideTotalFee: revOverrideFee.trim() !== '' ? Number(revOverrideFee) : null,
        reason: revReason,
      });
      setRevReason('');
      setRevOverrideFee('');
      setActionMessage({
        type: 'success',
        text: `تم إنشاء إصدار لقطة السعر رقم ${res.version_number} بإجمالي شحن ${Number(res.total_shipping_fee).toFixed(2)} ج.م.`,
      });
      await loadData();
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إعادة تسعير الشحنة.',
      });
    } finally {
      setSubmittingReprice(false);
    }
  };

  const handleAddNote = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail || !noteBody.trim()) return;
    setSavingNote(true);
    try {
      await addShipmentNote(
        tenant.id,
        detail.shipment.id,
        noteType,
        noteBody,
        profile?.display_name ?? 'مستخدم النظام',
      );
      setNoteBody('');
      await loadData();
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حفظ الملاحظة.',
      });
    } finally {
      setSavingNote(false);
    }
  };

  const handleShipmentAttachmentUploaded = async (draft: AttachmentDraftPayload) => {
    if (!detail) return;
    setActionMessage(null);
    try {
      await registerShipmentAttachment(tenant.id, detail.shipment.id, {
        ...draft,
        category: attachmentCategory,
        visibility: isClientUser ? 'external' : attachmentVisibility,
        notes: attachmentNotes,
      });
      setAttachmentNotes('');
      const fresh = await listShipmentAttachments(tenant.id, detail.shipment.id);
      setAttachments(fresh);
      setActionMessage({type: 'success', text: 'تم إرفاق المستند وحفظه في التخزين الخاص للشحنة.'});
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تسجيل مرفق الشحنة.',
      });
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!detail) return;
    setActionMessage(null);
    try {
      await deleteShipmentAttachment(tenant.id, attachmentId);
      const fresh = await listShipmentAttachments(tenant.id, detail.shipment.id);
      setAttachments(fresh);
      setActionMessage({type: 'success', text: 'تم حذف المرفق بنجاح.'});
    } catch (err) {
      setActionMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر حذف المرفق.',
      });
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
        جاري تحميل ملف الشحنة...
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error ?? 'الشحنة المطلوبة غير موجودة أو لا تملك صلاحية عرضها.'}
      </div>
    );
  }

  const shp = detail.shipment;
  const sender = detail.parties.find((p) => p.party_type === 'sender');
  const recipient = detail.parties.find((p) => p.party_type === 'recipient');
  const activeToken = detail.trackingTokens.find((t) => t.is_active)?.token ?? '';
  const publicTrackingPath = activeToken
    ? `${buildTenantBasePath(tenant.slug)}/track/${activeToken}`
    : `${buildTenantBasePath(tenant.slug)}/track`;

  const allowedTransitions = WORKFLOW_OPTIONS[shp.operational_status];
  const canTransition =
    allowedTransitions.length > 0 &&
    (can('operations.pickup.approve', shp.current_branch_id) ||
      can('operations.delivery.execute', shp.current_branch_id) ||
      can('shipments.update_draft', shp.current_branch_id) ||
      can('shipments.cancel', shp.current_branch_id));

  const canReprice =
    !REPRICE_LOCKED_STATUSES.includes(shp.operational_status) &&
    (can('shipments.update_draft', shp.current_branch_id) ||
      can('operations.pickup.approve', shp.current_branch_id) ||
      can('pricing.override'));

  // 4-Stage Visual Progress Track (MASTER_SPEC lines 1007-1012)
  const stageCreated = shp.operational_status !== 'cancelled';
  const stagePickedUp = [
    'pickup_scheduled',
    'picked_up',
    'in_warehouse',
    'in_transit_branch',
    'out_for_delivery',
    'rescheduled',
    'partially_delivered',
    'delivered',
    'delivery_failed',
    'return_to_sender',
    'returned',
  ].includes(shp.operational_status);
  const stageOutForDelivery = [
    'out_for_delivery',
    'rescheduled',
    'partially_delivered',
    'delivered',
    'delivery_failed',
    'return_to_sender',
    'returned',
  ].includes(shp.operational_status);
  const stageDelivered = shp.operational_status === 'delivered' || shp.operational_status === 'partially_delivered';

  return (
    <div className="space-y-6">
      {/* Printable Waybill Sheet (visible during print) */}
      <section className="hidden print:block rounded-xl border-2 border-slate-900 bg-white p-6 text-right text-xs">
        <div className="flex items-start justify-between border-b-2 border-slate-900 pb-4">
          <div>
            <p className="text-base font-bold text-slate-900">{tenant.name}</p>
            <p className="mt-0.5 text-[11px] text-slate-600">بوليصة شحن وتوصيل · {SHIPMENT_TYPE_LABELS[shp.shipment_type_code]}</p>
          </div>
          <div className="text-left">
            <p className="font-mono-tabular text-lg font-bold text-slate-900">{shp.shipment_number}</p>
            <p className="font-mono-tabular text-xs text-slate-700">{shp.barcode_token}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-6">
          <div className="space-y-1">
            <p className="font-bold text-slate-900">الراسل (التاجر)</p>
            <p>{sender?.name ?? clientNameMap.get(shp.client_id) ?? '—'}</p>
            <p>{govNameMap.get(shp.sender_governorate_id) ?? ''} · {regNameMap.get(shp.sender_region_id) ?? ''}</p>
            <p className="font-mono-tabular">{sender?.mobile ?? '—'}</p>
            <p>{sender?.address_line ?? '—'}</p>
          </div>
          <div className="space-y-1">
            <p className="font-bold text-slate-900">المرسل إليه (المستلم)</p>
            <p>{recipient?.name ?? '—'}</p>
            <p>{govNameMap.get(shp.recipient_governorate_id) ?? ''} · {regNameMap.get(shp.recipient_region_id) ?? ''}</p>
            <p className="font-mono-tabular">{recipient?.mobile ?? '—'}</p>
            <p>{recipient?.address_line ?? '—'}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3 border-t border-slate-300 pt-3">
          <div>
            <p className="text-slate-500">الخدمة</p>
            <p className="font-semibold">{serviceNameMap.get(shp.service_id) ?? '—'}</p>
          </div>
          <div>
            <p className="text-slate-500">الوزن / القطع</p>
            <p className="font-mono-tabular font-semibold">{shp.chargeable_weight_kg} كجم · {shp.pieces_count} قطع</p>
          </div>
          <div>
            <p className="text-slate-500">نوع الدفع</p>
            <p className="font-semibold">{PAYMENT_TERM_LABELS[shp.payment_term_code]}</p>
          </div>
          <div>
            <p className="text-slate-500">المطلوب تحصيله</p>
            <p className="font-mono-tabular text-sm font-bold">{Number(shp.recipient_collect_amount).toFixed(2)} {tenant.default_currency}</p>
          </div>
        </div>
        {shp.package_description && (
          <p className="mt-3 border-t border-slate-200 pt-2">وصف الطرد: {shp.package_description}</p>
        )}
      </section>

      {/* Header & Barcode / Public Tracking Bar */}
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-6 print:hidden">
        <div>
          <Link
            to={`${basePath}/shipments`}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            العودة لقائمة الشحنات
          </Link>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-mono-tabular text-2xl font-bold text-slate-900">{shp.shipment_number}</h1>
            <span className="text-sm font-semibold text-slate-700">
              {SHIPMENT_STATUS_LABELS[shp.operational_status]}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1 font-mono-tabular">
              <Barcode className="h-3.5 w-3.5" />
              {shp.barcode_token}
            </span>
            <span aria-hidden="true">·</span>
            <span>{clientNameMap.get(shp.client_id) ?? 'العميل'}</span>
            <span aria-hidden="true">·</span>
            <span>{serviceNameMap.get(shp.service_id) ?? 'الخدمة'}</span>
            <span aria-hidden="true">·</span>
            <span>{SHIPMENT_TYPE_LABELS[shp.shipment_type_code]}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleCopy('barcode', shp.barcode_token)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            {copiedKey === 'barcode' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            نسخ الباركود
          </button>

          <button
            type="button"
            onClick={() => void handleCopy('track', `${window.location.origin}${publicTrackingPath}`)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            {copiedKey === 'track' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            نسخ رابط التتبع العام
          </button>

          <Link
            to={publicTrackingPath}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            صفحة التتبع
          </Link>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            <Printer className="h-3.5 w-3.5" />
            طباعة البوليصة
          </button>
        </div>
      </div>

      {/* Top 4 Financial / Lifecycle Status Checkboxes (MASTER_SPEC lines 1002-1006) */}
      <section aria-label="مؤشرات الإتمام المالي والتشغيلي" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {label: 'تم الإنشاء', done: shp.is_created_confirmed},
          {label: 'تم التحصيل من المندوب', done: shp.is_collected_from_courier},
          {label: 'تم السداد للعميل', done: shp.is_settled_to_client},
          {label: 'تم السداد للمندوب', done: shp.is_courier_commission_paid},
        ].map((flag) => (
          <div
            key={flag.label}
            className={`flex items-center justify-between rounded-xl border px-4 py-3 text-xs font-semibold ${
              flag.done
                ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800'
                : 'border-slate-200 bg-white text-slate-500'
            }`}
          >
            <span>{flag.label}</span>
            <span className="inline-flex items-center gap-1">
              {flag.done ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-slate-300" />}
              <span>{flag.done ? 'مكتمل' : 'قيد الانتظار'}</span>
            </span>
          </div>
        ))}
      </section>

      {/* 4-Step Visual Milestone Track (MASTER_SPEC lines 1007-1012) */}
      <section aria-label="مراحل مسار الشحنة" className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            {label: '1. تم الإنشاء', active: stageCreated},
            {label: '2. تم الشحن / الالتقاط', active: stagePickedUp},
            {label: '3. جاري التوصيل', active: stageOutForDelivery},
            {label: shp.operational_status === 'partially_delivered' ? '4. تسليم جزئي (PDP)' : '4. تم التسليم', active: stageDelivered},
          ].map((step) => (
            <div
              key={step.label}
              className={`rounded-lg border px-3 py-2.5 text-center text-xs font-semibold ${
                step.active
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-slate-50 text-slate-400'
              }`}
            >
              {step.label}
            </div>
          ))}
        </div>
      </section>

      {actionMessage && (
        <div
          role="status"
          className={`rounded-xl border px-4 py-3 text-xs font-medium ${
            actionMessage.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      {/* Server Actions: Transition & Repricing */}
      {(canTransition || canReprice) && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {canTransition && (
            <form onSubmit={handleTransitionSubmit} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <RefreshCw className="h-4 w-4 text-slate-700" />
                <h2 className="text-sm font-semibold text-slate-900">تحديث الحالة عبر الخادم</h2>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="tr-status" className="block text-xs font-medium text-slate-700">
                    الحالة التالية
                  </label>
                  <select
                    id="tr-status"
                    value={targetStatus}
                    onChange={(e) => setTargetStatus(e.target.value as ShipmentOperationalStatus)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  >
                    {allowedTransitions.map((st) => (
                      <option key={st} value={st}>
                        {SHIPMENT_STATUS_LABELS[st]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="tr-branch" className="block text-xs font-medium text-slate-700">
                    الفرع الحالي
                  </label>
                  <select
                    id="tr-branch"
                    value={transitionBranchId}
                    onChange={(e) => setTransitionBranchId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  >
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="tr-courier" className="block text-xs font-medium text-slate-700">
                    المندوب المكلف (اختياري)
                  </label>
                  <select
                    id="tr-courier"
                    value={transitionCourierId}
                    onChange={(e) => setTransitionCourierId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  >
                    <option value="">بدون تحديد</option>
                    {couriers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                {(targetStatus === 'delivery_failed' || targetStatus === 'return_to_sender' || targetStatus === 'cancelled') && (
                  <div>
                    <label htmlFor="tr-reason" className="block text-xs font-medium text-slate-700">
                      سبب التعذر / الإلغاء / الإرجاع
                    </label>
                    <select
                      id="tr-reason"
                      value={exceptionReasonId}
                      onChange={(e) => setExceptionReasonId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                    >
                      <option value="">اختر السبب...</option>
                      {exceptionReasons.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {targetStatus === 'partially_delivered' && (
                  <>
                    <div>
                      <label htmlFor="tr-del-pcs" className="block text-xs font-medium text-slate-700">
                        القطع المسلمة (من أصل {shp.pieces_count})
                      </label>
                      <input
                        id="tr-del-pcs"
                        type="number"
                        min="1"
                        max={Math.max(1, shp.pieces_count - 1)}
                        value={deliveredPieces}
                        onChange={(e) => setDeliveredPieces(e.target.value)}
                        required
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                      />
                    </div>
                    <div>
                      <label htmlFor="tr-del-amt" className="block text-xs font-medium text-slate-700">
                        المبلغ المحصل فعليًا (ج.م)
                      </label>
                      <input
                        id="tr-del-amt"
                        type="number"
                        min="0"
                        step="0.01"
                        value={deliveredAmount}
                        onChange={(e) => setDeliveredAmount(e.target.value)}
                        required
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                      />
                    </div>
                  </>
                )}

                {targetStatus === 'delivered' && (
                  <div>
                    <label htmlFor="tr-del-amt-full" className="block text-xs font-medium text-slate-700">
                      المبلغ المحصل عند التسليم (ج.م)
                    </label>
                    <input
                      id="tr-del-amt-full"
                      type="number"
                      min="0"
                      step="0.01"
                      value={deliveredAmount}
                      onChange={(e) => setDeliveredAmount(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                    />
                  </div>
                )}

                <div className="sm:col-span-2">
                  <label htmlFor="tr-notes" className="block text-xs font-medium text-slate-700">
                    ملاحظات الحركة
                  </label>
                  <input
                    id="tr-notes"
                    type="text"
                    value={transitionNotes}
                    onChange={(e) => setTransitionNotes(e.target.value)}
                    placeholder="توضيح الإجراء أو سبب التغيير"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submittingTransition}
                className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {submittingTransition ? 'جاري التنفيذ...' : 'تنفيذ الانتقال'}
              </button>
            </form>
          )}

          {canReprice && (
            <form onSubmit={handleRepriceSubmit} className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-slate-700" />
                <h2 className="text-sm font-semibold text-slate-900">تعديل الوزن وإعادة التسعير</h2>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label htmlFor="rev-weight" className="block text-xs font-medium text-slate-700">
                    الوزن الفعلي (كجم)
                  </label>
                  <input
                    id="rev-weight"
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
                  <label htmlFor="rev-len" className="block text-xs font-medium text-slate-700">
                    طول (سم)
                  </label>
                  <input
                    id="rev-len"
                    type="number"
                    min="0"
                    value={revLength}
                    onChange={(e) => setRevLength(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono-tabular text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="rev-wid" className="block text-xs font-medium text-slate-700">
                    عرض (سم)
                  </label>
                  <input
                    id="rev-wid"
                    type="number"
                    min="0"
                    value={revWidth}
                    onChange={(e) => setRevWidth(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono-tabular text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="rev-hei" className="block text-xs font-medium text-slate-700">
                    ارتفاع (سم)
                  </label>
                  <input
                    id="rev-hei"
                    type="number"
                    min="0"
                    value={revHeight}
                    onChange={(e) => setRevHeight(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 font-mono-tabular text-xs"
                  />
                </div>

                {can('pricing.override') && (
                  <div className="col-span-2">
                    <label htmlFor="rev-override" className="block text-xs font-medium text-slate-700">
                      سعر شحن إداري مخصص (اختياري)
                    </label>
                    <input
                      id="rev-override"
                      type="number"
                      min="0"
                      step="0.01"
                      value={revOverrideFee}
                      onChange={(e) => setRevOverrideFee(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                    />
                  </div>
                )}

                <div className={can('pricing.override') ? 'col-span-2' : 'col-span-2 sm:col-span-4'}>
                  <label htmlFor="rev-reason" className="block text-xs font-medium text-slate-700">
                    سبب التعديل (إلزامي للتدقيق)
                  </label>
                  <input
                    id="rev-reason"
                    type="text"
                    required
                    value={revReason}
                    onChange={(e) => setRevReason(e.target.value)}
                    placeholder="مثال: إعادة وزن على ميزان المخزن"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submittingReprice}
                className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60"
              >
                {submittingReprice ? 'جاري إصدار اللقطة...' : 'اعتماد إصدار سعر جديد'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Detail Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5">
        {(
          [
            {key: 'description', label: 'الوصف والبيانات'},
            {key: 'movements', label: `الحركات وسجل الحالات (${detail.events.length})`},
            {key: 'finance', label: `الأثر المالي ولقطات السعر (${detail.snapshots.length})`},
            {key: 'notes', label: `الملاحظات (${detail.notes.length})`},
            {key: 'attachments', label: `المستندات والمرفقات (${attachments.length})`},
            {key: 'messages', label: 'الرسائل والمحادثة'},
            {key: 'tracking', label: 'الباركود والعلاقات'},
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              activeTab === tab.key
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Description & Core Metadata */}
      {activeTab === 'description' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">ملخص الشحنة التشغيلي</h2>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-slate-500">تاريخ الالتقاط</dt>
                <dd className="font-mono-tabular text-slate-900">{shp.pickup_date}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">فرع المنشأ / الفرع الحالي</dt>
                <dd className="text-slate-900">
                  {branchNameMap.get(shp.origin_branch_id) ?? '—'} · {branchNameMap.get(shp.current_branch_id) ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">المندوب الحالي</dt>
                <dd className="text-slate-900">
                  {shp.assigned_courier_id ? courierNameMap.get(shp.assigned_courier_id) ?? '—' : 'غير معيّن'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">الوزن الفعلي / المفوتر</dt>
                <dd className="font-mono-tabular text-slate-900">
                  {shp.actual_weight_kg} / {shp.chargeable_weight_kg} كجم
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">عدد القطع (مسلم / مرتجع)</dt>
                <dd className="font-mono-tabular text-slate-900">
                  {shp.pieces_count} ({shp.delivered_pieces_count} / {shp.returned_pieces_count})
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">فتح الطرد</dt>
                <dd className="text-slate-900">{shp.allow_package_opening ? 'مسموح' : 'غير مسموح'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">وصف الطرد</dt>
                <dd className="text-slate-900">{shp.package_description ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">الرقم المرجعي</dt>
                <dd className="font-mono-tabular text-slate-900">{shp.external_reference ?? '—'}</dd>
              </div>
              {shp.partial_return_custody !== 'none' && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">عهدة المرتجع الجزئي (PDP)</dt>
                  <dd className="font-medium text-amber-700">{RETURN_CUSTODY_LABELS[shp.partial_return_custody]}</dd>
                </div>
              )}
              {shp.exchange_status !== 'none' && (
                <div className="flex justify-between">
                  <dt className="text-slate-500">عهدة الاستبدال (PTP)</dt>
                  <dd className="font-medium text-amber-700">{RETURN_CUSTODY_LABELS[shp.exchange_status]}</dd>
                </div>
              )}
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">بيانات الراسل</h2>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-slate-500">الاسم</dt>
                <dd className="font-medium text-slate-900">{sender?.name ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">الموقع</dt>
                <dd className="text-slate-900">
                  {govNameMap.get(shp.sender_governorate_id) ?? '—'} · {regNameMap.get(shp.sender_region_id) ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">الموبايل</dt>
                <dd className="font-mono-tabular text-slate-900">{sender?.mobile ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">التليفون</dt>
                <dd className="font-mono-tabular text-slate-900">{sender?.phone ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">العنوان</dt>
                <dd className="mt-1 text-slate-900">{sender?.address_line ?? '—'}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">بيانات المرسل إليه</h2>
            <dl className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <dt className="text-slate-500">الاسم</dt>
                <dd className="font-medium text-slate-900">{recipient?.name ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">الوجهة</dt>
                <dd className="text-slate-900">
                  {govNameMap.get(shp.recipient_governorate_id) ?? '—'} · {regNameMap.get(shp.recipient_region_id) ?? '—'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">الموبايل</dt>
                <dd className="font-mono-tabular text-slate-900">{recipient?.mobile ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">التليفون</dt>
                <dd className="font-mono-tabular text-slate-900">{recipient?.phone ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">العنوان بالتفصيل</dt>
                <dd className="mt-1 text-slate-900">{recipient?.address_line ?? '—'}</dd>
              </div>
            </dl>
          </section>
        </div>
      )}

      {/* Tab 2: Status Events Log (MASTER_SPEC line 1031) */}
      {activeTab === 'movements' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">التاريخ</th>
                <th className="px-4 py-3 font-medium">الحدث</th>
                <th className="px-4 py-3 font-medium">الحالة</th>
                <th className="px-4 py-3 font-medium">الفرع</th>
                <th className="px-4 py-3 font-medium">المندوب</th>
                <th className="px-4 py-3 font-medium">القائمة</th>
                <th className="px-4 py-3 font-medium">السبب / الملاحظات</th>
                <th className="px-4 py-3 font-medium">القائم بالتعديل</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {detail.events.map((evt) => (
                <tr key={evt.id}>
                  <td className="px-4 py-3 font-mono-tabular text-slate-600 whitespace-nowrap">
                    {formatDateTime(evt.created_at)}
                  </td>
                  <td className="px-4 py-3 font-mono-tabular text-slate-700">{evt.event_code}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {SHIPMENT_STATUS_LABELS[evt.to_status as ShipmentOperationalStatus] ?? evt.to_status}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {evt.branch_id ? branchNameMap.get(evt.branch_id) ?? '—' : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {evt.courier_id ? courierNameMap.get(evt.courier_id) ?? '—' : '—'}
                  </td>
                  <td className="px-4 py-3 font-mono-tabular text-slate-600">
                    {evt.list_code ? `${evt.list_type ?? ''} ${evt.list_code}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {evt.exception_reason_id ? `${reasonNameMap.get(evt.exception_reason_id) ?? ''} · ` : ''}
                    {evt.notes ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{evt.actor_display_name ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 3: Financial Breakdown & Snapshot Versions */}
      {activeTab === 'finance' && (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">
              الملخص المالي المعتمد ({PAYMENT_TERM_LABELS[shp.payment_term_code]})
            </h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-xs sm:grid-cols-4">
              <div>
                <dt className="text-slate-500">إجمالي مصاريف الشحن</dt>
                <dd className="mt-1 font-mono-tabular text-base font-bold text-slate-900">
                  {Number(shp.total_shipping_fee).toFixed(2)} ج.م
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">المطلوب تحصيله من المستلم</dt>
                <dd className="mt-1 font-mono-tabular text-base font-bold text-slate-900">
                  {Number(shp.recipient_collect_amount).toFixed(2)} ج.م
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">صافي مستحق / أثر التاجر</dt>
                <dd className="mt-1 font-mono-tabular text-base font-bold text-emerald-700">
                  {Number(shp.client_net_payout).toFixed(2)} ج.م
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">الرصيد المدخل / رسوم الإرجاع</dt>
                <dd className="mt-1 font-mono-tabular text-sm font-semibold text-slate-700">
                  {Number(shp.prepaid_balance_amount).toFixed(2)} / {Number(shp.return_fee).toFixed(2)} ج.م
                </dd>
              </div>
            </dl>
          </section>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">الإصدار</th>
                  <th className="px-4 py-3 font-medium">الوزن المفوتر</th>
                  <th className="px-4 py-3 font-medium">الضريبة</th>
                  <th className="px-4 py-3 font-medium">إجمالي الشحن</th>
                  <th className="px-4 py-3 font-medium">التحصيل من المستلم</th>
                  <th className="px-4 py-3 font-medium">صافي التاجر</th>
                  <th className="px-4 py-3 font-medium">تعديل يدوي / السبب</th>
                  <th className="px-4 py-3 font-medium">التوقيت</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {detail.snapshots.map((snap) => (
                  <tr key={snap.id}>
                    <td className="px-4 py-3 font-mono-tabular font-semibold text-slate-900">
                      v{snap.version_number}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular">{snap.chargeable_weight_kg} كجم</td>
                    <td className="px-4 py-3 font-mono-tabular">
                      {snap.tax_mode} · {Number(snap.tax_amount).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular font-semibold">
                      {Number(snap.total_shipping_fee).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular">{Number(snap.recipient_collect_amount).toFixed(2)}</td>
                    <td className="px-4 py-3 font-mono-tabular">{Number(snap.client_net_payout).toFixed(2)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {snap.is_manual_override ? 'نعم' : 'تلقائي'}
                      {snap.override_reason ? ` · ${snap.override_reason}` : ''}
                    </td>
                    <td className="px-4 py-3 font-mono-tabular text-slate-500">
                      {formatDateTime(snap.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Notes */}
      {activeTab === 'notes' && (
        <div className="space-y-4">
          <form onSubmit={handleAddNote} className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">إضافة ملاحظة جديدة</h2>
            <div className="mt-3 flex flex-wrap gap-3">
              <select
                value={isClientUser ? 'client_visible' : noteType}
                onChange={(e) => setNoteType(e.target.value as ShipmentNoteType)}
                disabled={isClientUser}
                className="rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50"
              >
                {!isClientUser && <option value="internal">ملاحظة داخلية للفريق</option>}
                <option value="client_visible">ملاحظة ظاهرة للعميل</option>
                {!isClientUser && <option value="courier_note">توجيه للمندوب</option>}
              </select>
              <input
                type="text"
                required
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="اكتب الملاحظة..."
                className="min-w-[240px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs"
              />
              <button
                type="submit"
                disabled={savingNote}
                className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                {savingNote ? 'جاري الحفظ...' : 'إضافة'}
              </button>
            </div>
          </form>

          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {detail.notes.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-500">لا توجد ملاحظات مسجلة حتى الآن.</p>
            ) : (
              detail.notes.map((n) => (
                <div key={n.id} className="p-4 text-xs">
                  <div className="flex items-center justify-between text-slate-500">
                    <span>
                      {n.created_by_name ?? 'مستخدم'} · {n.note_type}
                    </span>
                    <span className="font-mono-tabular">{formatDateTime(n.created_at)}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-slate-900">{n.body}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab 5: Tracking & Relations */}
      {activeTab === 'tracking' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">الباركود وروابط التتبع العام</h2>
            <dl className="mt-3 space-y-2 text-xs">
              <div>
                <dt className="text-slate-500">رمز الباركود غير القابل للتخمين</dt>
                <dd className="mt-1 font-mono-tabular text-sm font-bold text-slate-900">{shp.barcode_token}</dd>
              </div>
              <div>
                <dt className="text-slate-500">رابط التتبع العام غير القابل للتخمين</dt>
                <dd className="mt-1 break-all font-mono-tabular text-slate-700">{publicTrackingPath}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">الطرود المرتبطة وعهدة الاستبدال</h2>
            {detail.relations.length === 0 ? (
              <p className="mt-3 text-xs text-slate-500">لا توجد علاقات مرتبطة بهذه الشحنة.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {detail.relations.map((rel) => (
                  <div key={rel.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                    <p className="font-semibold text-slate-900">{rel.relation_type}</p>
                    <p className="mt-1 text-slate-700">{rel.exchange_item_description ?? rel.notes ?? '—'}</p>
                    <p className="mt-1 text-slate-500">
                      حالة العهدة: {RETURN_CUSTODY_LABELS[rel.custody_status as keyof typeof RETURN_CUSTODY_LABELS] ?? rel.custody_status}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {/* Tab 6: Private Storage Attachments */}
      {activeTab === 'attachments' && (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">رفع مستند أو صورة للشحنة (تخزين خاص مؤمن)</h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="att-cat" className="block text-xs font-medium text-slate-700">
                  تصنيف المرفق
                </label>
                <select
                  id="att-cat"
                  value={attachmentCategory}
                  onChange={(e) => setAttachmentCategory(e.target.value as ShipmentAttachmentCategory)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  {Object.entries(SHIPMENT_ATTACHMENT_CATEGORY_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              {!isClientUser && (
                <div>
                  <label htmlFor="att-vis" className="block text-xs font-medium text-slate-700">
                    نطاق الرؤية
                  </label>
                  <select
                    id="att-vis"
                    value={attachmentVisibility}
                    onChange={(e) => setAttachmentVisibility(e.target.value as MessageVisibility)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  >
                    <option value="external">مرئي للتاجر والفريق</option>
                    <option value="internal">داخلي للفريق فقط</option>
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="att-notes" className="block text-xs font-medium text-slate-700">
                  وصف مختصر (اختياري)
                </label>
                <input
                  id="att-notes"
                  type="text"
                  value={attachmentNotes}
                  onChange={(e) => setAttachmentNotes(e.target.value)}
                  placeholder="مثال: صورة الفاتورة أو إثبات التسليم"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="mt-4">
              <AttachmentUploader
                tenantId={tenant.id}
                bucketId={attachmentCategory === 'delivery_proof' ? 'delivery-proof' : 'shipment-attachments'}
                entityType={attachmentCategory === 'delivery_proof' ? 'delivery_proof' : 'shipment'}
                entityId={shp.id}
                maxSizeMb={maxAttachmentMb}
                label="اختيار ورفع ملف للشحنة"
                onUploaded={handleShipmentAttachmentUploaded}
              />
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">المرفقات المسجلة ({attachments.length})</h2>
            <div className="mt-3">
              {attachments.length === 0 ? (
                <p className="text-xs text-slate-500">لا توجد مرفقات مسجلة لهذه الشحنة حتى الآن.</p>
              ) : (
                <AttachmentPreviewList
                  items={attachments.map((att) => ({
                    id: att.id,
                    storageObject: att.storage_object,
                    subtitle: `${SHIPMENT_ATTACHMENT_CATEGORY_LABELS[att.category]}${att.notes ? ` · ${att.notes}` : ''}`,
                    canDelete: !isClientUser || att.created_by === profile?.id,
                  }))}
                  onDelete={handleDeleteAttachment}
                />
              )}
            </div>
          </section>
        </div>
      )}

      {/* Tab 7: Shipment Conversation Thread */}
      {activeTab === 'messages' && (
        <ConversationThreadPanel
          tenantId={tenant.id}
          entityType="shipment"
          entityId={shp.id}
          defaultSubject={`محادثة الشحنة ${shp.shipment_number}`}
          maxAttachmentSizeMb={maxAttachmentMb}
        />
      )}
    </div>
  );
}
