import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {BRAND_CONFIG, buildTenantBasePath} from '@/config/brand';
import {useAuth} from '@/lib/auth';
import {formatDateTime, isValidCompanySlug, isValidUsername} from '@/lib/formatters';
import * as tenantService from '@/features/tenants/tenantService';
import type {
  BillingCycle,
  DomainType,
  PlatformSupportAccessRecord,
  PlatformSupportSnapshot,
  PlatformTenantDirectoryItem,
  SubscriptionPlanRecord,
  SubscriptionStatus,
  SupportAccessMode,
  TenantDomainRecord,
  TenantRecord,
  TenantStatus,
} from '@/types/tenant';
import {LaunchReadinessPanel} from '@/features/launch/LaunchReadinessPanel';
import {
  Activity,
  Building2,
  CheckCircle2,
  DatabaseBackup,
  ExternalLink,
  Globe,
  Layers,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sliders,
  Trash2,
  XCircle,
} from 'lucide-react';

type PlatformTab = 'companies' | 'plans' | 'domains' | 'support' | 'launch';

function getTenantStatusLabel(status: TenantStatus): {label: string; className: string} {
  switch (status) {
    case 'active':
      return {label: 'نشطة', className: 'text-emerald-700'};
    case 'suspended':
      return {label: 'موقوفة', className: 'text-amber-700'};
    case 'archived':
      return {label: 'مؤرشفة', className: 'text-slate-500'};
  }
}

function getSubscriptionStatusLabel(status: SubscriptionStatus): string {
  switch (status) {
    case 'trial':
      return 'تجريبي';
    case 'active':
      return 'نشط';
    case 'past_due':
      return 'متأخر السداد';
    case 'suspended':
      return 'موقوف';
    case 'cancelled':
      return 'ملغي';
  }
}

function formatLimit(used: number, max: number | null): string {
  return max === null ? `${used} / مفتوح` : `${used} / ${max}`;
}

