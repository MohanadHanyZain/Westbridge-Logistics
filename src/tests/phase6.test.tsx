import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {AccountSubjectType, PermissionScope} from '@/types/common';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';
import type {ShipmentFullDetail, ShipmentListItem} from '@/types/shipments';

const mockUseAuth = vi.fn();
const mockGetMyTenantPermissions = vi.fn();
const mockFetchPublicTenantBySlug = vi.fn();

const mockListBranches = vi.fn();
const mockListGovernorates = vi.fn();
const mockListRegions = vi.fn();
const mockListMovementTypes = vi.fn();
const mockListShipmentTypes = vi.fn();
const mockListShippingServices = vi.fn();
const mockListOperationalRefs = vi.fn();
const mockListExceptionReasons = vi.fn();

const mockListClients = vi.fn();
const mockCalculateShipmentPrice = vi.fn();
const mockListCouriers = vi.fn();

const mockListShipments = vi.fn();
const mockGetShipmentDetail = vi.fn();
const mockCreateShipment = vi.fn();
const mockTransitionShipmentStatus = vi.fn();
const mockRepriceShipment = vi.fn();
const mockAddShipmentNote = vi.fn();
const mockTrackPublicShipment = vi.fn();
const mockFetchShipmentDashboardCounts = vi.fn();

vi.mock('@/lib/auth', () => ({
  AuthProvider: ({children}: {children: React.ReactNode}) => <>{children}</>,
  useAuth: () => mockUseAuth(),
  updateMyCredentials: vi.fn(),
  GENERIC_LOGIN_ERROR: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
}));

vi.mock('@/features/tenants/tenantService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/tenants/tenantService')>();
  return {
    ...actual,
    fetchPublicTenantBySlug: (...args: unknown[]) => mockFetchPublicTenantBySlug(...args),
  };
});

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
    listGovernorates: (...args: unknown[]) => mockListGovernorates(...args),
    listRegions: (...args: unknown[]) => mockListRegions(...args),
    listMovementTypes: (...args: unknown[]) => mockListMovementTypes(...args),
    listShipmentTypes: (...args: unknown[]) => mockListShipmentTypes(...args),
    listShippingServices: (...args: unknown[]) => mockListShippingServices(...args),
    listOperationalRefs: (...args: unknown[]) => mockListOperationalRefs(...args),
    listExceptionReasons: (...args: unknown[]) => mockListExceptionReasons(...args),
  };
});

vi.mock('@/features/clients/clientsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/clients/clientsService')>();
  return {
    ...actual,
    listClients: (...args: unknown[]) => mockListClients(...args),
  };
});

vi.mock('@/features/pricing/pricingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pricing/pricingService')>();
  return {
    ...actual,
    calculateShipmentPrice: (...args: unknown[]) => mockCalculateShipmentPrice(...args),
  };
});

vi.mock('@/features/couriers/couriersService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/couriers/couriersService')>();
  return {
    ...actual,
    listCouriers: (...args: unknown[]) => mockListCouriers(...args),
  };
});

vi.mock('@/features/shipments/shipmentsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/shipments/shipmentsService')>();
  return {
    ...actual,
    listShipments: (...args: unknown[]) => mockListShipments(...args),
    getShipmentDetail: (...args: unknown[]) => mockGetShipmentDetail(...args),
    createShipment: (...args: unknown[]) => mockCreateShipment(...args),
    transitionShipmentStatus: (...args: unknown[]) => mockTransitionShipmentStatus(...args),
    repriceShipment: (...args: unknown[]) => mockRepriceShipment(...args),
    addShipmentNote: (...args: unknown[]) => mockAddShipmentNote(...args),
    trackPublicShipment: (...args: unknown[]) => mockTrackPublicShipment(...args),
    fetchShipmentDashboardCounts: (...args: unknown[]) => mockFetchShipmentDashboardCounts(...args),
  };
});

