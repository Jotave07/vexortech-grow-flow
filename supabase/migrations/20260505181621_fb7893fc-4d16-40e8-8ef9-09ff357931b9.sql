-- Add missing columns to orders
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS public_token TEXT DEFAULT gen_random_uuid()::text,
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pendente',
ADD COLUMN IF NOT EXISTS customer_name TEXT,
ADD COLUMN IF NOT EXISTS customer_email TEXT,
ADD COLUMN IF NOT EXISTS customer_document TEXT,
ADD COLUMN IF NOT EXISTS delivery_address TEXT,
ADD COLUMN IF NOT EXISTS delivery_neighborhood TEXT,
ADD COLUMN IF NOT EXISTS delivery_city TEXT,
ADD COLUMN IF NOT EXISTS delivery_state TEXT,
ADD COLUMN IF NOT EXISTS delivery_zip_code TEXT,
ADD COLUMN IF NOT EXISTS delivery_fee DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS subtotal DECIMAL(10,2) DEFAULT 0;

-- Add missing columns to order_item_options
ALTER TABLE public.order_item_options 
ADD COLUMN IF NOT EXISTS option_name TEXT,
ADD COLUMN IF NOT EXISTS item_name TEXT,
ADD COLUMN IF NOT EXISTS extra_price DECIMAL(10,2) DEFAULT 0;

-- Add missing columns to order_items
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS product_name TEXT;

-- Update customers table
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS name TEXT;
UPDATE public.customers SET name = full_name WHERE name IS NULL;

-- Update RPC functions to include _token check
CREATE OR REPLACE FUNCTION public.get_public_order(_order_id UUID, _token TEXT DEFAULT NULL)
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
  payment_status TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id, o.status, o.total, o.created_at, o.delivery_type, o.payment_method, o.notes, 
    s.name as store_name, o.store_id, o.payment_status
  FROM public.orders o
  JOIN public.stores s ON s.id = o.store_id
  WHERE o.id = _order_id AND (o.public_token = _token OR _token IS NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_public_order_items(_order_id UUID, _token TEXT DEFAULT NULL)
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
  WHERE oi.order_id = _order_id AND (o.public_token = _token OR _token IS NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_public_order_status_history(_order_id UUID, _token TEXT DEFAULT NULL)
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
  WHERE h.order_id = _order_id AND (o.public_token = _token OR _token IS NULL)
  ORDER BY h.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
