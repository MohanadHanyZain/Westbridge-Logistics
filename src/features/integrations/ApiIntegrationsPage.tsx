import {useCallback, useEffect, useState, type FormEvent} from 'react';
import {
  AlertTriangle,
  Check,
  Code2,
  Copy,
  KeyRound,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Webhook,
} from 'lucide-react';
import {ConfirmDialog} from '@/components/ui/ConfirmDialog';
import {DataTable, type DataTableColumn} from '@/components/ui/DataTable';
import {listClients} from '@/features/clients/clientsService';
import {
  API_SCOPE_OPTIONS,
  WEBHOOK_EVENT_OPTIONS,
  createApiToken,
  deleteWebhookEndpoint,
  dispatchPendingWebhooks,
  getIntegrationsOverview,
  revokeApiToken,
  rotateWebhookSecret,
  triggerTestWebhookEvent,
  upsertWebhookEndpoint,
} from '@/features/integrations/integrationsService';
import {useTenantWorkspace} from '@/features/tenants/TenantWorkspaceContext';
import {formatDateTime} from '@/lib/formatters';
import type {ClientRecord} from '@/types/pricing';
import type {
  ApiRequestLogRecord,
  ApiTokenRecord,
  ApiTokenScope,
  IntegrationsOverview,
  WebhookDeliveryRecord,
  WebhookDeliveryStatus,
  WebhookEndpointRecord,
  WebhookEventType,
} from '@/types/integrations';

type ActiveTab = 'tokens' | 'webhooks' | 'logs';

interface RevealedSecretState {
  readonly kind: 'token' | 'webhook';
  readonly label: string;
  readonly value: string;
}

