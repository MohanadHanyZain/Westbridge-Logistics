import {useEffect, useState, type FormEvent, type ReactNode} from 'react';
import {Link, Navigate, useNavigate} from 'react-router-dom';
import {useTenantSlug} from '@/lib/tenant/TenantRuntimeContext';
import {BRAND_CONFIG, buildTenantBasePath} from '@/config/brand';
import {useAuth} from '@/lib/auth';
import {getSupabaseClient} from '@/lib/supabase/client';
import {fetchPublicTenantBySlug} from '@/features/tenants/tenantService';
import {
  brandCssVars,
  fontStack,
  getTenantBranding,
  normalizePublicBranding,
} from '@/features/tenants/brandingService';
import type {PublicTenantInfo} from '@/types/tenant';
import type {PublicTenantBranding} from '@/types/tenantBranding';
import {FloatingField} from '@/components/ui/FloatingField';
import {BrandSpinner, PageLoader} from '@/components/ui/LoadingState';
import {KeyRound} from 'lucide-react';

const AUTH_CARD_CLASS =
  'w-full max-w-[400px] rounded-2xl border border-slate-200/80 bg-white p-7 shadow-[0_18px_50px_-32px_rgba(15,23,42,0.45)]';

function AuthBrandMark({
  logoPath,
  name,
  fallbackColor,
}: {
  readonly logoPath: string | null;
  readonly name: string;
  readonly fallbackColor: string;
}) {
  if (logoPath) {
    return <img src={logoPath} alt={name} className="h-12 w-auto max-w-[160px] object-contain" />;
  }
  return (
    <span
      className="flex h-12 w-12 items-center justify-center rounded-xl text-sm font-black"
      style={{backgroundColor: fallbackColor, color: '#ffffff'}}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function PlatformLoginPage() {
  const navigate = useNavigate();
  const {signIn, platformAdmin, loading, isConfigured} = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && platformAdmin?.is_active) {
    return <Navigate to="/platform" replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn({
        scope: 'platform',
        username,
        password,
      });
      navigate('/platform', {replace: true});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'اسم المستخدم أو كلمة المرور غير صحيحة.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f2f4f7] px-5 py-10">
      <div className={AUTH_CARD_CLASS}>
        <div className="flex flex-col items-center text-center">
          <AuthBrandMark logoPath={null} name={BRAND_CONFIG.appName} fallbackColor="#ef6a47" />
          <p className="mt-4 text-sm font-extrabold text-slate-900">{BRAND_CONFIG.appName}</p>
          <h1 className="mt-1 text-lg font-extrabold text-slate-900">تسجيل دخول إدارة المنصة</h1>
        </div>

        {!isConfigured && (
          <p role="alert" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            لم يتم تهيئة متغيرات اتصال Supabase في البيئة بعد.
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-3.5">
          <FloatingField
            id="platform-username"
            label="اسم المستخدم"
            type="text"
            required
            dir="ltr"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <FloatingField
            id="platform-password"
            label="كلمة المرور"
            type="password"
            required
            dir="ltr"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && (
            <p role="alert" className="text-xs font-semibold text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !isConfigured}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#ef6a47] px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#d95537] disabled:opacity-60"
          >
            {submitting ? <BrandSpinner size="sm" className="app-spinner-on-brand" /> : null}
            {submitting ? 'جارٍ التحقق' : 'دخول'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function TenantLoginPage() {
  const companySlug = useTenantSlug();
  const navigate = useNavigate();
  const {signIn, memberships, loading, isConfigured} = useAuth();
  const [tenant, setTenant] = useState<PublicTenantInfo | null>(null);
  const [branding, setBranding] = useState<PublicTenantBranding | null>(null);
  const [tenantLoading, setTenantLoading] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanSlug = companySlug.trim().toLowerCase();
  const basePath = buildTenantBasePath(cleanSlug);

  useEffect(() => {
    let active = true;
    setTenantLoading(true);
    fetchPublicTenantBySlug(cleanSlug)
      .then((data) => {
        if (active) {
          setTenant(data);
        }
      })
      .finally(() => {
        if (active) {
          setTenantLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [cleanSlug]);

  useEffect(() => {
    if (!tenant) return;
    let active = true;
    void getTenantBranding(tenant.id)
      .then((data) => {
        if (active) setBranding(normalizePublicBranding(data));
      })
      .catch(() => {
        if (active) setBranding(normalizePublicBranding(null));
      });
    return () => {
      active = false;
    };
  }, [tenant]);

  const hasMembershipForTenant = memberships.some(
    (m) => m.tenants?.slug === cleanSlug && m.is_active,
  );

  if (!loading && hasMembershipForTenant) {
    return <Navigate to={`${basePath}/app`} replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn({
        scope: 'tenant',
        tenantSlug: cleanSlug,
        username,
        password,
      });
      navigate(`${basePath}/app`, {replace: true});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'اسم المستخدم أو كلمة المرور غير صحيحة.');
    } finally {
      setSubmitting(false);
    }
  };

  if (tenantLoading) {
    return <PageLoader label="جارٍ التحقق من بوابة الشركة" />;
  }

  if (!tenant) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f2f4f7] px-5">
        <div className={`${AUTH_CARD_CLASS} text-center`}>
          <h1 className="text-lg font-bold text-slate-900">الشركة غير موجودة أو موقوفة</h1>
          <p className="mt-2 text-sm text-slate-600">تأكد من صحة رابط شركة الشحن قبل تسجيل الدخول.</p>
          <Link
            to="/"
            className="mt-5 inline-block rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white"
          >
            العودة للرئيسية
          </Link>
        </div>
      </div>
    );
  }

  const activeBranding = branding ?? normalizePublicBranding(null);
  const brandVars = brandCssVars(activeBranding);
  const brandColor = activeBranding.primary_color;

  return (
    <div
      style={{
        ...brandVars,
        fontFamily: fontStack(activeBranding.font_family),
        backgroundColor: 'color-mix(in srgb, var(--tenant-brand) 6%, #f2f4f7)',
      }}
      className="flex min-h-screen items-center justify-center px-5 py-10"
    >
      <div className={AUTH_CARD_CLASS}>
        <div className="flex flex-col items-center text-center">
          <AuthBrandMark
            logoPath={activeBranding.logo_path ?? tenant.brand_logo_path}
            name={tenant.name}
            fallbackColor={brandColor}
          />
          <p className="mt-4 text-sm font-extrabold text-slate-900">{tenant.name}</p>
          <h1 className="mt-1 text-lg font-extrabold text-slate-900">تسجيل الدخول إلى النظام</h1>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-3.5">
          <FloatingField
            id="tenant-username"
            label="اسم المستخدم"
            type="text"
            required
            dir="ltr"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <FloatingField
            id="tenant-password"
            label="كلمة المرور"
            type="password"
            required
            dir="ltr"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && (
            <p role="alert" className="text-xs font-semibold text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !isConfigured}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-60"
            style={{backgroundColor: brandColor}}
          >
            {submitting ? <BrandSpinner size="sm" className="app-spinner-on-brand" /> : null}
            {submitting ? 'جارٍ الدخول' : 'دخول'}
          </button>
        </form>

        <p className="mt-5 text-center text-[11px] font-medium text-slate-400">
          بوابة {tenant.name}
        </p>
      </div>
    </div>
  );
}

export function SetPasswordPage() {
  const {session, loading} = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFeedback(null);

    if (password.length < 8) {
      setFeedback({type: 'error', text: 'كلمة المرور يجب أن لا تقل عن 8 أحرف.'});
      return;
    }

    if (password !== confirmPassword) {
      setFeedback({type: 'error', text: 'كلمتا المرور غير متطابقتين.'});
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      setFeedback({type: 'error', text: 'اتصال Supabase غير مهيأ.'});
      return;
    }

    setSaving(true);
    try {
      const {error} = await client.auth.updateUser({password});
      if (error) {
        setFeedback({type: 'error', text: 'تعذر تعيين كلمة المرور. تأكد من صلاحية رابط التفعيل.'});
        return;
      }
      setFeedback({
        type: 'success',
        text: 'تم تعيين كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول إلى بوابة شركتك.',
      });
      setPassword('');
      setConfirmPassword('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f2f4f7] px-5 py-10">
      <div className={AUTH_CARD_CLASS}>
        <div className="flex flex-col items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#fff1ec] text-[#ef6a47]">
            <KeyRound strokeWidth={1.9} className="h-6 w-6" />
          </span>
          <h1 className="mt-4 text-lg font-extrabold text-slate-900">تعيين كلمة المرور</h1>
          <p className="mt-0.5 text-xs font-semibold text-slate-500">تفعيل الحساب</p>
        </div>

        {loading ? (
          <div className="mt-6 flex items-center justify-center gap-3">
            <BrandSpinner size="sm" />
            <span className="text-xs font-semibold text-slate-500">جارٍ التحقق من رابط التفعيل…</span>
          </div>
        ) : !session ? (
          <div className="mt-6 space-y-3 text-center text-sm text-slate-600">
            <p>يرجى فتح هذه الصفحة عبر رابط الدعوة أو الاستعادة المرسل إلى بريدك الإلكتروني.</p>
            <Link to="/" className="inline-block text-xs font-semibold text-slate-900 underline">
              العودة للرئيسية
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-3.5">
            <FloatingField
              id="new-pass"
              label="كلمة المرور الجديدة"
              type="password"
              required
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <FloatingField
              id="confirm-pass"
              label="تأكيد كلمة المرور"
              type="password"
              required
              dir="ltr"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />

            {feedback && (
              <p
                role="status"
                className={`text-xs font-semibold ${
                  feedback.type === 'error' ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                {feedback.text}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#ef6a47] px-4 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[#d95537] disabled:opacity-60"
            >
              {saving ? <BrandSpinner size="sm" className="app-spinner-on-brand" /> : null}
              {saving ? 'جارٍ الحفظ' : 'حفظ كلمة المرور'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export function RequirePlatformAdmin({children}: {children: ReactNode}) {
  const {platformAdmin, loading} = useAuth();

  if (loading) {
    return <PageLoader label="جارٍ التحقق من صلاحيات المنصة" />;
  }

  if (!platformAdmin || !platformAdmin.is_active) {
    return <Navigate to="/platform/login" replace />;
  }

  return <>{children}</>;
}

export function RequireTenantMember({children}: {children: ReactNode}) {
  const companySlug = useTenantSlug();
  const {memberships, loading} = useAuth();
  const cleanSlug = companySlug.trim().toLowerCase();

  if (loading) {
    return <PageLoader label="جارٍ التحقق من عضوية الشركة" />;
  }

  const isMember = memberships.some(
    (m) => m.tenants?.slug === cleanSlug && m.is_active,
  );

  if (!isMember) {
    return <Navigate to={`${buildTenantBasePath(cleanSlug)}/login`} replace />;
  }

  return <>{children}</>;
}
