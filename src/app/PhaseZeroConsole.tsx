import {useMemo, useState} from 'react';
import {Link} from 'react-router-dom';
import {BRAND_CONFIG, buildTenantBasePath} from '@/config/brand';
import {assertNoServerSecretsInClientEnv} from '@/config/env';
import {formatCurrency, formatDateTime, formatWeightKg} from '@/lib/formatters';
import {getSupabaseReadiness} from '@/lib/supabase/client';
import {PhaseStatus} from '@/types/common';
import {
  APPROVED_DECISIONS,
  OPEN_QUESTIONS_LIST,
  ROADMAP_PHASES,
} from '@/app/phaseRoadmapData';
import {CheckCircle2, Clock3, Lock, Search, ShieldCheck} from 'lucide-react';

type ActiveTab = 'overview' | 'roadmap' | 'decisions' | 'readiness';
type RoadmapFilter = 'all' | 'ready' | 'blocked' | 'pending';
type DecisionSubTab = 'approved' | 'open';

function getPhaseStatusLabel(status: PhaseStatus): {
  label: string;
  textClass: string;
  icon: 'check' | 'lock' | 'clock';
} {
  switch (status) {
    case PhaseStatus.READY_FOR_OWNER_REVIEW:
      return {
        label: 'جاهزة لمراجعة المالك',
        textClass: 'text-emerald-700',
        icon: 'check',
      };
    case PhaseStatus.APPROVED:
      return {
        label: 'معتمدة',
        textClass: 'text-emerald-700',
        icon: 'check',
      };
    case PhaseStatus.BLOCKED_BY_OPEN_QUESTION:
      return {
        label: 'معلّقة على قرارات مفتوحة',
        textClass: 'text-amber-700',
        icon: 'lock',
      };
    case PhaseStatus.IN_PROGRESS:
      return {
        label: 'قيد التنفيذ',
        textClass: 'text-sky-700',
        icon: 'clock',
      };
    case PhaseStatus.PENDING:
    default:
      return {
        label: 'بانتظار دورها',
        textClass: 'text-slate-600',
        icon: 'clock',
      };
  }
}