const tenantAlpha: TenantRecord = {
  id: '11111111-1111-1111-1111-111111111111',
  code: 'ALPHA',
  slug: 'alpha-express',
  name: 'شركة ألفا للشحن',
  status: 'active',
  default_timezone: 'Africa/Cairo',
  default_currency: 'EGP',
  default_locale: 'ar-EG',
  created_at: '2026-11-18T10:00:00Z',
  updated_at: '2026-11-18T10:00:00Z',
};

const membershipOwner: TenantMembershipRecord = {
  id: 'aaaa1111-1111-1111-1111-111111111111',
  tenant_id: tenantAlpha.id,
  user_id: 'user-alpha-1',
  username: 'admin',
  account_subject_type: AccountSubjectType.STAFF,
  role_key: 'company_owner',
  is_active: true,
  must_change_password: false,
  tenants: tenantAlpha,
};

const sampleListItem: ShipmentListItem = {
  id: 'shp-1',
  tenant_id: tenantAlpha.id,
  shipment_number: 'SHP-0000001',
  barcode_token: 'BR-ALPHA-992288',
  client_id: 'cl-1',
  origin_branch_id: 'br-1',
  current_branch_id: 'br-1',
  destination_branch_id: null,
  assigned_courier_id: 'cr-1',
  movement_type_id: 'mov-1',
  shipment_type_id: 'st-fdp',
  shipment_type_code: 'FDP',
  service_id: 'srv-1',
  payment_term_id: 'pt-cod',
  payment_term_code: 'COD',
  price_mode: 'shipping_excluded',
  operational_status: 'out_for_delivery',
  is_created_confirmed: true,
  is_collected_from_courier: false,
  is_settled_to_client: false,
  is_courier_commission_paid: false,
  entered_amount: 500,
  prepaid_balance_amount: 500,
  total_shipping_fee: 70,
  return_fee: 35,
  recipient_collect_amount: 570,
  client_net_payout: 500,
  delivered_amount: null,
  pieces_count: 3,
  delivered_pieces_count: 0,
  returned_pieces_count: 0,
  partial_return_custody: 'none',
  exchange_status: 'none',
  actual_weight_kg: 2,
  chargeable_weight_kg: 2,
  allow_package_opening: true,
  package_description: 'ملابس شتوية',
  external_reference: 'ORD-707',
  notes: null,
  pickup_date: '2026-11-19',
  pickup_time_from: null,
  pickup_time_to: null,
  current_snapshot_id: 'snap-1',
  sender_governorate_id: 'gov-1',
  sender_region_id: 'reg-1',
  recipient_governorate_id: 'gov-2',
  recipient_region_id: 'reg-2',
  delivery_attempts_count: 0,
  last_exception_reason_id: null,
  delivered_at: null,
  returned_at: null,
  cancelled_at: null,
  created_at: '2026-11-19T08:00:00Z',
  updated_at: '2026-11-19T09:00:00Z',
  sender_name: 'متجر النيل',
  sender_mobile: '01010002000',
  recipient_name: 'عماد محمود',
  recipient_mobile: '01299887766',
  recipient_address: 'سموحة - شارع فوزي معاذ',
  tracking_token: 'TRK-X9K2M7P4Q1',
};

