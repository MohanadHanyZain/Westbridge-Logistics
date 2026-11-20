import {getSupabaseClient} from '@/lib/supabase/client';
import type {ShipmentPriceSnapshotRecord} from '@/types/pricing';
import type {
  CreateShipmentInput,
  CreateShipmentResult,
  PaymentTermCode,
  PublicTrackingResult,
  ShipmentDashboardCounts,
  ShipmentDimensionRecord,
  ShipmentFullDetail,
  ShipmentListItem,
  ShipmentListPreset,
  ShipmentNoteRecord,
  ShipmentNoteType,
  ShipmentOperationalStatus,
  ShipmentPackageRecord,
  ShipmentPartyRecord,
  ShipmentRecord,
  ShipmentReferenceRecord,
  ShipmentRelationRecord,
  ShipmentStatusEventRecord,
  ShipmentTrackingTokenRecord,
  ShipmentTypeCode,
} from '@/types/shipments';

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }
  return client;
}

export interface ListShipmentsFilter {
  readonly preset?: ShipmentListPreset;
  readonly search?: string;
  readonly status?: ShipmentOperationalStatus | '';
  readonly originBranchId?: string;
  readonly currentBranchId?: string;
  readonly serviceId?: string;
  readonly shipmentTypeCode?: ShipmentTypeCode | '';
  readonly paymentTermCode?: PaymentTermCode | '';
  readonly clientId?: string;
  readonly destinationGovId?: string;
  readonly destinationRegionId?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  readonly limit?: number;
}

const PRESET_STATUSES: Partial<Record<ShipmentListPreset, readonly ShipmentOperationalStatus[]>> = {
  warehouse: ['in_warehouse', 'picked_up', 'in_transit_branch'],
  'out-for-delivery': ['out_for_delivery'],
  rescheduled: ['rescheduled', 'delivery_failed'],
  returns: ['return_to_sender', 'returned', 'partially_delivered'],
};

export async function listShipments(
  tenantId: string,
  filter: ListShipmentsFilter = {},
): Promise<readonly ShipmentListItem[]> {
  const client = requireClient();

  let query = client
    .from('shipments')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', {ascending: false})
    .limit(filter.limit ?? 200);

  if (filter.status) {
    query = query.eq('operational_status', filter.status);
  } else if (filter.preset && PRESET_STATUSES[filter.preset]) {
    query = query.in('operational_status', PRESET_STATUSES[filter.preset] as ShipmentOperationalStatus[]);
  }

  if (filter.originBranchId) query = query.eq('origin_branch_id', filter.originBranchId);
  if (filter.currentBranchId) query = query.eq('current_branch_id', filter.currentBranchId);
  if (filter.serviceId) query = query.eq('service_id', filter.serviceId);
  if (filter.shipmentTypeCode) query = query.eq('shipment_type_code', filter.shipmentTypeCode);
  if (filter.paymentTermCode) query = query.eq('payment_term_code', filter.paymentTermCode);
  if (filter.clientId) query = query.eq('client_id', filter.clientId);
  if (filter.destinationGovId) query = query.eq('recipient_governorate_id', filter.destinationGovId);
  if (filter.destinationRegionId) query = query.eq('recipient_region_id', filter.destinationRegionId);
  if (filter.dateFrom) query = query.gte('pickup_date', filter.dateFrom);
  if (filter.dateTo) query = query.lte('pickup_date', filter.dateTo);

  const {data: shipmentsData, error} = await query;
  if (error) {
    throw new Error('تعذر تحميل قائمة الشحنات.');
  }

  const rows = (shipmentsData ?? []) as ShipmentRecord[];
  if (rows.length === 0) return [];

  const shipmentIds = rows.map((r) => r.id);

  const [partiesRes, tokensRes] = await Promise.all([
    client
      .from('shipment_parties')
      .select('id, tenant_id, shipment_id, party_type, name, phone, mobile, governorate_id, city_id, region_id, address_line')
      .eq('tenant_id', tenantId)
      .in('shipment_id', shipmentIds),
    client
      .from('shipment_tracking_tokens')
      .select('shipment_id, token')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('shipment_id', shipmentIds),
  ]);

  const partiesByShipment = new Map<string, {sender?: ShipmentPartyRecord; recipient?: ShipmentPartyRecord}>();
  for (const p of (partiesRes.data ?? []) as ShipmentPartyRecord[]) {
    const entry = partiesByShipment.get(p.shipment_id) ?? {};
    if (p.party_type === 'sender') entry.sender = p;
    else if (p.party_type === 'recipient') entry.recipient = p;
    partiesByShipment.set(p.shipment_id, entry);
  }

  const tokenByShipment = new Map<string, string>();
  for (const t of (tokensRes.data ?? []) as {shipment_id: string; token: string}[]) {
    tokenByShipment.set(t.shipment_id, t.token);
  }

  const enriched: ShipmentListItem[] = rows.map((row) => {
    const partyPair = partiesByShipment.get(row.id);
    return {
      ...row,
      sender_name: partyPair?.sender?.name,
      sender_mobile: partyPair?.sender?.mobile,
      recipient_name: partyPair?.recipient?.name,
      recipient_mobile: partyPair?.recipient?.mobile,
      recipient_address: partyPair?.recipient?.address_line,
      tracking_token: tokenByShipment.get(row.id),
    };
  });

  const q = filter.search?.trim().toLowerCase();
  if (!q) return enriched;

  return enriched.filter((item) =>
    [
      item.shipment_number,
      item.barcode_token,
      item.external_reference ?? '',
      item.package_description ?? '',
      item.sender_name ?? '',
      item.sender_mobile ?? '',
      item.recipient_name ?? '',
      item.recipient_mobile ?? '',
      item.tracking_token ?? '',
    ].some((field) => field.toLowerCase().includes(q)),
  );
}

