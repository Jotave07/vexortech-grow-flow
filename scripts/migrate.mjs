import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const { Client } = pg;
const root = process.cwd();

const clean = (value) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const loadDotEnv = () => {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
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
    throw new Error("DATABASE_URL ou POSTGRES_HOST/POSTGRES_DATABASE/POSTGRES_USER/POSTGRES_PASSWORD obrigatorio para migrar.");
  }

  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
};

const getSslConfig = (connectionString) => {
  const sslMode = connectionString.match(/[?&]sslmode=([^&]+)/i)?.[1]?.toLowerCase();
  const explicitSsl = clean(process.env.DATABASE_SSL) || clean(process.env.POSTGRES_SSL);
  const shouldUseSsl =
    (sslMode !== undefined && sslMode !== "disable") ||
    explicitSsl === "true" ||
    /supabase\.co/i.test(connectionString);

  if (!shouldUseSsl) return undefined;

  const rejectUnauthorizedEnv =
    clean(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED) ||
    clean(process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED);

  return {
    rejectUnauthorized: rejectUnauthorizedEnv ? rejectUnauthorizedEnv !== "false" : sslMode !== "no-verify",
  };
};

const ensureMigrationTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      name text NOT NULL,
      checksum text NOT NULL,
      executed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
};

const checksum = (content) => crypto.createHash("sha256").update(content).digest("hex");

const compatibleChecksums = new Map([
  [
    "20260521143000_production_hardening.sql",
    [
      "2d062451b7b17cb467e78b4ea629fba55fe4ea2f0cb48e87b4fd06bdab8401ce",
      "95534036768d371fd2463750363604e60c5d14b361a3e95c4f4b55226e947e65",
    ],
  ],
]);

const migrationFiles = () => {
  const dir = path.join(root, "db", "migrations");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => path.join(dir, file));
};

loadDotEnv();

const connectionString = buildConnectionString();
const client = new Client({ connectionString, ssl: getSslConfig(connectionString) });

try {
  await client.connect();
  await ensureMigrationTable(client);

  const files = migrationFiles();
  if (!files.length) {
    console.log("No migrations found in db/migrations.");
  }

  for (const filePath of files) {
    const name = path.basename(filePath);
    const version = name.split("_")[0];
    const content = fs.readFileSync(filePath, "utf8");
    const fileChecksum = checksum(content);
    const { rows } = await client.query(
      "SELECT checksum FROM public.schema_migrations WHERE version = $1::text",
      [version],
    );

    if (rows[0]) {
      const legacyChecksums = compatibleChecksums.get(name) || [];
      if (rows[0].checksum !== fileChecksum && !legacyChecksums.includes(rows[0].checksum)) {
        throw new Error(`Migration ${name} ja foi aplicada com checksum diferente.`);
      }
      console.log(rows[0].checksum === fileChecksum ? `Skipping ${name}` : `Skipping ${name} (compatible legacy checksum)`);
      continue;
    }

    console.log(`Applying ${name}`);
    await client.query(content);
    await client.query(
      "INSERT INTO public.schema_migrations (version, name, checksum) VALUES ($1::text, $2::text, $3::text)",
      [version, name, fileChecksum],
    );
  }

  console.log("Migrations completed.");
} finally {
  await client.end().catch(() => undefined);
}
