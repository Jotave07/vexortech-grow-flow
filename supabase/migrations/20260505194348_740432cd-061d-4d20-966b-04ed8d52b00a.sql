-- Adiciona colunas faltantes em store_settings
ALTER TABLE public.store_settings 
ADD COLUMN IF NOT EXISTS free_delivery_above NUMERIC,
ADD COLUMN IF NOT EXISTS next_opening_time TEXT;

-- Adiciona colunas de cupom em orders
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES public.coupons(id),
ADD COLUMN IF NOT EXISTS coupon_code TEXT;

-- Adiciona asaas_id em customers
ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS asaas_id TEXT;

-- Atualiza cache
NOTIFY pgrst, 'reload schema';