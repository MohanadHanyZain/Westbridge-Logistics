import {getSupabaseClient} from '@/lib/supabase/client';
import type {
  CourierPortalTasksFeed,
  CreateDeliveryListInput,
  CreateReturnManifestInput,
  DeliveryExecutionInput,
  DeliveryExecutionResult,
  DeliveryFilter,
  DeliveryListDetail,
  DeliveryListItemRecord,
  DeliveryListRecord,
  DeliveryListType,
  ReturnManifestDetail,
  ReturnManifestItemRecord,
  ReturnManifestRecord,
  ReturnManifestType,
  TenantDeliveryPolicyRecord,
} from '@/types/delivery';
import type {AddOperationShipmentsResult} from '@/types/operations';
import type {ShipmentListItem, ShipmentPartyRecord, ShipmentRecord} from '@/types/shipments';

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }
  return client;
}

async function enrichShipmentsMap(
  tenantId: string,
  shipments: readonly ShipmentRecord[],
): Promise<Map<string, ShipmentListItem>> {
  const map = new Map<string, ShipmentListItem>();
  if (shipments.length === 0) return map;

  const client = requireClient();
  const ids = shipments.map((s) => s.id);
  const {data: partyRows} = await client
    .from('shipment_parties')
    .select('id, tenant_id, shipment_id, party_type, name, phone, mobile, governorate_id, city_id, region_id, address_line')
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
// Delivery Policy (ADR-017)
// ----------------------------------------------------------------------------
export async function getTenantDeliveryPolicy(tenantId: string): Promise<TenantDeliveryPolicyRecord> {
  const client = requireClient();
  const {data, error} = await client
    .from('tenant_settings')
    .select('tenant_id, max_delivery_attempts, retry_extra_fee, require_pod_on_delivery')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error || !data) {
    return {
      tenant_id: tenantId,
      max_delivery_attempts: 3,
      retry_extra_fee: 0,
      require_pod_on_delivery: false,
    };
  }

  return {
    tenant_id: tenantId,
    max_delivery_attempts: Number((data as {max_delivery_attempts?: number}).max_delivery_attempts ?? 3),
    retry_extra_fee: Number((data as {retry_extra_fee?: number}).retry_extra_fee ?? 0),
    require_pod_on_delivery: Boolean((data as {require_pod_on_delivery?: boolean}).require_pod_on_delivery ?? false),
  };
}

export async function updateTenantDeliveryPolicy(
  tenantId: string,
  maxAttempts: number,
  retryExtraFee: number,
  requirePod: boolean,
): Promise<TenantDeliveryPolicyRecord> {
  const client = requireClient();
  const {data, error} = await client.rpc('update_tenant_delivery_policy', {
    p_tenant_id: tenantId,
    p_max_attempts: maxAttempts,
    p_retry_extra_fee: retryExtraFee,
    p_require_pod: requirePod,
  });

  if (error) {
    throw new Error(error.message || 'تعذر تحديث سياسة محاولات التوصيل.');
  }

  const res = data as {max_delivery_attempts: number; retry_extra_fee: number; require_pod_on_delivery: boolean};
  return {
    tenant_id: tenantId,
    max_delivery_attempts: Number(res.max_delivery_attempts ?? maxAttempts),
    retry_extra_fee: Number(res.retry_extra_fee ?? retryExtraFee),
    require_pod_on_delivery: Boolean(res.require_pod_on_delivery),
  };
}

// ----------------------------------------------------------------------------
// Delivery & Redelivery Lists (DLV-* / RDL-*)
// ----------------------------------------------------------------------------
export async function listDeliveryLists(
  tenantId: string,
  listType: DeliveryListType,
  filter: DeliveryFilter = {},
): Promise<readonly DeliveryListRecord[]> {
  const client = requireClient();
  let query = client
    .from('delivery_lists')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('list_type', listType)
    .order('created_at', {ascending: false})
    .limit(150);

  if (filter.branchId) query = query.eq('branch_id', filter.branchId);
  if (filter.courierId) query = query.eq('courier_id', filter.courierId);
  if (filter.status) query = query.eq('status', filter.status);
  if (filter.dateFrom) query = query.gte('list_date', filter.dateFrom);
  if (filter.dateTo) query = query.lte('list_date', filter.dateTo);

  const {data, error} = await query;
  if (error) {
    throw new Error('تعذر تحميل قوائم التوصيل.');
  }

  const rows = (data ?? []) as DeliveryListRecord[];
  if (rows.length === 0) return [];

  const listIds = rows.map((r) => r.id);
  const {data: itemLinks} = await client
    .from('delivery_list_items')
    .select('delivery_list_id, execution_outcome')
    .eq('tenant_id', tenantId)
    .in('delivery_list_id', listIds);

  const totalByList = new Map<string, number>();
  const pendingByList = new Map<string, number>();
  for (const link of (itemLinks ?? []) as {delivery_list_id: string; execution_outcome: string}[]) {
    totalByList.set(link.delivery_list_id, (totalByList.get(link.delivery_list_id) ?? 0) + 1);
    if (link.execution_outcome === 'pending') {
      pendingByList.set(link.delivery_list_id, (pendingByList.get(link.delivery_list_id) ?? 0) + 1);
    }
  }

  const needle = filter.code?.trim().toLowerCase() ?? '';
  return rows
    .filter((r) => (!needle ? true : r.list_code.toLowerCase().includes(needle)))
    .map((r) => ({
      ...r,
      shipments_count: totalByList.get(r.id) ?? 0,
      pending_count: pendingByList.get(r.id) ?? 0,
    }));
}

