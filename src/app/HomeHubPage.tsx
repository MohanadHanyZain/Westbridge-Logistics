import {useState} from 'react';
import {Link} from 'react-router-dom';
import {BRAND_CONFIG} from '@/config/brand';
import {useAuth} from '@/lib/auth';
import {translateUi, useLocale} from '@/lib/i18n';
import {
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  Building2,
  Check,
  ChevronDown,
  ClipboardList,
  Clock3,
  FileCheck2,
  Globe2,
  LockKeyhole,
  Mail,
  MapPin,
  Menu,
  MessageCircle,
  PackageCheck,
  Repeat2,
  Route,
  ScanBarcode,
  ShieldCheck,
  Sparkles,
  Truck,
  UserRoundCheck,
  Users,
  Wallet,
  X,
} from 'lucide-react';

const navLinks = [
  {href: '#apps', label: 'البوابات'},
  {href: '#features', label: 'الإمكانات'},
  {href: '#workflow', label: 'دورة التشغيل'},
  {href: '#security', label: 'الأمان'},
  {href: '#faq', label: 'الأسئلة'},
  {href: '#contact', label: 'تواصل معنا'},
];

const heroChecks = ['عزل بيانات لكل شركة', 'صلاحيات ونطاقات فروع', 'سجل تدقيق لكل تغيير'];

const metrics = [
  {value: '5', label: 'بوابات مترابطة'},
  {value: '12', label: 'دورًا وظيفيًا جاهزًا'},
  {value: '27', label: 'صلاحية دقيقة'},
  {value: '18', label: 'مرحلة تنفيذ موثّقة'},
];

const features = [
  {
    icon: ScanBarcode,
    title: 'إدارة الشحنات',
    text: 'إنشاء الشحنة مع تحقق العميل والتغطية، باركود غير قابل للتخمين، وتتبع من الالتقاط حتى التسليم والمرتجع.',
  },
  {
    icon: ClipboardList,
    title: 'العمليات اليومية',
    text: 'قوائم التقاط واستلام بالمخزن ونقل بين الفروع وتوصيل وإعادة توصيل، بقوائم معتمدة ونتيجة مستقلة لكل شحنة.',
  },
  {
    icon: Wallet,
    title: 'المالية والتسويات',
    text: 'تحصيل من المناديب، تسويات العملاء، صرف العمولات، الخزائن والتحويلات، وسندات قبض وصرف مترابطة.',
  },
  {
    icon: BarChart3,
    title: 'التقارير والمؤشرات',
    text: 'معدلات التسليم والتعذر والمرتجعات وأزمنة الدورة وأرصدة الخزائن، مع تصدير آمن وتقارير تنفيذية.',
  },
  {
    icon: ShieldCheck,
    title: 'الأدوار والصلاحيات',
    text: 'فصل نوع الحساب عن الدور عن نطاق الفرع، مع 27 صلاحية دقيقة تُفرض على الخادم وقاعدة البيانات.',
  },
  {
    icon: MapPin,
    title: 'التغطية والخرائط',
    text: 'دول ومحافظات ومناطق ومناطق خدمة لكل فرع، وخريطة حية لتحركات المندوبين أثناء المهام النشطة.',
  },
];

const apps = [
  {
    icon: Building2,
    name: 'المنصة المركزية',
    tag: 'المشغّل',
    text: 'إضافة الشركات وإيقافها، الباقات والحدود، النطاقات، ودخول الدعم المؤقت المسبب والمراقب.',
  },
  {
    icon: Globe2,
    name: 'موقع الشركة',
    tag: 'عام',
    text: 'صفحة عامة بالخدمات والتغطية، تتبع محدود للشحنة، وتسجيل عملاء حسب إعدادات كل شركة.',
  },
  {
    icon: BarChart3,
    name: 'لوحة الإدارة',
    tag: 'تشغيل',
    text: 'التعريفات والفروع والعملاء والأسعار والأمان والمناديب والشحنات والعمليات والمالية والحسابات.',
  },
  {
    icon: UserRoundCheck,
    name: 'بوابة العميل',
    tag: 'التاجر',
    text: 'الشحنات وطلبات الالتقاط والاستيراد والتتبع والطباعة وكشف الحساب والتسويات والرسائل ورموز API.',
  },
  {
    icon: Route,
    name: 'بوابة المندوب',
    tag: 'ميداني',
    text: 'مهام اليوم والمسارات والخريطة والتسليم والتعذر والإرجاع وإثبات التسليم وملخص العهدة النقدية.',
  },
];

