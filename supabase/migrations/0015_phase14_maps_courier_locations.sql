-- ============================================================================
-- Migration 0015: Phase 14 - Google Maps Platform, Live Courier Positions & GPS Events
-- ============================================================================
-- Implements ADR-022 & MASTER_SPEC Sections 03 / 08 / 12:
-- 1. Add Phase 14 permissions ('couriers.locations_read', 'couriers.locations_record')
--    and backfill role_permissions cleanly across existing tenants.
-- 2. Extend `tenant_settings` with location retention policy, ping interval, and
--    delivery GPS requirement (`location_retention_days`, `gps_ping_interval_seconds`,
--    `require_gps_on_delivery`), plus optional coordinates on `branches`.
-- 3. Create `courier_devices` and `courier_location_events` protected by composite
--    tenant FKs, coordinate range checks, and FORCE ROW LEVEL SECURITY.
-- 4. Server-side RPCs:
--    - `record_courier_location_event`: active-task / field location capture.
--    - `get_live_couriers_positions`: latest known coordinates + shift load per courier.
--    - `list_courier_movements_timeline`: chronological route stops & GPS timeline.
--    - `get_tenant_maps_settings` / `update_tenant_maps_settings`: retention & GPS policy.
--    - `purge_expired_courier_locations`: admin cleanup of expired location events.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Phase 14 Permissions Catalog & Role Backfill
-- ----------------------------------------------------------------------------
INSERT INTO public.permissions (key, module, label_ar, description_ar, default_scope, is_sensitive)
VALUES
  ('couriers.locations_read', 'couriers', 'متابعة مواقع ومسارات المناديب', 'استعراض الخريطة الحية ومسارات تحركات المناديب ونقاط التسليم.', 'branch', true),
  ('couriers.locations_record', 'couriers', 'تسجيل نقاط الموقع الميداني', 'إرسال إحداثيات التتبع الميداني أثناء المهام النشطة وعمليات التوصيل.', 'assigned', false)
ON CONFLICT (key) DO UPDATE
  SET module = EXCLUDED.module,
      label_ar = EXCLUDED.label_ar,
      description_ar = EXCLUDED.description_ar,
      default_scope = EXCLUDED.default_scope,
      is_sensitive = EXCLUDED.is_sensitive;

INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, scope)
SELECT r.tenant_id, r.id, p.key,
  CASE
    WHEN r.code IN ('company_owner', 'company_admin', 'operations_manager') THEN 'tenant'
    WHEN r.code IN ('branch_manager', 'customer_support') THEN 'branch'
    WHEN r.code = 'delivery_agent' THEN 'assigned'
    ELSE p.default_scope
  END
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.key IN ('couriers.locations_read', 'couriers.locations_record')
  AND (
    (r.code IN ('company_owner', 'company_admin', 'operations_manager') AND p.key IN ('couriers.locations_read', 'couriers.locations_record'))
    OR (r.code IN ('branch_manager', 'customer_support') AND p.key = 'couriers.locations_read')
    OR (r.code = 'delivery_agent' AND p.key IN ('couriers.locations_read', 'couriers.locations_record'))
  )
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Extend tenant_settings & branches with Maps / GPS Policy & Coordinates
-- ----------------------------------------------------------------------------
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS location_retention_days integer NOT NULL DEFAULT 90
    CHECK (location_retention_days BETWEEN 7 AND 365),
  ADD COLUMN IF NOT EXISTS gps_ping_interval_seconds integer NOT NULL DEFAULT 60
    CHECK (gps_ping_interval_seconds BETWEEN 15 AND 600),
  ADD COLUMN IF NOT EXISTS require_gps_on_delivery boolean NOT NULL DEFAULT false;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS lat numeric(9, 6) CHECK (lat IS NULL OR (lat BETWEEN -90 AND 90)),
  ADD COLUMN IF NOT EXISTS lng numeric(9, 6) CHECK (lng IS NULL OR (lng BETWEEN -180 AND 180));

