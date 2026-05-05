-- 1. Garantir que a coluna sort_order existe na tabela plans
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- 2. Atualizar a função administrativa mantendo o nome do parâmetro se necessário ou apenas o corpo
CREATE OR REPLACE FUNCTION public.is_vexor_admin(_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE user_id = _user_id AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Reforçar políticas para Planos (Garantir que Admin consiga fazer TUDO)
-- Primeiro limpamos qualquer política duplicada ou restritiva demais
DROP POLICY IF EXISTS "Admins can insert plans" ON public.plans;
DROP POLICY IF EXISTS "Admins can manage all plans" ON public.plans;

-- Criamos uma política abrangente
CREATE POLICY "Admin total access on plans" ON public.plans 
FOR ALL USING (is_vexor_admin(auth.uid())) WITH CHECK (is_vexor_admin(auth.uid()));

-- 4. Corrigir permissões para Lojistas em Categorias e Produtos (essencial para o dia a dia)
DROP POLICY IF EXISTS "Lojistas gerenciam categorias" ON public.categories;
CREATE POLICY "Lojistas gerenciam categorias" ON public.categories 
FOR ALL USING (EXISTS (SELECT 1 FROM stores WHERE stores.id = categories.store_id AND stores.owner_user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM stores WHERE stores.id = categories.store_id AND stores.owner_user_id = auth.uid()));

DROP POLICY IF EXISTS "Lojistas gerenciam produtos" ON public.products;
CREATE POLICY "Lojistas gerenciam produtos" ON public.products 
FOR ALL USING (EXISTS (SELECT 1 FROM stores WHERE stores.id = products.store_id AND stores.owner_user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM stores WHERE stores.id = products.store_id AND stores.owner_user_id = auth.uid()));

-- 5. Garantir que o perfil de usuário tenha a estrutura necessária
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'customer';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS store_id UUID;
