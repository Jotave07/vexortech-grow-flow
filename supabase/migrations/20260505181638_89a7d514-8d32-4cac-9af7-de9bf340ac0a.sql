-- Table orders improvements
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS order_number SERIAL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Table order_item_options improvements
ALTER TABLE public.order_item_options 
ADD COLUMN IF NOT EXISTS name TEXT,
ADD COLUMN IF NOT EXISTS option_item_id UUID;

-- Table store_settings improvements
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Update RPC functions to handle optional order_id if token is provided
CREATE OR REPLACE FUNCTION public.get_public_order(_token TEXT, _order_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  status TEXT,
  total DECIMAL,
  created_at TIMESTAMP WITH TIME ZONE,
  delivery_type TEXT,
  payment_method TEXT,
  notes TEXT,
  store_name TEXT,
  store_id UUID,
  payment_status TEXT,
  public_token TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id, o.status, o.total, o.created_at, o.delivery_type, o.payment_method, o.notes, 
    s.name as store_name, o.store_id, o.payment_status, o.public_token
  FROM public.orders o
  JOIN public.stores s ON s.id = o.store_id
  WHERE (o.public_token = _token) AND (_order_id IS NULL OR o.id = _order_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_public_order_items(_token TEXT, _order_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  quantity INTEGER,
  unit_price DECIMAL,
  product_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    oi.id, oi.quantity, oi.unit_price, COALESCE(oi.product_name, p.name) as product_name
  FROM public.order_items oi
  LEFT JOIN public.products p ON p.id = oi.product_id
  JOIN public.orders o ON o.id = oi.order_id
  WHERE (o.public_token = _token) AND (_order_id IS NULL OR o.id = _order_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_public_order_status_history(_token TEXT, _order_id UUID DEFAULT NULL)
RETURNS TABLE (
  id UUID,
  status TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    h.id, h.status, h.notes, h.created_at
  FROM public.order_status_history h
  JOIN public.orders o ON o.id = h.order_id
  WHERE (o.public_token = _token) AND (_order_id IS NULL OR o.id = _order_id)
  ORDER BY h.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
