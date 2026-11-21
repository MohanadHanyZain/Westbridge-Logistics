import {useEffect, useRef, useState, type FormEvent, type PointerEvent} from 'react';
import {recordCourierLocationEvent} from '@/features/couriers/couriersService';
import {recordDeliveryExecution} from '@/features/delivery/deliveryService';
import {getBrowserDeviceFingerprint} from '@/lib/maps';
import {
  DELIVERY_OUTCOME_LABELS,
  RETURN_TYPE_LABELS,
  type DeliveryExecutionOutcome,
  type DeliveryExecutionResult,
  type ProofOfDeliveryMethod,
  type ReturnLiabilityType,
} from '@/types/delivery';
import type {DeliveryExceptionReasonRecord} from '@/types/definitions';
import type {ShipmentListItem} from '@/types/shipments';
import {CheckCircle2, Eraser, LocateFixed, PenTool, ShieldCheck, X} from 'lucide-react';

interface DeliveryExecutionModalProps {
  readonly open: boolean;
  readonly tenantId: string;
  readonly shipment: ShipmentListItem | null;
  readonly deliveryListId?: string | null;
  readonly courierId?: string | null;
  readonly requirePod?: boolean;
  readonly requireGps?: boolean;
  readonly maxAttempts?: number;
  readonly exceptionReasons: readonly DeliveryExceptionReasonRecord[];
  readonly onClose: () => void;
  readonly onExecuted: (result: DeliveryExecutionResult) => Promise<void> | void;
}

