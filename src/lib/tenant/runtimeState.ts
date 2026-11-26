/**
 * Host-routing runtime state (Phase 1).
 *
 * The active tenant is resolved once at boot by TenantRuntimeProvider and kept
 * here so that plain (non-React) helpers such as buildTenantBasePath can read it
 * without a hook. The module intentionally has no imports to avoid cycles.
 */
let activeTenantSlug: string | null = null;
let activeTenantHost: string | null = null;

export function setActiveTenantRuntime(slug: string | null, host: string | null): void {
  const cleanSlug = slug ? slug.trim().toLowerCase() : '';
  activeTenantSlug = cleanSlug || null;
  activeTenantHost = host ? host.trim().toLowerCase() : null;
}

export function getActiveTenantSlug(): string | null {
  return activeTenantSlug;
}

export function getActiveTenantHost(): string | null {
  return activeTenantHost;
}

export function clearActiveTenantRuntime(): void {
  activeTenantSlug = null;
  activeTenantHost = null;
}
