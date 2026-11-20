import {getSupabaseClient} from '@/lib/supabase/client';
import type {
  CommissionType,
  CourierCommissionCalculationResult,
  CourierCommissionListRecord,
  CourierCommissionRuleRecord,
  CourierRecord,
  CourierRouteRecord,
  CourierRouteStopRecord,
  DriverRecord,
  VehicleRecord,
  VehicleType,
} from '@/types/couriers';

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }
  return client;
}

// ----------------------------------------------------------------------------
// Vehicles & Drivers
// ----------------------------------------------------------------------------
export async function listVehicles(tenantId: string): Promise<readonly VehicleRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('vehicles')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('code');
  if (error) throw new Error('تعذر تحميل قائمة السيارات.');
  return (data ?? []) as VehicleRecord[];
}

export async function saveVehicle(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly code: string;
    readonly name: string;
    readonly plate_number: string | null;
    readonly vehicle_type: VehicleType;
    readonly capacity_kg: number | null;
    readonly is_active: boolean;
  },
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    plate_number: input.plate_number?.trim() || null,
    vehicle_type: input.vehicle_type,
    capacity_kg: input.capacity_kg,
    is_active: input.is_active,
  };
  if (input.id) {
    const {error} = await client.from('vehicles').update(payload).eq('tenant_id', tenantId).eq('id', input.id);
    if (error) throw new Error('تعذر تحديث بيانات السيارة.');
  } else {
    const {error} = await client.from('vehicles').insert(payload);
    if (error) throw new Error('تعذر إضافة السيارة (تأكد من عدم تكرار الكود).');
  }
}

export async function listDrivers(tenantId: string): Promise<readonly DriverRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('drivers')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('code');
  if (error) throw new Error('تعذر تحميل قائمة السائقين.');
  return (data ?? []) as DriverRecord[];
}

export async function saveDriver(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly code: string;
    readonly name: string;
    readonly mobile: string | null;
    readonly license_number: string | null;
    readonly is_active: boolean;
  },
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    mobile: input.mobile?.trim() || null,
    license_number: input.license_number?.trim() || null,
    is_active: input.is_active,
  };
  if (input.id) {
    const {error} = await client.from('drivers').update(payload).eq('tenant_id', tenantId).eq('id', input.id);
    if (error) throw new Error('تعذر تحديث بيانات السائق.');
  } else {
    const {error} = await client.from('drivers').insert(payload);
    if (error) throw new Error('تعذر إضافة السائق (تأكد من عدم تكرار الكود).');
  }
}

// ----------------------------------------------------------------------------
// Courier Routes & Stops
// ----------------------------------------------------------------------------
export async function listCourierRoutes(tenantId: string): Promise<readonly CourierRouteRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('courier_routes')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('is_system_default', {ascending: false})
    .order('code');
  if (error) throw new Error('تعذر تحميل خطوط السير.');
  return (data ?? []) as CourierRouteRecord[];
}

export async function saveCourierRoute(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly code: string;
    readonly name: string;
    readonly description: string | null;
    readonly vehicle_id: string | null;
    readonly driver_id: string | null;
    readonly is_active: boolean;
  },
): Promise<string> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    description: input.description?.trim() || null,
    vehicle_id: input.vehicle_id || null,
    driver_id: input.driver_id || null,
    is_active: input.is_active,
  };
  if (input.id) {
    const {error} = await client.from('courier_routes').update(payload).eq('tenant_id', tenantId).eq('id', input.id);
    if (error) throw new Error('تعذر تحديث خط السير.');
    return input.id;
  } else {
    const {data, error} = await client.from('courier_routes').insert(payload).select('id').single();
    if (error || !data) throw new Error('تعذر إنشاء خط السير.');
    return data.id as string;
  }
}

export async function listRouteStops(tenantId: string, routeId: string): Promise<readonly CourierRouteStopRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('courier_route_stops')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('route_id', routeId)
    .order('stop_order');
  if (error) throw new Error('تعذر تحميل محطات خط السير.');
  return (data ?? []) as CourierRouteStopRecord[];
}

