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
}
