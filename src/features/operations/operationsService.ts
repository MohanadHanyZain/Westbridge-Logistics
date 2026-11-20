import {getSupabaseClient} from '@/lib/supabase/client';
import {
  INTAKE_ELIGIBLE_STATUSES,
  PICKUP_ELIGIBLE_STATUSES,
  type AddOperationShipmentsResult,
  type AdminHangReleaseAction,
  type CreatePickupListInput,
  type CreateWarehouseManifestInput,
  type InboundTransferShipmentRecord,
  type OperationsListFilter,
  type PickupListDetail,
  type PickupListItemRecord,
  type PickupListRecord,
  type WarehouseManifestDetail,
  type WarehouseManifestItemRecord,
  type WarehouseManifestRecord,
  type WarehouseManifestType,
} from '@/types/operations';
import type {ShipmentListItem, ShipmentPartyRecord, ShipmentRecord} from '@/types/shipments';

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }
  return client;
}

async function enrichShipments(
  tenantId: string,
  shipments: readonly ShipmentRecord[],
): Promise<Map<string, ShipmentListItem>> {
  const map = new Map<string, ShipmentListItem>();
  if (shipments.length === 0) return map;

  const client = requireClient();
  const ids = shipments.map((s) => s.id);
  const {data: partyRows} = await client
    .from('shipment_parties')
    .select(
      'id, tenant_id, shipment_id, party_type, name, phone, mobile, governorate_id, city_id, region_id, address_line',
    )
    .eq('tenant_id', tenantId)
    .in('shipment_id', ids);

  const byShp = new Map<string, {sender?: ShipmentPartyRecord; recipient?: ShipmentPartyRecord}>();
  for (const p of (partyRows ?? []) as ShipmentPartyRecord[]) {
    const entry = byShp.get(p.shipment_id) ?? {};
    if (p.party_type === 'sender') entry.sender = p;
    else if (p.party_type === 'recipient') entry.recipient = p;
    byShp.set(p.shipment_id, entry);
  }

  for (const s of shipments) {
    const parties = byShp.get(s.id);
    map.set(s.id, {
      ...s,
      sender_name: parties?.sender?.name,
      sender_mobile: parties?.sender?.mobile,
      recipient_name: parties?.recipient?.name,
      recipient_mobile: parties?.recipient?.mobile,
      recipient_address: parties?.recipient?.address_line,
    });
  }
  return map;
}

