CREATE OR REPLACE FUNCTION public.resolve_or_create_employee(
  _employee_id text,
  _full_name text,
  _id_photo_path text
)
RETURNS TABLE(employee_uuid uuid, was_created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_employee_id text := NULLIF(btrim(_employee_id), '');
  normalized_full_name text := COALESCE(NULLIF(btrim(_full_name), ''), 'Unknown');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF normalized_employee_id IS NOT NULL THEN
    SELECT e.id
    INTO employee_uuid
    FROM public.employees e
    WHERE e.employee_id = normalized_employee_id
    LIMIT 1;

    IF employee_uuid IS NOT NULL THEN
      was_created := false;
      RETURN NEXT;
      RETURN;
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.employees (full_name, employee_id, id_photo_path, created_by)
    VALUES (normalized_full_name, normalized_employee_id, _id_photo_path, auth.uid())
    RETURNING id INTO employee_uuid;

    was_created := true;
    RETURN NEXT;
    RETURN;
  EXCEPTION WHEN unique_violation THEN
    IF normalized_employee_id IS NULL THEN
      RAISE;
    END IF;

    SELECT e.id
    INTO employee_uuid
    FROM public.employees e
    WHERE e.employee_id = normalized_employee_id
    LIMIT 1;

    IF employee_uuid IS NULL THEN
      RAISE;
    END IF;

    was_created := false;
    RETURN NEXT;
    RETURN;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_or_create_employee(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_or_create_employee(text, text, text) TO authenticated;