ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS delivery_reference text,
  ADD COLUMN IF NOT EXISTS zip_code text,
  ADD COLUMN IF NOT EXISTS neighborhood text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text;

DROP FUNCTION IF EXISTS public.get_public_order(text);

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
  delivery_address text,
  delivery_reference text,
  zip_code text,
  neighborhood text,
  city text,
  state text,
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
    o.delivery_address,
    o.delivery_reference,
    o.zip_code,
    o.neighborhood,
    o.city,
    o.state,
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
