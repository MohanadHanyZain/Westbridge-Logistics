import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {AccountSubjectType, PermissionScope} from '@/types/common';
import type {TenantMapsSettingsRecord} from '@/types/couriers';
import type {TenantMessagingSettings} from '@/types/messaging';
import type {
  PlatformSupportAccessRecord,
  PlatformSupportSnapshot,
  PlatformTenantDirectoryItem,
  SubscriptionPlanRecord,
  TenantDomainRecord,
  TenantMembershipRecord,
  TenantRecord,
  TenantSubscriptionOverview,
} from '@/types/tenant';

const mockUseAuth = vi.fn();
const mockGetMyTenantPermissions = vi.fn();
const mockListBranches = vi.fn();
const mockGetTenantMessagingSettings = vi.fn();
const mockGetTenantMapsSettings = vi.fn();

const mockListPlatformTenantsDirectory = vi.fn();
const mockListAllTenants = vi.fn();
const mockListSubscriptionPlans = vi.fn();
const mockUpsertSubscriptionPlan = vi.fn();
const mockAssignTenantSubscription = vi.fn();
const mockListTenantDomains = vi.fn();
const mockUpsertTenantDomain = vi.fn();
const mockVerifyTenantDomain = vi.fn();
const mockDeleteTenantDomain = vi.fn();
const mockListPlatformSupportSessions = vi.fn();
const mockRequestPlatformSupportAccess = vi.fn();
const mockRevokePlatformSupportAccess = vi.fn();
const mockGetPlatformTenantSupportSnapshot = vi.fn();
const mockGetTenantSubscriptionOverview = vi.fn();

vi.mock('@/lib/auth', () => ({
  AuthProvider: ({children}: {children: React.ReactNode}) => <>{children}</>,
  useAuth: () => mockUseAuth(),
  updateMyCredentials: vi.fn(),
  GENERIC_LOGIN_ERROR: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
}));

vi.mock('@/features/security/securityService', () => ({
  getMyTenantPermissions: (...args: unknown[]) => mockGetMyTenantPermissions(...args),
}));

vi.mock('@/features/branches/branchesService', () => ({
  listBranches: (...args: unknown[]) => mockListBranches(...args),
}));

vi.mock('@/features/messaging/messagingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/messaging/messagingService')>();
  return {
    ...actual,
    getTenantMessagingSettings: (...args: unknown[]) => mockGetTenantMessagingSettings(...args),
    updateTenantMessagingSettings: vi.fn(),
    listMyNotifications: vi.fn().mockResolvedValue([]),
    getUnreadNotificationsCount: vi.fn().mockResolvedValue(0),
    markNotificationsRead: vi.fn(),
    subscribeToMessagingUpdates: () => () => {},
  };
});

vi.mock('@/features/couriers/couriersService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/couriers/couriersService')>();
  return {
    ...actual,
    getTenantMapsSettings: (...args: unknown[]) => mockGetTenantMapsSettings(...args),
    updateTenantMapsSettings: vi.fn(),
    purgeExpiredCourierLocations: vi.fn(),
  };
});

