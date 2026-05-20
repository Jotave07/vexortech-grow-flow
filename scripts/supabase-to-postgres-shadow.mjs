#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const PAGE_SIZE = 1000;

const TABLES = [
  "plans",
  "stores",
  "store_settings",
  "categories",
  "products",
  "product_options",
  "product_option_items",
  "delivery_zones",
  "coupons",
  "customers",
  "orders",
  "order_items",
  "order_item_options",
  "order_status_history",
  "payments",
  "subscriptions",
  "profiles",
  "user_roles",
  "customer_addresses",
  "customer_favorites",
  "store_reviews",
  "audit_logs",
];

const COMMON_ID = { type: "uuid", suffix: "PRIMARY KEY DEFAULT gen_random_uuid()" };
const CREATED_AT = { type: "timestamptz", suffix: "DEFAULT now()" };
const UPDATED_AT = { type: "timestamptz", suffix: "DEFAULT now()" };

const SCHEMA = {
  plans: {
    id: COMMON_ID,
    name: "text",
    price_monthly: "numeric(10,2)",
    max_products: "integer",
    features: "jsonb",
    created_at: CREATED_AT,
    slug: "text",
    description: "text",
    is_active: { type: "boolean", suffix: "DEFAULT true" },
    allows_coupons: { type: "boolean", suffix: "DEFAULT false" },
    allows_advanced_reports: { type: "boolean", suffix: "DEFAULT false" },
    allows_custom_branding: { type: "boolean", suffix: "DEFAULT false" },
    allows_custom_domain: { type: "boolean", suffix: "DEFAULT false" },
    sort_order: { type: "integer", suffix: "DEFAULT 0" },
  },
  stores: {
    id: COMMON_ID,
    owner_user_id: "uuid",
    name: "text",
    slug: "text",
    logo_url: "text",
    cover_url: "text",
    is_active: { type: "boolean", suffix: "DEFAULT true" },
    is_suspended: { type: "boolean", suffix: "DEFAULT false" },
    status: "text",
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    plan_id: "uuid",
    zip_code: "text",
    address: "text",
    address_number: "text",
    address_complement: "text",
    neighborhood: "text",
    city: "text",
    state: "text",
    description: "text",
    phone: "text",
    whatsapp: "text",
    whatsapp_number: "text",
    email: "text",
    document: "text",
    primary_color: "text",
    secondary_color: "text",
    font_family: "text",
    public_name: "text",
    latitude: "numeric(10,7)",
    longitude: "numeric(10,7)",
    delivery_fee: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    min_order_amount: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    payment_methods: "jsonb",
    store_type: { type: "text", suffix: "DEFAULT 'Restaurantes'" },
  },
  store_settings: {
    id: COMMON_ID,
    store_id: "uuid",
    address: "text",
    delivery_fee: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    min_order_amount: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    min_order_value: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    business_hours: { type: "jsonb", suffix: "DEFAULT '{}'::jsonb" },
    payment_methods: { type: "jsonb", suffix: "DEFAULT '[]'::jsonb" },
    whatsapp_number: "text",
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    excluded_neighborhoods: "jsonb",
    delivery_distance_rules: "jsonb",
    allow_delivery: { type: "boolean", suffix: "DEFAULT true" },
    allow_pickup: { type: "boolean", suffix: "DEFAULT true" },
    avg_prep_time_minutes: "integer",
    delivery_radius_km: "numeric(10,2)",
    delivery_fee_per_km: "numeric(10,2)",
    delivery_message: "text",
    is_open: { type: "boolean", suffix: "DEFAULT true" },
    accept_orders_when_closed: { type: "boolean", suffix: "DEFAULT false" },
    accept_cash: { type: "boolean", suffix: "DEFAULT true" },
    accept_pix: { type: "boolean", suffix: "DEFAULT true" },
    accept_card_on_delivery: { type: "boolean", suffix: "DEFAULT true" },
    accept_card_online: { type: "boolean", suffix: "DEFAULT false" },
    pix_key: "text",
    pix_key_type: "text",
    delivery_base_fee: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    asaas_api_key: "text",
    asaas_wallet_id: "text",
    free_delivery_above: "numeric(10,2)",
    next_opening_time: "text",
  },
  categories: {
    id: COMMON_ID,
    store_id: "uuid",
    name: "text",
    is_active: { type: "boolean", suffix: "DEFAULT true" },
    sort_order: { type: "integer", suffix: "DEFAULT 0" },
    created_at: CREATED_AT,
    description: "text",
  },
  products: {
    id: COMMON_ID,
    store_id: "uuid",
    category_id: "uuid",
    name: "text",
    description: "text",
    price: "numeric(10,2)",
    image_url: "text",
    is_active: { type: "boolean", suffix: "DEFAULT true" },
    is_available: { type: "boolean", suffix: "DEFAULT true" },
    sort_order: { type: "integer", suffix: "DEFAULT 0" },
    created_at: CREATED_AT,
    promo_price: "numeric(10,2)",
    prep_time_minutes: "integer",
    is_featured: { type: "boolean", suffix: "DEFAULT false" },
  },
  product_options: {
    id: COMMON_ID,
    product_id: "uuid",
    name: "text",
    is_required: { type: "boolean", suffix: "DEFAULT false" },
    min_choices: { type: "integer", suffix: "DEFAULT 0" },
    max_choices: { type: "integer", suffix: "DEFAULT 1" },
    sort_order: { type: "integer", suffix: "DEFAULT 0" },
    created_at: CREATED_AT,
  },
  product_option_items: {
    id: COMMON_ID,
    option_id: "uuid",
    name: "text",
    extra_price: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    is_active: { type: "boolean", suffix: "DEFAULT true" },
    sort_order: { type: "integer", suffix: "DEFAULT 0" },
    created_at: CREATED_AT,
  },
  delivery_zones: {
    id: COMMON_ID,
    store_id: "uuid",
    neighborhood: "text",
    fee: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    is_active: { type: "boolean", suffix: "DEFAULT true" },
    created_at: CREATED_AT,
    city: "text",
    min_order: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    estimated_minutes: "integer",
    name: "text",
    state: "text",
    zip_start: "text",
    zip_end: "text",
    max_radius_km: "numeric(10,2)",
    fee_per_km: "numeric(10,2)",
    min_fee: "numeric(10,2)",
    max_fee: "numeric(10,2)",
    priority: { type: "integer", suffix: "DEFAULT 0" },
    base_prep_time: "integer",
    minutes_per_km: "integer",
    additional_region_time: "integer",
    internal_notes: "text",
  },
  coupons: {
    id: COMMON_ID,
    store_id: "uuid",
    code: "text",
    discount_type: "text",
    discount_value: "numeric(10,2)",
    min_order_value: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    max_discount_amount: "numeric(10,2)",
    usage_limit: "integer",
    usage_count: { type: "integer", suffix: "DEFAULT 0" },
    is_active: { type: "boolean", suffix: "DEFAULT true" },
    expires_at: "timestamptz",
    created_at: CREATED_AT,
  },
  customers: {
    id: COMMON_ID,
    store_id: "uuid",
    user_id: "uuid",
    full_name: "text",
    name: "text",
    phone: "text",
    document: "text",
    street: "text",
    number: "text",
    complement: "text",
    neighborhood: "text",
    city: "text",
    state: "text",
    zip_code: "text",
    asaas_id: "text",
    registration_completed: { type: "boolean", suffix: "DEFAULT false" },
    total_orders: { type: "integer", suffix: "DEFAULT 0" },
    total_spent: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    last_order_at: "timestamptz",
    created_at: CREATED_AT,
  },
  orders: {
    id: COMMON_ID,
    store_id: "uuid",
    customer_id: "uuid",
    order_number: "integer",
    public_token: "text",
    customer_name: "text",
    customer_phone: "text",
    customer_email: "text",
    customer_document: "text",
    delivery_type: "text",
    status: "text",
    payment_status: "text",
    payment_method: "text",
    delivery_address: "text",
    delivery_fee: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    subtotal: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    discount_amount: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    total: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    change_for: "numeric(10,2)",
    notes: "text",
    zip_code: "text",
    street: "text",
    number: "text",
    complement: "text",
    neighborhood: "text",
    city: "text",
    state: "text",
    delivery_zip_code: "text",
    delivery_neighborhood: "text",
    delivery_city: "text",
    delivery_state: "text",
    delivery_region_id: "uuid",
    delivery_source: "text",
    distance_km: "numeric(10,2)",
    estimated_min: "integer",
    estimated_max: "integer",
    coupon_id: "uuid",
    coupon_code: "text",
    idempotency_key: "text",
    is_seen: { type: "boolean", suffix: "DEFAULT false" },
    scheduled_at: "timestamptz",
    estimated_ready_at: "timestamptz",
    estimated_delivery_at: "timestamptz",
    accepted_at: "timestamptz",
    preparation_started_at: "timestamptz",
    ready_at: "timestamptz",
    out_for_delivery_at: "timestamptz",
    delivered_at: "timestamptz",
    cancelled_at: "timestamptz",
    cancel_reason: "text",
    refused_reason: "text",
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
  },
  order_items: {
    id: COMMON_ID,
    order_id: "uuid",
    store_id: "uuid",
    product_id: "uuid",
    product_name: "text",
    unit_price: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    quantity: { type: "integer", suffix: "DEFAULT 1" },
    subtotal: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    notes: "text",
    created_at: CREATED_AT,
  },
  order_item_options: {
    id: COMMON_ID,
    order_item_id: "uuid",
    option_item_id: "uuid",
    option_name: "text",
    item_name: "text",
    name: "text",
    extra_price: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    price: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    created_at: CREATED_AT,
  },
  order_status_history: {
    id: COMMON_ID,
    order_id: "uuid",
    store_id: "uuid",
    status: "text",
    notes: "text",
    created_at: CREATED_AT,
  },
  payments: {
    id: COMMON_ID,
    order_id: "uuid",
    store_id: "uuid",
    amount: { type: "numeric(10,2)", suffix: "DEFAULT 0" },
    status: "text",
    asaas_id: "text",
    external_id: "text",
    paid_at: "timestamptz",
    created_at: CREATED_AT,
  },
  subscriptions: {
    id: COMMON_ID,
    store_id: "uuid",
    plan_id: "uuid",
    status: "text",
    provider: "text",
    asaas_subscription_id: "text",
    last_payment_status: "text",
    trial_ends_at: "timestamptz",
    current_period_start: "timestamptz",
    current_period_end: "timestamptz",
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
  },
  profiles: {
    id: COMMON_ID,
    user_id: "uuid",
    store_id: "uuid",
    role: "text",
    full_name: "text",
    email: "text",
    phone: "text",
    document: "text",
    avatar_url: "text",
    street: "text",
    number: "text",
    complement: "text",
    neighborhood: "text",
    city: "text",
    state: "text",
    zip_code: "text",
    is_exempt: { type: "boolean", suffix: "DEFAULT false" },
    last_login: "timestamptz",
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
  },
  user_roles: {
    id: COMMON_ID,
    user_id: "uuid",
    store_id: "uuid",
    role: "text",
    created_at: CREATED_AT,
  },
  customer_addresses: {
    id: COMMON_ID,
    user_id: "uuid",
    label: "text",
    street: "text",
    number: "text",
    complement: "text",
    neighborhood: "text",
    city: "text",
    state: "text",
    zip_code: "text",
    latitude: "numeric(10,7)",
    longitude: "numeric(10,7)",
    is_default: { type: "boolean", suffix: "DEFAULT false" },
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
  },
  customer_favorites: {
    id: COMMON_ID,
    user_id: "uuid",
    store_id: "uuid",
    created_at: CREATED_AT,
  },
  store_reviews: {
    id: COMMON_ID,
    order_id: "uuid",
    store_id: "uuid",
    user_id: "uuid",
    rating: "integer",
    comment: "text",
    is_visible: { type: "boolean", suffix: "DEFAULT true" },
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
  },
  audit_logs: {
    id: COMMON_ID,
    store_id: "uuid",
    actor_user_id: "uuid",
    entity_type: "text",
    entity_id: "text",
    action: "text",
    metadata: "jsonb",
    created_at: CREATED_AT,
  },
};

