import {useCallback, useEffect, useMemo, useState} from 'react';
import {Link, Navigate, NavLink, Outlet, useLocation} from 'react-router-dom';
import type {LucideIcon} from 'lucide-react';
import {useTenantSlug} from '@/lib/tenant/TenantRuntimeContext';
import {buildTenantBasePath} from '@/config/brand';
import {getMyTenantPermissions} from '@/features/security/securityService';
import {TenantWorkspaceProvider} from '@/features/tenants/TenantWorkspaceContext';
import {useAuth} from '@/lib/auth';
import {hasEffectivePermission} from '@/lib/permissions';
import {AccountSubjectType} from '@/types/common';
import {translateUi, useLocale} from '@/lib/i18n';
import type {MyTenantPermissionsBundle} from '@/types/security';
import {getUnreadNotificationsCount, subscribeToMessagingUpdates} from '@/features/messaging/messagingService';
import {
  brandCssVars,
  fontStack,
  getTenantBranding,
  normalizePublicBranding,
} from '@/features/tenants/brandingService';
import type {PublicTenantBranding} from '@/types/tenantBranding';
import {PageLoader} from '@/components/ui/LoadingState';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Barcode,
  BellRing,
  BookOpen,
  Building2,
  Scale,
  ChevronDown,
  CircleUserRound,
  ClipboardList,
  Clock,
  Coins,
  FileSpreadsheet,
  KeyRound,
  LayoutDashboard,
  Map,
  MapPin,
  MapPinned,
  Menu,
  MessagesSquare,
  Package,
  PackageCheck,
  PackagePlus,
  ReceiptText,
  RotateCcw,
  Route,
  Settings,
  Shield,
  Truck,
  Upload,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  Webhook,
  X,
} from 'lucide-react';

interface SidebarLink {
  readonly to: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly end?: boolean;
}

interface SidebarGroup {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly items: readonly SidebarLink[];
}

function getOpenSection(pathname: string): string | null {
  if (pathname.includes('/definitions/')) return 'definitions';
  if (pathname.includes('/shipments')) return 'shipments';
  if (pathname.includes('/operations') || pathname.includes('/portal/pickups')) return 'operations';
  if (pathname.includes('/pricing') || pathname.includes('/clients')) return 'clients';
  if (pathname.includes('/couriers')) return 'couriers';
  if (pathname.includes('/finance') || pathname.includes('/portal/finance')) return 'finance';
  if (pathname.includes('/accounting') || pathname.includes('/reports')) return 'accounting';
  if (pathname.includes('/security')) return 'security';
  return null;
}

