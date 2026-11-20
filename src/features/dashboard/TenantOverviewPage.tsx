import {useEffect, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {buildTenantBasePath} from '@/config/brand';
import {ClientPortalDashboardPage} from '@/features/clients/ClientPortalDashboardPage';
import {fetchPhase2SummaryCounts} from '@/features/definitions/definitionsService';
import {fetchShipmentDashboardCounts} from '@/features/shipments/shipmentsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {updateMyCredentials, useAuth} from '@/lib/auth';
import {isValidUsername} from '@/lib/formatters';
import {AccountSubjectType} from '@/types/common';
import type {Phase2SummaryCounts} from '@/types/definitions';
import type {ShipmentDashboardCounts} from '@/types/shipments';
import {
  AlertCircle,
  Building,
  MapPinned,
  Package,
  PackageCheck,
  ShieldCheck,
  Truck,
  Wallet,
} from 'lucide-react';

export function TenantOverviewPage() {
  const {membership} = useTenantWorkspace();

  if (membership.account_subject_type === AccountSubjectType.CLIENT) {
    return <ClientPortalDashboardPage />;
  }

  return <StaffTenantOverviewInner />;
}

function StaffTenantOverviewInner() {
  const {tenant, membership} = useTenantWorkspace();
  const {profile, refreshContext} = useAuth();
  const basePath = `${buildTenantBasePath(tenant.slug)}/app`;

  const [counts, setCounts] = useState<Phase2SummaryCounts | null>(null);
  const [shipmentCounts, setShipmentCounts] = useState<ShipmentDashboardCounts | null>(null);
  const [newUsername, setNewUsername] = useState(membership.username);
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  useEffect(() => {
    let active = true;
    fetchPhase2SummaryCounts(tenant.id)
      .then((res) => {
        if (active) setCounts(res);
      })
      .catch(() => {
        if (active) setCounts(null);
      });
    fetchShipmentDashboardCounts(tenant.id)
      .then((res) => {
        if (active) setShipmentCounts(res);
      })
      .catch(() => {
        if (active) setShipmentCounts(null);
      });
    return () => {
      active = false;
    };
  }, [tenant.id]);

  const handleCredentialsSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);

    if (newUsername && !isValidUsername(newUsername)) {
      setFeedback({type: 'error', text: 'صيغة اسم المستخدم غير صالحة (3–32 حرفًا إنجليزيًا/رقميًا).'});
      return;
    }

    if (newPassword && newPassword.length < 8) {
      setFeedback({type: 'error', text: 'كلمة المرور يجب أن لا تقل عن 8 أحرف.'});
      return;
    }

    setSaving(true);
    try {
      await updateMyCredentials({
        tenantId: tenant.id,
        newUsername: newUsername !== membership.username ? newUsername : undefined,
        newPassword: newPassword || undefined,
      });
      setNewPassword('');
      await refreshContext();
      setFeedback({type: 'success', text: 'تم تحديث بيانات الحساب بنجاح.'});
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تحديث بيانات الحساب.',
      });
    } finally {
      setSaving(false);
    }
  };

  const summaryCards = [
    {
      label: 'الفروع النشطة',
      value: counts?.branchesCount ?? '—',
      to: `${basePath}/definitions/branches`,
      icon: Building,
    },
    {
      label: 'المحافظات المفعلة',
      value: counts?.activeGovernoratesCount ?? '—',
      to: `${basePath}/definitions/geography`,
      icon: MapPinned,
    },
    {
      label: 'المناطق المغطاة',
      value: counts?.activeRegionsCount ?? '—',
      to: `${basePath}/definitions/geography`,
      icon: MapPinned,
    },
    {
      label: 'خدمات الشحن',
      value: counts?.activeServicesCount ?? '—',
      to: `${basePath}/definitions/services`,
      icon: PackageCheck,
    },
    {
      label: 'الخزائن الفعالة',
      value: counts?.activeCashboxesCount ?? '—',
      to: `${basePath}/definitions/cashboxes`,
      icon: Wallet,
    },
    {
      label: 'أسباب التعذر والإرجاع',
      value: counts?.activeExceptionReasonsCount ?? '—',
      to: `${basePath}/definitions/exceptions`,
      icon: AlertCircle,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <p className="text-xs font-medium text-slate-500">لوحة إدارة الشركة · {tenant.name}</p>
        <h1 className="mt-1 text-xl font-bold text-slate-900">مرحبًا، {profile?.display_name}</h1>
        <dl className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500">اسم المستخدم</dt>
            <dd className="mt-1 font-mono-tabular font-medium text-slate-900">{membership.username}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">نوع الحساب / الدور</dt>
            <dd className="mt-1 font-mono-tabular font-medium text-slate-900">
              {membership.account_subject_type} · {membership.role_key}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">كود الشركة</dt>
            <dd className="mt-1 font-mono-tabular font-medium text-slate-900">{tenant.code}</dd>
          </div>
        </dl>
      </section>

      <section aria-label="ملخص الشحنات والتشغيل">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">مؤشرات حركة الشحنات</h2>
          <Link
            to={`${basePath}/shipments/new`}
            className="text-xs font-medium text-slate-700 underline underline-offset-4 hover:text-slate-900"
          >
            + إنشاء شحنة جديدة
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[
            {label: 'إجمالي الشحنات', value: shipmentCounts?.totalCount ?? '—', to: `${basePath}/shipments`, icon: Package},
            {label: 'في المخزون', value: shipmentCounts?.inWarehouseCount ?? '—', to: `${basePath}/shipments/warehouse`, icon: PackageCheck},
            {label: 'قيد التوصيل', value: shipmentCounts?.outForDeliveryCount ?? '—', to: `${basePath}/shipments/out-for-delivery`, icon: Truck},
            {label: 'تم التسليم', value: shipmentCounts?.deliveredCount ?? '—', to: `${basePath}/shipments`, icon: PackageCheck},
            {label: 'المرتجعات', value: shipmentCounts?.returnsCount ?? '—', to: `${basePath}/shipments/returns`, icon: AlertCircle},
          ].map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.label}
                to={card.to}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50/50"
              >
                <div>
                  <p className="text-xs font-medium text-slate-500">{card.label}</p>
                  <p className="mt-1 font-mono-tabular text-xl font-bold text-slate-900">{card.value}</p>
                </div>
                <Icon className="h-4 w-4 text-slate-400" />
              </Link>
            );
          })}
        </div>
      </section>

      <section aria-label="ملخص التعريفات الأساسية">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">جاهزية التعريفات الأساسية للشركة</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {summaryCards.map((card) => {
            const Icon = card.icon;
            return (
              <Link
                key={card.label}
                to={card.to}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-5 transition-colors hover:border-slate-300 hover:bg-slate-50/50"
              >
                <div>
                  <p className="text-xs font-medium text-slate-500">{card.label}</p>
                  <p className="mt-1.5 font-mono-tabular text-2xl font-bold text-slate-900">{card.value}</p>
                </div>
                <Icon className="h-5 w-5 text-slate-400" />
              </Link>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-slate-700" />
          <h2 className="text-base font-semibold text-slate-900">تحديث اسم المستخدم أو كلمة المرور</h2>
        </div>
        {membership.must_change_password && (
          <p className="mt-2 text-xs font-medium text-amber-700">
            يُرجى تعيين كلمة مرور شخصية جديدة لاستكمال تفعيل حسابك.
          </p>
        )}

        <form onSubmit={handleCredentialsSubmit} className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="update-username" className="block text-xs font-medium text-slate-700">
              اسم المستخدم الجديد (اختياري)
            </label>
            <input
              id="update-username"
              type="text"
              dir="ltr"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value.toLowerCase())}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="update-password" className="block text-xs font-medium text-slate-700">
              كلمة المرور الجديدة (8 أحرف على الأقل)
            </label>
            <input
              id="update-password"
              type="password"
              dir="ltr"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="اتركه فارغًا إن لم ترغب بالتغيير"
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
            </button>
          </div>
        </form>

        {feedback && (
          <p
            role="status"
            className={`mt-3 text-xs font-medium ${
              feedback.type === 'error' ? 'text-red-700' : 'text-emerald-700'
            }`}
          >
            {feedback.text}
          </p>
        )}
      </section>
    </div>
  );
}