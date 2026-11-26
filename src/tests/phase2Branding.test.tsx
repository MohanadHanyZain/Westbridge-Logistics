import {describe, expect, it} from 'vitest';
import {
  contrastRatio,
  isAccessible,
  isValidHexColor,
  readableTextColor,
  shadeColor,
  WCAG_AA_LARGE,
} from '@/lib/color/contrast';
import {
  DEFAULT_BRANDING,
  STOREFRONT_SECTION_CATALOG,
  brandingToUpdateInput,
  normalizePublicBranding,
  resolveSections,
  validateBranding,
  visibleSectionIds,
} from '@/features/tenants/brandingService';
import type {TenantBrandingSection} from '@/types/tenantBranding';

describe('Phase 2: tenant branding & storefront sections', () => {
  it('computes WCAG contrast ratios and picks readable text colours', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 2);
    expect(isAccessible('#ffffff', '#1f2937')).toBe(true);
    expect(isAccessible('#fde68a', '#ffffff', WCAG_AA_LARGE)).toBe(false);
    expect(readableTextColor('#111827')).toBe('#ffffff');
    expect(readableTextColor('#fde68a')).toBe('#111827');
    expect(shadeColor('#000000', 0.5)).toBe('#808080');
    expect(shadeColor('#ffffff', -0.5)).toBe('#808080');
  });

  it('validates hex input strictly and case-insensitively', () => {
    expect(isValidHexColor('#EF6A47')).toBe(true);
    expect(isValidHexColor('  #ef6a47 ')).toBe(true);
    expect(isValidHexColor('#ef6a4')).toBe(false);
    expect(isValidHexColor('ef6a47')).toBe(false);
    expect(isValidHexColor('rgb(1,2,3)')).toBe(false);
  });

  it('falls back to a complete default branding record when the payload has none', () => {
    const branding = normalizePublicBranding(null);
    expect(branding.settings_version).toBe(1);
    expect(branding.primary_color).toBe(DEFAULT_BRANDING.primary_color);
    expect(branding.sections).toHaveLength(STOREFRONT_SECTION_CATALOG.length);
    expect(visibleSectionIds(branding)).toContain('hero');
    expect(visibleSectionIds(branding)).not.toContain('app_download');
  });

  it('keeps the stored section order, drops unknown ids and appends missing ones', () => {
    const sections = [
      {id: 'coverage', visible: true},
      {id: 'hero', visible: false},
      {id: 'not-a-real-section', visible: true},
    ] as unknown as TenantBrandingSection[];

    const resolved = resolveSections(normalizePublicBranding({...DEFAULT_BRANDING, sections}));

    expect(resolved[0].id).toBe('coverage');
    expect(resolved[0].order).toBe(0);
    expect(resolved[1].id).toBe('hero');
    expect(resolved[1].visible).toBe(false);
    expect(resolved.map((section) => section.id)).not.toContain('not-a-real-section');
    expect(resolved).toHaveLength(STOREFRONT_SECTION_CATALOG.length);
  });

  it('accepts the default branding as a valid save payload', () => {
    const result = validateBranding(brandingToUpdateInput(DEFAULT_BRANDING));
    expect(result.errors).toEqual([]);
  });

  it('rejects malformed colours, duplicated sections and warns on weak body contrast', () => {
    const base = brandingToUpdateInput(DEFAULT_BRANDING);

    expect(validateBranding({...base, primary_color: 'red'}).errors).toContain(
      'اللون الأساسي يجب أن يكون بصيغة #rrggbb.',
    );
    expect(
      validateBranding({...base, sections: [base.sections[0], ...base.sections.slice(0, -1)]}).errors
        .length,
    ).toBeGreaterThan(0);
    expect(validateBranding({...base, hero_title: 'x'.repeat(81)}).errors.length).toBeGreaterThan(0);
    // Mid-grey sits between the AA thresholds: readable for large text only.
    expect(validateBranding({...base, primary_color: '#7b7b7b'}).warnings.length).toBe(1);
  });
});