export async function getDeliveryListDetail(tenantId: string, listId: string): Promise<DeliveryListDetail> {
  const client = requireClient();
  const [listRes, itemsRes] = await Promise.all([
    client.from('delivery_lists').select('*').eq('tenant_id', tenantId).eq('id', listId).single(),
    client
      .from('delivery_list_items')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('delivery_list_id', listId)
      .order('created_at', {ascending: true}),
  ]);

  if (listRes.error || !listRes.data) {
    throw new Error('تعذر تحميل تفاصيل قائمة التوصيل.');
  }

  const rawItems = (itemsRes.data ?? []) as DeliveryListItemRecord[];
  const shpIds = rawItems.map((i) => i.shipment_id);
  let shpMap = new Map<string, ShipmentListItem>();
  if (shpIds.length > 0) {
    const {data: shpRows} = await client
      .from('shipments')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('id', shpIds);
    shpMap = await enrichShipmentsMap(tenantId, (shpRows ?? []) as ShipmentRecord[]);
  }

  return {
    list: listRes.data as DeliveryListRecord,
    items: rawItems.map((item) => ({...item, shipment: shpMap.get(item.shipment_id)})),
  };
}

export async function createDeliveryList(
  tenantId: string,
  input: CreateDeliveryListInput,
): Promise<{id: string; list_code: string; list_type: DeliveryListType; status: string}> {
  const client = requireClient();
  const {data, error} = await client.rpc('create_delivery_list', {
    p_tenant_id: tenantId,
    p_payload: input,
  });

  if (error) {
    throw new Error(error.message || 'تعذر إنشاء قائمة التوصيل.');
  }
  return data as {id: string; list_code: string; list_type: DeliveryListType; status: string};
}

export async function addShipmentsToDeliveryList(
  tenantId: string,
  listId: string,
  shipmentIds: readonly string[],
  barcodeQuery?: string,
  adminOverrideAttempts = false,
): Promise<AddOperationShipmentsResult> {
  const client = requireClient();
  const {data, error} = await client.rpc('add_shipments_to_delivery_list', {
    p_tenant_id: tenantId,
    p_delivery_list_id: listId,
    p_shipment_ids: shipmentIds,
    p_barcode_query: barcodeQuery?.trim() || null,
    p_admin_override_attempts: adminOverrideAttempts,
  });

  if (error) {
    throw new Error(error.message || 'تعذر إضافة الشحنات إلى قائمة التوصيل.');
  }
  return data as AddOperationShipmentsResult;
}

export async function removeShipmentFromDeliveryList(
  tenantId: string,
  listId: string,
  shipmentId: string,
): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('remove_shipment_from_delivery_list', {
    p_tenant_id: tenantId,
    p_delivery_list_id: listId,
    p_shipment_id: shipmentId,
  });

  if (error) {
    throw new Error(error.message || 'تعذر إزالة الشحنة من قائمة التوصيل.');
  }
}

export async function approveDeliveryList(
  tenantId: string,
  listId: string,
): Promise<{id: string; list_code: string; status: string; shipments_count: number}> {
  const client = requireClient();
  const {data, error} = await client.rpc('approve_delivery_list', {
    p_tenant_id: tenantId,
    p_delivery_list_id: listId,
  });

  if (error) {
    throw new Error(error.message || 'تعذر اعتماد قائمة التوصيل.');
  }
  return data as {id: string; list_code: string; status: string; shipments_count: number};
}