const sampleDetail: ShipmentFullDetail = {
  shipment: sampleListItem,
  parties: [
    {
      id: 'prt-1',
      tenant_id: tenantAlpha.id,
      shipment_id: 'shp-1',
      party_type: 'sender',
      name: 'متجر النيل',
      phone: null,
      mobile: '01010002000',
      governorate_id: 'gov-1',
      city_id: null,
      region_id: 'reg-1',
      address_line: 'مدينة نصر - شارع عباس العقاد',
    },
    {
      id: 'prt-2',
      tenant_id: tenantAlpha.id,
      shipment_id: 'shp-1',
      party_type: 'recipient',
      name: 'عماد محمود',
      phone: null,
      mobile: '01299887766',
      governorate_id: 'gov-2',
      city_id: null,
      region_id: 'reg-2',
      address_line: 'سموحة - شارع فوزي معاذ',
    },
  ],
  packages: [
    {
      id: 'pkg-1',
      shipment_id: 'shp-1',
      package_index: 1,
      description: 'ملابس شتوية',
      pieces_count: 3,
      weight_kg: 2,
      declared_value: 500,
      barcode: 'BR-ALPHA-992288',
    },
  ],
  dimensions: [
    {
      id: 'dim-1',
      shipment_id: 'shp-1',
      snapshot_id: 'snap-1',
      version_number: 1,
      actual_weight_kg: 2,
      length_cm: 20,
      width_cm: 20,
      height_cm: 10,
      volumetric_divisor: 5000,
      volumetric_weight_kg: 0.8,
      chargeable_weight_kg: 2,
      reason: 'الإدخال الأولي',
      created_at: '2026-11-19T08:00:00Z',
    },
  ],
  snapshots: [
    {
      id: 'snap-1',
      tenant_id: tenantAlpha.id,
      client_id: 'cl-1',
      service_id: 'srv-1',
      version_number: 1,
      chargeable_weight_kg: 2,
      price_mode: 'shipping_excluded',
      entered_amount: 500,
      tax_mode: 'none',
      tax_amount: 0,
      total_shipping_fee: 70,
      recipient_collect_amount: 570,
      client_net_payout: 500,
      is_manual_override: false,
      override_reason: null,
      created_at: '2026-11-19T08:00:00Z',
    },
  ],
  events: [
    {
      id: 'evt-1',
      shipment_id: 'shp-1',
      event_code: 'CREATED',
      from_status: null,
      to_status: 'created',
      branch_id: 'br-1',
      courier_id: null,
      movement_type_id: 'mov-1',
      exception_reason_id: null,
      list_type: null,
      list_code: null,
      delivered_amount: null,
      return_type: null,
      fees_snapshot: 70,
      notes: 'تم إصدار البوليصة',
      actor_user_id: 'user-alpha-1',
      actor_display_name: 'مالك ألفا',
      created_at: '2026-11-19T08:00:00Z',
    },
    {
      id: 'evt-2',
      shipment_id: 'shp-1',
      event_code: 'STATUS_CHANGE',
      from_status: 'in_warehouse',
      to_status: 'out_for_delivery',
      branch_id: 'br-1',
      courier_id: 'cr-1',
      movement_type_id: null,
      exception_reason_id: null,
      list_type: 'delivery_run',
      list_code: 'DR-001',
      delivered_amount: null,
      return_type: null,
      fees_snapshot: 70,
      notes: 'خرجت مع المندوب للتسليم',
      actor_user_id: 'user-alpha-1',
      actor_display_name: 'مالك ألفا',
      created_at: '2026-11-19T09:00:00Z',
    },
  ],
  relations: [
    {
      id: 'rel-1',
      shipment_id: 'shp-1',
      related_shipment_id: null,
      relation_type: 'ptp_exchange_return',
      exchange_item_description: 'طرد استبدال مقاس 42',
      custody_status: 'pending',
      notes: null,
      created_at: '2026-11-19T08:00:00Z',
    },
  ],
  trackingTokens: [
    {
      id: 'tok-1',
      shipment_id: 'shp-1',
      token: 'TRK-X9K2M7P4Q1',
      is_active: true,
      created_at: '2026-11-19T08:00:00Z',
    },
  ],
  notes: [],
  references: [],
};