const workflowSteps = [
  {
    title: 'إنشاء الشحنة وتسعيرها',
    text: 'تحقق من العميل والخدمة والتغطية، ثم تسعير على الخادم مع تثبيت لقطة سعر لا تتغير بعد إصدار القائمة.',
  },
  {
    title: 'الالتقاط والاستلام بالمخزن',
    text: 'قائمة التقاط معتمدة، ثم استلام بالمخزن مع تعديل الوزن الموثّق وأثره على العهدة.',
  },
  {
    title: 'النقل بين الفروع',
    text: 'مصافحة استلام على خطوتين تمنع نقل العهدة قبل اعتماد الاستلام في الفرع المستقبِل.',
  },
  {
    title: 'التوصيل أو التعذر',
    text: 'مهمة واضحة للمندوب مع إثبات تسليم، ومحاولات محدودة تُحوّل الشحنة تلقائيًا إلى مرتجع.',
  },
  {
    title: 'التحصيل والعهد',
    text: 'دفتر نقدية منفصل عن عهدة الشحنات والعمولات، مع منع تحصيل الاستحقاق مرتين.',
  },
  {
    title: 'التسوية والحسابات',
    text: 'سندات معتمدة، قيود متوازنة مربوطة بمصادرها، وميزان مراجعة وكشف حساب لكل طرف.',
  },
];

const securityPoints = [
  {
    icon: LockKeyhole,
    title: 'عزل على مستوى قاعدة البيانات',
    text: 'كل سجل شركة يحمل معرّف الشركة مع مفاتيح مركبة وسياسات RLS مفعّلة إجباريًا على الجداول المكشوفة.',
  },
  {
    icon: FileCheck2,
    title: 'تدقيق قبل وبعد',
    text: 'كل عملية حساسة تُسجّل المنفّذ والوقت والمصدر والقيمة السابقة واللاحقة، مع جلسات دخول مراقبة.',
  },
  {
    icon: Repeat2,
    title: 'مستندات لا تُحذف',
    text: 'المستند المعتمد يُصحّح بمستند عكسي، وتُنشأ العمليات الحرجة داخل معاملة واحدة مع مفاتيح منع التكرار.',
  },
  {
    icon: BadgeCheck,
    title: 'صلاحيات مفروضة خادميًا',
    text: 'إخفاء الأزرار ليس حماية؛ كل انتقال حالة أو اعتماد مالي يُتحقق منه في الخادم قبل تنفيذه.',
  },
];

const comparison = [
  {without: 'بيانات مشتتة بين الملفات والفرق', with: 'مصدر واحد لكل شحنة وعميل ومستند'},
  {without: 'متابعة يدوية لحالات الشحنات', with: 'انتقالات حالة محكومة ومُدقّقة'},
  {without: 'تسويات وعهد يصعب مطابقتها', with: 'عهدة نقدية منفصلة وتوزيع تلقائي'},
  {without: 'صلاحيات غير واضحة بين الفروع', with: 'أدوار ونطاقات فروع دقيقة'},
];

const faqs = [
  {
    q: 'هل يمكن تشغيل أكثر من شركة شحن على نفس المنصة؟',
    a: 'نعم. المنصة متعددة الشركات: كل شركة لها بياناتها وعملاؤها ومناديبها وفرقها وبوابتها العامة، مع عزل كامل على مستوى قاعدة البيانات وليس الواجهة فقط.',
  },
  {
    q: 'كيف تنضم فرق العمل والمناديب؟',
    a: 'يُنشئ مدير الشركة حسابات الموظفين والمناديب بأدوار ونطاقات فروع، ويصل الحساب عبر دعوة بريدية لتعيين كلمة مرور شخصية. لا تُخزَّن كلمات المرور في جداول التطبيق.',
  },
  {
    q: 'هل تعمل بوابة المندوب من الموبايل؟',
    a: 'نعم، تعمل من متصفح الهاتف: مهام اليوم، الخريطة، تسجيل نتيجة التسليم أو التعذر، إثبات التسليم، ومتابعة العهدة النقدية.',
  },
  {
    q: 'ماذا يتضمّن تأسيس شركة جديدة؟',
    a: 'فرع رئيسي، بيانات مرجعية وجغرافية، شجرة حسابات وأدوار وصلاحيات افتراضية، وترقيم مستندات — تُنشأ مرة واحدة وبشكل ذري قابل لإعادة المحاولة.',
  },
];

