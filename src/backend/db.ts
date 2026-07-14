import path from "node:path";
import pg from "pg";
import { isSupabaseEdgeRuntime, validateRuntimeEnv } from "./env";

const { Pool } = pg;

type GlobalWithPool = typeof globalThis & {
  __hypePgPool?: pg.Pool;
};

const clean = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const buildConnectionString = () => {
  const direct = clean(process.env.DATABASE_URL);
  if (direct) return direct;

  const host = clean(process.env.POSTGRES_HOST);
  const database = clean(process.env.POSTGRES_DATABASE) || clean(process.env.POSTGRES_DB);
  const user = clean(process.env.POSTGRES_USER);
  const password = clean(process.env.POSTGRES_PASSWORD);
  const port = clean(process.env.POSTGRES_PORT) || "5432";

  if (!host || !database || !user || !password) {
    throw new Error(
      "Banco PostgreSQL nao configurado. Defina DATABASE_URL ou POSTGRES_HOST/POSTGRES_DATABASE/POSTGRES_USER/POSTGRES_PASSWORD.",
    );
  }

  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
};

const parsedConnectionUrl = (connectionString: string) => {
  try {
    return new URL(connectionString);
  } catch {
    return null;
  }
};

const isSupabaseDatabaseHost = (connectionString: string) => {
  const hostname = parsedConnectionUrl(connectionString)?.hostname.toLowerCase() || "";
  return (
    hostname === "supabase.co" ||
    hostname.endsWith(".supabase.co") ||
    hostname === "supabase.com" ||
    hostname.endsWith(".supabase.com")
  );
};

const getSslConfig = (connectionString: string) => {
  const sslMode = parsedConnectionUrl(connectionString)?.searchParams.get("sslmode")?.toLowerCase();
  const explicitSsl = clean(process.env.DATABASE_SSL) || clean(process.env.POSTGRES_SSL);
  const shouldUseSsl =
    (sslMode !== undefined && sslMode !== "disable") ||
    explicitSsl === "true" ||
    isSupabaseDatabaseHost(connectionString);

  if (!shouldUseSsl) return undefined;

  const rejectUnauthorizedEnv =
    clean(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED) ||
    clean(process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED);

  return {
    rejectUnauthorized: rejectUnauthorizedEnv
      ? rejectUnauthorizedEnv !== "false"
      : sslMode !== "no-verify",
  };
};

export const getPgPoolConfig = (connectionString: string): pg.PoolConfig => {
  const rootCertPath =
    clean(process.env.DATABASE_SSL_ROOT_CERT) || clean(process.env.POSTGRES_SSL_ROOT_CERT);
  if (!rootCertPath) {
    const ssl = getSslConfig(connectionString);
    if (!ssl) return { connectionString, ssl };

    // node-postgres lets SSL query parameters replace the explicit `ssl`
    // object. Remove them after validation so certificate verification cannot
    // silently degrade to driver-specific sslmode semantics.
    const configuredUrl = new URL(connectionString);
    const sslParameters = new Set([
      "sslmode",
      "sslcert",
      "sslkey",
      "sslrootcert",
      "uselibpqcompat",
    ]);
    for (const name of [...configuredUrl.searchParams.keys()]) {
      if (sslParameters.has(name.toLowerCase())) configuredUrl.searchParams.delete(name);
    }
    return { connectionString: configuredUrl.toString(), ssl };
  }
  if (!path.isAbsolute(rootCertPath)) {
    throw new Error("DATABASE_SSL_ROOT_CERT deve ser um caminho absoluto.");
  }
  const rejectUnauthorized =
    clean(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED) ||
    clean(process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED);
  if (rejectUnauthorized?.toLowerCase() === "false") {
    throw new Error(
      "DATABASE_SSL_ROOT_CERT nao pode ser combinado com SSL sem validacao de certificado.",
    );
  }

  // URL SSL settings take precedence inside node-postgres. Put the pinned CA
  // and verify-full in that same source of truth to prevent a legacy sslmode
  // from weakening certificate or hostname validation.
  const configuredUrl = new URL(connectionString);
  configuredUrl.searchParams.set("sslmode", "verify-full");
  configuredUrl.searchParams.set("sslrootcert", rootCertPath);
  return { connectionString: configuredUrl.toString() };
};

export const getPool = () => {
  const g = globalThis as GlobalWithPool;
  if (!g.__hypePgPool) {
    validateRuntimeEnv();
    const connectionString = buildConnectionString();
    g.__hypePgPool = new Pool({
      ...getPgPoolConfig(connectionString),
      max: isSupabaseEdgeRuntime() ? 1 : Number(process.env.POSTGRES_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return g.__hypePgPool;
};

let sqlLogSequence = 0;

const isSqlDebugEnabled = () => process.env.SQL_DEBUG === "true";
const shouldLogSqlErrors = () => process.env.NODE_ENV !== "production" || isSqlDebugEnabled();

const describeParam = (value: unknown) => {
  if (Array.isArray(value)) {
    const sample = value.find((item) => item !== null && item !== undefined);
    return {
      type: "array",
      length: value.length,
      itemType: sample === undefined ? "unknown" : typeof sample,
    };
  }
  if (value === null) return { type: "null" };
  if (value instanceof Date) return { type: "date" };
  return { type: typeof value };
};

const normalizeSqlForLog = (text: string) => text.replace(/\s+/g, " ").trim();

const logSql = (level: "debug" | "error", payload: Record<string, unknown>) => {
  const line = JSON.stringify(payload);
  if (level === "debug") console.debug(line);
  else console.error(line);
};

const runLoggedQuery = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  executor: (text: string, params?: unknown[]) => Promise<pg.QueryResult<T>>,
  text: string,
  params: unknown[] = [],
) => {
  const requestId = `sql-${Date.now().toString(36)}-${++sqlLogSequence}`;
  const basePayload = {
    requestId,
    sql: normalizeSqlForLog(text),
    params: params.map(describeParam),
  };

  if (isSqlDebugEnabled()) {
    logSql("debug", { event: "sql.query", ...basePayload });
  }

  try {
    return await executor(text, params);
  } catch (error: any) {
    if (shouldLogSqlErrors()) {
      logSql("error", {
        event: "sql.error",
        ...basePayload,
        pgCode: error?.code || null,
        message: error?.message || "SQL query failed",
      });
    }
    throw error;
  }
};

export const query = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
) => {
  return runLoggedQuery<T>((sql, values) => getPool().query<T>(sql, values), text, params);
};

export const queryWithStatementTimeout = async <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  timeoutMs = 5_000,
) => {
  const client = await getPool().connect();
  const boundedTimeoutMs = Math.max(1, Math.min(Math.floor(timeoutMs), 30_000));
  try {
    await client.query("BEGIN");
    await client.query(`SELECT set_config('statement_timeout', $1, true)`, [
      `${boundedTimeoutMs}ms`,
    ]);
    const result = await runLoggedQuery<T>(
      (sql, values) => client.query<T>(sql, values),
      text,
      params,
    );
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const withTransaction = async <T>(fn: (client: pg.PoolClient) => Promise<T>) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const tracedClient = {
      ...client,
      query: (text: string, params: unknown[] = []) =>
        runLoggedQuery((sql, values) => client.query(sql, values), text, params),
    } as pg.PoolClient;
    const result = await fn(tracedClient);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const quoteIdent = (value: string) => `"${String(value).replaceAll('"', '""')}"`;

export const parseBearerToken = (request: Request) => {
  const header = request.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
};
