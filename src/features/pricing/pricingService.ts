import {getSupabaseClient} from '@/lib/supabase/client';
import type {
  ClientPriceListRecord,
  DeliveryPriceRuleRecord,
  PickupPriceRuleRecord,
  PriceCalculationBreakdown,
  PriceListVersionRecord,
  PriceMode,
  PriceSurchargeRecord,
  ShipmentPriceSnapshotRecord,
  SurchargeType,
  TaxProfileRecord,
  WeightRoundingRule,
} from '@/types/pricing';

function requireClient() {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('إعدادات الاتصال بقاعدة البيانات غير مهيأة.');
  }
  return client;
}

export async function listTaxProfiles(tenantId: string): Promise<readonly TaxProfileRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('tax_profiles')
    .select('id, tenant_id, code, name, rate_percent, tax_mode, is_default, is_active')
    .eq('tenant_id', tenantId)
    .order('is_default', {ascending: false})
    .order('code');
  if (error) throw new Error('تعذر تحميل ملفات الضريبة.');
  return (data ?? []) as TaxProfileRecord[];
}

export async function listClientPriceLists(tenantId: string): Promise<readonly ClientPriceListRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('client_price_lists')
    .select('*')
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('is_system_default', {ascending: false})
    .order('code');
  if (error) throw new Error('تعذر تحميل قوائم الأسعار.');
  return (data ?? []) as ClientPriceListRecord[];
}

export async function createClientPriceList(
  tenantId: string,
  input: {
    readonly code: string;
    readonly name: string;
    readonly description: string | null;
    readonly volumetric_divisor: number;
    readonly weight_rounding_rule: WeightRoundingRule;
  },
): Promise<string> {
  const client = requireClient();
  const {data: listData, error: listErr} = await client
    .from('client_price_lists')
    .insert({
      tenant_id: tenantId,
      code: input.code.trim().toUpperCase(),
      name: input.name.trim(),
      description: input.description?.trim() || null,
      is_system_default: false,
      is_active: true,
    })
    .select('id')
    .single();

  if (listErr || !listData) throw new Error('تعذر إنشاء قائمة الأسعار. تأكد من عدم تكرار الكود.');

  const {error: verErr} = await client.from('price_list_versions').insert({
    tenant_id: tenantId,
    price_list_id: listData.id,
    version_number: 1,
    label: 'الإصدار 1',
    volumetric_divisor: input.volumetric_divisor,
    weight_rounding_rule: input.weight_rounding_rule,
    is_active: true,
    is_published: true,
  });

  if (verErr) throw new Error('تم إنشاء القائمة لكن تعذر إنشاء الإصدار الافتراضي.');
  return listData.id as string;
}

export async function updateClientPriceList(
  tenantId: string,
  priceListId: string,
  input: {readonly name: string; readonly description: string | null; readonly is_active: boolean},
): Promise<void> {
  const client = requireClient();
  const {error} = await client
    .from('client_price_lists')
    .update({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      is_active: input.is_active,
    })
    .eq('id', priceListId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error('تعذر تحديث بيانات قائمة الأسعار.');
}

export async function clonePriceList(
  tenantId: string,
  sourcePriceListId: string,
  newCode: string,
  newName: string,
  description: string | null,
): Promise<string> {
  const client = requireClient();
  const {data, error} = await client.rpc('clone_price_list', {
    p_tenant_id: tenantId,
    p_source_price_list_id: sourcePriceListId,
    p_new_code: newCode.trim().toUpperCase(),
    p_new_name: newName.trim(),
    p_description: description?.trim() || null,
  });
  if (error || !data) throw new Error('تعذر نسخ قائمة الأسعار.');
  return data as string;
}

export async function listPriceListVersions(
  tenantId: string,
  priceListId: string,
): Promise<readonly PriceListVersionRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('price_list_versions')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('price_list_id', priceListId)
    .order('version_number', {ascending: false});
  if (error) throw new Error('تعذر تحميل إصدارات قائمة الأسعار.');
  return (data ?? []) as PriceListVersionRecord[];
}

