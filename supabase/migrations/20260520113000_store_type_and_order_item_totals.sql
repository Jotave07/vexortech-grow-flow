ALTER TABLE public.stores
ADD COLUMN IF NOT EXISTS store_type TEXT;

ALTER TABLE public.stores
ALTER COLUMN store_type SET DEFAULT 'Restaurantes';

UPDATE public.stores
SET store_type = COALESCE(NULLIF(store_type, ''), 'Restaurantes')
WHERE store_type IS NULL OR store_type = '';

CREATE INDEX IF NOT EXISTS idx_stores_store_type
ON public.stores(store_type);

ALTER TABLE public.order_items
ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10,2) DEFAULT 0;

UPDATE public.order_items oi
SET subtotal = COALESCE(NULLIF(oi.subtotal, 0), (
  (COALESCE(oi.unit_price, 0) + COALESCE(option_totals.extra_total, 0)) * COALESCE(oi.quantity, 0)
))
FROM (
  SELECT order_item_id, SUM(COALESCE(extra_price, 0)) AS extra_total
  FROM public.order_item_options
  GROUP BY order_item_id
) option_totals
WHERE option_totals.order_item_id = oi.id
  AND COALESCE(oi.subtotal, 0) = 0;

UPDATE public.order_items
SET subtotal = COALESCE(NULLIF(subtotal, 0), COALESCE(unit_price, 0) * COALESCE(quantity, 0))
WHERE COALESCE(subtotal, 0) = 0;

DROP FUNCTION IF EXISTS public.get_public_order_items(text);

CREATE OR REPLACE FUNCTION public.get_public_order_items(_token text)
RETURNS TABLE(
  id uuid,
  quantity integer,
  unit_price numeric,
  item_subtotal numeric,
  product_name text,
  options jsonb,
  notes text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    oi.id,
    oi.quantity,
    oi.unit_price,
    COALESCE(NULLIF(oi.subtotal, 0), (
      (COALESCE(oi.unit_price, 0) + COALESCE((
        SELECT SUM(COALESCE(oio.extra_price, 0))
        FROM public.order_item_options oio
        WHERE oio.order_item_id = oi.id
      ), 0)) * COALESCE(oi.quantity, 0)
    )) AS item_subtotal,
    COALESCE(oi.product_name, p.name) AS product_name,
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object(
          'name', COALESCE(oio.name, oio.item_name),
          'extra_price', oio.extra_price
        ))
        FROM public.order_item_options oio
        WHERE oio.order_item_id = oi.id
      ),
      '[]'::jsonb
    ) AS options,
    oi.notes
  FROM public.order_items oi
  LEFT JOIN public.products p ON p.id = oi.product_id
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.public_token = _token;
END;
$function$;

COMMENT ON COLUMN public.stores.store_type IS 'Classificação pública da loja usada na vitrine: Restaurantes, Lanches, Pizza, Açaí, Mercados, Bebidas, Farmácia, Pet ou Outros.';
COMMENT ON COLUMN public.order_items.subtotal IS 'Total congelado do item no momento do pedido, incluindo quantidade e adicionais.';

NOTIFY pgrst, 'reload schema';
