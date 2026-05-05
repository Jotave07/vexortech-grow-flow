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
    const { data: { user: adminUser }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    
    if (authError || !adminUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Check if user is super_admin or specific email
    const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', adminUser.id).maybeSingle()
    const isSuperAdmin = profile?.role === 'super_admin' || adminUser.email === "jvieira@vexortech.com.br"
    
    if (!isSuperAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { email, password, full_name, name, slug, whatsapp, document, city, state } = await req.json()

    // 1. Create the user in Auth
    const { data: userData, error: createUserError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name.toUpperCase() }
    })

    if (createUserError) throw createUserError

    const newUser = userData.user

    // 2. Create the store
    const { data: store, error: storeErr } = await supabase
      .from('stores')
      .insert({
        owner_user_id: newUser.id,
        slug: slug.toLowerCase(),
        name: name.toUpperCase(),
        whatsapp: whatsapp?.replace(/\D/g, ""),
        phone: whatsapp?.replace(/\D/g, ""),
        document: document?.replace(/\D/g, ""),
        city: city?.toUpperCase(),
        state: state?.toUpperCase(),
        email: email.toLowerCase(),
      })
      .select()
      .single()

    if (storeErr) {
      // Rollback user creation if store fails
      await supabase.auth.admin.deleteUser(newUser.id)
      throw storeErr
    }

    // 3. Update profile and roles
    await Promise.all([
      supabase.from('store_settings').insert({ store_id: store.id }),
      supabase.from('profiles').update({ store_id: store.id, role: 'store_owner' }).eq('user_id', newUser.id),
      supabase.from('user_roles').insert({ user_id: newUser.id, role: 'store_owner', store_id: store.id }),
    ])

    return new Response(JSON.stringify({ success: true, store_id: store.id, user_id: newUser.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
