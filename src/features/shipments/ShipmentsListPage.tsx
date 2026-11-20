import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {listClients} from '@/features/clients/clientsService';
import {
  listBranches,
  listExceptionReasons,
  listGovernorates,
  listOperationalRefs,
  listRegions,
  listShippingServices,
} from '@/features/definitions/definitionsService';
import {DeliveryExecutionModal} from '@/features/delivery/DeliveryExecutionModal';
import {getTenantDeliveryPolicy} from '@/features/delivery/deliveryService';
import {listShipments} from '@/features/shipments/shipmentsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {formatDateTime} from '@/lib/formatters';
import type {
  BranchRecord,
  DeliveryExceptionReasonRecord,
  GovernorateRecord,
  PaymentTermRecord,
  RegionRecord,
  ShippingServiceRecord,
} from '@/types/definitions';
import type {TenantDeliveryPolicyRecord} from '@/types/delivery';
import type {ClientRecord} from '@/types/pricing';
import {
  PAYMENT_TERM_LABELS,
  SHIPMENT_STATUS_LABELS,
  type PaymentTermCode,
  type ShipmentListItem,
  type ShipmentListPreset,
  type ShipmentOperationalStatus,
} from '@/types/shipments';
import {Barcode, Check, Copy, Filter, PackagePlus, Search, X} from 'lucide-react';

interface ShipmentsListPageProps {
  readonly preset?: ShipmentListPreset;
}

const PRESET_TITLES: Record<ShipmentListPreset, {title: string; subtitle: string}> = {
  all: {
    title: 'قائمة الشحنات',
    subtitle: 'استعراض وبحث وفلترة جميع بوالص الشحن وحالاتها المالية والتشغيلية.',
  },
  warehouse: {
    title: 'شحنات في المخزون',
    subtitle: 'الشحنات الملتقطة أو المستلمة بالمخزن أو قيد النقل بين الفروع تمهيدًا للتوزيع.',
  },
  'out-for-delivery': {
    title: 'الشحنات قيد التوصيل',
    subtitle: 'الشحنات الخارجة للتوصيل مع المناديب حاليًا.',
  },
  rescheduled: {
    title: 'انتظار إعادة التوصيل',
    subtitle: 'الشحنات المتعثرة أو المؤجلة المطلوب إعادة جدولتها للتوصيل.',
  },
  returns: {
    title: 'المرتجعات والمتعثرة',
    subtitle: 'الشحنات قيد الإرجاع للراسل، المرتجعة، أو المسلمة جزئيًا بعهدة مرتجعة.',
  },
  tracking: {
    title: 'الباركود والتتبع',
    subtitle: 'إدارة أرقام الباركود غير القابلة للتخمين وروابط التتبع العام لكل شحنة.',
  },
};

function getStatusAccentClass(status: ShipmentOperationalStatus): string {
  if (status === 'delivered') return 'text-emerald-700';
  if (status === 'partially_delivered') return 'text-amber-700';
  if (status === 'delivery_failed' || status === 'return_to_sender' || status === 'returned' || status === 'cancelled') {
    return 'text-red-700';
  }
  if (status === 'out_for_delivery' || status === 'in_warehouse') return 'text-sky-700';
  return 'text-slate-700';
}

