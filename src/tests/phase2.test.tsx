import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {generateNextCode} from '@/features/definitions/definitionsService';
import {AccountSubjectType} from '@/types/common';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';

const mockUseAuth = vi.fn();
const mockSummaryCounts = vi.fn();
const mockListBranches = vi.fn();
const mockListCountries = vi.fn();
const mockListGovernorates = vi.fn();
const mockListCities = vi.fn();
const mockListRegions = vi.fn();
const mockListShipmentTypes = vi.fn();
const mockListShippingServices = vi.fn();
const mockListChartOfAccounts = vi.fn();
const mockListExceptionReasons = vi.fn();
const mockListCashboxes = vi.fn();
const mockListCashboxCustodians = vi.fn();
const mockListTenantStaffMemberships = vi.fn();

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
    listCountries: (...args: unknown[]) => mockListCountries(...args),
    listGovernorates: (...args: unknown[]) => mockListGovernorates(...args),
    listCities: (...args: unknown[]) => mockListCities(...args),
    listRegions: (...args: unknown[]) => mockListRegions(...args),
    listShipmentTypes: (...args: unknown[]) => mockListShipmentTypes(...args),
    listShippingServices: (...args: unknown[]) => mockListShippingServices(...args),
    listChartOfAccounts: (...args: unknown[]) => mockListChartOfAccounts(...args),
    listExceptionReasons: (...args: unknown[]) => mockListExceptionReasons(...args),
    listCashboxes: (...args: unknown[]) => mockListCashboxes(...args),
    listCashboxCustodians: (...args: unknown[]) => mockListCashboxCustodians(...args),
    listTenantStaffMemberships: (...args: unknown[]) => mockListTenantStaffMemberships(...args),
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

