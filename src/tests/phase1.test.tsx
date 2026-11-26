import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {AccountSubjectType} from '@/types/common';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';

const mockUseAuth = vi.fn();
const mockFetchPublicTenantBySlug = vi.fn();
const mockListAllTenants = vi.fn();
const mockOnboardNewTenant = vi.fn();
const mockUpdateTenantStatus = vi.fn();

vi.mock('@/lib/auth', () => ({
  AuthProvider: ({children}: {children: React.ReactNode}) => <>{children}</>,
  useAuth: () => mockUseAuth(),
  updateMyCredentials: vi.fn(),
  GENERIC_LOGIN_ERROR: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
}));

vi.mock('@/features/tenants/tenantService', () => ({
  fetchPublicTenantBySlug: (...args: unknown[]) => mockFetchPublicTenantBySlug(...args),
  listAllTenants: (...args: unknown[]) => mockListAllTenants(...args),
  onboardNewTenant: (...args: unknown[]) => mockOnboardNewTenant(...args),
  updateTenantStatus: (...args: unknown[]) => mockUpdateTenantStatus(...args),
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
  must_change_password: true,
  tenants: tenantAlpha,
};

describe('Phase 1: Multi-Tenant Route Guards & Isolation', () => {
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
  });

  it('redirects unauthenticated users from /platform to /platform/login', () => {
    render(
      <MemoryRouter initialEntries={['/platform']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', {name: 'تسجيل دخول إدارة المنصة'})).toBeInTheDocument();
  });

  it('blocks a Tenant A member from accessing Tenant B workspace (/c/beta-logistics/app)', async () => {
    mockUseAuth.mockReturnValue({
      session: {user: {id: 'user-alpha-1'}},
      user: {id: 'user-alpha-1'},
      profile: {id: 'user-alpha-1', display_name: 'مالك ألفا', avatar_path: null, is_platform_user: false, is_active: true},
      platformAdmin: null,
      memberships: [membershipAlpha],
      loading: false,
      isConfigured: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });

    mockFetchPublicTenantBySlug.mockResolvedValue({
      id: '22222222-2222-2222-2222-222222222222',
      slug: 'beta-logistics',
      name: 'شركة بيتا للشحن',
      status: 'active',
      default_timezone: 'Africa/Cairo',
      default_currency: 'EGP',
      default_locale: 'ar-EG',
      allow_client_self_registration: false,
      brand_logo_path: null,
    });

    render(
      <MemoryRouter initialEntries={['/c/beta-logistics/app']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('شركة بيتا للشحن')).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', {name: 'تسجيل الدخول إلى النظام'})).toBeInTheDocument();
    expect(screen.queryByText(/بوابة الشركة المعزولة/)).not.toBeInTheDocument();
  });

  it('allows an active Tenant A member into /c/alpha-express/app without a staff password prompt', () => {
    mockUseAuth.mockReturnValue({
      session: {user: {id: 'user-alpha-1'}},
      user: {id: 'user-alpha-1'},
      profile: {id: 'user-alpha-1', display_name: 'مالك ألفا', avatar_path: null, is_platform_user: false, is_active: true},
      platformAdmin: null,
      memberships: [membershipAlpha],
      loading: false,
      isConfigured: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', {name: 'نظرة عامة على العمليات'})).toBeInTheDocument();
    expect(screen.queryByText(/يُرجى تعيين كلمة مرور شخصية جديدة/)).not.toBeInTheDocument();
  });

  it('shows Platform Super Admin tenant list and idempotent onboarding form', async () => {
    mockUseAuth.mockReturnValue({
      session: {user: {id: 'super-1'}},
      user: {id: 'super-1'},
      profile: {id: 'super-1', display_name: 'مدير المنصة', avatar_path: null, is_platform_user: true, is_active: true},
      platformAdmin: {user_id: 'super-1', role_key: 'platform_super_admin', username: 'superadmin', is_active: true},
      memberships: [],
      loading: false,
      isConfigured: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });

    mockListAllTenants.mockResolvedValue([tenantAlpha]);

    render(
      <MemoryRouter initialEntries={['/platform']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('شركة ألفا للشحن')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', {name: 'إضافة شركة شحن جديدة'}));
    expect(screen.getByRole('heading', {name: /تأسيس شركة شحن جديدة/})).toBeInTheDocument();
    expect(screen.getByText(/مفتاح عدم التكرار:/)).toBeInTheDocument();
  });

  it('renders public tenant storefront without leaking internal users or emails', async () => {
    mockFetchPublicTenantBySlug.mockResolvedValue({
      id: tenantAlpha.id,
      slug: tenantAlpha.slug,
      name: tenantAlpha.name,
      status: 'active',
      default_timezone: 'Africa/Cairo',
      default_currency: 'EGP',
      default_locale: 'ar-EG',
      allow_client_self_registration: false,
      brand_logo_path: null,
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: /مرحبًا بكم في شركة ألفا للشحن/})).toBeInTheDocument();
    });
    expect(screen.getByRole('link', {name: 'تسجيل الدخول'})).toHaveAttribute(
      'href',
      '/c/alpha-express/login',
    );
  });
});
