import {useEffect, useState, type FormEvent, type ReactNode} from 'react';
import {Link, Navigate, useNavigate} from 'react-router-dom';
import {useTenantSlug} from '@/lib/tenant/TenantRuntimeContext';
import {BRAND_CONFIG, buildTenantBasePath} from '@/config/brand';
import {useAuth} from '@/lib/auth';
import {getSupabaseClient} from '@/lib/supabase/client';
import {fetchPublicTenantBySlug} from '@/features/tenants/tenantService';
import type {PublicTenantInfo} from '@/types/tenant';
import {KeyRound, LogIn} from 'lucide-react';

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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <Link to="/" className="text-base font-bold text-slate-900">
            {BRAND_CONFIG.appName}
          </Link>
          <span className="text-xs text-slate-500">دخول إدارة النظام</span>
        </div>

        <h1 className="mt-5 text-lg font-bold text-slate-900">تسجيل دخول إدارة المنصة</h1>
        <p className="mt-1 text-xs text-slate-600">
          استخدم اسم المستخدم وكلمة المرور الخاصة بحسابك.
        </p>

        {!isConfigured && (
          <p role="alert" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            لم يتم تهيئة متغيرات اتصال Supabase في البيئة بعد.
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="platform-username" className="block text-xs font-medium text-slate-700">
              اسم المستخدم (Username)
            </label>
            <input
              id="platform-username"
              type="text"
              required
              dir="ltr"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="platform-password" className="block text-xs font-medium text-slate-700">
              كلمة المرور
            </label>
            <input
              id="platform-password"
              type="password"
              required
              dir="ltr"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs font-medium text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !isConfigured}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            <LogIn className="h-4 w-4" />
            {submitting ? 'جاري التحقق...' : 'دخول للمنصة'}
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-sm text-slate-600">
        جاري التحقق من بوابة الشركة...
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-right">
          <h1 className="text-lg font-bold text-slate-900">الشركة غير موجودة أو موقوفة</h1>
          <p className="mt-2 text-sm text-slate-600">
            تأكد من صحة رابط شركة الشحن قبل تسجيل الدخول.
          </p>
          <Link
            to="/"
            className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white"
          >
            العودة للرئيسية
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <Link to={basePath} className="text-base font-bold text-slate-900">
            {tenant.name}
          </Link>
          <span className="font-mono-tabular text-xs text-slate-500">{tenant.slug}</span>
        </div>

        <h1 className="mt-5 text-lg font-bold text-slate-900">تسجيل الدخول إلى النظام</h1>
        <p className="mt-1 text-xs text-slate-600">
          أدخل اسم المستخدم وكلمة المرور المخصصين لحسابك في {tenant.name}.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="tenant-username" className="block text-xs font-medium text-slate-700">
              اسم المستخدم (Username)
            </label>
            <input
              id="tenant-username"
              type="text"
              required
              dir="ltr"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="tenant-password" className="block text-xs font-medium text-slate-700">
              كلمة المرور
            </label>
            <input
              id="tenant-password"
              type="password"
              required
              dir="ltr"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs font-medium text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !isConfigured}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            <LogIn className="h-4 w-4" />
            {submitting ? 'جاري تسجيل الدخول...' : 'دخول'}
          </button>
        </form>
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
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-4">
          <KeyRound className="h-4 w-4 text-slate-700" />
          <h1 className="text-base font-bold text-slate-900">تفعيل الحساب وتعيين كلمة المرور</h1>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-slate-600">جاري التحقق من رابط التفعيل...</p>
        ) : !session ? (
          <div className="mt-4 space-y-3 text-sm text-slate-600">
            <p>يرجى فتح هذه الصفحة عبر رابط الدعوة أو الاستعادة المرسل إلى بريدك الإلكتروني.</p>
            <Link to="/" className="inline-block text-xs font-medium text-slate-900 underline">
              العودة للرئيسية
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="new-pass" className="block text-xs font-medium text-slate-700">
                كلمة المرور الجديدة
              </label>
              <input
                id="new-pass"
                type="password"
                required
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="confirm-pass" className="block text-xs font-medium text-slate-700">
                تأكيد كلمة المرور
              </label>
              <input
                id="confirm-pass"
                type="password"
                required
                dir="ltr"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
              />
            </div>

            {feedback && (
              <p
                role="status"
                className={`text-xs font-medium ${
                  feedback.type === 'error' ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                {feedback.text}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ كلمة المرور'}
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
        جاري التحقق من صلاحيات المنصة...
      </div>
    );
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
        جاري التحقق من عضوية الشركة...
      </div>
    );
  }

  const isMember = memberships.some(
    (m) => m.tenants?.slug === cleanSlug && m.is_active,
  );

  if (!isMember) {
    return <Navigate to={`${buildTenantBasePath(cleanSlug)}/login`} replace />;
  }

  return <>{children}</>;
}
