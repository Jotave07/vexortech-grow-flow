import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const RUNTIME_ROLE = "vexortech_runtime";
const LOCK_NAME = "vexortech:reconcile-contract-prices:v1";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_CONTRACT_CENTS = 999_999_999_999;

const clean = (value) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const buildConnectionString = (environment = process.env) => {
  const direct = clean(environment.DATABASE_URL);
  if (direct) return direct;

  const host = clean(environment.POSTGRES_HOST);
  const database = clean(environment.POSTGRES_DATABASE) || clean(environment.POSTGRES_DB);
  const user = clean(environment.POSTGRES_USER);
  const password = clean(environment.POSTGRES_PASSWORD);
  const port = clean(environment.POSTGRES_PORT) || "5432";

  if (!host || !database || !user || !password) {
    throw new Error(
      "DATABASE_URL ou POSTGRES_HOST/POSTGRES_DATABASE/POSTGRES_USER/POSTGRES_PASSWORD obrigatorio.",
    );
  }

  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
};

const getSslConfig = (connectionString, environment = process.env) => {
  const sslMode = connectionString.match(/[?&]sslmode=([^&]+)/i)?.[1]?.toLowerCase();
  const explicitSsl = clean(environment.DATABASE_SSL) || clean(environment.POSTGRES_SSL);
  const shouldUseSsl =
    (sslMode !== undefined && sslMode !== "disable") ||
    explicitSsl === "true" ||
    /supabase\.co/i.test(connectionString);

  if (!shouldUseSsl) return undefined;

  const rejectUnauthorizedEnv =
    clean(environment.DATABASE_SSL_REJECT_UNAUTHORIZED) ||
    clean(environment.POSTGRES_SSL_REJECT_UNAUTHORIZED);

  return {
    rejectUnauthorized: rejectUnauthorizedEnv
      ? rejectUnauthorizedEnv.toLowerCase() !== "false"
      : sslMode !== "no-verify",
  };
};

export const getPgClientConfig = (connectionString, environment = process.env) => {
  const rootCertPath =
    clean(environment.DATABASE_SSL_ROOT_CERT) || clean(environment.POSTGRES_SSL_ROOT_CERT);
  if (!rootCertPath) {
    return { connectionString, ssl: getSslConfig(connectionString, environment) };
  }
  if (!path.isAbsolute(rootCertPath)) {
    throw new Error("DATABASE_SSL_ROOT_CERT deve ser um caminho absoluto.");
  }
  const rejectUnauthorized =
    clean(environment.DATABASE_SSL_REJECT_UNAUTHORIZED) ||
    clean(environment.POSTGRES_SSL_REJECT_UNAUTHORIZED);
  if (rejectUnauthorized?.toLowerCase() === "false") {
    throw new Error(
      "DATABASE_SSL_ROOT_CERT nao pode ser combinado com SSL sem validacao de certificado.",
    );
  }
  fs.accessSync(rootCertPath, fs.constants.R_OK);

  const configuredUrl = new URL(connectionString);
  configuredUrl.searchParams.set("sslmode", "verify-full");
  configuredUrl.searchParams.set("sslrootcert", rootCertPath);
  return { connectionString: configuredUrl.toString() };
};

export const getAsaasConfig = (environment = process.env) => {
  const apiKey = clean(environment.ASAAS_API_KEY);
  const asaasEnvironment = clean(environment.ASAAS_ENVIRONMENT)?.toLowerCase();
  if (!apiKey) throw new Error("ASAAS_API_KEY obrigatoria.");
  if (asaasEnvironment !== "sandbox" && asaasEnvironment !== "production") {
    throw new Error("ASAAS_ENVIRONMENT deve ser sandbox ou production.");
  }
  return {
    apiKey,
    asaasEnvironment,
    baseUrl:
      asaasEnvironment === "sandbox"
        ? "https://sandbox.asaas.com/api/v3"
        : "https://www.asaas.com/api/v3",
  };
};

const requireExactString = (value) => (typeof value === "string" && value ? value : undefined);

