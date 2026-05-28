import type { QueryFilter, QueryPayload } from "@/integrations/backend/compat-types";
import { query, quoteIdent } from "./db";
import { getActor } from "./auth";
import { publishRealtime } from "./realtime";

type QueryContext = {
  admin?: boolean;
  token?: string;
};

const NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const ensureName = (value: string, kind = "identificador") => {
  if (!NAME_RE.test(value)) throw new Error(`${kind} invalido: ${value}`);
  return value;
};

const splitTopLevel = (input: string) => {
  const items: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of input) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      if (current.trim()) items.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) items.push(current.trim());
  return items;
};

export type Relation = {
  table: string;
  local: string;
  foreign: string;
  localType: PgScalarType;
  foreignType: PgScalarType;
  many: boolean;
  nested?: Record<string, Relation>;
};

export type PgScalarType = "uuid" | "text" | "numeric" | "integer" | "boolean" | "timestamptz" | "jsonb";

export const columnTypes: Record<string, Record<string, PgScalarType>> = {
  stores: {
    id: "uuid",
    owner_user_id: "uuid",
    slug: "text",
    name: "text",
    public_name: "text",
    description: "text",
    store_type: "text",
    is_verified: "boolean",
    verification_status: "text",
    verification_notes: "text",
    logo_url: "text",
    cover_url: "text",
    document: "text",
    email: "text",
    address: "text",
    address_number: "text",
    address_complement: "text",
    neighborhood: "text",
    zip_code: "text",
    latitude: "numeric",
    longitude: "numeric",
    primary_color: "text",
    secondary_color: "text",
    city: "text",
    state: "text",
    phone: "text",
    whatsapp: "text",
    whatsapp_number: "text",
    is_active: "boolean",
    is_suspended: "boolean",
    created_at: "timestamptz",
  },
  store_settings: {
    id: "uuid",
    store_id: "uuid",
    asaas_api_key: "text",
    payment_gateway_provider: "text",
    payment_gateway_api_key: "text",
    payment_gateway_config: "jsonb",
    pix_key: "text",
    pix_key_type: "text",
    asaas_wallet_id: "text",
    allow_delivery: "boolean",
    allow_pickup: "boolean",
    accept_pix: "boolean",
    accept_cash: "boolean",
    accept_card_on_delivery: "boolean",
    accept_orders_when_closed: "boolean",
    is_open: "boolean",
    delivery_radius_km: "numeric",
    delivery_base_fee: "numeric",
    delivery_fee_per_km: "numeric",
    min_order_value: "numeric",
    min_order_amount: "numeric",
    free_delivery_above: "numeric",
    avg_prep_time_minutes: "integer",
    business_hours: "jsonb",
    whatsapp_number: "text",
  },
  products: {
    id: "uuid",
    store_id: "uuid",
    category_id: "uuid",
    name: "text",
    is_active: "boolean",
    is_available: "boolean",
    price: "numeric",
    promo_price: "numeric",
    sort_order: "integer",
  },
  product_options: {
    id: "uuid",
    product_id: "uuid",
    name: "text",
    is_required: "boolean",
    min_choices: "integer",
    max_choices: "integer",
    sort_order: "integer",
  },
  product_option_items: {
    id: "uuid",
    option_id: "uuid",
    name: "text",
    extra_price: "numeric",
    is_active: "boolean",
    sort_order: "integer",
  },
  categories: {
    id: "uuid",
    store_id: "uuid",
    name: "text",
    is_active: "boolean",
    sort_order: "integer",
  },
  customers: {
    id: "uuid",
    store_id: "uuid",
    user_id: "uuid",
    name: "text",
    full_name: "text",
    phone: "text",
    document: "text",
    total_orders: "integer",
    total_spent: "numeric",
    last_order_at: "timestamptz",
  },
  orders: {
    id: "uuid",
    store_id: "uuid",
    customer_id: "uuid",
    delivery_region_id: "uuid",
    coupon_id: "uuid",
    status: "text",
    payment_status: "text",
    payment_method: "text",
    public_token: "text",
    idempotency_key: "text",
    order_number: "integer",
    delivery_type: "text",
    delivery_source: "text",
    customer_name: "text",
    customer_phone: "text",
    customer_document: "text",
    customer_email: "text",
    delivery_address: "text",
    delivery_reference: "text",
    zip_code: "text",
    neighborhood: "text",
    city: "text",
    state: "text",
    street: "text",
    number: "text",
    complement: "text",
    notes: "text",
    subtotal: "numeric",
    delivery_fee: "numeric",
    discount_amount: "numeric",
    total: "numeric",
    change_for: "numeric",
    distance_km: "numeric",
    estimated_min: "integer",
    estimated_max: "integer",
    is_seen: "boolean",
    created_at: "timestamptz",
    updated_at: "timestamptz",
  },
  order_items: {
    id: "uuid",
    order_id: "uuid",
    store_id: "uuid",
    product_id: "uuid",
    product_name: "text",
    unit_price: "numeric",
    quantity: "integer",
    notes: "text",
    subtotal: "numeric",
    options_total: "numeric",
    created_at: "timestamptz",
  },
  order_item_options: {
    id: "uuid",
    order_item_id: "uuid",
    option_id: "uuid",
    option_item_id: "uuid",
    option_name: "text",
    item_name: "text",
    extra_price: "numeric",
    name: "text",
    created_at: "timestamptz",
  },
  payments: {
    id: "uuid",
    order_id: "uuid",
    store_id: "uuid",
    provider: "text",
    external_id: "text",
    asaas_id: "text",
    idempotency_key: "text",
    status: "text",
    amount: "numeric",
    paid_at: "timestamptz",
  },
  delivery_zones: {
    id: "uuid",
    store_id: "uuid",
    name: "text",
    city: "text",
    state: "text",
    neighborhood: "text",
    zip_start: "text",
    zip_end: "text",
    is_active: "boolean",
    max_radius_km: "numeric",
    fee: "numeric",
    fee_per_km: "numeric",
    min_fee: "numeric",
    max_fee: "numeric",
    min_order: "numeric",
    base_prep_time: "integer",
    minutes_per_km: "numeric",
    additional_region_time: "integer",
    priority: "integer",
  },
  coupons: {
    id: "uuid",
    store_id: "uuid",
    code: "text",
    is_active: "boolean",
    min_order_value: "numeric",
    usage_count: "integer",
    usage_limit: "integer",
    expires_at: "timestamptz",
  },
  subscriptions: {
    id: "uuid",
    store_id: "uuid",
    plan_id: "uuid",
    status: "text",
    asaas_subscription_id: "text",
  },
  plans: {
    id: "uuid",
    is_active: "boolean",
    sort_order: "integer",
  },
  profiles: {
    id: "uuid",
    user_id: "uuid",
    store_id: "uuid",
    role: "text",
  },
  user_roles: {
    id: "uuid",
    user_id: "uuid",
    store_id: "uuid",
    role: "text",
  },
  order_status_history: {
    id: "uuid",
    order_id: "uuid",
    store_id: "uuid",
    status: "text",
    created_at: "timestamptz",
  },
  customer_addresses: {
    id: "uuid",
    user_id: "uuid",
    city: "text",
    state: "text",
  },
  customer_favorites: {
    id: "uuid",
    user_id: "uuid",
    store_id: "uuid",
  },
  auth_users: {
    id: "uuid",
    email: "text",
    encrypted_password: "text",
    deleted_at: "timestamptz",
  },
  users: {
    id: "uuid",
    email: "text",
  },
  store_reviews: {
    id: "uuid",
    store_id: "uuid",
    rating: "integer",
  },
};

