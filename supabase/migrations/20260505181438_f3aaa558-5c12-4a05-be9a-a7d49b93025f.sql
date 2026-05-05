-- Update trigger to handle roles automatically
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name, email, role)
  VALUES (
    NEW.id, 
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'USUARIO'), 
    NEW.email,
    CASE WHEN NEW.email = 'jvieira@vexortech.com.br' THEN 'super_admin' ELSE 'store_owner' END
  );
  
  -- Insert into user_roles
  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id, 
    CASE WHEN NEW.email = 'jvieira@vexortech.com.br' THEN 'admin' ELSE 'store_owner' END
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add policies for users to see their own roles
CREATE POLICY "Users can view their own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

-- Allow users to insert their own profile (backup)
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can insert their own roles" ON public.user_roles FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Ensure all tables have at least a basic "select" policy for the owner
CREATE POLICY "Owners can view their own store settings" ON public.store_settings FOR SELECT USING (EXISTS (SELECT 1 FROM public.stores WHERE id = store_id AND owner_user_id = auth.uid()));
CREATE POLICY "Owners can manage their own store settings" ON public.store_settings FOR ALL USING (EXISTS (SELECT 1 FROM public.stores WHERE id = store_id AND owner_user_id = auth.uid()));
