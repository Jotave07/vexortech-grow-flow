import pg from "pg";

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

export const getPool = () => {
  const g = globalThis as GlobalWithPool;
  if (!g.__hypePgPool) {
    g.__hypePgPool = new Pool({
      connectionString: buildConnectionString(),
      max: Number(process.env.POSTGRES_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return g.__hypePgPool;
};

export const query = async <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []) => {
  return getPool().query<T>(text, params);
};

export const withTransaction = async <T>(fn: (client: pg.PoolClient) => Promise<T>) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
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