export const getColumnPgType = (table: string, column: string): PgScalarType => {
  const normalizedTable = table.replace(/^public\./, "");
  const normalizedColumn = column.trim();
  const type = columnTypes[normalizedTable]?.[normalizedColumn];
  if (!type) {
    throw new Error(`Tipo PostgreSQL nao mapeado para ${normalizedTable}.${normalizedColumn}`);
  }
  return type;
};

export const pgArrayCast = (type: PgScalarType) => `${type}[]`;

export const arrayCastFor = (table: string, column: string) => {
  return pgArrayCast(getColumnPgType(table, column));
};

const optionalColumnCastFor = (table: string, column: string) => {
  const normalizedTable = table.replace(/^public\./, "");
  const normalizedColumn = column.trim();
  const type = columnTypes[normalizedTable]?.[normalizedColumn];
  return type ? `::${type}` : "";
};

const typedParamSql = (table: string, column: string, index: number) =>
  `$${index}${optionalColumnCastFor(table, column)}`;

const relations: Record<string, Record<string, Relation>> = {
  stores: {
    store_settings: { table: "store_settings", local: "id", foreign: "store_id", localType: "uuid", foreignType: "uuid", many: true },
    subscriptions: {
      table: "subscriptions",
      local: "id",
      foreign: "store_id",
      localType: "uuid",
      foreignType: "uuid",
      many: true,
      nested: {
        plans: { table: "plans", local: "plan_id", foreign: "id", localType: "uuid", foreignType: "uuid", many: false },
      },
    },
  },
  subscriptions: {
    plans: { table: "plans", local: "plan_id", foreign: "id", localType: "uuid", foreignType: "uuid", many: false },
    stores: { table: "stores", local: "store_id", foreign: "id", localType: "uuid", foreignType: "uuid", many: false },
  },
  products: {
    categories: { table: "categories", local: "category_id", foreign: "id", localType: "uuid", foreignType: "uuid", many: false },
  },
  orders: {
    stores: { table: "stores", local: "store_id", foreign: "id", localType: "uuid", foreignType: "uuid", many: false },
  },
  order_items: {
    order_item_options: { table: "order_item_options", local: "id", foreign: "order_item_id", localType: "uuid", foreignType: "uuid", many: true },
  },
  payments: {
    orders: { table: "orders", local: "order_id", foreign: "id", localType: "uuid", foreignType: "uuid", many: false },
  },
};

