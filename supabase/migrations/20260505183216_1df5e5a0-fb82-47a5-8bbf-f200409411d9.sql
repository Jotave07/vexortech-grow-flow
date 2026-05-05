-- Drop existing restrictive or redundant policies if necessary, but here we just add the missing ones
-- First, ensure RLS is enabled
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;

-- Allow users to create their own store
CREATE POLICY "Users can create their own store" 
ON public.stores 
FOR INSERT 
WITH CHECK (auth.uid() = owner_user_id);

-- Allow owners to update their own store
CREATE POLICY "Store owners can update their own stores" 
ON public.stores 
FOR UPDATE 
USING (auth.uid() = owner_user_id);

-- Allow owners to delete their own store
CREATE POLICY "Store owners can delete their own stores" 
ON public.stores 
FOR DELETE 
USING (auth.uid() = owner_user_id);

-- Verify and add INSERT policy for store_settings if missing (it had ALL but let's be explicit if needed)
-- The existing 'Owners can manage their own store settings' with CMD 'ALL' should cover it, 
-- but it depends on the EXISTS check which might be tricky during the first insert.
-- Let's make sure it's robust.

ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

-- If 'Owners can manage their own store settings' is already CMD 'ALL', it covers INSERT.
-- However, sometimes subqueries in WITH CHECK for INSERT can be problematic if the parent record is new.
-- But in Supabase/Postgres, if the INSERT to 'stores' succeeded, the next INSERT to 'store_settings' should find it.
