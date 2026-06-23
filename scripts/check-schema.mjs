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
    label: "orders.order_number default/not-null",
    sql: `
      SELECT column_default LIKE '%orders_order_number_seq%' AND is_nullable = 'NO' AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'order_number'
    `,
  },
  {
    label: "orders.order_number backfilled",
    sql: "SELECT count(*) = 0 AS ok FROM public.orders WHERE order_number IS NULL",
  },
  {
    label: "orders_order_number_unique",
    sql: "SELECT to_regclass('public.orders_order_number_unique') IS NOT NULL AS ok",
  },
  {
    label: "orders_public_token_unique",
    sql: "SELECT to_regclass('public.orders_public_token_unique') IS NOT NULL AS ok",
  },
  {
    label: "orders idempotency index is not duplicated",
    sql: `
      SELECT
        to_regclass('public.orders_store_customer_idempotency_unique') IS NOT NULL
        AND to_regclass('public.orders_checkout_idempotency_unique') IS NULL AS ok
    `,
  },
  {
    label: "foreign key covering indexes",
    sql: `
      SELECT
        to_regclass('public.customers_store_id_idx') IS NOT NULL
        AND to_regclass('public.order_status_history_order_id_idx') IS NOT NULL
        AND to_regclass('public.orders_customer_id_idx') IS NOT NULL
        AND to_regclass('public.product_option_items_option_id_idx') IS NOT NULL
        AND to_regclass('public.product_options_product_id_idx') IS NOT NULL
        AND to_regclass('public.products_store_id_idx') IS NOT NULL AS ok
    `,
  },
  {
    label: "delivery quote columns",
    sql: `
      SELECT count(*) = 5 AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'delivery_zones'
        AND column_name = ANY($1::text[])
    `,
    params: [["max_radius_km", "fee_per_km", "min_fee", "max_fee", "base_prep_time"]],
  },
  {
    label: "orders delivery/status columns",
    sql: `
      SELECT count(*) = 6 AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = ANY($1::text[])
    `,
    params: [["delivery_reference", "distance_km", "delivery_source", "accepted_at", "ready_at", "cancelled_at"]],
  },
  {
    label: "notification_events idempotency",
    sql: `
      SELECT
        to_regclass('public.notification_events') IS NOT NULL
        AND to_regclass('public.notification_events_provider_type_order_recipient_unique') IS NOT NULL AS ok
    `,
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
  {
    label: "store contract columns",
    sql: `
      SELECT count(*) = 33 AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'stores'
        AND column_name = ANY($1::text[])
    `,
    params: [[
      "public_name",
      "description",
      "store_type",
      "is_verified",
      "verification_status",
      "verification_notes",
      "logo_url",
      "cover_url",
      "document",
      "email",
      "address",
      "address_number",
      "address_complement",
      "neighborhood",
      "zip_code",
      "latitude",
      "longitude",
      "primary_color",
      "secondary_color",
      "city",
      "state",
      "plan_id",
      "status",
      "font_family",
      "payment_methods",
      "phone",
      "whatsapp",
      "whatsapp_number",
      "is_active",
      "is_suspended",
      "delivery_fee",
      "min_order_amount",
      "updated_at",
    ]],
  },
  {
    label: "stores_plan_id_fkey",
    sql: `
      SELECT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'stores_plan_id_fkey'
      ) AS ok
    `,
  },
  {
    label: "store settings contract columns",
    sql: `
      SELECT count(*) = 28 AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'store_settings'
        AND column_name = ANY($1::text[])
    `,
    params: [[
      "payment_instructions",
      "payment_gateway_provider",
      "payment_gateway_api_key",
      "payment_gateway_config",
      "pix_key",
      "pix_key_type",
      "asaas_wallet_id",
      "allow_delivery",
      "allow_pickup",
      "accept_pix",
      "accept_cash",
      "accept_card_on_delivery",
      "accept_orders_when_closed",
      "accept_card_online",
      "is_open",
      "delivery_radius_km",
      "delivery_base_fee",
      "delivery_fee_per_km",
      "delivery_distance_rules",
      "delivery_message",
      "excluded_neighborhoods",
      "min_order_value",
      "min_order_amount",
      "free_delivery_above",
      "avg_prep_time_minutes",
      "business_hours",
      "whatsapp_number",
      "updated_at",
    ]],
  },
  {
    label: "store settings runtime columns",
    sql: `
      SELECT count(*) = 3 AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'store_settings'
        AND column_name = ANY($1::text[])
    `,
    params: [["address", "next_opening_time", "payment_methods"]],
  },
  {
    label: "products runtime columns",
    sql: `
      SELECT count(*) = 2 AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'products'
        AND column_name = ANY($1::text[])
    `,
    params: [["is_featured", "prep_time_minutes"]],
  },
  {
    label: "profiles admin subscription columns",
    sql: `
      SELECT count(*) = 2 AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'profiles'
        AND column_name = ANY($1::text[])
    `,
    params: [["avatar_url", "is_exempt"]],
  },
  {
    label: "subscriptions trial column",
    sql: `
      SELECT count(*) = 1 AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'subscriptions'
        AND column_name = 'trial_ends_at'
    `,
  },
  {
    label: "orders scheduling/cancellation columns",
    sql: `
      SELECT count(*) = 9 AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'orders'
        AND column_name = ANY($1::text[])
    `,
    params: [[
      "cancel_reason",
      "delivery_city",
      "delivery_neighborhood",
      "delivery_state",
      "delivery_zip_code",
      "estimated_delivery_at",
      "estimated_ready_at",
      "refused_reason",
      "scheduled_at",
    ]],
  },
  {
    label: "delivery zones internal notes column",
    sql: `
      SELECT count(*) = 1 AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'delivery_zones'
        AND column_name = 'internal_notes'
    `,
  },
  {
    label: "delivery drivers table",
    sql: `
      SELECT
        to_regclass('public.delivery_drivers') IS NOT NULL
        AND to_regclass('public.delivery_drivers_store_id_idx') IS NOT NULL
        AND (
          SELECT count(*) = 8
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'delivery_drivers'
            AND column_name = ANY($1::text[])
        )
        AND EXISTS (
          SELECT 1
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relname = 'delivery_drivers'
            AND c.relrowsecurity IS TRUE
        ) AS ok
    `,
    params: [["id", "store_id", "name", "phone", "vehicle_type", "is_active", "created_at", "updated_at"]],
  },
  {
    label: "customer account tables",
    sql: `
      SELECT
        to_regclass('public.customer_addresses') IS NOT NULL
        AND to_regclass('public.customer_favorites') IS NOT NULL
        AND (
          SELECT count(*) = 15
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'customer_addresses'
            AND column_name = ANY($1::text[])
        )
        AND (
          SELECT count(*) = 4
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'customer_favorites'
            AND column_name = ANY($2::text[])
        ) AS ok
    `,
    params: [
      [
        "id",
        "user_id",
        "label",
        "street",
        "number",
        "complement",
        "neighborhood",
        "city",
        "state",
        "zip_code",
        "latitude",
        "longitude",
        "is_default",
        "created_at",
        "updated_at",
      ],
      ["id", "user_id", "store_id", "created_at"],
    ],
  },
  {
    label: "audit log table",
    sql: `
      SELECT
        to_regclass('public.audit_logs') IS NOT NULL
        AND (
          SELECT count(*) = 8
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'audit_logs'
            AND column_name = ANY($1::text[])
        ) AS ok
    `,
    params: [["id", "actor_user_id", "store_id", "action", "entity_type", "entity_id", "metadata", "created_at"]],
  },
  {
    label: "store reviews runtime columns",
    sql: `
      SELECT count(*) = 9 AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'store_reviews'
        AND column_name = ANY($1::text[])
    `,
    params: [["id", "store_id", "user_id", "order_id", "rating", "comment", "is_visible", "created_at", "updated_at"]],
  },
  {
    label: "plan catalog safety columns",
    sql: `
      SELECT count(*) = 6 AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'plans'
        AND column_name = ANY($1::text[])
    `,
    params: [["slug", "features", "max_products", "max_orders_per_month", "sort_order", "allows_custom_branding"]],
  },
  {
    label: "supabase auth profile trigger",
    sql: `
      SELECT
        to_regprocedure('public.handle_auth_user_created()') IS NOT NULL
        AND (
          to_regclass('auth.users') IS NULL
          OR EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgname = 'on_auth_user_created'
              AND tgrelid = to_regclass('auth.users')
          )
        ) AS ok
    `,
  },
  {
    label: "user role uniqueness",
    sql: "SELECT to_regclass('public.user_roles_user_role_store_unique') IS NOT NULL AS ok",
  },
  {
    label: "store owners have resolvable profiles",
    sql: `
      SELECT count(*) = 0 AS ok
      FROM public.stores s
      WHERE s.owner_user_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.user_id = s.owner_user_id
             OR p.store_id = s.id
        )
    `,
  },
  {
    label: "public tables do not expose Data API privileges to anon/authenticated",
    sql: `
      SELECT count(*) = 0 AS ok
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND (
          has_table_privilege('anon', c.oid, 'select, insert, update, delete')
          OR has_table_privilege('authenticated', c.oid, 'select, insert, update, delete')
        )
    `,
  },
  {
    label: "public functions use fixed search_path",
    sql: `
      SELECT count(*) = 0 AS ok
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = ANY($1::text[])
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) cfg(value)
          WHERE cfg.value LIKE 'search_path=%'
        )
    `,
    params: [[
      "is_vexor_admin",
      "get_public_order",
      "get_public_order_items",
      "get_public_order_status_history",
      "get_store_rating",
      "normalize_signup_role",
      "handle_auth_user_created",
    ]],
  },
  {
    label: "internal auth trigger helpers are not executable through Data API roles",
    sql: `
      SELECT NOT (
        has_function_privilege('anon', 'public.handle_auth_user_created()', 'execute')
        OR has_function_privilege('authenticated', 'public.handle_auth_user_created()', 'execute')
        OR has_function_privilege('anon', 'public.normalize_signup_role(jsonb)', 'execute')
        OR has_function_privilege('authenticated', 'public.normalize_signup_role(jsonb)', 'execute')
      ) AS ok
    `,
  },
];

loadDotEnv();
const connectionString = buildConnectionString();
const client = new Client({ connectionString, ssl: getSslConfig(connectionString) });

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
