import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, asaas-access-token',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const asaasWebhookSecret = Deno.env.get('ASAAS_WEBHOOK_SECRET')

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  const signature = req.headers.get('asaas-access-token')
  
  // Verify signature if secret is configured
  if (asaasWebhookSecret && signature !== asaasWebhookSecret) {
    console.warn('Unauthorized webhook attempt')
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      console.error('Error parsing webhook body:', e);
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
    }

    const { event, payment } = body;
    console.log(`Received Asaas event: ${event} for payment: ${payment?.id}`);
    
    if (!payment) {
      console.error('Payment data missing in webhook body');
      return new Response(JSON.stringify({ error: 'Payment data missing' }), { status: 400 });
    }

    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      console.log('Processing confirmed payment:', payment.id);
      
      // 1. Process Subscription (Platform Owner Account)
      if (payment.subscription || (payment.externalReference && payment.externalReference.length > 20)) {
        console.log('Checking subscription for:', payment.subscription || payment.externalReference);
        const { data: subscription, error: subError } = await supabase
          .from('subscriptions')
          .select('*')
          .or(`asaas_subscription_id.eq.${payment.subscription},store_id.eq.${payment.externalReference}`)
          .maybeSingle();

        if (subError) console.error('Error fetching subscription:', subError);

        if (subscription) {
          const { error: updateSubError } = await supabase
            .from('subscriptions')
            .update({ 
              status: 'ativa',
              last_payment_at: new Date().toISOString()
            })
            .eq('id', subscription.id);
            
          if (updateSubError) console.error('Error updating subscription:', updateSubError);
          else console.log(`Subscription ${subscription.id} updated to active`);
        }
      }

      // 2. Process Store Customer Payment (Individual Store Account)
      console.log('Checking order payment for external_id:', payment.id, 'or ref:', payment.externalReference);
      const { data: orderPayment, error: payError } = await supabase
        .from('payments')
        .select('*, orders(*)')
        .or(`external_id.eq.${payment.id},order_id.eq.${payment.externalReference}`)
        .maybeSingle();

      if (payError) console.error('Error fetching payment:', payError);

      if (orderPayment) {
        console.log('Updating order and payment for order_id:', orderPayment.order_id);
        const { error: updatePayError } = await supabase
          .from('payments')
          .update({ 
            status: 'pago', 
            paid_at: new Date().toISOString(),
            external_id: payment.id
          })
          .eq('id', orderPayment.id);

        if (updatePayError) console.error('Error updating payment record:', updatePayError);

        const { error: updateOrderError } = await supabase
          .from('orders')
          .update({ 
            status: 'novo',
            payment_status: 'pago' 
          })
          .eq('id', orderPayment.order_id);
          
        if (updateOrderError) console.error('Error updating order status:', updateOrderError);
          
        await supabase.from('order_status_history').insert({
          order_id: orderPayment.order_id,
          store_id: orderPayment.store_id,
          status: 'novo',
          notes: 'Pagamento PIX confirmado via Webhook (Asaas)'
        });
          
        console.log(`Order ${orderPayment.order_id} update flow completed`);
      } else {
        console.log('No matching subscription or order payment found for this webhook event');
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Critical error processing webhook:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal Server Error' }), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