const parseRelationSelections = (select = "*") => {
  return splitTopLevel(select)
    .map((item) => {
      const match = item.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/s);
      if (!match) return null;
      return { name: match[1], select: match[2] || "*" };
    })
    .filter(Boolean) as Array<{ name: string; select: string }>;
};

const baseColumnsSql = (select = "*") => {
  const items = splitTopLevel(select).filter((item) => !item.includes("("));
  if (!items.length || items.includes("*")) return "*";
  const columns = items.map((item) => ensureName(item.trim())).map(quoteIdent);
  return columns.join(", ");
};

export const appendFilterSql = (table: string, filter: QueryFilter, params: unknown[]) => {
  const column = quoteIdent(ensureName(filter.column, "coluna"));
  switch (filter.op) {
    case "eq":
      params.push(filter.value);
      return `${column} = ${typedParamSql(table, filter.column, params.length)}`;
    case "neq":
      params.push(filter.value);
      return `${column} <> ${typedParamSql(table, filter.column, params.length)}`;
    case "gt":
      params.push(filter.value);
      return `${column} > ${typedParamSql(table, filter.column, params.length)}`;
    case "gte":
      params.push(filter.value);
      return `${column} >= ${typedParamSql(table, filter.column, params.length)}`;
    case "lt":
      params.push(filter.value);
      return `${column} < ${typedParamSql(table, filter.column, params.length)}`;
    case "lte":
      params.push(filter.value);
      return `${column} <= ${typedParamSql(table, filter.column, params.length)}`;
    case "in":
      if (!filter.values.length) return "FALSE";
      {
        const arrayCast = arrayCastFor(table, filter.column);
        params.push(filter.values);
        return `${column} = ANY($${params.length}::${arrayCast})`;
      }
    case "is":
      if (filter.value === null) return `${column} IS NULL`;
      params.push(filter.value);
      return `${column} IS NOT DISTINCT FROM ${typedParamSql(table, filter.column, params.length)}`;
    default:
      return "TRUE";
  }
};