export async function getShipmentDetail(
  tenantId: string,
  shipmentId: string,
): Promise<ShipmentFullDetail | null> {
  const client = requireClient();

  const {data: shpData, error: shpErr} = await client
    .from('shipments')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', shipmentId)
    .maybeSingle();

  if (shpErr) throw new Error('تعذر تحميل بيانات الشحنة.');
  if (!shpData) return null;

  const [partiesRes, pkgRes, dimRes, snapRes, evtRes, relRes, tokRes, noteRes, refRes] =
    await Promise.all([
      client.from('shipment_parties').select('*').eq('tenant_id', tenantId).eq('shipment_id', shipmentId),
      client
        .from('shipment_packages')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('shipment_id', shipmentId)
        .order('package_index'),
      client
        .from('shipment_dimensions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('shipment_id', shipmentId)
        .order('version_number', {ascending: false}),
      client
        .from('shipment_price_snapshots')
        .select(
          'id, tenant_id, client_id, service_id, version_number, chargeable_weight_kg, price_mode, entered_amount, tax_mode, tax_amount, total_shipping_fee, recipient_collect_amount, client_net_payout, is_manual_override, override_reason, created_at',
        )
        .eq('tenant_id', tenantId)
        .eq('shipment_id', shipmentId)
        .order('version_number', {ascending: false}),
      client
        .from('shipment_status_events')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('shipment_id', shipmentId)
        .order('created_at', {ascending: false}),
      client
        .from('shipment_relations')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('shipment_id', shipmentId)
        .order('created_at', {ascending: false}),
      client
        .from('shipment_tracking_tokens')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('shipment_id', shipmentId)
        .order('created_at', {ascending: false}),
      client
        .from('shipment_notes')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('shipment_id', shipmentId)
        .order('created_at', {ascending: false}),
      client
        .from('shipment_reference_numbers')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('shipment_id', shipmentId),
    ]);

  return {
    shipment: shpData as ShipmentRecord,
    parties: (partiesRes.data ?? []) as ShipmentPartyRecord[],
    packages: (pkgRes.data ?? []) as ShipmentPackageRecord[],
    dimensions: (dimRes.data ?? []) as ShipmentDimensionRecord[],
    snapshots: (snapRes.data ?? []) as ShipmentPriceSnapshotRecord[],
    events: (evtRes.data ?? []) as ShipmentStatusEventRecord[],
    relations: (relRes.data ?? []) as ShipmentRelationRecord[],
    trackingTokens: (tokRes.data ?? []) as ShipmentTrackingTokenRecord[],
    notes: (noteRes.data ?? []) as ShipmentNoteRecord[],
    references: (refRes.data ?? []) as ShipmentReferenceRecord[],
  };
}

export async function createShipment(
  tenantId: string,
  idempotencyKey: string,
  payload: CreateShipmentInput,
): Promise<CreateShipmentResult> {
  const client = requireClient();
  const {data, error} = await client.rpc('create_shipment', {
    p_tenant_id: tenantId,
    p_idempotency_key: idempotencyKey,
    p_payload: payload,
  });

  if (error || !data) {
    throw new Error(error?.message || 'تعذر إنشاء الشحنة على الخادم.');
  }

  return data as CreateShipmentResult;
}

export interface TransitionShipmentStatusInput {
  readonly tenantId: string;
  readonly shipmentId: string;
  readonly toStatus: ShipmentOperationalStatus;
  readonly notes?: string | null;
  readonly exceptionReasonId?: string | null;
  readonly branchId?: string | null;
  readonly courierId?: string | null;
  readonly deliveredPieces?: number | null;
  readonly deliveredAmount?: number | null;
}

export async function transitionShipmentStatus(
  input: TransitionShipmentStatusInput,
): Promise<{
  readonly shipment_id: string;
  readonly from_status: ShipmentOperationalStatus;
  readonly to_status: ShipmentOperationalStatus;
}> {
  const client = requireClient();
  const {data, error} = await client.rpc('transition_shipment_status', {
    p_tenant_id: input.tenantId,
    p_shipment_id: input.shipmentId,
    p_to_status: input.toStatus,
    p_notes: input.notes?.trim() || null,
    p_exception_reason_id: input.exceptionReasonId || null,
    p_branch_id: input.branchId || null,
    p_courier_id: input.courierId || null,
    p_delivered_pieces: input.deliveredPieces ?? null,
    p_delivered_amount: input.deliveredAmount ?? null,
  });

  if (error || !data) {
    throw new Error(error?.message || 'تعذر تحديث حالة الشحنة.');
  }

  return data as {
    shipment_id: string;
    from_status: ShipmentOperationalStatus;
    to_status: ShipmentOperationalStatus;
  };
}

export interface RepriceShipmentInput {
  readonly tenantId: string;
  readonly shipmentId: string;
  readonly actualWeightKg: number;
  readonly lengthCm: number;
  readonly widthCm: number;
  readonly heightCm: number;
  readonly overrideTotalFee?: number | null;
  readonly reason: string;
}

export async function repriceShipment(input: RepriceShipmentInput): Promise<{
  readonly snapshot_id: string;
  readonly version_number: number;
  readonly chargeable_weight_kg: number;
  readonly total_shipping_fee: number;
}> {
  const client = requireClient();
  const {data, error} = await client.rpc('reprice_shipment_weight_or_override', {
    p_tenant_id: input.tenantId,
    p_shipment_id: input.shipmentId,
    p_actual_weight_kg: input.actualWeightKg,
    p_length_cm: input.lengthCm,
    p_width_cm: input.widthCm,
    p_height_cm: input.heightCm,
    p_override_total_fee: input.overrideTotalFee ?? null,
    p_reason: input.reason.trim(),
  });

  if (error || !data) {
    throw new Error(error?.message || 'تعذر إعادة تسعير الشحنة.');
  }

  return data as {
    snapshot_id: string;
    version_number: number;
    chargeable_weight_kg: number;
    total_shipping_fee: number;
  };
}

export async function addShipmentNote(
  tenantId: string,
  shipmentId: string,
  noteType: ShipmentNoteType,
  body: string,
  authorName: string,
): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('shipment_notes').insert({
    tenant_id: tenantId,
    shipment_id: shipmentId,
    note_type: noteType,
    body: body.trim(),
    created_by_name: authorName.trim() || 'مستخدم النظام',
  });
  if (error) {
    throw new Error('تعذر حفظ الملاحظة.');
  }
}

