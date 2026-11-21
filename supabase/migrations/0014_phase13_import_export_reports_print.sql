-- ============================================================================
-- Migration 0014: Phase 13 - Excel/CSV Bulk Import, Safe Exports, Printing & Reports
-- ============================================================================
-- Implements ADR-021 & MASTER_SPEC Sections 03 / 08 / 12 / 14:
-- 1. Add Phase 13 permissions ('shipments.import', 'reports.read', 'reports.export')
--    and backfill role_permissions cleanly across existing tenants.
-- 2. Create versioned import templates catalog (`import_templates` with `SHIPMENTS_V1`),
--    batch tracking (`import_jobs`, `import_job_rows`), and export/print audit
--    (`export_jobs`).
-- 3. Enable & FORCE ROW LEVEL SECURITY across all Phase 13 tables with strict
--    tenant, client-binding, and creator isolation.
-- 4. Server-side RPCs:
--    - `get_shipment_import_templates`: ensures & lists versioned templates (`SHIPMENTS_V1`).
--    - `run_shipment_import_batch`: performs strict Dry-Run validation with exact
--      pricing preview OR atomic Idempotent Commit via `public.create_shipment`.
--    - `list_import_jobs` & `get_import_job_detail`: batch audit history & error rows.
--    - `record_export_job`: audits CSV/Excel exports and print jobs.
--    - `get_executive_operations_report`: server-side operational, SLA, financial,
--      branch, governorate, client, and courier analytics scoped by RLS/role.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Phase 13 Permissions Catalog & Role Backfill
-- ----------------------------------------------------------------------------
ALTER TABLE public.permissions
  DROP CONSTRAINT IF EXISTS permissions_module_check;

ALTER TABLE public.permissions
  ADD CONSTRAINT permissions_module_check
    CHECK (module IN (
      'dashboard', 'definitions', 'clients', 'pricing', 'couriers',
      'shipments', 'operations', 'finance', 'accounting', 'security',
      'integrations', 'messaging', 'reports'
    ));

INSERT INTO public.permissions (key, module, label_ar, description_ar, default_scope, is_sensitive)
VALUES
  ('shipments.import', 'shipments', 'استيراد الشحنات من Excel/CSV', 'رفع قوالب الشحنات المجمعة وتنفيذ الفحص المسبق والاعتماد.', 'branch', false),
  ('reports.read', 'reports', 'عرض التقارير التنفيذية والتحليلية', 'استعراض مؤشرات التشغيل، الالتزام بالوقت، التحصيلات، وأداء المناديب والعملاء.', 'tenant', false),
  ('reports.export', 'reports', 'تصدير التقارير والبيانات وطباعة البوالص', 'تصدير ملفات CSV/Excel المحمية وطباعة البوالص والملصقات.', 'branch', false)
ON CONFLICT (key) DO UPDATE
  SET module = EXCLUDED.module,
      label_ar = EXCLUDED.label_ar,
      description_ar = EXCLUDED.description_ar,
      default_scope = EXCLUDED.default_scope,
      is_sensitive = EXCLUDED.is_sensitive;

INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, scope)
SELECT r.tenant_id, r.id, p.key,
  CASE
    WHEN r.code IN ('company_owner', 'company_admin') THEN 'tenant'
    WHEN r.code IN ('client_owner', 'client_staff') THEN 'own'
    WHEN r.code IN ('branch_manager', 'warehouse_operator') THEN 'branch'
    ELSE p.default_scope
  END
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.key IN ('shipments.import', 'reports.read', 'reports.export')
  AND (
    r.code IN ('company_owner', 'company_admin', 'operations_manager', 'accountant', 'branch_manager', 'data_entry', 'customer_support')
    OR (r.code = 'warehouse_operator' AND p.key IN ('reports.read', 'reports.export'))
    OR (r.code IN ('client_owner', 'client_staff') AND p.key IN ('shipments.import', 'reports.read', 'reports.export'))
  )
ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Phase 13 Tables: Import Templates, Import Batches, Rows & Export Audit
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  template_code text NOT NULL CHECK (template_code ~ '^[A-Z0-9_]{3,32}$'),
  entity_type text NOT NULL CHECK (entity_type IN ('shipments')),
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number >= 1),
  name_ar text NOT NULL CHECK (char_length(trim(name_ar)) >= 3),
  description_ar text,
  columns_schema jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_import_templates_tenant_code UNIQUE (tenant_id, template_code)
);

