BEGIN;

-- Do not let a deploy wait indefinitely for DDL locks or an unexpectedly
-- expensive backfill. Both settings are scoped to this transaction.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Preserve the commercial price agreed when a subscription is created. The
-- catalog price can change later and must not retroactively alter contracts.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS contract_price_monthly numeric(12,2);

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS previous_asaas_subscription_ids text[]
  NOT NULL DEFAULT '{}'::text[];

-- Durable hand-off between the database transition and the Asaas API. A
-- webhook is acknowledged only after the pending gateway action succeeds;
-- retries therefore remain idempotent if the process stops between the two.
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS gateway_action_pending text;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS gateway_paused_for_dispute boolean
  NOT NULL DEFAULT false;

-- Profile-level marker closes the gap between the durable cancellation intent
-- and the external calls across every store owned by the same person.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS billing_exemption_pending boolean
  NOT NULL DEFAULT false;

UPDATE public.subscriptions
SET previous_asaas_subscription_ids = '{}'::text[]
WHERE previous_asaas_subscription_ids IS NULL;

ALTER TABLE public.subscriptions
  ALTER COLUMN previous_asaas_subscription_ids SET DEFAULT '{}'::text[],
  ALTER COLUMN previous_asaas_subscription_ids SET NOT NULL;

-- A plan can have changed since an existing Asaas contract was signed. Never
-- infer the legacy gateway price from the current catalog: deployment must
-- reconcile those rows against the read-only Asaas subscription endpoint
-- before db:check and before the new application is started. Subscriptions
-- without a gateway identity can safely inherit the current catalog price.
UPDATE public.subscriptions AS subscription
SET contract_price_monthly = plan.price_monthly
FROM public.plans AS plan
WHERE subscription.plan_id = plan.id
  AND subscription.asaas_subscription_id IS NULL
  AND subscription.contract_price_monthly IS NULL
  AND plan.price_monthly > 0;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_contract_price_monthly_positive_chk;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_contract_price_monthly_positive_chk
  CHECK (contract_price_monthly IS NULL OR contract_price_monthly > 0)
  NOT VALID;

ALTER TABLE public.subscriptions
  VALIDATE CONSTRAINT subscriptions_contract_price_monthly_positive_chk;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_gateway_action_pending_chk;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_gateway_action_pending_chk
  CHECK (
    gateway_action_pending IS NULL
    OR gateway_action_pending IN ('CANCEL', 'INACTIVE', 'ACTIVE', 'EXEMPT_CANCEL')
  ) NOT VALID;

ALTER TABLE public.subscriptions
  VALIDATE CONSTRAINT subscriptions_gateway_action_pending_chk;

-- Keep the readiness backlog checks cheap as webhook volume grows. Only rows
-- that still require recovery are indexed.
CREATE INDEX IF NOT EXISTS idx_payment_events_unprocessed_received
  ON public.payment_events ((COALESCE(processing_started_at, received_at)))
  WHERE processed IS FALSE;

CREATE INDEX IF NOT EXISTS idx_subscriptions_pending_gateway_action_updated
  ON public.subscriptions (updated_at)
  WHERE gateway_action_pending IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_pending_billing_exemption_updated
  ON public.profiles (updated_at)
  WHERE billing_exemption_pending IS TRUE;

CREATE INDEX IF NOT EXISTS idx_subscriptions_plan_id
  ON public.subscriptions (plan_id);

-- Billing rows must never outlive their owning store or silently lose their
-- commercial plan. The application archives stores instead of deleting them.
ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_store_id_fkey;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_store_id_fkey
  FOREIGN KEY (store_id)
  REFERENCES public.stores(id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.subscriptions
  VALIDATE CONSTRAINT subscriptions_store_id_fkey;

ALTER TABLE public.subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_plan_id_fkey;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_plan_id_fkey
  FOREIGN KEY (plan_id)
  REFERENCES public.plans(id)
  ON DELETE RESTRICT
  NOT VALID;

ALTER TABLE public.subscriptions
  VALIDATE CONSTRAINT subscriptions_plan_id_fkey;

-- Keep the public API contract deterministic even when an older migration
-- created this constraint with a narrower set of accepted Asaas key types.
-- The lock closes the gap between the data preflight and constraint install.
LOCK TABLE public.store_settings IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  invalid_values text;
BEGIN
  SELECT string_agg(value, ', ' ORDER BY value)
  INTO invalid_values
  FROM (
    SELECT DISTINCT pix_key_type AS value
    FROM public.store_settings
    WHERE pix_key_type IS NOT NULL
      AND upper(pix_key_type) NOT IN (
        'CPF',
        'CNPJ',
        'EMAIL',
        'PHONE',
        'EVP',
        'RANDOM',
        'KEY',
        'COPY_PASTE'
      )
  ) AS invalid;

  IF invalid_values IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'store_settings.pix_key_type contains values outside the supported contract',
      DETAIL = invalid_values,
      HINT = 'Normalize the reported values before retrying this migration.';
  END IF;
END $$;

ALTER TABLE public.store_settings
  DROP CONSTRAINT IF EXISTS store_settings_pix_key_type_chk;

ALTER TABLE public.store_settings
  ADD CONSTRAINT store_settings_pix_key_type_chk
  CHECK (
    pix_key_type IS NULL
    OR upper(pix_key_type) IN (
      'CPF',
      'CNPJ',
      'EMAIL',
      'PHONE',
      'EVP',
      'RANDOM',
      'KEY',
      'COPY_PASTE'
    )
  ) NOT VALID;

ALTER TABLE public.store_settings
  VALIDATE CONSTRAINT store_settings_pix_key_type_chk;

-- financial_movements is an internal server-side ledger. It must remain
-- inaccessible to the Supabase Data API roles.
ALTER TABLE public.financial_movements ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.financial_movements
  FROM PUBLIC, anon, authenticated, authenticator, service_role;

DROP POLICY IF EXISTS financial_movements_server_access
  ON public.financial_movements;

-- RLS remains default-deny for every Supabase Data API role. A dedicated
-- direct PostgreSQL runtime role may operate only when it also has explicit
-- table grants; a policy alone never grants table privileges.
CREATE POLICY financial_movements_server_access
  ON public.financial_movements
  AS PERMISSIVE
  FOR ALL
  TO PUBLIC
  USING (
    current_user <> ALL (
      ARRAY['anon', 'authenticated', 'authenticator', 'service_role']::name[]
    )
  )
  WITH CHECK (
    current_user <> ALL (
      ARRAY['anon', 'authenticated', 'authenticator', 'service_role']::name[]
    )
  );

COMMIT;
