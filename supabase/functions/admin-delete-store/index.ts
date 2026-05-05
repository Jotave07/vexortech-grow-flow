import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Check if requester is admin
    const authHeader = req.headers.get('Authorization')!
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Check if user is vexor admin
    // Hardcoded check for the owner email or using the RPC
    const { data: isAdmin } = await supabase.rpc('is_vexor_admin', { _user_id: user.id })
    const isOwnerEmail = user.email === "jvieira@vexortech.com.br"
    
    if (!isAdmin && !isOwnerEmail) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { store_id } = await req.json()
    if (!store_id) {
      return new Response(JSON.stringify({ error: 'Store ID is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Get the owner_user_id
    const { data: store, error: storeFetchError } = await supabase
      .from('stores')
      .select('owner_user_id')
      .eq('id', store_id)
      .single()

    if (storeFetchError || !store) {
      return new Response(JSON.stringify({ error: 'Store not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const ownerUserId = store.owner_user_id

    // 1. Delete user roles for this store
    await supabase.from('user_roles').delete().eq('store_id', store_id)
    
    // 2. Delete subscriptions
    await supabase.from('subscriptions').delete().eq('store_id', store_id)

    // 3. Delete the store (this handles most public data if cascades are on)
    const { error: deleteStoreError } = await supabase
      .from('stores')
      .delete()
      .eq('id', store_id)

    if (deleteStoreError) {
      return new Response(JSON.stringify({ error: deleteStoreError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 4. Delete the user from auth and public.profiles
    if (ownerUserId) {
      // Profiles usually has a FK to auth.users, but let's be safe
      await supabase.from('profiles').delete().eq('user_id', ownerUserId)
      
      const { error: deleteUserError } = await supabase.auth.admin.deleteUser(ownerUserId)
      if (deleteUserError) {
        console.error('Error deleting auth user:', deleteUserError)
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
