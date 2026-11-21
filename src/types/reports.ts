export type ImportMode = 'dry_run' | 'commit';
export type ImportJobStatus = 'validated' | 'failed' | 'completed' | 'partial';
export type ImportRowStatus = 'valid' | 'error' | 'created' | 'skipped';

export interface ImportTemplateColumnSchema {
  readonly key: string;
  readonly header_ar: string;
  readonly required: boolean;
  readonly description_ar: string;
}

export interface ImportTemplateRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly template_code: string;
  readonly entity_type: 'shipments';
  readonly version_number: number;
  readonly name_ar: string;
  readonly description_ar?: string | null;
  readonly columns_schema: readonly ImportTemplateColumnSchema[];
  readonly is_active: boolean;
}

export interface ImportRowInput {
  readonly row_number: number;
  readonly client_code: string;
  readonly service_code: string;
  readonly shipment_type_code: string;
  readonly payment_term_code: string;
  readonly price_mode: string;
  readonly recipient_name: string;
  readonly recipient_mobile: string;
  readonly recipient_phone?: string;
  readonly governorate: string;
  readonly region: string;
  readonly recipient_address: string;
  readonly weight_kg: string | number;
  readonly pieces_count: string | number;
  readonly cod_amount: string | number;
  readonly package_description?: string;
  readonly external_reference?: string;
  readonly allow_package_opening?: string;
  readonly exchange_item_description?: string;
}

export interface ImportJobRowResult {
  readonly row_number: number;
  readonly status: ImportRowStatus;
  readonly errors: readonly string[];
  readonly estimated_shipping_fee: number | null;
  readonly estimated_collect_amount: number | null;
  readonly shipment_id: string | null;
  readonly shipment_number: string | null;
  readonly barcode_token: string | null;
  readonly normalized_payload: {
    readonly client_id?: string;
    readonly client_name?: string;
    readonly client_code?: string;
    readonly service_code?: string;
    readonly shipment_type_code?: string;
    readonly payment_term_code?: string;
    readonly price_mode?: string;
    readonly recipient_name?: string;
    readonly recipient_mobile?: string;
    readonly recipient_phone?: string | null;
    readonly recipient_governorate_id?: string;
    readonly recipient_governorate_name?: string;
    readonly recipient_region_id?: string;
    readonly recipient_region_name?: string;
    readonly recipient_address_line?: string;
    readonly actual_weight_kg?: number;
    readonly pieces_count?: number;
    readonly prepaid_balance_amount?: number;
    readonly package_description?: string | null;
    readonly external_reference?: string | null;
  };
}

export interface ImportBatchResult {
  readonly job_id: string;
  readonly template_code: string;
  readonly file_name: string;
  readonly mode: ImportMode;
  readonly status: ImportJobStatus;
  readonly total_rows: number;
  readonly valid_rows: number;
  readonly error_rows: number;
  readonly created_shipments_count: number;
  readonly already_existed?: boolean;
  readonly rows: readonly ImportJobRowResult[];
}

export interface ImportJobSummary {
  readonly id: string;
  readonly tenant_id: string;
  readonly template_code: string;
  readonly file_name: string;
  readonly mode: ImportMode;
  readonly status: ImportJobStatus;
  readonly total_rows: number;
  readonly valid_rows: number;
  readonly error_rows: number;
  readonly created_shipments_count: number;
  readonly created_at: string;
}

export type WaybillPrintLayout =
  | 'single_a4'
  | 'two_copies_same'
  | 'three_copies_same'
  | 'two_shipments'
  | 'three_shipments'
  | 'barcode_label_thermal';

