-- Drop partial unique index (partial indexes don't work with ON CONFLICT)
-- and create a full unique constraint so upsert works correctly.
DROP INDEX IF EXISTS public.store_reviews_order_id_unique;

-- Recreate as a full unique index (no WHERE clause)
CREATE UNIQUE INDEX IF NOT EXISTS store_reviews_order_id_unique
  ON public.store_reviews(order_id);
