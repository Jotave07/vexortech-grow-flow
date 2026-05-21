BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS delivery_radius_km numeric;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS address_number text,
  ADD COLUMN IF NOT EXISTS address_complement text,
  ADD COLUMN IF NOT EXISTS neighborhood text;

ALTER TABLE public.delivery_zones
  ADD COLUMN IF NOT EXISTS max_radius_km numeric,
  ADD COLUMN IF NOT EXISTS fee numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fee_per_km numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_fee numeric,
  ADD COLUMN IF NOT EXISTS max_fee numeric,
  ADD COLUMN IF NOT EXISTS min_order numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_prep_time integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS minutes_per_km numeric DEFAULT 5,
  ADD COLUMN IF NOT EXISTS additional_region_time integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_region_id uuid,
  ADD COLUMN IF NOT EXISTS distance_km numeric,
  ADD COLUMN IF NOT EXISTS delivery_source text,
  ADD COLUMN IF NOT EXISTS estimated_min integer,
  ADD COLUMN IF NOT EXISTS estimated_max integer,
  ADD COLUMN IF NOT EXISTS delivery_reference text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS public_token text,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS preparation_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS out_for_delivery_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

UPDATE public.orders
SET public_token = gen_random_uuid()::text
WHERE public_token IS NULL OR btrim(public_token) = '';

ALTER TABLE public.orders
  ALTER COLUMN public_token SET DEFAULT gen_random_uuid()::text;

ALTER TABLE public.orders
  ALTER COLUMN public_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_public_token_unique
ON public.orders(public_token);

CREATE INDEX IF NOT EXISTS delivery_zones_store_active_idx
ON public.delivery_zones(store_id, is_active);

CREATE INDEX IF NOT EXISTS delivery_zones_location_idx
ON public.delivery_zones(store_id, state, city, neighborhood);

CREATE INDEX IF NOT EXISTS orders_store_status_created_idx
ON public.orders(store_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS orders_store_customer_idempotency_unique
ON public.orders(store_id, customer_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_type text NOT NULL,
  order_id uuid NOT NULL,
  recipient_phone text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_events_provider_type_order_recipient_unique
ON public.notification_events(provider, event_type, order_id, recipient_phone);

COMMIT;