function SidebarRow({
  item,
  depth = false,
  onNavigate,
}: {
  readonly item: SidebarLink;
  readonly depth?: boolean;
  readonly onNavigate: () => void;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({isActive}) =>
        [
          'group relative flex items-center rounded-lg transition-colors duration-150',
          depth ? 'gap-2.5 px-3 py-2 text-[13px]' : 'gap-2.5 px-3 py-2.5 text-sm',
          isActive
            ? 'font-bold text-[var(--tenant-brand)]'
            : 'font-medium text-slate-600 hover:text-[var(--tenant-brand)]',
        ].join(' ')
      }
    >
      {({isActive}) => (
        <>
          <span
            aria-hidden="true"
            className={`absolute inset-y-1.5 start-0 w-[2px] rounded-full bg-[var(--tenant-brand)] transition-opacity duration-150 ${
              isActive ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <Icon
            strokeWidth={1.9}
            className={`shrink-0 transition-colors ${depth ? 'h-4 w-4' : 'h-[18px] w-[18px]'} ${
              isActive ? 'text-[var(--tenant-brand)]' : 'text-slate-400 group-hover:text-[var(--tenant-brand)]'
            }`}
          />
          <span className="truncate">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

export function TenantAdminShellPage() {
  const companySlug = useTenantSlug();
  const location = useLocation();
  const {memberships} = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openSections, setOpenSections] = useState<string[]>(() => {
    const active = getOpenSection(location.pathname);
    return active ? [active] : [];
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (typeof localStorage !== 'undefined' && localStorage.getItem('shipflow_theme') === 'dark' ? 'dark' : 'light'),
  );
  const [tenantBranding, setTenantBranding] = useState<PublicTenantBranding | null>(null);
  const locale = useLocale();
  const t = (text: string) => translateUi(text, locale);
  const activeMembership = memberships.find(
    (m) => m.tenants?.slug === companySlug.trim().toLowerCase() && m.is_active,
  );
  const [permBundle, setPermBundle] = useState<MyTenantPermissionsBundle>({
    client_id: null,
    branch_ids: [],
    permissions: [],
  });
  const [permissionsLoading, setPermissionsLoading] = useState(
    () =>
      Boolean(activeMembership) &&
      activeMembership?.role_key !== 'company_owner' &&
      activeMembership?.role_key !== 'company_admin',
  );
  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

  useEffect(() => {
    if (!sidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  useEffect(() => {
    setSidebarOpen(false);
    const active = getOpenSection(location.pathname);
    if (!active) return;
    setOpenSections((current) => (current.includes(active) ? current : [...current, active]));
  }, [location.pathname]);

  useEffect(() => {
    const syncTheme = () => {
      setTheme(localStorage.getItem('shipflow_theme') === 'dark' ? 'dark' : 'light');
    };
    window.addEventListener('shipflow-theme-change', syncTheme);
    return () => window.removeEventListener('shipflow-theme-change', syncTheme);
  }, []);

  const tenantId = activeMembership?.tenants?.id ?? null;

  useEffect(() => {
    if (!tenantId) {
      setTenantBranding(null);
      return;
    }
    let cancelled = false;
    void getTenantBranding(tenantId)
      .then((branding) => {
        if (!cancelled) setTenantBranding(normalizePublicBranding(branding));
      })
      .catch(() => {
        if (!cancelled) setTenantBranding(normalizePublicBranding(null));
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) {
      setPermissionsLoading(false);
      return;
    }
    let cancelled = false;
    const isPlatformOwner =
      activeMembership?.role_key === 'company_owner' ||
      activeMembership?.role_key === 'company_admin';
    setPermissionsLoading(!isPlatformOwner);
    setPermissionsError(null);
    void (async () => {
      try {
        const bundle = await getMyTenantPermissions(tenantId);
        if (!cancelled) {
          setPermBundle(bundle);
        }
      } catch (error) {
        if (!cancelled) {
          setPermissionsError(error instanceof Error ? error.message : 'تعذر تحميل صلاحيات الحساب.');
        }
      } finally {
        if (!cancelled) setPermissionsLoading(false);
      }
    })();

    const refreshUnread = () => {
      void getUnreadNotificationsCount(tenantId)
        .then((count) => {
          if (!cancelled) setUnreadNotifCount(count);
        })
        .catch(() => undefined);
    };

    refreshUnread();
    const unsubscribe = subscribeToMessagingUpdates(tenantId, activeMembership?.user_id, {
      onNotificationChanged: refreshUnread,
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [tenantId, activeMembership?.user_id]);

  const roleKey = activeMembership?.role_key ?? '';
  const isCourierAccount =
    activeMembership?.account_subject_type === AccountSubjectType.COURIER ||
    roleKey === 'delivery_agent' ||
    Boolean(permBundle.courier_id);
  const isClientAccount =
    activeMembership?.account_subject_type === AccountSubjectType.CLIENT ||
    Boolean(permBundle.client_id);
  const isAdmin =
    !isCourierAccount &&
    !isClientAccount &&
    activeMembership?.account_subject_type === AccountSubjectType.STAFF &&
    (roleKey === 'company_owner' || roleKey === 'company_admin');

  const toggleSection = (section: string) => {
    setOpenSections((current) =>
      current.includes(section) ? current.filter((id) => id !== section) : [...current, section],
    );
  };

  const can = useCallback(
    (permissionKey: string, branchId?: string | null) => {
      if (isAdmin) return true;
      return hasEffectivePermission(
        isCourierAccount || isClientAccount ? '' : roleKey,
        permBundle.permissions,
        permissionKey,
        permBundle.branch_ids,
        branchId,
      );
    },
    [isAdmin, isCourierAccount, isClientAccount, roleKey, permBundle.permissions, permBundle.branch_ids],
  );

  const workspaceValue = useMemo(() => {
    if (!activeMembership || !activeMembership.tenants) return null;
    return {
      tenant: activeMembership.tenants,
      membership: activeMembership,
      isAdmin,
      branchIds: permBundle.branch_ids,
      boundClientId: permBundle.client_id,
      boundCourierId: permBundle.courier_id ?? null,
      can,
    };
  }, [activeMembership, isAdmin, permBundle.branch_ids, permBundle.client_id, permBundle.courier_id, can]);

  if (!activeMembership || !activeMembership.tenants || !workspaceValue) {
    return null;
  }
  if (permissionsLoading) {
    return <PageLoader label={t('جارٍ تحميل صلاحيات الحساب')} />;
  }
  if (permissionsError) {
    return (
      <div role="alert" className="m-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        تعذر تحميل صلاحيات الحساب: {permissionsError}
      </div>
    );
  }
  if (isCourierAccount && isClientAccount) {
    return (
      <div role="alert" className="m-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        تعذر تحديد نوع الحساب المرتبط. تواصل مع إدارة الشركة لتصحيح ربط الحساب.
      </div>
    );
  }

  const tenant = activeMembership.tenants;
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const definitionLinks: SidebarLink[] = [
    {to: `${basePath}/definitions/branches`, label: 'الفروع', icon: Building2},
    {to: `${basePath}/definitions/geography`, label: 'الأقاليم والمناطق', icon: Map},
    {to: `${basePath}/definitions/services`, label: 'خدمات الشحن', icon: Package},
    {to: `${basePath}/definitions/exceptions`, label: 'أسباب التعذر والإرجاع', icon: AlertTriangle},
    {to: `${basePath}/definitions/cashboxes`, label: 'الخزائن وأمناؤها', icon: Wallet},
    {to: `${basePath}/definitions/accounting-refs`, label: 'الحركات واليوميات والحسابات', icon: BookOpen},
  ];

  const clientLinks: SidebarLink[] = [
    {to: `${basePath}/clients`, label: 'قائمة العملاء', icon: Users, end: true},
    {to: `${basePath}/clients/new`, label: 'إنشاء عميل', icon: UserPlus, end: true},
    {to: `${basePath}/clients/registrations`, label: 'الحسابات المسجلة', icon: UserCheck, end: true},
    {to: `${basePath}/pricing/price-lists`, label: 'قوائم أسعار الشحن', icon: ReceiptText},
    {to: `${basePath}/clients/settlements`, label: 'قيد التسوية مع العملاء', icon: FileSpreadsheet, end: true},
  ];

  const courierPortalPath = `${basePath}/operations/courier-portal`;
  const allowedClientPath =
    location.pathname === basePath ||
    location.pathname.startsWith(`${basePath}/shipments`) ||
    location.pathname.startsWith(`${basePath}/portal/`) ||
    location.pathname.startsWith(`${basePath}/reports`) ||
    location.pathname.startsWith(`${basePath}/messaging`) ||
    location.pathname.startsWith(`${basePath}/notifications`) ||
    location.pathname === `${basePath}/security/integrations` ||
    location.pathname === `${basePath}/settings`;

  if (
    isCourierAccount &&
    location.pathname !== courierPortalPath &&
    location.pathname !== `${basePath}/messaging` &&
    location.pathname !== `${basePath}/settings`
  ) {
    return <Navigate to={courierPortalPath} replace />;
  }
  if (!isCourierAccount && location.pathname === courierPortalPath) {
    return <Navigate to={basePath} replace />;
  }
  if (isClientAccount && !allowedClientPath) {
    return <Navigate to={basePath} replace />;
  }
  if (!isClientAccount && location.pathname.startsWith(`${basePath}/portal/`)) {
    return <Navigate to={basePath} replace />;
  }

  const shipmentLinks: SidebarLink[] = [
    {to: `${basePath}/shipments`, label: 'قائمة الشحنات', icon: Package, end: true},
    {to: `${basePath}/shipments/new`, label: 'إنشاء شحنة', icon: PackagePlus, end: true},
    {to: `${basePath}/shipments/import`, label: 'استيراد Excel', icon: Upload, end: true},
    {to: `${basePath}/shipments/warehouse`, label: 'شحنات في المخزون', icon: PackageCheck, end: true},
    {to: `${basePath}/shipments/out-for-delivery`, label: 'الشحنات قيد التوصيل', icon: Truck, end: true},
    {to: `${basePath}/shipments/rescheduled`, label: 'انتظار إعادة التوصيل', icon: Clock, end: true},
    {to: `${basePath}/shipments/returns`, label: 'المرتجعات والمتعثرة', icon: RotateCcw, end: true},
    {to: `${basePath}/shipments/tracking`, label: 'الباركود والتتبع', icon: Barcode, end: true},
  ];

  const operationLinks: SidebarLink[] = [
    {to: `${basePath}/operations/pickup`, label: 'قوائم الالتقاط', icon: ClipboardList, end: true},
    {to: `${basePath}/operations/warehouse`, label: 'قوائم الاستلام بالمخزن', icon: PackageCheck, end: true},
    {to: `${basePath}/operations/transfers`, label: 'النقل بين الفروع', icon: ArrowLeftRight, end: true},
    {to: `${basePath}/operations/delivery`, label: 'قوائم التوصيل', icon: Truck, end: true},
    {to: `${basePath}/operations/redelivery`, label: 'قوائم إعادة التوصيل', icon: Clock, end: true},
    {to: `${basePath}/operations/returns`, label: 'قوائم المرتجعات', icon: RotateCcw, end: true},
  ];

  const securityLinks: SidebarLink[] = [
    {to: `${basePath}/security/users`, label: 'المستخدمون', icon: UserCog},
    {to: `${basePath}/security/roles`, label: 'الأدوار والصلاحيات', icon: KeyRound},
    {to: `${basePath}/security/sessions`, label: 'سجل الدخول والجلسات', icon: Activity},
    {to: `${basePath}/security/integrations`, label: 'رموز API والتكاملات', icon: Webhook},
  ];

  const courierLinks: SidebarLink[] = [
    {to: `${basePath}/couriers`, label: 'قائمة المندوبين', icon: Truck, end: true},
    {to: `${basePath}/couriers/new`, label: 'إنشاء مندوب', icon: UserPlus, end: true},
    {to: `${basePath}/couriers/commissions`, label: 'قوائم عمولات المندوبين', icon: Coins, end: true},
    {to: `${basePath}/couriers/routes`, label: 'خطوط سير المندوبين', icon: Route, end: true},
    {to: `${basePath}/couriers/settlements`, label: 'قيد التسوية مع المندوبين', icon: FileSpreadsheet, end: true},
    {to: `${basePath}/couriers/movements`, label: 'تحركات مندوب الشحن', icon: MapPinned, end: true},
  ];

  const financeLinks: SidebarLink[] = [
    {to: `${basePath}/finance/cashboxes`, label: 'إدارة الخزائن والحركات', icon: Wallet, end: true},
    {to: `${basePath}/finance/collections`, label: 'التحصيل من المندوبين', icon: Coins, end: true},
    {to: `${basePath}/clients/settlements`, label: 'تسويات العملاء', icon: FileSpreadsheet, end: true},
    {to: `${basePath}/couriers/settlements`, label: 'تسويات وعمولات المندوبين', icon: Banknote, end: true},
  ];

  const accountingLinks: SidebarLink[] = [
    {to: `${basePath}/reports`, label: 'التقارير التنفيذية', icon: BarChart3, end: true},
    {to: `${basePath}/accounting/journal-entries`, label: 'قيود اليومية العامة', icon: BookOpen, end: true},
    {to: `${basePath}/accounting/trial-balance`, label: 'ميزان المراجعة والأستاذ', icon: Scale, end: true},
  ];

  const clientShipmentLinks: SidebarLink[] = [
    {to: `${basePath}/shipments`, label: 'شحناتي', icon: Package, end: true},
    ...(can('shipments.create')
      ? [{to: `${basePath}/shipments/new`, label: 'إنشاء شحنة جديدة', icon: PackagePlus, end: true}]
      : []),
    ...(can('shipments.import') || can('shipments.create')
      ? [{to: `${basePath}/shipments/import`, label: 'استيراد شحنات Excel', icon: Upload, end: true}]
      : []),
  ];

  const isStaffAdmin = !isClientAccount && !isCourierAccount;
  // Portal menus are short, so their groups stay visible instead of collapsing.
  const alwaysOpenGroups = isClientAccount || isCourierAccount;

  const homeLink: SidebarLink | null = isClientAccount
    ? {to: basePath, label: t('لوحة التاجر'), icon: LayoutDashboard, end: true}
    : isCourierAccount
      ? {to: courierPortalPath, label: t('بوابة المندوب'), icon: Truck}
      : {to: basePath, label: t('لوحة التحكم'), icon: LayoutDashboard, end: true};

  const groups: SidebarGroup[] = isClientAccount
    ? [
        {id: 'shipments', label: 'الشحنات', icon: Package, items: clientShipmentLinks},
        {
          id: 'operations',
          label: 'الخدمات',
          icon: Truck,
          items: [{to: `${basePath}/portal/pickups`, label: 'طلبات الالتقاط والعناوين', icon: Truck, end: true}],
        },
        {
          id: 'finance',
          label: 'المالية',
          icon: FileSpreadsheet,
          items: [{to: `${basePath}/portal/finance`, label: 'قيد التسوية وكشف الحساب', icon: FileSpreadsheet, end: true}],
        },
        {
          id: 'accounting',
          label: 'التقارير',
          icon: BarChart3,
          items: [{to: `${basePath}/reports`, label: 'التقارير التنفيذية', icon: BarChart3, end: true}],
        },
        {
          id: 'security',
          label: 'التكاملات',
          icon: Webhook,
          items: [{to: `${basePath}/security/integrations`, label: 'رموز API والتكاملات', icon: Webhook, end: true}],
        },
      ]
    : isCourierAccount
      ? [
          {
            id: 'account',
            label: 'الحساب',
            icon: Settings,
            items: [{to: `${basePath}/settings`, label: 'إعدادات الحساب', icon: Settings, end: true}],
          },
        ]
      : [
          {id: 'definitions', label: 'التعريفات الأساسية', icon: Building2, items: definitionLinks},
          {id: 'shipments', label: 'الشحنات', icon: Package, items: shipmentLinks},
          {id: 'operations', label: 'العمليات اليومية', icon: ClipboardList, items: operationLinks},
          {id: 'clients', label: 'العملاء', icon: Users, items: clientLinks},
          {id: 'couriers', label: 'مندوبو التوصيل', icon: MapPin, items: courierLinks},
          {id: 'finance', label: 'المالية والخزائن', icon: Wallet, items: financeLinks},
          {id: 'accounting', label: 'الحسابات العامة والتقارير', icon: Scale, items: accountingLinks},
          ...(isStaffAdmin ? [{id: 'security', label: 'الأمان', icon: Shield, items: securityLinks}] : []),
        ];

  const roleLabel = isClientAccount ? 'بوابة التاجر' : isCourierAccount ? 'بوابة المندوب' : 'لوحة الشركة';

  const renderSidebar = (onNavigate: () => void) => (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="flex h-16 shrink-0 items-center border-b border-slate-200/80 px-5">
        <Link to={basePath} className="flex min-w-0 items-center gap-2.5">
          {tenantBranding?.logo_path ? (
            <img src={tenantBranding.logo_path} alt={tenant.name} className="h-8 w-auto max-w-20 object-contain" />
          ) : (
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-black"
              style={{
                backgroundColor: tenantBranding?.primary_color ?? '#ef6a47',
                color: 'var(--tenant-brand-contrast, #111827)',
              }}
            >
              {tenant.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-slate-900">{tenant.name}</span>
            <span className="block truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {roleLabel}
            </span>
          </span>
        </Link>
      </div>

      <nav
        aria-label={
          isClientAccount
            ? 'القائمة الجانبية لبوابة العميل'
            : isCourierAccount
              ? 'القائمة الجانبية للمندوب'
              : 'القائمة الجانبية للشركة'
        }
        className="app-sidebar-nav app-sidebar-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3"
      >
        <div className="space-y-0.5">
          {homeLink ? <SidebarRow item={homeLink} onNavigate={onNavigate} /> : null}

          {groups.map((group) => {
            const isOpen = alwaysOpenGroups || openSections.includes(group.id);
            const GroupIcon = group.icon;
            return (
              <div key={group.id} className="pt-1">
                {alwaysOpenGroups ? (
                  <div className="flex w-full items-center gap-2 px-3 py-2 text-[13px] font-semibold text-slate-500">
                    <GroupIcon strokeWidth={1.9} className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="truncate">{t(group.label)}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggleSection(group.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-[13px] font-semibold transition-colors ${
                      isOpen ? 'text-slate-800' : 'text-slate-500'
                    } hover:text-[var(--tenant-brand)]`}
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <GroupIcon
                        strokeWidth={1.9}
                        className={`h-4 w-4 shrink-0 ${isOpen ? 'text-[var(--tenant-brand)]' : 'text-slate-400'}`}
                      />
                      <span className="truncate">{t(group.label)}</span>
                    </span>
                    <ChevronDown
                      strokeWidth={2}
                      className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-[var(--tenant-brand)]' : ''
                      }`}
                    />
                  </button>
                )}

                {isOpen ? (
                  <div className="ms-2 mt-0.5 space-y-0.5 border-s border-slate-200/80 ps-2">
                    {group.items.map((item) => (
                      <SidebarRow
                        key={`${group.id}-${item.to}`}
                        item={{...item, label: t(item.label)}}
                        depth
                        onNavigate={onNavigate}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </nav>
    </div>
  );

  const iconButtonClass =
    'relative flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-[var(--tenant-brand)]';

  return (
    <TenantWorkspaceProvider value={workspaceValue}>
      <div
        data-app-theme={theme}
        style={{
          ...(tenantBranding ? brandCssVars(tenantBranding) : {}),
          fontFamily: tenantBranding ? fontStack(tenantBranding.font_family) : undefined,
        }}
        className="tenant-app-shell flex min-h-screen text-slate-900"
      >
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 overflow-hidden border-l border-slate-200/80 bg-white lg:block print:hidden">
          {renderSidebar(() => setSidebarOpen(false))}
        </aside>

        {sidebarOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden print:hidden">
            <div className="w-64 bg-white shadow-xl">{renderSidebar(() => setSidebarOpen(false))}</div>
            <button
              type="button"
              aria-label="إغلاق القائمة"
              onClick={() => setSidebarOpen(false)}
              className="flex-1 bg-slate-900/40"
            />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur print:hidden">
            <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  aria-label="فتح القائمة الجانبية"
                  onClick={() => setSidebarOpen((prev) => !prev)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 lg:hidden"
                >
                  {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                </button>
                <Link
                  to={basePath}
                  className="flex min-w-0 items-center gap-2 text-sm font-extrabold tracking-tight text-slate-900"
                >
                  {tenantBranding?.logo_path ? (
                    <img src={tenantBranding.logo_path} alt="" className="h-6 w-auto max-w-14 object-contain" />
                  ) : (
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[9px] font-black"
                      style={{
                        backgroundColor: tenantBranding?.primary_color ?? '#ef6a47',
                        color: 'var(--tenant-brand-contrast, #111827)',
                      }}
                    >
                      {tenant.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <span className="hidden max-w-44 truncate sm:inline">{tenant.name}</span>
                </Link>
              </div>

              <div className="ms-auto flex items-center gap-0.5">
                <Link
                  to={`${basePath}/notifications`}
                  aria-label={unreadNotifCount > 0 ? `${t('الإشعارات')} · ${unreadNotifCount}` : t('الإشعارات')}
                  className={iconButtonClass}
                >
                  <BellRing strokeWidth={1.9} className="h-[18px] w-[18px]" />
                  {unreadNotifCount > 0 && (
                    <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--tenant-brand)] px-1 text-[9px] font-bold text-white">
                      {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                    </span>
                  )}
                </Link>
                <Link to={`${basePath}/messaging`} aria-label={t('الرسائل والمحادثات')} className={iconButtonClass}>
                  <MessagesSquare strokeWidth={1.9} className="h-[18px] w-[18px]" />
                </Link>
                <Link
                  to={`${basePath}/settings`}
                  aria-label={isStaffAdmin ? t('إعدادات الشركة والملفات') : t('إعدادات الحساب')}
                  className={iconButtonClass}
                >
                  <CircleUserRound strokeWidth={1.9} className="h-[18px] w-[18px]" />
                </Link>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-6">
            <Outlet />
          </main>
        </div>
      </div>
    </TenantWorkspaceProvider>
  );
}
