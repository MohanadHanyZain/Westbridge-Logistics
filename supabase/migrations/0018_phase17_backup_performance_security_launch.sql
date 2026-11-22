-- ============================================================================
-- Migration 0018: Phase 17 - Backup Policies, Restore Drills, Composite
--                 Performance Indexes, Security Audit & Launch Readiness (ADR-025)
-- ============================================================================
-- Implements ADR-025 & MASTER_SPEC Sections 02 / 06 / Definition of Done:
-- 1. Composite performance indexes for high-traffic shipment, ledger,
--    notification, and audit log queries.
-- 2. `public.backup_policies` (DEFAULT policy seeded: RPO <= 15m PITR,
--    RTO <= 60m DB, <= 120m Storage, 30d retention, 30d restore drill cadence).
-- 3. `public.backup_restore_drills` tracking isolated restore tests & verifications.
-- 4. Strict `FORCE ROW LEVEL SECURITY` + platform-admin-only visibility.
-- 5. Live PostgreSQL catalog security & launch readiness RPCs:
--    - `public.get_launch_readiness_overview()`
--    - `public.update_backup_policy(jsonb)`
--    - `public.record_backup_restore_drill(jsonb)`
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Composite Performance Indexes (Idempotent)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_shipments_tenant_created_at_desc
  ON public.shipments (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shipments_tenant_client_status
  ON public.shipments (tenant_id, client_id, operational_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shipments_tenant_pickup_date
  ON public.shipments (tenant_id, pickup_date DESC, current_branch_id);

CREATE INDEX IF NOT EXISTS idx_sse_tenant_created_at_desc
  ON public.shipment_status_events (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_journal_entries_tenant_status_date
  ON public.journal_entries (tenant_id, status, entry_date DESC);

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_tenant_account
  ON public.journal_entry_lines (tenant_id, account_id, entry_id);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant_created_at
  ON public.notifications (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_lookup
  ON audit.audit_logs (entity_type, entity_id, created_at DESC)
  WHERE entity_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Backup Policies & Restore Drills Tables
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.backup_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code text NOT NULL UNIQUE DEFAULT 'DEFAULT' CHECK (policy_code = 'DEFAULT'),
  rpo_minutes integer NOT NULL DEFAULT 15 CHECK (rpo_minutes BETWEEN 1 AND 1440),
  rto_minutes integer NOT NULL DEFAULT 60 CHECK (rto_minutes BETWEEN 5 AND 1440),
  storage_rto_minutes integer NOT NULL DEFAULT 120 CHECK (storage_rto_minutes BETWEEN 5 AND 2880),
  retention_days integer NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 7 AND 365),
  pitr_enabled boolean NOT NULL DEFAULT true,
  daily_snapshot_enabled boolean NOT NULL DEFAULT true,
  storage_sync_enabled boolean NOT NULL DEFAULT true,
  drill_cadence_days integer NOT NULL DEFAULT 30 CHECK (drill_cadence_days BETWEEN 7 AND 90),
  last_verified_drill_at timestamptz,
  notes text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_backup_policies_updated_at ON public.backup_policies;
CREATE TRIGGER trg_backup_policies_updated_at
  BEFORE UPDATE ON public.backup_policies
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

INSERT INTO public.backup_policies (
  policy_code,
  rpo_minutes,
  rto_minutes,
  storage_rto_minutes,
  retention_days,
  pitr_enabled,
  daily_snapshot_enabled,
  storage_sync_enabled,
  drill_cadence_days,
  notes
)
VALUES (
  'DEFAULT',
  15,
  60,
  120,
  30,
  true,
  true,
  true,
  30,
  'سياسة الإنتاج المعتمدة وفق ADR-025: تفعيل PITR بفاصل RPO <= 15 دقيقة واحتفاظ 30 يومًا ومزامنة حاويات Storage.'
)
ON CONFLICT (policy_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.backup_restore_drills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL CHECK (environment IN ('staging', 'isolated_clone', 'production_readonly')),
  backup_point_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  rto_achieved_minutes integer NOT NULL CHECK (rto_achieved_minutes BETWEEN 1 AND 10080),
  storage_verified boolean NOT NULL DEFAULT false,
  rls_verified boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('passed', 'failed', 'scheduled')),
  notes text,
  executed_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_backup_restore_drills_window CHECK (completed_at IS NULL OR completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_backup_restore_drills_created
  ON public.backup_restore_drills (created_at DESC);

-- ----------------------------------------------------------------------------
-- 3. Strict FORCE ROW LEVEL SECURITY & Least-Privilege Grants
-- ----------------------------------------------------------------------------
ALTER TABLE public.backup_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_policies FORCE ROW LEVEL SECURITY;

ALTER TABLE public.backup_restore_drills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_restore_drills FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.backup_policies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.backup_restore_drills FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.backup_policies TO authenticated;
GRANT SELECT ON public.backup_restore_drills TO authenticated;

DROP POLICY IF EXISTS p_backup_policies_platform_select ON public.backup_policies;
CREATE POLICY p_backup_policies_platform_select
  ON public.backup_policies
  FOR SELECT
  TO authenticated
  USING (app_private.current_user_is_platform_admin());

DROP POLICY IF EXISTS p_backup_restore_drills_platform_select ON public.backup_restore_drills;
CREATE POLICY p_backup_restore_drills_platform_select
  ON public.backup_restore_drills
  FOR SELECT
  TO authenticated
  USING (app_private.current_user_is_platform_admin());

-- ----------------------------------------------------------------------------
-- 4. Live Security Catalog Audit & Launch Readiness RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_launch_readiness_overview()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit, information_schema
AS $$
DECLARE
  v_policy public.backup_policies%ROWTYPE;
  v_drills jsonb;
  v_total_tables integer := 0;
  v_rls_enabled_count integer := 0;
  v_rls_forced_count integer := 0;
  v_unprotected_tables jsonb := '[]'::jsonb;
  v_unprotected_count integer := 0;
  v_password_columns_count integer := 0;
  v_token_hash_exposed boolean := false;
  v_app_private_exposed boolean := false;
  v_audit_schema_exposed boolean := false;
  v_private_buckets_count integer := 0;
  v_public_exposed_buckets_count integer := 0;
  v_performance_indexes_count integer := 0;
  v_passed_drills_count integer := 0;
  v_total_tenants integer := 0;
  v_active_tenants integer := 0;
  v_active_plans integer := 0;
  v_active_api_tokens integer := 0;
  v_active_webhooks integer := 0;
  v_pending_webhooks integer := 0;
  v_total_shipments integer := 0;
  v_ready_for_launch boolean := false;
BEGIN
  IF NOT app_private.current_user_is_platform_admin() THEN
    RAISE EXCEPTION 'Forbidden: platform admin access required';
  END IF;

  SELECT * INTO v_policy
  FROM public.backup_policies
  WHERE policy_code = 'DEFAULT'
  LIMIT 1;

  IF v_policy.id IS NULL THEN
    INSERT INTO public.backup_policies (policy_code)
    VALUES ('DEFAULT')
    ON CONFLICT (policy_code) DO NOTHING;

    SELECT * INTO v_policy
    FROM public.backup_policies
    WHERE policy_code = 'DEFAULT'
    LIMIT 1;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(d.*) ORDER BY d.created_at DESC), '[]'::jsonb)
  INTO v_drills
  FROM (
    SELECT
      id,
      environment,
      backup_point_at,
      started_at,
      completed_at,
      rto_achieved_minutes,
      storage_verified,
      rls_verified,
      status,
      notes,
      executed_by,
      created_at
    FROM public.backup_restore_drills
    ORDER BY created_at DESC
    LIMIT 25
  ) d;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE c.relrowsecurity)::integer,
    count(*) FILTER (WHERE c.relrowsecurity AND c.relforcerowsecurity)::integer,
    COALESCE(
      jsonb_agg(c.relname ORDER BY c.relname)
        FILTER (WHERE NOT (c.relrowsecurity AND c.relforcerowsecurity)),
      '[]'::jsonb
    ),
    count(*) FILTER (WHERE NOT (c.relrowsecurity AND c.relforcerowsecurity))::integer
  INTO
    v_total_tables,
    v_rls_enabled_count,
    v_rls_forced_count,
    v_unprotected_tables,
    v_unprotected_count
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p');

  SELECT count(*)::integer
  INTO v_password_columns_count
  FROM information_schema.columns col
  WHERE col.table_schema = 'public'
    AND col.column_name ~* '(^|_)(password|pass_hash|passwd)(_|$)';

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.role_column_grants rcg
    WHERE rcg.grantee IN ('anon', 'authenticated', 'PUBLIC')
      AND rcg.table_schema = 'public'
      AND rcg.table_name = 'api_tokens'
      AND rcg.column_name = 'token_hash'
      AND rcg.privilege_type = 'SELECT'
  ) INTO v_token_hash_exposed;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants rtg
    WHERE rtg.grantee IN ('anon', 'authenticated', 'PUBLIC')
      AND rtg.table_schema = 'app_private'
  ) INTO v_app_private_exposed;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.role_table_grants rtg
    WHERE rtg.grantee IN ('anon', 'authenticated', 'PUBLIC')
      AND rtg.table_schema = 'audit'
  ) INTO v_audit_schema_exposed;

  IF to_regclass('storage.buckets') IS NOT NULL THEN
    SELECT
      count(*) FILTER (
        WHERE b.id IN ('shipment-attachments', 'message-attachments', 'delivery-proof')
          AND b.public = false
      )::integer,
      count(*) FILTER (
        WHERE b.id IN ('shipment-attachments', 'message-attachments', 'delivery-proof')
          AND b.public = true
      )::integer
    INTO v_private_buckets_count, v_public_exposed_buckets_count
    FROM storage.buckets b;
  END IF;

  SELECT count(*)::integer
  INTO v_performance_indexes_count
  FROM pg_catalog.pg_indexes idx
  WHERE idx.schemaname IN ('public', 'audit')
    AND idx.indexname LIKE 'idx_%';

  SELECT count(*)::integer
  INTO v_passed_drills_count
  FROM public.backup_restore_drills
  WHERE status = 'passed';

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE status = 'active')::integer
  INTO v_total_tenants, v_active_tenants
  FROM public.tenants;

  SELECT count(*)::integer INTO v_active_plans
  FROM public.subscription_plans
  WHERE is_active = true;

  SELECT count(*)::integer INTO v_active_api_tokens
  FROM public.api_tokens
  WHERE is_active = true AND revoked_at IS NULL;

  SELECT count(*)::integer INTO v_active_webhooks
  FROM public.webhook_endpoints
  WHERE is_active = true;

  SELECT count(*)::integer INTO v_pending_webhooks
  FROM public.webhook_deliveries
  WHERE status IN ('pending', 'retrying');

  SELECT count(*)::integer INTO v_total_shipments
  FROM public.shipments;

  v_ready_for_launch := (
    v_unprotected_count = 0
    AND v_password_columns_count = 0
    AND NOT v_token_hash_exposed
    AND NOT v_app_private_exposed
    AND NOT v_audit_schema_exposed
    AND v_public_exposed_buckets_count = 0
    AND COALESCE(v_policy.pitr_enabled, false)
    AND v_passed_drills_count >= 1
  );

  RETURN jsonb_build_object(
    'policy', to_jsonb(v_policy),
    'drills', v_drills,
    'security_audit', jsonb_build_object(
      'checked_at', now(),
      'total_public_tables', v_total_tables,
      'rls_enabled_count', v_rls_enabled_count,
      'rls_forced_count', v_rls_forced_count,
      'unprotected_tables_count', v_unprotected_count,
      'unprotected_tables', v_unprotected_tables,
      'password_columns_count', v_password_columns_count,
      'token_hash_exposed', v_token_hash_exposed,
      'app_private_exposed', v_app_private_exposed,
      'audit_schema_exposed', v_audit_schema_exposed,
      'private_storage_buckets_count', v_private_buckets_count,
      'public_exposed_buckets_count', v_public_exposed_buckets_count,
      'performance_indexes_count', v_performance_indexes_count
    ),
    'operational_metrics', jsonb_build_object(
      'total_tenants', v_total_tenants,
      'active_tenants', v_active_tenants,
      'active_plans', v_active_plans,
      'active_api_tokens', v_active_api_tokens,
      'active_webhooks', v_active_webhooks,
      'pending_webhooks', v_pending_webhooks,
      'total_shipments', v_total_shipments,
      'passed_drills_count', v_passed_drills_count
    ),
    'ready_for_launch', v_ready_for_launch
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_backup_policy(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_before public.backup_policies%ROWTYPE;
  v_after public.backup_policies%ROWTYPE;
  v_rpo integer;
  v_rto integer;
  v_storage_rto integer;
  v_retention integer;
  v_cadence integer;
  v_pitr boolean;
  v_daily boolean;
  v_storage_sync boolean;
  v_notes text;
BEGIN
  IF NOT app_private.current_user_is_platform_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: platform super admin required';
  END IF;

  SELECT * INTO v_before
  FROM public.backup_policies
  WHERE policy_code = 'DEFAULT'
  FOR UPDATE;

  IF v_before.id IS NULL THEN
    INSERT INTO public.backup_policies (policy_code)
    VALUES ('DEFAULT')
    RETURNING * INTO v_before;
  END IF;

  v_rpo := COALESCE((p_payload->>'rpo_minutes')::integer, v_before.rpo_minutes);
  v_rto := COALESCE((p_payload->>'rto_minutes')::integer, v_before.rto_minutes);
  v_storage_rto := COALESCE((p_payload->>'storage_rto_minutes')::integer, v_before.storage_rto_minutes);
  v_retention := COALESCE((p_payload->>'retention_days')::integer, v_before.retention_days);
  v_cadence := COALESCE((p_payload->>'drill_cadence_days')::integer, v_before.drill_cadence_days);
  v_pitr := COALESCE((p_payload->>'pitr_enabled')::boolean, v_before.pitr_enabled);
  v_daily := COALESCE((p_payload->>'daily_snapshot_enabled')::boolean, v_before.daily_snapshot_enabled);
  v_storage_sync := COALESCE((p_payload->>'storage_sync_enabled')::boolean, v_before.storage_sync_enabled);
  v_notes := CASE
    WHEN p_payload ? 'notes' THEN NULLIF(trim(p_payload->>'notes'), '')
    ELSE v_before.notes
  END;

  IF v_rpo < 1 OR v_rpo > 1440 THEN
    RAISE EXCEPTION 'Invalid rpo_minutes: must be between 1 and 1440';
  END IF;
  IF v_rto < 5 OR v_rto > 1440 THEN
    RAISE EXCEPTION 'Invalid rto_minutes: must be between 5 and 1440';
  END IF;
  IF v_storage_rto < 5 OR v_storage_rto > 2880 THEN
    RAISE EXCEPTION 'Invalid storage_rto_minutes: must be between 5 and 2880';
  END IF;
  IF v_retention < 7 OR v_retention > 365 THEN
    RAISE EXCEPTION 'Invalid retention_days: must be between 7 and 365';
  END IF;
  IF v_cadence < 7 OR v_cadence > 90 THEN
    RAISE EXCEPTION 'Invalid drill_cadence_days: must be between 7 and 90';
  END IF;

  UPDATE public.backup_policies
  SET
    rpo_minutes = v_rpo,
    rto_minutes = v_rto,
    storage_rto_minutes = v_storage_rto,
    retention_days = v_retention,
    pitr_enabled = v_pitr,
    daily_snapshot_enabled = v_daily,
    storage_sync_enabled = v_storage_sync,
    drill_cadence_days = v_cadence,
    notes = v_notes,
    updated_by = v_actor
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  INSERT INTO audit.audit_logs (
    tenant_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    source
  )
  VALUES (
    NULL,
    v_actor,
    'backup_policy.updated',
    'backup_policy',
    v_after.id,
    to_jsonb(v_before),
    to_jsonb(v_after),
    'server'
  );

  RETURN to_jsonb(v_after);
END;
$$;

CREATE OR REPLACE FUNCTION public.record_backup_restore_drill(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_environment text;
  v_backup_point_at timestamptz;
  v_started_at timestamptz;
  v_completed_at timestamptz;
  v_rto_achieved integer;
  v_storage_verified boolean;
  v_rls_verified boolean;
  v_status text;
  v_notes text;
  v_row public.backup_restore_drills%ROWTYPE;
BEGIN
  IF NOT app_private.current_user_is_platform_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: platform super admin required';
  END IF;

  v_environment := COALESCE(NULLIF(trim(p_payload->>'environment'), ''), 'staging');
  IF v_environment NOT IN ('staging', 'isolated_clone', 'production_readonly') THEN
    RAISE EXCEPTION 'Invalid environment: %', v_environment;
  END IF;

  v_status := COALESCE(NULLIF(trim(p_payload->>'status'), ''), 'passed');
  IF v_status NOT IN ('passed', 'failed', 'scheduled') THEN
    RAISE EXCEPTION 'Invalid drill status: %', v_status;
  END IF;

  v_rto_achieved := COALESCE((p_payload->>'rto_achieved_minutes')::integer, 0);
  IF v_rto_achieved < 1 OR v_rto_achieved > 10080 THEN
    RAISE EXCEPTION 'Invalid rto_achieved_minutes: must be between 1 and 10080';
  END IF;

  v_backup_point_at := COALESCE((p_payload->>'backup_point_at')::timestamptz, now() - interval '15 minutes');
  v_started_at := COALESCE((p_payload->>'started_at')::timestamptz, now() - make_interval(mins => v_rto_achieved));
  v_completed_at := CASE
    WHEN v_status = 'scheduled' THEN NULL
    ELSE COALESCE((p_payload->>'completed_at')::timestamptz, now())
  END;

  IF v_completed_at IS NOT NULL AND v_completed_at < v_started_at THEN
    RAISE EXCEPTION 'completed_at cannot precede started_at';
  END IF;

  v_storage_verified := COALESCE((p_payload->>'storage_verified')::boolean, false);
  v_rls_verified := COALESCE((p_payload->>'rls_verified')::boolean, false);
  v_notes := NULLIF(trim(COALESCE(p_payload->>'notes', '')), '');

  INSERT INTO public.backup_restore_drills (
    environment,
    backup_point_at,
    started_at,
    completed_at,
    rto_achieved_minutes,
    storage_verified,
    rls_verified,
    status,
    notes,
    executed_by
  )
  VALUES (
    v_environment,
    v_backup_point_at,
    v_started_at,
    v_completed_at,
    v_rto_achieved,
    v_storage_verified,
    v_rls_verified,
    v_status,
    v_notes,
    v_actor
  )
  RETURNING * INTO v_row;

  IF v_status = 'passed' THEN
    UPDATE public.backup_policies
    SET
      last_verified_drill_at = COALESCE(v_completed_at, now()),
      updated_by = v_actor
    WHERE policy_code = 'DEFAULT';
  END IF;

  INSERT INTO audit.audit_logs (
    tenant_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    source
  )
  VALUES (
    NULL,
    v_actor,
    'backup_restore_drill.recorded',
    'backup_restore_drill',
    v_row.id,
    NULL,
    to_jsonb(v_row),
    'server'
  );

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.get_launch_readiness_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_launch_readiness_overview() TO authenticated;

REVOKE ALL ON FUNCTION public.update_backup_policy(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_backup_policy(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.record_backup_restore_drill(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_backup_restore_drill(jsonb) TO authenticated;
