-- Corrige a separacao entre cliente, parceiro e admin no ciclo de autenticacao.
-- Novos cadastros de loja passam a nascer como store_owner quando o metadata indicar.

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  requested_role text;
  normalized_role text;
BEGIN
  requested_role := COALESCE(
    NEW.raw_user_meta_data->>'account_type',
    NEW.raw_user_meta_data->>'role',
    'customer'
  );

  normalized_role := CASE
    WHEN lower(NEW.email) = 'jvieira@vexortech.com.br' THEN 'super_admin'
    WHEN requested_role IN ('store_owner', 'merchant', 'partner', 'parceiro', 'lojista') THEN 'store_owner'
    ELSE 'customer'
  END;

  INSERT INTO public.profiles (user_id, full_name, email, document, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'USUARIO'),
    NEW.email,
    NULLIF(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'document', ''), '\D', '', 'g'), ''),
    normalized_role
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    email = COALESCE(EXCLUDED.email, public.profiles.email),
    document = COALESCE(EXCLUDED.document, public.profiles.document),
    role = CASE
      WHEN public.profiles.role = 'super_admin' THEN 'super_admin'
      ELSE EXCLUDED.role
    END;

  INSERT INTO public.user_roles (user_id, role)
  SELECT NEW.id, normalized_role
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = NEW.id
      AND role = normalized_role
  );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS TRIGGER AS $$
DECLARE
  db_role text;
BEGIN
  db_role := current_setting('role', true);

  IF (OLD.role IS DISTINCT FROM NEW.role OR OLD.is_exempt IS DISTINCT FROM NEW.is_exempt) THEN
    IF db_role IN ('postgres', 'service_role', 'supabase_admin') THEN
      RETURN NEW;
    END IF;

    IF (
      OLD.role = 'customer'
      AND NEW.role = 'store_owner'
      AND NEW.store_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.stores
        WHERE stores.id = NEW.store_id
          AND stores.owner_user_id = auth.uid()
      )
    ) THEN
      RETURN NEW;
    END IF;

    IF NOT (SELECT public.is_vexor_admin(auth.uid())) THEN
      NEW.role := OLD.role;
      NEW.is_exempt := OLD.is_exempt;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

UPDATE public.profiles p
SET
  store_id = s.id,
  role = 'store_owner'
FROM public.stores s
WHERE p.user_id = s.owner_user_id;

INSERT INTO public.user_roles (user_id, role, store_id)
SELECT s.owner_user_id, 'store_owner', s.id
FROM public.stores s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.user_roles ur
  WHERE ur.user_id = s.owner_user_id
    AND ur.role = 'store_owner'
);

UPDATE public.user_roles ur
SET store_id = s.id
FROM public.stores s
WHERE ur.user_id = s.owner_user_id
  AND ur.role = 'store_owner'
  AND ur.store_id IS NULL;

UPDATE public.profiles
SET role = 'super_admin'
WHERE lower(email) = 'jvieira@vexortech.com.br';

INSERT INTO public.user_roles (user_id, role)
SELECT user_id, 'super_admin'
FROM public.profiles
WHERE lower(email) = 'jvieira@vexortech.com.br'
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = profiles.user_id
      AND ur.role = 'super_admin'
  );
