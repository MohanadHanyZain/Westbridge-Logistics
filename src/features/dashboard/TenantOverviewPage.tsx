import {useEffect, useState} from 'react';
import {Link} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {ClientPortalDashboardPage} from '@/features/clients/ClientPortalDashboardPage';
import {getExecutiveOperationsReport} from '@/features/reports/reportsService';
import {fetchShipmentDashboardCounts} from '@/features/shipments/shipmentsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {AccountSubjectType} from '@/types/common';
import {translateUi, useLocale} from '@/lib/i18n';
import type {ShipmentDashboardCounts} from '@/types/shipments';
import {AlertCircle, ArrowLeft, Package, PackageCheck, Truck} from 'lucide-react';
import {Skeleton} from '@/components/ui/Skeleton';

const cardStyles = [
  {icon: 'text-orange-600', surface: 'bg-orange-50/80 border-orange-100'},
  {icon: 'text-sky-600', surface: 'bg-sky-50/80 border-sky-100'},
  {icon: 'text-violet-600', surface: 'bg-violet-50/80 border-violet-100'},
  {icon: 'text-emerald-600', surface: 'bg-emerald-50/80 border-emerald-100'},
  {icon: 'text-rose-600', surface: 'bg-rose-50/80 border-rose-100'},
] as const;

export function TenantOverviewPage() {
  const {membership} = useTenantWorkspace();
  if (membership.account_subject_type === AccountSubjectType.CLIENT) {
    return <ClientPortalDashboardPage />;
  }
  return <StaffTenantOverviewInner />;
}

