BEGIN;

-- Kept as a compatibility helper for existing schema checks and callers. Signup
-- metadata is user-controlled in Supabase and can never select an application
-- authorization role.
CREATE OR REPLACE FUNCTION public.normalize_signup_role(_metadata jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT 'customer'::text;
$$;

CREATE OR REPLACE FUNCTION public.handle_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
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
    'customer',
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = COALESCE(public.profiles.email, EXCLUDED.email),
    full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
    document = COALESCE(NULLIF(public.profiles.document, ''), EXCLUDED.document),
    -- A signup trigger may fill a missing role, but it must never demote or
    -- replace an authorization role that was granted by a trusted workflow.
    role = COALESCE(NULLIF(public.profiles.role, ''), EXCLUDED.role),
    updated_at = now();

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'customer')
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

REVOKE ALL ON FUNCTION public.normalize_signup_role(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_auth_user_created() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.normalize_signup_role(jsonb) IS
  'Compatibility helper. Supabase signup metadata is untrusted, so every direct signup resolves to customer.';

COMMENT ON FUNCTION public.handle_auth_user_created() IS
  'Creates customer-only application rows for direct Supabase Auth signups without replacing existing authorization roles.';

COMMIT;