const hasAtMostTwoDecimalPlaces = (value) => {
  const [coefficient, exponentText] = value.toString().toLowerCase().split("e");
  const decimalPlaces = coefficient.split(".")[1]?.length || 0;
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  return Number.isInteger(exponent) && Math.max(0, decimalPlaces - exponent) <= 2;
};

export const validateGatewaySubscription = (local, remote) => {
  if (!remote || typeof remote !== "object" || Array.isArray(remote)) {
    throw new Error("Resposta de assinatura invalida.");
  }

  const gatewayId = requireExactString(local.asaas_subscription_id);
  const storeId = requireExactString(local.store_id);
  const externalReference = requireExactString(local.external_reference);
  const customerId = requireExactString(local.asaas_customer_id);
  const billingType = requireExactString(local.billing_type);
  const expectedExternalReference = storeId ? `platform-subscription:${storeId}` : undefined;

  if (
    !gatewayId ||
    !storeId ||
    !externalReference ||
    externalReference !== expectedExternalReference ||
    !customerId ||
    !billingType ||
    remote.id !== gatewayId ||
    remote.externalReference !== externalReference ||
    remote.customer !== customerId ||
    remote.billingType !== billingType ||
    remote.cycle !== "MONTHLY"
  ) {
    throw new Error("Identidade da assinatura nao confere.");
  }

  if (typeof remote.value !== "number" || !Number.isFinite(remote.value) || remote.value <= 0) {
    throw new Error("Valor do contrato invalido.");
  }
  const cents = Math.round(remote.value * 100);
  if (
    !Number.isSafeInteger(cents) ||
    cents <= 0 ||
    cents > MAX_CONTRACT_CENTS ||
    !hasAtMostTwoDecimalPlaces(remote.value)
  ) {
    throw new Error("Valor do contrato invalido.");
  }

  return (cents / 100).toFixed(2);
};