// ----------------------------------------------------------------------------
// Pickup Lists
// ----------------------------------------------------------------------------
export async function listPickupLists(
  tenantId: string,
  filter: OperationsListFilter = {},
): Promise<readonly PickupListRecord[]> {
  const client = requireClient();
  let query = client
    .from('pickup_lists')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', {ascending: false})
    .limit(150);

  if (filter.branchId) query = query.eq('branch_id', filter.branchId);
  if (filter.status) query = query.eq('status', filter.status);
  if (filter.courierId) query = query.eq('courier_id', filter.courierId);
  if (filter.dateFrom) query = query.gte('list_date', filter.dateFrom);
  if (filter.dateTo) query = query.lte('list_date', filter.dateTo);

  const {data, error} = await query;
  if (error) {
    throw new Error('تعذر تحميل قوائم الالتقاط.');
  }

  const rows = (data ?? []) as PickupListRecord[];
  if (rows.length === 0) return [];

  const listIds = rows.map((r) => r.id);
  const {data: itemLinks} = await client
    .from('pickup_list_items')
    .select('pickup_list_id, shipment_id')
    .eq('tenant_id', tenantId)
    .in('pickup_list_id', listIds);

  const countsByList = new Map<string, number>();
  const shpIdsByList = new Map<string, string[]>();
  const allShpIds = new Set<string>();
  for (const link of (itemLinks ?? []) as {pickup_list_id: string; shipment_id: string}[]) {
    countsByList.set(link.pickup_list_id, (countsByList.get(link.pickup_list_id) ?? 0) + 1);
    const arr = shpIdsByList.get(link.pickup_list_id) ?? [];
    arr.push(link.shipment_id);
    shpIdsByList.set(link.pickup_list_id, arr);
    allShpIds.add(link.shipment_id);
  }

  let shpGeoMap = new Map<
    string,
    {sender_governorate_id: string; sender_region_id: string; recipient_governorate_id: string; recipient_region_id: string}
  >();
  if (
    allShpIds.size > 0 &&
    (filter.originGovId || filter.originRegionId || filter.destGovId || filter.destRegionId)
  ) {
    const {data: shpGeoRows} = await client
      .from('shipments')
      .select('id, sender_governorate_id, sender_region_id, recipient_governorate_id, recipient_region_id')
      .eq('tenant_id', tenantId)
      .in('id', Array.from(allShpIds));
    for (const r of (shpGeoRows ?? []) as {
      id: string;
      sender_governorate_id: string;
      sender_region_id: string;
      recipient_governorate_id: string;
      recipient_region_id: string;
    }[]) {
      shpGeoMap.set(r.id, r);
    }
  }

  const enriched = rows.map((row) => ({
    ...row,
    shipments_count: countsByList.get(row.id) ?? 0,
  }));

  const searchLower = filter.search?.trim().toLowerCase() ?? '';
  const codeLower = filter.code?.trim().toLowerCase() ?? '';

  return enriched.filter((row) => {
    if (codeLower && !row.list_code.toLowerCase().includes(codeLower)) return false;
    if (
      searchLower &&
      ![row.list_code, row.notes ?? '', row.list_date].some((f) => f.toLowerCase().includes(searchLower))
    ) {
      return false;
    }
    if (filter.originGovId || filter.originRegionId || filter.destGovId || filter.destRegionId) {
      const sids = shpIdsByList.get(row.id) ?? [];
      const hasGeoMatch = sids.some((sid) => {
        const geo = shpGeoMap.get(sid);
        if (!geo) return false;
        if (filter.originGovId && geo.sender_governorate_id !== filter.originGovId) return false;
        if (filter.originRegionId && geo.sender_region_id !== filter.originRegionId) return false;
        if (filter.destGovId && geo.recipient_governorate_id !== filter.destGovId) return false;
        if (filter.destRegionId && geo.recipient_region_id !== filter.destRegionId) return false;
        return true;
      });
      if (!hasGeoMatch) return false;
    }
    return true;
  });
}

export async function getPickupListDetail(
  tenantId: string,
  pickupListId: string,
): Promise<PickupListDetail | null> {
  const client = requireClient();
  const {data: listData, error: listErr} = await client
    .from('pickup_lists')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', pickupListId)
    .maybeSingle();

  if (listErr) throw new Error('تعذر تحميل تفاصيل قائمة الالتقاط.');
  if (!listData) return null;

  const {data: itemsData, error: itemsErr} = await client
    .from('pickup_list_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('pickup_list_id', pickupListId)
    .order('created_at', {ascending: true});

  if (itemsErr) throw new Error('تعذر تحميل شحنات قائمة الالتقاط.');
  const rawItems = (itemsData ?? []) as PickupListItemRecord[];

  let enrichedMap = new Map<string, ShipmentListItem>();
  if (rawItems.length > 0) {
    const shpIds = rawItems.map((i) => i.shipment_id);
    const {data: shpRows} = await client
      .from('shipments')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('id', shpIds);
    enrichedMap = await enrichShipments(tenantId, (shpRows ?? []) as ShipmentRecord[]);
  }

  return {
    list: {
      ...(listData as PickupListRecord),
      shipments_count: rawItems.length,
    },
    items: rawItems.map((item) => ({
      ...item,
      shipment: enrichedMap.get(item.shipment_id),
    })),
  };
}

export async function createPickupList(
  tenantId: string,
  payload: CreatePickupListInput,
): Promise<{readonly id: string; readonly list_code: string}> {
  const client = requireClient();
  const {data, error} = await client.rpc('create_pickup_list', {
    p_tenant_id: tenantId,
    p_payload: payload,
  });
  if (error || !data) {
    throw new Error(error?.message || 'تعذر إنشاء قائمة الالتقاط.');
  }
  return data as {id: string; list_code: string};
}

export async function addShipmentsToPickupList(
  tenantId: string,
  pickupListId: string,
  options: {readonly shipmentIds?: readonly string[]; readonly barcodeQuery?: string | null},
): Promise<AddOperationShipmentsResult> {
  const client = requireClient();
  const {data, error} = await client.rpc('add_shipments_to_pickup_list', {
    p_tenant_id: tenantId,
    p_pickup_list_id: pickupListId,
    p_shipment_ids: options.shipmentIds ?? [],
    p_barcode_query: options.barcodeQuery?.trim() || null,
  });
  if (error || !data) {
    throw new Error(error?.message || 'تعذر إضافة الشحنات إلى قائمة الالتقاط.');
  }
  return data as AddOperationShipmentsResult;
}

export async function removeShipmentFromPickupList(
  tenantId: string,
  pickupListId: string,
  shipmentId: string,
): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('remove_shipment_from_pickup_list', {
    p_tenant_id: tenantId,
    p_pickup_list_id: pickupListId,
    p_shipment_id: shipmentId,
  });
  if (error) {
    throw new Error(error.message || 'تعذر إزالة الشحنة من قائمة الالتقاط.');
  }
}

