import {useCallback, useEffect, useMemo, useState, type FormEvent} from 'react';
import {Link} from 'react-router-dom';
import {BRAND_CONFIG, buildTenantBasePath} from '@/config/brand';
import {useAuth} from '@/lib/auth';
import {formatDateTime, isValidCompanySlug, isValidUsername} from '@/lib/formatters';
import {listAllTenants, onboardNewTenant, updateTenantStatus} from '@/features/tenants/tenantService';
import type {TenantRecord, TenantStatus} from '@/types/tenant';
import {Building2, ExternalLink, LogOut, Plus, RefreshCw, Search} from 'lucide-react';

function getTenantStatusLabel(status: TenantStatus): {label: string; className: string} {
  switch (status) {
    case 'active':
      return {label: 'نشطة', className: 'text-emerald-700'};
    case 'suspended':
      return {label: 'موقوفة', className: 'text-amber-700'};
    case 'archived':
      return {label: 'مؤرشفة', className: 'text-slate-500'};
  }
}

export function PlatformTenantsPage() {
  const {platformAdmin, profile, signOut} = useAuth();
  const [tenants, setTenants] = useState<readonly TenantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | TenantStatus>('all');

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [code, setCode] = useState('');
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [ownerDisplayName, setOwnerDisplayName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerUsername, setOwnerUsername] = useState('admin');
  const [submitting, setSubmitting] = useState(false);
  const [formFeedback, setFormFeedback] = useState<{type: 'error' | 'success'; text: string} | null>(
    null,
  );

  const loadTenants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAllTenants();
      setTenants(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل قائمة الشركات.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  const filteredTenants = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tenants.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q)
      );
    });
  }, [tenants, searchQuery, statusFilter]);

  const handleOnboardSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormFeedback(null);

    if (!isValidCompanySlug(slug)) {
      setFormFeedback({
        type: 'error',
        text: 'المعرّف النصي (Slug) يجب أن يتكون من أحرف إنجليزية صغيرة وأرقام وشرطة فقط (مثال: cairo-express).',
      });
      return;
    }

    if (!isValidUsername(ownerUsername)) {
      setFormFeedback({
        type: 'error',
        text: 'اسم مستخدم المالك يجب أن يكون 3–32 حرفًا إنجليزيًا/رقميًا.',
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await onboardNewTenant({
        idempotencyKey,
        code,
        slug,
        name,
        ownerEmail,
        ownerUsername,
        ownerDisplayName,
      });

      setFormFeedback({
        type: 'success',
        text: res.already_existed
          ? 'تم استرجاع الشركة المنشأة مسبقًا بنفس مفتاح عدم التكرار.'
          : 'تم تأسيس الشركة وإرسال رابط الدعوة لبريد المالك بنجاح.',
      });

      setCode('');
      setSlug('');
      setName('');
      setOwnerDisplayName('');
      setOwnerEmail('');
      setOwnerUsername('admin');
      setIdempotencyKey(crypto.randomUUID());
      await loadTenants();
    } catch (err) {
      setFormFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'تعذر تأسيس الشركة.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (tenant: TenantRecord) => {
    const nextStatus: TenantStatus = tenant.status === 'active' ? 'suspended' : 'active';
    try {
      await updateTenantStatus(tenant.id, nextStatus);
      await loadTenants();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تغيير حالة الشركة.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-4">
          <Link to="/" className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            {BRAND_CONFIG.appName}
          </Link>

          <nav aria-label="تنقل المنصة" className="flex items-center gap-6">
            <Link
              to="/platform"
              className="border-b-2 border-slate-900 pb-1 text-sm font-medium text-slate-900 whitespace-nowrap shrink-0"
            >
              الشركات
            </Link>
            <Link
              to="/architecture"
              className="border-b-2 border-transparent pb-1 text-sm font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              خارطة المراحل
            </Link>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden text-xs text-slate-600 md:inline">
              {profile?.display_name ?? platformAdmin?.username}
            </span>
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <LogOut className="h-3.5 w-3.5" />
              خروج
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-medium text-slate-500">المنصة المركزية · إدارة المستأجرين</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">شركات الشحن المسجلة</h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void loadTenants()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              تحديث
            </button>

            {platformAdmin?.role_key === 'platform_super_admin' && (
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm((prev) => !prev);
                  setFormFeedback(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                {showCreateForm ? 'إغلاق النموذج' : 'إضافة شركة شحن جديدة'}
              </button>
            )}
          </div>
        </div>

        {showCreateForm && (
          <section aria-label="نموذج تأسيس شركة جديدة" className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">تأسيس شركة شحن جديدة (يدوي + دعوة المالك)</h2>
            <p className="mt-1 text-xs text-slate-500">
              يُنشأ حساب مالك واحد فقط ويرسل له رابط تفعيل آمن عبر البريد الإلكتروني دون كلمة مرور ثابتة.
            </p>

            <form onSubmit={handleOnboardSubmit} className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div>
                <label htmlFor="tenant-name" className="block text-xs font-medium text-slate-700">
                  اسم الشركة
                </label>
                <input
                  id="tenant-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثال: القاهرة السريع للشحن"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="tenant-code" className="block text-xs font-medium text-slate-700">
                  كود الشركة
                </label>
                <input
                  id="tenant-code"
                  type="text"
                  required
                  dir="ltr"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="CAIRO_EXP"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="tenant-slug" className="block text-xs font-medium text-slate-700">
                  مسار الموقع (Slug)
                </label>
                <input
                  id="tenant-slug"
                  type="text"
                  required
                  dir="ltr"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder="cairo-express"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="owner-name" className="block text-xs font-medium text-slate-700">
                  اسم المالك
                </label>
                <input
                  id="owner-name"
                  type="text"
                  required
                  value={ownerDisplayName}
                  onChange={(e) => setOwnerDisplayName(e.target.value)}
                  placeholder="الاسم الكامل لمالك الشركة"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="owner-email" className="block text-xs font-medium text-slate-700">
                  بريد المالك الإلكتروني (للدعوة)
                </label>
                <input
                  id="owner-email"
                  type="email"
                  required
                  dir="ltr"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="owner@company.com"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="owner-username" className="block text-xs font-medium text-slate-700">
                  اسم المستخدم للمالك (Username)
                </label>
                <input
                  id="owner-username"
                  type="text"
                  required
                  dir="ltr"
                  value={ownerUsername}
                  onChange={(e) => setOwnerUsername(e.target.value.toLowerCase())}
                  placeholder="admin"
                  className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-between pt-2 md:col-span-3">
                <p className="font-mono-tabular text-xs text-slate-500">
                  مفتاح عدم التكرار: {idempotencyKey.slice(0, 8)}...
                </p>

                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {submitting ? 'جاري التأسيس وإرسال الدعوة...' : 'تأسيس الشركة وإرسال الدعوة'}
                </button>
              </div>
            </form>

            {formFeedback && (
              <p
                role="status"
                className={`mt-4 text-xs font-medium ${
                  formFeedback.type === 'error' ? 'text-red-700' : 'text-emerald-700'
                }`}
              >
                {formFeedback.text}
              </p>
            )}
          </section>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ابحث بالاسم أو الكود أو المسار..."
              aria-label="بحث في الشركات"
              className="w-72 rounded-lg border border-slate-200 bg-white py-2 pr-9 pl-3 text-sm focus:border-slate-400 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(['all', 'active', 'suspended'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st === 'all' ? 'الكل' : st === 'active' ? 'نشطة' : 'موقوفة'}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-right text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                  <th className="px-4 py-3">الكود</th>
                  <th className="px-4 py-3">الشركة</th>
                  <th className="px-4 py-3">المسار العام</th>
                  <th className="px-4 py-3">الحالة</th>
                  <th className="px-4 py-3">تاريخ التأسيس</th>
                  <th className="px-4 py-3">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                      جاري تحميل بيانات الشركات...
                    </td>
                  </tr>
                ) : filteredTenants.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-500">
                      <Building2 className="mx-auto mb-2 h-6 w-6 text-slate-400" />
                      لا توجد شركات مسجلة مطابقة للبحث.
                    </td>
                  </tr>
                ) : (
                  filteredTenants.map((tenant) => {
                    const statusInfo = getTenantStatusLabel(tenant.status);
                    const publicPath = buildTenantBasePath(tenant.slug);
                    return (
                      <tr key={tenant.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono-tabular font-medium text-slate-900">
                          {tenant.code}
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{tenant.name}</td>
                        <td className="px-4 py-3 font-mono-tabular text-xs text-slate-600" dir="ltr">
                          {publicPath}
                        </td>
                        <td className={`px-4 py-3 text-xs font-medium ${statusInfo.className}`}>
                          {statusInfo.label}
                        </td>
                        <td className="px-4 py-3 font-mono-tabular text-xs text-slate-600">
                          {formatDateTime(tenant.created_at, tenant.default_timezone, tenant.default_locale)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <Link
                              to={publicPath}
                              className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                              الموقع
                            </Link>
                            {platformAdmin?.role_key === 'platform_super_admin' &&
                              tenant.status !== 'archived' && (
                                <button
                                  type="button"
                                  onClick={() => void handleToggleStatus(tenant)}
                                  className="text-xs font-medium text-slate-700 underline underline-offset-4 hover:text-slate-900"
                                >
                                  {tenant.status === 'active' ? 'إيقاف' : 'تفعيل'}
                                </button>
                              )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
