/**
 * Centralized brand and platform configuration (ADR-001).
 * Never hardcode the platform name across UI components or pages;
 * import BRAND_CONFIG instead so renaming the product requires a single edit.
 */
export interface BrandConfig {
  readonly appName: string;
  readonly appTagline: string;
  readonly defaultLocale: string;
  readonly defaultCurrency: string;
  readonly defaultTimezone: string;
  readonly defaultDirection: 'rtl';
  readonly defaultLanguage: 'ar';
  readonly tenantRoutePrefix: string;
}

function readRawEnv(key: string): string {
  if (typeof import.meta === 'undefined' || !import.meta.env) {
    return '';
  }
  const value = import.meta.env[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function sanitizeLocale(raw: string, fallback = 'ar-EG'): string {
  if (!raw) {
    return fallback;
  }
  const cleaned = raw.replace(/^VITE_DEFAULT_LOCALE\s*=\s*/i, '').trim();
  if (!cleaned) {
    return fallback;
  }
  try {
    const canonical = Intl.getCanonicalLocales(cleaned);
    if (canonical.length > 0 && Intl.NumberFormat.supportedLocalesOf(canonical).length > 0) {
      return canonical[0];
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export function sanitizeCurrency(raw: string, fallback = 'EGP'): string {
  const cleaned = raw.replace(/^VITE_DEFAULT_CURRENCY\s*=\s*/i, '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(cleaned)) {
    try {
      new Intl.NumberFormat('en-US', {style: 'currency', currency: cleaned}).format(0);
      return cleaned;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function sanitizeTimezone(raw: string, fallback = 'Africa/Cairo'): string {
  const cleaned = raw.replace(/^VITE_DEFAULT_TIMEZONE\s*=\s*/i, '').trim();
  if (!cleaned) {
    return fallback;
  }
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: cleaned}).format(new Date(0));
    return cleaned;
  } catch {
    return fallback;
  }
}

const envBrandName = readRawEnv('VITE_APP_BRAND_NAME');
const envLocale = sanitizeLocale(readRawEnv('VITE_DEFAULT_LOCALE'));
const envCurrency = sanitizeCurrency(readRawEnv('VITE_DEFAULT_CURRENCY'));
const envTimezone = sanitizeTimezone(readRawEnv('VITE_DEFAULT_TIMEZONE'));

export const BRAND_CONFIG: BrandConfig = {
  appName: envBrandName || 'ShipFlow',
  appTagline: 'منصة إدارة شركات الشحن والتوصيل والعمليات اللوجستية والمالية',
  defaultLocale: envLocale,
  defaultCurrency: envCurrency,
  defaultTimezone: envTimezone,
  defaultDirection: 'rtl',
  defaultLanguage: 'ar',
  tenantRoutePrefix: '/c',
};

export function buildTenantBasePath(companySlug: string): string {
  const cleanSlug = companySlug.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
  return `${BRAND_CONFIG.tenantRoutePrefix}/${cleanSlug}`;
}
