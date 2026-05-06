CREATE POLICY "Users can view their orders by phone" 
ON public.orders 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.user_id = auth.uid() 
    AND profiles.phone = orders.customer_phone
  )
);