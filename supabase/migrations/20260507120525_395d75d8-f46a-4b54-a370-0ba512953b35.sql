ALTER TABLE public.delivery_zones 
ADD COLUMN name TEXT,
ADD COLUMN state TEXT,
ADD COLUMN zip_start TEXT,
ADD COLUMN zip_end TEXT,
ADD COLUMN max_radius_km NUMERIC,
ADD COLUMN fee_per_km NUMERIC DEFAULT 0,
ADD COLUMN min_fee NUMERIC,
ADD COLUMN max_fee NUMERIC,
ADD COLUMN priority INTEGER DEFAULT 0,
ADD COLUMN base_prep_time INTEGER DEFAULT 30,
ADD COLUMN minutes_per_km INTEGER DEFAULT 5,
ADD COLUMN additional_region_time INTEGER DEFAULT 0,
ADD COLUMN internal_notes TEXT;

-- Garantir que as colunas existentes tenham valores consistentes se necessário
UPDATE public.delivery_zones SET name = neighborhood WHERE name IS NULL;
UPDATE public.delivery_zones SET priority = 0 WHERE priority IS NULL;
