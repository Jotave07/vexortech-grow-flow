-- Atualizar a função administrativa para aceitar super_admin e admin
CREATE OR REPLACE FUNCTION public.is_vexor_admin(_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE user_id = _user_id AND role IN ('admin', 'super_admin')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Garantir que as tabelas críticas tenham as permissões corretas usando a função atualizada
-- O Supabase recarrega as políticas automaticamente ao atualizar a função da qual dependem.
