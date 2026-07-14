BEGIN;

LOCK TABLE public.delivery_zones IN SHARE ROW EXCLUSIVE MODE;

-- Legacy NULL flags were historically interpreted as active by checkout
-- queries. Quarantine them before making the activation contract explicit.
UPDATE public.delivery_zones
SET is_active = false
WHERE is_active IS NULL;

ALTER TABLE public.delivery_zones
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL;

-- Invalid active rules must never keep quoting while their values are repaired.
-- Deactivate them first, then normalize every constrained value so validation is
-- deterministic even when legacy numeric columns contain NaN or infinities.
UPDATE public.delivery_zones
SET is_active = false
WHERE name IS NULL
   OR btrim(name) = ''
   OR fee IS NULL
   OR fee::text IN ('NaN', 'Infinity', '-Infinity')
   OR fee < 0 OR fee > 100000
   OR fee_per_km IS NULL
   OR fee_per_km::text IN ('NaN', 'Infinity', '-Infinity')
   OR fee_per_km < 0 OR fee_per_km > 10000
   OR (min_fee IS NOT NULL AND (
        min_fee::text IN ('NaN', 'Infinity', '-Infinity')
        OR min_fee < 0 OR min_fee > 100000
      ))
   OR (max_fee IS NOT NULL AND (
        max_fee::text IN ('NaN', 'Infinity', '-Infinity')
        OR max_fee < 0 OR max_fee > 100000
      ))
   OR (min_fee IS NOT NULL AND max_fee IS NOT NULL AND min_fee > max_fee)
   OR min_order IS NULL
   OR min_order::text IN ('NaN', 'Infinity', '-Infinity')
   OR min_order < 0 OR min_order > 1000000
   OR (max_radius_km IS NOT NULL AND (
        max_radius_km::text IN ('NaN', 'Infinity', '-Infinity')
        OR max_radius_km < 0.1 OR max_radius_km > 500
      ))
   OR base_prep_time IS NULL OR base_prep_time < 1 OR base_prep_time > 240
   OR minutes_per_km IS NULL
   OR minutes_per_km::text IN ('NaN', 'Infinity', '-Infinity')
   OR minutes_per_km < 0 OR minutes_per_km > 120
   OR additional_region_time IS NULL
   OR additional_region_time < 0 OR additional_region_time > 240
   OR (estimated_minutes IS NOT NULL AND (estimated_minutes < 1 OR estimated_minutes > 480))
   OR priority IS NULL OR priority < 0 OR priority > 1000
   OR (
        NULLIF(regexp_replace(COALESCE(zip_start, ''), '[^0-9]', '', 'g'), '') IS NULL
        AND NULLIF(regexp_replace(COALESCE(zip_end, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
      )
   OR (
        NULLIF(regexp_replace(COALESCE(zip_start, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
        AND NULLIF(regexp_replace(COALESCE(zip_end, ''), '[^0-9]', '', 'g'), '') IS NULL
      )
   OR (
        NULLIF(regexp_replace(COALESCE(zip_start, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
        AND (
          length(regexp_replace(zip_start, '[^0-9]', '', 'g')) <> 8
          OR length(regexp_replace(zip_end, '[^0-9]', '', 'g')) <> 8
          OR regexp_replace(zip_start, '[^0-9]', '', 'g') > regexp_replace(zip_end, '[^0-9]', '', 'g')
        )
      )
   OR (
        NULLIF(regexp_replace(COALESCE(zip_start, ''), '[^0-9]', '', 'g'), '') IS NULL
        AND (NULLIF(btrim(city), '') IS NULL OR upper(btrim(COALESCE(state, ''))) !~ '^[A-Z]{2}$')
      );

UPDATE public.delivery_zones
SET name = NULLIF(btrim(name), ''),
    city = NULLIF(btrim(city), ''),
    state = CASE
      WHEN upper(btrim(COALESCE(state, ''))) ~ '^[A-Z]{2}$' THEN upper(btrim(state))
      ELSE NULL
    END,
    neighborhood = NULLIF(btrim(neighborhood), ''),
    zip_start = CASE
      WHEN regexp_replace(COALESCE(zip_start, ''), '[^0-9]', '', 'g') ~ '^[0-9]{8}$'
        THEN regexp_replace(zip_start, '[^0-9]', '', 'g')
      ELSE NULL
    END,
    zip_end = CASE
      WHEN regexp_replace(COALESCE(zip_end, ''), '[^0-9]', '', 'g') ~ '^[0-9]{8}$'
        THEN regexp_replace(zip_end, '[^0-9]', '', 'g')
      ELSE NULL
    END,
    fee = CASE
      WHEN fee IS NOT NULL
       AND fee::text NOT IN ('NaN', 'Infinity', '-Infinity')
       AND fee >= 0 AND fee <= 100000 THEN fee
      ELSE 0
    END,
    fee_per_km = CASE
      WHEN fee_per_km IS NOT NULL
       AND fee_per_km::text NOT IN ('NaN', 'Infinity', '-Infinity')
       AND fee_per_km >= 0 AND fee_per_km <= 10000 THEN fee_per_km
      ELSE 0
    END,
    min_fee = CASE
      WHEN min_fee IS NULL THEN NULL
      WHEN min_fee::text NOT IN ('NaN', 'Infinity', '-Infinity')
       AND min_fee >= 0 AND min_fee <= 100000 THEN min_fee
      ELSE NULL
    END,
    max_fee = CASE
      WHEN max_fee IS NULL THEN NULL
      WHEN max_fee::text NOT IN ('NaN', 'Infinity', '-Infinity')
       AND max_fee >= 0 AND max_fee <= 100000 THEN max_fee
      ELSE NULL
    END,
    min_order = CASE
      WHEN min_order IS NOT NULL
       AND min_order::text NOT IN ('NaN', 'Infinity', '-Infinity')
       AND min_order >= 0 AND min_order <= 1000000 THEN min_order
      ELSE 0
    END,
    max_radius_km = CASE
      WHEN max_radius_km IS NULL THEN NULL
      WHEN max_radius_km::text NOT IN ('NaN', 'Infinity', '-Infinity')
       AND max_radius_km >= 0.1 AND max_radius_km <= 500 THEN max_radius_km
      ELSE NULL
    END,
    base_prep_time = CASE
      WHEN base_prep_time >= 1 AND base_prep_time <= 240 THEN base_prep_time
      ELSE 30
    END,
    minutes_per_km = CASE
      WHEN minutes_per_km IS NOT NULL
       AND minutes_per_km::text NOT IN ('NaN', 'Infinity', '-Infinity')
       AND minutes_per_km >= 0 AND minutes_per_km <= 120 THEN minutes_per_km
      ELSE 5
    END,
    additional_region_time = CASE
      WHEN additional_region_time >= 0 AND additional_region_time <= 240
        THEN additional_region_time
      ELSE 0
    END,
    estimated_minutes = CASE
      WHEN estimated_minutes >= 1 AND estimated_minutes <= 480 THEN estimated_minutes
      ELSE NULL
    END,
    priority = CASE WHEN priority >= 0 AND priority <= 1000 THEN priority ELSE 0 END;

UPDATE public.delivery_zones
SET min_fee = NULL,
    max_fee = NULL
WHERE min_fee IS NOT NULL
  AND max_fee IS NOT NULL
  AND min_fee > max_fee;

ALTER TABLE public.delivery_zones
  DROP CONSTRAINT IF EXISTS delivery_zones_fee_chk,
  DROP CONSTRAINT IF EXISTS delivery_zones_fee_per_km_chk,
  DROP CONSTRAINT IF EXISTS delivery_zones_fee_bounds_chk,
  DROP CONSTRAINT IF EXISTS delivery_zones_min_order_chk,
  DROP CONSTRAINT IF EXISTS delivery_zones_max_radius_km_chk,
  DROP CONSTRAINT IF EXISTS delivery_zones_timing_chk,
  DROP CONSTRAINT IF EXISTS delivery_zones_priority_chk,
  DROP CONSTRAINT IF EXISTS delivery_zones_coverage_chk;

ALTER TABLE public.delivery_zones
  ADD CONSTRAINT delivery_zones_fee_chk CHECK (
    fee IS NOT NULL
    AND fee::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND fee >= 0 AND fee <= 100000
  ) NOT VALID,
  ADD CONSTRAINT delivery_zones_fee_per_km_chk CHECK (
    fee_per_km IS NOT NULL
    AND fee_per_km::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND fee_per_km >= 0 AND fee_per_km <= 10000
  ) NOT VALID,
  ADD CONSTRAINT delivery_zones_fee_bounds_chk CHECK (
    (min_fee IS NULL OR (
      min_fee::text NOT IN ('NaN', 'Infinity', '-Infinity')
      AND min_fee >= 0 AND min_fee <= 100000
    ))
    AND (max_fee IS NULL OR (
      max_fee::text NOT IN ('NaN', 'Infinity', '-Infinity')
      AND max_fee >= 0 AND max_fee <= 100000
    ))
    AND (min_fee IS NULL OR max_fee IS NULL OR min_fee <= max_fee)
  ) NOT VALID,
  ADD CONSTRAINT delivery_zones_min_order_chk CHECK (
    min_order IS NOT NULL
    AND min_order::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND min_order >= 0 AND min_order <= 1000000
  ) NOT VALID,
  ADD CONSTRAINT delivery_zones_max_radius_km_chk CHECK (
    max_radius_km IS NULL OR (
      max_radius_km::text NOT IN ('NaN', 'Infinity', '-Infinity')
      AND max_radius_km >= 0.1 AND max_radius_km <= 500
    )
  ) NOT VALID,
  ADD CONSTRAINT delivery_zones_timing_chk CHECK (
    base_prep_time IS NOT NULL AND base_prep_time >= 1 AND base_prep_time <= 240
    AND minutes_per_km IS NOT NULL
    AND minutes_per_km::text NOT IN ('NaN', 'Infinity', '-Infinity')
    AND minutes_per_km >= 0 AND minutes_per_km <= 120
    AND additional_region_time IS NOT NULL
    AND additional_region_time >= 0 AND additional_region_time <= 240
    AND (estimated_minutes IS NULL OR (estimated_minutes >= 1 AND estimated_minutes <= 480))
  ) NOT VALID,
  ADD CONSTRAINT delivery_zones_priority_chk CHECK (
    priority IS NOT NULL AND priority >= 0 AND priority <= 1000
  ) NOT VALID,
  ADD CONSTRAINT delivery_zones_coverage_chk CHECK (
    is_active IS NOT TRUE
    OR (
      NULLIF(btrim(name), '') IS NOT NULL
      AND (state IS NULL OR state ~ '^[A-Z]{2}$')
      AND (
        (
          zip_start IS NOT NULL
          AND zip_end IS NOT NULL
          AND zip_start ~ '^[0-9]{8}$'
          AND zip_end ~ '^[0-9]{8}$'
          AND zip_start <= zip_end
        )
        OR (
          zip_start IS NULL
          AND zip_end IS NULL
          AND NULLIF(btrim(city), '') IS NOT NULL
          AND state ~ '^[A-Z]{2}$'
        )
      )
    )
  ) NOT VALID;

ALTER TABLE public.delivery_zones
  VALIDATE CONSTRAINT delivery_zones_fee_chk,
  VALIDATE CONSTRAINT delivery_zones_fee_per_km_chk,
  VALIDATE CONSTRAINT delivery_zones_fee_bounds_chk,
  VALIDATE CONSTRAINT delivery_zones_min_order_chk,
  VALIDATE CONSTRAINT delivery_zones_max_radius_km_chk,
  VALIDATE CONSTRAINT delivery_zones_timing_chk,
  VALIDATE CONSTRAINT delivery_zones_priority_chk,
  VALIDATE CONSTRAINT delivery_zones_coverage_chk;

COMMIT;
