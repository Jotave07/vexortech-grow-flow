-- Remover funções sobrecarregadas para evitar conflitos
DROP FUNCTION IF EXISTS public.get_public_order(uuid);
DROP FUNCTION IF EXISTS public.get_public_order(text, uuid);
DROP FUNCTION IF EXISTS public.get_public_order(uuid, text);
DROP FUNCTION IF EXISTS public.get_public_order(text);

-- Criar versão única e completa da get_public_order
CREATE OR REPLACE FUNCTION public.get_public_order(_token text)
 RETURNS TABLE(
   id uuid, 
   status text, 
   total numeric, 
   subtotal numeric, 
   delivery_fee numeric, 
   delivery_type text, 
   order_number integer, 
   created_at timestamp with time zone, 
   notes text, 
   store_name text, 
   store_id uuid, 
   payment_status text, 
   payment_method text, 
   public_token text,
   store_logo_url text,
   store_whatsapp text,
   change_for numeric,
   discount_amount numeric
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    o.id,
    o.status,
    o.total,
    o.subtotal,
    o.delivery_fee,
    o.delivery_type,
    o.order_number,
    o.created_at,
    o.notes,
    s.name as store_name,
    o.store_id,
    o.payment_status,
    o.payment_method,
    o.public_token,
    s.logo_url as store_logo_url,
    st.whatsapp as store_whatsapp,
    o.change_for,
    o.discount_amount
  FROM public.orders o
  JOIN public.stores s ON s.id = o.store_id
  LEFT JOIN public.store_settings st ON st.store_id = s.id
  WHERE o.public_token = _token;
END;
$function$;

-- Remover funções sobrecarregadas de itens
DROP FUNCTION IF EXISTS public.get_public_order_items(uuid);
DROP FUNCTION IF EXISTS public.get_public_order_items(text, uuid);
DROP FUNCTION IF EXISTS public.get_public_order_items(uuid, text);
DROP FUNCTION IF EXISTS public.get_public_order_items(text);

-- Criar versão única e completa da get_public_order_items
CREATE OR REPLACE FUNCTION public.get_public_order_items(_token text)
 RETURNS TABLE(
   id uuid, 
   quantity integer, 
   unit_price numeric, 
   product_name text, 
   options jsonb,
   notes text
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    oi.id,
    oi.quantity,
    oi.unit_price,
    COALESCE(oi.product_name, p.name) as product_name,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
        'name', oio.name,
        'extra_price', oio.extra_price
      ))
      FROM public.order_item_options oio
      WHERE oio.order_item_id = oi.id),
      '[]'::jsonb
    ) as options,
    oi.notes
  FROM public.order_items oi
  LEFT JOIN public.products p ON p.id = oi.product_id
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.public_token = _token;
END;
$function$;

-- Remover funções sobrecarregadas de histórico
DROP FUNCTION IF EXISTS public.get_public_order_status_history(uuid);
DROP FUNCTION IF EXISTS public.get_public_order_status_history(text, uuid);
DROP FUNCTION IF EXISTS public.get_public_order_status_history(uuid, text);
DROP FUNCTION IF EXISTS public.get_public_order_status_history(text);

-- Criar versão única e completa da get_public_order_status_history
CREATE OR REPLACE FUNCTION public.get_public_order_status_history(_token text)
 RETURNS TABLE(
   id uuid, 
   status text, 
   notes text, 
   created_at timestamp with time zone
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    h.id, h.status, h.notes, h.created_at
  FROM public.order_status_history h
  JOIN public.orders o ON o.id = h.order_id
  WHERE o.public_token = _token
  ORDER BY h.created_at DESC;
END;
$function$;
