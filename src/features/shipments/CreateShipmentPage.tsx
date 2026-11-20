import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import * as clientsService from '@/features/clients/clientsService';
import {
  listBranches,
  listGovernorates,
  listMovementTypes,
  listOperationalRefs,
  listRegions,
  listShipmentTypes,
  listShippingServices,
} from '@/features/definitions/definitionsService';
import {calculateShipmentPrice} from '@/features/pricing/pricingService';
import {createShipment} from '@/features/shipments/shipmentsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import type {
  BranchRecord,
  GovernorateRecord,
  MovementTypeRecord,
  PaymentTermRecord,
  RegionRecord,
  ShipmentTypeRecord,
  ShippingServiceRecord,
} from '@/types/definitions';
import type {ClientAddressRecord, ClientRecord, PriceCalculationBreakdown, PriceMode} from '@/types/pricing';
import {PAYMENT_TERM_LABELS, type PaymentTermCode} from '@/types/shipments';
import {ArrowRight, Calculator, PackageCheck, Save} from 'lucide-react';

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `shp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function CreateShipmentPage() {
  const {tenant, boundClientId, can} = useTenantWorkspace();
  const navigate = useNavigate();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  // Reference data
  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [governorates, setGovernorates] = useState<readonly GovernorateRecord[]>([]);
  const [regions, setRegions] = useState<readonly RegionRecord[]>([]);
  const [movementTypes, setMovementTypes] = useState<readonly MovementTypeRecord[]>([]);
  const [shipmentTypes, setShipmentTypes] = useState<readonly ShipmentTypeRecord[]>([]);
  const [services, setServices] = useState<readonly ShippingServiceRecord[]>([]);
  const [paymentTerms, setPaymentTerms] = useState<readonly PaymentTermRecord[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);

  // Section 1: Shipment Details
  const [originBranchId, setOriginBranchId] = useState('');
  const [movementTypeId, setMovementTypeId] = useState('');
  const [shipmentTypeId, setShipmentTypeId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [packageDescription, setPackageDescription] = useState('');
  const [actualWeightKg, setActualWeightKg] = useState('1');
  const [lengthCm, setLengthCm] = useState('0');
  const [widthCm, setWidthCm] = useState('0');
  const [heightCm, setHeightCm] = useState('0');
  const [piecesCount, setPiecesCount] = useState('1');
  const [paymentTermId, setPaymentTermId] = useState('');
  const [prepaidBalanceAmount, setPrepaidBalanceAmount] = useState('0');
  const [priceMode, setPriceMode] = useState<PriceMode>('shipping_excluded');
  const [externalReference, setExternalReference] = useState('');
  const [allowPackageOpening, setAllowPackageOpening] = useState(false);
  const [pickupDate, setPickupDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [exchangeItemDescription, setExchangeItemDescription] = useState('');

  // Optional admin override (ADR-010)
  const [overrideTotalFee, setOverrideTotalFee] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  // Section 2: Sender
  const [clientId, setClientId] = useState(boundClientId ?? '');
  const [savedAddresses, setSavedAddresses] = useState<readonly ClientAddressRecord[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [senderName, setSenderName] = useState('');
  const [senderGovId, setSenderGovId] = useState('');
  const [senderRegionId, setSenderRegionId] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [senderMobile, setSenderMobile] = useState('');
  const [senderAddress, setSenderAddress] = useState('');

  // Section 3: Recipient
  const [recipientName, setRecipientName] = useState('');
  const [recipientGovId, setRecipientGovId] = useState('');
  const [recipientRegionId, setRecipientRegionId] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [recipientMobile, setRecipientMobile] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');

  // Live Pricing Preview & Submit State
  const [pricingBreakdown, setPricingBreakdown] = useState<PriceCalculationBreakdown | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);
  const [calculatingPrice, setCalculatingPrice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [idempotencyKey] = useState<string>(() => newIdempotencyKey());

  const applyClientDefaults = useCallback(
    (selected: ClientRecord, fallbackBranchId: string) => {
      setClientId(selected.id);
      setSenderName(selected.name);
      setSenderGovId(selected.governorate_id);
      setSenderRegionId(selected.region_id);
      setSenderPhone(selected.phone ?? '');
      setSenderMobile(selected.mobile ?? '');
      setSenderAddress(selected.address_line ?? '');
      setOriginBranchId(selected.branch_id ?? fallbackBranchId);
      setPriceMode(selected.default_price_mode);
      setAllowPackageOpening(selected.allow_package_opening);
      if (selected.default_payment_term_id) setPaymentTermId(selected.default_payment_term_id);
      if (selected.default_shipment_type_id) setShipmentTypeId(selected.default_shipment_type_id);
    },
    [],
  );

  useEffect(() => {
    let active = true;
    setLoadingRefs(true);
    Promise.all([
      clientsService.listClients(tenant.id),
      listBranches(tenant.id),
      listGovernorates(tenant.id),
      listRegions(tenant.id),
      listMovementTypes(tenant.id),
      listShipmentTypes(tenant.id),
      listShippingServices(tenant.id),
      listOperationalRefs(tenant.id),
    ])
      .then(([cl, br, gov, reg, mov, shpTypes, srv, opRefs]) => {
        if (!active) return;
        const activeClients = cl.filter((c) => c.is_active);
        const activeBranches = br.filter((b) => b.is_active);
        const activeGovs = gov.filter((g) => g.is_active);
        const activeRegs = reg.filter((r) => r.is_active);
        const activeServices = srv.filter((s) => s.is_active);
        const activeTerms = opRefs.paymentTerms.filter((t) => t.is_active);
        const activeTypes = shpTypes.filter((t) => t.is_active);
        const activeMovs = mov.filter((m) => m.is_active);

        setClients(activeClients);
        setBranches(activeBranches);
        setGovernorates(activeGovs);
        setRegions(activeRegs);
        setMovementTypes(activeMovs);
        setShipmentTypes(activeTypes);
        setServices(activeServices);
        setPaymentTerms(activeTerms);

        const defaultBranchId = activeBranches.find((b) => b.is_main)?.id ?? activeBranches[0]?.id ?? '';
        setOriginBranchId((curr) => curr || defaultBranchId);

        const defaultMov = activeMovs.find((m) => m.code === 'MOV-001') ?? activeMovs[0];
        if (defaultMov) setMovementTypeId((curr) => curr || defaultMov.id);

        const defaultType = activeTypes.find((t) => t.code === 'FDP') ?? activeTypes[0];
        if (defaultType) setShipmentTypeId((curr) => curr || defaultType.id);

        const defaultService = activeServices[0];
        if (defaultService) setServiceId((curr) => curr || defaultService.id);

        const defaultTerm = activeTerms.find((t) => t.code === 'COD') ?? activeTerms[0];
        if (defaultTerm) setPaymentTermId((curr) => curr || defaultTerm.id);

        if (activeGovs[0]) {
          setRecipientGovId((curr) => curr || activeGovs[0].id);
          const firstReg = activeRegs.find((r) => r.governorate_id === activeGovs[0].id);
          if (firstReg) setRecipientRegionId((curr) => curr || firstReg.id);
        }

        const targetClient = boundClientId
          ? activeClients.find((c) => c.id === boundClientId)
          : activeClients[0];
        if (targetClient) {
          applyClientDefaults(targetClient, defaultBranchId);
        } else if (activeGovs[0]) {
          setSenderGovId(activeGovs[0].id);
          const firstSenderReg = activeRegs.find((r) => r.governorate_id === activeGovs[0].id);
          if (firstSenderReg) setSenderRegionId(firstSenderReg.id);
        }
      })
      .finally(() => {
        if (active) setLoadingRefs(false);
      });

    return () => {
      active = false;
    };
  }, [tenant.id, boundClientId, applyClientDefaults]);

  useEffect(() => {
    if (!clientId || typeof clientsService.listClientAddresses !== 'function') {
      setSavedAddresses([]);
      setSelectedAddressId('');
      return;
    }
    let active = true;
    clientsService
      .listClientAddresses(tenant.id, clientId)
      .then((rows) => {
        if (active) {
          setSavedAddresses(rows);
          setSelectedAddressId('');
        }
      })
      .catch(() => {
        if (active) setSavedAddresses([]);
      });
    return () => {
      active = false;
    };
  }, [tenant.id, clientId]);

  const selectedPaymentTerm = useMemo(
    () => paymentTerms.find((t) => t.id === paymentTermId),
    [paymentTerms, paymentTermId],
  );
  const paymentTermCode = (selectedPaymentTerm?.code ?? 'COD') as PaymentTermCode;
  const showBalanceField = paymentTermCode === 'COD' || paymentTermCode === 'PREPAID';

  const selectedShipmentType = useMemo(
    () => shipmentTypes.find((t) => t.id === shipmentTypeId),
    [shipmentTypes, shipmentTypeId],
  );
  const isPtpOrder = selectedShipmentType?.code === 'PTP';
  const isPdpOrder = selectedShipmentType?.code === 'PDP';

  const senderRegions = useMemo(
    () => regions.filter((r) => r.governorate_id === senderGovId),
    [regions, senderGovId],
  );
  const recipientRegions = useMemo(
    () => regions.filter((r) => r.governorate_id === recipientGovId),
    [regions, recipientGovId],
  );

  // Live server-side price preview whenever pricing inputs change
  useEffect(() => {
    if (!clientId || !serviceId || !senderGovId || !recipientGovId) {
      setPricingBreakdown(null);
      return;
    }

    const timer = setTimeout(() => {
      let cancelled = false;
      setCalculatingPrice(true);
      setPricingError(null);

      const enteredForEngine = paymentTermCode === 'COD' ? Math.max(0, Number(prepaidBalanceAmount) || 0) : 0;
      const overrideVal = overrideTotalFee.trim() !== '' ? Number(overrideTotalFee) : null;

      void calculateShipmentPrice({
        tenantId: tenant.id,
        clientId,
        serviceId,
        pickupGovernorateId: senderGovId,
        pickupRegionId: senderRegionId || null,
        deliveryGovernorateId: recipientGovId,
        deliveryRegionId: recipientRegionId || null,
        actualWeightKg: Math.max(0, Number(actualWeightKg) || 0),
        lengthCm: Math.max(0, Number(lengthCm) || 0),
        widthCm: Math.max(0, Number(widthCm) || 0),
        heightCm: Math.max(0, Number(heightCm) || 0),
        enteredAmount: enteredForEngine,
        priceMode,
        overrideTotalFee: overrideVal,
        overrideReason: overrideVal !== null ? overrideReason : null,
        persistSnapshot: false,
      })
        .then((res) => {
          if (!cancelled) setPricingBreakdown(res);
        })
        .catch((err) => {
          if (!cancelled) {
            setPricingBreakdown(null);
            setPricingError(err instanceof Error ? err.message : 'تعذر احتساب سعر المسار الحالي.');
          }
        })
        .finally(() => {
          if (!cancelled) setCalculatingPrice(false);
        });

      return () => {
        cancelled = true;
      };
    }, 200);

    return () => clearTimeout(timer);
  }, [
    tenant.id,
    clientId,
    serviceId,
    senderGovId,
    senderRegionId,
    recipientGovId,
    recipientRegionId,
    actualWeightKg,
    lengthCm,
    widthCm,
    heightCm,
    prepaidBalanceAmount,
    priceMode,
    paymentTermCode,
    overrideTotalFee,
    overrideReason,
  ]);

  // Effective ADR-013 display summary derived cleanly from server breakdown + selected payment term
  const effectiveSummary = useMemo(() => {
    if (!pricingBreakdown) return null;
    const fee = Number(pricingBreakdown.total_shipping_fee);
    if (paymentTermCode === 'COD') {
      return {
        collect: Number(pricingBreakdown.recipient_collect_amount),
        payout: Number(pricingBreakdown.client_net_payout),
        note: 'عهدة نقدية على المندوب عند التحصيل + استحقاق صافي للتاجر.',
      };
    }
    if (paymentTermCode === 'PREPAID') {
      return {
        collect: 0,
        payout: 0,
        note: 'تُخصم رسوم الشحن من الرصيد المدفوع مسبقًا دون تحصيل من المستلم.',
      };
    }
    if (paymentTermCode === 'POSTPAID') {
      return {
        collect: 0,
        payout: Number((0 - fee).toFixed(2)),
        note: 'تُقيّد رسوم الشحن ذمةً آجلة على حساب تسوية العميل دون تحصيل من المستلم.',
      };
    }
    return {
      collect: 0,
      payout: 0,
      note: 'سداد نقدي فوري لرسوم الشحن عند الإنشاء بالفرع دون تحصيل من المستلم.',
    };
  }, [pricingBreakdown, paymentTermCode]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!clientId || !originBranchId || !serviceId || !shipmentTypeId || !paymentTermId) {
      setSubmitError('يرجى استكمال بيانات العميل والفرع والخدمة ونوع الطلب ونوع الدفع.');
      return;
    }

    if (isPtpOrder && exchangeItemDescription.trim().length < 2) {
      setSubmitError('يرجى إدخال وصف طرد الاستبدال المرتجع عند اختيار طلب استبدال (PTP).');
      return;
    }

    setSubmitting(true);
    try {
      const result = await createShipment(tenant.id, idempotencyKey, {
        client_id: clientId,
        origin_branch_id: originBranchId,
        movement_type_id: movementTypeId || null,
        shipment_type_id: shipmentTypeId,
        service_id: serviceId,
        payment_term_id: paymentTermId,
        price_mode: priceMode,
        actual_weight_kg: Math.max(0, Number(actualWeightKg) || 1),
        length_cm: Math.max(0, Number(lengthCm) || 0),
        width_cm: Math.max(0, Number(widthCm) || 0),
        height_cm: Math.max(0, Number(heightCm) || 0),
        pieces_count: Math.max(1, Math.trunc(Number(piecesCount) || 1)),
        prepaid_balance_amount: showBalanceField ? Math.max(0, Number(prepaidBalanceAmount) || 0) : 0,
        package_description: packageDescription.trim() || null,
        external_reference: externalReference.trim() || null,
        allow_package_opening: allowPackageOpening,
        notes: notes.trim() || null,
        pickup_date: pickupDate,
        exchange_item_description: isPtpOrder ? exchangeItemDescription.trim() : null,
        sender_name: senderName.trim(),
        sender_governorate_id: senderGovId,
        sender_region_id: senderRegionId,
        sender_phone: senderPhone.trim() || null,
        sender_mobile: senderMobile.trim(),
        sender_address_line: senderAddress.trim(),
        recipient_name: recipientName.trim(),
        recipient_governorate_id: recipientGovId,
        recipient_region_id: recipientRegionId,
        recipient_phone: recipientPhone.trim() || null,
        recipient_mobile: recipientMobile.trim(),
        recipient_address_line: recipientAddress.trim(),
        override_total_fee: overrideTotalFee.trim() !== '' ? Number(overrideTotalFee) : null,
        override_reason: overrideTotalFee.trim() !== '' ? overrideReason.trim() : null,
      });

      navigate(`${basePath}/shipments/${result.shipment_id}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'تعذر إنشاء الشحنة.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingRefs) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
        جاري تحميل بيانات العملاء والفروع وقوائم التسعير...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            to={`${basePath}/shipments`}
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-900"
          >
            <ArrowRight className="h-3.5 w-3.5" />
            العودة لقائمة الشحنات
          </Link>
          <h1 className="mt-1 text-xl font-bold text-slate-900">إنشاء شحنة جديدة</h1>
          <p className="mt-1 text-sm text-slate-600">
            إصدار بوليصة شحن بباركود غير قابل للتخمين مع احتساب خادمي فوري للتكلفة ولقطة سعر غير قابلة للتعديل.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Main 3 Form Sections */}
        <div className="space-y-6 lg:col-span-8">
          {/* Section 1: Shipment Details */}
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">01. تفاصيل الشحنة والتسعير</h2>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-slate-700">رقم الشحنة</label>
                <input
                  type="text"
                  readOnly
                  value="يُولّد تلقائيًا عند الحفظ"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500"
                />
              </div>

              <div>
                <label htmlFor="shp-origin-branch" className="block text-xs font-medium text-slate-700">
                  فرع المنشأ
                </label>
                <select
                  id="shp-origin-branch"
                  value={originBranchId}
                  onChange={(e) => setOriginBranchId(e.target.value)}
                  required
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
                <label htmlFor="shp-movement-type" className="block text-xs font-medium text-slate-700">
                  نوع الحركة
                </label>
                <select
                  id="shp-movement-type"
                  value={movementTypeId}
                  onChange={(e) => setMovementTypeId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  {movementTypes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="shp-type" className="block text-xs font-medium text-slate-700">
                  نوع الطلب
                </label>
                <select
                  id="shp-type"
                  value={shipmentTypeId}
                  onChange={(e) => setShipmentTypeId(e.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  {shipmentTypes.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.code})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="shp-service" className="block text-xs font-medium text-slate-700">
                  الخدمة
                </label>
                <select
                  id="shp-service"
                  value={serviceId}
                  onChange={(e) => setServiceId(e.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.estimated_days_min}–{s.estimated_days_max} أيام)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="shp-pickup-date" className="block text-xs font-medium text-slate-700">
                  تاريخ الالتقاط
                </label>
                <input
                  id="shp-pickup-date"
                  type="date"
                  value={pickupDate}
                  onChange={(e) => setPickupDate(e.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label htmlFor="shp-desc" className="block text-xs font-medium text-slate-700">
                  وصف الطرد
                </label>
                <input
                  id="shp-desc"
                  type="text"
                  value={packageDescription}
                  onChange={(e) => setPackageDescription(e.target.value)}
                  placeholder="مثال: ملابس قطنية - 3 قطع"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label htmlFor="shp-weight" className="block text-xs font-medium text-slate-700">
                  الوزن الفعلي (كجم)
                </label>
                <input
                  id="shp-weight"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={actualWeightKg}
                  onChange={(e) => setActualWeightKg(e.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>

              <div>
                <label htmlFor="shp-pieces" className="block text-xs font-medium text-slate-700">
                  عدد القطع
                </label>
                <input
                  id="shp-pieces"
                  type="number"
                  min="1"
                  step="1"
                  value={piecesCount}
                  onChange={(e) => setPiecesCount(e.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label htmlFor="shp-len" className="block text-[11px] font-medium text-slate-700">
                    طول (سم)
                  </label>
                  <input
                    id="shp-len"
                    type="number"
                    min="0"
                    step="1"
                    value={lengthCm}
                    onChange={(e) => setLengthCm(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 font-mono-tabular text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="shp-wid" className="block text-[11px] font-medium text-slate-700">
                    عرض (سم)
                  </label>
                  <input
                    id="shp-wid"
                    type="number"
                    min="0"
                    step="1"
                    value={widthCm}
                    onChange={(e) => setWidthCm(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 font-mono-tabular text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="shp-hei" className="block text-[11px] font-medium text-slate-700">
                    ارتفاع (سم)
                  </label>
                  <input
                    id="shp-hei"
                    type="number"
                    min="0"
                    step="1"
                    value={heightCm}
                    onChange={(e) => setHeightCm(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 font-mono-tabular text-xs"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="shp-payment-term" className="block text-xs font-medium text-slate-700">
                  نوع الدفع
                </label>
                <select
                  id="shp-payment-term"
                  value={paymentTermId}
                  onChange={(e) => setPaymentTermId(e.target.value)}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  {paymentTerms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {PAYMENT_TERM_LABELS[t.code as PaymentTermCode] ?? t.name}
                    </option>
                  ))}
                </select>
              </div>

              {showBalanceField && (
                <div>
                  <label htmlFor="shp-balance" className="block text-xs font-medium text-slate-700">
                    قيمة الرصيد / المبلغ (ج.م)
                  </label>
                  <input
                    id="shp-balance"
                    type="number"
                    min="0"
                    step="0.01"
                    value={prepaidBalanceAmount}
                    onChange={(e) => setPrepaidBalanceAmount(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                  />
                </div>
              )}

              <div>
                <label htmlFor="shp-price-mode" className="block text-xs font-medium text-slate-700">
                  نوع السعر
                </label>
                <select
                  id="shp-price-mode"
                  value={priceMode}
                  onChange={(e) => setPriceMode(e.target.value as PriceMode)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  <option value="shipping_excluded">غير شامل مصاريف الشحن (يُضاف على المستلم)</option>
                  <option value="shipping_included">شامل مصاريف الشحن (يُخصم من الإجمالي للتاجر)</option>
                </select>
              </div>

              <div>
                <label htmlFor="shp-ref" className="block text-xs font-medium text-slate-700">
                  الرقم المرجعي
                </label>
                <input
                  id="shp-ref"
                  type="text"
                  value={externalReference}
                  onChange={(e) => setExternalReference(e.target.value)}
                  placeholder="رقم طلب المتجر أو الفاتورة"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>

              <div>
                <label htmlFor="shp-open" className="block text-xs font-medium text-slate-700">
                  إمكانية فتح الطرد
                </label>
                <select
                  id="shp-open"
                  value={allowPackageOpening ? 'allowed' : 'forbidden'}
                  onChange={(e) => setAllowPackageOpening(e.target.value === 'allowed')}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  <option value="forbidden">غير مسموح</option>
                  <option value="allowed">مسموح</option>
                </select>
              </div>

              <div className="sm:col-span-2 lg:col-span-3">
                <label htmlFor="shp-notes" className="block text-xs font-medium text-slate-700">
                  ملاحظات الشحنة
                </label>
                <textarea
                  id="shp-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
            </div>

            {isPtpOrder && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 p-4">
                <label htmlFor="shp-exchange-desc" className="block text-xs font-semibold text-amber-900">
                  وصف طرد الاستبدال المرتجع (إلزامي لطلبات PTP · ADR-014)
                </label>
                <input
                  id="shp-exchange-desc"
                  type="text"
                  required
                  value={exchangeItemDescription}
                  onChange={(e) => setExchangeItemDescription(e.target.value)}
                  placeholder="مثال: استلام حذاء مقاس 42 مرتجع من المستلم وتسليمه للراسل"
                  className="mt-1.5 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs"
                />
              </div>
            )}

            {isPdpOrder && (
              <p className="mt-3 text-xs text-slate-600">
                طلب تسليم جزئي (PDP): يُعالج التسليم الجزئي عند التنفيذ على نفس الشحنة بتحديد عدد القطع المسلمة والباقي المرتجع (ADR-014).
              </p>
            )}

            {can('pricing.override') && (
              <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="shp-override-fee" className="block text-xs font-medium text-slate-700">
                    تعديل يدوي لإجمالي الشحن (صلاحية إدارية · ADR-010)
                  </label>
                  <input
                    id="shp-override-fee"
                    type="number"
                    min="0"
                    step="0.01"
                    value={overrideTotalFee}
                    onChange={(e) => setOverrideTotalFee(e.target.value)}
                    placeholder="اتركه فارغًا للتسعير التلقائي"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                  />
                </div>
                <div>
                  <label htmlFor="shp-override-reason" className="block text-xs font-medium text-slate-700">
                    سبب التعديل اليدوي للسعر
                  </label>
                  <input
                    id="shp-override-reason"
                    type="text"
                    required={overrideTotalFee.trim() !== ''}
                    value={overrideReason}
                    onChange={(e) => setOverrideReason(e.target.value)}
                    placeholder="إلزامي عند إدخال سعر يدوي"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>
              </div>
            )}
          </section>

          {/* Section 2: Sender Data */}
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">02. بيانات الراسل</h2>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label htmlFor="shp-client" className="block text-xs font-medium text-slate-700">
                  العميل المسجل (تعبئة تلقائية لبيانات الراسل)
                </label>
                <select
                  id="shp-client"
                  value={clientId}
                  disabled={Boolean(boundClientId)}
                  onChange={(e) => {
                    const selected = clients.find((c) => c.id === e.target.value);
                    if (selected) applyClientDefaults(selected, originBranchId);
                    else setClientId(e.target.value);
                  }}
                  required
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50"
                >
                  <option value="">اختر العميل...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {savedAddresses.length > 0 && (
                <div className="sm:col-span-2">
                  <label htmlFor="shp-saved-address" className="block text-xs font-medium text-slate-700">
                    اختيار من عناوين الالتقاط المحفوظة
                  </label>
                  <select
                    id="shp-saved-address"
                    value={selectedAddressId}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSelectedAddressId(val);
                      const found = savedAddresses.find((a) => a.id === val);
                      if (found) {
                        setSenderGovId(found.governorate_id);
                        if (found.region_id) setSenderRegionId(found.region_id);
                        setSenderAddress(found.address_line);
                        if (found.phone) setSenderMobile(found.phone);
                      }
                    }}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value="">العنوان الرئيسي المسجل بالملف</option>
                    {savedAddresses.map((addr) => (
                      <option key={addr.id} value={addr.id}>
                        {addr.label} — {addr.address_line}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="shp-sender-name" className="block text-xs font-medium text-slate-700">
                  اسم الراسل
                </label>
                <input
                  id="shp-sender-name"
                  type="text"
                  required
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label htmlFor="shp-sender-gov" className="block text-xs font-medium text-slate-700">
                  محافظة / إقليم الراسل
                </label>
                <select
                  id="shp-sender-gov"
                  required
                  value={senderGovId}
                  onChange={(e) => {
                    const govId = e.target.value;
                    setSenderGovId(govId);
                    const firstReg = regions.find((r) => r.governorate_id === govId);
                    setSenderRegionId(firstReg?.id ?? '');
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  {governorates.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="shp-sender-reg" className="block text-xs font-medium text-slate-700">
                  منطقة الراسل
                </label>
                <select
                  id="shp-sender-reg"
                  required
                  value={senderRegionId}
                  onChange={(e) => setSenderRegionId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  {senderRegions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="shp-sender-mobile" className="block text-xs font-medium text-slate-700">
                  موبايل الراسل
                </label>
                <input
                  id="shp-sender-mobile"
                  type="text"
                  required
                  value={senderMobile}
                  onChange={(e) => setSenderMobile(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>

              <div>
                <label htmlFor="shp-sender-phone" className="block text-xs font-medium text-slate-700">
                  تليفون الراسل (اختياري)
                </label>
                <input
                  id="shp-sender-phone"
                  type="text"
                  value={senderPhone}
                  onChange={(e) => setSenderPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="shp-sender-address" className="block text-xs font-medium text-slate-700">
                  عنوان الراسل بالتفصيل
                </label>
                <input
                  id="shp-sender-address"
                  type="text"
                  required
                  value={senderAddress}
                  onChange={(e) => setSenderAddress(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
            </div>
          </section>

          {/* Section 3: Recipient Data */}
          <section className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">03. بيانات المرسل إليه</h2>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="shp-rec-name" className="block text-xs font-medium text-slate-700">
                  اسم المرسل إليه
                </label>
                <input
                  id="shp-rec-name"
                  type="text"
                  required
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>

              <div>
                <label htmlFor="shp-rec-gov" className="block text-xs font-medium text-slate-700">
                  محافظة / إقليم المرسل إليه
                </label>
                <select
                  id="shp-rec-gov"
                  required
                  value={recipientGovId}
                  onChange={(e) => {
                    const govId = e.target.value;
                    setRecipientGovId(govId);
                    const firstReg = regions.find((r) => r.governorate_id === govId);
                    setRecipientRegionId(firstReg?.id ?? '');
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  {governorates.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="shp-rec-reg" className="block text-xs font-medium text-slate-700">
                  منطقة المرسل إليه
                </label>
                <select
                  id="shp-rec-reg"
                  required
                  value={recipientRegionId}
                  onChange={(e) => setRecipientRegionId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  {recipientRegions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="shp-rec-mobile" className="block text-xs font-medium text-slate-700">
                  موبايل المرسل إليه
                </label>
                <input
                  id="shp-rec-mobile"
                  type="text"
                  required
                  value={recipientMobile}
                  onChange={(e) => setRecipientMobile(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>

              <div>
                <label htmlFor="shp-rec-phone" className="block text-xs font-medium text-slate-700">
                  تليفون المرسل إليه (اختياري)
                </label>
                <input
                  id="shp-rec-phone"
                  type="text"
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                />
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="shp-rec-address" className="block text-xs font-medium text-slate-700">
                  عنوان المرسل إليه بالتفصيل
                </label>
                <input
                  id="shp-rec-address"
                  type="text"
                  required
                  value={recipientAddress}
                  onChange={(e) => setRecipientAddress(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
            </div>
          </section>
        </div>

        {/* Sticky Authoritative Live Pricing Summary Panel */}
        <aside className="space-y-4 lg:col-span-4">
          <div className="sticky top-6 rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Calculator className="h-4 w-4 text-slate-700" />
                <h2 className="text-sm font-semibold text-slate-900">ملخص التسعير الخادمي الفوري</h2>
              </div>
              {calculatingPrice && <span className="text-[11px] text-slate-500">جاري الاحتساب...</span>}
            </div>

            {pricingError && (
              <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {pricingError}
              </div>
            )}

            {pricingBreakdown && effectiveSummary ? (
              <dl className="mt-4 space-y-2.5 text-xs">
                <div className="flex justify-between text-slate-600">
                  <dt>الوزن المفوتر (الحجمي {pricingBreakdown.volumetric_weight_kg})</dt>
                  <dd className="font-mono-tabular font-semibold text-slate-900">
                    {pricingBreakdown.chargeable_weight_kg} كجم
                  </dd>
                </div>
                <div className="flex justify-between text-slate-600">
                  <dt>سعر التوصيل الأساسي</dt>
                  <dd className="font-mono-tabular">{Number(pricingBreakdown.base_delivery_fee).toFixed(2)} ج.م</dd>
                </div>
                <div className="flex justify-between text-slate-600">
                  <dt>سعر الوزن الإضافي</dt>
                  <dd className="font-mono-tabular">{Number(pricingBreakdown.extra_weight_fee).toFixed(2)} ج.م</dd>
                </div>
                <div className="flex justify-between text-slate-600">
                  <dt>عمولة التحصيل</dt>
                  <dd className="font-mono-tabular">{Number(pricingBreakdown.collection_fee).toFixed(2)} ج.م</dd>
                </div>
                <div className="flex justify-between text-slate-600">
                  <dt>الإضافات / الإعفاءات</dt>
                  <dd className="font-mono-tabular">
                    +{Number(pricingBreakdown.surcharges_total).toFixed(2)} / -{Number(pricingBreakdown.exemptions_total).toFixed(2)}
                  </dd>
                </div>
                <div className="flex justify-between text-slate-600">
                  <dt>الضريبة ({pricingBreakdown.tax_rate_percent}%)</dt>
                  <dd className="font-mono-tabular">{Number(pricingBreakdown.tax_amount).toFixed(2)} ج.م</dd>
                </div>
                <div className="flex justify-between text-slate-600">
                  <dt>رسوم الإرجاع المتوقعة</dt>
                  <dd className="font-mono-tabular">{Number(pricingBreakdown.return_fee).toFixed(2)} ج.م</dd>
                </div>

                <div className="border-t border-slate-200 pt-3">
                  <div className="flex justify-between text-sm font-bold text-slate-900">
                    <dt>إجمالي مصاريف الشحن</dt>
                    <dd className="font-mono-tabular">{Number(pricingBreakdown.total_shipping_fee).toFixed(2)} ج.م</dd>
                  </div>
                  <div className="mt-2 flex justify-between text-sm font-bold text-slate-900">
                    <dt>المطلوب تحصيله من المستلم</dt>
                    <dd className="font-mono-tabular">{effectiveSummary.collect.toFixed(2)} ج.م</dd>
                  </div>
                  <div className="mt-2 flex justify-between text-sm font-semibold text-emerald-700">
                    <dt>صافي مستحق / أثر التاجر</dt>
                    <dd className="font-mono-tabular">{effectiveSummary.payout.toFixed(2)} ج.م</dd>
                  </div>
                </div>

                <p className="border-t border-slate-100 pt-3 text-[11px] leading-relaxed text-slate-500">
                  {effectiveSummary.note}
                </p>
              </dl>
            ) : (
              !pricingError && (
                <p className="mt-4 text-xs text-slate-500">
                  اختر العميل والخدمة ومسار الالتقاط والتسليم لعرض الحساب التفصيلي من الخادم.
                </p>
              )
            )}

            {submitError && (
              <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {submitError}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {submitting ? (
                'جاري إصدار البوليصة...'
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  إنشاء وحفظ الشحنة
                </>
              )}
            </button>

            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
              <PackageCheck className="h-3.5 w-3.5 shrink-0" />
              <span>يتم تثبيت لقطة السعر وتوليد الباركود تلقائيًا داخل معاملة ذرية.</span>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}