export async function updatePriceListVersionSettings(
  tenantId: string,
  versionId: string,
  input: {readonly volumetric_divisor: number; readonly weight_rounding_rule: WeightRoundingRule; readonly label: string},
): Promise<void> {
  const client = requireClient();
  const {error} = await client
    .from('price_list_versions')
    .update({
      volumetric_divisor: input.volumetric_divisor,
      weight_rounding_rule: input.weight_rounding_rule,
      label: input.label.trim(),
    })
    .eq('id', versionId)
    .eq('tenant_id', tenantId);
  if (error) throw new Error('تعذر تحديث إعدادات الوزن لإصدار القائمة.');
}

export async function listPickupPriceRules(
  tenantId: string,
  versionId: string,
): Promise<readonly PickupPriceRuleRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('pickup_price_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('price_list_version_id', versionId)
    .order('created_at');
  if (error) throw new Error('تعذر تحميل قواعد الالتقاط.');
  return (data ?? []) as PickupPriceRuleRecord[];
}

export async function savePickupPriceRule(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly price_list_version_id: string;
    readonly service_id: string;
    readonly pickup_governorate_id: string;
    readonly pickup_region_id: string | null;
    readonly is_active: boolean;
    readonly notes: string | null;
  },
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    price_list_version_id: input.price_list_version_id,
    service_id: input.service_id,
    pickup_governorate_id: input.pickup_governorate_id,
    pickup_region_id: input.pickup_region_id || null,
    is_active: input.is_active,
    notes: input.notes?.trim() || null,
  };
  const {error} = input.id
    ? await client.from('pickup_price_rules').update(payload).eq('id', input.id).eq('tenant_id', tenantId)
    : await client.from('pickup_price_rules').insert(payload);
  if (error) throw new Error('تعذر حفظ قاعدة الالتقاط. تأكد من عدم تكرار نفس الخدمة والموقع.');
}

export async function deletePickupPriceRule(tenantId: string, ruleId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('pickup_price_rules').delete().eq('id', ruleId).eq('tenant_id', tenantId);
  if (error) throw new Error('تعذر حذف قاعدة الالتقاط.');
}

export async function listDeliveryPriceRules(
  tenantId: string,
  pickupRuleId: string,
): Promise<readonly DeliveryPriceRuleRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('delivery_price_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('pickup_rule_id', pickupRuleId)
    .order('created_at');
  if (error) throw new Error('تعذر تحميل قواعد التسليم المرتبطة.');
  return (data ?? []) as DeliveryPriceRuleRecord[];
}

export async function saveDeliveryPriceRule(
  tenantId: string,
  input: {
    readonly id?: string;
    readonly pickup_rule_id: string;
    readonly delivery_governorate_id: string;
    readonly delivery_region_id: string | null;
    readonly base_weight_kg: number;
    readonly base_delivery_fee: number;
    readonly extra_weight_step_kg: number;
    readonly extra_weight_fee: number;
    readonly return_fee: number;
    readonly collection_threshold_amount: number;
    readonly collection_fee_base: number;
    readonly collection_extra_step_amount: number;
    readonly collection_extra_fee: number;
    readonly is_active: boolean;
  },
): Promise<void> {
  const client = requireClient();
  const payload = {
    tenant_id: tenantId,
    pickup_rule_id: input.pickup_rule_id,
    delivery_governorate_id: input.delivery_governorate_id,
    delivery_region_id: input.delivery_region_id || null,
    base_weight_kg: input.base_weight_kg,
    base_delivery_fee: input.base_delivery_fee,
    extra_weight_step_kg: input.extra_weight_step_kg,
    extra_weight_fee: input.extra_weight_fee,
    return_fee: input.return_fee,
    collection_threshold_amount: input.collection_threshold_amount,
    collection_fee_base: input.collection_fee_base,
    collection_extra_step_amount: input.collection_extra_step_amount,
    collection_extra_fee: input.collection_extra_fee,
    is_active: input.is_active,
  };

  const {error} = input.id
    ? await client.from('delivery_price_rules').update(payload).eq('id', input.id).eq('tenant_id', tenantId)
    : await client.from('delivery_price_rules').insert(payload);
  if (error) throw new Error('تعذر حفظ قاعدة التسليم. تأكد من عدم تكرار الوجهة لنفس نقطة الالتقاط.');
}

