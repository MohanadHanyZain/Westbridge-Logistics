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
    label: 'أرقام سريعة',
    description: 'عدد الخدمات والمحافظات والمناطق المغطاة.',
    defaultVisible: true,
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
    },
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر حفظ هوية الشركة.');
  }

  const row = (Array.isArray(data) ? data[0] : data) as TenantBranding;
  return {...row, sections: normalizeSections(row.sections)};
}

export function themeModeIsDark(mode: TenantThemeMode): boolean {
  return mode === 'dark';
}
