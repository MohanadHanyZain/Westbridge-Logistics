import {useCallback, useEffect, useMemo, useState} from 'react';
import {Link, Navigate, NavLink, Outlet, useLocation, useParams} from 'react-router-dom';
import {BRAND_CONFIG, buildTenantBasePath} from '@/config/brand';
import {getMyTenantPermissions} from '@/features/security/securityService';
import {TenantWorkspaceProvider} from '@/features/tenants/TenantWorkspaceContext';
import {useAuth} from '@/lib/auth';
import {hasEffectivePermission} from '@/lib/permissions';
import {AccountSubjectType} from '@/types/common';
import {translateUi, useLocale} from '@/lib/i18n';
import type {MyTenantPermissionsBundle} from '@/types/security';
import {getUnreadNotificationsCount, subscribeToMessagingUpdates} from '@/features/messaging/messagingService';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Barcode,
  Bell,
  BookOpen,
  Building2,
  Scale,
  ChevronDown,
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
  MessageSquare,
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
  UserRound,
  Users,
  Wallet,
  Webhook,
  X,
} from 'lucide-react';

export function TenantAdminShellPage() {
  const {companySlug = ''} = useParams();
  const location = useLocation();
  const {memberships} = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);
  const locale = useLocale();
  const t = (text: string) => translateUi(text, locale);
  const [permBundle, setPermBundle] = useState<MyTenantPermissionsBundle>({
    client_id: null,
    branch_ids: [],
    permissions: [],
  });
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

  useEffect(() => {
    if (!sidebarOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [sidebarOpen]);

  const activeMembership = memberships.find(
    (m) => m.tenants?.slug === companySlug.trim().toLowerCase() && m.is_active,
  );
  const tenantId = activeMembership?.tenants?.id ?? null;

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    void (async () => {
      try {
        const bundle = await getMyTenantPermissions(tenantId);
        if (!cancelled) {
          setPermBundle(bundle);
        }
      } catch {
        // Fallback smoothly when client/mock is unconfigured (e.g. unit tests)
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
  const isAdmin = roleKey === 'company_owner' || roleKey === 'company_admin';

  const toggleSection = (section: string) => {
    setOpenSection((current) => current === section ? null : section);
  };

  const can = useCallback(
    (permissionKey: string, branchId?: string | null) => {
      if (isAdmin) return true;
      return hasEffectivePermission(
        roleKey,
        permBundle.permissions,
        permissionKey,
        permBundle.branch_ids,
        branchId,
      );
    },
    [isAdmin, roleKey, permBundle.permissions, permBundle.branch_ids],
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

  const tenant = activeMembership.tenants;
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const definitionLinks = [
    {to: `${basePath}/definitions/branches`, label: 'الفروع', icon: Building2},
    {to: `${basePath}/definitions/geography`, label: 'الأقاليم والمناطق', icon: Map},
    {to: `${basePath}/definitions/services`, label: 'خدمات الشحن', icon: Package},
    {to: `${basePath}/definitions/exceptions`, label: 'أسباب التعذر والإرجاع', icon: AlertTriangle},
    {to: `${basePath}/definitions/cashboxes`, label: 'الخزائن وأمناؤها', icon: Wallet},
    {to: `${basePath}/definitions/accounting-refs`, label: 'الحركات واليوميات والحسابات', icon: BookOpen},
  ];

  const clientLinks = [
    {to: `${basePath}/clients`, label: 'قائمة العملاء', icon: Users, end: true},
    {to: `${basePath}/clients/new`, label: 'إنشاء عميل', icon: UserPlus, end: true},
    {to: `${basePath}/clients/registrations`, label: 'الحسابات المسجلة', icon: UserCheck, end: true},
    {to: `${basePath}/pricing/price-lists`, label: 'قوائم أسعار الشحن', icon: ReceiptText, end: false},
    {to: `${basePath}/clients/settlements`, label: 'قيد التسوية مع العملاء', icon: FileSpreadsheet, end: true},
  ];

  const isClientAccount = activeMembership.account_subject_type === AccountSubjectType.CLIENT;
  const isCourierAccount = activeMembership.account_subject_type === AccountSubjectType.COURIER;
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

  const clientPortalLinks = [
    {to: basePath, label: 'لوحة التاجر', icon: LayoutDashboard, end: true},
    {to: `${basePath}/shipments`, label: 'شحناتي', icon: Package, end: true},
    ...(can('shipments.create')
      ? [{to: `${basePath}/shipments/new`, label: 'إنشاء شحنة جديدة', icon: PackagePlus, end: true}]
      : []),
    ...(can('shipments.import') || can('shipments.create')
      ? [{to: `${basePath}/shipments/import`, label: 'استيراد شحنات Excel', icon: Upload, end: true}]
      : []),
    {to: `${basePath}/portal/pickups`, label: 'طلبات الالتقاط والعناوين', icon: Truck, end: true},
    {to: `${basePath}/portal/finance`, label: 'قيد التسوية وكشف الحساب', icon: FileSpreadsheet, end: true},
    {to: `${basePath}/reports`, label: 'التقارير التنفيذية', icon: BarChart3, end: true},
    {to: `${basePath}/messaging`, label: 'الرسائل والمحادثات', icon: MessageSquare, end: true},
    {
      to: `${basePath}/notifications`,
      label: unreadNotifCount > 0 ? `الإشعارات · ${unreadNotifCount}` : 'الإشعارات',
      icon: Bell,
      end: true,
    },
    {to: `${basePath}/security/integrations`, label: 'رموز API والتكاملات', icon: Webhook, end: true},
    {to: `${basePath}/settings`, label: 'إعدادات الحساب', icon: Settings, end: true},
  ];

  const shipmentLinks = [
    {to: `${basePath}/shipments`, label: 'قائمة الشحنات', icon: Package, end: true},
    {to: `${basePath}/shipments/new`, label: 'إنشاء شحنة', icon: PackagePlus, end: true},
    {to: `${basePath}/shipments/import`, label: 'استيراد Excel', icon: Upload, end: true},
    {to: `${basePath}/shipments/warehouse`, label: 'شحنات في المخزون', icon: PackageCheck, end: true},
    {to: `${basePath}/shipments/out-for-delivery`, label: 'الشحنات قيد التوصيل', icon: Truck, end: true},
    {to: `${basePath}/shipments/rescheduled`, label: 'انتظار إعادة التوصيل', icon: Clock, end: true},
    {to: `${basePath}/shipments/returns`, label: 'المرتجعات والمتعثرة', icon: RotateCcw, end: true},
    {to: `${basePath}/shipments/tracking`, label: 'الباركود والتتبع', icon: Barcode, end: true},
  ];

  const operationLinks = [
    {to: `${basePath}/operations/pickup`, label: 'قوائم الالتقاط', icon: ClipboardList, end: true},
    {to: `${basePath}/operations/warehouse`, label: 'قوائم الاستلام بالمخزن', icon: PackageCheck, end: true},
    {to: `${basePath}/operations/transfers`, label: 'النقل بين الفروع', icon: ArrowLeftRight, end: true},
    {to: `${basePath}/operations/delivery`, label: 'قوائم التوصيل', icon: Truck, end: true},
    {to: `${basePath}/operations/redelivery`, label: 'قوائم إعادة التوصيل', icon: Clock, end: true},
    {to: `${basePath}/operations/returns`, label: 'قوائم المرتجعات', icon: RotateCcw, end: true},
  ];

  const securityLinks = [
    {to: `${basePath}/security/users`, label: 'المستخدمون', icon: UserCog, end: false},
    {to: `${basePath}/security/roles`, label: 'الأدوار والصلاحيات', icon: KeyRound, end: false},
    {to: `${basePath}/security/sessions`, label: 'سجل الدخول والجلسات', icon: Activity, end: false},
    {to: `${basePath}/security/integrations`, label: 'رموز API والتكاملات', icon: Webhook, end: false},
  ];

  const courierLinks = [
    {to: `${basePath}/couriers`, label: 'قائمة المندوبين', icon: Truck, end: true},
    {to: `${basePath}/couriers/new`, label: 'إنشاء مندوب', icon: UserPlus, end: true},
    {to: `${basePath}/couriers/commissions`, label: 'قوائم عمولات المندوبين', icon: Coins, end: true},
    {to: `${basePath}/couriers/routes`, label: 'خطوط سير المندوبين', icon: Route, end: true},
    {to: `${basePath}/couriers/settlements`, label: 'قيد التسوية مع المندوبين', icon: FileSpreadsheet, end: true},
    {to: `${basePath}/couriers/movements`, label: 'تحركات مندوب الشحن', icon: MapPinned, end: true},
  ];

  const financeLinks = [
    {to: `${basePath}/finance/cashboxes`, label: 'إدارة الخزائن والحركات', icon: Wallet, end: true},
    {to: `${basePath}/finance/collections`, label: 'التحصيل من المندوبين', icon: Coins, end: true},
    {to: `${basePath}/clients/settlements`, label: 'تسويات العملاء', icon: FileSpreadsheet, end: true},
    {to: `${basePath}/couriers/settlements`, label: 'تسويات وعمولات المندوبين', icon: Banknote, end: true},
  ];

  const accountingLinks = [
    {to: `${basePath}/reports`, label: 'التقارير التنفيذية', icon: BarChart3, end: true},
    {to: `${basePath}/accounting/journal-entries`, label: 'قيود اليومية العامة', icon: BookOpen, end: true},
    {to: `${basePath}/accounting/trial-balance`, label: 'ميزان المراجعة والأستاذ', icon: Scale, end: true},
  ];

  const messagingSettingsLinks = [
    {to: `${basePath}/messaging`, label: 'الرسائل والمحادثات', icon: MessageSquare, end: true},
    {
      to: `${basePath}/notifications`,
      label: unreadNotifCount > 0 ? `الإشعارات · ${unreadNotifCount}` : 'الإشعارات',
      icon: Bell,
      end: true,
    },
    {to: `${basePath}/settings`, label: 'إعدادات الشركة والملفات', icon: Settings, end: true},
  ];

  const renderSidebarContent = () => (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-slate-200 px-5 py-4">
          <Link to={buildTenantBasePath(tenant.slug)} className="block text-base font-bold text-slate-900">
            {tenant.name}
          </Link>
        </div>

        <nav aria-label={isClientAccount ? 'القائمة الجانبية لبوابة العميل' : isCourierAccount ? 'القائمة الجانبية للمندوب' : 'القائمة الجانبية للشركة'} className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-3">
          {isClientAccount ? (
            <div className="space-y-1">
              {clientPortalLinks.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setSidebarOpen(false)}
                    className={({isActive}) =>
                      `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{t(item.label)}</span>
                  </NavLink>
                );
              })}
            </div>
          ) : isCourierAccount ? (
            <div className="space-y-1">
              <NavLink
                to={courierPortalPath}
                onClick={() => setSidebarOpen(false)}
                className={({isActive}) =>
                  `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors ${
                    isActive ? 'bg-[#ef6a47] text-white shadow-sm' : 'text-slate-700 hover:bg-orange-50 hover:text-[#d95537]'
                  }`
                }
              >
                <Truck className="h-4 w-4 shrink-0" />
                <span>{t('بوابة المندوب')}</span>
              </NavLink>
              <NavLink
                to={`${basePath}/messaging`}
                onClick={() => setSidebarOpen(false)}
                className={({isActive}) =>
                  `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold ${
                    isActive ? 'bg-[#ef6a47] text-white' : 'text-slate-700 hover:bg-orange-50 hover:text-[#d95537]'
                  }`
                }
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                <span>{t('الرسائل والمحادثات')}</span>
              </NavLink>
              <NavLink
                to={`${basePath}/settings`}
                onClick={() => setSidebarOpen(false)}
                className={({isActive}) =>
                  `flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold ${
                    isActive ? 'bg-[#ef6a47] text-white' : 'text-slate-700 hover:bg-orange-50 hover:text-[#d95537]'
                  }`
                }
              >
                <Settings className="h-4 w-4 shrink-0" />
                <span>{t('إعدادات الشركة والملفات')}</span>
              </NavLink>
            </div>
          ) : (
            <>
              <NavLink
                to={basePath}
                end
                onClick={() => setSidebarOpen(false)}
                className={({isActive}) =>
                  `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                  }`
                }
              >
                <LayoutDashboard className="h-4 w-4 shrink-0" />
                <span>{t('لوحة التحكم')}</span>
              </NavLink>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => toggleSection('definitions')}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span>{t('التعريفات الأساسية')}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${openSection === 'definitions' ? 'rotate-180' : ''}`}
              />
            </button>

            {openSection === 'definitions' && (
              <div className="mt-1 space-y-0.5 pr-1">
                {definitionLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setSidebarOpen(false)}
                      className={({isActive}) =>
                        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`
                      }
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{t(item.label)}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => toggleSection('shipments')}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span>{t('الشحنات')}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${openSection === 'shipments' ? 'rotate-180' : ''}`}
              />
            </button>

            {openSection === 'shipments' && (
              <div className="mt-1 space-y-0.5 pr-1">
                {shipmentLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setSidebarOpen(false)}
                      className={({isActive}) =>
                        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`
                      }
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{t(item.label)}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => toggleSection('operations')}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span>{t('العمليات اليومية')}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${openSection === 'operations' ? 'rotate-180' : ''}`}
              />
            </button>

            {openSection === 'operations' && (
              <div className="mt-1 space-y-0.5 pr-1">
                {operationLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setSidebarOpen(false)}
                      className={({isActive}) =>
                        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`
                      }
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{t(item.label)}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => toggleSection('clients')}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span>{t('العملاء')}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${openSection === 'clients' ? 'rotate-180' : ''}`}
              />
            </button>

            {openSection === 'clients' && (
              <div className="mt-1 space-y-0.5 pr-1">
                {clientLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setSidebarOpen(false)}
                      className={({isActive}) =>
                        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`
                      }
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{t(item.label)}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => toggleSection('couriers')}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span>{t('مندوبو التوصيل')}</span>
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${openSection === 'couriers' ? 'rotate-180' : ''}`}
              />
            </button>

            {openSection === 'couriers' && (
              <div className="mt-1 space-y-0.5 pr-1">
                {courierLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setSidebarOpen(false)}
                      className={({isActive}) =>
                        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`
                      }
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{t(item.label)}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => toggleSection('finance')}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span className="inline-flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5 shrink-0" />
                <span>{t('المالية والخزائن')}</span>
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${openSection === 'finance' ? 'rotate-180' : ''}`}
              />
            </button>

            {openSection === 'finance' && (
              <div className="mt-1 space-y-0.5 pr-1">
                {financeLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setSidebarOpen(false)}
                      className={({isActive}) =>
                        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`
                      }
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{t(item.label)}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => toggleSection('accounting')}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span className="inline-flex items-center gap-1.5">
                <Scale className="h-3.5 w-3.5 shrink-0" />
                <span>{t('الحسابات العامة والتقارير')}</span>
              </span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${openSection === 'accounting' ? 'rotate-180' : ''}`} />
            </button>
            {openSection === 'accounting' && (
              <div className="mt-1 space-y-0.5 pr-1">
                {accountingLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setSidebarOpen(false)}
                      className={({isActive}) =>
                        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                          isActive ? 'bg-[#ef6a47] text-white shadow-sm' : 'text-slate-700 hover:bg-orange-50 hover:text-[#d95537]'
                        }`
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{t(item.label)}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => toggleSection('security')}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span className="inline-flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 shrink-0" />
                <span>{t('الأمان')}</span>
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${openSection === 'security' ? 'rotate-180' : ''}`}
              />
            </button>

            {openSection === 'security' && (
              <div className="mt-1 space-y-0.5 pr-1">
                {securityLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setSidebarOpen(false)}
                      className={({isActive}) =>
                        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                          isActive
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`
                      }
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{t(item.label)}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => toggleSection('messages')}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span className="inline-flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span>{t('الرسائل والإعدادات')}</span>
              </span>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${openSection === 'messages' ? 'rotate-180' : ''}`} />
            </button>
            {openSection === 'messages' && (
              <div className="mt-1 space-y-0.5 pr-1">
                {messagingSettingsLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setSidebarOpen(false)}
                      className={({isActive}) =>
                        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                          isActive ? 'bg-[#ef6a47] text-white shadow-sm' : 'text-slate-700 hover:bg-orange-50 hover:text-[#d95537]'
                        }`
                      }
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{t(item.label)}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>
            </>
          )}
        </nav>
      </div>

      <div className="shrink-0 border-t border-slate-200 p-4">
        <Link
          to={`${basePath}/settings`}
          aria-label={t('إعدادات الشركة والملفات')}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 hover:border-orange-200 hover:bg-orange-50 hover:text-[#d95537]"
        >
          <UserRound className="h-5 w-5" />
        </Link>
      </div>
    </div>
  );

  return (
    <TenantWorkspaceProvider value={workspaceValue}>
      <div className="flex min-h-screen bg-slate-50 text-slate-900">
        {/* Desktop Sidebar */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-l border-slate-200 bg-white lg:block print:hidden">
          {renderSidebarContent()}
        </aside>

        {/* Mobile Drawer */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 flex lg:hidden print:hidden">
            <div className="w-64 bg-white shadow-xl">{renderSidebarContent()}</div>
            <button
              type="button"
              aria-label="إغلاق القائمة"
              onClick={() => setSidebarOpen(false)}
              className="flex-1 bg-slate-900/40"
            />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top Bar Contract: Single row, 3 zones */}
          <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/95 print:hidden backdrop-blur">
            <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="فتح القائمة الجانبية"
                  onClick={() => setSidebarOpen((prev) => !prev)}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-700 lg:hidden"
                >
                  {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                </button>
                <span className="text-base font-extrabold tracking-tight text-slate-900 whitespace-nowrap">
                  {BRAND_CONFIG.appName}
                </span>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <Link
                  to={`${basePath}/notifications`}
                  aria-label={t('الإشعارات')}
                  className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-orange-200 hover:bg-orange-50 hover:text-[#d95537]"
                >
                  <Bell className="h-5 w-5" />
                  {unreadNotifCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ef6a47] px-1 text-[9px] font-bold text-white">
                      {unreadNotifCount > 9 ? '9+' : unreadNotifCount}
                    </span>
                  )}
                </Link>
                <Link
                  to={`${basePath}/settings`}
                  aria-label={t('إعدادات الشركة والملفات')}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:border-orange-200 hover:bg-orange-50 hover:text-[#d95537]"
                >
                  <UserRound className="h-5 w-5" />
                </Link>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4 sm:px-6 sm:py-6">
            <Outlet />
          </main>
        </div>
      </div>
    </TenantWorkspaceProvider>
  );
}
