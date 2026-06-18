BEGIN;

ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS public_name text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS store_type text DEFAULT 'Restaurantes',
  ADD COLUMN IF NOT EXISTS is_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'profile_pending',
  ADD COLUMN IF NOT EXISTS verification_notes text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS cover_url text,
  ADD COLUMN IF NOT EXISTS document text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS address_number text,
  ADD COLUMN IF NOT EXISTS address_complement text,
  ADD COLUMN IF NOT EXISTS neighborhood text,
  ADD COLUMN IF NOT EXISTS zip_code text,
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS primary_color text,
  ADD COLUMN IF NOT EXISTS secondary_color text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS plan_id uuid,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS font_family text,
  ADD COLUMN IF NOT EXISTS payment_methods jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS whatsapp_number text,
  ADD COLUMN IF NOT EXISTS delivery_fee numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_order_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.stores
SET store_type = COALESCE(NULLIF(btrim(store_type), ''), 'Restaurantes'),
    verification_status = COALESCE(NULLIF(btrim(verification_status), ''), 'profile_pending'),
    payment_methods = COALESCE(payment_methods, '{}'::jsonb),
    status = COALESCE(NULLIF(btrim(status), ''), 'active')
WHERE store_type IS NULL
   OR btrim(store_type) = ''
   OR verification_status IS NULL
   OR btrim(verification_status) = ''
   OR payment_methods IS NULL
   OR status IS NULL
   OR btrim(status) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stores_plan_id_fkey'
  ) THEN
    ALTER TABLE public.stores
      ADD CONSTRAINT stores_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS stores_plan_id_idx
  ON public.stores(plan_id)
  WHERE plan_id IS NOT NULL;

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS payment_instructions text,
  ADD COLUMN IF NOT EXISTS payment_gateway_provider text,
  ADD COLUMN IF NOT EXISTS payment_gateway_api_key text,
  ADD COLUMN IF NOT EXISTS payment_gateway_config jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pix_key text,
  ADD COLUMN IF NOT EXISTS pix_key_type text,
  ADD COLUMN IF NOT EXISTS asaas_wallet_id text,
  ADD COLUMN IF NOT EXISTS delivery_radius_km numeric,
  ADD COLUMN IF NOT EXISTS delivery_base_fee numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_fee_per_km numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS delivery_distance_rules jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS delivery_message text,
  ADD COLUMN IF NOT EXISTS excluded_neighborhoods jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS accept_card_online boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_number text,
  ADD COLUMN IF NOT EXISTS min_order_value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_delivery_above numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_prep_time_minutes integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS business_hours jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.store_settings
SET payment_gateway_config = COALESCE(payment_gateway_config, '{}'::jsonb),
    delivery_distance_rules = COALESCE(delivery_distance_rules, '[]'::jsonb),
    excluded_neighborhoods = COALESCE(excluded_neighborhoods, '[]'::jsonb),
    business_hours = COALESCE(business_hours, '{}'::jsonb),
    accept_card_online = COALESCE(accept_card_online, true),
    avg_prep_time_minutes = COALESCE(avg_prep_time_minutes, 30)
WHERE payment_gateway_config IS NULL
   OR delivery_distance_rules IS NULL
   OR excluded_neighborhoods IS NULL
   OR business_hours IS NULL
   OR accept_card_online IS NULL
   OR avg_prep_time_minutes IS NULL;

COMMIT;
