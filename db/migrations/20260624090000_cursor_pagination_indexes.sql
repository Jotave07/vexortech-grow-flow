-- migrate:split-statements
-- Cursor-pagination indexes for orders, products and stores.
-- This migration is intentionally idempotent and must run outside a transaction
-- because PostgreSQL does not allow CREATE INDEX CONCURRENTLY in a transaction.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_store_cursor
  ON public.orders (store_id, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_store_status_cursor
  ON public.orders (store_id, status, created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_store_cursor
  ON public.products (store_id, sort_order ASC, id ASC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_store_category_cursor
  ON public.products (store_id, category_id, sort_order ASC, id ASC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stores_cursor
  ON public.stores (created_at DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stores_active_cursor
  ON public.stores (is_active, is_suspended, name ASC)
  WHERE is_active = true AND is_suspended = false;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS document_file_path text,
  ADD COLUMN IF NOT EXISTS selfie_file_path text,
  ADD COLUMN IF NOT EXISTS document_number text;
