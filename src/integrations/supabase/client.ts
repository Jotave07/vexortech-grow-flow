import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

// Using external Supabase Vexortech
const SUPABASE_URL = import.meta.env.VITE_VEXOR_SUPABASE_URL || '';
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_VEXOR_SUPABASE_ANON_KEY || '';

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window !== 'undefined' ? localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
  }
});
