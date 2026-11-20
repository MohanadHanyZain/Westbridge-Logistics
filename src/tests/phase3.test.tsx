import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {AccountSubjectType} from '@/types/common';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';

const mockUseAuth = vi.fn();
const mockSummaryCounts = vi.fn();
const mockListBranches = vi.fn();
const mockListChartOfAccounts = vi.fn();
const mockListCountries = vi.fn();
const mockListGovernorates = vi.fn();
const mockListRegions = vi.fn();
const mockListOperationalRefs = vi.fn();
const mockListShipmentTypes = vi.fn();
const mockListShippingServices = vi.fn();

const mockListClients = vi.fn();
const mockListClientRegistrationRequests = vi.fn();
const mockListTaxProfiles = vi.fn();
const mockListClientPriceLists = vi.fn();
const mockListPriceListVersions = vi.fn();
const mockListPickupPriceRules = vi.fn();
const mockListDeliveryPriceRules = vi.fn();
const mockListPriceSurcharges = vi.fn();
const mockCalculateShipmentPrice = vi.fn();
const mockListPriceSnapshots = vi.fn();

vi.mock('@/lib/auth', () => ({
  AuthProvider: ({children}: {children: React.ReactNode}) => <>{children}</>,
  useAuth: () => mockUseAuth(),
  updateMyCredentials: vi.fn(),
  GENERIC_LOGIN_ERROR: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
}));

vi.mock('@/features/definitions/definitionsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/definitions/definitionsService')>();
  return {
    ...actual,
    fetchPhase2SummaryCounts: (...args: unknown[]) => mockSummaryCounts(...args),
    listBranches: (...args: unknown[]) => mockListBranches(...args),
    listChartOfAccounts: (...args: unknown[]) => mockListChartOfAccounts(...args),
    listCountries: (...args: unknown[]) => mockListCountries(...args),
    listGovernorates: (...args: unknown[]) => mockListGovernorates(...args),
    listRegions: (...args: unknown[]) => mockListRegions(...args),
    listOperationalRefs: (...args: unknown[]) => mockListOperationalRefs(...args),
    listShipmentTypes: (...args: unknown[]) => mockListShipmentTypes(...args),
    listShippingServices: (...args: unknown[]) => mockListShippingServices(...args),
  };
});

vi.mock('@/features/clients/clientsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/clients/clientsService')>();
  return {
    ...actual,
    listClients: (...args: unknown[]) => mockListClients(...args),
    listClientRegistrationRequests: (...args: unknown[]) => mockListClientRegistrationRequests(...args),
  };
});

vi.mock('@/features/pricing/pricingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pricing/pricingService')>();
  return {
    ...actual,
    listTaxProfiles: (...args: unknown[]) => mockListTaxProfiles(...args),
    listClientPriceLists: (...args: unknown[]) => mockListClientPriceLists(...args),
    listPriceListVersions: (...args: unknown[]) => mockListPriceListVersions(...args),
    listPickupPriceRules: (...args: unknown[]) => mockListPickupPriceRules(...args),
    listDeliveryPriceRules: (...args: unknown[]) => mockListDeliveryPriceRules(...args),
    listPriceSurcharges: (...args: unknown[]) => mockListPriceSurcharges(...args),
    calculateShipmentPrice: (...args: unknown[]) => mockCalculateShipmentPrice(...args),
    listPriceSnapshots: (...args: unknown[]) => mockListPriceSnapshots(...args),
  };
});

vi.mock('@/features/finance/financeService', () => ({
  getClientsSettlementOverview: vi.fn().mockResolvedValue([]),
  listClientSettlements: vi.fn().mockResolvedValue([]),
  listClientUnsettledShipments: vi.fn().mockResolvedValue([]),
  getCashboxesWithBalances: vi.fn().mockResolvedValue([]),
  getTenantFinancePolicy: vi.fn().mockResolvedValue({
    tenant_id: '11111111-1111-1111-1111-111111111111',
    enforce_four_eyes: true,
    allow_owner_self_approve: true,
    high_value_approval_threshold: 0,
  }),
  createClientSettlement: vi.fn(),
  approveClientSettlement: vi.fn(),
}));

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

