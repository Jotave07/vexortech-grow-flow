BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  encrypted_password text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid,
  name text NOT NULL,
  public_name text,
  slug text UNIQUE NOT NULL,
  phone text,
  whatsapp text,
  whatsapp_number text,
  logo_url text,
  is_active boolean DEFAULT true,
  is_suspended boolean DEFAULT false,
  delivery_fee numeric DEFAULT 0,
  min_order_amount numeric DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.store_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid UNIQUE NOT NULL,
  whatsapp_number text,
  asaas_api_key text,
  allow_delivery boolean DEFAULT true,
  allow_pickup boolean DEFAULT true,
  accept_pix boolean DEFAULT true,
  accept_cash boolean DEFAULT true,
  accept_card_on_delivery boolean DEFAULT true,
  accept_orders_when_closed boolean DEFAULT false,
  is_open boolean DEFAULT true,
  business_hours jsonb DEFAULT '{}'::jsonb,
  delivery_fee numeric DEFAULT 0,
  delivery_base_fee numeric DEFAULT 0,
  min_order_value numeric DEFAULT 0,
  min_order_amount numeric DEFAULT 0,
  free_delivery_above numeric DEFAULT 0,
  avg_prep_time_minutes integer DEFAULT 30,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL,
  store_id uuid,
  role text DEFAULT 'customer',
  full_name text,
  name text,
  phone text,
  document text,
  street text,
  number text,
  neighborhood text,
  city text,
  state text,
  zip_code text,
  complement text,
  last_login timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  store_id uuid,
  role text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  user_id uuid,
  asaas_id text,
  full_name text,
  name text,
  phone text NOT NULL,
  document text,
  street text,
  number text,
  neighborhood text,
  city text,
  state text,
  zip_code text,
  complement text,
  registration_completed boolean DEFAULT false,
  total_orders integer DEFAULT 0,
  total_spent numeric DEFAULT 0,
  last_order_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  category_id uuid,
  name text NOT NULL,
  description text,
  price numeric NOT NULL DEFAULT 0,
  promo_price numeric,
  image_url text,
  is_active boolean DEFAULT true,
  is_available boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  name text NOT NULL,
  is_required boolean DEFAULT false,
  min_choices integer DEFAULT 0,
  max_choices integer DEFAULT 1,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_option_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  option_id uuid NOT NULL,
  name text NOT NULL,
  extra_price numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  name text,
  city text,
  state text,
  neighborhood text,
  zip_start text,
  zip_end text,
  fee numeric DEFAULT 0,
  min_order numeric DEFAULT 0,
  estimated_minutes integer,
  priority integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  code text NOT NULL,
  discount_type text NOT NULL,
  discount_value numeric NOT NULL DEFAULT 0,
  min_order_value numeric DEFAULT 0,
  max_discount_amount numeric,
  usage_count integer DEFAULT 0,
  usage_limit integer,
  expires_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public.orders_order_number_seq;

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  customer_id uuid,
  order_number integer NOT NULL DEFAULT nextval('public.orders_order_number_seq'),
  public_token text NOT NULL DEFAULT gen_random_uuid()::text,
  idempotency_key text,
  customer_name text,
  customer_phone text,
  customer_document text,
  customer_email text,
  delivery_type text,
  status text DEFAULT 'novo',
  payment_status text DEFAULT 'pendente',
  payment_method text,
  delivery_address text,
  delivery_fee numeric DEFAULT 0,
  subtotal numeric DEFAULT 0,
  discount_amount numeric DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  change_for numeric,
  notes text,
  zip_code text,
  neighborhood text,
  city text,
  state text,
  street text,
  number text,
  complement text,
  delivery_region_id uuid,
  estimated_min integer,
  estimated_max integer,
  delivery_source text,
  distance_km numeric,
  coupon_id uuid,
  coupon_code text,
  is_seen boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  store_id uuid,
  product_id uuid,
  product_name text,
  unit_price numeric NOT NULL DEFAULT 0,
  quantity integer NOT NULL,
  notes text,
  subtotal numeric DEFAULT 0,
  options_total numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_item_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id uuid NOT NULL,
  option_id uuid,
  option_item_id uuid,
  option_name text,
  item_name text,
  extra_price numeric DEFAULT 0,
  price numeric DEFAULT 0,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  store_id uuid NOT NULL,
  status text NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid,
  store_id uuid,
  provider text DEFAULT 'asaas',
  external_id text,
  asaas_id text,
  idempotency_key text,
  amount numeric DEFAULT 0,
  status text DEFAULT 'payment_creating',
  last_error text,
  paid_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'asaas',
  event_type text NOT NULL,
  external_payment_id text,
  order_id uuid,
  store_id uuid,
  payload_hash text NOT NULL,
  payload_redacted jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  price_monthly numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid UNIQUE NOT NULL,
  plan_id uuid,
  asaas_subscription_id text,
  status text DEFAULT 'pendente_pagamento',
  last_payment_status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS public_token text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pendente';
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS notes text;