export async function approvePickupList(
  tenantId: string,
  pickupListId: string,
): Promise<{readonly id: string; readonly list_code: string; readonly shipments_count: number}> {
  const client = requireClient();
  const {data, error} = await client.rpc('approve_pickup_list', {
    p_tenant_id: tenantId,
    p_pickup_list_id: pickupListId,
  });
  if (error || !data) {
    throw new Error(error?.message || 'تعذر اعتماد قائمة الالتقاط.');
  }
  return data as {id: string; list_code: string; shipments_count: number};
}

// ----------------------------------------------------------------------------
// Warehouse Intake & Inter-Branch Transfers
// ----------------------------------------------------------------------------
export async function listWarehouseManifests(
  tenantId: string,
  manifestType: WarehouseManifestType,
  filter: OperationsListFilter = {},
): Promise<readonly WarehouseManifestRecord[]> {
  const client = requireClient();
  let query = client
    .from('warehouse_manifests')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('manifest_type', manifestType)
    .order('created_at', {ascending: false})
    .limit(150);

  if (filter.branchId) query = query.eq('branch_id', filter.branchId);
  if (filter.targetBranchId) query = query.eq('target_branch_id', filter.targetBranchId);
  if (filter.status) query = query.eq('status', filter.status);
  if (filter.courierId) query = query.eq('courier_id', filter.courierId);
  if (filter.dateFrom) query = query.gte('manifest_date', filter.dateFrom);
  if (filter.dateTo) query = query.lte('manifest_date', filter.dateTo);

  const {data, error} = await query;
  if (error) {
    throw new Error('تعذر تحميل القوائم المخزنية.');
  }

  const rows = (data ?? []) as WarehouseManifestRecord[];
  if (rows.length === 0) return [];

  const manifestIds = rows.map((r) => r.id);
  const {data: itemLinks} = await client
    .from('warehouse_manifest_items')
    .select('manifest_id, shipment_id')
    .eq('tenant_id', tenantId)
    .in('manifest_id', manifestIds);

  const countsByManifest = new Map<string, number>();
  const shpIdsByManifest = new Map<string, string[]>();
  const allShpIds = new Set<string>();
  for (const link of (itemLinks ?? []) as {manifest_id: string; shipment_id: string}[]) {
    countsByManifest.set(link.manifest_id, (countsByManifest.get(link.manifest_id) ?? 0) + 1);
    const arr = shpIdsByManifest.get(link.manifest_id) ?? [];
    arr.push(link.shipment_id);
    shpIdsByManifest.set(link.manifest_id, arr);
    allShpIds.add(link.shipment_id);
  }

  let shpGeoMap = new Map<
    string,
    {sender_governorate_id: string; sender_region_id: string; recipient_governorate_id: string; recipient_region_id: string}
  >();
  if (
    allShpIds.size > 0 &&
    (filter.originGovId || filter.originRegionId || filter.destGovId || filter.destRegionId)
  ) {
    const {data: shpGeoRows} = await client
      .from('shipments')
      .select('id, sender_governorate_id, sender_region_id, recipient_governorate_id, recipient_region_id')
      .eq('tenant_id', tenantId)
      .in('id', Array.from(allShpIds));
    for (const r of (shpGeoRows ?? []) as {
      id: string;
      sender_governorate_id: string;
      sender_region_id: string;
      recipient_governorate_id: string;
      recipient_region_id: string;
    }[]) {
      shpGeoMap.set(r.id, r);
    }
  }

  const enriched = rows.map((row) => ({
    ...row,
    shipments_count: countsByManifest.get(row.id) ?? 0,
  }));

  const searchLower = filter.search?.trim().toLowerCase() ?? '';
  const codeLower = filter.code?.trim().toLowerCase() ?? '';

  return enriched.filter((row) => {
    if (codeLower && !row.manifest_code.toLowerCase().includes(codeLower)) return false;
    if (
      searchLower &&
      ![row.manifest_code, row.notes ?? '', row.manifest_date].some((f) =>
        f.toLowerCase().includes(searchLower),
      )
    ) {
      return false;
    }
    if (filter.originGovId || filter.originRegionId || filter.destGovId || filter.destRegionId) {
      const sids = shpIdsByManifest.get(row.id) ?? [];
      const hasGeoMatch = sids.some((sid) => {
        const geo = shpGeoMap.get(sid);
        if (!geo) return false;
        if (filter.originGovId && geo.sender_governorate_id !== filter.originGovId) return false;
        if (filter.originRegionId && geo.sender_region_id !== filter.originRegionId) return false;
        if (filter.destGovId && geo.recipient_governorate_id !== filter.destGovId) return false;
        if (filter.destRegionId && geo.recipient_region_id !== filter.destRegionId) return false;
        return true;
      });
      if (!hasGeoMatch) return false;
    }
    return true;
  });
}

