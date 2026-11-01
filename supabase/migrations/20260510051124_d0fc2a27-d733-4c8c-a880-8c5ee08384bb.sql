ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'view';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS place text;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS place text;