UPDATE public.orders
SET public_token = gen_random_uuid()::text
WHERE public_token IS NULL OR btrim(public_token) = '';

WITH duplicated_tokens AS (
  SELECT id, row_number() OVER (PARTITION BY public_token ORDER BY created_at NULLS LAST, id) AS rn
  FROM public.orders
  WHERE public_token IS NOT NULL AND btrim(public_token) <> ''
)
UPDATE public.orders o
SET public_token = gen_random_uuid()::text
FROM duplicated_tokens d
WHERE o.id = d.id AND d.rn > 1;

ALTER TABLE public.orders
  ALTER COLUMN public_token SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN public_token SET NOT NULL;

ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS store_id uuid;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS subtotal numeric DEFAULT 0;
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS options_total numeric DEFAULT 0;

ALTER TABLE public.order_item_options ADD COLUMN IF NOT EXISTS option_id uuid;
ALTER TABLE public.order_item_options ADD COLUMN IF NOT EXISTS option_item_id uuid;
ALTER TABLE public.order_item_options ADD COLUMN IF NOT EXISTS option_name text;
ALTER TABLE public.order_item_options ADD COLUMN IF NOT EXISTS item_name text;
ALTER TABLE public.order_item_options ADD COLUMN IF NOT EXISTS extra_price numeric DEFAULT 0;
ALTER TABLE public.order_item_options ADD COLUMN IF NOT EXISTS name text;
UPDATE public.order_item_options SET name = COALESCE(name, item_name, option_name, 'Opcao') WHERE name IS NULL OR btrim(name) = '';
ALTER TABLE public.order_item_options ALTER COLUMN name SET NOT NULL;

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS provider text DEFAULT 'asaas';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS asaas_id text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS status text DEFAULT 'payment_creating';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

WITH duplicated_order_payments AS (
  SELECT id, row_number() OVER (PARTITION BY order_id ORDER BY created_at NULLS LAST, id) AS rn
  FROM public.payments
  WHERE order_id IS NOT NULL
)
UPDATE public.payments p
SET order_id = NULL,
    last_error = COALESCE(last_error, 'Duplicated payment detached by production hardening migration')
FROM duplicated_order_payments d
WHERE p.id = d.id AND d.rn > 1;

WITH duplicated_external AS (
  SELECT id, row_number() OVER (PARTITION BY external_id ORDER BY created_at NULLS LAST, id) AS rn
  FROM public.payments
  WHERE external_id IS NOT NULL AND btrim(external_id) <> ''
)
UPDATE public.payments p
SET external_id = NULL,
    last_error = COALESCE(last_error, 'Duplicated external_id cleared by production hardening migration')
FROM duplicated_external d
WHERE p.id = d.id AND d.rn > 1;

WITH duplicated_asaas AS (
  SELECT id, row_number() OVER (PARTITION BY asaas_id ORDER BY created_at NULLS LAST, id) AS rn
  FROM public.payments
  WHERE asaas_id IS NOT NULL AND btrim(asaas_id) <> ''
)
UPDATE public.payments p
SET asaas_id = NULL,
    last_error = COALESCE(last_error, 'Duplicated asaas_id cleared by production hardening migration')
FROM duplicated_asaas d
WHERE p.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS orders_public_token_unique
  ON public.orders(public_token);

CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_idempotency_unique
  ON public.orders(store_id, customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_order_id_unique
  ON public.payments(order_id)
  WHERE order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_external_id_unique
  ON public.payments(external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_asaas_id_unique
  ON public.payments(asaas_id)
  WHERE asaas_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payment_events_provider_event_payment_hash_unique
  ON public.payment_events(provider, event_type, external_payment_id, payload_hash)
  WHERE external_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_public_token_lookup_idx ON public.orders(public_token);
CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS order_item_options_order_item_id_idx ON public.order_item_options(order_item_id);
CREATE INDEX IF NOT EXISTS payments_order_id_idx ON public.payments(order_id);

DROP FUNCTION IF EXISTS public.get_public_order();
DROP FUNCTION IF EXISTS public.get_public_order(uuid);
DROP FUNCTION IF EXISTS public.get_public_order_items();
DROP FUNCTION IF EXISTS public.get_public_order_items(uuid);
DROP FUNCTION IF EXISTS public.get_public_order_status_history();
DROP FUNCTION IF EXISTS public.get_public_order_status_history(uuid);

DROP FUNCTION IF EXISTS public.is_vexor_admin(uuid);

CREATE OR REPLACE FUNCTION public.is_vexor_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role IN ('super_admin', 'admin', 'vexor_admin')
  ), false);
