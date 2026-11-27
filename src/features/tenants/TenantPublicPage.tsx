import {LoadingState} from '@/components/ui/LoadingState';
import {useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link, useNavigate} from 'react-router-dom';
import {useTenantSlug} from '@/lib/tenant/TenantRuntimeContext';
import {buildTenantBasePath} from '@/config/brand';
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
import type {
  StorefrontFeature,
  StorefrontSectionId,
  PublicTenantBranding,
  StorefrontSocialLink,
  StorefrontLocale,
  StorefrontPricingRow,
} from '@/types/tenantBranding';
import {
  CheckCircle2,
  Facebook,
  Globe,
  Instagram,
  Linkedin,
  LogIn,
  Mail,
  MapPin,
  Menu,
  PackageCheck,
  PackageSearch,
  Phone,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Music2,
  ShieldCheck,
  Star,
  Twitter,
  Truck,
  Wallet,
  Youtube,
  X,
} from 'lucide-react';

function featureIcon(feature: StorefrontFeature) {
  if (feature.icon_key === 'wallet') return Wallet;
  if (feature.icon_key === 'shield') return ShieldCheck;
  if (feature.icon_key === 'map') return MapPin;
  if (feature.icon_key === 'support') return Phone;
  if (feature.icon_key === 'package') return PackageCheck;
  return Truck;
}

function socialIcon(platform: StorefrontSocialLink['platform']) {
  if (platform === 'facebook') return Facebook;
  if (platform === 'instagram') return Instagram;
  if (platform === 'linkedin') return Linkedin;
  if (platform === 'youtube') return Youtube;
  if (platform === 'twitter') return Twitter;
  if (platform === 'tiktok') return Music2;
  if (platform === 'whatsapp') return MessageCircle;
  return Globe;
}

