export type ConversationEntityType = 'shipment' | 'client' | 'pickup_request' | 'general';

export type ConversationStatus = 'open' | 'resolved' | 'archived';

export type MessageVisibility = 'external' | 'internal';

export type PrivateStorageBucketId =
  | 'shipment-attachments'
  | 'message-attachments'
  | 'delivery-proof';

export type ShipmentAttachmentCategory =
  | 'general'
  | 'waybill'
  | 'damage_photo'
  | 'delivery_proof'
  | 'exception_photo';

export type NotificationCategory =
  | 'shipment_status'
  | 'new_message'
  | 'pickup_request'
  | 'settlement'
  | 'delivery_exception'
  | 'system';

export interface StorageObjectMetadataRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly bucket_id: PrivateStorageBucketId;
  readonly object_path: string;
  readonly entity_type: 'shipment' | 'message' | 'delivery_proof' | 'pickup_request';
  readonly entity_id: string;
  readonly shipment_id: string | null;
  readonly client_id: string | null;
  readonly file_name: string;
  readonly mime_type: string;
  readonly size_bytes: number;
  readonly visibility: MessageVisibility;
  readonly uploaded_by: string | null;
  readonly uploaded_by_name: string | null;
  readonly created_at: string;
}

export interface AttachmentDraftPayload {
  readonly bucket_id: PrivateStorageBucketId;
  readonly object_path: string;
  readonly file_name: string;
  readonly mime_type: string;
  readonly size_bytes: number;
}

export interface ConversationRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly entity_type: ConversationEntityType;
  readonly entity_id: string | null;
  readonly shipment_id: string | null;
  readonly client_id: string | null;
  readonly courier_id: string | null;
  readonly branch_id: string | null;
  readonly subject: string;
  readonly status: ConversationStatus;
  readonly last_message_at: string;
  readonly last_message_preview: string | null;
  readonly created_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface MessageRecord {
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
  readonly attachments: readonly StorageObjectMetadataRecord[];
}

export interface ShipmentAttachmentRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly shipment_id: string;
  readonly storage_object_id: string;
  readonly category: ShipmentAttachmentCategory;
  readonly notes: string | null;
  readonly created_by: string | null;
  readonly created_at: string;
  readonly storage_object: StorageObjectMetadataRecord;
}

export interface NotificationRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly recipient_user_id: string;
  readonly category: NotificationCategory;
  readonly title: string;
  readonly body: string;
  readonly entity_type: string | null;
  readonly entity_id: string | null;
  readonly action_path: string | null;
  readonly is_read: boolean;
  readonly read_at: string | null;
  readonly created_at: string;
}

export interface TenantMessagingSettings {
  readonly tenant_id: string;
  readonly message_retention_days: number;
  readonly attachment_max_size_mb: number;
  readonly notify_on_shipment_status: boolean;
  readonly notify_on_new_message: boolean;
  readonly notify_on_settlement: boolean;
}

export interface SendMessageResult {
  readonly message_id: string;
  readonly conversation_id: string;
  readonly attachments_count?: number;
  readonly deduplicated: boolean;
}

export const CONVERSATION_ENTITY_LABELS: Record<ConversationEntityType, string> = {
  shipment: 'شحنة',
  client: 'تاجر / عميل',
  pickup_request: 'طلب التقاط',
  general: 'تواصل داخلي',
};

export const SHIPMENT_ATTACHMENT_CATEGORY_LABELS: Record<ShipmentAttachmentCategory, string> = {
  general: 'مستند عام',
  waybill: 'بوليصة / فاتورة',
  damage_photo: 'صورة تلف',
  delivery_proof: 'إثبات تسليم (POD)',
  exception_photo: 'صورة تعذر تسليم',
};

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  shipment_status: 'حالة شحنة',
  new_message: 'رسالة جديدة',
  pickup_request: 'طلب التقاط',
  settlement: 'تسوية مالية',
  delivery_exception: 'تعذر / مرتجع',
  system: 'إشعار نظام',
};