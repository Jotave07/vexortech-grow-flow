-- Ensure store_settings has an explicit INSERT policy
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'store_settings' 
        AND policyname = 'Owners can insert their own store settings'
    ) THEN
        CREATE POLICY "Owners can insert their own store settings" 
        ON public.store_settings 
        FOR INSERT 
        WITH CHECK (
            EXISTS (
                SELECT 1 FROM public.stores 
                WHERE stores.id = store_settings.store_id 
                AND stores.owner_user_id = auth.uid()
            )
        );
    END IF;
END $$;
