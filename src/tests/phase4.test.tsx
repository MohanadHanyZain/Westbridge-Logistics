import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {hasEffectivePermission} from '@/lib/permissions';
import {AccountSubjectType, PermissionScope} from '@/types/common';
import type {TenantMembershipRecord, TenantRecord} from '@/types/tenant';

const mockUseAuth = vi.fn();
const mockListBranches = vi.fn();
const mockListClients = vi.fn();
const mockListCouriers = vi.fn();
const mockGetMyTenantPermissions = vi.fn();
const mockListTenantUsersDirectory = vi.fn();
const mockListTenantRoles = vi.fn();
const mockListPermissionsCatalog = vi.fn();
const mockListRolePermissions = vi.fn();
const mockCreateTenantUser = vi.fn();
const mockCreateCustomRole = vi.fn();
const mockSaveRolePermissions = vi.fn();
const mockListTenantSessionAudit = vi.fn();

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

vi.mock('@/features/couriers/couriersService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/couriers/couriersService')>();
  return {
    ...actual,
    listCouriers: (...args: unknown[]) => mockListCouriers(...args),
  };
});

vi.mock('@/features/security/securityService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/security/securityService')>();
  return {
    ...actual,
    getMyTenantPermissions: (...args: unknown[]) => mockGetMyTenantPermissions(...args),
    listTenantUsersDirectory: (...args: unknown[]) => mockListTenantUsersDirectory(...args),
    listTenantRoles: (...args: unknown[]) => mockListTenantRoles(...args),
    listPermissionsCatalog: (...args: unknown[]) => mockListPermissionsCatalog(...args),
    listRolePermissions: (...args: unknown[]) => mockListRolePermissions(...args),
    createTenantUser: (...args: unknown[]) => mockCreateTenantUser(...args),
    createCustomRole: (...args: unknown[]) => mockCreateCustomRole(...args),
    saveRolePermissions: (...args: unknown[]) => mockSaveRolePermissions(...args),
    listTenantSessionAudit: (...args: unknown[]) => mockListTenantSessionAudit(...args),
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

describe('Phase 4: RBAC, Users Management, Subject Links & Session Audit', () => {
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
      branch_ids: [],
      permissions: [{permission_key: 'users.manage', scope: PermissionScope.TENANT}],
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

    mockListClients.mockResolvedValue([
      {
        id: 'cl-1',
        tenant_id: tenantAlpha.id,
        code: 'CL-001',
        name: 'متجر النيل',
      },
    ]);

    mockListCouriers.mockResolvedValue([
      {
        id: 'cr-1',
        tenant_id: tenantAlpha.id,
        code: 'CR-001',
        name: 'كابتن طارق',
      },
    ]);

    mockListTenantRoles.mockResolvedValue([
      {
        id: 'role-owner',
        tenant_id: tenantAlpha.id,
        code: 'company_owner',
        name: 'مالك الشركة',
        description: 'صلاحيات كاملة محمية',
        default_subject_type: 'staff',
        default_scope: PermissionScope.TENANT,
        is_system: true,
        is_active: true,
        created_at: '2026-11-18T10:00:00Z',
      },
      {
        id: 'role-branch',
        tenant_id: tenantAlpha.id,
        code: 'branch_manager',
        name: 'مدير فرع',
        description: 'إدارة عمليات الفروع المسندة',
        default_subject_type: 'staff',
        default_scope: PermissionScope.BRANCH,
        is_system: true,
        is_active: true,
        created_at: '2026-11-18T10:00:00Z',
      },
      {
        id: 'role-client',
        tenant_id: tenantAlpha.id,
        code: 'client_owner',
        name: 'حساب عميل (تاجر)',
        description: 'وصول إلى شحنات العميل المرتبط',
        default_subject_type: 'client',
        default_scope: PermissionScope.OWN,
        is_system: true,
        is_active: true,
        created_at: '2026-11-18T10:00:00Z',
      },
      {
        id: 'role-courier',
        tenant_id: tenantAlpha.id,
        code: 'delivery_agent',
        name: 'مندوب توصيل',
        description: 'عرض المهام المسندة',
        default_subject_type: 'courier',
        default_scope: PermissionScope.ASSIGNED,
        is_system: true,
        is_active: true,
        created_at: '2026-11-18T10:00:00Z',
      },
    ]);

    mockListTenantUsersDirectory.mockResolvedValue([
      {
        membership_id: membershipOwner.id,
        tenant_id: tenantAlpha.id,
        user_id: 'user-alpha-1',
        username: 'admin',
        display_name: 'مالك ألفا',
        account_subject_type: AccountSubjectType.STAFF,
        role_key: 'company_owner',
        role_id: 'role-owner',
        role_name: 'مالك الشركة',
        is_active: true,
        must_change_password: false,
        client_id: null,
        client_code: null,
        client_name: null,
        courier_id: null,
        branch_ids: [],
        branch_names: [],
        created_at: '2026-11-18T10:00:00Z',
      },
      {
        membership_id: 'mem-client-1',
        tenant_id: tenantAlpha.id,
        user_id: 'user-client-1',
        username: 'nile.merchant',
        display_name: 'محمود التاجر',
        account_subject_type: AccountSubjectType.CLIENT,
        role_key: 'client_owner',
        role_id: 'role-client',
        role_name: 'حساب عميل (تاجر)',
        is_active: true,
        must_change_password: true,
        client_id: 'cl-1',
        client_code: 'CL-001',
        client_name: 'متجر النيل',
        courier_id: null,
        branch_ids: [],
        branch_names: [],
        created_at: '2026-11-18T10:00:00Z',
      },
    ]);

    mockListPermissionsCatalog.mockResolvedValue([
      {
        key: 'users.manage',
        module: 'security',
        label_ar: 'إدارة المستخدمين',
        description_ar: null,
        default_scope: PermissionScope.TENANT,
        is_sensitive: true,
      },
      {
        key: 'shipments.view',
        module: 'shipments',
        label_ar: 'عرض الشحنات',
        description_ar: null,
        default_scope: PermissionScope.BRANCH,
        is_sensitive: false,
      },
    ]);

    mockListRolePermissions.mockResolvedValue([
      {
        id: 'rp-1',
        tenant_id: tenantAlpha.id,
        role_id: 'role-branch',
        permission_key: 'shipments.view',
        scope: PermissionScope.BRANCH,
      },
    ]);

    mockListTenantSessionAudit.mockResolvedValue([
      {
        id: 'aud-1',
        tenant_id: tenantAlpha.id,
        user_id: 'user-alpha-1',
        username: 'admin',
        display_name: 'مالك ألفا',
        event_type: 'login_success',
        metadata: {channel: 'username'},
        created_at: '2026-11-18T12:00:00Z',
      },
      {
        id: 'aud-2',
        tenant_id: tenantAlpha.id,
        user_id: null,
        username: 'unknown.user',
        display_name: null,
        event_type: 'login_failed',
        metadata: {reason: 'invalid_credentials'},
        created_at: '2026-11-18T11:30:00Z',
      },
    ]);
  });

  it('evaluates hasEffectivePermission accurately for owner bypass and branch scope', () => {
    expect(hasEffectivePermission('company_owner', [], 'anything.here')).toBe(true);

    const grants = [{permission_key: 'shipments.view', scope: PermissionScope.BRANCH}];
    expect(hasEffectivePermission('branch_manager', grants, 'shipments.view', ['br-1'], 'br-1')).toBe(true);
    expect(hasEffectivePermission('branch_manager', grants, 'shipments.view', ['br-1'], 'br-2')).toBe(false);
    expect(hasEffectivePermission('branch_manager', grants, 'users.manage', ['br-1'], 'br-1')).toBe(false);

    const tenantGrants = [{permission_key: 'shipments.view', scope: PermissionScope.TENANT}];
    expect(hasEffectivePermission('operations_manager', tenantGrants, 'shipments.view', ['br-1'], 'br-2')).toBe(
      true,
    );
  });

  it('renders UsersManagementPage with security sidebar, dynamic client/courier role fields, and creates user', async () => {
    mockCreateTenantUser.mockResolvedValue('mem-new-1');

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/security/users']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('@nile.merchant')).toBeInTheDocument();
    });
    expect(screen.getByText(/متجر النيل/)).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'المستخدمون'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'الأدوار والصلاحيات'})).toBeInTheDocument();
    expect(screen.getByRole('link', {name: 'سجل الدخول والجلسات'})).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'إضافة مستخدم جديد'}));
    expect(screen.queryByLabelText(/ربط الحساب بملف العميل/)).not.toBeInTheDocument();
    expect(screen.getByText(/CAI — فرع القاهرة/)).toBeInTheDocument();

    // Switch role to client_owner -> shows client selector
    fireEvent.change(screen.getByLabelText(/الدور الوظيفي/), {target: {value: 'role-client'}});
    expect(screen.getByLabelText(/ربط الحساب بملف العميل/)).toHaveValue('cl-1');

    // Switch role to delivery_agent -> hides client selector and shows courier selector (#usr-courier)
    fireEvent.change(screen.getByLabelText(/الدور الوظيفي/), {target: {value: 'role-courier'}});
    expect(screen.queryByLabelText(/ربط الحساب بملف العميل/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/ربط الحساب بملف المندوب/)).toHaveValue('cr-1');

    // Switch back to branch_manager, fill and submit
    fireEvent.change(screen.getByLabelText(/الدور الوظيفي/), {target: {value: 'role-branch'}});
    fireEvent.change(screen.getByLabelText(/اسم المستخدم للدخول/), {target: {value: 'branch.ops'}});
    fireEvent.change(screen.getByLabelText(/الاسم الكامل/), {target: {value: 'كريم محمد'}});
    fireEvent.change(screen.getByLabelText(/كلمة المرور المؤقتة/), {target: {value: 'SecretPass123!'}});
    fireEvent.click(screen.getByRole('checkbox', {name: /CAI — فرع القاهرة/}));

    fireEvent.click(screen.getByRole('button', {name: 'إنشاء المستخدم'}));

    await waitFor(() => {
      expect(mockCreateTenantUser).toHaveBeenCalledWith({
        tenantId: tenantAlpha.id,
        username: 'branch.ops',
        displayName: 'كريم محمد',
        password: 'SecretPass123!',
        roleId: 'role-branch',
        clientId: null,
        courierId: null,
        branchIds: ['br-1'],
      });
    });
  });

  it('renders RolesPermissionsPage, switches role permissions, and creates a custom role', async () => {
    mockCreateCustomRole.mockResolvedValue('role-custom-1');

    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/security/roles']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', {name: 'الأدوار ومصفوفة الصلاحيات'})).toBeInTheDocument();
    });

    expect(screen.getByRole('button', {name: /مالك الشركة/})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /مدير فرع/})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /مندوب توصيل/})).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: /مدير فرع/}));
    await waitFor(() => {
      expect(mockListRolePermissions).toHaveBeenCalledWith(tenantAlpha.id, 'role-branch');
    });

    fireEvent.click(screen.getByRole('button', {name: 'إضافة دور مخصص'}));
    fireEvent.change(screen.getByLabelText(/كود الدور/), {target: {value: 'branch_auditor'}});
    fireEvent.change(screen.getByLabelText(/اسم الدور/), {target: {value: 'مراجع فروع'}});
    fireEvent.click(screen.getByRole('button', {name: 'حفظ الدور'}));

    await waitFor(() => {
      expect(mockCreateCustomRole).toHaveBeenCalledWith(tenantAlpha.id, {
        code: 'branch_auditor',
        name: 'مراجع فروع',
        description: null,
        default_subject_type: 'staff',
        default_scope: PermissionScope.BRANCH,
      });
    });
  });

  it('renders SessionAuditPage with login_success and login_failed events', async () => {
    render(
      <MemoryRouter initialEntries={['/c/alpha-express/app/security/sessions']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('تسجيل دخول ناجح')).toBeInTheDocument();
    });
    expect(screen.getByText('محاولة دخول فاشلة')).toBeInTheDocument();
    expect(screen.getByText('@admin')).toBeInTheDocument();
    expect(screen.getByText('@unknown.user')).toBeInTheDocument();
  });
});
