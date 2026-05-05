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
    const body = await req.json()
    const { event, payment } = body

    console.log(`Received Asaas event: ${event}`, JSON.stringify(payment))

    if (event === 'PAYMENT_RECEIVED' || event === 'PAYMENT_CONFIRMED') {
      
      // 1. Process Subscription (Platform Owner Account)
      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('*')
        .or(`asaas_subscription_id.eq.${payment.subscription},store_id.eq.${payment.externalReference}`)
        .maybeSingle()

      if (subscription) {
        await supabase
          .from('subscriptions')
          .update({ 
            status: 'ativa',
            last_payment_at: new Date().toISOString()
          })
          .eq('id', subscription.id)
          
        console.log(`Subscription ${subscription.id} updated to active`)
      }

      // 2. Process Store Customer Payment (Individual Store Account)
      const { data: orderPayment } = await supabase
        .from('payments')
        .select('*, orders(*)')
        .or(`external_id.eq.${payment.id},order_id.eq.${payment.externalReference}`)
        .maybeSingle()

      if (orderPayment) {
        await supabase
          .from('payments')
          .update({ 
            status: 'pago', 
            paid_at: new Date().toISOString(),
            external_id: payment.id
          })
          .eq('id', orderPayment.id)

        await supabase
          .from('orders')
          .update({ 
            status: 'novo', // Move from 'aguardando_pagamento' to 'novo' (Novos Pedidos)
            payment_status: 'pago' 
          })
          .eq('id', orderPayment.order_id)
          
        await supabase.from('order_status_history').insert({
          order_id: orderPayment.order_id,
          store_id: orderPayment.store_id,
          status: 'novo',
          notes: 'Pagamento PIX confirmado via Webhook'
        })
          
        console.log(`Order ${orderPayment.order_id} updated to paid/new`)
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error processing webhook:', error)
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