export const relationSelectSql = (relation: Relation, paramIndex = 1) =>
  `SELECT * FROM public.${quoteIdent(relation.table)} WHERE ${quoteIdent(relation.foreign)} = ANY($${paramIndex}::${pgArrayCast(relation.foreignType)})`;

const publicReadable = new Set([
  "stores",
  "store_settings",
  "categories",
  "products",
  "product_options",
  "product_option_items",
  "delivery_zones",
  "coupons",
  "plans",
  "store_reviews",
]);

const storeIdTables = new Set([
  "store_settings",
  "categories",
  "products",
  "delivery_zones",
  "coupons",
  "customers",
  "orders",
  "order_items",
  "payments",
  "subscriptions",
  "order_status_history",
]);

const platformAdminRoles = new Set(["admin", "super_admin"]);
const assignableNonAdminRoles = new Set(["customer", "store_owner", "store_manager", "store_attendant"]);
const serverManagedTables = new Set([
  "payments",
  "order_items",
  "order_item_options",
  "order_status_history",
  "subscriptions",
]);
const protectedStoreColumns = new Set([
  "owner_user_id",
  "plan_id",
  "is_active",
  "is_suspended",
  "is_verified",
  "verification_status",
  "verification_notes",
]);

const accessSql = async (table: string, operation: QueryPayload["operation"], ctx: QueryContext, params: unknown[]) => {
  if (ctx.admin) return "TRUE";
  const actor = await getActor(ctx.token);
  if (actor?.admin) return "TRUE";

  const mutating = operation !== "select";
  if (!actor) {
    if (!mutating && publicReadable.has(table)) {
      if (table === "stores") return `(COALESCE(${quoteIdent("is_active")}, true) IS TRUE AND COALESCE(${quoteIdent("is_suspended")}, false) IS FALSE)`;
      if (["categories", "products", "product_option_items", "delivery_zones", "coupons", "plans"].includes(table)) {
        return `COALESCE(${quoteIdent("is_active")}, true) IS TRUE`;
      }
      return "TRUE";
    }
    throw new Error("Nao autorizado.");
  }

  const owned = actor.ownedStoreIds;
  let userParam: string | null = null;
  let storesParam: string | null = null;
  const userSql = () => {
    if (!userParam) {
      params.push(actor.user.id);
      userParam = `$${params.length}`;
    }
    return userParam;
  };
  const storesSql = () => {
    if (!storesParam) {
      params.push(owned);
      storesParam = `$${params.length}`;
    }
    return storesParam;
  };

  if (table === "stores") {
    return mutating
      ? `${quoteIdent("owner_user_id")} = ${userSql()}`
      : `(${quoteIdent("owner_user_id")} = ${userSql()} OR (COALESCE(${quoteIdent("is_active")}, true) IS TRUE AND COALESCE(${quoteIdent("is_suspended")}, false) IS FALSE))`;
  }
  if (table === "profiles") return `(${quoteIdent("user_id")} = ${userSql()} OR ${quoteIdent("store_id")} = ANY(${storesSql()}::uuid[]))`;
  if (table === "user_roles") return `(${quoteIdent("user_id")} = ${userSql()} OR ${quoteIdent("store_id")} = ANY(${storesSql()}::uuid[]))`;
  if (table === "customer_addresses" || table === "customer_favorites") return `${quoteIdent("user_id")} = ${userSql()}`;
  if (storeIdTables.has(table)) {
    if (!mutating && publicReadable.has(table)) return "TRUE";
    if (table === "customers") return `(${quoteIdent("user_id")} = ${userSql()} OR ${quoteIdent("store_id")} = ANY(${storesSql()}::uuid[]))`;
    if (table === "orders") {
      return `(${quoteIdent("store_id")} = ANY(${storesSql()}::uuid[]) OR EXISTS (SELECT 1 FROM public.customers c WHERE c.id = ${quoteIdent("customer_id")} AND c.user_id = ${userSql()}))`;
    }
    if (table === "order_items") {
      return `(${quoteIdent("store_id")} = ANY(${storesSql()}::uuid[]) OR EXISTS (
        SELECT 1 FROM public.orders o
        JOIN public.customers c ON c.id = o.customer_id
        WHERE o.id = ${quoteIdent("order_id")} AND c.user_id = ${userSql()}
      ))`;
    }
    if (table === "payments") {
      return `(${quoteIdent("store_id")} = ANY(${storesSql()}::uuid[]) OR EXISTS (
        SELECT 1 FROM public.orders o
        JOIN public.customers c ON c.id = o.customer_id
        WHERE o.id = ${quoteIdent("order_id")} AND c.user_id = ${userSql()}
      ))`;
    }
    return `${quoteIdent("store_id")} = ANY(${storesSql()}::uuid[])`;
  }
  if (table === "product_options") {
    if (!mutating) return "TRUE";
    return `EXISTS (SELECT 1 FROM public.products p WHERE p.id = ${quoteIdent("product_id")} AND p.store_id = ANY(${storesSql()}::uuid[]))`;
  }
  if (table === "product_option_items") {
    if (!mutating) return "TRUE";
    return `EXISTS (
      SELECT 1 FROM public.product_options po
      JOIN public.products p ON p.id = po.product_id
      WHERE po.id = ${quoteIdent("option_id")} AND p.store_id = ANY(${storesSql()}::uuid[])
    )`;
  }
  if (table === "order_item_options") {
    return `EXISTS (
      SELECT 1 FROM public.order_items oi
      LEFT JOIN public.orders o ON o.id = oi.order_id
      LEFT JOIN public.customers c ON c.id = o.customer_id
      WHERE oi.id = ${quoteIdent("order_item_id")}
        AND (oi.store_id = ANY(${storesSql()}::uuid[]) OR c.user_id = ${userSql()})
    )`;
  }

  if (!mutating && publicReadable.has(table)) return "TRUE";
  throw new Error("Nao autorizado.");
};

