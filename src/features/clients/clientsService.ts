import {getSupabaseClient} from '@/lib/supabase/client';
import type {
  ClientAddressRecord,
  ClientCategory,
  ClientContactRecord,
  ClientContractTermRecord,
  ClientRecord,
  ClientRegistrationRequestRecord,
  ExemptionTarget,
  PayoutMethod,
  PriceExemptionRecord,
  PriceMode,
  TradeDirection,
} from '@/types/pricing';

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }
  return client;
}

export async function listClients(tenantId: string): Promise<readonly ClientRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('clients')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('code');
  if (error) throw new Error('تعذر تحميل قائمة العملاء.');
  return (data ?? []) as ClientRecord[];
}

export async function getClientById(tenantId: string, clientId: string): Promise<ClientRecord | null> {
  const client = requireClient();
  const {data, error} = await client
    .from('clients')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', clientId)
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw new Error('تعذر تحميل تفاصيل العميل.');
  return (data as ClientRecord) ?? null;
}

export interface SaveClientInput {
  readonly id?: string;
  readonly code: string;
  readonly name: string;
  readonly branch_id: string | null;
  readonly ledger_account_id: string | null;
  readonly country_id: string | null;
  readonly governorate_id: string;
  readonly city_id: string | null;
  readonly region_id: string;
  readonly price_list_id: string;
  readonly tax_profile_id: string;
  readonly default_payment_term_id: string | null;
  readonly default_shipment_type_id: string | null;
  readonly default_price_mode: PriceMode;
  readonly allow_package_opening: boolean;
  readonly client_category: ClientCategory;
  readonly activity_type: string | null;
  readonly trade_direction: TradeDirection;
  readonly payout_method: PayoutMethod;
  readonly bank_name: string | null;
  readonly bank_account_number: string | null;
  readonly wallet_phone: string | null;
  readonly phone: string;
  readonly mobile: string;
  readonly po_box: string | null;
  readonly postal_code: string | null;
  readonly address_line: string;
  readonly email: string | null;
  readonly is_active: boolean;
}

export async function saveClient(tenantId: string, input: SaveClientInput): Promise<string> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    branch_id: input.branch_id || null,
    ledger_account_id: input.ledger_account_id || null,
    country_id: input.country_id || null,
    governorate_id: input.governorate_id,
    city_id: input.city_id || null,
    region_id: input.region_id,
    price_list_id: input.price_list_id,
    tax_profile_id: input.tax_profile_id,
    default_payment_term_id: input.default_payment_term_id || null,
    default_shipment_type_id: input.default_shipment_type_id || null,
    default_price_mode: input.default_price_mode,
    allow_package_opening: input.allow_package_opening,
    client_category: input.client_category,
    activity_type: input.activity_type?.trim() || null,
    trade_direction: input.trade_direction,
    payout_method: input.payout_method,
    bank_name: input.payout_method === 'bank_transfer' ? input.bank_name?.trim() || null : null,
    bank_account_number:
      input.payout_method === 'bank_transfer' ? input.bank_account_number?.trim() || null : null,
    wallet_phone: input.payout_method === 'vodafone_cash' ? input.wallet_phone?.trim() || null : null,
    phone: input.phone.trim(),
    mobile: input.mobile.trim(),
    po_box: input.po_box?.trim() || null,
    postal_code: input.postal_code?.trim() || null,
    address_line: input.address_line.trim(),
    email: input.email?.trim() || null,
    is_active: input.is_active,
  };

  if (input.id) {
    const {error} = await client.from('clients').update(payload).eq('id', input.id).eq('tenant_id', tenantId);
    if (error) throw new Error('تعذر تحديث بيانات العميل.');
    return input.id;
  }

  const {data, error} = await client.from('clients').insert(payload).select('id').single();
  if (error || !data) throw new Error('تعذر إنشاء العميل. تأكد من عدم تكرار الكود واستيفاء الحقول الإلزامية.');
  return data.id as string;
}

