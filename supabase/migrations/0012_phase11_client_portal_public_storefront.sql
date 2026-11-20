-- ============================================================================
-- Migration 0012: Phase 11 - Client Portal, Pickup Requests & Public Storefront
-- ============================================================================
-- Implements:
-- 1. Fix app_private.user_has_permission for client accounts with 'own' scope
--    when branch_id is passed into create_shipment or detail queries.
-- 2. Harden RLS SELECT policies on clients, client_addresses, client_contacts,
--    client_contract_terms, price_exemptions, shipment_price_snapshots, and
--    journal_entries so bound client users see ONLY their own merchant record.
-- 3. Extend tenant_settings with public storefront contact/tagline fields.
-- 4. Create client_pickup_requests (REQ-XXXXXX) with FORCE ROW LEVEL SECURITY.
-- 5. Public storefront & self-registration RPCs (anon/authenticated safe).
-- 6. Client portal self-service RPCs (addresses, pickup requests, dashboard KPIs,
--    account statement & settlement tracking).
-- ============================================================================

GRANT USAGE ON SCHEMA app_private TO authenticated, anon;

-- ----------------------------------------------------------------------------
-- 1. Fix Permission Scope Helper for Client Accounts ('own' scope)
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
    JOIN public.profiles pr ON pr.id = tm.user_id AND pr.is_active = true
    JOIN public.tenants t ON t.id = tm.tenant_id AND t.status = 'active'
    JOIN public.roles r ON r.tenant_id = tm.tenant_id AND r.code = tm.role_key AND r.is_active = true
    WHERE tm.tenant_id = p_tenant_id
      AND tm.user_id = auth.uid()
      AND tm.is_active = true
      AND (
        tm.role_key = 'company_owner'
        OR EXISTS (
          SELECT 1
          FROM public.role_permissions rp
          WHERE rp.tenant_id = tm.tenant_id
            AND rp.role_id = r.id
            AND rp.permission_key = p_permission_key
            AND (
              p_branch_id IS NULL
              OR rp.scope = 'tenant'
              OR (rp.scope = 'own' AND tm.account_subject_type = 'client')
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

REVOKE ALL ON FUNCTION app_private.user_has_permission(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.user_has_permission(uuid, text, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Harden RLS Policies Against Cross-Client Data Leakage
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS clients_select_policy ON public.clients;
CREATE POLICY clients_select_policy ON public.clients
  FOR SELECT USING (
    (
      app_private.user_get_bound_client_id(tenant_id) IS NULL
      AND app_private.user_belongs_to_tenant(tenant_id)
    )
    OR id = app_private.user_get_bound_client_id(tenant_id)
  );

DROP POLICY IF EXISTS client_addresses_select_policy ON public.client_addresses;
CREATE POLICY client_addresses_select_policy ON public.client_addresses
  FOR SELECT USING (
    (
      app_private.user_get_bound_client_id(tenant_id) IS NULL
      AND app_private.user_belongs_to_tenant(tenant_id)
    )
    OR client_id = app_private.user_get_bound_client_id(tenant_id)
  );

DROP POLICY IF EXISTS client_contacts_select_policy ON public.client_contacts;
CREATE POLICY client_contacts_select_policy ON public.client_contacts
  FOR SELECT USING (
    (
      app_private.user_get_bound_client_id(tenant_id) IS NULL
      AND app_private.user_belongs_to_tenant(tenant_id)
    )
    OR client_id = app_private.user_get_bound_client_id(tenant_id)
  );

DROP POLICY IF EXISTS client_contract_terms_select_policy ON public.client_contract_terms;
CREATE POLICY client_contract_terms_select_policy ON public.client_contract_terms
  FOR SELECT USING (
    (
      app_private.user_get_bound_client_id(tenant_id) IS NULL
      AND app_private.user_belongs_to_tenant(tenant_id)
    )
    OR client_id = app_private.user_get_bound_client_id(tenant_id)
  );

DROP POLICY IF EXISTS price_exemptions_select_policy ON public.price_exemptions;
CREATE POLICY price_exemptions_select_policy ON public.price_exemptions
  FOR SELECT USING (
    (
      app_private.user_get_bound_client_id(tenant_id) IS NULL
      AND app_private.user_belongs_to_tenant(tenant_id)
    )
    OR client_id = app_private.user_get_bound_client_id(tenant_id)
  );

DROP POLICY IF EXISTS shipment_price_snapshots_select_policy ON public.shipment_price_snapshots;
CREATE POLICY shipment_price_snapshots_select_policy ON public.shipment_price_snapshots
  FOR SELECT USING (
    (
      app_private.user_get_bound_client_id(tenant_id) IS NULL
      AND app_private.user_belongs_to_tenant(tenant_id)
    )
    OR client_id = app_private.user_get_bound_client_id(tenant_id)
  );

DROP POLICY IF EXISTS tenant_isolation_journal_entries ON public.journal_entries;
CREATE POLICY tenant_isolation_journal_entries ON public.journal_entries
  FOR SELECT USING (
    app_private.user_get_bound_client_id(tenant_id) IS NULL
    AND app_private.user_belongs_to_tenant(tenant_id)
  );

DROP POLICY IF EXISTS tenant_isolation_journal_entry_lines ON public.journal_entry_lines;
CREATE POLICY tenant_isolation_journal_entry_lines ON public.journal_entry_lines
  FOR SELECT USING (
    app_private.user_get_bound_client_id(tenant_id) IS NULL
    AND app_private.user_belongs_to_tenant(tenant_id)
  );

-- ----------------------------------------------------------------------------
-- 3. Extend tenant_settings with Public Storefront Metadata
-- ----------------------------------------------------------------------------
ALTER TABLE public.tenant_settings
  ADD COLUMN IF NOT EXISTS public_tagline text,
  ADD COLUMN IF NOT EXISTS public_support_phone text,
  ADD COLUMN IF NOT EXISTS public_support_email text;

-- ----------------------------------------------------------------------------
-- 4. Update Numbering Sequences for Client Pickup Requests & Auto Clients
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.next_document_number(
  p_tenant_id uuid,
  p_entity_key text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_seq public.numbering_sequences%ROWTYPE;
  v_formatted text;
  v_default_prefix text;
  v_default_padding integer;
BEGIN
  SELECT * INTO v_seq
  FROM public.numbering_sequences
  WHERE tenant_id = p_tenant_id
    AND entity_key = p_entity_key
  FOR UPDATE;

  IF v_seq.id IS NULL THEN
    v_default_prefix := CASE p_entity_key
      WHEN 'shipments' THEN 'SHP'
      WHEN 'pickup_lists' THEN 'PKP'
      WHEN 'warehouse_manifests' THEN 'WRH'
      WHEN 'transfer_lists' THEN 'TRF'
      WHEN 'delivery_lists' THEN 'DLV'
      WHEN 'redelivery_lists' THEN 'RDL'
      WHEN 'courier_return_handovers' THEN 'RTH'
      WHEN 'return_dispatch_lists' THEN 'RTD'
      WHEN 'return_lists' THEN 'RTN'
      WHEN 'courier_collections' THEN 'COL'
      WHEN 'client_settlements' THEN 'CST'
      WHEN 'courier_commission_payouts' THEN 'CMP'
      WHEN 'cashbox_transfers' THEN 'CTR'
      WHEN 'cashbox_transactions' THEN 'CTX'
      WHEN 'receipt_vouchers' THEN 'RCV'
      WHEN 'payment_vouchers' THEN 'PAY'
      WHEN 'journal_entries' THEN 'JENT'
      WHEN 'client_pickup_requests' THEN 'REQ'
      WHEN 'clients' THEN 'CL'
      ELSE upper(left(p_entity_key, 3))
    END;

    v_default_padding := CASE
      WHEN p_entity_key = 'shipments' THEN 7
      WHEN p_entity_key = 'clients' THEN 4
      ELSE 6
    END;

    INSERT INTO public.numbering_sequences (tenant_id, entity_key, label, prefix, next_number, padding_length)
    VALUES (p_tenant_id, p_entity_key, p_entity_key, v_default_prefix, 1, v_default_padding)
    RETURNING * INTO v_seq;
  END IF;

  v_formatted := v_seq.prefix || '-' || lpad(v_seq.next_number::text, v_seq.padding_length, '0');

  UPDATE public.numbering_sequences
  SET next_number = v_seq.next_number + 1
  WHERE id = v_seq.id;

  RETURN v_formatted;
END;
$$;

REVOKE ALL ON FUNCTION app_private.next_document_number(uuid, text) FROM PUBLIC, anon, authenticated;

INSERT INTO public.numbering_sequences (tenant_id, entity_key, label, prefix, next_number, padding_length)
SELECT t.id, s.entity_key, s.label, s.prefix, 1, s.padding_length
FROM public.tenants t
CROSS JOIN (
  VALUES
    ('client_pickup_requests', 'طلبات الالتقاط من التجار', 'REQ', 6),
    ('clients', 'أكواد العملاء التلقائية', 'CL', 4)
) AS s(entity_key, label, prefix, padding_length)
ON CONFLICT (tenant_id, entity_key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. Client Pickup Requests Table + FORCE ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_pickup_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  request_code text NOT NULL CHECK (char_length(trim(request_code)) >= 4),
  client_id uuid NOT NULL,
  address_id uuid,
  branch_id uuid,
  governorate_id uuid NOT NULL,
  region_id uuid,
  pickup_address text NOT NULL CHECK (char_length(trim(pickup_address)) >= 3),
  contact_phone text NOT NULL CHECK (char_length(trim(contact_phone)) >= 4),
  preferred_date date NOT NULL DEFAULT current_date,
  preferred_time_slot text NOT NULL DEFAULT '10:00-14:00',
  estimated_shipments_count integer NOT NULL DEFAULT 1 CHECK (estimated_shipments_count >= 1 AND estimated_shipments_count <= 5000),
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'picked_up', 'cancelled')),
  pickup_list_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  updated_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cpr_tenant_code UNIQUE (tenant_id, request_code),
  CONSTRAINT fk_cpr_client FOREIGN KEY (tenant_id, client_id) REFERENCES public.clients(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cpr_gov FOREIGN KEY (tenant_id, governorate_id) REFERENCES public.governorates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cpr_region FOREIGN KEY (tenant_id, region_id) REFERENCES public.regions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cpr_branch FOREIGN KEY (tenant_id, branch_id) REFERENCES public.branches(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cpr_pickup_list FOREIGN KEY (tenant_id, pickup_list_id) REFERENCES public.pickup_lists(tenant_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cpr_tenant_client ON public.client_pickup_requests (tenant_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cpr_tenant_status ON public.client_pickup_requests (tenant_id, status, preferred_date);

DROP TRIGGER IF EXISTS trg_cpr_updated_at ON public.client_pickup_requests;
CREATE TRIGGER trg_cpr_updated_at
  BEFORE UPDATE ON public.client_pickup_requests
  FOR EACH ROW EXECUTE FUNCTION app_private.set_updated_at();

ALTER TABLE public.client_pickup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_pickup_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_pickup_requests_select_policy ON public.client_pickup_requests;
CREATE POLICY client_pickup_requests_select_policy ON public.client_pickup_requests
  FOR SELECT USING (
    (
      app_private.user_get_bound_client_id(tenant_id) IS NULL
      AND app_private.user_belongs_to_tenant(tenant_id)
    )
    OR client_id = app_private.user_get_bound_client_id(tenant_id)
  );

-- ----------------------------------------------------------------------------
-- 6. Public Storefront & Self-Registration RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_public_tenant_storefront(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tenant_row record;
  v_services jsonb;
  v_govs jsonb;
  v_regs jsonb;
BEGIN
  SELECT
    t.id,
    t.slug,
    t.name,
    t.status,
    t.default_timezone,
    t.default_currency,
    t.default_locale,
    COALESCE(ts.allow_client_self_registration, false) AS allow_client_self_registration,
    COALESCE(ts.auto_approve_clients, false) AS auto_approve_clients,
    ts.brand_logo_path,
    ts.public_tagline,
    ts.public_support_phone,
    ts.public_support_email
  INTO v_tenant_row
  FROM public.tenants t
  LEFT JOIN public.tenant_settings ts ON ts.tenant_id = t.id
  WHERE t.slug = lower(trim(p_slug))
    AND t.status = 'active'
  LIMIT 1;

  IF v_tenant_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ss.id,
    'code', ss.code,
    'name', ss.name,
    'estimated_days_min', ss.estimated_days_min,
    'estimated_days_max', ss.estimated_days_max
  ) ORDER BY ss.code), '[]'::jsonb)
  INTO v_services
  FROM public.shipping_services ss
  WHERE ss.tenant_id = v_tenant_row.id
    AND ss.is_active = true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', g.id,
    'code', g.code,
    'name', g.name
  ) ORDER BY g.code), '[]'::jsonb)
  INTO v_govs
  FROM public.governorates g
  WHERE g.tenant_id = v_tenant_row.id
    AND g.is_active = true;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id,
    'governorate_id', r.governorate_id,
    'code', r.code,
    'name', r.name
  ) ORDER BY r.code), '[]'::jsonb)
  INTO v_regs
  FROM public.regions r
  WHERE r.tenant_id = v_tenant_row.id
    AND r.is_active = true;

  RETURN jsonb_build_object(
    'tenant', to_jsonb(v_tenant_row),
    'services', v_services,
    'governorates', v_govs,
    'regions', v_regs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_tenant_storefront(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_tenant_storefront(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_client_registration_request(
  p_tenant_slug text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_tenant public.tenants%ROWTYPE;
  v_settings public.tenant_settings%ROWTYPE;
  v_company_name text := trim(COALESCE(p_payload->>'company_name', ''));
  v_contact_name text := nullif(trim(COALESCE(p_payload->>'contact_name', '')), '');
  v_email text := lower(trim(COALESCE(p_payload->>'email', '')));
  v_phone text := trim(COALESCE(p_payload->>'phone', ''));
  v_mobile text := nullif(trim(COALESCE(p_payload->>'mobile', '')), '');
  v_gov_id uuid := (p_payload->>'governorate_id')::uuid;
  v_reg_id uuid := (p_payload->>'region_id')::uuid;
  v_address_line text := trim(COALESCE(p_payload->>'address_line', ''));
  v_payout_method text := COALESCE(nullif(trim(COALESCE(p_payload->>'payout_method', '')), ''), 'cash');
  v_bank_name text := nullif(trim(COALESCE(p_payload->>'bank_name', '')), '');
  v_bank_account text := nullif(trim(COALESCE(p_payload->>'bank_account_number', '')), '');
  v_wallet_phone text := nullif(trim(COALESCE(p_payload->>'wallet_phone', '')), '');
  v_req_id uuid;
  v_client_id uuid;
  v_client_code text;
  v_country_id uuid;
  v_price_list_id uuid;
  v_tax_profile_id uuid;
  v_payment_term_id uuid;
  v_shipment_type_id uuid;
BEGIN
  SELECT * INTO v_tenant
  FROM public.tenants
  WHERE slug = lower(trim(p_tenant_slug))
    AND status = 'active'
  LIMIT 1;

  IF v_tenant.id IS NULL THEN
    RAISE EXCEPTION 'الشركة غير متاحة حاليًا.';
  END IF;

  SELECT * INTO v_settings
  FROM public.tenant_settings
  WHERE tenant_id = v_tenant.id;

  IF NOT COALESCE(v_settings.allow_client_self_registration, false) THEN
    RAISE EXCEPTION 'التسجيل الذاتي للتجار غير مفعّل حاليًا لهذه الشركة.';
  END IF;

  IF char_length(v_company_name) < 2 THEN
    RAISE EXCEPTION 'اسم المتجر أو الشركة مطلوب (حرفان على الأقل).';
  END IF;
  IF v_email = '' OR position('@' IN v_email) = 0 THEN
    RAISE EXCEPTION 'البريد الإلكتروني غير صالح.';
  END IF;
  IF char_length(v_phone) < 4 THEN
    RAISE EXCEPTION 'رقم الهاتف مطلوب.';
  END IF;
  IF char_length(v_address_line) < 3 THEN
    RAISE EXCEPTION 'العنوان التفصيلي مطلوب.';
  END IF;
  IF v_payout_method NOT IN ('cash', 'bank_transfer', 'vodafone_cash') THEN
    RAISE EXCEPTION 'طريقة السداد غير صالحة.';
  END IF;
  IF v_payout_method = 'bank_transfer' AND (v_bank_name IS NULL OR v_bank_account IS NULL) THEN
    RAISE EXCEPTION 'بيانات البنك ورقم الحساب مطلوبة عند اختيار التحويل البنكي.';
  END IF;
  IF v_payout_method = 'vodafone_cash' AND v_wallet_phone IS NULL THEN
    RAISE EXCEPTION 'رقم محفظة فودافون كاش مطلوب.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.regions r
    WHERE r.id = v_reg_id
      AND r.governorate_id = v_gov_id
      AND r.tenant_id = v_tenant.id
      AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'المحافظة أو المنطقة المختارة غير صالحة لهذه الشركة.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.client_registration_requests crr
    WHERE crr.tenant_id = v_tenant.id
      AND lower(crr.email) = v_email
      AND crr.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'يوجد طلب تسجيل قيد المراجعة بالفعل بنفس البريد الإلكتروني.';
  END IF;

  IF COALESCE(v_settings.auto_approve_clients, false) THEN
    SELECT id INTO v_price_list_id
    FROM public.client_price_lists
    WHERE tenant_id = v_tenant.id AND is_active = true
    ORDER BY is_system_default DESC, (code = '0') DESC, created_at ASC
    LIMIT 1;

    SELECT id INTO v_tax_profile_id
    FROM public.tax_profiles
    WHERE tenant_id = v_tenant.id AND is_active = true
    ORDER BY (tax_mode = 'none') DESC, is_default DESC, created_at ASC
    LIMIT 1;

    IF v_price_list_id IS NULL OR v_tax_profile_id IS NULL THEN
      RAISE EXCEPTION 'تعذر تفعيل العميل تلقائيًا لعدم توفر قائمة أسعار أو ملف ضريبة افتراضي.';
    END IF;

    SELECT id INTO v_country_id
    FROM public.countries
    WHERE tenant_id = v_tenant.id AND is_active = true
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1;

    SELECT id INTO v_payment_term_id
    FROM public.payment_terms
    WHERE tenant_id = v_tenant.id AND is_active = true
    ORDER BY (code = 'COD') DESC, created_at ASC
    LIMIT 1;

    SELECT id INTO v_shipment_type_id
    FROM public.shipment_types
    WHERE tenant_id = v_tenant.id AND is_active = true
    ORDER BY (code = 'FDP') DESC, created_at ASC
    LIMIT 1;

    LOOP
      v_client_code := app_private.next_document_number(v_tenant.id, 'clients');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.clients c WHERE c.tenant_id = v_tenant.id AND c.code = v_client_code
      );
    END LOOP;

    INSERT INTO public.clients (
      tenant_id, code, name, country_id, governorate_id, region_id,
      price_list_id, tax_profile_id, default_payment_term_id, default_shipment_type_id,
      payout_method, bank_name, bank_account_number, wallet_phone,
      phone, mobile, address_line, email, approval_status, is_active
    )
    VALUES (
      v_tenant.id, v_client_code, v_company_name, v_country_id, v_gov_id, v_reg_id,
      v_price_list_id, v_tax_profile_id, v_payment_term_id, v_shipment_type_id,
      v_payout_method,
      CASE WHEN v_payout_method = 'bank_transfer' THEN v_bank_name ELSE NULL END,
      CASE WHEN v_payout_method = 'bank_transfer' THEN v_bank_account ELSE NULL END,
      CASE WHEN v_payout_method = 'vodafone_cash' THEN v_wallet_phone ELSE NULL END,
      v_phone, COALESCE(v_mobile, v_phone), v_address_line, v_email, 'approved', true
    )
    RETURNING id INTO v_client_id;

    INSERT INTO public.client_addresses (
      tenant_id, client_id, label, governorate_id, region_id, address_line, phone, is_default, is_active
    )
    VALUES (
      v_tenant.id, v_client_id, 'العنوان الرئيسي', v_gov_id, v_reg_id, v_address_line, COALESCE(v_mobile, v_phone), true, true
    );

    INSERT INTO public.client_registration_requests (
      tenant_id, company_name, contact_name, email, phone, mobile,
      governorate_id, region_id, address_line, payout_method,
      bank_name, bank_account_number, wallet_phone,
      status, reviewed_at, approved_client_id
    )
    VALUES (
      v_tenant.id, v_company_name, v_contact_name, v_email, v_phone, COALESCE(v_mobile, v_phone),
      v_gov_id, v_reg_id, v_address_line, v_payout_method,
      CASE WHEN v_payout_method = 'bank_transfer' THEN v_bank_name ELSE NULL END,
      CASE WHEN v_payout_method = 'bank_transfer' THEN v_bank_account ELSE NULL END,
      CASE WHEN v_payout_method = 'vodafone_cash' THEN v_wallet_phone ELSE NULL END,
      'approved', now(), v_client_id
    )
    RETURNING id INTO v_req_id;

    RETURN jsonb_build_object(
      'request_id', v_req_id,
      'status', 'approved',
      'auto_approved', true,
      'client_id', v_client_id,
      'client_code', v_client_code
    );
  ELSE
    INSERT INTO public.client_registration_requests (
      tenant_id, company_name, contact_name, email, phone, mobile,
      governorate_id, region_id, address_line, payout_method,
      bank_name, bank_account_number, wallet_phone, status
    )
    VALUES (
      v_tenant.id, v_company_name, v_contact_name, v_email, v_phone, COALESCE(v_mobile, v_phone),
      v_gov_id, v_reg_id, v_address_line, v_payout_method,
      CASE WHEN v_payout_method = 'bank_transfer' THEN v_bank_name ELSE NULL END,
      CASE WHEN v_payout_method = 'bank_transfer' THEN v_bank_account ELSE NULL END,
      CASE WHEN v_payout_method = 'vodafone_cash' THEN v_wallet_phone ELSE NULL END,
      'pending'
    )
    RETURNING id INTO v_req_id;

    RETURN jsonb_build_object(
      'request_id', v_req_id,
      'status', 'pending',
      'auto_approved', false,
      'client_id', NULL,
      'client_code', NULL
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_client_registration_request(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_client_registration_request(text, jsonb) TO anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7. Tenant Registration & Storefront Admin Settings RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_tenant_registration_settings(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_row public.tenant_settings%ROWTYPE;
BEGIN
  IF NOT (
    app_private.user_is_tenant_admin(p_tenant_id)
    OR app_private.user_is_staff_with_permission(p_tenant_id, 'clients.read')
  ) THEN
    RAISE EXCEPTION 'غير مصرح بعرض إعدادات التسجيل الذاتي.';
  END IF;

  SELECT * INTO v_row
  FROM public.tenant_settings
  WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'tenant_id', p_tenant_id,
    'allow_client_self_registration', COALESCE(v_row.allow_client_self_registration, false),
    'auto_approve_clients', COALESCE(v_row.auto_approve_clients, false),
    'public_tagline', v_row.public_tagline,
    'public_support_phone', v_row.public_support_phone,
    'public_support_email', v_row.public_support_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tenant_registration_settings(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_registration_settings(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_tenant_registration_settings(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_row public.tenant_settings%ROWTYPE;
BEGIN
  IF NOT app_private.user_is_tenant_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'تعديل إعدادات الموقع العام والتسجيل الذاتي مقتصر على إدارة الشركة.';
  END IF;

  UPDATE public.tenant_settings
  SET
    allow_client_self_registration = COALESCE((p_payload->>'allow_client_self_registration')::boolean, allow_client_self_registration),
    auto_approve_clients = COALESCE((p_payload->>'auto_approve_clients')::boolean, auto_approve_clients),
    public_tagline = nullif(trim(COALESCE(p_payload->>'public_tagline', '')), ''),
    public_support_phone = nullif(trim(COALESCE(p_payload->>'public_support_phone', '')), ''),
    public_support_email = nullif(trim(COALESCE(p_payload->>'public_support_email', '')), ''),
    updated_at = now()
  WHERE tenant_id = p_tenant_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'tenant_id', p_tenant_id,
    'allow_client_self_registration', v_row.allow_client_self_registration,
    'auto_approve_clients', v_row.auto_approve_clients,
    'public_tagline', v_row.public_tagline,
    'public_support_phone', v_row.public_support_phone,
    'public_support_email', v_row.public_support_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_tenant_registration_settings(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_registration_settings(uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Client Portal Self-Service: Addresses & Pickup Requests RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_my_client_address(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_bound_client uuid := app_private.user_get_bound_client_id(p_tenant_id);
  v_client_id uuid;
  v_addr_id uuid := NULLIF(p_payload->>'id', '')::uuid;
  v_label text := trim(COALESCE(p_payload->>'label', ''));
  v_gov_id uuid := (p_payload->>'governorate_id')::uuid;
  v_reg_id uuid := NULLIF(p_payload->>'region_id', '')::uuid;
  v_address_line text := trim(COALESCE(p_payload->>'address_line', ''));
  v_phone text := nullif(trim(COALESCE(p_payload->>'phone', '')), '');
  v_is_default boolean := COALESCE((p_payload->>'is_default')::boolean, false);
BEGIN
  IF v_bound_client IS NOT NULL THEN
    v_client_id := v_bound_client;
  ELSIF app_private.user_is_staff_with_permission(p_tenant_id, 'clients.update') THEN
    v_client_id := (p_payload->>'client_id')::uuid;
  ELSE
    RAISE EXCEPTION 'غير مصرح بإدارة عناوين العميل.';
  END IF;

  IF char_length(v_label) < 2 OR char_length(v_address_line) < 3 THEN
    RAISE EXCEPTION 'اسم العنوان وتفاصيله حقول مطلوبة.';
  END IF;

  IF v_is_default THEN
    UPDATE public.client_addresses
    SET is_default = false
    WHERE tenant_id = p_tenant_id AND client_id = v_client_id;
  END IF;

  IF v_addr_id IS NOT NULL THEN
    UPDATE public.client_addresses
    SET
      label = v_label,
      governorate_id = v_gov_id,
      region_id = v_reg_id,
      address_line = v_address_line,
      phone = v_phone,
      is_default = v_is_default
    WHERE id = v_addr_id
      AND tenant_id = p_tenant_id
      AND client_id = v_client_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'العنوان غير موجود أو لا يتبع لهذا الحساب.';
    END IF;
    RETURN v_addr_id;
  ELSE
    INSERT INTO public.client_addresses (
      tenant_id, client_id, label, governorate_id, region_id, address_line, phone, is_default, is_active, created_by
    )
    VALUES (
      p_tenant_id, v_client_id, v_label, v_gov_id, v_reg_id, v_address_line, v_phone, v_is_default, true, auth.uid()
    )
    RETURNING id INTO v_addr_id;
    RETURN v_addr_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.save_my_client_address(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_client_address(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_my_client_address(
  p_tenant_id uuid,
  p_address_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_bound_client uuid := app_private.user_get_bound_client_id(p_tenant_id);
BEGIN
  IF v_bound_client IS NOT NULL THEN
    DELETE FROM public.client_addresses
    WHERE id = p_address_id AND tenant_id = p_tenant_id AND client_id = v_bound_client;
  ELSIF app_private.user_is_staff_with_permission(p_tenant_id, 'clients.update') THEN
    DELETE FROM public.client_addresses
    WHERE id = p_address_id AND tenant_id = p_tenant_id;
  ELSE
    RAISE EXCEPTION 'غير مصرح بحذف هذا العنوان.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_client_address(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_client_address(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_client_pickup_request(
  p_tenant_id uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_bound_client uuid := app_private.user_get_bound_client_id(p_tenant_id);
  v_client_row public.clients%ROWTYPE;
  v_req_id uuid;
  v_req_code text;
  v_gov_id uuid := NULLIF(p_payload->>'governorate_id', '')::uuid;
  v_reg_id uuid := NULLIF(p_payload->>'region_id', '')::uuid;
  v_addr_id uuid := NULLIF(p_payload->>'address_id', '')::uuid;
  v_pickup_addr text := trim(COALESCE(p_payload->>'pickup_address', ''));
  v_phone text := trim(COALESCE(p_payload->>'contact_phone', ''));
  v_pref_date date := COALESCE(NULLIF(p_payload->>'preferred_date', '')::date, current_date);
  v_slot text := COALESCE(nullif(trim(COALESCE(p_payload->>'preferred_time_slot', '')), ''), '10:00-14:00');
  v_est_count integer := COALESCE((p_payload->>'estimated_shipments_count')::integer, 1);
  v_notes text := nullif(trim(COALESCE(p_payload->>'notes', '')), '');
  v_target_client_id uuid;
BEGIN
  IF v_bound_client IS NOT NULL THEN
    v_target_client_id := v_bound_client;
  ELSIF app_private.user_is_staff_with_permission(p_tenant_id, 'operations.pickup.create') THEN
    v_target_client_id := (p_payload->>'client_id')::uuid;
  ELSE
    RAISE EXCEPTION 'غير مصرح بإنشاء طلب التقاط.';
  END IF;

  SELECT * INTO v_client_row
  FROM public.clients
  WHERE id = v_target_client_id
    AND tenant_id = p_tenant_id
    AND is_active = true
    AND archived_at IS NULL;

  IF v_client_row.id IS NULL THEN
    RAISE EXCEPTION 'ملف العميل غير موجود أو غير نشط.';
  END IF;

  IF v_gov_id IS NULL THEN
    v_gov_id := v_client_row.governorate_id;
  END IF;
  IF v_reg_id IS NULL THEN
    v_reg_id := v_client_row.region_id;
  END IF;
  IF char_length(v_pickup_addr) < 3 THEN
    v_pickup_addr := v_client_row.address_line;
  END IF;
  IF char_length(v_phone) < 4 THEN
    v_phone := COALESCE(v_client_row.mobile, v_client_row.phone);
  END IF;

  v_req_code := app_private.next_document_number(p_tenant_id, 'client_pickup_requests');

  INSERT INTO public.client_pickup_requests (
    tenant_id, request_code, client_id, address_id, branch_id,
    governorate_id, region_id, pickup_address, contact_phone,
    preferred_date, preferred_time_slot, estimated_shipments_count, notes,
    status, created_by, updated_by
  )
  VALUES (
    p_tenant_id, v_req_code, v_client_row.id, v_addr_id, v_client_row.branch_id,
    v_gov_id, v_reg_id, v_pickup_addr, v_phone,
    v_pref_date, v_slot, GREATEST(1, v_est_count), v_notes,
    'pending', auth.uid(), auth.uid()
  )
  RETURNING id INTO v_req_id;

  RETURN v_req_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_client_pickup_request(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_client_pickup_request(uuid, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_client_pickup_request(
  p_tenant_id uuid,
  p_request_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_bound_client uuid := app_private.user_get_bound_client_id(p_tenant_id);
  v_row public.client_pickup_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.client_pickup_requests
  WHERE id = p_request_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'طلب الالتقاط غير موجود.';
  END IF;

  IF v_bound_client IS NOT NULL THEN
    IF v_row.client_id <> v_bound_client THEN
      RAISE EXCEPTION 'غير مصرح بإلغاء طلب التقاط لعميل آخر.';
    END IF;
  ELSIF NOT app_private.user_is_staff_with_permission(p_tenant_id, 'operations.pickup.create') THEN
    RAISE EXCEPTION 'غير مصرح بإلغاء طلب الالتقاط.';
  END IF;

  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'لا يمكن إلغاء طلب التقاط تمت جدولته أو تنفيذه بالفعل.';
  END IF;

  UPDATE public.client_pickup_requests
  SET status = 'cancelled', updated_by = auth.uid(), updated_at = now()
  WHERE id = v_row.id;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_client_pickup_request(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_client_pickup_request(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_pickup_request_status(
  p_tenant_id uuid,
  p_request_id uuid,
  p_status text,
  p_pickup_list_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
BEGIN
  IF NOT app_private.user_is_staff_with_permission(p_tenant_id, 'operations.pickup.create') THEN
    RAISE EXCEPTION 'غير مصرح بتحديث حالة طلبات الالتقاط.';
  END IF;

  IF p_status NOT IN ('pending', 'scheduled', 'picked_up', 'cancelled') THEN
    RAISE EXCEPTION 'حالة طلب الالتقاط غير صالحة.';
  END IF;

  UPDATE public.client_pickup_requests
  SET
    status = p_status,
    pickup_list_id = COALESCE(p_pickup_list_id, pickup_list_id),
    updated_by = auth.uid(),
    updated_at = now()
  WHERE id = p_request_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'طلب الالتقاط غير موجود.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_pickup_request_status(uuid, uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_pickup_request_status(uuid, uuid, text, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 9. Client Portal Summary & Account Statement RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_client_portal_summary(
  p_tenant_id uuid,
  p_client_id uuid DEFAULT NULL,
  p_period text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_bound_client uuid := app_private.user_get_bound_client_id(p_tenant_id);
  v_target_client uuid;
  v_since timestamptz;
  v_client record;
  v_total_shipments integer := 0;
  v_in_progress integer := 0;
  v_delivered integer := 0;
  v_returned integer := 0;
  v_total_shipping_fees numeric(14,2) := 0;
  v_cod_collected numeric(14,2) := 0;
  v_in_flight_cod numeric(14,2) := 0;
  v_ready_count integer := 0;
  v_ready_net numeric(14,2) := 0;
  v_settled_net numeric(14,2) := 0;
  v_pending_pickups integer := 0;
BEGIN
  IF v_bound_client IS NOT NULL THEN
    v_target_client := v_bound_client;
  ELSIF app_private.user_is_staff_with_permission(p_tenant_id, 'clients.read') THEN
    v_target_client := p_client_id;
  ELSE
    RAISE EXCEPTION 'غير مصرح بالوصول إلى ملخص بوابة العميل.';
  END IF;

  IF v_target_client IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد العميل المطلوب.';
  END IF;

  v_since := CASE COALESCE(p_period, 'all')
    WHEN '7d' THEN now() - interval '7 days'
    WHEN '30d' THEN now() - interval '30 days'
    WHEN '90d' THEN now() - interval '90 days'
    ELSE NULL
  END;

  SELECT c.id, c.code, c.name, c.payout_method, c.default_price_mode,
         g.name AS governorate_name, r.name AS region_name
  INTO v_client
  FROM public.clients c
  LEFT JOIN public.governorates g ON g.id = c.governorate_id
  LEFT JOIN public.regions r ON r.id = c.region_id
  WHERE c.id = v_target_client AND c.tenant_id = p_tenant_id;

  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'العميل غير موجود.';
  END IF;

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE s.operational_status NOT IN ('delivered', 'partially_delivered', 'returned', 'cancelled'))::integer,
    COUNT(*) FILTER (WHERE s.operational_status IN ('delivered', 'partially_delivered'))::integer,
    COUNT(*) FILTER (WHERE s.operational_status IN ('return_to_sender', 'returned'))::integer,
    COALESCE(SUM(s.total_shipping_fee) FILTER (WHERE s.operational_status <> 'cancelled'), 0)::numeric(14,2),
    COALESCE(SUM(
      CASE
        WHEN s.payment_term_code = 'COD' AND s.operational_status IN ('delivered', 'partially_delivered')
        THEN COALESCE(NULLIF(s.delivered_amount, 0), s.recipient_collect_amount)
        ELSE 0
      END
    ), 0)::numeric(14,2),
    COALESCE(SUM(
      CASE
        WHEN s.payment_term_code = 'COD'
          AND s.operational_status IN ('delivered', 'partially_delivered')
          AND s.is_collected_from_courier = false
          AND s.is_settled_to_client = false
        THEN COALESCE(NULLIF(s.delivered_amount, 0), s.recipient_collect_amount)
        ELSE 0
      END
    ), 0)::numeric(14,2)
  INTO
    v_total_shipments,
    v_in_progress,
    v_delivered,
    v_returned,
    v_total_shipping_fees,
    v_cod_collected,
    v_in_flight_cod
  FROM public.shipments s
  WHERE s.tenant_id = p_tenant_id
    AND s.client_id = v_target_client
    AND (v_since IS NULL OR s.created_at >= v_since);

  -- Ready to settle right now (across all open unsettled eligible shipments)
  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(
      CASE
        WHEN s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'COD'
          THEN COALESCE(NULLIF(s.delivered_amount, 0), s.recipient_collect_amount) - s.total_shipping_fee
        WHEN s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'POSTPAID'
          THEN -s.total_shipping_fee
        WHEN s.operational_status = 'returned' AND COALESCE(s.return_liability, 'none') = 'sender_partial_fee'
          THEN -COALESCE(NULLIF(s.applied_return_fee, 0), s.return_fee, 0)
        WHEN s.operational_status = 'returned' AND COALESCE(s.return_liability, 'none') IN ('no_charge', 'recipient_paid_fee')
          THEN 0
        ELSE 0
      END
    ), 0)::numeric(14,2)
  INTO v_ready_count, v_ready_net
  FROM public.shipments s
  WHERE s.tenant_id = p_tenant_id
    AND s.client_id = v_target_client
    AND s.is_settled_to_client = false
    AND (
      (s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'COD' AND s.is_collected_from_courier = true)
      OR (s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'POSTPAID')
      OR (s.operational_status = 'returned' AND COALESCE(s.return_liability, 'none') = 'sender_partial_fee' AND COALESCE(NULLIF(s.applied_return_fee, 0), s.return_fee, 0) > 0)
    );

  SELECT COALESCE(SUM(cs.net_payable_amount), 0)::numeric(14,2)
  INTO v_settled_net
  FROM public.client_settlements cs
  WHERE cs.tenant_id = p_tenant_id
    AND cs.client_id = v_target_client
    AND cs.status = 'approved'
    AND (v_since IS NULL OR cs.settlement_date >= v_since::date);

  SELECT COUNT(*)::integer
  INTO v_pending_pickups
  FROM public.client_pickup_requests cpr
  WHERE cpr.tenant_id = p_tenant_id
    AND cpr.client_id = v_target_client
    AND cpr.status IN ('pending', 'scheduled');

  RETURN jsonb_build_object(
    'client', to_jsonb(v_client),
    'period', COALESCE(p_period, 'all'),
    'total_shipments', v_total_shipments,
    'in_progress_count', v_in_progress,
    'delivered_count', v_delivered,
    'returned_count', v_returned,
    'total_shipping_fees', v_total_shipping_fees,
    'cod_collected_amount', v_cod_collected,
    'in_flight_cod_amount', v_in_flight_cod,
    'ready_unsettled_count', v_ready_count,
    'ready_net_settlement_amount', v_ready_net,
    'total_settled_payout_amount', v_settled_net,
    'pending_pickup_requests_count', v_pending_pickups
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_client_portal_summary(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_portal_summary(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_client_account_statement(
  p_tenant_id uuid,
  p_client_id uuid DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_bound_client uuid := app_private.user_get_bound_client_id(p_tenant_id);
  v_target_client uuid;
  v_client record;
  v_currency text;
  v_opening_balance numeric(14,2) := 0;
  v_total_credits numeric(14,2) := 0;
  v_total_debits numeric(14,2) := 0;
  v_closing_balance numeric(14,2) := 0;
  v_ready_net numeric(14,2) := 0;
  v_in_flight_cod numeric(14,2) := 0;
  v_entries jsonb := '[]'::jsonb;
  v_rec record;
  v_running numeric(14,2) := 0;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_bound_client IS NOT NULL THEN
    v_target_client := v_bound_client;
  ELSIF app_private.user_is_staff_with_permission(p_tenant_id, 'clients.read') THEN
    v_target_client := p_client_id;
  ELSE
    RAISE EXCEPTION 'غير مصرح بعرض كشف حساب العميل.';
  END IF;

  IF v_target_client IS NULL THEN
    RAISE EXCEPTION 'يجب تحديد العميل لعرض كشف الحساب.';
  END IF;

  SELECT default_currency INTO v_currency
  FROM public.tenants WHERE id = p_tenant_id;

  SELECT id, code, name, payout_method
  INTO v_client
  FROM public.clients
  WHERE id = v_target_client AND tenant_id = p_tenant_id;

  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'العميل غير موجود.';
  END IF;

  -- Unsettled & in-flight metrics
  SELECT
    COALESCE(SUM(
      CASE
        WHEN s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'COD'
          THEN COALESCE(NULLIF(s.delivered_amount, 0), s.recipient_collect_amount) - s.total_shipping_fee
        WHEN s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'POSTPAID'
          THEN -s.total_shipping_fee
        WHEN s.operational_status = 'returned' AND COALESCE(s.return_liability, 'none') = 'sender_partial_fee'
          THEN -COALESCE(NULLIF(s.applied_return_fee, 0), s.return_fee, 0)
        ELSE 0
      END
    ), 0)::numeric(14,2)
  INTO v_ready_net
  FROM public.shipments s
  WHERE s.tenant_id = p_tenant_id
    AND s.client_id = v_target_client
    AND s.is_settled_to_client = false
    AND (
      (s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'COD' AND s.is_collected_from_courier = true)
      OR (s.operational_status IN ('delivered', 'partially_delivered') AND s.payment_term_code = 'POSTPAID')
      OR (s.operational_status = 'returned' AND COALESCE(s.return_liability, 'none') = 'sender_partial_fee' AND COALESCE(NULLIF(s.applied_return_fee, 0), s.return_fee, 0) > 0)
    );

  SELECT COALESCE(SUM(COALESCE(NULLIF(s.delivered_amount, 0), s.recipient_collect_amount)), 0)::numeric(14,2)
  INTO v_in_flight_cod
  FROM public.shipments s
  WHERE s.tenant_id = p_tenant_id
    AND s.client_id = v_target_client
    AND s.payment_term_code = 'COD'
    AND s.operational_status IN ('delivered', 'partially_delivered')
    AND s.is_collected_from_courier = false
    AND s.is_settled_to_client = false;

  -- Build chronological ledger from approved client settlements & cashbox vouchers
  FOR v_rec IN
    WITH raw_movements AS (
      -- 1) Settlement shipment net credit/debit entitlement
      SELECT
        cs.id::text || ':entitlement' AS row_id,
        cs.settlement_date AS entry_date,
        COALESCE(cs.approved_at, cs.created_at) AS sort_ts,
        1 AS sort_order,
        cs.settlement_code AS reference_code,
        'settlement_entitlement' AS entry_type,
        'استحقاق تسوية شحنات (' || cs.settlement_code || ') — تحصيل: ' || cs.gross_cod_collected::text || ' / خصومات: ' || (cs.shipping_fees_deducted + cs.return_fees_deducted)::text AS description,
        GREATEST(cs.net_payable_amount, 0)::numeric(14,2) AS credit_amount,
        GREATEST(-cs.net_payable_amount, 0)::numeric(14,2) AS debit_amount,
        cs.payout_method,
        cs.payout_reference
      FROM public.client_settlements cs
      WHERE cs.tenant_id = p_tenant_id
        AND cs.client_id = v_target_client
        AND cs.status = 'approved'

      UNION ALL

      -- 2) Settlement cash execution (payout to client or receipt from client)
      SELECT
        cs.id::text || ':cash' AS row_id,
        cs.settlement_date AS entry_date,
        COALESCE(cs.approved_at, cs.created_at) AS sort_ts,
        2 AS sort_order,
        cs.settlement_code AS reference_code,
        CASE WHEN cs.cash_direction = 'payout_to_client' THEN 'settlement_payout' ELSE 'settlement_receipt' END AS entry_type,
        CASE
          WHEN cs.cash_direction = 'payout_to_client' THEN 'صرف مستحق تسوية للعميل (' || cs.settlement_code || ')'
          ELSE 'تحصيل فرق تسوية من العميل (' || cs.settlement_code || ')'
        END AS description,
        CASE WHEN cs.cash_direction = 'receipt_from_client' THEN ABS(cs.net_payable_amount)::numeric(14,2) ELSE 0::numeric(14,2) END AS credit_amount,
        CASE WHEN cs.cash_direction = 'payout_to_client' THEN ABS(cs.net_payable_amount)::numeric(14,2) ELSE 0::numeric(14,2) END AS debit_amount,
        cs.payout_method,
        cs.payout_reference
      FROM public.client_settlements cs
      WHERE cs.tenant_id = p_tenant_id
        AND cs.client_id = v_target_client
        AND cs.status = 'approved'
        AND cs.cash_direction IN ('payout_to_client', 'receipt_from_client')
        AND cs.net_payable_amount <> 0

      UNION ALL

      -- 3) Cashbox vouchers bound directly to this client (prepaid deposits, receipts, payments)
      SELECT
        cv.id::text AS row_id,
        cv.voucher_date AS entry_date,
        COALESCE(cv.approved_at, cv.created_at) AS sort_ts,
        3 AS sort_order,
        cv.voucher_code AS reference_code,
        cv.voucher_type AS entry_type,
        CASE cv.voucher_type
          WHEN 'prepaid_deposit' THEN 'إيداع رصيد مقدم (' || cv.voucher_code || ')' || COALESCE(' · ' || cv.notes, '')
          WHEN 'receipt' THEN 'سند قبض من العميل (' || cv.voucher_code || ')' || COALESCE(' · ' || cv.notes, '')
          ELSE 'سند صرف للعميل (' || cv.voucher_code || ')' || COALESCE(' · ' || cv.notes, '')
        END AS description,
        CASE WHEN cv.voucher_type IN ('prepaid_deposit', 'receipt') THEN cv.amount::numeric(14,2) ELSE 0::numeric(14,2) END AS credit_amount,
        CASE WHEN cv.voucher_type = 'payment' THEN cv.amount::numeric(14,2) ELSE 0::numeric(14,2) END AS debit_amount,
        NULL::text AS payout_method,
        NULL::text AS payout_reference
      FROM public.cashbox_vouchers cv
      WHERE cv.tenant_id = p_tenant_id
        AND cv.client_id = v_target_client
        AND cv.status = 'approved'
    )
    SELECT *
    FROM raw_movements
    ORDER BY entry_date ASC, sort_ts ASC, sort_order ASC, row_id ASC
  LOOP
    IF p_date_from IS NOT NULL AND v_rec.entry_date < p_date_from THEN
      v_opening_balance := v_opening_balance + v_rec.credit_amount - v_rec.debit_amount;
      v_running := v_opening_balance;
    ELSIF p_date_to IS NOT NULL AND v_rec.entry_date > p_date_to THEN
      CONTINUE;
    ELSE
      v_running := v_running + v_rec.credit_amount - v_rec.debit_amount;
      v_total_credits := v_total_credits + v_rec.credit_amount;
      v_total_debits := v_total_debits + v_rec.debit_amount;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'row_id', v_rec.row_id,
        'entry_date', v_rec.entry_date,
        'reference_code', v_rec.reference_code,
        'entry_type', v_rec.entry_type,
        'description', v_rec.description,
        'credit_amount', v_rec.credit_amount,
        'debit_amount', v_rec.debit_amount,
        'running_balance', v_running,
        'payout_method', v_rec.payout_method,
        'payout_reference', v_rec.payout_reference
      ));
    END IF;
  END LOOP;

  v_closing_balance := v_opening_balance + v_total_credits - v_total_debits;

  RETURN jsonb_build_object(
    'client', to_jsonb(v_client),
    'currency', COALESCE(v_currency, 'EGP'),
    'date_from', p_date_from,
    'date_to', p_date_to,
    'opening_balance', v_opening_balance,
    'total_credits', v_total_credits,
    'total_debits', v_total_debits,
    'closing_balance', v_closing_balance,
    'ready_unsettled_net', v_ready_net,
    'in_flight_cod_amount', v_in_flight_cod,
    'entries', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_client_account_statement(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_account_statement(uuid, uuid, date, date) TO authenticated;
