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
  [
    "20260521180000_generic_pix_gateway.sql",
    [
      "60b5593a6ff0642622145cffaa04df687c5905847cc6d6ed87a96c0b090f31a0",
    ],
  ],
  [
    "20260521190000_orders_delivery_evolution.sql",
    [
      "26c339fbdc1217abb1941fe8f9eaf55f8c0b3f2c6a225e0ccc857a568b1d842d",
    ],
  ],
  [
    "20260522153000_order_number_defaults.sql",
    [
      "e9b1d80f8615c1c1e7f04b87ea9697895280d8b9800c9671cd0c7a3315033d17",
    ],
  ],
  [
    "20260522154000_public_order_address_fields.sql",
    [
      "e4202434a5bcfbd93779375b9470e57cc1166793c911073c8b5738b3d9c61fc5",
    ],
  ],
  [
    "20260526110000_subscription_and_manual_pix.sql",
    [
      "f2f09fa7e291c63e93dd093c466ef860890633ecfbb2e08c5263e54414e9b677",
    ],
  ],
  [
    "20260527102000_store_profile_and_plan_safety.sql",
    [
      "1ae045ab534f631bbab1106149b39dbba056f7403509633dddb8a667b18991ea",
      "2b67f3af999259a593ab8d8360b6b5e60e0dd9d28ee35bba27bbd0bc1d7b5eec",
    ],
  ],
  [
    "20260619145104_plan_monthly_order_limit.sql",
    [
      "7bf2b051ee2485ae551f12ddbb511d6b6fdfc56d27d936972e5fdbb19f368f8a",
    ],
  ],
  [
    "20260617120000_supabase_auth_storage_maps.sql",
    [
      "75ca2b74e286fe6e8f99260cf3a869919843d87a83486e06cd1d7b2556ca0a54",
    ],
  ],
  [
    "20260617163500_store_public_profile_columns.sql",
    [
      "9529517da4cad10d11f21fb5cd78d885dc5ba9652388e47094c1e518c3d22805",
    ],
  ],
  [
    "20260618082000_store_contract_columns.sql",
    [
      "44194f92a730286c7668def7a496dbef3a1a2cbcd37f9d4496dbd227463d167a",
    ],
  ],
  [
    "20260618090000_subscriptions_provider_column.sql",
    [
      "8cbd0c4bf012afb208c6564b55913b3a35b2629ce06951b8ae3071587ea8ba73",
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