export async function deleteDeliveryPriceRule(tenantId: string, ruleId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('delivery_price_rules').delete().eq('id', ruleId).eq('tenant_id', tenantId);
  if (error) throw new Error('تعذر حذف قاعدة التسليم.');
}

export async function listPriceSurcharges(
  tenantId: string,
  versionId: string,
): Promise<readonly PriceSurchargeRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('price_surcharges')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('price_list_version_id', versionId)
    .order('code');
  if (error) throw new Error('تعذر تحميل الرسوم الإضافية.');
  return (data ?? []) as PriceSurchargeRecord[];
}

export async function savePriceSurcharge(
  tenantId: string,
  input: {
    readonly price_list_version_id: string;
    readonly service_id: string | null;
    readonly code: string;
    readonly name: string;
    readonly charge_type: SurchargeType;
    readonly amount: number;
  },
): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('price_surcharges').insert({
    tenant_id: tenantId,
    price_list_version_id: input.price_list_version_id,
    service_id: input.service_id || null,
    code: input.code.trim().toUpperCase(),
    name: input.name.trim(),
    charge_type: input.charge_type,
    amount: input.amount,
    is_active: true,
  });
  if (error) throw new Error('تعذر إضافة الرسم الإضافي.');
}

export async function deletePriceSurcharge(tenantId: string, surchargeId: string): Promise<void> {
  const client = requireClient();
  const {error} = await client.from('price_surcharges').delete().eq('id', surchargeId).eq('tenant_id', tenantId);
  if (error) throw new Error('تعذر حذف الرسم الإضافي.');
}

export interface CalculatePriceInput {
  readonly tenantId: string;
  readonly clientId: string;
  readonly serviceId: string;
  readonly pickupGovernorateId: string;
  readonly pickupRegionId: string | null;
  readonly deliveryGovernorateId: string;
  readonly deliveryRegionId: string | null;
  readonly actualWeightKg: number;
  readonly lengthCm: number;
  readonly widthCm: number;
  readonly heightCm: number;
  readonly enteredAmount: number;
  readonly priceMode: PriceMode;
  readonly overrideTotalFee?: number | null;
  readonly overrideReason?: string | null;
  readonly persistSnapshot?: boolean;
}

export async function calculateShipmentPrice(input: CalculatePriceInput): Promise<PriceCalculationBreakdown> {
  const client = requireClient();
  const {data, error} = await client.rpc('calculate_shipment_price', {
    p_tenant_id: input.tenantId,
    p_client_id: input.clientId,
    p_service_id: input.serviceId,
    p_pickup_governorate_id: input.pickupGovernorateId,
    p_pickup_region_id: input.pickupRegionId || null,
    p_delivery_governorate_id: input.deliveryGovernorateId,
    p_delivery_region_id: input.deliveryRegionId || null,
    p_actual_weight_kg: input.actualWeightKg,
    p_length_cm: input.lengthCm,
    p_width_cm: input.widthCm,
    p_height_cm: input.heightCm,
    p_entered_amount: input.enteredAmount,
    p_price_mode: input.priceMode,
    p_override_total_fee: input.overrideTotalFee ?? null,
    p_override_reason: input.overrideReason ?? null,
    p_persist_snapshot: input.persistSnapshot ?? false,
  });

  if (error || !data) {
    throw new Error(error?.message || 'تعذر احتساب السعر من الخادم.');
  }

  return data as PriceCalculationBreakdown;
}

export async function listPriceSnapshots(tenantId: string): Promise<readonly ShipmentPriceSnapshotRecord[]> {
  const client = requireClient();
  const {data, error} = await client
    .from('shipment_price_snapshots')
    .select(
      'id, tenant_id, client_id, service_id, version_number, chargeable_weight_kg, price_mode, entered_amount, tax_mode, tax_amount, total_shipping_fee, recipient_collect_amount, client_net_payout, is_manual_override, override_reason, created_at',
    )
    .eq('tenant_id', tenantId)
    .order('created_at', {ascending: false})
    .limit(20);
  if (error) throw new Error('تعذر تحميل سجل لقطات الأسعار.');
  return (data ?? []) as ShipmentPriceSnapshotRecord[];
}
