DROP POLICY IF EXISTS "admins update leaves" ON public.leave_requests;
CREATE POLICY "admins or creators update leaves"
ON public.leave_requests
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR auth.uid() = created_by);