import type {TimestampUtc} from '@/types/common';

export type ApiTokenScope = 'shipments:read' | 'shipments:write' | 'tracking:read';

export type WebhookEventType =
  | 'shipment.created'
  | 'shipment.status_changed'
  | 'pickup_request.updated'
  | 'settlement.approved'
  | 'webhook.test';

export type WebhookDeliveryStatus = 'pending' | 'delivered' | 'failed' | 'dead_letter';

export interface ApiAccessSummary {
  readonly allow_api_access: boolean;
  readonly plan_allow_api_access: boolean;
  readonly plan_code: string;
  readonly plan_name_ar: string;
  readonly subscription_status: string;
  readonly bound_client_id: string | null;
}

export interface ApiTokenRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly token_prefix: string;
  readonly account_scope: 'tenant' | 'client';
  readonly client_id: string | null;
  readonly client_code: string | null;
  readonly client_name: string | null;
  readonly scopes: readonly ApiTokenScope[];
  readonly allowed_ips: readonly string[];
  readonly is_active: boolean;
  readonly expires_at: TimestampUtc | null;
  readonly last_used_at: TimestampUtc | null;
  readonly revoked_at: TimestampUtc | null;
  readonly created_at: TimestampUtc;
}

export interface CreateApiTokenPayload {
  readonly name: string;
  readonly account_scope: 'tenant' | 'client';
  readonly client_id?: string | null;
  readonly scopes: readonly ApiTokenScope[];
  readonly allowed_ips?: readonly string[];
  readonly expires_in_days?: number | null;
}

export interface CreateApiTokenResult {
  readonly token: ApiTokenRecord;
  readonly plaintext_token: string;
}

export interface WebhookEndpointRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly client_id: string | null;
  readonly client_code: string | null;
  readonly client_name: string | null;
  readonly name: string;
  readonly target_url: string;
  readonly events: readonly WebhookEventType[];
  readonly signing_secret_prefix: string;
  readonly is_active: boolean;
  readonly failure_count: number;
  readonly last_triggered_at: TimestampUtc | null;
  readonly last_status_code: number | null;
  readonly created_at: TimestampUtc;
  readonly updated_at: TimestampUtc;
}

export interface UpsertWebhookEndpointPayload {
  readonly id?: string | null;
  readonly client_id?: string | null;
  readonly name: string;
  readonly target_url: string;
  readonly events: readonly WebhookEventType[];
  readonly is_active?: boolean;
}

export interface UpsertWebhookEndpointResult {
  readonly endpoint: WebhookEndpointRecord;
  readonly plaintext_signing_secret: string | null;
}

export interface RotateWebhookSecretResult {
  readonly endpoint_id: string;
  readonly signing_secret_prefix: string;
  readonly plaintext_signing_secret: string;
}

export interface WebhookDeliveryRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly endpoint_id: string;
  readonly endpoint_name: string;
  readonly target_url: string;
  readonly event_type: WebhookEventType;
  readonly entity_type: string;
  readonly entity_id: string | null;
  readonly response_status: number | null;
  readonly response_excerpt: string | null;
  readonly attempt_count: number;
  readonly status: WebhookDeliveryStatus;
  readonly next_retry_at: TimestampUtc | null;
  readonly delivered_at: TimestampUtc | null;
  readonly created_at: TimestampUtc;
}

export interface ApiRequestLogRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly token_id: string | null;
  readonly token_name: string | null;
  readonly token_prefix: string | null;
  readonly method: string;
  readonly path: string;
  readonly status_code: number;
  readonly ip_address: string | null;
  readonly idempotency_key: string | null;
  readonly duration_ms: number;
  readonly created_at: TimestampUtc;
}

export interface IntegrationsOverview {
  readonly api_access: ApiAccessSummary;
  readonly tokens: readonly ApiTokenRecord[];
  readonly endpoints: readonly WebhookEndpointRecord[];
  readonly deliveries: readonly WebhookDeliveryRecord[];
  readonly request_logs: readonly ApiRequestLogRecord[];
}
