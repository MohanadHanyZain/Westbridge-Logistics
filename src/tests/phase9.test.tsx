import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {AccountSubjectType, PermissionScope} from '@/types/common';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';

const mockUseAuth = vi.fn();
const mockGetMyTenantPermissions = vi.fn();
const mockListBranches = vi.fn();
const mockListClients = vi.fn();
const mockListTaxProfiles = vi.fn();
const mockListCouriers = vi.fn();
const mockListCourierRoutes = vi.fn();
const mockListCommissionLists = vi.fn();

const mockGetTenantFinancePolicy = vi.fn();
const mockUpdateTenantFinancePolicy = vi.fn();
const mockGetCashboxesWithBalances = vi.fn();
const mockListCashboxTransactions = vi.fn();
const mockListCashboxTransfers = vi.fn();
const mockCreateCashboxTransfer = vi.fn();
const mockApproveCashboxTransfer = vi.fn();
const mockListCashboxVouchers = vi.fn();
const mockCreateCashboxVoucher = vi.fn();
const mockApproveCashboxVoucher = vi.fn();
const mockGetCourierCustodyOverview = vi.fn();
const mockListCourierUncollectedCashShipments = vi.fn();
const mockListCourierCollectionVouchers = vi.fn();
const mockCreateCourierCollectionVoucher = vi.fn();
const mockApproveCourierCollectionVoucher = vi.fn();
const mockGetClientsSettlementOverview = vi.fn();
const mockListClientUnsettledShipments = vi.fn();
const mockListClientSettlements = vi.fn();
const mockCreateClientSettlement = vi.fn();
const mockApproveClientSettlement = vi.fn();
const mockListCourierPayableCommissions = vi.fn();
const mockListCourierCommissionPayouts = vi.fn();
const mockCreateCourierCommissionPayout = vi.fn();
const mockApproveCourierCommissionPayout = vi.fn();

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
    listTaxProfiles: (...args: unknown[]) => mockListTaxProfiles(...args),
  };
});

vi.mock('@/features/couriers/couriersService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/couriers/couriersService')>();
  return {
    ...actual,
    listCouriers: (...args: unknown[]) => mockListCouriers(...args),
    listCourierRoutes: (...args: unknown[]) => mockListCourierRoutes(...args),
    listCommissionLists: (...args: unknown[]) => mockListCommissionLists(...args),
  };
});

