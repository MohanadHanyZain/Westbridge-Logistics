import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {
  buildBarcodeBars,
  buildSafeCsvContent,
  parseCsvText,
  sanitizeCsvCell,
} from '@/features/reports/exportUtils';
import {AccountSubjectType, PermissionScope} from '@/types/common';
import type {TenantDeliveryPolicyRecord} from '@/types/delivery';
import type {
  ExecutiveOperationsReport,
  ImportBatchResult,
  ImportTemplateRecord,
} from '@/types/reports';
import type {ShipmentListItem} from '@/types/shipments';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';

const mockUseAuth = vi.fn();
const mockGetMyTenantPermissions = vi.fn();
const mockListBranches = vi.fn();
const mockListClients = vi.fn();
const mockListShippingServices = vi.fn();
const mockListGovernorates = vi.fn();
const mockListRegions = vi.fn();
const mockListOperationalRefs = vi.fn();
const mockListExceptionReasons = vi.fn();
const mockGetTenantDeliveryPolicy = vi.fn();
const mockListShipments = vi.fn();
const mockFetchShipmentDashboardCounts = vi.fn();
const mockFetchPhase2SummaryCounts = vi.fn();

const mockGetShipmentImportTemplates = vi.fn();
const mockRunShipmentImportBatch = vi.fn();
const mockListImportJobs = vi.fn();
const mockGetImportJobDetail = vi.fn();
const mockRecordExportJob = vi.fn();
const mockGetExecutiveOperationsReport = vi.fn();

vi.mock('@/lib/auth', () => ({
  AuthProvider: ({children}: {children: React.ReactNode}) => <>{children}</>,
  useAuth: () => mockUseAuth(),
  updateMyCredentials: vi.fn(),
  GENERIC_LOGIN_ERROR: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
}));

vi.mock('@/features/security/securityService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/security/securityService')>();
  return {
    ...actual,
    getMyTenantPermissions: (...args: unknown[]) => mockGetMyTenantPermissions(...args),
  };
});

vi.mock('@/features/definitions/definitionsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/definitions/definitionsService')>();
  return {
    ...actual,
    listBranches: (...args: unknown[]) => mockListBranches(...args),
    listShippingServices: (...args: unknown[]) => mockListShippingServices(...args),
    listGovernorates: (...args: unknown[]) => mockListGovernorates(...args),
    listRegions: (...args: unknown[]) => mockListRegions(...args),
    listOperationalRefs: (...args: unknown[]) => mockListOperationalRefs(...args),
    listExceptionReasons: (...args: unknown[]) => mockListExceptionReasons(...args),
    fetchPhase2SummaryCounts: (...args: unknown[]) => mockFetchPhase2SummaryCounts(...args),
  };
});

vi.mock('@/features/clients/clientsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/clients/clientsService')>();
  return {
    ...actual,
    listClients: (...args: unknown[]) => mockListClients(...args),
  };
});

vi.mock('@/features/delivery/deliveryService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/delivery/deliveryService')>();
  return {
    ...actual,
    getTenantDeliveryPolicy: (...args: unknown[]) => mockGetTenantDeliveryPolicy(...args),
  };
});

vi.mock('@/features/shipments/shipmentsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/shipments/shipmentsService')>();
  return {
    ...actual,
    listShipments: (...args: unknown[]) => mockListShipments(...args),
    fetchShipmentDashboardCounts: (...args: unknown[]) => mockFetchShipmentDashboardCounts(...args),
  };
});

vi.mock('@/features/messaging/messagingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/messaging/messagingService')>();
  return {
    ...actual,
    getUnreadNotificationsCount: vi.fn().mockResolvedValue(0),
    subscribeToMessagingUpdates: vi.fn(() => () => undefined),
  };
});

vi.mock('@/features/reports/reportsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/reports/reportsService')>();
  return {
    ...actual,
    getShipmentImportTemplates: (...args: unknown[]) => mockGetShipmentImportTemplates(...args),
    runShipmentImportBatch: (...args: unknown[]) => mockRunShipmentImportBatch(...args),
    listImportJobs: (...args: unknown[]) => mockListImportJobs(...args),
    getImportJobDetail: (...args: unknown[]) => mockGetImportJobDetail(...args),
    recordExportJob: (...args: unknown[]) => mockRecordExportJob(...args),
    getExecutiveOperationsReport: (...args: unknown[]) => mockGetExecutiveOperationsReport(...args),
  };
});

