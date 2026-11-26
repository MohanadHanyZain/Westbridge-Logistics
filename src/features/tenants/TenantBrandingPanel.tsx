import {useCallback, useEffect, useMemo, useState} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Palette,
  Save,
} from 'lucide-react';
import {
  BRANDING_FONTS,
  DEFAULT_BRANDING,
  brandingToUpdateInput,
  brandCssVars,
  fontStack,
  getTenantBranding,
  normalizePublicBranding,
  resolveSections,
  updateTenantBranding,
  validateBranding,
} from '@/features/tenants/brandingService';
import {contrastRatio, isValidHexColor, readableTextColor} from '@/lib/color/contrast';
import type {
  PublicTenantBranding,
  StorefrontSectionId,
  TenantBrandingFont,
  TenantThemeMode,
} from '@/types/tenantBranding';

interface TenantBrandingPanelProps {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly canEdit: boolean;
}

type ColorKey = 'primary_color' | 'secondary_color' | 'accent_color';

const COLOR_FIELDS: readonly {key: ColorKey; label: string; hint: string}[] = [
  {key: 'primary_color', label: 'اللون الأساسي', hint: 'أزرار التتبع والدعوات الرئيسية'},
  {key: 'secondary_color', label: 'اللون الثانوي', hint: 'العناوين والنصوص الأساسية'},
  {key: 'accent_color', label: 'لون التمييز', hint: 'الشارات والحالات والتفاصيل'},
];

function toPublicBranding(branding: PublicTenantBranding): PublicTenantBranding {
  return normalizePublicBranding(branding);
}

