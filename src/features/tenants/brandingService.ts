import type {CSSProperties} from 'react';
import {getSupabaseClient} from '@/lib/supabase/client';
import {contrastRatio, isValidHexColor, normalizeHexColor, readableTextColor, shadeColor} from '@/lib/color/contrast';
import type {
  PublicTenantBranding,
  StorefrontSectionId,
  TenantBranding,
  TenantBrandingFont,
  TenantBrandingSection,
  TenantThemeMode,
  TenantStorefrontConfig,
  UpdateTenantBrandingInput,
} from '@/types/tenantBranding';

export interface BrandingFontOption {
  readonly value: TenantBrandingFont;
  readonly label: string;
  readonly stack: string;
}

export const BRANDING_FONTS: readonly BrandingFontOption[] = [
  {value: 'Cairo', label: 'Cairo — القاهرة', stack: '"Cairo", system-ui, sans-serif'},
  {value: 'Tajawal', label: 'Tajawal — تجوال', stack: '"Tajawal", system-ui, sans-serif'},
  {value: 'Almarai', label: 'Almarai — المراعي', stack: '"Almarai", system-ui, sans-serif'},
  {
    value: 'IBM Plex Sans Arabic',
    label: 'IBM Plex Sans Arabic',
    stack: '"IBM Plex Sans Arabic", system-ui, sans-serif',
  },
];

export const DEFAULT_STOREFRONT_CONFIG: TenantStorefrontConfig = {
  default_locale: 'ar',
  features_visible: true,
  pricing_visible: true,
  footer_visible: true,
  testimonials_visible: true,
  faq_visible: true,
  card_style: 'soft',
  surface_radius: 'standard',
  section_spacing: 'standard',
  hero_height: 'large',
  hero_text_align: 'start',
  content_animation: 'rise',
  hero_layout: 'background',
  hero_title_ar: '',
  hero_title_en: '',
  hero_subtitle_ar: '',
  hero_subtitle_en: '',
  hero_overlay_color: '#0b1220',
  hero_overlay_opacity: 0.58,
  hero_shadow_color: '#0b1220',
  hero_shadow_opacity: 0.18,
  header_shadow_color: '#0f172a',
  header_shadow_opacity: 0.08,
  nav_links: [
    {id: 'tracking', label_ar: 'تتبع الشحنة', label_en: 'Track shipment', url: '#tracking', visible: true},
    {id: 'services', label_ar: 'الخدمات والأسعار', label_en: 'Services & pricing', url: '#services-pricing', visible: true},
    {id: 'contact', label_ar: 'تواصل معنا', label_en: 'Contact us', url: '#contact', visible: true},
  ],
  features: [
    {id: 'feature-1', title_ar: 'توصيل موثوق', title_en: 'Reliable delivery', text_ar: 'تتبع واضح ومواعيد تنفيذ يمكن الاعتماد عليها.', text_en: 'Clear tracking and dependable delivery timelines.', icon_key: 'truck', visible: true},
    {id: 'feature-2', title_ar: 'دعم تشغيلي', title_en: 'Operational support', text_ar: 'متابعة مستمرة لحالة الشحنات وطوارئ التوصيل.', text_en: 'Continuous follow-up for shipment status and delivery issues.', icon_key: 'support', visible: true},
    {id: 'feature-3', title_ar: 'تغطية واسعة', title_en: 'Wide coverage', text_ar: 'خدمات تغطي المحافظات والمناطق المعتمدة للشركة.', text_en: 'Coverage across the company-approved governorates and regions.', icon_key: 'map', visible: true},
  ],
  pricing: [],
  cta_primary: {
    title_ar: 'شحن آمن يبدأ بخطوة واحدة',
    title_en: 'Secure shipping starts with one step',
    text_ar: 'ابدأ تتبع شحنتك أو تواصل مع فريق الشركة للاستفسار.',
    text_en: 'Start tracking your shipment or contact the company team.',
    button_label_ar: 'تتبع الشحنة',
    button_label_en: 'Track shipment',
    button_url: '#tracking',
    image_path: null,
    image_side: 'right',
    visible: true,
  },
  cta_secondary: {
    title_ar: 'انضم كتاجر إلى شبكة الشحن',
    title_en: 'Join the shipping network as a merchant',
    text_ar: 'سجّل متجرك واستلم بيانات التشغيل والدعم من فريق الشركة.',
    text_en: 'Register your store and receive account and support details.',
    button_label_ar: 'سجّل كتاجر',
    button_label_en: 'Register',
    button_url: '#merchant-registration',
    image_path: null,
    image_side: 'left',
    visible: true,
  },
  social_links: [],
  custom_sections: [],
  testimonials: [
    {
      id: 'testimonial-1',
      name_ar: 'عميل موثوق',
      name_en: 'Trusted customer',
      role_ar: 'تاجر إلكتروني',
      role_en: 'Online merchant',
      quote_ar: 'التزام واضح في مواعيد الاستلام والتوصيل، والمتابعة سهلة عبر رقم الشحنة.',
      quote_en: 'Clear pickup and delivery commitments, with easy follow-up through the shipment number.',
      rating: 5,
      avatar_path: null,
      visible: true,
    },
  ],
  faq_items: [
    {
      id: 'faq-1',
      question_ar: 'كيف يمكنني تتبع شحنتي؟',
      question_en: 'How can I track my shipment?',
      answer_ar: 'أدخل رقم الشحنة أو البوليصة في قسم التتبع للحصول على آخر حالة متاحة.',
      answer_en: 'Enter the shipment or waybill number in the tracking section to view the latest status.',
      visible: true,
    },
  ],
  footer_text_ar: '',
  footer_text_en: '',
  header_login_label_ar: 'تسجيل الدخول',
  header_login_label_en: 'Sign in',
  tracking_placeholder_ar: 'رقم الشحنة أو البوليصة',
  tracking_placeholder_en: 'Shipment or waybill number',
  tracking_button_ar: 'تتبع الشحنة',
  tracking_button_en: 'Track',
  contact_accounts: [],
};