export function PhaseZeroConsole() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [roadmapFilter, setRoadmapFilter] = useState<RoadmapFilter>('all');
  const [roadmapSearch, setRoadmapSearch] = useState('');
  const [decisionTab, setDecisionTab] = useState<DecisionSubTab>('approved');
  const [decisionSearch, setDecisionSearch] = useState('');
  const [secretAuditResult, setSecretAuditResult] = useState<string | null>(null);

  const readiness = useMemo(() => getSupabaseReadiness(), []);

  const filteredPhases = useMemo(() => {
    const query = roadmapSearch.trim().toLowerCase();
    return ROADMAP_PHASES.filter((phase) => {
      if (roadmapFilter === 'ready' && phase.status !== PhaseStatus.READY_FOR_OWNER_REVIEW) {
        return false;
      }
      if (roadmapFilter === 'blocked' && phase.status !== PhaseStatus.BLOCKED_BY_OPEN_QUESTION) {
        return false;
      }
      if (roadmapFilter === 'pending' && phase.status !== PhaseStatus.PENDING) {
        return false;
      }
      if (!query) {
        return true;
      }
      return (
        phase.title.toLowerCase().includes(query) ||
        phase.summary.toLowerCase().includes(query) ||
        String(phase.phaseNumber) === query
      );
    });
  }, [roadmapFilter, roadmapSearch]);

  const filteredOpenQuestions = useMemo(() => {
    const query = decisionSearch.trim().toLowerCase();
    if (!query) {
      return OPEN_QUESTIONS_LIST;
    }
    return OPEN_QUESTIONS_LIST.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.summary.toLowerCase().includes(query) ||
        item.blockingPhase.toLowerCase().includes(query),
    );
  }, [decisionSearch]);

  const handleRunSecretAudit = () => {
    try {
      const clientEnv =
        typeof import.meta !== 'undefined' && import.meta.env
          ? (import.meta.env as Record<string, unknown>)
          : {};
      assertNoServerSecretsInClientEnv(clientEnv);
      setSecretAuditResult('تم التحقق: لا توجد مفاتيح سرية خادمية (service_role) مكشوفة في حزمة الواجهة.');
    } catch (error) {
      setSecretAuditResult(
        error instanceof Error ? error.message : 'تم رصد مخالفة أمان في متغيرات البيئة.',
      );
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Bar Contract: Single row, 3 balanced zones */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-4">
          <Link
            to="/"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 hover:text-slate-700"
          >
            {BRAND_CONFIG.appName}
          </Link>

          <nav aria-label="التنقل الرئيسي" className="flex items-center gap-6 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('overview')}
              className={`border-b-2 pb-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'overview'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              نظرة عامة
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('roadmap')}
              className={`border-b-2 pb-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'roadmap'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              خارطة المراحل
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('decisions')}
              className={`border-b-2 pb-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'decisions'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              القرارات
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('readiness')}
              className={`border-b-2 pb-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'readiness'
                  ? 'border-slate-900 text-slate-900'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              جاهزية البيئة
            </button>
          </nav>

          <button
            type="button"
            onClick={() => setActiveTab('readiness')}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            فحص الجاهزية
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {activeTab === 'overview' && (
          <section aria-labelledby="overview-heading" className="space-y-8">
            <div className="border-b border-slate-200 pb-6">
              <p className="text-xs font-medium text-slate-500">
                المرحلة 0 · التأسيس والبيئات والاختبارات والهيكل
              </p>
              <h1 id="overview-heading" className="mt-2 text-2xl font-bold text-slate-900">
                {BRAND_CONFIG.appName} — {BRAND_CONFIG.appTagline}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
                تم إعداد البنية المرجعية للتطبيق باستخدام React 19 وTypeScript الصارم وTailwind CSS
                بالاتجاه العربي RTL، مع توثيق المرجع الرئيسي للمواصفات وسجلات القرارات وهيكل مجلدات
                Supabase دون إنشاء جداول أو بيانات إنتاج في هذه المرحلة.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-medium text-slate-500">البنية المعتمدة</p>
                <p className="mt-2 text-base font-semibold text-slate-900">Supabase BaaS + RLS</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  قاعدة بيانات PostgreSQL ومصادقة Auth وتخزين خاص ومنطق خادمي عبر Edge Functions.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-medium text-slate-500">مسار الشركات المبدئي</p>
                <p className="mt-2 font-mono-tabular text-base font-semibold text-slate-900" dir="ltr">
                  {buildTenantBasePath('company-slug')}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  عزل مسار كل شركة عبر المعرّف النصي قبل تفعيل النطاقات المخصصة في المرحلة 15.
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-medium text-slate-500">تنسيق الأرقام والعملة الافتراضي</p>
                <p className="mt-2 font-mono-tabular text-base font-semibold text-slate-900">
                  {formatCurrency(1250.5)} · {formatWeightKg(3.25)}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  توقيت الشركة الافتراضي: {BRAND_CONFIG.defaultTimezone} ·{' '}
                  <span className="tabular-nums">
                    {formatDateTime('2026-11-18T12:00:00Z')}
                  </span>
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-base font-semibold text-slate-900">التطبيقات الخمسة في المنصة</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-right text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                      <th className="py-2.5 pl-4">التطبيق</th>
                      <th className="py-2.5 pl-4">الجمهور المستهدف</th>
                      <th className="py-2.5">الوظائف المحورية</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="py-3 pl-4 font-medium text-slate-900">المنصة المركزية</td>
                      <td className="py-3 pl-4 text-slate-600">إدارة المنصة والدعم المراقب</td>
                      <td className="py-3 text-slate-600">تأسيس شركات الشحن، الباقات، الحدود، والنطاقات.</td>
                    </tr>
                    <tr>
                      <td className="py-3 pl-4 font-medium text-slate-900">موقع الشركة العام</td>
                      <td className="py-3 pl-4 text-slate-600">الزوار والتجار الجدد</td>
                      <td className="py-3 text-slate-600">التعريف بالخدمات، التتبع العام المحدود، وتسجيل العملاء.</td>
                    </tr>
                    <tr>
                      <td className="py-3 pl-4 font-medium text-slate-900">لوحة إدارة الشركة</td>
                      <td className="py-3 pl-4 text-slate-600">المالك والموظفون والمحاسبون</td>
                      <td className="py-3 text-slate-600">التعريفات، الأسعار، الشحنات، قوائم التشغيل، والمحاسبة.</td>
                    </tr>
                    <tr>
                      <td className="py-3 pl-4 font-medium text-slate-900">بوابة العميل</td>
                      <td className="py-3 pl-4 text-slate-600">التاجر وفريقه</td>
                      <td className="py-3 text-slate-600">إنشاء الشحنات، استيراد Excel، الالتقاط، وكشف الحساب.</td>
                    </tr>
                    <tr>
                      <td className="py-3 pl-4 font-medium text-slate-900">بوابة المندوب</td>
                      <td className="py-3 pl-4 text-slate-600">مندوبو التوصيل</td>
                      <td className="py-3 text-slate-600">مهام اليوم، خطوط السير، إثبات التسليم، وتوريد العهدة.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'roadmap' && (
          <section aria-labelledby="roadmap-heading" className="space-y-6">
            <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 id="roadmap-heading" className="text-xl font-bold text-slate-900">
                  خارطة التنفيذ المرحلية (0 – 17)
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  لا تبدأ أي مرحلة تالية قبل مراجعة المالك وتأكيده بكلمة «تم»، وحسم القرارات المفتوحة المرتبطة بها.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
                  <input
                    type="search"
                    value={roadmapSearch}
                    onChange={(event) => setRoadmapSearch(event.target.value)}
                    placeholder="ابحث برقم أو اسم المرحلة..."
                    aria-label="بحث في المراحل"
                    className="w-64 rounded-lg border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="تصفية حالة المراحل">
                  <button
                    type="button"
                    onClick={() => setRoadmapFilter('all')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      roadmapFilter === 'all'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    الكل ({ROADMAP_PHASES.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoadmapFilter('ready')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      roadmapFilter === 'ready'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    جاهز للمراجعة
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoadmapFilter('blocked')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      roadmapFilter === 'blocked'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    بانتظار قرارات
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoadmapFilter('pending')}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      roadmapFilter === 'pending'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    قادم
                  </button>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-right text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                      <th className="px-4 py-3">المرحلة</th>
                      <th className="px-4 py-3">العنوان</th>
                      <th className="px-4 py-3">النطاق الرئيسي</th>
                      <th className="px-4 py-3">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredPhases.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-sm text-slate-500">
                          لا توجد مراحل مطابقة لمعايير البحث الحالية.
                        </td>
                      </tr>
                    ) : (
                      filteredPhases.map((phase) => {
                        const statusInfo = getPhaseStatusLabel(phase.status);
                        return (
                          <tr key={phase.phaseNumber} className="hover:bg-slate-50">
                            <td className="px-4 py-3 font-mono-tabular font-medium text-slate-900">
                              {phase.phaseNumber}
                            </td>
                            <td className="px-4 py-3 font-medium text-slate-900">{phase.title}</td>
                            <td className="px-4 py-3 text-slate-600">{phase.summary}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${statusInfo.textClass}`}>
                                {statusInfo.icon === 'check' && <CheckCircle2 className="h-3.5 w-3.5" />}
                                {statusInfo.icon === 'lock' && <Lock className="h-3.5 w-3.5" />}
                                {statusInfo.icon === 'clock' && <Clock3 className="h-3.5 w-3.5" />}
                                {statusInfo.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {activeTab === 'decisions' && (
          <section aria-labelledby="decisions-heading" className="space-y-6">
            <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 id="decisions-heading" className="text-xl font-bold text-slate-900">
                  سجل القرارات المعتمدة والمفتوحة
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  المرجع الموثق في <span className="font-mono-tabular text-xs">docs/decisions/</span> لمنع افتراض أي قاعدة غير معتمدة.
                </p>
              </div>

              <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setDecisionTab('approved')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    decisionTab === 'approved'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  القرارات المعتمدة ({APPROVED_DECISIONS.length})
                </button>
                <button
                  type="button"
                  onClick={() => setDecisionTab('open')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    decisionTab === 'open'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  القرارات المفتوحة ({OPEN_QUESTIONS_LIST.length})
                </button>
              </div>
            </div>

            {decisionTab === 'approved' ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {APPROVED_DECISIONS.map((item) => (
                  <article key={item.code} className="rounded-xl border border-slate-200 bg-white p-5">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-medium text-emerald-700">معتمد</span>
                    </div>
                    <h2 className="mt-2 text-base font-semibold text-slate-900">{item.title}</h2>
                    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{item.decision}</p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative max-w-sm">
                  <Search className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
                  <input
                    type="search"
                    value={decisionSearch}
                    onChange={(event) => setDecisionSearch(event.target.value)}
                    placeholder="ابحث في القرارات المفتوحة..."
                    aria-label="بحث في القرارات المفتوحة"
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
                  />
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <table className="w-full border-collapse text-right text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                        <th className="px-4 py-3">البند المفتوح</th>
                        <th className="px-4 py-3">المرحلة المرتبطة</th>
                        <th className="px-4 py-3">التفاصيل المطلوب حسمها</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredOpenQuestions.map((oq) => (
                        <tr key={oq.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-900">{oq.title}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-amber-700">{oq.blockingPhase}</td>
                          <td className="px-4 py-3 text-slate-600">{oq.summary}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === 'readiness' && (
          <section aria-labelledby="readiness-heading" className="space-y-6">
            <div className="border-b border-slate-200 pb-5">
              <h1 id="readiness-heading" className="text-xl font-bold text-slate-900">
                فحص جاهزية البيئة والأمان — المرحلة 0
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                التحقق من إعدادات الاتجاه العربي RTL، مركزية الهوية، وعدم وجود أي مفاتيح سرية خادمية في الواجهة.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-semibold text-slate-900">إعدادات التطبيق والاتجاه</h2>
                <dl className="mt-4 space-y-2.5 text-sm">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <dt className="text-slate-500">اسم المنصة المركزي</dt>
                    <dd className="font-medium text-slate-900">{BRAND_CONFIG.appName}</dd>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <dt className="text-slate-500">الاتجاه واللغة</dt>
                    <dd className="font-mono-tabular text-slate-900">
                      {BRAND_CONFIG.defaultDirection} / {BRAND_CONFIG.defaultLanguage}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <dt className="text-slate-500">العملة والمنطقة الزمنية</dt>
                    <dd className="font-mono-tabular text-slate-900">
                      {BRAND_CONFIG.defaultCurrency} · {BRAND_CONFIG.defaultTimezone}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">حالة Supabase (عميل الواجهة العام)</dt>
                    <dd className="text-slate-700">
                      {readiness.configured
                        ? 'مهيأ (عميل Supabase العام نشط)'
                        : 'غير مهيأ في متغيرات البيئة'}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5">
                <h2 className="text-sm font-semibold text-slate-900">فحص عزل الأسرار الخادمية</h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  يتأكد الفحص التالي من خلو متغيرات الواجهة (`import.meta.env`) من أي مفتاح سري مثل
                  <span className="font-mono-tabular"> SERVICE_ROLE_KEY</span>.
                </p>
                <button
                  type="button"
                  onClick={handleRunSecretAudit}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800"
                >
                  <ShieldCheck className="h-4 w-4" />
                  تشغيل فحص متغيرات الواجهة
                </button>
                {secretAuditResult && (
                  <p role="status" className="mt-3 text-xs font-medium text-emerald-700">
                    {secretAuditResult}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
