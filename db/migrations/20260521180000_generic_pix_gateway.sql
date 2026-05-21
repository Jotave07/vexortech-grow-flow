BEGIN;

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS payment_gateway_provider text DEFAULT 'asaas',
  ADD COLUMN IF NOT EXISTS payment_gateway_api_key text,
  ADD COLUMN IF NOT EXISTS payment_gateway_config jsonb DEFAULT '{}'::jsonb;

UPDATE public.store_settings
SET payment_gateway_provider = COALESCE(NULLIF(btrim(payment_gateway_provider), ''), 'asaas'),
    payment_gateway_api_key = COALESCE(NULLIF(btrim(payment_gateway_api_key), ''), NULLIF(btrim(asaas_api_key), ''))
WHERE payment_gateway_api_key IS NULL
   OR btrim(payment_gateway_api_key) = ''
   OR payment_gateway_provider IS NULL
   OR btrim(payment_gateway_provider) = '';

ALTER TABLE public.payments
  ALTER COLUMN provider SET DEFAULT 'asaas';

COMMIT;