$$;

DROP FUNCTION IF EXISTS public.get_public_order(text);
DROP FUNCTION IF EXISTS public.get_public_order_items(text);
DROP FUNCTION IF EXISTS public.get_public_order_status_history(text);

CREATE OR REPLACE FUNCTION public.get_public_order(_token text)
RETURNS TABLE (
  id uuid,
  store_id uuid,
  order_number integer,
  public_token text,
  status text,
  payment_status text,
  payment_method text,
  delivery_type text,
  subtotal numeric,
  delivery_fee numeric,
  discount_amount numeric,
  total numeric,
  change_for numeric,
  notes text,
  created_at timestamptz,
  store_name text,
  store_logo_url text,
  store_whatsapp text
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    o.id,
    o.store_id,
    o.order_number,
    o.public_token,
    o.status,
    o.payment_status,
    o.payment_method,
    o.delivery_type,
    o.subtotal,
    o.delivery_fee,
    o.discount_amount,
    o.total,
    o.change_for,
    o.notes,
    o.created_at,
    COALESCE(s.public_name, s.name) AS store_name,
    s.logo_url AS store_logo_url,
    COALESCE(s.whatsapp, s.whatsapp_number, s.phone) AS store_whatsapp
  FROM public.orders o
  JOIN public.stores s ON s.id = o.store_id
  WHERE _token IS NOT NULL
    AND btrim(_token) <> ''
    AND o.public_token = _token
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_public_order_items(_token text)
RETURNS TABLE (
  id uuid,
  product_name text,
  quantity integer,
  unit_price numeric,
  notes text,
  options jsonb
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    oi.id,
    oi.product_name,
    oi.quantity,
    oi.unit_price,
    oi.notes,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'name', oio.name,
          'option_name', oio.option_name,
          'item_name', oio.item_name,
          'extra_price', oio.extra_price
        )
      ) FILTER (WHERE oio.id IS NOT NULL),
      '[]'::jsonb
    ) AS options
  FROM public.orders o
  JOIN public.order_items oi ON oi.order_id = o.id
  LEFT JOIN public.order_item_options oio ON oio.order_item_id = oi.id
  WHERE _token IS NOT NULL
    AND btrim(_token) <> ''
    AND o.public_token = _token
  GROUP BY oi.id, oi.product_name, oi.quantity, oi.unit_price, oi.notes
  ORDER BY oi.created_at NULLS LAST, oi.id;
$$;

CREATE OR REPLACE FUNCTION public.get_public_order_status_history(_token text)
RETURNS TABLE (
  id uuid,
  status text,
  notes text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT h.id, h.status, h.notes, h.created_at
  FROM public.orders o
  JOIN public.order_status_history h ON h.order_id = o.id
  WHERE _token IS NOT NULL
    AND btrim(_token) <> ''
    AND o.public_token = _token
  ORDER BY h.created_at DESC NULLS LAST, h.id DESC;
$$;

CREATE TABLE IF NOT EXISTS public.store_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL,
  rating integer NOT NULL,
  comment text,
  created_at timestamptz DEFAULT now()
);

DROP FUNCTION IF EXISTS public.get_store_rating(uuid);

CREATE OR REPLACE FUNCTION public.get_store_rating(_store_id uuid)
RETURNS TABLE (rating numeric, reviews_count integer)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(round(avg(sr.rating)::numeric, 2), 0::numeric) AS rating,
    count(*)::integer AS reviews_count
  FROM public.store_reviews sr
  WHERE sr.store_id = _store_id;
$$;

COMMENT ON COLUMN public.orders.public_token IS
  'Opaque non-sequential public tracking token generated by PostgreSQL by default.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'store_settings_store_id_fkey') THEN
    ALTER TABLE public.store_settings
      ADD CONSTRAINT store_settings_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_store_id_fkey') THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT customers_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_store_id_fkey') THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_options_product_id_fkey') THEN
    ALTER TABLE public.product_options
      ADD CONSTRAINT product_options_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_option_items_option_id_fkey') THEN
    ALTER TABLE public.product_option_items
      ADD CONSTRAINT product_option_items_option_id_fkey FOREIGN KEY (option_id) REFERENCES public.product_options(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_store_id_fkey') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_customer_id_fkey') THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_order_id_fkey') THEN
    ALTER TABLE public.order_items
      ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_item_options_order_item_id_fkey') THEN
    ALTER TABLE public.order_item_options
      ADD CONSTRAINT order_item_options_order_item_id_fkey FOREIGN KEY (order_item_id) REFERENCES public.order_items(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payments_order_id_fkey') THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_status_history_order_id_fkey') THEN
    ALTER TABLE public.order_status_history
      ADD CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
  END IF;
END $$;

COMMIT;
