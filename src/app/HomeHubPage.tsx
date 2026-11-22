import {Link} from 'react-router-dom';
import {BRAND_CONFIG} from '@/config/brand';
import {useAuth} from '@/lib/auth';
import {
  ArrowLeft,
  BarChart3,
  Building2,
  Check,
  Globe2,
  Mail,
  MessageCircle,
  PackageCheck,
  Route,
  ShieldCheck,
  Truck,
  Wallet,
} from 'lucide-react';

const heroImageUrl = new URL('../../images/Golden Hour Logistics Hub.png', import.meta.url).href;

const features = [
  {icon: PackageCheck, title: 'إدارة الشحنات', text: 'من الإنشاء وحتى التسليم والمرتجعات مع تدفق واضح لكل حالة.'},
  {icon: Route, title: 'تشغيل يومي منظم', text: 'التقاط، مخزن، نقل، توصيل وتحركات المندوبين في مكان واحد.'},
  {icon: Wallet, title: 'المالية والتسويات', text: 'متابعة التحصيل والعهد والخزائن وتسويات العملاء والمناديب.'},
  {icon: BarChart3, title: 'رؤية وتقارير', text: 'مؤشرات دقيقة تساعدك على اتخاذ القرار ومتابعة الأداء.'},
];

export function HomeHubPage() {
  const {platformAdmin} = useAuth();

  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2 text-xl font-extrabold tracking-tight text-slate-950">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl brand-gradient text-sm text-white shadow-sm">SF</span>
            <span>{BRAND_CONFIG.appName}</span>
          </Link>
          <nav className="hidden items-center gap-7 md:flex" aria-label="التنقل الرئيسي">
            <a href="#features" className="text-sm font-semibold text-slate-600 hover:text-[#d95537]">المميزات</a>
            <a href="#workflow" className="text-sm font-semibold text-slate-600 hover:text-[#d95537]">كيف يعمل</a>
            <a href="#contact" className="text-sm font-semibold text-slate-600 hover:text-[#d95537]">تواصل معنا</a>
          </nav>
          <Link
            to={platformAdmin?.is_active ? '/platform' : '/platform/login'}
            className="brand-gradient rounded-xl px-4 py-2.5 text-xs font-bold text-white shadow-sm hover:-translate-y-0.5 hover:shadow-md"
          >
            دخول المنصة
          </Link>
        </div>
      </header>

      <main>
        <section className="relative border-b border-slate-100">
          <div className="absolute inset-0 -z-0 opacity-70 [background-image:radial-gradient(#fed7cf_1px,transparent_1px)] [background-size:18px_18px]" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[1.08fr_.92fr] lg:py-24">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-orange-100 bg-orange-50 px-3 py-1.5 text-xs font-bold text-[#c54a30]">
                <ShieldCheck className="h-3.5 w-3.5" />
                منصة تشغيل مخصصة لشركات الشحن
              </div>
              <h1 className="mt-5 max-w-2xl text-4xl font-extrabold leading-[1.18] tracking-tight text-slate-950 sm:text-5xl">
                إدارة الشحنات والعمليات
                <span className="block text-[#e85f40]">بوضوح أعلى وأداء أسهل.</span>
              </h1>
              <p className="mt-5 max-w-xl text-base leading-8 text-slate-600 sm:text-lg">
                تجمع ShipFlow الفروع والشحنات والمناديب والعملاء والمالية والتقارير في تجربة واحدة هادئة ومنظمة.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/platform/login" className="brand-gradient inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-sm hover:-translate-y-0.5 hover:shadow-md">
                  ابدأ إدارة عملياتك
                  <ArrowLeft className="h-4 w-4" />
                </Link>
                <a href="#features" className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:border-orange-200 hover:text-[#d95537]">
                  استكشف المنصة
                </a>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-xl">
              <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white p-2 shadow-[0_24px_70px_-34px_rgba(15,23,42,.35)]">
                <img
                  src={heroImageUrl}
                  alt="فريق توصيل ينظم حركة الشحنات في مركز لوجستي"
                  className="aspect-[4/3] w-full rounded-[22px] object-cover"
                />
              </div>
              <div className="absolute -bottom-4 right-4 flex items-center gap-2 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-lg sm:right-8">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50 text-[#e85f40]">
                  <Truck className="h-5 w-5" />
                </span>
                <span className="text-sm font-extrabold text-slate-800">عمليات الشحن في مكان واحد</span>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-xl">
            <p className="text-xs font-bold text-[#d95537]">منصة متكاملة</p>
            <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950">كل ما تحتاجه التشغيل اليومي</h2>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({icon: Icon, title, text}) => (
              <article key={title} className="surface-card rounded-2xl p-5 hover:-translate-y-1 hover:border-orange-100 hover:shadow-md">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-[#e85f40]">
                  <Icon className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-base font-extrabold text-slate-900">{title}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-500">{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="workflow" className="border-y border-slate-100 bg-[#fafafa]">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
            <div className="grid items-center gap-10 lg:grid-cols-2">
              <div>
                <p className="text-xs font-bold text-[#d95537]">قبل ShipFlow وبعده</p>
                <h2 className="mt-2 text-3xl font-extrabold text-slate-950">تشغيل أقل تعقيدًا، وتنفيذ أكثر وضوحًا</h2>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-sm font-extrabold text-slate-500">بدون منصة موحدة</p>
                  <ul className="mt-4 space-y-3 text-sm text-slate-500">
                    <li>بيانات مشتتة بين الفرق</li>
                    <li>متابعة اليدوية للحالات</li>
                    <li>صعوبة التسوية والتتبع</li>
                  </ul>
                </div>
                <div className="brand-card rounded-2xl p-5">
                  <p className="text-sm font-extrabold text-[#b94329]">مع ShipFlow</p>
                  <ul className="mt-4 space-y-3 text-sm text-slate-700">
                    {['حالة واحدة واضحة', 'صلاحيات ونطاقات دقيقة', 'رؤية تشغيلية ومالية'].map((item) => (
                      <li key={item} className="flex items-center gap-2"><Check className="h-4 w-4 text-[#e85f40]" />{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="contact" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="surface-card rounded-[28px] p-6 sm:p-10">
            <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <p className="text-xs font-bold text-[#d95537]">تواصل معنا</p>
                <h2 className="mt-2 text-3xl font-extrabold text-slate-950">ابدأ رحلتك مع ShipFlow</h2>
                <p className="mt-3 max-w-xl text-sm leading-7 text-slate-500">
                  تواصل معنا للتعرّف على المنصة وكيفية تهيئتها لتناسب عمليات شركتك.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <a href="mailto:shipflow.official@gmail.com" className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 hover:border-orange-200 hover:text-[#d95537]">
                  <Mail className="h-4 w-4" />
                  البريد الإلكتروني
                </a>
                <a href="https://wa.me/201016987179" target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-xl brand-gradient px-4 py-3 text-sm font-bold text-white hover:shadow-md">
                  <MessageCircle className="h-4 w-4" />
                  تواصل عبر واتساب
                </a>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 sm:pb-20">
          <div className="brand-gradient flex flex-col items-start justify-between gap-6 rounded-[28px] px-6 py-8 text-white sm:flex-row sm:items-center sm:px-10 sm:py-10">
            <div>
              <h2 className="text-2xl font-extrabold">هل أنت جاهز لتنظيم عمليات الشحن؟</h2>
              <p className="mt-2 text-sm text-white/80">ابدأ بوصول واضح إلى شحناتك وفرقك وبياناتك التشغيلية.</p>
            </div>
            <Link to="/platform/login" className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-extrabold text-[#cf4f31] hover:-translate-y-0.5">
              الدخول إلى ShipFlow
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </div>
        </section>

        <footer className="border-t border-slate-100">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span className="font-extrabold text-slate-900">{BRAND_CONFIG.appName}</span>
            <div className="flex items-center gap-5">
              <span className="inline-flex items-center gap-1.5"><Globe2 className="h-3.5 w-3.5" />عربي / English</span>
              <span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />شركات الشحن والتوصيل</span>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
