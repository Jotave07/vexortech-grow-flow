import fs from "node:fs";
import path from "node:path";

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

/** Token de autenticacao do webhook Asaas (aceita ambos os nomes de variavel). */
export const getAsaasWebhookSecret = () =>
  clean(process.env.ASAAS_WEBHOOK_SECRET) || clean(process.env.ASAAS_WEBHOOK_AUTH_TOKEN);

export const validateRuntimeEnv = (options: { requireWebhookSecret?: boolean } = {}) => {
  if (!isProduction()) return;

  if (!hasDatabaseConfig()) {
    throw new Error("Banco PostgreSQL obrigatorio em producao.");
  }
  const sslRootCert =
    clean(process.env.DATABASE_SSL_ROOT_CERT) || clean(process.env.POSTGRES_SSL_ROOT_CERT);
  if (!sslRootCert) {
    throw new Error("DATABASE_SSL_ROOT_CERT obrigatorio em producao.");
  }
  if (!path.isAbsolute(sslRootCert)) {
    throw new Error("DATABASE_SSL_ROOT_CERT deve ser um caminho absoluto em producao.");
  }
  const rejectUnauthorized =
    clean(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED) ||
    clean(process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED);
  if (rejectUnauthorized?.toLowerCase() === "false") {
    throw new Error(
      "DATABASE_SSL_ROOT_CERT nao pode ser combinado com SSL sem validacao de certificado.",
    );
  }
  try {
    fs.accessSync(sslRootCert, fs.constants.R_OK);
  } catch {
    throw new Error("DATABASE_SSL_ROOT_CERT nao existe ou nao pode ser lido.");
  }

  const configuredPublicUrl = clean(process.env.PUBLIC_APP_URL);
  if (!configuredPublicUrl) {
    throw new Error("PUBLIC_APP_URL obrigatorio em producao.");
  }
  const publicUrl = new URL(configuredPublicUrl);
  if (publicUrl.protocol !== "https:")
    throw new Error("PUBLIC_APP_URL deve usar HTTPS em producao.");

  if (
    !clean(process.env.NEXT_PUBLIC_SUPABASE_URL) ||
    !clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  ) {
    throw new Error("URL e chave publicavel do Supabase sao obrigatorias em producao.");
  }

  if (!clean(process.env.SUPABASE_SECRET_KEY) && !clean(process.env.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error("Chave secreta do Supabase e obrigatoria apenas no servidor de producao.");
  }
  const flowSecret =
    clean(process.env.AUTH_FLOW_SECRET) ||
    clean(process.env.SUPABASE_SECRET_KEY) ||
    clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!flowSecret || flowSecret.length < 32) {
    throw new Error(
      "AUTH_FLOW_SECRET (ou chave secreta Supabase forte) obrigatorio para PKCE em producao.",
    );
  }

  if (options.requireWebhookSecret && !getAsaasWebhookSecret()) {
    throw new Error(
      "ASAAS_WEBHOOK_SECRET (ou ASAAS_WEBHOOK_AUTH_TOKEN) obrigatorio para webhooks em producao.",
    );
  }

  if (!clean(process.env.ASAAS_API_KEY)) {
    throw new Error("ASAAS_API_KEY obrigatoria em producao.");
  }
  const asaasEnvironment = clean(process.env.ASAAS_ENVIRONMENT)?.toLowerCase();
  if (!asaasEnvironment || !["sandbox", "production"].includes(asaasEnvironment)) {
    throw new Error("ASAAS_ENVIRONMENT deve ser sandbox ou production em producao.");
  }

  // Evolution has a server-side default sender and notification calls are best-effort.
  // Missing sender configuration must not block database-backed routes.
};

export const isProductionRuntime = isProduction;
