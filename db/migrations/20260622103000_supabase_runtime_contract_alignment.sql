BEGIN;

-- Align the live Supabase schema with the runtime contract used by the app.
-- This migration is intentionally idempotent: it only adds missing columns,
-- tables, indexes and safe backfills.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_featured boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS prep_time_minutes integer;

UPDATE public.products
SET is_featured = COALESCE(is_featured, false)
WHERE is_featured IS NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS is_exempt boolean DEFAULT false;

UPDATE public.profiles
SET is_exempt = COALESCE(is_exempt, false)
WHERE is_exempt IS NULL;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

ALTER TABLE public.delivery_zones
  ADD COLUMN IF NOT EXISTS internal_notes text;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS delivery_city text,
  ADD COLUMN IF NOT EXISTS delivery_neighborhood text,
  ADD COLUMN IF NOT EXISTS delivery_state text,
  ADD COLUMN IF NOT EXISTS delivery_zip_code text,
  ADD COLUMN IF NOT EXISTS estimated_delivery_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS refused_reason text,
  ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

UPDATE public.orders
SET
  delivery_city = COALESCE(delivery_city, city),
  delivery_neighborhood = COALESCE(delivery_neighborhood, neighborhood),
  delivery_state = COALESCE(delivery_state, state),
  delivery_zip_code = COALESCE(delivery_zip_code, zip_code)
WHERE delivery_city IS NULL
   OR delivery_neighborhood IS NULL
   OR delivery_state IS NULL
   OR delivery_zip_code IS NULL;

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS next_opening_time text,
  ADD COLUMN IF NOT EXISTS payment_methods jsonb DEFAULT '{}'::jsonb;

UPDATE public.store_settings ss
SET
  address = COALESCE(ss.address, s.address),
  payment_methods = COALESCE(ss.payment_methods, s.payment_methods, '{}'::jsonb)
FROM public.stores s
WHERE ss.store_id = s.id
  AND (ss.address IS NULL OR ss.payment_methods IS NULL);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid,
  store_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  label text NOT NULL DEFAULT 'Principal',
  street text NOT NULL,
  number text NOT NULL,
  complement text,
  neighborhood text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  zip_code text NOT NULL,
  latitude numeric,
  longitude numeric,
  is_default boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  store_id uuid NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.store_reviews
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS order_id uuid,
  ADD COLUMN IF NOT EXISTS is_visible boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.store_reviews
SET is_visible = COALESCE(is_visible, true),
    updated_at = COALESCE(updated_at, created_at, now())
WHERE is_visible IS NULL OR updated_at IS NULL;

-- Recover legacy stores whose owner profile exists only by store_id, or whose
-- profile was never created after the auth user was provisioned.
UPDATE public.stores s
SET owner_user_id = p.user_id
FROM public.profiles p
WHERE s.owner_user_id IS NULL
  AND p.store_id = s.id
  AND p.user_id IS NOT NULL
  AND COALESCE(p.role, '') IN ('store_owner', 'store_manager', '');

INSERT INTO public.profiles (user_id, store_id, role, full_name, email, is_exempt)
SELECT s.owner_user_id, s.id, 'store_owner', s.name, s.email, false
FROM public.stores s
WHERE s.owner_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = s.owner_user_id
  );

UPDATE public.profiles p
SET
  store_id = COALESCE(p.store_id, s.id),
  role = CASE
    WHEN p.role IN ('admin', 'super_admin', 'vexor_admin') THEN p.role
    ELSE 'store_owner'
  END,
  is_exempt = COALESCE(p.is_exempt, false)
FROM public.stores s
WHERE s.owner_user_id = p.user_id
  AND (p.store_id IS NULL OR p.store_id = s.id);

INSERT INTO public.user_roles (user_id, role, store_id)
SELECT s.owner_user_id, 'store_owner', s.id
FROM public.stores s
WHERE s.owner_user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = s.owner_user_id
      AND ur.store_id = s.id
      AND ur.role = 'store_owner'
  );

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_store_id_fkey') THEN
    ALTER TABLE public.audit_logs
      ADD CONSTRAINT audit_logs_store_id_fkey
      FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_favorites_store_id_fkey') THEN
    ALTER TABLE public.customer_favorites
      ADD CONSTRAINT customer_favorites_store_id_fkey
      FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_category_id_fkey') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_reviews_order_id_fkey') THEN
    ALTER TABLE public.store_reviews
      ADD CONSTRAINT store_reviews_order_id_fkey
      FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF to_regclass('auth.users') IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_addresses_user_id_fkey') THEN
      ALTER TABLE public.customer_addresses
        ADD CONSTRAINT customer_addresses_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_favorites_user_id_fkey') THEN
      ALTER TABLE public.customer_favorites
        ADD CONSTRAINT customer_favorites_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_reviews_user_id_fkey') THEN
      ALTER TABLE public.store_reviews
        ADD CONSTRAINT store_reviews_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS audit_logs_store_id_created_at_idx
  ON public.audit_logs(store_id, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_addresses_user_id_idx
  ON public.customer_addresses(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS customer_addresses_user_default_unique
  ON public.customer_addresses(user_id)
  WHERE is_default IS TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS customer_favorites_user_store_unique
  ON public.customer_favorites(user_id, store_id);

CREATE INDEX IF NOT EXISTS store_reviews_store_id_visible_idx
  ON public.store_reviews(store_id)
  WHERE is_visible IS TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS store_reviews_order_id_unique
  ON public.store_reviews(order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_featured_store_idx
  ON public.products(store_id, is_featured)
  WHERE is_featured IS TRUE;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_favorites ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.audit_logs FROM anon;
    REVOKE ALL ON public.customer_addresses FROM anon;
    REVOKE ALL ON public.customer_favorites FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.audit_logs FROM authenticated;
    REVOKE ALL ON public.customer_addresses FROM authenticated;
    REVOKE ALL ON public.customer_favorites FROM authenticated;
  END IF;
END $$;

COMMIT;