describe('Phase 2: Definitions, Geography, Branches, Services & Cashboxes', () => {
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

    mockSummaryCounts.mockResolvedValue({
      branchesCount: 1,
      activeGovernoratesCount: 27,
      activeRegionsCount: 64,
      activeServicesCount: 2,
      activeCashboxesCount: 1,
      activeExceptionReasonsCount: 12,
    });

    mockListCountries.mockResolvedValue([
      {
        id: 'cnt-eg',
        tenant_id: tenantAlpha.id,
        code: 'EG',
        name: 'جمهورية مصر العربية',
        iso2: 'EG',
        is_default: true,
        is_active: true,
      },
    ]);

    mockListBranches.mockResolvedValue([
      {
        id: 'br-1',
        tenant_id: tenantAlpha.id,
        code: 'BR-001',
        name: 'الفرع الرئيسي',
        is_main: true,
        is_active: true,
        country_id: 'cnt-eg',
        governorate_id: 'gov-1',
        city_id: 'cit-1',
        region_id: 'reg-1',
        phone: '01000000000',
        fax: null,
        address_line: 'مدينة نصر',
        archived_at: null,
        created_at: '2026-11-18T10:00:00Z',
      },
    ]);

    mockListGovernorates.mockResolvedValue([
      {
        id: 'gov-1',
        tenant_id: tenantAlpha.id,
        country_id: 'cnt-eg',
        code: 'EG-01',
        name: 'القاهرة',
        default_branch_id: 'br-1',
        is_active: true,
      },
      {
        id: 'gov-2',
        tenant_id: tenantAlpha.id,
        country_id: 'cnt-eg',
        code: 'EG-02',
        name: 'الجيزة',
        default_branch_id: 'br-1',
        is_active: true,
      },
    ]);

    mockListCities.mockResolvedValue([
      {
        id: 'cit-1',
        tenant_id: tenantAlpha.id,
        governorate_id: 'gov-1',
        code: 'EG-01-C01',
        name: 'مدينة القاهرة',
        is_active: true,
      },
    ]);

    mockListRegions.mockResolvedValue([
      {
        id: 'reg-1',
        tenant_id: tenantAlpha.id,
        governorate_id: 'gov-1',
        city_id: 'cit-1',
        code: 'EG-01-R01',
        name: 'مدينة نصر',
        default_branch_id: 'br-1',
        is_active: true,
      },
    ]);
  });

  it('generates sequential codes cleanly from existing records', () => {
    expect(generateNextCode('BR', ['BR-001', 'BR-004'])).toBe('BR-005');
    expect(generateNextCode('SRV', [])).toBe('SRV-001');
  });

  it('displays Phase 2 KPI cards inside the tenant workspace overview', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('27')).toBeInTheDocument();
    });
    expect(screen.getByText('الفروع النشطة')).toBeInTheDocument();
    expect(screen.getByText('التعريفات الأساسية')).toBeInTheDocument();
  });

  it('renders branches list and pre-fills next generated code on create', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/definitions/branches']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('الفرع الرئيسي')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', {name: 'إضافة فرع جديد'}));
    expect(screen.getByLabelText('كود الفرع')).toHaveValue('BR-002');
    expect(screen.queryByText('الفرع الرئيسي')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders master-detail Egyptian governorates and their regions', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/definitions/geography']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: /محافظة القاهرة/})).toBeInTheDocument();
    });
    expect(screen.getByText('مدينة نصر')).toBeInTheDocument();
  });

  it('renders shipping services with multi-select ShipmentTypes in form', async () => {
    mockListShipmentTypes.mockResolvedValue([
      {id: 'st-1', tenant_id: tenantAlpha.id, code: 'FDP', name: 'تسليم كامل للطرد', description: null, is_system: true, is_active: true},
      {id: 'st-2', tenant_id: tenantAlpha.id, code: 'PTP', name: 'طرد مقابل طرد - استبدال', description: null, is_system: true, is_active: true},
    ]);
    mockListChartOfAccounts.mockResolvedValue([
      {id: 'acc-1', tenant_id: tenantAlpha.id, code: '4101', name: 'إيرادات النقل والتوصيل', account_type: 'revenue', parent_id: null, is_group: false, is_system: true, is_active: true},
    ]);
    mockListShippingServices.mockResolvedValue([
      {
        id: 'srv-1',
        tenant_id: tenantAlpha.id,
        code: 'SRV-001',
        name: 'التوصيل القياسي',
        estimated_days_min: 2,
        estimated_days_max: 4,
        branch_id: 'br-1',
        delivery_revenue_account_id: 'acc-1',
        collection_revenue_account_id: 'acc-1',
        courier_commission_account_id: 'acc-1',
        is_active: true,
        archived_at: null,
        shipment_type_ids: ['st-1', 'st-2'],
      },
    ]);

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/definitions/services']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('التوصيل القياسي')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', {name: 'إضافة خدمة شحن'}));
    expect(screen.getByText(/تسليم كامل للطرد/)).toBeInTheDocument();
    expect(screen.getByText(/طرد مقابل طرد - استبدال/)).toBeInTheDocument();
  });

  it('renders cashboxes and custodians panel', async () => {
    mockListChartOfAccounts.mockResolvedValue([
      {id: 'acc-cash', tenant_id: tenantAlpha.id, code: '1101', name: 'الخزينة الرئيسية', account_type: 'asset', parent_id: null, is_group: false, is_system: true, is_active: true},
    ]);
    mockListCashboxes.mockResolvedValue([
      {
        id: 'box-1',
        tenant_id: tenantAlpha.id,
        code: 'CSH-001',
        name: 'الخزينة الرئيسية',
        branch_id: 'br-1',
        ledger_account_id: 'acc-cash',
        is_active: true,
        allow_deposit: true,
        allow_withdraw: true,
        allow_transfer_in: true,
        allow_transfer_out: true,
        archived_at: null,
      },
    ]);
    mockListCashboxCustodians.mockResolvedValue([
      {
        id: 'cust-1',
        tenant_id: tenantAlpha.id,
        cashbox_id: 'box-1',
        membership_id: membershipAlpha.id,
        is_active: true,
        created_at: '2026-11-18T10:00:00Z',
      },
    ]);
    mockListTenantStaffMemberships.mockResolvedValue([
      {
        id: membershipAlpha.id,
        username: 'admin',
        role_key: 'company_owner',
        is_active: true,
        display_name: 'مالك ألفا',
      },
    ]);

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/definitions/cashboxes']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('CSH-001')).toBeInTheDocument();
    });
    expect(screen.getByText(/أمناء الخزينة: الخزينة الرئيسية/)).toBeInTheDocument();
    expect(screen.getAllByText('مالك ألفا').length).toBeGreaterThanOrEqual(2);
  });
});