function StaffTenantOverviewInner() {
  const {tenant} = useTenantWorkspace();
  const locale = useLocale();
  const t = (text: string) => translateUi(text, locale);
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;
  const [shipmentCounts, setShipmentCounts] = useState<ShipmentDashboardCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'all' | '7d' | '30d'>('all');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setDashboardError(null);

    const load = period === 'all'
      ? fetchShipmentDashboardCounts(tenant.id)
      : (() => {
          const days = period === '7d' ? 7 : 30;
          const dateTo = new Date();
          const dateFrom = new Date();
          dateFrom.setDate(dateTo.getDate() - days);
          return getExecutiveOperationsReport({
            tenantId: tenant.id,
            dateFrom: dateFrom.toISOString().slice(0, 10),
            dateTo: dateTo.toISOString().slice(0, 10),
          }).then((report) => ({
            totalCount: report.kpis.total_shipments,
            inWarehouseCount: report.kpis.in_warehouse_count,
            outForDeliveryCount: report.kpis.out_for_delivery_count,
            deliveredCount: report.kpis.delivered_count + report.kpis.partially_delivered_count,
            returnsCount: report.kpis.returned_count + report.kpis.delivery_failed_count,
          }));
        })();

    load
      .then((res) => {
        if (active) setShipmentCounts(res);
      })
      .catch((error: unknown) => {
        if (active) {
          setShipmentCounts(null);
          setDashboardError(error instanceof Error ? error.message : 'تعذر تحميل مؤشرات لوحة التحكم.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [tenant.id, period]);

  const cards = [
    {label: 'إجمالي الشحنات', value: shipmentCounts?.totalCount ?? (dashboardError ? null : 0), to: `${basePath}/shipments`, icon: Package},
    {label: 'في المخزون', value: shipmentCounts?.inWarehouseCount ?? (dashboardError ? null : 0), to: `${basePath}/shipments/warehouse`, icon: PackageCheck},
    {label: 'قيد التوصيل', value: shipmentCounts?.outForDeliveryCount ?? (dashboardError ? null : 0), to: `${basePath}/shipments/out-for-delivery`, icon: Truck},
    {label: 'تم التسليم', value: shipmentCounts?.deliveredCount ?? (dashboardError ? null : 0), to: `${basePath}/shipments`, icon: PackageCheck},
    {label: 'المرتجعات', value: shipmentCounts?.returnsCount ?? (dashboardError ? null : 0), to: `${basePath}/shipments/returns`, icon: AlertCircle},
  ];

  const distribution = cards.slice(1).map((card, index) => ({
    label: card.label,
    value: card.value ?? 0,
    color: ['#38bdf8', '#a78bfa', '#34d399', '#fb7185'][index],
  }));
  const distributionTotal = distribution.reduce((sum, item) => sum + item.value, 0);
  let chartOffset = 0;
  const chartSegments = distribution.map((item) => {
    const start = chartOffset;
    chartOffset += distributionTotal === 0 ? 0 : (item.value / distributionTotal) * 100;
    return `${item.color} ${start}% ${chartOffset}%`;
  });
  const chartBackground = distributionTotal > 0
    ? `conic-gradient(${chartSegments.join(', ')})`
    : 'conic-gradient(#e5e7eb 0% 100%)';

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-slate-500">{t('لوحة الإدارة')}</p>
          <h1 className="mt-1 text-xl font-extrabold text-slate-900 sm:text-2xl">{t('نظرة عامة على العمليات')}</h1>
        </div>
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1" role="group" aria-label={t('نطاق المؤشرات الزمني')}>
          {([
            ['all', 'الكل'],
            ['7d', '7 أيام'],
            ['30d', '30 يومًا'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setPeriod(id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                period === id
                  ? 'brand-gradient text-white shadow-sm'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {t(label)}
            </button>
          ))}
        </div>
      </section>

      {dashboardError && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {t('تعذر تحميل مؤشرات لوحة التحكم')}: {dashboardError}
        </div>
      )}

      <section aria-label="مؤشرات حركة الشحنات" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((card, index) => {
          const Icon = card.icon;
          const style = cardStyles[index];
          return (
            <Link
              key={card.label}
              to={card.to}
              className={`group min-h-28 rounded-2xl border p-4 ${style.surface} hover:-translate-y-0.5 hover:shadow-sm`}
            >
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-9 w-9 rounded-xl" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-6 w-16" />
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-xl bg-white/80 shadow-sm ${style.icon}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <ArrowLeft className="h-4 w-4 text-slate-300 transition-transform group-hover:-translate-x-1" />
                  </div>
                  <p className="mt-3 text-xs font-medium text-slate-500">{t(card.label)}</p>
                  <p className="mt-1 font-mono-tabular text-2xl font-extrabold text-slate-900">
                    {card.value === null ? '—' : card.value.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US')}
                  </p>
                </>
              )}
            </Link>
          );
        })}
      </section>

      <section className="surface-card rounded-2xl p-4 sm:p-5" aria-label="رسم حركة الشحنات">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-slate-900">{t('حركة الشحنات')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('توزيع مؤشرات العمليات للفترة المحددة')}</p>
          </div>
          <Link to={`${basePath}/reports`} className="text-xs font-bold text-[#d95537] hover:text-[#b94329]">
            {t('عرض التقرير')}
          </Link>
        </div>

        {loading ? (
          <div className="mt-6 flex h-52 items-center justify-center">
            <Skeleton className="h-40 w-40 rounded-full" />
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center justify-center gap-6 sm:flex-row">
            <div
              role="img"
              aria-label={t('حركة الشحنات')}
              className="relative h-44 w-44 shrink-0 rounded-full"
              style={{background: chartBackground}}
            >
              <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-white text-center">
                <span className="text-xs font-medium text-slate-500">{t('إجمالي الشحنات')}</span>
                <span className="mt-1 font-mono-tabular text-2xl font-extrabold text-slate-900">
                  {dashboardError ? '—' : (shipmentCounts?.totalCount ?? 0).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US')}
                </span>
              </div>
            </div>
            <div className="grid w-full max-w-sm grid-cols-1 gap-3">
              {distribution.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-3 py-2.5">
                  <span className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-full" style={{backgroundColor: item.color}} />
                    {t(item.label)}
                  </span>
                  <span className="font-mono-tabular text-sm font-bold text-slate-900">
                    {dashboardError ? '—' : item.value.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
