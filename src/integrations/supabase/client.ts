import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Using external Supabase Vexortech
const SUPABASE_URL = (import.meta.env.VITE_VEXOR_SUPABASE_URL || process.env.VEXOR_SUPABASE_URL || '').trim();
const SUPABASE_PUBLISHABLE_KEY = (import.meta.env.VITE_VEXOR_SUPABASE_ANON_KEY || process.env.VEXOR_SUPABASE_ANON_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
  console.error("Missing Supabase configuration. URL:", !!SUPABASE_URL, "Key:", !!SUPABASE_PUBLISHABLE_KEY);
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window !== 'undefined' ? localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  }
});
