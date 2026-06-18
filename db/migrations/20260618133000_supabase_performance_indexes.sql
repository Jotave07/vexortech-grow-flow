-- Supabase performance advisor cleanup.
-- Adds covering indexes for foreign keys and removes a duplicated idempotency index.

CREATE INDEX IF NOT EXISTS customers_store_id_idx
  ON public.customers(store_id);

CREATE INDEX IF NOT EXISTS order_status_history_order_id_idx
  ON public.order_status_history(order_id);

CREATE INDEX IF NOT EXISTS orders_customer_id_idx
  ON public.orders(customer_id);

CREATE INDEX IF NOT EXISTS product_option_items_option_id_idx
  ON public.product_option_items(option_id);

CREATE INDEX IF NOT EXISTS product_options_product_id_idx
  ON public.product_options(product_id);

CREATE INDEX IF NOT EXISTS products_store_id_idx
  ON public.products(store_id);

DROP INDEX IF EXISTS public.orders_checkout_idempotency_unique;
