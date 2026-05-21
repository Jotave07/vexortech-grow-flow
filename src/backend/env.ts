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

  if (options.requireWebhookSecret && !clean(process.env.ASAAS_WEBHOOK_SECRET)) {
    throw new Error("ASAAS_WEBHOOK_SECRET obrigatorio para webhooks em producao.");
  }
};

export const isProductionRuntime = isProduction;