const normalizeRows = (values: unknown) => (Array.isArray(values) ? values : [values]).filter(Boolean) as Record<string, unknown>[];

const changedColumns = (values: unknown) =>
  Array.from(new Set(normalizeRows(values).flatMap((row) => Object.keys(row))));

const onlyColumns = (values: unknown, allowedColumns: string[]) => {
  const columns = changedColumns(values);
  return columns.length > 0 && columns.every((column) => allowedColumns.includes(column));
};

const assertAssignableRole = (role: unknown) => {
  if (role === undefined || role === null) return;
  const value = String(role);
  if (platformAdminRoles.has(value)) {
    throw new Error("Papel administrativo so pode ser alterado por admin da plataforma.");
  }
  if (!assignableNonAdminRoles.has(value)) {
    throw new Error("Papel de usuario invalido.");
  }
};

export const assertSafePatchForNonAdmin = (table: string, operation: QueryPayload["operation"], values: unknown) => {
  if (table === "orders") {
    if (operation === "update" && onlyColumns(values, ["is_seen"])) return;
    throw new Error("Use funcoes seguras para alterar pedidos.");
  }
  if (serverManagedTables.has(table)) {
    throw new Error("Use funcoes seguras para alterar dados financeiros e operacionais.");
  }

  const columns = changedColumns(values);
  if (table === "stores" && operation !== "insert") {
    const blocked = columns.find((column) => protectedStoreColumns.has(column));
    if (blocked) throw new Error(`Campo de loja protegido: ${blocked}.`);
  }

  if (table === "profiles" || table === "user_roles") {
    for (const row of normalizeRows(values)) assertAssignableRole(row.role);
  }
};