export function TenantPublicPage() {
  const companySlug = useTenantSlug();
  const navigate = useNavigate();
  const [tenant, setTenant] = useState<PublicTenantInfo | null>(null);
  const [services, setServices] = useState<readonly PublicStorefrontService[]>([]);
  const [governorates, setGovernorates] = useState<readonly PublicStorefrontGov[]>([]);
  const [regions, setRegions] = useState<readonly PublicStorefrontRegion[]>([]);
  const [branding, setBranding] = useState<PublicTenantBranding>(() => normalizePublicBranding(null));
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [locale, setLocale] = useState<StorefrontLocale>('ar');
  const [trackingCode, setTrackingCode] = useState('');
  const [trackingNotice, setTrackingNotice] = useState<string | null>(null);
  const [testimonialOffset, setTestimonialOffset] = useState(0);

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

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        let payload: Awaited<ReturnType<typeof tenantService.fetchPublicTenantStorefront>> = null;
        try {
          payload = await tenantService.fetchPublicTenantStorefront(companySlug);
        } catch {
          payload = null;
        }
        if (!active) return;
        if (payload?.tenant) {
          setTenant(payload.tenant);
          setServices(payload.services ?? []);
          setGovernorates(payload.governorates ?? []);
          setRegions(payload.regions ?? []);
          const normalized = normalizePublicBranding(payload.branding ?? null);
          setBranding(normalized);
          const saved = localStorage.getItem(`storefront_locale_${companySlug}`);
          setLocale(saved === 'en' ? 'en' : saved === 'ar' ? 'ar' : normalized.storefront_config.default_locale);
          if ((payload.governorates ?? []).length > 0) {
            const firstGov = payload.governorates[0];
            setGovernorateId(firstGov.id);
            const firstRegion = (payload.regions ?? []).find((region) => region.governorate_id === firstGov.id);
            setRegionId(firstRegion?.id ?? '');
          }
          return;
        }
        const basic = typeof tenantService.fetchPublicTenantBySlug === 'function'
          ? await tenantService.fetchPublicTenantBySlug(companySlug)
          : null;
        if (!active) return;
        setTenant(basic);
        setServices([]);
        setGovernorates([]);
        setRegions([]);
        const normalized = normalizePublicBranding(null);
        setBranding(normalized);
        const saved = localStorage.getItem(`storefront_locale_${companySlug}`);
        setLocale(saved === 'en' ? 'en' : saved === 'ar' ? 'ar' : normalized.storefront_config.default_locale);
      } catch {
        if (active) setTenant(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [companySlug]);

  useEffect(() => {
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    if (branding.storefront_config.content_animation === 'none') return;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-storefront-reveal]'));
    if (!('IntersectionObserver' in window) || nodes.length === 0) {
      nodes.forEach((node) => node.classList.add('is-visible'));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      {threshold: 0.12},
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [branding, locale]);

  const filteredRegions = useMemo(
    () => governorateId ? regions.filter((region) => region.governorate_id === governorateId) : regions,
    [regions, governorateId],
  );

  const basePath = buildTenantBasePath(companySlug);
  const config = branding.storefront_config;
  const sectionList = useMemo(() => resolveSections(branding), [branding]);
  const isVisible = (id: StorefrontSectionId) =>
    sectionList.some((section) => section.id === id && section.visible);
  const sectionText = (id: StorefrontSectionId) =>
    sectionList.find((section) => section.id === id)?.text?.trim() ?? '';
  const themeVars = useMemo(() => brandCssVars(branding), [branding]);
  const text = (ar: string, en: string) => locale === 'ar' ? ar : en;

  const changeLocale = (nextLocale: StorefrontLocale) => {
    setLocale(nextLocale);
    localStorage.setItem(`storefront_locale_${companySlug}`, nextLocale);
  };

  const handleTrack = (event: FormEvent) => {
    event.preventDefault();
    const cleaned = trackingCode.trim();
    if (!cleaned) {
      setTrackingNotice(text('يرجى إدخال رقم الشحنة أولًا.', 'Enter a shipment number first.'));
      return;
    }
    navigate(`${basePath}/track/${encodeURIComponent(cleaned)}`);
  };

  const handleRegistration = async (event: FormEvent) => {
    event.preventDefault();
    if (!tenant) return;
    setRegError(null);
    setRegResult(null);
    setSubmittingReg(true);
    try {
      const result = await tenantService.submitClientRegistrationRequest(tenant.slug, {
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
      setRegResult(result);
      setCompanyName('');
      setContactName('');
      setEmail('');
      setPhone('');
      setMobile('');
      setAddressLine('');
      setBankAccountNumber('');
      setWalletPhone('');
    } catch (error) {
      setRegError(error instanceof Error ? error.message : text('تعذر إرسال الطلب.', 'Unable to submit the request.'));
    } finally {
      setSubmittingReg(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-sm text-slate-600">
        <LoadingState label={text('جارٍ تحميل موقع الشركة', 'Loading company website')} />
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6">
          <h1 className="text-lg font-bold text-slate-900">{text('الشركة غير متاحة', 'Company unavailable')}</h1>
          <p className="mt-2 text-sm leading-7 text-slate-600">
            {text('تعذر العثور على شركة نشطة بالعنوان المطلوب.', 'No active company was found for this address.')}
          </p>
          <Link to="/" className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white">
            {text('العودة للرئيسية', 'Back to home')}
          </Link>
        </div>
      </div>
    );
  }

  const heroTitle =
    text(config.hero_title_ar, config.hero_title_en) ||
    text(branding.hero_title ?? '', branding.hero_title ?? '') ||
    text(`مرحبًا بكم في ${tenant.name}`, `Welcome to ${tenant.name}`);
  const heroSubtitle =
    text(config.hero_subtitle_ar, config.hero_subtitle_en) ||
    branding.hero_subtitle ||
    tenant.public_tagline ||
    text('حلول شحن موثوقة وتتبع واضح من الاستلام حتى التسليم.', 'Reliable shipping and clear tracking from pickup to delivery.');

  return (
    <div
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      lang={locale}
      style={{...themeVars, fontFamily: fontStack(branding.font_family)}}
      className="min-h-screen bg-white text-slate-900"
    >
      <header
        className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur"
        style={{boxShadow: `0 8px 28px ${config.header_shadow_color}${Math.round(config.header_shadow_opacity * 255).toString(16).padStart(2, '0')}`}}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to={basePath || '/'} className="flex min-w-0 items-center gap-3">
            {branding.logo_path ? (
              <img src={branding.logo_path} alt={tenant.name} className="h-9 max-w-36 w-auto object-contain" />
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-black" style={{backgroundColor: branding.primary_color, color: 'var(--tenant-brand-contrast)'}}>
                {tenant.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="truncate text-sm font-extrabold sm:text-base">{tenant.name}</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label={text('القائمة الرئيسية', 'Main navigation')}>
            {config.nav_links.filter((link) => link.visible).map((link) => (
              <a key={link.id} href={link.url} className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-950">
                {text(link.label_ar, link.label_en)}
              </a>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => changeLocale(locale === 'ar' ? 'en' : 'ar')}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700"
              aria-label={locale === 'ar' ? 'Switch to English' : 'التبديل للعربية'}
            >
              <span aria-hidden="true">{locale === 'ar' ? '🇺🇸' : '🇪🇬'}</span>
              <span>{locale === 'ar' ? 'EN' : 'AR'}</span>
            </button>
            <Link
              to={`${basePath}/login`}
              className="hidden items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold sm:inline-flex"
              style={{backgroundColor: branding.primary_color, color: 'var(--tenant-brand-contrast)'}}
            >
              <LogIn className="h-3.5 w-3.5" />
              {text(config.header_login_label_ar, config.header_login_label_en)}
            </Link>
            <button type="button" onClick={() => setMenuOpen((open) => !open)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 md:hidden" aria-label={text('القائمة', 'Menu')}>
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>
        {menuOpen && (
          <nav className="border-t border-slate-100 bg-white px-4 py-3 md:hidden">
            <div className="mx-auto grid max-w-7xl gap-1">
              {config.nav_links.filter((link) => link.visible).map((link) => (
                <a key={link.id} href={link.url} onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  {text(link.label_ar, link.label_en)}
                </a>
              ))}
              <Link to={`${basePath}/login`} className="mt-1 rounded-lg px-3 py-2.5 text-sm font-bold" style={{color: branding.primary_color}}>
                {text(config.header_login_label_ar, config.header_login_label_en)}
              </Link>
            </div>
          </nav>
        )}
      </header>

      <main
        className={`flex flex-col storefront-spacing-${config.section_spacing} storefront-animation-${config.content_animation}`}
      >
        {isVisible('hero') && (
          <section
            id="hero"
            data-storefront-reveal
            style={{order: 10}}
            className={config.hero_layout === 'background'
              ? 'relative isolate overflow-hidden'
              : 'border-b border-slate-100 bg-slate-50'}
          >
            {config.hero_layout === 'background' ? (
              <div
                className="relative min-h-[520px]"
                style={{
                  backgroundColor: config.hero_overlay_color,
                  minHeight: config.hero_height === 'large' ? 520 : 420,
                  backgroundImage: branding.hero_image_path
                    ? `linear-gradient(rgba(11,18,32,${config.hero_overlay_opacity}),rgba(11,18,32,${config.hero_overlay_opacity})), url(${branding.hero_image_path})`
                    : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                <div
                  className={`mx-auto flex max-w-7xl items-center px-4 py-16 text-white sm:px-6 ${config.hero_text_align === 'center' ? 'justify-center' : ''}`}
                  style={{minHeight: config.hero_height === 'large' ? 520 : 420}}
                >
                  <div className={config.hero_text_align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
                    <p className="text-xs font-bold" style={{color: branding.accent_color}}>
                      {tenant.name}
                    </p>
                    <h1 className="mt-4 text-4xl font-extrabold leading-[1.15] sm:text-5xl lg:text-6xl">{heroTitle}</h1>
                    <p className="mt-5 max-w-xl text-base leading-8 text-white/85 sm:text-lg">{heroSubtitle}</p>
                    <div className="mt-8 flex flex-wrap gap-3">
                      <a href="#tracking" className="inline-flex rounded-lg px-5 py-3 text-sm font-bold" style={{backgroundColor: branding.primary_color, color: 'var(--tenant-brand-contrast)'}}>
                        {text(config.tracking_button_ar, config.tracking_button_en)}
                      </a>
                      {config.cta_primary.visible && (
                        <a href={config.cta_primary.button_url || '#contact'} className="inline-flex rounded-lg border border-white/30 bg-white/10 px-5 py-3 text-sm font-bold text-white">
                          {text(config.cta_primary.button_label_ar, config.cta_primary.button_label_en)}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 lg:min-h-[520px] lg:grid-cols-2 lg:py-16">
                <div className={config.hero_layout === 'split-left' ? 'lg:order-2' : ''}>
                  <p className="text-xs font-bold" style={{color: branding.accent_color}}>{tenant.name}</p>
                  <h1 className="mt-4 text-4xl font-extrabold leading-[1.15] sm:text-5xl" style={{color: branding.secondary_color}}>{heroTitle}</h1>
                  <p className="mt-5 max-w-xl text-base leading-8 text-slate-600">{heroSubtitle}</p>
                  <div className="mt-8 flex flex-wrap gap-3">
                    <a href="#tracking" className="inline-flex rounded-lg px-5 py-3 text-sm font-bold" style={{backgroundColor: branding.primary_color, color: 'var(--tenant-brand-contrast)'}}>
                      {text(config.tracking_button_ar, config.tracking_button_en)}
                    </a>
                  </div>
                </div>
                {branding.hero_image_path ? (
                  <img src={branding.hero_image_path} alt="" className={`h-72 w-full rounded-2xl object-cover shadow-[0_24px_55px_-35px_${config.hero_shadow_color}] sm:h-96 ${config.hero_layout === 'split-left' ? 'lg:order-1' : ''}`} />
                ) : (
                  <div className={`flex h-72 items-center justify-center rounded-2xl border border-slate-200 bg-white sm:h-96 ${config.hero_layout === 'split-left' ? 'lg:order-1' : ''}`}>
                    <Truck className="h-16 w-16" style={{color: branding.accent_color}} />
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {config.features_visible && config.features.some((feature) => feature.visible) && (
          <section id="features" data-storefront-reveal style={{order: 40}} className="border-b border-slate-100 bg-white py-16 sm:py-20">
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <p className="text-xs font-bold" style={{color: branding.primary_color}}>
                {text('لماذا نحن', 'Why choose us')}
              </p>
              <h2 className="mt-2 text-3xl font-extrabold" style={{color: branding.secondary_color}}>
                {text('مميزات تشغيل واضحة', 'Clear operational advantages')}
              </h2>
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {config.features.filter((feature) => feature.visible).map((feature) => {
                  const Icon = featureIcon(feature);
                  return (
                    <article
                      key={feature.id}
                      className={`storefront-card-${config.card_style} storefront-radius-${config.surface_radius} p-5`}
                    >
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg" style={{backgroundColor: branding.primary_color, color: 'var(--tenant-brand-contrast)'}}>
                        <Icon className="h-5 w-5" />
                      </span>
                      <h3 className="mt-4 text-base font-extrabold text-slate-900">{text(feature.title_ar, feature.title_en)}</h3>
                      <p className="mt-2 text-sm leading-7 text-slate-600">{text(feature.text_ar, feature.text_en)}</p>
                    </article>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {config.testimonials_visible && config.testimonials.some((testimonial) => testimonial.visible) && (
          <section
            id="testimonials"
            data-storefront-reveal
            style={{order: 50}}
            className="border-b border-slate-100 bg-slate-50 py-16 sm:py-20"
          >
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-bold" style={{color: branding.primary_color}}>
                    {text('آراء العملاء', 'Customer reviews')}
                  </p>
                  <h2 className="mt-2 text-3xl font-extrabold" style={{color: branding.secondary_color}}>
                    {text('قصص ثقة وتجارب عملاء', 'Trust and customer experiences')}
                  </h2>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    aria-label={text('آراء سابقة', 'Previous testimonials')}
                    onClick={() => setTestimonialOffset((current) => Math.max(0, current - 3))}
                    className="storefront-carousel-button"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={text('آراء التالية', 'Next testimonials')}
                    onClick={() => setTestimonialOffset((current) =>
                      Math.min(
                        Math.max(0, config.testimonials.filter((item) => item.visible).length - 3),
                        current + 3,
                      ),
                    )}
                    className="storefront-carousel-button"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {config.testimonials
                  .filter((testimonial) => testimonial.visible)
                  .slice(testimonialOffset, testimonialOffset + 3)
                  .map((testimonial) => (
                    <article
                      key={testimonial.id}
                      className={`storefront-card-${config.card_style} storefront-radius-${config.surface_radius} bg-white p-5`}
                    >
                      <div className="flex gap-1" aria-label={`${testimonial.rating} / 5`}>
                        {Array.from({length: 5}).map((_, index) => (
                          <Star
                            key={index}
                            className={`h-4 w-4 ${index < testimonial.rating ? 'fill-current' : ''}`}
                            style={{color: branding.accent_color}}
                          />
                        ))}
                      </div>
                      <blockquote className="mt-4 text-sm leading-7 text-slate-700">
                        “{text(testimonial.quote_ar, testimonial.quote_en)}”
                      </blockquote>
                      <div className="mt-5 flex items-center gap-3">
                        {testimonial.avatar_path ? (
                          <img src={testimonial.avatar_path} alt="" className="h-10 w-10 rounded-full object-cover" />
                        ) : (
                          <span
                            className="flex h-10 w-10 items-center justify-center rounded-full text-xs font-black"
                            style={{backgroundColor: branding.primary_color, color: 'var(--tenant-brand-contrast)'}}
                          >
                            {(locale === 'ar' ? testimonial.name_ar : testimonial.name_en).slice(0, 1)}
                          </span>
                        )}
                        <div>
                          <p className="text-xs font-bold text-slate-900">{text(testimonial.name_ar, testimonial.name_en)}</p>
                          <p className="mt-0.5 text-[11px] text-slate-500">{text(testimonial.role_ar, testimonial.role_en)}</p>
                        </div>
                      </div>
                    </article>
                  ))}
              </div>
            </div>
          </section>
        )}

        {config.faq_visible && config.faq_items.some((item) => item.visible) && (
          <section
            id="faq"
            data-storefront-reveal
            style={{order: 60}}
            className="border-b border-slate-100 bg-white py-16 sm:py-20"
          >
            <div className="mx-auto max-w-4xl px-4 sm:px-6">
              <p className="text-xs font-bold" style={{color: branding.primary_color}}>
                {text('الأسئلة الشائعة', 'Frequently asked questions')}
              </p>
              <h2 className="mt-2 text-3xl font-extrabold" style={{color: branding.secondary_color}}>
                {text('إجابات مختصرة قبل أن تبدأ', 'Quick answers before you start')}
              </h2>
              <div className="mt-7 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
                {config.faq_items.filter((item) => item.visible).map((item) => (
                  <details key={item.id} className="group px-5 py-4 open:bg-slate-50">
                    <summary className="cursor-pointer list-none text-sm font-bold text-slate-900">
                      {text(item.question_ar, item.question_en)}
                    </summary>
                    <p className="mt-3 text-sm leading-7 text-slate-600">
                      {text(item.answer_ar, item.answer_en)}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          </section>
        )}

        {config.cta_primary.visible && (
          <section id="cta-primary" data-storefront-reveal style={{order: 70}} className="bg-white py-12 sm:py-16">
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <div className="grid items-center gap-8 rounded-2xl border border-slate-200 bg-slate-50 p-6 sm:p-8 lg:grid-cols-2">
                <div className={config.cta_primary.image_side === 'left' ? 'lg:order-2' : ''}>
                  <h2 className="text-3xl font-extrabold" style={{color: branding.secondary_color}}>
                    {text(config.cta_primary.title_ar, config.cta_primary.title_en)}
                  </h2>
                  <p className="mt-3 max-w-xl text-sm leading-7 text-slate-600">
                    {text(config.cta_primary.text_ar, config.cta_primary.text_en)}
                  </p>
                  <a href={config.cta_primary.button_url || '#tracking'} className="mt-5 inline-flex rounded-lg px-5 py-3 text-sm font-bold" style={{backgroundColor: branding.primary_color, color: 'var(--tenant-brand-contrast)'}}>
                    {text(config.cta_primary.button_label_ar, config.cta_primary.button_label_en)}
                  </a>
                </div>
                {config.cta_primary.image_path ? (
                  <img src={config.cta_primary.image_path} alt="" className={`h-64 w-full rounded-xl object-cover sm:h-72 ${config.cta_primary.image_side === 'left' ? 'lg:order-1' : ''}`} />
                ) : (
                  <div className={`flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-white sm:h-72 ${config.cta_primary.image_side === 'left' ? 'lg:order-1' : ''}`}>
                    <Truck className="h-16 w-16" style={{color: branding.accent_color}} />
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {config.pricing_visible && (
          <section id="services-pricing" data-storefront-reveal style={{order: 35}} className="border-y border-slate-100 bg-slate-50 py-16 sm:py-20">
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <p className="text-xs font-bold" style={{color: branding.primary_color}}>{text('الخدمات والأسعار', 'Services & pricing')}</p>
              <h2 className="mt-2 text-3xl font-extrabold" style={{color: branding.secondary_color}}>{text('أسعار الشحن حسب المحافظة', 'Shipping rates by governorate')}</h2>
              {config.pricing.filter((row) => row.visible).length > 0 ? (
                <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {config.pricing.filter((row: StorefrontPricingRow) => row.visible).map((row) => (
                    <article key={row.id} className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-sm font-extrabold text-slate-900">{text(row.governorate_name_ar, row.governorate_name_en)}</p>
                      <p className="mt-4 text-2xl font-extrabold" style={{color: branding.primary_color}}>{row.price.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US')} EGP</p>
                      <p className="mt-2 text-xs text-slate-500">{text('مدة التوصيل', 'Delivery time')}: {row.delivery_days} {text('يوم', 'days')}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {governorates.slice(0, 8).map((gov) => (
                    <article key={gov.id} className="rounded-xl border border-slate-200 bg-white p-5">
                      <p className="text-sm font-extrabold text-slate-900">{gov.name}</p>
                      <p className="mt-3 text-xs text-slate-500">{text('يرجى التواصل للاستفسار عن السعر', 'Contact us for the delivery rate')}</p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {config.cta_secondary.visible && (
          <section id="cta-secondary" data-storefront-reveal style={{order: 76}} className="bg-white py-12 sm:py-16">
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <div className="grid items-center gap-8 rounded-2xl px-6 py-10 sm:px-10" style={{backgroundColor: branding.primary_color, color: 'var(--tenant-brand-contrast)'}}>
                <div className={config.cta_secondary.image_path ? 'grid gap-8 lg:grid-cols-2 lg:items-center' : ''}>
                  <div>
                    <h2 className="text-3xl font-extrabold">{text(config.cta_secondary.title_ar, config.cta_secondary.title_en)}</h2>
                    <p className="mt-3 max-w-xl text-sm leading-7 opacity-90">{text(config.cta_secondary.text_ar, config.cta_secondary.text_en)}</p>
                    <a href={config.cta_secondary.button_url || '#merchant-registration'} className="mt-5 inline-flex rounded-lg bg-white px-5 py-3 text-sm font-bold" style={{color: branding.primary_color}}>
                      {text(config.cta_secondary.button_label_ar, config.cta_secondary.button_label_en)}
                    </a>
                  </div>
                  {config.cta_secondary.image_path && (
                    <img src={config.cta_secondary.image_path} alt="" className="h-64 w-full rounded-xl object-cover" />
                  )}
                </div>
              </div>
            </div>
          </section>
        )}

        {isVisible('tracking') && (
          <section id="tracking" data-storefront-reveal style={{order: 20}} className="border-y border-slate-100 bg-slate-50 py-14 sm:py-16">
            <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
              <h2 className="text-3xl font-extrabold" style={{color: branding.secondary_color}}>{text('تتبع الشحنة', 'Track shipment')}</h2>
              <p className="mt-2 text-sm text-slate-600">{text('أدخل رقم الشحنة أو البوليصة لعرض آخر حالة.', 'Enter your shipment or waybill number to view the latest status.')}</p>
              <form onSubmit={handleTrack} className="mx-auto mt-6 flex max-w-2xl flex-col gap-2 sm:flex-row">
                <div className="relative flex-1">
                  <PackageSearch className="pointer-events-none absolute top-3.5 right-3 h-4 w-4 text-slate-400" />
                  <input
                    value={trackingCode}
                    onChange={(event) => setTrackingCode(event.target.value)}
                    placeholder={text(config.tracking_placeholder_ar, config.tracking_placeholder_en)}
                    dir="ltr"
                    className="h-11 w-full rounded-lg border border-slate-200 bg-white pr-10 pl-3 text-sm outline-none focus:border-slate-400"
                  />
                </div>
                <button type="submit" className="h-11 rounded-lg px-6 text-sm font-bold" style={{backgroundColor: branding.primary_color, color: 'var(--tenant-brand-contrast)'}}>
                  {text(config.tracking_button_ar, config.tracking_button_en)}
                </button>
              </form>
              {trackingNotice && <p role="status" className="mt-3 text-xs font-semibold text-slate-600">{trackingNotice}</p>}
            </div>
          </section>
        )}

        {isVisible('services') && services.length > 0 && (
          <section id="services" data-storefront-reveal style={{order: 30}} className="bg-white py-14">
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <h2 className="text-2xl font-extrabold" style={{color: branding.secondary_color}}>{text('خدمات الشحن', 'Shipping services')}</h2>
              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {services.map((service) => (
                  <article key={service.id} className="rounded-xl border border-slate-200 p-5">
                    <p className="text-sm font-bold text-slate-900">{service.name}</p>
                    <p className="mt-2 text-xs text-slate-500">{service.estimated_days_min}–{service.estimated_days_max} {text('يوم عمل', 'working days')}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        {isVisible('coverage') && governorates.length > 0 && (
          <section id="coverage" data-storefront-reveal style={{order: 32}} className="bg-slate-50 py-14">
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <h2 className="text-2xl font-extrabold" style={{color: branding.secondary_color}}>{text('نطاق التغطية', 'Coverage area')}</h2>
              <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {governorates.map((gov) => (
                  <div key={gov.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                    <MapPin className="h-3.5 w-3.5" style={{color: branding.accent_color}} />
                    <span className="truncate">{gov.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {isVisible('registration') && tenant.allow_client_self_registration && (
          <section id="merchant-registration" data-storefront-reveal style={{order: 80}} className="bg-white py-16 sm:py-20">
            <div className="mx-auto max-w-5xl px-4 sm:px-6">
              <h2 className="text-3xl font-extrabold" style={{color: branding.secondary_color}}>{text('تسجيل التاجر', 'Merchant registration')}</h2>
              {regResult && (
                <div role="status" className="mt-5 flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  {regResult.auto_approved
                    ? text(`تم قبول وتفعيل ملف التاجر تلقائيًا بكود (${regResult.client_code ?? '—'}).`, `The merchant account was approved automatically with code (${regResult.client_code ?? '—'}).`)
                    : text('تم استلام طلب التسجيل وقيد المراجعة.', 'Your registration request was received and is under review.')}
                </div>
              )}
              {regError && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{regError}</p>}
              <form onSubmit={handleRegistration} className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <StoreInput label={text('اسم المتجر / النشاط *', 'Store name *')} value={companyName} onChange={setCompanyName} required />
                <StoreInput label={text('اسم المسؤول', 'Contact name')} value={contactName} onChange={setContactName} />
                <StoreInput label={text('البريد الإلكتروني *', 'Email *')} value={email} onChange={setEmail} required type="email" dir="ltr" />
                <StoreInput label={text('رقم الهاتف / الموبايل *', 'Phone *')} value={phone} onChange={setPhone} required dir="ltr" />
                <StoreInput label={text('موبايل إضافي', 'Additional mobile')} value={mobile} onChange={setMobile} dir="ltr" />
                <label className="store-label">
                  {text('المحافظة *', 'Governorate *')}
                  <select required value={governorateId} onChange={(event) => {
                    setGovernorateId(event.target.value);
                    const firstRegion = regions.find((region) => region.governorate_id === event.target.value);
                    setRegionId(firstRegion?.id ?? '');
                  }} className="store-field">
                    {governorates.map((gov) => <option key={gov.id} value={gov.id}>{gov.name}</option>)}
                  </select>
                </label>
                <label className="store-label">
                  {text('المنطقة *', 'Region *')}
                  <select required value={regionId} onChange={(event) => setRegionId(event.target.value)} className="store-field">
                    {filteredRegions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
                  </select>
                </label>
                <StoreInput label={text('عنوان الالتقاط بالتفصيل *', 'Pickup address *')} value={addressLine} onChange={setAddressLine} required className="sm:col-span-2" />
                <label className="store-label">
                  {text('طريقة استلام المستحقات *', 'Payout method *')}
                  <select value={payoutMethod} onChange={(event) => setPayoutMethod(event.target.value as PayoutMethod)} className="store-field">
                    <option value="cash">{text('نقدي', 'Cash')}</option>
                    <option value="bank_transfer">{text('تحويل بنكي', 'Bank transfer')}</option>
                    <option value="vodafone_cash">Vodafone Cash</option>
                  </select>
                </label>
                {payoutMethod === 'bank_transfer' && (
                  <>
                    <label className="store-label">{text('اسم البنك', 'Bank')}
                      <select value={bankName} onChange={(event) => setBankName(event.target.value)} className="store-field">
                        {EGYPTIAN_BANKS.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
                      </select>
                    </label>
                    <StoreInput label={text('رقم الحساب / IBAN', 'Account / IBAN')} value={bankAccountNumber} onChange={setBankAccountNumber} required dir="ltr" />
                  </>
                )}
                {payoutMethod === 'vodafone_cash' && (
                  <StoreInput label={text('رقم المحفظة', 'Wallet number')} value={walletPhone} onChange={setWalletPhone} required dir="ltr" />
                )}
                <div className="sm:col-span-2 lg:col-span-3">
                  <button type="submit" disabled={submittingReg} className="rounded-lg px-6 py-3 text-sm font-bold disabled:opacity-60" style={{backgroundColor: branding.primary_color, color: 'var(--tenant-brand-contrast)'}}>
                    {submittingReg ? text('جاري الإرسال...', 'Submitting...') : text('إرسال طلب تسجيل التاجر', 'Submit merchant registration')}
                  </button>
                </div>
              </form>
            </div>
          </section>
        )}

        {isVisible('about') && sectionText('about') && (
          <section id="about" data-storefront-reveal style={{order: 65}} className="bg-slate-50 py-14">
            <div className="mx-auto max-w-5xl px-4 sm:px-6">
              <h2 className="text-2xl font-extrabold" style={{color: branding.secondary_color}}>{text('عن الشركة', 'About us')}</h2>
              <p className="mt-4 whitespace-pre-line text-sm leading-8 text-slate-600">{sectionText('about')}</p>
            </div>
          </section>
        )}

        {isVisible('faq') && sectionText('faq') && !config.faq_items.some((item) => item.visible) && (
          <section id="faq" data-storefront-reveal style={{order: 60}} className="bg-white py-14">
            <div className="mx-auto max-w-5xl px-4 sm:px-6">
              <h2 className="text-2xl font-extrabold" style={{color: branding.secondary_color}}>{text('الأسئلة الشائعة', 'Frequently asked questions')}</h2>
              <div className="mt-5 divide-y divide-slate-200 rounded-xl border border-slate-200">
                {sectionText('faq').split('\n').filter((line) => line.trim()).map((line) => (
                  <details key={line} className="px-5 py-4">
                    <summary className="cursor-pointer text-sm font-bold text-slate-900">{line}</summary>
                  </details>
                ))}
              </div>
            </div>
          </section>
        )}

        {config.custom_sections.filter((section) => section.visible).map((section) => (
          <section
            key={section.id}
            data-storefront-reveal
            style={{order: 65}}
            className={
              section.style === 'dark'
                ? 'bg-slate-950 py-14 text-white sm:py-16'
                : section.style === 'brand'
                  ? 'py-14 sm:py-16'
                  : section.style === 'surface'
                    ? 'border-y border-slate-100 bg-slate-50 py-14 sm:py-16'
                    : 'border-b border-slate-100 bg-white py-14 sm:py-16'
            }
          >
            {section.layout === 'banner' ? (
              <div
                className="mx-auto max-w-7xl px-4 sm:px-6"
                style={section.style === 'brand'
                  ? {backgroundColor: branding.primary_color, color: 'var(--tenant-brand-contrast)', padding: '2.5rem', borderRadius: '1.25rem'}
                  : undefined}
              >
                <h2 className="text-3xl font-extrabold">{text(section.title_ar, section.title_en)}</h2>
                <p className="mt-4 max-w-2xl text-sm leading-8 opacity-90">{text(section.text_ar, section.text_en)}</p>
                {section.button_url && (
                  <a href={section.button_url} className="mt-5 inline-flex rounded-lg bg-white px-5 py-3 text-sm font-bold" style={{color: branding.primary_color}}>
                    {text(section.button_label_ar, section.button_label_en)}
                  </a>
                )}
              </div>
            ) : section.layout === 'text' ? (
              <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
                <h2 className="text-3xl font-extrabold" style={{color: section.style === 'dark' ? '#fff' : branding.secondary_color}}>{text(section.title_ar, section.title_en)}</h2>
                <p className="mt-4 whitespace-pre-line text-sm leading-8 opacity-80">{text(section.text_ar, section.text_en)}</p>
              </div>
            ) : section.layout === 'cards' ? (
              <div className="mx-auto max-w-7xl px-4 sm:px-6">
                <div className="max-w-2xl">
                  <h2 className="text-3xl font-extrabold" style={{color: section.style === 'dark' ? '#fff' : branding.secondary_color}}>{text(section.title_ar, section.title_en)}</h2>
                  <p className="mt-3 text-sm leading-7 opacity-80">{text(section.text_ar, section.text_en)}</p>
                </div>
                <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {text(section.text_ar, section.text_en)
                    .split('\n')
                    .filter((line) => line.trim())
                    .map((line) => (
                      <article key={line} className="rounded-xl border border-slate-200 bg-white p-5 text-slate-900 shadow-[0_12px_35px_-30px_rgba(15,23,42,.5)]">
                        <span className="mb-3 block h-1 w-10 rounded-full" style={{backgroundColor: branding.primary_color}} />
                        <p className="text-sm font-semibold leading-7">{line}</p>
                      </article>
                    ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 sm:px-6 lg:grid-cols-2">
              <div className={section.layout === 'split' && section.image_side === 'left' ? 'lg:order-2' : ''}>
                <h2 className="text-3xl font-extrabold" style={{color: branding.secondary_color}}>{text(section.title_ar, section.title_en)}</h2>
                <p className="mt-4 whitespace-pre-line text-sm leading-8 text-slate-600">{text(section.text_ar, section.text_en)}</p>
                {section.button_url && (
                  <a href={section.button_url} className="mt-5 inline-flex rounded-lg px-5 py-3 text-sm font-bold" style={{backgroundColor: branding.primary_color, color: 'var(--tenant-brand-contrast)'}}>
                    {text(section.button_label_ar, section.button_label_en)}
                  </a>
                )}
              </div>
              {section.image_path && (
                <img src={section.image_path} alt="" className={`h-72 w-full rounded-xl object-cover ${section.image_side === 'left' ? 'lg:order-1' : ''}`} />
              )}
              </div>
            )}
          </section>
        ))}

        {isVisible('contact') && (
          <section id="contact" data-storefront-reveal style={{order: 85}} className="bg-slate-50 py-10">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-5 px-4 text-sm text-slate-600 sm:px-6">
              {config.contact_accounts.filter((account) => account.visible).map((account) => (
                <span key={account.id} className="inline-flex items-center gap-2">
                  {account.kind === 'email' ? <Mail className="h-4 w-4" /> : <Phone className="h-4 w-4" />}
                  <span>{text(account.label_ar, account.label_en)}: <span dir="ltr">{account.value}</span></span>
                </span>
              ))}
              {!config.contact_accounts.some((account) => account.visible) && tenant.public_support_phone && (
                <span className="inline-flex items-center gap-2"><Phone className="h-4 w-4" /><span dir="ltr">{tenant.public_support_phone}</span></span>
              )}
              {!config.contact_accounts.some((account) => account.visible) && tenant.public_support_email && (
                <span className="inline-flex items-center gap-2"><Mail className="h-4 w-4" /><span dir="ltr">{tenant.public_support_email}</span></span>
              )}
            </div>
          </section>
        )}
      </main>

      {config.footer_visible && (
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <p className="text-sm font-extrabold text-slate-900">{tenant.name}</p>
              <p className="mt-1 text-xs leading-6 text-slate-500">
                {text(config.footer_text_ar, config.footer_text_en) || text('خدمات الشحن والتوصيل والتتبع.', 'Shipping, delivery and tracking services.')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {config.social_links.filter((link) => link.visible).map((link) => {
                const Icon = socialIcon(link.platform);
                return (
                  <a key={link.id} href={link.url} target="_blank" rel="noreferrer" aria-label={link.platform} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900">
                    <Icon className="h-4 w-4" />
                  </a>
                );
              })}
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function StoreInput({
  label,
  value,
  onChange,
  required = false,
  type = 'text',
  dir,
  className = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  type?: 'text' | 'email';
  dir?: 'ltr';
  className?: string;
}) {
  return (
    <label className={`store-label ${className}`}>
      {label}
      <input
        type={type}
        required={required}
        dir={dir}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="store-field"
      />
    </label>
  );
}
