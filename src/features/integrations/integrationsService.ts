import {getSupabaseClient} from '@/lib/supabase/client';
import type {
  CreateApiTokenPayload,
  CreateApiTokenResult,
  IntegrationsOverview,
  RotateWebhookSecretResult,
  UpsertWebhookEndpointPayload,
  UpsertWebhookEndpointResult,
  WebhookDeliveryRecord,
  WebhookEventType,
} from '@/types/integrations';

function requireSupabaseClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }
  return client;
}

export const API_SCOPE_OPTIONS = [
  {
    value: 'shipments:read',
    label: 'قراءة الشحنات',
    description: 'استعراض قائمة الشحنات وحالاتها والمبالغ عبر GET /shipments.',
  },
  {
    value: 'shipments:write',
    label: 'إنشاء الشحنات بالتسعير الخادمي',
    description: 'إرسال طلبات شحن جديدة من المتجر أو الـ ERP عبر POST /shipments.',
  },
  {
    value: 'tracking:read',
    label: 'التتبع العام للشحنات',
    description: 'قراءة خط سير الشحنة العام عبر GET /track/:token.',
  },
] as const;

export const WEBHOOK_EVENT_OPTIONS: readonly {
  readonly value: WebhookEventType;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: 'shipment.created',
    label: 'إنشاء شحنة جديدة',
    description: 'يُرسل فور تسجيل شحنة جديدة واعتماد تسعيرها الأولي.',
  },
  {
    value: 'shipment.status_changed',
    label: 'تغير حالة الشحنة',
    description: 'يُرسل عند كل انتقال تشغيلي (التقاط، مخزن، توصيل، تسليم، مرتجع).',
  },
  {
    value: 'pickup_request.updated',
    label: 'تحديث طلب التقاط التاجر',
    description: 'يُرسل عند جدولة أو تنفيذ أو إلغاء طلب التقاط.',
  },
  {
    value: 'settlement.approved',
    label: 'اعتماد تسوية تاجر',
    description: 'يُرسل فور اعتماد سند تسوية مالية لتاجر.',
  },
  {
    value: 'webhook.test',
    label: 'اختبار الاتصال التجريبي',
    description: 'حدث تجريبي للتحقق من الجاهزية وتوقيع HMAC-SHA256.',
  },
];

export async function getIntegrationsOverview(tenantId: string): Promise<IntegrationsOverview> {
  const client = requireSupabaseClient();
  const {data, error} = await client.rpc('get_integrations_overview', {
    p_tenant_id: tenantId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as IntegrationsOverview;
}

export async function createApiToken(
  tenantId: string,
  payload: CreateApiTokenPayload,
): Promise<CreateApiTokenResult> {
  const client = requireSupabaseClient();
  const {data, error} = await client.rpc('create_api_token', {
    p_tenant_id: tenantId,
    p_payload: {
      name: payload.name,
      account_scope: payload.account_scope,
      client_id: payload.client_id ?? null,
      scopes: [...payload.scopes],
      allowed_ips: payload.allowed_ips ? [...payload.allowed_ips] : [],
      expires_in_days: payload.expires_in_days ?? null,
    },
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as CreateApiTokenResult;
}

export async function revokeApiToken(tenantId: string, tokenId: string): Promise<void> {
  const client = requireSupabaseClient();
  const {error} = await client.rpc('revoke_api_token', {
    p_tenant_id: tenantId,
    p_token_id: tokenId,
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function upsertWebhookEndpoint(
  tenantId: string,
  payload: UpsertWebhookEndpointPayload,
): Promise<UpsertWebhookEndpointResult> {
  const client = requireSupabaseClient();
  const {data, error} = await client.rpc('upsert_webhook_endpoint', {
    p_tenant_id: tenantId,
    p_payload: {
      id: payload.id ?? null,
      client_id: payload.client_id ?? null,
      name: payload.name,
      target_url: payload.target_url,
      events: [...payload.events],
      is_active: payload.is_active ?? true,
    },
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as UpsertWebhookEndpointResult;
}

export async function rotateWebhookSecret(
  tenantId: string,
  endpointId: string,
): Promise<RotateWebhookSecretResult> {
  const client = requireSupabaseClient();
  const {data, error} = await client.rpc('rotate_webhook_secret', {
    p_tenant_id: tenantId,
    p_endpoint_id: endpointId,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as RotateWebhookSecretResult;
}

export async function deleteWebhookEndpoint(tenantId: string, endpointId: string): Promise<void> {
  const client = requireSupabaseClient();
  const {error} = await client.rpc('delete_webhook_endpoint', {
    p_tenant_id: tenantId,
    p_endpoint_id: endpointId,
  });
  if (error) {
    throw new Error(error.message);
  }
}

export async function triggerTestWebhookEvent(
  tenantId: string,
  endpointId: string,
  eventType: WebhookEventType = 'webhook.test',
): Promise<WebhookDeliveryRecord> {
  const client = requireSupabaseClient();
  const {data, error} = await client.rpc('trigger_test_webhook_event', {
    p_tenant_id: tenantId,
    p_endpoint_id: endpointId,
    p_event_type: eventType,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data as WebhookDeliveryRecord;
}

export async function dispatchPendingWebhooks(
  tenantId: string,
  endpointId?: string | null,
): Promise<{processed_count: number}> {
  const client = requireSupabaseClient();
  const {data, error} = await client.functions.invoke('public-api-v1/webhooks/dispatch', {
    body: {
      tenant_id: tenantId,
      endpoint_id: endpointId ?? null,
      limit: 15,
    },
  });
  if (error) {
    throw new Error(error.message);
  }
  return (data as {processed_count: number}) ?? {processed_count: 0};
}
