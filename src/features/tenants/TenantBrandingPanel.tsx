import {LoadingState} from '@/components/ui/LoadingState';
import {useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode} from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Palette,
  Plus,
  Save,
  Trash2,
  Upload,
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
  uploadTenantStorefrontAsset,
  validateBranding,
} from '@/features/tenants/brandingService';
import {contrastRatio, isValidHexColor, readableTextColor} from '@/lib/color/contrast';
import type {
  PublicTenantBranding,
  StorefrontCta,
  StorefrontCustomSection,
  StorefrontFaqItem,
  StorefrontFeature,
  StorefrontLink,
  StorefrontPricingRow,
  StorefrontSectionId,
  StorefrontSocialLink,
  StorefrontTestimonial,
  TenantBrandingFont,
  TenantThemeMode,
} from '@/types/tenantBranding';

interface TenantBrandingPanelProps {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly canEdit: boolean;
}


const uid = () => crypto.randomUUID();

export function TenantBrandingPanel({tenantId, tenantName, canEdit}: TenantBrandingPanelProps) {
  const [draft, setDraft] = useState<PublicTenantBranding>(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; text: string} | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDraft(normalizePublicBranding(await getTenantBranding(tenantId)));
    } catch (error) {
      setFeedback({
        type: 'error',
        text: error instanceof Error ? error.message : 'تعذر تحميل إعدادات الموقع.',
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
  const config = draft.storefront_config;

  const update = (patch: Partial<PublicTenantBranding>) =>
    setDraft((current) => ({...current, ...patch}));

  const updateConfig = (patch: Partial<typeof config>) =>
    setDraft((current) => ({
      ...current,
      storefront_config: {...current.storefront_config, ...patch},
    }));

  const moveSection = (index: number, delta: number) => {
    const next = [...sections];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    update({sections: next.map(({id, visible, text}) => ({id, visible, text: text ?? null}))});
  };

  const toggleSection = (id: StorefrontSectionId) =>
    update({
      sections: sections.map((section) =>
        section.id === id ? {id, visible: !section.visible, text: section.text ?? null} : section,
      ),
    });

  const setSectionText = (id: StorefrontSectionId, text: string) =>
    update({
      sections: sections.map((section) =>
        section.id === id
          ? {id, visible: section.visible, text: text.trim() ? text : null}
          : section,
      ),
    });

  const handleUpload = async (
    kind: 'logo' | 'hero' | 'cta' | 'custom',
    event: ChangeEvent<HTMLInputElement>,
    onUploaded: (url: string) => void,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(kind);
    setFeedback(null);
    try {
      onUploaded(await uploadTenantStorefrontAsset(tenantId, kind, file));
    } catch (error) {
      setFeedback({type: 'error', text: error instanceof Error ? error.message : 'تعذر رفع الصورة.'});
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    if (!canEdit || validation.errors.length > 0) return;
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await updateTenantBranding(tenantId, brandingToUpdateInput(draft));
      setDraft(normalizePublicBranding(saved));
      setFeedback({type: 'success', text: 'تم نشر إعدادات الموقع العام للشركة بنجاح.'});
    } catch (error) {
      setFeedback({type: 'error', text: error instanceof Error ? error.message : 'تعذر حفظ إعدادات الموقع.'});
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 text-xs text-slate-500">
        <LoadingState label="جارٍ تحميل مصمم الموقع" />
      </section>
    );
  }

  const previewText = readableTextColor(draft.primary_color);
  const primaryContrast = contrastRatio(previewText, draft.primary_color);

  return (
    <section aria-label="مصمم الموقع العام للشركة" className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-slate-700" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900">مصمم موقع {tenantName}</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">قالب رسمي موحّد قابل للتحكم كاملًا لكل شركة.</p>
          </div>
        </div>
        <span className="font-mono-tabular text-[11px] text-slate-500">الإصدار {draft.settings_version}</span>
      </div>

      {!canEdit && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          تعديل مواقع الشركات متاح للمدير الأعلى للمنصة فقط.
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

      {validation.errors.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-[11px] text-red-800">
          {validation.errors.map((error) => (
            <p key={error}>• {error}</p>
          ))}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <EditorCard title="اللغة والإعدادات العامة">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="لغة الموقع الافتراضية">
                <select
                  value={config.default_locale}
                  disabled={!canEdit}
                  onChange={(event) => updateConfig({default_locale: event.target.value as 'ar' | 'en'})}
                  className="field"
                >
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </Field>
              <Field label="الخط">
                <select
                  value={draft.font_family}
                  disabled={!canEdit}
                  onChange={(event) => update({font_family: event.target.value as TenantBrandingFont})}
                  className="field"
                >
                  {BRANDING_FONTS.map((font) => (
                    <option key={font.value} value={font.value}>{font.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="نمط الخلفية">
                <select
                  value={draft.theme_mode}
                  disabled={!canEdit}
                  onChange={(event) => update({theme_mode: event.target.value as TenantThemeMode})}
                  className="field"
                >
                  <option value="light">فاتح</option>
                  <option value="dark">داكن رسمي</option>
                </select>
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-4 text-[11px] text-slate-700">
              {([
                ['features_visible', 'قسم المميزات'],
                ['pricing_visible', 'قسم الأسعار'],
                ['footer_visible', 'الفوتر'],
                ['testimonials_visible', 'آراء العملاء'],
                ['faq_visible', 'الأسئلة الشائعة'],
              ] as const).map(([key, label]) => (
                <label key={key} className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={config[key]}
                    disabled={!canEdit}
                    onChange={(event) => updateConfig({[key]: event.target.checked} as Partial<typeof config>)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="شكل الكروت">
                <select
                  value={config.card_style}
                  disabled={!canEdit}
                  onChange={(event) => updateConfig({card_style: event.target.value as 'flat' | 'soft' | 'outline'})}
                  className="field"
                >
                  <option value="flat">مسطح رسمي</option>
                  <option value="soft">ناعـم وظل خفيف</option>
                  <option value="outline">حدود واضحة</option>
                </select>
              </Field>
              <Field label="نصف قطر الزوايا">
                <select
                  value={config.surface_radius}
                  disabled={!canEdit}
                  onChange={(event) => updateConfig({surface_radius: event.target.value as 'compact' | 'standard' | 'rounded'})}
                  className="field"
                >
                  <option value="compact">حاد ومكثف</option>
                  <option value="standard">قياسي</option>
                  <option value="rounded">مستدير رسمي</option>
                </select>
              </Field>
              <Field label="مسافات الأقسام">
                <select
                  value={config.section_spacing}
                  disabled={!canEdit}
                  onChange={(event) => updateConfig({section_spacing: event.target.value as 'compact' | 'standard' | 'wide'})}
                  className="field"
                >
                  <option value="compact">مضغوط</option>
                  <option value="standard">متوازن</option>
                  <option value="wide">واسع</option>
                </select>
              </Field>
              <Field label="ارتفاع الهيرو">
                <select
                  value={config.hero_height}
                  disabled={!canEdit}
                  onChange={(event) => updateConfig({hero_height: event.target.value as 'medium' | 'large'})}
                  className="field"
                >
                  <option value="medium">متوسط</option>
                  <option value="large">كبير</option>
                </select>
              </Field>
              <Field label="محاذاة نص الهيرو">
                <select
                  value={config.hero_text_align}
                  disabled={!canEdit}
                  onChange={(event) => updateConfig({hero_text_align: event.target.value as 'start' | 'center'})}
                  className="field"
                >
                  <option value="start">على جهة المحتوى</option>
                  <option value="center">بالمنتصف</option>
                </select>
              </Field>
              <Field label="الأنيميشن">
                <select
                  value={config.content_animation}
                  disabled={!canEdit}
                  onChange={(event) => updateConfig({content_animation: event.target.value as 'none' | 'fade' | 'rise'})}
                  className="field"
                >
                  <option value="none">بدون حركة</option>
                  <option value="fade">ظهور هادئ</option>
                  <option value="rise">تحرك خفيف للأعلى</option>
                </select>
              </Field>
            </div>
          </EditorCard>

          <EditorCard title="الألوان والعلامة">
            <div className="grid gap-4 sm:grid-cols-3">
              {([
                ['primary_color', 'اللون الأساسي'],
                ['secondary_color', 'اللون الثانوي'],
                ['accent_color', 'لون التمييز'],
              ] as const).map(([key, label]) => (
                <div key={key} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                  <input
                    type="color"
                    aria-label={label}
                    disabled={!canEdit}
                    value={isValidHexColor(draft[key]) ? draft[key] : '#000000'}
                    onChange={(event) => update({[key]: event.target.value.toLowerCase()} as Partial<PublicTenantBranding>)}
                    className="h-10 w-12 rounded border border-slate-200 p-1"
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-slate-700">{label}</p>
                    <input
                      dir="ltr"
                      disabled={!canEdit}
                      value={draft[key]}
                      onChange={(event) => update({[key]: event.target.value.toLowerCase()} as Partial<PublicTenantBranding>)}
                      className="mt-1 w-full rounded border border-slate-200 px-2 py-1 font-mono-tabular text-[10px]"
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-slate-500">
              تباين النص فوق اللون الأساسي: {Math.round(primaryContrast * 10) / 10}:1
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <AssetField
                label="شعار الهيدر"
                value={draft.logo_path}
                uploading={uploading === 'logo'}
                disabled={!canEdit}
                onUrl={(value) => update({logo_path: value || null})}
                onUpload={(event) => void handleUpload('logo', event, (url) => update({logo_path: url}))}
              />
              <AssetField
                label="صورة الهيرو"
                value={draft.hero_image_path}
                uploading={uploading === 'hero'}
                disabled={!canEdit}
                onUrl={(value) => update({hero_image_path: value || null})}
                onUpload={(event) => void handleUpload('hero', event, (url) => update({hero_image_path: url}))}
              />
            </div>
          </EditorCard>

          <EditorCard title="الهيرو والـ Header">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="نمط الهيرو">
                <select
                  value={config.hero_layout}
                  disabled={!canEdit}
                  onChange={(event) => updateConfig({hero_layout: event.target.value as 'background' | 'split-right' | 'split-left'})}
                  className="field"
                >
                  <option value="background">صورة خلفية بكامل العرض</option>
                  <option value="split-right">صورة يمين والنص يسار</option>
                  <option value="split-left">صورة يسار والنص يمين</option>
                </select>
              </Field>
              <Field label="لون ظلال الهيدر">
                <input
                  type="color"
                  disabled={!canEdit}
                  value={isValidHexColor(config.header_shadow_color) ? config.header_shadow_color : '#0f172a'}
                  onChange={(event) => updateConfig({header_shadow_color: event.target.value})}
                  className="h-10 w-full rounded border border-slate-200 p-1"
                />
              </Field>
              <Field label="العنوان الرئيسي بالعربية">
                <input
                  maxLength={80}
                  disabled={!canEdit}
                  value={config.hero_title_ar}
                  onChange={(event) => updateConfig({hero_title_ar: event.target.value})}
                  className="field"
                />
              </Field>
              <Field label="Hero title in English">
                <input
                  maxLength={80}
                  disabled={!canEdit}
                  dir="ltr"
                  value={config.hero_title_en}
                  onChange={(event) => updateConfig({hero_title_en: event.target.value})}
                  className="field"
                />
              </Field>
              <Field label="الوصف بالعربية">
                <textarea
                  maxLength={240}
                  rows={3}
                  disabled={!canEdit}
                  value={config.hero_subtitle_ar}
                  onChange={(event) => updateConfig({hero_subtitle_ar: event.target.value})}
                  className="field"
                />
              </Field>
              <Field label="Subtitle in English">
                <textarea
                  maxLength={240}
                  rows={3}
                  disabled={!canEdit}
                  dir="ltr"
                  value={config.hero_subtitle_en}
                  onChange={(event) => updateConfig({hero_subtitle_en: event.target.value})}
                  className="field"
                />
              </Field>
              <RangeField
                label="شفافية طبقة الهيرو"
                value={config.hero_overlay_opacity}
                min={0}
                max={0.95}
                step={0.05}
                disabled={!canEdit}
                onChange={(value) => updateConfig({hero_overlay_opacity: value})}
              />
              <RangeField
                label="قوة الظل"
                value={config.header_shadow_opacity}
                min={0}
                max={0.5}
                step={0.01}
                disabled={!canEdit}
                onChange={(value) => updateConfig({header_shadow_opacity: value})}
              />
            </div>
          </EditorCard>

          <EditorCard title="روابط الهيدر وتسجيل الدخول">
            <ArrayEditor
              items={config.nav_links}
              disabled={!canEdit}
              addLabel="إضافة رابط هيدر"
              onAdd={() => updateConfig({nav_links: [...config.nav_links, {id: uid(), label_ar: 'رابط جديد', label_en: 'New link', url: '#', visible: true}]})}
              render={(item: StorefrontLink, index) => (
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_90px_auto]">
                  <input className="field" value={item.label_ar} disabled={!canEdit} onChange={(event) => updateConfig({nav_links: config.nav_links.map((row, i) => i === index ? {...row, label_ar: event.target.value} : row)})} placeholder="الاسم بالعربية" />
                  <input className="field" dir="ltr" value={item.label_en} disabled={!canEdit} onChange={(event) => updateConfig({nav_links: config.nav_links.map((row, i) => i === index ? {...row, label_en: event.target.value} : row)})} placeholder="English name" />
                  <input className="field" dir="ltr" value={item.url} disabled={!canEdit} onChange={(event) => updateConfig({nav_links: config.nav_links.map((row, i) => i === index ? {...row, url: event.target.value} : row)})} placeholder="#tracking" />
                  <button type="button" disabled={!canEdit} onClick={() => updateConfig({nav_links: config.nav_links.map((row, i) => i === index ? {...row, visible: !row.visible} : row)})} className="field inline-flex items-center justify-center gap-1">
                    {item.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {item.visible ? 'ظاهر' : 'مخفي'}
                  </button>
                  <button type="button" disabled={!canEdit} onClick={() => updateConfig({nav_links: config.nav_links.filter((_, i) => i !== index)})} className="rounded-lg border border-red-200 p-2 text-red-700">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="زر تسجيل الدخول بالعربية">
                <input className="field" disabled={!canEdit} value={config.header_login_label_ar} onChange={(event) => updateConfig({header_login_label_ar: event.target.value})} />
              </Field>
              <Field label="Sign in label">
                <input className="field" dir="ltr" disabled={!canEdit} value={config.header_login_label_en} onChange={(event) => updateConfig({header_login_label_en: event.target.value})} />
              </Field>
            </div>
          </EditorCard>

          <EditorCard title="أقسام الموقع وترتيبها">
            <ul className="space-y-2">
              {sections.map((section, index) => (
                <li key={section.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col">
                      <button type="button" disabled={!canEdit || index === 0} onClick={() => moveSection(index, -1)} className="rounded p-0.5 text-slate-500 disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
                      <button type="button" disabled={!canEdit || index === sections.length - 1} onClick={() => moveSection(index, 1)} className="rounded p-0.5 text-slate-500 disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold text-slate-900">{section.meta.label}</p>
                      <p className="text-[10px] text-slate-500">{section.meta.description}</p>
                    </div>
                    <button type="button" disabled={!canEdit} onClick={() => toggleSection(section.id)} className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600">
                      {section.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    </button>
                  </div>
                  {section.meta.supportsText && (
                    <textarea
                      rows={2}
                      disabled={!canEdit}
                      value={section.text ?? ''}
                      onChange={(event) => setSectionText(section.id, event.target.value)}
                      className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-[11px]"
                      placeholder={section.meta.label}
                    />
                  )}
                </li>
              ))}
            </ul>
          </EditorCard>

          <EditorCard title="قسم المميزات">
            <ArrayEditor
              items={config.features}
              disabled={!canEdit}
              addLabel="إضافة ميزة"
              onAdd={() => updateConfig({features: [...config.features, {id: uid(), title_ar: 'ميزة جديدة', title_en: 'New feature', text_ar: '', text_en: '', icon_key: 'package', visible: true}]})}
              render={(item: StorefrontFeature, index) => (
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className="field" disabled={!canEdit} value={item.title_ar} onChange={(event) => updateConfig({features: config.features.map((row, i) => i === index ? {...row, title_ar: event.target.value} : row)})} placeholder="عنوان الميزة بالعربية" />
                  <input className="field" dir="ltr" disabled={!canEdit} value={item.title_en} onChange={(event) => updateConfig({features: config.features.map((row, i) => i === index ? {...row, title_en: event.target.value} : row)})} placeholder="Feature title" />
                  <textarea className="field" rows={2} disabled={!canEdit} value={item.text_ar} onChange={(event) => updateConfig({features: config.features.map((row, i) => i === index ? {...row, text_ar: event.target.value} : row)})} placeholder="الوصف بالعربية" />
                  <textarea className="field" rows={2} dir="ltr" disabled={!canEdit} value={item.text_en} onChange={(event) => updateConfig({features: config.features.map((row, i) => i === index ? {...row, text_en: event.target.value} : row)})} placeholder="Feature description" />
                  <div className="flex gap-2 sm:col-span-2">
                    <button type="button" disabled={!canEdit} onClick={() => updateConfig({features: config.features.map((row, i) => i === index ? {...row, visible: !row.visible} : row)})} className="field flex flex-1 items-center justify-center gap-1">
                      {item.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />} {item.visible ? 'ظاهر' : 'مخفي'}
                    </button>
                    <button type="button" disabled={!canEdit} onClick={() => updateConfig({features: config.features.filter((_, i) => i !== index)})} className="rounded-lg border border-red-200 px-3 text-red-700"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              )}
            />
          </EditorCard>

          <EditorCard title="آراء العملاء — عجلة عرض كل 3 آراء">
            <ArrayEditor
              items={config.testimonials}
              disabled={!canEdit}
              addLabel="إضافة رأي عميل"
              onAdd={() => updateConfig({
                testimonials: [...config.testimonials, {
                  id: uid(),
                  name_ar: 'عميل جديد',
                  name_en: 'New customer',
                  role_ar: '',
                  role_en: '',
                  quote_ar: '',
                  quote_en: '',
                  rating: 5,
                  avatar_path: null,
                  visible: true,
                }],
              })}
              render={(item: StorefrontTestimonial, index) => (
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className="field" disabled={!canEdit} value={item.name_ar} onChange={(event) => updateConfig({testimonials: config.testimonials.map((row, i) => i === index ? {...row, name_ar: event.target.value} : row)})} placeholder="اسم العميل بالعربية" />
                  <input className="field" dir="ltr" disabled={!canEdit} value={item.name_en} onChange={(event) => updateConfig({testimonials: config.testimonials.map((row, i) => i === index ? {...row, name_en: event.target.value} : row)})} placeholder="Customer name" />
                  <input className="field" disabled={!canEdit} value={item.role_ar} onChange={(event) => updateConfig({testimonials: config.testimonials.map((row, i) => i === index ? {...row, role_ar: event.target.value} : row)})} placeholder="الصفة بالعربية" />
                  <input className="field" dir="ltr" disabled={!canEdit} value={item.role_en} onChange={(event) => updateConfig({testimonials: config.testimonials.map((row, i) => i === index ? {...row, role_en: event.target.value} : row)})} placeholder="Customer role" />
                  <textarea className="field" rows={3} disabled={!canEdit} value={item.quote_ar} onChange={(event) => updateConfig({testimonials: config.testimonials.map((row, i) => i === index ? {...row, quote_ar: event.target.value} : row)})} placeholder="الرأي بالعربية" />
                  <textarea className="field" rows={3} dir="ltr" disabled={!canEdit} value={item.quote_en} onChange={(event) => updateConfig({testimonials: config.testimonials.map((row, i) => i === index ? {...row, quote_en: event.target.value} : row)})} placeholder="Customer review" />
                  <input className="field" type="number" min={1} max={5} disabled={!canEdit} value={item.rating} onChange={(event) => updateConfig({testimonials: config.testimonials.map((row, i) => i === index ? {...row, rating: Math.min(5, Math.max(1, Number(event.target.value)))} : row)})} placeholder="التقييم 1–5" />
                  <input className="field" dir="ltr" disabled={!canEdit} value={item.avatar_path ?? ''} onChange={(event) => updateConfig({testimonials: config.testimonials.map((row, i) => i === index ? {...row, avatar_path: event.target.value || null} : row)})} placeholder="Avatar image URL" />
                  <div className="flex gap-2 sm:col-span-2">
                    <button type="button" disabled={!canEdit} onClick={() => updateConfig({testimonials: config.testimonials.map((row, i) => i === index ? {...row, visible: !row.visible} : row)})} className="field flex-1">
                      {item.visible ? 'ظاهر' : 'مخفي'}
                    </button>
                    <button type="button" disabled={!canEdit} onClick={() => updateConfig({testimonials: config.testimonials.filter((_, i) => i !== index)})} className="rounded-lg border border-red-200 px-3 text-red-700">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            />
          </EditorCard>

          <EditorCard title="الأسئلة الشائعة">
            <ArrayEditor
              items={config.faq_items}
              disabled={!canEdit}
              addLabel="إضافة سؤال"
              onAdd={() => updateConfig({
                faq_items: [...config.faq_items, {
                  id: uid(),
                  question_ar: 'سؤال جديد؟',
                  question_en: 'New question?',
                  answer_ar: '',
                  answer_en: '',
                  visible: true,
                }],
              })}
              render={(item: StorefrontFaqItem, index) => (
                <div className="grid gap-2 sm:grid-cols-2">
                  <input className="field" disabled={!canEdit} value={item.question_ar} onChange={(event) => updateConfig({faq_items: config.faq_items.map((row, i) => i === index ? {...row, question_ar: event.target.value} : row)})} placeholder="السؤال بالعربية" />
                  <input className="field" dir="ltr" disabled={!canEdit} value={item.question_en} onChange={(event) => updateConfig({faq_items: config.faq_items.map((row, i) => i === index ? {...row, question_en: event.target.value} : row)})} placeholder="Question in English" />
                  <textarea className="field" rows={3} disabled={!canEdit} value={item.answer_ar} onChange={(event) => updateConfig({faq_items: config.faq_items.map((row, i) => i === index ? {...row, answer_ar: event.target.value} : row)})} placeholder="الإجابة بالعربية" />
                  <textarea className="field" rows={3} dir="ltr" disabled={!canEdit} value={item.answer_en} onChange={(event) => updateConfig({faq_items: config.faq_items.map((row, i) => i === index ? {...row, answer_en: event.target.value} : row)})} placeholder="Answer in English" />
                  <div className="flex gap-2 sm:col-span-2">
                    <button type="button" disabled={!canEdit} onClick={() => updateConfig({faq_items: config.faq_items.map((row, i) => i === index ? {...row, visible: !row.visible} : row)})} className="field flex-1">
                      {item.visible ? 'ظاهر' : 'مخفي'}
                    </button>
                    <button type="button" disabled={!canEdit} onClick={() => updateConfig({faq_items: config.faq_items.filter((_, i) => i !== index)})} className="rounded-lg border border-red-200 px-3 text-red-700">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            />
          </EditorCard>

          <EditorCard title="أسعار المحافظات ومدد التوصيل">
            <ArrayEditor
              items={config.pricing}
              disabled={!canEdit}
              addLabel="إضافة محافظة"
              onAdd={() => updateConfig({pricing: [...config.pricing, {id: uid(), governorate_name_ar: 'محافظة جديدة', governorate_name_en: 'New governorate', price: 0, delivery_days: '2–3', visible: true}]})}
              render={(item: StorefrontPricingRow, index) => (
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_110px_100px_auto_auto]">
                  <input className="field" disabled={!canEdit} value={item.governorate_name_ar} onChange={(event) => updateConfig({pricing: config.pricing.map((row, i) => i === index ? {...row, governorate_name_ar: event.target.value} : row)})} />
                  <input className="field" dir="ltr" disabled={!canEdit} value={item.governorate_name_en} onChange={(event) => updateConfig({pricing: config.pricing.map((row, i) => i === index ? {...row, governorate_name_en: event.target.value} : row)})} />
                  <input className="field" type="number" min={0} disabled={!canEdit} value={item.price} onChange={(event) => updateConfig({pricing: config.pricing.map((row, i) => i === index ? {...row, price: Number(event.target.value)} : row)})} />
                  <input className="field" dir="ltr" disabled={!canEdit} value={item.delivery_days} onChange={(event) => updateConfig({pricing: config.pricing.map((row, i) => i === index ? {...row, delivery_days: event.target.value} : row)})} />
                  <button type="button" disabled={!canEdit} onClick={() => updateConfig({pricing: config.pricing.map((row, i) => i === index ? {...row, visible: !row.visible} : row)})} className="rounded-lg border border-slate-200 px-2 text-[11px]">{item.visible ? 'ظاهر' : 'مخفي'}</button>
                  <button type="button" disabled={!canEdit} onClick={() => updateConfig({pricing: config.pricing.filter((_, i) => i !== index)})} className="rounded-lg border border-red-200 px-2 text-red-700"><Trash2 className="h-4 w-4" /></button>
                </div>
              )}
            />
          </EditorCard>

          <EditorCard title="CTAs وأقسام المحتوى المخصصة">
            <CtaEditor
              label="CTA الأساسي"
              value={config.cta_primary}
              tenantId={tenantId}
              disabled={!canEdit}
              uploading={uploading === 'cta'}
              onChange={(cta) => updateConfig({cta_primary: cta})}
              onUpload={(event) => void handleUpload('cta', event, (url) => updateConfig({cta_primary: {...config.cta_primary, image_path: url}}))}
            />
            <div className="my-5 border-t border-slate-100" />
            <CtaEditor
              label="CTA الثانوي"
              value={config.cta_secondary}
              tenantId={tenantId}
              disabled={!canEdit}
              uploading={uploading === 'cta'}
              onChange={(cta) => updateConfig({cta_secondary: cta})}
              onUpload={(event) => void handleUpload('cta', event, (url) => updateConfig({cta_secondary: {...config.cta_secondary, image_path: url}}))}
            />

            <div className="mt-6 border-t border-slate-100 pt-5">
              <ArrayEditor
                items={config.custom_sections}
                disabled={!canEdit}
                addLabel="إضافة قسم مخصص"
                onAdd={() => updateConfig({custom_sections: [...config.custom_sections, {id: uid(), title_ar: 'قسم جديد', title_en: 'New section', text_ar: '', text_en: '', image_path: null, image_side: 'right', button_label_ar: '', button_label_en: '', button_url: '', visible: true, layout: 'split', style: 'minimal', animation: 'rise'}]})}
                render={(item: StorefrontCustomSection, index) => (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className="field" disabled={!canEdit} value={item.title_ar} onChange={(event) => updateConfig({custom_sections: config.custom_sections.map((row, i) => i === index ? {...row, title_ar: event.target.value} : row)})} placeholder="العنوان بالعربية" />
                    <input className="field" dir="ltr" disabled={!canEdit} value={item.title_en} onChange={(event) => updateConfig({custom_sections: config.custom_sections.map((row, i) => i === index ? {...row, title_en: event.target.value} : row)})} placeholder="Title in English" />
                    <textarea className="field" rows={3} disabled={!canEdit} value={item.text_ar} onChange={(event) => updateConfig({custom_sections: config.custom_sections.map((row, i) => i === index ? {...row, text_ar: event.target.value} : row)})} placeholder="النص بالعربية" />
                    <textarea className="field" rows={3} dir="ltr" disabled={!canEdit} value={item.text_en} onChange={(event) => updateConfig({custom_sections: config.custom_sections.map((row, i) => i === index ? {...row, text_en: event.target.value} : row)})} placeholder="Text in English" />
                    <input className="field" dir="ltr" disabled={!canEdit} value={item.image_path ?? ''} onChange={(event) => updateConfig({custom_sections: config.custom_sections.map((row, i) => i === index ? {...row, image_path: event.target.value || null} : row)})} placeholder="Image URL or uploaded image" />
                    <select className="field" disabled={!canEdit} value={item.image_side} onChange={(event) => updateConfig({custom_sections: config.custom_sections.map((row, i) => i === index ? {...row, image_side: event.target.value as 'right' | 'left'} : row)})}>
                      <option value="right">الصورة يمين</option>
                      <option value="left">الصورة يسار</option>
                    </select>
                    <select className="field" disabled={!canEdit} value={item.layout ?? 'split'} onChange={(event) => updateConfig({custom_sections: config.custom_sections.map((row, i) => i === index ? {...row, layout: event.target.value as 'split' | 'cards' | 'banner' | 'text'} : row)})}>
                      <option value="split">صورة ونص</option>
                      <option value="cards">بطاقات من النص</option>
                      <option value="banner">لافتة عريضة</option>
                      <option value="text">نص مركزي</option>
                    </select>
                    <select className="field" disabled={!canEdit} value={item.style ?? 'minimal'} onChange={(event) => updateConfig({custom_sections: config.custom_sections.map((row, i) => i === index ? {...row, style: event.target.value as 'minimal' | 'surface' | 'brand' | 'dark'} : row)})}>
                      <option value="minimal">بسيط رسمي</option>
                      <option value="surface">خلفية سطحية</option>
                      <option value="brand">لون الهوية</option>
                      <option value="dark">داكن</option>
                    </select>
                    <select className="field" disabled={!canEdit} value={item.animation ?? 'rise'} onChange={(event) => updateConfig({custom_sections: config.custom_sections.map((row, i) => i === index ? {...row, animation: event.target.value as 'none' | 'fade' | 'rise'} : row)})}>
                      <option value="none">بدون أنيميشن</option>
                      <option value="fade">ظهور هادئ</option>
                      <option value="rise">ظهور وتصاعد</option>
                    </select>
                    <input className="field" disabled={!canEdit} value={item.button_label_ar} onChange={(event) => updateConfig({custom_sections: config.custom_sections.map((row, i) => i === index ? {...row, button_label_ar: event.target.value} : row)})} placeholder="اسم الزر بالعربية" />
                    <input className="field" dir="ltr" disabled={!canEdit} value={item.button_url} onChange={(event) => updateConfig({custom_sections: config.custom_sections.map((row, i) => i === index ? {...row, button_url: event.target.value} : row)})} placeholder="Button URL" />
                    <div className="flex gap-2 sm:col-span-2">
                      <button type="button" disabled={!canEdit} onClick={() => updateConfig({custom_sections: config.custom_sections.map((row, i) => i === index ? {...row, visible: !row.visible} : row)})} className="field flex-1">{item.visible ? 'ظاهر' : 'مخفي'}</button>
                      <button type="button" disabled={!canEdit} onClick={() => updateConfig({custom_sections: config.custom_sections.filter((_, i) => i !== index)})} className="rounded-lg border border-red-200 px-3 text-red-700"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                )}
              />
            </div>
          </EditorCard>

          <EditorCard title="التتبع والتواصل والسوشيال وفوتر">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="نص تتبع الشحنة بالعربية"><input className="field" disabled={!canEdit} value={config.tracking_placeholder_ar} onChange={(event) => updateConfig({tracking_placeholder_ar: event.target.value})} /></Field>
              <Field label="Tracking placeholder"><input className="field" dir="ltr" disabled={!canEdit} value={config.tracking_placeholder_en} onChange={(event) => updateConfig({tracking_placeholder_en: event.target.value})} /></Field>
              <Field label="زر التتبع بالعربية"><input className="field" disabled={!canEdit} value={config.tracking_button_ar} onChange={(event) => updateConfig({tracking_button_ar: event.target.value})} /></Field>
              <Field label="Tracking button"><input className="field" dir="ltr" disabled={!canEdit} value={config.tracking_button_en} onChange={(event) => updateConfig({tracking_button_en: event.target.value})} /></Field>
              <Field label="نص الفوتر بالعربية"><textarea className="field" rows={2} disabled={!canEdit} value={config.footer_text_ar} onChange={(event) => updateConfig({footer_text_ar: event.target.value})} /></Field>
              <Field label="Footer in English"><textarea className="field" rows={2} dir="ltr" disabled={!canEdit} value={config.footer_text_en} onChange={(event) => updateConfig({footer_text_en: event.target.value})} /></Field>
            </div>

            <div className="mt-5">
              <ArrayEditor
                items={config.social_links}
                disabled={!canEdit}
                addLabel="إضافة حساب اجتماعي"
                onAdd={() => updateConfig({social_links: [...config.social_links, {id: uid(), platform: 'facebook', url: '', visible: true}]})}
                render={(item: StorefrontSocialLink, index) => (
                  <div className="grid gap-2 sm:grid-cols-[160px_1fr_auto_auto]">
                    <select className="field" disabled={!canEdit} value={item.platform} onChange={(event) => updateConfig({social_links: config.social_links.map((row, i) => i === index ? {...row, platform: event.target.value as StorefrontSocialLink['platform']} : row)})}>
                      <option value="facebook">Facebook</option>
                      <option value="instagram">Instagram</option>
                      <option value="twitter">X / Twitter</option>
                      <option value="linkedin">LinkedIn</option>
                      <option value="youtube">YouTube</option>
                      <option value="tiktok">TikTok</option>
                      <option value="whatsapp">WhatsApp</option>
                    </select>
                    <input className="field" dir="ltr" disabled={!canEdit} value={item.url} onChange={(event) => updateConfig({social_links: config.social_links.map((row, i) => i === index ? {...row, url: event.target.value} : row)})} placeholder="https://..." />
                    <button type="button" disabled={!canEdit} onClick={() => updateConfig({social_links: config.social_links.map((row, i) => i === index ? {...row, visible: !row.visible} : row)})} className="rounded-lg border border-slate-200 px-2 text-[11px]">{item.visible ? 'ظاهر' : 'مخفي'}</button>
                    <button type="button" disabled={!canEdit} onClick={() => updateConfig({social_links: config.social_links.filter((_, i) => i !== index)})} className="rounded-lg border border-red-200 px-2 text-red-700"><Trash2 className="h-4 w-4" /></button>
                  </div>
                )}
              />
            </div>
            <div className="mt-5 border-t border-slate-100 pt-5">
              <ArrayEditor
                items={config.contact_accounts}
                disabled={!canEdit}
                addLabel="إضافة رقم أو حساب تواصل"
                onAdd={() => updateConfig({contact_accounts: [...config.contact_accounts, {id: uid(), kind: 'phone', label_ar: 'الهاتف', label_en: 'Phone', value: '', visible: true}]})}
                render={(item, index) => (
                  <div className="grid gap-2 sm:grid-cols-[120px_1fr_1fr_1fr_auto_auto]">
                    <select
                      className="field"
                      disabled={!canEdit}
                      value={item.kind}
                      onChange={(event) => updateConfig({contact_accounts: config.contact_accounts.map((row, i) => i === index ? {...row, kind: event.target.value as 'phone' | 'email' | 'whatsapp'} : row)})}
                    >
                      <option value="phone">هاتف</option>
                      <option value="email">بريد</option>
                      <option value="whatsapp">واتساب</option>
                    </select>
                    <input className="field" disabled={!canEdit} value={item.label_ar} onChange={(event) => updateConfig({contact_accounts: config.contact_accounts.map((row, i) => i === index ? {...row, label_ar: event.target.value} : row)})} placeholder="اسم الحساب" />
                    <input className="field" dir="ltr" disabled={!canEdit} value={item.label_en} onChange={(event) => updateConfig({contact_accounts: config.contact_accounts.map((row, i) => i === index ? {...row, label_en: event.target.value} : row)})} placeholder="Account name" />
                    <input className="field" dir="ltr" disabled={!canEdit} value={item.value} onChange={(event) => updateConfig({contact_accounts: config.contact_accounts.map((row, i) => i === index ? {...row, value: event.target.value} : row)})} placeholder="Phone / email / WhatsApp" />
                    <button type="button" disabled={!canEdit} onClick={() => updateConfig({contact_accounts: config.contact_accounts.map((row, i) => i === index ? {...row, visible: !row.visible} : row)})} className="rounded-lg border border-slate-200 px-2 text-[11px]">{item.visible ? 'ظاهر' : 'مخفي'}</button>
                    <button type="button" disabled={!canEdit} onClick={() => updateConfig({contact_accounts: config.contact_accounts.filter((_, i) => i !== index)})} className="rounded-lg border border-red-200 px-2 text-red-700"><Trash2 className="h-4 w-4" /></button>
                  </div>
                )}
              />
            </div>
          </EditorCard>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            <div className="border-b border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-900">معاينة سريعة</div>
            <div style={{...cssVars, fontFamily: fontStack(draft.font_family)}} className="p-3">
              <div
                className="relative min-h-52 overflow-hidden rounded-lg border border-slate-200"
                style={{
                  backgroundColor: draft.secondary_color,
                  backgroundImage: draft.hero_image_path ? `linear-gradient(rgba(15,23,42,${config.hero_overlay_opacity}),rgba(15,23,42,${config.hero_overlay_opacity})), url(${draft.hero_image_path})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                <div className="relative flex min-h-52 flex-col justify-center p-5 text-white">
                  <p className="text-[10px] font-bold" style={{color: draft.accent_color}}>معاينة الموقع الرسمي</p>
                  <h3 className="mt-2 max-w-56 text-xl font-extrabold leading-tight">
                    {(config.default_locale === 'ar' ? config.hero_title_ar : config.hero_title_en) || tenantName}
                  </h3>
                  <p className="mt-2 max-w-64 text-[11px] leading-5 text-white/85">
                    {(config.default_locale === 'ar' ? config.hero_subtitle_ar : config.hero_subtitle_en) || 'عنوان فرعي قابل للتحرير'}
                  </p>
                  <button type="button" className="mt-4 w-fit rounded-md px-3 py-2 text-[10px] font-bold" style={{backgroundColor: draft.primary_color, color: previewText}}>
                    {config.tracking_button_ar}
                  </button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {config.features.filter((feature) => feature.visible).slice(0, 3).map((feature) => (
                  <div key={feature.id} className="rounded-lg border border-slate-200 bg-white p-2">
                    <p className="text-[9px] font-bold text-slate-900">{config.default_locale === 'ar' ? feature.title_ar : feature.title_en}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            disabled={!canEdit || saving || validation.errors.length > 0}
            onClick={() => void save()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {saving ? 'جاري النشر...' : 'حفظ ونشر إعدادات الموقع'}
          </button>
        </aside>
      </div>

      <button
        type="button"
        disabled={!canEdit || saving || validation.errors.length > 0}
        onClick={() => void save()}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60 xl:hidden"
      >
        <Save className="h-4 w-4" />
        {saving ? 'جاري النشر...' : 'حفظ ونشر إعدادات الموقع'}
      </button>
    </section>
  );
}

function EditorCard({title, children}: {title: string; children: ReactNode}) {
  return (
    <section className="rounded-xl border border-slate-200 p-4 sm:p-5">
      <h3 className="text-xs font-semibold text-slate-900">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Field({label, children}: {label: string; children: ReactNode}) {
  return (
    <label className="block text-[11px] font-medium text-slate-700">
      {label}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-[11px] font-medium text-slate-700">
      {label}: <span className="font-mono-tabular">{value}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-slate-900"
      />
    </label>
  );
}

function AssetField({
  label,
  value,
  uploading,
  disabled,
  onUrl,
  onUpload,
}: {
  label: string;
  value: string | null;
  uploading: boolean;
  disabled: boolean;
  onUrl: (value: string) => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-[11px] font-semibold text-slate-700">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" disabled={disabled || uploading} onChange={onUpload} className="hidden" />
        <button type="button" disabled={disabled || uploading} onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[11px] text-slate-700 disabled:opacity-60">
          <Upload className="h-3.5 w-3.5" />
          {uploading ? 'جاري الرفع...' : 'رفع صورة'}
        </button>
        <button type="button" disabled={disabled} onClick={() => onUrl('')} className="rounded-lg px-2 py-2 text-[11px] text-red-700">إزالة</button>
      </div>
      {value && (
        <div className="mt-2 flex items-center gap-2">
          <img src={value} alt="" className="h-10 w-10 rounded border border-slate-200 object-contain" />
          <span className="max-w-48 truncate font-mono-tabular text-[9px] text-slate-500">{value}</span>
        </div>
      )}
    </div>
  );
}

function ArrayEditor<T>({
  items,
  disabled,
  addLabel,
  onAdd,
  render,
}: {
  items: readonly T[];
  disabled: boolean;
  addLabel: string;
  onAdd: () => void;
  render: (item: T, index: number) => ReactNode;
}) {
  return (
    <div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
            {render(item, index)}
          </div>
        ))}
      </div>
      <button type="button" disabled={disabled} onClick={onAdd} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[11px] font-medium text-slate-700 disabled:opacity-60">
        <Plus className="h-3.5 w-3.5" />
        {addLabel}
      </button>
    </div>
  );
}

function CtaEditor({
  label,
  value,
  tenantId,
  disabled,
  uploading,
  onChange,
  onUpload,
}: {
  label: string;
  value: {
    title_ar: string;
    title_en: string;
    text_ar: string;
    text_en: string;
    button_label_ar: string;
    button_label_en: string;
    button_url: string;
    image_path: string | null;
    image_side: 'right' | 'left';
    visible: boolean;
  };
  tenantId: string;
  disabled: boolean;
  uploading: boolean;
  onChange: (value: StorefrontCta) => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  void tenantId;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-semibold text-slate-800">{label}</p>
        <button type="button" disabled={disabled} onClick={() => onChange({...value, visible: !value.visible})} className="rounded-lg border border-slate-200 px-2 py-1 text-[10px]">
          {value.visible ? 'ظاهر' : 'مخفي'}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="field" disabled={disabled} value={value.title_ar} onChange={(event) => onChange({...value, title_ar: event.target.value})} placeholder="العنوان بالعربية" />
        <input className="field" dir="ltr" disabled={disabled} value={value.title_en} onChange={(event) => onChange({...value, title_en: event.target.value})} placeholder="Title in English" />
        <textarea className="field" rows={2} disabled={disabled} value={value.text_ar} onChange={(event) => onChange({...value, text_ar: event.target.value})} placeholder="النص بالعربية" />
        <textarea className="field" rows={2} dir="ltr" disabled={disabled} value={value.text_en} onChange={(event) => onChange({...value, text_en: event.target.value})} placeholder="Text in English" />
        <input className="field" disabled={disabled} value={value.button_label_ar} onChange={(event) => onChange({...value, button_label_ar: event.target.value})} placeholder="اسم الزر بالعربية" />
        <input className="field" dir="ltr" disabled={disabled} value={value.button_label_en} onChange={(event) => onChange({...value, button_label_en: event.target.value})} placeholder="Button label" />
        <input className="field" dir="ltr" disabled={disabled} value={value.button_url} onChange={(event) => onChange({...value, button_url: event.target.value})} placeholder="https://... أو #tracking" />
        <select className="field" disabled={disabled} value={value.image_side} onChange={(event) => onChange({...value, image_side: event.target.value as 'right' | 'left'})}>
          <option value="right">الصورة يمين</option>
          <option value="left">الصورة يسار</option>
        </select>
        <div className="flex items-center gap-2 sm:col-span-2">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/svg+xml" disabled={disabled || uploading} onChange={onUpload} className="hidden" />
          <button type="button" disabled={disabled || uploading} onClick={() => inputRef.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[11px]">
            <Upload className="h-3.5 w-3.5" /> {uploading ? 'جاري الرفع...' : 'رفع صورة CTA'}
          </button>
          {value.image_path && <button type="button" disabled={disabled} onClick={() => onChange({...value, image_path: null})} className="text-[11px] text-red-700">إزالة الصورة</button>}
        </div>
      </div>
    </div>
  );
}
