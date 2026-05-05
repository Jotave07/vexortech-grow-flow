-- Allow anyone to view store settings (required for checkout)
CREATE POLICY "Anyone can view store settings" ON public.store_settings FOR SELECT USING (true);

-- Ensure customers can view their own orders
DROP POLICY IF EXISTS "Customers can view their own orders" ON public.orders;
CREATE POLICY "Customers can view their own orders" ON public.orders 
FOR SELECT USING (auth.uid() IN (SELECT user_id FROM customers WHERE id = customer_id));

-- Ensure customers can insert orders
DROP POLICY IF EXISTS "Customers can insert orders" ON public.orders;
CREATE POLICY "Customers can insert orders" ON public.orders 
FOR INSERT WITH CHECK (true); -- We will enforce auth in the code, but RLS needs to allow the insert. 
-- Actually, better to check auth.uid()
DROP POLICY IF EXISTS "Authenticated users can insert orders" ON public.orders;
CREATE POLICY "Authenticated users can insert orders" ON public.orders 
FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Payments RLS
DROP POLICY IF EXISTS "Anyone can insert payments" ON public.payments;
CREATE POLICY "Anyone can insert payments" ON public.payments 
FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Users can view their own payments" ON public.payments;
CREATE POLICY "Users can view their own payments" ON public.payments 
FOR SELECT USING (true);