const ensureMutationRowsAllowed = async (table: string, operation: QueryPayload["operation"], values: unknown, ctx: QueryContext) => {
  if (ctx.admin) return;
  const actor = await getActor(ctx.token);
  if (!actor) throw new Error("Nao autorizado.");
  if (actor.admin) return;
  assertSafePatchForNonAdmin(table, operation, values);
  if (operation !== "insert" && operation !== "upsert") return;

  const rows = normalizeRows(values);
  const ownsStore = (storeId: unknown) => !!storeId && actor.ownedStoreIds.includes(String(storeId));

  for (const row of rows) {
    if (table === "stores") {
      if (row.owner_user_id && String(row.owner_user_id) !== actor.user.id) throw new Error("Loja pertence a outro usuario.");
      row.owner_user_id = actor.user.id;
      continue;
    }
    if (table === "profiles" || table === "user_roles") {
      if (String(row.user_id || "") === actor.user.id || ownsStore(row.store_id)) continue;
      throw new Error("Perfil/papel fora do escopo do usuario.");
    }
    if (table === "customers") {
      if (String(row.user_id || "") === actor.user.id || ownsStore(row.store_id)) continue;
      throw new Error("Cliente fora do escopo do usuario.");
    }
    if (storeIdTables.has(table) && ownsStore(row.store_id)) continue;
    if (table === "orders" || table === "order_items" || table === "payments") {
      throw new Error("Use o checkout seguro para criar pedidos e pagamentos.");
    }
    if (table === "order_item_options" && row.order_item_id) {
      const { rows: orders } = await query(
        `SELECT oi.id
         FROM public.order_items oi
         JOIN public.orders o ON o.id = oi.order_id
         WHERE oi.id = $1 AND o.store_id = ANY($2::uuid[])`,
        [row.order_item_id, actor.ownedStoreIds],
      );
      if (orders[0]) continue;
      throw new Error("Use o checkout seguro para criar opcoes do pedido.");
    }
    if (table === "product_options" && row.product_id) {
      const { rows: products } = await query(`SELECT id FROM public.products WHERE id = $1 AND store_id = ANY($2::uuid[])`, [row.product_id, actor.ownedStoreIds]);
      if (products[0]) continue;
    }
    if (table === "product_option_items" && row.option_id) {
      const { rows: options } = await query(
        `SELECT po.id
         FROM public.product_options po
         JOIN public.products p ON p.id = po.product_id
         WHERE po.id = $1 AND p.store_id = ANY($2::uuid[])`,
        [row.option_id, actor.ownedStoreIds],
      );
      if (options[0]) continue;
    }
    throw new Error("Operacao fora do escopo do usuario.");
  }
};

const insertRows = async (table: string, values: unknown) => {
  const rows = normalizeRows(values);
  if (!rows.length) return [];
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const params: unknown[] = [];
  const valueSql = rows.map((row) => {
    const placeholders = columns.map((column) => {
      params.push(row[column] ?? null);
      return typedParamSql(table, column, params.length);
    });
    return `(${placeholders.join(", ")})`;
  });
  const sql = `INSERT INTO public.${quoteIdent(table)} (${columns.map((column) => quoteIdent(ensureName(column))).join(", ")})
    VALUES ${valueSql.join(", ")}
    RETURNING *`;
  const result = await query(sql, params);
  return result.rows;
};

