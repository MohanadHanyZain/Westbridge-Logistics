import {getSupabaseClient} from '@/lib/supabase/client';
import type {
  AttachmentDraftPayload,
  ConversationEntityType,
  ConversationRecord,
  MessageRecord,
  MessageVisibility,
  NotificationRecord,
  PrivateStorageBucketId,
  SendMessageResult,
  ShipmentAttachmentCategory,
  ShipmentAttachmentRecord,
  StorageObjectMetadataRecord,
  TenantMessagingSettings,
} from '@/types/messaging';

export const ALLOWED_ATTACHMENT_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const ALLOWED_ATTACHMENT_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'pdf'] as const;

export const DEFAULT_SIGNED_URL_TTL_SECONDS = 300;

export function isSafeHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function isSafeAppRoute(path: string | null | undefined): path is string {
  if (!path) return false;
  return path.startsWith('/') && !path.startsWith('//');
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export interface AttachmentValidationResult {
  readonly valid: boolean;
  readonly error?: string;
  readonly extension: string;
}

export function validateAttachmentFile(
  file: Pick<File, 'name' | 'type' | 'size'>,
  maxSizeMb = 5,
): AttachmentValidationResult {
  const cleanName = file.name.trim();
  const ext = cleanName.includes('.') ? cleanName.split('.').pop()?.toLowerCase() ?? '' : '';

  if (
    !ALLOWED_ATTACHMENT_EXTENSIONS.includes(
      ext as (typeof ALLOWED_ATTACHMENT_EXTENSIONS)[number],
    )
  ) {
    return {
      valid: false,
      extension: ext,
      error: 'امتداد الملف غير مسموح. الصيغ المدعومة هي: JPEG, PNG, WEBP, PDF فقط.',
    };
  }

  if (
    file.type &&
    !ALLOWED_ATTACHMENT_MIME_TYPES.includes(
      file.type.toLowerCase() as (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number],
    )
  ) {
    return {
      valid: false,
      extension: ext,
      error: 'نوع الملف (MIME) غير مصرح به. يسمح بالصور القياسية وملفات PDF فقط.',
    };
  }

  if (file.size <= 0) {
    return {
      valid: false,
      extension: ext,
      error: 'الملف المحدد فارغ ولا يمكن رفعه.',
    };
  }

  const maxBytes = Math.max(1, Math.min(25, maxSizeMb)) * 1024 * 1024;
  if (file.size > maxBytes) {
    return {
      valid: false,
      extension: ext,
      error: `حجم الملف يتجاوز الحد الأقصى المسموح (${maxSizeMb} ميجابايت).`,
    };
  }

  return {valid: true, extension: ext};
}

export function buildTenantStorageObjectPath(
  tenantId: string,
  entityType: 'shipment' | 'message' | 'delivery_proof' | 'pickup_request',
  entityId: string,
  extension: string,
  now = new Date(),
): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const token =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const cleanExt = extension.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'bin';
  return `${tenantId}/${entityType}/${entityId}/${yyyy}-${mm}-${dd}/${token}.${cleanExt}`;
}

export async function uploadPrivateAttachment(
  tenantId: string,
  bucketId: PrivateStorageBucketId,
  entityType: 'shipment' | 'message' | 'delivery_proof' | 'pickup_request',
  entityId: string,
  file: File,
  maxSizeMb = 5,
): Promise<AttachmentDraftPayload> {
  const validation = validateAttachmentFile(file, maxSizeMb);
  if (!validation.valid) {
    throw new Error(validation.error ?? 'الملف غير صالح.');
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('عميل Supabase غير مهيأ.');
  }

  const objectPath = buildTenantStorageObjectPath(
    tenantId,
    entityType,
    entityId,
    validation.extension,
  );
  const contentType =
    file.type ||
    (validation.extension === 'pdf'
      ? 'application/pdf'
      : `image/${validation.extension === 'jpg' ? 'jpeg' : validation.extension}`);

  const {error} = await supabase.storage.from(bucketId).upload(objectPath, file, {
    contentType,
    upsert: false,
  });

  if (error) {
    throw new Error(error.message || 'تعذر رفع الملف إلى حاوية التخزين الخاصة.');
  }

  return {
    bucket_id: bucketId,
    object_path: objectPath,
    file_name: file.name,
    mime_type: contentType,
    size_bytes: file.size,
  };
}

export async function getSignedAttachmentUrl(
  bucketId: PrivateStorageBucketId,
  objectPath: string,
  expiresInSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('عميل Supabase غير مهيأ.');
  }

  const {data, error} = await supabase.storage
    .from(bucketId)
    .createSignedUrl(objectPath, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message || 'تعذر إصدار رابط التحميل المؤقت.');
  }

  if (!isSafeHttpUrl(data.signedUrl)) {
    throw new Error('رابط الملف غير صالح.');
  }

  return data.signedUrl;
}

