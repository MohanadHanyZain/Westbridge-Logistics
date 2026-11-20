import {getSupabaseClient} from '@/lib/supabase/client';
import type {
  OnboardTenantInput,
  OnboardTenantResponse,
  PublicStorefrontPayload,
  PublicTenantInfo,
  SubmitClientRegistrationInput,
  SubmitClientRegistrationResult,
  TenantRecord,
  TenantRegistrationSettings,
  TenantStatus,
} from '@/types/tenant';

export async function fetchPublicTenantBySlug(slug: string): Promise<PublicTenantInfo | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const cleanSlug = slug.trim().toLowerCase();
  if (!cleanSlug) {
    return null;
  }

  const {data, error} = await client.rpc('get_public_tenant_by_slug', {
    p_slug: cleanSlug,
  });

  if (error || !data) {
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return (row as PublicTenantInfo | undefined) ?? null;
}

export async function fetchPublicTenantStorefront(slug: string): Promise<PublicStorefrontPayload | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const cleanSlug = slug.trim().toLowerCase();
  if (!cleanSlug) {
    return null;
  }

  const {data, error} = await client.rpc('get_public_tenant_storefront', {
    p_slug: cleanSlug,
  });

  if (!error && data) {
    return data as PublicStorefrontPayload;
  }

  const fallback = await fetchPublicTenantBySlug(cleanSlug);
  if (!fallback) {
    return null;
  }

  return {
    tenant: fallback,
    services: [],
    governorates: [],
    regions: [],
  };
}

export async function submitClientRegistrationRequest(
  tenantSlug: string,
  payload: SubmitClientRegistrationInput,
): Promise<SubmitClientRegistrationResult> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {data, error} = await client.rpc('submit_client_registration_request', {
    p_tenant_slug: tenantSlug.trim().toLowerCase(),
    p_payload: payload,
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر إرسال طلب تسجيل المتجر. تحقق من الحقول المطلوبة.');
  }

  return data as SubmitClientRegistrationResult;
}

export async function getTenantRegistrationSettings(tenantId: string): Promise<TenantRegistrationSettings> {
  const client = getSupabaseClient();
  if (!client) {
    return {
      tenant_id: tenantId,
      allow_client_self_registration: false,
      auto_approve_clients: false,
      public_tagline: null,
      public_support_phone: null,
      public_support_email: null,
    };
  }

  const {data, error} = await client.rpc('get_tenant_registration_settings', {
    p_tenant_id: tenantId,
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر تحميل إعدادات التسجيل الذاتي والموقع العام.');
  }

  return data as TenantRegistrationSettings;
}

export async function updateTenantRegistrationSettings(
  tenantId: string,
  payload: {
    readonly allow_client_self_registration: boolean;
    readonly auto_approve_clients: boolean;
    readonly public_tagline?: string | null;
    readonly public_support_phone?: string | null;
    readonly public_support_email?: string | null;
  },
): Promise<TenantRegistrationSettings> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {data, error} = await client.rpc('update_tenant_registration_settings', {
    p_tenant_id: tenantId,
    p_payload: payload,
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر حفظ إعدادات الموقع العام والتسجيل الذاتي.');
  }

  return data as TenantRegistrationSettings;
}

export async function listAllTenants(): Promise<readonly TenantRecord[]> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {data, error} = await client
    .from('tenants')
    .select('id, code, slug, name, status, default_timezone, default_currency, default_locale, created_at, updated_at')
    .order('created_at', {ascending: false});

  if (error) {
    throw new Error('تعذر تحميل قائمة الشركات.');
  }

  return (data ?? []) as TenantRecord[];
}

export async function onboardNewTenant(input: OnboardTenantInput): Promise<OnboardTenantResponse> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const redirectTo =
    typeof window !== 'undefined' ? `${window.location.origin}/auth/set-password` : undefined;

  const {data, error} = await client.functions.invoke<OnboardTenantResponse & {error?: string}>(
    'platform-onboard-tenant',
    {
      body: {
        idempotency_key: input.idempotencyKey,
        code: input.code.trim().toUpperCase(),
        slug: input.slug.trim().toLowerCase(),
        name: input.name.trim(),
        owner_email: input.ownerEmail.trim().toLowerCase(),
        owner_username: input.ownerUsername.trim().toLowerCase(),
        owner_display_name: input.ownerDisplayName.trim(),
        redirect_to: redirectTo,
      },
    },
  );

  if (error || !data?.tenant_id) {
    throw new Error(data?.error ?? 'تعذر تأسيس الشركة. تحقق من البيانات أو صلاحيات المنصة.');
  }

  return data;
}

export async function updateTenantStatus(tenantId: string, status: TenantStatus): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {error} = await client
    .from('tenants')
    .update({status})
    .eq('id', tenantId);

  if (error) {
    throw new Error('تعذر تحديث حالة الشركة.');
  }
}