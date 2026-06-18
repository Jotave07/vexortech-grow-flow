BEGIN;

-- The app reads/writes domain data through the server BFF (`/api/backend`) using
-- direct Postgres credentials. Browser Supabase usage is limited to Auth and
-- public Storage URLs, so anon/authenticated must not keep generated Data API
-- privileges over public application tables/functions.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
  END IF;

  REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC;

ALTER FUNCTION public.is_vexor_admin(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_public_order(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_public_order_items(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_public_order_status_history(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_store_rating(uuid) SET search_path = public, pg_temp;
ALTER FUNCTION public.normalize_signup_role(jsonb) SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_auth_user_created() SET search_path = public, auth, pg_temp;

REVOKE ALL ON FUNCTION public.handle_auth_user_created() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.normalize_signup_role(jsonb) FROM PUBLIC, anon, authenticated;

COMMIT;