const previewShipments = [
  {code: 'SHP-0001428', city: 'القاهرة · مدينة نصر', status: 'قيد التوصيل', tone: 'amber'},
  {code: 'SHP-0001427', city: 'الجيزة · الدقي', status: 'تم التسليم', tone: 'emerald'},
  {code: 'SHP-0001425', city: 'الإسكندرية · سموحة', status: 'بالمخزن', tone: 'sky'},
  {code: 'SHP-0001421', city: 'المنصورة · الجامعة', status: 'مرتجع', tone: 'rose'},
];

const toneClasses: Record<string, string> = {
  amber: 'border-amber-100 bg-amber-50 text-amber-700',
  emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  sky: 'border-sky-100 bg-sky-50 text-sky-700',
  rose: 'border-rose-100 bg-rose-50 text-rose-700',
};

export function HomeHubPage() {
  const {platformAdmin} = useAuth();
  const locale = useLocale();
  const t = (text: string) => translateUi(text, locale);
  const [menuOpen, setMenuOpen] = useState(false);

  const platformTarget = platformAdmin?.is_active ? '/platform' : '/platform/login';

  return (
    <div className="min-h-screen overflow-x-hidden bg-white text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5" aria-label={`${BRAND_CONFIG.appName} — الرئيسية`}>
            <span className="brand-gradient flex h-9 w-9 items-center justify-center rounded-[10px] text-[13px] font-black text-white shadow-[0_8px_18px_-8px_rgba(217,85,55,.9)]">
              SF
            </span>
            <span className="text-lg font-extrabold tracking-tight text-slate-950">{BRAND_CONFIG.appName}</span>
            <span className="hidden rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500 sm:inline">
              SaaS
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex" aria-label={t('التنقل الرئيسي')}>
            {navLinks.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              >
                {t(item.label)}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to={platformTarget}
              className="hidden rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-bold text-slate-700 hover:border-orange-200 hover:text-[#d95537] sm:inline-flex"
            >
              {t('دخول المنصة')}
            </Link>
            <Link
              to={platformTarget}
              className="brand-gradient inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold text-white shadow-sm hover:shadow-md"
            >
              {t('ابدأ الآن')}
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
            <button
              type="button"
              aria-label={menuOpen ? t('إغلاق القائمة') : t('فتح القائمة')}
              aria-expanded={menuOpen}
              aria-controls="landing-mobile-nav"
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 lg:hidden"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div id="landing-mobile-nav" className="border-t border-slate-200 bg-white px-4 py-3 lg:hidden">
            <nav className="grid gap-1" aria-label={t('التنقل الرئيسي')}>
              {navLinks.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {t(item.label)}
                </a>
              ))}
              <Link
                to={platformTarget}
                className="mt-1 rounded-lg px-3 py-2.5 text-sm font-bold text-[#d95537] hover:bg-orange-50"
              >
                {t('دخول المنصة')}
              </Link>
            </nav>
          </div>
        )}
      </header>

      <main>
        {/* Hero */}
        <section className="relative isolate overflow-hidden bg-[#0b1220] text-white">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'radial-gradient(900px 480px at 88% -12%, rgba(239,106,71,.34), transparent 62%), radial-gradient(680px 380px at 6% 8%, rgba(56,189,248,.16), transparent 60%)',
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.4) 1px, transparent 1px)',
              backgroundSize: '58px 58px',
              maskImage: 'radial-gradient(ellipse at 50% 0%, black, transparent 78%)',
              WebkitMaskImage: 'radial-gradient(ellipse at 50% 0%, black, transparent 78%)',
            }}
          />

          <div className="relative mx-auto grid max-w-7xl gap-14 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.02fr_.98fr] lg:items-center lg:gap-10 lg:pb-28 lg:pt-20">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3 py-1.5 text-[11px] font-bold text-orange-100 backdrop-blur">
                <Sparkles className="h-3.5 w-3.5 text-[#ff9878]" aria-hidden="true" />
                {t('منصة تشغيل مخصصة لشركات الشحن والتوصيل')}
              </span>

              <h1 className="mt-6 text-[2.15rem] font-extrabold leading-[1.2] tracking-tight sm:text-5xl lg:text-[3.35rem]">
                {t('إدارة كاملة لشركات الشحن')}
                <span className="mt-1 block bg-gradient-to-l from-[#ffb199] via-[#ff9776] to-[#f2704c] bg-clip-text text-transparent">
                  {t('من البوليصة إلى التسوية.')}
                </span>
              </h1>

              <p className="mt-5 max-w-xl text-[15px] leading-8 text-slate-300 sm:text-base">
                {t(
                  'الشحنات والعمليات اليومية والمناديب والعملاء والتحصيل والحسابات في نظام واحد، بصلاحيات دقيقة لكل دور وفرع، وبيانات معزولة لكل شركة.',
                )}
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  to={platformTarget}
                  className="brand-gradient inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_32px_-16px_rgba(239,106,71,.9)] hover:-translate-y-0.5"
                >
                  {t('الدخول إلى المنصة')}
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </Link>
                <a
                  href="#apps"
                  className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/[0.06] px-6 py-3.5 text-sm font-bold text-white backdrop-blur hover:border-white/35 hover:bg-white/[0.1]"
                >
                  {t('استكشف البوابات الخمس')}
                </a>
              </div>

              <ul className="mt-8 grid gap-2.5 text-[13px] text-slate-300 sm:grid-cols-3">
                {heroChecks.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/15">
                      <Check className="h-3 w-3 text-emerald-300" aria-hidden="true" />
                    </span>
                    {t(item)}
                  </li>
                ))}
              </ul>
            </div>

            {/* Interface preview */}
            <div className="relative mx-auto w-full max-w-xl lg:max-w-none">
              <div
                aria-hidden="true"
                className="absolute -inset-6 -z-10 rounded-[42px] bg-gradient-to-tr from-[#ef6a47]/30 via-transparent to-transparent blur-2xl"
              />
              <div className="rounded-[26px] border border-white/15 bg-white/[0.06] p-2 backdrop-blur">
                <div className="overflow-hidden rounded-[20px] bg-white text-slate-900 shadow-[0_30px_70px_-30px_rgba(2,6,23,.75)]">
                  <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/90 px-3.5 py-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#fca5a5]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#fcd34d]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#86efac]" />
                    <span className="mx-auto truncate rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-500">
                      shipflow.app/c/your-company
                    </span>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                      {t('متصل')}
                    </span>
                  </div>

                  <div className="space-y-3 p-4">
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        {icon: PackageCheck, label: 'شحنات اليوم', value: '128'},
                        {icon: Truck, label: 'قيد التوصيل', value: '42'},
                        {icon: Wallet, label: 'تحصيل اليوم', value: '18,450'},
                      ].map(({icon: Icon, label, value}) => (
                        <div key={label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-2.5">
                          <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                            <Icon className="h-3 w-3 text-[#d95537]" aria-hidden="true" />
                            {t(label)}
                          </span>
                          <p className="font-mono-tabular mt-1.5 text-base font-extrabold leading-none text-slate-900">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="overflow-hidden rounded-xl border border-slate-100">
                      <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-3 py-2">
                        <span className="text-[11px] font-extrabold text-slate-700">{t('آخر الشحنات')}</span>
                        <span className="text-[10px] font-semibold text-slate-400">{t('كل الفروع')}</span>
                      </div>
                      <ul>
                        {previewShipments.map((row) => (
                          <li
                            key={row.code}
                            className="flex items-center justify-between gap-2 border-b border-slate-50 px-3 py-2 last:border-b-0"
                          >
                            <div className="min-w-0">
                              <p className="font-mono-tabular truncate text-[11px] font-bold text-slate-800">{row.code}</p>
                              <p className="truncate text-[10px] text-slate-500">{t(row.city)}</p>
                            </div>
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${toneClasses[row.tone]}`}
                            >
                              {t(row.status)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <p className="text-center text-[10px] font-semibold text-slate-400">
                      {t('معاينة من واجهة لوحة الإدارة')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="absolute -bottom-6 left-1 hidden w-60 rounded-2xl border border-slate-100 bg-white p-3 text-slate-900 shadow-[0_20px_45px_-22px_rgba(2,6,23,.5)] sm:block">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-50 text-[#e85f40]">
                    <Clock3 className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <p className="text-[11px] font-extrabold text-slate-900">{t('مهمة اليوم')}</p>
                    <p className="text-[10px] text-slate-500">{t('12 محطة · مندوب الجيزة')}</p>
                  </div>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full w-[68%] rounded-full bg-[#ef6a47]" />
                </div>
                <p className="mt-1.5 text-[10px] font-semibold text-slate-500">{t('8 من 12 تم تنفيذها')}</p>
              </div>
            </div>
          </div>
        </section>

        {/* Metrics band */}
        <section aria-label={t('أرقام المنصة')} className="border-b border-slate-100 bg-white">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-6 px-4 py-8 sm:grid-cols-4 sm:px-6">
            {metrics.map((metric) => (
              <div key={metric.label} className="text-center sm:text-start">
                <p className="font-mono-tabular text-2xl font-extrabold text-slate-950 sm:text-3xl">{metric.value}</p>
                <p className="mt-1 text-[11px] font-semibold text-slate-500 sm:text-xs">{t(metric.label)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Five apps */}
        <section id="apps" className="scroll-mt-20 bg-[#fafbfc] py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-xs font-bold text-[#d95537]">{t('خمس بوابات، نظام واحد')}</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-[2.35rem]">
                {t('كل فريق يعمل من بوابته، والبيانات واحدة')}
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {t(
                  'من إدارة المنصة إلى المندوب في الشارع، كل واجهة مصممة لمهمتها اليومية دون أن تفقد الترابط بين الشحنة والقائمة والمالية.',
                )}
              </p>
            </div>

            <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {apps.map(({icon: Icon, name, tag, text}) => (
                <article
                  key={name}
                  className="group surface-card rounded-2xl p-5 transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-[0_18px_40px_-28px_rgba(15,23,42,.5)]"
                >
                  <div className="flex items-start justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-orange-50 text-[#e85f40] transition group-hover:bg-[#ef6a47] group-hover:text-white">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-bold text-slate-500">
                      {t(tag)}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-extrabold text-slate-900">{t(name)}</h3>
                  <p className="mt-2 text-[13px] leading-7 text-slate-500">{t(text)}</p>
                </article>
              ))}

              <article className="brand-card flex flex-col justify-between rounded-2xl p-5">
                <div>
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[#d95537] shadow-sm">
                    <Users className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-base font-extrabold text-slate-900">{t('بداية سريعة')}</h3>
                  <p className="mt-2 text-[13px] leading-7 text-slate-600">
                    {t('تُنشأ الشركة بفرعها الرئيسي وأدوارها وشجرة حساباتها جاهزة، ثم تُدعى فرقك للعمل.')}
                  </p>
                </div>
                <Link
                  to={platformTarget}
                  className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-extrabold text-[#c04a2f] hover:text-[#a53c25]"
                >
                  {t('ابدأ من المنصة')}
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </article>
            </div>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="scroll-mt-20 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-xl">
                <p className="text-xs font-bold text-[#d95537]">{t('إمكانات المنصة')}</p>
                <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-[2.35rem]">
                  {t('مبنية على تفاصيل التشغيل اليومي')}
                </h2>
              </div>
              <p className="max-w-sm text-sm leading-7 text-slate-500">
                {t('لا شاشات عامة؛ كل وحدة مرتبطة بدورة الشحنة وبأثرها المالي والمخزني.')}
              </p>
            </div>

            <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map(({icon: Icon, title, text}) => (
                <article
                  key={title}
                  className="rounded-2xl border border-slate-200/80 bg-white p-5 transition hover:border-[#ef6a47]/30 hover:shadow-[0_18px_40px_-30px_rgba(15,23,42,.45)]"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-orange-100 bg-orange-50 text-[#e85f40]">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 text-[15px] font-extrabold text-slate-900">{t(title)}</h3>
                  <p className="mt-2 text-[13px] leading-7 text-slate-500">{t(text)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Workflow */}
        <section id="workflow" className="scroll-mt-20 border-y border-slate-100 bg-[#fafbfc] py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[.85fr_1.15fr] lg:gap-14">
            <div className="lg:sticky lg:top-24 lg:self-start">
              <p className="text-xs font-bold text-[#d95537]">{t('دورة التشغيل')}</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-[2.35rem]">
                {t('مسار واحد واضح من الالتقاط حتى التسوية')}
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {t(
                  'كل خطوة تُنفّذ خادميًا داخل قائمة معتمدة، وتترك أثرًا في العهدة والمخزون والمالية — دون تعديل مباشر على الحالة.',
                )}
              </p>
              <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
                <p className="flex items-center gap-2 text-[13px] font-extrabold text-slate-900">
                  <ShieldCheck className="h-4 w-4 text-[#e85f40]" aria-hidden="true" />
                  {t('لا تغيير حالة من الواجهة')}
                </p>
                <p className="mt-1.5 text-[12px] leading-6 text-slate-500">
                  {t('كل انتقال يتحقق من الحالة السابقة والصلاحية والفرع والسبب والأثر المالي والمخزني.')}
                </p>
              </div>
            </div>

            <ol className="relative space-y-4">
              {workflowSteps.map((step, index) => (
                <li key={step.title} className="relative flex gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <span className="font-mono-tabular flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0b1220] text-xs font-extrabold text-white">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[14px] font-extrabold text-slate-900">{t(step.title)}</h3>
                    <p className="mt-1 text-[12.5px] leading-7 text-slate-500">{t(step.text)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Security */}
        <section id="security" className="scroll-mt-20 bg-white py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl items-start gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_.85fr] lg:gap-14">
            <div>
              <p className="text-xs font-bold text-[#d95537]">{t('الأمان والحوكمة')}</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950 sm:text-[2.35rem]">
                {t('العزل والتدقيق ليست إعدادات اختيارية')}
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-7 text-slate-600">
                {t('في منصة تُدار فيها أموال وعهد، الحماية تُفرض في قاعدة البيانات والخادم، لا في الشاشة.')}
              </p>

              <div className="mt-7 grid gap-4 sm:grid-cols-2">
                {securityPoints.map(({icon: Icon, title, text}) => (
                  <article key={title} className="rounded-2xl border border-slate-200/80 p-4">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0b1220] text-white">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <h3 className="mt-3 text-[13.5px] font-extrabold text-slate-900">{t(title)}</h3>
                    <p className="mt-1.5 text-[12.5px] leading-6 text-slate-500">{t(text)}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_60px_-40px_rgba(15,23,42,.6)]">
              <div className="border-b border-slate-100 bg-slate-50/70 px-5 py-3">
                <p className="text-[13px] font-extrabold text-slate-900">{t('قبل وبعد المنصة')}</p>
              </div>
              <ul className="divide-y divide-slate-100">
                {comparison.map((row) => (
                  <li key={row.without} className="grid gap-3 px-5 py-3.5 sm:grid-cols-2">
                    <div className="flex items-start gap-2 text-[12.5px] leading-6 text-slate-400">
                      <X className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="line-through decoration-slate-300">{t(row.without)}</span>
                    </div>
                    <div className="flex items-start gap-2 text-[12.5px] leading-6 font-semibold text-slate-800">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                      <span>{t(row.with)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="scroll-mt-20 border-y border-slate-100 bg-[#fafbfc] py-16 sm:py-20">
          <div className="mx-auto max-w-4xl px-4 sm:px-6">
            <div className="max-w-2xl">
              <p className="text-xs font-bold text-[#d95537]">{t('أسئلة متكررة')}</p>
              <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-950">{t('قبل أن تبدأ')}</h2>
            </div>

            <div className="mt-8 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {faqs.map((item) => (
                <details key={item.q} className="group px-5 py-4 open:bg-slate-50/60">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[13.5px] font-extrabold text-slate-900">
                    {t(item.q)}
                    <ChevronDown
                      className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <p className="mt-2.5 text-[12.5px] leading-7 text-slate-600">{t(item.a)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Contact / CTA */}
        <section id="contact" className="scroll-mt-20 bg-white py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="relative overflow-hidden rounded-[26px] bg-[#0b1220] px-6 py-10 text-white sm:px-10 sm:py-12">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    'radial-gradient(720px 320px at 92% 10%, rgba(239,106,71,.4), transparent 65%), radial-gradient(520px 260px at 0% 100%, rgba(56,189,248,.18), transparent 60%)',
                }}
              />
              <div className="relative grid gap-8 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
                <div>
                  <p className="text-xs font-bold text-orange-200">{t('تواصل معنا')}</p>
                  <h2 className="mt-2 text-2xl font-extrabold leading-snug sm:text-[2rem]">
                    {t('جهّز شركتك للتشغيل على المنصة')}
                  </h2>
                  <p className="mt-3 max-w-xl text-[13.5px] leading-7 text-slate-300">
                    {t(
                      'أخبرنا بحجم عملياتك وعدد الفروع، ونوضح لك كيف تُهيَّأ المنصة على دورة عملك الحالية دون توقف.',
                    )}
                  </p>

                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <a
                      href="https://wa.me/201016987179"
                      target="_blank"
                      rel="noreferrer"
                      className="brand-gradient inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-lg hover:-translate-y-0.5"
                    >
                      <MessageCircle className="h-4 w-4" aria-hidden="true" />
                      {t('تواصل عبر واتساب')} · 01016987179
                    </a>
                    <a
                      href="mailto:shipflow.official@gmail.com"
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/[0.06] px-5 py-3 text-sm font-bold text-white hover:border-white/35"
                    >
                      <Mail className="h-4 w-4" aria-hidden="true" />
                      {t('البريد الإلكتروني')}
                    </a>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/15 bg-white/[0.05] p-5 backdrop-blur">
                  <p className="text-[13px] font-extrabold text-white">{t('جاهز للدخول الآن؟')}</p>
                  <p className="mt-1.5 text-[12px] leading-6 text-slate-300">
                    {t('بوابات الشركة والعميل والمندوب تعمل من نفس الحساب حسب دورك وصلاحياتك.')}
                  </p>
                  <Link
                    to={platformTarget}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-[13px] font-extrabold text-[#c04a2f] hover:-translate-y-0.5"
                  >
                    {t('الدخول إلى المنصة')}
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="brand-gradient flex h-8 w-8 items-center justify-center rounded-[9px] text-[11px] font-black text-white">
                SF
              </span>
              <span className="text-base font-extrabold text-slate-950">{BRAND_CONFIG.appName}</span>
            </div>
            <p className="mt-3 max-w-xs text-[12px] leading-6 text-slate-500">{t(BRAND_CONFIG.appTagline)}</p>
          </div>

          <div>
            <p className="text-[12px] font-extrabold text-slate-900">{t('البوابات')}</p>
            <ul className="mt-3 space-y-2 text-[12px] text-slate-500">
              {apps.slice(0, 4).map((app) => (
                <li key={app.name}>
                  <a href="#apps" className="hover:text-[#d95537]">
                    {t(app.name)}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[12px] font-extrabold text-slate-900">{t('المنصة')}</p>
            <ul className="mt-3 space-y-2 text-[12px] text-slate-500">
              <li>
                <a href="#features" className="hover:text-[#d95537]">
                  {t('الإمكانات')}
                </a>
              </li>
              <li>
                <a href="#workflow" className="hover:text-[#d95537]">
                  {t('دورة التشغيل')}
                </a>
              </li>
              <li>
                <a href="#security" className="hover:text-[#d95537]">
                  {t('الأمان والحوكمة')}
                </a>
              </li>
              <li>
                <a href="#faq" className="hover:text-[#d95537]">
                  {t('الأسئلة المتكررة')}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-[12px] font-extrabold text-slate-900">{t('تواصل')}</p>
            <ul className="mt-3 space-y-2 text-[12px] text-slate-500">
              <li>
                <a href="mailto:shipflow.official@gmail.com" className="hover:text-[#d95537]">
                  shipflow.official@gmail.com
                </a>
              </li>
              <li dir="ltr" className="text-right">
                <a href="tel:+201016987179" className="hover:text-[#d95537]">
                  +20 101 698 7179
                </a>
              </li>
              <li className="flex items-center gap-1.5">
                <Globe2 className="h-3.5 w-3.5" aria-hidden="true" />
                {t('عربي / English')}
              </li>
              <li className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                {t('شركات الشحن والتوصيل')}
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-slate-100">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span>
              © {new Date().getFullYear()} {BRAND_CONFIG.appName}. {t('جميع الحقوق محفوظة.')}
            </span>
            <span>{t('منصة متعددة الشركات لإدارة الشحن والتوصيل.')}</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
