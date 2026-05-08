-- 1. Tabelas de Cliente e Marketplace
CREATE TABLE IF NOT EXISTS public.customer_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    label TEXT, -- Ex: "Casa", "Trabalho"
    zip_code TEXT NOT NULL,
    street TEXT NOT NULL,
    number TEXT NOT NULL,
    complement TEXT,
    neighborhood TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    is_visible BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(order_id) -- Apenas uma avaliação por pedido
);

CREATE TABLE IF NOT EXISTS public.customer_favorites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    store_id UUID NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, store_id)
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_user_id UUID REFERENCES auth.users(id),
    store_id UUID REFERENCES public.stores(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Ajustes na tabela orders (garantindo campos e constraints)
-- Nota: ALTERS devem ser protegidos com IF NOT EXISTS ou checagem manual se necessário,
-- assume a criacao dos objetos que faltam nesta migracao.
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'estimated_ready_at') THEN
        ALTER TABLE public.orders ADD COLUMN estimated_ready_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'estimated_delivery_at') THEN
        ALTER TABLE public.orders ADD COLUMN estimated_delivery_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'accepted_at') THEN
        ALTER TABLE public.orders ADD COLUMN accepted_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'preparation_started_at') THEN
        ALTER TABLE public.orders ADD COLUMN preparation_started_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'ready_at') THEN
        ALTER TABLE public.orders ADD COLUMN ready_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'out_for_delivery_at') THEN
        ALTER TABLE public.orders ADD COLUMN out_for_delivery_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'delivered_at') THEN
        ALTER TABLE public.orders ADD COLUMN delivered_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'cancelled_at') THEN
        ALTER TABLE public.orders ADD COLUMN cancelled_at TIMESTAMPTZ;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'cancel_reason') THEN
        ALTER TABLE public.orders ADD COLUMN cancel_reason TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'refused_reason') THEN
        ALTER TABLE public.orders ADD COLUMN refused_reason TEXT;
    END IF;
END $$;

-- 3. Índices de Performance
CREATE INDEX IF NOT EXISTS idx_stores_slug ON public.stores(slug);
CREATE INDEX IF NOT EXISTS idx_stores_active_suspended ON public.stores(is_active, is_suspended);
CREATE INDEX IF NOT EXISTS idx_products_store_active ON public.products(store_id, is_active);
CREATE INDEX IF NOT EXISTS idx_categories_store_active ON public.categories(store_id, is_active);
CREATE INDEX IF NOT EXISTS idx_orders_public_token ON public.orders(public_token);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders(customer_id);

-- 4. RLS - Habilitando e Configurando
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Customer Addresses: Usuário acessa apenas os seus
CREATE POLICY "Users can manage their own addresses" 
ON public.customer_addresses FOR ALL 
USING (auth.uid() = user_id);

-- Store Reviews: Público lê, Cliente cria para seus pedidos entregues
CREATE POLICY "Reviews are viewable by everyone" 
ON public.store_reviews FOR SELECT 
USING (is_visible = true);

CREATE POLICY "Users can review their own delivered orders" 
ON public.store_reviews FOR INSERT 
WITH CHECK (
    auth.uid() = user_id AND 
    EXISTS (
        SELECT 1 FROM public.orders 
        WHERE id = order_id AND status = 'entregue'
    )
);

-- Customer Favorites: Usuário acessa os seus
CREATE POLICY "Users can manage their own favorites" 
ON public.customer_favorites FOR ALL 
USING (auth.uid() = user_id);

-- Audit Logs: Apenas super_admin acessa
CREATE POLICY "Super admins can view audit logs" 
ON public.audit_logs FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = auth.uid() AND role = 'super_admin'
    )
);

-- 5. Função para cálculo de média de avaliações (opcional, mas bom para performance)
CREATE OR REPLACE FUNCTION public.get_store_rating(p_store_id UUID)
RETURNS TABLE(avg_rating NUMERIC, total_reviews BIGINT) AS $$
BEGIN
    RETURN QUERY 
    SELECT 
        COALESCE(AVG(rating), 0)::NUMERIC as avg_rating,
        COUNT(*)::BIGINT as total_reviews
    FROM public.store_reviews
    WHERE store_id = p_store_id AND is_visible = true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
