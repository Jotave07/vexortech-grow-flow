CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'USUARIO'),
    NEW.email,
    CASE WHEN NEW.email = 'jvieira@vexortech.com.br' THEN 'super_admin' ELSE 'customer' END
  )
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    CASE WHEN NEW.email = 'jvieira@vexortech.com.br' THEN 'super_admin' ELSE 'customer' END
  )
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$function$;

UPDATE public.profiles
SET role = 'customer'
WHERE role = 'store_owner'
  AND store_id IS NULL
  AND user_id NOT IN (SELECT owner_user_id FROM public.stores WHERE owner_user_id IS NOT NULL);

DELETE FROM public.user_roles ur1
USING public.user_roles ur2
WHERE ur1.ctid < ur2.ctid
  AND ur1.user_id = ur2.user_id
  AND ur1.role = ur2.role;