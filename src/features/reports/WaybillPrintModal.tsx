import {useMemo, useState} from 'react';
import {buildBarcodeBars} from '@/features/reports/exportUtils';
import {recordExportJob} from '@/features/reports/reportsService';
import {
  PAYMENT_TERM_LABELS,
  type PaymentTermCode,
} from '@/types/shipments';
import {
  WAYBILL_LAYOUT_OPTIONS,
  type PrintableWaybillItem,
  type WaybillPrintLayout,
} from '@/types/reports';
import {Printer, X} from 'lucide-react';

interface WaybillPrintModalProps {
  readonly open: boolean;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantCode: string;
  readonly items: readonly PrintableWaybillItem[];
  readonly onClose: () => void;
}

interface RenderSlot {
  readonly key: string;
  readonly copyLabel?: string;
  readonly item: PrintableWaybillItem;
}

function SvgBarcode({token, compact = false}: {readonly token: string; readonly compact?: boolean}) {
  const {bars, totalWidth} = useMemo(() => buildBarcodeBars(token), [token]);
  const height = compact ? 36 : 48;

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox={`0 0 ${totalWidth} ${height}`}
        className={compact ? 'h-9 w-full max-w-[200px]' : 'h-12 w-full max-w-[250px]'}
        role="img"
        aria-label={`باركود ${token}`}
        preserveAspectRatio="none"
      >
        <rect x={0} y={0} width={totalWidth} height={height} fill="#ffffff" />
        {bars.map((bar, idx) => (
          <rect key={idx} x={bar.x} y={0} width={bar.width} height={height} fill="#0f172a" />
        ))}
      </svg>
      <span className="mt-1 font-mono-tabular text-[11px] font-semibold tracking-wider text-slate-900">
        {token}
      </span>
    </div>
  );
}