vi.mock('@/features/finance/financeService', () => ({
  getTenantFinancePolicy: (...args: unknown[]) => mockGetTenantFinancePolicy(...args),
  updateTenantFinancePolicy: (...args: unknown[]) => mockUpdateTenantFinancePolicy(...args),
  getCashboxesWithBalances: (...args: unknown[]) => mockGetCashboxesWithBalances(...args),
  listCashboxTransactions: (...args: unknown[]) => mockListCashboxTransactions(...args),
  listCashboxTransfers: (...args: unknown[]) => mockListCashboxTransfers(...args),
  createCashboxTransfer: (...args: unknown[]) => mockCreateCashboxTransfer(...args),
  approveCashboxTransfer: (...args: unknown[]) => mockApproveCashboxTransfer(...args),
  listCashboxVouchers: (...args: unknown[]) => mockListCashboxVouchers(...args),
  createCashboxVoucher: (...args: unknown[]) => mockCreateCashboxVoucher(...args),
  approveCashboxVoucher: (...args: unknown[]) => mockApproveCashboxVoucher(...args),
  getCourierCustodyOverview: (...args: unknown[]) => mockGetCourierCustodyOverview(...args),
  listCourierUncollectedCashShipments: (...args: unknown[]) => mockListCourierUncollectedCashShipments(...args),
  listCourierCollectionVouchers: (...args: unknown[]) => mockListCourierCollectionVouchers(...args),
  createCourierCollectionVoucher: (...args: unknown[]) => mockCreateCourierCollectionVoucher(...args),
  approveCourierCollectionVoucher: (...args: unknown[]) => mockApproveCourierCollectionVoucher(...args),
  getClientsSettlementOverview: (...args: unknown[]) => mockGetClientsSettlementOverview(...args),
  listClientUnsettledShipments: (...args: unknown[]) => mockListClientUnsettledShipments(...args),
  listClientSettlements: (...args: unknown[]) => mockListClientSettlements(...args),
  createClientSettlement: (...args: unknown[]) => mockCreateClientSettlement(...args),
  approveClientSettlement: (...args: unknown[]) => mockApproveClientSettlement(...args),
  listCourierPayableCommissions: (...args: unknown[]) => mockListCourierPayableCommissions(...args),
  listCourierCommissionPayouts: (...args: unknown[]) => mockListCourierCommissionPayouts(...args),
  createCourierCommissionPayout: (...args: unknown[]) => mockCreateCourierCommissionPayout(...args),
  approveCourierCommissionPayout: (...args: unknown[]) => mockApproveCourierCommissionPayout(...args),
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
  user_id: 'user-owner-1',
  username: 'admin',
  account_subject_type: AccountSubjectType.STAFF,
  role_key: 'company_owner',
  is_active: true,
  must_change_password: false,
  tenants: tenantAlpha,
};

const membershipCashier: TenantMembershipRecord = {
  id: 'bbbb2222-2222-2222-2222-222222222222',
  tenant_id: tenantAlpha.id,
  user_id: 'user-cashier-2',
  username: 'cashier1',
  account_subject_type: AccountSubjectType.STAFF,
  role_key: 'branch_cashier',
  is_active: true,
  must_change_password: false,
  tenants: tenantAlpha,
};

describe('Phase 9: Finance, Cashboxes, Collections, Client & Courier Settlements (ADR-012 / ADR-016 / ADR-018)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseAuth.mockReturnValue({
      session: {user: {id: 'user-owner-1'}},
      user: {id: 'user-owner-1'},
      profile: {
        id: 'user-owner-1',
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
      branch_ids: ['br-1'],
      permissions: [{permission_key: 'finance.payouts.approve', scope: PermissionScope.TENANT}],
    });

    mockListBranches.mockResolvedValue([
      {
        id: 'br-1',
        tenant_id: tenantAlpha.id,
        code: 'CAI',
        name: 'فرع القاهرة',
        governorate_id: null,
        region_id: null,
        address_line: 'مدينة نصر',
        phone: null,
        manager_name: null,
        is_hub: true,
        is_active: true,
      },
    ]);

    mockListClients.mockResolvedValue([
      {
        id: 'cl-1',
        tenant_id: tenantAlpha.id,
        code: 'CL-001',
        name: 'متجر النيل',
        branch_id: 'br-1',
        ledger_account_id: null,
        country_id: null,
        governorate_id: null,
        city_id: null,
        region_id: null,
        price_list_id: 'pl-0',
        tax_profile_id: 'tax-none',
        default_payment_term_id: null,
        default_shipment_type_id: null,
        default_price_mode: 'shipping_excluded',
        allow_package_opening: false,
        client_category: null,
        activity_type: null,
        trade_direction: null,
        payout_method: 'cash',
        bank_name: null,
        bank_account_number: null,
        wallet_phone: null,
        phone: null,
        mobile: '01012345678',
        po_box: null,
        postal_code: null,
        address_line: null,
        email: null,
        approval_status: 'approved',
        is_active: true,
        archived_at: null,
        created_at: '2026-11-19T10:00:00Z',
      },
    ]);

    mockListTaxProfiles.mockResolvedValue([
      {id: 'tax-none', tenant_id: tenantAlpha.id, code: 'NO-TAX', name: 'بدون ضريبة', rate_percent: 0, tax_mode: 'none', is_default: true, is_active: true},
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
        default_route_id: 'rt-1',
        commission_list_id: 'ccl-0',
        default_commission_type: 'fixed_amount',
        default_commission_value: 25,
        country_id: null,
        governorate_id: null,
        city_id: null,
        region_id: null,
        phone: null,
        mobile: '01011223344',
        po_box: null,
        postal_code: null,
        address_line: null,
        email: null,
        is_active: true,
        archived_at: null,
        created_at: '2026-11-19T10:00:00Z',
      },
    ]);
    mockListCourierRoutes.mockResolvedValue([
      {id: 'rt-1', tenant_id: tenantAlpha.id, code: 'GENERAL', name: 'خط السير العام', description: null, vehicle_id: null, driver_id: null, is_system_default: true, is_active: true, archived_at: null, created_at: '2026-11-19T10:00:00Z'},
    ]);
    mockListCommissionLists.mockResolvedValue([
      {id: 'ccl-0', tenant_id: tenantAlpha.id, code: '0', name: 'القائمة الافتراضية', description: null, is_system_default: true, is_active: true, archived_at: null, created_at: '2026-11-19T10:00:00Z'},
    ]);

    mockGetTenantFinancePolicy.mockResolvedValue({
      tenant_id: tenantAlpha.id,
      enforce_four_eyes: true,
      allow_owner_self_approve: true,
      high_value_approval_threshold: 5000,
    });

    mockGetCashboxesWithBalances.mockResolvedValue([
      {
        id: 'cb-main',
        tenant_id: tenantAlpha.id,
        code: 'CB-01',
        name: 'الخزينة الرئيسية',
        branch_id: 'br-1',
        branch_name: 'فرع القاهرة',
        ledger_account_id: 'acc-1',
        is_active: true,
        allow_deposit: true,
        allow_withdraw: true,
        allow_transfer_in: true,
        allow_transfer_out: true,
        current_balance: 15000,
      },
      {
        id: 'cb-vault',
        tenant_id: tenantAlpha.id,
        code: 'CB-02',
        name: 'خزينة الإدارة المركزية',
        branch_id: 'br-1',
        branch_name: 'فرع القاهرة',
        ledger_account_id: 'acc-2',
        is_active: true,
        allow_deposit: true,
        allow_withdraw: true,
        allow_transfer_in: true,
        allow_transfer_out: true,
        current_balance: 25000,
      },
    ]);

    mockListCashboxTransactions.mockResolvedValue([
      {
        id: 'ctx-1',
        tenant_id: tenantAlpha.id,
        transaction_code: 'CTX-000001',
        cashbox_id: 'cb-main',
        branch_id: 'br-1',
        transaction_date: '2026-11-19',
        transaction_type: 'courier_collection_in',
        direction: 'in',
        amount: 1200,
        reference_type: 'courier_collection_voucher',
        reference_id: 'col-1',
        reference_code: 'COL-000001',
        notes: 'توريد تحصيل COD',
        actor_user_id: 'user-owner-1',
        created_at: '2026-11-19T11:00:00Z',
      },
    ]);

    mockListCashboxTransfers.mockResolvedValue([
      {
        id: 'ctr-1',
        tenant_id: tenantAlpha.id,
        transfer_code: 'CTR-000001',
        transfer_date: '2026-11-19',
        from_cashbox_id: 'cb-main',
        to_cashbox_id: 'cb-vault',
        amount: 3000,
        status: 'draft',
        notes: 'ترحيل فائض',
        approved_at: null,
        approved_by: null,
        created_at: '2026-11-19T11:30:00Z',
        created_by: 'user-cashier-2',
      },
    ]);

    mockListCashboxVouchers.mockResolvedValue([]);
    mockGetCourierCustodyOverview.mockResolvedValue([
      {
        courier_id: 'cr-1',
        code: 'CR-001',
        name: 'كابتن طارق',
        mobile: '01011223344',
        branch_id: 'br-1',
        shipment_custody_count: 2,
        uncollected_cash_shipments_count: 1,
        uncollected_cash_amount: 1170,
        total_accrued_commission: 55,
        payable_commission_amount: 25,
      },
    ]);
    mockListCourierUncollectedCashShipments.mockResolvedValue([
      {
        shipment_id: 'shp-1',
        shipment_number: 'SHP-000001',
        barcode_token: 'tok-1',
        operational_status: 'delivered',
        payment_term_code: 'COD',
        return_liability: 'none',
        delivered_at: '2026-11-19T10:00:00Z',
        cash_source_type: 'cod_delivery',
        expected_amount: 1170,
        client_name: 'متجر النيل',
      },
    ]);
    mockListCourierCollectionVouchers.mockResolvedValue([]);

    mockGetClientsSettlementOverview.mockResolvedValue([
      {
        client_id: 'cl-1',
        code: 'CL-001',
        name: 'متجر النيل',
        mobile: '01012345678',
        branch_id: 'br-1',
        payout_method: 'cash',
        bank_name: null,
        bank_account_number: null,
        wallet_phone: null,
        default_price_mode: 'shipping_excluded',
        unsettled_shipments_count: 1,
        awaiting_courier_collection_count: 0,
        gross_cod_amount: 1170,
        shipping_fees_deductible: 170,
        return_fees_deductible: 0,
        ready_net_balance: 1000,
      },
    ]);
    mockListClientUnsettledShipments.mockResolvedValue([
      {
        shipment_id: 'shp-1',
        shipment_number: 'SHP-000001',
        operational_status: 'delivered',
        payment_term_code: 'COD',
        price_mode: 'shipping_excluded',
        is_collected_from_courier: true,
        return_liability: 'none',
        cod_collected_amount: 1170,
        shipping_fee_deducted: 170,
        return_fee_deducted: 0,
        net_client_amount: 1000,
        awaiting_courier_cash: false,
      },
    ]);
    mockListClientSettlements.mockResolvedValue([]);

    mockListCourierPayableCommissions.mockResolvedValue([
      {
        shipment_id: 'shp-cod-uncollected',
        shipment_number: 'SHP-COD-WAIT',
        operational_status: 'delivered',
        payment_term_code: 'COD',
        is_collected_from_courier: false,
        accrued_courier_commission: 30,
        eligible_for_payout: false,
      },
      {
        shipment_id: 'shp-paid-ready',
        shipment_number: 'SHP-READY-2',
        operational_status: 'delivered',
        payment_term_code: 'PREPAID',
        is_collected_from_courier: false,
        accrued_courier_commission: 25,
        eligible_for_payout: true,
      },
    ]);
    mockListCourierCommissionPayouts.mockResolvedValue([]);
  });

  it('renders FinanceCashboxesPage with live cashbox balances, ledger, ADR-018 Four-Eyes policy update, and transfer creation', async () => {
    mockUpdateTenantFinancePolicy.mockResolvedValue({
      tenant_id: tenantAlpha.id,
      enforce_four_eyes: true,
      allow_owner_self_approve: false,
      high_value_approval_threshold: 7500,
    });
    mockCreateCashboxTransfer.mockResolvedValue({id: 'ctr-2', transfer_code: 'CTR-000002'});

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/finance/cashboxes']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('الخزينة الرئيسية')).toBeInTheDocument();
    });

    expect(screen.getByText('المالية والخزائن')).toBeInTheDocument();
    expect(screen.getByText('CTX-000001')).toBeInTheDocument();

    // Update ADR-018 policy
    fireEvent.click(screen.getByRole('button', {name: /ضبط سياسة العينين الأربع/}));
    fireEvent.change(screen.getByLabelText(/حد المبلغ الذي يتطلب اعتماد المالك/), {
      target: {value: '7500'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'حفظ السياسة المالية'}));

    await waitFor(() => {
      expect(mockUpdateTenantFinancePolicy).toHaveBeenCalledWith(tenantAlpha.id, {
        enforce_four_eyes: true,
        allow_owner_self_approve: true,
        high_value_approval_threshold: 7500,
      });
    });

    // Switch to transfers tab and create CTR-*
    fireEvent.click(screen.getByRole('button', {name: /التحويلات بين الخزائن/}));
    expect(screen.getByText('CTR-000001')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('المبلغ'), {target: {value: '2000'}});
    fireEvent.click(screen.getByRole('button', {name: 'إنشاء تحويل'}));

    await waitFor(() => {
      expect(mockCreateCashboxTransfer).toHaveBeenCalledTimes(1);
    });
  });

  it('blocks self-approval in UI for non-owner creator under ADR-018 Four-Eyes rule', async () => {
    mockUseAuth.mockReturnValue({
      session: {user: {id: 'user-cashier-2'}},
      user: {id: 'user-cashier-2'},
      profile: {
        id: 'user-cashier-2',
        display_name: 'أمين الخزينة',
        avatar_path: null,
        is_platform_user: false,
        is_active: true,
      },
      platformAdmin: null,
      memberships: [membershipCashier],
      loading: false,
      isConfigured: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });
    mockGetMyTenantPermissions.mockResolvedValue({
      membership_id: membershipCashier.id,
      role_key: 'branch_cashier',
      account_subject_type: AccountSubjectType.STAFF,
      client_id: null,
      courier_id: null,
      branch_ids: ['br-1'],
      permissions: [
        {permission_key: 'finance.collections.create', scope: PermissionScope.BRANCH},
        {permission_key: 'finance.collections.approve', scope: PermissionScope.BRANCH},
      ],
    });
    mockListCourierCollectionVouchers.mockResolvedValue([
      {
        id: 'col-draft-self',
        tenant_id: tenantAlpha.id,
        voucher_code: 'COL-000099',
        voucher_date: '2026-11-19',
        branch_id: 'br-1',
        courier_id: 'cr-1',
        cashbox_id: 'cb-main',
        total_expected_amount: 1170,
        total_collected_amount: 1170,
        variance_amount: 0,
        status: 'draft',
        notes: null,
        approved_at: null,
        approved_by: null,
        created_at: '2026-11-19T12:00:00Z',
        created_by: 'user-cashier-2',
      },
    ]);

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/finance/collections']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('COL-000099')).toBeInTheDocument();
    });
    expect(screen.getByText('بانتظار اعتماد مراجع آخر')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'اعتماد وإيداع'})).not.toBeInTheDocument();
  });

  it('creates and approves CourierCollectionVoucher (COL-*) on CourierCollectionsPage', async () => {
    mockCreateCourierCollectionVoucher.mockResolvedValue({
      id: 'col-new',
      voucher_code: 'COL-000002',
      total_collected_amount: 1170,
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/finance/collections']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('SHP-000001')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', {name: 'إصدار سند التحصيل (COL)'}));

    await waitFor(() => {
      expect(mockCreateCourierCollectionVoucher).toHaveBeenCalledWith(
        tenantAlpha.id,
        expect.objectContaining({
          courier_id: 'cr-1',
          cashbox_id: 'cb-main',
          shipment_ids: ['shp-1'],
          collected_amount: 1170,
        }),
      );
    });
  });

  it('creates ClientSettlement (CST-*) and displays printable settlement modal on ClientSettlementsPage', async () => {
    mockCreateClientSettlement.mockResolvedValue({
      id: 'cst-1',
      settlement_code: 'CST-000001',
      net_payable_amount: 1000,
    });
    mockListClientSettlements.mockResolvedValue([
      {
        id: 'cst-1',
        tenant_id: tenantAlpha.id,
        settlement_code: 'CST-000001',
        settlement_date: '2026-11-19',
        branch_id: 'br-1',
        client_id: 'cl-1',
        cashbox_id: 'cb-main',
        payout_method: 'cash',
        payout_reference: null,
        gross_cod_collected: 1170,
        shipping_fees_deducted: 170,
        return_fees_deducted: 0,
        adjustment_amount: 0,
        net_payable_amount: 1000,
        cash_direction: 'payout_to_client',
        status: 'draft',
        notes: null,
        approved_at: null,
        approved_by: null,
        created_at: '2026-11-19T12:15:00Z',
        created_by: 'user-owner-1',
      },
    ]);

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/clients/settlements']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('SHP-000001')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', {name: 'إنشاء كشف تسوية عميل (CST)'}));

    await waitFor(() => {
      expect(mockCreateClientSettlement).toHaveBeenCalledWith(
        tenantAlpha.id,
        expect.objectContaining({
          client_id: 'cl-1',
          shipment_ids: ['shp-1'],
        }),
      );
    });

    fireEvent.click(screen.getByRole('button', {name: 'طباعة الكشف'}));
    expect(screen.getByRole('dialog', {name: 'كشف تسوية CST-000001'})).toBeInTheDocument();
  });

  it('enforces ADR-012 commission separation on CourierSettlementsPage (disables uncollected COD checkbox and creates CMP for eligible shipments)', async () => {
    mockCreateCourierCommissionPayout.mockResolvedValue({
      id: 'cmp-1',
      payout_code: 'CMP-000001',
      net_payout_amount: 25,
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/couriers/settlements']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('SHP-COD-WAIT')).toBeInTheDocument();
    });

    expect(screen.getByText('معلّقة لحين توريد المبلغ المحصل')).toBeInTheDocument();
    expect(screen.getByText('SHP-READY-2')).toBeInTheDocument();

    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toBeDisabled();
    expect(checkboxes[1]).not.toBeDisabled();
    expect(checkboxes[1]).toBeChecked();

    fireEvent.click(screen.getByRole('button', {name: 'إنشاء سند صرف عمولات (CMP)'}));

    await waitFor(() => {
      expect(mockCreateCourierCommissionPayout).toHaveBeenCalledWith(
        tenantAlpha.id,
        expect.objectContaining({
          courier_id: 'cr-1',
          cashbox_id: 'cb-main',
          shipment_ids: ['shp-paid-ready'],
        }),
      );
    });
  });
});
