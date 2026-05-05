ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_exempt BOOLEAN DEFAULT false;
COMMENT ON COLUMN public.profiles.is_exempt IS 'If true, the user bypasses all subscription and payment checks.';