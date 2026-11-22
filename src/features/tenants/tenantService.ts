import {getSupabaseClient} from '@/lib/supabase/client';
import type {
  AssignTenantSubscriptionInput,
  OnboardTenantInput,
  OnboardTenantResponse,
  PlatformSupportAccessRecord,
  PlatformSupportSnapshot,
  PlatformTenantDirectoryItem,
  PublicStorefrontPayload,
  PublicTenantInfo,
  SubscriptionPlanRecord,
  SubmitClientRegistrationInput,
  SubmitClientRegistrationResult,
  SupportAccessMode,
  TenantDomainRecord,
  TenantRecord,
  TenantRegistrationSettings,
  TenantStatus,
  TenantSubscriptionOverview,
  UpsertSubscriptionPlanInput,
  UpsertTenantDomainInput,
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

export async function listSubscriptionPlans(): Promise<readonly SubscriptionPlanRecord[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const {data, error} = await client.rpc('list_subscription_plans');
  if (error) {
    throw new Error(error.message ?? 'تعذر تحميل باقات الاشتراك.');
  }

  return ((data as SubscriptionPlanRecord[] | null) ?? []).map((p) => ({
    ...p,
    monthly_price_egp: Number(p.monthly_price_egp ?? 0),
    annual_price_egp: Number(p.annual_price_egp ?? 0),
  }));
}

export async function upsertSubscriptionPlan(
  payload: UpsertSubscriptionPlanInput,
): Promise<SubscriptionPlanRecord> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {data, error} = await client.rpc('upsert_subscription_plan', {
    p_payload: payload,
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر حفظ باقة الاشتراك.');
  }

  return data as SubscriptionPlanRecord;
}

export async function assignTenantSubscription(
  tenantId: string,
  payload: AssignTenantSubscriptionInput,
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {error} = await client.rpc('assign_tenant_subscription', {
    p_tenant_id: tenantId,
    p_payload: payload,
  });

  if (error) {
    throw new Error(error.message ?? 'تعذر تحديث اشتراك الشركة وحدودها.');
  }
}

export async function listPlatformTenantsDirectory(): Promise<readonly PlatformTenantDirectoryItem[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const {data, error} = await client.rpc('list_platform_tenants_directory');
  if (error) {
    throw new Error(error.message ?? 'تعذر تحميل دليل شركات المنصة واشتراكاتها.');
  }

  return (data as PlatformTenantDirectoryItem[] | null) ?? [];
}

export async function getTenantSubscriptionOverview(
  tenantId: string,
): Promise<TenantSubscriptionOverview> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {data, error} = await client.rpc('get_tenant_subscription_overview', {
    p_tenant_id: tenantId,
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر تحميل تفاصيل باقة الاشتراك والنطاقات.');
  }

  return data as TenantSubscriptionOverview;
}

export async function listTenantDomains(
  tenantId: string | null = null,
): Promise<readonly TenantDomainRecord[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const {data, error} = await client.rpc('list_tenant_domains', {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(error.message ?? 'تعذر تحميل نطاقات الشركات.');
  }

  return (data as TenantDomainRecord[] | null) ?? [];
}

export async function upsertTenantDomain(
  tenantId: string,
  payload: UpsertTenantDomainInput,
): Promise<TenantDomainRecord> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {data, error} = await client.rpc('upsert_tenant_domain', {
    p_tenant_id: tenantId,
    p_payload: payload,
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر حفظ نطاق الشركة.');
  }

  return data as TenantDomainRecord;
}

export async function verifyTenantDomain(
  tenantId: string,
  domainId: string,
  markVerified = true,
): Promise<TenantDomainRecord> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {data, error} = await client.rpc('verify_tenant_domain', {
    p_tenant_id: tenantId,
    p_domain_id: domainId,
    p_mark_verified: markVerified,
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر تحديث حالة توثيق النطاق.');
  }

  return data as TenantDomainRecord;
}

export async function deleteTenantDomain(tenantId: string, domainId: string): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {error} = await client.rpc('delete_tenant_domain', {
    p_tenant_id: tenantId,
    p_domain_id: domainId,
  });

  if (error) {
    throw new Error(error.message ?? 'تعذر حذف النطاق.');
  }
}

export async function resolveTenantByDomain(host: string): Promise<PublicTenantInfo | null> {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const cleanHost = host.trim().toLowerCase();
  if (!cleanHost) {
    return null;
  }

  const {data, error} = await client.rpc('resolve_tenant_by_domain', {
    p_host: cleanHost,
  });

  if (error || !data) {
    return null;
  }

  const row = Array.isArray(data) ? data[0] : data;
  return (row as PublicTenantInfo | undefined) ?? null;
}

export async function requestPlatformSupportAccess(
  tenantId: string,
  reason: string,
  durationMinutes = 60,
  accessMode: SupportAccessMode = 'read_only',
): Promise<PlatformSupportAccessRecord> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {data, error} = await client.rpc('request_platform_support_access', {
    p_tenant_id: tenantId,
    p_reason: reason.trim(),
    p_duration_minutes: durationMinutes,
    p_access_mode: accessMode,
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر فتح جلسة دعم فني مسببة.');
  }

  return data as PlatformSupportAccessRecord;
}

export async function revokePlatformSupportAccess(
  accessId: string,
): Promise<PlatformSupportAccessRecord> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {data, error} = await client.rpc('revoke_platform_support_access', {
    p_access_id: accessId,
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر إنهاء جلسة الدعم.');
  }

  return data as PlatformSupportAccessRecord;
}

export async function listPlatformSupportSessions(
  tenantId: string | null = null,
): Promise<readonly PlatformSupportAccessRecord[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  const {data, error} = await client.rpc('list_platform_support_sessions', {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(error.message ?? 'تعذر تحميل سجل جلسات الدعم.');
  }

  return (data as PlatformSupportAccessRecord[] | null) ?? [];
}

export async function getPlatformTenantSupportSnapshot(
  tenantId: string,
): Promise<PlatformSupportSnapshot> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }

  const {data, error} = await client.rpc('get_platform_tenant_support_snapshot', {
    p_tenant_id: tenantId,
  });

  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر فتح اللوحة التشخيصية. تأكد من وجود جلسة دعم نشطة.');
  }

  return data as PlatformSupportSnapshot;
}

