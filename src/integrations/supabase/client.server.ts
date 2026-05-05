import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Admin client for server-side operations (bypasses RLS)
const SUPABASE_URL = process.env.VEXOR_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.VEXOR_SUPABASE_SERVICE_ROLE_KEY || '';

export const supabaseAdmin = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});
