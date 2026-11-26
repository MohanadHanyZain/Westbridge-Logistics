import {createContext, useContext, useEffect, useMemo, useState, type ReactNode} from 'react';
import {useParams} from 'react-router-dom';
import {BRAND_CONFIG} from '@/config/brand';
import type {PublicTenantInfo} from '@/types/tenant';
import {
  classifyHost,
  getPlatformBaseDomain,
  resolveHostTenant,
  type HostClassification,
  type TenantHostMode,
} from '@/lib/tenant/hostResolver';
import {
  clearActiveTenantRuntime,
  getActiveTenantSlug,
  setActiveTenantRuntime,
} from '@/lib/tenant/runtimeState';

export type TenantRuntimeStatus = 'resolving' | 'ready' | 'not-found';

export interface TenantRuntimeValue {
  readonly mode: TenantHostMode;
  readonly status: TenantRuntimeStatus;
  readonly host: string;
  readonly slug: string | null;
  readonly tenant: PublicTenantInfo | null;
  readonly basePath: string;
  readonly isHostMode: boolean;
  readonly platformBaseDomain: string | null;
}

interface RuntimeState {
  readonly classification: HostClassification;
  readonly status: TenantRuntimeStatus;
  readonly tenant: PublicTenantInfo | null;
}

const TenantRuntimeContext = createContext<TenantRuntimeValue | null>(null);

function classifyCurrentHost(): HostClassification {
  if (typeof window === 'undefined') {
    return {kind: 'platform', host: 'localhost'};
  }
  let storage: Storage | null = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  return classifyHost(window.location.hostname, window.location.search, storage);
}

function applyTenantDocumentMeta(tenant: PublicTenantInfo): void {
  if (typeof document === 'undefined') {
    return;
  }
  document.title = tenant.name;
  const logo = tenant.brand_logo_path?.trim() ?? '';
  if (!/^https?:\/\//i.test(logo)) {
    return;
  }
  let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!icon) {
    icon = document.createElement('link');
    icon.rel = 'icon';
    document.head.appendChild(icon);
  }
  icon.href = logo;
}

function TenantBootScreen() {
  return (
    <div
      dir="rtl"
      className="flex min-h-screen items-center justify-center bg-slate-50 px-6 text-sm text-slate-600"
    >
      جاري تحديد الشركة المرتبطة بهذا النطاق...
    </div>
  );
}

function UnknownTenantHostNotice({host}: {host: string}) {
  const baseDomain = getPlatformBaseDomain();
  return (
    <div dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-12">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-right">
        <h1 className="text-lg font-bold text-slate-900">لا توجد شركة مرتبطة بهذا النطاق</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          النطاق{' '}
          <span dir="ltr" className="font-mono-tabular">
            {host}
          </span>{' '}
          غير مسجَّل لأي شركة نشطة على المنصة. تحقق من الرابط، أو تواصل مع إدارة الشركة التي
          أصدرته.
        </p>
        {baseDomain ? (
          <a
            href={`https://${baseDomain}`}
            className="mt-5 inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            الانتقال إلى المنصة
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function TenantRuntimeProvider({children}: {children: ReactNode}) {
  const [state, setState] = useState<RuntimeState>(() => {
    const classification = classifyCurrentHost();
    if (classification.kind === 'platform') {
      clearActiveTenantRuntime();
      return {classification, status: 'ready', tenant: null};
    }
    return {classification, status: 'resolving', tenant: null};
  });

  useEffect(() => {
    if (state.status !== 'resolving') {
      return;
    }
    let active = true;
    const {classification} = state;
    void (async () => {
      const tenant = await resolveHostTenant(classification);
      if (!active) {
        return;
      }
      if (tenant) {
        setActiveTenantRuntime(tenant.slug, classification.host);
      } else {
        clearActiveTenantRuntime();
      }
      setState({classification, status: tenant ? 'ready' : 'not-found', tenant});
    })();
    return () => {
      active = false;
    };
  }, [state]);

  useEffect(() => {
    if (state.tenant) {
      applyTenantDocumentMeta(state.tenant);
    }
  }, [state.tenant]);

  const value = useMemo<TenantRuntimeValue>(() => {
    const isHostMode = state.classification.kind !== 'platform';
    return {
      mode: isHostMode ? 'host' : 'path',
      status: state.status,
      host: state.classification.host,
      slug: state.tenant?.slug ?? null,
      tenant: state.tenant,
      basePath: isHostMode ? '' : BRAND_CONFIG.tenantRoutePrefix,
      isHostMode,
      platformBaseDomain: getPlatformBaseDomain(),
    };
  }, [state]);

  if (state.status === 'resolving') {
    return <TenantBootScreen />;
  }

  if (state.status === 'not-found') {
    return <UnknownTenantHostNotice host={state.classification.host} />;
  }

  return <TenantRuntimeContext.Provider value={value}>{children}</TenantRuntimeContext.Provider>;
}

export function useTenantRuntime(): TenantRuntimeValue {
  const value = useContext(TenantRuntimeContext);
  if (!value) {
    throw new Error('useTenantRuntime must be used inside TenantRuntimeProvider');
  }
  return value;
}

/**
 * Tenant slug for the current screen: the route param in path mode, or the
 * host-resolved tenant in host mode. Safe to call outside the provider.
 */
export function useTenantSlug(): string {
  const params = useParams();
  const fromRoute =
    typeof params.companySlug === 'string' ? params.companySlug.trim().toLowerCase() : '';
  return fromRoute || getActiveTenantSlug() || '';
}