export interface PrintableWaybillItem {
  readonly id: string;
  readonly shipment_number: string;
  readonly barcode_token: string;
  readonly pickup_date: string;
  readonly sender_name: string;
  readonly client_name: string;
  readonly recipient_name: string;
  readonly recipient_mobile: string;
  readonly recipient_address: string;
  readonly destination_gov_name: string;
  readonly destination_reg_name: string;
  readonly service_name: string;
  readonly shipment_type_code: string;
  readonly payment_term_code: string;
  readonly chargeable_weight_kg: number;
  readonly pieces_count: number;
  readonly recipient_collect_amount: number;
  readonly total_shipping_fee: number;
  readonly allow_package_opening?: boolean;
  readonly package_description?: string | null;
  readonly external_reference?: string | null;
}

export interface ExecutiveReportKpis {
  readonly total_shipments: number;
  readonly pending_pickup_count: number;
  readonly in_warehouse_count: number;
  readonly out_for_delivery_count: number;
  readonly rescheduled_count: number;
  readonly delivered_count: number;
  readonly partially_delivered_count: number;
  readonly returned_count: number;
  readonly cancelled_count: number;
  readonly delivery_failed_count: number;
  readonly first_attempt_success_rate: number;
  readonly return_rate: number;
  readonly avg_cycle_hours: number;
  readonly sla_delayed_count: number;
  readonly total_shipping_revenue: number;
  readonly total_cod_collected: number;
  readonly pending_courier_cash: number;
  readonly pending_client_payouts: number;
  readonly total_accrued_commissions: number;
  readonly total_cashbox_balance: number;
}

export interface BranchReportRow {
  readonly branch_id: string;
  readonly branch_name: string;
  readonly total_count: number;
  readonly delivered_count: number;
  readonly returned_count: number;
  readonly shipping_revenue: number;
}

export interface GovernorateReportRow {
  readonly governorate_id: string;
  readonly governorate_name: string;
  readonly total_count: number;
  readonly delivered_count: number;
  readonly returned_count: number;
  readonly cod_collected: number;
}

export interface ClientReportRow {
  readonly client_id: string;
  readonly client_name: string;
  readonly total_count: number;
  readonly delivered_count: number;
  readonly returned_count: number;
  readonly shipping_revenue: number;
  readonly net_payable: number;
}

export interface CourierReportRow {
  readonly courier_id: string;
  readonly courier_name: string;
  readonly assigned_count: number;
  readonly delivered_count: number;
  readonly failed_or_returned_count: number;
  readonly cod_held_amount: number;
  readonly accrued_commission: number;
}

export interface ExecutiveOperationsReport {
  readonly kpis: ExecutiveReportKpis;
  readonly by_branch: readonly BranchReportRow[];
  readonly by_governorate: readonly GovernorateReportRow[];
  readonly by_client: readonly ClientReportRow[];
  readonly by_courier: readonly CourierReportRow[];
}

export const WAYBILL_LAYOUT_OPTIONS: readonly {
  readonly id: WaybillPrintLayout;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    id: 'single_a4',
    label: 'بوليصة واحدة / A4',
    description: 'صفحة كاملة بتفاصيل الشحنة والراسل والمستلم والباركود.',
  },
  {
    id: 'two_copies_same',
    label: 'نسختان من نفس البوليصة',
    description: 'نسخة للمستلم ونسخة للعميل أو التشغيل في صفحة واحدة.',
  },
  {
    id: 'three_copies_same',
    label: 'ثلاث نسخ من نفس البوليصة',
    description: 'نسخة المستلم + نسخة التاجر + نسخة الأرشيف والمندوب.',
  },
  {
    id: 'two_shipments',
    label: 'شحنتان في الصفحة',
    description: 'ضغط طباعة بوليصتين مختلفتين في كل ورقة A4.',
  },
  {
    id: 'three_shipments',
    label: 'ثلاث شحنات في الصفحة',
    description: '3 بوالص متراصة في ورقة A4 لتسريع تجهيز المخزن.',
  },
  {
    id: 'barcode_label_thermal',
    label: 'ملصق باركود حراري (10×15)',
    description: 'ملصق مضغوط مخصص لطابعات الملصقات الحرارية واللوجستيات.',
  },
];