export async function saveRouteStop(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly route_id: string;
    readonly stop_order: number;
    readonly governorate_id: string;
    readonly region_id: string | null;
    readonly notes: string | null;
  },
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    route_id: input.route_id,
    stop_order: input.stop_order,
    governorate_id: input.governorate_id,
    region_id: input.region_id || null,
    notes: input.notes?.trim() || null,
  };
  if (input.id) {
    const {error} = await client
      .from('courier_route_stops')
      .update(payload)
      .eq('tenant_id', tenantId)
      .eq('id', input.id);
    if (error) throw new Error('تعذر تعديل محطة خط السير (تحقق من عدم تكرار رقم الترتيب).');
  } else {
    const {error} = await client.from('courier_route_stops').insert(payload);
    if (error) throw new Error('تعذر إضافة المحطة (تحقق من عدم تكرار رقم السطر).');
  }
}

export async function deleteRouteStop(tenantId: string, stopId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('courier_route_stops').delete().eq('tenant_id', tenantId).eq('id', stopId);
  if (error) throw new Error('تعذر حذف المحطة.');
}

// ----------------------------------------------------------------------------
// Commission Lists & Geographic Rules
// ----------------------------------------------------------------------------
export async function listCommissionLists(tenantId: string): Promise<readonly CourierCommissionListRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('courier_commission_lists')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('is_system_default', {ascending: false})
    .order('code');
  if (error) throw new Error('تعذر تحميل قوائم عمولات المناديب.');
  return (data ?? []) as CourierCommissionListRecord[];
}

export async function saveCommissionList(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly code: string;
    readonly name: string;
    readonly description: string | null;
    readonly is_active: boolean;
  },
): Promise<string> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    description: input.description?.trim() || null,
    is_active: input.is_active,
  };
  if (input.id) {
    const {error} = await client
      .from('courier_commission_lists')
      .update(payload)
      .eq('tenant_id', tenantId)
      .eq('id', input.id);
    if (error) throw new Error('تعذر تحديث قائمة العمولات.');
    return input.id;
  } else {
    const {data, error} = await client.from('courier_commission_lists').insert(payload).select('id').single();
    if (error || !data) throw new Error('تعذر إنشاء قائمة العمولات (تحقق من عدم تكرار الكود).');
    return data.id as string;
  }
}

export async function listCommissionRules(
  tenantId: string,
  commissionListId: string,
): Promise<readonly CourierCommissionRuleRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('courier_commission_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('commission_list_id', commissionListId)
    .order('created_at');
  if (error) throw new Error('تعذر تحميل بنود قائمة العمولات.');
  return (data ?? []) as CourierCommissionRuleRecord[];
}

export async function saveCommissionRule(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly commission_list_id: string;
    readonly governorate_id: string;
    readonly region_id: string | null;
    readonly commission_type: CommissionType;
    readonly commission_value: number;
    readonly valid_from: string | null;
    readonly valid_to: string | null;
    readonly is_active: boolean;
    readonly notes: string | null;
  },
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    commission_list_id: input.commission_list_id,
    governorate_id: input.governorate_id,
    region_id: input.region_id || null,
    commission_type: input.commission_type,
    commission_value: input.commission_value,
    valid_from: input.valid_from || null,
    valid_to: input.valid_to || null,
    is_active: input.is_active,
    notes: input.notes?.trim() || null,
  };
  if (input.id) {
    const {error} = await client
      .from('courier_commission_rules')
      .update(payload)
      .eq('tenant_id', tenantId)
      .eq('id', input.id);
    if (error) throw new Error('تعذر تحديث قاعدة العمولة.');
  } else {
    const {error} = await client.from('courier_commission_rules').insert(payload);
    if (error) throw new Error('تعذر إضافة قاعدة العمولة (ربما توجد قاعدة فعالة لنفس المنطقة/المحافظة).');
  }
}

