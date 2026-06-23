BEGIN;

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS max_orders_per_month integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'plans_max_orders_per_month_non_negative'
  ) THEN
    ALTER TABLE public.plans
      ADD CONSTRAINT plans_max_orders_per_month_non_negative
      CHECK (max_orders_per_month IS NULL OR max_orders_per_month >= 0);
  END IF;
END $$;

UPDATE public.plans
SET max_orders_per_month = CASE
  WHEN slug ILIKE '%white%' OR slug ILIKE '%premium%' OR slug ILIKE '%enterprise%' OR price_monthly >= 299 THEN NULL
  WHEN slug ILIKE '%prof%' OR slug ILIKE '%pro%' OR slug ILIKE '%avanc%' OR price_monthly >= 119 THEN 2000
  WHEN slug ILIKE '%essencial%' OR slug ILIKE '%intermedi%' OR price_monthly >= 59 THEN 600
  ELSE 300
END
WHERE max_orders_per_month IS NULL;

UPDATE public.plans
SET features = (
  SELECT COALESCE(jsonb_agg(feature), '[]'::jsonb)
  FROM jsonb_array_elements_text(features) AS item(feature)
  WHERE lower(feature) NOT LIKE '%dom%nio%'
    AND lower(feature) NOT LIKE '%domain%'
)
WHERE jsonb_typeof(features) = 'array';

COMMIT;