export async function listConversations(
  tenantId: string,
  filters?: {entityType?: ConversationEntityType | ''; search?: string},
): Promise<ConversationRecord[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  let query = supabase
    .from('conversations')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('last_message_at', {ascending: false})
    .limit(100);

  if (filters?.entityType) {
    query = query.eq('entity_type', filters.entityType);
  }

  const {data, error} = await query;
  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as ConversationRecord[];
  const q = filters?.search?.trim().toLowerCase();
  if (!q) return rows;

  return rows.filter(
    (row) =>
      row.subject.toLowerCase().includes(q) ||
      (row.last_message_preview ?? '').toLowerCase().includes(q),
  );
}

export async function openOrGetConversation(
  tenantId: string,
  entityType: ConversationEntityType,
  entityId?: string | null,
  subject?: string | null,
): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('عميل Supabase غير مهيأ.');
  }

  const {data, error} = await supabase.rpc('open_or_get_conversation', {
    p_tenant_id: tenantId,
    p_entity_type: entityType,
    p_entity_id: entityId ?? null,
    p_subject: subject ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as string;
}

interface RawMessageRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly conversation_id: string;
  readonly sender_user_id: string;
  readonly sender_display_name: string;
  readonly sender_subject_type: 'staff' | 'client' | 'courier' | 'platform_support';
  readonly visibility: MessageVisibility;
  readonly body: string;
  readonly idempotency_key: string | null;
  readonly created_at: string;
  readonly message_attachments?: readonly {
    readonly storage_objects_metadata: StorageObjectMetadataRecord | null;
  }[];
}

export async function listConversationMessages(
  tenantId: string,
  conversationId: string,
): Promise<MessageRecord[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const {data, error} = await supabase
    .from('messages')
    .select(
      'id, tenant_id, conversation_id, sender_user_id, sender_display_name, sender_subject_type, visibility, body, idempotency_key, created_at, message_attachments(storage_objects_metadata(*))',
    )
    .eq('tenant_id', tenantId)
    .eq('conversation_id', conversationId)
    .order('created_at', {ascending: true})
    .limit(200);

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as unknown as RawMessageRow[];
  return rows.map((row) => ({
    id: row.id,
    tenant_id: row.tenant_id,
    conversation_id: row.conversation_id,
    sender_user_id: row.sender_user_id,
    sender_display_name: row.sender_display_name,
    sender_subject_type: row.sender_subject_type,
    visibility: row.visibility,
    body: row.body,
    idempotency_key: row.idempotency_key,
    created_at: row.created_at,
    attachments: (row.message_attachments ?? [])
      .map((ma) => ma.storage_objects_metadata)
      .filter((obj): obj is StorageObjectMetadataRecord => obj !== null),
  }));
}

export async function sendConversationMessage(
  tenantId: string,
  conversationId: string,
  body: string,
  visibility: MessageVisibility = 'external',
  idempotencyKey?: string,
  attachments: readonly AttachmentDraftPayload[] = [],
): Promise<SendMessageResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('عميل Supabase غير مهيأ.');
  }

  const {data, error} = await supabase.rpc('send_conversation_message', {
    p_tenant_id: tenantId,
    p_conversation_id: conversationId,
    p_body: body,
    p_visibility: visibility,
    p_idempotency_key: idempotencyKey ?? null,
    p_attachments: attachments,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as SendMessageResult;
}

export async function markConversationRead(
  tenantId: string,
  conversationId: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;

  const {error} = await supabase.rpc('mark_conversation_read', {
    p_tenant_id: tenantId,
    p_conversation_id: conversationId,
  });

  if (error) {
    throw new Error(error.message);
  }
}

interface RawShipmentAttachmentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly shipment_id: string;
  readonly storage_object_id: string;
  readonly category: ShipmentAttachmentCategory;
  readonly notes: string | null;
  readonly created_by: string | null;
  readonly created_at: string;
  readonly storage_objects_metadata: StorageObjectMetadataRecord | null;
}

export async function listShipmentAttachments(
  tenantId: string,
  shipmentId: string,
): Promise<ShipmentAttachmentRecord[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const {data, error} = await supabase
    .from('shipment_attachments')
    .select('*, storage_objects_metadata(*)')
    .eq('tenant_id', tenantId)
    .eq('shipment_id', shipmentId)
    .order('created_at', {ascending: false});

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as unknown as RawShipmentAttachmentRow[];
  return rows
    .filter(
      (r): r is RawShipmentAttachmentRow & {storage_objects_metadata: StorageObjectMetadataRecord} =>
        r.storage_objects_metadata !== null,
    )
    .map((r) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      shipment_id: r.shipment_id,
      storage_object_id: r.storage_object_id,
      category: r.category,
      notes: r.notes,
      created_by: r.created_by,
      created_at: r.created_at,
      storage_object: r.storage_objects_metadata,
    }));
}

