import {getSupabaseClient} from '@/lib/supabase/client';
import type {
  ExecutiveOperationsReport,
  ImportBatchResult,
  ImportJobSummary,
  ImportMode,
  ImportRowInput,
  ImportTemplateRecord,
} from '@/types/reports';

const EMPTY_REPORT: ExecutiveOperationsReport = {
  kpis: {
    total_shipments: 0,
    pending_pickup_count: 0,
    in_warehouse_count: 0,
    out_for_delivery_count: 0,
    rescheduled_count: 0,
    delivered_count: 0,
    partially_delivered_count: 0,
    returned_count: 0,
    cancelled_count: 0,
    delivery_failed_count: 0,
    first_attempt_success_rate: 0,
    return_rate: 0,
    avg_cycle_hours: 0,
    sla_delayed_count: 0,
    total_shipping_revenue: 0,
    total_cod_collected: 0,
    pending_courier_cash: 0,
    pending_client_payouts: 0,
    total_accrued_commissions: 0,
    total_cashbox_balance: 0,
  },
  by_branch: [],
  by_governorate: [],
  by_client: [],
  by_courier: [],
};

export async function getShipmentImportTemplates(
  tenantId: string,
): Promise<readonly ImportTemplateRecord[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const {data, error} = await client.rpc('get_shipment_import_templates', {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(error.message || 'تعذر تحميل قوالب الاستيراد المعتمدة.');
  }

  return (data ?? []) as ImportTemplateRecord[];
}

export async function runShipmentImportBatch(params: {
  readonly tenantId: string;
  readonly templateCode: string;
  readonly fileName: string;
  readonly batchIdempotencyKey: string;
  readonly mode: ImportMode;
  readonly defaultClientId?: string | null;
  readonly defaultBranchId?: string | null;
  readonly rows: readonly ImportRowInput[];
}): Promise<ImportBatchResult> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('عميل Supabase غير مهيأ لتنفيذ عملية الاستيراد.');
  }

  const {data, error} = await client.rpc('run_shipment_import_batch', {
    p_tenant_id: params.tenantId,
    p_template_code: params.templateCode,
    p_file_name: params.fileName,
    p_batch_idempotency_key: params.batchIdempotencyKey,
    p_mode: params.mode,
    p_default_client_id: params.defaultClientId || null,
    p_default_branch_id: params.defaultBranchId || null,
    p_rows: params.rows,
  });

  if (error) {
    throw new Error(error.message || 'تعذر تنفيذ دفعة استيراد الشحنات.');
  }

  return data as ImportBatchResult;
}

export async function listImportJobs(tenantId: string): Promise<readonly ImportJobSummary[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const {data, error} = await client.rpc('list_import_jobs', {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(error.message || 'تعذر تحميل سجل دفعات الاستيراد.');
  }

  return (data ?? []) as ImportJobSummary[];
}

export async function getImportJobDetail(
  tenantId: string,
  jobId: string,
): Promise<ImportBatchResult> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('عميل Supabase غير مهيأ.');
  }

  const {data, error} = await client.rpc('get_import_job_detail', {
    p_tenant_id: tenantId,
    p_job_id: jobId,
  });

  if (error) {
    throw new Error(error.message || 'تعذر تحميل تفاصيل دفعة الاستيراد.');
  }

  return data as ImportBatchResult;
}

export async function recordExportJob(params: {
  readonly tenantId: string;
  readonly exportType:
    | 'shipments_csv'
    | 'shipments_excel'
    | 'waybill_print'
    | 'executive_report_csv'
    | 'executive_report_print';
  readonly format: 'csv' | 'xlsx_tsv' | 'print_a4' | 'print_label';
  readonly filters?: Record<string, unknown>;
  readonly rowCount: number;
}): Promise<void> {
  const client = getSupabaseClient();
  if (!client) return;

  const {error} = await client.rpc('record_export_job', {
    p_tenant_id: params.tenantId,
    p_export_type: params.exportType,
    p_format: params.format,
    p_filters: params.filters ?? {},
    p_row_count: params.rowCount,
  });

  if (error) {
    throw new Error(error.message || 'تعذر تسجيل حركة التصدير أو الطباعة.');
  }
}

export async function getExecutiveOperationsReport(params: {
  readonly tenantId: string;
  readonly dateFrom?: string | null;
  readonly dateTo?: string | null;
  readonly branchId?: string | null;
  readonly clientId?: string | null;
}): Promise<ExecutiveOperationsReport> {
  const client = getSupabaseClient();
  if (!client) return EMPTY_REPORT;

  const {data, error} = await client.rpc('get_executive_operations_report', {
    p_tenant_id: params.tenantId,
    p_date_from: params.dateFrom || null,
    p_date_to: params.dateTo || null,
    p_branch_id: params.branchId || null,
    p_client_id: params.clientId || null,
  });

  if (error) {
    throw new Error(error.message || 'تعذر تحميل التقرير التنفيذي للتشغيل والمالية.');
  }

  return (data as ExecutiveOperationsReport | null) ?? EMPTY_REPORT;
}