import type {ShipmentListItem, ShipmentOperationalStatus} from '@/types/shipments';

export type PickupListStatus = 'draft' | 'approved' | 'completed' | 'cancelled';
export type WarehouseManifestType = 'intake' | 'transfer_out';
export type WarehouseManifestStatus =
  | 'draft'
  | 'in_transit'
  | 'approved'
  | 'partially_received'
  | 'cancelled';
export type ManifestItemReceiveStatus = 'pending' | 'received' | 'missing_discrepancy' | 'released';
export type AddedViaMode = 'manual' | 'barcode';
export type AdminHangReleaseAction = 'return_to_origin' | 'force_receive_destination';

export type WarehousePrintLayoutMode =
  | 'two_copies_same'
  | 'three_copies_same'
  | 'two_different'
  | 'three_different'
  | 'barcode_sticker';

export const PICKUP_STATUS_LABELS: Record<PickupListStatus, string> = {
  draft: 'مسودة قيد التجهيز',
  approved: 'معتمدة وجاري الالتقاط',
  completed: 'مكتملة الاستلام',
  cancelled: 'ملغاة',
};

export const MANIFEST_STATUS_LABELS: Record<WarehouseManifestStatus, string> = {
  draft: 'مسودة قيد التجهيز',
  in_transit: 'قيد النقل بين الفروع',
  approved: 'معتمدة ومستلمة',
  partially_received: 'مستلمة جزئيًا',
  cancelled: 'ملغاة',
};

export const MANIFEST_ITEM_STATUS_LABELS: Record<ManifestItemReceiveStatus, string> = {
  pending: 'بانتظار الاعتماد / الاستلام',
  received: 'مستلم بالمخزن',
  missing_discrepancy: 'عجز / فرق جرد',
  released: 'مفكوك التعليق إداريًا',
};

export const WAREHOUSE_PRINT_LAYOUT_LABELS: Record<WarehousePrintLayoutMode, string> = {
  two_copies_same: 'نسختان لنفس البوليصة',
  three_copies_same: '3 نسخ لنفس البوليصة',
  two_different: 'بوليصتان مختلفتان في الورقة',
  three_different: '3 بوالص مختلفة في الورقة',
  barcode_sticker: 'ملصق بالباركود',
};

export interface PickupListRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly list_code: string;
  readonly list_date: string;
  readonly branch_id: string;
  readonly courier_id: string | null;
  readonly route_id: string | null;
  readonly movement_type_id: string | null;
  readonly client_id: string | null;
  readonly status: PickupListStatus;
  readonly notes: string | null;
  readonly approved_at: string | null;
  readonly approved_by: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly shipments_count?: number;
}

export interface PickupListItemRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly pickup_list_id: string;
  readonly shipment_id: string;
  readonly added_via: AddedViaMode;
  readonly pickup_completed_at: string | null;
  readonly notes: string | null;
  readonly created_at: string;
  readonly shipment?: ShipmentListItem;
}

export interface PickupListDetail {
  readonly list: PickupListRecord;
  readonly items: readonly PickupListItemRecord[];
}

export interface WarehouseManifestRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly manifest_code: string;
  readonly manifest_type: WarehouseManifestType;
  readonly manifest_date: string;
  readonly branch_id: string;
  readonly target_branch_id: string | null;
  readonly source_transfer_manifest_id: string | null;
  readonly courier_id: string | null;
  readonly movement_type_id: string | null;
  readonly status: WarehouseManifestStatus;
  readonly notes: string | null;
  readonly approved_at: string | null;
  readonly approved_by: string | null;
  readonly released_at: string | null;
  readonly released_by: string | null;
  readonly release_reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly shipments_count?: number;
}

export interface WarehouseManifestItemRecord {
  readonly id: string;
  readonly tenant_id: string;
  readonly manifest_id: string;
  readonly shipment_id: string;
  readonly added_via: AddedViaMode;
  readonly receive_status: ManifestItemReceiveStatus;
  readonly verified_weight_kg: number | null;
  readonly notes: string | null;
  readonly received_at: string | null;
  readonly created_at: string;
  readonly shipment?: ShipmentListItem;
}

export interface WarehouseManifestDetail {
  readonly manifest: WarehouseManifestRecord;
  readonly items: readonly WarehouseManifestItemRecord[];
}

export interface InboundTransferShipmentRecord {
  readonly shipment_id: string;
  readonly shipment_number: string;
  readonly barcode_token: string;
  readonly origin_branch_id: string;
  readonly target_branch_id: string;
  readonly transfer_manifest_id: string;
  readonly transfer_manifest_code: string;
  readonly recipient_name: string | null;
  readonly recipient_mobile: string | null;
  readonly chargeable_weight_kg: number;
  readonly pieces_count: number;
  readonly recipient_collect_amount: number;
}

export interface OperationsListFilter {
  readonly search?: string;
  readonly code?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly branchId?: string;
  readonly targetBranchId?: string;
  readonly status?: string;
  readonly courierId?: string;
  readonly originGovId?: string;
  readonly originRegionId?: string;
  readonly destGovId?: string;
  readonly destRegionId?: string;
}

export interface CreatePickupListInput {
  readonly list_date: string;
  readonly branch_id: string;
  readonly courier_id: string | null;
  readonly route_id: string | null;
  readonly movement_type_id: string | null;
  readonly client_id: string | null;
  readonly notes: string | null;
}

export interface CreateWarehouseManifestInput {
  readonly manifest_type: WarehouseManifestType;
  readonly manifest_date: string;
  readonly branch_id: string;
  readonly target_branch_id?: string | null;
  readonly source_transfer_manifest_id?: string | null;
  readonly courier_id?: string | null;
  readonly movement_type_id: string | null;
  readonly notes: string | null;
}

export interface AddOperationShipmentsResult {
  readonly added_count: number;
  readonly skipped_count: number;
}

export const PICKUP_ELIGIBLE_STATUSES: readonly ShipmentOperationalStatus[] = [
  'created',
  'pickup_scheduled',
];

export const INTAKE_ELIGIBLE_STATUSES: readonly ShipmentOperationalStatus[] = [
  'created',
  'pickup_scheduled',
  'picked_up',
  'in_transit_branch',
  'out_for_delivery',
  'delivery_failed',
  'partially_delivered',
  'return_to_sender',
];
