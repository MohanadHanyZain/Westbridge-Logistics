import {beforeEach, describe, expect, it, vi} from 'vitest';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {AccountSubjectType, PermissionScope} from '@/types/common';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';

const mockUseAuth = vi.fn();
const mockGetMyTenantPermissions = vi.fn();
const mockListBranches = vi.fn();
const mockListChartOfAccounts = vi.fn();
const mockListCountries = vi.fn();
const mockListGovernorates = vi.fn();
const mockListCities = vi.fn();
const mockListRegions = vi.fn();

const mockListCouriers = vi.fn();
const mockSaveCourier = vi.fn();
const mockListCourierRoutes = vi.fn();
const mockListRouteStops = vi.fn();
const mockSaveRouteStop = vi.fn();
const mockListVehicles = vi.fn();
const mockListDrivers = vi.fn();
const mockListCommissionLists = vi.fn();
const mockListCommissionRules = vi.fn();
const mockSaveCommissionList = vi.fn();
const mockCalculateCourierCommission = vi.fn();

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
    listChartOfAccounts: (...args: unknown[]) => mockListChartOfAccounts(...args),
    listCountries: (...args: unknown[]) => mockListCountries(...args),
    listGovernorates: (...args: unknown[]) => mockListGovernorates(...args),
    listCities: (...args: unknown[]) => mockListCities(...args),
    listRegions: (...args: unknown[]) => mockListRegions(...args),
  };
});

vi.mock('@/features/couriers/couriersService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/couriers/couriersService')>();
  return {
    ...actual,
    listCouriers: (...args: unknown[]) => mockListCouriers(...args),
    saveCourier: (...args: unknown[]) => mockSaveCourier(...args),
    listCourierRoutes: (...args: unknown[]) => mockListCourierRoutes(...args),
    listRouteStops: (...args: unknown[]) => mockListRouteStops(...args),
    saveRouteStop: (...args: unknown[]) => mockSaveRouteStop(...args),
    listVehicles: (...args: unknown[]) => mockListVehicles(...args),
    listDrivers: (...args: unknown[]) => mockListDrivers(...args),
    listCommissionLists: (...args: unknown[]) => mockListCommissionLists(...args),
    listCommissionRules: (...args: unknown[]) => mockListCommissionRules(...args),
    saveCommissionList: (...args: unknown[]) => mockSaveCommissionList(...args),
    calculateCourierCommission: (...args: unknown[]) => mockCalculateCourierCommission(...args),
  };
});

