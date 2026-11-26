import {afterEach, describe, expect, it} from 'vitest';
import {buildTenantBasePath} from '@/config/brand';
import {classifyHost, isPlatformHost} from '@/lib/tenant/hostResolver';
import {clearActiveTenantRuntime, setActiveTenantRuntime} from '@/lib/tenant/runtimeState';

describe('host routing (phase 0 & 1)', () => {
  afterEach(() => {
    clearActiveTenantRuntime();
    sessionStorage.clear();
  });

  it('keeps the /c prefix when no tenant host is active', () => {
    expect(buildTenantBasePath('demo-express')).toBe('/c/demo-express');
  });

  it('drops the /c prefix for the active host tenant only', () => {
    setActiveTenantRuntime('demo-express', 'demo-express.example.com');
    expect(buildTenantBasePath('demo-express')).toBe('');
    expect(buildTenantBasePath('other-company')).toBe('/c/other-company');
  });

  it('classifies platform hosts as path mode', () => {
    expect(classifyHost('localhost', '', null).kind).toBe('platform');
    expect(classifyHost('127.0.0.1', '', null).kind).toBe('platform');
    expect(classifyHost('westbridge-logistics.vercel.app', '', null).kind).toBe('platform');
    expect(isPlatformHost('example.com', 'example.com')).toBe(true);
    expect(isPlatformHost('www.example.com', 'example.com')).toBe(true);
    expect(isPlatformHost('cairo-express.example.com', 'example.com')).toBe(false);
  });

  it('classifies tenant subdomains and custom domains as host mode', () => {
    expect(classifyHost('cairo-express.example.com', '', null)).toEqual({
      kind: 'tenant-domain',
      host: 'cairo-express.example.com',
      domain: 'cairo-express.example.com',
    });
    expect(classifyHost('track.cairo-express.com', '', null)).toEqual({
      kind: 'tenant-domain',
      host: 'track.cairo-express.com',
      domain: 'track.cairo-express.com',
    });
  });

  it('supports local slug previews through the host parameter and *.localhost', () => {
    expect(classifyHost('localhost', '?host=cairo-express', sessionStorage)).toEqual({
      kind: 'tenant-slug',
      host: 'cairo-express',
      slug: 'cairo-express',
    });
    expect(classifyHost('cairo-express.localhost', '', sessionStorage).kind).toBe('tenant-slug');
  });

  it('persists the host override for the session and clears it with an empty value', () => {
    classifyHost('localhost', '?host=cairo-express', sessionStorage);
    expect(sessionStorage.getItem('shipflow.debug_host')).toBe('cairo-express');
    expect(classifyHost('localhost', '', sessionStorage).kind).toBe('tenant-slug');
    expect(classifyHost('localhost', '?host=', sessionStorage).kind).toBe('platform');
  });
});
