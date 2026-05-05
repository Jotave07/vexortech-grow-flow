-- Add missing columns
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE public.store_settings ADD COLUMN IF NOT EXISTS accept_card_online BOOLEAN DEFAULT false;
ALTER TABLE public.delivery_zones 
ADD COLUMN IF NOT EXISTS city TEXT,
ADD COLUMN IF NOT EXISTS min_order DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;

-- RPC functions for public access (tracking)
CREATE OR REPLACE FUNCTION public.get_public_order(_order_id UUID)
RETURNS TABLE (
  id UUID,
  status TEXT,
  total DECIMAL,
  created_at TIMESTAMP WITH TIME ZONE,
  delivery_type TEXT,
  payment_method TEXT,
  notes TEXT,
  store_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id, o.status, o.total, o.created_at, o.delivery_type, o.payment_method, o.notes, s.name as store_name
  FROM public.orders o
  JOIN public.stores s ON s.id = o.store_id
  WHERE o.id = _order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_public_order_items(_order_id UUID)
RETURNS TABLE (
  id UUID,
  quantity INTEGER,
  unit_price DECIMAL,
  product_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    oi.id, oi.quantity, oi.unit_price, p.name as product_name
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = _order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_public_order_status_history(_order_id UUID)
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
  WHERE h.order_id = _order_id
  ORDER BY h.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
