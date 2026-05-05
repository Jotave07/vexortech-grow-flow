-- Add address columns to customers table
ALTER TABLE public.customers 
ADD COLUMN IF NOT EXISTS zip_code TEXT,
ADD COLUMN IF NOT EXISTS street TEXT,
ADD COLUMN IF NOT EXISTS number TEXT,
ADD COLUMN IF NOT EXISTS complement TEXT,
ADD COLUMN IF NOT EXISTS neighborhood TEXT,
ADD COLUMN IF NOT EXISTS city TEXT,
ADD COLUMN IF NOT EXISTS state TEXT,
ADD COLUMN IF NOT EXISTS registration_completed BOOLEAN DEFAULT false;

-- Update RLS policies for customers if they don't allow what's needed
-- (The previous migration already added wide policies, but let's ensure they cover everything)
DROP POLICY IF EXISTS "Anyone can update customers" ON public.customers;
CREATE POLICY "Anyone can update customers" ON public.customers FOR UPDATE USING (true) WITH CHECK (true);