export async function deleteCommissionRule(tenantId: string, ruleId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('courier_commission_rules').delete().eq('tenant_id', tenantId).eq('id', ruleId);
  if (error) throw new Error('تعذر حذف قاعدة العمولة.');
}

// ----------------------------------------------------------------------------
// Couriers Master CRUD & Server Commission Calculator
// ----------------------------------------------------------------------------
export interface SaveCourierInput {
  readonly id?: string;
  readonly code: string;
  readonly name: string;
  readonly branch_id: string | null;
  readonly ledger_account_id: string | null;
  readonly custody_account_id: string | null;
  readonly default_route_id: string;
  readonly commission_list_id: string;
  readonly default_commission_type: CommissionType;
  readonly default_commission_value: number;
  readonly country_id: string | null;
  readonly governorate_id: string | null;
  readonly city_id: string | null;
  readonly region_id: string | null;
  readonly phone: string | null;
  readonly mobile: string;
  readonly po_box: string | null;
  readonly postal_code: string | null;
  readonly address_line: string | null;
  readonly email: string | null;
  readonly is_active: boolean;
}

export async function listCouriers(tenantId: string): Promise<readonly CourierRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('couriers')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('code');
  if (error) throw new Error('تعذر تحميل قائمة المناديب.');
  return (data ?? []) as CourierRecord[];
}

export async function saveCourier(tenantId: string, input: SaveCourierInput): Promise<string> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    branch_id: input.branch_id || null,
    ledger_account_id: input.ledger_account_id || null,
    custody_account_id: input.custody_account_id || null,
    default_route_id: input.default_route_id,
    commission_list_id: input.commission_list_id,
    default_commission_type: input.default_commission_type,
    default_commission_value: input.default_commission_value,
    country_id: input.country_id || null,
    governorate_id: input.governorate_id || null,
    city_id: input.city_id || null,
    region_id: input.region_id || null,
    phone: input.phone?.trim() || null,
    mobile: input.mobile.trim(),
    po_box: input.po_box?.trim() || null,
    postal_code: input.postal_code?.trim() || null,
    address_line: input.address_line?.trim() || null,
    email: input.email?.trim() || null,
    is_active: input.is_active,
  };
  if (input.id) {
    const {error} = await client.from('couriers').update(payload).eq('tenant_id', tenantId).eq('id', input.id);
    if (error) throw new Error('تعذر تحديث بيانات المندوب.');
    return input.id;
  } else {
    const {data, error} = await client.from('couriers').insert(payload).select('id').single();
    if (error || !data) throw new Error('تعذر إنشاء المندوب (تحقق من الكود والحقول المطلوبة).');
    return data.id as string;
  }
}

export async function archiveCourier(tenantId: string, courierId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client
    .from('couriers')
    .update({archived_at: new Date().toISOString(), is_active: false})
    .eq('tenant_id', tenantId)
    .eq('id', courierId);
  if (error) throw new Error('تعذر أرشفة ملف المندوب.');
}

export async function calculateCourierCommission(input: {
  readonly tenantId: string;
  readonly courierId: string;
  readonly governorateId: string;
  readonly regionId?: string | null;
  readonly deliveryFee: number;
  readonly collectionFee: number;
  readonly calcDate?: string;
}): Promise<CourierCommissionCalculationResult> {
  const client = requireClient();
  const {data, error} = await client.rpc('calculate_courier_commission', {
    p_tenant_id: input.tenantId,
    p_courier_id: input.courierId,
    p_governorate_id: input.governorateId,
    p_region_id: input.regionId ?? null,
    p_delivery_fee: input.deliveryFee,
    p_collection_fee: input.collectionFee,
    p_calc_date: input.calcDate ?? new Date().toISOString().slice(0, 10),
  });
  if (error || !data) {
    throw new Error(error?.message ?? 'تعذر احتساب عمولة المندوب من الخادم.');
  }
  return data as CourierCommissionCalculationResult;
}
