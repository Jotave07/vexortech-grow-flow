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
    const { data: isAdmin } = await supabase.rpc('is_vexor_admin', { _user_id: user.id })
    if (!isAdmin) {
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

    // Delete the store (this should handle related public data)
    const { error: deleteStoreError } = await supabase
      .from('stores')
      .delete()
      .eq('id', store_id)

    if (deleteStoreError) {
      return new Response(JSON.stringify({ error: deleteStoreError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Delete the user from auth
    if (ownerUserId) {
      const { error: deleteUserError } = await supabase.auth.admin.deleteUser(ownerUserId)
      if (deleteUserError) {
        console.error('Error deleting auth user:', deleteUserError)
        // We don't fail the whole request if the user deletion fails (maybe they were already deleted)
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