export interface StorefrontSectionMeta {
  readonly id: StorefrontSectionId;
  readonly label: string;
  readonly description: string;
  readonly defaultVisible: boolean;
  readonly supportsText: boolean;
}

/**
 * Section registry — must stay in sync with app_private.tenant_section_catalog().
 * The database is the source of truth; this list drives the editor UI.
 */
export const STOREFRONT_SECTION_CATALOG: readonly StorefrontSectionMeta[] = [
  {
    id: 'hero',
    label: 'الواجهة الرئيسية',
    description: 'الشعار والعنوان الرئيسي ووصف الشركة مع زر التتبع.',
    defaultVisible: true,
    supportsText: false,
  },
  {
    id: 'tracking',
    label: 'تتبع الشحنة',
    description: 'حقل إدخال رقم الشحنة أو البوليصة للانتقال إلى صفحة التتبع.',
    defaultVisible: true,
    supportsText: false,
  },
  {
    id: 'services',
    label: 'خدمات الشحن',
    description: 'الخدمات النشطة ومدد التسليم المسجّلة في الشركة.',
    defaultVisible: true,
    supportsText: false,
  },
  {
    id: 'coverage',
    label: 'نطاق التغطية',
    description: 'المحافظات والمناطق المفعّلة في الشركة.',
    defaultVisible: true,
    supportsText: false,
  },
  {
    id: 'stats',
    label: 'أرقام سريعة — غير مستخدمة',
    description: 'القالب الحالي لا يعرض هذا القسم نهائيًا.',
    defaultVisible: false,
    supportsText: false,
  },
  {
    id: 'about',
    label: 'عن الشركة',
    description: 'نص تعريفي يكتبه العميل ويظهر في متجره.',
    defaultVisible: false,
    supportsText: true,
  },
  {
    id: 'faq',
    label: 'الأسئلة الشائعة',
    description: 'نص أسئلة وأجوبة يكتبه العميل بصيغة سؤال ثم جواب في كل سطر.',
    defaultVisible: false,
    supportsText: true,
  },
  {
    id: 'contact',
    label: 'بيانات التواصل',
    description: 'هاتف وبريد الدعم المسجّلين في إعدادات الشركة.',
    defaultVisible: true,
    supportsText: false,
  },
  {
    id: 'registration',
    label: 'تسجيل التجار',
    description: 'نموذج التسجيل الذاتي، ويظهر فقط عند تفعيله في إعدادات الشركة.',
    defaultVisible: true,
    supportsText: false,
  },
  {
    id: 'app_download',
    label: 'تحميل التطبيق',
    description: 'رابط تحميل تطبيق الشركة، ويُفعّل بعد إصدار أول نسخة APK.',
    defaultVisible: false,
    supportsText: false,
  },
];

