-- Harden product composition tables used by the public menu and merchant product options.
-- Existing projects may already have these tables from the hosted database; this migration
-- keeps fresh environments and future restores compatible with the current application code.

CREATE TABLE IF NOT EXISTS public.product_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_required BOOLEAN DEFAULT false,
  min_choices INTEGER DEFAULT 0,
  max_choices INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_option_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES public.product_options(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  extra_price NUMERIC(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.product_options
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_choices INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_choices INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_required BOOLEAN DEFAULT false;

ALTER TABLE public.product_option_items
  ADD COLUMN IF NOT EXISTS store_id UUID REFERENCES public.stores(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS extra_price NUMERIC(10,2) DEFAULT 0;

UPDATE public.product_options po
SET store_id = p.store_id
FROM public.products p
WHERE po.product_id = p.id
  AND po.store_id IS NULL;

UPDATE public.product_option_items poi
SET store_id = po.store_id
FROM public.product_options po
WHERE poi.option_id = po.id
  AND poi.store_id IS NULL;

UPDATE public.product_options
SET
  min_choices = GREATEST(0, COALESCE(min_choices, 0)),
  max_choices = GREATEST(1, COALESCE(max_choices, 1));

UPDATE public.product_options
SET min_choices = LEAST(min_choices, max_choices)
WHERE min_choices > max_choices;

UPDATE public.product_option_items
SET extra_price = GREATEST(0, COALESCE(extra_price, 0));

CREATE INDEX IF NOT EXISTS idx_product_options_product_sort
  ON public.product_options(product_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_product_option_items_option_sort
  ON public.product_option_items(option_id, sort_order);

ALTER TABLE public.product_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_option_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view product options" ON public.product_options;
CREATE POLICY "Public can view product options"
ON public.product_options
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Store owners can manage product options" ON public.product_options;
CREATE POLICY "Store owners can manage product options"
ON public.product_options
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.stores
    WHERE stores.id = product_options.store_id
      AND stores.owner_user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.stores
    WHERE stores.id = product_options.store_id
      AND stores.owner_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Public can view product option items" ON public.product_option_items;
CREATE POLICY "Public can view product option items"
ON public.product_option_items
FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Store owners can manage product option items" ON public.product_option_items;
CREATE POLICY "Store owners can manage product option items"
ON public.product_option_items
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.stores
    WHERE stores.id = product_option_items.store_id
      AND stores.owner_user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.stores
    WHERE stores.id = product_option_items.store_id
      AND stores.owner_user_id = auth.uid()
  )
);

NOTIFY pgrst, 'reload schema';
