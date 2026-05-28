BEGIN;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS store_type text,
  ADD COLUMN IF NOT EXISTS is_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'profile_pending',
  ADD COLUMN IF NOT EXISTS verification_notes text;

UPDATE public.stores
SET store_type = COALESCE(NULLIF(btrim(store_type), ''), 'Restaurantes'),
    verification_status = COALESCE(NULLIF(btrim(verification_status), ''), 'profile_pending')
WHERE store_type IS NULL
   OR btrim(store_type) = ''
   OR verification_status IS NULL
   OR btrim(verification_status) = '';

CREATE INDEX IF NOT EXISTS stores_public_listing_idx
  ON public.stores(is_active, is_suspended, store_type, name);

CREATE INDEX IF NOT EXISTS stores_verified_idx
  ON public.stores(is_verified)
  WHERE is_verified IS TRUE;

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS features jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS max_products integer,
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allows_coupons boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS allows_advanced_reports boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS allows_custom_branding boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS allows_custom_domain boolean DEFAULT false;

UPDATE public.plans
SET slug = COALESCE(NULLIF(btrim(slug), ''), lower(regexp_replace(name, '[^a-zA-Z0-9]+', '_', 'g'))),
    features = COALESCE(features, '[]'::jsonb),
    sort_order = COALESCE(sort_order, 0)
WHERE slug IS NULL
   OR btrim(slug) = ''
   OR features IS NULL
   OR sort_order IS NULL;

COMMIT;
