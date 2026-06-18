const clean = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const isProduction = () => process.env.NODE_ENV === "production";

const hasDatabaseConfig = () => {
  if (clean(process.env.DATABASE_URL)) return true;
  return Boolean(
    clean(process.env.POSTGRES_HOST) &&
      (clean(process.env.POSTGRES_DATABASE) || clean(process.env.POSTGRES_DB)) &&
      clean(process.env.POSTGRES_USER) &&
      clean(process.env.POSTGRES_PASSWORD),
  );
};

const hasSupabaseAuthConfig = () =>
  Boolean(
    (clean(process.env.SUPABASE_URL) ||
      clean(process.env.NEXT_PUBLIC_SUPABASE_URL) ||
      clean(process.env.VITE_SUPABASE_URL)) &&
      (clean(process.env.SUPABASE_SECRET_KEY) ||
        clean(process.env.SUPABASE_SERVICE_ROLE_KEY)) &&
      (clean(process.env.SUPABASE_PUBLISHABLE_KEY) ||
        clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ||
        clean(process.env.VITE_SUPABASE_PUBLISHABLE_KEY)),
  );

export const validateRuntimeEnv = (options: { requireWebhookSecret?: boolean } = {}) => {
  if (!isProduction()) return;

  if (!hasSupabaseAuthConfig()) {
    throw new Error("Supabase Auth e obrigatorio em producao. Defina URL, publishable key e secret key.");
  }

  if (!hasDatabaseConfig()) {
    throw new Error("Banco PostgreSQL obrigatorio em producao.");
  }

  if (!clean(process.env.PUBLIC_APP_URL)) {
    throw new Error("PUBLIC_APP_URL obrigatorio em producao.");
  }

  if (!(clean(process.env.SUPABASE_SECRET_KEY) || clean(process.env.SUPABASE_SERVICE_ROLE_KEY))) {
    throw new Error("Supabase Storage exige SUPABASE_SECRET_KEY em producao.");
  }

  if (options.requireWebhookSecret && !clean(process.env.ASAAS_WEBHOOK_SECRET)) {
    throw new Error("ASAAS_WEBHOOK_SECRET obrigatorio para webhooks em producao.");
  }

  if (clean(process.env.ASAAS_API_KEY) && !clean(process.env.ASAAS_ENVIRONMENT)) {
    throw new Error("ASAAS_ENVIRONMENT obrigatorio quando ASAAS_API_KEY esta configurada.");
  }

  if (!clean(process.env.ASAAS_ENVIRONMENT)) {
    throw new Error("ASAAS_ENVIRONMENT obrigatorio em producao.");
  }

  if (!clean(process.env.EVOLUTION_API_URL)) {
    throw new Error("EVOLUTION_API_URL obrigatorio em producao.");
  }

  if (!clean(process.env.EVOLUTION_API_KEY)) {
    throw new Error("EVOLUTION_API_KEY obrigatorio em producao.");
  }

  if (!clean(process.env.EVOLUTION_INSTANCE)) {
    throw new Error("EVOLUTION_INSTANCE obrigatorio em producao.");
  }

  if (!clean(process.env.EVOLUTION_AUTOMATION_PHONE)) {
    throw new Error("EVOLUTION_AUTOMATION_PHONE obrigatorio em producao.");
  }
};

export const isProductionRuntime = isProduction;
