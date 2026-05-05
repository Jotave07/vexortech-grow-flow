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

    const { data: isAdmin } = await supabase.rpc('is_vexor_admin', { _user_id: user.id })
    const isOwnerEmail = user.email === "jvieira@vexortech.com.br"
    
    if (!isAdmin && !isOwnerEmail) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { action, email, user_id } = await req.json()

    if (action === 'cleanup_orphans') {
      // 1. Get all users from auth
      const { data: { users }, error: listError } = await supabase.auth.admin.listUsers()
      if (listError) throw listError

      // 2. Get all profile user_ids
      const { data: profiles } = await supabase.from('profiles').select('id')
      const profileIds = new Set(profiles?.map(p => p.id) || [])

      const deleted = []
      for (const u of users) {
        // Don't delete the current admin or the owner
        if (u.id === user.id || u.email === "jvieira@vexortech.com.br") continue

        // If user is not in profiles, delete from auth
        if (!profileIds.has(u.id)) {
          const { error: delErr } = await supabase.auth.admin.deleteUser(u.id)
          if (!delErr) deleted.push(u.email)
        }
      }

      return new Response(JSON.stringify({ success: true, deleted_count: deleted.length, deleted_emails: deleted }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'delete_by_email' && email) {
      const { data: { users }, error: findError } = await supabase.auth.admin.listUsers()
      if (findError) throw findError

      const targetUser = users.find(u => u.email?.toLowerCase() === email.toLowerCase())
      if (!targetUser) {
        return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }

      // Delete profile and other data first (to avoid FK errors if they still exist)
      await supabase.from('user_roles').delete().eq('user_id', targetUser.id)
      await supabase.from('profiles').delete().eq('id', targetUser.id)
      
      const { error: delErr } = await supabase.auth.admin.deleteUser(targetUser.id)
      if (delErr) throw delErr

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
