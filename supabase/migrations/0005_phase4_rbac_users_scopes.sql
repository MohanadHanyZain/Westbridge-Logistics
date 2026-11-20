-- ============================================================================
-- Migration 0005: Phase 4 - Users, Roles, Permissions, Scopes & Subject Links
-- ============================================================================
-- Enforces MASTER_SPEC Section 04 (Roles & Permissions):
-- - Separates account_subject_type (staff/client/courier/platform_support)
--   from role, fine-grained permissions, and branch scope.
-- - Links tenant memberships cleanly to clients (and prepares courier_id for Phase 5)
--   via tenant-locked composite foreign keys.
-- - Never stores passwords in application tables.
-- - Adds server-side permission checks + session audit directory RPC +
--   service_role wrappers for Edge Function user provisioning.
-- ============================================================================

-- Relax role_key check on tenant_memberships to support custom tenant roles
-- while keeping format validation and system role constraints in public.roles.
ALTER TABLE public.tenant_memberships
  DROP CONSTRAINT IF EXISTS tenant_memberships_role_key_check;

ALTER TABLE public.tenant_memberships
  ADD CONSTRAINT tenant_memberships_role_key_check
    CHECK (role_key ~ '^[a-z0-9_]{2,48}$');

-- ----------------------------------------------------------------------------
-- 1. Global Permission Registry (Catalog)
-- ----------------------------------------------------------------------------
CREATE TABLE public.permissions (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9_.]{3,64}$'),
  module text NOT NULL CHECK (module IN (
    'dashboard', 'definitions', 'clients', 'pricing', 'couriers',
    'shipments', 'operations', 'finance', 'accounting', 'security', 'integrations'
  )),
  label_ar text NOT NULL CHECK (char_length(trim(label_ar)) >= 2),
  description_ar text,
  default_scope text NOT NULL DEFAULT 'tenant'
    CHECK (default_scope IN ('tenant', 'branch', 'own', 'assigned')),
  is_sensitive boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.permissions (key, module, label_ar, description_ar, default_scope, is_sensitive)
VALUES
  ('dashboard.view', 'dashboard', 'عرض لوحة التحكم والإحصائيات', 'الوصول إلى مؤشرات الأداء ولوحة الشركة.', 'tenant', false),
  ('definitions.read', 'definitions', 'استعراض التعريفات الأساسية', 'قراءة الفروع والأقاليم والمناطق والخدمات والخزائن.', 'tenant', false),
  ('definitions.manage', 'definitions', 'إدارة التعريفات الأساسية', 'إضافة وتعديل وأرشفة الفروع والجغرافيا والخدمات.', 'tenant', true),
  ('clients.read', 'clients', 'استعراض العملاء', 'عرض قائمة العملاء وملفاتهم وشروط التعاقد.', 'tenant', false),
  ('clients.create', 'clients', 'إنشاء عميل جديد', 'إضافة ملف عميل جديد يدويًا.', 'tenant', false),
  ('clients.update', 'clients', 'تعديل بيانات العملاء', 'تحديث بيانات العملاء وعناوين الالتقاط.', 'tenant', false),
  ('clients.approve', 'clients', 'اعتماد طلبات تسجيل العملاء', 'مراجعة وقبول أو رفض الحسابات المسجلة.', 'tenant', true),
  ('pricing.read', 'pricing', 'استعراض قوائم الأسعار', 'عرض مصفوفات التسعير وإصداراتها.', 'tenant', false),
  ('pricing.manage', 'pricing', 'إدارة ونسخ قوائم الأسعار', 'تعديل قواعد الالتقاط والتسليم والوزن الحجمي.', 'tenant', true),
  ('pricing.override', 'pricing', 'تعديل السعر يدويًا (override_price)', 'تعديل رسوم الشحنة يدويًا مع إلزامية ذكر السبب.', 'tenant', true),
  ('couriers.read', 'couriers', 'استعراض المندوبين وخطوط السير', 'متابعة بيانات المناديب وخطوط السير.', 'branch', false),
  ('couriers.manage', 'couriers', 'إدارة المندوبين والعمولات', 'إنشاء المناديب وضبط العمولات وخطوط السير.', 'tenant', true),
  ('shipments.read', 'shipments', 'استعراض الشحنات', 'قراءة بيانات الشحنات وحالاتها وتفاصيلها.', 'branch', false),
  ('shipments.create', 'shipments', 'إنشاء شحنة جديدة', 'تسجيل الشحنات الفردية أو بالاستيراد.', 'branch', false),
  ('shipments.update_draft', 'shipments', 'تعديل الشحنات قبل الخروج', 'تعديل الشحنات والوزن قبل مرحلة التوصيل.', 'branch', false),
  ('shipments.cancel', 'shipments', 'إلغاء الشحنات', 'إلغاء الشحنات وفق ضوابط الحالة.', 'branch', true),
  ('operations.pickup.approve', 'operations', 'إدارة واعتماد قوائم الالتقاط والمخزن', 'تجهيز واعتماد قوائم الالتقاط والاستلام بالمخزن.', 'branch', false),
  ('operations.delivery.execute', 'operations', 'تنفيذ التسليم والمحاولات والمرتجعات', 'تنفيذ مهام المندوب وتسجيل التسليم والتعذر.', 'assigned', false),
  ('finance.collections.create', 'finance', 'إنشاء مستندات التحصيل من المناديب', 'إعداد سندات توريد النقدية من المندوب.', 'branch', false),
  ('finance.collections.approve', 'finance', 'اعتماد التحصيلات والخزائن', 'اعتماد سندات التحصيل والتوريد المالي.', 'branch', true),
  ('finance.payouts.approve', 'finance', 'اعتماد تسويات العملاء والعمولات', 'اعتماد صرف مستحقات التجار وعمولات المناديب.', 'tenant', true),
  ('accounting.journals.post', 'accounting', 'إدارة الدليل والقيود المحاسبية', 'ترحيل القيود ومراجعة الأستاذ العام والميزان.', 'tenant', true),
  ('users.read', 'security', 'استعراض المستخدمين والأدوار', 'عرض دليل المستخدمين ونطاق فروعهم.', 'tenant', false),
  ('users.manage', 'security', 'إدارة المستخدمين وتعيين كلمات المرور', 'إنشاء المستخدمين وتعطيلهم وربطهم بالعملاء والفروع.', 'tenant', true),
  ('roles.manage', 'security', 'إدارة الأدوار ومصفوفة الصلاحيات', 'إنشاء الأدوار المخصصة وضبط صلاحياتها ونطاقها.', 'tenant', true),
  ('sessions.audit.read', 'security', 'مراجعة سجل الدخول والجلسات', 'متابعة أحداث تسجيل الدخول وتحديث بيانات الدخول.', 'tenant', true),
  ('api_tokens.create', 'integrations', 'إدارة مفاتيح API والتكاملات', 'إصدار وإبطال رموز التكامل البرمجي للعملاء.', 'tenant', true)
