BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS document text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS store_id uuid;

WITH ranked_roles AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, role, COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid)
      ORDER BY created_at NULLS LAST, id
    ) AS rn
  FROM public.user_roles
)
DELETE FROM public.user_roles ur
USING ranked_roles ranked
WHERE ur.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_role_store_unique
  ON public.user_roles(user_id, role, COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE OR REPLACE FUNCTION public.normalize_signup_role(_metadata jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _metadata->>'role' IN ('customer', 'store_owner') THEN _metadata->>'role'
    WHEN _metadata->>'account_type' IN ('customer', 'store_owner') THEN _metadata->>'account_type'
    ELSE 'customer'
  END;
$$;

CREATE OR REPLACE FUNCTION public.handle_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  app_role text;
BEGIN
  app_role := public.normalize_signup_role(COALESCE(NEW.raw_user_meta_data, '{}'::jsonb));

  INSERT INTO public.profiles (
    user_id,
    email,
    full_name,
    document,
    role,
    created_at,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    NULLIF(NEW.raw_user_meta_data->>'document', ''),
    app_role,
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = COALESCE(public.profiles.email, EXCLUDED.email),
    full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
    document = COALESCE(NULLIF(public.profiles.document, ''), EXCLUDED.document),
    role = CASE
      WHEN public.profiles.role IN ('admin', 'super_admin', 'store_owner') THEN public.profiles.role
      ELSE EXCLUDED.role
    END,
    updated_at = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, app_role)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_auth_user_created();
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES
      ('store-assets', 'store-assets', true),
      ('logos', 'logos', true),
      ('banners', 'banners', true),
      ('products', 'products', true),
      ('documents', 'documents', false),
      ('receipts', 'receipts', false),
      ('internal-attachments', 'internal-attachments', false)
    ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;
  END IF;
END $$;

COMMENT ON FUNCTION public.handle_auth_user_created() IS
  'Creates the application profile and initial role for users created by Supabase Auth, including OAuth providers.';

COMMIT;
