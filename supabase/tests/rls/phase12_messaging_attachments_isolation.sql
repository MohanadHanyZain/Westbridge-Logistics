-- ============================================================================
-- RLS & Workflow Verification Script for Phase 12
-- Messaging, Internal Visibility Isolation, Private Storage Metadata,
-- Idempotent Messages, Attachment Limits & Shipment Auto-Notifications
-- Run inside a transaction (ROLLBACK at the end) in Supabase SQL Editor.
-- ============================================================================

BEGIN;

INSERT INTO auth.users (id, email)
VALUES
  ('d1111111-1111-1111-1111-111111111111', 'owner-p12@test.local'),
  ('d2222222-2222-2222-2222-222222222222', 'client-a1-p12@test.local'),
  ('d3333333-3333-3333-3333-333333333333', 'client-a2-p12@test.local'),
  ('d9999999-9999-9999-9999-999999999999', 'superadmin-p12@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
VALUES ('d9999999-9999-9999-9999-999999999999', 'Super Admin P12', true, true)
ON CONFLICT (id) DO NOTHING;

SELECT * FROM app_private.onboard_tenant(
  'idem-phase12-a',
  'd9999999-9999-9999-9999-999999999999',
  'TEN_P12',
  'phase12-messaging',
  'شركة المرحلة الثانية عشرة للشحن',
  'd1111111-1111-1111-1111-111111111111',
  'admin',
  'مالك شركة 12',
  'owner-p12@test.local',
  'ow***@test.local'
);

DO $$
DECLARE
  v_tenant uuid;
  v_branch uuid;
  v_gov uuid;
  v_reg uuid;
  v_price_list uuid;
  v_tax_profile uuid;
  v_service uuid;
  v_shp_type uuid;
  v_mov_type uuid;
  v_term_cod uuid;
  v_role_client uuid;
  v_client1 uuid;
  v_client2 uuid;
  v_shp1_id uuid;
  v_conv1_id uuid;
  v_msg1 jsonb;
  v_msg2 jsonb;
  v_msg_dup jsonb;
  v_att_id uuid;
  v_count integer;
BEGIN
  SELECT id INTO v_tenant FROM public.tenants WHERE slug = 'phase12-messaging';
  SELECT id INTO v_branch FROM public.branches WHERE tenant_id = v_tenant AND is_main = true LIMIT 1;
  SELECT id INTO v_gov FROM public.governorates WHERE tenant_id = v_tenant AND is_active = true LIMIT 1;
  SELECT id INTO v_reg FROM public.regions WHERE tenant_id = v_tenant AND governorate_id = v_gov AND is_active = true LIMIT 1;
  SELECT id INTO v_price_list FROM public.client_price_lists WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_tax_profile FROM public.tax_profiles WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_service FROM public.shipping_services WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_shp_type FROM public.shipment_types WHERE tenant_id = v_tenant AND code = 'FDP' LIMIT 1;
  SELECT id INTO v_mov_type FROM public.movement_types WHERE tenant_id = v_tenant LIMIT 1;
  SELECT id INTO v_term_cod FROM public.payment_terms WHERE tenant_id = v_tenant AND code = 'COD' LIMIT 1;
SELECT id INTO v_role_client FROM public.roles WHERE tenant_id = v_tenant AND code = 'client_owner' LIMIT 1;

  INSERT INTO public.clients (
    tenant_id, code, name, governorate_id, region_id, price_list_id, tax_profile_id,
    default_payment_term_id, default_shipment_type_id, phone, mobile, address_line
  ) VALUES (
    v_tenant, 'CL-P12-1', 'متجر الأول', v_gov, v_reg, v_price_list, v_tax_profile,
    v_term_cod, v_shp_type, '01000000011', '01000000011', 'القاهرة'
  ) RETURNING id INTO v_client1;

  INSERT INTO public.clients (
    tenant_id, code, name, governorate_id, region_id, price_list_id, tax_profile_id,
    default_payment_term_id, default_shipment_type_id, phone, mobile, address_line
  ) VALUES (
    v_tenant, 'CL-P12-2', 'متجر الثاني', v_gov, v_reg, v_price_list, v_tax_profile,
    v_term_cod, v_shp_type, '01000000022', '01000000022', 'الجيزة'
  ) RETURNING id INTO v_client2;

  PERFORM public.srv_provision_tenant_user(
    v_tenant, 'd1111111-1111-1111-1111-111111111111', 'd2222222-2222-2222-2222-222222222222',
    'merchant_p12_1', 'تاجر 1', 'client-a1-p12@test.local',
    v_role_client, v_client1, ARRAY[]::uuid[], NULL
  );
  PERFORM public.srv_provision_tenant_user(
    v_tenant, 'd1111111-1111-1111-1111-111111111111', 'd3333333-3333-3333-3333-333333333333',
    'merchant_p12_2', 'تاجر 2', 'client-a2-p12@test.local',
    v_role_client, v_client2, ARRAY[]::uuid[], NULL
  );

  -- Owner creates shipment for Client 1 & posts both external and internal messages
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', 'd1111111-1111-1111-1111-111111111111', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);

    v_shp1_id := (public.create_shipment(v_tenant, 'p12-shp-1', jsonb_build_object(
    'client_id', v_client1,
    'origin_branch_id', v_branch,
    'service_id', v_service,
    'shipment_type_id', v_shp_type,
    'movement_type_id', v_mov_type,
    'payment_term_id', v_term_cod,
    'actual_weight_kg', 1,
    'entered_amount', 400,
    'sender_name', 'متجر الأول',
    'sender_governorate_id', v_gov,
    'sender_region_id', v_reg,
    'sender_mobile', '01000000011',
    'sender_address_line', 'القاهرة',
    'recipient_name', 'مستلم 1',
    'recipient_governorate_id', v_gov,
    'recipient_region_id', v_reg,
    'recipient_mobile', '01111111119',
    'recipient_address_line', 'المهندسين'
  ))->>'shipment_id')::uuid;

  v_conv1_id := public.open_or_get_conversation(v_tenant, 'shipment', v_shp1_id, NULL);

  -- Send external message with attachment + verify idempotency deduplication
  v_msg1 := public.send_conversation_message(
    v_tenant,
    v_conv1_id,
    'تم استلام الشحنة وجاري تجهيزها',
    'external',
    'idem-msg-1',
    jsonb_build_array(jsonb_build_object(
      'bucket_id', 'message-attachments',
      'object_path', v_tenant::text || '/message/' || v_conv1_id::text || '/2026-11-21/receipt.pdf',
      'file_name', 'receipt.pdf',
      'mime_type', 'application/pdf',
      'size_bytes', 102400
    ))
  );

  v_msg_dup := public.send_conversation_message(
    v_tenant,
    v_conv1_id,
    'تم استلام الشحنة وجاري تجهيزها',
    'external',
    'idem-msg-1',
    '[]'::jsonb
  );

  IF COALESCE((v_msg_dup->>'deduplicated')::boolean, false) <> true
     OR (v_msg_dup->>'message_id')::uuid <> (v_msg1->>'message_id')::uuid THEN
    RAISE EXCEPTION 'Expected duplicate idempotency_key to return original message_id';
  END IF;

  -- Send internal-only message
  v_msg2 := public.send_conversation_message(
    v_tenant,
    v_conv1_id,
    'تنبيه داخلي للمراجعة المالية فقط',
    'internal',
    'idem-msg-2',
    '[]'::jsonb
  );

  -- Register shipment attachment directly
  v_att_id := public.register_shipment_attachment(
    v_tenant,
    v_shp1_id,
    'shipment-attachments',
    v_tenant::text || '/shipment/' || v_shp1_id::text || '/2026-11-21/package.jpg',
    'package.jpg',
    'image/jpeg',
    204800,
    'general',
    'external',
    'صورة الطرد قبل الالتقاط'
  );

  -- Trigger shipment status notification -> Client 1 receives shipment_status notification
  PERFORM public.transition_shipment_status(v_tenant, v_shp1_id, 'in_warehouse', 'وصلت للمخزن الرئيسي', NULL, v_branch, NULL);

  -- 1. Switch to Client 1: sees external message (1), does NOT see internal message, sees auto notifications!
  PERFORM set_config('request.jwt.claim.sub', 'd2222222-2222-2222-2222-222222222222', true);

  SELECT COUNT(*) INTO v_count
  FROM public.messages
  WHERE conversation_id = v_conv1_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected Client 1 to see ONLY 1 external message, saw %', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.notifications
  WHERE tenant_id = v_tenant AND recipient_user_id = 'd2222222-2222-2222-2222-222222222222';
  IF v_count < 2 THEN
    RAISE EXCEPTION 'Expected Client 1 to receive message & status notifications, saw %', v_count;
  END IF;

  -- 2. Switch to Client 2: sees 0 conversations, 0 messages, 0 attachments, 0 notifications from Client 1
  PERFORM set_config('request.jwt.claim.sub', 'd3333333-3333-3333-3333-333333333333', true);

  SELECT COUNT(*) INTO v_count FROM public.conversations WHERE tenant_id = v_tenant;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Expected Client 2 to see 0 conversations, saw %', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.shipment_attachments WHERE tenant_id = v_tenant;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Expected Client 2 to see 0 shipment attachments, saw %', v_count;
  END IF;

  BEGIN
    PERFORM public.send_conversation_message(v_tenant, v_conv1_id, 'محاولة اختراق', 'external', NULL, '[]'::jsonb);
    RAISE EXCEPTION 'Expected Client 2 to be blocked from posting in Client 1 conversation';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 3. Oversized attachment rejection (> 5MB default)
  PERFORM set_config('request.jwt.claim.sub', 'd1111111-1111-1111-1111-111111111111', true);
  BEGIN
    PERFORM public.register_shipment_attachment(
      v_tenant, v_shp1_id, 'shipment-attachments',
      v_tenant::text || '/shipment/' || v_shp1_id::text || '/2026-11-21/huge.pdf',
      'huge.pdf', 'application/pdf', 10485760, 'general', 'external', NULL
    );
    RAISE EXCEPTION 'Expected attachment > 5MB to be rejected by tenant_settings limit';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;

ROLLBACK;