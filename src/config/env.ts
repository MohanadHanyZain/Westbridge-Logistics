/**
 * Client-safe environment configuration reader (ADR-002).
 * Only reads public VITE_* variables. Server secrets (service_role, etc.)
 * are strictly forbidden in the browser bundle.
 */
export interface PublicEnvConfig {
  readonly supabaseUrl: string | null;
  readonly supabaseAnonKey: string | null;
  readonly googleMapsApiKey: string | null;
  readonly isSupabaseConfigured: boolean;
  readonly isMapsConfigured: boolean;
}

function readPublicEnv(key: string): string | null {
  if (typeof import.meta === 'undefined' || !import.meta.env) {
    return null;
  }
  const raw = import.meta.env[key];
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (
    !trimmed ||
    trimmed.includes('your-project-ref') ||
    trimmed.includes('your-public-anon-key') ||
    trimmed.includes('your-referrer-restricted-maps-key')
  ) {
    return null;
  }
  return trimmed;
}

export function getPublicEnvConfig(): PublicEnvConfig {
  const supabaseUrl = readPublicEnv('VITE_SUPABASE_URL');
  const supabaseAnonKey = readPublicEnv('VITE_SUPABASE_ANON_KEY');
  const googleMapsApiKey = readPublicEnv('VITE_GOOGLE_MAPS_API_KEY');

  return {
    supabaseUrl,
    supabaseAnonKey,
    googleMapsApiKey,
    isSupabaseConfigured: Boolean(supabaseUrl && supabaseAnonKey),
    isMapsConfigured: Boolean(googleMapsApiKey),
  };
}

export function assertNoServerSecretsInClientEnv(
  envRecord: Record<string, unknown>,
): void {
  const forbiddenKeys = [
    'VITE_SUPABASE_SERVICE_ROLE_KEY',
    'VITE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  for (const key of forbiddenKeys) {
    if (key in envRecord && envRecord[key]) {
      throw new Error(
        `Security violation: server secret "${key}" must never be exposed to the client environment.`,
      );
    }
  }
}