export async function getWarehouseManifestDetail(
  tenantId: string,
  manifestId: string,
): Promise<WarehouseManifestDetail | null> {
  const client = requireClient();
  const {data: manifestData, error: mErr} = await client
    .from('warehouse_manifests')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', manifestId)
    .maybeSingle();

  if (mErr) throw new Error('تعذر تحميل تفاصيل القائمة.');
  if (!manifestData) return null;

  const {data: itemsData, error: iErr} = await client
    .from('warehouse_manifest_items')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('manifest_id', manifestId)
    .order('created_at', {ascending: true});

  if (iErr) throw new Error('تعذر تحميل الشحنات المدرجة في القائمة.');
  const rawItems = (itemsData ?? []) as WarehouseManifestItemRecord[];

  let enrichedMap = new Map<string, ShipmentListItem>();
  if (rawItems.length > 0) {
    const shpIds = rawItems.map((i) => i.shipment_id);
    const {data: shpRows} = await client
      .from('shipments')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('id', shpIds);
    enrichedMap = await enrichShipments(tenantId, (shpRows ?? []) as ShipmentRecord[]);
  }

  return {
    manifest: {
      ...(manifestData as WarehouseManifestRecord),
      shipments_count: rawItems.length,
    },
    items: rawItems.map((item) => ({
      ...item,
      shipment: enrichedMap.get(item.shipment_id),
    })),
  };
}

export async function createWarehouseManifest(
  tenantId: string,
  payload: CreateWarehouseManifestInput,
): Promise<{readonly id: string; readonly manifest_code: string; readonly manifest_type: WarehouseManifestType}> {
  const client = requireClient();
  const {data, error} = await client.rpc('create_warehouse_manifest', {
    p_tenant_id: tenantId,
    p_payload: payload,
  });
  if (error || !data) {
    throw new Error(error?.message || 'تعذر إنشاء القائمة.');
  }
  return data as {id: string; manifest_code: string; manifest_type: WarehouseManifestType};
}