// ----------------------------------------------------------------------------
// Delivery Execution & POD
// ----------------------------------------------------------------------------
export async function recordDeliveryExecution(
  tenantId: string,
  input: DeliveryExecutionInput,
): Promise<DeliveryExecutionResult> {
  const client = requireClient();
  const {data, error} = await client.rpc('record_delivery_execution', {
    p_tenant_id: tenantId,
    p_payload: input,
  });

  if (error) {
    throw new Error(error.message || 'تعذر تسجيل نتيجة التوصيل.');
  }
  return data as DeliveryExecutionResult;
}

// ----------------------------------------------------------------------------
// Return Manifests Workflow (RTH / RTD / RTN)
// ----------------------------------------------------------------------------
export async function listReturnManifests(
  tenantId: string,
  manifestType: ReturnManifestType,
  filter: DeliveryFilter = {},
): Promise<readonly ReturnManifestRecord[]> {
  const client = requireClient();
  let query = client
    .from('return_manifests')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('manifest_type', manifestType)
    .order('created_at', {ascending: false})
    .limit(150);

  if (filter.branchId) query = query.eq('branch_id', filter.branchId);
  if (filter.courierId) query = query.eq('courier_id', filter.courierId);
  if (filter.status) query = query.eq('status', filter.status);
  if (filter.dateFrom) query = query.gte('manifest_date', filter.dateFrom);
  if (filter.dateTo) query = query.lte('manifest_date', filter.dateTo);

  const {data, error} = await query;
  if (error) {
    throw new Error('تعذر تحميل قوائم المرتجعات.');
  }

  const rows = (data ?? []) as ReturnManifestRecord[];
  if (rows.length === 0) return [];

  const manifestIds = rows.map((r) => r.id);
  const {data: itemLinks} = await client
    .from('return_manifest_items')
    .select('return_manifest_id')
    .eq('tenant_id', tenantId)
    .in('return_manifest_id', manifestIds);

  const counts = new Map<string, number>();
  for (const link of (itemLinks ?? []) as {return_manifest_id: string}[]) {
    counts.set(link.return_manifest_id, (counts.get(link.return_manifest_id) ?? 0) + 1);
  }

  const needle = filter.code?.trim().toLowerCase() ?? '';
  return rows
    .filter((r) => (!needle ? true : r.manifest_code.toLowerCase().includes(needle)))
    .map((r) => ({...r, shipments_count: counts.get(r.id) ?? 0}));
}

export async function getReturnManifestDetail(
  tenantId: string,
  manifestId: string,
): Promise<ReturnManifestDetail> {
  const client = requireClient();
  const [manifestRes, itemsRes] = await Promise.all([
    client.from('return_manifests').select('*').eq('tenant_id', tenantId).eq('id', manifestId).single(),
    client
      .from('return_manifest_items')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('return_manifest_id', manifestId)
      .order('created_at', {ascending: true}),
  ]);

  if (manifestRes.error || !manifestRes.data) {
    throw new Error('تعذر تحميل تفاصيل قائمة المرتجع.');
  }

  const rawItems = (itemsRes.data ?? []) as ReturnManifestItemRecord[];
  const shpIds = rawItems.map((i) => i.shipment_id);
  let shpMap = new Map<string, ShipmentListItem>();
  if (shpIds.length > 0) {
    const {data: shpRows} = await client
      .from('shipments')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('id', shpIds);
    shpMap = await enrichShipmentsMap(tenantId, (shpRows ?? []) as ShipmentRecord[]);
  }

  return {
    manifest: manifestRes.data as ReturnManifestRecord,
    items: rawItems.map((item) => ({...item, shipment: shpMap.get(item.shipment_id)})),
  };
}

export async function createReturnManifest(
  tenantId: string,
  input: CreateReturnManifestInput,
): Promise<{id: string; manifest_code: string; manifest_type: ReturnManifestType; status: string}> {
  const client = requireClient();
  const {data, error} = await client.rpc('create_return_manifest', {
    p_tenant_id: tenantId,
    p_payload: input,
  });

  if (error) {
    throw new Error(error.message || 'تعذر إنشاء قائمة المرتجعات.');
  }
  return data as {id: string; manifest_code: string; manifest_type: ReturnManifestType; status: string};
}

export async function addShipmentsToReturnManifest(
  tenantId: string,
  manifestId: string,
  shipmentIds: readonly string[],
  barcodeQuery?: string,
): Promise<AddOperationShipmentsResult> {
  const client = requireClient();
  const {data, error} = await client.rpc('add_shipments_to_return_manifest', {
    p_tenant_id: tenantId,
    p_manifest_id: manifestId,
    p_shipment_ids: shipmentIds,
    p_barcode_query: barcodeQuery?.trim() || null,
  });

  if (error) {
    throw new Error(error.message || 'تعذر إضافة الشحنات لقائمة المرتجعات.');
  }
  return data as AddOperationShipmentsResult;
}

