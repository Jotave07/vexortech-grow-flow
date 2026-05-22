BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.orders_order_number_seq;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_number integer;

LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE;

SELECT setval(
  'public.orders_order_number_seq'::regclass,
  COALESCE((SELECT max(order_number) FROM public.orders WHERE order_number IS NOT NULL), 1),
  (SELECT max(order_number) IS NOT NULL FROM public.orders WHERE order_number IS NOT NULL)
);

WITH missing_orders AS (
  SELECT id
  FROM public.orders
  WHERE order_number IS NULL
  ORDER BY created_at NULLS FIRST, id
)
UPDATE public.orders AS orders
SET order_number = nextval('public.orders_order_number_seq'::regclass)
FROM missing_orders
WHERE orders.id = missing_orders.id;

SELECT setval(
  'public.orders_order_number_seq'::regclass,
  COALESCE((SELECT max(order_number) FROM public.orders WHERE order_number IS NOT NULL), 1),
  (SELECT max(order_number) IS NOT NULL FROM public.orders WHERE order_number IS NOT NULL)
);

ALTER TABLE public.orders
  ALTER COLUMN order_number SET DEFAULT nextval('public.orders_order_number_seq'::regclass),
  ALTER COLUMN order_number SET NOT NULL;

ALTER SEQUENCE public.orders_order_number_seq
  OWNED BY public.orders.order_number;

CREATE UNIQUE INDEX IF NOT EXISTS orders_order_number_unique
ON public.orders(order_number);

COMMIT;