const INDEXES = [
  ["stores", "slug"],
  ["stores", "store_type"],
  ["store_settings", "store_id"],
  ["categories", "store_id"],
  ["products", "store_id"],
  ["products", "category_id"],
  ["product_options", "product_id"],
  ["product_option_items", "option_id"],
  ["orders", "store_id"],
  ["orders", "customer_id"],
  ["orders", "public_token"],
  ["order_items", "order_id"],
  ["order_item_options", "order_item_id"],
  ["payments", "order_id"],
  ["profiles", "user_id"],
  ["user_roles", "user_id"],
];

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      parsed[key] = next && !next.startsWith("--") ? args[++i] : true;
    }
  }
  return parsed;
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [name, ...rest] = line.split("=");
    if (process.env[name]) continue;
    process.env[name] = rest.join("=").trim().replace(/^"|"$/g, "");
  }
}

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function columnDefinition(definition) {
  if (typeof definition === "string") return definition;
  return `${definition.type}${definition.suffix ? ` ${definition.suffix}` : ""}`;
}

function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlValue(value, definition) {
  if (value === null || value === undefined) return "NULL";
  const type = typeof definition === "string" ? definition : definition?.type;
  if (type === "jsonb") return `${quoteLiteral(JSON.stringify(value))}::jsonb`;
  if (type === "boolean") return value ? "TRUE" : "FALSE";
  if (type?.startsWith("integer")) return Number.isFinite(Number(value)) ? String(Math.trunc(Number(value))) : "NULL";
  if (type?.startsWith("numeric")) return Number.isFinite(Number(value)) ? String(Number(value)) : "NULL";
  return quoteLiteral(value);
}