vi.mock('@/features/tenants/tenantService', () => ({
  fetchPublicTenantBySlug: vi.fn().mockResolvedValue(null),
  listAllTenants: (...args: unknown[]) => mockListAllTenants(...args),
  onboardNewTenant: vi.fn(),
  updateTenantStatus: vi.fn(),
  listPlatformTenantsDirectory: (...args: unknown[]) => mockListPlatformTenantsDirectory(...args),
  listSubscriptionPlans: (...args: unknown[]) => mockListSubscriptionPlans(...args),
  upsertSubscriptionPlan: (...args: unknown[]) => mockUpsertSubscriptionPlan(...args),
  assignTenantSubscription: (...args: unknown[]) => mockAssignTenantSubscription(...args),
  listTenantDomains: (...args: unknown[]) => mockListTenantDomains(...args),
  upsertTenantDomain: (...args: unknown[]) => mockUpsertTenantDomain(...args),
  verifyTenantDomain: (...args: unknown[]) => mockVerifyTenantDomain(...args),
  deleteTenantDomain: (...args: unknown[]) => mockDeleteTenantDomain(...args),
  listPlatformSupportSessions: (...args: unknown[]) => mockListPlatformSupportSessions(...args),
  requestPlatformSupportAccess: (...args: unknown[]) => mockRequestPlatformSupportAccess(...args),
  revokePlatformSupportAccess: (...args: unknown[]) => mockRevokePlatformSupportAccess(...args),
  getPlatformTenantSupportSnapshot: (...args: unknown[]) => mockGetPlatformTenantSupportSnapshot(...args),
  getTenantSubscriptionOverview: (...args: unknown[]) => mockGetTenantSubscriptionOverview(...args),
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

const planStarter: SubscriptionPlanRecord = {
  id: 'plan-starter',
  code: 'STARTER',
  name_ar: 'باقة البداية',
  description_ar: 'مناسبة للشركات الناشئة',
  monthly_price_egp: 950,
  annual_price_egp: 9500,
  max_branches: 3,
  max_users: 10,
  max_couriers: 10,
  max_monthly_shipments: 1000,
  allow_custom_domain: false,
  allow_api_access: false,
  is_active: true,
  sort_order: 10,
  created_at: '2026-11-22T00:00:00Z',
  updated_at: '2026-11-22T00:00:00Z',
};

const planGrowth: SubscriptionPlanRecord = {
  id: 'plan-growth',
  code: 'GROWTH',
  name_ar: 'باقة النمو الاحترافية',
  description_ar: 'نطاق مخصص وتكامل API',
  monthly_price_egp: 2450,
  annual_price_egp: 24500,
  max_branches: 15,
  max_users: 50,
  max_couriers: 50,
  max_monthly_shipments: 10000,
  allow_custom_domain: true,
  allow_api_access: true,
  is_active: true,
  sort_order: 20,
  created_at: '2026-11-22T00:00:00Z',
  updated_at: '2026-11-22T00:00:00Z',
};

const directoryItemAlpha: PlatformTenantDirectoryItem = {
  tenant: tenantAlpha,
  subscription: {
    id: 'sub-alpha',
    plan_id: 'plan-growth',
    plan_code: 'GROWTH',
    plan_name_ar: 'باقة النمو الاحترافية',
    status: 'active',
    billing_cycle: 'monthly',
    current_period_start: '2026-11-01',
    current_period_end: '2026-12-01',
    trial_ends_at: null,
    effective_max_branches: 15,
    effective_max_users: 50,
    effective_max_couriers: 50,
    effective_max_monthly_shipments: 10000,
    allow_custom_domain: true,
    allow_api_access: true,
  },
  usage: {
    active_branches: 2,
    active_users: 7,
    active_couriers: 5,
    month_shipments: 420,
  },
  primary_domain: 'alpha-express.shipflow.app',
  domains_count: 2,
  active_support_sessions_count: 1,
};

const primarySubdomain: TenantDomainRecord = {
  id: 'dom-1',
  tenant_id: tenantAlpha.id,
  tenant_name: tenantAlpha.name,
  tenant_slug: tenantAlpha.slug,
  domain: 'alpha-express.shipflow.app',
  domain_type: 'subdomain',
  is_primary: true,
  verification_status: 'verified',
  verification_token: 'shipflow-verify-sub1',
  verified_at: '2026-11-22T00:00:00Z',
  ssl_status: 'active',
  created_at: '2026-11-22T00:00:00Z',
  updated_at: '2026-11-22T00:00:00Z',
};

const customPendingDomain: TenantDomainRecord = {
  id: 'dom-2',
  tenant_id: tenantAlpha.id,
  tenant_name: tenantAlpha.name,
  tenant_slug: tenantAlpha.slug,
  domain: 'portal.alpha-eg.com',
  domain_type: 'custom',
  is_primary: false,
  verification_status: 'pending',
  verification_token: 'shipflow-verify-abc123',
  verified_at: null,
  ssl_status: 'pending',
  created_at: '2026-11-22T01:00:00Z',
  updated_at: '2026-11-22T01:00:00Z',
};

const activeSupportSession: PlatformSupportAccessRecord = {
  id: 'sup-ses-1',
  support_user_id: 'support-1',
  support_username: 'support_agent',
  tenant_id: tenantAlpha.id,
  tenant_name: tenantAlpha.name,
  tenant_slug: tenantAlpha.slug,
  reason: 'مراجعة تذكرة تسعير شحنة التاجر رقم 104',
  access_mode: 'read_only',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  revoked_at: null,
  last_entered_at: null,
  created_at: '2026-11-22T02:00:00Z',
};

const supportSnapshotAlpha: PlatformSupportSnapshot = {
  support_session: {
    id: 'sup-ses-1',
    reason: activeSupportSession.reason,
    access_mode: 'read_only',
    expires_at: activeSupportSession.expires_at,
  },
  tenant: {
    id: tenantAlpha.id,
    code: tenantAlpha.code,
    slug: tenantAlpha.slug,
    name: tenantAlpha.name,
    status: 'active',
  },
  metrics: {
    branches_count: 2,
    active_users_count: 7,
    clients_count: 18,
    couriers_count: 5,
    total_shipments_count: 1200,
    delivered_shipments_count: 1080,
    failed_shipments_count: 15,
  },
  recent_audit_events: [
    {
      id: 'aud-1',
      action: 'shipment_created',
      entity_type: 'shipments',
      source: 'server',
      created_at: '2026-11-22T01:30:00Z',
    },
  ],
};

const membershipOwnerAlpha: TenantMembershipRecord = {
  id: 'mem-owner-1',
  tenant_id: tenantAlpha.id,
  user_id: 'owner-1',
  username: 'admin',
  account_subject_type: AccountSubjectType.STAFF,
  role_key: 'company_owner',
  is_active: true,
  must_change_password: false,
  tenants: tenantAlpha,
};

const msgDefaults: TenantMessagingSettings = {
  tenant_id: tenantAlpha.id,
  message_retention_days: 365,
  attachment_max_size_mb: 5,
  notify_on_shipment_status: true,
  notify_on_new_message: true,
  notify_on_settlement: true,
};

const mapsDefaults: TenantMapsSettingsRecord = {
  tenant_id: tenantAlpha.id,
  location_retention_days: 90,
  gps_ping_interval_seconds: 60,
  require_gps_on_delivery: false,
};

const overviewAlpha: TenantSubscriptionOverview = {
  tenant_id: tenantAlpha.id,
  subscription: directoryItemAlpha.subscription,
  usage: directoryItemAlpha.usage,
  domains: [primarySubdomain, customPendingDomain],
  support_sessions: [activeSupportSession],
};

describe('Phase 15: Central Platform, Subscriptions, Quotas, Domains & Audited Support Access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListPlatformTenantsDirectory.mockResolvedValue([directoryItemAlpha]);
    mockListAllTenants.mockResolvedValue([tenantAlpha]);
    mockListSubscriptionPlans.mockResolvedValue([planStarter, planGrowth]);
    mockListTenantDomains.mockResolvedValue([primarySubdomain, customPendingDomain]);
    mockListPlatformSupportSessions.mockResolvedValue([activeSupportSession]);
    mockUpsertSubscriptionPlan.mockResolvedValue(planGrowth);
    mockAssignTenantSubscription.mockResolvedValue(undefined);
    mockUpsertTenantDomain.mockResolvedValue(customPendingDomain);
    mockVerifyTenantDomain.mockResolvedValue({
      ...customPendingDomain,
      verification_status: 'verified',
      ssl_status: 'active',
    });
    mockDeleteTenantDomain.mockResolvedValue(undefined);
    mockRequestPlatformSupportAccess.mockResolvedValue(activeSupportSession);
    mockRevokePlatformSupportAccess.mockResolvedValue({
      ...activeSupportSession,
      revoked_at: new Date().toISOString(),
    });
    mockGetPlatformTenantSupportSnapshot.mockResolvedValue(supportSnapshotAlpha);
    mockGetTenantSubscriptionOverview.mockResolvedValue(overviewAlpha);
    mockGetTenantMessagingSettings.mockResolvedValue(msgDefaults);
    mockGetTenantMapsSettings.mockResolvedValue(mapsDefaults);
    mockGetMyTenantPermissions.mockResolvedValue({
      account_subject_type: AccountSubjectType.STAFF,
      role_code: 'company_owner',
      role_name_ar: 'مالك الشركة',
      is_admin: true,
      branch_ids: ['br-1'],
      permissions: [
        {permission_code: 'settings.manage', scope: PermissionScope.TENANT},
        {permission_code: 'shipments.read', scope: PermissionScope.TENANT},
      ],
    });
    mockListBranches.mockResolvedValue([]);
  });

  it('allows Platform Super Admin to inspect quota usage and assign subscription plan overrides', async () => {
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

    render(
      <MemoryRouter initialEntries={['/platform']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('شركة ألفا للشحن')).toBeInTheDocument();
    });

    expect(screen.getByText('فروع: 2 / 15')).toBeInTheDocument();
    expect(screen.getByText('شحنات الشهر: 420 / 10000')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'إدارة الباقة والحدود'}));
    expect(screen.getByLabelText('تخصيص اشتراك وحدود الشركة')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('الباقة'), {target: {value: 'STARTER'}});
    fireEvent.change(screen.getByLabelText('استثناء حد الفروع (اختياري)'), {target: {value: '5'}});
    fireEvent.click(screen.getByRole('button', {name: 'حفظ الاشتراك والحدود'}));

    await waitFor(() => {
      expect(mockAssignTenantSubscription).toHaveBeenCalledWith(
        tenantAlpha.id,
        expect.objectContaining({
          plan_code: 'STARTER',
          override_max_branches: 5,
        }),
      );
    });
  });

  it('allows Platform Super Admin to create subscription plans and manage/verify custom domains', async () => {
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

    render(
      <MemoryRouter initialEntries={['/platform']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('شركة ألفا للشحن')).toBeInTheDocument();
    });

    // Plans tab
    fireEvent.click(screen.getByRole('tab', {name: 'الباقات والحدود'}));
    expect(screen.getByText('باقة البداية')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('كود الباقة'), {target: {value: 'SCALE_PRO'}});
    fireEvent.change(screen.getByLabelText('اسم الباقة (عربي)'), {target: {value: 'باقة التوسع'}});
    fireEvent.click(screen.getByRole('button', {name: 'حفظ الباقة'}));

    await waitFor(() => {
      expect(mockUpsertSubscriptionPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'SCALE_PRO',
          name_ar: 'باقة التوسع',
        }),
      );
    });

    // Domains tab
    fireEvent.click(screen.getByRole('tab', {name: 'النطاقات المخصصة والفرعية'}));
    expect(screen.getByText('portal.alpha-eg.com')).toBeInTheDocument();
    expect(screen.getByText(/shipflow-verify-abc123/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('اسم النطاق (Hostname)'), {
      target: {value: 'track.alpha-eg.com'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'إضافة النطاق'}));

    await waitFor(() => {
      expect(mockUpsertTenantDomain).toHaveBeenCalledWith(
        tenantAlpha.id,
        expect.objectContaining({
          domain: 'track.alpha-eg.com',
          domain_type: 'custom',
        }),
      );
    });

    fireEvent.click(screen.getByRole('button', {name: 'توثيق النطاق'}));
    await waitFor(() => {
      expect(mockVerifyTenantDomain).toHaveBeenCalledWith(tenantAlpha.id, 'dom-2', true);
    });
  });

  it('enforces role isolation for platform_support and supports audited reason-bound sessions & snapshots', async () => {
    mockUseAuth.mockReturnValue({
      session: {user: {id: 'support-1'}},
      user: {id: 'support-1'},
      profile: {id: 'support-1', display_name: 'مهندس الدعم', avatar_path: null, is_platform_user: true, is_active: true},
      platformAdmin: {user_id: 'support-1', role_key: 'platform_support', username: 'support_agent', is_active: true},
      memberships: [],
      loading: false,
      isConfigured: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/platform']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('شركة ألفا للشحن')).toBeInTheDocument();
    });

    // platform_support cannot onboard tenants or mutate subscriptions
    expect(screen.queryByRole('button', {name: 'إضافة شركة شحن جديدة'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'إدارة الباقة والحدود'})).not.toBeInTheDocument();

    // Open audited support access tab
    fireEvent.click(screen.getByRole('tab', {name: 'دخول الدعم المسبب'}));
    fireEvent.change(screen.getByLabelText(/سبب الدخول الموثق/), {
      target: {value: 'مراجعة تذكرة تسعير رقم 104'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'بدء جلسة الدعم الموثقة'}));

    await waitFor(() => {
      expect(mockRequestPlatformSupportAccess).toHaveBeenCalledWith(
        tenantAlpha.id,
        'مراجعة تذكرة تسعير رقم 104',
        60,
        'read_only',
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/معاينة التشخيص: شركة ألفا للشحن/)).toBeInTheDocument();
    });
    expect(screen.getByText('1080')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'إنهاء الجلسة'}));
    await waitFor(() => {
      expect(mockRevokePlatformSupportAccess).toHaveBeenCalledWith('sup-ses-1');
    });
  });

  it('renders tenant subscription quotas, domains, and audited support visits inside TenantSettingsPage', async () => {
    mockUseAuth.mockReturnValue({
      session: {user: {id: 'owner-1'}},
      user: {id: 'owner-1'},
      profile: {id: 'owner-1', display_name: 'مالك ألفا', avatar_path: null, is_platform_user: false, is_active: true},
      platformAdmin: null,
      memberships: [membershipOwnerAlpha],
      loading: false,
      isConfigured: true,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refreshContext: vi.fn(),
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/settings']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/باقة الاشتراك والحدود والنطاقات وسجل الدعم/),
      ).toBeInTheDocument();
    });

    expect(screen.getByText(/باقة النمو الاحترافية \(GROWTH\)/)).toBeInTheDocument();
    expect(screen.getByText('2 / 15')).toBeInTheDocument();
    expect(screen.getByText('420 / 10000')).toBeInTheDocument();
    expect(screen.getByText('alpha-express.shipflow.app')).toBeInTheDocument();
    expect(screen.getByText('portal.alpha-eg.com')).toBeInTheDocument();
    expect(screen.getByText('مراجعة تذكرة تسعير شحنة التاجر رقم 104')).toBeInTheDocument();
  });
});