export async function trackPublicShipment(
  tenantSlug: string,
  query: string,
): Promise<PublicTrackingResult> {
  const client = requireClient();
  const {data, error} = await client.rpc('track_public_shipment', {
    p_tenant_slug: tenantSlug.trim().toLowerCase(),
    p_query: query.trim(),
  });
  if (error || !data) {
    throw new Error('تعذر الاستعلام عن الشحنة حاليًا.');
  }
  return data as PublicTrackingResult;
}

export async function fetchShipmentDashboardCounts(
  tenantId: string,
): Promise<ShipmentDashboardCounts> {
  const client = requireClient();

  const [totalRes, whRes, ofdRes, delRes, retRes] = await Promise.all([
    client.from('shipments').select('id', {count: 'exact', head: true}).eq('tenant_id', tenantId),
    client
      .from('shipments')
      .select('id', {count: 'exact', head: true})
      .eq('tenant_id', tenantId)
      .in('operational_status', ['in_warehouse', 'picked_up', 'in_transit_branch']),
    client
      .from('shipments')
      .select('id', {count: 'exact', head: true})
      .eq('tenant_id', tenantId)
      .eq('operational_status', 'out_for_delivery'),
    client
      .from('shipments')
      .select('id', {count: 'exact', head: true})
      .eq('tenant_id', tenantId)
      .in('operational_status', ['delivered', 'partially_delivered']),
    client
      .from('shipments')
      .select('id', {count: 'exact', head: true})
      .eq('tenant_id', tenantId)
      .in('operational_status', ['return_to_sender', 'returned']),
  ]);

  return {
    totalCount: totalRes.count ?? 0,
    inWarehouseCount: whRes.count ?? 0,
    outForDeliveryCount: ofdRes.count ?? 0,
    deliveredCount: delRes.count ?? 0,
    returnsCount: retRes.count ?? 0,
  };
}