ON CONFLICT (key) DO UPDATE
  SET module = EXCLUDED.module,
      label_ar = EXCLUDED.label_ar,
      description_ar = EXCLUDED.description_ar,
      default_scope = EXCLUDED.default_scope,
      is_sensitive = EXCLUDED.is_sensitive;

-- ----------------------------------------------------------------------------
-- 2. Tenant Roles & Role Permissions
-- ----------------------------------------------------------------------------
CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[a-z0-9_]{2,48}$'),
  name text NOT NULL CHECK (char_length(trim(name)) >= 2),
  description text,
  default_subject_type text NOT NULL DEFAULT 'staff'
    CHECK (default_subject_type IN ('staff', 'client', 'courier')),
  default_scope text NOT NULL DEFAULT 'tenant'
    CHECK (default_scope IN ('tenant', 'branch', 'own', 'assigned')),
  is_system boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_roles_tenant_code UNIQUE (tenant_id, code),
  CONSTRAINT uq_roles_tenant_id_id UNIQUE (tenant_id, id)
);

CREATE INDEX idx_roles_tenant_active ON public.roles (tenant_id, is_active);

CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

CREATE OR REPLACE FUNCTION app_private.protect_system_owner_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system THEN
      RAISE EXCEPTION 'Cannot delete built-in system role: %', OLD.code;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.code = 'company_owner' AND NEW.is_active = false THEN
    RAISE EXCEPTION 'Cannot deactivate company_owner role';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_system_owner_role
  BEFORE UPDATE OR DELETE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION app_private.protect_system_owner_role();

