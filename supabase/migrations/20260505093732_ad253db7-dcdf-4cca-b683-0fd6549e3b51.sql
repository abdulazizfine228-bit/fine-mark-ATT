
-- 1. Promote the specified user to admin
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role FROM auth.users WHERE email = 'abdulazizfine228@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- Also update the profile employee_id if missing
UPDATE public.profiles
SET employee_id = COALESCE(employee_id, 'FM153')
WHERE id = (SELECT id FROM auth.users WHERE email = 'abdulazizfine228@gmail.com');

-- 2. Create employees table (people being scanned, not auth users)
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  employee_id text UNIQUE,
  id_photo_path text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone authed can view employees"
  ON public.employees FOR SELECT TO authenticated USING (true);

CREATE POLICY "anyone authed can add employees"
  ON public.employees FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "admins update employees"
  ON public.employees FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete employees"
  ON public.employees FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- 3. Attendance: add employee_id (subject) and recorded_by (scanner)
ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS recorded_by uuid;

-- Make user_id nullable (legacy column)
ALTER TABLE public.attendance ALTER COLUMN user_id DROP NOT NULL;

DROP POLICY IF EXISTS "view own attendance" ON public.attendance;
DROP POLICY IF EXISTS "insert own attendance" ON public.attendance;
DROP POLICY IF EXISTS "admins delete attendance" ON public.attendance;

CREATE POLICY "authed view attendance"
  ON public.attendance FOR SELECT TO authenticated USING (true);

CREATE POLICY "authed insert attendance"
  ON public.attendance FOR INSERT TO authenticated WITH CHECK (auth.uid() = recorded_by);

CREATE POLICY "admins delete attendance"
  ON public.attendance FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

-- 4. Leave: add employee_id; allow admins/creators to insert for any employee
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES public.employees(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS created_by uuid;

ALTER TABLE public.leave_requests ALTER COLUMN user_id DROP NOT NULL;

DROP POLICY IF EXISTS "view own leaves" ON public.leave_requests;
DROP POLICY IF EXISTS "insert own leaves" ON public.leave_requests;
DROP POLICY IF EXISTS "users delete own pending leaves" ON public.leave_requests;
DROP POLICY IF EXISTS "admins update leaves" ON public.leave_requests;

CREATE POLICY "authed view leaves"
  ON public.leave_requests FOR SELECT TO authenticated USING (true);

CREATE POLICY "authed insert leaves"
  ON public.leave_requests FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

CREATE POLICY "admins update leaves"
  ON public.leave_requests FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "admins or creators delete pending leaves"
  ON public.leave_requests FOR DELETE TO authenticated
  USING (status = 'pending' AND (auth.uid() = created_by OR has_role(auth.uid(), 'admin')));

-- 5. Storage policies for id-photos bucket so any authed user can upload/read
DROP POLICY IF EXISTS "authed upload id-photos" ON storage.objects;
DROP POLICY IF EXISTS "authed read id-photos" ON storage.objects;

CREATE POLICY "authed upload id-photos"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'id-photos');

CREATE POLICY "authed read id-photos"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'id-photos');
