import {getSupabaseClient} from '@/lib/supabase/client';
import type {
  ClientAccountStatement,
  ClientPickupRequestRecord,
  ClientPickupRequestStatus,
  ClientPortalPeriod,
  ClientPortalSummary,
} from '@/types/clientPortal';

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }
  return client;
}

export async function getClientPortalSummary(
  tenantId: string,
  clientId?: string | null,
  period: ClientPortalPeriod = 'all',
): Promise<ClientPortalSummary> {
  const client = requireClient();
  const {data, error} = await client.rpc('get_client_portal_summary', {
    p_tenant_id: tenantId,
    p_client_id: clientId ?? null,
    p_period: period,
  });
  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر تحميل ملخص بوابة العميل.');
  }
  return data as ClientPortalSummary;
}

export async function getClientAccountStatement(
  tenantId: string,
  clientId?: string | null,
  dateFrom?: string | null,
  dateTo?: string | null,
): Promise<ClientAccountStatement> {
  const client = requireClient();
  const {data, error} = await client.rpc('get_client_account_statement', {
    p_tenant_id: tenantId,
    p_client_id: clientId ?? null,
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null,
  });
  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر تحميل كشف حساب العميل.');
  }
  return data as ClientAccountStatement;
}

export async function listClientPickupRequests(
  tenantId: string,
  options?: {
    readonly clientId?: string | null;
    readonly status?: ClientPickupRequestStatus | '';
  },
): Promise<readonly ClientPickupRequestRecord[]> {
  const client = getSupabaseClient();
  if (!client) {
    return [];
  }

  let query = client
    .from('client_pickup_requests')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', {ascending: false});

  if (options?.clientId) {
    query = query.eq('client_id', options.clientId);
  }
  if (options?.status) {
    query = query.eq('status', options.status);
  }

  const {data, error} = await query;
  if (error) {
    throw new Error('تعذر تحميل طلبات الالتقاط.');
  }
  return (data ?? []) as ClientPickupRequestRecord[];
}

export async function createClientPickupRequest(
  tenantId: string,
  input: {
    readonly client_id?: string | null;
    readonly address_id?: string | null;
    readonly governorate_id: string;
    readonly region_id?: string | null;
    readonly pickup_address: string;
    readonly contact_phone: string;
    readonly preferred_date: string;
    readonly preferred_time_slot: string;
    readonly estimated_shipments_count: number;
    readonly notes?: string | null;
  },
): Promise<string> {
  const client = requireClient();
  const {data, error} = await client.rpc('create_client_pickup_request', {
    p_tenant_id: tenantId,
    p_payload: input,
  });
  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر إنشاء طلب الالتقاط.');
  }
  return data as string;
}

export async function cancelClientPickupRequest(tenantId: string, requestId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('cancel_client_pickup_request', {
    p_tenant_id: tenantId,
    p_request_id: requestId,
  });
  if (error) {
    throw new Error(error.message ?? 'تعذر إلغاء طلب الالتقاط.');
  }
}

export async function updatePickupRequestStatus(
  tenantId: string,
  requestId: string,
  status: ClientPickupRequestStatus,
  pickupListId?: string | null,
): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('update_pickup_request_status', {
    p_tenant_id: tenantId,
    p_request_id: requestId,
    p_status: status,
    p_pickup_list_id: pickupListId ?? null,
  });
  if (error) {
    throw new Error(error.message ?? 'تعذر تحديث حالة طلب الالتقاط.');
  }
}

export async function saveMyClientAddress(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly client_id?: string | null;
    readonly label: string;
    readonly governorate_id: string;
    readonly region_id: string | null;
    readonly address_line: string;
    readonly phone: string | null;
    readonly is_default: boolean;
  },
): Promise<string> {
  const client = requireClient();
  const {data, error} = await client.rpc('save_my_client_address', {
    p_tenant_id: tenantId,
    p_payload: input,
  });
  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر حفظ عنوان الالتقاط.');
  }
  return data as string;
}

export async function deleteMyClientAddress(tenantId: string, addressId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.rpc('delete_my_client_address', {
    p_tenant_id: tenantId,
    p_address_id: addressId,
  });
  if (error) {
    throw new Error(error.message ?? 'تعذر حذف العنوان.');
  }
}