const tenantA: TenantRecord = {
  id: 'ten-p13-a',
  code: 'EXPRESS',
  slug: 'express-eg',
  name: 'شركة إكسبرس مصر',
  status: 'active',
  default_locale: 'ar-EG',
  default_currency: 'EGP',
  default_timezone: 'Africa/Cairo',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

const ownerMembership: TenantMembershipRecord = {
  id: 'mem-p13-owner',
  tenant_id: tenantA.id,
  user_id: 'usr-p13-owner',
  username: 'admin',
  account_subject_type: AccountSubjectType.STAFF,
  role_key: 'company_owner',
  is_active: true,
  must_change_password: false,
  tenants: tenantA,
};

const templateV1: ImportTemplateRecord = {
  id: 'tpl-v1',
  tenant_id: tenantA.id,
  template_code: 'SHIPMENTS_V1',
  entity_type: 'shipments',
  version_number: 1,
  name_ar: 'قالب استيراد الشحنات المجمع (SHIPMENTS_V1)',
  description_ar: 'القالب المعتمد',
  columns_schema: [
    {key: 'client_code', header_ar: 'كود_العميل', required: true, description_ar: 'كود العميل'},
    {key: 'recipient_name', header_ar: 'اسم_المستلم', required: true, description_ar: 'اسم المستلم'},
  ],
  is_active: true,
};

const sampleShipments: ShipmentListItem[] = [
  {
    id: 'shp-101',
    tenant_id: tenantA.id,
    shipment_number: 'SHP-0000101',
    barcode_token: 'SFB-AABBCCDD1122',
    client_id: 'cli-1',
    origin_branch_id: 'br-1',
    current_branch_id: 'br-1',
    destination_branch_id: 'br-1',
    assigned_courier_id: null,
    movement_type_id: 'mov-1',
    shipment_type_id: 'st-fdp',
    shipment_type_code: 'FDP',
    service_id: 'srv-1',
    payment_term_id: 'pt-cod',
    payment_term_code: 'COD',
    price_mode: 'shipping_excluded',
    operational_status: 'created',
    is_created_confirmed: true,
    is_collected_from_courier: false,
    is_settled_to_client: false,
    is_courier_commission_paid: false,
    entered_amount: 500,
    prepaid_balance_amount: 500,
    total_shipping_fee: 65,
    return_fee: 30,
    recipient_collect_amount: 565,
    client_net_payout: 500,
    delivered_amount: null,
    pieces_count: 2,
    delivered_pieces_count: 0,
    returned_pieces_count: 0,
    partial_return_custody: 'none',
    exchange_status: 'none',
    actual_weight_kg: 2,
    chargeable_weight_kg: 2,
    allow_package_opening: true,
    package_description: 'ملابس',
    external_reference: 'ORD-501',
    notes: null,
    pickup_date: '2026-11-21',
    pickup_time_from: null,
    pickup_time_to: null,
    current_snapshot_id: null,
    sender_governorate_id: 'gov-1',
    sender_region_id: 'reg-1',
    recipient_governorate_id: 'gov-1',
    recipient_region_id: 'reg-1',
    delivery_attempts_count: 0,
    last_exception_reason_id: null,
    delivered_at: null,
    returned_at: null,
    cancelled_at: null,
    created_at: '2026-11-21T08:00:00Z',
    updated_at: '2026-11-21T08:00:00Z',
    sender_name: 'متجر النيل',
    recipient_name: 'كريم عادل',
    recipient_mobile: '01099887766',
    recipient_address: 'شارع النصر 10',
    tracking_token: 'trk-101',
  },
  {
    id: 'shp-102',
    tenant_id: tenantA.id,
    shipment_number: 'SHP-0000102',
    barcode_token: 'SFB-EEFFGGHH3344',
    client_id: 'cli-1',
    origin_branch_id: 'br-1',
    current_branch_id: 'br-1',
    destination_branch_id: 'br-1',
    assigned_courier_id: null,
    movement_type_id: 'mov-1',
    shipment_type_id: 'st-fdp',
    shipment_type_code: 'FDP',
    service_id: 'srv-1',
    payment_term_id: 'pt-pre',
    payment_term_code: 'PREPAID',
    price_mode: 'shipping_excluded',
    operational_status: 'in_warehouse',
    is_created_confirmed: true,
    is_collected_from_courier: false,
    is_settled_to_client: false,
    is_courier_commission_paid: false,
    entered_amount: 0,
    prepaid_balance_amount: 0,
    total_shipping_fee: 50,
    return_fee: 25,
    recipient_collect_amount: 0,
    client_net_payout: 0,
    delivered_amount: null,
    pieces_count: 1,
    delivered_pieces_count: 0,
    returned_pieces_count: 0,
    partial_return_custody: 'none',
    exchange_status: 'none',
    actual_weight_kg: 1,
    chargeable_weight_kg: 1,
    allow_package_opening: false,
    package_description: 'إلكترونيات',
    external_reference: 'ORD-502',
    notes: null,
    pickup_date: '2026-11-21',
    pickup_time_from: null,
    pickup_time_to: null,
    current_snapshot_id: null,
    sender_governorate_id: 'gov-1',
    sender_region_id: 'reg-1',
    recipient_governorate_id: 'gov-1',
    recipient_region_id: 'reg-1',
    delivery_attempts_count: 0,
    last_exception_reason_id: null,
    delivered_at: null,
    returned_at: null,
    cancelled_at: null,
    created_at: '2026-11-21T09:00:00Z',
    updated_at: '2026-11-21T09:00:00Z',
    sender_name: 'متجر النيل',
    recipient_name: 'ياسمين طارق',
    recipient_mobile: '01122334455',
    recipient_address: 'المعادي شارع 9',
    tracking_token: 'trk-102',
  },
];

const sampleReport: ExecutiveOperationsReport = {
  kpis: {
    total_shipments: 120,
    pending_pickup_count: 10,
    in_warehouse_count: 18,
    out_for_delivery_count: 22,
    rescheduled_count: 5,
    delivered_count: 55,
    partially_delivered_count: 3,
    returned_count: 5,
    cancelled_count: 2,
    delivery_failed_count: 0,
    first_attempt_success_rate: 84.5,
    return_rate: 4.2,
    avg_cycle_hours: 19.4,
    sla_delayed_count: 2,
    total_shipping_revenue: 8400,
    total_cod_collected: 42500,
    pending_courier_cash: 6200,
    pending_client_payouts: 15800,
    total_accrued_commissions: 1850,
    total_cashbox_balance: 34200,
  },
  by_branch: [
    {
      branch_id: 'br-1',
      branch_name: 'الفرع الرئيسي - القاهرة',
      total_count: 90,
      delivered_count: 48,
      returned_count: 3,
      shipping_revenue: 6300,
    },
  ],
  by_governorate: [
    {
      governorate_id: 'gov-1',
      governorate_name: 'القاهرة',
      total_count: 85,
      delivered_count: 45,
      returned_count: 2,
      cod_collected: 32000,
    },
  ],
  by_client: [
    {
      client_id: 'cli-1',
      client_name: 'متجر النيل',
      total_count: 60,
      delivered_count: 35,
      returned_count: 1,
      shipping_revenue: 4200,
      net_payable: 9400,
    },
  ],
  by_courier: [
    {
      courier_id: 'cr-1',
      courier_name: 'محمود مندوب',
      assigned_count: 40,
      delivered_count: 34,
      failed_or_returned_count: 2,
      cod_held_amount: 3100,
      accrued_commission: 950,
    },
  ],
};

function setupDefaultMocks() {
  mockUseAuth.mockReturnValue({
    session: {user: {id: 'usr-p13-owner'}},
    profile: {id: 'usr-p13-owner', display_name: 'أحمد الإداري', is_platform_user: false, is_active: true},
    memberships: [ownerMembership],
    isLoading: false,
    isPlatformAdmin: false,
    signIn: vi.fn(),
    signOut: vi.fn(),
    refreshContext: vi.fn(),
  });
  mockGetMyTenantPermissions.mockResolvedValue({
    client_id: null,
    courier_id: null,
    branch_ids: ['br-1'],
    permissions: [
      {permission_key: 'shipments.read', scope: PermissionScope.TENANT},
      {permission_key: 'shipments.create', scope: PermissionScope.TENANT},
      {permission_key: 'shipments.import', scope: PermissionScope.TENANT},
      {permission_key: 'reports.read', scope: PermissionScope.TENANT},
      {permission_key: 'reports.export', scope: PermissionScope.TENANT},
    ],
  });
  mockListBranches.mockResolvedValue([
    {id: 'br-1', tenant_id: tenantA.id, code: 'MAIN', name: 'الفرع الرئيسي', is_main: true, is_active: true},
  ]);
  mockListClients.mockResolvedValue([
    {id: 'cli-1', tenant_id: tenantA.id, code: 'C-0001', name: 'متجر النيل', is_active: true},
  ]);
  mockListShippingServices.mockResolvedValue([
    {id: 'srv-1', tenant_id: tenantA.id, code: 'STD', name: 'توصيل قياسي', is_active: true},
  ]);
  mockListGovernorates.mockResolvedValue([
    {id: 'gov-1', tenant_id: tenantA.id, code: 'CAI', name: 'القاهرة', is_active: true},
  ]);
  mockListRegions.mockResolvedValue([
    {id: 'reg-1', tenant_id: tenantA.id, governorate_id: 'gov-1', code: 'NASR', name: 'مدينة نصر', is_active: true},
  ]);
  mockListOperationalRefs.mockResolvedValue({
    paymentTerms: [{id: 'pt-cod', code: 'COD', name: 'الدفع عند الاستلام', is_active: true}],
    shipmentTypes: [],
    movementTypes: [],
    deliveryTypes: [],
  });
  mockListExceptionReasons.mockResolvedValue([]);
  mockGetTenantDeliveryPolicy.mockResolvedValue({
    tenant_id: tenantA.id,
    max_delivery_attempts: 3,
    retry_extra_fee: 0,
    require_pod_on_delivery: false,
  } satisfies TenantDeliveryPolicyRecord);
  mockListShipments.mockResolvedValue(sampleShipments);
  mockFetchPhase2SummaryCounts.mockResolvedValue({
    branchesCount: 2,
    activeGovernoratesCount: 5,
    activeRegionsCount: 24,
    activeServicesCount: 3,
    activeCashboxesCount: 2,
    activeExceptionReasonsCount: 6,
  });
  mockFetchShipmentDashboardCounts.mockResolvedValue({
    totalCount: 120,
    inWarehouseCount: 18,
    outForDeliveryCount: 22,
    deliveredCount: 55,
    returnsCount: 5,
  });
  mockGetShipmentImportTemplates.mockResolvedValue([templateV1]);
  mockListImportJobs.mockResolvedValue([]);
  mockRecordExportJob.mockResolvedValue(undefined);
  mockGetExecutiveOperationsReport.mockResolvedValue(sampleReport);
}

describe('Phase 13: Bulk Import, Safe Exports, Multi-Layout Printing & Executive Reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
    Object.defineProperty(URL, 'createObjectURL', {
      writable: true,
      value: vi.fn(() => 'blob:mock-csv'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      writable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window, 'print', {
      writable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });

  it('neutralizes CSV formula injection triggers, writes UTF-8 BOM, parses SHIPMENTS_V1 CSV/TSV, and builds SVG barcode bars', () => {
    expect(sanitizeCsvCell('=cmd|"/C calc"!A0')).toBe('"\'=cmd|""/C calc""!A0"');
    expect(sanitizeCsvCell('+SUM(1,2)')).toBe('"\'+SUM(1,2)"');
    expect(sanitizeCsvCell('-10')).toBe("'-10");
    expect(sanitizeCsvCell('@HYPERLINK("http://evil")')).toBe("\"'@HYPERLINK(\"\"http://evil\"\")\"");
    expect(sanitizeCsvCell('  =1+1')).toBe("'  =1+1");
    expect(sanitizeCsvCell('أحمد, القاهرة')).toBe('"أحمد, القاهرة"');

    const csv = buildSafeCsvContent(['العميل', 'المبلغ'], [['=EVIL', 500]]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain("'=EVIL,500");

    const parsed = parseCsvText(
      'رقم_السطر\tكود_العميل\tالخدمة\tنوع_الطلب\tنوع_الدفع\tشامل_الشحن\tاسم_المستلم\tموبايل_المستلم\tالمحافظة\tالمنطقة\tالعنوان\tالوزن_كجم\tعدد_القطع\tمبلغ_التحصيل\n' +
        '1\tC-0001\tSTD\tFDP\tCOD\tno\tسارة علي\t01012345678\tالقاهرة\tمدينة نصر\tشارع عباس العقاد\t1.5\t2\t400',
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].recipient_name).toBe('سارة علي');
    expect(parsed[0].weight_kg).toBe('1.5');
    expect(parsed[0].cod_amount).toBe('400');

    expect(() => parseCsvText('foo,bar\n1,2')).toThrow();

    const bars = buildBarcodeBars('SFB-AABBCCDD1122');
    expect(bars.bars.length).toBeGreaterThan(10);
    expect(bars.totalWidth).toBeGreaterThan(30);
  });

  it('runs server dry-run validation showing row errors and commits cleanly with printable waybills', async () => {
    const dryErrResult: ImportBatchResult = {
      job_id: 'job-err-1',
      template_code: 'SHIPMENTS_V1',
      file_name: 'shipments_batch.csv',
      mode: 'dry_run',
      status: 'failed',
      total_rows: 2,
      valid_rows: 1,
      error_rows: 1,
      created_shipments_count: 0,
      rows: [
        {
          row_number: 1,
          status: 'valid',
          errors: [],
          estimated_shipping_fee: 60,
          estimated_collect_amount: 560,
          shipment_id: null,
          shipment_number: null,
          barcode_token: null,
          normalized_payload: {
            client_name: 'متجر النيل',
            recipient_name: 'كريم عادل',
            recipient_mobile: '01099887766',
            recipient_governorate_name: 'القاهرة',
            recipient_region_name: 'مدينة نصر',
          },
        },
        {
          row_number: 2,
          status: 'error',
          errors: ['المحافظة غير معرفة أو غير مفعلة: محافظة_وهمية'],
          estimated_shipping_fee: null,
          estimated_collect_amount: null,
          shipment_id: null,
          shipment_number: null,
          barcode_token: null,
          normalized_payload: {
            client_name: 'متجر النيل',
            recipient_name: 'خالد حسن',
            recipient_mobile: '01234567890',
          },
        },
      ],
    };

    const dryOkResult: ImportBatchResult = {
      job_id: 'job-ok-1',
      template_code: 'SHIPMENTS_V1',
      file_name: 'shipments_batch.csv',
      mode: 'dry_run',
      status: 'validated',
      total_rows: 1,
      valid_rows: 1,
      error_rows: 0,
      created_shipments_count: 0,
      rows: [dryErrResult.rows[0]],
    };

    const commitResult: ImportBatchResult = {
      job_id: 'job-commit-1',
      template_code: 'SHIPMENTS_V1',
      file_name: 'shipments_batch.csv',
      mode: 'commit',
      status: 'completed',
      total_rows: 1,
      valid_rows: 1,
      error_rows: 0,
      created_shipments_count: 1,
      already_existed: false,
      rows: [
        {
          ...dryErrResult.rows[0],
          status: 'created',
          shipment_id: 'shp-new-900',
          shipment_number: 'SHP-0000900',
          barcode_token: 'SFB-NEW900112233',
          normalized_payload: {
            ...dryErrResult.rows[0].normalized_payload,
            recipient_address_line: 'شارع عباس العقاد',
            service_code: 'STD',
            shipment_type_code: 'FDP',
            payment_term_code: 'COD',
            actual_weight_kg: 1.5,
            pieces_count: 1,
          },
        },
      ],
    };

    mockRunShipmentImportBatch
      .mockResolvedValueOnce(dryErrResult)
      .mockResolvedValueOnce(dryOkResult)
      .mockResolvedValueOnce(commitResult);

    render(
      <MemoryRouter initialEntries={['/c/express-eg/app/shipments/import']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await screen.findByText('استيراد الشحنات المجمع (Excel / CSV)');

    const textarea = screen.getByLabelText(/أو الصق جدول البيانات مباشرة/);
    fireEvent.change(textarea, {
      target: {
        value:
          'رقم_السطر,كود_العميل,الخدمة,نوع_الطلب,نوع_الدفع,شامل_الشحن,اسم_المستلم,موبايل_المستلم,المحافظة,المنطقة,العنوان,الوزن_كجم,عدد_القطع,مبلغ_التحصيل\n' +
          '1,C-0001,STD,FDP,COD,no,كريم عادل,01099887766,القاهرة,مدينة نصر,شارع عباس العقاد,1.5,1,500\n' +
          '2,C-0001,STD,FDP,COD,no,خالد حسن,01234567890,محافظة_وهمية,مدينة نصر,عنوان,1,1,200',
      },
    });

    fireEvent.click(screen.getByRole('button', {name: /فحص الملف \(Dry-Run\)/}));

    await screen.findByText(/المحافظة غير معرفة أو غير مفعلة/);
    expect(screen.queryByRole('button', {name: /اعتماد وإنشاء/})).not.toBeInTheDocument();

    // Fix input to clean 1-row batch
    fireEvent.change(textarea, {
      target: {
        value:
          'رقم_السطر,كود_العميل,الخدمة,نوع_الطلب,نوع_الدفع,شامل_الشحن,اسم_المستلم,موبايل_المستلم,المحافظة,المنطقة,العنوان,الوزن_كجم,عدد_القطع,مبلغ_التحصيل\n' +
          '1,C-0001,STD,FDP,COD,no,كريم عادل,01099887766,القاهرة,مدينة نصر,شارع عباس العقاد,1.5,1,500',
      },
    });

    fireEvent.click(screen.getByRole('button', {name: /فحص الملف \(Dry-Run\)/}));
    const commitBtn = await screen.findByRole('button', {name: /اعتماد وإنشاء 1 شحنة/});
    fireEvent.click(commitBtn);

    await screen.findByText('SHP-0000900');
    const printImportedBtn = screen.getByRole('button', {name: /طباعة البوالص المستوردة/});
    fireEvent.click(printImportedBtn);

    const dialog = await screen.findByRole('dialog', {name: 'مركز طباعة البوالص والملصقات'});
    expect(within(dialog).getByText('SFB-NEW900112233')).toBeInTheDocument();
  });

  it('supports bulk CSV export and 6 non-state-mutating print layouts in ShipmentsListPage', async () => {
    render(
      <MemoryRouter initialEntries={['/c/express-eg/app/shipments']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await screen.findByText('SHP-0000101');
    fireEvent.click(screen.getByLabelText('تحديد SHP-0000101'));

    fireEvent.click(screen.getByRole('button', {name: /تصدير المحدد/}));
    await waitFor(() => {
      expect(mockRecordExportJob).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: tenantA.id,
          exportType: 'shipments_csv',
          format: 'csv',
          rowCount: 1,
        }),
      );
    });

    fireEvent.click(screen.getByRole('button', {name: /طباعة المحدد/}));
    const dialog = await screen.findByRole('dialog', {name: 'مركز طباعة البوالص والملصقات'});
    expect(dialog).toBeInTheDocument();

    // Switch to 3 copies of same waybill -> renders 3 waybill cards for 1 shipment
    fireEvent.click(screen.getByRole('button', {name: /ثلاث نسخ من نفس البوليصة/}));
    expect(screen.getByText(/نسخة المستلم \(1\/3\)/)).toBeInTheDocument();
    expect(screen.getByText(/نسخة الأرشيف \(3\/3\)/)).toBeInTheDocument();

    // Switch to thermal barcode label layout
    fireEvent.click(screen.getByRole('button', {name: /ملصق باركود حراري/}));
    expect(screen.getByTestId('waybill-print-preview')).toHaveAttribute('data-layout', 'barcode_label_thermal');

    fireEvent.click(screen.getByRole('button', {name: /تنفيذ الطباعة الآن/}));
    await waitFor(() => {
      expect(mockRecordExportJob).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: tenantA.id,
          exportType: 'waybill_print',
          format: 'print_label',
          rowCount: 1,
        }),
      );
      expect(window.print).toHaveBeenCalled();
    });
  });

  it('renders executive operations & financial report KPIs, breakdowns, period switcher, and exports', async () => {
    render(
      <MemoryRouter initialEntries={['/c/express-eg/app/reports']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await screen.findByText('التقارير التنفيذية والتشغيلية');
    expect(screen.getByText('84.5%')).toBeInTheDocument();
    expect(screen.getByText('4.2%')).toBeInTheDocument();
    expect(screen.getByText('الفرع الرئيسي - القاهرة')).toBeInTheDocument();
    expect(screen.getByText('محمود مندوب')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'آخر 7 أيام'}));
    await waitFor(() => {
      expect(mockGetExecutiveOperationsReport).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: tenantA.id,
          dateFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );
    });

    fireEvent.click(screen.getByRole('button', {name: /تصدير CSV\/Excel/}));
    await waitFor(() => {
      expect(mockRecordExportJob).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: tenantA.id,
          exportType: 'executive_report_csv',
          format: 'csv',
        }),
      );
    });
  });

  it('wires All/7d/30d overview switcher and sidebar links for import and executive reports', async () => {
    render(
      <MemoryRouter initialEntries={['/c/express-eg/app']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await screen.findByText('مؤشرات حركة الشحنات');
    expect(screen.getByRole('link', {name: 'استيراد Excel'})).toHaveAttribute(
      'href',
      '/c/express-eg/app/shipments/import',
    );
    expect(screen.getAllByRole('link', {name: 'التقارير التنفيذية'}).length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', {name: 'آخر 30 يومًا'}));
    await waitFor(() => {
      expect(mockGetExecutiveOperationsReport).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: tenantA.id,
          dateFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );
    });
  });
});