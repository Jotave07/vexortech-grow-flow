-- Primeiro criar a função auxiliar
CREATE OR REPLACE FUNCTION public.check_column_exists(t_name text, c_name text) RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = t_name 
    AND column_name = c_name
  );
END;
$$ LANGUAGE plpgsql;

-- Tabela de endereços do cliente
CREATE TABLE IF NOT EXISTS public.customer_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    zip_code TEXT NOT NULL,
    street TEXT NOT NULL,
    number TEXT NOT NULL,
    complement TEXT,
    neighborhood TEXT NOT NULL,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Habilitar RLS
ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;

-- Políticas
DROP POLICY IF EXISTS "Clientes podem ver seus próprios endereços" ON public.customer_addresses;
CREATE POLICY "Clientes podem ver seus próprios endereços"
    ON public.customer_addresses FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Clientes podem criar seus próprios endereços" ON public.customer_addresses;
CREATE POLICY "Clientes podem criar seus próprios endereços"
    ON public.customer_addresses FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Clientes podem editar seus próprios endereços" ON public.customer_addresses;
CREATE POLICY "Clientes podem editar seus próprios endereços"
    ON public.customer_addresses FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Clientes podem excluir seus próprios endereços" ON public.customer_addresses;
CREATE POLICY "Clientes podem excluir seus próprios endereços"
    ON public.customer_addresses FOR DELETE
    USING (auth.uid() = user_id);

-- Adicionar campos em orders
DO $$ 
BEGIN 
    IF NOT public.check_column_exists('orders', 'change_for') THEN
        ALTER TABLE public.orders ADD COLUMN change_for NUMERIC;
    END IF;
    
    IF NOT public.check_column_exists('orders', 'scheduled_at') THEN
        ALTER TABLE public.orders ADD COLUMN scheduled_at TIMESTAMP WITH TIME ZONE;
    END IF;

    IF NOT public.check_column_exists('orders', 'idempotency_key') THEN
        ALTER TABLE public.orders ADD COLUMN idempotency_key TEXT UNIQUE;
    END IF;

    ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_delivery_type_check;
    ALTER TABLE public.orders ADD CONSTRAINT orders_delivery_type_check CHECK (delivery_type IN ('entrega', 'retirada'));

    ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
    ALTER TABLE public.orders ADD CONSTRAINT orders_payment_method_check CHECK (payment_method IN ('pix', 'dinheiro', 'cartao_entrega'));
END $$;

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_customer_addresses_updated_at ON public.customer_addresses;
CREATE TRIGGER update_customer_addresses_updated_at
    BEFORE UPDATE ON public.customer_addresses
    FOR EACH ROW
    EXECUTE PROCEDURE public.update_updated_at_column();
