import {useState, type FormEvent} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {BRAND_CONFIG, buildTenantBasePath} from '@/config/brand';
import {isValidCompanySlug} from '@/lib/formatters';
import {useAuth} from '@/lib/auth';
import {ArrowLeft, Building2, Layers, Shield} from 'lucide-react';

export function HomeHubPage() {
  const navigate = useNavigate();
  const {platformAdmin} = useAuth();
  const [companySlug, setCompanySlug] = useState('');
  const [slugError, setSlugError] = useState<string | null>(null);

  const handleOpenTenant = (event: FormEvent) => {
    event.preventDefault();
    setSlugError(null);
    const normalized = companySlug.trim().toLowerCase();
    if (!isValidCompanySlug(normalized)) {
      setSlugError('أدخل معرّف الشركة بالإنجليزية (مثال: cairo-express).');
      return;
    }
    navigate(buildTenantBasePath(normalized));
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-4">
          <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            {BRAND_CONFIG.appName}
          </span>

          <nav aria-label="التنقل الرئيسي" className="flex items-center gap-6">
            <Link
              to="/"
              className="border-b-2 border-slate-900 pb-1 text-sm font-medium text-slate-900 whitespace-nowrap shrink-0"
            >
              الرئيسية
            </Link>
            <Link
              to="/platform"
              className="border-b-2 border-transparent pb-1 text-sm font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              المنصة المركزية
            </Link>
            <Link
              to="/architecture"
              className="border-b-2 border-transparent pb-1 text-sm font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              المعمارية والمراحل
            </Link>
          </nav>

          <Link
            to={platformAdmin?.is_active ? '/platform' : '/platform/login'}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            {platformAdmin?.is_active ? 'لوحة المنصة' : 'دخول إدارة المنصة'}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-8 px-6 py-10">
        <section className="border-b border-slate-200 pb-8">
          <p className="text-xs font-medium text-slate-500">
            المرحلة 1 · عزل الشركات والمصادقة والعضويات (Multi-Tenant & RLS)
          </p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">
            {BRAND_CONFIG.appName} — {BRAND_CONFIG.appTagline}
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
            إدارة مستقلة لكل شركة شحن عبر بوابة عامة ولوحة إدارة ومعرفات معزولة على مستوى قاعدة
            البيانات (`PostgreSQL RLS`)، مع تسجيل دخول آمن بـ `Username` دون كشف البريد الإلكتروني.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <Shield className="h-5 w-5 text-slate-700" />
            <h2 className="mt-3 text-base font-semibold text-slate-900">المنصة المركزية</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              إضافة شركات الشحن يدويًا من مالك المنصة، تفعيلها أو إيقافها، وإرسال دعوة التفعيل للمالك.
            </p>
            <Link
              to="/platform"
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900 underline underline-offset-4"
            >
              فتح المنصة المركزية
              <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <Building2 className="h-5 w-5 text-slate-700" />
            <h2 className="mt-3 text-base font-semibold text-slate-900">بوابة شركة شحن</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              افتح الموقع العام لشركة شحن أو انتقل مباشرة إلى صفحة تسجيل الدخول الخاصة بها.
            </p>
            <form onSubmit={handleOpenTenant} className="mt-4 flex items-center gap-2">
              <input
                type="text"
                dir="ltr"
                value={companySlug}
                onChange={(e) => setCompanySlug(e.target.value)}
                placeholder="company-slug"
                aria-label="معرّف الشركة"
                className="w-full rounded-lg border border-slate-200 px-3 py-1.5 font-mono-tabular text-xs focus:border-slate-400 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
              >
                فتح
              </button>
            </form>
            {slugError && <p className="mt-2 text-xs text-red-700">{slugError}</p>}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <Layers className="h-5 w-5 text-slate-700" />
            <h2 className="mt-3 text-base font-semibold text-slate-900">المرجع المعماري والمراحل</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              استعراض خارطة التنفيذ (0–17)، سجل القرارات المعتمدة والمفتوحة، وفحص جاهزية البيئة.
            </p>
            <Link
              to="/architecture"
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900 underline underline-offset-4"
            >
              عرض المرجع المعماري
              <ArrowLeft className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
