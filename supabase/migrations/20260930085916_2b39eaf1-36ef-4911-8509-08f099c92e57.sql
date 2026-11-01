CREATE OR REPLACE FUNCTION public.get_or_create_employee(_full_name text, _employee_id text, _photo_path text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _employee_id IS NOT NULL AND _employee_id <> '' THEN
    SELECT id INTO _id FROM employees WHERE employee_id = _employee_id LIMIT 1;
    IF _id IS NOT NULL THEN RETURN _id; END IF;
  END IF;
  INSERT INTO employees (full_name, employee_id, id_photo_path, created_by)
  VALUES (COALESCE(NULLIF(_full_name,''),'Unknown'), NULLIF(_employee_id,''), _photo_path, auth.uid())
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.get_or_create_employee(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_employee(text,text,text) TO authenticated;