export async function removeShipmentFromReturnManifest(
  tenantId: string,
  manifestId: string,
  shipmentId: string,
): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('remove_shipment_from_return_manifest', {
    p_tenant_id: tenantId,
    p_manifest_id: manifestId,
    p_shipment_id: shipmentId,
  });

  if (error) {
    throw new Error(error.message || 'تعذر إزالة الشحنة من قائمة المرتجعات.');
  }
}

export async function approveReturnManifest(
  tenantId: string,
  manifestId: string,
): Promise<{id: string; manifest_code: string; status: string; shipments_count: number}> {
  const client = requireClient();
  const {data, error} = await client.rpc('approve_return_manifest', {
    p_tenant_id: tenantId,
    p_manifest_id: manifestId,
  });

  if (error) {
    throw new Error(error.message || 'تعذر اعتماد قائمة المرتجعات.');
  }
  return data as {id: string; manifest_code: string; status: string; shipments_count: number};
}

// ----------------------------------------------------------------------------
// Courier Portal Tasks Feed
// ----------------------------------------------------------------------------
export async function listCourierMyTasks(
  tenantId: string,
  courierId?: string | null,
): Promise<CourierPortalTasksFeed> {
  const client = requireClient();
  const {data, error} = await client.rpc('list_courier_my_tasks', {
    p_tenant_id: tenantId,
    p_courier_id: courierId ?? null,
  });

  if (error) {
    throw new Error(error.message || 'تعذر تحميل مهام المندوب.');
  }

  return data as CourierPortalTasksFeed;
}

export async function listEligibleShipmentsForDelivery(
  tenantId: string,
  listType: DeliveryListType,
  branchId?: string | null,
): Promise<readonly ShipmentListItem[]> {
  const client = requireClient();
  const statuses =
    listType === 'redelivery'
      ? ['rescheduled', 'delivery_failed', 'in_warehouse']
      : ['in_warehouse', 'picked_up', 'rescheduled', 'delivery_failed'];

  let query = client
    .from('shipments')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('operational_status', statuses)
    .order('created_at', {ascending: false})
    .limit(150);

  if (branchId) {
    query = query.eq('current_branch_id', branchId);
  }

  const {data, error} = await query;
  if (error) {
    throw new Error('تعذر تحميل الشحنات المؤهلة لقائمة التوصيل.');
  }

  const rows = (data ?? []) as ShipmentRecord[];
  const map = await enrichShipmentsMap(tenantId, rows);
  return rows.map((r) => map.get(r.id)!);
}

export async function listEligibleShipmentsForReturns(
  tenantId: string,
  manifestType: ReturnManifestType,
  options: {readonly clientId?: string | null} = {},
): Promise<readonly ShipmentListItem[]> {
  const client = requireClient();

  let query = client
    .from('shipments')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('operational_status', [
      'return_to_sender',
      'delivery_failed',
      'partially_delivered',
      'delivered',
      'in_warehouse',
    ])
    .order('created_at', {ascending: false})
    .limit(200);

  if (options.clientId) {
    query = query.eq('client_id', options.clientId);
  }

  const {data, error} = await query;
  if (error) {
    throw new Error('تعذر تحميل الشحنات المؤهلة للمرتجعات.');
  }

  const rows = ((data ?? []) as ShipmentRecord[]).filter((s) => {
    if (manifestType === 'courier_return_inbound') {
      return (
        s.operational_status === 'return_to_sender' ||
        s.operational_status === 'delivery_failed' ||
        (s.operational_status === 'partially_delivered' && s.partial_return_custody === 'with_courier') ||
        (s.operational_status === 'delivered' &&
          s.shipment_type_code === 'PTP' &&
          s.exchange_status === 'with_courier')
      );
    }

    return (
      s.operational_status === 'return_to_sender' ||
      s.operational_status === 'delivery_failed' ||
      s.operational_status === 'in_warehouse' ||
      (s.operational_status === 'partially_delivered' &&
        (s.partial_return_custody === 'with_courier' || s.partial_return_custody === 'in_warehouse')) ||
      (s.operational_status === 'delivered' &&
        s.shipment_type_code === 'PTP' &&
        (s.exchange_status === 'with_courier' || s.exchange_status === 'in_warehouse'))
    );
  });

  const map = await enrichShipmentsMap(tenantId, rows);
  return rows.map((r) => map.get(r.id)!);
}

