/**
 * Host resolution (Phase 1).
 *
 * Rules:
 *  - Loopback hosts, IP addresses and the platform apex keep the path-based
 *    routes (`/c/{slug}`) so local development and existing links keep working.
 *  - Any other host is treated as a tenant host and resolved through
 *    `resolve_tenant_by_domain` (tenant_domains).
 *  - `{slug}.localhost` and `?host={slug}` exist for local testing without DNS.
 */
import {getPublicEnvConfig} from '@/config/env';
import {fetchPublicTenantBySlug, resolveTenantByDomain} from '@/features/tenants/tenantService';
import type {PublicTenantInfo} from '@/types/tenant';

export type TenantHostMode = 'path' | 'host';

export type HostClassification =
  | {readonly kind: 'platform'; readonly host: string}
  | {readonly kind: 'tenant-slug'; readonly host: string; readonly slug: string}
  | {readonly kind: 'tenant-domain'; readonly host: string; readonly domain: string};

export const DEBUG_HOST_PARAM = 'host';
export const DEBUG_HOST_STORAGE_KEY = 'shipflow.debug_host';

/** Lowercases a host, strips protocol, path, port and trailing dots. */
export function normalizeHost(rawHost: string | null | undefined): string {
  if (!rawHost) {
    return '';
  }
  return rawHost
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.+$/, '');
}

function isIpv4(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

export function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized === '[::1]' ||
    isIpv4(normalized)
  );
}

function isBareSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
}

export function getPlatformBaseDomain(): string | null {
  return getPublicEnvConfig().platformBaseDomain;
}

/**
 * True for the platform apex, its `www` alias and any Vercel deployment host.
 * Tenant subdomains of the base domain deliberately return false.
 */
export function isPlatformHost(hostname: string, baseDomain: string | null): boolean {
  const host = normalizeHost(hostname);
  if (!host) {
    return true;
  }
  if (host.endsWith('.vercel.app')) {
    return true;
  }
  const base = normalizeHost(baseDomain);
  if (!base) {
    return false;
  }
  return host === base || host === `www.${base}`;
}

/**
 * Reads `?host=` from the query string and persists it for the session so that
 * navigation keeps the simulated tenant host. An empty value clears it.
 */
export function readDebugHostOverride(search: string, storage: Storage | null): string | null {
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    if (params.has(DEBUG_HOST_PARAM)) {
      const raw = normalizeHost(params.get(DEBUG_HOST_PARAM));
      if (!raw) {
        storage?.removeItem(DEBUG_HOST_STORAGE_KEY);
        return null;
      }
      storage?.setItem(DEBUG_HOST_STORAGE_KEY, raw);
      return raw;
    }
    return normalizeHost(storage?.getItem(DEBUG_HOST_STORAGE_KEY) ?? null) || null;
  } catch {
    return null;
  }
}

export function classifyHost(
  rawHostname: string,
  search: string,
  storage: Storage | null,
): HostClassification {
  const override = readDebugHostOverride(search, storage);
  const host = override ?? normalizeHost(rawHostname);

  if (!host || isLoopbackHost(host) || isPlatformHost(host, getPlatformBaseDomain())) {
    return {kind: 'platform', host: host || 'localhost'};
  }

  // `?host=cairo-express` — local preview by slug without DNS.
  if (isBareSlug(host)) {
    return {kind: 'tenant-slug', host, slug: host};
  }

  // `cairo-express.localhost` — local preview of a tenant host.
  if (host.endsWith('.localhost')) {
    const firstLabel = host.slice(0, -'.localhost'.length).split('.').filter(Boolean)[0] ?? '';
    if (isBareSlug(firstLabel)) {
      return {kind: 'tenant-slug', host, slug: firstLabel};
    }
    return {kind: 'platform', host};
  }

  return {kind: 'tenant-domain', host, domain: host};
}

export async function resolveHostTenant(
  classification: HostClassification,
): Promise<PublicTenantInfo | null> {
  try {
    if (classification.kind === 'tenant-slug') {
      return await fetchPublicTenantBySlug(classification.slug);
    }
    if (classification.kind === 'tenant-domain') {
      return await resolveTenantByDomain(classification.domain);
    }
    return null;
  } catch {
    return null;
  }
}