export async function registerShipmentAttachment(
  tenantId: string,
  shipmentId: string,
  payload: AttachmentDraftPayload & {
    readonly category: ShipmentAttachmentCategory;
    readonly visibility: MessageVisibility;
    readonly notes?: string;
  },
): Promise<string> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('عميل Supabase غير مهيأ.');
  }

  const {data, error} = await supabase.rpc('register_shipment_attachment', {
    p_tenant_id: tenantId,
    p_shipment_id: shipmentId,
    p_bucket_id: payload.bucket_id,
    p_object_path: payload.object_path,
    p_file_name: payload.file_name,
    p_mime_type: payload.mime_type,
    p_size_bytes: payload.size_bytes,
    p_category: payload.category,
    p_visibility: payload.visibility,
    p_notes: payload.notes ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as string;
}

export async function deleteShipmentAttachment(
  tenantId: string,
  attachmentId: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('عميل Supabase غير مهيأ.');
  }

  const {error} = await supabase.rpc('delete_shipment_attachment', {
    p_tenant_id: tenantId,
    p_attachment_id: attachmentId,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function listMyNotifications(
  tenantId: string,
  options?: {unreadOnly?: boolean; category?: string},
): Promise<NotificationRecord[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  let query = supabase
    .from('notifications')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', {ascending: false})
    .limit(100);

  if (options?.unreadOnly) {
    query = query.eq('is_read', false);
  }
  if (options?.category) {
    query = query.eq('category', options.category);
  }

  const {data, error} = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as NotificationRecord[];
}

export async function getUnreadNotificationsCount(tenantId: string): Promise<number> {
  const supabase = getSupabaseClient();
  if (!supabase) return 0;

  const {count, error} = await supabase
    .from('notifications')
    .select('id', {count: 'exact', head: true})
    .eq('tenant_id', tenantId)
    .eq('is_read', false);

  if (error) {
    return 0;
  }

  return count ?? 0;
}

export async function markNotificationsRead(
  tenantId: string,
  notificationIds?: readonly string[] | null,
): Promise<number> {
  const supabase = getSupabaseClient();
  if (!supabase) return 0;

  const {data, error} = await supabase.rpc('mark_notifications_read', {
    p_tenant_id: tenantId,
    p_notification_ids: notificationIds && notificationIds.length > 0 ? [...notificationIds] : null,
  });

  if (error) {
    throw new Error(error.message);
  }

  return Number(data ?? 0);
}

export async function getTenantMessagingSettings(
  tenantId: string,
): Promise<TenantMessagingSettings> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      tenant_id: tenantId,
      message_retention_days: 365,
      attachment_max_size_mb: 5,
      notify_on_shipment_status: true,
      notify_on_new_message: true,
      notify_on_settlement: true,
    };
  }

  const {data, error} = await supabase.rpc('get_tenant_messaging_settings', {
    p_tenant_id: tenantId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as TenantMessagingSettings;
}

export async function updateTenantMessagingSettings(
  tenantId: string,
  settings: Omit<TenantMessagingSettings, 'tenant_id'>,
): Promise<TenantMessagingSettings> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error('عميل Supabase غير مهيأ.');
  }

  const {data, error} = await supabase.rpc('update_tenant_messaging_settings', {
    p_tenant_id: tenantId,
    p_payload: settings,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as TenantMessagingSettings;
}

export interface RealtimeMessagingCallbacks {
  readonly onMessageInserted?: (conversationId: string) => void;
  readonly onNotificationChanged?: () => void;
}

/**
 * Subscribes to server-authoritative Supabase Realtime postgres_changes
 * for messages & notifications within the tenant.
 */
export function subscribeToMessagingUpdates(
  tenantId: string,
  userId: string | undefined,
  callbacks: RealtimeMessagingCallbacks,
): () => void {
  const supabase = getSupabaseClient();
  if (!supabase || !tenantId) {
    return () => {};
  }

  const channelName = `shipflow-messaging-${tenantId}-${userId ?? 'anon'}-${Math.random().toString(36).slice(2, 8)}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `tenant_id=eq.${tenantId}`,
      },
      (payload) => {
        const convId = (payload.new as {conversation_id?: string} | null)?.conversation_id;
        if (convId && callbacks.onMessageInserted) {
          callbacks.onMessageInserted(convId);
        }
      },
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `tenant_id=eq.${tenantId}`,
      },
      () => {
        if (callbacks.onNotificationChanged) {
          callbacks.onNotificationChanged();
        }
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}