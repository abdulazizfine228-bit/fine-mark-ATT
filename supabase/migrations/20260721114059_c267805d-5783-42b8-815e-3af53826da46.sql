DROP POLICY IF EXISTS "anyone authed can view employees" ON public.employees;
CREATE POLICY "creators or admins or view can read employees"
ON public.employees FOR SELECT
TO authenticated
USING (
  auth.uid() = created_by
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'view'::app_role)
);