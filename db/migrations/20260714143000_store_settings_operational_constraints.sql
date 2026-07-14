-- Keep the database contract aligned with the bounded values accepted by the
-- merchant BFF. Invalid legacy values become NULL instead of being clamped to
-- an invented commercial value; every affected field already has a safe
-- application fallback.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

UPDATE public.store_settings
SET avg_prep_time_minutes = CASE
      WHEN avg_prep_time_minutes >= 1 AND avg_prep_time_minutes <= 240
        THEN avg_prep_time_minutes
      ELSE NULL
    END,
    min_order_value = CASE
      WHEN min_order_value >= 0 AND min_order_value <= 1000000
        THEN min_order_value
      ELSE NULL
    END,
    delivery_radius_km = CASE
      WHEN delivery_radius_km >= 0.1 AND delivery_radius_km <= 500
        THEN delivery_radius_km
      ELSE NULL
    END,
    delivery_base_fee = CASE
      WHEN delivery_base_fee >= 0 AND delivery_base_fee <= 1000
        THEN delivery_base_fee
      ELSE NULL
    END,
    delivery_fee_per_km = CASE
      WHEN delivery_fee_per_km >= 0 AND delivery_fee_per_km <= 100
        THEN delivery_fee_per_km
      ELSE NULL
    END,
    delivery_fee = CASE
      WHEN delivery_fee >= 0 AND delivery_fee <= 1000
        THEN delivery_fee
      ELSE NULL
    END
WHERE (avg_prep_time_minutes IS NOT NULL AND (
        avg_prep_time_minutes < 1 OR avg_prep_time_minutes > 240
      ))
   OR (min_order_value IS NOT NULL AND (
        min_order_value < 0 OR min_order_value > 1000000
      ))
   OR (delivery_radius_km IS NOT NULL AND (
        delivery_radius_km < 0.1 OR delivery_radius_km > 500
      ))
   OR (delivery_base_fee IS NOT NULL AND (
        delivery_base_fee < 0 OR delivery_base_fee > 1000
      ))
   OR (delivery_fee_per_km IS NOT NULL AND (
        delivery_fee_per_km < 0 OR delivery_fee_per_km > 100
      ))
   OR (delivery_fee IS NOT NULL AND (
        delivery_fee < 0 OR delivery_fee > 1000
      ));

ALTER TABLE public.store_settings
  DROP CONSTRAINT IF EXISTS store_settings_avg_prep_time_minutes_chk,
  DROP CONSTRAINT IF EXISTS store_settings_min_order_value_chk,
  DROP CONSTRAINT IF EXISTS store_settings_delivery_radius_km_chk,
  DROP CONSTRAINT IF EXISTS store_settings_delivery_base_fee_chk,
  DROP CONSTRAINT IF EXISTS store_settings_delivery_fee_per_km_chk,
  DROP CONSTRAINT IF EXISTS store_settings_delivery_fee_chk;

-- NOT VALID makes the strong DDL lock independent from the table scan. The
-- transaction is committed before validation so that lock is released first.
ALTER TABLE public.store_settings
  ADD CONSTRAINT store_settings_avg_prep_time_minutes_chk
    CHECK (
      avg_prep_time_minutes IS NULL
      OR (avg_prep_time_minutes >= 1 AND avg_prep_time_minutes <= 240)
    ) NOT VALID,
  ADD CONSTRAINT store_settings_min_order_value_chk
    CHECK (
      min_order_value IS NULL
      OR (min_order_value >= 0 AND min_order_value <= 1000000)
    ) NOT VALID,
  ADD CONSTRAINT store_settings_delivery_radius_km_chk
    CHECK (
      delivery_radius_km IS NULL
      OR (delivery_radius_km >= 0.1 AND delivery_radius_km <= 500)
    ) NOT VALID,
  ADD CONSTRAINT store_settings_delivery_base_fee_chk
    CHECK (
      delivery_base_fee IS NULL
      OR (delivery_base_fee >= 0 AND delivery_base_fee <= 1000)
    ) NOT VALID,
  ADD CONSTRAINT store_settings_delivery_fee_per_km_chk
    CHECK (
      delivery_fee_per_km IS NULL
      OR (delivery_fee_per_km >= 0 AND delivery_fee_per_km <= 100)
    ) NOT VALID,
  ADD CONSTRAINT store_settings_delivery_fee_chk
    CHECK (
      delivery_fee IS NULL
      OR (delivery_fee >= 0 AND delivery_fee <= 1000)
    ) NOT VALID;

COMMIT;

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- A single ALTER TABLE lets PostgreSQL validate the six checks in one table
-- scan while holding only the validation lock class.
ALTER TABLE public.store_settings
  VALIDATE CONSTRAINT store_settings_avg_prep_time_minutes_chk,
  VALIDATE CONSTRAINT store_settings_min_order_value_chk,
  VALIDATE CONSTRAINT store_settings_delivery_radius_km_chk,
  VALIDATE CONSTRAINT store_settings_delivery_base_fee_chk,
  VALIDATE CONSTRAINT store_settings_delivery_fee_per_km_chk,
  VALIDATE CONSTRAINT store_settings_delivery_fee_chk;

COMMIT;
