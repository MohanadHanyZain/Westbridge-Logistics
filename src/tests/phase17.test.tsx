import {beforeEach, describe, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {AppRoutes} from '@/App';
import {APPROVED_DECISIONS, ROADMAP_PHASES} from '@/app/phaseRoadmapData';
import {PhaseStatus} from '@/types/common';
import type {LaunchReadinessOverview} from '@/types/launch';
import type {PlatformSupportAccessRecord, PlatformTenantDirectoryItem, SubscriptionPlanRecord, TenantDomainRecord} from '@/types/tenant';

const mockUseAuth = vi.fn();
const mockGetLaunchReadinessOverview = vi.fn();
const mockUpdateBackupPolicy = vi.fn();
const mockRecordBackupRestoreDrill = vi.fn();

vi.mock('@/lib/auth', () => ({
  AuthProvider: ({children}: {children: React.ReactNode}) => <>{children}</>,
  useAuth: () => mockUseAuth(),
  updateMyCredentials: vi.fn(),
  GENERIC_LOGIN_ERROR: 'اسم المستخدم أو كلمة المرور غير صحيحة.',
}));

vi.mock('@/features/launch/launchService', () => ({
  getLaunchReadinessOverview: (...args: unknown[]) => mockGetLaunchReadinessOverview(...args),
  updateBackupPolicy: (...args: unknown[]) => mockUpdateBackupPolicy(...args),
  recordBackupRestoreDrill: (...args: unknown[]) => mockRecordBackupRestoreDrill(...args),
}));

vi.mock('@/features/tenants/tenantService', () => ({
  fetchPublicTenantBySlug: vi.fn().mockResolvedValue(null),
  listAllTenants: vi.fn().mockResolvedValue([]),
  onboardNewTenant: vi.fn(),
  updateTenantStatus: vi.fn(),
  listPlatformTenantsDirectory: vi.fn().mockResolvedValue([] as PlatformTenantDirectoryItem[]),
  listSubscriptionPlans: vi.fn().mockResolvedValue([] as SubscriptionPlanRecord[]),
  upsertSubscriptionPlan: vi.fn(),
  assignTenantSubscription: vi.fn(),
  listTenantDomains: vi.fn().mockResolvedValue([] as TenantDomainRecord[]),
  upsertTenantDomain: vi.fn(),
  verifyTenantDomain: vi.fn(),
  deleteTenantDomain: vi.fn(),
  listPlatformSupportSessions: vi.fn().mockResolvedValue([] as PlatformSupportAccessRecord[]),
  requestPlatformSupportAccess: vi.fn(),
  revokePlatformSupportAccess: vi.fn(),
  getPlatformTenantSupportSnapshot: vi.fn(),
  getTenantSubscriptionOverview: vi.fn(),
}));

function buildOverview(overrides?: Partial<LaunchReadinessOverview>): LaunchReadinessOverview {
  return {
    policy: {
      id: 'pol-1',
      policy_code: 'DEFAULT',
      rpo_minutes: 15,
      rto_minutes: 60,
      storage_rto_minutes: 120,
      retention_days: 30,
      pitr_enabled: true,
      daily_snapshot_enabled: true,
      storage_sync_enabled: true,
      drill_cadence_days: 30,
      last_verified_drill_at: '2026-11-22T10:00:00Z',
      notes: 'سياسة PITR معتمدة وفق ADR-025',
      updated_at: '2026-11-22T10:00:00Z',
    },
    drills: [
      {
        id: 'drill-1',
        environment: 'isolated_clone',
        backup_point_at: '2026-11-22T09:30:00Z',
        started_at: '2026-11-22T09:35:00Z',
        completed_at: '2026-11-22T10:00:00Z',
        rto_achieved_minutes: 25,
        storage_verified: true,
        rls_verified: true,
        status: 'passed',
        notes: 'اختبار استعادة ناجح والتحقق من Storage وFORCE RLS',
        executed_by: 'super-1',
        created_at: '2026-11-22T10:00:00Z',
      },
    ],
    security_audit: {
      checked_at: '2026-11-22T12:00:00Z',
      total_public_tables: 58,
      rls_enabled_count: 58,
      rls_forced_count: 58,
      unprotected_tables_count: 0,
      unprotected_tables: [],
      password_columns_count: 0,
      token_hash_exposed: false,
      app_private_exposed: false,
      audit_schema_exposed: false,
      private_storage_buckets_count: 3,
      public_exposed_buckets_count: 0,
      performance_indexes_count: 42,
    },
    operational_metrics: {
      total_tenants: 4,
      active_tenants: 4,
      active_plans: 3,
      active_api_tokens: 5,
      active_webhooks: 3,
      pending_webhooks: 0,
      total_shipments: 120,
      passed_drills_count: 1,
    },
    ready_for_launch: true,
    ...overrides,
  };
}

describe('Phase 17: Backup, Restore Drills, Security Audit & Launch Readiness (ADR-025)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLaunchReadinessOverview.mockResolvedValue(buildOverview());
  });

  it('tracks Phase 16 APPROVED, Phase 17 READY_FOR_OWNER_REVIEW, and ADR-025 in roadmap metadata', () => {
    const phase16 = ROADMAP_PHASES.find((p) => p.phaseNumber === 16);
    const phase17 = ROADMAP_PHASES.find((p) => p.phaseNumber === 17);
    const adr025 = APPROVED_DECISIONS.find((d) => d.code === 'ADR-025');

    expect(phase16?.status).toBe(PhaseStatus.APPROVED);
    expect(phase17?.status).toBe(PhaseStatus.READY_FOR_OWNER_REVIEW);
    expect(phase17?.hasOpenDecisions).toBe(false);
    expect(adr025).toBeDefined();
  });

  it('renders live PostgreSQL security audit, updates RPO/RTO policy, and records restore drills as super admin', async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: {id: 'super-1', email: 'super@shipflow.local'},
      profile: {id: 'super-1', display_name: 'مالك المنصة', is_platform_user: true, is_active: true},
      platformAdmin: {
        user_id: 'super-1',
        role_key: 'platform_super_admin',
        username: 'superadmin',
        is_active: true,
      },
      memberships: [],
      signOut: vi.fn(),
    });

    mockUpdateBackupPolicy.mockResolvedValue(buildOverview().policy);
    mockRecordBackupRestoreDrill.mockResolvedValue(buildOverview().drills[0]);

    render(
      <MemoryRouter initialEntries={['/platform']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    const launchTab = await screen.findByRole('tab', {name: 'النسخ الاحتياطي والإطلاق'});
    fireEvent.click(launchTab);

    await waitFor(() => {
      expect(mockGetLaunchReadinessOverview).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText('النظام مستوفٍ لشروط الإطلاق الإنتاجي')).toBeInTheDocument();
    expect(screen.getByText('58 / 58 جدول محمي بالكامل')).toBeInTheDocument();
    expect(screen.getByText('اختبار استعادة ناجح والتحقق من Storage وFORCE RLS')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('مستهدف RTO لقاعدة البيانات (دقيقة)'), {
      target: {value: '45'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'حفظ سياسة النسخ الاحتياطي'}));

    await waitFor(() => {
      expect(mockUpdateBackupPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          rpo_minutes: 15,
          rto_minutes: 45,
          storage_rto_minutes: 120,
          retention_days: 30,
          pitr_enabled: true,
        }),
      );
    });

    fireEvent.change(screen.getByLabelText('زمن الاستعادة الفعلي المحقق (دقيقة)'), {
      target: {value: '22'},
    });
    fireEvent.change(screen.getByLabelText('تقرير / ملاحظات الاستعادة'), {
      target: {value: 'تمرين استعادة قبل الإطلاق'},
    });
    fireEvent.click(screen.getByRole('button', {name: 'توثيق اختبار الاستعادة'}));

    await waitFor(() => {
      expect(mockRecordBackupRestoreDrill).toHaveBeenCalledWith(
        expect.objectContaining({
          environment: 'isolated_clone',
          rto_achieved_minutes: 22,
          storage_verified: true,
          rls_verified: true,
          status: 'passed',
          notes: 'تمرين استعادة قبل الإطلاق',
        }),
      );
    });
  });

  it('enforces read-only view for platform_support and warns when unprotected tables or missing drills exist', async () => {
    mockUseAuth.mockReturnValue({
      loading: false,
      user: {id: 'sup-1', email: 'support@shipflow.local'},
      profile: {id: 'sup-1', display_name: 'دعم المنصة', is_platform_user: true, is_active: true},
      platformAdmin: {
        user_id: 'sup-1',
        role_key: 'platform_support',
        username: 'support1',
        is_active: true,
      },
      memberships: [],
      signOut: vi.fn(),
    });

    mockGetLaunchReadinessOverview.mockResolvedValue(
      buildOverview({
        drills: [],
        ready_for_launch: false,
        operational_metrics: {
          ...buildOverview().operational_metrics,
          passed_drills_count: 0,
        },
        security_audit: {
          ...buildOverview().security_audit,
          unprotected_tables_count: 1,
          unprotected_tables: ['legacy_temp'],
        },
      }),
    );

    render(
      <MemoryRouter initialEntries={['/platform']}>
        <AppRoutes />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('tab', {name: 'النسخ الاحتياطي والإطلاق'}));

    await waitFor(() => {
      expect(screen.getByText('مطلوب استكمال متطلبات الإطلاق قبل التفعيل')).toBeInTheDocument();
    });

    expect(screen.getByText('جداول غير محمية: legacy_temp')).toBeInTheDocument();
    expect(screen.getByText(/عرض فقط: تعديل سياسة النسخ الاحتياطي متاح حصريًا/)).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'حفظ سياسة النسخ الاحتياطي'})).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'توثيق اختبار الاستعادة'})).not.toBeInTheDocument();
  });
});
