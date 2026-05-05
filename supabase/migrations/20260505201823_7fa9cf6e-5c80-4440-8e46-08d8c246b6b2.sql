-- Enable RLS on orders and related tables
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies for orders to recreate them correctly
DROP POLICY IF EXISTS "Anyone can create orders" ON public.orders;
DROP POLICY IF EXISTS "Store owners can view their store orders" ON public.orders;
DROP POLICY IF EXISTS "Public can view order by token" ON public.orders;
DROP POLICY IF EXISTS "Store owners can update their store orders" ON public.orders;
DROP POLICY IF EXISTS "Store owners can delete their store orders" ON public.orders;

-- Orders Policies
CREATE POLICY "Anyone can create orders" ON public.orders FOR INSERT WITH CHECK (true);

CREATE POLICY "Store owners can view their store orders" ON public.orders FOR SELECT
USING (EXISTS (SELECT 1 FROM public.stores WHERE stores.id = orders.store_id AND stores.owner_user_id = auth.uid()));

CREATE POLICY "Public can view order by token" ON public.orders FOR SELECT USING (true);

CREATE POLICY "Store owners can update their store orders" ON public.orders FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.stores WHERE stores.id = orders.store_id AND stores.owner_user_id = auth.uid()));

CREATE POLICY "Store owners can delete their store orders" ON public.orders FOR DELETE
USING (EXISTS (SELECT 1 FROM public.stores WHERE stores.id = orders.store_id AND stores.owner_user_id = auth.uid()));

-- Order Items Policies
DROP POLICY IF EXISTS "Anyone can create order items" ON public.order_items;
DROP POLICY IF EXISTS "Store owners can view order items" ON public.order_items;
CREATE POLICY "Anyone can create order items" ON public.order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Store owners can view order items" ON public.order_items FOR SELECT
USING (EXISTS (SELECT 1 FROM public.stores WHERE stores.id = order_items.store_id AND stores.owner_user_id = auth.uid()));
CREATE POLICY "Public can view order items" ON public.order_items FOR SELECT USING (true);

-- Order Item Options Policies
DROP POLICY IF EXISTS "Anyone can create order item options" ON public.order_item_options;
DROP POLICY IF EXISTS "Anyone can view order item options" ON public.order_item_options;
CREATE POLICY "Anyone can create order item options" ON public.order_item_options FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can view order item options" ON public.order_item_options FOR SELECT USING (true);

-- Customers Policies
DROP POLICY IF EXISTS "Anyone can create or find customers" ON public.customers;
DROP POLICY IF EXISTS "Anyone can view customers" ON public.customers;
CREATE POLICY "Anyone can create or find customers" ON public.customers FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can view customers" ON public.customers FOR SELECT USING (true);

-- Order Status History Policies
DROP POLICY IF EXISTS "Anyone can create status history" ON public.order_status_history;
DROP POLICY IF EXISTS "Anyone can view status history" ON public.order_status_history;
CREATE POLICY "Anyone can create status history" ON public.order_status_history FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can view status history" ON public.order_status_history FOR SELECT USING (true);

-- Payments Policies
DROP POLICY IF EXISTS "Anyone can create payments" ON public.payments;
DROP POLICY IF EXISTS "Store owners can view payments" ON public.payments;
CREATE POLICY "Anyone can create payments" ON public.payments FOR INSERT WITH CHECK (true);
CREATE POLICY "Store owners can view payments" ON public.payments FOR SELECT
USING (EXISTS (SELECT 1 FROM public.stores WHERE stores.id = payments.store_id AND stores.owner_user_id = auth.uid()));
CREATE POLICY "Public can view payments" ON public.payments FOR SELECT USING (true);
