-- Courier task data is available only through the authenticated courier's own account.
ALTER FUNCTION public.list_courier_my_tasks(uuid, uuid)
  RENAME TO list_courier_my_tasks_internal;

REVOKE ALL ON FUNCTION public.list_courier_my_tasks_internal(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_courier_my_tasks(
  p_tenant_id uuid,
  p_courier_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
DECLARE
  v_bound_courier_id uuid;
BEGIN
  v_bound_courier_id := app_private.user_get_bound_courier_id(p_tenant_id);

  IF v_bound_courier_id IS NULL THEN
    RAISE EXCEPTION 'Courier account required to access courier tasks';
  END IF;

  IF p_courier_id IS NOT NULL AND p_courier_id <> v_bound_courier_id THEN
    RAISE EXCEPTION 'Courier accounts may only access their own tasks';
  END IF;

  RETURN public.list_courier_my_tasks_internal(p_tenant_id, v_bound_courier_id);
END;
$$;

REVOKE ALL ON FUNCTION public.list_courier_my_tasks(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_courier_my_tasks(uuid, uuid) TO authenticated;
