-- Ensure public schema is correctly configured
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- Final column check for stores
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS cover_url TEXT;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT false;

-- Final column check for store_settings
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS business_hours JSONB DEFAULT '{}';
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS payment_methods JSONB DEFAULT '[]';

-- Final policies cleanup
DROP POLICY IF EXISTS "Everyone can see stores" ON public.stores;
CREATE POLICY "Everyone can see stores" ON public.stores FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public can see products" ON public.products;
CREATE POLICY "Public can see products" ON public.products FOR SELECT USING (true);
