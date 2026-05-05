-- Payments improvements
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS external_id TEXT;

-- Customers improvements
ALTER TABLE public.customers ALTER COLUMN full_name DROP NOT NULL;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS name TEXT;

-- Order Item Options
ALTER TABLE public.order_item_options ADD COLUMN IF NOT EXISTS price DECIMAL(10,2) DEFAULT 0;

-- Ensure store_settings and stores are synced
ALTER TABLE public.stores 
ADD COLUMN IF NOT EXISTS address TEXT,
ADD COLUMN IF NOT EXISTS delivery_fee DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS min_order_amount DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS payment_methods JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS whatsapp_number TEXT;
