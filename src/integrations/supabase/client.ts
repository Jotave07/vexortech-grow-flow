import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const env = import.meta.env as Record<string, string | undefined>;

export const supabaseUrl =
  env.VITE_SUPABASE_URL ||
  env.NEXT_PUBLIC_SUPABASE_URL ||
  "";

export const supabasePublishableKey =
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.VITE_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

export const hasSupabaseBrowserConfig = Boolean(supabaseUrl && supabasePublishableKey);

let browserClient: SupabaseClient | null = null;

export const getSupabaseBrowserClient = () => {
  if (!hasSupabaseBrowserConfig) return null;
  if (!browserClient) {
    browserClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        persistSession: true,
      },
    });
  }
  return browserClient;
};

export const getSupabasePublicStorageUrl = (bucket: string, path: string) => {
  if (!supabaseUrl) return "";
  const cleanPath = path
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${cleanPath}`;
};
