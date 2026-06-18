BEGIN;

-- Fix: persistSubscription() (src/server/subscription.service.ts) faz
-- INSERT ... (provider) e ON CONFLICT (store_id) DO UPDATE SET provider = EXCLUDED.provider,
-- mas a coluna nunca foi criada em public.subscriptions. Sem ela, TODO checkout pago e
-- troca de plano falha em runtime com: column "provider" of relation "subscriptions" does not exist.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS provider text DEFAULT 'asaas';

UPDATE public.subscriptions
SET provider = 'asaas'
WHERE provider IS NULL;

COMMIT;
