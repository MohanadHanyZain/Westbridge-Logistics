import {useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {useTenantSlug} from '@/lib/tenant/TenantRuntimeContext';
import {BRAND_CONFIG, buildTenantBasePath} from '@/config/brand';
import * as tenantService from '@/features/tenants/tenantService';
import {EGYPTIAN_BANKS, type PayoutMethod} from '@/types/pricing';
import type {
  PublicStorefrontGov,
  PublicStorefrontRegion,
  PublicStorefrontService,
  PublicTenantInfo,
  SubmitClientRegistrationResult,
} from '@/types/tenant';
import {
  brandCssVars,
  fontStack,
  normalizePublicBranding,
  resolveSections,
} from '@/features/tenants/brandingService';
import type {PublicTenantBranding, StorefrontSectionId, StorefrontStats} from '@/types/tenantBranding';
import {
  CheckCircle2,
  Globe,
  LogIn,
  Mail,
  MapPin,
  PackageCheck,
  PackageSearch,
  Phone,
  Store,
} from 'lucide-react';

export function TenantPublicPage() {
  const companySlug = useTenantSlug();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<PublicTenantInfo | null>(null);
  const [services, setServices] = useState<readonly PublicStorefrontService[]>([]);
  const [governorates, setGovernorates] = useState<readonly PublicStorefrontGov[]>([]);
  const [regions, setRegions] = useState<readonly PublicStorefrontRegion[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackingCode, setTrackingCode] = useState('');
  const [trackingNotice, setTrackingNotice] = useState<string | null>(null);

  // Client Self-Registration Form State
  const [companyName, setCompanyName] = useState('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [mobile, setMobile] = useState('');
  const [governorateId, setGovernorateId] = useState('');
  const [regionId, setRegionId] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethod>('cash');
  const [bankName, setBankName] = useState<string>(EGYPTIAN_BANKS[0]);
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [walletPhone, setWalletPhone] = useState('');
  const [submittingReg, setSubmittingReg] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);
  const [regResult, setRegResult] = useState<SubmitClientRegistrationResult | null>(null);
  const [branding, setBranding] = useState<PublicTenantBranding>(() => normalizePublicBranding(null));
  const [stats, setStats] = useState<StorefrontStats | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const loadStorefront = async () => {
      try {
        if (
          Object.keys(tenantService).includes('fetchPublicTenantStorefront') &&
          typeof tenantService.fetchPublicTenantStorefront === 'function'
        ) {
          const payload = await tenantService.fetchPublicTenantStorefront(companySlug);
          if (!active) return;
          if (payload?.tenant) {
            setTenant(payload.tenant);
            setServices(payload.services ?? []);
            const govs = payload.governorates ?? [];
            const regs = payload.regions ?? [];
            setGovernorates(govs);
            setRegions(regs);
            setBranding(normalizePublicBranding(payload.branding ?? null));
            setStats(payload.stats ?? null);
            if (govs[0]) {
              setGovernorateId(govs[0].id);
              const firstReg = regs.find((r) => r.governorate_id === govs[0].id);
              setRegionId(firstReg?.id ?? '');
            }
            return;
          }
        }
        const basic = await tenantService.fetchPublicTenantBySlug(companySlug);
        if (active) {
          setTenant(basic);
          setServices([]);
          setGovernorates([]);
          setRegions([]);
          setBranding(normalizePublicBranding(null));
          setStats(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadStorefront();

    return () => {
      active = false;
    };
  }, [companySlug]);

  const filteredRegions = useMemo(
    () => (governorateId ? regions.filter((r) => r.governorate_id === governorateId) : regions),
    [regions, governorateId],
  );

  const basePath = buildTenantBasePath(companySlug);

  const sectionList = useMemo(() => resolveSections(branding), [branding]);
  const orderOf = (id: StorefrontSectionId) => sectionList.find((item) => item.id === id)?.order ?? 99;
  const isVisible = (id: StorefrontSectionId) =>
    sectionList.some((item) => item.id === id && item.visible);
  const sectionText = (id: StorefrontSectionId) =>
    sectionList.find((item) => item.id === id)?.text?.trim() ?? '';
  const themeVars = useMemo(() => brandCssVars(branding), [branding]);
  const surfaceFont = fontStack(branding.font_family);
  const isDarkSurface = branding.theme_mode === 'dark';

  const handleRegistrationSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (
      !tenant ||
      !Object.keys(tenantService).includes('submitClientRegistrationRequest') ||
      typeof tenantService.submitClientRegistrationRequest !== 'function'
    ) {
      return;
    }
    setRegError(null);
    setRegResult(null);
    setSubmittingReg(true);
    try {
      const res = await tenantService.submitClientRegistrationRequest(tenant.slug, {
        company_name: companyName,
        contact_name: contactName || undefined,
        email,
        phone,
        mobile: mobile || phone,
        governorate_id: governorateId,
        region_id: regionId,
        address_line: addressLine,
        payout_method: payoutMethod,
        bank_name: payoutMethod === 'bank_transfer' ? bankName : undefined,
        bank_account_number: payoutMethod === 'bank_transfer' ? bankAccountNumber : undefined,
        wallet_phone: payoutMethod === 'vodafone_cash' ? walletPhone : undefined,
      });
      setRegResult(res);
      setCompanyName('');
      setContactName('');
      setEmail('');
      setPhone('');
      setMobile('');
      setAddressLine('');
      setBankAccountNumber('');
      setWalletPhone('');
    } catch (err) {
      setRegError(err instanceof Error ? err.message : 'تعذر إرسال طلب التسجيل.');
    } finally {
      setSubmittingReg(false);
    }
  };

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
    <div
      data-tenant-surface
      dir="rtl"
      style={{...themeVars, fontFamily: surfaceFont}}
      className={
        isDarkSurface
          ? 'min-h-screen bg-slate-950 text-slate-100'
          : 'min-h-screen bg-slate-50 text-slate-900'
      }
    >
      <header
        className="border-b bg-white"
        style={{borderBottomColor: branding.primary_color}}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-6 py-4">
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-lg font-bold text-slate-900 whitespace-nowrap">{tenant.name}</span>
          </div>

          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            <a href="#tracking" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              تتبع الشحنة
            </a>
            <a href="#services" className="hover:text-slate-900 whitespace-nowrap shrink-0">
              الخدمات والتغطية
            </a>
            {isVisible('registration') && tenant.allow_client_self_registration && (
              <a href="#merchant-registration" className="hover:text-slate-900 whitespace-nowrap shrink-0">
                سجّل كتاجر
              </a>
            )}
          </nav>

          <Link
            to={`${basePath}/login`}
            className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium hover:bg-slate-800 whitespace-nowrap shrink-0"
            style={{backgroundColor: branding.primary_color, color: 'var(--tenant-brand-contrast)'}}
          >
            <LogIn className="h-3.5 w-3.5" />
            تسجيل الدخول
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col space-y-10 px-6 py-10">
        {/* Hero */}
        {isVisible('hero') && (
          <section
            id="hero"
            style={{
              order: orderOf('hero'),
              backgroundImage: branding.hero_image_path
                ? 'url(' + branding.hero_image_path + ')'
                : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
            className="rounded-xl border border-slate-200 bg-white p-8"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-xs font-medium text-slate-500">
                الموقع العام للشركة · {BRAND_CONFIG.appName}
              </p>
              {branding.logo_path && (
                <img
                  src={branding.logo_path}
                  alt={'شعار ' + tenant.name}
                  className="h-10 w-auto"
                />
              )}
            </div>

            <h1 className="mt-2 text-2xl font-bold" style={{color: branding.secondary_color}}>
              {branding.hero_title?.trim() || 'مرحبًا بكم في ' + tenant.name}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
              {branding.hero_subtitle?.trim() ||
                tenant.public_tagline?.trim() ||
                'بوابة التتبع العام وخدمات الشحن والتوصيل الخاصة بالشركة. يمكن للتجار الجدد التقديم إلكترونيًا، ويمكن للمستخدمين المسجلين الدخول إلى لوحة المتابعة والعمليات.'}
            </p>
          </section>
        )}

        {/* Instant public tracking */}
        {isVisible('tracking') && (
          <section
            id="tracking"
            style={{order: orderOf('tracking')}}
            className="rounded-xl border border-slate-200 bg-white p-8"
          >
            <h2 className="text-base font-bold text-slate-900">تتبع الشحنة</h2>
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
              className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center"
            >
              <div className="relative flex-1 max-w-md">
                <PackageSearch className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={trackingCode}
                  onChange={(e) => setTrackingCode(e.target.value)}
                  placeholder="أدخل رقم الشحنة أو البوليصة أو رمز التتبع..."
                  aria-label="رقم الشحنة للتتبع"
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="rounded-lg px-5 py-2 text-sm font-medium whitespace-nowrap"
                style={{
                  backgroundColor: branding.primary_color,
                  color: 'var(--tenant-brand-contrast)',
                }}
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
        )}

        {/* Contact */}
        {isVisible('contact') && (tenant.public_support_phone || tenant.public_support_email) && (
          <section
            id="contact"
            style={{order: orderOf('contact')}}
            className="rounded-xl border border-slate-200 bg-white p-5"
          >
            <h2 className="text-sm font-semibold text-slate-900">بيانات التواصل</h2>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-600">
              {tenant.public_support_phone && (
                <span className="inline-flex items-center gap-1.5 font-mono-tabular">
                  <Phone className="h-3.5 w-3.5 text-slate-400" />
                  {tenant.public_support_phone}
                </span>
              )}
              {tenant.public_support_email && (
                <span className="inline-flex items-center gap-1.5 font-mono-tabular" dir="ltr">
                  <Mail className="h-3.5 w-3.5 text-slate-400" />
                  {tenant.public_support_email}
                </span>
              )}
            </div>
          </section>
        )}

        {/* Overview KPIs & Access Cards */}
        {isVisible('stats') && (
        <section
          id="stats"
          style={{order: orderOf('stats')}}
          className="grid grid-cols-1 gap-4 md:grid-cols-3"
        >
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">التوقيت والعملة المعتمدة</h2>
            <p className="mt-2 font-mono-tabular text-sm text-slate-700">
              {tenant.default_currency} · {tenant.default_timezone}
            </p>
            {stats && (
              <p className="mt-1 text-xs text-slate-500">
                {stats.services_count} خدمة · {stats.governorates_count} محافظة ·{' '}
                {stats.regions_count} منطقة
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">تسجيل التجار الجدد</h2>
            <p className="mt-2 text-sm text-slate-600">
              {tenant.allow_client_self_registration
                ? tenant.auto_approve_clients
                  ? 'التسجيل الذاتي مفعّل مع تفعيل تلقائي فوري لملف التاجر.'
                  : 'التسجيل الذاتي للتجار مفعّل من إدارة الشركة عبر النموذج أدناه.'
                : 'تسجيل التجار يتم عبر إدارة الشركة حاليًا.'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">دخول التاجر والموظفين</h2>
            <Link
              to={`${basePath}/login`}
              className="mt-2 inline-block text-sm font-medium text-slate-900 underline underline-offset-4"
            >
              الانتقال إلى صفحة تسجيل الدخول
            </Link>
          </div>
        </section>
        )}

        {/* Live Shipping Services & Geographic Coverage */}
        {(isVisible('services') || isVisible('coverage')) &&
          (services.length > 0 || governorates.length > 0) && (
          <section
            style={{
              order: Math.min(
                isVisible('services') ? orderOf('services') : 99,
                isVisible('coverage') ? orderOf('coverage') : 99,
              ),
            }}
            className="grid grid-cols-1 gap-6 lg:grid-cols-2"
          >
            {isVisible('services') && services.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex items-center gap-2">
                  <PackageCheck className="h-4 w-4 text-slate-700" />
                  <h2 className="text-base font-bold text-slate-900">خدمات الشحن والتوصيل المتاحة</h2>
                </div>
                <div className="mt-4 divide-y divide-slate-100">
                  {services.map((srv) => (
                    <div key={srv.id} className="flex items-center justify-between py-3 text-sm">
                      <div>
                        <p className="font-semibold text-slate-900">{srv.name}</p>
                        <p className="font-mono-tabular text-xs text-slate-500">{srv.code}</p>
                      </div>
                      <span className="font-mono-tabular text-xs font-medium text-slate-700">
                        {srv.estimated_days_min}–{srv.estimated_days_max} أيام عمل
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isVisible('coverage') && governorates.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-6">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-slate-700" />
                    <h2 className="text-base font-bold text-slate-900">نطاق التغطية الجغرافية</h2>
                  </div>
                  <span className="font-mono-tabular text-xs font-semibold text-slate-600">
                    {governorates.length} محافظة · {regions.length} منطقة
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  {governorates.slice(0, 18).map((gov) => (
                    <div
                      key={gov.id}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-slate-700"
                    >
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <span className="truncate">{gov.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {/* Self-Registration Form (When Enabled) */}
        {tenant.allow_client_self_registration && (
          <section
            id="merchant-registration"
            style={{order: orderOf('registration')}}
            className="rounded-xl border border-slate-200 bg-white p-6 md:p-8"
          >
            <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
              <Store className="h-5 w-5 text-slate-900" />
              <div>
                <h2 className="text-lg font-bold text-slate-900">التسجيل الذاتي للتجار والمتاجر</h2>
                <p className="mt-0.5 text-xs text-slate-600">
                  سجّل بيانات متجرك ومقر الالتقاط ووسيلة استلام مستحقاتك للانضمام إلى شبكة {tenant.name}.
                </p>
              </div>
            </div>

            {regResult && (
              <div
                role="status"
                className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
              >
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                <div>
                  <p className="font-semibold">
                    {regResult.auto_approved
                      ? `تم قبول وتفعيل ملف التاجر تلقائيًا بكود (${regResult.client_code ?? '—'}).`
                      : 'تم استلام طلب التسجيل بنجاح وهو قيد المراجعة من إدارة الشركة.'}
                  </p>
                  <p className="mt-1 text-xs text-emerald-800">
                    {regResult.auto_approved
                      ? 'سيقوم فريق الشركة بإصدار اسم المستخدم وكلمة المرور للدخول إلى بوابة التاجر على البريد المسجل.'
                      : 'ستقوم الإدارة بمراجعة الطلب واعتماد ملف المتجر وإبلاغك ببيانات الدخول لبوابة العميل.'}
                  </p>
                </div>
              </div>
            )}

            {regError && (
              <div
                role="alert"
                className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800"
              >
                {regError}
              </div>
            )}

            <form onSubmit={handleRegistrationSubmit} className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label htmlFor="reg-company" className="block text-xs font-medium text-slate-700">
                  اسم المتجر / النشاط *
                </label>
                <input
                  id="reg-company"
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="reg-contact" className="block text-xs font-medium text-slate-700">
                  اسم المسؤول
                </label>
                <input
                  id="reg-contact"
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="reg-email" className="block text-xs font-medium text-slate-700">
                  البريد الإلكتروني *
                </label>
                <input
                  id="reg-email"
                  type="email"
                  required
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="reg-phone" className="block text-xs font-medium text-slate-700">
                  رقم الهاتف / الموبايل *
                </label>
                <input
                  id="reg-phone"
                  type="text"
                  required
                  dir="ltr"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="reg-mobile" className="block text-xs font-medium text-slate-700">
                  رقم موبايل إضافي (اختياري)
                </label>
                <input
                  id="reg-mobile"
                  type="text"
                  dir="ltr"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="reg-gov" className="block text-xs font-medium text-slate-700">
                  المحافظة *
                </label>
                <select
                  id="reg-gov"
                  required
                  value={governorateId}
                  onChange={(e) => {
                    const nextGov = e.target.value;
                    setGovernorateId(nextGov);
                    const firstReg = regions.find((r) => r.governorate_id === nextGov);
                    setRegionId(firstReg?.id ?? '');
                  }}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                >
                  {governorates.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="reg-region" className="block text-xs font-medium text-slate-700">
                  المنطقة *
                </label>
                <select
                  id="reg-region"
                  required
                  value={regionId}
                  onChange={(e) => setRegionId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                >
                  {filteredRegions.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="reg-address" className="block text-xs font-medium text-slate-700">
                  عنوان الالتقاط بالتفصيل *
                </label>
                <input
                  id="reg-address"
                  type="text"
                  required
                  value={addressLine}
                  onChange={(e) => setAddressLine(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="reg-payout" className="block text-xs font-medium text-slate-700">
                  طريقة استلام المستحقات *
                </label>
                <select
                  id="reg-payout"
                  value={payoutMethod}
                  onChange={(e) => setPayoutMethod(e.target.value as PayoutMethod)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                >
                  <option value="cash">نقدي</option>
                  <option value="bank_transfer">تحويل بنكي</option>
                  <option value="vodafone_cash">فودافون كاش</option>
                </select>
              </div>

              {payoutMethod === 'bank_transfer' && (
                <>
                  <div>
                    <label htmlFor="reg-bank" className="block text-xs font-medium text-slate-700">
                      اسم البنك *
                    </label>
                    <select
                      id="reg-bank"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      {EGYPTIAN_BANKS.map((bank) => (
                        <option key={bank} value={bank}>
                          {bank}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="reg-iban" className="block text-xs font-medium text-slate-700">
                      رقم الحساب / IBAN *
                    </label>
                    <input
                      id="reg-iban"
                      type="text"
                      required
                      dir="ltr"
                      value={bankAccountNumber}
                      onChange={(e) => setBankAccountNumber(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
                    />
                  </div>
                </>
              )}

              {payoutMethod === 'vodafone_cash' && (
                <div>
                  <label htmlFor="reg-wallet" className="block text-xs font-medium text-slate-700">
                    رقم محفظة فودافون كاش *
                  </label>
                  <input
                    id="reg-wallet"
                    type="text"
                    required
                    dir="ltr"
                    value={walletPhone}
                    onChange={(e) => setWalletPhone(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm"
                  />
                </div>
              )}

              <div className="sm:col-span-2 lg:col-span-3 pt-2">
                <button
                  type="submit"
                  disabled={submittingReg || governorates.length === 0}
                  className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {submittingReg ? 'جاري إرسال الطلب...' : 'إرسال طلب تسجيل التاجر'}
                </button>
              </div>
            </form>
          </section>
        )}
        {isVisible('about') && sectionText('about') && (
          <section
            id="about"
            style={{order: orderOf('about')}}
            className="rounded-xl border border-slate-200 bg-white p-6"
          >
            <h2 className="text-base font-bold text-slate-900">عن {tenant.name}</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">
              {sectionText('about')}
            </p>
          </section>
        )}

        {isVisible('faq') && sectionText('faq') && (
          <section
            id="faq"
            style={{order: orderOf('faq')}}
            className="rounded-xl border border-slate-200 bg-white p-6"
          >
            <h2 className="text-base font-bold text-slate-900">الأسئلة الشائعة</h2>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              {sectionText('faq')
                .split('\n')
                .filter((line) => line.trim().length > 0)
                .map((line) => (
                  <li
                    key={line}
                    className="border-s-2 ps-3"
                    style={{borderColor: branding.accent_color}}
                  >
                    {line}
                  </li>
                ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}