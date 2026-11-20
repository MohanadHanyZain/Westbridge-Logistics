import {getSupabaseClient} from '@/lib/supabase/client';
import type {
  AccountType,
  AuxiliaryJournalRecord,
  BranchRecord,
  CashboxCustodianRecord,
  CashboxRecord,
  ChartOfAccountRecord,
  CityRecord,
  CountryRecord,
  DeliveryExceptionReasonRecord,
  DeliveryTypeRecord,
  ExceptionCategory,
  GovernorateRecord,
  JournalCategory,
  JournalEntryTypeRecord,
  MovementDirection,
  MovementTypeRecord,
  NumberingSequenceRecord,
  PaymentMethodRecord,
  PaymentTermRecord,
  Phase2SummaryCounts,
  RegionRecord,
  ShipmentTypeRecord,
  ShippingServiceRecord,
  TenantMemberOption,
} from '@/types/definitions';

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }
  return client;
}

export function generateNextCode(prefix: string, existingCodes: readonly string[]): string {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escaped}-(\\d+)$`, 'i');
  let maxNum = 0;
  for (const code of existingCodes) {
    const match = pattern.exec(code.trim());
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxNum) {
        maxNum = n;
      }
    }
  }
  const next = String(maxNum + 1).padStart(3, '0');
  return `${prefix.toUpperCase()}-${next}`;
}

export async function fetchPhase2SummaryCounts(tenantId: string): Promise<Phase2SummaryCounts> {
  const client = requireClient();

  const [branchesRes, govRes, regRes, srvRes, boxRes, rsnRes] = await Promise.all([
    client
      .from('branches')
      .select('id', {count: 'exact', head: true})
      .eq('tenant_id', tenantId)
      .is('archived_at', null),
    client
      .from('governorates')
      .select('id', {count: 'exact', head: true})
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .is('archived_at', null),
    client
      .from('regions')
      .select('id', {count: 'exact', head: true})
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .is('archived_at', null),
    client
      .from('shipping_services')
      .select('id', {count: 'exact', head: true})
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .is('archived_at', null),
    client
      .from('cashboxes')
      .select('id', {count: 'exact', head: true})
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .is('archived_at', null),
    client
      .from('delivery_exception_reasons')
      .select('id', {count: 'exact', head: true})
      .eq('tenant_id', tenantId)
      .eq('is_active', true),
  ]);

  return {
    branchesCount: branchesRes.count ?? 0,
    activeGovernoratesCount: govRes.count ?? 0,
    activeRegionsCount: regRes.count ?? 0,
    activeServicesCount: srvRes.count ?? 0,
    activeCashboxesCount: boxRes.count ?? 0,
    activeExceptionReasonsCount: rsnRes.count ?? 0,
  };
}

// ----------------------------------------------------------------------------
// Geography
// ----------------------------------------------------------------------------
export async function listCountries(tenantId: string): Promise<readonly CountryRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('countries')
    .select('id, tenant_id, code, name, iso2, is_default, is_active')
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('is_default', {ascending: false})
    .order('name');
  if (error) throw new Error('تعذر تحميل الدول.');
  return (data ?? []) as CountryRecord[];
}

export async function listGovernorates(tenantId: string): Promise<readonly GovernorateRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('governorates')
    .select('id, tenant_id, country_id, code, name, default_branch_id, is_active')
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('code');
  if (error) throw new Error('تعذر تحميل المحافظات.');
  return (data ?? []) as GovernorateRecord[];
}

export async function saveGovernorate(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly country_id: string;
    readonly code: string;
    readonly name: string;
    readonly default_branch_id: string | null;
    readonly is_active: boolean;
  },
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    country_id: input.country_id,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    default_branch_id: input.default_branch_id || null,
    is_active: input.is_active,
  };

  if (input.id) {
    const {error} = await client
      .from('governorates')
      .update(payload)
      .eq('id', input.id)
      .eq('tenant_id', tenantId);
    if (error) throw new Error('تعذر تحديث بيانات المحافظة.');
  } else {
    const {error} = await client.from('governorates').insert(payload);
    if (error) throw new Error('تعذر إضافة المحافظة. تأكد من عدم تكرار الكود.');
  }
}

export async function listCities(tenantId: string, governorateId?: string): Promise<readonly CityRecord[]> {
  const client = requireClient();
  let query = client
    .from('cities')
    .select('id, tenant_id, governorate_id, code, name, is_active')
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('name');

  if (governorateId) {
    query = query.eq('governorate_id', governorateId);
  }

  const {data, error} = await query;
  if (error) throw new Error('تعذر تحميل المدن.');
  return (data ?? []) as CityRecord[];
}

export async function saveCity(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly governorate_id: string;
    readonly code: string;
    readonly name: string;
    readonly is_active: boolean;
  },
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    governorate_id: input.governorate_id,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    is_active: input.is_active,
  };
  if (input.id) {
    const {error} = await client.from('cities').update(payload).eq('id', input.id).eq('tenant_id', tenantId);
    if (error) throw new Error('تعذر تحديث المدينة.');
  } else {
    const {error} = await client.from('cities').insert(payload);
    if (error) throw new Error('تعذر إضافة المدينة.');
  }
}

export async function listRegions(tenantId: string, governorateId?: string): Promise<readonly RegionRecord[]> {
  const client = requireClient();
  let query = client
    .from('regions')
    .select('id, tenant_id, governorate_id, city_id, code, name, default_branch_id, is_active')
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('code');

  if (governorateId) {
    query = query.eq('governorate_id', governorateId);
  }

  const {data, error} = await query;
  if (error) throw new Error('تعذر تحميل المناطق.');
  return (data ?? []) as RegionRecord[];
}

export async function saveRegion(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly governorate_id: string;
    readonly city_id: string | null;
    readonly code: string;
    readonly name: string;
    readonly default_branch_id: string | null;
    readonly is_active: boolean;
  },
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    governorate_id: input.governorate_id,
    city_id: input.city_id || null,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    default_branch_id: input.default_branch_id || null,
    is_active: input.is_active,
  };

  if (input.id) {
    const {error} = await client.from('regions').update(payload).eq('id', input.id).eq('tenant_id', tenantId);
    if (error) throw new Error('تعذر تحديث المنطقة.');
  } else {
    const {error} = await client.from('regions').insert(payload);
    if (error) throw new Error('تعذر إضافة المنطقة. تأكد من عدم تكرار الكود.');
  }
}

// ----------------------------------------------------------------------------
// Branches
// ----------------------------------------------------------------------------
export async function listBranches(tenantId: string): Promise<readonly BranchRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('branches')
    .select(
      'id, tenant_id, code, name, is_main, is_active, country_id, governorate_id, city_id, region_id, phone, fax, address_line, archived_at, created_at',
    )
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('is_main', {ascending: false})
    .order('code');

  if (error) throw new Error('تعذر تحميل قائمة الفروع.');
  return (data ?? []) as BranchRecord[];
}

export async function saveBranch(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly code: string;
    readonly name: string;
    readonly is_main: boolean;
    readonly is_active: boolean;
    readonly country_id: string | null;
    readonly governorate_id: string | null;
    readonly city_id: string | null;
    readonly region_id: string | null;
    readonly phone: string | null;
    readonly fax: string | null;
    readonly address_line: string | null;
  },
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    is_active: input.is_main ? true : input.is_active,
    country_id: input.country_id || null,
    governorate_id: input.governorate_id || null,
    city_id: input.city_id || null,
    region_id: input.region_id || null,
    phone: input.phone?.trim() || null,
    fax: input.fax?.trim() || null,
    address_line: input.address_line?.trim() || null,
  };

  let targetBranchId = input.id;

  if (targetBranchId) {
    const {error} = await client
      .from('branches')
      .update(payload)
      .eq('id', targetBranchId)
      .eq('tenant_id', tenantId);
    if (error) throw new Error('تعذر تحديث بيانات الفرع.');
  } else {
    const {data, error} = await client
      .from('branches')
      .insert({...payload, is_main: false})
      .select('id')
      .single();
    if (error || !data) throw new Error('تعذر إنشاء الفرع. تأكد من عدم تكرار الكود.');
    targetBranchId = data.id;
  }

  if (input.is_main && targetBranchId) {
    const {error: mainErr} = await client.rpc('set_main_branch', {
      p_tenant_id: tenantId,
      p_branch_id: targetBranchId,
    });
    if (mainErr) throw new Error('تم حفظ الفرع لكن تعذر تعيينه كفرع رئيسي.');
  }
}

export async function archiveBranch(tenantId: string, branchId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client
    .from('branches')
    .update({is_active: false, archived_at: new Date().toISOString()})
    .eq('id', branchId)
    .eq('tenant_id', tenantId)
    .eq('is_main', false);
  if (error) throw new Error('تعذر أرشفة الفرع (لا يمكن أرشفة الفرع الرئيسي).');
}

// ----------------------------------------------------------------------------
// Chart of Accounts, Movement Types, Journals & Entry Types
// ----------------------------------------------------------------------------
export async function listChartOfAccounts(tenantId: string): Promise<readonly ChartOfAccountRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('chart_of_accounts')
    .select('id, tenant_id, code, name, account_type, parent_id, is_group, is_system, is_active')
    .eq('tenant_id', tenantId)
    .order('code');
  if (error) throw new Error('تعذر تحميل دليل الحسابات.');
  return (data ?? []) as ChartOfAccountRecord[];
}

export async function createChartAccount(
  tenantId: string,
  input: {
    readonly code: string;
    readonly name: string;
    readonly account_type: AccountType;
    readonly parent_id: string | null;
    readonly is_group: boolean;
  },
): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('chart_of_accounts').insert({
    tenant_id: tenantId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    account_type: input.account_type,
    parent_id: input.parent_id || null,
    is_group: input.is_group,
    is_system: false,
    is_active: true,
  });
  if (error) throw new Error('تعذر إضافة الحساب. تأكد من عدم تكرار الكود.');
}

export async function listMovementTypes(tenantId: string): Promise<readonly MovementTypeRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('movement_types')
    .select('id, tenant_id, code, name, direction, is_system, is_active')
    .eq('tenant_id', tenantId)
    .order('code');
  if (error) throw new Error('تعذر تحميل أنواع الحركات.');
  return (data ?? []) as MovementTypeRecord[];
}

export async function saveMovementType(
  tenantId: string,
  input: {readonly id?: string; readonly code: string; readonly name: string; readonly direction: MovementDirection; readonly is_active: boolean},
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    direction: input.direction,
    is_active: input.is_active,
  };
  const {error} = input.id
    ? await client.from('movement_types').update(payload).eq('id', input.id).eq('tenant_id', tenantId)
    : await client.from('movement_types').insert(payload);
  if (error) throw new Error('تعذر حفظ نوع الحركة.');
}

export async function listAuxiliaryJournals(tenantId: string): Promise<readonly AuxiliaryJournalRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('auxiliary_journals')
    .select('id, tenant_id, code, name, journal_category, is_system, is_active')
    .eq('tenant_id', tenantId)
    .order('code');
  if (error) throw new Error('تعذر تحميل اليوميات المساعدة.');
  return (data ?? []) as AuxiliaryJournalRecord[];
}

export async function saveAuxiliaryJournal(
  tenantId: string,
  input: {readonly id?: string; readonly code: string; readonly name: string; readonly journal_category: JournalCategory; readonly is_active: boolean},
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    journal_category: input.journal_category,
    is_active: input.is_active,
  };
  const {error} = input.id
    ? await client.from('auxiliary_journals').update(payload).eq('id', input.id).eq('tenant_id', tenantId)
    : await client.from('auxiliary_journals').insert(payload);
  if (error) throw new Error('تعذر حفظ اليومية المساعدة.');
}

export async function listJournalEntryTypes(tenantId: string): Promise<readonly JournalEntryTypeRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('journal_entry_types')
    .select('id, tenant_id, code, name, is_reversal_type, is_system, is_active')
    .eq('tenant_id', tenantId)
    .order('code');
  if (error) throw new Error('تعذر تحميل أنواع القيد المحاسبي.');
  return (data ?? []) as JournalEntryTypeRecord[];
}

export async function saveJournalEntryType(
  tenantId: string,
  input: {readonly id?: string; readonly code: string; readonly name: string; readonly is_reversal_type: boolean; readonly is_active: boolean},
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    is_reversal_type: input.is_reversal_type,
    is_active: input.is_active,
  };
  const {error} = input.id
    ? await client.from('journal_entry_types').update(payload).eq('id', input.id).eq('tenant_id', tenantId)
    : await client.from('journal_entry_types').insert(payload);
  if (error) throw new Error('تعذر حفظ نوع القيد.');
}

// ----------------------------------------------------------------------------
// Shipping Services & Shipment Types
// ----------------------------------------------------------------------------
export async function listShipmentTypes(tenantId: string): Promise<readonly ShipmentTypeRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('shipment_types')
    .select('id, tenant_id, code, name, description, is_system, is_active')
    .eq('tenant_id', tenantId)
    .order('code');
  if (error) throw new Error('تعذر تحميل أنواع الشحنات.');
  return (data ?? []) as ShipmentTypeRecord[];
}

export async function listShippingServices(tenantId: string): Promise<readonly ShippingServiceRecord[]> {
  const client = requireClient();
  const [servicesRes, linksRes] = await Promise.all([
    client
      .from('shipping_services')
      .select(
        'id, tenant_id, code, name, estimated_days_min, estimated_days_max, branch_id, delivery_revenue_account_id, collection_revenue_account_id, courier_commission_account_id, is_active, archived_at',
      )
      .eq('tenant_id', tenantId)
      .is('archived_at', null)
      .order('code'),
    client
      .from('shipping_service_types')
      .select('service_id, shipment_type_id')
      .eq('tenant_id', tenantId),
  ]);

  if (servicesRes.error) throw new Error('تعذر تحميل خدمات الشحن.');

  const linkMap = new Map<string, string[]>();
  for (const link of linksRes.data ?? []) {
    const arr = linkMap.get(link.service_id) ?? [];
    arr.push(link.shipment_type_id);
    linkMap.set(link.service_id, arr);
  }

  return (servicesRes.data ?? []).map((srv) => ({
    ...srv,
    shipment_type_ids: linkMap.get(srv.id) ?? [],
  })) as ShippingServiceRecord[];
}

export async function saveShippingService(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly code: string;
    readonly name: string;
    readonly estimated_days_min: number;
    readonly estimated_days_max: number;
    readonly branch_id: string | null;
    readonly delivery_revenue_account_id: string | null;
    readonly collection_revenue_account_id: string | null;
    readonly courier_commission_account_id: string | null;
    readonly is_active: boolean;
    readonly shipment_type_ids: readonly string[];
  },
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    estimated_days_min: input.estimated_days_min,
    estimated_days_max: Math.max(input.estimated_days_min, input.estimated_days_max),
    branch_id: input.branch_id || null,
    delivery_revenue_account_id: input.delivery_revenue_account_id || null,
    collection_revenue_account_id: input.collection_revenue_account_id || null,
    courier_commission_account_id: input.courier_commission_account_id || null,
    is_active: input.is_active,
  };

  let serviceId = input.id;
  if (serviceId) {
    const {error} = await client
      .from('shipping_services')
      .update(payload)
      .eq('id', serviceId)
      .eq('tenant_id', tenantId);
    if (error) throw new Error('تعذر تحديث خدمة الشحن.');
  } else {
    const {data, error} = await client
      .from('shipping_services')
      .insert(payload)
      .select('id')
      .single();
    if (error || !data) throw new Error('تعذر إضافة خدمة الشحن. تأكد من عدم تكرار الكود.');
    serviceId = data.id;
  }

  if (serviceId) {
    await client
      .from('shipping_service_types')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('service_id', serviceId);

    if (input.shipment_type_ids.length > 0) {
      const {error: linkErr} = await client.from('shipping_service_types').insert(
        input.shipment_type_ids.map((typeId) => ({
          tenant_id: tenantId,
          service_id: serviceId,
          shipment_type_id: typeId,
        })),
      );
      if (linkErr) throw new Error('تم حفظ الخدمة لكن تعذر ربط أنواع الطلبات.');
    }
  }
}

// ----------------------------------------------------------------------------
// Delivery Exception Reasons
// ----------------------------------------------------------------------------
export async function listExceptionReasons(tenantId: string): Promise<readonly DeliveryExceptionReasonRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('delivery_exception_reasons')
    .select('id, tenant_id, code, name, category, requires_note, is_system, is_active')
    .eq('tenant_id', tenantId)
    .order('code');
  if (error) throw new Error('تعذر تحميل أسباب التعذر والإرجاع.');
  return (data ?? []) as DeliveryExceptionReasonRecord[];
}

export async function saveExceptionReason(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly code: string;
    readonly name: string;
    readonly category: ExceptionCategory;
    readonly requires_note: boolean;
    readonly is_active: boolean;
  },
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    category: input.category,
    requires_note: input.requires_note,
    is_active: input.is_active,
  };
  const {error} = input.id
    ? await client.from('delivery_exception_reasons').update(payload).eq('id', input.id).eq('tenant_id', tenantId)
    : await client.from('delivery_exception_reasons').insert(payload);
  if (error) throw new Error('تعذر حفظ سبب الاستثناء.');
}

// ----------------------------------------------------------------------------
// Cashboxes & Custodians
// ----------------------------------------------------------------------------
export async function listCashboxes(tenantId: string): Promise<readonly CashboxRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('cashboxes')
    .select(
      'id, tenant_id, code, name, branch_id, ledger_account_id, is_active, allow_deposit, allow_withdraw, allow_transfer_in, allow_transfer_out, archived_at',
    )
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('code');
  if (error) throw new Error('تعذر تحميل الخزائن.');
  return (data ?? []) as CashboxRecord[];
}

export async function saveCashbox(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly code: string;
    readonly name: string;
    readonly branch_id: string;
    readonly ledger_account_id: string;
    readonly is_active: boolean;
    readonly allow_deposit: boolean;
    readonly allow_withdraw: boolean;
    readonly allow_transfer_in: boolean;
    readonly allow_transfer_out: boolean;
  },
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    branch_id: input.branch_id,
    ledger_account_id: input.ledger_account_id,
    is_active: input.is_active,
    allow_deposit: input.allow_deposit,
    allow_withdraw: input.allow_withdraw,
    allow_transfer_in: input.allow_transfer_in,
    allow_transfer_out: input.allow_transfer_out,
  };
  const {error} = input.id
    ? await client.from('cashboxes').update(payload).eq('id', input.id).eq('tenant_id', tenantId)
    : await client.from('cashboxes').insert(payload);
  if (error) throw new Error('تعذر حفظ بيانات الخزينة.');
}

export async function listCashboxCustodians(tenantId: string): Promise<readonly CashboxCustodianRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('cashbox_custodians')
    .select('id, tenant_id, cashbox_id, membership_id, is_active, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at');
  if (error) throw new Error('تعذر تحميل أمناء الخزائن.');
  return (data ?? []) as CashboxCustodianRecord[];
}

export async function listTenantStaffMemberships(tenantId: string): Promise<readonly TenantMemberOption[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('tenant_memberships')
    .select('id, username, role_key, is_active, profiles (display_name)')
    .eq('tenant_id', tenantId)
    .eq('account_subject_type', 'staff')
    .order('created_at');
  if (error) throw new Error('تعذر تحميل أعضاء الفريق.');

  return (data ?? []).map((row) => {
    const profileObj = row.profiles as unknown as {display_name?: string} | null;
    return {
      id: row.id,
      username: row.username,
      role_key: row.role_key,
      is_active: row.is_active,
      display_name: profileObj?.display_name ?? row.username,
    };
  });
}

export async function addCashboxCustodian(
  tenantId: string,
  cashboxId: string,
  membershipId: string,
): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('cashbox_custodians').upsert(
    {
      tenant_id: tenantId,
      cashbox_id: cashboxId,
      membership_id: membershipId,
      is_active: true,
    },
    {onConflict: 'tenant_id,cashbox_id,membership_id'},
  );
  if (error) throw new Error('تعذر تعيين أمين الخزينة.');
}

export async function toggleCashboxCustodian(
  tenantId: string,
  custodianId: string,
  isActive: boolean,
): Promise<void> {
  const client = requireClient();
  const {error} = await client
    .from('cashbox_custodians')
    .update({is_active: isActive})
    .eq('id', custodianId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error('تعذر تحديث حالة أمين الخزينة.');
}

// ----------------------------------------------------------------------------
// Payment References & Numbering Sequences
// ----------------------------------------------------------------------------
export async function listOperationalRefs(tenantId: string): Promise<{
  readonly paymentMethods: readonly PaymentMethodRecord[];
  readonly paymentTerms: readonly PaymentTermRecord[];
  readonly deliveryTypes: readonly DeliveryTypeRecord[];
  readonly sequences: readonly NumberingSequenceRecord[];
}> {
  const client = requireClient();
  const [methodsRes, termsRes, delRes, seqRes] = await Promise.all([
    client.from('payment_methods').select('id, code, name, is_active').eq('tenant_id', tenantId).order('code'),
    client.from('payment_terms').select('id, code, name, is_active').eq('tenant_id', tenantId).order('code'),
    client.from('delivery_types').select('id, code, name, is_active').eq('tenant_id', tenantId).order('code'),
    client
      .from('numbering_sequences')
      .select('id, entity_key, label, prefix, next_number, padding_length, is_active')
      .eq('tenant_id', tenantId)
      .order('entity_key'),
  ]);

  return {
    paymentMethods: (methodsRes.data ?? []) as PaymentMethodRecord[],
    paymentTerms: (termsRes.data ?? []) as PaymentTermRecord[],
    deliveryTypes: (delRes.data ?? []) as DeliveryTypeRecord[],
    sequences: (seqRes.data ?? []) as NumberingSequenceRecord[],
  };
}

export async function updateNumberingSequencePrefix(
  tenantId: string,
  sequenceId: string,
  prefix: string,
): Promise<void> {
  const client = requireClient();
  const {error} = await client
    .from('numbering_sequences')
    .update({prefix: prefix.trim().toUpperCase()})
    .eq('id', sequenceId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error('تعذر تحديث بادئة الترقيم.');
}
