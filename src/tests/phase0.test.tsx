import {describe, expect, it} from 'vitest';
import {fireEvent, render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import App from '@/App';
import {PhaseZeroConsole} from '@/app/PhaseZeroConsole';
import {
  BRAND_CONFIG,
  buildTenantBasePath,
  sanitizeCurrency,
  sanitizeLocale,
  sanitizeTimezone,
} from '@/config/brand';
import {assertNoServerSecretsInClientEnv} from '@/config/env';
import {
  formatCurrency,
  formatDateTime,
  formatWeightKg,
  isValidCompanySlug,
  isValidUsername,
  normalizeUsername,
} from '@/lib/formatters';
import {getSupabaseReadiness} from '@/lib/supabase/client';

describe('Phase 0: Centralized Brand & Environment Guards', () => {
  it('provides centralized temporary brand name ShipFlow and RTL defaults', () => {
    expect(BRAND_CONFIG.appName).toBe('ShipFlow');
    expect(BRAND_CONFIG.defaultDirection).toBe('rtl');
    expect(BRAND_CONFIG.defaultLanguage).toBe('ar');
    expect(buildTenantBasePath('  Demo-Express/ ')).toBe('/c/demo-express');
  });

  it('sanitizes malformed locale, currency, and timezone env values safely', () => {
    expect(sanitizeLocale('VITE_DEFAULT_LOCALE=ar-EG')).toBe('ar-EG');
    expect(sanitizeLocale('not a valid locale!')).toBe('ar-EG');
    expect(sanitizeCurrency('جنيه مصري')).toBe('EGP');
    expect(sanitizeCurrency('usd')).toBe('USD');
    expect(sanitizeTimezone('توقيت مصر القياسي (EET)')).toBe('Africa/Cairo');
    expect(sanitizeTimezone('Africa/Cairo')).toBe('Africa/Cairo');
  });

  it('rejects any server secret exposed in client env variables', () => {
    expect(() =>
      assertNoServerSecretsInClientEnv({VITE_SUPABASE_URL: 'https://example.supabase.co'}),
    ).not.toThrow();

    expect(() =>
      assertNoServerSecretsInClientEnv({VITE_SUPABASE_SERVICE_ROLE_KEY: 'secret'}),
    ).toThrow(/Security violation/);

    expect(() =>
      assertNoServerSecretsInClientEnv({SUPABASE_SERVICE_ROLE_KEY: 'secret'}),
    ).toThrow(/Security violation/);
  });

  it('reports Supabase readiness status cleanly', () => {
    const status = getSupabaseReadiness();
    expect(['phase-1-connected', 'phase-1-unconfigured']).toContain(status.phase);
    expect(typeof status.configured).toBe('boolean');
  });
});

describe('Phase 0: Formatters & Input Normalizers', () => {
  it('formats currency, weight, and UTC dates safely even with invalid overrides', () => {
    expect(formatCurrency(100)).toContain('100');
    expect(formatCurrency(100, 'جنيه مصري', 'VITE_DEFAULT_LOCALE=ar-EG')).toContain('100');
    expect(formatWeightKg(2.5)).toContain('كجم');
    expect(formatDateTime('invalid-date')).toBe('—');
    expect(formatDateTime('2026-11-18T12:00:00Z')).not.toBe('—');
    expect(formatDateTime('2026-11-18T12:00:00Z', 'Bad/Timezone', 'bad_locale')).not.toBe('—');
  });

  it('normalizes and validates usernames and company slugs', () => {
    expect(normalizeUsername('  Admin_01 ')).toBe('admin_01');
    expect(isValidUsername('admin_01')).toBe(true);
    expect(isValidUsername('ab')).toBe(false);
    expect(isValidUsername('user@mail.com')).toBe(false);

    expect(isValidCompanySlug('cairo-express')).toBe(true);
    expect(isValidCompanySlug('-invalid-')).toBe(false);
  });
});

describe('Phase 0: RTL Application Shell & Interactive Architecture Console', () => {
  it('renders App with RTL direction and centralized brand name', () => {
    render(<App />);

    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(screen.getAllByText(BRAND_CONFIG.appName).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('heading', {level: 1})).toHaveTextContent('إدارة كاملة لشركات الشحن');
  });

  it('switches tabs and filters roadmap phases and open questions accurately', () => {
    render(
      <MemoryRouter>
        <PhaseZeroConsole />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', {name: 'خارطة المراحل'}));
    expect(screen.getByRole('heading', {name: /خارطة التنفيذ المرحلية/})).toBeInTheDocument();

    const searchInput = screen.getByLabelText('بحث في المراحل');
    fireEvent.change(searchInput, {target: {value: 'التسعير'}});
    expect(screen.getByText(/محرك التسعير/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'القرارات'}));
    expect(screen.getByText('اسم المنصة التجاري وإدارة الهوية مركزيًا')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: /القرارات المفتوحة/}));
    expect(screen.getByText('معامل الوزن الحجمي ووحدته وسياسة التقريب')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'جاهزية البيئة'}));
    fireEvent.click(screen.getByRole('button', {name: 'تشغيل فحص متغيرات الواجهة'}));
    expect(screen.getByRole('status')).toHaveTextContent('لا توجد مفاتيح سرية');
  });
});