describe('Phase 6: Shipments, Barcode, Lifecycle (ADR-013 & ADR-014) & Public Tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseAuth.mockReturnValue({
      session: {user: {id: 'user-alpha-1'}},
      user: {id: 'user-alpha-1'},
      profile: {
        id: 'user-alpha-1',
        display_name: 'مالك ألفا',
        avatar_path: null,
        is_platform_user: false,
        is_active: true,
      },
      platformAdmin: null,
      memberships: [membershipOwner],
      loading: false,
      isConfigured: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });

    mockGetMyTenantPermissions.mockResolvedValue({
      membership_id: membershipOwner.id,
      role_key: 'company_owner',
      account_subject_type: AccountSubjectType.STAFF,
      client_id: null,
      courier_id: null,
      branch_ids: [],
      permissions: [{permission_key: 'shipments.manage', scope: PermissionScope.TENANT}],
    });

    mockFetchPublicTenantBySlug.mockResolvedValue({
      id: tenantAlpha.id,
      slug: tenantAlpha.slug,
      name: tenantAlpha.name,
      default_currency: 'EGP',
      default_locale: 'ar-EG',
    });

    mockListBranches.mockResolvedValue([
      {
        id: 'br-1',
        tenant_id: tenantAlpha.id,
        code: 'CAI',
        name: 'فرع القاهرة الرئيسي',
        governorate_id: 'gov-1',
        region_id: 'reg-1',
        address_line: 'مدينة نصر',
        phone: '0223456789',
        manager_name: null,
        is_main: true,
        is_active: true,
      },
    ]);

    mockListGovernorates.mockResolvedValue([
      {id: 'gov-1', tenant_id: tenantAlpha.id, country_id: 'cnt-eg', code: 'EG-01', name: 'القاهرة', default_branch_id: 'br-1', is_active: true},
      {id: 'gov-2', tenant_id: tenantAlpha.id, country_id: 'cnt-eg', code: 'EG-02', name: 'الإسكندرية', default_branch_id: 'br-1', is_active: true},
    ]);

    mockListRegions.mockResolvedValue([
      {id: 'reg-1', tenant_id: tenantAlpha.id, governorate_id: 'gov-1', city_id: null, code: 'EG-01-R01', name: 'مدينة نصر', default_branch_id: 'br-1', is_active: true},
      {id: 'reg-2', tenant_id: tenantAlpha.id, governorate_id: 'gov-2', city_id: null, code: 'EG-02-R01', name: 'سموحة', default_branch_id: 'br-1', is_active: true},
    ]);

    mockListMovementTypes.mockResolvedValue([
      {id: 'mov-1', tenant_id: tenantAlpha.id, code: 'MOV-001', name: 'تسليم عادي', is_active: true},
    ]);

    mockListShipmentTypes.mockResolvedValue([
      {id: 'st-fdp', tenant_id: tenantAlpha.id, code: 'FDP', name: 'تسليم كامل للطرد', is_active: true},
      {id: 'st-pdp', tenant_id: tenantAlpha.id, code: 'PDP', name: 'تسليم جزء من الطرد', is_active: true},
      {id: 'st-ptp', tenant_id: tenantAlpha.id, code: 'PTP', name: 'استبدال طرد', is_active: true},
    ]);

    mockListShippingServices.mockResolvedValue([
      {id: 'srv-1', tenant_id: tenantAlpha.id, code: 'STD', name: 'شحن قياسي', estimated_days_min: 1, estimated_days_max: 2, is_active: true},
    ]);

    mockListOperationalRefs.mockResolvedValue({
      paymentTerms: [
        {id: 'pt-cod', tenant_id: tenantAlpha.id, code: 'COD', name: 'واجبة التحصيل', is_active: true},
        {id: 'pt-prepaid', tenant_id: tenantAlpha.id, code: 'PREPAID', name: 'مدفوعة مسبقًا', is_active: true},
        {id: 'pt-postpaid', tenant_id: tenantAlpha.id, code: 'POSTPAID', name: 'آجلة - بريد', is_active: true},
        {id: 'pt-cash', tenant_id: tenantAlpha.id, code: 'CASH_PAID', name: 'مسددة نقدًا', is_active: true},
      ],
      deliveryOutcomes: [],
      returnTypes: [],
      accountingJournals: [],
    });

    mockListExceptionReasons.mockResolvedValue([
      {id: 'exc-1', tenant_id: tenantAlpha.id, code: 'NO_ANS', name: 'لا يرد على الهاتف', category: 'delivery', is_active: true},
    ]);

    mockListClients.mockResolvedValue([
      {
        id: 'cl-1',
        tenant_id: tenantAlpha.id,
        code: 'C-0001',
        name: 'متجر النيل',
        branch_id: 'br-1',
        price_list_id: 'pl-0',
        tax_profile: 'none',
        default_payment_term_id: 'pt-cod',
        default_shipment_type_id: 'st-fdp',
        default_price_mode: 'shipping_excluded',
        allow_package_opening: true,
        country_id: 'cnt-eg',
        governorate_id: 'gov-1',
        city_id: null,
        region_id: 'reg-1',
        phone: '0226700000',
        mobile: '01010002000',
        address_line: 'مدينة نصر - شارع عباس العقاد',
        email: 'store@nile.test',
        ledger_account_id: null,
        is_active: true,
        created_at: '2026-11-18T10:00:00Z',
      },
    ]);

    mockListCouriers.mockResolvedValue([
      {
        id: 'cr-1',
        tenant_id: tenantAlpha.id,
        code: 'CR-001',
        name: 'كابتن طارق',
        branch_id: 'br-1',
        ledger_account_id: null,
        custody_account_id: null,
        default_route_id: null,
        commission_list_id: null,
        default_commission_type: 'fixed_amount',
        default_commission_value: 25,
        country_id: 'cnt-eg',
        governorate_id: 'gov-1',
        city_id: null,
        region_id: 'reg-1',
        phone: null,
        mobile: '01011223344',
        po_box: null,
        postal_code: null,
        address_line: null,
        email: null,
        is_active: true,
        archived_at: null,
        created_at: '2026-11-18T10:00:00Z',
      },
    ]);

    mockCalculateShipmentPrice.mockResolvedValue({
      snapshot_id: null,
      version_number: 1,
      actual_weight_kg: 1,
      volumetric_weight_kg: 0,
      chargeable_weight_kg: 1,
      base_delivery_fee: 60,
      extra_weight_fee: 0,
      collection_fee: 10,
      surcharges_total: 0,
      exemptions_total: 0,
      tax_mode: 'none',
      tax_rate_percent: 0,
      tax_amount: 0,
      total_shipping_fee: 70,
      return_fee: 35,
      recipient_collect_amount: 570,
      client_net_payout: 500,
      is_manual_override: false,
      override_reason: null,
    });

    mockListShipments.mockResolvedValue([sampleListItem]);
    mockGetShipmentDetail.mockResolvedValue(sampleDetail);
    mockFetchShipmentDashboardCounts.mockResolvedValue({
      totalCount: 12,
      inWarehouseCount: 3,
      outForDeliveryCount: 4,
      deliveredCount: 4,
      returnsCount: 1,
    });
  });

  it('renders 7 sidebar shipment links, lists shipments with barcode/amounts, and supports selection & filters', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/shipments']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('SHP-0000001')).toBeInTheDocument();
    });

    // Verify all 7 sidebar links inside الشحنات group
    expect(screen.getByRole('link', {name: 'قائمة الشحنات'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'إنشاء شحنة'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'شحنات في المخزون'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'الشحنات قيد التوصيل'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'انتظار إعادة التوصيل'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'المرتجعات والمتعثرة'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'الباركود والتتبع'})).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getByText('BR-ALPHA-992288')).toBeInTheDocument();
    expect(within(table).getByText('عماد محمود')).toBeInTheDocument();
    expect(within(table).getByText(/570\.00/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('تحديد SHP-0000001'));
    expect(screen.getByText(/تم تحديد 1 شحنة/)).toBeInTheDocument();
  });

  it('enforces ADR-013 payment term balance visibility, ADR-014 PTP exchange field, client autofill, and live pricing on CreateShipmentPage', async () => {
    mockCreateShipment.mockResolvedValue({
      shipment_id: 'shp-1',
      shipment_number: 'SHP-0000001',
      barcode_token: 'BR-ALPHA-992288',
      tracking_token: 'TRK-X9K2M7P4Q1',
      already_existed: false,
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/shipments/new']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'إنشاء شحنة جديدة'})).toBeInTheDocument();
    });

    // Client autofill populated sender fields
    expect(screen.getByLabelText('اسم الراسل')).toHaveValue('متجر النيل');
    expect(screen.getByLabelText('موبايل الراسل')).toHaveValue('01010002000');

    // ADR-013: Balance input is visible under default COD and PREPAID, hidden under POSTPAID and CASH_PAID
    expect(screen.getByLabelText('قيمة الرصيد / المبلغ (ج.م)')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('نوع الدفع'), {target: {value: 'pt-prepaid'}});
    expect(screen.getByLabelText('قيمة الرصيد / المبلغ (ج.م)')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('نوع الدفع'), {target: {value: 'pt-postpaid'}});
    expect(screen.queryByLabelText('قيمة الرصيد / المبلغ (ج.م)')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('نوع الدفع'), {target: {value: 'pt-cash'}});
    expect(screen.queryByLabelText('قيمة الرصيد / المبلغ (ج.م)')).not.toBeInTheDocument();

    // Switch back to COD and fill amount
    fireEvent.change(screen.getByLabelText('نوع الدفع'), {target: {value: 'pt-cod'}});
    fireEvent.change(screen.getByLabelText('قيمة الرصيد / المبلغ (ج.م)'), {target: {value: '500'}});

    // ADR-014: Selecting PTP shows mandatory exchange parcel description
    expect(screen.queryByLabelText(/وصف طرد الاستبدال المرتجع/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('نوع الطلب'), {target: {value: 'st-ptp'}});
    const exchangeInput = screen.getByLabelText(/وصف طرد الاستبدال المرتجع/);
    expect(exchangeInput).toBeInTheDocument();
    fireEvent.change(exchangeInput, {target: {value: 'استبدال حذاء مقاس 42'}});

    // Pricing preview waits until the recipient details are available.
    fireEvent.change(screen.getByLabelText('اسم المرسل إليه'), {target: {value: 'عماد محمود'}});
    fireEvent.change(screen.getByLabelText('موبايل المرسل إليه'), {target: {value: '01299887766'}});
    fireEvent.change(screen.getByLabelText('عنوان المرسل إليه بالتفصيل'), {
      target: {value: 'سموحة - شارع فوزي معاذ'},
    });

    await waitFor(() => {
      expect(mockCalculateShipmentPrice).toHaveBeenCalled();
      expect(screen.getByText('70.00 ج.م')).toBeInTheDocument();
    });

    // Submit the completed shipment.
    fireEvent.click(screen.getByRole('button', {name: 'إنشاء وحفظ الشحنة'}));

    await waitFor(() => {
      expect(mockCreateShipment).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateShipment).toHaveBeenCalledWith(
      tenantAlpha.id,
      expect.any(String),
      expect.objectContaining({
        client_id: 'cl-1',
        prepaid_balance_amount: 500,
        exchange_item_description: 'استبدال حذاء مقاس 42',
        recipient_name: 'عماد محمود',
      }),
    );
  });

  it('renders ShipmentDetailPage 4 flags, 4-stage track, PDP transition, ADR-010 reprice, and detail tabs', async () => {
    mockTransitionShipmentStatus.mockResolvedValue({
      shipment_id: 'shp-1',
      from_status: 'out_for_delivery',
      to_status: 'partially_delivered',
    });
    mockRepriceShipment.mockResolvedValue({
      snapshot_id: 'snap-2',
      version_number: 2,
      chargeable_weight_kg: 5,
      total_shipping_fee: 110,
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/shipments/shp-1']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'SHP-0000001'})).toBeInTheDocument();
    });

    // Top 4 lifecycle completion indicators
    const flagsSection = screen.getByLabelText('مؤشرات الإتمام المالي والتشغيلي');
    expect(within(flagsSection).getByText('تم الإنشاء')).toBeInTheDocument();
    expect(within(flagsSection).getByText('تم التحصيل من المندوب')).toBeInTheDocument();
    expect(within(flagsSection).getByText('تم السداد للعميل')).toBeInTheDocument();
    expect(within(flagsSection).getByText('تم السداد للمندوب')).toBeInTheDocument();

    // 4-step visual milestone track
    const stagesSection = screen.getByLabelText('مراحل مسار الشحنة');
    expect(within(stagesSection).getByText('1. تم الإنشاء')).toBeInTheDocument();
    expect(within(stagesSection).getByText('2. تم الشحن / الالتقاط')).toBeInTheDocument();
    expect(within(stagesSection).getByText('3. جاري التوصيل')).toBeInTheDocument();
    expect(within(stagesSection).getByText('4. تم التسليم')).toBeInTheDocument();

    // PDP transition (partially_delivered shows pieces & amount inputs)
    fireEvent.change(screen.getByLabelText('الحالة التالية'), {target: {value: 'partially_delivered'}});
    fireEvent.change(screen.getByLabelText(/القطع المسلمة/), {target: {value: '2'}});
    fireEvent.change(screen.getByLabelText(/المبلغ المحصل فعليًا/), {target: {value: '380'}});
    fireEvent.click(screen.getByRole('button', {name: 'تنفيذ الانتقال'}));

    await waitFor(() => {
      expect(mockTransitionShipmentStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: tenantAlpha.id,
          shipmentId: 'shp-1',
          toStatus: 'partially_delivered',
          deliveredPieces: 2,
          deliveredAmount: 380,
        }),
      );
    });

    // Detail tabs check
    fireEvent.click(screen.getByRole('button', {name: /الحركات وسجل الحالات/}));
    expect(screen.getByText('DR-001', {exact: false})).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /الأثر المالي ولقطات السعر/}));
    expect(screen.getByText('v1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'الباركود والعلاقات'}));
    expect(screen.getByText('طرد استبدال مقاس 42')).toBeInTheDocument();
  });

  it('renders sanitized PublicTrackingPage without exposing PII phone/mobile/address/COD amounts', async () => {
    mockTrackPublicShipment.mockResolvedValue({
      found: true,
      tenant_name: 'شركة ألفا للشحن',
      shipment_number: 'SHP-0000001',
      operational_status: 'out_for_delivery',
      service_name: 'شحن قياسي',
      shipment_type_name: 'تسليم كامل للطرد',
      pieces_count: 3,
      origin_label: 'القاهرة',
      destination_label: 'الإسكندرية',
      created_at: '2026-11-19T08:00:00Z',
      delivered_at: null,
      events: [
        {
          event_code: 'CREATED',
          to_status: 'created',
          branch_name: 'فرع القاهرة الرئيسي',
          created_at: '2026-11-19T08:00:00Z',
        },
        {
          event_code: 'STATUS_CHANGE',
          to_status: 'out_for_delivery',
          branch_name: 'فرع القاهرة الرئيسي',
          created_at: '2026-11-19T09:00:00Z',
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/track/TRK-X9K2M7P4Q1']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockTrackPublicShipment).toHaveBeenCalledWith('alpha-express', 'TRK-X9K2M7P4Q1');
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'SHP-0000001'})).toBeInTheDocument();
    });

    expect(screen.getByText('القاهرة')).toBeInTheDocument();
    expect(screen.getByText('الإسكندرية')).toBeInTheDocument();
    expect(screen.getAllByText(/فرع القاهرة الرئيسي/).length).toBeGreaterThanOrEqual(1);

    // Strict zero-PII assertions
    expect(screen.queryByText(/01299887766/)).not.toBeInTheDocument();
    expect(screen.queryByText(/سموحة/)).not.toBeInTheDocument();
    expect(screen.queryByText(/عماد محمود/)).not.toBeInTheDocument();
    expect(screen.queryByText(/570/)).not.toBeInTheDocument();
  });
});
