import {useEffect, useState} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {BRAND_CONFIG, buildTenantBasePath} from '@/config/brand';
import {fetchPublicTenantBySlug} from '@/features/tenants/tenantService';
import type {PublicTenantInfo} from '@/types/tenant';
import {LogIn, PackageSearch} from 'lucide-react';

export function TenantPublicPage() {
  const {companySlug = ''} = useParams();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<PublicTenantInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [trackingCode, setTrackingCode] = useState('');
  const [trackingNotice, setTrackingNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchPublicTenantBySlug(companySlug)
      .then((data) => {
        if (active) {
          setTenant(data);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [companySlug]);

  const basePath = buildTenantBasePath(companySlug);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-sm text-slate-600">
        جاري تحميل بوابة الشركة...
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-right">
          <h1 className="text-lg font-bold text-slate-900">الشركة غير متاحة</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            تعذر العثور على شركة شحن نشطة بالمسار المطلوب، أو أن حساب الشركة موقوف مؤقتًا.
          </p>
          <Link
            to="/"
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            العودة للرئيسية
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          <span className="text-lg font-bold text-slate-900 whitespace-nowrap shrink-0">
            {tenant.name}
          </span>

          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            <a href="#tracking" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              تتبع الشحنة
            </a>
            <a href="#services" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              الخدمات والتغطية
            </a>
          </nav>

          <Link
            to={`${basePath}/login`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <LogIn className="h-3.5 w-3.5" />
            تسجيل الدخول
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-10 px-6 py-12">
        <section id="tracking" className="rounded-xl border border-slate-200 bg-white p-8">
          <p className="text-xs font-medium text-slate-500">
            الموقع العام للشركة · {BRAND_CONFIG.appName}
          </p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">مرحبًا بكم في {tenant.name}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            بوابة التتبع العام وخدمات الشحن والتوصيل الخاصة بالشركة. يمكن للموظفين والتجار والمناديب
            تسجيل الدخول من الزر المخصص للوصول إلى لوحة التحكم.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const cleaned = trackingCode.trim();
              if (!cleaned) {
                setTrackingNotice('يرجى إدخال رقم الشحنة أو البوليصة أولًا.');
                return;
              }
              navigate(`${basePath}/track/${encodeURIComponent(cleaned)}`);
            }}
            className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <div className="relative flex-1 max-w-md">
              <PackageSearch className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={trackingCode}
                onChange={(e) => setTrackingCode(e.target.value)}
                placeholder="أدخل رقم الشحنة أو البوليصة..."
                aria-label="رقم الشحنة للتتبع"
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 whitespace-nowrap"
            >
              تتبع الشحنة
            </button>
          </form>

          {trackingNotice && (
            <p role="status" className="mt-3 text-xs font-medium text-slate-600">
              {trackingNotice}
            </p>
          )}
        </section>

        <section id="services" className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">التوقيت والعملة المعتمدة</h2>
            <p className="mt-2 font-mono-tabular text-sm text-slate-700">
              {tenant.default_currency} · {tenant.default_timezone}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">تسجيل التجار الجدد</h2>
            <p className="mt-2 text-sm text-slate-600">
              {tenant.allow_client_self_registration
                ? 'التسجيل الذاتي للتجار مفعّل من إدارة الشركة (تُفعّل البوابة في المرحلة 11).'
                : 'تسجيل التجار يتم عبر إدارة الشركة حاليًا.'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">دخول المستخدمين</h2>
            <Link
              to={`${basePath}/login`}
              className="mt-2 inline-block text-sm font-medium text-slate-900 underline underline-offset-4"
            >
              الانتقال إلى صفحة تسجيل الدخول
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