const updateRows = async (table: string, values: any, whereSql: string, params: unknown[]) => {
  const entries = Object.entries(values || {});
  if (!entries.length) return [];
  const setSql = entries.map(([column, value]) => {
    params.push(value);
    return `${quoteIdent(ensureName(column))} = ${typedParamSql(table, column, params.length)}`;
  });
  const sql = `UPDATE public.${quoteIdent(table)} SET ${setSql.join(", ")} WHERE ${whereSql} RETURNING *`;
  const result = await query(sql, params);
  return result.rows;
};

const deleteRows = async (table: string, whereSql: string, params: unknown[]) => {
  const result = await query(`DELETE FROM public.${quoteIdent(table)} WHERE ${whereSql} RETURNING *`, params);
  return result.rows;
};

const upsertRows = async (table: string, values: unknown, onConflict?: string) => {
  const rows = normalizeRows(values);
  if (!rows.length) return [];
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const conflictColumns = (onConflict || "id")
    .split(",")
    .map((column) => ensureName(column.trim()))
    .filter(Boolean);
  const params: unknown[] = [];
  const valueSql = rows.map((row) => {
    const placeholders = columns.map((column) => {
      params.push(row[column] ?? null);
      return typedParamSql(table, column, params.length);
    });
    return `(${placeholders.join(", ")})`;
  });
  const updateColumns = columns.filter((column) => !conflictColumns.includes(column));
  const conflictAction = updateColumns.length
    ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(", ")}`
    : "DO NOTHING";
  const sql = `INSERT INTO public.${quoteIdent(table)} (${columns.map((column) => quoteIdent(ensureName(column))).join(", ")})
    VALUES ${valueSql.join(", ")}
    ON CONFLICT (${conflictColumns.map(quoteIdent).join(", ")})
    ${conflictAction}
    RETURNING *`;
  const result = await query(sql, params);
  return result.rows;
};

const attachRelations = async (table: string, rows: any[], select = "*") => {
  if (!rows.length) return rows;
  const selections = parseRelationSelections(select);
  if (!selections.length) return rows;
  const tableRelations = relations[table] || {};

  for (const selection of selections) {
    const relation = tableRelations[selection.name];
    if (!relation) continue;
    const localValues = Array.from(new Set(rows.map((row) => row[relation.local]).filter(Boolean)));
    if (!localValues.length) continue;
    const { rows: relatedRows } = await query(relationSelectSql(relation), [localValues]);
    await attachNestedRelations(relation, relatedRows, selection.select);
    for (const row of rows) {
      const matches = relatedRows.filter((related) => related[relation.foreign] === row[relation.local]);
      row[selection.name] = relation.many ? matches : matches[0] || null;
    }
  }

  return rows;
};

const attachNestedRelations = async (parentRelation: Relation, rows: any[], select: string) => {
  const selections = parseRelationSelections(select);
  if (!rows.length || !selections.length || !parentRelation.nested) return;
  for (const selection of selections) {
    const relation = parentRelation.nested[selection.name];
    if (!relation) continue;
    const localValues = Array.from(new Set(rows.map((row) => row[relation.local]).filter(Boolean)));
    if (!localValues.length) continue;
    const { rows: nestedRows } = await query(relationSelectSql(relation), [localValues]);
    for (const row of rows) {
      const matches = nestedRows.filter((nested) => nested[relation.foreign] === row[relation.local]);
      row[selection.name] = relation.many ? matches : matches[0] || null;
    }
  }
};

const publishRows = (table: string, eventType: "INSERT" | "UPDATE" | "DELETE", rows: any[]) => {
  for (const row of rows) {
    publishRealtime({
      schema: "public",
      table,
      eventType,
      new: eventType === "DELETE" ? null : row,
      old: eventType === "INSERT" ? null : row,
    });
  }
};

const hasTextValue = (value: unknown) => String(value ?? "").trim().length > 0;

const sanitizeStoreSettingsRows = async (table: string, rows: any[], ctx: QueryContext) => {
  if (table !== "store_settings" || !rows.length || ctx.admin) return rows;
  const actor = await getActor(ctx.token);
  if (actor?.admin) return rows;

  return rows.map((row) => {
    if (actor?.ownedStoreIds.includes(String(row.store_id))) return row;
    const pixConfigured = hasTextValue(row.pix_key);
    return {
      ...row,
      asaas_api_key: null,
      asaas_wallet_id: null,
      payment_gateway_api_key: null,
      payment_gateway_config: null,
      pix_gateway_configured: pixConfigured,
    };
  });
};

export const executeQueryPayload = async (payload: QueryPayload, ctx: QueryContext = {}) => {
  try {
    const table = ensureName(payload.table, "tabela");
    const params: unknown[] = [];
    const filters = [...(payload.filters || [])].map((filter) => appendFilterSql(table, filter, params));
    const access = await accessSql(table, payload.operation, ctx, params);
    const whereSql = [...filters, access].filter(Boolean).join(" AND ") || "TRUE";

    if (payload.operation === "select") {
      if (payload.selectOptions?.head) {
        const count = await query(`SELECT count(*)::int AS count FROM public.${quoteIdent(table)} WHERE ${whereSql}`, params);
        return { data: null, error: null, count: count.rows[0]?.count ?? 0 };
      }
      const orderSql = (payload.orders || [])
        .map((order) => {
          const direction = order.ascending === false ? "DESC" : "ASC";
          const nulls = order.nullsFirst === undefined ? "" : order.nullsFirst ? " NULLS FIRST" : " NULLS LAST";
          return `${quoteIdent(ensureName(order.column, "coluna"))} ${direction}${nulls}`;
        })
        .join(", ");
      const limitSql = payload.limit ? ` LIMIT ${Math.max(0, Number(payload.limit))}` : "";
      const result = await query(
        `SELECT ${baseColumnsSql(payload.select)} FROM public.${quoteIdent(table)} WHERE ${whereSql}${orderSql ? ` ORDER BY ${orderSql}` : ""}${limitSql}`,
        params,
      );
      const rows = await sanitizeStoreSettingsRows(table, await attachRelations(table, result.rows, payload.select), ctx);
      if (payload.single === "single" && rows.length !== 1) return { data: null, error: { message: "Registro nao encontrado ou resultado ambiguo." } };
      if (payload.single === "maybeSingle") return { data: rows[0] || null, error: null };
      if (payload.single === "single") return { data: rows[0], error: null };
      return { data: rows, error: null };
    }

    let changedRows: any[] = [];
    if (payload.operation === "insert") {
      await ensureMutationRowsAllowed(table, payload.operation, payload.values, ctx);
      changedRows = await insertRows(table, payload.values);
    }
    if (payload.operation === "update") {
      await ensureMutationRowsAllowed(table, payload.operation, payload.values, ctx);
      changedRows = await updateRows(table, payload.values, whereSql, params);
    }
    if (payload.operation === "delete") {
      await ensureMutationRowsAllowed(table, payload.operation, null, ctx);
      changedRows = await deleteRows(table, whereSql, params);
    }
    if (payload.operation === "upsert") {
      await ensureMutationRowsAllowed(table, payload.operation, payload.values, ctx);
      changedRows = await upsertRows(table, payload.values, payload.upsertOptions?.onConflict);
    }

    if (payload.operation === "insert" || payload.operation === "upsert") publishRows(table, "INSERT", changedRows);
    if (payload.operation === "update") publishRows(table, "UPDATE", changedRows);
    if (payload.operation === "delete") publishRows(table, "DELETE", changedRows);

    let data: any = payload.returning ? await attachRelations(table, changedRows, payload.select) : null;
    if (payload.single === "single" || payload.single === "maybeSingle") data = Array.isArray(data) ? data[0] || null : data;
    return { data, error: null };
  } catch (error: any) {
    return { data: null, error: { message: error?.message || "Erro no banco de dados", code: error?.code } };
  }
};