vi.mock('@/features/finance/financeService', () => ({
  getCourierCustodyOverview: vi.fn().mockResolvedValue([]),
  listCourierCommissionPayouts: vi.fn().mockResolvedValue([]),
  listCourierPayableCommissions: vi.fn().mockResolvedValue([]),
  getCashboxesWithBalances: vi.fn().mockResolvedValue([]),
  getTenantFinancePolicy: vi.fn().mockResolvedValue({
    tenant_id: '11111111-1111-1111-1111-111111111111',
    enforce_four_eyes: true,
    allow_owner_self_approve: true,
    high_value_approval_threshold: 0,
  }),
  createCourierCommissionPayout: vi.fn(),
  approveCourierCommissionPayout: vi.fn(),
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

describe('Phase 5: Couriers, Commission Rules (ADR-012) & Routes', () => {
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
      permissions: [{permission_key: 'couriers.manage', scope: PermissionScope.TENANT}],
    });

    mockListBranches.mockResolvedValue([
      {
        id: 'br-1',
        tenant_id: tenantAlpha.id,
        code: 'CAI',
        name: 'فرع القاهرة',
        governorate_id: 'gov-1',
        region_id: 'reg-1',
        address_line: 'مدينة نصر',
        phone: '0223456789',
        manager_name: null,
        is_hub: true,
        is_active: true,
      },
    ]);

    mockListChartOfAccounts.mockResolvedValue([]);
    mockListCountries.mockResolvedValue([
      {id: 'cnt-eg', tenant_id: tenantAlpha.id, code: 'EG', name: 'مصر', iso2: 'EG', is_default: true, is_active: true},
    ]);
    mockListGovernorates.mockResolvedValue([
      {id: 'gov-1', tenant_id: tenantAlpha.id, country_id: 'cnt-eg', code: 'EG-01', name: 'القاهرة', default_branch_id: null, is_active: true},
    ]);
    mockListCities.mockResolvedValue([]);
    mockListRegions.mockResolvedValue([
      {id: 'reg-1', tenant_id: tenantAlpha.id, governorate_id: 'gov-1', city_id: null, code: 'EG-01-R01', name: 'مدينة نصر', default_branch_id: null, is_active: true},
    ]);

    mockListCourierRoutes.mockResolvedValue([
      {
        id: 'rt-general',
        tenant_id: tenantAlpha.id,
        code: 'GENERAL',
        name: 'خط السير العام — كافة أنحاء الجمهورية',
        description: null,
        vehicle_id: null,
        driver_id: null,
        is_system_default: true,
        is_active: true,
        archived_at: null,
        created_at: '2026-11-18T10:00:00Z',
      },
    ]);
    mockListRouteStops.mockResolvedValue([
      {
        id: 'stop-1',
        tenant_id: tenantAlpha.id,
        route_id: 'rt-general',
        stop_order: 1,
        governorate_id: 'gov-1',
        region_id: 'reg-1',
        notes: null,
      },
    ]);
    mockListVehicles.mockResolvedValue([
      {
        id: 'vh-1',
        tenant_id: tenantAlpha.id,
        code: 'VH-001',
        name: 'سوزوكي فان 2025',
        plate_number: 'ق ص ر 1234',
        vehicle_type: 'van',
        capacity_kg: 800,
        is_active: true,
        archived_at: null,
      },
    ]);
    mockListDrivers.mockResolvedValue([
      {
        id: 'dr-1',
        tenant_id: tenantAlpha.id,
        code: 'DR-001',
        name: 'سيد السائق',
        mobile: '01099887766',
        license_number: 'LIC-900',
        is_active: true,
        archived_at: null,
      },
    ]);

    mockListCommissionLists.mockResolvedValue([
      {
        id: 'ccl-0',
        tenant_id: tenantAlpha.id,
        code: '0',
        name: 'قائمة العمولات الافتراضية للمناديب',
        description: null,
        is_system_default: true,
        is_active: true,
        archived_at: null,
        created_at: '2026-11-18T10:00:00Z',
      },
    ]);

    mockListCommissionRules.mockResolvedValue([
      {
        id: 'ccr-1',
        tenant_id: tenantAlpha.id,
        commission_list_id: 'ccl-0',
        governorate_id: 'gov-1',
        region_id: 'reg-1',
        commission_type: 'delivery_percent',
        commission_value: 20,
        valid_from: null,
        valid_to: null,
        is_active: true,
        notes: null,
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
        default_route_id: 'rt-general',
        commission_list_id: 'ccl-0',
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
  });

  it('renders 6 courier sidebar sections, lists couriers, pre-fills CR-002 on /couriers/new, and saves courier', async () => {
    mockSaveCourier.mockResolvedValue('cr-2');

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/couriers']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('كابتن طارق')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', {name: 'قائمة المندوبين'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'إنشاء مندوب'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'قوائم عمولات المندوبين'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'خطوط سير المندوبين'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'قيد التسوية مع المندوبين'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'تحركات مندوب الشحن'})).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'إنشاء مندوب جديد'}));
    expect(screen.getByLabelText(/كود المندوب/)).toHaveValue('CR-002');
    expect(screen.getByLabelText(/خط السير/)).toHaveValue('rt-general');
    expect(screen.getByLabelText(/قائمة العمولات/)).toHaveValue('ccl-0');

    fireEvent.change(screen.getByLabelText(/^اسم المندوب/), {target: {value: 'كابتن كريم'}});
    fireEvent.change(screen.getByLabelText(/^رقم الموبايل/), {target: {value: '01233445566'}});
    fireEvent.click(screen.getByRole('button', {name: 'حفظ المندوب'}));

    await waitFor(() => {
      expect(mockSaveCourier).toHaveBeenCalledTimes(1);
    });
  });

  it('renders CommissionListsPage and evaluates ADR-012 commission cascade via server RPC', async () => {
    mockCalculateCourierCommission.mockResolvedValue({
      accrual_trigger: 'on_delivery',
      match_tier: 'region_rule',
      courier_id: 'cr-1',
      courier_code: 'CR-001',
      courier_name: 'كابتن طارق',
      commission_list_id: 'ccl-0',
      rule_id: 'ccr-1',
      commission_type: 'delivery_percent',
      commission_value: 20,
      delivery_fee_base: 70,
      collection_fee_base: 15,
      commission_base_amount: 70,
      commission_amount: 14,
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/couriers/commissions']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('قائمة العمولات الافتراضية للمناديب')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('table')).toBeInTheDocument();
    });
    expect(within(screen.getByRole('table')).getByText('مدينة نصر')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'احتساب العمولة من الخادم'}));

    await waitFor(() => {
      expect(mockCalculateCourierCommission).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('المستوى 1: قاعدة المنطقة المحددة')).toBeInTheDocument();
    expect(screen.getByText('14.00 ج.م')).toBeInTheDocument();
  });

  it('creates a commission list without restarting the data-loading effect', async () => {
    mockSaveCommissionList.mockResolvedValue('ccl-new');

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/couriers/commissions']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('قائمة العمولات الافتراضية للمناديب')).toBeInTheDocument();
      expect(mockListCommissionLists).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', {name: 'إنشاء قائمة عمولات جديدة'}));
    fireEvent.change(screen.getByLabelText(/^اسم قائمة العمولات/), {
      target: {value: 'عمولات القاهرة'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'حفظ القائمة'}));

    await waitFor(() => {
      expect(mockSaveCommissionList).toHaveBeenCalledTimes(1);
      expect(mockListCommissionLists).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mockListCommissionLists).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('تم إنشاء قائمة العمولات بنجاح.');
  });

  it('renders CourierRoutesPage with stops, vehicles, and drivers tabs', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/couriers/routes']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('خط السير العام — كافة أنحاء الجمهورية')).toBeInTheDocument();
    });
    expect(within(screen.getByRole('table')).getByText('مدينة نصر')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /السيارات/}));
    expect(screen.getByText('سوزوكي فان 2025')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /السائقون/}));
    expect(screen.getByText('سيد السائق')).toBeInTheDocument();
  });

  it('renders CourierSettlementsPage and CourierMovementsPage cleanly', async () => {
    const {unmount} = render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/couriers/settlements']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'قيد التسوية مع المندوبين'})).toBeInTheDocument();
    });
    expect(screen.getByText('ملخص عهد وعمولات المناديب')).toBeInTheDocument();
    expect(screen.getByText('سجل سندات صرف عمولات المناديب (CMP)')).toBeInTheDocument();
    unmount();

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/couriers/movements']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'تحركات مندوب الشحن'})).toBeInTheDocument();
    });
    expect(screen.getByText(/تفعيل الخريطة في المرحلة 14/)).toBeInTheDocument();
  });
});
