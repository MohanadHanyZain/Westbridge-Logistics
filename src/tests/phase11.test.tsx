import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {hasEffectivePermission} from '@/lib/permissions';
import {AccountSubjectType, PermissionScope} from '@/types/common';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';

const mockUseAuth = vi.fn();
const mockGetMyTenantPermissions = vi.fn();

// Tenant storefront & registration settings mocks
const mockFetchPublicTenantStorefront = vi.fn();
const mockSubmitClientRegistrationRequest = vi.fn();
const mockGetTenantRegistrationSettings = vi.fn();
const mockUpdateTenantRegistrationSettings = vi.fn();

// Client portal mocks
const mockGetClientPortalSummary = vi.fn();
const mockGetClientAccountStatement = vi.fn();
const mockListClientPickupRequests = vi.fn();
const mockCreateClientPickupRequest = vi.fn();
const mockCancelClientPickupRequest = vi.fn();
const mockSaveMyClientAddress = vi.fn();
const mockDeleteMyClientAddress = vi.fn();

// Supporting service mocks
const mockListShipments = vi.fn();
const mockListClients = vi.fn();
const mockListClientAddresses = vi.fn();
const mockListClientRegistrationRequests = vi.fn();
const mockListClientUnsettledShipments = vi.fn();
const mockListGovernorates = vi.fn();
const mockListRegions = vi.fn();
const mockListBranches = vi.fn();
const mockListChartOfAccounts = vi.fn();
const mockListCountries = vi.fn();
const mockListOperationalRefs = vi.fn();
const mockListShipmentTypes = vi.fn();
const mockListClientPriceLists = vi.fn();
const mockListTaxProfiles = vi.fn();

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

vi.mock('@/features/tenants/tenantService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/tenants/tenantService')>();
  return {
    ...actual,
    fetchPublicTenantStorefront: (...args: unknown[]) => mockFetchPublicTenantStorefront(...args),
    submitClientRegistrationRequest: (...args: unknown[]) => mockSubmitClientRegistrationRequest(...args),
    getTenantRegistrationSettings: (...args: unknown[]) => mockGetTenantRegistrationSettings(...args),
    updateTenantRegistrationSettings: (...args: unknown[]) => mockUpdateTenantRegistrationSettings(...args),
  };
});

vi.mock('@/features/clients/clientPortalService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/clients/clientPortalService')>();
  return {
    ...actual,
    getClientPortalSummary: (...args: unknown[]) => mockGetClientPortalSummary(...args),
    getClientAccountStatement: (...args: unknown[]) => mockGetClientAccountStatement(...args),
    listClientPickupRequests: (...args: unknown[]) => mockListClientPickupRequests(...args),
    createClientPickupRequest: (...args: unknown[]) => mockCreateClientPickupRequest(...args),
    cancelClientPickupRequest: (...args: unknown[]) => mockCancelClientPickupRequest(...args),
    saveMyClientAddress: (...args: unknown[]) => mockSaveMyClientAddress(...args),
    deleteMyClientAddress: (...args: unknown[]) => mockDeleteMyClientAddress(...args),
  };
});

vi.mock('@/features/clients/clientsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/clients/clientsService')>();
  return {
    ...actual,
    listClients: (...args: unknown[]) => mockListClients(...args),
    listClientAddresses: (...args: unknown[]) => mockListClientAddresses(...args),
    listClientRegistrationRequests: (...args: unknown[]) => mockListClientRegistrationRequests(...args),
  };
});

vi.mock('@/features/finance/financeService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/finance/financeService')>();
  return {
    ...actual,
    listClientUnsettledShipments: (...args: unknown[]) => mockListClientUnsettledShipments(...args),
  };
});

vi.mock('@/features/shipments/shipmentsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/shipments/shipmentsService')>();
  return {
    ...actual,
    listShipments: (...args: unknown[]) => mockListShipments(...args),
  };
});

