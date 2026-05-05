-- 1. Criar Buckets de Armazenamento
INSERT INTO storage.buckets (id, name, public) 
VALUES ('store-assets', 'store-assets', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public) 
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Políticas de Armazenamento (Storage)
-- Permitir que qualquer usuário autenticado faça upload (simplificado para garantir funcionamento inicial)
CREATE POLICY "Acesso público leitura store-assets" ON storage.objects FOR SELECT USING (bucket_id = 'store-assets');
CREATE POLICY "Upload autenticado store-assets" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'store-assets' AND auth.role() = 'authenticated');
CREATE POLICY "Update autenticado store-assets" ON storage.objects FOR UPDATE USING (bucket_id = 'store-assets' AND auth.role() = 'authenticated');
CREATE POLICY "Delete autenticado store-assets" ON storage.objects FOR DELETE USING (bucket_id = 'store-assets' AND auth.role() = 'authenticated');

-- 3. RLS para delivery_zones
ALTER TABLE public.delivery_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Donos de loja gerenciam suas zonas de entrega" 
ON public.delivery_zones 
FOR ALL 
USING (
  store_id IN (SELECT id FROM public.stores WHERE owner_user_id = auth.uid())
);

CREATE POLICY "Leitura pública de zonas de entrega" 
ON public.delivery_zones 
FOR SELECT 
USING (true);

-- 4. RLS para coupons
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Donos de loja gerenciam seus cupons" 
ON public.coupons 
FOR ALL 
USING (
  store_id IN (SELECT id FROM public.stores WHERE owner_user_id = auth.uid())
);

CREATE POLICY "Leitura pública de cupons" 
ON public.coupons 
FOR SELECT 
USING (true);

-- 5. Garante que is_available existe em products (para evitar erro de 'Esgotado')
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_available BOOLEAN DEFAULT true;

NOTIFY pgrst, 'reload schema';