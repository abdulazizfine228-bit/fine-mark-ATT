
-- ATTENDANCE: restrict SELECT
DROP POLICY IF EXISTS "authed view attendance" ON public.attendance;

CREATE POLICY "view attendance scoped"
ON public.attendance
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR auth.uid() = recorded_by
  OR (
    has_role(auth.uid(), 'view'::app_role)
    AND (
      place IS NULL
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (p.place IS NULL OR p.place = 'All' OR p.place = public.attendance.place)
      )
    )
  )
);

-- LEAVE REQUESTS: restrict SELECT
DROP POLICY IF EXISTS "authed view leaves" ON public.leave_requests;

CREATE POLICY "view own or admin leaves"
ON public.leave_requests
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role)
  OR auth.uid() = created_by
  OR auth.uid() = user_id
);

-- STORAGE id-photos: drop overly broad policies
DROP POLICY IF EXISTS "authed read id-photos" ON storage.objects;
DROP POLICY IF EXISTS "authed upload id-photos" ON storage.objects;

-- Admin read for id-photos
CREATE POLICY "admins read id-photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'id-photos' AND has_role(auth.uid(), 'admin'::app_role));

-- Admin and owner delete for id-photos
CREATE POLICY "owners or admins delete id-photos"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'id-photos'
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR auth.uid()::text = (storage.foldername(name))[1]
  )
);