vi.mock('@/features/definitions/definitionsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/definitions/definitionsService')>();
  return {
    ...actual,
    listGovernorates: (...args: unknown[]) => mockListGovernorates(...args),
    listRegions: (...args: unknown[]) => mockListRegions(...args),
    listBranches: (...args: unknown[]) => mockListBranches(...args),
    listChartOfAccounts: (...args: unknown[]) => mockListChartOfAccounts(...args),
    listCountries: (...args: unknown[]) => mockListCountries(...args),
    listOperationalRefs: (...args: unknown[]) => mockListOperationalRefs(...args),
    listShipmentTypes: (...args: unknown[]) => mockListShipmentTypes(...args),
  };
});

vi.mock('@/features/pricing/pricingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/pricing/pricingService')>();
  return {
    ...actual,
    listClientPriceLists: (...args: unknown[]) => mockListClientPriceLists(...args),
    listTaxProfiles: (...args: unknown[]) => mockListTaxProfiles(...args),
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

const clientMembership: TenantMembershipRecord = {
  id: 'mem-client-1',
  tenant_id: tenantAlpha.id,
  user_id: 'user-client-1',
  username: 'nile_store',
  account_subject_type: AccountSubjectType.CLIENT,
  role_key: 'client_owner',
  is_active: true,
  must_change_password: false,
  tenants: tenantAlpha,
};

const adminMembership: TenantMembershipRecord = {
  id: 'mem-admin-1',
  tenant_id: tenantAlpha.id,
  user_id: 'user-admin-1',
  username: 'admin',
  account_subject_type: AccountSubjectType.STAFF,
  role_key: 'company_owner',
  is_active: true,
  must_change_password: false,
  tenants: tenantAlpha,
};

function setupClientAuth() {
  mockUseAuth.mockReturnValue({
    session: {user: {id: 'user-client-1'}},
    user: {id: 'user-client-1'},
    profile: {id: 'user-client-1', display_name: 'متجر النيل', avatar_path: null, is_platform_user: false, is_active: true},
    platformAdmin: null,
    memberships: [clientMembership],
    loading: false,
    isConfigured: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
    refreshContext: vi.fn(),
  });
  mockGetMyTenantPermissions.mockResolvedValue({
    client_id: 'client-1',
    branch_ids: [],
    permissions: [
      {permission_key: 'dashboard.view', scope: PermissionScope.OWN},
      {permission_key: 'shipments.read', scope: PermissionScope.OWN},
      {permission_key: 'shipments.create', scope: PermissionScope.OWN},
    ],
  });
}

function setupAdminAuth() {
  mockUseAuth.mockReturnValue({
    session: {user: {id: 'user-admin-1'}},
    user: {id: 'user-admin-1'},
    profile: {id: 'user-admin-1', display_name: 'مالك ألفا', avatar_path: null, is_platform_user: false, is_active: true},
    platformAdmin: null,
    memberships: [adminMembership],
    loading: false,
    isConfigured: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
    refreshContext: vi.fn(),
  });
  mockGetMyTenantPermissions.mockResolvedValue({
    client_id: null,
    branch_ids: ['br-1'],
    permissions: [],
  });
}

describe('Phase 11: Client Portal, Pickup Requests, Statement & Public Storefront', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({
      session: null,
      user: null,
      profile: null,
      platformAdmin: null,
      memberships: [],
      loading: false,
      isConfigured: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });
    mockListGovernorates.mockResolvedValue([
      {id: 'gov-1', tenant_id: tenantAlpha.id, country_id: 'cnt-1', code: 'EG-01', name: 'القاهرة', default_branch_id: null, is_active: true},
    ]);
    mockListRegions.mockResolvedValue([
      {id: 'reg-1', tenant_id: tenantAlpha.id, governorate_id: 'gov-1', city_id: null, code: 'EG-01-R1', name: 'مدينة نصر', default_branch_id: null, is_active: true},
    ]);
    mockListBranches.mockResolvedValue([]);
    mockListChartOfAccounts.mockResolvedValue([]);
    mockListCountries.mockResolvedValue([]);
    mockListOperationalRefs.mockResolvedValue({paymentTerms: [], deliveryTypes: []});
    mockListShipmentTypes.mockResolvedValue([]);
    mockListClientPriceLists.mockResolvedValue([]);
    mockListTaxProfiles.mockResolvedValue([]);
    mockListClients.mockResolvedValue([]);
    mockListClientRegistrationRequests.mockResolvedValue([]);
    mockListShipments.mockResolvedValue([]);
    mockListClientAddresses.mockResolvedValue([]);
    mockListClientPickupRequests.mockResolvedValue([]);
    mockListClientUnsettledShipments.mockResolvedValue([]);
  });

  it('allows OWN-scope client permission checks even when branchId is supplied', () => {
    const allowed = hasEffectivePermission(
      'client_owner',
      [{permission_key: 'shipments.create', scope: PermissionScope.OWN}],
      'shipments.create',
      [],
      'br-1',
    );
    expect(allowed).toBe(true);
  });

  it('renders public storefront services, coverage, and submits auto-approved self-registration', async () => {
    mockFetchPublicTenantStorefront.mockResolvedValue({
      tenant: {
        id: tenantAlpha.id,
        slug: tenantAlpha.slug,
        name: tenantAlpha.name,
        status: 'active',
        default_timezone: 'Africa/Cairo',
        default_currency: 'EGP',
        default_locale: 'ar-EG',
        allow_client_self_registration: true,
        auto_approve_clients: true,
        brand_logo_path: null,
        public_tagline: 'شحن وتوصيل سريع لجميع المحافظات خلال 24 ساعة.',
        public_support_phone: '19999',
        public_support_email: 'support@alpha-express.test',
      },
      services: [
        {id: 'srv-1', code: 'STD', name: 'توصيل قياسي', estimated_days_min: 1, estimated_days_max: 2},
      ],
      governorates: [{id: 'gov-1', code: 'EG-01', name: 'القاهرة'}],
      regions: [{id: 'reg-1', governorate_id: 'gov-1', code: 'EG-01-R1', name: 'مدينة نصر'}],
    });
    mockSubmitClientRegistrationRequest.mockResolvedValue({
      request_id: 'req-1',
      status: 'approved',
      auto_approved: true,
      client_id: 'cl-new-1',
      client_code: 'CL-0001',
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('شحن وتوصيل سريع لجميع المحافظات خلال 24 ساعة.')).toBeInTheDocument();
    });
    expect(screen.getByText('توصيل قياسي')).toBeInTheDocument();
    expect(screen.getByText('19999')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('اسم المتجر / النشاط *'), {target: {value: 'متجر الزهور'}});
    fireEvent.change(screen.getByLabelText('البريد الإلكتروني *'), {target: {value: 'flowers@store.test'}});
    fireEvent.change(screen.getByLabelText('رقم الهاتف / الموبايل *'), {target: {value: '01012345678'}});
    fireEvent.change(screen.getByLabelText('عنوان الالتقاط بالتفصيل *'), {target: {value: 'شارع الطيران مدينة نصر'}});

    fireEvent.click(screen.getByRole('button', {name: 'إرسال طلب تسجيل التاجر'}));

    await waitFor(() => {
      expect(mockSubmitClientRegistrationRequest).toHaveBeenCalledWith(
        'alpha-express',
        expect.objectContaining({
          company_name: 'متجر الزهور',
          email: 'flowers@store.test',
          phone: '01012345678',
          address_line: 'شارع الطيران مدينة نصر',
        }),
      );
    });
    expect(screen.getByText(/تم قبول وتفعيل ملف التاجر تلقائيًا بكود \(CL-0001\)/)).toBeInTheDocument();
  });

  it('renders dedicated Client Portal sidebar, KPIs, and period switching when logged in as client', async () => {
    setupClientAuth();
    mockGetClientPortalSummary.mockResolvedValue({
      client: {
        id: 'client-1',
        code: 'CL-001',
        name: 'متجر النيل',
        payout_method: 'cash',
        default_price_mode: 'shipping_excluded',
        governorate_name: 'القاهرة',
        region_name: 'مدينة نصر',
      },
      period: 'all',
      total_shipments: 18,
      in_progress_count: 5,
      delivered_count: 11,
      returned_count: 2,
      total_shipping_fees: 950,
      cod_collected_amount: 8400,
      in_flight_cod_amount: 1200,
      ready_unsettled_count: 4,
      ready_net_settlement_amount: 3150,
      total_settled_payout_amount: 4200,
      pending_pickup_requests_count: 1,
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/portal']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: /مرحبًا، متجر النيل/})).toBeInTheDocument();
    });

    // Dedicated client navigation visible; staff-only admin sections hidden
    expect(screen.getByRole('link', {name: 'طلبات الالتقاط والعناوين'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'قيد التسوية وكشف الحساب'})).toBeInTheDocument();
    expect(screen.queryByText('الأمان')).not.toBeInTheDocument();
    expect(screen.queryByText('التعريفات الأساسية')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('3150.00 EGP')).toBeInTheDocument();
    });
    expect(screen.getByText('1200.00 EGP')).toBeInTheDocument();

    // Switch period filter to 7d
    fireEvent.click(screen.getByRole('button', {name: 'آخر 7 أيام'}));
    await waitFor(() => {
      expect(mockGetClientPortalSummary).toHaveBeenCalledWith(tenantAlpha.id, 'client-1', '7d');
    });
  });

  it('allows merchant to submit & cancel pickup requests and save pickup addresses', async () => {
    setupClientAuth();
    mockListClientAddresses.mockResolvedValue([
      {
        id: 'addr-1',
        tenant_id: tenantAlpha.id,
        client_id: 'client-1',
        label: 'المخزن الرئيسي',
        governorate_id: 'gov-1',
        city_id: null,
        region_id: 'reg-1',
        address_line: 'عباس العقاد 10',
        phone: '01099887766',
        is_default: true,
        is_active: true,
      },
    ]);
    mockListClientPickupRequests.mockResolvedValue([
      {
        id: 'req-1',
        tenant_id: tenantAlpha.id,
        request_code: 'REQ-000001',
        client_id: 'client-1',
        address_id: 'addr-1',
        branch_id: null,
        governorate_id: 'gov-1',
        region_id: 'reg-1',
        pickup_address: 'عباس العقاد 10',
        contact_phone: '01099887766',
        preferred_date: '2026-11-21',
        preferred_time_slot: '10:00-14:00',
        estimated_shipments_count: 4,
        notes: null,
        status: 'pending',
        pickup_list_id: null,
        created_at: '2026-11-20T10:00:00Z',
        updated_at: '2026-11-20T10:00:00Z',
      },
    ]);
    mockCreateClientPickupRequest.mockResolvedValue('req-2');
    mockCancelClientPickupRequest.mockResolvedValue(undefined);
    mockSaveMyClientAddress.mockResolvedValue('addr-2');

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/portal/pickups']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('REQ-000001')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('عدد الشحنات التقديري *'), {target: {value: '6'}});
    fireEvent.click(screen.getByRole('button', {name: 'إرسال طلب الالتقاط'}));

    await waitFor(() => {
      expect(mockCreateClientPickupRequest).toHaveBeenCalledWith(
        tenantAlpha.id,
        expect.objectContaining({
          estimated_shipments_count: 6,
          pickup_address: 'عباس العقاد 10',
        }),
      );
    });

    fireEvent.click(screen.getByRole('button', {name: 'إلغاء الطلب'}));
    await waitFor(() => {
      expect(mockCancelClientPickupRequest).toHaveBeenCalledWith(tenantAlpha.id, 'req-1');
    });

    // Switch to Saved Addresses tab & add a branch address
    fireEvent.click(screen.getByRole('button', {name: /عناوين الالتقاط/}));
    fireEvent.change(screen.getByLabelText('تسمية العنوان *'), {target: {value: 'فرع المعادي'}});
    fireEvent.change(screen.getByLabelText('العنوان التفصيلي *'), {target: {value: 'شارع 9 المعادي'}});
    fireEvent.click(screen.getByRole('button', {name: 'حفظ العنوان'}));

    await waitFor(() => {
      expect(mockSaveMyClientAddress).toHaveBeenCalledWith(
        tenantAlpha.id,
        expect.objectContaining({
          label: 'فرع المعادي',
          address_line: 'شارع 9 المعادي',
        }),
      );
    });
  });

  it('displays merchant unsettled shipments and filtered account statement ledger', async () => {
    setupClientAuth();
    mockListClientUnsettledShipments.mockResolvedValue([
      {
        shipment_id: 'shp-1',
        shipment_number: 'SHP-0000005',
        operational_status: 'delivered',
        payment_term_code: 'COD',
        delivered_at: '2026-11-20T09:00:00Z',
        cod_collected_amount: 1000,
        shipping_fee_deducted: 65,
        return_fee_deducted: 0,
        net_client_amount: 935,
      },
    ]);
    mockGetClientAccountStatement.mockResolvedValue({
      client: {id: 'client-1', code: 'CL-001', name: 'متجر النيل', payout_method: 'cash'},
      currency: 'EGP',
      date_from: null,
      date_to: null,
      opening_balance: 0,
      total_credits: 940,
      total_debits: 940,
      closing_balance: 0,
      ready_unsettled_net: 935,
      in_flight_cod_amount: 500,
      entries: [
        {
          row_id: 'stl-1:entitlement',
          entry_date: '2026-11-19',
          reference_code: 'CST-000001',
          entry_type: 'settlement_entitlement',
          description: 'استحقاق تسوية شحنات (CST-000001)',
          credit_amount: 940,
          debit_amount: 0,
          running_balance: 940,
          payout_method: 'cash',
          payout_reference: null,
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/portal/finance']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('SHP-0000005')).toBeInTheDocument();
    });
    expect(screen.getByText('935.00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'كشف الحساب والتسويات'}));
    expect(screen.getByText('CST-000001')).toBeInTheDocument();
    expect(screen.getByText('استحقاق تسوية شحنات (CST-000001)')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('من تاريخ'), {target: {value: '2026-11-01'}});
    await waitFor(() => {
      expect(mockGetClientAccountStatement).toHaveBeenCalledWith(
        tenantAlpha.id,
        'client-1',
        '2026-11-01',
        null,
      );
    });
  });

  it('allows admin to configure self-registration and auto-approval on registrations page', async () => {
    setupAdminAuth();
    mockGetTenantRegistrationSettings.mockResolvedValue({
      tenant_id: tenantAlpha.id,
      allow_client_self_registration: false,
      auto_approve_clients: false,
      public_tagline: '',
      public_support_phone: '',
      public_support_email: '',
    });
    mockUpdateTenantRegistrationSettings.mockResolvedValue({
      tenant_id: tenantAlpha.id,
      allow_client_self_registration: true,
      auto_approve_clients: true,
      public_tagline: 'توصيل لكل مصر',
      public_support_phone: '19000',
      public_support_email: null,
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/clients/registrations']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('إعدادات الموقع العام والتسجيل الذاتي للتجار')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/تفعيل التسجيل الذاتي للتجار عبر الموقع العام/));
    fireEvent.click(screen.getByLabelText(/الاعتماد التلقائي الفوري للتجار الجدد/));
    fireEvent.change(screen.getByLabelText('الوصف التعريفي بالموقع العام للشركة'), {
      target: {value: 'توصيل لكل مصر'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'حفظ إعدادات الموقع العام'}));

    await waitFor(() => {
      expect(mockUpdateTenantRegistrationSettings).toHaveBeenCalledWith(
        tenantAlpha.id,
        expect.objectContaining({
          allow_client_self_registration: true,
          auto_approve_clients: true,
          public_tagline: 'توصيل لكل مصر',
        }),
      );
    });
  });
});