function WaybillCard({
  item,
  tenantName,
  tenantCode,
  copyLabel,
  layout,
}: {
  readonly item: PrintableWaybillItem;
  readonly tenantName: string;
  readonly tenantCode: string;
  readonly copyLabel?: string;
  readonly layout: WaybillPrintLayout;
}) {
  const isThermal = layout === 'barcode_label_thermal';
  const isDense = layout === 'three_shipments' || layout === 'three_copies_same';
  const paymentLabel =
    PAYMENT_TERM_LABELS[item.payment_term_code as PaymentTermCode] ?? item.payment_term_code;

  if (isThermal) {
    return (
      <article className="mx-auto w-full max-w-[380px] rounded-lg border border-slate-900 bg-white p-3.5 text-slate-900 break-inside-avoid">
        <div className="flex items-start justify-between border-b border-slate-300 pb-2">
          <div>
            <p className="text-xs font-bold">{tenantName}</p>
            <p className="font-mono-tabular text-[10px] text-slate-500">
              {tenantCode} · {item.pickup_date}
            </p>
          </div>
          <div className="text-left">
            <p className="font-mono-tabular text-xs font-bold">{item.shipment_number}</p>
            <p className="text-[10px] font-semibold text-slate-700">
              {item.service_name} · {item.shipment_type_code}
            </p>
          </div>
        </div>

        <div className="my-2.5 flex justify-center border-b border-slate-200 pb-2.5">
          <SvgBarcode token={item.barcode_token} compact />
        </div>

        <div className="space-y-1.5 text-xs">
          <div>
            <p className="text-[10px] font-medium text-slate-500">الراسل / العميل</p>
            <p className="font-semibold">
              {item.client_name} ({item.sender_name})
            </p>
          </div>
          <div className="border-t border-slate-200 pt-1.5">
            <p className="text-[10px] font-medium text-slate-500">المستلم والوجهة</p>
            <p className="font-bold">{item.recipient_name}</p>
            <p className="font-mono-tabular text-[11px]">{item.recipient_mobile}</p>
            <p className="text-[11px] text-slate-700">
              {item.destination_gov_name} · {item.destination_reg_name}
            </p>
            <p className="text-[11px] text-slate-700">{item.recipient_address}</p>
          </div>
        </div>

        <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-slate-900 pt-2 text-center font-mono-tabular text-[11px]">
          <div>
            <span className="block text-[10px] text-slate-500">الوزن / القطع</span>
            <strong>
              {item.chargeable_weight_kg} كجم · {item.pieces_count} ق
            </strong>
          </div>
          <div>
            <span className="block text-[10px] text-slate-500">الدفع</span>
            <strong>{item.payment_term_code}</strong>
          </div>
          <div>
            <span className="block text-[10px] text-slate-500">التحصيل</span>
            <strong>{Number(item.recipient_collect_amount).toFixed(2)}</strong>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className={`rounded-lg border border-slate-300 bg-white text-slate-900 break-inside-avoid ${
        isDense ? 'p-3' : 'p-4'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-2.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-900">{tenantName}</span>
            {copyLabel && (
              <span className="font-mono-tabular text-[11px] font-semibold text-slate-600">
                · {copyLabel}
              </span>
            )}
          </div>
          <p className="mt-0.5 font-mono-tabular text-[11px] text-slate-500">
            تاريخ الالتقاط: {item.pickup_date} · {item.service_name} ({item.shipment_type_code})
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-left">
            <p className="text-[10px] text-slate-500">رقم البوليصة</p>
            <p className="font-mono-tabular text-sm font-bold text-slate-900">{item.shipment_number}</p>
            {item.external_reference && (
              <p className="font-mono-tabular text-[10px] text-slate-500">
                مرجع: {item.external_reference}
              </p>
            )}
          </div>
          <SvgBarcode token={item.barcode_token} compact={isDense} />
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${isDense ? 'mt-2 text-[11px]' : 'mt-3 text-xs'}`}>
        <div className="rounded-lg border border-slate-200 p-2.5">
          <p className="text-[10px] font-semibold text-slate-500">بيانات التاجر / الراسل</p>
          <p className="mt-1 font-semibold text-slate-900">{item.client_name}</p>
          <p className="mt-0.5 text-slate-600">الراسل: {item.sender_name}</p>
          {item.package_description && (
            <p className="mt-1 text-slate-600">المحتوى: {item.package_description}</p>
          )}
          <p className="mt-0.5 text-slate-500">
            فتح الطرد: {item.allow_package_opening ? 'مسموح قبل الدفع' : 'غير مسموح'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 p-2.5">
          <p className="text-[10px] font-semibold text-slate-500">بيانات المستلم والوجهة</p>
          <p className="mt-1 font-bold text-slate-900">{item.recipient_name}</p>
          <p className="mt-0.5 font-mono-tabular text-slate-700">{item.recipient_mobile}</p>
          <p className="mt-0.5 font-medium text-slate-800">
            {item.destination_gov_name} · {item.destination_reg_name}
          </p>
          <p className="mt-0.5 text-slate-600">{item.recipient_address}</p>
        </div>
      </div>

      <div className="mt-2.5 grid grid-cols-4 gap-2 border-t border-slate-200 pt-2 font-mono-tabular text-xs">
        <div>
          <span className="block text-[10px] text-slate-500">طريقة الدفع</span>
          <span className="font-semibold text-slate-900">{paymentLabel}</span>
        </div>
        <div>
          <span className="block text-[10px] text-slate-500">الوزن المحتسب</span>
          <span className="font-semibold text-slate-900">{item.chargeable_weight_kg} كجم</span>
        </div>
        <div>
          <span className="block text-[10px] text-slate-500">عدد القطع</span>
          <span className="font-semibold text-slate-900">{item.pieces_count}</span>
        </div>
        <div>
          <span className="block text-[10px] text-slate-500">المطلوب تحصيله</span>
          <span className="font-bold text-slate-900">
            {Number(item.recipient_collect_amount).toFixed(2)} ج.م
          </span>
        </div>
      </div>
    </article>
  );
}

export function WaybillPrintModal({
  open,
  tenantId,
  tenantName,
  tenantCode,
  items,
  onClose,
}: WaybillPrintModalProps) {
  const [layout, setLayout] = useState<WaybillPrintLayout>('single_a4');
  const [printing, setPrinting] = useState(false);

  const slots = useMemo<readonly RenderSlot[]>(() => {
    if (items.length === 0) return [];
    if (layout === 'two_copies_same') {
      return items.flatMap((item) => [
        {key: `${item.id}-c1`, copyLabel: 'نسخة المستلم (1/2)', item},
        {key: `${item.id}-c2`, copyLabel: 'نسخة التاجر / التشغيل (2/2)', item},
      ]);
    }
    if (layout === 'three_copies_same') {
      return items.flatMap((item) => [
        {key: `${item.id}-c1`, copyLabel: 'نسخة المستلم (1/3)', item},
        {key: `${item.id}-c2`, copyLabel: 'نسخة التاجر (2/3)', item},
        {key: `${item.id}-c3`, copyLabel: 'نسخة الأرشيف (3/3)', item},
      ]);
    }
    return items.map((item) => ({key: item.id, item}));
  }, [items, layout]);

  if (!open) return null;

  const handlePrint = async () => {
    setPrinting(true);
    try {
      await recordExportJob({
        tenantId,
        exportType: 'waybill_print',
        format: layout === 'barcode_label_thermal' ? 'print_label' : 'print_a4',
        filters: {
          layout,
          shipment_numbers: items.map((i) => i.shipment_number),
        },
        rowCount: items.length,
      }).catch(() => undefined);

      if (typeof window !== 'undefined' && typeof window.print === 'function') {
        window.print();
      }
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="مركز طباعة البوالص والملصقات"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 print:static print:bg-white print:p-0"
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white print:max-h-none print:border-0">
        {/* Header & Layout Picker (Hidden in print output) */}
        <div className="border-b border-slate-200 px-5 py-4 print:hidden">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                مركز طباعة البوالص وملصقات الباركود ({items.length} شحنة)
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                اختر القالب المناسب للطباعة على ورق A4 أو الطابعة الحرارية. الطباعة للعرض والتسليم فقط ولا تعدل أي حالة تشغيلية أو مالية.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={printing || items.length === 0}
                onClick={() => void handlePrint()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <Printer className="h-3.5 w-3.5" />
                {printing ? 'جارٍ التجهيز...' : 'تنفيذ الطباعة الآن'}
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="إغلاق نافذة الطباعة"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <X className="h-3.5 w-3.5" />
                إغلاق
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {WAYBILL_LAYOUT_OPTIONS.map((opt) => {
              const selected = layout === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setLayout(opt.id)}
                  className={`rounded-lg border px-3 py-2 text-right transition-colors ${
                    selected
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <p className="text-xs font-semibold">{opt.label}</p>
                  <p className={`mt-0.5 text-[11px] ${selected ? 'text-slate-200' : 'text-slate-500'}`}>
                    {opt.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Printable Preview Surface */}
        <div
          data-testid="waybill-print-preview"
          data-layout={layout}
          className="flex-1 overflow-y-auto bg-slate-50 p-5 print:overflow-visible print:bg-white print:p-0"
        >
          {slots.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-500">لا توجد شحنات محددة للطباعة.</p>
          ) : (
            <div
              className={
                layout === 'two_shipments' || layout === 'two_copies_same'
                  ? 'grid grid-cols-1 gap-4'
                  : layout === 'three_shipments' || layout === 'three_copies_same'
                    ? 'grid grid-cols-1 gap-3'
                    : 'space-y-4'
              }
            >
              {slots.map((slot) => (
                <WaybillCard
                  key={slot.key}
                  item={slot.item}
                  tenantName={tenantName}
                  tenantCode={tenantCode}
                  copyLabel={slot.copyLabel}
                  layout={layout}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
