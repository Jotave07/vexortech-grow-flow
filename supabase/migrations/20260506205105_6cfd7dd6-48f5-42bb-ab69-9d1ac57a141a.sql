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
 SET search_path = public
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
    COALESCE(s.whatsapp_number, s.phone) as store_whatsapp,
    o.change_for,
    o.discount_amount
  FROM public.orders o
  JOIN public.stores s ON s.id = o.store_id
  WHERE o.public_token = _token;
END;
$function$;