function inferDefinition(column, value) {
  if (value && typeof value === "object") return "jsonb";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "numeric(12,4)";
  if (column === "id" || column.endsWith("_id")) return "uuid";
  if (column.endsWith("_at") || column.endsWith("_date")) return "timestamptz";
  return "text";
}

function schemaWithRows(table, rows) {
  const schema = { ...(SCHEMA[table] || {}) };
  for (const row of rows) {
    for (const [column, value] of Object.entries(row)) {
      if (!schema[column]) schema[column] = inferDefinition(column, value);
    }
  }
  return schema;
}

function createSchemaSql(table, schema) {
  const columns = Object.entries(schema).map(([column, definition]) => {
    return `  ${quoteIdent(column)} ${columnDefinition(definition)}`;
  });

  const statements = [
    `CREATE TABLE IF NOT EXISTS public.${quoteIdent(table)} (\n${columns.join(",\n")}\n);`,
    `ALTER TABLE public.${quoteIdent(table)} DISABLE ROW LEVEL SECURITY;`,
  ];

  for (const [column, definition] of Object.entries(schema)) {
    statements.push(
      `ALTER TABLE public.${quoteIdent(table)} ADD COLUMN IF NOT EXISTS ${quoteIdent(column)} ${columnDefinition(definition)};`,
    );
  }

  return statements.join("\n");
}

