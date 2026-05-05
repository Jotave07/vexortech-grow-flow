-- Adicionar coluna sort_order à tabela plans se ela não existir
ALTER TABLE public.plans 
ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Garantir que os administradores tenham acesso total para inserir planos
-- O usuário já criou a política "Admins can do everything on plans" mas vamos reforçar
-- se houver algum problema com o is_vexor_admin

DO $$ 
BEGIN
    -- Se a política de inserção não existir de forma clara para admin, podemos adicionar uma específica
    -- Mas a política "Admins can do everything on plans" com cmd=ALL já cobre isso.
    -- O erro de RLS na loja foi resolvido anteriormente, agora focamos no schema cache e acesso.
END $$;