export async function cloneClientRecord(
  tenantId: string,
  sourceClientId: string,
  newCode: string,
  newName: string,
): Promise<string> {
  const client = requireClient();
  const {data, error} = await client.rpc('clone_client_record', {
    p_tenant_id: tenantId,
    p_source_client_id: sourceClientId,
    p_new_code: newCode.trim().toUpperCase(),
    p_new_name: newName.trim(),
  });
  if (error || !data) throw new Error('تعذر نسخ سجل العميل.');
  return data as string;
}

export async function archiveClient(tenantId: string, clientId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client
    .from('clients')
    .update({is_active: false, archived_at: new Date().toISOString()})
    .eq('id', clientId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error('تعذر أرشفة العميل.');
}

// ----------------------------------------------------------------------------
// Client Addresses, Contacts, Terms & Exemptions
// ----------------------------------------------------------------------------
export async function listClientAddresses(tenantId: string, clientId: string): Promise<readonly ClientAddressRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('client_addresses')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('client_id', clientId)
    .order('is_default', {ascending: false})
    .order('created_at');
  if (error) throw new Error('تعذر تحميل عناوين الالتقاط.');
  return (data ?? []) as ClientAddressRecord[];
}

export async function saveClientAddress(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly client_id: string;
    readonly label: string;
    readonly governorate_id: string;
    readonly city_id: string | null;
    readonly region_id: string | null;
    readonly address_line: string;
    readonly phone: string | null;
    readonly is_default: boolean;
  },
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    client_id: input.client_id,
    label: input.label.trim(),
    governorate_id: input.governorate_id,
    city_id: input.city_id || null,
    region_id: input.region_id || null,
    address_line: input.address_line.trim(),
    phone: input.phone?.trim() || null,
    is_default: input.is_default,
  };
  const {error} = input.id
    ? await client.from('client_addresses').update(payload).eq('id', input.id).eq('tenant_id', tenantId)
    : await client.from('client_addresses').insert(payload);
  if (error) throw new Error('تعذر حفظ عنوان الالتقاط.');
}

export async function deleteClientAddress(tenantId: string, addressId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('client_addresses').delete().eq('id', addressId).eq('tenant_id', tenantId);
  if (error) throw new Error('تعذر حذف العنوان.');
}

export async function listClientContacts(tenantId: string, clientId: string): Promise<readonly ClientContactRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('client_contacts')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('client_id', clientId)
    .order('is_primary', {ascending: false});
  if (error) throw new Error('تعذر تحميل جهات الاتصال.');
  return (data ?? []) as ClientContactRecord[];
}

export async function saveClientContact(
  tenantId: string,
  input: {
    readonly client_id: string;
    readonly name: string;
    readonly role_title: string | null;
    readonly phone: string | null;
    readonly mobile: string | null;
    readonly email: string | null;
    readonly is_primary: boolean;
  },
): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('client_contacts').insert({
    tenant_id: tenantId,
    client_id: input.client_id,
    name: input.name.trim(),
    role_title: input.role_title?.trim() || null,
    phone: input.phone?.trim() || null,
    mobile: input.mobile?.trim() || null,
    email: input.email?.trim() || null,
    is_primary: input.is_primary,
  });
  if (error) throw new Error('تعذر إضافة جهة الاتصال.');
}

export async function listClientContractTerms(
  tenantId: string,
  clientId: string,
): Promise<readonly ClientContractTermRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('client_contract_terms')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('client_id', clientId)
    .order('term_code');
  if (error) throw new Error('تعذر تحميل شروط التعامل.');
  return (data ?? []) as ClientContractTermRecord[];
}

