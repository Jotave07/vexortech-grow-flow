-- Consolidate schema
-- This ensures everything is in sync and triggers a type refresh

-- Table: customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS total_orders INTEGER DEFAULT 0;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS total_spent DECIMAL(10,2) DEFAULT 0;

-- Table: products
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS promo_price DECIMAL(10,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS prep_time_minutes INTEGER;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false;

-- Table: order_items
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE;

-- Table: subscriptions
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS last_payment_status TEXT;

-- Table: orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS is_seen BOOLEAN DEFAULT false;

-- Ensure RLS is active and correct
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners can manage their own customers" ON public.customers FOR ALL USING (EXISTS (SELECT 1 FROM public.stores WHERE id = store_id AND owner_user_id = auth.uid()));

-- Table: categories
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS description TEXT;

-- Table: coupons
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS min_order_value DECIMAL(10,2) DEFAULT 0;