export function DeliveryExecutionModal({
  open,
  tenantId,
  shipment,
  deliveryListId = null,
  courierId = null,
  requirePod = false,
  requireGps = false,
  maxAttempts = 3,
  exceptionReasons,
  onClose,
  onExecuted,
}: DeliveryExecutionModalProps) {
  const [outcome, setOutcome] = useState<Exclude<DeliveryExecutionOutcome, 'pending'>>('delivered');
  const [deliveredAmount, setDeliveredAmount] = useState('0');
  const [deliveredPieces, setDeliveredPieces] = useState('1');
  const [exceptionReasonId, setExceptionReasonId] = useState('');
  const [rescheduledDate, setRescheduledDate] = useState('');
  const [returnTypeCode, setReturnTypeCode] = useState<ReturnLiabilityType>('no_charge');
  const [appliedReturnFee, setAppliedReturnFee] = useState('0');
  const [returnCollectedAmount, setReturnCollectedAmount] = useState('0');
  const [podMethod, setPodMethod] = useState<ProofOfDeliveryMethod>('signature');
  const [podRecipientName, setPodRecipientName] = useState('');
  const [podOtpCode, setPodOtpCode] = useState('');
  const [podOtpVerified, setPodOtpVerified] = useState(false);
  const [hasSignatureStroke, setHasSignatureStroke] = useState(false);
  const [notes, setNotes] = useState('');
  const [capturedGps, setCapturedGps] = useState<{lat: number; lng: number; accuracy?: number} | null>(null);
  const [capturingGps, setCapturingGps] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    if (!open || !shipment) return;
    setOutcome('delivered');
    setDeliveredAmount(String(Number(shipment.recipient_collect_amount ?? 0)));
    setDeliveredPieces(String(Math.max(1, Number(shipment.pieces_count ?? 1) - 1)));
    setExceptionReasonId(exceptionReasons[0]?.id ?? '');
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    setRescheduledDate(tomorrow);
    setReturnTypeCode('no_charge');
    setAppliedReturnFee(String(Number(shipment.return_fee ?? 0)));
    setReturnCollectedAmount(String(Number(shipment.total_shipping_fee ?? 0)));
    setPodMethod(requirePod ? 'signature' : 'signature');
    setPodRecipientName(shipment.recipient_name ?? '');
    setPodOtpCode('');
    setPodOtpVerified(false);
    setHasSignatureStroke(false);
    setNotes('');
    setCapturedGps(null);
    setError(null);

    const canvas = canvasRef.current;
    if (canvas) {
      try {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      } catch {
        // Ignore in headless environments without 2D canvas
      }
    }
  }, [open, shipment, exceptionReasons, requirePod]);

  if (!open || !shipment) return null;

  const isDeliverySuccess = outcome === 'delivered' || outcome === 'partially_delivered';
  const isFailureOrReschedule = outcome === 'delivery_failed' || outcome === 'rescheduled';
  const nextAttemptNumber = Number(shipment.delivery_attempts_count ?? 0) + 1;
  const willExceedAttempts = isFailureOrReschedule && nextAttemptNumber >= maxAttempts;
  const canPartialDeliver = Number(shipment.pieces_count ?? 1) >= 2;

  const getCanvasCoords = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return {x: 0, y: 0};
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handlePointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const {x, y} = getCanvasCoords(e);
      drawingRef.current = true;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#0f172a';
      setHasSignatureStroke(true);
    } catch {
      setHasSignatureStroke(true);
    }
  };

  const handlePointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !canvasRef.current) return;
    try {
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;
      const {x, y} = getCanvasCoords(e);
      ctx.lineTo(x, y);
      ctx.stroke();
    } catch {
      // Ignore canvas error
    }
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      } catch {
        // Ignore
      }
    }
    setHasSignatureStroke(false);
  };

  const extractSignatureDataUrl = (): string | null => {
    if (podMethod !== 'signature' || !hasSignatureStroke) return null;
    try {
      return canvasRef.current?.toDataURL('image/png') ?? 'signature:captured';
    } catch {
      return 'signature:captured';
    }
  };

  const handleCaptureGps = async () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('المتصفح الحالي لا يدعم خدمة تحديد الموقع التلقائي.');
      return;
    }
    setCapturingGps(true);
    setError(null);
    try {
      const coords = await new Promise<GeolocationCoordinates>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve(pos.coords),
          (err) => reject(err),
          {enableHighAccuracy: true, timeout: 10000, maximumAge: 15000},
        );
      });
      setCapturedGps({
        lat: Number(coords.latitude.toFixed(6)),
        lng: Number(coords.longitude.toFixed(6)),
        accuracy: Number.isFinite(coords.accuracy) ? Number(coords.accuracy.toFixed(1)) : undefined,
      });
    } catch {
      setError('تعذر الحصول على إحداثيات GPS من المتصفح.');
    } finally {
      setCapturingGps(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (requirePod && isDeliverySuccess) {
      const hasAnyPod =
        podRecipientName.trim().length > 0 ||
        (podMethod === 'signature' && hasSignatureStroke) ||
        (podMethod === 'otp' && podOtpVerified);
      if (!hasAnyPod) {
        setError('سياسة الشركة تتطلب إدخال اسم المستلم أو التوقيع الإلكتروني أو تأكيد OTP قبل التسليم.');
        return;
      }
    }

    if (requireGps && !capturedGps) {
      setError('سياسة الشركة تتطلب توثيق إحداثيات الموقع الميداني (GPS) قبل حفظ نتيجة التوصيل.');
      return;
    }

    if (outcome === 'return_to_sender' && returnTypeCode === 'recipient_paid_fee') {
      const collectedVal = Number(returnCollectedAmount);
      if (!Number.isFinite(collectedVal) || collectedVal <= 0) {
        setError('يرجى إدخال المبلغ المحصل من المستلم عند الباب (أكبر من صفر).');
        return;
      }
    }

    setBusy(true);
    try {
      const res = await recordDeliveryExecution(tenantId, {
        shipment_id: shipment.id,
        delivery_list_id: deliveryListId,
        outcome,
        delivered_amount: isDeliverySuccess ? Number(deliveredAmount || 0) : null,
        delivered_pieces: outcome === 'partially_delivered' ? Number(deliveredPieces || 1) : null,
        exception_reason_id: !isDeliverySuccess && exceptionReasonId ? exceptionReasonId : null,
        rescheduled_for_date: outcome === 'rescheduled' && rescheduledDate ? rescheduledDate : null,
        return_type_code: outcome === 'return_to_sender' ? returnTypeCode : null,
        applied_return_fee:
          outcome === 'return_to_sender' && returnTypeCode === 'sender_partial_fee'
            ? Number(appliedReturnFee || 0)
            : null,
        return_collected_amount:
          outcome === 'return_to_sender' && returnTypeCode === 'recipient_paid_fee'
            ? Number(returnCollectedAmount || 0)
            : null,
        pod_method: isDeliverySuccess ? podMethod : null,
        pod_recipient_name: isDeliverySuccess ? podRecipientName.trim() || null : null,
        pod_signature_data: isDeliverySuccess ? extractSignatureDataUrl() : null,
        pod_otp_verified: isDeliverySuccess && podMethod === 'otp' ? podOtpVerified : false,
        notes: notes.trim() || null,
      });

      if (capturedGps) {
        try {
          await recordCourierLocationEvent(tenantId, {
            courier_id: courierId ?? shipment.assigned_courier_id ?? undefined,
            shipment_id: shipment.id,
            delivery_list_id: deliveryListId,
            event_type: 'delivery_attempt',
            lat: capturedGps.lat,
            lng: capturedGps.lng,
            accuracy_meters: capturedGps.accuracy ?? null,
            source: 'delivery_pod',
            device_fingerprint: getBrowserDeviceFingerprint(),
            notes: `نتيجة التنفيذ: ${DELIVERY_OUTCOME_LABELS[outcome]}`,
          });
        } catch {
          // Non-blocking if location RPC fails after delivery execution
        }
      }

      await onExecuted(res);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ نتيجة التوصيل.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`تسجيل نتيجة التوصيل - ${shipment.shipment_number}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto"
    >
      <div className="my-6 w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">تسجيل نتيجة التوصيل وإثبات الاستلام</h2>
            <p className="mt-1 text-xs text-slate-500">
              <span className="font-mono-tabular font-semibold text-slate-700">{shipment.shipment_number}</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span>{shipment.recipient_name ?? 'مستلم'}</span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span className="font-mono-tabular">
                تحصيل: {Number(shipment.recipient_collect_amount).toFixed(2)} ج.م
              </span>
              <span className="mx-1.5" aria-hidden="true">·</span>
              <span className="font-mono-tabular">
                المحاولات: {shipment.delivery_attempts_count} / {maxAttempts}
              </span>
            </p>
          </div>
          <button
            type="button"
            aria-label="إغلاق نافذة تسجيل النتيجة"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-5 space-y-5">
          {/* Outcome Selector */}
          <div>
            <span className="block text-xs font-medium text-slate-700">نتيجة الزيارة الميدانية</span>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {(
                [
                  'delivered',
                  'partially_delivered',
                  'rescheduled',
                  'delivery_failed',
                  'return_to_sender',
                ] as const
              ).map((opt) => {
                const disabled = opt === 'partially_delivered' && !canPartialDeliver;
                return (
                  <button
                    key={opt}
                    type="button"
                    disabled={disabled}
                    onClick={() => setOutcome(opt)}
                    className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                      outcome === opt
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    } disabled:cursor-not-allowed disabled:opacity-40`}
                  >
                    {DELIVERY_OUTCOME_LABELS[opt]}
                  </button>
                );
              })}
            </div>
            {!canPartialDeliver && (
              <p className="mt-1.5 text-[11px] text-slate-500">
                التسليم الجزئي (PDP) يتطلب شحنة تحتوي على قطعتين فأكثر (القطع الحالية: {shipment.pieces_count}).
              </p>
            )}
          </div>

          {willExceedAttempts && (
            <div
              role="note"
              className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900"
            >
              تنبيه الحد الأقصى للمحاولات: هذه المحاولة ستبلغ الحد المسموح ({maxAttempts} محاولات)، وسيتم تحويل الشحنة
              تلقائيًا إلى <span className="font-semibold">قيد الإرجاع للراسل</span>.
            </div>
          )}

          {/* Success / Partial Delivery Inputs + POD */}
          {isDeliverySuccess && (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="exec-delivered-amount" className="block text-xs font-medium text-slate-700">
                    المبلغ المحصل فعليًا (ج.م)
                  </label>
                  <input
                    id="exec-delivered-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={deliveredAmount}
                    onChange={(e) => setDeliveredAmount(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-tabular text-xs"
                  />
                </div>

                {outcome === 'partially_delivered' && (
                  <div>
                    <label htmlFor="exec-delivered-pieces" className="block text-xs font-medium text-slate-700">
                      عدد القطع المسلمة (من أصل {shipment.pieces_count})
                    </label>
                    <input
                      id="exec-delivered-pieces"
                      type="number"
                      min={1}
                      max={Math.max(1, shipment.pieces_count - 1)}
                      value={deliveredPieces}
                      onChange={(e) => setDeliveredPieces(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-tabular text-xs"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor="exec-pod-recipient" className="block text-xs font-medium text-slate-700">
                    اسم المستلم الفعلي {requirePod ? '*' : '(اختياري)'}
                  </label>
                  <input
                    id="exec-pod-recipient"
                    type="text"
                    value={podRecipientName}
                    onChange={(e) => setPodRecipientName(e.target.value)}
                    placeholder="الاسم الثلاثي للمستلم"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label htmlFor="exec-pod-method" className="block text-xs font-medium text-slate-700">
                    وسيلة إثبات التسليم (POD)
                  </label>
                  <select
                    id="exec-pod-method"
                    value={podMethod}
                    onChange={(e) => setPodMethod(e.target.value as ProofOfDeliveryMethod)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value="signature">توقيع إلكتروني على الشاشة</option>
                    <option value="otp">تأكيد رمز تحقق المستلم (OTP)</option>
                    <option value="none">بدون توقيع رقمي</option>
                  </select>
                </div>
              </div>

              {podMethod === 'signature' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
                      <PenTool className="h-3.5 w-3.5" />
                      لوحة توقيع المستلم
                    </span>
                    <button
                      type="button"
                      onClick={clearSignature}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 hover:text-slate-900"
                    >
                      <Eraser className="h-3 w-3" />
                      مسح التوقيع
                    </button>
                  </div>
                  <canvas
                    ref={canvasRef}
                    width={520}
                    height={120}
                    aria-label="لوحة توقيع المستلم"
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                    className="h-28 w-full touch-none rounded-lg border border-dashed border-slate-300 bg-white cursor-crosshair"
                  />
                </div>
              )}

              {podMethod === 'otp' && (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
                  <ShieldCheck className="h-4 w-4 text-emerald-700 shrink-0" />
                  <input
                    type="text"
                    value={podOtpCode}
                    onChange={(e) => setPodOtpCode(e.target.value)}
                    placeholder="أدخل رمز التسليم من المستلم"
                    aria-label="رمز OTP"
                    className="w-40 rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs"
                  />
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-800">
                    <input
                      type="checkbox"
                      checked={podOtpVerified}
                      onChange={(e) => setPodOtpVerified(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    تأكيد مطابقة الرمز مع المستلم
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Failure / Reschedule / Return Reason & ADR-016 Return Liability */}
          {!isDeliverySuccess && (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="exec-exception-reason" className="block text-xs font-medium text-slate-700">
                    سبب التعذر / التأجيل / الإرجاع *
                  </label>
                  <select
                    id="exec-exception-reason"
                    value={exceptionReasonId}
                    onChange={(e) => setExceptionReasonId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                  >
                    <option value="">اختر السبب...</option>
                    {exceptionReasons.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>

                {outcome === 'rescheduled' && (
                  <div>
                    <label htmlFor="exec-reschedule-date" className="block text-xs font-medium text-slate-700">
                      تاريخ إعادة التوصيل المقترح
                    </label>
                    <input
                      id="exec-reschedule-date"
                      type="date"
                      value={rescheduledDate}
                      onChange={(e) => setRescheduledDate(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-tabular text-xs"
                    />
                  </div>
                )}
              </div>

              {outcome === 'return_to_sender' && (
                <div className="space-y-3 border-t border-slate-200 pt-3">
                  <div>
                    <label htmlFor="exec-return-type" className="block text-xs font-medium text-slate-700">
                      سياسة تحمل رسوم المرتجع
                    </label>
                    <select
                      id="exec-return-type"
                      value={returnTypeCode}
                      onChange={(e) => setReturnTypeCode(e.target.value as ReturnLiabilityType)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                    >
                      {Object.entries(RETURN_TYPE_LABELS).map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {returnTypeCode === 'sender_partial_fee' && (
                    <div>
                      <label htmlFor="exec-applied-return-fee" className="block text-xs font-medium text-slate-700">
                        رسوم المرتجع المحملة على الراسل (ج.م)
                      </label>
                      <input
                        id="exec-applied-return-fee"
                        type="number"
                        min="0"
                        step="0.01"
                        value={appliedReturnFee}
                        onChange={(e) => setAppliedReturnFee(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-tabular text-xs"
                      />
                    </div>
                  )}

                  {returnTypeCode === 'recipient_paid_fee' && (
                    <div>
                      <label htmlFor="exec-return-collected" className="block text-xs font-medium text-slate-700">
                        المبلغ المحصل من المستلم عند الباب — عهدة على المندوب (ج.م) *
                      </label>
                      <input
                        id="exec-return-collected"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={returnCollectedAmount}
                        onChange={(e) => setReturnCollectedAmount(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono-tabular text-xs"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs">
            <div>
              <p className="font-medium text-slate-800">
                توثيق إحداثيات الموقع (GPS) {requireGps ? '*' : '(اختياري)'}
              </p>
              <p className="mt-0.5 font-mono-tabular text-[11px] text-slate-500" dir="ltr">
                {capturedGps
                  ? `${capturedGps.lat.toFixed(5)}, ${capturedGps.lng.toFixed(5)}${
                      capturedGps.accuracy ? ` (±${Math.round(capturedGps.accuracy)}m)` : ''
                    }`
                  : 'لم يتم التقاط موقع بعد'}
              </p>
            </div>
            <button
              type="button"
              disabled={capturingGps}
              onClick={() => void handleCaptureGps()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-60"
            >
              <LocateFixed className="h-3.5 w-3.5" />
              <span>{capturingGps ? 'جاري الالتقاط...' : capturedGps ? 'تحديث الموقع' : 'التقاط الموقع الآن'}</span>
            </button>
          </div>

          <div>
            <label htmlFor="exec-notes" className="block text-xs font-medium text-slate-700">
              ملاحظات التنفيذ
            </label>
            <textarea
              id="exec-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="أي تفاصيل إضافية عن حالة التسليم أو سبب التعذر..."
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
            />
          </div>

          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              إلغاء
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {busy ? 'جاري التسجيل...' : 'حفظ نتيجة التوصيل'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
