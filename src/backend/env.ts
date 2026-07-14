import fs from "node:fs";
import path from "node:path";
import { getSupabaseServerConfig } from "./supabase";

const clean = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const secureEdgeSslModes = new Set(["require", "verify-ca", "verify-full"]);

const isSupabaseDatabaseHost = (hostname: string) => {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "supabase.co" ||
    normalized.endsWith(".supabase.co") ||
    normalized === "supabase.com" ||
    normalized.endsWith(".supabase.com")
  );
};

export const isSupabaseEdgeRuntime = () => Boolean(process.env.DENO_DEPLOYMENT_ID);

const isProduction = () => process.env.NODE_ENV === "production" || isSupabaseEdgeRuntime();

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

  const edgeRuntime = isSupabaseEdgeRuntime();
  const databaseUrl = clean(process.env.DATABASE_URL);

  if (edgeRuntime && !databaseUrl) {
    throw new Error(
      "DATABASE_URL do papel restrito vexortech_runtime e obrigatorio no Supabase Edge.",
    );
  }
  if (!edgeRuntime && !hasDatabaseConfig()) {
    throw new Error(
      "Banco PostgreSQL obrigatorio em producao.",
    );
  }
  const configuredDatabaseHost = databaseUrl
    ? new URL(databaseUrl).hostname
    : clean(process.env.POSTGRES_HOST) || "";
  if (!isSupabaseDatabaseHost(configuredDatabaseHost)) {
    throw new Error("O banco de producao deve pertencer ao projeto Supabase configurado.");
  }
  if (edgeRuntime && databaseUrl) {
    const configuredUrl = new URL(databaseUrl);
    const role = decodeURIComponent(configuredUrl.username).split(".")[0];
    const expectedRole = clean(process.env.DATABASE_RUNTIME_ROLE) || "vexortech_runtime";
    if (role !== expectedRole) {
      throw new Error(
        `DATABASE_URL do Supabase Edge deve usar o papel restrito ${expectedRole}.`,
      );
    }
    if (configuredUrl.port !== "6543") {
      throw new Error("DATABASE_URL do Supabase Edge deve usar o pooler transacional na porta 6543.");
    }
    const sslModes = [...configuredUrl.searchParams.entries()]
      .filter(([name]) => name.toLowerCase() === "sslmode")
      .map(([, value]) => value.toLowerCase());
    if (sslModes.length !== 1 || !secureEdgeSslModes.has(sslModes[0])) {
      throw new Error(
        "DATABASE_URL do Supabase Edge deve validar TLS com sslmode explicito require, verify-ca ou verify-full.",
      );
    }
  }
  const edgeProxySecret = clean(process.env.EDGE_PROXY_SECRET);
  if (edgeRuntime && (!edgeProxySecret || edgeProxySecret.length < 32)) {
    throw new Error("EDGE_PROXY_SECRET de no minimo 32 caracteres e obrigatorio no Supabase Edge.");
  }
  const sslRootCert =
    clean(process.env.DATABASE_SSL_ROOT_CERT) || clean(process.env.POSTGRES_SSL_ROOT_CERT);
  if (!sslRootCert && !edgeRuntime) {
    throw new Error("DATABASE_SSL_ROOT_CERT obrigatorio em producao.");
  }
  if (sslRootCert && !path.isAbsolute(sslRootCert)) {
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
  if (sslRootCert) {
    try {
      fs.accessSync(sslRootCert, fs.constants.R_OK);
    } catch {
      throw new Error("DATABASE_SSL_ROOT_CERT nao existe ou nao pode ser lido.");
    }
  }

  const configuredPublicUrl = clean(process.env.PUBLIC_APP_URL);
  if (!configuredPublicUrl) {
    throw new Error("PUBLIC_APP_URL obrigatorio em producao.");
  }
  const publicUrl = new URL(configuredPublicUrl);
  if (publicUrl.protocol !== "https:")
    throw new Error("PUBLIC_APP_URL deve usar HTTPS em producao.");

  const supabase = getSupabaseServerConfig();
  if (!supabase.url || !supabase.publishableKey) {
    throw new Error("URL e chave publicavel do Supabase sao obrigatorias em producao.");
  }

  if (!supabase.secretKey) {
    throw new Error("Chave secreta do Supabase e obrigatoria apenas no servidor de producao.");
  }
  const flowSecret =
    clean(process.env.AUTH_FLOW_SECRET) ||
    supabase.secretKey;
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
