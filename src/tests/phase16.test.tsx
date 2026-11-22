import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {AccountSubjectType, PermissionScope} from '@/types/common';
import type {IntegrationsOverview} from '@/types/integrations';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';

const mockUseAuth = vi.fn();
const mockGetMyTenantPermissions = vi.fn();
const mockListClients = vi.fn();
const mockGetIntegrationsOverview = vi.fn();
const mockCreateApiToken = vi.fn();
const mockRevokeApiToken = vi.fn();
const mockUpsertWebhookEndpoint = vi.fn();
const mockRotateWebhookSecret = vi.fn();
const mockDeleteWebhookEndpoint = vi.fn();
const mockTriggerTestWebhookEvent = vi.fn();
const mockDispatchPendingWebhooks = vi.fn();

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

vi.mock('@/features/clients/clientsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/clients/clientsService')>();
  return {
    ...actual,
    listClients: (...args: unknown[]) => mockListClients(...args),
  };
});

vi.mock('@/features/integrations/integrationsService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/integrations/integrationsService')>();
  return {
    ...actual,
    getIntegrationsOverview: (...args: unknown[]) => mockGetIntegrationsOverview(...args),
    createApiToken: (...args: unknown[]) => mockCreateApiToken(...args),
    revokeApiToken: (...args: unknown[]) => mockRevokeApiToken(...args),
    upsertWebhookEndpoint: (...args: unknown[]) => mockUpsertWebhookEndpoint(...args),
    rotateWebhookSecret: (...args: unknown[]) => mockRotateWebhookSecret(...args),
    deleteWebhookEndpoint: (...args: unknown[]) => mockDeleteWebhookEndpoint(...args),
    triggerTestWebhookEvent: (...args: unknown[]) => mockTriggerTestWebhookEvent(...args),
    dispatchPendingWebhooks: (...args: unknown[]) => mockDispatchPendingWebhooks(...args),
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

const ownerMembership: TenantMembershipRecord = {
  id: 'mem-owner-1',
  tenant_id: tenantAlpha.id,
  user_id: 'user-owner-1',
  username: 'admin',
  account_subject_type: AccountSubjectType.STAFF,
  role_key: 'company_owner',
  is_active: true,
  must_change_password: false,
  tenants: tenantAlpha,
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

const staffRestrictedMembership: TenantMembershipRecord = {
  id: 'mem-staff-1',
  tenant_id: tenantAlpha.id,
  user_id: 'user-staff-1',
  username: 'ops.staff',
  account_subject_type: AccountSubjectType.STAFF,
  role_key: 'data_entry',
  is_active: true,
  must_change_password: false,
  tenants: tenantAlpha,
};

const baseOverview: IntegrationsOverview = {
  api_access: {
    allow_api_access: true,
    plan_allow_api_access: true,
    plan_code: 'GROWTH',
    plan_name_ar: 'باقة النمو الاحترافية',
    subscription_status: 'active',
    bound_client_id: null,
  },
  tokens: [
    {
      id: 'tok-1',
      tenant_id: tenantAlpha.id,
      name: 'تكامل مخزون ERP',
      token_prefix: 'sf_live_11223344',
      account_scope: 'tenant',
      client_id: null,
      client_code: null,
      client_name: null,
      scopes: ['shipments:read', 'shipments:write'],
      allowed_ips: ['198.51.100.0/24'],
      is_active: true,
      expires_at: '2027-11-22T00:00:00Z',
      last_used_at: null,
      revoked_at: null,
      created_at: '2026-11-22T08:00:00Z',
    },
  ],
  endpoints: [
    {
      id: 'wh-1',
      tenant_id: tenantAlpha.id,
      client_id: null,
      client_code: null,
      client_name: null,
      name: 'تحديثات المتجر الرئيسي',
      target_url: 'https://hooks.merchant-example.com/shipflow',
      events: ['shipment.created', 'shipment.status_changed', 'webhook.test'],
      signing_secret_prefix: 'whsec_aabbccdd',
      is_active: true,
      failure_count: 0,
      last_triggered_at: null,
      last_status_code: null,
      created_at: '2026-11-22T08:00:00Z',
      updated_at: '2026-11-22T08:00:00Z',
    },
  ],
  deliveries: [
    {
      id: 'del-1',
      tenant_id: tenantAlpha.id,
      endpoint_id: 'wh-1',
      endpoint_name: 'تحديثات المتجر الرئيسي',
      target_url: 'https://hooks.merchant-example.com/shipflow',
      event_type: 'shipment.created',
      entity_type: 'shipment',
      entity_id: 'shp-1',
      response_status: 200,
      response_excerpt: '{"ok":true}',
      attempt_count: 1,
      status: 'delivered',
      next_retry_at: null,
      delivered_at: '2026-11-22T08:10:00Z',
      created_at: '2026-11-22T08:09:58Z',
    },
  ],
  request_logs: [
    {
      id: 'log-1',
      tenant_id: tenantAlpha.id,
      token_id: 'tok-1',
      token_name: 'تكامل مخزون ERP',
      token_prefix: 'sf_live_11223344',
      method: 'POST',
      path: '/shipments',
      status_code: 201,
      ip_address: '198.51.100.15',
      idempotency_key: 'ord-901',
      duration_ms: 42,
      created_at: '2026-11-22T08:05:00Z',
    },
  ],
};

function setupAuth(
  membership: TenantMembershipRecord,
  permissions: {permission_key: string; scope: PermissionScope}[],
  clientId: string | null = null,
) {
  mockUseAuth.mockReturnValue({
    session: {user: {id: membership.user_id}},
    user: {id: membership.user_id},
    profile: {
      id: membership.user_id,
      display_name: 'مستخدم الاختبار',
      avatar_path: null,
      is_platform_user: false,
      is_active: true,
    },
    platformAdmin: null,
    memberships: [membership],
    loading: false,
    isConfigured: true,
    signIn: vi.fn(),
    signOut: vi.fn(),
    refreshContext: vi.fn(),
  });
  mockGetMyTenantPermissions.mockResolvedValue({
    membership_id: membership.id,
    role_key: membership.role_key,
    account_subject_type: membership.account_subject_type,
    client_id: clientId,
    branch_ids: [],
    permissions,
  });
}

describe('Phase 16: API Tokens, External Integrations & Webhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListClients.mockResolvedValue([
      {id: 'cl-1', tenant_id: tenantAlpha.id, code: 'CL-001', name: 'متجر النيل'},
    ]);
    mockGetIntegrationsOverview.mockResolvedValue(baseOverview);
    mockCreateApiToken.mockResolvedValue({
      token: {
        ...baseOverview.tokens[0],
        id: 'tok-new',
        name: 'رمز شوبيفاي الجديد',
        token_prefix: 'sf_live_99887766',
      },
      plaintext_token: 'sf_live_99887766554433221100aabbccddeeff1122',
    });
    mockRevokeApiToken.mockResolvedValue(undefined);
    mockUpsertWebhookEndpoint.mockResolvedValue({
      endpoint: {
        ...baseOverview.endpoints[0],
        id: 'wh-new',
        name: 'ويب هوك الطلبات',
      },
      plaintext_signing_secret: 'whsec_11223344556677889900aabbccddeeff',
    });
    mockRotateWebhookSecret.mockResolvedValue({
      endpoint_id: 'wh-1',
      signing_secret_prefix: 'whsec_rotated12',
      plaintext_signing_secret: 'whsec_rotated1234567890abcdef1234567890',
    });
    mockTriggerTestWebhookEvent.mockResolvedValue(baseOverview.deliveries[0]);
    mockDispatchPendingWebhooks.mockResolvedValue({processed_count: 1});
  });

  it('allows company owner to create API token with IP allowlist, reveals secret once, and revokes token', async () => {
    setupAuth(ownerMembership, []);

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/security/integrations']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('تكامل مخزون ERP')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', {name: 'رموز API والتكاملات'})).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('اسم الرمز / المتجر *'), {target: {value: 'رمز شوبيفاي الجديد'}});
    fireEvent.change(screen.getByLabelText('عناوين IP المسموحة (اختياري)'), {
      target: {value: '198.51.100.10, 203.0.113.0/24'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'إصدار رمز API جديد'}));

    await waitFor(() => {
      expect(mockCreateApiToken).toHaveBeenCalledWith(
        tenantAlpha.id,
        expect.objectContaining({
          name: 'رمز شوبيفاي الجديد',
          account_scope: 'tenant',
          allowed_ips: ['198.51.100.10', '203.0.113.0/24'],
        }),
      );
    });

    expect(screen.getByText('sf_live_99887766554433221100aabbccddeeff1122')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'إخفاء'}));
    expect(screen.queryByText('sf_live_99887766554433221100aabbccddeeff1122')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'إبطال الرمز'}));
    fireEvent.click(screen.getByRole('button', {name: 'إبطال الرمز الآن'}));
    await waitFor(() => {
      expect(mockRevokeApiToken).toHaveBeenCalledWith(tenantAlpha.id, 'tok-1');
    });
  });

  it('locks bound client portal users to their client_id and supports webhook creation, test delivery & secret rotation', async () => {
    setupAuth(
      clientMembership,
      [
        {permission_key: 'api_tokens.read', scope: PermissionScope.OWN},
        {permission_key: 'api_tokens.create', scope: PermissionScope.OWN},
        {permission_key: 'webhooks.manage', scope: PermissionScope.OWN},
      ],
      'cl-1',
    );

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/security/integrations']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'رموز API والتكاملات وWebhooks'})).toBeInTheDocument();
    });

    // Staff-only scope selector must not be shown to bound client users
    expect(screen.queryByLabelText('نطاق الرمز *')).not.toBeInTheDocument();
    expect(mockListClients).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('اسم الرمز / المتجر *'), {target: {value: 'مفتاح متجر النيل'}});
    fireEvent.click(screen.getByRole('button', {name: 'إصدار رمز API جديد'}));

    await waitFor(() => {
      expect(mockCreateApiToken).toHaveBeenCalledWith(
        tenantAlpha.id,
        expect.objectContaining({
          name: 'مفتاح متجر النيل',
          account_scope: 'client',
          client_id: 'cl-1',
        }),
      );
    });

    // Switch to Webhooks tab
    fireEvent.click(screen.getByRole('button', {name: /نقاط Webhooks/}));
    expect(screen.getByText('https://hooks.merchant-example.com/shipflow')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('اسم نقطة الاستقبال *'), {target: {value: 'ويب هوك الطلبات'}});
    fireEvent.change(screen.getByLabelText('رابط الاستقبال العام (HTTPS فقط) *'), {
      target: {value: 'https://api.nile-store.com/hooks/shipflow'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'حفظ نقطة Webhook'}));

    await waitFor(() => {
      expect(mockUpsertWebhookEndpoint).toHaveBeenCalledWith(
        tenantAlpha.id,
        expect.objectContaining({
          name: 'ويب هوك الطلبات',
          target_url: 'https://api.nile-store.com/hooks/shipflow',
          client_id: 'cl-1',
        }),
      );
    });
    expect(screen.getByText('whsec_11223344556677889900aabbccddeeff')).toBeInTheDocument();

    // Test & Rotate existing endpoint
    fireEvent.click(screen.getByRole('button', {name: 'إرسال حدث تجريبي'}));
    await waitFor(() => {
      expect(mockTriggerTestWebhookEvent).toHaveBeenCalledWith(tenantAlpha.id, 'wh-1', 'webhook.test');
      expect(mockDispatchPendingWebhooks).toHaveBeenCalledWith(tenantAlpha.id, 'wh-1');
    });

    fireEvent.click(screen.getByRole('button', {name: 'تدوير السر'}));
    await waitFor(() => {
      expect(mockRotateWebhookSecret).toHaveBeenCalledWith(tenantAlpha.id, 'wh-1');
    });
    expect(screen.getByText('whsec_rotated1234567890abcdef1234567890')).toBeInTheDocument();
  });

  it('displays delivery logs, API request logs, and upgrade warning when STARTER plan disables API access', async () => {
    setupAuth(ownerMembership, []);
    mockGetIntegrationsOverview.mockResolvedValue({
      ...baseOverview,
      api_access: {
        allow_api_access: false,
        plan_allow_api_access: false,
        plan_code: 'STARTER',
        plan_name_ar: 'باقة البداية',
        subscription_status: 'trial',
        bound_client_id: null,
      },
    });

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/security/integrations']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/غير متاح في الباقة الحالية/)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', {name: 'إصدار رمز API جديد'})).toBeDisabled();

    fireEvent.click(screen.getByRole('button', {name: /سجل التسليم والطلبات والدليل/}));
    expect(screen.getByText('POST /shipments')).toBeInTheDocument();
    expect(screen.getByText(/HTTP 201 · 42ms/)).toBeInTheDocument();
    expect(screen.getAllByText(/X-ShipFlow-Signature/).length).toBeGreaterThan(0);
  });

  it('blocks unauthorized staff lacking integration permissions', async () => {
    setupAuth(staffRestrictedMembership, [{permission_key: 'shipments.read', scope: PermissionScope.BRANCH}]);

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/security/integrations']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('لا تملك صلاحية استعراض رموز API والتكاملات لهذه الشركة.')).toBeInTheDocument();
    });
    expect(mockGetIntegrationsOverview).not.toHaveBeenCalled();
  });
});
