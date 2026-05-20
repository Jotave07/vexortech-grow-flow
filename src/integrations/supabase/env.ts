const cleanEnvValue = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim();
  return cleaned.length > 0 ? cleaned : undefined;
};

const readProcessEnv = (name: string) => {
  if (typeof process === "undefined" || !process.env) return undefined;
  return cleanEnvValue(process.env[name]);
};

export const readSupabaseUrl = () =>
  cleanEnvValue(import.meta.env.VITE_SUPABASE_URL) ??
  cleanEnvValue(import.meta.env.VITE_VEXOR_SUPABASE_URL) ??
  readProcessEnv("SUPABASE_URL") ??
  readProcessEnv("VITE_SUPABASE_URL") ??
  readProcessEnv("VITE_VEXOR_SUPABASE_URL");

export const readSupabasePublishableKey = () =>
  cleanEnvValue(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ??
  cleanEnvValue(import.meta.env.VITE_SUPABASE_ANON_KEY) ??
  cleanEnvValue(import.meta.env.VITE_VEXOR_SUPABASE_ANON_KEY) ??
  readProcessEnv("SUPABASE_PUBLISHABLE_KEY") ??
  readProcessEnv("SUPABASE_ANON_KEY") ??
  readProcessEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ??
  readProcessEnv("VITE_SUPABASE_ANON_KEY") ??
  readProcessEnv("VITE_VEXOR_SUPABASE_ANON_KEY");

export const readSupabaseServiceRoleKey = () =>
  readProcessEnv("SUPABASE_SERVICE_ROLE_KEY")?.trim();