export const DEFAULT_BRANDING: PublicTenantBranding = {
  primary_color: '#ef6a47',
  secondary_color: '#1f2937',
  accent_color: '#0f766e',
  font_family: 'Cairo',
  logo_path: null,
  favicon_path: null,
  hero_image_path: null,
  hero_title: null,
  hero_subtitle: null,
  theme_mode: 'light',
  storefront_config: DEFAULT_STOREFRONT_CONFIG,
  sections: STOREFRONT_SECTION_CATALOG.map((section) => ({
    id: section.id,
    visible: section.defaultVisible,
  })),
  settings_version: 1,
};

export function sectionMeta(id: StorefrontSectionId): StorefrontSectionMeta {
  return (
    STOREFRONT_SECTION_CATALOG.find((section) => section.id === id) ??
    STOREFRONT_SECTION_CATALOG[0]
  );
}

export function fontStack(font: TenantBrandingFont): string {
  return BRANDING_FONTS.find((option) => option.value === font)?.stack ?? BRANDING_FONTS[0].stack;
}

function normalizeSections(
  input: readonly TenantBrandingSection[] | null | undefined,
): TenantBrandingSection[] {
  const fromInput = Array.isArray(input) ? input : [];
  const known = fromInput
    .filter((section) => STOREFRONT_SECTION_CATALOG.some((meta) => meta.id === section.id))
    .map((section) => ({
      id: section.id,
      visible: section.visible !== false,
      text: section.text?.trim() ? section.text.trim() : null,
    }));

  const seen = new Set(known.map((section) => section.id));
  const missing = STOREFRONT_SECTION_CATALOG.filter((meta) => !seen.has(meta.id)).map((meta) => ({
    id: meta.id,
    visible: meta.defaultVisible,
    text: null,
  }));

  return [...known, ...missing];
}

/** Fills gaps for payloads that predate the branding table (or a failed RPC). */
export function normalizeStorefrontConfig(
  input: Partial<TenantStorefrontConfig> | null | undefined,
): TenantStorefrontConfig {
  if (!input) {
    return DEFAULT_STOREFRONT_CONFIG;
  }
  const d = DEFAULT_STOREFRONT_CONFIG;
  return {
    ...d,
    ...input,
    default_locale: input.default_locale === 'en' ? 'en' : 'ar',
    card_style:
      input.card_style === 'flat' || input.card_style === 'outline'
        ? input.card_style
        : 'soft',
    surface_radius:
      input.surface_radius === 'compact' || input.surface_radius === 'rounded'
        ? input.surface_radius
        : 'standard',
    section_spacing:
      input.section_spacing === 'compact' || input.section_spacing === 'wide'
        ? input.section_spacing
        : 'standard',
    hero_height: input.hero_height === 'medium' ? 'medium' : 'large',
    hero_text_align: input.hero_text_align === 'center' ? 'center' : 'start',
    content_animation:
      input.content_animation === 'none' || input.content_animation === 'fade'
        ? input.content_animation
        : 'rise',
    hero_layout:
      input.hero_layout === 'split-right' || input.hero_layout === 'split-left'
        ? input.hero_layout
        : 'background',
    nav_links: Array.isArray(input.nav_links) ? input.nav_links : d.nav_links,
    features: Array.isArray(input.features) ? input.features : d.features,
    pricing: Array.isArray(input.pricing) ? input.pricing : d.pricing,
    cta_primary: input.cta_primary ? {...d.cta_primary, ...input.cta_primary} : d.cta_primary,
    cta_secondary: input.cta_secondary ? {...d.cta_secondary, ...input.cta_secondary} : d.cta_secondary,
    social_links: Array.isArray(input.social_links) ? input.social_links : d.social_links,
    custom_sections: Array.isArray(input.custom_sections)
      ? input.custom_sections.map((section) => ({
          ...section,
          layout: section.layout ?? 'split',
          style: section.style ?? 'minimal',
          animation: section.animation ?? 'rise',
        }))
      : d.custom_sections,
    testimonials: Array.isArray(input.testimonials) ? input.testimonials : d.testimonials,
    faq_items: Array.isArray(input.faq_items) ? input.faq_items : d.faq_items,
    contact_accounts: Array.isArray(input.contact_accounts) ? input.contact_accounts : d.contact_accounts,
  };
}