DROP TRIGGER IF EXISTS trg_import_templates_updated_at ON public.import_templates;
CREATE TRIGGER trg_import_templates_updated_at
  BEFORE UPDATE ON public.import_templates
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE IF NOT EXISTS public.import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  template_code text NOT NULL CHECK (template_code ~ '^[A-Z0-9_]{3,32}$'),
  file_name text NOT NULL CHECK (char_length(trim(file_name)) >= 1),
  batch_idempotency_key text,
  mode text NOT NULL CHECK (mode IN ('dry_run', 'commit')),
  status text NOT NULL CHECK (status IN ('validated', 'failed', 'completed', 'partial')),
  default_client_id uuid,
  default_branch_id uuid,
  total_rows integer NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  valid_rows integer NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
  error_rows integer NOT NULL DEFAULT 0 CHECK (error_rows >= 0),
  created_shipments_count integer NOT NULL DEFAULT 0 CHECK (created_shipments_count >= 0),
  summary_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_import_jobs_tenant_id_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_import_jobs_client FOREIGN KEY (tenant_id, default_client_id) REFERENCES public.clients(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_import_jobs_branch FOREIGN KEY (tenant_id, default_branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_jobs_commit_idempotency
  ON public.import_jobs (tenant_id, batch_idempotency_key)
  WHERE mode = 'commit' AND status IN ('completed', 'partial') AND batch_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_import_jobs_tenant_recent
  ON public.import_jobs (tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_import_jobs_updated_at ON public.import_jobs;
CREATE TRIGGER trg_import_jobs_updated_at
  BEFORE UPDATE ON public.import_jobs
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE TABLE IF NOT EXISTS public.import_job_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  job_id uuid NOT NULL,
  row_number integer NOT NULL CHECK (row_number >= 1),
  status text NOT NULL CHECK (status IN ('valid', 'error', 'created', 'skipped')),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimated_shipping_fee numeric(12,2),
  estimated_collect_amount numeric(14,2),
  shipment_id uuid,
  shipment_number text,
  barcode_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_import_job_rows_job_row UNIQUE (tenant_id, job_id, row_number),
  CONSTRAINT fk_ijr_job FOREIGN KEY (tenant_id, job_id) REFERENCES public.import_jobs(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_ijr_shipment FOREIGN KEY (tenant_id, shipment_id) REFERENCES public.shipments(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_import_job_rows_job
  ON public.import_job_rows (tenant_id, job_id, row_number);

CREATE TABLE IF NOT EXISTS public.export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  export_type text NOT NULL CHECK (
    export_type IN (
      'shipments_csv',
      'shipments_excel',
      'waybill_print',
      'executive_report_csv',
      'executive_report_print'
    )
  ),
  format text NOT NULL CHECK (format IN ('csv', 'xlsx_tsv', 'print_a4', 'print_label')),
  filters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_tenant_recent
  ON public.export_jobs (tenant_id, created_at DESC);

-- Helper to seed default SHIPMENTS_V1 template for any tenant
CREATE OR REPLACE FUNCTION app_private.ensure_shipment_import_template_v1(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_schema jsonb := '[
    {"key":"row_number","header_ar":"رقم_السطر","required":false,"description_ar":"رقم السطر المرجعي في الملف"},
    {"key":"client_code","header_ar":"كود_العميل","required":true,"description_ar":"كود العميل أو اسمه المسجل (أو العميل الافتراضي للدفعة)"},
    {"key":"service_code","header_ar":"الخدمة","required":true,"description_ar":"كود أو اسم خدمة الشحن مثل STD"},
    {"key":"shipment_type_code","header_ar":"نوع_الطلب","required":true,"description_ar":"FDP أو PDP أو PTP أو CLC أو RTS"},
    {"key":"payment_term_code","header_ar":"نوع_الدفع","required":true,"description_ar":"COD أو PREPAID أو POSTPAID أو CASH_PAID"},
    {"key":"price_mode","header_ar":"شامل_الشحن","required":false,"description_ar":"yes إذا كان المبلغ شاملاً الشحن، وإلا no"},
    {"key":"recipient_name","header_ar":"اسم_المستلم","required":true,"description_ar":"الاسم الكامل للمستلم"},
    {"key":"recipient_mobile","header_ar":"موبايل_المستلم","required":true,"description_ar":"رقم موبايل المستلم الأساسي"},
    {"key":"recipient_phone","header_ar":"تليفون_المستلم","required":false,"description_ar":"رقم هاتف إضافي اختياري"},
    {"key":"governorate","header_ar":"المحافظة","required":true,"description_ar":"اسم أو كود محافظة الوجهة"},
    {"key":"region","header_ar":"المنطقة","required":true,"description_ar":"اسم أو كود المنطقة داخل المحافظة"},
    {"key":"recipient_address","header_ar":"العنوان","required":true,"description_ar":"العنوان التفصيلي للتسليم"},
    {"key":"weight_kg","header_ar":"الوزن_كجم","required":true,"description_ar":"الوزن بالكيلوجرام أكبر من صفر"},
    {"key":"pieces_count","header_ar":"عدد_القطع","required":true,"description_ar":"عدد الطرود أو القطع (>= 1)"},
    {"key":"cod_amount","header_ar":"مبلغ_التحصيل","required":true,"description_ar":"المبلغ المطلوب تحصيله عند الاستلام (0 أو أكثر)"},
    {"key":"package_description","header_ar":"وصف_الطرد","required":false,"description_ar":"وصف محتوى الشحنة"},
    {"key":"external_reference","header_ar":"المرجع_الخارجي","required":false,"description_ar":"رقم طلب المتجر (يُفحص لمنع التكرار)"},
    {"key":"allow_package_opening","header_ar":"فتح_الطرد","required":false,"description_ar":"yes للسماح بفتح الطرد قبل الدفع"},
    {"key":"exchange_item_description","header_ar":"وصف_الاستبدال","required":false,"description_ar":"إلزامي لنوع الطلب PTP"}
  ]'::jsonb;
BEGIN
  INSERT INTO public.import_templates (
    tenant_id, template_code, entity_type, version_number, name_ar, description_ar, columns_schema, is_active
  )
  VALUES (
    p_tenant_id,
    'SHIPMENTS_V1',
    'shipments',
    1,
    'قالب استيراد الشحنات المجمع (SHIPMENTS_V1)',
    'القالب المعتمد لرفع الشحنات من ملفات CSV/Excel مع فحص الحقول والتسعير المسبق ومنع التكرار.',
    v_schema,
    true
  )
  ON CONFLICT (tenant_id, template_code) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION app_private.ensure_shipment_import_template_v1(uuid) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_t record;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    PERFORM app_private.ensure_shipment_import_template_v1(v_t.id);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Enable & FORCE Row Level Security
-- ----------------------------------------------------------------------------
ALTER TABLE public.import_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_templates FORCE ROW LEVEL SECURITY;

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_jobs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.import_job_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_job_rows FORCE ROW LEVEL SECURITY;

ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.export_jobs FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.import_templates, public.import_jobs, public.import_job_rows, public.export_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.import_templates, public.import_jobs, public.import_job_rows, public.export_jobs TO authenticated;

DROP POLICY IF EXISTS import_templates_select_tenant ON public.import_templates;
CREATE POLICY import_templates_select_tenant
  ON public.import_templates
  FOR SELECT
  TO authenticated
  USING (app_private.user_belongs_to_tenant(tenant_id));

DROP POLICY IF EXISTS import_jobs_select_scoped ON public.import_jobs;
CREATE POLICY import_jobs_select_scoped
  ON public.import_jobs
  FOR SELECT
  TO authenticated
  USING (
    app_private.user_belongs_to_tenant(tenant_id)
    AND (
      app_private.current_user_is_platform_super_admin()
      OR app_private.user_is_tenant_admin(tenant_id)
      OR (
        EXISTS (
          SELECT 1
          FROM public.tenant_memberships tm
          WHERE tm.tenant_id = import_jobs.tenant_id
            AND tm.user_id = auth.uid()
            AND tm.is_active = true
            AND tm.account_subject_type = 'staff'
        )
        AND (
          app_private.user_has_permission(tenant_id, 'shipments.read', default_branch_id)
          OR app_private.user_has_permission(tenant_id, 'shipments.import', default_branch_id)
          OR created_by = auth.uid()
        )
      )
      OR created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS import_job_rows_select_scoped ON public.import_job_rows;
CREATE POLICY import_job_rows_select_scoped
  ON public.import_job_rows
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.import_jobs ij
      WHERE ij.id = import_job_rows.job_id
        AND ij.tenant_id = import_job_rows.tenant_id
        AND app_private.user_belongs_to_tenant(ij.tenant_id)
        AND (
          app_private.current_user_is_platform_super_admin()
          OR app_private.user_is_tenant_admin(ij.tenant_id)
          OR ij.created_by = auth.uid()
          OR (
            EXISTS (
              SELECT 1
              FROM public.tenant_memberships tm
              WHERE tm.tenant_id = ij.tenant_id
                AND tm.user_id = auth.uid()
                AND tm.is_active = true
                AND tm.account_subject_type = 'staff'
            )
            AND (
              app_private.user_has_permission(ij.tenant_id, 'shipments.read', ij.default_branch_id)
              OR app_private.user_has_permission(ij.tenant_id, 'shipments.import', ij.default_branch_id)
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS export_jobs_select_scoped ON public.export_jobs;
CREATE POLICY export_jobs_select_scoped
  ON public.export_jobs
  FOR SELECT
  TO authenticated
  USING (
    app_private.user_belongs_to_tenant(tenant_id)
    AND (
      app_private.current_user_is_platform_super_admin()
      OR app_private.user_is_tenant_admin(tenant_id)
      OR actor_user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 4. Phase 13 RPCs
-- ----------------------------------------------------------------------------

-- 4.1 Get Versioned Import Templates
CREATE OR REPLACE FUNCTION public.get_shipment_import_templates(p_tenant_id uuid)
RETURNS SETOF public.import_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Forbidden: tenant membership required';
  END IF;

  PERFORM app_private.ensure_shipment_import_template_v1(p_tenant_id);

  RETURN QUERY
  SELECT *
  FROM public.import_templates
  WHERE tenant_id = p_tenant_id
    AND is_active = true
  ORDER BY version_number DESC, template_code ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_shipment_import_templates(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shipment_import_templates(uuid) TO authenticated;

-- 4.2 Run Shipment Import Batch (Dry-Run Validation + Atomic Idempotent Commit)
CREATE OR REPLACE FUNCTION public.run_shipment_import_batch(
  p_tenant_id uuid,
  p_template_code text,
  p_file_name text,
  p_batch_idempotency_key text,
  p_mode text,
  p_default_client_id uuid DEFAULT NULL,
  p_default_branch_id uuid DEFAULT NULL,
  p_rows jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_clean_mode text := COALESCE(NULLIF(trim(p_mode), ''), 'dry_run');
  v_clean_template text := COALESCE(NULLIF(upper(trim(p_template_code)), ''), 'SHIPMENTS_V1');
  v_clean_file text := COALESCE(NULLIF(trim(p_file_name), ''), 'shipments_import.csv');
  v_clean_idem text := NULLIF(trim(COALESCE(p_batch_idempotency_key, '')), '');

  v_membership public.tenant_memberships%ROWTYPE;
  v_bound_client_id uuid := NULL;

  v_existing_job public.import_jobs%ROWTYPE;
  v_existing_rows jsonb;

  v_job_id uuid;
  v_total_rows integer := 0;
  v_valid_rows integer := 0;
  v_error_rows integer := 0;
  v_created_count integer := 0;

  v_idx integer := 0;
  v_row jsonb;
  v_row_num integer;
  v_row_errors jsonb;
  v_seen_ext_refs text[] := ARRAY[]::text[];

  v_client_token text;
  v_service_token text;
  v_shp_type_token text;
  v_pay_term_token text;
  v_price_mode_token text;
  v_price_mode text;
  v_rec_name text;
  v_rec_mobile text;
  v_rec_phone text;
  v_gov_token text;
  v_reg_token text;
  v_rec_address text;
  v_weight_num numeric(10,3);
  v_pieces_num integer;
  v_cod_num numeric(14,2);
  v_pkg_desc text;
  v_ext_ref text;
  v_allow_open_token text;
  v_allow_open boolean;
  v_exchange_desc text;

  v_client public.clients%ROWTYPE;
  v_service public.shipping_services%ROWTYPE;
  v_shp_type public.shipment_types%ROWTYPE;
  v_pay_term public.payment_terms%ROWTYPE;
  v_gov public.governorates%ROWTYPE;
  v_reg public.regions%ROWTYPE;
  v_origin_branch_id uuid;
  v_main_branch_id uuid;
  v_default_mov_id uuid;

  v_pricing_entered numeric(14,2);
  v_breakdown jsonb;
  v_est_fee numeric(12,2);
  v_est_collect numeric(14,2);
  v_normalized jsonb;

  v_row_record record;
  v_create_res jsonb;
  v_all_rows_out jsonb := '[]'::jsonb;
  v_final_status text;
BEGIN
  IF v_clean_mode NOT IN ('dry_run', 'commit') THEN
    RAISE EXCEPTION 'Invalid import mode: %', v_clean_mode;
  END IF;

  IF jsonb_typeof(COALESCE(p_rows, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Import rows payload must be a JSON array';
  END IF;

  v_total_rows := jsonb_array_length(COALESCE(p_rows, '[]'::jsonb));
  IF v_total_rows = 0 THEN
    RAISE EXCEPTION 'ملف الاستيراد لا يحتوي على أي سطور صالحة للفحص.';
  END IF;
  IF v_total_rows > 500 THEN
    RAISE EXCEPTION 'الحد الأقصى للدفعة الواحدة هو 500 شحنة (%).', v_total_rows;
  END IF;

  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Forbidden: tenant membership required';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'shipments.import', p_default_branch_id)
    OR app_private.user_has_permission(p_tenant_id, 'shipments.create', p_default_branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: shipments.import or shipments.create permission required';
  END IF;

  PERFORM app_private.ensure_shipment_import_template_v1(p_tenant_id);

  SELECT * INTO v_membership
  FROM public.tenant_memberships
  WHERE tenant_id = p_tenant_id AND user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF v_membership.account_subject_type = 'client' THEN
    SELECT client_id INTO v_bound_client_id
    FROM public.account_subjects
    WHERE tenant_id = p_tenant_id AND membership_id = v_membership.id AND is_active = true
    LIMIT 1;

    IF v_bound_client_id IS NULL THEN
      RAISE EXCEPTION 'Forbidden: client account is missing client binding';
    END IF;
  END IF;

  -- Check batch idempotency when committing
  IF v_clean_mode = 'commit' AND v_clean_idem IS NOT NULL THEN
    SELECT * INTO v_existing_job
    FROM public.import_jobs
    WHERE tenant_id = p_tenant_id
      AND batch_idempotency_key = v_clean_idem
      AND mode = 'commit'
      AND status IN ('completed', 'partial')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_job.id IS NOT NULL THEN
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'row_number', r.row_number,
            'status', r.status,
            'errors', r.errors,
            'estimated_shipping_fee', r.estimated_shipping_fee,
            'estimated_collect_amount', r.estimated_collect_amount,
            'shipment_id', r.shipment_id,
            'shipment_number', r.shipment_number,
            'barcode_token', r.barcode_token,
            'normalized_payload', r.normalized_payload
          )
          ORDER BY r.row_number ASC
        ),
        '[]'::jsonb
      )
      INTO v_existing_rows
      FROM public.import_job_rows r
      WHERE r.tenant_id = p_tenant_id AND r.job_id = v_existing_job.id;

      RETURN jsonb_build_object(
        'job_id', v_existing_job.id,
        'template_code', v_existing_job.template_code,
        'file_name', v_existing_job.file_name,
        'mode', v_existing_job.mode,
        'status', v_existing_job.status,
        'total_rows', v_existing_job.total_rows,
        'valid_rows', v_existing_job.valid_rows,
        'error_rows', v_existing_job.error_rows,
        'created_shipments_count', v_existing_job.created_shipments_count,
        'already_existed', true,
        'rows', v_existing_rows
      );
    END IF;
  END IF;

  SELECT id INTO v_main_branch_id
  FROM public.branches
  WHERE tenant_id = p_tenant_id AND is_main = true AND archived_at IS NULL
  LIMIT 1;

  IF v_main_branch_id IS NULL THEN
    SELECT id INTO v_main_branch_id
    FROM public.branches
    WHERE tenant_id = p_tenant_id AND is_active = true AND archived_at IS NULL
    ORDER BY created_at ASC LIMIT 1;
  END IF;

  SELECT id INTO v_default_mov_id
  FROM public.movement_types
  WHERE tenant_id = p_tenant_id AND is_active = true
  ORDER BY (code = 'MOV-001') DESC, created_at ASC
  LIMIT 1;

  INSERT INTO public.import_jobs (
    tenant_id, template_code, file_name, batch_idempotency_key,
    mode, status, default_client_id, default_branch_id,
    total_rows, valid_rows, error_rows, created_shipments_count, created_by
  )
  VALUES (
    p_tenant_id, v_clean_template, v_clean_file, v_clean_idem,
    v_clean_mode, 'validated', COALESCE(v_bound_client_id, p_default_client_id), p_default_branch_id,
    v_total_rows, 0, 0, 0, auth.uid()
  )
  RETURNING id INTO v_job_id;

  -- Validate every row
  FOR v_idx IN 0..(v_total_rows - 1) LOOP
    v_row := p_rows -> v_idx;
    v_row_num := COALESCE(NULLIF(trim(COALESCE(v_row->>'row_number', '')), '')::integer, v_idx + 1);
    v_row_errors := '[]'::jsonb;

    v_client := NULL;
    v_service := NULL;
    v_shp_type := NULL;
    v_pay_term := NULL;
    v_gov := NULL;
    v_reg := NULL;
    v_est_fee := NULL;
    v_est_collect := NULL;
    v_origin_branch_id := NULL;

    v_client_token := NULLIF(trim(COALESCE(v_row->>'client_code', '')), '');
    v_service_token := NULLIF(trim(COALESCE(v_row->>'service_code', '')), '');
    v_shp_type_token := upper(COALESCE(NULLIF(trim(COALESCE(v_row->>'shipment_type_code', '')), ''), 'FDP'));
    v_pay_term_token := upper(COALESCE(NULLIF(trim(COALESCE(v_row->>'payment_term_code', '')), ''), 'COD'));
    v_price_mode_token := lower(trim(COALESCE(v_row->>'price_mode', 'no')));
    v_rec_name := trim(COALESCE(v_row->>'recipient_name', ''));
    v_rec_mobile := trim(COALESCE(v_row->>'recipient_mobile', ''));
    v_rec_phone := NULLIF(trim(COALESCE(v_row->>'recipient_phone', '')), '');
    v_gov_token := NULLIF(trim(COALESCE(v_row->>'governorate', '')), '');
    v_reg_token := NULLIF(trim(COALESCE(v_row->>'region', '')), '');
    v_rec_address := trim(COALESCE(v_row->>'recipient_address', ''));
    v_pkg_desc := NULLIF(trim(COALESCE(v_row->>'package_description', '')), '');
    v_ext_ref := NULLIF(trim(COALESCE(v_row->>'external_reference', '')), '');
    v_allow_open_token := lower(trim(COALESCE(v_row->>'allow_package_opening', 'no')));
    v_exchange_desc := NULLIF(trim(COALESCE(v_row->>'exchange_item_description', '')), '');

    -- Safe numeric parsing
    BEGIN
      v_weight_num := COALESCE(NULLIF(trim(COALESCE(v_row->>'weight_kg', '')), '')::numeric, 1);
    EXCEPTION WHEN others THEN
      v_weight_num := -1;
      v_row_errors := v_row_errors || jsonb_build_array('الوزن (weight_kg) يجب أن يكون رقمًا صالحًا.');
    END;

    BEGIN
      v_pieces_num := COALESCE(NULLIF(trim(COALESCE(v_row->>'pieces_count', '')), '')::integer, 1);
    EXCEPTION WHEN others THEN
      v_pieces_num := 0;
      v_row_errors := v_row_errors || jsonb_build_array('عدد القطع (pieces_count) يجب أن يكون عددًا صحيحًا.');
    END;

    BEGIN
      v_cod_num := COALESCE(NULLIF(trim(COALESCE(v_row->>'cod_amount', '')), '')::numeric, 0);
    EXCEPTION WHEN others THEN
      v_cod_num := -1;
      v_row_errors := v_row_errors || jsonb_build_array('مبلغ التحصيل (cod_amount) يجب أن يكون رقمًا صالحًا.');
    END;

    IF v_weight_num <= 0 THEN
      v_row_errors := v_row_errors || jsonb_build_array('الوزن يجب أن يكون أكبر من صفر.');
    END IF;
    IF v_pieces_num < 1 OR v_pieces_num > 999 THEN
      v_row_errors := v_row_errors || jsonb_build_array('عدد القطع يجب أن يكون بين 1 و 999.');
    END IF;
    IF v_cod_num < 0 THEN
      v_row_errors := v_row_errors || jsonb_build_array('مبلغ التحصيل لا يمكن أن يكون سالبًا.');
    END IF;

    v_price_mode := CASE
      WHEN v_price_mode_token IN ('yes', 'true', '1', 'included', 'shipping_included', 'نعم') THEN 'shipping_included'
      ELSE 'shipping_excluded'
    END;

    v_allow_open := v_allow_open_token IN ('yes', 'true', '1', 'نعم');

    -- Resolve Client
    IF v_bound_client_id IS NOT NULL THEN
      SELECT * INTO v_client
      FROM public.clients
      WHERE tenant_id = p_tenant_id AND id = v_bound_client_id AND archived_at IS NULL AND is_active = true;

      IF v_client_token IS NOT NULL AND v_client.id IS NOT NULL
         AND lower(v_client.code) <> lower(v_client_token)
         AND lower(v_client.name) <> lower(v_client_token) THEN
        v_row_errors := v_row_errors || jsonb_build_array('لا يُسمح لحساب التاجر بالاستيراد نيابة عن عميل آخر.');
      END IF;
    ELSIF v_client_token IS NOT NULL THEN
      SELECT * INTO v_client
      FROM public.clients
      WHERE tenant_id = p_tenant_id
        AND archived_at IS NULL
        AND is_active = true
        AND (lower(code) = lower(v_client_token) OR lower(name) = lower(v_client_token))
      LIMIT 1;
    ELSIF p_default_client_id IS NOT NULL THEN
      SELECT * INTO v_client
      FROM public.clients
      WHERE tenant_id = p_tenant_id AND id = p_default_client_id AND archived_at IS NULL AND is_active = true;
    END IF;

    IF v_client.id IS NULL THEN
      v_row_errors := v_row_errors || jsonb_build_array('العميل غير موجود أو غير نشط (كود_العميل).');
    END IF;

    -- Resolve Service
    IF v_service_token IS NOT NULL THEN
      SELECT * INTO v_service
      FROM public.shipping_services
      WHERE tenant_id = p_tenant_id AND archived_at IS NULL AND is_active = true
        AND (lower(code) = lower(v_service_token) OR lower(name) = lower(v_service_token))
      LIMIT 1;
    ELSE
      SELECT * INTO v_service
      FROM public.shipping_services
      WHERE tenant_id = p_tenant_id AND archived_at IS NULL AND is_active = true
      ORDER BY (code = 'STD') DESC, created_at ASC LIMIT 1;
    END IF;
    IF v_service.id IS NULL THEN
      v_row_errors := v_row_errors || jsonb_build_array('خدمة الشحن غير صالحة أو غير مفعلة.');
    END IF;

    -- Resolve Shipment Type
    SELECT * INTO v_shp_type
    FROM public.shipment_types
    WHERE tenant_id = p_tenant_id AND is_active = true
      AND (upper(code) = v_shp_type_token OR lower(name) = lower(v_shp_type_token))
    LIMIT 1;
    IF v_shp_type.id IS NULL THEN
      v_row_errors := v_row_errors || jsonb_build_array('نوع الطلب يجب أن يكون من القيم المعتمدة (FDP/PDP/PTP/CLC/RTS).');
    ELSIF v_shp_type.code = 'PTP' AND v_exchange_desc IS NULL THEN
      v_row_errors := v_row_errors || jsonb_build_array('وصف طرد الاستبدال إلزامي عند اختيار نوع الطلب PTP.');
    END IF;

    -- Resolve Payment Term
    SELECT * INTO v_pay_term
    FROM public.payment_terms
    WHERE tenant_id = p_tenant_id AND is_active = true
      AND (upper(code) = v_pay_term_token OR lower(name) = lower(v_pay_term_token))
    LIMIT 1;
    IF v_pay_term.id IS NULL THEN
      v_row_errors := v_row_errors || jsonb_build_array('نوع الدفع غير صالح (COD/PREPAID/POSTPAID/CASH_PAID).');
    END IF;

    -- Recipient validations
    IF char_length(v_rec_name) < 2 THEN
      v_row_errors := v_row_errors || jsonb_build_array('اسم المستلم مطلوب (حرفان على الأقل).');
    END IF;
    IF char_length(v_rec_mobile) < 6 THEN
      v_row_errors := v_row_errors || jsonb_build_array('موبايل المستلم غير صالح أو قصير جدًا.');
    END IF;
    IF char_length(v_rec_address) < 3 THEN
      v_row_errors := v_row_errors || jsonb_build_array('عنوان المستلم مطلوب.');
    END IF;

    -- Geography lookups
    IF v_gov_token IS NULL THEN
      v_row_errors := v_row_errors || jsonb_build_array('المحافظة مطلوبة.');
    ELSE
      SELECT * INTO v_gov
      FROM public.governorates
      WHERE tenant_id = p_tenant_id AND archived_at IS NULL AND is_active = true
        AND (lower(code) = lower(v_gov_token) OR lower(name) = lower(v_gov_token))
      LIMIT 1;
      IF v_gov.id IS NULL THEN
        v_row_errors := v_row_errors || jsonb_build_array('المحافظة غير معرفة أو غير مفعلة: ' || v_gov_token);
      END IF;
    END IF;

    IF v_reg_token IS NULL THEN
      v_row_errors := v_row_errors || jsonb_build_array('المنطقة مطلوبة.');
    ELSIF v_gov.id IS NOT NULL THEN
      SELECT * INTO v_reg
      FROM public.regions
      WHERE tenant_id = p_tenant_id AND governorate_id = v_gov.id AND archived_at IS NULL AND is_active = true
        AND (lower(code) = lower(v_reg_token) OR lower(name) = lower(v_reg_token))
      LIMIT 1;
      IF v_reg.id IS NULL THEN
        v_row_errors := v_row_errors || jsonb_build_array('المنطقة غير مطابقة للمحافظة المحددة: ' || v_reg_token);
      END IF;
    END IF;

    -- Duplicate external_reference check within batch & existing DB
    IF v_ext_ref IS NOT NULL THEN
      IF v_ext_ref = ANY(v_seen_ext_refs) THEN
        v_row_errors := v_row_errors || jsonb_build_array('المرجع الخارجي مكرر داخل نفس الملف: ' || v_ext_ref);
      ELSE
        v_seen_ext_refs := array_append(v_seen_ext_refs, v_ext_ref);
        IF v_client.id IS NOT NULL AND EXISTS (
          SELECT 1
          FROM public.shipments s
          WHERE s.tenant_id = p_tenant_id
            AND s.client_id = v_client.id
            AND s.external_reference = v_ext_ref
            AND s.operational_status <> 'cancelled'
        ) THEN
          v_row_errors := v_row_errors || jsonb_build_array('يوجد شحنة مسجلة مسبقًا بنفس المرجع الخارجي للعميل: ' || v_ext_ref);
        END IF;
      END IF;
    END IF;

    -- Resolve origin branch & estimate pricing if no errors so far
    IF jsonb_array_length(v_row_errors) = 0 THEN
      v_origin_branch_id := COALESCE(p_default_branch_id, v_client.branch_id, v_main_branch_id);
      IF v_origin_branch_id IS NULL THEN
        v_row_errors := v_row_errors || jsonb_build_array('تعذر تحديد فرع المنشأ للشحنة.');
      ELSE
        BEGIN
          v_pricing_entered := CASE WHEN v_pay_term.code = 'COD' THEN v_cod_num ELSE 0 END;
          v_breakdown := public.calculate_shipment_price(
            p_tenant_id,
            v_client.id,
            v_service.id,
            v_client.governorate_id,
            v_client.region_id,
            v_gov.id,
            v_reg.id,
            v_weight_num,
            0, 0, 0,
            v_pricing_entered,
            v_price_mode,
            NULL, NULL, false
          );
          v_est_fee := (v_breakdown->>'total_shipping_fee')::numeric;
          v_est_collect := CASE WHEN v_pay_term.code = 'COD' THEN (v_breakdown->>'recipient_collect_amount')::numeric ELSE 0 END;
        EXCEPTION WHEN others THEN
          v_row_errors := v_row_errors || jsonb_build_array('فشل حساب السعر لهذا المسار والعميل: ' || SQLERRM);
        END;
      END IF;
    END IF;

    v_normalized := jsonb_build_object(
      'client_id', v_client.id,
      'client_name', COALESCE(v_client.name, v_client_token),
      'client_code', COALESCE(v_client.code, v_client_token),
      'origin_branch_id', v_origin_branch_id,
      'movement_type_id', v_default_mov_id,
      'shipment_type_id', v_shp_type.id,
      'shipment_type_code', COALESCE(v_shp_type.code, v_shp_type_token),
      'service_id', v_service.id,
      'service_code', COALESCE(v_service.code, v_service_token),
      'payment_term_id', v_pay_term.id,
      'payment_term_code', COALESCE(v_pay_term.code, v_pay_term_token),
      'price_mode', v_price_mode,
      'actual_weight_kg', v_weight_num,
      'length_cm', 0,
      'width_cm', 0,
      'height_cm', 0,
      'pieces_count', v_pieces_num,
      'prepaid_balance_amount', v_cod_num,
      'sender_name', v_client.name,
      'sender_governorate_id', v_client.governorate_id,
      'sender_region_id', v_client.region_id,
      'sender_phone', v_client.phone,
      'sender_mobile', v_client.mobile,
      'sender_address_line', v_client.address_line,
      'recipient_name', v_rec_name,
      'recipient_governorate_id', v_gov.id,
      'recipient_governorate_name', COALESCE(v_gov.name, v_gov_token),
      'recipient_region_id', v_reg.id,
      'recipient_region_name', COALESCE(v_reg.name, v_reg_token),
      'recipient_phone', v_rec_phone,
      'recipient_mobile', v_rec_mobile,
      'recipient_address_line', v_rec_address,
      'package_description', v_pkg_desc,
      'external_reference', v_ext_ref,
      'allow_package_opening', v_allow_open,
      'exchange_item_description', v_exchange_desc
    );

    IF jsonb_array_length(v_row_errors) = 0 THEN
      v_valid_rows := v_valid_rows + 1;
    ELSE
      v_error_rows := v_error_rows + 1;
    END IF;

    INSERT INTO public.import_job_rows (
      tenant_id, job_id, row_number, status, raw_payload, normalized_payload,
      errors, estimated_shipping_fee, estimated_collect_amount
    )
    VALUES (
      p_tenant_id,
      v_job_id,
      v_row_num,
      CASE WHEN jsonb_array_length(v_row_errors) = 0 THEN 'valid' ELSE 'error' END,
      COALESCE(v_row, '{}'::jsonb),
      v_normalized,
      v_row_errors,
      v_est_fee,
      v_est_collect
    );
  END LOOP;

  -- Commit atomically only if mode = 'commit' AND zero errors
  IF v_clean_mode = 'commit' THEN
    IF v_error_rows > 0 THEN
      v_final_status := 'failed';
    ELSE
      FOR v_row_record IN
        SELECT *
        FROM public.import_job_rows
        WHERE tenant_id = p_tenant_id AND job_id = v_job_id AND status = 'valid'
        ORDER BY row_number ASC
      LOOP
        v_create_res := public.create_shipment(
          p_tenant_id,
          COALESCE(v_clean_idem, v_job_id::text) || ':row:' || v_row_record.row_number::text,
          v_row_record.normalized_payload
        );

        UPDATE public.import_job_rows
        SET status = 'created',
            shipment_id = (v_create_res->>'shipment_id')::uuid,
            shipment_number = v_create_res->>'shipment_number',
            barcode_token = v_create_res->>'barcode_token'
        WHERE id = v_row_record.id;

        v_created_count := v_created_count + 1;
      END LOOP;

      v_final_status := 'completed';

      INSERT INTO audit.audit_logs (
        tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
      )
      VALUES (
        p_tenant_id,
        auth.uid(),
        'shipments_bulk_import_committed',
        'import_job',
        v_job_id,
        jsonb_build_object(
          'template_code', v_clean_template,
          'file_name', v_clean_file,
          'created_shipments_count', v_created_count
        ),
        'server'
      );
    END IF;
  ELSE
    v_final_status := CASE WHEN v_error_rows = 0 THEN 'validated' ELSE 'failed' END;
  END IF;

  UPDATE public.import_jobs
  SET status = v_final_status,
      valid_rows = v_valid_rows,
      error_rows = v_error_rows,
      created_shipments_count = v_created_count,
      summary_json = jsonb_build_object(
        'total_rows', v_total_rows,
        'valid_rows', v_valid_rows,
        'error_rows', v_error_rows,
        'created_shipments_count', v_created_count
      )
  WHERE id = v_job_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'row_number', r.row_number,
        'status', r.status,
        'errors', r.errors,
        'estimated_shipping_fee', r.estimated_shipping_fee,
        'estimated_collect_amount', r.estimated_collect_amount,
        'shipment_id', r.shipment_id,
        'shipment_number', r.shipment_number,
        'barcode_token', r.barcode_token,
        'normalized_payload', r.normalized_payload
      )
      ORDER BY r.row_number ASC
    ),
    '[]'::jsonb
  )
  INTO v_all_rows_out
  FROM public.import_job_rows r
  WHERE r.tenant_id = p_tenant_id AND r.job_id = v_job_id;

  RETURN jsonb_build_object(
    'job_id', v_job_id,
    'template_code', v_clean_template,
    'file_name', v_clean_file,
    'mode', v_clean_mode,
    'status', v_final_status,
    'total_rows', v_total_rows,
    'valid_rows', v_valid_rows,
    'error_rows', v_error_rows,
    'created_shipments_count', v_created_count,
    'already_existed', false,
    'rows', v_all_rows_out
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_shipment_import_batch(uuid, text, text, text, text, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_shipment_import_batch(uuid, text, text, text, text, uuid, uuid, jsonb) TO authenticated;

-- 4.3 List Import Jobs
CREATE OR REPLACE FUNCTION public.list_import_jobs(p_tenant_id uuid)
RETURNS SETOF public.import_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Forbidden: tenant membership required';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.import_jobs
  WHERE tenant_id = p_tenant_id
    AND (
      app_private.current_user_is_platform_super_admin()
      OR app_private.user_is_tenant_admin(p_tenant_id)
      OR created_by = auth.uid()
      OR (
        EXISTS (
          SELECT 1
          FROM public.tenant_memberships tm
          WHERE tm.tenant_id = p_tenant_id
            AND tm.user_id = auth.uid()
            AND tm.is_active = true
            AND tm.account_subject_type = 'staff'
        )
        AND (
          app_private.user_has_permission(p_tenant_id, 'shipments.read', default_branch_id)
          OR app_private.user_has_permission(p_tenant_id, 'shipments.import', default_branch_id)
        )
      )
    )
  ORDER BY created_at DESC
  LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.list_import_jobs(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_import_jobs(uuid) TO authenticated;

-- 4.4 Get Import Job Detail
CREATE OR REPLACE FUNCTION public.get_import_job_detail(p_tenant_id uuid, p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_job public.import_jobs%ROWTYPE;
  v_rows jsonb;
BEGIN
  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Forbidden: tenant membership required';
  END IF;

  SELECT * INTO v_job
  FROM public.import_jobs
  WHERE tenant_id = p_tenant_id AND id = p_job_id;

  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'دفعة الاستيراد غير موجودة.';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR v_job.created_by = auth.uid()
    OR (
      EXISTS (
        SELECT 1
        FROM public.tenant_memberships tm
        WHERE tm.tenant_id = p_tenant_id
          AND tm.user_id = auth.uid()
          AND tm.is_active = true
          AND tm.account_subject_type = 'staff'
      )
      AND (
        app_private.user_has_permission(p_tenant_id, 'shipments.read', v_job.default_branch_id)
        OR app_private.user_has_permission(p_tenant_id, 'shipments.import', v_job.default_branch_id)
      )
    )
  ) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'row_number', r.row_number,
        'status', r.status,
        'errors', r.errors,
        'estimated_shipping_fee', r.estimated_shipping_fee,
        'estimated_collect_amount', r.estimated_collect_amount,
        'shipment_id', r.shipment_id,
        'shipment_number', r.shipment_number,
        'barcode_token', r.barcode_token,
        'normalized_payload', r.normalized_payload
      )
      ORDER BY r.row_number ASC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.import_job_rows r
  WHERE r.tenant_id = p_tenant_id AND r.job_id = p_job_id;

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'template_code', v_job.template_code,
    'file_name', v_job.file_name,
    'mode', v_job.mode,
    'status', v_job.status,
    'total_rows', v_job.total_rows,
    'valid_rows', v_job.valid_rows,
    'error_rows', v_job.error_rows,
    'created_shipments_count', v_job.created_shipments_count,
    'already_existed', false,
    'rows', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_import_job_detail(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_import_job_detail(uuid, uuid) TO authenticated;

-- 4.5 Record Export / Print Audit Job
CREATE OR REPLACE FUNCTION public.record_export_job(
  p_tenant_id uuid,
  p_export_type text,
  p_format text,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_row_count integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Forbidden: tenant membership required';
  END IF;

  INSERT INTO public.export_jobs (
    tenant_id, export_type, format, filters_json, row_count, actor_user_id
  )
  VALUES (
    p_tenant_id,
    p_export_type,
    p_format,
    COALESCE(p_filters, '{}'::jsonb),
    GREATEST(0, COALESCE(p_row_count, 0)),
    auth.uid()
  )
  RETURNING id INTO v_id;

  INSERT INTO audit.audit_logs (
    tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source
  )
  VALUES (
    p_tenant_id,
    auth.uid(),
    'export_or_print_executed',
    'export_job',
    v_id,
    jsonb_build_object('export_type', p_export_type, 'format', p_format, 'row_count', p_row_count),
    'server'
  );

  RETURN jsonb_build_object('id', v_id, 'export_type', p_export_type, 'format', p_format, 'row_count', p_row_count);
END;
$$;

REVOKE ALL ON FUNCTION public.record_export_job(uuid, text, text, jsonb, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_export_job(uuid, text, text, jsonb, integer) TO authenticated;

-- 4.6 Executive Operations & Financial Analytics Report
CREATE OR REPLACE FUNCTION public.get_executive_operations_report(
  p_tenant_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_client_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_membership public.tenant_memberships%ROWTYPE;
  v_bound_client_id uuid := NULL;
  v_eff_client_id uuid := p_client_id;
  v_cashbox_balance numeric(14,2) := 0;
  v_kpi jsonb;
  v_by_branch jsonb;
  v_by_gov jsonb;
  v_by_client jsonb;
  v_by_courier jsonb;
BEGIN
  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RAISE EXCEPTION 'Forbidden: tenant membership required';
  END IF;

  IF NOT (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'reports.read', p_branch_id)
    OR app_private.user_has_permission(p_tenant_id, 'dashboard.view', p_branch_id)
  ) THEN
    RAISE EXCEPTION 'Forbidden: reports.read or dashboard.view permission required';
  END IF;

  SELECT * INTO v_membership
  FROM public.tenant_memberships
  WHERE tenant_id = p_tenant_id AND user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF v_membership.account_subject_type = 'client' THEN
    SELECT client_id INTO v_bound_client_id
    FROM public.account_subjects
    WHERE tenant_id = p_tenant_id AND membership_id = v_membership.id AND is_active = true
    LIMIT 1;

    v_eff_client_id := v_bound_client_id;
  END IF;

  IF v_bound_client_id IS NULL THEN
    SELECT COALESCE(
      SUM(CASE WHEN ct.direction = 'in' THEN ct.amount ELSE -ct.amount END),
      0
    )
    INTO v_cashbox_balance
    FROM public.cashbox_transactions ct
    JOIN public.cashboxes cb ON cb.id = ct.cashbox_id AND cb.tenant_id = ct.tenant_id
    WHERE ct.tenant_id = p_tenant_id
      AND cb.archived_at IS NULL
      AND (p_branch_id IS NULL OR cb.branch_id = p_branch_id);
  END IF;

  WITH filtered AS (
    SELECT s.*
    FROM public.shipments s
    WHERE s.tenant_id = p_tenant_id
      AND (p_date_from IS NULL OR s.created_at::date >= p_date_from)
      AND (p_date_to IS NULL OR s.created_at::date <= p_date_to)
      AND (p_branch_id IS NULL OR s.current_branch_id = p_branch_id OR s.origin_branch_id = p_branch_id)
      AND (v_eff_client_id IS NULL OR s.client_id = v_eff_client_id)
  )
  SELECT jsonb_build_object(
    'total_shipments', COUNT(*),
    'pending_pickup_count', COUNT(*) FILTER (WHERE operational_status IN ('created', 'pickup_scheduled')),
    'in_warehouse_count', COUNT(*) FILTER (WHERE operational_status IN ('picked_up', 'in_warehouse', 'in_transit_branch')),
    'out_for_delivery_count', COUNT(*) FILTER (WHERE operational_status = 'out_for_delivery'),
    'rescheduled_count', COUNT(*) FILTER (WHERE operational_status = 'rescheduled'),
    'delivered_count', COUNT(*) FILTER (WHERE operational_status = 'delivered'),
    'partially_delivered_count', COUNT(*) FILTER (WHERE operational_status = 'partially_delivered'),
    'returned_count', COUNT(*) FILTER (WHERE operational_status IN ('return_to_sender', 'returned')),
    'cancelled_count', COUNT(*) FILTER (WHERE operational_status = 'cancelled'),
    'delivery_failed_count', COUNT(*) FILTER (WHERE operational_status = 'delivery_failed'),
    'first_attempt_success_rate', COALESCE(
      ROUND(
        100.0 * COUNT(*) FILTER (
          WHERE operational_status IN ('delivered', 'partially_delivered')
            AND delivery_attempts_count <= 1
        )
        / NULLIF(
          COUNT(*) FILTER (WHERE operational_status IN ('delivered', 'partially_delivered', 'return_to_sender', 'returned', 'delivery_failed')),
          0
        ),
        1
      ),
      0
    ),
    'return_rate', COALESCE(
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE operational_status IN ('return_to_sender', 'returned'))
        / NULLIF(COUNT(*) FILTER (WHERE operational_status <> 'cancelled'), 0),
        1
      ),
      0
    ),
    'avg_cycle_hours', COALESCE(
      ROUND(
        AVG(EXTRACT(EPOCH FROM (delivered_at - created_at)) / 3600.0)
          FILTER (WHERE delivered_at IS NOT NULL),
        1
      ),
      0
    ),
    'sla_delayed_count', COUNT(*) FILTER (
      WHERE operational_status NOT IN ('delivered', 'returned', 'cancelled')
        AND created_at < (now() - interval '72 hours')
    ),
    'total_shipping_revenue', COALESCE(SUM(total_shipping_fee) FILTER (WHERE operational_status <> 'cancelled'), 0),
    'total_cod_collected', COALESCE(
      SUM(COALESCE(delivered_amount, recipient_collect_amount))
        FILTER (WHERE operational_status IN ('delivered', 'partially_delivered') AND payment_term_code = 'COD'),
      0
    ),
    'pending_courier_cash', COALESCE(
      SUM(COALESCE(delivered_amount, recipient_collect_amount))
        FILTER (
          WHERE operational_status IN ('delivered', 'partially_delivered')
            AND payment_term_code = 'COD'
            AND is_collected_from_courier = false
        ),
      0
    ),
    'pending_client_payouts', COALESCE(
      SUM(GREATEST(client_net_payout, 0))
        FILTER (
          WHERE operational_status IN ('delivered', 'partially_delivered', 'returned')
            AND is_settled_to_client = false
        ),
      0
    ),
    'total_accrued_commissions', COALESCE(
      SUM(accrued_courier_commission) FILTER (WHERE operational_status IN ('delivered', 'partially_delivered')),
      0
    ),
    'total_cashbox_balance', v_cashbox_balance
  )
  INTO v_kpi
  FROM filtered;

  WITH filtered AS (
    SELECT s.*
    FROM public.shipments s
    WHERE s.tenant_id = p_tenant_id
      AND (p_date_from IS NULL OR s.created_at::date >= p_date_from)
      AND (p_date_to IS NULL OR s.created_at::date <= p_date_to)
      AND (p_branch_id IS NULL OR s.current_branch_id = p_branch_id OR s.origin_branch_id = p_branch_id)
      AND (v_eff_client_id IS NULL OR s.client_id = v_eff_client_id)
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'branch_id', b.id,
        'branch_name', b.name,
        'total_count', agg.total_count,
        'delivered_count', agg.delivered_count,
        'returned_count', agg.returned_count,
        'shipping_revenue', agg.shipping_revenue
      )
      ORDER BY agg.total_count DESC
    ),
    '[]'::jsonb
  )
  INTO v_by_branch
  FROM (
    SELECT
      f.current_branch_id AS branch_id,
      COUNT(*) AS total_count,
      COUNT(*) FILTER (WHERE f.operational_status IN ('delivered', 'partially_delivered')) AS delivered_count,
      COUNT(*) FILTER (WHERE f.operational_status IN ('return_to_sender', 'returned')) AS returned_count,
      COALESCE(SUM(f.total_shipping_fee) FILTER (WHERE f.operational_status <> 'cancelled'), 0) AS shipping_revenue
    FROM filtered f
    GROUP BY f.current_branch_id
  ) agg
  JOIN public.branches b ON b.id = agg.branch_id AND b.tenant_id = p_tenant_id;

  WITH filtered AS (
    SELECT s.*
    FROM public.shipments s
    WHERE s.tenant_id = p_tenant_id
      AND (p_date_from IS NULL OR s.created_at::date >= p_date_from)
      AND (p_date_to IS NULL OR s.created_at::date <= p_date_to)
      AND (p_branch_id IS NULL OR s.current_branch_id = p_branch_id OR s.origin_branch_id = p_branch_id)
      AND (v_eff_client_id IS NULL OR s.client_id = v_eff_client_id)
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'governorate_id', g.id,
        'governorate_name', g.name,
        'total_count', agg.total_count,
        'delivered_count', agg.delivered_count,
        'returned_count', agg.returned_count,
        'cod_collected', agg.cod_collected
      )
      ORDER BY agg.total_count DESC
    ),
    '[]'::jsonb
  )
  INTO v_by_gov
  FROM (
    SELECT
      f.recipient_governorate_id AS governorate_id,
      COUNT(*) AS total_count,
      COUNT(*) FILTER (WHERE f.operational_status IN ('delivered', 'partially_delivered')) AS delivered_count,
      COUNT(*) FILTER (WHERE f.operational_status IN ('return_to_sender', 'returned')) AS returned_count,
      COALESCE(
        SUM(COALESCE(f.delivered_amount, f.recipient_collect_amount))
          FILTER (WHERE f.operational_status IN ('delivered', 'partially_delivered') AND f.payment_term_code = 'COD'),
        0
      ) AS cod_collected
    FROM filtered f
    GROUP BY f.recipient_governorate_id
  ) agg
  JOIN public.governorates g ON g.id = agg.governorate_id AND g.tenant_id = p_tenant_id;

  WITH filtered AS (
    SELECT s.*
    FROM public.shipments s
    WHERE s.tenant_id = p_tenant_id
      AND (p_date_from IS NULL OR s.created_at::date >= p_date_from)
      AND (p_date_to IS NULL OR s.created_at::date <= p_date_to)
      AND (p_branch_id IS NULL OR s.current_branch_id = p_branch_id OR s.origin_branch_id = p_branch_id)
      AND (v_eff_client_id IS NULL OR s.client_id = v_eff_client_id)
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'client_id', c.id,
        'client_name', c.name,
        'total_count', agg.total_count,
        'delivered_count', agg.delivered_count,
        'returned_count', agg.returned_count,
        'shipping_revenue', agg.shipping_revenue,
        'net_payable', agg.net_payable
      )
      ORDER BY agg.total_count DESC
    ),
    '[]'::jsonb
  )
  INTO v_by_client
  FROM (
    SELECT
      f.client_id,
      COUNT(*) AS total_count,
      COUNT(*) FILTER (WHERE f.operational_status IN ('delivered', 'partially_delivered')) AS delivered_count,
      COUNT(*) FILTER (WHERE f.operational_status IN ('return_to_sender', 'returned')) AS returned_count,
      COALESCE(SUM(f.total_shipping_fee) FILTER (WHERE f.operational_status <> 'cancelled'), 0) AS shipping_revenue,
      COALESCE(SUM(GREATEST(f.client_net_payout, 0)) FILTER (WHERE f.operational_status IN ('delivered', 'partially_delivered') AND f.is_settled_to_client = false), 0) AS net_payable
    FROM filtered f
    GROUP BY f.client_id
    ORDER BY COUNT(*) DESC
    LIMIT 15
  ) agg
  JOIN public.clients c ON c.id = agg.client_id AND c.tenant_id = p_tenant_id;

  IF v_bound_client_id IS NULL THEN
    WITH filtered AS (
      SELECT s.*
      FROM public.shipments s
      WHERE s.tenant_id = p_tenant_id
        AND s.assigned_courier_id IS NOT NULL
        AND (p_date_from IS NULL OR s.created_at::date >= p_date_from)
        AND (p_date_to IS NULL OR s.created_at::date <= p_date_to)
        AND (p_branch_id IS NULL OR s.current_branch_id = p_branch_id OR s.origin_branch_id = p_branch_id)
        AND (v_eff_client_id IS NULL OR s.client_id = v_eff_client_id)
    )
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'courier_id', cr.id,
          'courier_name', cr.name,
          'assigned_count', agg.assigned_count,
          'delivered_count', agg.delivered_count,
          'failed_or_returned_count', agg.failed_or_returned_count,
          'cod_held_amount', agg.cod_held_amount,
          'accrued_commission', agg.accrued_commission
        )
        ORDER BY agg.delivered_count DESC, agg.assigned_count DESC
      ),
      '[]'::jsonb
    )
    INTO v_by_courier
    FROM (
      SELECT
        f.assigned_courier_id AS courier_id,
        COUNT(*) AS assigned_count,
        COUNT(*) FILTER (WHERE f.operational_status IN ('delivered', 'partially_delivered')) AS delivered_count,
        COUNT(*) FILTER (WHERE f.operational_status IN ('delivery_failed', 'return_to_sender', 'returned')) AS failed_or_returned_count,
        COALESCE(SUM(COALESCE(f.delivered_amount, f.recipient_collect_amount)) FILTER (
          WHERE f.operational_status IN ('delivered', 'partially_delivered')
            AND f.payment_term_code = 'COD'
            AND f.is_collected_from_courier = false
        ), 0) AS cod_held_amount,
        COALESCE(SUM(f.accrued_courier_commission) FILTER (WHERE f.operational_status IN ('delivered', 'partially_delivered')), 0) AS accrued_commission
      FROM filtered f
      GROUP BY f.assigned_courier_id
      ORDER BY COUNT(*) DESC
      LIMIT 15
    ) agg
    JOIN public.couriers cr ON cr.id = agg.courier_id AND cr.tenant_id = p_tenant_id;
  ELSE
    v_by_courier := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'kpis', v_kpi,
    'by_branch', v_by_branch,
    'by_governorate', v_by_gov,
    'by_client', v_by_client,
    'by_courier', v_by_courier
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_executive_operations_report(uuid, date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_executive_operations_report(uuid, date, date, uuid, uuid) TO authenticated;