const membershipAlpha: TenantMembershipRecord = {
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

describe('Phase 3: Clients, Price Lists, Server Pricing Engine & Snapshots', () => {
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
      memberships: [membershipAlpha],
      loading: false,
      isConfigured: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });

    mockListBranches.mockResolvedValue([]);
    mockListChartOfAccounts.mockResolvedValue([]);
    mockListCountries.mockResolvedValue([
      {id: 'cnt-eg', tenant_id: tenantAlpha.id, code: 'EG', name: 'مصر', iso2: 'EG', is_default: true, is_active: true},
    ]);
    mockListGovernorates.mockResolvedValue([
      {id: 'gov-1', tenant_id: tenantAlpha.id, country_id: 'cnt-eg', code: 'EG-01', name: 'القاهرة', default_branch_id: null, is_active: true},
      {id: 'gov-2', tenant_id: tenantAlpha.id, country_id: 'cnt-eg', code: 'EG-02', name: 'الجيزة', default_branch_id: null, is_active: true},
    ]);
    mockListRegions.mockResolvedValue([
      {id: 'reg-1', tenant_id: tenantAlpha.id, governorate_id: 'gov-1', city_id: null, code: 'EG-01-R01', name: 'مدينة نصر', default_branch_id: null, is_active: true},
      {id: 'reg-2', tenant_id: tenantAlpha.id, governorate_id: 'gov-2', city_id: null, code: 'EG-02-R01', name: 'المهندسين', default_branch_id: null, is_active: true},
    ]);
    mockListOperationalRefs.mockResolvedValue({
      paymentTerms: [{id: 'pt-1', tenant_id: tenantAlpha.id, code: 'NET7', name: 'تسوية أسبوعية'}],
      packagingTypes: [],
      cancellationReasons: [],
    });
    mockListShipmentTypes.mockResolvedValue([
      {id: 'st-1', tenant_id: tenantAlpha.id, code: 'FDP', name: 'تسليم كامل للطرد', description: null, is_system: true, is_active: true},
    ]);
    mockListShippingServices.mockResolvedValue([
      {
        id: 'srv-1',
        tenant_id: tenantAlpha.id,
        code: 'SRV-001',
        name: 'التوصيل القياسي',
        estimated_days_min: 2,
        estimated_days_max: 4,
        branch_id: null,
        delivery_revenue_account_id: null,
        collection_revenue_account_id: null,
        courier_commission_account_id: null,
        is_active: true,
        archived_at: null,
        shipment_type_ids: ['st-1'],
      },
    ]);

    mockListTaxProfiles.mockResolvedValue([
      {id: 'tax-none', tenant_id: tenantAlpha.id, code: 'NO-TAX', name: 'بدون ضريبة', rate_percent: 0, tax_mode: 'none', is_default: true, is_active: true},
      {id: 'tax-vat', tenant_id: tenantAlpha.id, code: 'VAT-14-EX', name: 'ضريبة مضافة 14%', rate_percent: 14, tax_mode: 'exclusive', is_default: false, is_active: true},
    ]);

    mockListClientPriceLists.mockResolvedValue([
      {
        id: 'pl-0',
        tenant_id: tenantAlpha.id,
        code: '0',
        name: 'أسعار عملاء الموبايل',
        description: 'القائمة الافتراضية المحمية',
        is_system_default: true,
        is_active: true,
        archived_at: null,
        created_at: '2026-11-18T10:00:00Z',
      },
    ]);

    mockListClients.mockResolvedValue([
      {
        id: 'cl-1',
        tenant_id: tenantAlpha.id,
        code: 'CL-001',
        name: 'متجر النيل',
        branch_id: null,
        ledger_account_id: null,
        country_id: 'cnt-eg',
        governorate_id: 'gov-1',
        city_id: null,
        region_id: 'reg-1',
        price_list_id: 'pl-0',
        tax_profile_id: 'tax-none',
        default_payment_term_id: 'pt-1',
        default_shipment_type_id: 'st-1',
        default_price_mode: 'shipping_excluded',
        allow_package_opening: false,
        client_category: 'ecommerce',
        activity_type: 'ملابس',
        trade_direction: 'b2c',
        payout_method: 'cash',
        bank_name: null,
        bank_account_number: null,
        wallet_phone: null,
        phone: '0223456789',
        mobile: '01012345678',
        po_box: null,
        postal_code: null,
        address_line: 'شارع عباس العقاد',
        email: 'orders@nile.eg',
        approval_status: 'approved',
        is_active: true,
        archived_at: null,
        created_at: '2026-11-18T10:00:00Z',
      },
    ]);

    mockListClientRegistrationRequests.mockResolvedValue([
      {
        id: 'req-1',
        tenant_id: tenantAlpha.id,
        company_name: 'متجر الدلتا الجديد',
        contact_name: 'أحمد محمود',
        email: 'delta@example.com',
        phone: '01122334455',
        mobile: '01122334455',
        governorate_id: 'gov-1',
        region_id: 'reg-1',
        address_line: 'مصر الجديدة',
        payout_method: 'cash',
        bank_name: null,
        bank_account_number: null,
        wallet_phone: null,
        status: 'pending',
        rejection_reason: null,
        approved_client_id: null,
        created_at: '2026-11-18T10:00:00Z',
      },
    ]);
  });

  it('renders ClientsListPage, pre-fills CL-002, toggles payout fields, and displays registration queue', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/clients']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('متجر النيل')).toBeInTheDocument();
    });
    expect(screen.getByText('CL-001')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'إنشاء عميل جديد'}));
    expect(screen.getByLabelText('كود العميل')).toHaveValue('CL-002');
    expect(screen.getByLabelText(/ملف الضريبة/)).toHaveValue('tax-none');

    fireEvent.change(screen.getByLabelText('نوع الدفع / السداد للعميل'), {
      target: {value: 'bank_transfer'},
    });
    expect(screen.getByLabelText('اسم البنك')).toBeInTheDocument();
    expect(screen.getByLabelText('رقم الحساب البنكي')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('نوع الدفع / السداد للعميل'), {
      target: {value: 'vodafone_cash'},
    });
    expect(screen.getByLabelText('رقم محفظة فودافون كاش')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /الحسابات المسجلة/}));
    expect(screen.getByText('متجر الدلتا الجديد')).toBeInTheDocument();
  });

  it('renders العملاء sidebar with 5 sub-sections and opens /clients/new and /clients/settlements directly', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/clients/new']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('كود العميل')).toHaveValue('CL-002');
    });

    expect(screen.getByRole('link', {name: 'قائمة العملاء'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'إنشاء عميل'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'الحسابات المسجلة'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'قوائم أسعار الشحن'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'قيد التسوية مع العملاء'})).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', {name: 'قيد التسوية مع العملاء'}));
    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'قيد التسوية مع العملاء'})).toBeInTheDocument();
    });
    expect(screen.getByText('أرصدة العملاء قيد التسوية')).toBeInTheDocument();
    expect(screen.getByText('سجل كشوف تسويات العملاء (CST)')).toBeInTheDocument();
  });

  it('renders protected default price list 0 and opens atomic clone form on PriceListsPage', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/pricing/price-lists']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('أسعار عملاء الموبايل')).toBeInTheDocument();
    });
    expect(screen.getByText('افتراضية محمية (غير قابلة للحذف)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'نسخ القائمة'}));
    expect(screen.getByText(/نسخ قائمة الأسعار: 0 — أسعار عملاء الموبايل/)).toBeInTheDocument();
    expect(screen.getByLabelText('الكود الجديد')).toHaveValue('PL-001');
  });

  it('renders volumetric divisor, rounding rule, and master-detail pickup -> delivery rules on PriceListDetailPage', async () => {
    mockListPriceListVersions.mockResolvedValue([
      {
        id: 'ver-1',
        tenant_id: tenantAlpha.id,
        price_list_id: 'pl-0',
        version_number: 1,
        label: 'الإصدار الافتراضي',
        volumetric_divisor: 5000,
        weight_rounding_rule: 'ceil_1kg',
        effective_from: '2026-11-18T10:00:00Z',
        is_active: true,
        is_published: true,
        notes: null,
      },
    ]);
    mockListPickupPriceRules.mockResolvedValue([
      {
        id: 'pr-1',
        tenant_id: tenantAlpha.id,
        price_list_version_id: 'ver-1',
        service_id: 'srv-1',
        pickup_governorate_id: 'gov-1',
        pickup_region_id: null,
        is_active: true,
        notes: null,
      },
    ]);
    mockListDeliveryPriceRules.mockResolvedValue([
      {
        id: 'dr-1',
        tenant_id: tenantAlpha.id,
        pickup_rule_id: 'pr-1',
        delivery_governorate_id: 'gov-2',
        delivery_region_id: 'reg-2',
        base_weight_kg: 1,
        base_delivery_fee: 60,
        extra_weight_step_kg: 1,
        extra_weight_fee: 10,
        return_fee: 35,
        collection_threshold_amount: 3000,
        collection_fee_base: 0,
        collection_extra_step_amount: 1000,
        collection_extra_fee: 10,
        is_active: true,
      },
    ]);
    mockListPriceSurcharges.mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/pricing/price-lists/pl-0']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText(/معامل الوزن الحجمي/)).toHaveValue(5000);
    });
    expect(screen.getByLabelText(/قاعدة تقريب الوزن المفوتر/)).toHaveValue('ceil_1kg');
    expect(screen.getByText(/الجيزة · المهندسين/)).toBeInTheDocument();
  });

  it('calls server calculateShipmentPrice RPC and displays volumetric + net payout breakdown', async () => {
    mockListPriceSnapshots.mockResolvedValue([]);
    mockCalculateShipmentPrice.mockResolvedValue({
      engine_version: 'phase3-v1',
      match_tier: 'gov_to_gov',
      price_list_id: 'pl-0',
      price_list_version_id: 'ver-1',
      version_number: 1,
      volumetric_divisor: 5000,
      rounding_rule: 'ceil_1kg',
      actual_weight_kg: 1.5,
      volumetric_weight_kg: 12,
      chargeable_weight_kg: 12,
      base_weight_kg: 1,
      base_delivery_fee: 60,
      extra_weight_fee: 110,
      collection_fee: 0,
      surcharges_total: 0,
      exemptions_total: 0,
      subtotal_before_tax: 170,
      tax_profile_code: 'NO-TAX',
      tax_mode: 'none',
      tax_rate_percent: 0,
      tax_amount: 0,
      total_shipping_fee: 170,
      return_fee: 35,
      price_mode: 'shipping_excluded',
      entered_amount: 1000,
      recipient_collect_amount: 1170,
      client_net_payout: 1000,
      is_manual_override: false,
      override_reason: null,
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/pricing/calculator']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('العميل')).toHaveValue('cl-1');
    });

    fireEvent.click(screen.getByRole('button', {name: 'معاينة التسعير من الخادم'}));

    await waitFor(() => {
      expect(mockCalculateShipmentPrice).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText('إجمالي رسوم الشحن')).toBeInTheDocument();
    expect(screen.getByText('المطلوب تحصيله من المستلم')).toBeInTheDocument();
    expect(screen.getByText('صافي المستحق للعميل (التاجر)')).toBeInTheDocument();
    expect(screen.getAllByText(/170\.00/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/1[٬,]170\.00/)).toBeInTheDocument();
  });
});