export function normalizePublicBranding(
  input: PublicTenantBranding | null | undefined,
): PublicTenantBranding {
  if (!input) {
    return DEFAULT_BRANDING;
  }
  return {
    primary_color: normalizeHexColor(input.primary_color ?? '', DEFAULT_BRANDING.primary_color),
    secondary_color: normalizeHexColor(input.secondary_color ?? '', DEFAULT_BRANDING.secondary_color),
    accent_color: normalizeHexColor(input.accent_color ?? '', DEFAULT_BRANDING.accent_color),
    font_family: input.font_family ?? DEFAULT_BRANDING.font_family,
    logo_path: input.logo_path ?? null,
    favicon_path: input.favicon_path ?? null,
    hero_image_path: input.hero_image_path ?? null,
    hero_title: input.hero_title ?? null,
    hero_subtitle: input.hero_subtitle ?? null,
    theme_mode: input.theme_mode === 'dark' ? 'dark' : 'light',
    sections: normalizeSections(input.sections),
    storefront_config: normalizeStorefrontConfig(input.storefront_config),
    settings_version: input.settings_version ?? 1,
  };
}

export interface ResolvedSection extends TenantBrandingSection {
  readonly order: number;
  readonly meta: StorefrontSectionMeta;
}

/** Stored order wins; visibility defaults to the catalog value. */
export function resolveSections(branding: PublicTenantBranding): ResolvedSection[] {
  return normalizeSections(branding.sections).map((section, index) => ({
    ...section,
    order: index,
    meta: sectionMeta(section.id),
  }));
}

export function visibleSectionIds(branding: PublicTenantBranding): StorefrontSectionId[] {
  return resolveSections(branding)
    .filter((section) => section.visible)
    .map((section) => section.id);
}

/** CSS custom properties consumed by the storefront surface. */
export function brandCssVars(branding: PublicTenantBranding): CSSProperties {
  const text = readableTextColor(branding.primary_color);
  return {
    '--tenant-brand': branding.primary_color,
    '--tenant-brand-dark': shadeColor(branding.primary_color, -0.22),
    '--tenant-brand-soft': shadeColor(branding.primary_color, 0.88),
    '--tenant-brand-contrast': text,
    '--tenant-accent': branding.accent_color,
    '--tenant-secondary': branding.secondary_color,
    '--tenant-font': fontStack(branding.font_family),
  } as CSSProperties;
}

export interface BrandingValidationResult {
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

/** Shared by the editor and the save path; the database re-validates everything. */
export function validateBranding(input: UpdateTenantBrandingInput): BrandingValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const colors: Array<[string, string]> = [
    ['اللون الأساسي', input.primary_color],
    ['اللون الثانوي', input.secondary_color],
    ['لون التمييز', input.accent_color],
  ];
  for (const [label, value] of colors) {
    if (!isValidHexColor(value)) {
      errors.push(`${label} يجب أن يكون بصيغة #rrggbb.`);
    }
  }

  if (!BRANDING_FONTS.some((option) => option.value === input.font_family)) {
    errors.push('الخط المختار غير معتمد.');
  }

  if (input.theme_mode !== 'light' && input.theme_mode !== 'dark') {
    errors.push('نمط الظهور يجب أن يكون فاتحًا أو داكنًا.');
  }

  if ((input.hero_title ?? '').length > 80) {
    errors.push('العنوان الرئيسي يجب ألا يتجاوز 80 حرفًا.');
  }
  if ((input.hero_subtitle ?? '').length > 240) {
    errors.push('الوصف الرئيسي يجب ألا يتجاوز 240 حرفًا.');
  }

  const ids = input.sections.map((section) => section.id);
  if (new Set(ids).size !== ids.length) {
    errors.push('لا يمكن تكرار القسم نفسه في القائمة.');
  }
  if (ids.length !== STOREFRONT_SECTION_CATALOG.length) {
    errors.push('قائمة الأقسام يجب أن تشمل كل الأقسام المعتمدة.');
  }

