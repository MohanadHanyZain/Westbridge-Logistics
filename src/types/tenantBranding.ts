import type {TimestampUtc} from '@/types/common';

/** Section ids approved by the database registry (app_private.tenant_section_catalog). */
export type StorefrontSectionId =
  | 'hero'
  | 'tracking'
  | 'services'
  | 'coverage'
  | 'stats'
  | 'about'
  | 'faq'
  | 'contact'
  | 'registration'
  | 'app_download';

export type TenantThemeMode = 'light' | 'dark';

export type TenantBrandingFont = 'Cairo' | 'Tajawal' | 'Almarai' | 'IBM Plex Sans Arabic';

export interface TenantBrandingSection {
  readonly id: StorefrontSectionId;
  readonly visible: boolean;
  readonly text?: string | null;
}

export type StorefrontLocale = 'ar' | 'en';
export type HeroLayout = 'background' | 'split-right' | 'split-left';
export type CardStyle = 'flat' | 'soft' | 'outline';
export type SurfaceRadius = 'compact' | 'standard' | 'rounded';
export type SectionSpacing = 'compact' | 'standard' | 'wide';
export type ContentAnimation = 'none' | 'fade' | 'rise';

export interface StorefrontLink {
  readonly id: string;
  readonly label_ar: string;
  readonly label_en: string;
  readonly url: string;
  readonly visible: boolean;
}

export interface StorefrontFeature {
  readonly id: string;
  readonly title_ar: string;
  readonly title_en: string;
  readonly text_ar: string;
  readonly text_en: string;
  readonly icon_key: 'truck' | 'package' | 'wallet' | 'shield' | 'map' | 'support';
  readonly visible: boolean;
}

export interface StorefrontPricingRow {
  readonly id: string;
  readonly governorate_id?: string | null;
  readonly governorate_name_ar: string;
  readonly governorate_name_en: string;
  readonly price: number;
  readonly delivery_days: string;
  readonly visible: boolean;
}

export interface StorefrontCta {
  readonly title_ar: string;
  readonly title_en: string;
  readonly text_ar: string;
  readonly text_en: string;
  readonly button_label_ar: string;
  readonly button_label_en: string;
  readonly button_url: string;
  readonly image_path: string | null;
  readonly image_side: 'right' | 'left';
  readonly visible: boolean;
}

export interface StorefrontSocialLink {
  readonly id: string;
  readonly platform: 'facebook' | 'instagram' | 'twitter' | 'linkedin' | 'youtube' | 'tiktok' | 'whatsapp';
  readonly url: string;
  readonly visible: boolean;
}

export interface StorefrontCustomSection {
  readonly id: string;
  readonly title_ar: string;
  readonly title_en: string;
  readonly text_ar: string;
  readonly text_en: string;
  readonly image_path: string | null;
  readonly image_side: 'right' | 'left';
  readonly button_label_ar: string;
  readonly button_label_en: string;
  readonly button_url: string;
  readonly visible: boolean;
  readonly layout: 'split' | 'cards' | 'banner' | 'text';
  readonly style: 'minimal' | 'surface' | 'brand' | 'dark';
  readonly animation: ContentAnimation;
}

export interface StorefrontTestimonial {
  readonly id: string;
  readonly name_ar: string;
  readonly name_en: string;
  readonly role_ar: string;
  readonly role_en: string;
  readonly quote_ar: string;
  readonly quote_en: string;
  readonly rating: number;
  readonly avatar_path: string | null;
  readonly visible: boolean;
}

export interface StorefrontFaqItem {
  readonly id: string;
  readonly question_ar: string;
  readonly question_en: string;
  readonly answer_ar: string;
  readonly answer_en: string;
  readonly visible: boolean;
}

export interface TenantStorefrontConfig {
  readonly default_locale: StorefrontLocale;
  readonly features_visible: boolean;
  readonly pricing_visible: boolean;
  readonly footer_visible: boolean;
  readonly testimonials_visible: boolean;
  readonly faq_visible: boolean;
  readonly card_style: CardStyle;
  readonly surface_radius: SurfaceRadius;
  readonly section_spacing: SectionSpacing;
  readonly hero_height: 'medium' | 'large';
  readonly hero_text_align: 'start' | 'center';
  readonly content_animation: ContentAnimation;
  readonly hero_layout: HeroLayout;
  readonly hero_title_ar: string;
  readonly hero_title_en: string;
  readonly hero_subtitle_ar: string;
  readonly hero_subtitle_en: string;
  readonly hero_overlay_color: string;
  readonly hero_overlay_opacity: number;
  readonly hero_shadow_color: string;
  readonly hero_shadow_opacity: number;
  readonly header_shadow_color: string;
  readonly header_shadow_opacity: number;
  readonly nav_links: readonly StorefrontLink[];
  readonly features: readonly StorefrontFeature[];
  readonly pricing: readonly StorefrontPricingRow[];
  readonly cta_primary: StorefrontCta;
  readonly cta_secondary: StorefrontCta;
  readonly social_links: readonly StorefrontSocialLink[];
  readonly custom_sections: readonly StorefrontCustomSection[];
  readonly testimonials: readonly StorefrontTestimonial[];
  readonly faq_items: readonly StorefrontFaqItem[];
  readonly footer_text_ar: string;
  readonly footer_text_en: string;
  readonly header_login_label_ar: string;
  readonly header_login_label_en: string;
  readonly tracking_placeholder_ar: string;
  readonly tracking_placeholder_en: string;
  readonly tracking_button_ar: string;
  readonly tracking_button_en: string;
  readonly contact_accounts: readonly {
    readonly id: string;
    readonly kind: 'phone' | 'email' | 'whatsapp';
    readonly label_ar: string;
    readonly label_en: string;
    readonly value: string;
    readonly visible: boolean;
  }[];
}

export interface TenantBranding {
  readonly tenant_id: string;
  readonly primary_color: string;
  readonly secondary_color: string;
  readonly accent_color: string;
  readonly font_family: TenantBrandingFont;
  readonly logo_path: string | null;
  readonly favicon_path: string | null;
  readonly hero_image_path: string | null;
  readonly hero_title: string | null;
  readonly hero_subtitle: string | null;
  readonly theme_mode: TenantThemeMode;
  readonly sections: readonly TenantBrandingSection[];
  readonly storefront_config: TenantStorefrontConfig;
  readonly settings_version: number;
  readonly created_at?: TimestampUtc;
  readonly updated_at?: TimestampUtc;
}

/** Branding as exposed to anonymous storefront visitors (no internal ids). */
export type PublicTenantBranding = Omit<TenantBranding, 'tenant_id' | 'created_at' | 'updated_at'>;

export interface StorefrontStats {
  readonly services_count: number;
  readonly governorates_count: number;
  readonly regions_count: number;
}

export interface UpdateTenantBrandingInput {
  readonly primary_color: string;
  readonly secondary_color: string;
  readonly accent_color: string;
  readonly font_family: TenantBrandingFont;
  readonly logo_path: string | null;
  readonly favicon_path: string | null;
  readonly hero_image_path: string | null;
  readonly hero_title: string | null;
  readonly hero_subtitle: string | null;
  readonly theme_mode: TenantThemeMode;
  readonly sections: readonly TenantBrandingSection[];
  readonly storefront_config: TenantStorefrontConfig;
}
