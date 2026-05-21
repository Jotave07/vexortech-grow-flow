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

export const validateRuntimeEnv = (options: { requireWebhookSecret?: boolean } = {}) => {
  if (!isProduction()) return;

  const jwtSecret = clean(process.env.JWT_SECRET) || clean(process.env.AUTH_SECRET);
  if (!jwtSecret || jwtSecret.length < 32 || jwtSecret === "hype-delivery-local-dev-secret") {
    throw new Error("JWT_SECRET forte e obrigatorio em producao.");
  }

  if (!hasDatabaseConfig()) {
    throw new Error("Banco PostgreSQL obrigatorio em producao.");
  }

  if (!clean(process.env.PUBLIC_APP_URL)) {
    throw new Error("PUBLIC_APP_URL obrigatorio em producao.");
  }

  if (!clean(process.env.STORAGE_DIR)) {
    throw new Error("STORAGE_DIR obrigatorio em producao.");
  }

  if (options.requireWebhookSecret && !clean(process.env.ASAAS_WEBHOOK_SECRET)) {
    throw new Error("ASAAS_WEBHOOK_SECRET obrigatorio para webhooks em producao.");
  }

  if (clean(process.env.ASAAS_API_KEY) && !clean(process.env.ASAAS_ENVIRONMENT)) {
    throw new Error("ASAAS_ENVIRONMENT obrigatorio quando ASAAS_API_KEY esta configurada.");
  }

  if ((clean(process.env.EVOLUTION_API_KEY) || clean(process.env.EVOLUTION_API_URL)) && !clean(process.env.EVOLUTION_SENDER_PHONE)) {
    throw new Error("EVOLUTION_SENDER_PHONE obrigatorio quando Evolution API esta configurada em producao.");
  }
};

export const isProductionRuntime = isProduction;
