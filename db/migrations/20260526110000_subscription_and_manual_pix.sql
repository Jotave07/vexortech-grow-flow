ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS pix_key text,
  ADD COLUMN IF NOT EXISTS pix_key_type text,
  ADD COLUMN IF NOT EXISTS payment_instructions text,
  ADD COLUMN IF NOT EXISTS payment_gateway_provider text,
  ADD COLUMN IF NOT EXISTS payment_gateway_api_key text,
  ADD COLUMN IF NOT EXISTS payment_gateway_config jsonb DEFAULT '{}'::jsonb;

UPDATE public.store_settings
SET payment_gateway_provider = NULL,
    payment_gateway_api_key = NULL,
    asaas_api_key = NULL
WHERE payment_gateway_provider IS NOT NULL
   OR payment_gateway_api_key IS NOT NULL
   OR asaas_api_key IS NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS pix_payload text,
  ADD COLUMN IF NOT EXISTS pix_qr_code text,
  ADD COLUMN IF NOT EXISTS waiting_payment_since timestamptz,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_approved_by uuid;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS approved_by uuid;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS asaas_customer_id text,
  ADD COLUMN IF NOT EXISTS billing_type text,
  ADD COLUMN IF NOT EXISTS external_reference text,
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS next_due_date date,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_effective_at timestamptz;

CREATE INDEX IF NOT EXISTS subscriptions_asaas_subscription_id_idx
  ON public.subscriptions(asaas_subscription_id)
  WHERE asaas_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_external_reference_idx
  ON public.subscriptions(external_reference)
  WHERE external_reference IS NOT NULL;
