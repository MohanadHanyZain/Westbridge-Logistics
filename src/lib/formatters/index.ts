import {BRAND_CONFIG, sanitizeCurrency, sanitizeLocale, sanitizeTimezone} from '@/config/brand';

export function formatCurrency(
  amount: number,
  currency: string = BRAND_CONFIG.defaultCurrency,
  locale: string = BRAND_CONFIG.defaultLocale,
): string {
  const safeLocale = sanitizeLocale(locale, BRAND_CONFIG.defaultLocale);
  const safeCurrency = sanitizeCurrency(currency, BRAND_CONFIG.defaultCurrency);
  try {
    return new Intl.NumberFormat(safeLocale, {
      style: 'currency',
      currency: safeCurrency,
      numberingSystem: 'latn',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${safeCurrency}`;
  }
}

export function formatNumber(
  value: number,
  locale: string = BRAND_CONFIG.defaultLocale,
): string {
  const safeLocale = sanitizeLocale(locale, BRAND_CONFIG.defaultLocale);
  try {
    return new Intl.NumberFormat(safeLocale, {
      numberingSystem: 'latn',
    }).format(value);
  } catch {
    return String(value);
  }
}

export function formatWeightKg(
  weightKg: number,
  locale: string = BRAND_CONFIG.defaultLocale,
): string {
  const safeLocale = sanitizeLocale(locale, BRAND_CONFIG.defaultLocale);
  try {
    const formatted = new Intl.NumberFormat(safeLocale, {
      numberingSystem: 'latn',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(weightKg);
    return `${formatted} كجم`;
  } catch {
    return `${weightKg} كجم`;
  }
}

export function formatDateTime(
  utcIso: string,
  timezone: string = BRAND_CONFIG.defaultTimezone,
  locale: string = BRAND_CONFIG.defaultLocale,
): string {
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const safeLocale = sanitizeLocale(locale, BRAND_CONFIG.defaultLocale);
  const safeTimezone = sanitizeTimezone(timezone, BRAND_CONFIG.defaultTimezone);
  try {
    return new Intl.DateTimeFormat(safeLocale, {
      timeZone: safeTimezone,
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidUsername(raw: string): boolean {
  const normalized = normalizeUsername(raw);
  return /^[a-z0-9._-]{3,32}$/.test(normalized);
}

export function isValidCompanySlug(raw: string): boolean {
  const trimmed = raw.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed) && trimmed.length >= 2 && trimmed.length <= 48;
}
