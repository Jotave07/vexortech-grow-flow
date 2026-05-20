-- Tighten customer/order visibility.
-- Public tracking continues through SECURITY DEFINER RPCs using the public token.

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Remove broad read policies that exposed data across customers.
DROP POLICY IF EXISTS "Public can view order by token" ON public.orders;
DROP POLICY IF EXISTS "Users can view their orders by phone" ON public.orders;
DROP POLICY IF EXISTS "Public can view order items" ON public.order_items;
DROP POLICY IF EXISTS "Anyone can view order item options" ON public.order_item_options;
DROP POLICY IF EXISTS "Anyone can view customers" ON public.customers;
DROP POLICY IF EXISTS "Anyone can update customers" ON public.customers;
DROP POLICY IF EXISTS "Anyone can view status history" ON public.order_status_history;
DROP POLICY IF EXISTS "Public can view payments" ON public.payments;
DROP POLICY IF EXISTS "Users can view their own payments" ON public.payments;

-- Customer records.
DROP POLICY IF EXISTS "Users can update their own customer record" ON public.customers;
CREATE POLICY "Users can update their own customer record"
ON public.customers
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can create their own customer record" ON public.customers;
CREATE POLICY "Authenticated users can create their own customer record"
ON public.customers
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = user_id);

-- Orders.
DROP POLICY IF EXISTS "Customers can view their own orders" ON public.orders;
CREATE POLICY "Customers can view their own orders"
ON public.orders
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.customers
    WHERE customers.id = orders.customer_id
      AND customers.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Authenticated users can insert orders" ON public.orders;
CREATE POLICY "Authenticated users can insert orders"
ON public.orders
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Order items and selected options.
DROP POLICY IF EXISTS "Customers can view their own order items" ON public.order_items;
CREATE POLICY "Customers can view their own order items"
ON public.order_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.orders
    JOIN public.customers ON customers.id = orders.customer_id
    WHERE orders.id = order_items.order_id
      AND customers.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Authenticated customers can create own order items" ON public.order_items;
CREATE POLICY "Authenticated customers can create own order items"
ON public.order_items
FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.orders
    JOIN public.customers ON customers.id = orders.customer_id
    WHERE orders.id = order_items.order_id
      AND customers.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Customers can view their own order item options" ON public.order_item_options;
CREATE POLICY "Customers can view their own order item options"
ON public.order_item_options
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.order_items
    JOIN public.orders ON orders.id = order_items.order_id
    JOIN public.customers ON customers.id = orders.customer_id
    WHERE order_items.id = order_item_options.order_item_id
      AND customers.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Store owners can view order item options" ON public.order_item_options;
CREATE POLICY "Store owners can view order item options"
ON public.order_item_options
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.order_items
    JOIN public.orders ON orders.id = order_items.order_id
    JOIN public.stores ON stores.id = orders.store_id
    WHERE order_items.id = order_item_options.order_item_id
      AND stores.owner_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Authenticated customers can create own order item options" ON public.order_item_options;
CREATE POLICY "Authenticated customers can create own order item options"
ON public.order_item_options
FOR INSERT
WITH CHECK (
  auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.order_items
    JOIN public.orders ON orders.id = order_items.order_id
    JOIN public.customers ON customers.id = orders.customer_id
    WHERE order_items.id = order_item_options.order_item_id
      AND customers.user_id = auth.uid()
  )
);

-- Status history and payments.
DROP POLICY IF EXISTS "Customers can view their own status history" ON public.order_status_history;
CREATE POLICY "Customers can view their own status history"
ON public.order_status_history
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.orders
    JOIN public.customers ON customers.id = orders.customer_id
    WHERE orders.id = order_status_history.order_id
      AND customers.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Store owners can view order status history" ON public.order_status_history;
CREATE POLICY "Store owners can view order status history"
ON public.order_status_history
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.orders
    JOIN public.stores ON stores.id = orders.store_id
    WHERE orders.id = order_status_history.order_id
      AND stores.owner_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can view their own payments" ON public.payments;
CREATE POLICY "Users can view their own payments"
ON public.payments
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.orders
    JOIN public.customers ON customers.id = orders.customer_id
    WHERE orders.id = payments.order_id
      AND customers.user_id = auth.uid()
  )
);
