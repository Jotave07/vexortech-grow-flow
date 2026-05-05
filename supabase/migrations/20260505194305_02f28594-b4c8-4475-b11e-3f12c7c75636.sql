-- Adiciona colunas de integração Asaas à tabela store_settings
ALTER TABLE public.store_settings 
ADD COLUMN IF NOT EXISTS asaas_api_key TEXT,
ADD COLUMN IF NOT EXISTS asaas_wallet_id TEXT;

-- Força atualização do cache do esquema
NOTIFY pgrst, 'reload schema';