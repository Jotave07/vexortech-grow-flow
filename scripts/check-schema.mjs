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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
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
    rejectUnauthorized: rejectUnauthorizedEnv
      ? rejectUnauthorizedEnv !== "false"
      : sslMode !== "no-verify",
  };
};

const getPgClientConfig = (connectionString) => {
  const rootCertPath =
    clean(process.env.DATABASE_SSL_ROOT_CERT) || clean(process.env.POSTGRES_SSL_ROOT_CERT);
  if (!rootCertPath) {
    return { connectionString, ssl: getSslConfig(connectionString) };
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
  fs.accessSync(rootCertPath, fs.constants.R_OK);

  // Keep the CA and verify-full in the parsed connection URL because
  // pg-connection-string lets URL SSL parameters override an explicit object.
  const configuredUrl = new URL(connectionString);
  configuredUrl.searchParams.set("sslmode", "verify-full");
  configuredUrl.searchParams.set("sslrootcert", rootCertPath);
  return { connectionString: configuredUrl.toString() };
};

// PostgreSQL deparses catalog expressions with redundant parentheses and
// implicit casts. Normalize only text outside quoted literals so regex groups,
// enum case, operators, key order and sort direction remain semantically exact.
const normalizedCatalogSql = (expression) => `
  (
    SELECT string_agg(
      CASE
        WHEN expression_part.ordinality % 2 = 0
          THEN chr(39) || expression_part.value || chr(39)
        ELSE regexp_replace(
          regexp_replace(
            expression_part.value,
            '::(text|numeric|integer|uuid|boolean)(\\[\\])?',
            '',
            'g'
          ),
          '[[:space:]()"]',
          '',
          'g'
        )
      END,
      '' ORDER BY expression_part.ordinality
    )
    FROM pg_catalog.regexp_split_to_table(${expression}, '''')
      WITH ORDINALITY AS expression_part(value, ordinality)
  )
`;

const requiredColumnContractsCheck = (label, columns) => ({
  label,
  sql: `
    WITH expected AS (
      SELECT *
      FROM jsonb_to_recordset($1::jsonb) AS contract(
        table_name text,
        column_name text,
        data_type text,
        not_null boolean,
        default_expression text
      )
    )
    SELECT NOT EXISTS (
      SELECT 1
      FROM expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_attribute AS attribute_state
        JOIN pg_catalog.pg_class AS table_relation
          ON table_relation.oid = attribute_state.attrelid
        JOIN pg_catalog.pg_namespace AS table_namespace
          ON table_namespace.oid = table_relation.relnamespace
        LEFT JOIN pg_catalog.pg_attrdef AS default_state
          ON default_state.adrelid = attribute_state.attrelid
         AND default_state.adnum = attribute_state.attnum
        WHERE table_namespace.nspname = 'public'
          AND table_relation.relname = expected.table_name
          AND table_relation.relkind IN ('r', 'p')
          AND attribute_state.attname = expected.column_name
          AND attribute_state.attnum > 0
          AND attribute_state.attisdropped IS FALSE
          AND pg_catalog.format_type(
            attribute_state.atttypid,
            attribute_state.atttypmod
          ) = expected.data_type
          AND attribute_state.attnotnull = expected.not_null
          AND (
            (
              expected.default_expression IS NULL
              AND default_state.oid IS NULL
            )
            OR (
              expected.default_expression IS NOT NULL
              AND default_state.oid IS NOT NULL
              AND ${normalizedCatalogSql(
                "pg_catalog.pg_get_expr(default_state.adbin, default_state.adrelid, true)",
              )} = ${normalizedCatalogSql("expected.default_expression")}
            )
          )
      )
    ) AS ok
  `,
  params: [
    JSON.stringify(
      columns.map((column) => ({
        table_name: column.table,
        column_name: column.column,
        data_type: column.type,
        not_null: Boolean(column.notNull),
        default_expression: column.default ?? null,
      })),
    ),
  ],
});

const requiredIndexContractsCheck = (label, indexes) => ({
  label,
  sql: `
    WITH expected AS (
      SELECT *
      FROM jsonb_to_recordset($1::jsonb) AS contract(
        index_name text,
        table_name text,
        unique_index boolean,
        key_expressions jsonb,
        predicate_expression text
      )
    )
    SELECT NOT EXISTS (
      SELECT 1
      FROM expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_index AS index_state
        JOIN pg_catalog.pg_class AS index_relation
          ON index_relation.oid = index_state.indexrelid
        JOIN pg_catalog.pg_namespace AS index_namespace
          ON index_namespace.oid = index_relation.relnamespace
        JOIN pg_catalog.pg_class AS table_relation
          ON table_relation.oid = index_state.indrelid
        JOIN pg_catalog.pg_namespace AS table_namespace
          ON table_namespace.oid = table_relation.relnamespace
        JOIN pg_catalog.pg_am AS access_method
          ON access_method.oid = index_relation.relam
        WHERE index_namespace.nspname = 'public'
          AND table_namespace.nspname = 'public'
          AND index_relation.relname = expected.index_name
          AND table_relation.relname = expected.table_name
          AND access_method.amname = 'btree'
          AND index_state.indisvalid IS TRUE
          AND index_state.indisready IS TRUE
          AND index_state.indislive IS TRUE
          AND index_state.indisunique = expected.unique_index
          AND index_state.indnatts = index_state.indnkeyatts
          AND (
            SELECT array_agg(
              ${normalizedCatalogSql(
                `
                  pg_catalog.pg_get_indexdef(
                    index_state.indexrelid,
                    key_position,
                    true
                  )
                  || CASE
                    WHEN (index_state.indoption[key_position - 1] & 1) = 1
                      THEN ' DESC'
                    ELSE ''
                  END
                  || CASE
                    WHEN (index_state.indoption[key_position - 1] & 1) = 1
                      AND (index_state.indoption[key_position - 1] & 2) = 0
                      THEN ' NULLS LAST'
                    WHEN (index_state.indoption[key_position - 1] & 1) = 0
                      AND (index_state.indoption[key_position - 1] & 2) = 2
                      THEN ' NULLS FIRST'
                    ELSE ''
                  END
                `,
              )}
              ORDER BY key_position
            )
            FROM generate_series(1, index_state.indnkeyatts)
              AS generated_key(key_position)
          ) = (
            SELECT array_agg(
              ${normalizedCatalogSql("expected_key.value")}
              ORDER BY expected_key.ordinality
            )
            FROM jsonb_array_elements_text(expected.key_expressions)
              WITH ORDINALITY AS expected_key(value, ordinality)
          )
          AND (
            (
              expected.predicate_expression IS NULL
              AND index_state.indpred IS NULL
            )
            OR (
              expected.predicate_expression IS NOT NULL
              AND index_state.indpred IS NOT NULL
              AND ${normalizedCatalogSql(
                "pg_catalog.pg_get_expr(index_state.indpred, index_state.indrelid, true)",
              )} = ${normalizedCatalogSql("expected.predicate_expression")}
            )
          )
      )
    ) AS ok
  `,
  params: [
    JSON.stringify(
      indexes.map((index) => ({
        index_name: index.name,
        table_name: index.table,
        unique_index: Boolean(index.unique),
        key_expressions: index.keys,
        predicate_expression: index.predicate ?? null,
      })),
    ),
  ],
});

const requiredCheckConstraintContractsCheck = (label, constraints) => ({
  label,
  sql: `
    WITH expected AS (
      SELECT *
      FROM jsonb_to_recordset($1::jsonb) AS contract(
        constraint_name text,
        table_name text,
        validated boolean,
        check_expression text
      )
    )
    SELECT NOT EXISTS (
      SELECT 1
      FROM expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_state
        JOIN pg_catalog.pg_class AS table_relation
          ON table_relation.oid = constraint_state.conrelid
        JOIN pg_catalog.pg_namespace AS table_namespace
          ON table_namespace.oid = table_relation.relnamespace
        WHERE table_namespace.nspname = 'public'
          AND table_relation.relname = expected.table_name
          AND constraint_state.conname = expected.constraint_name
          AND constraint_state.contype = 'c'
          AND (
            expected.validated IS NULL
            OR constraint_state.convalidated = expected.validated
          )
          AND ${normalizedCatalogSql(
            "pg_catalog.pg_get_expr(constraint_state.conbin, constraint_state.conrelid, true)",
          )} = ${normalizedCatalogSql("expected.check_expression")}
      )
    ) AS ok
  `,
  params: [
    JSON.stringify(
      constraints.map((constraint) => ({
        constraint_name: constraint.name,
        table_name: constraint.table,
        validated: constraint.validated,
        check_expression: constraint.expression,
      })),
    ),
  ],
});

const requiredForeignKeyContractsCheck = (label, constraints) => ({
  label,
  sql: `
    WITH expected AS (
      SELECT *
      FROM jsonb_to_recordset($1::jsonb) AS contract(
        constraint_name text,
        table_name text,
        key_columns jsonb,
        referenced_table_name text,
        referenced_columns jsonb,
        delete_action "char",
        update_action "char",
        match_type "char",
        validated boolean
      )
    )
    SELECT NOT EXISTS (
      SELECT 1
      FROM expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_state
        JOIN pg_catalog.pg_class AS table_relation
          ON table_relation.oid = constraint_state.conrelid
        JOIN pg_catalog.pg_namespace AS table_namespace
          ON table_namespace.oid = table_relation.relnamespace
        JOIN pg_catalog.pg_class AS referenced_relation
          ON referenced_relation.oid = constraint_state.confrelid
        JOIN pg_catalog.pg_namespace AS referenced_namespace
          ON referenced_namespace.oid = referenced_relation.relnamespace
        WHERE table_namespace.nspname = 'public'
          AND referenced_namespace.nspname = 'public'
          AND table_relation.relname = expected.table_name
          AND referenced_relation.relname = expected.referenced_table_name
          AND constraint_state.conname = expected.constraint_name
          AND constraint_state.contype = 'f'
          AND (
            expected.validated IS NULL
            OR constraint_state.convalidated = expected.validated
          )
          AND constraint_state.confdeltype = expected.delete_action
          AND constraint_state.confupdtype = expected.update_action
          AND constraint_state.confmatchtype = expected.match_type
          AND (
            SELECT array_agg(attribute_state.attname::text ORDER BY key_state.ordinality)
            FROM unnest(constraint_state.conkey)
              WITH ORDINALITY AS key_state(attnum, ordinality)
            JOIN pg_catalog.pg_attribute AS attribute_state
              ON attribute_state.attrelid = constraint_state.conrelid
             AND attribute_state.attnum = key_state.attnum
          ) = (
            SELECT array_agg(expected_key.value ORDER BY expected_key.ordinality)
            FROM jsonb_array_elements_text(expected.key_columns)
              WITH ORDINALITY AS expected_key(value, ordinality)
          )
          AND (
            SELECT array_agg(attribute_state.attname::text ORDER BY key_state.ordinality)
            FROM unnest(constraint_state.confkey)
              WITH ORDINALITY AS key_state(attnum, ordinality)
            JOIN pg_catalog.pg_attribute AS attribute_state
              ON attribute_state.attrelid = constraint_state.confrelid
             AND attribute_state.attnum = key_state.attnum
          ) = (
            SELECT array_agg(expected_key.value ORDER BY expected_key.ordinality)
            FROM jsonb_array_elements_text(expected.referenced_columns)
              WITH ORDINALITY AS expected_key(value, ordinality)
          )
      )
    ) AS ok
  `,
  params: [
    JSON.stringify(
      constraints.map((constraint) => ({
        constraint_name: constraint.name,
        table_name: constraint.table,
        key_columns: constraint.columns,
        referenced_table_name: constraint.referencedTable,
        referenced_columns: constraint.referencedColumns,
        delete_action: constraint.deleteAction,
        update_action: constraint.updateAction,
        match_type: constraint.matchType,
        validated: constraint.validated,
      })),
    ),
  ],
});

const requiredKeyConstraintContractsCheck = (label, constraints) => ({
  label,
  sql: `
    WITH expected AS (
      SELECT *
      FROM jsonb_to_recordset($1::jsonb) AS contract(
        constraint_name text,
        table_name text,
        constraint_type "char",
        key_columns jsonb,
        validated boolean
      )
    )
    SELECT NOT EXISTS (
      SELECT 1
      FROM expected
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_state
        JOIN pg_catalog.pg_class AS table_relation
          ON table_relation.oid = constraint_state.conrelid
        JOIN pg_catalog.pg_namespace AS table_namespace
          ON table_namespace.oid = table_relation.relnamespace
        WHERE table_namespace.nspname = 'public'
          AND table_relation.relname = expected.table_name
          AND constraint_state.conname = expected.constraint_name
          AND constraint_state.contype = expected.constraint_type
          AND constraint_state.convalidated = expected.validated
          AND (
            SELECT array_agg(attribute_state.attname::text ORDER BY key_state.ordinality)
            FROM unnest(constraint_state.conkey)
              WITH ORDINALITY AS key_state(attnum, ordinality)
            JOIN pg_catalog.pg_attribute AS attribute_state
              ON attribute_state.attrelid = constraint_state.conrelid
             AND attribute_state.attnum = key_state.attnum
          ) = (
            SELECT array_agg(expected_key.value ORDER BY expected_key.ordinality)
            FROM jsonb_array_elements_text(expected.key_columns)
              WITH ORDINALITY AS expected_key(value, ordinality)
          )
      )
    ) AS ok
  `,
  params: [
    JSON.stringify(
      constraints.map((constraint) => ({
        constraint_name: constraint.name,
        table_name: constraint.table,
        constraint_type: constraint.type,
        key_columns: constraint.columns,
        validated: constraint.validated,
      })),
    ),
  ],
});

const runtimeRoleName = "vexortech_runtime";
const runtimeTablePrivileges = {
  audit_logs: ["SELECT"],
  categories: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  coupons: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  customer_addresses: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  customer_favorites: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  customers: ["SELECT", "INSERT", "UPDATE"],
  delivery_drivers: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  delivery_zones: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  financial_movements: ["SELECT", "INSERT", "UPDATE"],
  notification_events: ["SELECT", "INSERT", "UPDATE"],
  order_item_options: ["SELECT", "INSERT"],
  order_items: ["SELECT", "INSERT"],
  order_status_history: ["SELECT", "INSERT"],
  orders: ["SELECT", "INSERT", "UPDATE"],
  payment_events: ["SELECT", "INSERT", "UPDATE"],
  payments: ["SELECT", "INSERT", "UPDATE"],
  plans: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  product_option_items: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  product_options: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  products: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  profiles: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  schema_migrations: ["SELECT"],
  store_reviews: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  store_settings: ["SELECT", "INSERT", "UPDATE"],
  stores: ["SELECT", "INSERT", "UPDATE"],
  subscriptions: ["SELECT", "INSERT", "UPDATE"],
  user_roles: ["SELECT", "INSERT", "DELETE"],
};
const runtimeTablePrivilegeRows = Object.entries(runtimeTablePrivileges).flatMap(
  ([tableName, privileges]) =>
    privileges.map((privilegeName) => ({
      table_name: tableName,
      privilege_name: privilegeName,
    })),
);
const runtimeTableNames = Object.keys(runtimeTablePrivileges);
const runtimeFunctionSignatures = [
  "public.is_vexor_admin(uuid)",
  "public.get_public_order_items(text)",
  "public.get_public_order_status_history(text)",
  "public.get_store_rating(uuid)",
];
const runtimeRlsTables = [
  "audit_logs",
  "customer_addresses",
  "customer_favorites",
  "delivery_drivers",
  "financial_movements",
];

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
    params: [
      [
        "delivery_reference",
        "distance_km",
        "delivery_source",
        "accepted_at",
        "ready_at",
        "cancelled_at",
      ],
    ],
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
    params: [
      [
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
      ],
    ],
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
    params: [
      [
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
      ],
    ],
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
    params: [
      [
        "cancel_reason",
        "delivery_city",
        "delivery_neighborhood",
        "delivery_state",
        "delivery_zip_code",
        "estimated_delivery_at",
        "estimated_ready_at",
        "refused_reason",
        "scheduled_at",
      ],
    ],
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
    params: [
      ["id", "store_id", "name", "phone", "vehicle_type", "is_active", "created_at", "updated_at"],
    ],
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
    params: [
      [
        "id",
        "actor_user_id",
        "store_id",
        "action",
        "entity_type",
        "entity_id",
        "metadata",
        "created_at",
      ],
    ],
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
    params: [
      [
        "id",
        "store_id",
        "user_id",
        "order_id",
        "rating",
        "comment",
        "is_visible",
        "created_at",
        "updated_at",
      ],
    ],
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
    params: [
      [
        "slug",
        "features",
        "max_products",
        "max_orders_per_month",
        "sort_order",
        "allows_custom_branding",
      ],
    ],
  },
  {
    label: "Supabase Auth signup is customer-only and metadata cannot grant roles",
    sql: `
      WITH auth_handler AS (
        SELECT
          function_state.oid,
          function_state.prosrc,
          function_state.prosecdef,
          function_state.provolatile,
          function_state.proconfig
        FROM pg_catalog.pg_proc AS function_state
        JOIN pg_catalog.pg_namespace AS function_schema
          ON function_schema.oid = function_state.pronamespace
        WHERE function_schema.nspname = 'public'
          AND function_state.oid = to_regprocedure('public.handle_auth_user_created()')
      ),
      role_normalizer AS (
        SELECT
          function_state.oid,
          function_state.prosrc,
          function_state.prosecdef,
          function_state.provolatile,
          function_state.proconfig
        FROM pg_catalog.pg_proc AS function_state
        JOIN pg_catalog.pg_namespace AS function_schema
          ON function_schema.oid = function_state.pronamespace
        WHERE function_schema.nspname = 'public'
          AND function_state.oid = to_regprocedure('public.normalize_signup_role(jsonb)')
      )
      SELECT
        to_regclass('auth.users') IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM auth_handler
          WHERE auth_handler.prosecdef IS TRUE
            AND auth_handler.provolatile = 'v'
            AND (
              SELECT
                count(*) = 1
                AND bool_and(
                  setting.value = ANY(
                    ARRAY['search_path=', 'search_path=""']::text[]
                  )
                )
              FROM unnest(COALESCE(auth_handler.proconfig, ARRAY[]::text[]))
                AS setting(value)
              WHERE setting.value LIKE 'search_path=%'
            )
            -- raw_user_meta_data may supply profile fields, but never an
            -- authorization key. Check the stored function body without
            -- selecting it, so the gate cannot print application data.
            AND (
              length(lower(auth_handler.prosrc))
              - length(
                replace(
                  lower(auth_handler.prosrc),
                  'raw_user_meta_data',
                  ''
                )
              )
            ) / length('raw_user_meta_data') = 2
            AND auth_handler.prosrc !~* $unsafe_metadata$(?n)raw_user_meta_data[[:space:]]*(->>|->|#>>|#>|[[])[^,;)]*(role|account_type|user_type|is_admin|permissions?)$unsafe_metadata$
            AND regexp_replace(
              auth_handler.prosrc,
              '[[:space:]"]',
              '',
              'g'
            ) LIKE '%NULLIF(NEW.raw_user_meta_data->>''full_name'','''')%'
            AND regexp_replace(
              auth_handler.prosrc,
              '[[:space:]"]',
              '',
              'g'
            ) LIKE '%NULLIF(NEW.raw_user_meta_data->>''document'',''''),''customer'',now(),now()%'
            AND regexp_replace(
              auth_handler.prosrc,
              '[[:space:]"]',
              '',
              'g'
            ) LIKE '%role=COALESCE(NULLIF(public.profiles.role,''''),EXCLUDED.role)%'
            AND regexp_replace(
              auth_handler.prosrc,
              '[[:space:]"]',
              '',
              'g'
            ) LIKE '%INSERTINTOpublic.user_roles(user_id,role)VALUES(NEW.id,''customer'')ONCONFLICTDONOTHING%'
        )
        AND EXISTS (
          SELECT 1
          FROM role_normalizer
          WHERE role_normalizer.prosecdef IS FALSE
            AND role_normalizer.provolatile = 'i'
            AND regexp_replace(
              role_normalizer.prosrc,
              '[[:space:];]',
              '',
              'g'
            ) = 'SELECT''customer''::text'
            AND (
              SELECT
                count(*) = 1
                AND bool_and(
                  setting.value = ANY(
                    ARRAY['search_path=', 'search_path=""']::text[]
                  )
                )
              FROM unnest(COALESCE(role_normalizer.proconfig, ARRAY[]::text[]))
                AS setting(value)
              WHERE setting.value LIKE 'search_path=%'
            )
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_trigger AS trigger_state
          CROSS JOIN auth_handler
          WHERE trigger_state.tgname = 'on_auth_user_created'
            AND trigger_state.tgrelid = to_regclass('auth.users')
            AND trigger_state.tgfoid = auth_handler.oid
            AND trigger_state.tgtype = 5
            AND trigger_state.tgenabled = 'O'
            AND trigger_state.tgisinternal IS FALSE
            AND trigger_state.tgqual IS NULL
        ) AS ok
    `,
  },
  {
    label: "user role uniqueness",
    sql: "SELECT to_regclass('public.user_roles_user_role_store_unique') IS NOT NULL AS ok",
  },
  {
    label: "critical schema migration history",
    sql: `
      SELECT NOT EXISTS (
        SELECT 1
        FROM (
          VALUES
            ('20260624090000', '20260624090000_cursor_pagination_indexes.sql'),
            ('20260624100000', '20260624100000_asaas_central_escrow.sql'),
            ('20260624110000', '20260624110000_checkout_integrity.sql'),
            ('20260713142207', '20260713142207_reconcile_financial_schema.sql'),
            ('20260713153000', '20260713153000_provision_vexortech_runtime.sql'),
            ('20260714124758', '20260714124758_reject_untrusted_signup_roles.sql'),
            ('20260714131354', '20260714131354_private_order_realtime_broadcast.sql'),
            (
              '20260714143000',
              '20260714143000_store_settings_operational_constraints.sql'
            ),
            (
              '20260714144500',
              '20260714144500_delivery_zones_operational_constraints.sql'
            )
        ) AS expected(version, name)
        WHERE NOT EXISTS (
          SELECT 1
          FROM public.schema_migrations applied
          WHERE applied.version = expected.version
            AND applied.name = expected.name
        )
      ) AS ok
    `,
  },
  {
    label: "ephemeral order Realtime ticket table has the exact private RLS contract",
    sql: `
      WITH private_table AS (
        SELECT
          table_relation.oid,
          table_relation.relrowsecurity,
          table_relation.relkind
        FROM pg_catalog.pg_class AS table_relation
        JOIN pg_catalog.pg_namespace AS table_schema
          ON table_schema.oid = table_relation.relnamespace
        WHERE table_schema.nspname = 'hype_private'
          AND table_relation.relname = 'order_realtime_tickets'
      ),
      expected_columns(column_name, data_type, not_null, default_expression) AS (
        VALUES
          ('ticket_id'::name, 'uuid'::text, true, 'gen_random_uuid()'::text),
          ('store_id'::name, 'uuid'::text, true, NULL::text),
          ('actor_user_id'::name, 'uuid'::text, true, NULL::text),
          ('created_at'::name, 'timestamp with time zone'::text, true, 'statement_timestamp()'::text),
          ('expires_at'::name, 'timestamp with time zone'::text, true, NULL::text)
      )
      SELECT
        to_regnamespace('hype_private') IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM private_table
          WHERE private_table.relkind IN ('r', 'p')
            AND private_table.relrowsecurity IS TRUE
            AND (
              SELECT count(*) = 5
              FROM pg_catalog.pg_attribute AS actual_column
              WHERE actual_column.attrelid = private_table.oid
                AND actual_column.attnum > 0
                AND actual_column.attisdropped IS FALSE
            )
            AND NOT EXISTS (
              SELECT 1
              FROM expected_columns AS expected_column
              WHERE NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_attribute AS actual_column
                LEFT JOIN pg_catalog.pg_attrdef AS column_default
                  ON column_default.adrelid = actual_column.attrelid
                 AND column_default.adnum = actual_column.attnum
                WHERE actual_column.attrelid = private_table.oid
                  AND actual_column.attname = expected_column.column_name
                  AND actual_column.attnum > 0
                  AND actual_column.attisdropped IS FALSE
                  AND pg_catalog.format_type(
                    actual_column.atttypid,
                    actual_column.atttypmod
                  ) = expected_column.data_type
                  AND actual_column.attnotnull = expected_column.not_null
                  AND (
                    (
                      expected_column.default_expression IS NULL
                      AND column_default.oid IS NULL
                    )
                    OR (
                      expected_column.default_expression IS NOT NULL
                      AND column_default.oid IS NOT NULL
                      AND ${normalizedCatalogSql(
                        "pg_catalog.pg_get_expr(column_default.adbin, column_default.adrelid, true)",
                      )} = ${normalizedCatalogSql("expected_column.default_expression")}
                    )
                  )
              )
            )
        ) AS ok
    `,
  },
  {
    label: "ephemeral order Realtime ticket constraints and indexes are exact",
    sql: `
      WITH private_table AS (
        SELECT table_relation.oid
        FROM pg_catalog.pg_class AS table_relation
        JOIN pg_catalog.pg_namespace AS table_schema
          ON table_schema.oid = table_relation.relnamespace
        WHERE table_schema.nspname = 'hype_private'
          AND table_relation.relname = 'order_realtime_tickets'
          AND table_relation.relkind IN ('r', 'p')
      ),
      expected_foreign_keys(
        constraint_name,
        key_column,
        referenced_schema,
        referenced_table,
        referenced_column
      ) AS (
        VALUES
          (
            'order_realtime_tickets_store_id_fkey'::name,
            'store_id'::name,
            'public'::name,
            'stores'::name,
            'id'::name
          ),
          (
            'order_realtime_tickets_actor_user_id_fkey'::name,
            'actor_user_id'::name,
            'auth'::name,
            'users'::name,
            'id'::name
          )
      ),
      expected_indexes(index_name, key_columns) AS (
        VALUES
          (
            'order_realtime_tickets_store_expiry_idx'::name,
            ARRAY['store_id', 'expires_at']::text[]
          ),
          (
            'order_realtime_tickets_expiry_idx'::name,
            ARRAY['expires_at']::text[]
          )
      )
      SELECT EXISTS (
        SELECT 1
        FROM private_table
        WHERE EXISTS (
          SELECT 1
          FROM pg_catalog.pg_constraint AS primary_key
          WHERE primary_key.conrelid = private_table.oid
            AND primary_key.conname = 'order_realtime_tickets_pkey'
            AND primary_key.contype = 'p'
            AND primary_key.convalidated IS TRUE
            AND (
              SELECT array_agg(key_column.attname::text ORDER BY key_state.ordinality)
              FROM unnest(primary_key.conkey)
                WITH ORDINALITY AS key_state(attnum, ordinality)
              JOIN pg_catalog.pg_attribute AS key_column
                ON key_column.attrelid = primary_key.conrelid
               AND key_column.attnum = key_state.attnum
            ) = ARRAY['ticket_id']::text[]
        )
        AND NOT EXISTS (
          SELECT 1
          FROM expected_foreign_keys AS expected_foreign_key
          WHERE NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_constraint AS foreign_key
            JOIN pg_catalog.pg_class AS referenced_table
              ON referenced_table.oid = foreign_key.confrelid
            JOIN pg_catalog.pg_namespace AS referenced_schema
              ON referenced_schema.oid = referenced_table.relnamespace
            WHERE foreign_key.conrelid = private_table.oid
              AND foreign_key.conname = expected_foreign_key.constraint_name
              AND foreign_key.contype = 'f'
              AND foreign_key.convalidated IS TRUE
              AND foreign_key.confdeltype = 'c'
              AND foreign_key.confupdtype = 'a'
              AND foreign_key.confmatchtype = 's'
              AND referenced_schema.nspname = expected_foreign_key.referenced_schema
              AND referenced_table.relname = expected_foreign_key.referenced_table
              AND (
                SELECT array_agg(key_column.attname::name ORDER BY key_state.ordinality)
                FROM unnest(foreign_key.conkey)
                  WITH ORDINALITY AS key_state(attnum, ordinality)
                JOIN pg_catalog.pg_attribute AS key_column
                  ON key_column.attrelid = foreign_key.conrelid
                 AND key_column.attnum = key_state.attnum
              ) = ARRAY[expected_foreign_key.key_column]::name[]
              AND (
                SELECT array_agg(key_column.attname::name ORDER BY key_state.ordinality)
                FROM unnest(foreign_key.confkey)
                  WITH ORDINALITY AS key_state(attnum, ordinality)
                JOIN pg_catalog.pg_attribute AS key_column
                  ON key_column.attrelid = foreign_key.confrelid
                 AND key_column.attnum = key_state.attnum
              ) = ARRAY[expected_foreign_key.referenced_column]::name[]
          )
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_constraint AS expiry_window
          WHERE expiry_window.conrelid = private_table.oid
            AND expiry_window.conname = 'order_realtime_tickets_expiry_window_chk'
            AND expiry_window.contype = 'c'
            AND expiry_window.convalidated IS TRUE
            AND regexp_replace(
              lower(
                pg_catalog.pg_get_expr(
                  expiry_window.conbin,
                  expiry_window.conrelid,
                  true
                )
              ),
              '[[:space:]()]',
              '',
              'g'
            ) = 'expires_at>created_atandexpires_at<=created_at+''00:15:00''::interval'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM expected_indexes AS expected_index
          WHERE NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_index AS index_state
            JOIN pg_catalog.pg_class AS index_relation
              ON index_relation.oid = index_state.indexrelid
            JOIN pg_catalog.pg_namespace AS index_schema
              ON index_schema.oid = index_relation.relnamespace
            JOIN pg_catalog.pg_am AS access_method
              ON access_method.oid = index_relation.relam
            WHERE index_state.indrelid = private_table.oid
              AND index_schema.nspname = 'hype_private'
              AND index_relation.relname = expected_index.index_name
              AND access_method.amname = 'btree'
              AND index_state.indisvalid IS TRUE
              AND index_state.indisready IS TRUE
              AND index_state.indislive IS TRUE
              AND index_state.indisunique IS FALSE
              AND index_state.indpred IS NULL
              AND index_state.indexprs IS NULL
              AND index_state.indnatts = index_state.indnkeyatts
              AND (
                SELECT array_agg(
                  pg_catalog.pg_get_indexdef(
                    index_state.indexrelid,
                    key_position,
                    true
                  )
                  ORDER BY key_position
                )
                FROM generate_series(1, index_state.indnkeyatts)
                  AS generated_key(key_position)
              ) = expected_index.key_columns
          )
        )
      ) AS ok
    `,
  },
  {
    label: "private order Realtime functions are hardened SECURITY DEFINER contracts",
    sql: `
      WITH expected_functions(
        function_signature,
        volatility,
        returns_set,
        result_type
      ) AS (
        VALUES
          (
            'hype_private.issue_order_realtime_ticket(uuid,uuid)'::text,
            'v'::"char",
            true,
            'TABLE(ticket_id uuid, expires_at timestamp with time zone)'::text
          ),
          (
            'hype_private.can_receive_store_order_topic(text)'::text,
            's'::"char",
            false,
            'boolean'::text
          ),
          (
            'hype_private.broadcast_store_order_invalidation()'::text,
            'v'::"char",
            false,
            'trigger'::text
          ),
          (
            'hype_private.revoke_store_order_realtime_tickets()'::text,
            'v'::"char",
            false,
            'trigger'::text
          )
      )
      SELECT NOT EXISTS (
        SELECT 1
        FROM expected_functions AS expected_function
        LEFT JOIN pg_catalog.pg_proc AS function_state
          ON function_state.oid = to_regprocedure(expected_function.function_signature)
        LEFT JOIN pg_catalog.pg_roles AS function_owner
          ON function_owner.oid = function_state.proowner
        WHERE function_state.oid IS NULL
          OR function_state.prokind <> 'f'
          OR function_state.prosecdef IS NOT TRUE
          OR function_state.proleakproof IS TRUE
          OR function_state.provolatile <> expected_function.volatility
          OR function_state.proretset <> expected_function.returns_set
          OR pg_catalog.pg_get_function_result(function_state.oid)
            <> expected_function.result_type
          OR function_owner.rolname = ANY(
            ARRAY[
              'anon',
              'authenticated',
              'authenticator',
              'service_role',
              'vexortech_runtime'
            ]::name[]
          )
          OR (
            SELECT NOT (
              count(*) = 1
              AND bool_and(
                setting.value = ANY(
                  ARRAY['search_path=', 'search_path=""']::text[]
                )
              )
            )
            FROM unnest(COALESCE(function_state.proconfig, ARRAY[]::text[]))
              AS setting(value)
            WHERE setting.value LIKE 'search_path=%'
          )
      ) AS ok
    `,
  },
  {
    label: "private order Realtime grants are minimal and tickets have no table grants",
    sql: `
      WITH private_schema AS (
        SELECT schema_state.oid, schema_state.nspowner, schema_state.nspacl
        FROM pg_catalog.pg_namespace AS schema_state
        WHERE schema_state.nspname = 'hype_private'
      ),
      private_table AS (
        SELECT
          table_relation.oid,
          table_relation.relowner,
          table_relation.relacl
        FROM pg_catalog.pg_class AS table_relation
        JOIN pg_catalog.pg_namespace AS table_schema
          ON table_schema.oid = table_relation.relnamespace
        WHERE table_schema.nspname = 'hype_private'
          AND table_relation.relname = 'order_realtime_tickets'
          AND table_relation.relkind IN ('r', 'p')
      ),
      expected_schema_grants(role_name) AS (
        VALUES
          ('vexortech_runtime'::name),
          ('anon'::name),
          ('authenticated'::name)
      ),
      expected_function_grants(function_signature, role_names) AS (
        VALUES
          (
            'hype_private.issue_order_realtime_ticket(uuid,uuid)'::text,
            ARRAY['vexortech_runtime']::name[]
          ),
          (
            'hype_private.can_receive_store_order_topic(text)'::text,
            ARRAY['anon', 'authenticated']::name[]
          ),
          (
            'hype_private.broadcast_store_order_invalidation()'::text,
            ARRAY[]::name[]
          ),
          (
            'hype_private.revoke_store_order_realtime_tickets()'::text,
            ARRAY[]::name[]
          )
      ),
      resolved_functions AS (
        SELECT
          expected_function.function_signature,
          expected_function.role_names,
          function_state.oid,
          function_state.proowner,
          function_state.proacl
        FROM expected_function_grants AS expected_function
        LEFT JOIN pg_catalog.pg_proc AS function_state
          ON function_state.oid = to_regprocedure(expected_function.function_signature)
      )
      SELECT
        EXISTS (SELECT 1 FROM private_schema)
        AND EXISTS (SELECT 1 FROM private_table)
        AND NOT EXISTS (
          SELECT 1
          FROM expected_schema_grants AS expected_grant
          WHERE NOT EXISTS (
            SELECT 1
            FROM private_schema
            CROSS JOIN pg_catalog.pg_roles AS granted_role
            CROSS JOIN LATERAL aclexplode(
              COALESCE(
                private_schema.nspacl,
                acldefault('n', private_schema.nspowner)
              )
            ) AS schema_acl
            WHERE granted_role.rolname = expected_grant.role_name
              AND schema_acl.grantee = granted_role.oid
              AND schema_acl.privilege_type = 'USAGE'
              AND schema_acl.is_grantable IS FALSE
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM private_schema
          CROSS JOIN LATERAL aclexplode(
            COALESCE(
              private_schema.nspacl,
              acldefault('n', private_schema.nspowner)
            )
          ) AS schema_acl
          LEFT JOIN pg_catalog.pg_roles AS granted_role
            ON granted_role.oid = schema_acl.grantee
          WHERE schema_acl.grantee <> private_schema.nspowner
            AND NOT (
              schema_acl.privilege_type = 'USAGE'
              AND schema_acl.is_grantable IS FALSE
              AND COALESCE(
                granted_role.rolname = ANY(
                  ARRAY['vexortech_runtime', 'anon', 'authenticated']::name[]
                ),
                false
              )
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM private_table
          CROSS JOIN LATERAL aclexplode(
            COALESCE(
              private_table.relacl,
              acldefault('r', private_table.relowner)
            )
          ) AS table_acl
          WHERE table_acl.grantee <> private_table.relowner
        )
        AND NOT EXISTS (
          SELECT 1
          FROM private_table
          JOIN pg_catalog.pg_attribute AS column_state
            ON column_state.attrelid = private_table.oid
           AND column_state.attnum > 0
           AND column_state.attisdropped IS FALSE
          CROSS JOIN LATERAL aclexplode(column_state.attacl) AS column_acl
          WHERE column_acl.grantee <> private_table.relowner
        )
        AND NOT EXISTS (
          SELECT 1
          FROM private_table
          CROSS JOIN pg_catalog.pg_roles AS checked_role
          WHERE checked_role.rolname = ANY(
              ARRAY['vexortech_runtime', 'anon', 'authenticated']::name[]
            )
            AND (
              pg_catalog.has_table_privilege(
                checked_role.oid,
                private_table.oid,
                'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
              )
              OR pg_catalog.has_any_column_privilege(
                checked_role.oid,
                private_table.oid,
                'SELECT,INSERT,UPDATE,REFERENCES'
              )
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM resolved_functions AS resolved_function
          WHERE resolved_function.oid IS NULL
            OR EXISTS (
              SELECT 1
              FROM unnest(resolved_function.role_names) AS expected_role(role_name)
              WHERE NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_roles AS granted_role
                CROSS JOIN LATERAL aclexplode(
                  COALESCE(
                    resolved_function.proacl,
                    acldefault('f', resolved_function.proowner)
                  )
                ) AS function_acl
                WHERE granted_role.rolname = expected_role.role_name
                  AND function_acl.grantee = granted_role.oid
                  AND function_acl.privilege_type = 'EXECUTE'
                  AND function_acl.is_grantable IS FALSE
              )
            )
            OR EXISTS (
              SELECT 1
              FROM aclexplode(
                COALESCE(
                  resolved_function.proacl,
                  acldefault('f', resolved_function.proowner)
                )
              ) AS function_acl
              LEFT JOIN pg_catalog.pg_roles AS granted_role
                ON granted_role.oid = function_acl.grantee
              WHERE function_acl.grantee <> resolved_function.proowner
                AND NOT (
                  function_acl.privilege_type = 'EXECUTE'
                  AND function_acl.is_grantable IS FALSE
                  AND COALESCE(
                    granted_role.rolname = ANY(resolved_function.role_names),
                    false
                  )
                )
            )
        ) AS ok
    `,
  },
  {
    label: "private order Realtime triggers match orders and store lifecycle events",
    sql: `
      WITH expected_triggers(
        trigger_name,
        table_schema,
        table_name,
        function_signature,
        trigger_type,
        update_columns
      ) AS (
        VALUES
          (
            'orders_private_broadcast_invalidation'::name,
            'public'::name,
            'orders'::name,
            'hype_private.broadcast_store_order_invalidation()'::text,
            29::smallint,
            ARRAY[]::name[]
          ),
          (
            'stores_revoke_order_realtime_tickets'::name,
            'public'::name,
            'stores'::name,
            'hype_private.revoke_store_order_realtime_tickets()'::text,
            17::smallint,
            ARRAY['is_active', 'is_suspended', 'owner_user_id']::name[]
          )
      )
      SELECT NOT EXISTS (
        SELECT 1
        FROM expected_triggers AS expected_trigger
        WHERE NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_trigger AS trigger_state
          JOIN pg_catalog.pg_class AS target_table
            ON target_table.oid = trigger_state.tgrelid
          JOIN pg_catalog.pg_namespace AS target_schema
            ON target_schema.oid = target_table.relnamespace
          WHERE trigger_state.tgname = expected_trigger.trigger_name
            AND target_schema.nspname = expected_trigger.table_schema
            AND target_table.relname = expected_trigger.table_name
            AND trigger_state.tgfoid = to_regprocedure(expected_trigger.function_signature)
            AND trigger_state.tgtype = expected_trigger.trigger_type
            AND trigger_state.tgenabled = 'O'
            AND trigger_state.tgisinternal IS FALSE
            AND trigger_state.tgqual IS NULL
            AND COALESCE(
              (
                SELECT array_agg(
                  update_column.attname::name
                  ORDER BY update_column_state.ordinality
                )
                FROM unnest(trigger_state.tgattr)
                  WITH ORDINALITY AS update_column_state(attnum, ordinality)
                JOIN pg_catalog.pg_attribute AS update_column
                  ON update_column.attrelid = trigger_state.tgrelid
                 AND update_column.attnum = update_column_state.attnum
              ),
              ARRAY[]::name[]
            ) = expected_trigger.update_columns
        )
      ) AS ok
    `,
  },
  {
    label: "private order Realtime has exactly three correctly scoped RLS policies",
    sql: `
      WITH realtime_messages AS (
        SELECT table_relation.oid, table_relation.relrowsecurity
        FROM pg_catalog.pg_class AS table_relation
        JOIN pg_catalog.pg_namespace AS table_schema
          ON table_schema.oid = table_relation.relnamespace
        WHERE table_schema.nspname = 'realtime'
          AND table_relation.relname = 'messages'
          AND table_relation.relkind IN ('r', 'p')
      ),
      expected_policies(
        policy_name,
        permissive,
        command,
        expects_qual,
        expects_with_check
      ) AS (
        VALUES
          (
            'hype_store_order_broadcast_receive'::name,
            true,
            'r'::"char",
            true,
            false
          ),
          (
            'hype_store_order_broadcast_ticket_guard'::name,
            false,
            'r'::"char",
            true,
            false
          ),
          (
            'hype_store_order_broadcast_database_only'::name,
            false,
            'a'::"char",
            false,
            true
          )
      ),
      checked_policies AS (
        SELECT
          expected_policy.*,
          policy_state.polqual,
          policy_state.polwithcheck,
          policy_state.polrelid,
          policy_state.polroles
        FROM expected_policies AS expected_policy
        LEFT JOIN realtime_messages
          ON true
        LEFT JOIN pg_catalog.pg_policy AS policy_state
          ON policy_state.polrelid = realtime_messages.oid
         AND policy_state.polname = expected_policy.policy_name
         AND policy_state.polpermissive = expected_policy.permissive
         AND policy_state.polcmd = expected_policy.command
      )
      SELECT
        EXISTS (
          SELECT 1
          FROM realtime_messages
          WHERE realtime_messages.relrowsecurity IS TRUE
        )
        AND (
          SELECT count(*) = 3
          FROM pg_catalog.pg_policy AS policy_state
          JOIN realtime_messages
            ON realtime_messages.oid = policy_state.polrelid
          WHERE left(
            policy_state.polname,
            length('hype_store_order_broadcast_')
          ) = 'hype_store_order_broadcast_'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM checked_policies AS checked_policy
          WHERE checked_policy.polrelid IS NULL
            OR cardinality(checked_policy.polroles) <> 2
            OR NOT COALESCE(
              (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon')
                = ANY(checked_policy.polroles),
              false
            )
            OR NOT COALESCE(
              (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
                = ANY(checked_policy.polroles),
              false
            )
            OR (checked_policy.polqual IS NOT NULL) <> checked_policy.expects_qual
            OR (checked_policy.polwithcheck IS NOT NULL)
              <> checked_policy.expects_with_check
            OR (
              checked_policy.policy_name IN (
                'hype_store_order_broadcast_receive',
                'hype_store_order_broadcast_ticket_guard'
              )
              AND pg_catalog.pg_get_expr(
                checked_policy.polqual,
                checked_policy.polrelid,
                true
              ) !~ 'hype_private[.]can_receive_store_order_topic'
            )
            OR (
              checked_policy.policy_name = 'hype_store_order_broadcast_receive'
              AND pg_catalog.pg_get_expr(
                checked_policy.polqual,
                checked_policy.polrelid,
                true
              ) !~ 'extension[[:space:]]*=[[:space:]]*''broadcast'''
            )
            OR (
              checked_policy.policy_name = 'hype_store_order_broadcast_ticket_guard'
              AND (
                pg_catalog.pg_get_expr(
                  checked_policy.polqual,
                  checked_policy.polrelid,
                  true
                ) !~ 'realtime[.]topic'
                OR pg_catalog.pg_get_expr(
                  checked_policy.polqual,
                  checked_policy.polrelid,
                  true
                ) !~ 'extension[[:space:]]*=[[:space:]]*''broadcast'''
                OR pg_catalog.pg_get_expr(
                  checked_policy.polqual,
                  checked_policy.polrelid,
                  true
                ) !~ '[[:space:]]OR[[:space:]]'
                OR pg_catalog.pg_get_expr(
                  checked_policy.polqual,
                  checked_policy.polrelid,
                  true
                ) !~ '[[:space:]]AND[[:space:]]'
                OR position(
                  '!~'
                  IN pg_catalog.pg_get_expr(
                    checked_policy.polqual,
                    checked_policy.polrelid,
                    true
                  )
                ) = 0
                OR position(
                  '''^hype:store-orders:'''
                  IN pg_catalog.pg_get_expr(
                    checked_policy.polqual,
                    checked_policy.polrelid,
                    true
                  )
                ) = 0
              )
            )
            OR (
              checked_policy.policy_name = 'hype_store_order_broadcast_database_only'
              AND (
                pg_catalog.pg_get_expr(
                  checked_policy.polwithcheck,
                  checked_policy.polrelid,
                  true
                ) !~ 'realtime[.]topic'
                OR pg_catalog.pg_get_expr(
                  checked_policy.polwithcheck,
                  checked_policy.polrelid,
                  true
                ) ~ 'extension'
                OR pg_catalog.pg_get_expr(
                  checked_policy.polwithcheck,
                  checked_policy.polrelid,
                  true
                ) ~ '[[:space:]](OR|AND)[[:space:]]'
                OR position(
                  '!~'
                  IN pg_catalog.pg_get_expr(
                    checked_policy.polwithcheck,
                    checked_policy.polrelid,
                    true
                  )
                ) = 0
                OR position(
                  '''^hype:store-orders:'''
                  IN pg_catalog.pg_get_expr(
                    checked_policy.polwithcheck,
                    checked_policy.polrelid,
                    true
                  )
                ) = 0
              )
            )
        ) AS ok
    `,
  },
  {
    label: "dedicated runtime role has least-privilege attributes and no ownership",
    sql: `
      SELECT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_roles AS role_state
        WHERE role_state.rolname = $1::name
          AND role_state.rolcanlogin
          AND NOT role_state.rolinherit
          AND NOT role_state.rolsuper
          AND NOT role_state.rolcreatedb
          AND NOT role_state.rolcreaterole
          AND NOT role_state.rolreplication
          AND NOT role_state.rolbypassrls
          AND role_state.rolconnlimit = 30
          AND COALESCE(
            (
              SELECT
                role_setting.setconfig @> ARRAY[
                  'search_path=pg_catalog, public',
                  'statement_timeout=30s',
                  'idle_in_transaction_session_timeout=15s'
                ]::text[]
                AND pg_catalog.cardinality(role_setting.setconfig) = 3
              FROM pg_catalog.pg_db_role_setting AS role_setting
              WHERE role_setting.setrole = role_state.oid
                AND role_setting.setdatabase = 0
            ),
            false
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_db_role_setting AS database_role_setting
            JOIN pg_catalog.pg_database AS configured_database
              ON configured_database.oid = database_role_setting.setdatabase
            WHERE database_role_setting.setrole = role_state.oid
              AND configured_database.datname = current_database()
          )
          AND pg_catalog.has_database_privilege(
            role_state.rolname,
            current_database(),
            'CONNECT'
          )
          AND NOT pg_catalog.has_database_privilege(
            role_state.rolname,
            current_database(),
            'CONNECT WITH GRANT OPTION'
          )
          AND NOT pg_catalog.has_database_privilege(
            role_state.rolname,
            current_database(),
            'CREATE'
          )
          AND pg_catalog.has_schema_privilege(
            role_state.rolname,
            'public',
            'USAGE'
          )
          AND NOT pg_catalog.has_schema_privilege(
            role_state.rolname,
            'public',
            'USAGE WITH GRANT OPTION'
          )
          AND NOT pg_catalog.has_schema_privilege(
            role_state.rolname,
            'public',
            'CREATE'
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_auth_members AS membership
            WHERE membership.member = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_auth_members AS membership
            LEFT JOIN pg_catalog.pg_roles AS grantor_role
              ON grantor_role.oid = membership.grantor
            WHERE membership.roleid = role_state.oid
              AND NOT (
                membership.admin_option
                AND COALESCE(
                  (pg_catalog.to_jsonb(membership) ->> 'inherit_option')::boolean,
                  true
                ) IS FALSE
                AND COALESCE(
                  (pg_catalog.to_jsonb(membership) ->> 'set_option')::boolean,
                  true
                ) IS FALSE
                AND grantor_role.rolsuper IS TRUE
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_namespace AS managed_schema
            WHERE managed_schema.nspname IN ('auth', 'storage', 'realtime')
              AND (
                pg_catalog.has_schema_privilege(
                  role_state.rolname,
                  managed_schema.oid,
                  'USAGE'
                )
                OR pg_catalog.has_schema_privilege(
                  role_state.rolname,
                  managed_schema.oid,
                  'CREATE'
                )
              )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_shdepend AS ownership_dependency
            WHERE ownership_dependency.refclassid = 'pg_catalog.pg_authid'::regclass
              AND ownership_dependency.refobjid = role_state.oid
              AND ownership_dependency.deptype = 'o'
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_database WHERE datdba = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_class WHERE relowner = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc WHERE proowner = role_state.oid
          )
          AND NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_type WHERE typowner = role_state.oid
          )
      ) AS ok
    `,
    params: [runtimeRoleName],
  },
  {
    label: "dedicated runtime role has the exact table privilege matrix",
    sql: `
      WITH expected AS (
        SELECT *
        FROM pg_catalog.jsonb_to_recordset($1::jsonb) AS privilege_contract(
          table_name name,
          privilege_name text
        )
      ),
      runtime_tables(table_name) AS (
        SELECT pg_catalog.unnest($2::name[])
      ),
      resolved_runtime_tables AS (
        SELECT
          runtime_table.table_name,
          target_table.oid AS table_oid
        FROM runtime_tables AS runtime_table
        LEFT JOIN pg_catalog.pg_namespace AS target_schema
          ON target_schema.nspname = 'public'
        LEFT JOIN pg_catalog.pg_class AS target_table
          ON target_table.relnamespace = target_schema.oid
          AND target_table.relname = runtime_table.table_name
          AND target_table.relkind IN ('r', 'p')
      ),
      all_public_tables AS (
        SELECT table_relation.oid, table_relation.relname
        FROM pg_catalog.pg_class AS table_relation
        JOIN pg_catalog.pg_namespace AS table_schema
          ON table_schema.oid = table_relation.relnamespace
        WHERE table_schema.nspname = 'public'
          AND table_relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      ),
      table_privileges(privilege_name) AS (
        VALUES
          ('SELECT'::text),
          ('INSERT'::text),
          ('UPDATE'::text),
          ('DELETE'::text),
          ('TRUNCATE'::text),
          ('REFERENCES'::text),
          ('TRIGGER'::text)
      ),
      column_privileges(privilege_name) AS (
        VALUES
          ('SELECT'::text),
          ('INSERT'::text),
          ('UPDATE'::text),
          ('REFERENCES'::text)
      )
      SELECT
        NOT EXISTS (
          SELECT 1
          FROM expected
          LEFT JOIN resolved_runtime_tables AS runtime_table
            ON runtime_table.table_name = expected.table_name
          WHERE runtime_table.table_oid IS NULL
            OR NOT pg_catalog.has_table_privilege(
              $3::name,
              runtime_table.table_oid,
              expected.privilege_name
            )
            OR pg_catalog.has_table_privilege(
              $3::name,
              runtime_table.table_oid,
              expected.privilege_name || ' WITH GRANT OPTION'
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM all_public_tables AS target_table
          CROSS JOIN table_privileges AS checked_privilege
          WHERE pg_catalog.has_table_privilege(
              $3::name,
              target_table.oid,
              checked_privilege.privilege_name
            )
            AND NOT EXISTS (
              SELECT 1
              FROM expected
              WHERE expected.table_name = target_table.relname
                AND expected.privilege_name = checked_privilege.privilege_name
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM all_public_tables AS target_table
          CROSS JOIN column_privileges AS checked_privilege
          WHERE pg_catalog.has_any_column_privilege(
              $3::name,
              target_table.oid,
              checked_privilege.privilege_name
            )
            AND NOT EXISTS (
              SELECT 1
              FROM expected
              WHERE expected.table_name = target_table.relname
                AND expected.privilege_name = checked_privilege.privilege_name
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM all_public_tables AS target_table
          CROSS JOIN column_privileges AS checked_privilege
          WHERE pg_catalog.has_any_column_privilege(
            $3::name,
            target_table.oid,
            checked_privilege.privilege_name || ' WITH GRANT OPTION'
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM all_public_tables AS target_table
          WHERE CASE
            WHEN current_setting('server_version_num')::integer >= 170000
              THEN pg_catalog.has_table_privilege(
                $3::name,
                target_table.oid,
                'MAINTAIN'
              )
            ELSE false
          END
        ) AS ok
    `,
    params: [JSON.stringify(runtimeTablePrivilegeRows), runtimeTableNames, runtimeRoleName],
  },
  {
    label: "dedicated runtime role has only orders sequence usage",
    sql: `
      SELECT
        pg_catalog.to_regclass('public.orders_order_number_seq') IS NOT NULL
        AND pg_catalog.has_sequence_privilege(
          $1::name,
          'public.orders_order_number_seq',
          'USAGE'
        )
        AND NOT pg_catalog.has_sequence_privilege(
          $1::name,
          'public.orders_order_number_seq',
          'SELECT'
        )
        AND NOT pg_catalog.has_sequence_privilege(
          $1::name,
          'public.orders_order_number_seq',
          'UPDATE'
        )
        AND NOT pg_catalog.has_sequence_privilege(
          $1::name,
          'public.orders_order_number_seq',
          'USAGE WITH GRANT OPTION'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS sequence_state
          JOIN pg_catalog.pg_namespace AS sequence_schema
            ON sequence_schema.oid = sequence_state.relnamespace
          CROSS JOIN (
            VALUES ('USAGE'::text), ('SELECT'::text), ('UPDATE'::text)
          ) AS checked_privilege(privilege_name)
          WHERE sequence_schema.nspname = 'public'
            AND sequence_state.relkind = 'S'
            AND pg_catalog.has_sequence_privilege(
              $1::name,
              sequence_state.oid,
              checked_privilege.privilege_name
            )
            AND NOT (
              sequence_state.relname = 'orders_order_number_seq'
              AND checked_privilege.privilege_name = 'USAGE'
            )
        ) AS ok
    `,
    params: [runtimeRoleName],
  },
  {
    label: "dedicated runtime role has only required RPC execution",
    sql: `
      WITH expected(function_signature) AS (
        SELECT pg_catalog.unnest($1::text[])
      ),
      resolved_expected AS (
        SELECT
          expected.function_signature,
          pg_catalog.to_regprocedure(expected.function_signature) AS function_oid
        FROM expected
      )
      SELECT
        NOT EXISTS (
          SELECT 1
          FROM resolved_expected
          WHERE function_oid IS NULL
            OR NOT pg_catalog.has_function_privilege(
              $2::name,
              function_oid,
              'EXECUTE'
            )
            OR pg_catalog.has_function_privilege(
              $2::name,
              function_oid,
              'EXECUTE WITH GRANT OPTION'
            )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_proc AS function_state
          JOIN pg_catalog.pg_namespace AS function_schema
            ON function_schema.oid = function_state.pronamespace
          WHERE function_schema.nspname = 'public'
            AND pg_catalog.has_function_privilege(
              $2::name,
              function_state.oid,
              'EXECUTE'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM resolved_expected
              WHERE resolved_expected.function_oid = function_state.oid
            )
        ) AS ok
    `,
    params: [runtimeFunctionSignatures, runtimeRoleName],
  },
  {
    label: "dedicated runtime role has applicable RLS policies",
    sql: `
      WITH runtime_role AS (
        SELECT oid
        FROM pg_catalog.pg_roles
        WHERE rolname = $2::name
      ),
      runtime_tables(table_name) AS (
        SELECT pg_catalog.unnest($1::name[])
      ),
      required_rls_tables(table_name) AS (
        SELECT pg_catalog.unnest($3::name[])
      ),
      resolved_runtime_tables AS (
        SELECT
          runtime_table.table_name,
          target_table.oid AS table_oid,
          target_table.relrowsecurity
        FROM runtime_tables AS runtime_table
        LEFT JOIN pg_catalog.pg_namespace AS target_schema
          ON target_schema.nspname = 'public'
        LEFT JOIN pg_catalog.pg_class AS target_table
          ON target_table.relnamespace = target_schema.oid
          AND target_table.relname = runtime_table.table_name
          AND target_table.relkind IN ('r', 'p')
      )
      SELECT
        EXISTS (SELECT 1 FROM runtime_role)
        AND NOT EXISTS (
          SELECT 1
          FROM resolved_runtime_tables AS runtime_table
          WHERE runtime_table.table_oid IS NULL
            OR (
              EXISTS (
                SELECT 1
                FROM required_rls_tables AS required_rls
                WHERE required_rls.table_name = runtime_table.table_name
              )
              AND runtime_table.relrowsecurity IS NOT TRUE
            )
            OR (
              runtime_table.relrowsecurity
              AND NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_policy AS runtime_policy
                WHERE runtime_policy.polrelid = runtime_table.table_oid
                  AND runtime_policy.polcmd = '*'
                  AND runtime_policy.polpermissive IS TRUE
                  AND runtime_policy.polqual IS NOT NULL
                  AND runtime_policy.polwithcheck IS NOT NULL
                  AND (
                    (
                      runtime_table.table_name = 'financial_movements'
                      AND runtime_policy.polname = 'financial_movements_server_access'
                      AND runtime_policy.polroles = ARRAY[0::oid]
                      AND pg_catalog.replace(
                        pg_catalog.replace(
                          pg_catalog.regexp_replace(
                            pg_catalog.lower(
                              pg_catalog.pg_get_expr(
                                runtime_policy.polqual,
                                runtime_policy.polrelid
                              )
                            ),
                            '[[:space:]()"]',
                            '',
                            'g'
                          ),
                          '::name[]',
                          ''
                        ),
                        '::name',
                        ''
                      ) IN (
                        'current_user<>allarray[''anon'',''authenticated'',''authenticator'',''service_role'']',
                        'current_user<>all''{anon,authenticated,authenticator,service_role}'''
                      )
                      AND pg_catalog.replace(
                        pg_catalog.replace(
                          pg_catalog.regexp_replace(
                            pg_catalog.lower(
                              pg_catalog.pg_get_expr(
                                runtime_policy.polwithcheck,
                                runtime_policy.polrelid
                              )
                            ),
                            '[[:space:]()"]',
                            '',
                            'g'
                          ),
                          '::name[]',
                          ''
                        ),
                        '::name',
                        ''
                      ) IN (
                        'current_user<>allarray[''anon'',''authenticated'',''authenticator'',''service_role'']',
                        'current_user<>all''{anon,authenticated,authenticator,service_role}'''
                      )
                    )
                    OR (
                      runtime_table.table_name <> 'financial_movements'
                      AND runtime_policy.polname = 'vexortech_runtime_direct_access'
                      AND runtime_policy.polroles = ARRAY[
                        (SELECT oid FROM runtime_role)
                      ]::oid[]
                      AND pg_catalog.regexp_replace(
                        pg_catalog.lower(
                          pg_catalog.pg_get_expr(
                            runtime_policy.polqual,
                            runtime_policy.polrelid
                          )
                        ),
                        '[[:space:]()]',
                        '',
                        'g'
                      ) = 'true'
                      AND pg_catalog.regexp_replace(
                        pg_catalog.lower(
                          pg_catalog.pg_get_expr(
                            runtime_policy.polwithcheck,
                            runtime_policy.polrelid
                          )
                        ),
                        '[[:space:]()]',
                        '',
                        'g'
                      ) = 'true'
                    )
                  )
              )
              OR EXISTS (
                SELECT 1
                FROM pg_catalog.pg_policy AS restrictive_policy
                WHERE restrictive_policy.polrelid = runtime_table.table_oid
                  AND restrictive_policy.polpermissive IS FALSE
                  AND (
                    0::oid = ANY (restrictive_policy.polroles)
                    OR (SELECT oid FROM runtime_role)
                      = ANY (restrictive_policy.polroles)
                  )
              )
            )
        ) AS ok
    `,
    params: [runtimeTableNames, runtimeRoleName, runtimeRlsTables],
  },
  requiredColumnContractsCheck("20260624090000 exact store document columns", [
    { table: "stores", column: "document_file_path", type: "text" },
    { table: "stores", column: "selfie_file_path", type: "text" },
    { table: "stores", column: "document_number", type: "text" },
  ]),
  requiredIndexContractsCheck("20260624090000 exact cursor indexes", [
    {
      name: "idx_orders_store_cursor",
      table: "orders",
      keys: ["store_id", "created_at DESC", "id DESC"],
    },
    {
      name: "idx_orders_store_status_cursor",
      table: "orders",
      keys: ["store_id", "status", "created_at DESC", "id DESC"],
    },
    {
      name: "idx_products_store_cursor",
      table: "products",
      keys: ["store_id", "sort_order", "id"],
    },
    {
      name: "idx_products_store_category_cursor",
      table: "products",
      keys: ["store_id", "category_id", "sort_order", "id"],
    },
    {
      name: "idx_stores_cursor",
      table: "stores",
      keys: ["created_at DESC", "id DESC"],
    },
    {
      name: "idx_stores_active_cursor",
      table: "stores",
      keys: ["is_active", "is_suspended", "name"],
      predicate: "is_active = true AND is_suspended = false",
    },
  ]),
  requiredColumnContractsCheck("20260624100000 exact financial columns", [
    {
      table: "store_settings",
      column: "financeiro_ativo",
      type: "boolean",
      notNull: true,
      default: "false",
    },
    {
      table: "store_settings",
      column: "repasse_automatico",
      type: "boolean",
      notNull: true,
      default: "true",
    },
    {
      table: "store_settings",
      column: "repasse_momento",
      type: "text",
      notNull: true,
      default: "'APOS_ENTREGA'",
    },
    {
      table: "store_settings",
      column: "taxa_percentual_plataforma",
      type: "numeric(6,3)",
      notNull: true,
      default: "0",
    },
    {
      table: "store_settings",
      column: "taxa_fixa_plataforma",
      type: "numeric(12,2)",
      notNull: true,
      default: "0",
    },
    {
      table: "orders",
      column: "transfer_status",
      type: "text",
      notNull: true,
      default: "'NAO_LIBERADO'",
    },
    {
      table: "orders",
      column: "refund_status",
      type: "text",
      notNull: true,
      default: "'NAO_SOLICITADO'",
    },
    { table: "orders", column: "asaas_transfer_id", type: "text" },
    { table: "orders", column: "asaas_event_id_ultimo", type: "text" },
    { table: "orders", column: "platform_fee_amount", type: "numeric(12,2)" },
    { table: "orders", column: "transfer_amount", type: "numeric(12,2)" },
    {
      table: "orders",
      column: "refunded_amount",
      type: "numeric(12,2)",
      notNull: true,
      default: "0",
    },
    { table: "orders", column: "production_released_at", type: "timestamp with time zone" },
    { table: "orders", column: "transfer_released_at", type: "timestamp with time zone" },
    { table: "orders", column: "transfer_sent_at", type: "timestamp with time zone" },
    { table: "orders", column: "refunded_at", type: "timestamp with time zone" },
    {
      table: "financial_movements",
      column: "id",
      type: "uuid",
      notNull: true,
      default: "gen_random_uuid()",
    },
    { table: "financial_movements", column: "order_id", type: "uuid" },
    { table: "financial_movements", column: "store_id", type: "uuid" },
    { table: "financial_movements", column: "type", type: "text", notNull: true },
    { table: "financial_movements", column: "nature", type: "text", notNull: true },
    {
      table: "financial_movements",
      column: "amount",
      type: "numeric(12,2)",
      notNull: true,
    },
    {
      table: "financial_movements",
      column: "status",
      type: "text",
      notNull: true,
      default: "'PENDENTE'",
    },
    { table: "financial_movements", column: "description", type: "text" },
    { table: "financial_movements", column: "asaas_payment_id", type: "text" },
    { table: "financial_movements", column: "asaas_transfer_id", type: "text" },
    { table: "financial_movements", column: "asaas_refund_id", type: "text" },
    { table: "financial_movements", column: "asaas_event_id", type: "text" },
    { table: "financial_movements", column: "external_reference", type: "text" },
    {
      table: "financial_movements",
      column: "idempotency_key",
      type: "text",
      notNull: true,
    },
    { table: "financial_movements", column: "metadata_json", type: "jsonb" },
    {
      table: "financial_movements",
      column: "created_at",
      type: "timestamp with time zone",
      notNull: true,
      default: "now()",
    },
    { table: "financial_movements", column: "confirmed_at", type: "timestamp with time zone" },
    { table: "financial_movements", column: "failed_at", type: "timestamp with time zone" },
    { table: "financial_movements", column: "fail_reason", type: "text" },
    { table: "payment_events", column: "asaas_event_id", type: "text" },
    { table: "payment_events", column: "resource_type", type: "text" },
    {
      table: "payment_events",
      column: "processed",
      type: "boolean",
      notNull: true,
      default: "true",
    },
    { table: "payment_events", column: "processed_at", type: "timestamp with time zone" },
    { table: "payment_events", column: "processing_error", type: "text" },
  ]),
  requiredIndexContractsCheck("20260624100000 exact financial indexes", [
    {
      name: "idx_orders_transfer_status",
      table: "orders",
      keys: ["transfer_status"],
      predicate:
        "transfer_status = ANY (ARRAY['AGUARDANDO_ENTREGA','LIBERADO','PROCESSANDO','FALHOU'])",
    },
    { name: "idx_orders_asaas_transfer_id", table: "orders", keys: ["asaas_transfer_id"] },
    {
      name: "uq_fin_mov_idempotency",
      table: "financial_movements",
      keys: ["idempotency_key"],
      unique: true,
    },
    {
      name: "uq_fin_mov_entrada",
      table: "financial_movements",
      keys: ["order_id"],
      unique: true,
      predicate: "type = 'ENTRADA_PIX'",
    },
    {
      name: "uq_fin_mov_repasse",
      table: "financial_movements",
      keys: ["order_id"],
      unique: true,
      predicate: "type = 'REPASSE_LOJISTA'",
    },
    {
      name: "idx_fin_mov_payment",
      table: "financial_movements",
      keys: ["asaas_payment_id"],
    },
    {
      name: "idx_fin_mov_transfer",
      table: "financial_movements",
      keys: ["asaas_transfer_id"],
    },
    {
      name: "idx_fin_mov_extref",
      table: "financial_movements",
      keys: ["external_reference"],
    },
    {
      name: "idx_fin_mov_store_created",
      table: "financial_movements",
      keys: ["store_id", "created_at DESC"],
    },
    { name: "idx_fin_mov_order", table: "financial_movements", keys: ["order_id"] },
    {
      name: "uq_payment_events_asaas_event_id",
      table: "payment_events",
      keys: ["asaas_event_id"],
      unique: true,
      predicate: "asaas_event_id IS NOT NULL",
    },
  ]),
  requiredCheckConstraintContractsCheck("20260624100000 exact financial checks", [
    {
      name: "store_settings_repasse_momento_chk",
      table: "store_settings",
      validated: true,
      expression: "repasse_momento = ANY (ARRAY['APOS_ENTREGA','MANUAL'])",
    },
    {
      name: "store_settings_taxas_nonneg_chk",
      table: "store_settings",
      validated: true,
      expression: "taxa_percentual_plataforma >= 0 AND taxa_fixa_plataforma >= 0",
    },
    {
      name: "orders_transfer_status_chk",
      table: "orders",
      validated: true,
      expression:
        "transfer_status = ANY (ARRAY['NAO_LIBERADO','AGUARDANDO_ENTREGA','LIBERADO','PROCESSANDO','ENVIADO','FALHOU','BLOQUEADO','CANCELADO'])",
    },
    {
      name: "orders_refund_status_chk",
      table: "orders",
      validated: true,
      expression:
        "refund_status = ANY (ARRAY['NAO_SOLICITADO','PENDENTE','PROCESSANDO','ESTORNADO_TOTAL','ESTORNADO_PARCIAL','FALHOU','NAO_APLICAVEL'])",
    },
    {
      name: "financial_movements_type_chk",
      table: "financial_movements",
      validated: true,
      expression:
        "type = ANY (ARRAY['ENTRADA_PIX','TAXA_PLATAFORMA','REPASSE_LOJISTA','REEMBOLSO_CLIENTE','AJUSTE_MANUAL','ESTORNO_REPASSE','RESERVA_OPERACIONAL'])",
    },
    {
      name: "financial_movements_nature_chk",
      table: "financial_movements",
      validated: true,
      expression: "nature = ANY (ARRAY['CREDITO','DEBITO'])",
    },
    {
      name: "financial_movements_status_chk",
      table: "financial_movements",
      validated: true,
      expression:
        "status = ANY (ARRAY['PENDENTE','PROCESSANDO','CONFIRMADO','FALHOU','CANCELADO'])",
    },
    {
      name: "financial_movements_amount_chk",
      table: "financial_movements",
      validated: true,
      expression: "amount >= 0",
    },
  ]),
  requiredKeyConstraintContractsCheck("20260624100000 exact financial primary key", [
    {
      name: "financial_movements_pkey",
      table: "financial_movements",
      type: "p",
      columns: ["id"],
      validated: true,
    },
  ]),
  requiredForeignKeyContractsCheck("20260624100000 exact financial foreign keys", [
    {
      name: "financial_movements_order_id_fkey",
      table: "financial_movements",
      columns: ["order_id"],
      referencedTable: "orders",
      referencedColumns: ["id"],
      deleteAction: "r",
      updateAction: "a",
      matchType: "s",
      validated: true,
    },
    {
      name: "financial_movements_store_id_fkey",
      table: "financial_movements",
      columns: ["store_id"],
      referencedTable: "stores",
      referencedColumns: ["id"],
      deleteAction: "r",
      updateAction: "a",
      matchType: "s",
      validated: true,
    },
  ]),
  requiredColumnContractsCheck("20260624110000 exact checkout integrity columns", [
    { table: "orders", column: "checkout_payload_hash", type: "text" },
    { table: "stores", column: "archived_at", type: "timestamp with time zone" },
    { table: "stores", column: "archived_by", type: "uuid" },
    { table: "stores", column: "archive_reason", type: "text" },
    { table: "payment_events", column: "processing_started_at", type: "timestamp with time zone" },
    {
      table: "payment_events",
      column: "attempt_count",
      type: "integer",
      notNull: true,
      default: "0",
    },
    { table: "payments", column: "last_webhook_at", type: "timestamp with time zone" },
    { table: "payments", column: "last_webhook_event", type: "text" },
    { table: "subscriptions", column: "last_payment_event_at", type: "timestamp with time zone" },
    { table: "subscriptions", column: "last_payment_event_type", type: "text" },
  ]),
  requiredIndexContractsCheck("20260624110000 exact integrity indexes", [
    {
      name: "subscriptions_asaas_id_unique",
      table: "subscriptions",
      keys: ["asaas_subscription_id"],
      unique: true,
      predicate: "asaas_subscription_id IS NOT NULL",
    },
    {
      name: "orders_id_store_id_unique",
      table: "orders",
      keys: ["id", "store_id"],
      unique: true,
    },
    {
      name: "customers_store_user_unique",
      table: "customers",
      keys: ["store_id", "user_id"],
      unique: true,
      predicate: "user_id IS NOT NULL",
    },
  ]),
  requiredCheckConstraintContractsCheck("20260624110000 exact integrity checks", [
    {
      name: "orders_checkout_payload_hash_chk",
      table: "orders",
      validated: null,
      expression: "checkout_payload_hash IS NULL OR checkout_payload_hash ~ '^[0-9a-f]{64}$'",
    },
    {
      name: "payment_events_attempt_count_chk",
      table: "payment_events",
      validated: null,
      expression: "attempt_count >= 0",
    },
    {
      name: "profiles_document_format_chk",
      table: "profiles",
      validated: null,
      expression:
        "document IS NULL OR document = '' OR document ~ '^(?:[0-9]{11}|[A-Z0-9]{12}[0-9]{2})$'",
    },
    {
      name: "stores_document_format_chk",
      table: "stores",
      validated: null,
      expression:
        "document IS NULL OR document = '' OR document ~ '^(?:[0-9]{11}|[A-Z0-9]{12}[0-9]{2})$'",
    },
    {
      name: "customers_document_format_chk",
      table: "customers",
      validated: null,
      expression:
        "document IS NULL OR document = '' OR document ~ '^(?:[0-9]{11}|[A-Z0-9]{12}[0-9]{2})$'",
    },
    {
      name: "order_items_financial_values_chk",
      table: "order_items",
      validated: null,
      expression:
        "quantity > 0 AND unit_price >= 0 AND COALESCE(subtotal, 0) >= 0 AND COALESCE(options_total, 0) >= 0",
    },
    {
      name: "orders_financial_values_chk",
      table: "orders",
      validated: null,
      expression:
        "COALESCE(subtotal, 0) >= 0 AND COALESCE(delivery_fee, 0) >= 0 AND COALESCE(discount_amount, 0) >= 0 AND COALESCE(total, 0) >= 0 AND COALESCE(refunded_amount, 0) >= 0",
    },
    {
      name: "payments_amount_nonnegative_chk",
      table: "payments",
      validated: null,
      expression: "amount >= 0",
    },
    {
      name: "products_price_nonnegative_chk",
      table: "products",
      validated: null,
      expression: "price >= 0 AND (promo_price IS NULL OR promo_price >= 0)",
    },
    {
      name: "product_options_choice_bounds_chk",
      table: "product_options",
      validated: null,
      expression:
        "COALESCE(min_choices, 0) >= 0 AND COALESCE(max_choices, 0) >= COALESCE(min_choices, 0)",
    },
  ]),
  requiredForeignKeyContractsCheck("20260624110000 exact composite financial foreign key", [
    {
      name: "financial_movements_order_store_fk",
      table: "financial_movements",
      columns: ["order_id", "store_id"],
      referencedTable: "orders",
      referencedColumns: ["id", "store_id"],
      deleteAction: "a",
      updateAction: "a",
      matchType: "s",
      validated: null,
    },
  ]),
  requiredColumnContractsCheck("20260713142207 exact subscription reconciliation columns", [
    {
      table: "subscriptions",
      column: "contract_price_monthly",
      type: "numeric(12,2)",
    },
    {
      table: "subscriptions",
      column: "previous_asaas_subscription_ids",
      type: "text[]",
      notNull: true,
      default: "'{}'",
    },
    {
      table: "subscriptions",
      column: "gateway_action_pending",
      type: "text",
    },
    {
      table: "subscriptions",
      column: "gateway_paused_for_dispute",
      type: "boolean",
      notNull: true,
      default: "false",
    },
    {
      table: "profiles",
      column: "billing_exemption_pending",
      type: "boolean",
      notNull: true,
      default: "false",
    },
  ]),
  {
    label: "gateway subscriptions have a positive reconciled contract price",
    sql: `
      SELECT count(*) = 0 AS ok
      FROM public.subscriptions
      WHERE NULLIF(pg_catalog.btrim(asaas_subscription_id), '') IS NOT NULL
        AND (
          contract_price_monthly IS NULL
          OR contract_price_monthly <= 0
        )
    `,
  },
  requiredIndexContractsCheck("20260713142207 exact recovery backlog indexes", [
    {
      name: "idx_payment_events_unprocessed_received",
      table: "payment_events",
      keys: ["COALESCE(processing_started_at, received_at)"],
      predicate: "processed IS FALSE",
    },
    {
      name: "idx_subscriptions_pending_gateway_action_updated",
      table: "subscriptions",
      keys: ["updated_at"],
      predicate: "gateway_action_pending IS NOT NULL",
    },
    {
      name: "idx_profiles_pending_billing_exemption_updated",
      table: "profiles",
      keys: ["updated_at"],
      predicate: "billing_exemption_pending IS TRUE",
    },
    {
      name: "idx_subscriptions_plan_id",
      table: "subscriptions",
      keys: ["plan_id"],
    },
  ]),
  requiredForeignKeyContractsCheck("20260713142207 exact subscription foreign keys", [
    {
      name: "subscriptions_store_id_fkey",
      table: "subscriptions",
      columns: ["store_id"],
      referencedTable: "stores",
      referencedColumns: ["id"],
      deleteAction: "r",
      updateAction: "a",
      matchType: "s",
      validated: true,
    },
    {
      name: "subscriptions_plan_id_fkey",
      table: "subscriptions",
      columns: ["plan_id"],
      referencedTable: "plans",
      referencedColumns: ["id"],
      deleteAction: "r",
      updateAction: "a",
      matchType: "s",
      validated: true,
    },
  ]),
  requiredCheckConstraintContractsCheck("20260713142207 reconciled validated checks", [
    {
      name: "store_settings_pix_key_type_chk",
      table: "store_settings",
      validated: true,
      expression:
        "pix_key_type IS NULL OR upper(pix_key_type) = ANY (ARRAY['CPF','CNPJ','EMAIL','PHONE','EVP','RANDOM','KEY','COPY_PASTE'])",
    },
    {
      name: "subscriptions_contract_price_monthly_positive_chk",
      table: "subscriptions",
      validated: true,
      expression: "contract_price_monthly IS NULL OR contract_price_monthly > 0",
    },
    {
      name: "subscriptions_gateway_action_pending_chk",
      table: "subscriptions",
      validated: true,
      expression:
        "gateway_action_pending IS NULL OR gateway_action_pending = ANY (ARRAY['CANCEL','INACTIVE','ACTIVE','EXEMPT_CANCEL'])",
    },
  ]),
  requiredCheckConstraintContractsCheck(
    "20260714143000 validated store settings operational checks",
    [
      {
        name: "store_settings_avg_prep_time_minutes_chk",
        table: "store_settings",
        validated: true,
        expression:
          "avg_prep_time_minutes IS NULL OR avg_prep_time_minutes >= 1 AND avg_prep_time_minutes <= 240",
      },
      {
        name: "store_settings_min_order_value_chk",
        table: "store_settings",
        validated: true,
        expression:
          "min_order_value IS NULL OR min_order_value >= 0 AND min_order_value <= 1000000",
      },
      {
        name: "store_settings_delivery_radius_km_chk",
        table: "store_settings",
        validated: true,
        expression:
          "delivery_radius_km IS NULL OR delivery_radius_km >= 0.1 AND delivery_radius_km <= 500",
      },
      {
        name: "store_settings_delivery_base_fee_chk",
        table: "store_settings",
        validated: true,
        expression:
          "delivery_base_fee IS NULL OR delivery_base_fee >= 0 AND delivery_base_fee <= 1000",
      },
      {
        name: "store_settings_delivery_fee_per_km_chk",
        table: "store_settings",
        validated: true,
        expression:
          "delivery_fee_per_km IS NULL OR delivery_fee_per_km >= 0 AND delivery_fee_per_km <= 100",
      },
      {
        name: "store_settings_delivery_fee_chk",
        table: "store_settings",
        validated: true,
        expression: "delivery_fee IS NULL OR delivery_fee >= 0 AND delivery_fee <= 1000",
      },
    ],
  ),
  {
    label: "20260714144500 validated delivery zone operational contract",
    sql: `
      WITH operational_constraints AS (
        SELECT constraint_state.convalidated
        FROM pg_catalog.pg_constraint AS constraint_state
        WHERE constraint_state.conrelid = 'public.delivery_zones'::regclass
          AND constraint_state.contype = 'c'
          AND constraint_state.conname = ANY (ARRAY[
            'delivery_zones_fee_chk',
            'delivery_zones_fee_per_km_chk',
            'delivery_zones_fee_bounds_chk',
            'delivery_zones_min_order_chk',
            'delivery_zones_max_radius_km_chk',
            'delivery_zones_timing_chk',
            'delivery_zones_priority_chk',
            'delivery_zones_coverage_chk'
          ]::name[])
      )
      SELECT
        (
          SELECT count(*) = 8 AND bool_and(operational_constraints.convalidated)
          FROM operational_constraints
        )
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_attribute AS active_column
          JOIN pg_catalog.pg_attrdef AS active_default
            ON active_default.adrelid = active_column.attrelid
           AND active_default.adnum = active_column.attnum
          WHERE active_column.attrelid = 'public.delivery_zones'::regclass
            AND active_column.attname = 'is_active'
            AND active_column.attnum > 0
            AND active_column.attisdropped IS FALSE
            AND active_column.atttypid = 'boolean'::regtype
            AND active_column.attnotnull IS TRUE
            AND regexp_replace(
              lower(
                pg_catalog.pg_get_expr(
                  active_default.adbin,
                  active_default.adrelid,
                  true
                )
              ),
              '[[:space:]()]',
              '',
              'g'
            ) = 'true'
        ) AS ok
    `,
  },
  {
    label: "financial movements RLS and effective Data API privileges",
    sql: `
      SELECT
        table_relation.relrowsecurity IS TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM (
            VALUES
              ('anon'::name),
              ('authenticated'::name),
              ('authenticator'::name),
              ('service_role'::name)
          ) AS checked_role(role_name)
          WHERE has_table_privilege(
              checked_role.role_name,
              table_relation.oid,
              'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
            )
            OR has_any_column_privilege(
              checked_role.role_name,
              table_relation.oid,
              'SELECT,INSERT,UPDATE,REFERENCES'
            )
            OR CASE
              WHEN current_setting('server_version_num')::integer >= 170000
                THEN has_table_privilege(
                  checked_role.role_name,
                  table_relation.oid,
                  'MAINTAIN'
                )
              ELSE false
            END
        )
        AND NOT EXISTS (
          SELECT 1
          FROM aclexplode(
            COALESCE(
              table_relation.relacl,
              acldefault('r', table_relation.relowner)
            )
          ) AS public_table_acl
          WHERE public_table_acl.grantee = 0
        )
        AND NOT EXISTS (
          SELECT 1
          FROM pg_attribute AS column_state
          CROSS JOIN LATERAL aclexplode(
            column_state.attacl
          ) AS public_column_acl
          WHERE column_state.attrelid = table_relation.oid
            AND column_state.attnum > 0
            AND column_state.attisdropped IS FALSE
            AND public_column_acl.grantee = 0
        )
        AND EXISTS (
          SELECT 1
          FROM pg_policy AS server_policy
          WHERE server_policy.polrelid = table_relation.oid
            AND server_policy.polname = 'financial_movements_server_access'
            AND server_policy.polcmd = '*'
            AND server_policy.polpermissive IS TRUE
            AND server_policy.polroles = ARRAY[0::oid]
            AND server_policy.polqual IS NOT NULL
            AND server_policy.polwithcheck IS NOT NULL
        ) AS ok
      FROM pg_class table_relation
      JOIN pg_namespace table_namespace ON table_namespace.oid = table_relation.relnamespace
      WHERE table_namespace.nspname = 'public'
        AND table_relation.relname = 'financial_movements'
        AND table_relation.relkind IN ('r', 'p')
    `,
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
    params: [
      [
        "is_vexor_admin",
        "get_public_order",
        "get_public_order_items",
        "get_public_order_status_history",
        "get_store_rating",
        "normalize_signup_role",
        "handle_auth_user_created",
      ],
    ],
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
const client = new Client(getPgClientConfig(connectionString));

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
