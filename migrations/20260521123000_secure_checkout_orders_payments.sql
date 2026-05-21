BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS public_token text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key text;

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

WITH duplicated_idempotency AS (
  SELECT id, row_number() OVER (PARTITION BY idempotency_key ORDER BY created_at NULLS LAST, id) AS rn
  FROM public.orders
  WHERE idempotency_key IS NOT NULL AND btrim(idempotency_key) <> ''
)
UPDATE public.orders o
SET idempotency_key = o.idempotency_key || ':' || o.id::text
FROM duplicated_idempotency d
WHERE o.id = d.id AND d.rn > 1;

ALTER TABLE public.orders
  ALTER COLUMN public_token SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN public_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_public_token_unique
  ON public.orders(public_token);

CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_unique
  ON public.orders(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS asaas_id text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS provider text DEFAULT 'asaas';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

WITH duplicated_order_payments AS (
  SELECT id, row_number() OVER (PARTITION BY order_id ORDER BY created_at NULLS LAST, id) AS rn
  FROM public.payments
  WHERE order_id IS NOT NULL
)
UPDATE public.payments p
SET order_id = NULL,
    last_error = COALESCE(last_error, 'Duplicated payment detached by secure checkout migration')
FROM duplicated_order_payments d
WHERE p.id = d.id AND d.rn > 1;

WITH duplicated_external AS (
  SELECT id, row_number() OVER (PARTITION BY external_id ORDER BY created_at NULLS LAST, id) AS rn
  FROM public.payments
  WHERE external_id IS NOT NULL AND btrim(external_id) <> ''
)
UPDATE public.payments p
SET external_id = NULL,
    last_error = COALESCE(last_error, 'Duplicated external_id cleared by secure checkout migration')
FROM duplicated_external d
WHERE p.id = d.id AND d.rn > 1;

WITH duplicated_asaas AS (
  SELECT id, row_number() OVER (PARTITION BY asaas_id ORDER BY created_at NULLS LAST, id) AS rn
  FROM public.payments
  WHERE asaas_id IS NOT NULL AND btrim(asaas_id) <> ''
)
UPDATE public.payments p
SET asaas_id = NULL,
    last_error = COALESCE(last_error, 'Duplicated asaas_id cleared by secure checkout migration')
FROM duplicated_asaas d
WHERE p.id = d.id AND d.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS payments_order_id_unique
  ON public.payments(order_id)
  WHERE order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_external_id_unique
  ON public.payments(external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS payments_asaas_id_unique
  ON public.payments(asaas_id)
  WHERE asaas_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.get_public_order();
DROP FUNCTION IF EXISTS public.get_public_order(uuid);
DROP FUNCTION IF EXISTS public.get_public_order_items();
DROP FUNCTION IF EXISTS public.get_public_order_items(uuid);
DROP FUNCTION IF EXISTS public.get_public_order_status_history();
DROP FUNCTION IF EXISTS public.get_public_order_status_history(uuid);

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
    NULL::text AS notes,
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
  GROUP BY oi.id, oi.product_name, oi.quantity, oi.unit_price
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

COMMENT ON COLUMN public.orders.public_token IS
  'Opaque non-sequential public tracking token. PostgreSQL generates it by default, so INSERT ... RETURNING public_token must return a non-null value.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
  END IF;
END $$;

COMMIT;
