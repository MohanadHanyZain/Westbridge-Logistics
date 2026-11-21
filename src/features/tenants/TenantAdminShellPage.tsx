import {useCallback, useEffect, useMemo, useState} from 'react';
import {Link, NavLink, Outlet, useParams} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {getMyTenantPermissions} from '@/features/security/securityService';
import {TenantWorkspaceProvider} from '@/features/tenants/TenantWorkspaceContext';
import {useAuth} from '@/lib/auth';
import {hasEffectivePermission} from '@/lib/permissions';
import {AccountSubjectType} from '@/types/common';
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
  LogOut,
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
  Users,
  Wallet,
  X,
} from 'lucide-react';

export function TenantAdminShellPage() {
  const {companySlug = ''} = useParams();
  const {memberships, profile, signOut} = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [defsExpanded, setDefsExpanded] = useState(true);
  const [shipmentsExpanded, setShipmentsExpanded] = useState(true);
  const [operationsExpanded, setOperationsExpanded] = useState(true);
  const [clientsExpanded, setClientsExpanded] = useState(true);
  const [couriersExpanded, setCouriersExpanded] = useState(true);
  const [financeExpanded, setFinanceExpanded] = useState(true);
  const [securityExpanded, setSecurityExpanded] = useState(true);
  const [permBundle, setPermBundle] = useState<MyTenantPermissionsBundle>({
    client_id: null,
    branch_ids: [],
    permissions: [],
  });
  const [unreadNotifCount, setUnreadNotifCount] = useState(0);

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
    {to: `${basePath}/portal/dashboard`, label: 'معاينة بوابة التاجر', icon: LayoutDashboard, end: true},
  ];

  const isClientAccount = activeMembership.account_subject_type === AccountSubjectType.CLIENT;

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
    {to: `${basePath}/operations/courier-portal`, label: 'بوابة المندوب', icon: UserCheck, end: true},
  ];

  const securityLinks = [
    {to: `${basePath}/security/users`, label: 'المستخدمون', icon: UserCog, end: false},
    {to: `${basePath}/security/roles`, label: 'الأدوار والصلاحيات', icon: KeyRound, end: false},
    {to: `${basePath}/security/sessions`, label: 'سجل الدخول والجلسات', icon: Activity, end: false},
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
    <div className="flex h-full flex-col justify-between">
      <div>
        <div className="border-b border-slate-200 px-5 py-4">
          <Link to={buildTenantBasePath(tenant.slug)} className="block text-base font-bold text-slate-900">
            {tenant.name}
          </Link>
          <p className="mt-0.5 font-mono-tabular text-xs text-slate-500">
            {tenant.code} · {tenant.slug}
          </p>
        </div>

        <nav aria-label={isClientAccount ? 'القائمة الجانبية لبوابة العميل' : 'القائمة الجانبية للشركة'} className="space-y-1 p-3">
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
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
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
                <span>لوحة التحكم</span>
              </NavLink>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => setDefsExpanded((prev) => !prev)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span>التعريفات الأساسية</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${defsExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {defsExpanded && (
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
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => setShipmentsExpanded((prev) => !prev)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span>الشحنات</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${shipmentsExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {shipmentsExpanded && (
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
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => setOperationsExpanded((prev) => !prev)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span>العمليات اليومية</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${operationsExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {operationsExpanded && (
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
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => setClientsExpanded((prev) => !prev)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span>العملاء</span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${clientsExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {clientsExpanded && (
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
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => setCouriersExpanded((prev) => !prev)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                <span>مندوبو التوصيل</span>
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${couriersExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {couriersExpanded && (
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
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => setFinanceExpanded((prev) => !prev)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span className="inline-flex items-center gap-1.5">
                <Wallet className="h-3.5 w-3.5 shrink-0" />
                <span>المالية والخزائن</span>
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${financeExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {financeExpanded && (
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
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <div className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400">
              <span>الحسابات العامة والتقارير</span>
            </div>
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
                        isActive
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`
                    }
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => setSecurityExpanded((prev) => !prev)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <span className="inline-flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 shrink-0" />
                <span>الأمان</span>
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${securityExpanded ? 'rotate-180' : ''}`}
              />
            </button>

            {securityExpanded && (
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
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-2">
            <div className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-400">
              <span>الرسائل والإعدادات</span>
            </div>
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
                        isActive
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-700 hover:bg-slate-100'
                      }`
                    }
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
            </>
          )}
        </nav>
      </div>

      <div className="border-t border-slate-200 p-4 text-xs">
        <p className="font-semibold text-slate-900">{profile?.display_name ?? activeMembership.username}</p>
        <p className="mt-0.5 font-mono-tabular text-slate-500">
          {activeMembership.username} · {activeMembership.role_key}
        </p>
      </div>
    </div>
  );

  return (
    <TenantWorkspaceProvider value={workspaceValue}>
      <div className="flex min-h-screen bg-slate-50 text-slate-900">
        {/* Desktop Sidebar */}
        <aside className="hidden w-64 shrink-0 border-l border-slate-200 bg-white lg:block print:hidden">
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
          <header className="border-b border-slate-200 bg-white print:hidden">
            <div className="flex items-center justify-between gap-4 px-6 py-3.5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="فتح القائمة الجانبية"
                  onClick={() => setSidebarOpen((prev) => !prev)}
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-700 lg:hidden"
                >
                  {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                </button>
                <span className="text-sm font-semibold text-slate-900 whitespace-nowrap">
                  {isClientAccount ? `بوابة التاجر · ${tenant.name}` : `بوابة إدارة ${tenant.name}`}
                </span>
              </div>

              <div className="hidden items-center gap-4 text-xs text-slate-500 sm:flex">
                <Link
                  to={`${basePath}/notifications`}
                  className="inline-flex items-center gap-1.5 font-medium text-slate-700 hover:text-slate-900 whitespace-nowrap"
                >
                  <Bell className="h-3.5 w-3.5" />
                  <span className="font-mono-tabular">
                    {unreadNotifCount > 0 ? `الإشعارات · ${unreadNotifCount}` : 'الإشعارات'}
                  </span>
                </Link>
                <span aria-hidden="true">·</span>
                <Link to={buildTenantBasePath(tenant.slug)} className="hover:text-slate-900 whitespace-nowrap">
                  الموقع العام للشركة
                </Link>
              </div>

              <button
                type="button"
                onClick={() => void signOut()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
                خروج
              </button>
            </div>
          </header>

          <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
            <Outlet />
          </main>
        </div>
      </div>
    </TenantWorkspaceProvider>
  );
}