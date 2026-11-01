ALTER TABLE public.attendance
  ADD COLUMN IF NOT EXISTS project_name text,
  ADD COLUMN IF NOT EXISTS location_lat numeric,
  ADD COLUMN IF NOT EXISTS location_lng numeric,
  ADD COLUMN IF NOT EXISTS location_address text,
  ADD COLUMN IF NOT EXISTS checked_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS total_minutes numeric
    GENERATED ALWAYS AS (
      CASE WHEN checked_out_at IS NOT NULL
           THEN EXTRACT(EPOCH FROM (checked_out_at - captured_at)) / 60.0
           ELSE NULL END
    ) STORED;

CREATE POLICY "recorder or admin updates attendance"
ON public.attendance
FOR UPDATE
TO authenticated
USING (auth.uid() = recorded_by OR has_role(auth.uid(), 'admin'::app_role));