export async function addShipmentsToWarehouseManifest(
  tenantId: string,
  manifestId: string,
  options: {readonly shipmentIds?: readonly string[]; readonly barcodeQuery?: string | null},
): Promise<AddOperationShipmentsResult> {
  const client = requireClient();
  const {data, error} = await client.rpc('add_shipments_to_warehouse_manifest', {
    p_tenant_id: tenantId,
    p_manifest_id: manifestId,
    p_shipment_ids: options.shipmentIds ?? [],
    p_barcode_query: options.barcodeQuery?.trim() || null,
  });
  if (error || !data) {
    throw new Error(error?.message || 'تعذر إضافة الشحنات إلى القائمة.');
  }
  return data as AddOperationShipmentsResult;
}

export async function removeShipmentFromWarehouseManifest(
  tenantId: string,
  manifestId: string,
  shipmentId: string,
): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('remove_shipment_from_warehouse_manifest', {
    p_tenant_id: tenantId,
    p_manifest_id: manifestId,
    p_shipment_id: shipmentId,
  });
  if (error) {
    throw new Error(error.message || 'تعذر إزالة الشحنة من القائمة.');
  }
}

export async function approveWarehouseManifest(
  tenantId: string,
  manifestId: string,
): Promise<{readonly id: string; readonly manifest_code: string; readonly status: string; readonly shipments_count: number}> {
  const client = requireClient();
  const {data, error} = await client.rpc('approve_warehouse_manifest', {
    p_tenant_id: tenantId,
    p_manifest_id: manifestId,
  });
  if (error || !data) {
    throw new Error(error?.message || 'تعذر اعتماد القائمة.');
  }
  return data as {id: string; manifest_code: string; status: string; shipments_count: number};
}

export async function listBranchInboundTransferShipments(
  tenantId: string,
  branchId: string,
): Promise<readonly InboundTransferShipmentRecord[]> {
  const client = requireClient();
  const {data, error} = await client.rpc('list_branch_inbound_transfer_shipments', {
    p_tenant_id: tenantId,
    p_branch_id: branchId,
  });
  if (error) {
    throw new Error(error.message || 'تعذر تحميل الشحنات الواردة قيد النقل.');
  }
  return (data ?? []) as InboundTransferShipmentRecord[];
}

export async function adminReleaseStuckTransfer(
  tenantId: string,
  input: {
    readonly manifestId: string;
    readonly shipmentId: string;
    readonly action: AdminHangReleaseAction;
    readonly reason: string;
  },
): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('admin_release_stuck_transfer_or_manifest', {
    p_tenant_id: tenantId,
    p_manifest_id: input.manifestId,
    p_shipment_id: input.shipmentId,
    p_action: input.action,
    p_reason: input.reason.trim(),
  });
  if (error) {
    throw new Error(error.message || 'تعذر تنفيذ فك التعليق الإداري.');
  }
}

export async function listEligibleShipmentsForOperation(
  tenantId: string,
  mode: 'pickup' | 'intake' | 'transfer_out',
  options: {readonly branchId?: string | null; readonly clientId?: string | null} = {},
): Promise<readonly ShipmentListItem[]> {
  const client = requireClient();

  let query = client
    .from('shipments')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', {ascending: false})
    .limit(150);

  if (mode === 'pickup') {
    query = query.in('operational_status', [...PICKUP_ELIGIBLE_STATUSES]);
    if (options.clientId) query = query.eq('client_id', options.clientId);
  } else if (mode === 'transfer_out') {
    query = query.eq('operational_status', 'in_warehouse');
    if (options.branchId) query = query.eq('current_branch_id', options.branchId);
  } else {
    query = query.in('operational_status', [...INTAKE_ELIGIBLE_STATUSES]);
  }

  const {data, error} = await query;
  if (error) {
    throw new Error('تعذر تحميل الشحنات المؤهلة.');
  }

  const rows = (data ?? []) as ShipmentRecord[];
  const map = await enrichShipments(tenantId, rows);
  return rows.map((r) => map.get(r.id)!);
}
