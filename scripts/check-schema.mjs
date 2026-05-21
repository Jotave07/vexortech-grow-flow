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
    throw new Error("DATABASE_URL ou POSTGRES_* obrigatorio para check-schema.");
  }
  return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
};

const checks = [
  {
    label: "orders.public_token default/not-null",
    sql: `
      SELECT column_default LIKE '%gen_random_uuid%' AND is_nullable = 'NO' AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'public_token'
    `,
  },
  {
    label: "orders_public_token_unique",
    sql: "SELECT to_regclass('public.orders_public_token_unique') IS NOT NULL AS ok",
  },
  {
    label: "orders_checkout_idempotency_unique",
    sql: "SELECT to_regclass('public.orders_checkout_idempotency_unique') IS NOT NULL AS ok",
  },
  {
    label: "payments_order_id_unique",
    sql: "SELECT to_regclass('public.payments_order_id_unique') IS NOT NULL AS ok",
  },
  {
    label: "payments external/asaas unique indexes",
    sql: `
      SELECT
        to_regclass('public.payments_external_id_unique') IS NOT NULL
        AND to_regclass('public.payments_asaas_id_unique') IS NOT NULL AS ok
    `,
  },
  {
    label: "payment_events audit table",
    sql: "SELECT to_regclass('public.payment_events') IS NOT NULL AS ok",
  },
  {
    label: "public order RPCs exist",
    sql: `
      SELECT
        to_regprocedure('public.get_public_order(text)') IS NOT NULL
        AND to_regprocedure('public.get_public_order_items(text)') IS NOT NULL
        AND to_regprocedure('public.get_public_order_status_history(text)') IS NOT NULL AS ok
    `,
  },
  {
    label: "order item financial columns",
    sql: `
      SELECT count(*) = 3 AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'order_items'
        AND column_name = ANY($1::text[])
    `,
    params: [["notes", "subtotal", "options_total"]],
  },
];

loadDotEnv();
const client = new Client({ connectionString: buildConnectionString() });

try {
  await client.connect();
  const failures = [];
  for (const check of checks) {
    const { rows } = await client.query(check.sql, check.params || []);
    const ok = Boolean(rows[0]?.ok);
    console.log(`${ok ? "ok" : "fail"} - ${check.label}`);
    if (!ok) failures.push(check.label);
  }

  if (failures.length) {
    throw new Error(`Schema check failed: ${failures.join(", ")}`);
  }

  console.log("Schema check completed.");
} finally {
  await client.end().catch(() => undefined);
}
