ALTER TABLE public.orders 
ADD COLUMN zip_code TEXT,
ADD COLUMN neighborhood TEXT,
ADD COLUMN city TEXT,
ADD COLUMN state TEXT,
ADD COLUMN street TEXT,
ADD COLUMN number TEXT,
ADD COLUMN complement TEXT,
ADD COLUMN delivery_region_id UUID REFERENCES public.delivery_zones(id),
ADD COLUMN estimated_min INTEGER,
ADD COLUMN estimated_max INTEGER,
ADD COLUMN delivery_source TEXT,
ADD COLUMN distance_km NUMERIC;