export function PlatformTenantsPage() {
  const {platformAdmin, profile, user, signOut} = useAuth();
  const isSuperAdmin = platformAdmin?.role_key === 'platform_super_admin';

  const [activeTab, setActiveTab] = useState<PlatformTab>('companies');
  const [directory, setDirectory] = useState<readonly PlatformTenantDirectoryItem[]>([]);
  const [plans, setPlans] = useState<readonly SubscriptionPlanRecord[]>([]);
  const [domains, setDomains] = useState<readonly TenantDomainRecord[]>([]);
  const [supportSessions, setSupportSessions] = useState<readonly PlatformSupportAccessRecord[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(
    null,
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TenantStatus>('all');

  // Onboard new tenant form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [code, setCode] = useState('');
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [ownerDisplayName, setOwnerDisplayName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerUsername, setOwnerUsername] = useState('admin');
  const [submitting, setSubmitting] = useState(false);
  const [formFeedback, setFormFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(
    null,
  );

  // Assign subscription & quota overrides
  const [editingSubTenant, setEditingSubTenant] = useState<PlatformTenantDirectoryItem | null>(null);
  const [subPlanCode, setSubPlanCode] = useState('STARTER');
  const [subStatus, setSubStatus] = useState<SubscriptionStatus>('active');
  const [subCycle, setSubCycle] = useState<BillingCycle>('monthly');
  const [ovBranches, setOvBranches] = useState('');
  const [ovUsers, setOvUsers] = useState('');
  const [ovCouriers, setOvCouriers] = useState('');
  const [ovShipments, setOvShipments] = useState('');
  const [subNotes, setSubNotes] = useState('');
  const [savingSub, setSavingSub] = useState(false);

  // Plan upsert form
  const [editingPlanId, setEditingPlanId] = useState<string | undefined>(undefined);
  const [planCode, setPlanCode] = useState('');
  const [planNameAr, setPlanNameAr] = useState('');
  const [planDescAr, setPlanDescAr] = useState('');
  const [planMonthlyPrice, setPlanMonthlyPrice] = useState('950');
  const [planAnnualPrice, setPlanAnnualPrice] = useState('9500');
  const [planMaxBranches, setPlanMaxBranches] = useState('3');
  const [planMaxUsers, setPlanMaxUsers] = useState('10');
  const [planMaxCouriers, setPlanMaxCouriers] = useState('10');
  const [planMaxShipments, setPlanMaxShipments] = useState('1000');
  const [planAllowDomain, setPlanAllowDomain] = useState(false);
  const [planAllowApi, setPlanAllowApi] = useState(false);
  const [planIsActive, setPlanIsActive] = useState(true);
  const [savingPlan, setSavingPlan] = useState(false);

  // Domain management form
  const [domainTenantId, setDomainTenantId] = useState('');
  const [domainHost, setDomainHost] = useState('');
  const [domainType, setDomainType] = useState<DomainType>('custom');
  const [domainPrimary, setDomainPrimary] = useState(false);
  const [savingDomain, setSavingDomain] = useState(false);

  // Support access form & diagnostic snapshot
  const [supportTenantId, setSupportTenantId] = useState('');
  const [supportReason, setSupportReason] = useState('');
  const [supportDuration, setSupportDuration] = useState(60);
  const [supportMode, setSupportMode] = useState<SupportAccessMode>('read_only');
  const [savingSupport, setSavingSupport] = useState(false);
  const [supportSnapshot, setSupportSnapshot] = useState<PlatformSupportSnapshot | null>(null);

  const loadAllPlatformData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const exportedKeys = Object.keys(tenantService);
      const hasDirectoryFn =
        exportedKeys.includes('listPlatformTenantsDirectory') &&
        typeof tenantService.listPlatformTenantsDirectory === 'function';
      const hasPlansFn =
        exportedKeys.includes('listSubscriptionPlans') &&
        typeof tenantService.listSubscriptionPlans === 'function';
      const hasDomainsFn =
        exportedKeys.includes('listTenantDomains') &&
        typeof tenantService.listTenantDomains === 'function';
      const hasSupportFn =
        exportedKeys.includes('listPlatformSupportSessions') &&
        typeof tenantService.listPlatformSupportSessions === 'function';

      let directoryItems: readonly PlatformTenantDirectoryItem[] = [];
      if (hasDirectoryFn) {
        const dirRows = await tenantService.listPlatformTenantsDirectory().catch(() => []);
        if (dirRows.length > 0) {
          directoryItems = dirRows;
        } else {
          const fallbackRows = await tenantService.listAllTenants();
          directoryItems = fallbackRows.map((tenant) => ({
            tenant,
            subscription: null,
            usage: {active_branches: 0, active_users: 0, active_couriers: 0, month_shipments: 0},
            primary_domain: null,
            domains_count: 0,
            active_support_sessions_count: 0,
          }));
        }
      } else {
        const fallbackRows = await tenantService.listAllTenants();
        directoryItems = fallbackRows.map((tenant) => ({
          tenant,
          subscription: null,
          usage: {active_branches: 0, active_users: 0, active_couriers: 0, month_shipments: 0},
          primary_domain: null,
          domains_count: 0,
          active_support_sessions_count: 0,
        }));
      }

      const [plansData, domainsData, sessionsData] = await Promise.all([
        hasPlansFn ? tenantService.listSubscriptionPlans().catch(() => []) : Promise.resolve([]),
        hasDomainsFn ? tenantService.listTenantDomains(null).catch(() => []) : Promise.resolve([]),
        hasSupportFn ? tenantService.listPlatformSupportSessions(null).catch(() => []) : Promise.resolve([]),
      ]);

      setDirectory(directoryItems);
      setPlans(plansData);
      setDomains(domainsData);
      setSupportSessions(sessionsData);

      if (directoryItems.length > 0) {
        const firstId = directoryItems[0].tenant.id;
        setDomainTenantId((prev) => prev || firstId);
        setSupportTenantId((prev) => prev || firstId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات المنصة.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAllPlatformData();
  }, [loadAllPlatformData]);

  const filteredDirectory = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return directory.filter((item) => {
      const t = item.tenant;
      if (statusFilter !== 'all' && t.status !== statusFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        (item.primary_domain ?? '').toLowerCase().includes(q)
      );
    });
  }, [directory, searchQuery, statusFilter]);

  const kpis = useMemo(() => {
    const activeCompanies = directory.filter((d) => d.tenant.status === 'active').length;
    const paidOrTrial = directory.filter(
      (d) => d.subscription && (d.subscription.status === 'active' || d.subscription.status === 'trial'),
    ).length;
    const activeSupport = supportSessions.filter(
      (s) => !s.revoked_at && new Date(s.expires_at).getTime() > Date.now(),
    ).length;
    return {
      totalCompanies: directory.length,
      activeCompanies,
      paidOrTrial,
      activeSupport,
    };
  }, [directory, supportSessions]);

  const handleOnboardSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormFeedback(null);

    if (!isValidCompanySlug(slug)) {
      setFormFeedback({
        type: 'error',
        text: 'المعرّف النصي (Slug) يجب أن يتكون من أحرف إنجليزية صغيرة وأرقام وشرطة فقط (مثال: cairo-express).',
      });
      return;
    }

    if (!isValidUsername(ownerUsername)) {
      setFormFeedback({
        type: 'error',
        text: 'اسم مستخدم المالك يجب أن يكون 3–32 حرفًا إنجليزيًا/رقميًا.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await tenantService.onboardNewTenant({
        idempotencyKey,
        code,
        slug,
        name,
        ownerEmail,
        ownerUsername,
        ownerDisplayName,
      });

      setFormFeedback({
        type: 'success',
        text: res.already_existed
          ? 'تم استرجاع الشركة المنشأة مسبقًا بنفس مفتاح عدم التكرار.'
          : 'تم تأسيس الشركة وإرسال رابط الدعوة لبريد المالك بنجاح.',
      });

      setCode('');
      setSlug('');
      setName('');
      setOwnerDisplayName('');
      setOwnerEmail('');
      setOwnerUsername('admin');
      setIdempotencyKey(crypto.randomUUID());
      await loadAllPlatformData();
    } catch (err) {
      setFormFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تأسيس الشركة.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (tenant: TenantRecord) => {
    const nextStatus: TenantStatus = tenant.status === 'active' ? 'suspended' : 'active';
    try {
      await tenantService.updateTenantStatus(tenant.id, nextStatus);
      await loadAllPlatformData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تغيير حالة الشركة.');
    }
  };

  const openSubscriptionEditor = (item: PlatformTenantDirectoryItem) => {
    setEditingSubTenant(item);
    setSubPlanCode(item.subscription?.plan_code ?? 'STARTER');
    setSubStatus(item.subscription?.status ?? 'active');
    setSubCycle(item.subscription?.billing_cycle ?? 'monthly');
    setOvBranches(item.subscription?.override_max_branches != null ? String(item.subscription.override_max_branches) : '');
    setOvUsers(item.subscription?.override_max_users != null ? String(item.subscription.override_max_users) : '');
    setOvCouriers(item.subscription?.override_max_couriers != null ? String(item.subscription.override_max_couriers) : '');
    setOvShipments(
      item.subscription?.override_max_monthly_shipments != null
        ? String(item.subscription.override_max_monthly_shipments)
        : '',
    );
    setSubNotes(item.subscription?.notes ?? '');
    setActionFeedback(null);
  };

  const handleSaveTenantSubscription = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingSubTenant || !isSuperAdmin) return;
    setSavingSub(true);
    setActionFeedback(null);
    try {
      await tenantService.assignTenantSubscription(editingSubTenant.tenant.id, {
        plan_code: subPlanCode,
        status: subStatus,
        billing_cycle: subCycle,
        override_max_branches: ovBranches.trim() ? Number(ovBranches) : null,
        override_max_users: ovUsers.trim() ? Number(ovUsers) : null,
        override_max_couriers: ovCouriers.trim() ? Number(ovCouriers) : null,
        override_max_monthly_shipments: ovShipments.trim() ? Number(ovShipments) : null,
        notes: subNotes.trim() || null,
      });
      setActionFeedback({
        type: 'success',
        text: `تم تحديث اشتراك وحدود شركة «${editingSubTenant.tenant.name}» بنجاح.`,
      });
      setEditingSubTenant(null);
      await loadAllPlatformData();
    } catch (err) {
      setActionFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحديث اشتراك الشركة.',
      });
    } finally {
      setSavingSub(false);
    }
  };

  const selectPlanForEdit = (plan: SubscriptionPlanRecord) => {
    setEditingPlanId(plan.id);
    setPlanCode(plan.code);
    setPlanNameAr(plan.name_ar);
    setPlanDescAr(plan.description_ar ?? '');
    setPlanMonthlyPrice(String(plan.monthly_price_egp));
    setPlanAnnualPrice(String(plan.annual_price_egp));
    setPlanMaxBranches(plan.max_branches != null ? String(plan.max_branches) : '');
    setPlanMaxUsers(plan.max_users != null ? String(plan.max_users) : '');
    setPlanMaxCouriers(plan.max_couriers != null ? String(plan.max_couriers) : '');
    setPlanMaxShipments(plan.max_monthly_shipments != null ? String(plan.max_monthly_shipments) : '');
    setPlanAllowDomain(plan.allow_custom_domain);
    setPlanAllowApi(plan.allow_api_access);
    setPlanIsActive(plan.is_active);
  };

  const resetPlanForm = () => {
    setEditingPlanId(undefined);
    setPlanCode('');
    setPlanNameAr('');
    setPlanDescAr('');
    setPlanMonthlyPrice('950');
    setPlanAnnualPrice('9500');
    setPlanMaxBranches('3');
    setPlanMaxUsers('10');
    setPlanMaxCouriers('10');
    setPlanMaxShipments('1000');
    setPlanAllowDomain(false);
    setPlanAllowApi(false);
    setPlanIsActive(true);
  };

  const handleSavePlan = async (e: FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) return;
    setSavingPlan(true);
    setActionFeedback(null);
    try {
      await tenantService.upsertSubscriptionPlan({
        id: editingPlanId,
        code: planCode.trim().toUpperCase(),
        name_ar: planNameAr.trim(),
        description_ar: planDescAr.trim() || null,
        monthly_price_egp: Number(planMonthlyPrice || 0),
        annual_price_egp: Number(planAnnualPrice || 0),
        max_branches: planMaxBranches.trim() ? Number(planMaxBranches) : null,
        max_users: planMaxUsers.trim() ? Number(planMaxUsers) : null,
        max_couriers: planMaxCouriers.trim() ? Number(planMaxCouriers) : null,
        max_monthly_shipments: planMaxShipments.trim() ? Number(planMaxShipments) : null,
        allow_custom_domain: planAllowDomain,
        allow_api_access: planAllowApi,
        is_active: planIsActive,
      });
      setActionFeedback({type: 'success', text: 'تم حفظ بيانات الباقة بنجاح.'});
      resetPlanForm();
      await loadAllPlatformData();
    } catch (err) {
      setActionFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر حفظ الباقة.'});
    } finally {
      setSavingPlan(false);
    }
  };

  const handleSaveDomain = async (e: FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin || !domainTenantId) return;
    setSavingDomain(true);
    setActionFeedback(null);
    try {
      await tenantService.upsertTenantDomain(domainTenantId, {
        domain: domainHost.trim().toLowerCase(),
        domain_type: domainType,
        is_primary: domainPrimary,
      });
      setActionFeedback({type: 'success', text: 'تم تسجيل النطاق وإصدار رمز التحقق DNS TXT.'});
      setDomainHost('');
      setDomainPrimary(false);
      await loadAllPlatformData();
    } catch (err) {
      setActionFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر حفظ النطاق.'});
    } finally {
      setSavingDomain(false);
    }
  };

  const handleVerifyDomain = async (dom: TenantDomainRecord, markVerified: boolean) => {
    if (!isSuperAdmin) return;
    setActionFeedback(null);
    try {
      await tenantService.verifyTenantDomain(dom.tenant_id, dom.id, markVerified);
      setActionFeedback({
        type: 'success',
        text: markVerified ? `تم توثيق النطاق ${dom.domain} وتفعيل SSL.` : `تم تعليق النطاق ${dom.domain}.`,
      });
      await loadAllPlatformData();
    } catch (err) {
      setActionFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر تحديث النطاق.'});
    }
  };

  const handleDeleteDomain = async (dom: TenantDomainRecord) => {
    if (!isSuperAdmin) return;
    setActionFeedback(null);
    try {
      await tenantService.deleteTenantDomain(dom.tenant_id, dom.id);
      setActionFeedback({type: 'success', text: `تم حذف النطاق ${dom.domain}.`});
      await loadAllPlatformData();
    } catch (err) {
      setActionFeedback({type: 'error', text: err instanceof Error ? err.message : 'تعذر حذف النطاق.'});
    }
  };

  const handleRequestSupport = async (e: FormEvent) => {
    e.preventDefault();
    if (!supportTenantId) return;
    setSavingSupport(true);
    setActionFeedback(null);
    try {
      const granted = await tenantService.requestPlatformSupportAccess(
        supportTenantId,
        supportReason,
        supportDuration,
        supportMode,
      );
      setSupportReason('');
      setActionFeedback({
        type: 'success',
        text: 'تم فتح جلسة دعم فني مؤقتة وتوثيق السبب في سجل التدقيق.',
      });
      await loadAllPlatformData();
      const snapshot = await tenantService.getPlatformTenantSupportSnapshot(granted.tenant_id).catch(() => null);
      if (snapshot) {
        setSupportSnapshot(snapshot);
      }
    } catch (err) {
      setActionFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر فتح جلسة الدعم.',
      });
    } finally {
      setSavingSupport(false);
    }
  };

  const handleOpenSupportSnapshot = async (tenantId: string) => {
    setActionFeedback(null);
    try {
      const snap = await tenantService.getPlatformTenantSupportSnapshot(tenantId);
      setSupportSnapshot(snap);
    } catch (err) {
      setActionFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر فتح لوحة التشخيص.',
      });
    }
  };

  const handleRevokeSupport = async (accessId: string) => {
    setActionFeedback(null);
    try {
      await tenantService.revokePlatformSupportAccess(accessId);
      setActionFeedback({type: 'success', text: 'تم إنهاء جلسة الدعم وتوثيق الإغلاق.'});
      if (supportSnapshot?.support_session.id === accessId) {
        setSupportSnapshot(null);
      }
      await loadAllPlatformData();
    } catch (err) {
      setActionFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر إنهاء جلسة الدعم.',
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-4">
          <Link to="/" className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            {BRAND_CONFIG.appName}
          </Link>

          <nav aria-label="تنقل المنصة" className="flex items-center gap-6">
            <Link
              to="/platform"
              className="border-b-2 border-slate-900 pb-1 text-sm font-medium text-slate-900 whitespace-nowrap shrink-0"
            >
              الشركات
            </Link>
            <Link
              to="/architecture"
              className="border-b-2 border-transparent pb-1 text-sm font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              خارطة المراحل
            </Link>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden text-xs text-slate-600 md:inline">
              {profile?.display_name ?? platformAdmin?.username}
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <LogOut className="h-3.5 w-3.5" />
              خروج
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">
              المنصة المركزية · الاشتراكات والنطاقات والدعم المراقب (ADR-023)
            </p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">شركات الشحن المسجلة</h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void loadAllPlatformData()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              تحديث
            </button>

            {isSuperAdmin && (
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm((prev) => !prev);
                  setFormFeedback(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                {showCreateForm ? 'إغلاق النموذج' : 'إضافة شركة شحن جديدة'}
              </button>
            )}
          </div>
        </div>

        {/* Platform KPIs */}
        <section aria-label="ملخص المنصة" className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">إجمالي شركات الشحن</p>
            <p className="mt-1 font-mono-tabular text-2xl font-bold text-slate-900">{kpis.totalCompanies}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">شركات نشطة</p>
            <p className="mt-1 font-mono-tabular text-2xl font-bold text-emerald-700">{kpis.activeCompanies}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">اشتراكات سارية / تجريبية</p>
            <p className="mt-1 font-mono-tabular text-2xl font-bold text-slate-900">{kpis.paidOrTrial}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">جلسات دعم نشطة الآن</p>
            <p className="mt-1 font-mono-tabular text-2xl font-bold text-amber-700">{kpis.activeSupport}</p>
          </div>
        </section>

        {/* Sub-navigation tabs */}
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3" role="tablist" aria-label="أقسام المنصة المركزية">
          {(
            [
              {id: 'companies', label: 'الشركات والاشتراكات', icon: Building2},
              {id: 'plans', label: 'الباقات والحدود', icon: Layers},
              {id: 'domains', label: 'النطاقات المخصصة والفرعية', icon: Globe},
              {id: 'support', label: 'دخول الدعم المسبب', icon: ShieldCheck},
              {id: 'launch', label: 'النسخ الاحتياطي والإطلاق', icon: DatabaseBackup},
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => {
                  setActiveTab(tab.id);
                  setActionFeedback(null);
                }}
                className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {actionFeedback && (
          <div
            role={actionFeedback.type === 'error' ? 'alert' : 'status'}
            className={`rounded-xl border px-4 py-3 text-xs font-medium ${
              actionFeedback.type === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            {actionFeedback.text}
          </div>
        )}

        {showCreateForm && activeTab === 'companies' && (
          <section aria-label="نموذج تأسيس شركة جديدة" className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">تأسيس شركة شحن جديدة (يدوي + دعوة المالك)</h2>
            <p className="mt-1 text-xs text-slate-500">
              يُنشأ حساب مالك واحد فقط ويرسل له رابط تفعيل آمن عبر البريد الإلكتروني دون كلمة مرور ثابتة.
            </p>

            <form onSubmit={handleOnboardSubmit} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label htmlFor="tenant-name" className="block text-xs font-medium text-slate-700">
                  اسم الشركة
                </label>
                <input
                  id="tenant-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: القاهرة السريع للشحن"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="tenant-code" className="block text-xs font-medium text-slate-700">
                  كود الشركة
                </label>
                <input
                  id="tenant-code"
                  type="text"
                  required
                  dir="ltr"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="CAIRO_EXP"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="tenant-slug" className="block text-xs font-medium text-slate-700">
                  مسار الموقع (Slug)
                </label>
                <input
                  id="tenant-slug"
                  type="text"
                  required
                  dir="ltr"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder="cairo-express"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="owner-name" className="block text-xs font-medium text-slate-700">
                  اسم المالك
                </label>
                <input
                  id="owner-name"
                  type="text"
                  required
                  value={ownerDisplayName}
                  onChange={(e) => setOwnerDisplayName(e.target.value)}
                  placeholder="الاسم الكامل لمالك الشركة"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="owner-email" className="block text-xs font-medium text-slate-700">
                  بريد المالك الإلكتروني (للدعوة)
                </label>
                <input
                  id="owner-email"
                  type="email"
                  required
                  dir="ltr"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="owner@company.com"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="owner-username" className="block text-xs font-medium text-slate-700">
                  اسم المستخدم للمالك (Username)
                </label>
                <input
                  id="owner-username"
                  type="text"
                  required
                  dir="ltr"
                  value={ownerUsername}
                  onChange={(e) => setOwnerUsername(e.target.value.toLowerCase())}
                  placeholder="admin"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between pt-2 md:col-span-3">
                <p className="font-mono-tabular text-xs text-slate-500">
                  مفتاح عدم التكرار: {idempotencyKey.slice(0, 8)}...
                </p>

                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {submitting ? 'جاري التأسيس وإرسال الدعوة...' : 'تأسيس الشركة وإرسال الدعوة'}
                </button>
              </div>
            </form>

            {formFeedback && (
              <p
                role="status"
                className={`mt-4 text-xs font-medium ${
                  formFeedback.type === 'error' ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                {formFeedback.text}
              </p>
            )}
          </section>
        )}

        {/* TAB 1: COMPANIES & SUBSCRIPTIONS */}
        {activeTab === 'companies' && (
          <>
            {editingSubTenant && isSuperAdmin && (
              <section
                aria-label="تخصيص اشتراك وحدود الشركة"
                className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">
                      إدارة الباقة والحدود — {editingSubTenant.tenant.name}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      يمكنك ترقية الباقة أو وضع استثناءات مخصصة للسعة (اترك حقل الاستثناء فارغًا لاعتماد حدود الباقة).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingSubTenant(null)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    إلغاء
                  </button>
                </div>

                <form onSubmit={handleSaveTenantSubscription} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div>
                    <label htmlFor="sub-plan-select" className="block text-xs font-medium text-slate-700">
                      الباقة
                    </label>
                    <select
                      id="sub-plan-select"
                      value={subPlanCode}
                      onChange={(e) => setSubPlanCode(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                    >
                      {plans.map((p) => (
                        <option key={p.id} value={p.code}>
                          {p.name_ar} ({p.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="sub-status-select" className="block text-xs font-medium text-slate-700">
                      حالة الاشتراك
                    </label>
                    <select
                      id="sub-status-select"
                      value={subStatus}
                      onChange={(e) => setSubStatus(e.target.value as SubscriptionStatus)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                    >
                      <option value="trial">تجريبي</option>
                      <option value="active">نشط</option>
                      <option value="past_due">متأخر السداد</option>
                      <option value="suspended">موقوف</option>
                      <option value="cancelled">ملغي</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="sub-cycle-select" className="block text-xs font-medium text-slate-700">
                      دورة الفوترة
                    </label>
                    <select
                      id="sub-cycle-select"
                      value={subCycle}
                      onChange={(e) => setSubCycle(e.target.value as BillingCycle)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                    >
                      <option value="monthly">شهري</option>
                      <option value="annual">سنوي</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="sub-ov-branches" className="block text-xs font-medium text-slate-700">
                      استثناء حد الفروع (اختياري)
                    </label>
                    <input
                      id="sub-ov-branches"
                      type="number"
                      min={1}
                      value={ovBranches}
                      onChange={(e) => setOvBranches(e.target.value)}
                      placeholder="افتراضي الباقة"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                    />
                  </div>

                  <div>
                    <label htmlFor="sub-ov-users" className="block text-xs font-medium text-slate-700">
                      استثناء حد المستخدمين
                    </label>
                    <input
                      id="sub-ov-users"
                      type="number"
                      min={1}
                      value={ovUsers}
                      onChange={(e) => setOvUsers(e.target.value)}
                      placeholder="افتراضي الباقة"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                    />
                  </div>

                  <div>
                    <label htmlFor="sub-ov-couriers" className="block text-xs font-medium text-slate-700">
                      استثناء حد المناديب
                    </label>
                    <input
                      id="sub-ov-couriers"
                      type="number"
                      min={1}
                      value={ovCouriers}
                      onChange={(e) => setOvCouriers(e.target.value)}
                      placeholder="افتراضي الباقة"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                    />
                  </div>

                  <div>
                    <label htmlFor="sub-ov-shipments" className="block text-xs font-medium text-slate-700">
                      استثناء شحنات الشهر
                    </label>
                    <input
                      id="sub-ov-shipments"
                      type="number"
                      min={10}
                      value={ovShipments}
                      onChange={(e) => setOvShipments(e.target.value)}
                      placeholder="افتراضي الباقة"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                    />
                  </div>

                  <div>
                    <label htmlFor="sub-notes" className="block text-xs font-medium text-slate-700">
                      ملاحظات التعاقد
                    </label>
                    <input
                      id="sub-notes"
                      type="text"
                      value={subNotes}
                      onChange={(e) => setSubNotes(e.target.value)}
                      placeholder="مثال: تعاقد سنوي خاص"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                    />
                  </div>

                  <div className="md:col-span-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={savingSub}
                      className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {savingSub ? 'جاري الحفظ...' : 'حفظ الاشتراك والحدود'}
                    </button>
                  </div>
                </form>
              </section>
            )}

            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="relative">
                <Search className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث بالاسم أو الكود أو المسار..."
                  aria-label="بحث في الشركات"
                  className="w-72 rounded-lg border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                {(['all', 'active', 'suspended'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      statusFilter === st
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {st === 'all' ? 'الكل' : st === 'active' ? 'نشطة' : 'موقوفة'}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-right text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                      <th className="px-4 py-3">الكود</th>
                      <th className="px-4 py-3">الشركة</th>
                      <th className="px-4 py-3">المسار والنطاق</th>
                      <th className="px-4 py-3">الباقة</th>
                      <th className="px-4 py-3">الاستهلاك والحدود</th>
                      <th className="px-4 py-3">الحالة</th>
                      <th className="px-4 py-3">تاريخ التأسيس</th>
                      <th className="px-4 py-3">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loading ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                          جاري تحميل بيانات الشركات...
                        </td>
                      </tr>
                    ) : filteredDirectory.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                          <Building2 className="mx-auto mb-2 h-6 w-6 text-slate-400" />
                          لا توجد شركات مسجلة مطابقة للبحث.
                        </td>
                      </tr>
                    ) : (
                      filteredDirectory.map((item) => {
                        const {tenant, subscription, usage, primary_domain} = item;
                        const statusInfo = getTenantStatusLabel(tenant.status);
                        const publicPath = buildTenantBasePath(tenant.slug);
                        return (
                          <tr key={tenant.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-mono-tabular font-medium text-slate-900">
                              {tenant.code}
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-900">{tenant.name}</td>
                            <td className="px-4 py-3 font-mono-tabular text-xs text-slate-600" dir="ltr">
                              <div>{publicPath}</div>
                              {primary_domain && (
                                <div className="text-[11px] text-slate-400">{primary_domain}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {subscription ? (
                                <div>
                                  <span className="font-semibold text-slate-900">{subscription.plan_name_ar}</span>
                                  <span className="mr-1 font-mono-tabular text-[11px] text-slate-500">
                                    ({getSubscriptionStatusLabel(subscription.status)})
                                  </span>
                                </div>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 font-mono-tabular text-[11px] text-slate-600">
                              {subscription ? (
                                <div className="space-y-0.5">
                                  <div>فروع: {formatLimit(usage.active_branches, subscription.effective_max_branches)}</div>
                                  <div>شحنات الشهر: {formatLimit(usage.month_shipments, subscription.effective_max_monthly_shipments)}</div>
                                </div>
                              ) : (
                                <span>—</span>
                              )}
                            </td>
                            <td className={`px-4 py-3 text-xs font-medium ${statusInfo.className}`}>
                              {statusInfo.label}
                            </td>
                            <td className="px-4 py-3 font-mono-tabular text-xs text-slate-600">
                              {formatDateTime(tenant.created_at, tenant.default_timezone, tenant.default_locale)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap items-center gap-3">
                                <Link
                                  to={publicPath}
                                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  الموقع
                                </Link>
                                {isSuperAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => openSubscriptionEditor(item)}
                                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900"
                                  >
                                    <Sliders className="h-3.5 w-3.5" />
                                    إدارة الباقة والحدود
                                  </button>
                                )}
                                {isSuperAdmin && tenant.status !== 'archived' && (
                                  <button
                                    type="button"
                                    onClick={() => void handleToggleStatus(tenant)}
                                    className="text-xs font-medium text-slate-700 underline underline-offset-4 hover:text-slate-900"
                                  >
                                    {tenant.status === 'active' ? 'إيقاف' : 'تفعيل'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* TAB 2: SUBSCRIPTION PLANS & QUOTAS */}
        {activeTab === 'plans' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {plans.map((plan) => (
                <div key={plan.id} className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono-tabular text-xs font-bold text-slate-500">{plan.code}</span>
                      <span className={`text-xs font-medium ${plan.is_active ? 'text-emerald-700' : 'text-slate-400'}`}>
                        {plan.is_active ? 'مفعلة' : 'معطلة'}
                      </span>
                    </div>
                    <h3 className="mt-1 text-base font-bold text-slate-900">{plan.name_ar}</h3>
                    {plan.description_ar && <p className="mt-1 text-xs text-slate-500">{plan.description_ar}</p>}

                    <div className="mt-4 flex items-baseline gap-2 border-y border-slate-100 py-3">
                      <span className="font-mono-tabular text-xl font-bold text-slate-900">
                        {plan.monthly_price_egp.toLocaleString('en-US')}
                      </span>
                      <span className="text-xs text-slate-500">ج.م / شهريًا</span>
                      <span className="mr-auto font-mono-tabular text-xs text-slate-500">
                        سنوي: {plan.annual_price_egp.toLocaleString('en-US')}
                      </span>
                    </div>

                    <ul className="mt-3 space-y-1.5 text-xs text-slate-700">
                      <li>الفروع: {plan.max_branches ?? 'مفتوح'}</li>
                      <li>المستخدمون: {plan.max_users ?? 'مفتوح'}</li>
                      <li>المناديب: {plan.max_couriers ?? 'مفتوح'}</li>
                      <li>شحنات الشهر: {plan.max_monthly_shipments?.toLocaleString('en-US') ?? 'مفتوح'}</li>
                      <li>نطاق مخصص: {plan.allow_custom_domain ? 'متاح' : 'غير متاح'}</li>
                      <li>وصول API: {plan.allow_api_access ? 'متاح' : 'غير متاح'}</li>
                    </ul>
                  </div>

                  {isSuperAdmin && (
                    <button
                      type="button"
                      onClick={() => selectPlanForEdit(plan)}
                      className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      تعديل الباقة
                    </button>
                  )}
                </div>
              ))}
            </div>

            {isSuperAdmin && (
              <section aria-label="إضافة أو تعديل باقة اشتراك" className="rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-semibold text-slate-900">
                    {editingPlanId ? `تعديل باقة (${planCode})` : 'إضافة باقة اشتراك جديدة'}
                  </h2>
                  {editingPlanId && (
                    <button
                      type="button"
                      onClick={resetPlanForm}
                      className="text-xs font-medium text-slate-600 underline"
                    >
                      إلغاء التعديل
                    </button>
                  )}
                </div>

                <form onSubmit={handleSavePlan} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div>
                    <label htmlFor="plan-code" className="block text-xs font-medium text-slate-700">
                      كود الباقة
                    </label>
                    <input
                      id="plan-code"
                      type="text"
                      required
                      dir="ltr"
                      disabled={Boolean(editingPlanId)}
                      value={planCode}
                      onChange={(e) => setPlanCode(e.target.value.toUpperCase())}
                      placeholder="SCALE_PRO"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs disabled:bg-slate-50"
                    />
                  </div>
                  <div>
                    <label htmlFor="plan-name-ar" className="block text-xs font-medium text-slate-700">
                      اسم الباقة (عربي)
                    </label>
                    <input
                      id="plan-name-ar"
                      type="text"
                      required
                      value={planNameAr}
                      onChange={(e) => setPlanNameAr(e.target.value)}
                      placeholder="باقة التوسع"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="plan-monthly" className="block text-xs font-medium text-slate-700">
                      السعر الشهري (EGP)
                    </label>
                    <input
                      id="plan-monthly"
                      type="number"
                      min={0}
                      required
                      value={planMonthlyPrice}
                      onChange={(e) => setPlanMonthlyPrice(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="plan-annual" className="block text-xs font-medium text-slate-700">
                      السعر السنوي (EGP)
                    </label>
                    <input
                      id="plan-annual"
                      type="number"
                      min={0}
                      required
                      value={planAnnualPrice}
                      onChange={(e) => setPlanAnnualPrice(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                    />
                  </div>

                  <div>
                    <label htmlFor="plan-max-branches" className="block text-xs font-medium text-slate-700">
                      أقصى فروع (فارغ = مفتوح)
                    </label>
                    <input
                      id="plan-max-branches"
                      type="number"
                      min={1}
                      value={planMaxBranches}
                      onChange={(e) => setPlanMaxBranches(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="plan-max-users" className="block text-xs font-medium text-slate-700">
                      أقصى مستخدمين
                    </label>
                    <input
                      id="plan-max-users"
                      type="number"
                      min={1}
                      value={planMaxUsers}
                      onChange={(e) => setPlanMaxUsers(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="plan-max-couriers" className="block text-xs font-medium text-slate-700">
                      أقصى مناديب
                    </label>
                    <input
                      id="plan-max-couriers"
                      type="number"
                      min={1}
                      value={planMaxCouriers}
                      onChange={(e) => setPlanMaxCouriers(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="plan-max-shipments" className="block text-xs font-medium text-slate-700">
                      أقصى شحنات/شهر
                    </label>
                    <input
                      id="plan-max-shipments"
                      type="number"
                      min={10}
                      value={planMaxShipments}
                      onChange={(e) => setPlanMaxShipments(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label htmlFor="plan-desc" className="block text-xs font-medium text-slate-700">
                      وصف مختصر
                    </label>
                    <input
                      id="plan-desc"
                      type="text"
                      value={planDescAr}
                      onChange={(e) => setPlanDescAr(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                    />
                  </div>

                  <div className="md:col-span-2 flex flex-wrap items-center gap-4 pt-5 text-xs">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={planAllowDomain}
                        onChange={(e) => setPlanAllowDomain(e.target.checked)}
                      />
                      <span>سماح بنطاق مخصص</span>
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={planAllowApi}
                        onChange={(e) => setPlanAllowApi(e.target.checked)}
                      />
                      <span>سماح بـ API</span>
                    </label>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={planIsActive}
                        onChange={(e) => setPlanIsActive(e.target.checked)}
                      />
                      <span>نشطة</span>
                    </label>
                  </div>

                  <div className="md:col-span-4 flex justify-end">
                    <button
                      type="submit"
                      disabled={savingPlan}
                      className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {savingPlan ? 'جاري الحفظ...' : 'حفظ الباقة'}
                    </button>
                  </div>
                </form>
              </section>
            )}
          </div>
        )}

        {/* TAB 3: TENANT DOMAINS */}
        {activeTab === 'domains' && (
          <div className="space-y-6">
            {isSuperAdmin && (
              <section aria-label="ربط نطاق فرعي أو مخصص" className="rounded-xl border border-slate-200 bg-white p-6">
                <h2 className="text-base font-semibold text-slate-900">ربط نطاق مخصص أو فرعي لشركة</h2>
                <p className="mt-1 text-xs text-slate-500">
                  النطاقات الفرعية تُفعّل فورًا؛ بينما النطاقات المخصصة تتطلب توثيق سجل DNS TXT وإصدار شهادة SSL.
                </p>

                <form onSubmit={handleSaveDomain} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div>
                    <label htmlFor="dom-tenant" className="block text-xs font-medium text-slate-700">
                      الشركة
                    </label>
                    <select
                      id="dom-tenant"
                      required
                      value={domainTenantId}
                      onChange={(e) => setDomainTenantId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                    >
                      {directory.map((d) => (
                        <option key={d.tenant.id} value={d.tenant.id}>
                          {d.tenant.name} ({d.tenant.code})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="dom-host" className="block text-xs font-medium text-slate-700">
                      اسم النطاق (Hostname)
                    </label>
                    <input
                      id="dom-host"
                      type="text"
                      required
                      dir="ltr"
                      value={domainHost}
                      onChange={(e) => setDomainHost(e.target.value.toLowerCase())}
                      placeholder="track.company-eg.com"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-xs"
                    />
                  </div>

                  <div>
                    <label htmlFor="dom-type" className="block text-xs font-medium text-slate-700">
                      النوع
                    </label>
                    <select
                      id="dom-type"
                      value={domainType}
                      onChange={(e) => setDomainType(e.target.value as DomainType)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                    >
                      <option value="custom">نطاق مخصص (Custom Domain)</option>
                      <option value="subdomain">نطاق فرعي للمنصة</option>
                    </select>
                  </div>

                  <div className="flex items-end justify-between gap-3">
                    <label className="inline-flex items-center gap-2 pb-2 text-xs">
                      <input
                        type="checkbox"
                        checked={domainPrimary}
                        onChange={(e) => setDomainPrimary(e.target.checked)}
                      />
                      <span>نطاق رئيسي</span>
                    </label>
                    <button
                      type="submit"
                      disabled={savingDomain}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {savingDomain ? 'جاري الإضافة...' : 'إضافة النطاق'}
                    </button>
                  </div>
                </form>
              </section>
            )}

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-right text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                      <th className="px-4 py-3">النطاق</th>
                      <th className="px-4 py-3">الشركة</th>
                      <th className="px-4 py-3">النوع</th>
                      <th className="px-4 py-3">التوثيق ورمز DNS TXT</th>
                      <th className="px-4 py-3">SSL</th>
                      <th className="px-4 py-3">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {domains.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                          لا توجد نطاقات مسجلة بعد.
                        </td>
                      </tr>
                    ) : (
                      domains.map((dom) => (
                        <tr key={dom.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-mono-tabular font-medium text-slate-900" dir="ltr">
                            {dom.domain}
                            {dom.is_primary && (
                              <span className="ml-2 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] text-white">
                                رئيسي
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-700">{dom.tenant_name ?? dom.tenant_id}</td>
                          <td className="px-4 py-3 text-slate-600">
                            {dom.domain_type === 'subdomain' ? 'فرعي' : 'مخصص'}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium">
                              {dom.verification_status === 'verified' ? (
                                <span className="text-emerald-700">موثق</span>
                              ) : dom.verification_status === 'failed' ? (
                                <span className="text-red-700">فشل التحقق</span>
                              ) : (
                                <span className="text-amber-700">بانتظار التحقق</span>
                              )}
                            </div>
                            <div className="mt-0.5 font-mono-tabular text-[11px] text-slate-500" dir="ltr">
                              TXT: {dom.verification_token}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono-tabular text-slate-600">{dom.ssl_status}</td>
                          <td className="px-4 py-3">
                            {isSuperAdmin && (
                              <div className="flex items-center gap-3">
                                {dom.verification_status !== 'verified' && (
                                  <button
                                    type="button"
                                    onClick={() => void handleVerifyDomain(dom, true)}
                                    className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:text-emerald-900"
                                  >
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    توثيق النطاق
                                  </button>
                                )}
                                {!dom.is_primary && (
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteDomain(dom)}
                                    className="inline-flex items-center gap-1 text-red-700 hover:text-red-900"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                    حذف
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: AUDITED SUPPORT ACCESS */}
        {activeTab === 'support' && (
          <div className="space-y-6">
            <section aria-label="فتح جلسة دعم فني مسببة" className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold text-slate-900">فتح جلسة دعم فني مؤقتة ومسببة</h2>
              <p className="mt-1 text-xs text-slate-500">
                يُحظر الدخول التشخيصي لأي شركة بدون سبب موثق ومدة زمنية محددة. تظهر جميع الزيارات في سجل الشركة.
              </p>

              <form onSubmit={handleRequestSupport} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
                <div>
                  <label htmlFor="sup-tenant" className="block text-xs font-medium text-slate-700">
                    الشركة المستهدفة
                  </label>
                  <select
                    id="sup-tenant"
                    required
                    value={supportTenantId}
                    onChange={(e) => setSupportTenantId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  >
                    {directory.map((d) => (
                      <option key={d.tenant.id} value={d.tenant.id}>
                        {d.tenant.name} ({d.tenant.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="sup-duration" className="block text-xs font-medium text-slate-700">
                    المدة الزمنية للجلسة
                  </label>
                  <select
                    id="sup-duration"
                    value={supportDuration}
                    onChange={(e) => setSupportDuration(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  >
                    <option value={30}>30 دقيقة</option>
                    <option value={60}>60 دقيقة</option>
                    <option value={120}>ساعتان</option>
                    <option value={240}>4 ساعات</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="sup-mode" className="block text-xs font-medium text-slate-700">
                    صلاحية الجلسة
                  </label>
                  <select
                    id="sup-mode"
                    value={supportMode}
                    onChange={(e) => setSupportMode(e.target.value as SupportAccessMode)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  >
                    <option value="read_only">معاينة وتشخيص للقراءة فقط</option>
                    <option value="diagnostic_assist">تشخيص متقدم ومساندة</option>
                  </select>
                </div>

                <div className="md:col-span-3">
                  <label htmlFor="sup-reason" className="block text-xs font-medium text-slate-700">
                    سبب الدخول الموثق (إلزامي · 5 أحرف فأكثر)
                  </label>
                  <input
                    id="sup-reason"
                    type="text"
                    required
                    minLength={5}
                    value={supportReason}
                    onChange={(e) => setSupportReason(e.target.value)}
                    placeholder="مثال: التحقق من تذكرة رقم #412 بخصوص تسعير منطقة التجمع"
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                  />
                </div>

                <div className="flex items-end justify-end">
                  <button
                    type="submit"
                    disabled={savingSupport}
                    className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {savingSupport ? 'جاري التوثيق والفتح...' : 'بدء جلسة الدعم الموثقة'}
                  </button>
                </div>
              </form>
            </section>

            {supportSnapshot && (
              <section
                aria-label="لقطة التشخيص المقيدة للشركة"
                className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-slate-700" />
                    <h3 className="text-sm font-bold text-slate-900">
                      معاينة التشخيص: {supportSnapshot.tenant.name} ({supportSnapshot.tenant.code})
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSupportSnapshot(null)}
                    className="text-xs text-slate-500 underline"
                  >
                    إغلاق المعاينة
                  </button>
                </div>

                <p className="text-xs text-slate-600">
                  سبب الجلسة النشطة: <span className="font-semibold text-slate-900">{supportSnapshot.support_session.reason}</span>
                </p>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7 text-xs">
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-slate-500">الفروع</p>
                    <p className="mt-1 font-mono-tabular text-lg font-bold">{supportSnapshot.metrics.branches_count}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-slate-500">المستخدمون</p>
                    <p className="mt-1 font-mono-tabular text-lg font-bold">{supportSnapshot.metrics.active_users_count}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-slate-500">التجار</p>
                    <p className="mt-1 font-mono-tabular text-lg font-bold">{supportSnapshot.metrics.clients_count}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-slate-500">المناديب</p>
                    <p className="mt-1 font-mono-tabular text-lg font-bold">{supportSnapshot.metrics.couriers_count}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-slate-500">كل الشحنات</p>
                    <p className="mt-1 font-mono-tabular text-lg font-bold">{supportSnapshot.metrics.total_shipments_count}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-slate-500">المسلّمة</p>
                    <p className="mt-1 font-mono-tabular text-lg font-bold text-emerald-700">{supportSnapshot.metrics.delivered_shipments_count}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="text-slate-500">المتعذرة</p>
                    <p className="mt-1 font-mono-tabular text-lg font-bold text-amber-700">{supportSnapshot.metrics.failed_shipments_count}</p>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-semibold text-slate-700">أحدث أحداث سجل التدقيق للشركة</h4>
                  <ul className="mt-2 divide-y divide-slate-100 rounded-lg border border-slate-200 text-xs">
                    {supportSnapshot.recent_audit_events.length === 0 ? (
                      <li className="px-3 py-2 text-slate-500">لا توجد أحداث حديثة.</li>
                    ) : (
                      supportSnapshot.recent_audit_events.map((ev) => (
                        <li key={ev.id} className="flex items-center justify-between px-3 py-2">
                          <span className="font-mono-tabular text-slate-800">
                            {ev.action} · {ev.entity_type}
                          </span>
                          <span className="font-mono-tabular text-[11px] text-slate-500">
                            {formatDateTime(ev.created_at)}
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>
              </section>
            )}

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-right text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                      <th className="px-4 py-3">الشركة</th>
                      <th className="px-4 py-3">موظف المنصة</th>
                      <th className="px-4 py-3">السبب الموثق</th>
                      <th className="px-4 py-3">الوضع</th>
                      <th className="px-4 py-3">ينتهي في</th>
                      <th className="px-4 py-3">الحالة</th>
                      <th className="px-4 py-3">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {supportSessions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                          لا توجد جلسات دعم مسجلة بعد.
                        </td>
                      </tr>
                    ) : (
                      supportSessions.map((ses) => {
                        const isActive =
                          !ses.revoked_at && new Date(ses.expires_at).getTime() > Date.now();
                        const isOwnerOfSession = user?.id === ses.support_user_id;
                        return (
                          <tr key={ses.id} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-medium text-slate-900">
                              {ses.tenant_name ?? ses.tenant_id}
                            </td>
                            <td className="px-4 py-3 font-mono-tabular text-slate-700">
                              {ses.support_username ?? ses.support_user_id}
                            </td>
                            <td className="px-4 py-3 text-slate-700">{ses.reason}</td>
                            <td className="px-4 py-3 text-slate-600">
                              {ses.access_mode === 'read_only' ? 'قراءة فقط' : 'تشخيص متقدم'}
                            </td>
                            <td className="px-4 py-3 font-mono-tabular text-slate-600">
                              {formatDateTime(ses.expires_at)}
                            </td>
                            <td className="px-4 py-3 font-medium">
                              {ses.revoked_at ? (
                                <span className="text-slate-500">منتهية (مسحوبة)</span>
                              ) : isActive ? (
                                <span className="text-emerald-700">نشطة</span>
                              ) : (
                                <span className="text-amber-700">منتهية المدة</span>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              {isActive && (
                                <div className="flex items-center gap-3">
                                  {(isOwnerOfSession || isSuperAdmin) && isOwnerOfSession && (
                                    <button
                                      type="button"
                                      onClick={() => void handleOpenSupportSnapshot(ses.tenant_id)}
                                      className="font-medium text-slate-800 underline underline-offset-4 hover:text-slate-950"
                                    >
                                      معاينة التشخيص
                                    </button>
                                  )}
                                  {(isOwnerOfSession || isSuperAdmin) && (
                                    <button
                                      type="button"
                                      onClick={() => void handleRevokeSupport(ses.id)}
                                      className="inline-flex items-center gap-1 text-red-700 hover:text-red-900"
                                    >
                                      <XCircle className="h-3.5 w-3.5" />
                                      إنهاء الجلسة
                                    </button>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'launch' && <LaunchReadinessPanel isSuperAdmin={isSuperAdmin} />}
      </main>
    </div>
  );
}
