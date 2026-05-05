-- Add document column to customers table
ALTER TABLE public.customers 
ADD COLUMN IF NOT EXISTS document TEXT;

-- Add document column to orders table
ALTER TABLE public.orders 
ADD COLUMN IF NOT EXISTS customer_document TEXT;

-- Update RLS policies to include the new column
-- (Assuming RLS is already enabled and basic policies exist)
