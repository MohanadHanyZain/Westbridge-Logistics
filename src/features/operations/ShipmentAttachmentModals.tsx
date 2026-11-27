import {LoadingState} from '@/components/ui/LoadingState';
import {useEffect, useMemo, useState, type FormEvent} from 'react';
import type {BranchRecord} from '@/types/definitions';
import type {ShipmentListItem} from '@/types/shipments';
import {Barcode, CheckSquare, Search, X} from 'lucide-react';

interface BarcodeScanModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSubmitBarcode: (query: string) => Promise<void>;
}

export function BarcodeScanModal({
  open,
  title,
  busy,
  onClose,
  onSubmitBarcode,
}: BarcodeScanModalProps) {
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setBarcodeInput('');
      setScanError(null);
      setScanSuccess(null);
    }
  }, [open]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = barcodeInput.trim();
    if (!cleaned) return;
    setScanError(null);
    setScanSuccess(null);
    try {
      await onSubmitBarcode(cleaned);
      setScanSuccess(`تمت إضافة الشحنة المطابقة للرمز (${cleaned}) بنجاح.`);
      setBarcodeInput('');
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'تعذر قراءة الباركود.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Barcode className="h-5 w-5 text-slate-800" />
            <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          </div>
          <button
            type="button"
            aria-label="إغلاق نافذة الباركود"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 space-y-4">
          <div>
            <label htmlFor="ops-barcode-input" className="block text-xs font-medium text-slate-700">
              امسح الباركود أو أدخل رقم البوليصة
            </label>
            <input
              id="ops-barcode-input"
              type="text"
              autoFocus
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              placeholder="مثال: SFB-XXXXXXXX أو SHP-0000001"
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 font-mono-tabular text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>

          {scanError && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {scanError}
            </div>
          )}

          {scanSuccess && (
            <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              {scanSuccess}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              إغلاق
            </button>
            <button
              type="submit"
              disabled={busy || !barcodeInput.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {busy ? 'جاري المطابقة...' : 'حفظ وإضافة الشحنة'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface MultiSelectShipmentsModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly shipments: readonly ShipmentListItem[];
  readonly alreadyAttachedIds: readonly string[];
  readonly branches: readonly BranchRecord[];
  readonly onClose: () => void;
  readonly onConfirmAdd: (shipmentIds: readonly string[]) => Promise<void>;
}

export function MultiSelectShipmentsModal({
  open,
  title,
  loading,
  busy,
  shipments,
  alreadyAttachedIds,
  branches,
  onClose,
  onConfirmAdd,
}: MultiSelectShipmentsModalProps) {
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setSelectedIds([]);
    }
  }, [open]);

  const branchMap = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);

  const availableShipments = useMemo(() => {
    const attachedSet = new Set(alreadyAttachedIds);
    const q = search.trim().toLowerCase();
    return shipments.filter((s) => {
      if (attachedSet.has(s.id)) return false;
      if (!q) return true;
      return [
        s.shipment_number,
        s.barcode_token,
        s.sender_name ?? '',
        s.recipient_name ?? '',
        s.recipient_mobile ?? '',
        s.package_description ?? '',
      ].some((val) => val.toLowerCase().includes(q));
    });
  }, [shipments, alreadyAttachedIds, search]);

  if (!open) return null;

  const toggleAll = () => {
    if (selectedIds.length === availableShipments.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(availableShipments.map((s) => s.id));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
    >
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <CheckSquare className="h-5 w-5 text-slate-800" />
            <h3 className="text-sm font-bold text-slate-900">{title}</h3>
          </div>
          <button
            type="button"
            aria-label="إغلاق اختيار الشحنات"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-slate-100 px-6 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث برقم الشحنة، الباركود، الراسل، المرسل إليه، أو الموبايل..."
              className="w-full rounded-lg border border-slate-200 py-2 pr-9 pl-3 text-xs focus:border-slate-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-3">
          {loading ? (
            <p className="py-10 text-center text-xs text-slate-500"><LoadingState className="py-10" label="جارٍ تحميل الشحنات المتاحة" /></p>
          ) : availableShipments.length === 0 ? (
            <p className="py-10 text-center text-xs text-slate-500">
              لا توجد شحنات مؤهلة متاحة حاليًا للإضافة لهذه القائمة.
            </p>
          ) : (
            <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label="تحديد كل الشحنات المتاحة"
                      checked={
                        availableShipments.length > 0 &&
                        selectedIds.length === availableShipments.length
                      }
                      onChange={toggleAll}
                      className="h-3.5 w-3.5 rounded border-slate-300"
                    />
                  </th>
                  <th className="px-3 py-2.5 font-medium">رقم الشحنة</th>
                  <th className="px-3 py-2.5 font-medium">الراسل</th>
                  <th className="px-3 py-2.5 font-medium">المرسل إليه</th>
                  <th className="px-3 py-2.5 font-medium">الفرع الحالي</th>
                  <th className="px-3 py-2.5 font-medium">القطع والوزن</th>
                  <th className="px-3 py-2.5 font-medium">التحصيل</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {availableShipments.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        aria-label={`اختيار ${s.shipment_number}`}
                        checked={selectedIds.includes(s.id)}
                        onChange={() => toggleOne(s.id)}
                        className="h-3.5 w-3.5 rounded border-slate-300"
                      />
                    </td>
                    <td className="px-3 py-2.5 font-mono-tabular">
                      <div className="font-semibold text-slate-900">{s.shipment_number}</div>
                      <div className="text-[11px] text-slate-500">{s.barcode_token}</div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{s.sender_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-700">
                      <div>{s.recipient_name ?? '—'}</div>
                      <div className="font-mono-tabular text-[11px] text-slate-500">
                        {s.recipient_mobile ?? '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600">
                      {branchMap.get(s.current_branch_id) ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono-tabular text-slate-700 whitespace-nowrap">
                      {s.pieces_count} ق · {s.chargeable_weight_kg} كجم
                    </td>
                    <td className="px-3 py-2.5 font-mono-tabular font-semibold text-slate-900">
                      {Number(s.recipient_collect_amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3.5">
          <span className="font-mono-tabular text-xs text-slate-600">
            تم تحديد: {selectedIds.length} شحنة
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              إلغاء
            </button>
            <button
              type="button"
              disabled={busy || selectedIds.length === 0}
              onClick={() => void onConfirmAdd(selectedIds)}
              className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {busy ? 'جاري الحفظ...' : `إضافة المحدد (${selectedIds.length})`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