export async function saveClientContractTerm(
  tenantId: string,
  input: {
    readonly client_id: string;
    readonly term_code: string;
    readonly title: string;
    readonly settlement_cycle_days: number;
    readonly notes: string | null;
  },
): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('client_contract_terms').insert({
    tenant_id: tenantId,
    client_id: input.client_id,
    term_code: input.term_code.trim().toUpperCase(),
    title: input.title.trim(),
    settlement_cycle_days: input.settlement_cycle_days,
    notes: input.notes?.trim() || null,
  });
  if (error) throw new Error('تعذر حفظ شرط التعامل.');
}

export async function listPriceExemptions(
  tenantId: string,
  clientId: string,
): Promise<readonly PriceExemptionRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('price_exemptions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('client_id', clientId)
    .order('created_at', {ascending: false});
  if (error) throw new Error('تعذر تحميل الإعفاءات السعرية.');
  return (data ?? []) as PriceExemptionRecord[];
}

export async function savePriceExemption(
  tenantId: string,
  input: {
    readonly client_id: string;
    readonly exemption_target: ExemptionTarget;
    readonly discount_percent: number;
    readonly notes: string | null;
  },
): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('price_exemptions').insert({
    tenant_id: tenantId,
    client_id: input.client_id,
    exemption_target: input.exemption_target,
    discount_percent: input.discount_percent,
    notes: input.notes?.trim() || null,
    is_active: true,
  });
  if (error) throw new Error('تعذر إضافة الإعفاء السعري.');
}

export async function deletePriceExemption(tenantId: string, exemptionId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('price_exemptions').delete().eq('id', exemptionId).eq('tenant_id', tenantId);
  if (error) throw new Error('تعذر حذف الإعفاء.');
}

// ----------------------------------------------------------------------------
// Client Self-Registration Requests Approval Queue
// ----------------------------------------------------------------------------
export async function listClientRegistrationRequests(
  tenantId: string,
): Promise<readonly ClientRegistrationRequestRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('client_registration_requests')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', {ascending: false});
  if (error) throw new Error('تعذر تحميل طلبات تسجيل العملاء.');
  return (data ?? []) as ClientRegistrationRequestRecord[];
}

export async function approveRegistrationRequest(
  tenantId: string,
  request: ClientRegistrationRequestRecord,
  options: {
    readonly clientCode: string;
    readonly priceListId: string;
    readonly taxProfileId: string;
  },
): Promise<void> {
  const client = requireClient();
  const newClientId = await saveClient(tenantId, {
    code: options.clientCode,
    name: request.company_name,
    branch_id: null,
    ledger_account_id: null,
    country_id: null,
    governorate_id: request.governorate_id,
    city_id: null,
    region_id: request.region_id,
    price_list_id: options.priceListId,
    tax_profile_id: options.taxProfileId,
    default_payment_term_id: null,
    default_shipment_type_id: null,
    default_price_mode: 'shipping_excluded',
    allow_package_opening: false,
    client_category: 'ecommerce',
    activity_type: 'طلب تسجيل إلكتروني',
    trade_direction: 'b2c',
    payout_method: request.payout_method,
    bank_name: request.bank_name,
    bank_account_number: request.bank_account_number,
    wallet_phone: request.wallet_phone,
    phone: request.phone,
    mobile: request.mobile || request.phone,
    po_box: null,
    postal_code: null,
    address_line: request.address_line,
    email: request.email,
    is_active: true,
  });

  const {error} = await client
    .from('client_registration_requests')
    .update({
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      approved_client_id: newClientId,
    })
    .eq('id', request.id)
    .eq('tenant_id', tenantId);

  if (error) throw new Error('تم إنشاء العميل لكن تعذر تحديث حالة الطلب.');
}

export async function rejectRegistrationRequest(
  tenantId: string,
  requestId: string,
  reason: string,
): Promise<void> {
  const client = requireClient();
  const {error} = await client
    .from('client_registration_requests')
    .update({
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason.trim() || 'مرفوض من الإدارة',
    })
    .eq('id', requestId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error('تعذر رفض طلب التسجيل.');
}
