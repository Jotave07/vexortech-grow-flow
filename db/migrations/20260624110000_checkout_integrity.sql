BEGIN;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS checkout_payload_hash text;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid,
  ADD COLUMN IF NOT EXISTS archive_reason text;

ALTER TABLE public.payment_events
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS last_webhook_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_webhook_event text;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_payment_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_payment_event_type text;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_asaas_id_unique
  ON public.subscriptions (asaas_subscription_id)
  WHERE asaas_subscription_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS orders_id_store_id_unique
  ON public.orders (id, store_id);

DO $$ BEGIN
  ALTER TABLE public.financial_movements
    ADD CONSTRAINT financial_movements_order_store_fk
    FOREIGN KEY (order_id, store_id)
    REFERENCES public.orders (id, store_id)
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_checkout_payload_hash_chk
    CHECK (checkout_payload_hash IS NULL OR checkout_payload_hash ~ '^[0-9a-f]{64}$')
    NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.payment_events
    ADD CONSTRAINT payment_events_attempt_count_chk
    CHECK (attempt_count >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_document_format_chk
    CHECK (document IS NULL OR document = '' OR document ~ '^(?:[0-9]{11}|[A-Z0-9]{12}[0-9]{2})$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.stores
    ADD CONSTRAINT stores_document_format_chk
    CHECK (document IS NULL OR document = '' OR document ~ '^(?:[0-9]{11}|[A-Z0-9]{12}[0-9]{2})$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.customers
    ADD CONSTRAINT customers_document_format_chk
    CHECK (document IS NULL OR document = '' OR document ~ '^(?:[0-9]{11}|[A-Z0-9]{12}[0-9]{2})$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Preserve legacy duplicates. The unique index is installed only when current
-- data is already unambiguous; checkout also takes a per-customer advisory lock.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.customers
    WHERE user_id IS NOT NULL
    GROUP BY store_id, user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate customers found for (store_id, user_id); resolve explicitly before applying checkout integrity migration.';
  END IF;
  CREATE UNIQUE INDEX IF NOT EXISTS customers_store_user_unique
    ON public.customers (store_id, user_id)
    WHERE user_id IS NOT NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.order_items
    ADD CONSTRAINT order_items_financial_values_chk
    CHECK (
      quantity > 0
      AND unit_price >= 0
      AND COALESCE(subtotal, 0) >= 0
      AND COALESCE(options_total, 0) >= 0
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.orders
    ADD CONSTRAINT orders_financial_values_chk
    CHECK (
      COALESCE(subtotal, 0) >= 0
      AND COALESCE(delivery_fee, 0) >= 0
      AND COALESCE(discount_amount, 0) >= 0
      AND COALESCE(total, 0) >= 0
      AND COALESCE(refunded_amount, 0) >= 0
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.payments
    ADD CONSTRAINT payments_amount_nonnegative_chk
    CHECK (amount >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.products
    ADD CONSTRAINT products_price_nonnegative_chk
    CHECK (price >= 0 AND (promo_price IS NULL OR promo_price >= 0)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.product_options
    ADD CONSTRAINT product_options_choice_bounds_chk
    CHECK (
      COALESCE(min_choices, 0) >= 0
      AND COALESCE(max_choices, 0) >= COALESCE(min_choices, 0)
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
