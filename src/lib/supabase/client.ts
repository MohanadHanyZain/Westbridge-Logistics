import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {getPublicEnvConfig, type PublicEnvConfig} from '@/config/env';

export interface SupabaseReadinessStatus {
  readonly phase: 'phase-1-connected' | 'phase-1-unconfigured';
  readonly configured: boolean;
  readonly env: PublicEnvConfig;
}

let cachedClient: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase browser client configured ONLY with the public anon key.
 * Never embeds service_role or server secrets.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (cachedClient) {
    return cachedClient;
  }

  const env = getPublicEnvConfig();
  if (!env.isSupabaseConfigured || !env.supabaseUrl || !env.supabaseAnonKey) {
    return null;
  }

  cachedClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return cachedClient;
}

export function getSupabaseReadiness(): SupabaseReadinessStatus {
  const env = getPublicEnvConfig();
  return {
    phase: env.isSupabaseConfigured ? 'phase-1-connected' : 'phase-1-unconfigured',
    configured: env.isSupabaseConfigured,
    env,
  };
}

export function resetSupabaseClientForTests(): void {
  cachedClient = null;
}
