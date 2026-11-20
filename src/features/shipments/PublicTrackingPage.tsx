import {useEffect, useState, type FormEvent} from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import {BRAND_CONFIG, buildTenantBasePath} from '@/config/brand';
import {trackPublicShipment} from '@/features/shipments/shipmentsService';
import {fetchPublicTenantBySlug} from '@/features/tenants/tenantService';
import {formatDateTime} from '@/lib/formatters';
import {SHIPMENT_STATUS_LABELS, type PublicTrackingResult} from '@/types/shipments';
import type {PublicTenantInfo} from '@/types/tenant';
import {ArrowRight, LogIn, PackageSearch} from 'lucide-react';

export function PublicTrackingPage() {
  const {companySlug = '', token = ''} = useParams();
  const navigate = useNavigate();
  const basePath = buildTenantBasePath(companySlug);

  const [tenant, setTenant] = useState<PublicTenantInfo | null>(null);
  const [query, setQuery] = useState(token);
  const [result, setResult] = useState<PublicTrackingResult | null>(null);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchPublicTenantBySlug(companySlug).then((data) => {
      if (active) setTenant(data);
    });
    return () => {
      active = false;
    };
  }, [companySlug]);

  useEffect(() => {
    if (!token.trim()) {
      setResult(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    setQuery(token);
    trackPublicShipment(companySlug, token)
      .then((res) => {
        if (active) setResult(res);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'تعذر تتبع الشحنة.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [companySlug, token]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const cleaned = query.trim();
    if (!cleaned) return;
    navigate(`${basePath}/track/${encodeURIComponent(cleaned)}`);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-8 px-6 py-4">
          <Link to={basePath} className="text-lg font-bold text-slate-900 whitespace-nowrap shrink-0">
            {tenant?.name ?? BRAND_CONFIG.appName}
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
            <Link to={basePath} className="hover:text-slate-900 whitespace-nowrap shrink-0">
              بوابة الشركة
            </Link>
          </nav>
          <Link
            to={`${basePath}/login`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <LogIn className="h-3.5 w-3.5" />
            تسجيل الدخول
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
        <div>
          <Link to={basePath} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">
            <ArrowRight className="h-3.5 w-3.5" />
            العودة لصفحة الشركة
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">تتبع حالة الشحنة</h1>
          <p className="mt-1 text-sm text-slate-600">
            أدخل رقم الشحنة أو رمز الباركود أو رمز التتبع لمتابعة المسار التشغيلي دون كشف أي بيانات شخصية.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row">
          <div className="relative flex-1">
            <PackageSearch className="pointer-events-none absolute top-2.5 right-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="مثال: SHP-0000001 أو رمز الباركود..."
              aria-label="رقم الشحنة أو رمز التتبع"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pr-9 pl-3 font-mono-tabular text-sm focus:border-slate-400 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-800 whitespace-nowrap"
          >
            بحث وتتبع
          </button>
        </form>

        {loading && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
            جاري البحث عن بيانات الشحنة...
          </div>
        )}

        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
            {error}
          </div>
        )}

        {!loading && result && !result.found && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-600">
            لم يتم العثور على شحنة مطابقة للرمز المدخل لدى هذه الشركة.
          </div>
        )}

        {!loading && result && result.found && result.operational_status && (
          <div className="space-y-6 rounded-xl border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <p className="text-xs text-slate-500">{result.tenant_name}</p>
                <h2 className="mt-1 font-mono-tabular text-xl font-bold text-slate-900">
                  {result.shipment_number}
                </h2>
              </div>
              <div className="text-left">
                <p className="text-xs text-slate-500">الحالة الحالية</p>
                <p className="mt-1 text-sm font-bold text-emerald-700">
                  {SHIPMENT_STATUS_LABELS[result.operational_status] ?? result.operational_status}
                </p>
              </div>
            </div>

            <dl className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-slate-500">الخدمة ونوع الطلب</dt>
                <dd className="mt-1 font-medium text-slate-900">
                  {result.service_name ?? '—'} · {result.shipment_type_name ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">من</dt>
                <dd className="mt-1 font-medium text-slate-900">{result.origin_label ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">إلى</dt>
                <dd className="mt-1 font-medium text-slate-900">{result.destination_label ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">عدد القطع</dt>
                <dd className="mt-1 font-mono-tabular font-medium text-slate-900">{result.pieces_count ?? 1}</dd>
              </div>
            </dl>

            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-sm font-semibold text-slate-900">سجل مراحل الحركة</h3>
              <ol className="mt-3 space-y-3">
                {(result.events ?? []).map((evt, index) => (
                  <li key={`${evt.created_at}-${index}`} className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs last:border-b-0">
                    <div>
                      <span className="font-semibold text-slate-900">
                        {SHIPMENT_STATUS_LABELS[evt.to_status] ?? evt.to_status}
                      </span>
                      {evt.branch_name && (
                        <span className="mr-2 text-slate-500">· فرع {evt.branch_name}</span>
                      )}
                    </div>
                    <span className="font-mono-tabular text-slate-500">{formatDateTime(evt.created_at)}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
