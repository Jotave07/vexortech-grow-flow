CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS TRIGGER AS $$
BEGIN
    -- Only allow super_admins (or the system/postgres role) to change role or is_exempt
    IF (OLD.role <> NEW.role OR OLD.is_exempt <> NEW.is_exempt) THEN
        IF NOT (SELECT is_vexor_admin(auth.uid())) THEN
            -- If it's the same user updating their own profile, reset the sensitive columns to their old values
            NEW.role := OLD.role;
            NEW.is_exempt := OLD.is_exempt;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS tr_protect_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER tr_protect_profile_sensitive_columns
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_sensitive_columns();