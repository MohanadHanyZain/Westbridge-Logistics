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
import {DistributionDonut, type DonutSlice} from '@/components/ui/DistributionDonut';

const SLICE_COLORS = {
  warehouse: '#0ea5e9',
  outForDelivery: '#8b5cf6',
  delivered: '#10b981',
  returns: '#f43f5e',
} as const;

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

  const format = (value: number) => value.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US');

  const cards = [
    {
      label: 'إجمالي الشحنات',
      value: shipmentCounts?.totalCount ?? (dashboardError ? null : 0),
      to: `${basePath}/shipments`,
      icon: Package,
      tone: 'text-[var(--tenant-brand)]',
    },
    {
      label: 'في المخزون',
      value: shipmentCounts?.inWarehouseCount ?? (dashboardError ? null : 0),
      to: `${basePath}/shipments/warehouse`,
      icon: PackageCheck,
      tone: 'text-sky-500',
    },
    {
      label: 'قيد التوصيل',
      value: shipmentCounts?.outForDeliveryCount ?? (dashboardError ? null : 0),
      to: `${basePath}/shipments/out-for-delivery`,
      icon: Truck,
      tone: 'text-violet-500',
    },
    {
      label: 'تم التسليم',
      value: shipmentCounts?.deliveredCount ?? (dashboardError ? null : 0),
      to: `${basePath}/shipments`,
      icon: PackageCheck,
      tone: 'text-emerald-500',
    },
    {
      label: 'المرتجعات',
      value: shipmentCounts?.returnsCount ?? (dashboardError ? null : 0),
      to: `${basePath}/shipments/returns`,
      icon: AlertCircle,
      tone: 'text-rose-500',
    },
  ];

  const slices: DonutSlice[] = [
    {key: 'warehouse', label: t('في المخزون'), value: shipmentCounts?.inWarehouseCount ?? 0, color: SLICE_COLORS.warehouse},
    {
      key: 'outForDelivery',
      label: t('قيد التوصيل'),
      value: shipmentCounts?.outForDeliveryCount ?? 0,
      color: SLICE_COLORS.outForDelivery,
    },
    {key: 'delivered', label: t('تم التسليم'), value: shipmentCounts?.deliveredCount ?? 0, color: SLICE_COLORS.delivered},
    {key: 'returns', label: t('المرتجعات'), value: shipmentCounts?.returnsCount ?? 0, color: SLICE_COLORS.returns},
  ];

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('لوحة الإدارة')}</p>
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
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                period === id
                  ? 'bg-[var(--tenant-brand)] text-white shadow-sm'
                  : 'text-slate-500 hover:text-[var(--tenant-brand)]'
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
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              key={card.label}
              to={card.to}
              className="group rounded-xl border border-slate-200 bg-white p-4 transition-all duration-200 hover:border-[var(--tenant-brand)] hover:shadow-sm"
            >
              {loading ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-5 rounded-md" />
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-6 w-16" />
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between">
                    <Icon strokeWidth={1.9} className={`h-5 w-5 ${card.tone}`} />
                    <ArrowLeft
                      strokeWidth={2}
                      className="h-3.5 w-3.5 text-slate-300 opacity-0 transition-all duration-200 group-hover:-translate-x-0.5 group-hover:text-[var(--tenant-brand)] group-hover:opacity-100"
                    />
                  </div>
                  <p className="mt-3 text-xs font-semibold text-slate-500">{t(card.label)}</p>
                  <p className="mt-0.5 font-mono-tabular text-2xl font-extrabold tracking-tight text-slate-900">
                    {card.value === null ? '—' : format(card.value)}
                  </p>
                </>
              )}
            </Link>
          );
        })}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-label="توزيع حالات الشحنات">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-slate-900">{t('مؤشرات حركة الشحنات')}</p>
            <p className="mt-1 text-xs text-slate-500">{t('توزيع حالات الشحنات ونسبها من الإجمالي للفترة المحددة')}</p>
          </div>
          <Link to={`${basePath}/reports`} className="shrink-0 text-xs font-bold text-[var(--tenant-brand)] hover:underline">
            {t('عرض التقرير')}
          </Link>
        </div>

        <div className="mt-4">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="h-40 w-40 animate-pulse rounded-full border-[26px] border-slate-100" />
            </div>
          ) : (
            <DistributionDonut
              slices={slices}
              total={shipmentCounts?.totalCount ?? 0}
              centerLabel={t('إجمالي الشحنات')}
              formatValue={format}
            />
          )}
        </div>
      </section>
    </div>
  );
}
