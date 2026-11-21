import {useCallback, useEffect, useMemo, useState, type ChangeEvent} from 'react';
import {Link} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {listClients} from '@/features/clients/clientsService';
import {listBranches} from '@/features/definitions/definitionsService';
import {
  downloadCsvFile,
  downloadShipmentsTemplateCsv,
  parseCsvText,
  SHIPMENTS_V1_TEMPLATE_HEADERS,
} from '@/features/reports/exportUtils';
import {
  getImportJobDetail,
  getShipmentImportTemplates,
  listImportJobs,
  runShipmentImportBatch,
} from '@/features/reports/reportsService';
import {WaybillPrintModal} from '@/features/reports/WaybillPrintModal';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {formatDateTime} from '@/lib/formatters';
import type {BranchRecord} from '@/types/definitions';
import type {ClientRecord} from '@/types/pricing';
import type {
  ImportBatchResult,
  ImportJobSummary,
  ImportRowInput,
  ImportTemplateRecord,
  PrintableWaybillItem,
} from '@/types/reports';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Printer,
  RefreshCw,
  Upload,
} from 'lucide-react';

function buildBatchIdempotencyKey(fileName: string, rows: readonly ImportRowInput[]): string {
  const fingerprint = rows
    .map((r) => `${r.row_number}|${r.client_code}|${r.recipient_mobile}|${r.external_reference ?? ''}`)
    .join(';');
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    hash = (hash * 31 + fingerprint.charCodeAt(i)) | 0;
  }
  return `imp-${fileName.replace(/[^a-zA-Z0-9_-]/g, '')}-${rows.length}-${Math.abs(hash)}`;
}