export function TenantBrandingPanel({tenantId, tenantName, canEdit}: TenantBrandingPanelProps) {
  const [draft, setDraft] = useState<PublicTenantBranding>(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; text: string} | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const branding = await getTenantBranding(tenantId);
      setDraft(toPublicBranding(branding));
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'تعذر تحميل هوية الشركة.',
      });
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  const validation = useMemo(() => validateBranding(brandingToUpdateInput(draft)), [draft]);
  const sections = useMemo(() => resolveSections(draft), [draft]);
  const cssVars = useMemo(() => brandCssVars(draft), [draft]);

  const update = (patch: Partial<PublicTenantBranding>) => {
    setDraft((current) => ({...current, ...patch}));
    setFeedback(null);
  };

  const updateColor = (key: ColorKey, value: string) => {
    update({[key]: value.toLowerCase()} as Partial<PublicTenantBranding>);
  };

  const moveSection = (index: number, delta: number) => {
    const next = [...sections];
    const target = index + delta;
    if (target < 0 || target >= next.length) {
      return;
    }
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    update({sections: next.map(({id, visible, text}) => ({id, visible, text: text ?? null}))});
  };

  const toggleSection = (id: StorefrontSectionId) => {
    update({
      sections: sections.map((section) =>
        section.id === id ? {id, visible: !section.visible, text: section.text ?? null} : section,
      ),
    });
  };

  const setSectionText = (id: StorefrontSectionId, text: string) => {
    update({
      sections: sections.map((section) =>
        section.id === id
          ? {id, visible: section.visible, text: text.trim() ? text : null}
          : section,
      ),
    });
  };

  const save = async () => {
    if (!canEdit || validation.errors.length > 0) {
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await updateTenantBranding(tenantId, brandingToUpdateInput(draft));
      setDraft(toPublicBranding(saved));
      setFeedback({type: 'success', text: 'تم حفظ هوية المتجر وتطبيقها على الموقع العام فورًا.'});
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'تعذر حفظ هوية الشركة.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5 text-xs text-slate-500">
        جاري تحميل هوية المتجر...
      </section>
    );
  }

  const previewText = readableTextColor(draft.primary_color);
  const primaryContrast = contrastRatio(previewText, draft.primary_color);

  return (
    <section
      aria-label="هوية المتجر والأقسام"
      className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-slate-700" />
          <h2 className="text-sm font-semibold text-slate-900">هوية المتجر والأقسام</h2>
        </div>
        <span className="font-mono-tabular text-[11px] text-slate-500">
          إصدار الإعدادات: {draft.settings_version}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        تُطبَّق هذه الهوية على الموقع العام للشركة فقط، وتحتفظ لوحة العمل بألوان المنصة الموحّدة.
      </p>

      {!canEdit && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          التعديل مقتصر على مدير الشركة أو مدير المنصة؛ يمكنك مراجعة القيم كما هي الآن.
        </p>
      )}

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] ${
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
          }`}
        >
          {feedback.type === 'error' ? (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          {/* Colours */}
          <div>
            <h3 className="text-xs font-semibold text-slate-900">الهوية اللونية</h3>
            <div className="mt-3 space-y-3">
              {COLOR_FIELDS.map((field) => {
                const value = draft[field.key];
                const invalid = !isValidHexColor(value);
                return (
                  <div key={field.key} className="flex items-center gap-3">
                    <input
                      type="color"
                      aria-label={field.label}
                      value={isValidHexColor(value) ? value : '#000000'}
                      onChange={(event) => updateColor(field.key, event.target.value)}
                      disabled={!canEdit}
                      className="h-9 w-12 cursor-pointer rounded-md border border-slate-200 bg-white p-0.5"
                    />
                    <div className="flex-1">
                      <label className="block text-[11px] font-medium text-slate-700">
                        {field.label}
                        <span className="ms-1 font-normal text-slate-400">— {field.hint}</span>
                      </label>
                      <input
                        type="text"
                        dir="ltr"
                        value={value}
                        readOnly={!canEdit}
                        onChange={(event) => updateColor(field.key, event.target.value)}
                        aria-invalid={invalid}
                        className={`mt-1 w-32 rounded-md border px-2 py-1 font-mono-tabular text-[11px] ${
                          invalid ? 'border-red-300 text-red-700' : 'border-slate-200 text-slate-800'
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              تباين النص على اللون الأساسي: {Math.round(primaryContrast * 10) / 10}:1
              {primaryContrast >= 4.5 ? ' — مطابق لمعيار AA' : ' — يراجع قبل النشر'}
            </p>
          </div>

          {/* Typography & theme */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-900" htmlFor="branding-font">
                خط المتجر
              </label>
              <select
                id="branding-font"
                value={draft.font_family}
                disabled={!canEdit}
                onChange={(event) =>
                  update({font_family: event.target.value as TenantBrandingFont})
                }
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                {BRANDING_FONTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-xs font-semibold text-slate-900">نمط المتجر</span>
              <div className="mt-1.5 flex gap-2">
                {(['light', 'dark'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => update({theme_mode: mode as TenantThemeMode})}
                    aria-pressed={draft.theme_mode === mode}
                    className={`rounded-lg border px-3 py-2 text-[11px] font-medium ${
                      draft.theme_mode === mode
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {mode === 'light' ? 'فاتح' : 'داكن'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Hero content */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-900" htmlFor="branding-hero-title">
                العنوان الرئيسي
                <span className="ms-1 font-normal text-slate-400">
                  ({draft.hero_title?.length ?? 0}/80)
                </span>
              </label>
              <input
                id="branding-hero-title"
                type="text"
                maxLength={80}
                readOnly={!canEdit}
                value={draft.hero_title ?? ''}
                onChange={(event) => update({hero_title: event.target.value || null})}
                placeholder={`مرحبًا بكم في ${tenantName}`}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label
                className="block text-xs font-semibold text-slate-900"
                htmlFor="branding-hero-subtitle"
              >
                الوصف الرئيسي
                <span className="ms-1 font-normal text-slate-400">
                  ({draft.hero_subtitle?.length ?? 0}/240)
                </span>
              </label>
              <textarea
                id="branding-hero-subtitle"
                rows={2}
                maxLength={240}
                readOnly={!canEdit}
                value={draft.hero_subtitle ?? ''}
                onChange={(event) => update({hero_subtitle: event.target.value || null})}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-900" htmlFor="branding-logo">
                رابط الشعار
                <span className="ms-1 font-normal text-slate-400">(https://... أو مسار داخل التخزين)</span>
              </label>
              <input
                id="branding-logo"
                type="text"
                dir="ltr"
                readOnly={!canEdit}
                value={draft.logo_path ?? ''}
                onChange={(event) => update({logo_path: event.target.value.trim() || null})}
                placeholder="https://cdn.example.com/logo.png"
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-[11px]"
              />
            </div>
          </div>

          {/* Sections */}
          <div>
            <h3 className="text-xs font-semibold text-slate-900">أقسام الموقع العام وترتيبها</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              الترتيب هنا هو ترتيب الظهور للزائر. القسم المخفي لا يُحذف، بل يتوقف عن العرض.
            </p>
            <ul className="mt-3 space-y-2">
              {sections.map((section, index) => (
                <li
                  key={section.id}
                  className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                      <button
                        type="button"
                        aria-label={`تحريك ${section.meta.label} لأعلى`}
                        disabled={!canEdit || index === 0}
                        onClick={() => moveSection(index, -1)}
                        className="rounded p-0.5 text-slate-500 hover:bg-white disabled:opacity-30"
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`تحريك ${section.meta.label} لأسفل`}
                        disabled={!canEdit || index === sections.length - 1}
                        onClick={() => moveSection(index, 1)}
                        className="rounded p-0.5 text-slate-500 hover:bg-white disabled:opacity-30"
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold text-slate-900">{section.meta.label}</p>
                      <p className="truncate text-[10px] text-slate-500">{section.meta.description}</p>
                    </div>
                    <button
                      type="button"
                      disabled={!canEdit}
                      onClick={() => toggleSection(section.id)}
                      aria-pressed={section.visible}
                      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium ${
                        section.visible
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-white text-slate-500'
                      }`}
                    >
                      {section.visible ? (
                        <Eye className="h-3 w-3" />
                      ) : (
                        <EyeOff className="h-3 w-3" />
                      )}
                      {section.visible ? 'ظاهر' : 'مخفي'}
                    </button>
                  </div>
                  {section.meta.supportsText && (
                    <textarea
                      rows={2}
                      readOnly={!canEdit}
                      value={section.text ?? ''}
                      onChange={(event) => setSectionText(section.id, event.target.value)}
                      placeholder={
                        section.id === 'faq'
                          ? 'سطر لكل سؤال: السؤال ثم العلامة ؟ ثم الجواب'
                          : 'نص تعريفي قصير عن الشركة'
                      }
                      className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1.5 text-[11px]"
                    />
                  )}
                </li>
              ))}
            </ul>
          </div>

          {validation.errors.length > 0 && (
            <ul role="alert" className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-[11px] text-red-800">
              {validation.errors.map((error) => (
                <li key={error}>• {error}</li>
              ))}
            </ul>
          )}
          {validation.warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900">
              {validation.warnings.map((warning) => (
                <li key={warning}>• {warning}</li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={!canEdit || saving || validation.errors.length > 0}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'جاري الحفظ...' : 'حفظ الهوية والأقسام'}
          </button>
        </div>

        {/* Live preview */}
        <div className="lg:col-span-2">
          <div className="sticky top-4">
            <p className="text-xs font-semibold text-slate-900">معاينة حية</p>
            <div
              data-tenant-surface
              dir="rtl"
              style={{...cssVars, fontFamily: fontStack(draft.font_family)}}
              className={`mt-2 overflow-hidden rounded-xl border ${
                draft.theme_mode === 'dark'
                  ? 'border-slate-700 bg-slate-900 text-slate-100'
                  : 'border-slate-200 bg-white text-slate-900'
              }`}
            >
              <div
                className="flex items-center justify-between px-3 py-2"
                style={{backgroundColor: draft.primary_color, color: previewText}}
              >
                <span className="text-[11px] font-bold">{tenantName}</span>
                <span
                  className="rounded px-2 py-0.5 text-[10px]"
                  style={{backgroundColor: 'rgba(255,255,255,0.18)'}}
                >
                  دخول
                </span>
              </div>
              <div className="space-y-2 px-3 py-4">
                <p className="text-sm font-bold" style={{color: draft.secondary_color}}>
                  {draft.hero_title?.trim() || `مرحبًا بكم في ${tenantName}`}
                </p>
                <p className="text-[11px] leading-relaxed opacity-80">
                  {draft.hero_subtitle?.trim() ||
                    'بوابة التتبع العام وخدمات الشحن والتوصيل الخاصة بالشركة.'}
                </p>
                <div className="flex gap-2">
                  <span
                    className="rounded-md px-2 py-1 text-[10px] font-medium"
                    style={{backgroundColor: draft.primary_color, color: previewText}}
                  >
                    تتبع الشحنة
                  </span>
                  <span
                    className="rounded-md border px-2 py-1 text-[10px]"
                    style={{borderColor: draft.accent_color, color: draft.accent_color}}
                  >
                    خدماتنا
                  </span>
                </div>
                <ul className="mt-2 flex flex-wrap gap-1">
                  {sections
                    .filter((section) => section.visible)
                    .map((section) => (
                      <li
                        key={section.id}
                        className="rounded border px-1.5 py-0.5 text-[9px]"
                        style={{borderColor: draft.accent_color, color: draft.accent_color}}
                      >
                        {section.meta.label}
                      </li>
                    ))}
                </ul>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-slate-500">
              المعاينة تقريبية؛ التطبيق النهائي يظهر على نطاق الشركة بعد الحفظ دون إعادة نشر.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
