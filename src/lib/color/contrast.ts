/**
 * WCAG 2.1 contrast helpers (Phase 2).
 *
 * Used to keep tenant brand colours readable before they are saved, instead of
 * publishing a storefront that fails accessibility checks.
 */

export interface RgbColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const HEX_PATTERN = /^#[0-9a-f]{6}$/;

export function isValidHexColor(value: string): boolean {
  return HEX_PATTERN.test(value.trim().toLowerCase());
}

export function normalizeHexColor(value: string, fallback = '#ef6a47'): string {
  const cleaned = value.trim().toLowerCase();
  return HEX_PATTERN.test(cleaned) ? cleaned : fallback;
}

export function hexToRgb(value: string): RgbColor | null {
  const cleaned = value.trim().toLowerCase();
  if (!HEX_PATTERN.test(cleaned)) {
    return null;
  }
  return {
    r: Number.parseInt(cleaned.slice(1, 3), 16),
    g: Number.parseInt(cleaned.slice(3, 5), 16),
    b: Number.parseInt(cleaned.slice(5, 7), 16),
  };
}

export function rgbToHex({r, g, b}: RgbColor): string {
  const clamp = (channel: number) =>
    Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0');
  return `#${clamp(r)}${clamp(g)}${clamp(b)}`;
}

function channelLuminance(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance per WCAG 2.1. */
export function relativeLuminance(value: string): number {
  const rgb = hexToRgb(value);
  if (!rgb) {
    return 0;
  }
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

/** Contrast ratio between two hex colours, from 1 to 21. */
export function contrastRatio(foreground: string, background: string): number {
  const light = relativeLuminance(foreground);
  const dark = relativeLuminance(background);
  const lighter = Math.max(light, dark);
  const darker = Math.min(light, dark);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA for normal body text. */
export const WCAG_AA_NORMAL = 4.5;

/** WCAG AA for large text (18.66px bold or 24px regular) and UI icons. */
export const WCAG_AA_LARGE = 3;

/** Picks black or white text for a given background, whichever contrasts more. */
export function readableTextColor(background: string): '#ffffff' | '#111827' {
  return contrastRatio('#ffffff', background) >= contrastRatio('#111827', background)
    ? '#ffffff'
    : '#111827';
}

/**
 * Mixes a colour toward white (positive ratio) or black (negative ratio).
 * `ratio` is clamped to [-1, 1].
 */
export function shadeColor(value: string, ratio: number): string {
  const rgb = hexToRgb(value);
  if (!rgb) {
    return value;
  }
  const target = ratio >= 0 ? 255 : 0;
  const amount = Math.min(1, Math.abs(ratio));
  return rgbToHex({
    r: rgb.r + (target - rgb.r) * amount,
    g: rgb.g + (target - rgb.g) * amount,
    b: rgb.b + (target - rgb.b) * amount,
  });
}

export function isAccessible(foreground: string, background: string, minimum = WCAG_AA_NORMAL): boolean {
  return contrastRatio(foreground, background) >= minimum;
}

/** Short Arabic label describing the contrast result. */
export function describeContrast(foreground: string, background: string): string {
  const ratio = contrastRatio(foreground, background);
  const rounded = Math.round(ratio * 10) / 10;
  if (ratio >= WCAG_AA_NORMAL) {
    return `تباين ${rounded}:1 — مطابق لمعيار AA`;
  }
  if (ratio >= WCAG_AA_LARGE) {
    return `تباين ${rounded}:1 — مطابق للنصوص الكبيرة فقط`;
  }
  return `تباين ${rounded}:1 — أقل من الحد الأدنى (4.5:1)`;
}