export function ShipmentsListPage({preset = 'all'}: ShipmentsListPageProps) {
  const {tenant, boundClientId, can} = useTenantWorkspace();
  const navigate = useNavigate();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const [items, setItems] = useState<readonly ShipmentListItem[]>([]);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [services, setServices] = useState<readonly ShippingServiceRecord[]>([]);
  const [governorates, setGovernorates] = useState<readonly GovernorateRecord[]>([]);
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);
  const [paymentTerms, setPaymentTerms] = useState<readonly PaymentTermRecord[]>([]);
  const [exceptionReasons, setExceptionReasons] = useState<readonly DeliveryExceptionReasonRecord[]>([]);
  const [deliveryPolicy, setDeliveryPolicy] = useState<TenantDeliveryPolicyRecord>({
    tenant_id: tenant.id,
    max_delivery_attempts: 3,
    retry_extra_fee: 0,
    require_pod_on_delivery: false,
  });
  const [execShipment, setExecShipment] = useState<ShipmentListItem | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);

  // Filter states
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ShipmentOperationalStatus | ''>('');
  const [originBranchId, setOriginBranchId] = useState('');
  const [currentBranchId, setCurrentBranchId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [paymentTermCode, setPaymentTermCode] = useState<PaymentTermCode | ''>('');
  const [clientId, setClientId] = useState('');
  const [destGovId, setDestGovId] = useState('');
  const [destRegionId, setDestRegionId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const loadRefs = useCallback(async () => {
    try {
      const [br, cl, srv, gov, reg, refs, reasons, pol] = await Promise.all([
        listBranches(tenant.id),
        listClients(tenant.id),
        listShippingServices(tenant.id),
        listGovernorates(tenant.id),
        listRegions(tenant.id),
        listOperationalRefs(tenant.id),
        listExceptionReasons(tenant.id),
        getTenantDeliveryPolicy(tenant.id),
      ]);
      setBranches(br);
      setClients(cl);
      setServices(srv);
      setGovernorates(gov);
      setRegions(reg);
      setPaymentTerms(refs.paymentTerms);
      setExceptionReasons(reasons.filter((r) => r.is_active));
      setDeliveryPolicy(pol);
    } catch {
      // Non-blocking reference dropdowns
    }
  }, [tenant.id]);

  const loadShipments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listShipments(tenant.id, {
        preset,
        search,
        status: statusFilter,
        originBranchId,
        currentBranchId,
        serviceId,
        paymentTermCode,
        clientId,
        destinationGovId: destGovId,
        destinationRegionId: destRegionId,
        dateFrom,
        dateTo,
      });
      setItems(data);
      setSelectedIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل قائمة الشحنات.');
    } finally {
      setLoading(false);
    }
  }, [
    tenant.id,
    preset,
    search,
    statusFilter,
    originBranchId,
    currentBranchId,
    serviceId,
    paymentTermCode,
    clientId,
    destGovId,
    destRegionId,
    dateFrom,
    dateTo,
  ]);

  useEffect(() => {
    void loadRefs();
  }, [loadRefs]);

  useEffect(() => {
    void loadShipments();
  }, [loadShipments]);

  const branchNameMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const clientNameMap = useMemo(() => new Map(clients.map((c) => [c.id, c.name])), [clients]);
  const serviceNameMap = useMemo(() => new Map(services.map((s) => [s.id, s.name])), [services]);
  const govNameMap = useMemo(() => new Map(governorates.map((g) => [g.id, g.name])), [governorates]);
  const regNameMap = useMemo(() => new Map(regions.map((r) => [r.id, r.name])), [regions]);

  const filteredRegions = useMemo(
    () => (destGovId ? regions.filter((r) => r.governorate_id === destGovId) : regions),
    [regions, destGovId],
  );

  const toggleSelectAll = () => {
    if (selectedIds.length === items.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(items.map((item) => item.id));
    }
  };

  const toggleRow = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleResetFilters = () => {
    setSearch('');
    setStatusFilter('');
    setOriginBranchId('');
    setCurrentBranchId('');
    setServiceId('');
    setPaymentTermCode('');
    setClientId('');
    setDestGovId('');
    setDestRegionId('');
    setDateFrom('');
    setDateTo('');
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1500);
    } catch {
      // Ignore clipboard failure in headless tests
    }
  };

  const handleFilterSubmit = (e: FormEvent) => {
    e.preventDefault();
    void loadShipments();
  };

  const meta = PRESET_TITLES[preset];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">{meta.title}</h1>
          <p className="mt-1 text-sm text-slate-600">{meta.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          {can('shipments.create') && (
            <Link
              to={`${basePath}/shipments/new`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <PackagePlus className="h-4 w-4" />
              إنشاء شحنة جديدة
            </Link>
          )}
        </div>
      </div>

      {/* Quick Preset Navigation Bar */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white p-1.5">
        {(
          [
            {key: 'all', label: 'كل الشحنات', to: `${basePath}/shipments`},
            {key: 'warehouse', label: 'في المخزون', to: `${basePath}/shipments/warehouse`},
            {key: 'out-for-delivery', label: 'قيد التوصيل', to: `${basePath}/shipments/out-for-delivery`},
            {key: 'rescheduled', label: 'إعادة التوصيل', to: `${basePath}/shipments/rescheduled`},
            {key: 'returns', label: 'المرتجعات والمتعثرة', to: `${basePath}/shipments/returns`},
            {key: 'tracking', label: 'الباركود والتتبع', to: `${basePath}/shipments/tracking`},
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => navigate(tab.to)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              preset === tab.key
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search & Multi-Faceted Filter Bar */}
      <form onSubmit={handleFilterSubmit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم الشحنة، الباركود، الموبايل، التاجر، أو المرجع..."
              aria-label="بحث في الشحنات"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pr-9 pl-3 text-xs focus:border-slate-400 focus:outline-none"
            />
          </div>

          <select
            aria-label="حالة الشحنة"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ShipmentOperationalStatus | '')}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-slate-400 focus:outline-none"
          >
            <option value="">كل الحالات</option>
            {Object.entries(SHIPMENT_STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>

          {!boundClientId && (
            <select
              aria-label="العميل"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-slate-400 focus:outline-none"
            >
              <option value="">كل العملاء</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => setShowAdvancedFilters((p) => !p)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Filter className="h-3.5 w-3.5" />
            فلاتر متقدمة
          </button>

          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            تطبيق
          </button>

          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-50 whitespace-nowrap"
          >
            <X className="h-3.5 w-3.5" />
            مسح
          </button>
        </div>

        {showAdvancedFilters && (
          <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-xs text-slate-500">فرع المنشأ</label>
              <select
                value={originBranchId}
                onChange={(e) => setOriginBranchId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
              >
                <option value="">الكل</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-500">الفرع الحالي</label>
              <select
                value={currentBranchId}
                onChange={(e) => setCurrentBranchId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
              >
                <option value="">الكل</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-500">الخدمة</label>
              <select
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
              >
                <option value="">الكل</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-500">نوع الدفع</label>
              <select
                value={paymentTermCode}
                onChange={(e) => setPaymentTermCode(e.target.value as PaymentTermCode | '')}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
              >
                <option value="">الكل</option>
                {paymentTerms.map((t) => (
                  <option key={t.id} value={t.code}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-500">إلى محافظة</label>
              <select
                value={destGovId}
                onChange={(e) => {
                  setDestGovId(e.target.value);
                  setDestRegionId('');
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
                value={destRegionId}
                onChange={(e) => setDestRegionId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs"
              >
                <option value="">الكل</option>
                {filteredRegions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-500">من تاريخ الالتقاط</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-500">إلى تاريخ الالتقاط</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
              />
            </div>
          </div>
        )}
      </form>

      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-700">
          <span className="font-mono-tabular font-medium">
            تم تحديد {selectedIds.length} شحنة للعمليات المجمعة (جاهزة لربط قوائم الالتقاط والتوصيل في المراحل 7–8).
          </span>
          <button
            type="button"
            onClick={() => setSelectedIds([])}
            className="text-slate-500 underline underline-offset-4 hover:text-slate-900"
          >
            إلغاء التحديد
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Shipments Data Grid */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-3 py-3 font-medium">
                <input
                  type="checkbox"
                  aria-label="تحديد جميع الشحنات"
                  checked={items.length > 0 && selectedIds.length === items.length}
                  onChange={toggleSelectAll}
                  className="h-3.5 w-3.5 rounded border-slate-300"
                />
              </th>
              <th className="px-4 py-3 font-medium">رقم الشحنة والباركود</th>
              <th className="px-4 py-3 font-medium">التاريخ</th>
              <th className="px-4 py-3 font-medium">العميل / الراسل</th>
              <th className="px-4 py-3 font-medium">المرسل إليه والوجهة</th>
              <th className="px-4 py-3 font-medium">الخدمة والدفع</th>
              <th className="px-4 py-3 font-medium">الوزن والقطع</th>
              <th className="px-4 py-3 font-medium">الشحن والتحصيل</th>
              <th className="px-4 py-3 font-medium">الحالة</th>
              <th className="px-4 py-3 font-medium">الإجراء</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {loading ? (
              Array.from({length: 4}).map((_, idx) => (
                <tr key={idx}>
                  <td colSpan={10} className="px-4 py-4">
                    <div className="h-4 w-full animate-pulse rounded bg-slate-100" />
                  </td>
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-6 py-12 text-center text-sm text-slate-500">
                  <p>لا توجد شحنات مطابقة لمعايير العرض الحالية.</p>
                  {can('shipments.create') && (
                    <Link
                      to={`${basePath}/shipments/new`}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
                    >
                      <PackagePlus className="h-3.5 w-3.5" />
                      إنشاء أول شحنة
                    </Link>
                  )}
                </td>
              </tr>
            ) : (
              items.map((shp) => {
                const destGov = govNameMap.get(shp.recipient_governorate_id) ?? '—';
                const destReg = regNameMap.get(shp.recipient_region_id) ?? '—';
                const trackingUrl = shp.tracking_token
                  ? `${window.location.origin}${buildTenantBasePath(tenant.slug)}/track/${shp.tracking_token}`
                  : '';

                return (
                  <tr key={shp.id} className="hover:bg-slate-50/70">
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label={`تحديد ${shp.shipment_number}`}
                        checked={selectedIds.includes(shp.id)}
                        onChange={() => toggleRow(shp.id)}
                        className="h-3.5 w-3.5 rounded border-slate-300"
                      />
                    </td>

                    <td className="px-4 py-3 align-top">
                      <Link
                        to={`${basePath}/shipments/${shp.id}`}
                        className="font-mono-tabular font-semibold text-slate-900 hover:underline"
                      >
                        {shp.shipment_number}
                      </Link>
                      <div className="mt-1 flex items-center gap-1.5 font-mono-tabular text-[11px] text-slate-500">
                        <Barcode className="h-3 w-3 shrink-0" />
                        <span>{shp.barcode_token}</span>
                        <button
                          type="button"
                          title="نسخ الباركود"
                          onClick={() => void handleCopy(shp.id, shp.barcode_token)}
                          className="text-slate-400 hover:text-slate-700"
                        >
                          {copiedId === shp.id ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                        </button>
                      </div>
                      {preset === 'tracking' && trackingUrl && (
                        <button
                          type="button"
                          onClick={() => void handleCopy(`trk-${shp.id}`, trackingUrl)}
                          className="mt-1 text-[11px] font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
                        >
                          {copiedId === `trk-${shp.id}` ? 'تم نسخ رابط التتبع' : 'نسخ رابط التتبع العام'}
                        </button>
                      )}
                    </td>

                    <td className="px-4 py-3 align-top font-mono-tabular text-slate-600 whitespace-nowrap">
                      <div>{shp.pickup_date}</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">{formatDateTime(shp.created_at)}</div>
                    </td>

                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-slate-900">
                        {clientNameMap.get(shp.client_id) ?? 'عميل مسجل'}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {shp.sender_name ?? '—'} · {branchNameMap.get(shp.origin_branch_id) ?? 'الفرع'}
                      </div>
                    </td>

                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-slate-900">{shp.recipient_name ?? '—'}</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {destGov} · {destReg}
                      </div>
                      <div className="mt-0.5 font-mono-tabular text-[11px] text-slate-500">
                        {shp.recipient_mobile ?? '—'}
                      </div>
                    </td>

                    <td className="px-4 py-3 align-top">
                      <div className="text-slate-900">
                        {serviceNameMap.get(shp.service_id) ?? '—'} · {shp.shipment_type_code}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {PAYMENT_TERM_LABELS[shp.payment_term_code]}
                      </div>
                    </td>

                    <td className="px-4 py-3 align-top font-mono-tabular text-slate-700 whitespace-nowrap">
                      <div>{shp.chargeable_weight_kg} كجم</div>
                      <div className="mt-0.5 text-[11px] text-slate-500">{shp.pieces_count} قطعة</div>
                    </td>

                    <td className="px-4 py-3 align-top font-mono-tabular whitespace-nowrap">
                      <div className="font-semibold text-slate-900">
                        تحصيل: {Number(shp.recipient_collect_amount).toFixed(2)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        رسوم: {Number(shp.total_shipping_fee).toFixed(2)} · صافي: {Number(shp.client_net_payout).toFixed(2)}
                      </div>
                    </td>

                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <span className={`font-semibold ${getStatusAccentClass(shp.operational_status)}`}>
                        {SHIPMENT_STATUS_LABELS[shp.operational_status]}
                      </span>
                      <div className="mt-0.5 text-[11px] text-slate-500">
                        {branchNameMap.get(shp.current_branch_id) ?? '—'}
                      </div>
                    </td>

                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(preset === 'out-for-delivery' || preset === 'rescheduled') &&
                          (shp.operational_status === 'out_for_delivery' ||
                            shp.operational_status === 'rescheduled' ||
                            shp.operational_status === 'delivery_failed') &&
                          (can('operations.delivery.execute') || can('operations.pickup.approve')) && (
                            <button
                              type="button"
                              onClick={() => setExecShipment(shp)}
                              className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-800"
                            >
                              تسجيل النتيجة
                            </button>
                          )}
                        <Link
                          to={`${basePath}/shipments/${shp.id}`}
                          className="inline-flex items-center rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        >
                          التفاصيل
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <DeliveryExecutionModal
        open={execShipment !== null}
        tenantId={tenant.id}
        shipment={execShipment}
        requirePod={deliveryPolicy.require_pod_on_delivery}
        maxAttempts={deliveryPolicy.max_delivery_attempts}
        exceptionReasons={exceptionReasons}
        onClose={() => setExecShipment(null)}
        onExecuted={async () => {
          await loadShipments();
        }}
      />
    </div>
  );
}