export function ShipmentsImportPage() {
  const {tenant, boundClientId, branchIds, can} = useTenantWorkspace();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const [templates, setTemplates] = useState<readonly ImportTemplateRecord[]>([]);
  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [branches, setBranches] = useState<readonly BranchRecord[]>([]);
  const [jobsHistory, setJobsHistory] = useState<readonly ImportJobSummary[]>([]);

  const [defaultClientId, setDefaultClientId] = useState(boundClientId ?? '');
  const [defaultBranchId, setDefaultBranchId] = useState('');
  const [fileName, setFileName] = useState('shipments_batch.csv');
  const [rawInput, setRawInput] = useState('');
  const [parsedRows, setParsedRows] = useState<readonly ImportRowInput[]>([]);
  const [showSchema, setShowSchema] = useState(false);

  const [dryRunResult, setDryRunResult] = useState<ImportBatchResult | null>(null);
  const [committedResult, setCommittedResult] = useState<ImportBatchResult | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  const [runningDryRun, setRunningDryRun] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadContext = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const [tpls, cl, br, history] = await Promise.all([
        getShipmentImportTemplates(tenant.id).catch(() => []),
        listClients(tenant.id).catch(() => []),
        listBranches(tenant.id).catch(() => []),
        listImportJobs(tenant.id).catch(() => []),
      ]);
      setTemplates(tpls);
      setClients(cl);
      setBranches(br);
      setJobsHistory(history);
      if (boundClientId) {
        setDefaultClientId(boundClientId);
      }
      if (!defaultBranchId && br.length > 0) {
        const preferred =
          (branchIds.length > 0 ? br.find((b) => branchIds.includes(b.id)) : undefined) ??
          br.find((b) => b.is_main) ??
          br[0];
        if (preferred) setDefaultBranchId(preferred.id);
      }
    } finally {
      setLoadingHistory(false);
    }
  }, [tenant.id, boundClientId, branchIds, defaultBranchId]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const activeTemplate = templates[0];

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setFeedback(null);
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      setRawInput(text);
      const rows = parseCsvText(text);
      setParsedRows(rows);
      setDryRunResult(null);
      setCommittedResult(null);
      setFeedback(`تم قراءة ${rows.length} صفًا من الملف ${file.name}. اضغط "فحص الملف (Dry-Run)" للتحقق قبل الاعتماد.`);
    } catch (err) {
      setParsedRows([]);
      setError(err instanceof Error ? err.message : 'تعذر قراءة ملف الاستيراد.');
    }
  };

  const handleParseText = (): readonly ImportRowInput[] | null => {
    try {
      const rows = parseCsvText(rawInput);
      setParsedRows(rows);
      return rows;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحليل البيانات المدخلة.');
      return null;
    }
  };

  const handleDryRun = async () => {
    setError(null);
    setFeedback(null);
    setCommittedResult(null);

    const rows = parsedRows.length > 0 ? parsedRows : handleParseText();
    if (!rows || rows.length === 0) return;

    setRunningDryRun(true);
    try {
      const res = await runShipmentImportBatch({
        tenantId: tenant.id,
        templateCode: activeTemplate?.template_code ?? 'SHIPMENTS_V1',
        fileName,
        batchIdempotencyKey: buildBatchIdempotencyKey(fileName, rows),
        mode: 'dry_run',
        defaultClientId: boundClientId || defaultClientId || null,
        defaultBranchId: defaultBranchId || null,
        rows,
      });
      setDryRunResult(res);
      await loadContext();
      if (res.error_rows === 0) {
        setFeedback(`نجح الفحص المسبق لجميع الصفوف (${res.valid_rows} شحنة جاهزة للاعتماد).`);
      } else {
        setError(`يحتوي الملف على ${res.error_rows} سطر به أخطاء. راجع الجدول أدناه وصحح الملف قبل الاعتماد.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تنفيذ الفحص المسبق.');
    } finally {
      setRunningDryRun(false);
    }
  };

  const handleCommit = async () => {
    if (!dryRunResult || dryRunResult.error_rows > 0 || parsedRows.length === 0) return;
    setError(null);
    setFeedback(null);
    setCommitting(true);

    try {
      const res = await runShipmentImportBatch({
        tenantId: tenant.id,
        templateCode: activeTemplate?.template_code ?? 'SHIPMENTS_V1',
        fileName,
        batchIdempotencyKey: buildBatchIdempotencyKey(fileName, parsedRows),
        mode: 'commit',
        defaultClientId: boundClientId || defaultClientId || null,
        defaultBranchId: defaultBranchId || null,
        rows: parsedRows,
      });
      setCommittedResult(res);
      await loadContext();
      setFeedback(
        res.already_existed
          ? `تم استرجاع نتيجة هذه الدفعة مسبقًا (Idempotent): ${res.created_shipments_count} شحنة.`
          : `تم اعتماد وإنشاء ${res.created_shipments_count} شحنة بنجاح.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر اعتماد وإنشاء الشحنات.');
    } finally {
      setCommitting(false);
    }
  };

  const handleExportDryRunErrors = () => {
    const active = committedResult ?? dryRunResult;
    if (!active) return;
    const headers = [
      'رقم_السطر',
      'الحالة',
      'كود_العميل',
      'اسم_المستلم',
      'موبايل_المستلم',
      'المحافظة',
      'المنطقة',
      'الرسوم_المتوقعة',
      'التحصيل_المتوقع',
      'الأخطاء',
      'رقم_الشحنة',
    ];
    const rows = active.rows.map((r) => [
      r.row_number,
      r.status,
      r.normalized_payload.client_code ?? '',
      r.normalized_payload.recipient_name ?? '',
      r.normalized_payload.recipient_mobile ?? '',
      r.normalized_payload.recipient_governorate_name ?? '',
      r.normalized_payload.recipient_region_name ?? '',
      r.estimated_shipping_fee ?? '',
      r.estimated_collect_amount ?? '',
      r.errors.join(' | '),
      r.shipment_number ?? '',
    ]);
    downloadCsvFile(`import_report_${active.job_id.slice(0, 8)}.csv`, headers, rows);
  };

  const handleInspectJob = async (jobId: string) => {
    setError(null);
    try {
      const detail = await getImportJobDetail(tenant.id, jobId);
      if (detail.mode === 'commit' && detail.status === 'completed') {
        setCommittedResult(detail);
        setDryRunResult(null);
      } else {
        setDryRunResult(detail);
        setCommittedResult(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر عرض تفاصيل الدفعة.');
    }
  };

  const activeBatch = committedResult ?? dryRunResult;

  const printableCreatedItems = useMemo<readonly PrintableWaybillItem[]>(() => {
    if (!committedResult) return [];
    const today = new Date().toISOString().slice(0, 10);
    return committedResult.rows
      .filter((r) => r.shipment_id && r.shipment_number && r.barcode_token)
      .map((r) => ({
        id: r.shipment_id as string,
        shipment_number: r.shipment_number as string,
        barcode_token: r.barcode_token as string,
        pickup_date: today,
        sender_name: r.normalized_payload.client_name ?? 'التاجر',
        client_name: r.normalized_payload.client_name ?? 'عميل مسجل',
        recipient_name: r.normalized_payload.recipient_name ?? '—',
        recipient_mobile: r.normalized_payload.recipient_mobile ?? '—',
        recipient_address: r.normalized_payload.recipient_address_line ?? '—',
        destination_gov_name: r.normalized_payload.recipient_governorate_name ?? '—',
        destination_reg_name: r.normalized_payload.recipient_region_name ?? '—',
        service_name: r.normalized_payload.service_code ?? 'STD',
        shipment_type_code: r.normalized_payload.shipment_type_code ?? 'FDP',
        payment_term_code: r.normalized_payload.payment_term_code ?? 'COD',
        chargeable_weight_kg: Number(r.normalized_payload.actual_weight_kg ?? 1),
        pieces_count: Number(r.normalized_payload.pieces_count ?? 1),
        recipient_collect_amount: Number(r.estimated_collect_amount ?? 0),
        total_shipping_fee: Number(r.estimated_shipping_fee ?? 0),
        package_description: r.normalized_payload.package_description ?? null,
        external_reference: r.normalized_payload.external_reference ?? null,
      }));
  }, [committedResult]);

  const canImport = can('shipments.import') || can('shipments.create');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">استيراد الشحنات المجمع (Excel / CSV)</h1>
          <p className="mt-1 text-sm text-slate-600">
            رفع دفعات الشحنات عبر قالب <span className="font-mono-tabular font-semibold">SHIPMENTS_V1</span> مع الفحص المسبق بالخادم وحساب التسعير ومنع التكرار.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={downloadShipmentsTemplateCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            تحميل قالب SHIPMENTS_V1 (CSV)
          </button>

          <button
            type="button"
            onClick={() => setShowSchema((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {showSchema ? 'إخفاء توصيف الأعمدة' : 'عرض أعمدة القالب'}
          </button>

          <Link
            to={`${basePath}/shipments`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            العودة لقائمة الشحنات
          </Link>
        </div>
      </div>

      {showSchema && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            هيكل الأعمدة المعتمد ({activeTemplate?.template_code ?? 'SHIPMENTS_V1'})
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            ترتيب الأعمدة في القالب القياسي ({SHIPMENTS_V1_TEMPLATE_HEADERS.length} عمودًا):
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 font-medium">عنوان العمود بالعربية</th>
                  <th className="px-3 py-2 font-medium">المفتاح البرمجي</th>
                  <th className="px-3 py-2 font-medium">الحالة</th>
                  <th className="px-3 py-2 font-medium">الوصف</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(activeTemplate?.columns_schema ?? []).map((col) => (
                  <tr key={col.key}>
                    <td className="px-3 py-2 font-semibold text-slate-900">{col.header_ar}</td>
                    <td className="px-3 py-2 font-mono-tabular text-slate-600">{col.key}</td>
                    <td className="px-3 py-2 font-medium text-slate-700">
                      {col.required ? 'إلزامي' : 'اختياري'}
                    </td>
                    <td className="px-3 py-2 text-slate-600">{col.description_ar}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!canImport ? (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
          ليس لديك صلاحية استيراد أو إنشاء الشحنات في هذا الفرع/الشركة.
        </div>
      ) : (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="import-default-client" className="block text-xs font-medium text-slate-700">
                العميل الافتراضي للدفعة (عند ترك كود العميل فارغًا)
              </label>
              <select
                id="import-default-client"
                disabled={Boolean(boundClientId)}
                value={defaultClientId}
                onChange={(e) => setDefaultClientId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-slate-400 focus:outline-none disabled:bg-slate-100"
              >
                <option value="">حسب عمود كود_العميل في كل صف</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="import-default-branch" className="block text-xs font-medium text-slate-700">
                فرع المنشأ الافتراضي
              </label>
              <select
                id="import-default-branch"
                value={defaultBranchId}
                onChange={(e) => setDefaultBranchId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs focus:border-slate-400 focus:outline-none"
              >
                <option value="">الفرع الافتراضي للعميل / الرئيسي</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="import-file-input" className="block text-xs font-medium text-slate-700">
                رفع ملف CSV / TSV من Excel
              </label>
              <label className="mt-1.5 flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-700 hover:bg-slate-100">
                <span className="truncate font-mono-tabular">{fileName}</span>
                <Upload className="h-4 w-4 shrink-0 text-slate-500" />
                <input
                  id="import-file-input"
                  type="file"
                  accept=".csv,.tsv,.txt"
                  onChange={(e) => void handleFileChange(e)}
                  className="sr-only"
                />
              </label>
            </div>
          </div>

          <div>
            <label htmlFor="import-raw-textarea" className="block text-xs font-medium text-slate-700">
              أو الصق جدول البيانات مباشرة من Excel / CSV (حد أقصى 500 صف للدفعة)
            </label>
            <textarea
              id="import-raw-textarea"
              rows={5}
              value={rawInput}
              onChange={(e) => {
                setRawInput(e.target.value);
                setParsedRows([]);
                setDryRunResult(null);
                setCommittedResult(null);
              }}
              placeholder="رقم_السطر,كود_العميل,الخدمة,نوع_الطلب,نوع_الدفع,شامل_الشحن,اسم_المستلم,موبايل_المستلم,تليفون_المستلم,المحافظة,المنطقة,العنوان,الوزن_كجم,عدد_القطع,مبلغ_التحصيل,وصف_الطرد,المرجع_الخارجي,فتح_الطرد,وصف_الاستبدال"
              className="mt-1.5 w-full rounded-lg border border-slate-200 p-3 font-mono-tabular text-xs focus:border-slate-400 focus:outline-none"
              dir="auto"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={runningDryRun || (!rawInput.trim() && parsedRows.length === 0)}
                onClick={() => void handleDryRun()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${runningDryRun ? 'animate-spin' : ''}`} />
                {runningDryRun ? 'جارٍ فحص الصفوف...' : 'فحص الملف (Dry-Run)'}
              </button>

              {dryRunResult && dryRunResult.error_rows === 0 && !committedResult && (
                <button
                  type="button"
                  disabled={committing}
                  onClick={() => void handleCommit()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {committing
                    ? 'جارٍ اعتماد الدفعة...'
                    : `اعتماد وإنشاء ${dryRunResult.valid_rows} شحنة`}
                </button>
              )}

              {activeBatch && (
                <button
                  type="button"
                  onClick={handleExportDryRunErrors}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  تصدير تقرير الفحص (CSV)
                </button>
              )}

              {printableCreatedItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPrintOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <Printer className="h-3.5 w-3.5" />
                  طباعة البوالص المستوردة ({printableCreatedItems.length})
                </button>
              )}
            </div>

            {parsedRows.length > 0 && (
              <span className="font-mono-tabular text-xs text-slate-500">
                الصفوف المحللة محليًا: {parsedRows.length}
              </span>
            )}
          </div>
        </section>
      )}

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {feedback && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {/* Batch Validation / Commit Result Table */}
      {activeBatch && (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {activeBatch.mode === 'commit' ? 'نتيجة اعتماد الدفعة' : 'نتيجة الفحص المسبق (Dry-Run)'}
              </h2>
              <p className="mt-0.5 font-mono-tabular text-xs text-slate-500">
                {activeBatch.file_name} · قالب {activeBatch.template_code}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 font-mono-tabular text-xs">
              <span className="text-slate-700">الإجمالي: {activeBatch.total_rows}</span>
              <span className="font-semibold text-emerald-700">الصالح: {activeBatch.valid_rows}</span>
              <span className="font-semibold text-red-700">الأخطاء: {activeBatch.error_rows}</span>
              <span className="font-semibold text-slate-900">
                المنشأ: {activeBatch.created_shipments_count}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2.5 font-medium">سطر</th>
                  <th className="px-3 py-2.5 font-medium">الحالة</th>
                  <th className="px-3 py-2.5 font-medium">العميل</th>
                  <th className="px-3 py-2.5 font-medium">المستلم والوجهة</th>
                  <th className="px-3 py-2.5 font-medium">رسوم الشحن</th>
                  <th className="px-3 py-2.5 font-medium">التحصيل</th>
                  <th className="px-3 py-2.5 font-medium">رقم الشحنة / الأخطاء</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {activeBatch.rows.map((row) => (
                  <tr key={row.row_number} className={row.status === 'error' ? 'bg-red-50/40' : ''}>
                    <td className="px-3 py-2.5 font-mono-tabular font-semibold text-slate-900">
                      {row.row_number}
                    </td>
                    <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                      {row.status === 'created' && <span className="text-emerald-700">تم الإنشاء</span>}
                      {row.status === 'valid' && <span className="text-sky-700">جاهز للاعتماد</span>}
                      {row.status === 'error' && <span className="text-red-700">يحتاج تصحيح</span>}
                      {row.status === 'skipped' && <span className="text-slate-500">متخطى</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {row.normalized_payload.client_name ?? row.normalized_payload.client_code ?? '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-slate-900">
                        {row.normalized_payload.recipient_name ?? '—'}
                      </div>
                      <div className="font-mono-tabular text-[11px] text-slate-500">
                        {row.normalized_payload.recipient_mobile ?? '—'} ·{' '}
                        {row.normalized_payload.recipient_governorate_name ?? '—'} /{' '}
                        {row.normalized_payload.recipient_region_name ?? '—'}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono-tabular text-slate-900 whitespace-nowrap">
                      {row.estimated_shipping_fee !== null
                        ? Number(row.estimated_shipping_fee).toFixed(2)
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5 font-mono-tabular text-slate-900 whitespace-nowrap">
                      {row.estimated_collect_amount !== null
                        ? Number(row.estimated_collect_amount).toFixed(2)
                        : '—'}
                    </td>
                    <td className="px-3 py-2.5">
                      {row.shipment_number ? (
                        <div className="font-mono-tabular">
                          <Link
                            to={`${basePath}/shipments/${row.shipment_id}`}
                            className="font-semibold text-slate-900 underline"
                          >
                            {row.shipment_number}
                          </Link>
                          <div className="text-[11px] text-slate-500">{row.barcode_token}</div>
                        </div>
                      ) : row.errors.length > 0 ? (
                        <ul className="space-y-0.5 text-red-700">
                          {row.errors.map((errMsg, idx) => (
                            <li key={idx}>• {errMsg}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-slate-500">جاهز للتنفيذ بدون ملاحظات</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Import History */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">سجل دفعات الاستيراد السابقة</h2>
          {loadingHistory && <span className="text-xs text-slate-500">جارٍ التحديث...</span>}
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-right text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2.5 font-medium">التاريخ</th>
                <th className="px-3 py-2.5 font-medium">الملف والقالب</th>
                <th className="px-3 py-2.5 font-medium">الوضع</th>
                <th className="px-3 py-2.5 font-medium">النتائج</th>
                <th className="px-3 py-2.5 font-medium">الإجراء</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobsHistory.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    لا توجد عمليات استيراد مسجلة بعد.
                  </td>
                </tr>
              ) : (
                jobsHistory.map((job) => (
                  <tr key={job.id}>
                    <td className="px-3 py-2.5 font-mono-tabular text-slate-600 whitespace-nowrap">
                      {formatDateTime(job.created_at)}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-slate-900">{job.file_name}</span>
                      <span className="mr-2 font-mono-tabular text-[11px] text-slate-500">
                        {job.template_code}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 font-mono-tabular text-slate-700">
                      {job.mode === 'commit' ? 'اعتماد' : 'فحص مسبق'} · {job.status}
                    </td>
                    <td className="px-3 py-2.5 font-mono-tabular text-slate-700 whitespace-nowrap">
                      الإجمالي: {job.total_rows} · صالح: {job.valid_rows} · أخطاء: {job.error_rows} · منشأ: {job.created_shipments_count}
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => void handleInspectJob(job.id)}
                        className="text-xs font-medium text-slate-700 underline hover:text-slate-900"
                      >
                        عرض التفاصيل
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <WaybillPrintModal
        open={printOpen}
        tenantId={tenant.id}
        tenantName={tenant.name}
        tenantCode={tenant.code}
        items={printableCreatedItems}
        onClose={() => setPrintOpen(false)}
      />
    </div>
  );
}
