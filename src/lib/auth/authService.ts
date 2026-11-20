import type {Session} from '@supabase/supabase-js';
import {getSupabaseClient} from '@/lib/supabase/client';
import {isValidUsername, normalizeUsername} from '@/lib/formatters';
import type {
  PlatformAdminRecord,
  ProfileRecord,
  TenantMembershipRecord,
} from '@/types/tenant';

export interface UsernameLoginParams {
  readonly scope: 'platform' | 'tenant';
  readonly tenantSlug?: string;
  readonly username: string;
  readonly password: string;
}

export interface AuthSessionBundle {
  readonly session: Session;
  readonly profile: ProfileRecord | null;
  readonly platformAdmin: PlatformAdminRecord | null;
  readonly memberships: readonly TenantMembershipRecord[];
}

export const GENERIC_LOGIN_ERROR = 'اسم المستخدم أو كلمة المرور غير صحيحة.';

export async function loginWithUsername(params: UsernameLoginParams): Promise<Session> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة بعد.');
  }

  const normalizedUsername = normalizeUsername(params.username);
  if (!isValidUsername(normalizedUsername) || !params.password) {
    throw new Error(GENERIC_LOGIN_ERROR);
  }

  if (params.scope === 'tenant' && !params.tenantSlug?.trim()) {
    throw new Error(GENERIC_LOGIN_ERROR);
  }

  const {data, error} = await client.functions.invoke<{
    session?: {
      access_token: string;
      refresh_token: string;
    };
    error?: string;
  }>('auth-resolve-login', {
    body: {
      scope: params.scope,
      tenant_slug: params.tenantSlug?.trim().toLowerCase(),
      username: normalizedUsername,
      password: params.password,
    },
  });

  if (error || !data?.session?.access_token || !data?.session?.refresh_token) {
    throw new Error(GENERIC_LOGIN_ERROR);
  }

  const {data: sessionData, error: setSessionError} = await client.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });

  if (setSessionError || !sessionData.session) {
    throw new Error(GENERIC_LOGIN_ERROR);
  }

  return sessionData.session;
}

export async function fetchAuthenticatedContext(userId: string): Promise<{
  readonly profile: ProfileRecord | null;
  readonly platformAdmin: PlatformAdminRecord | null;
  readonly memberships: readonly TenantMembershipRecord[];
}> {
  const client = getSupabaseClient();
  if (!client) {
    return {profile: null, platformAdmin: null, memberships: []};
  }

  const [profileRes, adminRes, membershipsRes] = await Promise.all([
    client
      .from('profiles')
      .select('id, display_name, avatar_path, is_platform_user, is_active')
      .eq('id', userId)
      .maybeSingle(),
    client
      .from('platform_admins')
      .select('user_id, role_key, username, is_active')
      .eq('user_id', userId)
      .maybeSingle(),
    client
      .from('tenant_memberships')
      .select(
        'id, tenant_id, user_id, username, account_subject_type, role_key, is_active, must_change_password, tenants (id, code, slug, name, status, default_timezone, default_currency, default_locale, created_at, updated_at)',
      )
      .eq('user_id', userId)
      .eq('is_active', true),
  ]);

  const rawMemberships = (membershipsRes.data ?? []) as unknown as TenantMembershipRecord[];

  return {
    profile: (profileRes.data as ProfileRecord | null) ?? null,
    platformAdmin: (adminRes.data as PlatformAdminRecord | null) ?? null,
    memberships: rawMemberships,
  };
}

export async function updateMyCredentials(input: {
  readonly tenantId?: string | null;
  readonly newUsername?: string;
  readonly newPassword?: string;
}): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {data, error} = await client.functions.invoke<{success?: boolean; error?: string}>(
    'auth-update-credentials',
    {
      body: {
        tenant_id: input.tenantId ?? null,
        new_username: input.newUsername ? normalizeUsername(input.newUsername) : undefined,
        new_password: input.newPassword || undefined,
      },
    },
  );

  if (error || !data?.success) {
    throw new Error(data?.error ?? 'تعذر تحديث بيانات الحساب.');
  }
}

export async function signOutCurrentUser(): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    return;
  }
  await client.auth.signOut();
}