export const fetchGatewaySubscription = async ({
  fetchImpl,
  baseUrl,
  apiKey,
  gatewayId,
  requestTimeoutMs = 15_000,
}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  let response;
  try {
    response = await fetchImpl(`${baseUrl}/subscriptions/${encodeURIComponent(gatewayId)}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        access_token: apiKey,
        "user-agent": "VexorTech-contract-price-reconciliation/1.0",
      },
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    throw new Error("Falha ao consultar assinatura no gateway.");
  }
  try {
    if (response.status !== 200 || !response.ok) {
      throw new Error("Gateway recusou a consulta de assinatura.");
    }
    if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      throw new Error("Gateway retornou conteudo inesperado.");
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      throw new Error("Resposta do gateway excede o limite permitido.");
    }

    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error("Resposta do gateway excede o limite permitido.");
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new Error("Gateway retornou JSON invalido.");
    }
  } finally {
    clearTimeout(timeout);
  }
};

const assertRuntimeRole = async (client) => {
  const { rows } = await client.query(
    "SELECT current_user::text AS current_user, session_user::text AS session_user",
  );
  if (rows[0]?.current_user !== RUNTIME_ROLE || rows[0]?.session_user !== RUNTIME_ROLE) {
    throw new Error("A reconciliacao exige conexao direta como vexortech_runtime.");
  }
};

const acquireLock = async (client) => {
  const { rows } = await client.query(
    "SELECT pg_try_advisory_lock(hashtextextended($1::text, 0::bigint)) AS locked",
    [LOCK_NAME],
  );
  if (rows[0]?.locked !== true) {
    throw new Error("Outra reconciliacao ja esta em execucao.");
  }
};

const releaseLock = async (client) => {
  await client
    .query("SELECT pg_advisory_unlock(hashtextextended($1::text, 0::bigint))", [LOCK_NAME])
    .catch(() => undefined);
};

const loadPendingSubscriptions = async (client) => {
  const { rows } = await client.query(`
    SELECT
      id::text,
      store_id::text,
      asaas_subscription_id,
      asaas_customer_id,
      external_reference,
      billing_type
    FROM public.subscriptions
    WHERE NULLIF(pg_catalog.btrim(asaas_subscription_id), '') IS NOT NULL
      AND (
        contract_price_monthly IS NULL
        OR contract_price_monthly <= 0
      )
    ORDER BY id
  `);
  return rows;
};

const updateContractPrices = async (client, reconciled) => {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30s'");

    let updated = 0;
    for (const item of reconciled) {
      const { rowCount } = await client.query(
        `
          UPDATE public.subscriptions
          SET contract_price_monthly = $1::numeric,
              updated_at = now()
          WHERE id = $2::uuid
            AND store_id = $3::uuid
            AND asaas_subscription_id IS NOT DISTINCT FROM $4::text
            AND asaas_customer_id IS NOT DISTINCT FROM $5::text
            AND external_reference IS NOT DISTINCT FROM $6::text
            AND billing_type IS NOT DISTINCT FROM $7::text
            AND (
              contract_price_monthly IS NULL
              OR contract_price_monthly <= 0
            )
        `,
        [
          item.contractPrice,
          item.local.id,
          item.local.store_id,
          item.local.asaas_subscription_id,
          item.local.asaas_customer_id,
          item.local.external_reference,
          item.local.billing_type,
        ],
      );
      if (rowCount !== 1) {
        throw new Error("Assinatura local mudou durante a reconciliacao.");
      }
      updated += 1;
    }

    const { rows } = await client.query(`
      SELECT count(*)::text AS remaining
      FROM public.subscriptions
      WHERE NULLIF(pg_catalog.btrim(asaas_subscription_id), '') IS NOT NULL
        AND (
          contract_price_monthly IS NULL
          OR contract_price_monthly <= 0
        )
    `);
    const remaining = Number(rows[0]?.remaining);
    if (!Number.isSafeInteger(remaining) || remaining !== 0) {
      throw new Error("Ainda existem contratos sem preco reconciliado.");
    }

    await client.query("COMMIT");
    return { updated, remaining };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
};

export const reconcileContractPrices = async ({
  client,
  fetchImpl = globalThis.fetch,
  apiKey,
  asaasEnvironment,
  requestTimeoutMs,
}) => {
  if (typeof fetchImpl !== "function") throw new Error("Cliente HTTP indisponivel.");
  if (!apiKey) throw new Error("ASAAS_API_KEY obrigatoria.");
  if (asaasEnvironment !== "sandbox" && asaasEnvironment !== "production") {
    throw new Error("ASAAS_ENVIRONMENT deve ser sandbox ou production.");
  }
  const baseUrl =
    asaasEnvironment === "sandbox"
      ? "https://sandbox.asaas.com/api/v3"
      : "https://www.asaas.com/api/v3";

  await assertRuntimeRole(client);
  await acquireLock(client);
  try {
    const pending = await loadPendingSubscriptions(client);
    const reconciled = [];
    for (const local of pending) {
      const remote = await fetchGatewaySubscription({
        fetchImpl,
        baseUrl,
        apiKey,
        gatewayId: local.asaas_subscription_id,
        requestTimeoutMs,
      });
      reconciled.push({
        local,
        contractPrice: validateGatewaySubscription(local, remote),
      });
    }

    const result = await updateContractPrices(client, reconciled);
    return { pending: pending.length, ...result };
  } finally {
    await releaseLock(client);
  }
};

const main = async () => {
  const connectionString = buildConnectionString();
  const asaas = getAsaasConfig();
  const client = new Client(getPgClientConfig(connectionString));
  try {
    await client.connect();
    const counts = await reconcileContractPrices({
      client,
      apiKey: asaas.apiKey,
      asaasEnvironment: asaas.asaasEnvironment,
    });
    process.stdout.write(`${JSON.stringify(counts)}\n`);
  } finally {
    await client.end().catch(() => undefined);
  }
};

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  main().catch(() => {
    process.stderr.write("Falha na reconciliacao de precos contratuais.\n");
    process.exitCode = 1;
  });
}