CREATE TABLE public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  role_id uuid NOT NULL,
  permission_key text NOT NULL REFERENCES public.permissions(key) ON DELETE RESTRICT,
  scope text NOT NULL DEFAULT 'tenant'
    CHECK (scope IN ('tenant', 'branch', 'own', 'assigned')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_role_permissions_unique UNIQUE (tenant_id, role_id, permission_key),
  CONSTRAINT fk_rp_role
    FOREIGN KEY (tenant_id, role_id) REFERENCES public.roles(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_role_permissions_role ON public.role_permissions (tenant_id, role_id);

-- Prevent removing critical permissions from company_owner
CREATE OR REPLACE FUNCTION app_private.protect_company_owner_permissions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_code text;
BEGIN
  SELECT code INTO v_code FROM public.roles WHERE id = OLD.role_id AND tenant_id = OLD.tenant_id;
  IF v_code = 'company_owner' THEN
    RAISE EXCEPTION 'Cannot remove permissions from company_owner role';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_protect_company_owner_permissions
  BEFORE DELETE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION app_private.protect_company_owner_permissions();

-- ----------------------------------------------------------------------------
-- 3. Membership Roles, Branch Scopes & Account Subjects (Client / Courier Binding)
-- ----------------------------------------------------------------------------
CREATE TABLE public.membership_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_membership_roles_unique UNIQUE (tenant_id, membership_id, role_id),
  CONSTRAINT fk_mr_membership
    FOREIGN KEY (tenant_id, membership_id) REFERENCES public.tenant_memberships(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_mr_role
    FOREIGN KEY (tenant_id, role_id) REFERENCES public.roles(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX uq_membership_roles_one_primary
  ON public.membership_roles (tenant_id, membership_id)
  WHERE is_primary = true;

CREATE TABLE public.membership_branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_membership_branches_unique UNIQUE (tenant_id, membership_id, branch_id),
  CONSTRAINT fk_mb_membership
    FOREIGN KEY (tenant_id, membership_id) REFERENCES public.tenant_memberships(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_mb_branch
    FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_membership_branches_membership ON public.membership_branches (tenant_id, membership_id);

CREATE TABLE public.account_subjects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL,
  subject_type text NOT NULL
    CHECK (subject_type IN ('staff', 'client', 'courier', 'platform_support')),
  client_id uuid,
  courier_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  CONSTRAINT uq_account_subjects_membership UNIQUE (tenant_id, membership_id),
  CONSTRAINT fk_as_membership
    FOREIGN KEY (tenant_id, membership_id) REFERENCES public.tenant_memberships(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_as_client
    FOREIGN KEY (tenant_id, client_id) REFERENCES public.clients(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT chk_account_subjects_binding CHECK (
    (subject_type = 'client' AND client_id IS NOT NULL AND courier_id IS NULL) OR
    (subject_type = 'staff' AND client_id IS NULL AND courier_id IS NULL) OR
    (subject_type = 'courier' AND client_id IS NULL) OR
    (subject_type = 'platform_support' AND client_id IS NULL AND courier_id IS NULL)
  )
);

CREATE INDEX idx_account_subjects_client ON public.account_subjects (tenant_id, client_id) WHERE client_id IS NOT NULL;

CREATE TRIGGER trg_account_subjects_updated_at
  BEFORE UPDATE ON public.account_subjects
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Server-Side Permission & Scope Helper Functions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.user_has_permission(
  p_tenant_id uuid,
  p_permission_key text,
  p_branch_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_memberships tm
    JOIN public.profiles p ON p.id = tm.user_id
    JOIN public.tenants t ON t.id = tm.tenant_id
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.is_active = true
      AND p.is_active = true
      AND t.status = 'active'
      AND (
        tm.role_key = 'company_owner'
        OR EXISTS (
          SELECT 1
          FROM public.membership_roles mr
          JOIN public.roles r ON r.id = mr.role_id AND r.tenant_id = mr.tenant_id AND r.is_active = true
          JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.tenant_id = r.tenant_id
          WHERE mr.tenant_id = tm.tenant_id
            AND mr.membership_id = tm.id
            AND rp.permission_key = p_permission_key
            AND (
              p_branch_id IS NULL
              OR rp.scope = 'tenant'
              OR EXISTS (
                SELECT 1
                FROM public.membership_branches mb
                WHERE mb.tenant_id = tm.tenant_id
                  AND mb.membership_id = tm.id
                  AND mb.branch_id = p_branch_id
              )
            )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_tenant_permissions(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_membership public.tenant_memberships%ROWTYPE;
  v_perms jsonb;
  v_branches jsonb;
  v_client_id uuid;
BEGIN
  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RETURN jsonb_build_object('permissions', '[]'::jsonb, 'branch_ids', '[]'::jsonb, 'client_id', NULL);
  END IF;

  SELECT * INTO v_membership
  FROM public.tenant_memberships
  WHERE tenant_id = p_tenant_id AND user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF v_membership.role_key = 'company_owner' THEN
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('permission_key', key, 'scope', 'tenant')),
      '[]'::jsonb
    )
    INTO v_perms
    FROM public.permissions;
  ELSE
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('permission_key', rp.permission_key, 'scope', rp.scope)),
      '[]'::jsonb
    )
    INTO v_perms
    FROM public.membership_roles mr
    JOIN public.roles r ON r.id = mr.role_id AND r.tenant_id = mr.tenant_id AND r.is_active = true
    JOIN public.role_permissions rp ON rp.role_id = r.id AND rp.tenant_id = r.tenant_id
    WHERE mr.tenant_id = p_tenant_id
      AND mr.membership_id = v_membership.id;
  END IF;

  SELECT COALESCE(jsonb_agg(branch_id), '[]'::jsonb)
  INTO v_branches
  FROM public.membership_branches
  WHERE tenant_id = p_tenant_id AND membership_id = v_membership.id;

  SELECT client_id INTO v_client_id
  FROM public.account_subjects
  WHERE tenant_id = p_tenant_id AND membership_id = v_membership.id AND is_active = true;

  RETURN jsonb_build_object(
    'membership_id', v_membership.id,
    'role_key', v_membership.role_key,
    'account_subject_type', v_membership.account_subject_type,
    'client_id', v_client_id,
    'branch_ids', v_branches,
    'permissions', v_perms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_tenant_permissions(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_tenant_permissions(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Security Directory & Session Audit RPCs (Safe Views Without Leaking Secrets)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_tenant_users_directory(p_tenant_id uuid)
RETURNS TABLE (
  membership_id uuid,
  tenant_id uuid,
  user_id uuid,
  username text,
  display_name text,
  account_subject_type text,
  role_key text,
  role_id uuid,
  role_name text,
  is_active boolean,
  must_change_password boolean,
  client_id uuid,
  client_code text,
  client_name text,
  courier_id uuid,
  branch_ids uuid[],
  branch_names text[],
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  IF NOT (
    app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'users.read', NULL)
  ) THEN
    RAISE EXCEPTION 'Forbidden: users.read permission required';
  END IF;

  RETURN QUERY
  SELECT
    tm.id AS membership_id,
    tm.tenant_id,
    tm.user_id,
    tm.username,
    p.display_name,
    tm.account_subject_type,
    tm.role_key,
    r.id AS role_id,
    COALESCE(r.name, tm.role_key) AS role_name,
    tm.is_active,
    tm.must_change_password,
    asub.client_id,
    cl.code AS client_code,
    cl.name AS client_name,
    asub.courier_id,
    COALESCE(
      (SELECT array_agg(mb.branch_id ORDER BY mb.is_default DESC)
       FROM public.membership_branches mb
       WHERE mb.tenant_id = tm.tenant_id AND mb.membership_id = tm.id),
      ARRAY[]::uuid[]
    ) AS branch_ids,
    COALESCE(
      (SELECT array_agg(br.name ORDER BY mb.is_default DESC)
       FROM public.membership_branches mb
       JOIN public.branches br ON br.id = mb.branch_id AND br.tenant_id = mb.tenant_id
       WHERE mb.tenant_id = tm.tenant_id AND mb.membership_id = tm.id),
      ARRAY[]::text[]
    ) AS branch_names,
    tm.created_at
  FROM public.tenant_memberships tm
  JOIN public.profiles p ON p.id = tm.user_id
  LEFT JOIN public.membership_roles mr
    ON mr.tenant_id = tm.tenant_id AND mr.membership_id = tm.id AND mr.is_primary = true
  LEFT JOIN public.roles r
    ON r.tenant_id = tm.tenant_id AND r.id = mr.role_id
  LEFT JOIN public.account_subjects asub
    ON asub.tenant_id = tm.tenant_id AND asub.membership_id = tm.id
  LEFT JOIN public.clients cl
    ON cl.tenant_id = tm.tenant_id AND cl.id = asub.client_id
  WHERE tm.tenant_id = p_tenant_id
  ORDER BY
    CASE WHEN tm.role_key = 'company_owner' THEN 0 ELSE 1 END,
    tm.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_tenant_users_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tenant_users_directory(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_tenant_session_audit(
  p_tenant_id uuid,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  user_id uuid,
  username text,
  display_name text,
  event_type text,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
BEGIN
  IF NOT (
    app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_has_permission(p_tenant_id, 'sessions.audit.read', NULL)
  ) THEN
    RAISE EXCEPTION 'Forbidden: sessions.audit.read permission required';
  END IF;

  RETURN QUERY
  SELECT
    usa.id,
    usa.tenant_id,
    usa.user_id,
    tm.username,
    p.display_name,
    usa.event_type,
    usa.metadata,
    usa.created_at
  FROM audit.user_sessions_audit usa
  LEFT JOIN public.tenant_memberships tm
    ON tm.tenant_id = usa.tenant_id AND tm.user_id = usa.user_id
  LEFT JOIN public.profiles p
    ON p.id = usa.user_id
  WHERE usa.tenant_id = p_tenant_id
  ORDER BY usa.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.list_tenant_session_audit(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_tenant_session_audit(uuid, integer) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Service-Role Wrappers for Edge Function `tenant-manage-users`
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.srv_provision_tenant_user(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_new_user_id uuid,
  p_username text,
  p_display_name text,
  p_auth_email text,
  p_role_id uuid,
  p_client_id uuid DEFAULT NULL,
  p_branch_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_clean_username text := lower(trim(p_username));
  v_clean_email text := lower(trim(p_auth_email));
  v_role public.roles%ROWTYPE;
  v_membership_id uuid;
  v_branch_id uuid;
  v_idx integer := 0;
BEGIN
  SELECT * INTO v_role
  FROM public.roles
  WHERE id = p_role_id AND tenant_id = p_tenant_id AND is_active = true;

  IF v_role.id IS NULL THEN
    RAISE EXCEPTION 'Role not found or inactive for tenant';
  END IF;

  IF v_role.default_subject_type = 'client' AND p_client_id IS NULL THEN
    RAISE EXCEPTION 'Client selection is required for client roles';
  END IF;

  IF p_client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients WHERE id = p_client_id AND tenant_id = p_tenant_id AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Selected client does not belong to this tenant';
  END IF;

  INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
  VALUES (p_new_user_id, trim(p_display_name), false, true)
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        is_active = true;

  INSERT INTO public.tenant_memberships (
    tenant_id, user_id, username, account_subject_type, role_key,
    is_active, must_change_password, created_by, updated_by
  )
  VALUES (
    p_tenant_id, p_new_user_id, v_clean_username, v_role.default_subject_type, v_role.code,
    true, true, p_actor_user_id, p_actor_user_id
  )
  RETURNING id INTO v_membership_id;

  INSERT INTO app_private.auth_identities (user_id, scope_type, tenant_id, username, auth_email, is_active)
  VALUES (p_new_user_id, 'tenant', p_tenant_id, v_clean_username, v_clean_email, true);

  INSERT INTO public.membership_roles (tenant_id, membership_id, role_id, is_primary, created_by)
  VALUES (p_tenant_id, v_membership_id, v_role.id, true, p_actor_user_id);

  INSERT INTO public.account_subjects (
    tenant_id, membership_id, subject_type, client_id, courier_id, is_active, created_by, updated_by
  )
  VALUES (
    p_tenant_id,
    v_membership_id,
    v_role.default_subject_type,
    CASE WHEN v_role.default_subject_type = 'client' THEN p_client_id ELSE NULL END,
    NULL,
    true,
    p_actor_user_id,
    p_actor_user_id
  );

  IF p_branch_ids IS NOT NULL THEN
    FOREACH v_branch_id IN ARRAY p_branch_ids LOOP
      v_idx := v_idx + 1;
      INSERT INTO public.membership_branches (tenant_id, membership_id, branch_id, is_default, created_by)
      VALUES (p_tenant_id, v_membership_id, v_branch_id, (v_idx = 1), p_actor_user_id)
      ON CONFLICT (tenant_id, membership_id, branch_id) DO NOTHING;
    END LOOP;
  END IF;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id,
    p_actor_user_id,
    'tenant_user.created',
    'tenant_memberships',
    v_membership_id,
    jsonb_build_object(
      'username', v_clean_username,
      'role_code', v_role.code,
      'subject_type', v_role.default_subject_type,
      'client_id', p_client_id,
      'branch_count', v_idx
    ),
    'edge_function'
  );

  RETURN v_membership_id;
END;
$$;

REVOKE ALL ON FUNCTION public.srv_provision_tenant_user(uuid, uuid, uuid, text, text, text, uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_provision_tenant_user(uuid, uuid, uuid, text, text, text, uuid, uuid, uuid[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.srv_update_tenant_user_assignment(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_display_name text,
  p_role_id uuid,
  p_client_id uuid DEFAULT NULL,
  p_branch_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_existing public.tenant_memberships%ROWTYPE;
  v_role public.roles%ROWTYPE;
  v_branch_id uuid;
  v_idx integer := 0;
BEGIN
  SELECT * INTO v_existing
  FROM public.tenant_memberships
  WHERE id = p_membership_id AND tenant_id = p_tenant_id;

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'Membership not found';
  END IF;

  SELECT * INTO v_role
  FROM public.roles
  WHERE id = p_role_id AND tenant_id = p_tenant_id AND is_active = true;

  IF v_role.id IS NULL THEN
    RAISE EXCEPTION 'Target role not found';
  END IF;

  IF v_existing.role_key = 'company_owner' AND v_role.code <> 'company_owner' THEN
    RAISE EXCEPTION 'Cannot downgrade company_owner role';
  END IF;

  IF v_role.default_subject_type = 'client' AND p_client_id IS NULL THEN
    RAISE EXCEPTION 'Client selection is required for client roles';
  END IF;

  UPDATE public.profiles
  SET display_name = trim(p_display_name)
  WHERE id = v_existing.user_id;

  UPDATE public.tenant_memberships
  SET role_key = v_role.code,
      account_subject_type = v_role.default_subject_type,
      updated_by = p_actor_user_id
  WHERE id = v_existing.id AND tenant_id = p_tenant_id;

  DELETE FROM public.membership_roles
  WHERE tenant_id = p_tenant_id AND membership_id = v_existing.id AND is_primary = true;

  INSERT INTO public.membership_roles (tenant_id, membership_id, role_id, is_primary, created_by)
  VALUES (p_tenant_id, v_existing.id, v_role.id, true, p_actor_user_id)
  ON CONFLICT (tenant_id, membership_id, role_id) DO UPDATE SET is_primary = true;

  INSERT INTO public.account_subjects (
    tenant_id, membership_id, subject_type, client_id, courier_id, is_active, created_by, updated_by
  )
  VALUES (
    p_tenant_id,
    v_existing.id,
    v_role.default_subject_type,
    CASE WHEN v_role.default_subject_type = 'client' THEN p_client_id ELSE NULL END,
    NULL,
    true,
    p_actor_user_id,
    p_actor_user_id
  )
  ON CONFLICT (tenant_id, membership_id) DO UPDATE
    SET subject_type = EXCLUDED.subject_type,
        client_id = EXCLUDED.client_id,
        updated_by = p_actor_user_id;

  DELETE FROM public.membership_branches
  WHERE tenant_id = p_tenant_id AND membership_id = v_existing.id;

  IF p_branch_ids IS NOT NULL THEN
    FOREACH v_branch_id IN ARRAY p_branch_ids LOOP
      v_idx := v_idx + 1;
      INSERT INTO public.membership_branches (tenant_id, membership_id, branch_id, is_default, created_by)
      VALUES (p_tenant_id, v_existing.id, v_branch_id, (v_idx = 1), p_actor_user_id)
      ON CONFLICT (tenant_id, membership_id, branch_id) DO NOTHING;
    END LOOP;
  END IF;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id,
    p_actor_user_id,
    'tenant_user.updated',
    'tenant_memberships',
    v_existing.id,
    jsonb_build_object('role_code', v_role.code, 'subject_type', v_role.default_subject_type, 'client_id', p_client_id),
    'edge_function'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.srv_update_tenant_user_assignment(uuid, uuid, uuid, text, uuid, uuid, uuid[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_update_tenant_user_assignment(uuid, uuid, uuid, text, uuid, uuid, uuid[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.srv_set_tenant_user_status(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid,
  p_is_active boolean
)
RETURNS TABLE (
  target_user_id uuid,
  other_active_tenants_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_existing public.tenant_memberships%ROWTYPE;
  v_other_count integer := 0;
BEGIN
  SELECT * INTO v_existing
  FROM public.tenant_memberships
  WHERE id = p_membership_id AND tenant_id = p_tenant_id;

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'Membership not found';
  END IF;

  IF v_existing.role_key = 'company_owner' AND NOT p_is_active THEN
    RAISE EXCEPTION 'Cannot deactivate company_owner';
  END IF;

  UPDATE public.tenant_memberships
  SET is_active = p_is_active,
      updated_by = p_actor_user_id
  WHERE id = v_existing.id AND tenant_id = p_tenant_id;

  UPDATE app_private.auth_identities
  SET is_active = p_is_active
  WHERE tenant_id = p_tenant_id
    AND user_id = v_existing.user_id
    AND scope_type = 'tenant';

  UPDATE public.account_subjects
  SET is_active = p_is_active,
      updated_by = p_actor_user_id
  WHERE tenant_id = p_tenant_id AND membership_id = v_existing.id;

  SELECT count(*)::integer INTO v_other_count
  FROM public.tenant_memberships
  WHERE user_id = v_existing.user_id
    AND tenant_id <> p_tenant_id
    AND is_active = true;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id,
    p_actor_user_id,
    CASE WHEN p_is_active THEN 'tenant_user.activated' ELSE 'tenant_user.deactivated' END,
    'tenant_memberships',
    v_existing.id,
    jsonb_build_object('username', v_existing.username, 'is_active', p_is_active),
    'edge_function'
  );

  RETURN QUERY SELECT v_existing.user_id, v_other_count;
END;
$$;

REVOKE ALL ON FUNCTION public.srv_set_tenant_user_status(uuid, uuid, uuid, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_set_tenant_user_status(uuid, uuid, uuid, boolean)
  TO service_role;

CREATE OR REPLACE FUNCTION public.srv_mark_tenant_user_password_reset(
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_membership_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_existing public.tenant_memberships%ROWTYPE;
BEGIN
  SELECT * INTO v_existing
  FROM public.tenant_memberships
  WHERE id = p_membership_id AND tenant_id = p_tenant_id;

  IF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'Membership not found';
  END IF;

  UPDATE public.tenant_memberships
  SET must_change_password = true,
      updated_by = p_actor_user_id
  WHERE id = v_existing.id AND tenant_id = p_tenant_id;

  INSERT INTO audit.user_sessions_audit (tenant_id, user_id, event_type, metadata)
  VALUES (
    p_tenant_id,
    v_existing.user_id,
    'credentials_updated',
    jsonb_build_object('reset_by_admin', p_actor_user_id, 'username', v_existing.username)
  );

  RETURN v_existing.user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.srv_mark_tenant_user_password_reset(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.srv_mark_tenant_user_password_reset(uuid, uuid, uuid)
  TO service_role;

-- ----------------------------------------------------------------------------
-- 7. Row Level Security for Phase 4 Tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.membership_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_roles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.membership_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_branches FORCE ROW LEVEL SECURITY;

ALTER TABLE public.account_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_subjects FORCE ROW LEVEL SECURITY;

CREATE POLICY permissions_select_policy ON public.permissions
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY roles_select_policy ON public.roles
  FOR SELECT TO authenticated
  USING (app_private.current_user_is_platform_admin() OR app_private.user_belongs_to_tenant(tenant_id));

CREATE POLICY roles_write_policy ON public.roles
  FOR ALL TO authenticated
  USING (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'roles.manage', NULL)
  )
  WITH CHECK (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'roles.manage', NULL)
  );

CREATE POLICY role_permissions_select_policy ON public.role_permissions
  FOR SELECT TO authenticated
  USING (app_private.current_user_is_platform_admin() OR app_private.user_belongs_to_tenant(tenant_id));

CREATE POLICY role_permissions_write_policy ON public.role_permissions
  FOR ALL TO authenticated
  USING (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'roles.manage', NULL)
  )
  WITH CHECK (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'roles.manage', NULL)
  );

CREATE POLICY membership_roles_select_policy ON public.membership_roles
  FOR SELECT TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR app_private.user_belongs_to_tenant(tenant_id)
  );

CREATE POLICY membership_roles_write_policy ON public.membership_roles
  FOR ALL TO authenticated
  USING (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'users.manage', NULL)
  )
  WITH CHECK (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'users.manage', NULL)
  );

CREATE POLICY membership_branches_select_policy ON public.membership_branches
  FOR SELECT TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR app_private.user_belongs_to_tenant(tenant_id)
  );

CREATE POLICY membership_branches_write_policy ON public.membership_branches
  FOR ALL TO authenticated
  USING (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'users.manage', NULL)
  )
  WITH CHECK (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'users.manage', NULL)
  );

CREATE POLICY account_subjects_select_policy ON public.account_subjects
  FOR SELECT TO authenticated
  USING (
    app_private.current_user_is_platform_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'users.read', NULL)
    OR EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.id = account_subjects.membership_id
        AND tm.tenant_id = account_subjects.tenant_id
        AND tm.user_id = auth.uid()
    )
  );

CREATE POLICY account_subjects_write_policy ON public.account_subjects
  FOR ALL TO authenticated
  USING (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'users.manage', NULL)
  )
  WITH CHECK (
    app_private.current_user_is_platform_super_admin()
    OR app_private.user_is_tenant_admin(tenant_id)
    OR app_private.user_has_permission(tenant_id, 'users.manage', NULL)
  );

-- ----------------------------------------------------------------------------
-- 8. Atomic & Idempotent Phase 4 Default Seeding + Backfill
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.seed_tenant_phase4_defaults(
  p_tenant_id uuid,
  p_actor_user_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_owner_role_id uuid;
  v_admin_role_id uuid;
  v_branch_mgr_id uuid;
  v_accountant_id uuid;
  v_cashier_id uuid;
  v_ops_mgr_id uuid;
  v_data_entry_id uuid;
  v_support_id uuid;
  v_wh_op_id uuid;
  v_courier_id uuid;
  v_client_owner_id uuid;
  v_client_staff_id uuid;
  v_tm record;
  v_role_id uuid;
BEGIN
  -- 1. Seed 12 Core System Roles
  INSERT INTO public.roles (
    tenant_id, code, name, description, default_subject_type, default_scope, is_system, is_active, created_by, updated_by
  )
  VALUES
    (p_tenant_id, 'company_owner', 'مالك الشركة', 'صلاحيات كاملة شاملة على الشركة والفروع والأمان والمالية.', 'staff', 'tenant', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'company_admin', 'مدير النظام (أدمن)', 'إدارة التشغيل والعملاء والمستخدمين والأسعار.', 'staff', 'tenant', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'branch_manager', 'مدير فرع', 'إدارة الشحنات والعمليات والتحصيلات ضمن الفروع المسندة.', 'staff', 'branch', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'accountant', 'محاسب', 'القيود المحاسبية واعتماد التسويات والعمولات.', 'staff', 'tenant', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'cashier', 'أمين خزينة', 'استلام وتوريد النقدية وسندات القبض والصرف.', 'staff', 'branch', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'operations_manager', 'مدير العمليات', 'إدارة قوائم الالتقاط والتوصيل والمرتجعات والمناديب.', 'staff', 'tenant', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'data_entry', 'مدخل بيانات', 'إنشاء الشحنات ومتابعة العملاء.', 'staff', 'branch', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'customer_support', 'دعم العملاء', 'متابعة الشحنات والاستثناءات وخدمة العملاء.', 'staff', 'tenant', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'warehouse_operator', 'موظف مخزن', 'استلام الشحنات وتعديل الوزن وإدارة المخزون.', 'staff', 'branch', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'delivery_agent', 'مندوب توصيل', 'تنفيذ مهام الالتقاط والتوصيل وتحصيل الـ COD.', 'courier', 'assigned', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'client_owner', 'صاحب حساب عميل (تاجر)', 'إدارة شحنات وطلبات التاجر وكشف حسابه بالكامل.', 'client', 'own', true, true, p_actor_user_id, p_actor_user_id),
    (p_tenant_id, 'client_staff', 'موظف عميل (تاجر)', 'إنشاء ومتابعة شحنات المتجر المرتبط.', 'client', 'own', true, true, p_actor_user_id, p_actor_user_id)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  SELECT id INTO v_owner_role_id FROM public.roles WHERE tenant_id = p_tenant_id AND code = 'company_owner';
  SELECT id INTO v_admin_role_id FROM public.roles WHERE tenant_id = p_tenant_id AND code = 'company_admin';
  SELECT id INTO v_branch_mgr_id FROM public.roles WHERE tenant_id = p_tenant_id AND code = 'branch_manager';
  SELECT id INTO v_accountant_id FROM public.roles WHERE tenant_id = p_tenant_id AND code = 'accountant';
  SELECT id INTO v_cashier_id FROM public.roles WHERE tenant_id = p_tenant_id AND code = 'cashier';
  SELECT id INTO v_ops_mgr_id FROM public.roles WHERE tenant_id = p_tenant_id AND code = 'operations_manager';
  SELECT id INTO v_data_entry_id FROM public.roles WHERE tenant_id = p_tenant_id AND code = 'data_entry';
  SELECT id INTO v_support_id FROM public.roles WHERE tenant_id = p_tenant_id AND code = 'customer_support';
  SELECT id INTO v_wh_op_id FROM public.roles WHERE tenant_id = p_tenant_id AND code = 'warehouse_operator';
  SELECT id INTO v_courier_id FROM public.roles WHERE tenant_id = p_tenant_id AND code = 'delivery_agent';
  SELECT id INTO v_client_owner_id FROM public.roles WHERE tenant_id = p_tenant_id AND code = 'client_owner';
  SELECT id INTO v_client_staff_id FROM public.roles WHERE tenant_id = p_tenant_id AND code = 'client_staff';

  -- 2. Default Role Permissions (idempotent)
  INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, scope, created_by)
  SELECT p_tenant_id, v_owner_role_id, key, 'tenant', p_actor_user_id FROM public.permissions
  ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

  INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, scope, created_by)
  SELECT p_tenant_id, v_admin_role_id, key, default_scope, p_actor_user_id
  FROM public.permissions
  WHERE key <> 'roles.manage'
  ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

  INSERT INTO public.role_permissions (tenant_id, role_id, permission_key, scope, created_by)
  VALUES
    (p_tenant_id, v_branch_mgr_id, 'dashboard.view', 'branch', p_actor_user_id),
    (p_tenant_id, v_branch_mgr_id, 'clients.read', 'tenant', p_actor_user_id),
    (p_tenant_id, v_branch_mgr_id, 'couriers.read', 'branch', p_actor_user_id),
    (p_tenant_id, v_branch_mgr_id, 'shipments.read', 'branch', p_actor_user_id),
    (p_tenant_id, v_branch_mgr_id, 'shipments.create', 'branch', p_actor_user_id),
    (p_tenant_id, v_branch_mgr_id, 'shipments.update_draft', 'branch', p_actor_user_id),
    (p_tenant_id, v_branch_mgr_id, 'operations.pickup.approve', 'branch', p_actor_user_id),
    (p_tenant_id, v_branch_mgr_id, 'finance.collections.create', 'branch', p_actor_user_id),

    (p_tenant_id, v_accountant_id, 'dashboard.view', 'tenant', p_actor_user_id),
    (p_tenant_id, v_accountant_id, 'definitions.read', 'tenant', p_actor_user_id),
    (p_tenant_id, v_accountant_id, 'clients.read', 'tenant', p_actor_user_id),
    (p_tenant_id, v_accountant_id, 'pricing.read', 'tenant', p_actor_user_id),
    (p_tenant_id, v_accountant_id, 'finance.collections.approve', 'tenant', p_actor_user_id),
    (p_tenant_id, v_accountant_id, 'finance.payouts.approve', 'tenant', p_actor_user_id),
    (p_tenant_id, v_accountant_id, 'accounting.journals.post', 'tenant', p_actor_user_id),

    (p_tenant_id, v_cashier_id, 'dashboard.view', 'branch', p_actor_user_id),
    (p_tenant_id, v_cashier_id, 'finance.collections.create', 'branch', p_actor_user_id),
    (p_tenant_id, v_cashier_id, 'finance.collections.approve', 'branch', p_actor_user_id),

    (p_tenant_id, v_ops_mgr_id, 'dashboard.view', 'tenant', p_actor_user_id),
    (p_tenant_id, v_ops_mgr_id, 'couriers.read', 'tenant', p_actor_user_id),
    (p_tenant_id, v_ops_mgr_id, 'couriers.manage', 'tenant', p_actor_user_id),
    (p_tenant_id, v_ops_mgr_id, 'shipments.read', 'tenant', p_actor_user_id),
    (p_tenant_id, v_ops_mgr_id, 'shipments.update_draft', 'tenant', p_actor_user_id),
    (p_tenant_id, v_ops_mgr_id, 'operations.pickup.approve', 'tenant', p_actor_user_id),

    (p_tenant_id, v_data_entry_id, 'clients.read', 'tenant', p_actor_user_id),
    (p_tenant_id, v_data_entry_id, 'clients.create', 'tenant', p_actor_user_id),
    (p_tenant_id, v_data_entry_id, 'shipments.read', 'branch', p_actor_user_id),
    (p_tenant_id, v_data_entry_id, 'shipments.create', 'branch', p_actor_user_id),
    (p_tenant_id, v_data_entry_id, 'shipments.update_draft', 'branch', p_actor_user_id),

    (p_tenant_id, v_support_id, 'clients.read', 'tenant', p_actor_user_id),
    (p_tenant_id, v_support_id, 'shipments.read', 'tenant', p_actor_user_id),
    (p_tenant_id, v_support_id, 'shipments.update_draft', 'tenant', p_actor_user_id),

    (p_tenant_id, v_wh_op_id, 'shipments.read', 'branch', p_actor_user_id),
    (p_tenant_id, v_wh_op_id, 'shipments.update_draft', 'branch', p_actor_user_id),
    (p_tenant_id, v_wh_op_id, 'operations.pickup.approve', 'branch', p_actor_user_id),

    (p_tenant_id, v_courier_id, 'shipments.read', 'assigned', p_actor_user_id),
    (p_tenant_id, v_courier_id, 'operations.delivery.execute', 'assigned', p_actor_user_id),

    (p_tenant_id, v_client_owner_id, 'dashboard.view', 'own', p_actor_user_id),
    (p_tenant_id, v_client_owner_id, 'shipments.read', 'own', p_actor_user_id),
    (p_tenant_id, v_client_owner_id, 'shipments.create', 'own', p_actor_user_id),
    (p_tenant_id, v_client_owner_id, 'api_tokens.create', 'own', p_actor_user_id),

    (p_tenant_id, v_client_staff_id, 'dashboard.view', 'own', p_actor_user_id),
    (p_tenant_id, v_client_staff_id, 'shipments.read', 'own', p_actor_user_id),
    (p_tenant_id, v_client_staff_id, 'shipments.create', 'own', p_actor_user_id)
  ON CONFLICT (tenant_id, role_id, permission_key) DO NOTHING;

  -- 3. Backfill membership_roles & account_subjects for existing memberships
  FOR v_tm IN
    SELECT id, role_key, account_subject_type
    FROM public.tenant_memberships
    WHERE tenant_id = p_tenant_id
  LOOP
    SELECT id INTO v_role_id
    FROM public.roles
    WHERE tenant_id = p_tenant_id AND code = v_tm.role_key
    LIMIT 1;

    IF v_role_id IS NOT NULL THEN
      INSERT INTO public.membership_roles (tenant_id, membership_id, role_id, is_primary, created_by)
      VALUES (p_tenant_id, v_tm.id, v_role_id, true, p_actor_user_id)
      ON CONFLICT (tenant_id, membership_id, role_id) DO NOTHING;
    END IF;

    IF v_tm.account_subject_type <> 'client' THEN
      INSERT INTO public.account_subjects (
        tenant_id, membership_id, subject_type, client_id, courier_id, is_active, created_by, updated_by
      )
      VALUES (
        p_tenant_id, v_tm.id, v_tm.account_subject_type, NULL, NULL, true, p_actor_user_id, p_actor_user_id
      )
      ON CONFLICT (tenant_id, membership_id) DO NOTHING;
    END IF;
  END LOOP;

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    p_tenant_id, p_actor_user_id, 'tenant.phase4_defaults_seeded', 'tenants', p_tenant_id,
    jsonb_build_object('system_roles_count', 12),
    'migration_seed'
  );
END;
$$;

REVOKE ALL ON FUNCTION app_private.seed_tenant_phase4_defaults(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Hook Phase 4 seeding into app_private.onboard_tenant
CREATE OR REPLACE FUNCTION app_private.onboard_tenant(
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_code text,
  p_slug text,
  p_name text,
  p_owner_user_id uuid,
  p_owner_username text,
  p_owner_display_name text,
  p_owner_email text,
  p_owner_email_masked text
)
RETURNS TABLE (
  tenant_id uuid,
  membership_id uuid,
  already_existed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private, audit
AS $$
DECLARE
  v_existing_tenant_id uuid;
  v_existing_membership_id uuid;
  v_tenant_id uuid;
  v_membership_id uuid;
  v_clean_slug text := lower(trim(p_slug));
  v_clean_code text := upper(trim(p_code));
  v_clean_username text := lower(trim(p_owner_username));
  v_clean_email text := lower(trim(p_owner_email));
BEGIN
  SELECT to_rec.tenant_id INTO v_existing_tenant_id
  FROM public.tenant_onboarding to_rec
  WHERE to_rec.idempotency_key = p_idempotency_key;

  IF v_existing_tenant_id IS NOT NULL THEN
    PERFORM app_private.seed_tenant_phase2_defaults(v_existing_tenant_id, p_actor_user_id);
    PERFORM app_private.seed_tenant_phase3_defaults(v_existing_tenant_id, p_actor_user_id);
    PERFORM app_private.seed_tenant_phase4_defaults(v_existing_tenant_id, p_actor_user_id);

    SELECT tm.id INTO v_existing_membership_id
    FROM public.tenant_memberships tm
    WHERE tm.tenant_id = v_existing_tenant_id
      AND tm.role_key = 'company_owner'
    LIMIT 1;

    RETURN QUERY SELECT v_existing_tenant_id, v_existing_membership_id, true;
    RETURN;
  END IF;

  INSERT INTO public.tenants (code, slug, name, status, created_by, updated_by)
  VALUES (v_clean_code, v_clean_slug, trim(p_name), 'active', p_actor_user_id, p_actor_user_id)
  RETURNING id INTO v_tenant_id;

  INSERT INTO public.tenant_settings (tenant_id, allow_client_self_registration, auto_approve_clients, updated_by)
  VALUES (v_tenant_id, false, false, p_actor_user_id);

  INSERT INTO public.tenant_onboarding (tenant_id, idempotency_key, step_status, created_by)
  VALUES (v_tenant_id, p_idempotency_key, 'phase1_initialized', p_actor_user_id);

  INSERT INTO public.profiles (id, display_name, is_platform_user, is_active)
  VALUES (p_owner_user_id, trim(p_owner_display_name), false, true)
  ON CONFLICT (id) DO UPDATE
    SET display_name = EXCLUDED.display_name,
        is_active = true;

  INSERT INTO public.tenant_memberships (
    tenant_id, user_id, username, account_subject_type, role_key,
    is_active, must_change_password, created_by, updated_by
  )
  VALUES (
    v_tenant_id, p_owner_user_id, v_clean_username, 'staff', 'company_owner',
    true, true, p_actor_user_id, p_actor_user_id
  )
  RETURNING id INTO v_membership_id;

  INSERT INTO app_private.auth_identities (user_id, scope_type, tenant_id, username, auth_email, is_active)
  VALUES (p_owner_user_id, 'tenant', v_tenant_id, v_clean_username, v_clean_email, true);

  INSERT INTO public.invitations (
    tenant_id, user_id, username, email_masked, role_key, status, expires_at, created_by
  )
  VALUES (
    v_tenant_id, p_owner_user_id, v_clean_username, p_owner_email_masked, 'company_owner',
    'pending', now() + interval '7 days', p_actor_user_id
  );

  PERFORM app_private.seed_tenant_phase2_defaults(v_tenant_id, p_actor_user_id);
  PERFORM app_private.seed_tenant_phase3_defaults(v_tenant_id, p_actor_user_id);
  PERFORM app_private.seed_tenant_phase4_defaults(v_tenant_id, p_actor_user_id);

  INSERT INTO audit.audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, after_data, source)
  VALUES (
    v_tenant_id,
    p_actor_user_id,
    'tenant.onboarded',
    'tenants',
    v_tenant_id,
    jsonb_build_object('code', v_clean_code, 'slug', v_clean_slug, 'owner_username', v_clean_username),
    'edge_function'
  );

  RETURN QUERY SELECT v_tenant_id, v_membership_id, false;
END;
$$;

-- Safe Backfill for all existing tenants
DO $$
DECLARE
  v_tenant record;
BEGIN
  FOR v_tenant IN SELECT id, created_by FROM public.tenants LOOP
    PERFORM app_private.seed_tenant_phase4_defaults(v_tenant.id, v_tenant.created_by);
  END LOOP;
END $$;