function upsertSql(table, rows, schema) {
  if (!rows.length) return `-- ${table}: no rows visible from source.`;

  const rowColumns = new Set();
  rows.forEach((row) => Object.keys(row).forEach((column) => rowColumns.add(column)));
  if (schema.id && !rowColumns.has("id")) rowColumns.add("id");
  const columns = [...rowColumns].filter((column) => schema[column]);
  if (!columns.length) return `-- ${table}: no insertable columns.`;

  const chunks = [];
  for (let i = 0; i < rows.length; i += 200) chunks.push(rows.slice(i, i + 200));

  return chunks
    .map((chunk) => {
      const values = chunk.map((row) => {
        return `(${columns.map((column) => sqlValue(row[column], schema[column])).join(", ")})`;
      });
      const updateColumns = columns.filter((column) => column !== "id");
      const conflict = columns.includes("id")
        ? `ON CONFLICT (${quoteIdent("id")}) DO UPDATE SET ${updateColumns
            .map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`)
            .join(", ")}`
        : "";
      return `INSERT INTO public.${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")})\nVALUES\n${values.join(",\n")}\n${conflict};`;
    })
    .join("\n");
}

async function fetchTable(baseUrl, key, table) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const response = await fetch(`${baseUrl}/rest/v1/${table}?select=*`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${offset + PAGE_SIZE - 1}`,
        Prefer: "count=exact",
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${table}: ${response.status} ${text}`);
    }
    const page = await response.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function supportFunctionsSql() {
  return `
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  encrypted_password text,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  email_confirmed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS auth.password_reset_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
$$;

CREATE OR REPLACE FUNCTION public.check_column_exists(t_name text, c_name text)
RETURNS boolean
LANGUAGE sql
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = t_name
      AND column_name = c_name
  );
$$;

CREATE OR REPLACE FUNCTION public.is_vexor_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = _user_id AND role IN ('super_admin', 'admin')
  ) OR EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('super_admin', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.get_public_order(_token text)
RETURNS TABLE(
  id uuid,
  store_id uuid,
  public_token text,
  order_number integer,
  status text,
  payment_status text,
  payment_method text,
  delivery_type text,
  delivery_fee numeric,
  subtotal numeric,
  discount_amount numeric,
  total numeric,
  change_for numeric,
  notes text,
  created_at timestamptz,
  store_name text,
  store_logo_url text,
  store_whatsapp text
)
LANGUAGE sql
AS $$
  SELECT
    o.id,
    o.store_id,
    o.public_token,
    o.order_number,
    o.status,
    o.payment_status,
    o.payment_method,
    o.delivery_type,
    o.delivery_fee,
    o.subtotal,
    o.discount_amount,
    o.total,
    o.change_for,
    o.notes,
    o.created_at,
    COALESCE(s.public_name, s.name) AS store_name,
    s.logo_url AS store_logo_url,
    COALESCE(s.whatsapp_number, s.whatsapp, s.phone) AS store_whatsapp
  FROM public.orders o
  LEFT JOIN public.stores s ON s.id = o.store_id
  WHERE o.public_token = _token;
$$;

CREATE OR REPLACE FUNCTION public.get_public_order_items(_token text)
RETURNS TABLE(
  id uuid,
  quantity integer,
  unit_price numeric,
  item_subtotal numeric,
  product_name text,
  options jsonb,
  notes text
)
LANGUAGE sql
AS $$
  SELECT
    oi.id,
    oi.quantity,
    oi.unit_price,
    COALESCE(NULLIF(oi.subtotal, 0), (
      (COALESCE(oi.unit_price, 0) + COALESCE((
        SELECT SUM(COALESCE(oio.extra_price, 0))
        FROM public.order_item_options oio
        WHERE oio.order_item_id = oi.id
      ), 0)) * COALESCE(oi.quantity, 0)
    )) AS item_subtotal,
    COALESCE(oi.product_name, p.name) AS product_name,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', COALESCE(oio.name, oio.item_name),
        'extra_price', oio.extra_price
      ))
      FROM public.order_item_options oio
      WHERE oio.order_item_id = oi.id
    ), '[]'::jsonb) AS options,
    oi.notes
  FROM public.order_items oi
  LEFT JOIN public.products p ON p.id = oi.product_id
  JOIN public.orders o ON o.id = oi.order_id
  WHERE o.public_token = _token;
$$;

CREATE OR REPLACE FUNCTION public.get_public_order_status_history(_token text)
RETURNS TABLE(id uuid, status text, notes text, created_at timestamptz)
LANGUAGE sql
AS $$
  SELECT h.id, h.status, h.notes, h.created_at
  FROM public.order_status_history h
  JOIN public.orders o ON o.id = h.order_id
  WHERE o.public_token = _token
  ORDER BY h.created_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.get_store_rating(p_store_id uuid)
RETURNS TABLE(avg_rating numeric, total_reviews bigint)
LANGUAGE sql
AS $$
  SELECT COALESCE(AVG(rating), 0), COUNT(*)
  FROM public.store_reviews
  WHERE store_id = p_store_id AND COALESCE(is_visible, true);
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_email ON auth.users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_user_id_unique ON public.profiles (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_roles_unique ON public.user_roles (user_id, role, COALESCE(store_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_store_id_unique ON public.subscriptions (store_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_store_settings_store_id_unique ON public.store_settings (store_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_slug_unique ON public.plans (slug);

INSERT INTO public.plans (slug, name, description, price_monthly, max_products, features, is_active, sort_order, allows_coupons, allows_advanced_reports, allows_custom_branding, allows_custom_domain)
VALUES
  ('starter', 'Starter', 'Plano inicial para lojas em operacao.', 49.90, 80, '["Cardapio online","Pedidos ilimitados","Painel do lojista"]'::jsonb, true, 1, false, false, false, false),
  ('pro', 'Pro', 'Plano completo para operacao de delivery.', 99.90, 300, '["Cardapio online","Cupons","Relatorios","Personalizacao"]'::jsonb, true, 2, true, true, true, false),
  ('premium_cortesia', 'Cortesia', 'Plano interno para lojas isentas.', 0, 9999, '["Acesso total"]'::jsonb, true, 99, true, true, true, true)
ON CONFLICT (slug) DO NOTHING;
`;
}