const DELIVERY_STATUS_STYLES: Record<WebhookDeliveryStatus, {label: string; cls: string}> = {
  pending: {label: 'قيد الانتظار', cls: 'bg-amber-50 text-amber-800 border-amber-200'},
  delivered: {label: 'تم التسليم', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200'},
  failed: {label: 'إعادة محاولة', cls: 'bg-orange-50 text-orange-800 border-orange-200'},
  dead_letter: {label: 'تعذر نهائي', cls: 'bg-red-50 text-red-800 border-red-200'},
};

const SCOPE_LABELS: Record<ApiTokenScope, string> = {
  'shipments:read': 'قراءة الشحنات',
  'shipments:write': 'إنشاء الشحنات',
  'tracking:read': 'التتبع العام',
};

const EVENT_LABELS: Record<WebhookEventType, string> = {
  'shipment.created': 'إنشاء شحنة',
  'shipment.status_changed': 'تغير حالة شحنة',
  'pickup_request.updated': 'تحديث طلب التقاط',
  'settlement.approved': 'اعتماد تسوية',
  'webhook.test': 'اختبار الاتصال',
};

export function ApiIntegrationsPage() {
  const {tenant, can, boundClientId} = useTenantWorkspace();

  const canRead =
    can('api_tokens.read') || can('api_tokens.create') || can('api_tokens.revoke') || can('webhooks.manage');
  const canCreateToken = can('api_tokens.create');
  const canRevokeToken = can('api_tokens.revoke') || can('api_tokens.create');
  const canManageWebhooks = can('webhooks.manage') || (boundClientId !== null && can('api_tokens.create'));

  const [tab, setTab] = useState<ActiveTab>('tokens');
  const [overview, setOverview] = useState<IntegrationsOverview | null>(null);
  const [clients, setClients] = useState<readonly ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<RevealedSecretState | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Token creation form
  const [tokName, setTokName] = useState('');
  const [tokScopeMode, setTokScopeMode] = useState<'tenant' | 'client'>(boundClientId ? 'client' : 'tenant');
  const [tokClientId, setTokClientId] = useState(boundClientId ?? '');
  const [tokScopes, setTokScopes] = useState<ApiTokenScope[]>(['shipments:read', 'shipments:write', 'tracking:read']);
  const [tokExpiresDays, setTokExpiresDays] = useState('365');
  const [tokAllowedIps, setTokAllowedIps] = useState('');

  // Webhook creation form
  const [whName, setWhName] = useState('');
  const [whUrl, setWhUrl] = useState('');
  const [whClientId, setWhClientId] = useState(boundClientId ?? '');
  const [whEvents, setWhEvents] = useState<WebhookEventType[]>([
    'shipment.created',
    'shipment.status_changed',
    'webhook.test',
  ]);

  // Confirmation dialogs
  const [confirmRevokeToken, setConfirmRevokeToken] = useState<ApiTokenRecord | null>(null);
  const [confirmDeleteWebhook, setConfirmDeleteWebhook] = useState<WebhookEndpointRecord | null>(null);

  useEffect(() => {
    if (boundClientId) {
      setTokScopeMode('client');
      setTokClientId(boundClientId);
      setWhClientId(boundClientId);
    }
  }, [boundClientId]);

  const loadData = useCallback(async () => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [ov, clientRows] = await Promise.all([
        getIntegrationsOverview(tenant.id),
        boundClientId ? Promise.resolve([] as ClientRecord[]) : listClients(tenant.id).catch(() => [] as ClientRecord[]),
      ]);
      setOverview(ov);
      setClients(clientRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل إعدادات رموز API والتكاملات.');
    } finally {
      setLoading(false);
    }
  }, [boundClientId, canRead, tenant.id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCopySecret = async () => {
    if (!revealedSecret) return;
    try {
      await navigator.clipboard?.writeText(revealedSecret.value);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    } catch {
      setCopiedSecret(false);
    }
  };

  const toggleTokenScope = (scope: ApiTokenScope) => {
    setTokScopes((prev) =>
      prev.includes(scope) ? prev.filter((item) => item !== scope) : [...prev, scope],
    );
  };

  const toggleWebhookEvent = (evt: WebhookEventType) => {
    setWhEvents((prev) =>
      prev.includes(evt) ? prev.filter((item) => item !== evt) : [...prev, evt],
    );
  };

  const handleCreateToken = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setBusy(true);
    try {
      const ips = tokAllowedIps
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const expiresNum = tokExpiresDays.trim() ? Number(tokExpiresDays.trim()) : null;

      const res = await createApiToken(tenant.id, {
        name: tokName.trim(),
        account_scope: boundClientId ? 'client' : tokScopeMode,
        client_id: boundClientId ? boundClientId : tokScopeMode === 'client' ? tokClientId : null,
        scopes: tokScopes,
        allowed_ips: ips,
        expires_in_days: expiresNum && Number.isFinite(expiresNum) ? expiresNum : null,
      });

      setRevealedSecret({
        kind: 'token',
        label: `رمز API الجديد (${res.token.name})`,
        value: res.plaintext_token,
      });
      setCopiedSecret(false);
      setTokName('');
      setTokAllowedIps('');
      setSuccessMsg('تم إصدار رمز API بنجاح. انسخ السر الآن لأن هذا هو الظهور الوحيد له.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إصدار رمز API.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRevokeToken = async () => {
    if (!confirmRevokeToken) return;
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await revokeApiToken(tenant.id, confirmRevokeToken.id);
      setConfirmRevokeToken(null);
      setSuccessMsg('تم إبطال رمز API فورًا وإيقاف استخدامه.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إبطال الرمز.');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateWebhook = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);
    setBusy(true);
    try {
      const res = await upsertWebhookEndpoint(tenant.id, {
        name: whName.trim(),
        target_url: whUrl.trim(),
        client_id: boundClientId ? boundClientId : whClientId || null,
        events: whEvents,
        is_active: true,
      });
      if (res.plaintext_signing_secret) {
        setRevealedSecret({
          kind: 'webhook',
          label: `سر توقيع HMAC لـ (${res.endpoint.name})`,
          value: res.plaintext_signing_secret,
        });
        setCopiedSecret(false);
      }
      setWhName('');
      setWhUrl('');
      setSuccessMsg('تم تسجيل نقطة Webhook وتوليد سر التوقيع بنجاح.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ نقطة Webhook.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleEndpointActive = async (ep: WebhookEndpointRecord) => {
    setBusy(true);
    setError(null);
    try {
      await upsertWebhookEndpoint(tenant.id, {
        id: ep.id,
        client_id: ep.client_id,
        name: ep.name,
        target_url: ep.target_url,
        events: ep.events,
        is_active: !ep.is_active,
      });
      setSuccessMsg(ep.is_active ? 'تم إيقاف نقطة Webhook مؤقتًا.' : 'تم تفعيل نقطة Webhook.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحديث حالة نقطة Webhook.');
    } finally {
      setBusy(false);
    }
  };

  const handleRotateSecret = async (ep: WebhookEndpointRecord) => {
    setBusy(true);
    setError(null);
    try {
      const res = await rotateWebhookSecret(tenant.id, ep.id);
      setRevealedSecret({
        kind: 'webhook',
        label: `سر التوقيع المُدوّر لـ (${ep.name})`,
        value: res.plaintext_signing_secret,
      });
      setCopiedSecret(false);
      setSuccessMsg('تم تدوير سر التوقيع بنجاح. حدّث السر لدى المتجر المستقبِل.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تدوير سر التوقيع.');
    } finally {
      setBusy(false);
    }
  };

  const handleTestWebhook = async (ep: WebhookEndpointRecord) => {
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await triggerTestWebhookEvent(tenant.id, ep.id, 'webhook.test');
      try {
        await dispatchPendingWebhooks(tenant.id, ep.id);
      } catch {
        // Delivery remains safely queued in webhook_deliveries even if Edge Function is not invoked locally
      }
      setSuccessMsg(`تمت جدولة وإرسال حدث اختباري إلى ${ep.name}.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر إرسال الحدث التجريبي.');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDeleteWebhook = async () => {
    if (!confirmDeleteWebhook) return;
    setBusy(true);
    setError(null);
    try {
      await deleteWebhookEndpoint(tenant.id, confirmDeleteWebhook.id);
      setConfirmDeleteWebhook(null);
      setSuccessMsg('تم حذف نقطة Webhook بنجاح.');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حذف نقطة Webhook.');
    } finally {
      setBusy(false);
    }
  };

  const handleDispatchPending = async () => {
    setBusy(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await dispatchPendingWebhooks(tenant.id, null);
      setSuccessMsg(`تمت معالجة ${res.processed_count} إشعارًا من طابور الإرسال.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تشغيل عامل الإرسال الآن.');
    } finally {
      setBusy(false);
    }
  };

  if (!canRead) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
        لا تملك صلاحية استعراض رموز API والتكاملات لهذه الشركة.
      </div>
    );
  }

  const apiAccessEnabled = overview?.api_access.allow_api_access ?? false;

  const tokenColumns: readonly DataTableColumn<ApiTokenRecord>[] = [
    {
      key: 'name',
      header: 'الرمز والبادئة',
      render: (r) => (
        <div>
          <p className="font-semibold text-slate-900">{r.name}</p>
          <p className="mt-0.5 font-mono-tabular text-xs text-slate-500">{r.token_prefix}••••••••</p>
        </div>
      ),
    },
    {
      key: 'scope',
      header: 'النطاق / التاجر',
      render: (r) =>
        r.account_scope === 'client' ? (
          <span className="text-xs font-medium text-slate-800">
            تاجر: {r.client_name ?? r.client_code ?? r.client_id}
          </span>
        ) : (
          <span className="text-xs font-medium text-indigo-700">نطاق الشركة بالكامل</span>
        ),
    },
    {
      key: 'scopes',
      header: 'الصلاحيات',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.scopes.map((sc) => (
            <span
              key={sc}
              className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-700"
            >
              {SCOPE_LABELS[sc] ?? sc}
            </span>
          ))}
        </div>
      ),
    },
    {
      key: 'security',
      header: 'القيود وآخر استخدام',
      render: (r) => (
        <div className="space-y-0.5 text-xs text-slate-600">
          <p>
            IPs: {r.allowed_ips.length > 0 ? <span className="font-mono-tabular">{r.allowed_ips.join(', ')}</span> : 'غير مقيد'}
          </p>
          <p>الانتهاء: {r.expires_at ? formatDateTime(r.expires_at) : 'بدون انتهاء'}</p>
          <p>آخر استخدام: {r.last_used_at ? formatDateTime(r.last_used_at) : 'لم يُستخدم بعد'}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'الحالة والإجراء',
      render: (r) => (
        <div className="flex items-center gap-2">
          <span
            className={`rounded border px-2 py-0.5 text-xs font-medium ${
              r.is_active && !r.revoked_at
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {r.is_active && !r.revoked_at ? 'نشط' : 'مُبطل'}
          </span>
          {r.is_active && !r.revoked_at && canRevokeToken && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmRevokeToken(r)}
              className="rounded border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              إبطال الرمز
            </button>
          )}
        </div>
      ),
    },
  ];

  const deliveryColumns: readonly DataTableColumn<WebhookDeliveryRecord>[] = [
    {
      key: 'created_at',
      header: 'التوقيت',
      render: (d) => <span className="font-mono-tabular text-xs text-slate-600">{formatDateTime(d.created_at)}</span>,
    },
    {
      key: 'endpoint',
      header: 'النقطة والحدث',
      render: (d) => (
        <div>
          <p className="text-xs font-semibold text-slate-900">{d.endpoint_name}</p>
          <p className="text-[11px] text-slate-500">{EVENT_LABELS[d.event_type] ?? d.event_type}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'الحالة والرد',
      render: (d) => {
        const badge = DELIVERY_STATUS_STYLES[d.status];
        return (
          <div className="space-y-1">
            <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-medium ${badge.cls}`}>
              {badge.label}
            </span>
            <p className="font-mono-tabular text-[11px] text-slate-500">
              محاولات: {d.attempt_count} {d.response_status ? `· HTTP ${d.response_status}` : ''}
            </p>
          </div>
        );
      },
    },
    {
      key: 'excerpt',
      header: 'تفاصيل الاستجابة',
      render: (d) => (
        <span className="block max-w-xs truncate font-mono-tabular text-xs text-slate-500">
          {d.response_excerpt || 'بانتظار الإرسال'}
        </span>
      ),
    },
  ];

  const logColumns: readonly DataTableColumn<ApiRequestLogRecord>[] = [
    {
      key: 'created_at',
      header: 'التوقيت',
      render: (l) => <span className="font-mono-tabular text-xs text-slate-600">{formatDateTime(l.created_at)}</span>,
    },
    {
      key: 'endpoint',
      header: 'الطلب',
      render: (l) => (
        <span className="font-mono-tabular text-xs font-semibold text-slate-900">
          {l.method} {l.path}
        </span>
      ),
    },
    {
      key: 'token',
      header: 'الرمز المستخدم',
      render: (l) => (
        <span className="text-xs text-slate-700">
          {l.token_name ?? '—'} {l.token_prefix ? `(${l.token_prefix}…)` : ''}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'النتيجة والزمن',
      render: (l) => (
        <span
          className={`font-mono-tabular text-xs font-semibold ${
            l.status_code >= 200 && l.status_code < 300 ? 'text-emerald-700' : 'text-red-700'
          }`}
        >
          HTTP {l.status_code} · {l.duration_ms}ms
        </span>
      ),
    },
    {
      key: 'ip',
      header: 'عنوان IP',
      render: (l) => <span className="font-mono-tabular text-xs text-slate-500">{l.ip_address ?? '—'}</span>,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">رموز API والتكاملات وWebhooks</h1>
          <p className="mt-1 text-xs text-slate-500">
            إصدار مفاتيح التكامل المجزأة، تقييد النطاق وعناوين IP، وإدارة نقاط Webhooks الموقعة بتوقيع HMAC-SHA256.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          disabled={loading || busy}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          تحديث السجلات
        </button>
      </div>

      {/* Plan API Access Status Banner */}
      {overview && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
            apiAccessEnabled
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {apiAccessEnabled ? (
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            )}
            <div className="text-xs">
              <p className="font-semibold">
                حالة التكامل للباقة ({overview.api_access.plan_name_ar} — {overview.api_access.plan_code}):{' '}
                {apiAccessEnabled ? 'مفعّل وجاهز' : 'غير متاح في الباقة الحالية'}
              </p>
              {!apiAccessEnabled && (
                <p className="mt-0.5 text-amber-800">
                  الوصول البرمجي وWebhooks يتطلب باقة النمو (GROWTH) أو المؤسسات (ENTERPRISE) واشتراكًا نشطًا.
                </p>
              )}
            </div>
          </div>
          <span className="rounded border border-current/20 bg-white/70 px-2.5 py-0.5 font-mono-tabular text-[11px] font-semibold">
            {overview.api_access.subscription_status}
          </span>
        </div>
      )}

      {/* One-Time Revealed Secret Card */}
      {revealedSecret && (
        <div
          role="region"
          aria-label="عرض السر لمرة واحدة"
          className="rounded-xl border border-amber-300 bg-slate-900 p-5 text-white"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-amber-300">{revealedSecret.label}</p>
              <p className="mt-1 text-xs text-slate-300">
                يُعرض هذا السر الآن لمرة واحدة فقط ولن يمكن استرجاعه مجددًا بعد إغلاق هذه الرسالة.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleCopySecret()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-300"
              >
                {copiedSecret ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedSecret ? 'تم النسخ' : 'نسخ السر'}
              </button>
              <button
                type="button"
                onClick={() => setRevealedSecret(null)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800"
              >
                إخفاء
              </button>
            </div>
          </div>
          <pre
            dir="ltr"
            className="mt-3 overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono-tabular text-xs text-emerald-300"
          >
            {revealedSecret.value}
          </pre>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800">
          {error}
        </div>
      )}
      {successMsg && (
        <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-800">
          {successMsg}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        <button
          type="button"
          onClick={() => setTab('tokens')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
            tab === 'tokens' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          <KeyRound className="h-4 w-4" />
          رموز API ({overview?.tokens.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setTab('webhooks')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
            tab === 'webhooks' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Webhook className="h-4 w-4" />
          نقاط Webhooks ({overview?.endpoints.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setTab('logs')}
          className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
            tab === 'logs' ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          <Code2 className="h-4 w-4" />
          سجل التسليم والطلبات والدليل
        </button>
      </div>

      {/* Tab 1: API Tokens */}
      {tab === 'tokens' && (
        <div className="space-y-6">
          {canCreateToken && (
            <form onSubmit={handleCreateToken} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-slate-700" />
                <h2 className="text-sm font-bold text-slate-900">إصدار رمز API جديد</h2>
              </div>

              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label htmlFor="tok-name" className="block text-xs font-medium text-slate-700">
                    اسم الرمز / المتجر *
                  </label>
                  <input
                    id="tok-name"
                    type="text"
                    required
                    value={tokName}
                    onChange={(e) => setTokName(e.target.value)}
                    placeholder="مثال: ربط متجر شوبيفاي الرئيسي"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                  />
                </div>

                {!boundClientId && (
                  <div>
                    <label htmlFor="tok-scope-mode" className="block text-xs font-medium text-slate-700">
                      نطاق الرمز *
                    </label>
                    <select
                      id="tok-scope-mode"
                      value={tokScopeMode}
                      onChange={(e) => setTokScopeMode(e.target.value as 'tenant' | 'client')}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                    >
                      <option value="tenant">نطاق الشركة بالكامل (Staff / ERP)</option>
                      <option value="client">مقيد بتاجر محدد</option>
                    </select>
                  </div>
                )}

                {!boundClientId && tokScopeMode === 'client' && (
                  <div>
                    <label htmlFor="tok-client-id" className="block text-xs font-medium text-slate-700">
                      التاجر المرتبط *
                    </label>
                    <select
                      id="tok-client-id"
                      required
                      value={tokClientId}
                      onChange={(e) => setTokClientId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                    >
                      <option value="">اختر التاجر...</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label htmlFor="tok-expires" className="block text-xs font-medium text-slate-700">
                    مدة الصلاحية (بالأيام)
                  </label>
                  <input
                    id="tok-expires"
                    type="number"
                    min={1}
                    max={1095}
                    value={tokExpiresDays}
                    onChange={(e) => setTokExpiresDays(e.target.value)}
                    placeholder="365"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-tabular text-xs focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div className={boundClientId ? 'lg:col-span-2' : ''}>
                  <label htmlFor="tok-ips" className="block text-xs font-medium text-slate-700">
                    عناوين IP المسموحة (اختياري)
                  </label>
                  <input
                    id="tok-ips"
                    type="text"
                    dir="ltr"
                    value={tokAllowedIps}
                    onChange={(e) => setTokAllowedIps(e.target.value)}
                    placeholder="198.51.100.10, 203.0.113.0/24"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-tabular text-xs focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <p className="text-xs font-medium text-slate-700">صلاحيات الرمز المسموحة *</p>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  {API_SCOPE_OPTIONS.map((sc) => (
                    <label
                      key={sc.value}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={tokScopes.includes(sc.value)}
                        onChange={() => toggleTokenScope(sc.value)}
                        className="mt-0.5 rounded border-slate-300"
                      />
                      <span className="text-xs">
                        <span className="block font-semibold text-slate-900">{sc.label}</span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">{sc.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={busy || !apiAccessEnabled || tokScopes.length === 0}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {busy ? 'جاري الإصدار...' : 'إصدار رمز API جديد'}
                </button>
              </div>
            </form>
          )}

          <DataTable
            columns={tokenColumns}
            rows={overview?.tokens ?? []}
            rowKey={(r) => r.id}
            loading={loading}
            emptyMessage="لا توجد رموز API صادرة حتى الآن."
          />
        </div>
      )}

      {/* Tab 2: Webhooks */}
      {tab === 'webhooks' && (
        <div className="space-y-6">
          {canManageWebhooks && (
            <form onSubmit={handleCreateWebhook} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
              <div className="flex items-center gap-2">
                <Plus className="h-4 w-4 text-slate-700" />
                <h2 className="text-sm font-bold text-slate-900">إضافة نقطة Webhook جديدة</h2>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label htmlFor="wh-name" className="block text-xs font-medium text-slate-700">
                    اسم نقطة الاستقبال *
                  </label>
                  <input
                    id="wh-name"
                    type="text"
                    required
                    value={whName}
                    onChange={(e) => setWhName(e.target.value)}
                    placeholder="مثال: إشعارات متجر أونلاين"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div className={boundClientId ? 'md:col-span-2' : ''}>
                  <label htmlFor="wh-url" className="block text-xs font-medium text-slate-700">
                    رابط الاستقبال العام (HTTPS فقط) *
                  </label>
                  <input
                    id="wh-url"
                    type="url"
                    dir="ltr"
                    required
                    value={whUrl}
                    onChange={(e) => setWhUrl(e.target.value)}
                    placeholder="https://store.example.com/webhooks/shipflow"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono-tabular text-xs focus:border-slate-900 focus:outline-none"
                  />
                </div>

                {!boundClientId && (
                  <div>
                    <label htmlFor="wh-client" className="block text-xs font-medium text-slate-700">
                      تقييد بتاجر (اختياري)
                    </label>
                    <select
                      id="wh-client"
                      value={whClientId}
                      onChange={(e) => setWhClientId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                    >
                      <option value="">جميع شحنات الشركة</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code} — {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-medium text-slate-700">الأحداث المشترك بها *</p>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  {WEBHOOK_EVENT_OPTIONS.map((ev) => (
                    <label
                      key={ev.value}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2.5 hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={whEvents.includes(ev.value)}
                        onChange={() => toggleWebhookEvent(ev.value)}
                        className="mt-0.5 rounded border-slate-300"
                      />
                      <span className="text-xs">
                        <span className="block font-semibold text-slate-900">{ev.label}</span>
                        <span className="mt-0.5 block text-[11px] text-slate-500">{ev.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={busy || !apiAccessEnabled || whEvents.length === 0}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {busy ? 'جاري الحفظ...' : 'حفظ نقطة Webhook'}
                </button>
              </div>
            </form>
          )}

          <div className="space-y-3">
            {(overview?.endpoints ?? []).length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
                لا توجد نقاط Webhooks مسجلة حتى الآن.
              </div>
            ) : (
              (overview?.endpoints ?? []).map((ep) => (
                <div key={ep.id} className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900">{ep.name}</h3>
                        <span
                          className={`rounded border px-2 py-0.5 text-[11px] font-medium ${
                            ep.is_active
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-slate-200 bg-slate-100 text-slate-600'
                          }`}
                        >
                          {ep.is_active ? 'مفعّلة' : 'متوقفة'}
                        </span>
                        {ep.client_name && (
                          <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-700">
                            تاجر: {ep.client_name}
                          </span>
                        )}
                      </div>
                      <p dir="ltr" className="font-mono-tabular text-xs text-slate-600">
                        {ep.target_url}
                      </p>
                      <p className="font-mono-tabular text-[11px] text-slate-500">
                        بادئة التوقيع: {ep.signing_secret_prefix}•••• · إخفاقات متتالية: {ep.failure_count}
                        {ep.last_status_code ? ` · آخر رد HTTP ${ep.last_status_code}` : ''}
                      </p>
                      <div className="flex flex-wrap gap-1 pt-1">
                        {ep.events.map((evt) => (
                          <span
                            key={evt}
                            className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-700"
                          >
                            {EVENT_LABELS[evt] ?? evt}
                          </span>
                        ))}
                      </div>
                    </div>

                    {canManageWebhooks && (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={busy || !apiAccessEnabled}
                          onClick={() => void handleTestWebhook(ep)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <Play className="h-3.5 w-3.5" />
                          إرسال حدث تجريبي
                        </button>
                        <button
                          type="button"
                          disabled={busy || !apiAccessEnabled}
                          onClick={() => void handleRotateSecret(ep)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          تدوير السر
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleToggleEndpointActive(ep)}
                          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {ep.is_active ? 'إيقاف' : 'تفعيل'}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setConfirmDeleteWebhook(ep)}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          حذف
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Deliveries, API Logs & Quick Docs */}
      {tab === 'logs' && (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-bold text-slate-900">سجل تسليم Webhooks</h2>
              {canManageWebhooks && (
                <button
                  type="button"
                  disabled={busy || !apiAccessEnabled}
                  onClick={() => void handleDispatchPending()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  تشغيل إرسال المعلق
                </button>
              )}
            </div>
            <DataTable
              columns={deliveryColumns}
              rows={overview?.deliveries ?? []}
              rowKey={(d) => d.id}
              loading={loading}
              emptyMessage="لا توجد عمليات تسليم Webhooks مسجلة بعد."
            />
          </div>

          <div className="space-y-3">
            <h2 className="text-sm font-bold text-slate-900">سجل طلبات REST API الخارجية</h2>
            <DataTable
              columns={logColumns}
              rows={overview?.request_logs ?? []}
              rowKey={(l) => l.id}
              loading={loading}
              emptyMessage="لا توجد طلبات REST API خارجية مسجلة حتى الآن."
            />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-bold text-slate-900">دليل التكامل السريع والتحقق من التوقيع</h2>
            <p className="mt-1 text-xs text-slate-600">
              مرر رمز Bearer في الترويسة، واستخدم معرّف <span className="font-mono-tabular">Idempotency-Key</span> عند إنشاء
              الشحنات لمنع التكرار، وتحقق من صحة كل Webhook عبر ترويسة{' '}
              <span className="font-mono-tabular">X-ShipFlow-Signature</span>.
            </p>
            <pre
              dir="ltr"
              className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-950 p-4 font-mono-tabular text-xs leading-relaxed text-slate-100"
            >
{`# 1) Create shipment (Server Pricing + Atomic Snapshot)
POST /functions/v1/public-api-v1/shipments
Authorization: Bearer sf_live_YOUR_SECRET_TOKEN
Idempotency-Key: order-2026-1001
Content-Type: application/json

# 2) Verify incoming Webhook signature
Header: X-ShipFlow-Signature: t=1763800000,v1=<hex_hmac_sha256>
Signed string: "{t}.{raw_request_body}" using whsec_...`}
            </pre>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmRevokeToken !== null}
        title="تأكيد إبطال رمز API"
        description={
          confirmRevokeToken
            ? `سيتم إيقاف الرمز "${confirmRevokeToken.name}" (${confirmRevokeToken.token_prefix}…) فورًا ولن يتمكن أي نظام خارجي من استخدامه.`
            : ''
        }
        confirmLabel="إبطال الرمز الآن"
        busy={busy}
        onConfirm={() => void handleConfirmRevokeToken()}
        onCancel={() => setConfirmRevokeToken(null)}
      />

      <ConfirmDialog
        open={confirmDeleteWebhook !== null}
        title="تأكيد حذف نقطة Webhook"
        description={
          confirmDeleteWebhook
            ? `سيتم حذف النقطة "${confirmDeleteWebhook.name}" وجميع سجلات محاولات التسليم المرتبطة بها.`
            : ''
        }
        confirmLabel="حذف النقطة"
        busy={busy}
        onConfirm={() => void handleConfirmDeleteWebhook()}
        onCancel={() => setConfirmDeleteWebhook(null)}
      />
    </div>
  );
}