-- ----------------------------------------------------------------------------
-- 3. Phase 14 Tables: Courier Devices & Courier Location Events
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.courier_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  courier_id uuid NOT NULL,
  device_fingerprint text NOT NULL CHECK (char_length(trim(device_fingerprint)) BETWEEN 3 AND 128),
  device_label text NOT NULL CHECK (char_length(trim(device_label)) BETWEEN 2 AND 120),
  platform text NOT NULL DEFAULT 'web_browser'
    CHECK (platform IN ('web_browser', 'android_pwa', 'ios_pwa', 'external_gps')),
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_courier_devices_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_courier_devices_fingerprint UNIQUE (tenant_id, courier_id, device_fingerprint),
  CONSTRAINT fk_courier_devices_courier
    FOREIGN KEY (tenant_id, courier_id) REFERENCES public.couriers(tenant_id, id) ON DELETE RESTRICT
);

DROP TRIGGER IF EXISTS trg_courier_devices_updated_at ON public.courier_devices;
CREATE TRIGGER trg_courier_devices_updated_at
  BEFORE UPDATE ON public.courier_devices
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_courier_devices_tenant_courier
  ON public.courier_devices (tenant_id, courier_id, is_active);

CREATE TABLE IF NOT EXISTS public.courier_location_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  courier_id uuid NOT NULL,
  device_id uuid,
  shipment_id uuid,
  delivery_list_id uuid,
  event_type text NOT NULL
    CHECK (event_type IN ('shift_start', 'ping', 'delivery_attempt', 'pickup_stop', 'shift_end')),
  lat numeric(9, 6) NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng numeric(9, 6) NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_meters numeric(8, 2) CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
  speed_mps numeric(8, 2) CHECK (speed_mps IS NULL OR speed_mps >= 0),
  heading_deg numeric(6, 2) CHECK (heading_deg IS NULL OR (heading_deg >= 0 AND heading_deg <= 360)),
  source text NOT NULL DEFAULT 'gps_browser'
    CHECK (source IN ('gps_browser', 'device_sdk', 'manual_pin', 'delivery_pod')),
  notes text,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_courier_location_events_courier
    FOREIGN KEY (tenant_id, courier_id) REFERENCES public.couriers(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_courier_location_events_device
    FOREIGN KEY (tenant_id, device_id) REFERENCES public.courier_devices(tenant_id, id) ON DELETE SET NULL,
  CONSTRAINT fk_courier_location_events_shipment
    FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE SET NULL,
  CONSTRAINT fk_courier_location_events_delivery_list
    FOREIGN KEY (tenant_id, delivery_list_id) REFERENCES public.delivery_lists(tenant_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_courier_location_events_timeline
  ON public.courier_location_events (tenant_id, courier_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_courier_location_events_expires
  ON public.courier_location_events (tenant_id, expires_at);

-- ----------------------------------------------------------------------------
-- 4. Authorization Helper & Forced RLS on Phase 14 Tables
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.user_can_read_courier_locations(
  p_tenant_id uuid,
  p_courier_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_branch_id uuid;
  v_bound_courier uuid;
BEGIN
  IF app_private.current_user_is_platform_admin() THEN
    RETURN true;
  END IF;

  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RETURN false;
  END IF;

  IF app_private.user_is_tenant_admin(p_tenant_id) THEN
    RETURN true;
  END IF;

  v_bound_courier := app_private.user_get_bound_courier_id(p_tenant_id);
  IF v_bound_courier IS NOT NULL THEN
    RETURN p_courier_id IS NOT NULL AND v_bound_courier = p_courier_id;
  END IF;

  SELECT c.branch_id INTO v_branch_id
  FROM public.couriers c
  WHERE c.tenant_id = p_tenant_id
    AND c.id = p_courier_id;

  RETURN
    app_private.user_is_staff_with_permission(p_tenant_id, 'couriers.locations_read', v_branch_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'couriers.read', v_branch_id);
END;
$$;

REVOKE ALL ON FUNCTION app_private.user_can_read_courier_locations(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.user_can_read_courier_locations(uuid, uuid) TO authenticated;

ALTER TABLE public.courier_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_devices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_courier_devices_select ON public.courier_devices;
CREATE POLICY p_courier_devices_select
  ON public.courier_devices
  FOR SELECT
  TO authenticated
  USING (app_private.user_can_read_courier_locations(tenant_id, courier_id));

ALTER TABLE public.courier_location_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_location_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_courier_location_events_select ON public.courier_location_events;
CREATE POLICY p_courier_location_events_select
  ON public.courier_location_events
  FOR SELECT
  TO authenticated
  USING (app_private.user_can_read_courier_locations(tenant_id, courier_id));

REVOKE ALL ON TABLE public.courier_devices, public.courier_location_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.courier_devices, public.courier_location_events TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Server-Side RPCs: Tenant Maps Settings (ADR-022)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_tenant_maps_settings(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_row public.tenant_settings%ROWTYPE;
BEGIN
  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'غير مصرح بعرض إعدادات الخرائط والمواقع.';
  END IF;

  SELECT * INTO v_row FROM public.tenant_settings WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'tenant_id', p_tenant_id,
    'location_retention_days', COALESCE(v_row.location_retention_days, 90),
    'gps_ping_interval_seconds', COALESCE(v_row.gps_ping_interval_seconds, 60),
    'require_gps_on_delivery', COALESCE(v_row.require_gps_on_delivery, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_maps_settings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_maps_settings(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_maps_settings(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_retention integer;
  v_interval integer;
  v_require_gps boolean;
  v_row public.tenant_settings%ROWTYPE;
BEGIN
  IF NOT app_private.user_is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'تعديل سياسة الخرائط وتتبع المواقع مقتصر على إدارة الشركة.';
  END IF;

  SELECT * INTO v_row FROM public.tenant_settings WHERE tenant_id = p_tenant_id;

  v_retention := COALESCE((p_payload->>'location_retention_days')::integer, COALESCE(v_row.location_retention_days, 90));
  v_interval := COALESCE((p_payload->>'gps_ping_interval_seconds')::integer, COALESCE(v_row.gps_ping_interval_seconds, 60));
  v_require_gps := COALESCE((p_payload->>'require_gps_on_delivery')::boolean, COALESCE(v_row.require_gps_on_delivery, false));

  IF v_retention < 7 OR v_retention > 365 THEN
    RAISE EXCEPTION 'مدة الاحتفاظ بمواقع GPS يجب أن تكون بين 7 و 365 يومًا.';
  END IF;

  IF v_interval < 15 OR v_interval > 600 THEN
    RAISE EXCEPTION 'فاصل تحديث الموقع يجب أن يكون بين 15 و 600 ثانية.';
  END IF;

  UPDATE public.tenant_settings
  SET
    location_retention_days = v_retention,
    gps_ping_interval_seconds = v_interval,
    require_gps_on_delivery = v_require_gps,
    updated_at = now()
  WHERE tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    p_tenant_id,
    auth.uid(),
    'tenant_maps_settings_updated',
    'tenant_settings',
    p_tenant_id,
    jsonb_build_object(
      'location_retention_days', v_row.location_retention_days,
      'gps_ping_interval_seconds', v_row.gps_ping_interval_seconds,
      'require_gps_on_delivery', v_row.require_gps_on_delivery
    ),
    'server'
  );

  RETURN jsonb_build_object(
    'tenant_id', p_tenant_id,
    'location_retention_days', v_row.location_retention_days,
    'gps_ping_interval_seconds', v_row.gps_ping_interval_seconds,
    'require_gps_on_delivery', v_row.require_gps_on_delivery
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_maps_settings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_maps_settings(uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Server-Side RPCs: Location Event Capture, Live View & Timeline
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_courier_location_event(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_bound_courier uuid;
  v_requested_courier uuid;
  v_courier_id uuid;
  v_courier_branch uuid;
  v_courier_active boolean;
  v_event_type text;
  v_lat numeric(9, 6);
  v_lng numeric(9, 6);
  v_accuracy numeric(8, 2);
  v_speed numeric(8, 2);
  v_heading numeric(6, 2);
  v_source text;
  v_shipment_id uuid;
  v_delivery_list_id uuid;
  v_device_fp text;
  v_device_label text;
  v_platform text;
  v_device_id uuid;
  v_notes text;
  v_retention_days integer := 90;
  v_event_id uuid;
  v_recorded_at timestamptz := now();
BEGIN
  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'غير مصرح بالوصول إلى هذه الشركة.';
  END IF;

  v_bound_courier := app_private.user_get_bound_courier_id(p_tenant_id);
  v_requested_courier := NULLIF(trim(COALESCE(p_payload->>'courier_id', '')), '')::uuid;

  IF v_bound_courier IS NOT NULL THEN
    IF v_requested_courier IS NOT NULL AND v_requested_courier <> v_bound_courier THEN
      RAISE EXCEPTION 'لا يمكن للمندوب تسجيل موقع لمندوب آخر.';
    END IF;
    v_courier_id := v_bound_courier;
  ELSE
    v_courier_id := v_requested_courier;
    IF v_courier_id IS NULL THEN
      RAISE EXCEPTION 'معرف المندوب مطلوب لتسجيل نقطة الموقع.';
    END IF;
  END IF;

  SELECT c.branch_id, c.is_active
  INTO v_courier_branch, v_courier_active
  FROM public.couriers c
  WHERE c.tenant_id = p_tenant_id
    AND c.id = v_courier_id
    AND c.archived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المندوب المحدد غير موجود ضمن هذه الشركة.';
  END IF;

  IF v_bound_courier IS NULL THEN
    IF NOT (
      app_private.user_is_tenant_admin(p_tenant_id)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'couriers.locations_record', v_courier_branch)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'couriers.manage', NULL)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'operations.delivery.execute', v_courier_branch)
    ) THEN
      RAISE EXCEPTION 'ليس لديك صلاحية تسجيل مواقع المندوبين.';
    END IF;
  END IF;

  v_event_type := COALESCE(NULLIF(trim(p_payload->>'event_type'), ''), 'ping');
  IF v_event_type NOT IN ('shift_start', 'ping', 'delivery_attempt', 'pickup_stop', 'shift_end') THEN
    RAISE EXCEPTION 'نوع حدث الموقع غير صالح.';
  END IF;

  v_lat := (p_payload->>'lat')::numeric(9, 6);
  v_lng := (p_payload->>'lng')::numeric(9, 6);
  IF v_lat IS NULL OR v_lng IS NULL OR v_lat < -90 OR v_lat > 90 OR v_lng < -180 OR v_lng > 180 THEN
    RAISE EXCEPTION 'إحداثيات خط العرض/الطول غير صالحة.';
  END IF;

  v_accuracy := NULLIF(trim(COALESCE(p_payload->>'accuracy_meters', '')), '')::numeric(8, 2);
  v_speed := NULLIF(trim(COALESCE(p_payload->>'speed_mps', '')), '')::numeric(8, 2);
  v_heading := NULLIF(trim(COALESCE(p_payload->>'heading_deg', '')), '')::numeric(6, 2);
  v_source := COALESCE(NULLIF(trim(p_payload->>'source'), ''), 'gps_browser');
  IF v_source NOT IN ('gps_browser', 'device_sdk', 'manual_pin', 'delivery_pod') THEN
    v_source := 'gps_browser';
  END IF;

  v_shipment_id := NULLIF(trim(COALESCE(p_payload->>'shipment_id', '')), '')::uuid;
  IF v_shipment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.shipments s WHERE s.tenant_id = p_tenant_id AND s.id = v_shipment_id
  ) THEN
    RAISE EXCEPTION 'الشحنة المرتبطة بنقطة الموقع غير موجودة في هذه الشركة.';
  END IF;

  v_delivery_list_id := NULLIF(trim(COALESCE(p_payload->>'delivery_list_id', '')), '')::uuid;
  IF v_delivery_list_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.delivery_lists dl WHERE dl.tenant_id = p_tenant_id AND dl.id = v_delivery_list_id
  ) THEN
    RAISE EXCEPTION 'قائمة التوصيل المرتبطة غير موجودة في هذه الشركة.';
  END IF;

  v_device_fp := NULLIF(trim(COALESCE(p_payload->>'device_fingerprint', '')), '');
  IF v_device_fp IS NOT NULL THEN
    v_device_label := COALESCE(NULLIF(trim(COALESCE(p_payload->>'device_label', '')), ''), 'متصفح المندوب');
    v_platform := COALESCE(NULLIF(trim(COALESCE(p_payload->>'platform', '')), ''), 'web_browser');
    IF v_platform NOT IN ('web_browser', 'android_pwa', 'ios_pwa', 'external_gps') THEN
      v_platform := 'web_browser';
    END IF;

    INSERT INTO public.courier_devices (
      tenant_id, courier_id, device_fingerprint, device_label, platform, last_seen_at
    )
    VALUES (
      p_tenant_id, v_courier_id, left(v_device_fp, 128), left(v_device_label, 120), v_platform, v_recorded_at
    )
    ON CONFLICT (tenant_id, courier_id, device_fingerprint) DO UPDATE
      SET device_label = EXCLUDED.device_label,
          last_seen_at = v_recorded_at,
          is_active = true
    RETURNING id INTO v_device_id;
  END IF;

  SELECT COALESCE(ts.location_retention_days, 90)
  INTO v_retention_days
  FROM public.tenant_settings ts
  WHERE ts.tenant_id = p_tenant_id;

  v_notes := NULLIF(trim(COALESCE(p_payload->>'notes', '')), '');

  INSERT INTO public.courier_location_events (
    tenant_id, courier_id, device_id, shipment_id, delivery_list_id,
    event_type, lat, lng, accuracy_meters, speed_mps, heading_deg,
    source, notes, recorded_by, recorded_at, expires_at
  )
  VALUES (
    p_tenant_id, v_courier_id, v_device_id, v_shipment_id, v_delivery_list_id,
    v_event_type, v_lat, v_lng, v_accuracy, v_speed, v_heading,
    v_source, v_notes, auth.uid(), v_recorded_at, v_recorded_at + make_interval(days => COALESCE(v_retention_days, 90))
  )
  RETURNING id INTO v_event_id;

  IF v_event_type IN ('shift_start', 'shift_end', 'delivery_attempt') THEN
    INSERT INTO audit.audit_logs (
      tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
    )
    VALUES (
      p_tenant_id,
      auth.uid(),
      'courier_location_milestone_recorded',
      'courier_location_event',
      v_event_id,
      jsonb_build_object(
        'courier_id', v_courier_id,
        'event_type', v_event_type,
        'lat', v_lat,
        'lng', v_lng,
        'accuracy_meters', v_accuracy,
        'source', v_source,
        'shipment_id', v_shipment_id
      ),
      'server'
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_event_id,
    'tenant_id', p_tenant_id,
    'courier_id', v_courier_id,
    'device_id', v_device_id,
    'shipment_id', v_shipment_id,
    'delivery_list_id', v_delivery_list_id,
    'event_type', v_event_type,
    'lat', v_lat,
    'lng', v_lng,
    'accuracy_meters', v_accuracy,
    'source', v_source,
    'recorded_at', v_recorded_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_courier_location_event(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_courier_location_event(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_live_couriers_positions(
  p_tenant_id uuid,
  p_branch_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_bound_courier uuid;
  v_positions jsonb := '[]'::jsonb;
BEGIN
  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'غير مصرح بالوصول إلى بيانات هذه الشركة.';
  END IF;

  v_bound_courier := app_private.user_get_bound_courier_id(p_tenant_id);

  IF v_bound_courier IS NULL THEN
    IF NOT (
      app_private.user_is_tenant_admin(p_tenant_id)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'couriers.locations_read', p_branch_id)
      OR app_private.user_is_staff_with_permission(p_tenant_id, 'couriers.read', p_branch_id)
    ) THEN
      RAISE EXCEPTION 'غير مصرح بعرض الخريطة الحية لمواقع المندوبين.';
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(row_obj ORDER BY row_obj->>'last_recorded_at' DESC NULLS LAST, row_obj->>'courier_code'), '[]'::jsonb)
  INTO v_positions
  FROM (
    SELECT jsonb_build_object(
      'courier_id', c.id,
      'courier_code', c.code,
      'courier_name', c.name,
      'courier_mobile', c.mobile,
      'branch_id', c.branch_id,
      'branch_name', b.name,
      'is_active', c.is_active,
      'last_event_id', le.id,
      'event_type', le.event_type,
      'lat', le.lat,
      'lng', le.lng,
      'accuracy_meters', le.accuracy_meters,
      'speed_mps', le.speed_mps,
      'heading_deg', le.heading_deg,
      'source', le.source,
      'last_recorded_at', le.recorded_at,
      'last_shipment_id', le.shipment_id,
      'last_shipment_number', shp.shipment_number,
      'active_shipments_count', (
        SELECT count(*)
        FROM public.shipments s
        WHERE s.tenant_id = p_tenant_id
          AND s.assigned_courier_id = c.id
          AND s.operational_status IN ('out_for_delivery', 'pickup_scheduled')
      ),
      'today_events_count', (
        SELECT count(*)
        FROM public.courier_location_events ev
        WHERE ev.tenant_id = p_tenant_id
          AND ev.courier_id = c.id
          AND ev.recorded_at >= date_trunc('day', now())
      )
    ) AS row_obj
    FROM public.couriers c
    LEFT JOIN public.branches b
      ON b.tenant_id = c.tenant_id AND b.id = c.branch_id
    LEFT JOIN LATERAL (
      SELECT e.*
      FROM public.courier_location_events e
      WHERE e.tenant_id = p_tenant_id
        AND e.courier_id = c.id
      ORDER BY e.recorded_at DESC
      LIMIT 1
    ) le ON true
    LEFT JOIN public.shipments shp
      ON shp.tenant_id = p_tenant_id AND shp.id = le.shipment_id
    WHERE c.tenant_id = p_tenant_id
      AND c.archived_at IS NULL
      AND (p_branch_id IS NULL OR c.branch_id = p_branch_id)
      AND (
        v_bound_courier IS NULL
        OR c.id = v_bound_courier
      )
      AND (
        app_private.user_is_tenant_admin(p_tenant_id)
        OR v_bound_courier = c.id
        OR app_private.user_is_staff_with_permission(p_tenant_id, 'couriers.locations_read', c.branch_id)
        OR app_private.user_is_staff_with_permission(p_tenant_id, 'couriers.read', c.branch_id)
      )
  ) sub;

  RETURN v_positions;
END;
$$;

REVOKE ALL ON FUNCTION public.get_live_couriers_positions(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_live_couriers_positions(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_courier_movements_timeline(
  p_tenant_id uuid,
  p_courier_id uuid,
  p_date_from date DEFAULT CURRENT_DATE,
  p_date_to date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_courier record;
  v_from date := COALESCE(p_date_from, CURRENT_DATE);
  v_to date := COALESCE(p_date_to, CURRENT_DATE);
  v_events jsonb := '[]'::jsonb;
  v_active_shipments jsonb := '[]'::jsonb;
BEGIN
  IF p_courier_id IS NULL THEN
    RAISE EXCEPTION 'معرف المندوب مطلوب لعرض خط السير.';
  END IF;

  IF NOT app_private.user_can_read_courier_locations(p_tenant_id, p_courier_id) THEN
    RAISE EXCEPTION 'غير مصرح باستعراض تحركات هذا المندوب.';
  END IF;

  SELECT c.id, c.code, c.name, c.mobile, c.branch_id, b.name AS branch_name, c.is_active
  INTO v_courier
  FROM public.couriers c
  LEFT JOIN public.branches b ON b.tenant_id = c.tenant_id AND b.id = c.branch_id
  WHERE c.tenant_id = p_tenant_id
    AND c.id = p_courier_id
    AND c.archived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'المندوب غير موجود ضمن هذه الشركة.';
  END IF;

  SELECT COALESCE(jsonb_agg(ev_obj ORDER BY ev_obj->>'recorded_at' ASC), '[]'::jsonb)
  INTO v_events
  FROM (
    SELECT jsonb_build_object(
      'id', e.id,
      'tenant_id', e.tenant_id,
      'courier_id', e.courier_id,
      'device_id', e.device_id,
      'shipment_id', e.shipment_id,
      'shipment_number', s.shipment_number,
      'shipment_status', s.operational_status,
      'recipient_name', rp.name,
      'recipient_address', rp.address_line,
      'delivery_list_id', e.delivery_list_id,
      'delivery_list_code', dl.list_code,
      'event_type', e.event_type,
      'lat', e.lat,
      'lng', e.lng,
      'accuracy_meters', e.accuracy_meters,
      'speed_mps', e.speed_mps,
      'heading_deg', e.heading_deg,
      'source', e.source,
      'notes', e.notes,
      'recorded_at', e.recorded_at
    ) AS ev_obj
    FROM public.courier_location_events e
    LEFT JOIN public.shipments s
      ON s.tenant_id = e.tenant_id AND s.id = e.shipment_id
    LEFT JOIN public.shipment_parties rp
      ON rp.tenant_id = e.tenant_id AND rp.shipment_id = e.shipment_id AND rp.party_type = 'recipient'
    LEFT JOIN public.delivery_lists dl
      ON dl.tenant_id = e.tenant_id AND dl.id = e.delivery_list_id
    WHERE e.tenant_id = p_tenant_id
      AND e.courier_id = p_courier_id
      AND e.recorded_at >= v_from::timestamptz
      AND e.recorded_at < (v_to + 1)::timestamptz
    ORDER BY e.recorded_at ASC
    LIMIT 500
  ) sub;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'shipment_number', s.shipment_number,
    'operational_status', s.operational_status,
    'recipient_name', rp.name,
    'recipient_address', rp.address_line,
    'recipient_collect_amount', s.recipient_collect_amount
  ) ORDER BY s.updated_at DESC), '[]'::jsonb)
  INTO v_active_shipments
  FROM public.shipments s
  LEFT JOIN public.shipment_parties rp
    ON rp.tenant_id = s.tenant_id AND rp.shipment_id = s.id AND rp.party_type = 'recipient'
  WHERE s.tenant_id = p_tenant_id
    AND s.assigned_courier_id = p_courier_id
    AND s.operational_status IN ('out_for_delivery', 'pickup_scheduled', 'rescheduled');

  RETURN jsonb_build_object(
    'courier', jsonb_build_object(
      'id', v_courier.id,
      'code', v_courier.code,
      'name', v_courier.name,
      'mobile', v_courier.mobile,
      'branch_id', v_courier.branch_id,
      'branch_name', v_courier.branch_name,
      'is_active', v_courier.is_active
    ),
    'date_from', v_from,
    'date_to', v_to,
    'events', v_events,
    'active_shipments', v_active_shipments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_courier_movements_timeline(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_courier_movements_timeline(uuid, uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.purge_expired_courier_locations(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  IF NOT app_private.user_is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'حذف سجلات المواقع المنتهية الصلاحية مقتصر على إدارة الشركة.';
  END IF;

  DELETE FROM public.courier_location_events
  WHERE tenant_id = p_tenant_id
    AND expires_at < now();

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted > 0 THEN
    INSERT INTO audit.audit_logs (
      tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
    )
    VALUES (
      p_tenant_id,
      auth.uid(),
      'expired_courier_locations_purged',
      'courier_location_events',
      p_tenant_id,
      jsonb_build_object('deleted_count', v_deleted),
      'server'
    );
  END IF;

  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_courier_locations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_expired_courier_locations(uuid) TO authenticated;
