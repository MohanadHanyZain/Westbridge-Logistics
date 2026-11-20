import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {AccountSubjectType, PermissionScope} from '@/types/common';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';

const mockUseAuth = vi.fn();
const mockGetMyTenantPermissions = vi.fn();
const mockListBranches = vi.fn();
const mockListAuxiliaryJournals = vi.fn();
const mockListJournalEntryTypes = vi.fn();
const mockListChartOfAccounts = vi.fn();
const mockListJournalEntries = vi.fn();
const mockCreateManualJournalEntry = vi.fn();
const mockApproveJournalEntry = vi.fn();
const mockGetTrialBalance = vi.fn();

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
    listAuxiliaryJournals: (...args: unknown[]) => mockListAuxiliaryJournals(...args),
    listJournalEntryTypes: (...args: unknown[]) => mockListJournalEntryTypes(...args),
    listChartOfAccounts: (...args: unknown[]) => mockListChartOfAccounts(...args),
  };
});

vi.mock('@/features/accounting/accountingService', () => ({
  listJournalEntries: (...args: unknown[]) => mockListJournalEntries(...args),
  createManualJournalEntry: (...args: unknown[]) => mockCreateManualJournalEntry(...args),
  approveJournalEntry: (...args: unknown[]) => mockApproveJournalEntry(...args),
  getTrialBalance: (...args: unknown[]) => mockGetTrialBalance(...args),
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
  created_at: '2026-11-20T10:00:00Z',
  updated_at: '2026-11-20T10:00:00Z',
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

describe('Phase 10: General Ledger, Journal Entries, Trial Balance & ADR-019 Cash Basis', () => {
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
      {id: 'br-1', tenant_id: tenantAlpha.id, code: 'CAI', name: 'فرع القاهرة', governorate_id: null, region_id: null, address_line: 'مدينة نصر', phone: null, manager_name: null, is_hub: true, is_active: true},
    ]);

    mockListAuxiliaryJournals.mockResolvedValue([
      {id: 'jrn-1', tenant_id: tenantAlpha.id, code: 'JRN-GEN', name: 'اليومية العامة', journal_category: 'general', is_active: true, archived_at: null},
    ]);

    mockListJournalEntryTypes.mockResolvedValue([
      {id: 'ent-1', tenant_id: tenantAlpha.id, code: 'ENT-STD', name: 'قيد تسوية قياسي', is_reversal_type: false, is_active: true},
    ]);

    mockListChartOfAccounts.mockResolvedValue([
      {id: 'acct-cash', tenant_id: tenantAlpha.id, code: '1111', name: 'الخزينة الرئيسية', account_type: 'asset', parent_id: null, is_group: false, is_active: true, archived_at: null},
      {id: 'acct-rev', tenant_id: tenantAlpha.id, code: '4111', name: 'إيرادات التوصيل', account_type: 'revenue', parent_id: null, is_group: false, is_active: true, archived_at: null},
    ]);

    mockListJournalEntries.mockResolvedValue([
      {
        id: 'je-1',
        tenant_id: tenantAlpha.id,
        entry_code: 'JENT-000001',
        entry_date: '2026-11-20',
        journal_id: 'jrn-1',
        entry_type_id: 'ent-1',
        branch_id: 'br-1',
        reference_type: 'manual',
        reference_id: null,
        reference_code: null,
        description: 'إثبات إيراد نقدية',
        total_debit: 500,
        total_credit: 500,
        status: 'draft',
        notes: null,
        approved_at: null,
        approved_by: null,
        created_at: '2026-11-20T10:00:00Z',
        created_by: 'user-owner-1',
      },
    ]);

    mockGetTrialBalance.mockResolvedValue([
      {account_id: 'acct-cash', account_code: '1111', account_name: 'الخزينة الرئيسية', account_type: 'asset', is_group: false, total_debit: 500, total_credit: 0, net_balance: 500},
      {account_id: 'acct-rev', account_code: '4111', account_name: 'إيرادات التوصيل', account_type: 'revenue', is_group: false, total_debit: 0, total_credit: 500, net_balance: 500},
    ]);
  });

  it('renders JournalEntriesPage, creates manual journal entry, and approves draft entry', async () => {
    mockCreateManualJournalEntry.mockResolvedValue({id: 'je-2', entry_code: 'JENT-000002', total_amount: 1200});

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/accounting/journal-entries']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('JENT-000001')).toBeInTheDocument();
    });

    expect(screen.getByText('إثبات إيراد نقدية')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'قيد يدوي جديد'}));
    expect(screen.getByRole('heading', {name: 'إنشاء قيد محاسبي يدوي مزدوج'})).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('المبلغ'), {target: {value: '1200'}});
    fireEvent.change(screen.getByLabelText('وصف القيد / البيان'), {target: {value: 'دفعة تحتساب إيراد'}});
    fireEvent.click(screen.getByRole('button', {name: 'حفظ القيد كمسودة'}));

    await waitFor(() => {
      expect(mockCreateManualJournalEntry).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', {name: 'اعتماد وترحيل'}));
    await waitFor(() => {
      expect(mockApproveJournalEntry).toHaveBeenCalledWith(tenantAlpha.id, 'je-1');
    });
  });

  it('renders TrialBalancePage and validates debit and credit balance totals', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/accounting/trial-balance']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('الميزان متوازن تمامًا ✓')).toBeInTheDocument();
    });

    expect(screen.getByText('الخزينة الرئيسية')).toBeInTheDocument();
    expect(screen.getByText('إيرادات التوصيل')).toBeInTheDocument();
  });
});
