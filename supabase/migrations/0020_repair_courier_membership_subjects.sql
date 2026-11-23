-- Repair courier memberships whose account subject was left as staff by legacy provisioning.
UPDATE public.tenant_memberships AS tm
SET account_subject_type = 'courier'
FROM public.account_subjects AS subject
WHERE subject.tenant_id = tm.tenant_id
  AND subject.membership_id = tm.id
  AND subject.is_active = true
  AND subject.subject_type = 'courier'
  AND subject.courier_id IS NOT NULL
  AND tm.is_active = true
  AND tm.account_subject_type <> 'courier';

DELETE FROM public.membership_roles AS mr
USING public.account_subjects AS subject,
      public.roles AS role,
      public.tenant_memberships AS tm
WHERE subject.tenant_id = mr.tenant_id
  AND subject.membership_id = mr.membership_id
  AND subject.is_active = true
  AND subject.subject_type = 'courier'
  AND subject.courier_id IS NOT NULL
  AND role.tenant_id = mr.tenant_id
  AND role.id = mr.role_id
  AND role.default_subject_type <> 'courier'
  AND tm.tenant_id = mr.tenant_id
  AND tm.id = mr.membership_id
  AND tm.is_active = true;

WITH courier_roles_without_primary AS (
  SELECT mr.id,
         row_number() OVER (
           PARTITION BY mr.tenant_id, mr.membership_id
           ORDER BY mr.created_at, mr.id
         ) AS role_order
  FROM public.membership_roles AS mr
  JOIN public.roles AS role
    ON role.tenant_id = mr.tenant_id
    AND role.id = mr.role_id
    AND role.default_subject_type = 'courier'
  JOIN public.account_subjects AS subject
    ON subject.tenant_id = mr.tenant_id
    AND subject.membership_id = mr.membership_id
    AND subject.is_active = true
    AND subject.subject_type = 'courier'
    AND subject.courier_id IS NOT NULL
  JOIN public.tenant_memberships AS tm
    ON tm.tenant_id = mr.tenant_id
    AND tm.id = mr.membership_id
    AND tm.is_active = true
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.membership_roles AS primary_role
    WHERE primary_role.tenant_id = mr.tenant_id
      AND primary_role.membership_id = mr.membership_id
      AND primary_role.is_primary = true
  )
)
UPDATE public.membership_roles AS mr
SET is_primary = true
FROM courier_roles_without_primary AS candidate
WHERE candidate.id = mr.id
  AND candidate.role_order = 1;

INSERT INTO public.membership_roles (tenant_id, membership_id, role_id, is_primary)
SELECT tm.tenant_id, tm.id, role.id, true
FROM public.tenant_memberships AS tm
JOIN public.account_subjects AS subject
  ON subject.tenant_id = tm.tenant_id
  AND subject.membership_id = tm.id
  AND subject.is_active = true
  AND subject.subject_type = 'courier'
  AND subject.courier_id IS NOT NULL
JOIN public.roles AS role
  ON role.tenant_id = tm.tenant_id
  AND role.code = 'delivery_agent'
  AND role.default_subject_type = 'courier'
  AND role.is_active = true
WHERE tm.is_active = true
  AND NOT EXISTS (
    SELECT 1
    FROM public.membership_roles AS mr
    JOIN public.roles AS assigned_role
      ON assigned_role.tenant_id = mr.tenant_id
      AND assigned_role.id = mr.role_id
      AND assigned_role.default_subject_type = 'courier'
    WHERE mr.tenant_id = tm.tenant_id
      AND mr.membership_id = tm.id
  );

UPDATE public.tenant_memberships AS tm
SET role_key = role.code
FROM public.account_subjects AS subject,
     public.membership_roles AS mr,
     public.roles AS role
WHERE subject.tenant_id = tm.tenant_id
  AND subject.membership_id = tm.id
  AND subject.is_active = true
  AND subject.subject_type = 'courier'
  AND subject.courier_id IS NOT NULL
  AND mr.tenant_id = tm.tenant_id
  AND mr.membership_id = tm.id
  AND mr.is_primary = true
  AND role.tenant_id = mr.tenant_id
  AND role.id = mr.role_id
  AND role.default_subject_type = 'courier'
  AND tm.is_active = true
  AND tm.role_key <> role.code;

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
  v_courier_id uuid;
BEGIN
  IF NOT app_private.user_belongs_to_tenant(p_tenant_id) THEN
    RETURN jsonb_build_object(
      'permissions', '[]'::jsonb,
      'branch_ids', '[]'::jsonb,
      'client_id', NULL,
      'courier_id', NULL
    );
  END IF;

  SELECT * INTO v_membership
  FROM public.tenant_memberships
  WHERE tenant_id = p_tenant_id AND user_id = auth.uid() AND is_active = true
  LIMIT 1;

  IF v_membership.role_key = 'company_owner'
     AND v_membership.account_subject_type NOT IN ('client', 'courier') THEN
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

  SELECT client_id, courier_id
  INTO v_client_id, v_courier_id
  FROM public.account_subjects
  WHERE tenant_id = p_tenant_id AND membership_id = v_membership.id AND is_active = true;

  RETURN jsonb_build_object(
    'membership_id', v_membership.id,
    'role_key', v_membership.role_key,
    'account_subject_type', v_membership.account_subject_type,
    'client_id', v_client_id,
    'courier_id', v_courier_id,
    'branch_ids', v_branches,
    'permissions', v_perms
  );
END;
$$;