async function applySql(sql, args) {
  const { Client } = await import("pg");
  const databaseUrl = envValue("DATABASE_URL") || args.databaseUrl;
  if (!databaseUrl) throw new Error("Missing DATABASE_URL for --apply.");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function main() {
  const args = parseArgs();
  loadDotEnv(path.resolve(process.cwd(), ".env"));

  const baseUrl = envValue("SUPABASE_URL", "VITE_SUPABASE_URL", "VITE_VEXOR_SUPABASE_URL");
  const key = envValue(
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_ANON_KEY",
    "VITE_SUPABASE_ANON_KEY",
    "VITE_VEXOR_SUPABASE_ANON_KEY",
  );

  const schemaOnly = Boolean(args["schema-only"]);
  if (!schemaOnly && (!baseUrl || !key)) {
    throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or Supabase API key in environment.");
  }

  const outFile = path.resolve(process.cwd(), args.out || "tmp/supabase-to-postgres-shadow.sql");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const exportedAt = new Date().toISOString();
  const blocks = [
    "-- Generated by scripts/supabase-to-postgres-shadow.mjs",
    `-- Exported at ${exportedAt}`,
    "BEGIN;",
    "CREATE EXTENSION IF NOT EXISTS pgcrypto;",
  ];

  const summary = [];

  for (const table of TABLES) {
    const rows = schemaOnly ? [] : await fetchTable(baseUrl, key, table);
    const schema = schemaWithRows(table, rows);
    summary.push({ table, rows: rows.length });
    blocks.push(`\n-- ${table}: ${rows.length} row(s)`);
    blocks.push(createSchemaSql(table, schema));
    blocks.push(upsertSql(table, rows, schema));
  }

  for (const [table, column] of INDEXES) {
    blocks.push(
      `CREATE INDEX IF NOT EXISTS ${quoteIdent(`idx_${table}_${column}`)} ON public.${quoteIdent(table)} (${quoteIdent(column)});`,
    );
  }

  blocks.push(supportFunctionsSql());
  blocks.push(`
CREATE TABLE IF NOT EXISTS public.migration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  exported_at timestamptz NOT NULL,
  applied_at timestamptz DEFAULT now(),
  summary jsonb NOT NULL
);

INSERT INTO public.migration_runs (source, exported_at, summary)
VALUES ('supabase-shadow', ${quoteLiteral(exportedAt)}, ${quoteLiteral(JSON.stringify(summary))}::jsonb);
`);
  blocks.push("COMMIT;");

  fs.writeFileSync(outFile, `${blocks.join("\n")}\n`, "utf8");

  console.log(`Wrote ${outFile}`);
  for (const item of summary) console.log(`${item.table}: ${item.rows}`);

  if (args.apply) {
    await applySql(blocks.join("\n"), args);
    console.log("Applied SQL to DATABASE_URL.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