  if (isValidHexColor(input.primary_color)) {
    const primary = normalizeHexColor(input.primary_color);
    const best = Math.max(contrastRatio('#ffffff', primary), contrastRatio('#111827', primary));
    if (best < 3) {
      errors.push('اللون الأساسي لا يحقق حدًا مقروءًا للنص فوقه؛ اختر لونًا أغمق أو أفتح.');
    } else if (best < 4.5) {
      warnings.push(
        'اللون الأساسي يحقق معيار AA للنصوص الكبيرة فقط؛ النصوص الصغيرة فوقه قد تكون غير مريحة للقراءة.',
      );
    }
  }

  return {errors, warnings};
}

function toUpdateInput(branding: PublicTenantBranding): UpdateTenantBrandingInput {
  return {
    primary_color: branding.primary_color,
    secondary_color: branding.secondary_color,
    accent_color: branding.accent_color,
    font_family: branding.font_family,
    logo_path: branding.logo_path,
    favicon_path: branding.favicon_path,
    hero_image_path: branding.hero_image_path,
    hero_title: branding.hero_title,
    hero_subtitle: branding.hero_subtitle,
    theme_mode: branding.theme_mode,
    sections: branding.sections,
    storefront_config: normalizeStorefrontConfig(branding.storefront_config),
  };
}

export function brandingToUpdateInput(branding: PublicTenantBranding): UpdateTenantBrandingInput {
  return toUpdateInput(branding);
}

export async function getTenantBranding(tenantId: string): Promise<TenantBranding> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {data, error} = await client.rpc('get_tenant_branding', {p_tenant_id: tenantId});

  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر تحميل هوية الشركة.');
  }

  const row = (Array.isArray(data) ? data[0] : data) as TenantBranding | undefined;
  if (!row) {
    throw new Error('تعذر تحميل هوية الشركة.');
  }

  return {
    ...row,
    sections: normalizeSections(row.sections),
    storefront_config: normalizeStorefrontConfig(row.storefront_config),
  };
}

export async function updateTenantBranding(
  tenantId: string,
  input: UpdateTenantBrandingInput,
): Promise<TenantBranding> {
  const validation = validateBranding(input);
  if (validation.errors.length > 0) {
    throw new Error(validation.errors[0]);
  }

  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {data, error} = await client.rpc('update_tenant_branding', {
    p_tenant_id: tenantId,
    p_payload: {
      primary_color: normalizeHexColor(input.primary_color),
      secondary_color: normalizeHexColor(input.secondary_color),
      accent_color: normalizeHexColor(input.accent_color),
      font_family: input.font_family,
      theme_mode: input.theme_mode,
      logo_path: input.logo_path,
      favicon_path: input.favicon_path,
      hero_image_path: input.hero_image_path,
      hero_title: input.hero_title,
      hero_subtitle: input.hero_subtitle,
      sections: input.sections,
      storefront_config: normalizeStorefrontConfig(input.storefront_config),
    },
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر حفظ هوية الشركة.');
  }

  const row = (Array.isArray(data) ? data[0] : data) as TenantBranding;
  return {
    ...row,
    sections: normalizeSections(row.sections),
    storefront_config: normalizeStorefrontConfig(row.storefront_config),
  };
}

export async function uploadTenantStorefrontAsset(
  tenantId: string,
  kind: 'logo' | 'hero' | 'cta' | 'custom',
  file: File,
): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(file.type)) {
    throw new Error('يجب رفع صورة بصيغة JPG أو PNG أو WEBP أو SVG.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('حجم الصورة يجب ألا يتجاوز 5 ميجابايت.');
  }

  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const extension =
    file.type === 'image/jpeg'
      ? 'jpg'
      : file.type === 'image/png'
        ? 'png'
        : file.type === 'image/webp'
          ? 'webp'
          : 'svg';
  const objectPath = `${tenantId}/${kind}/${crypto.randomUUID()}.${extension}`;
  const {error} = await client.storage
    .from('tenant-storefront-assets')
    .upload(objectPath, file, {cacheControl: '3600', upsert: false, contentType: file.type});
  if (error) {
    throw new Error(error.message || 'تعذر رفع صورة الموقع العام.');
  }

  return client.storage.from('tenant-storefront-assets').getPublicUrl(objectPath).data.publicUrl;
}

export function themeModeIsDark(mode: TenantThemeMode): boolean {
  return mode === 'dark';
}
