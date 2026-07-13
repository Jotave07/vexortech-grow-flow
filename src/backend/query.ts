import type { QueryFilter, QueryPayload } from "@/integrations/backend/compat-types";
import { query, quoteIdent, withTransaction } from "./db";
import { assertActiveMerchantSubscription, getActor } from "./auth";
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

export type PgScalarType =
  | "uuid"
  | "text"
  | "numeric"
  | "integer"
  | "boolean"
  | "timestamptz"
  | "jsonb";

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
    plan_id: "uuid",
    status: "text",
    font_family: "text",
    payment_methods: "jsonb",
    phone: "text",
    whatsapp: "text",
    whatsapp_number: "text",
    is_active: "boolean",
    is_suspended: "boolean",
    created_at: "timestamptz",
    updated_at: "timestamptz",
  },
  store_settings: {
    id: "uuid",
    store_id: "uuid",
    address: "text",
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
    accept_card_online: "boolean",
    accept_orders_when_closed: "boolean",
    is_open: "boolean",
    delivery_radius_km: "numeric",
    delivery_base_fee: "numeric",
    delivery_fee_per_km: "numeric",
    delivery_distance_rules: "jsonb",
    delivery_message: "text",
    excluded_neighborhoods: "jsonb",
    min_order_value: "numeric",
    min_order_amount: "numeric",
    free_delivery_above: "numeric",
    avg_prep_time_minutes: "integer",
    business_hours: "jsonb",
    next_opening_time: "text",
    payment_methods: "jsonb",
    whatsapp_number: "text",
    payment_instructions: "text",
    updated_at: "timestamptz",
  },
  products: {
    id: "uuid",
    store_id: "uuid",
    category_id: "uuid",
    name: "text",
    description: "text",
    image_url: "text",
    is_active: "boolean",
    is_available: "boolean",
    is_featured: "boolean",
    price: "numeric",
    promo_price: "numeric",
    prep_time_minutes: "integer",
    sort_order: "integer",
    created_at: "timestamptz",
    updated_at: "timestamptz",
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
    cancel_reason: "text",
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
    delivery_city: "text",
    delivery_neighborhood: "text",
    delivery_reference: "text",
    delivery_state: "text",
    delivery_zip_code: "text",
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
    estimated_delivery_at: "timestamptz",
    estimated_ready_at: "timestamptz",
    is_seen: "boolean",
    refused_reason: "text",
    scheduled_at: "timestamptz",
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
    internal_notes: "text",
    min_fee: "numeric",
    max_fee: "numeric",
    min_order: "numeric",
    base_prep_time: "integer",
    minutes_per_km: "numeric",
    additional_region_time: "integer",
    priority: "integer",
  },
  delivery_drivers: {
    id: "uuid",
    store_id: "uuid",
    name: "text",
    phone: "text",
    vehicle_type: "text",
    is_active: "boolean",
    created_at: "timestamptz",
    updated_at: "timestamptz",
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
    billing_type: "text",
    canceled_at: "timestamptz",
    cancellation_effective_at: "timestamptz",
    trial_ends_at: "timestamptz",
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
    avatar_url: "text",
    is_exempt: "boolean",
    billing_exemption_pending: "boolean",
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
    label: "text",
    street: "text",
    number: "text",
    complement: "text",
    neighborhood: "text",
    city: "text",
    state: "text",
    zip_code: "text",
    latitude: "numeric",
    longitude: "numeric",
    is_default: "boolean",
    created_at: "timestamptz",
    updated_at: "timestamptz",
  },
  customer_favorites: {
    id: "uuid",
    user_id: "uuid",
    store_id: "uuid",
  },
  users: {
    id: "uuid",
    email: "text",
  },
  store_reviews: {
    id: "uuid",
    store_id: "uuid",
    user_id: "uuid",
    order_id: "uuid",
    rating: "integer",
    comment: "text",
    is_visible: "boolean",
    created_at: "timestamptz",
    updated_at: "timestamptz",
  },
  audit_logs: {
    id: "uuid",
    actor_user_id: "uuid",
    store_id: "uuid",
    action: "text",
    entity_type: "text",
    entity_id: "text",
    metadata: "jsonb",
    created_at: "timestamptz",
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
    store_settings: {
      table: "store_settings",
      local: "id",
      foreign: "store_id",
      localType: "uuid",
      foreignType: "uuid",
      many: true,
    },
    subscriptions: {
      table: "subscriptions",
      local: "id",
      foreign: "store_id",
      localType: "uuid",
      foreignType: "uuid",
      many: true,
      nested: {
        plans: {
          table: "plans",
          local: "plan_id",
          foreign: "id",
          localType: "uuid",
          foreignType: "uuid",
          many: false,
        },
      },
    },
  },
  subscriptions: {
    plans: {
      table: "plans",
      local: "plan_id",
      foreign: "id",
      localType: "uuid",
      foreignType: "uuid",
      many: false,
    },
    stores: {
      table: "stores",
      local: "store_id",
      foreign: "id",
      localType: "uuid",
      foreignType: "uuid",
      many: false,
    },
  },
  products: {
    categories: {
      table: "categories",
      local: "category_id",
      foreign: "id",
      localType: "uuid",
      foreignType: "uuid",
      many: false,
    },
  },
  orders: {
    stores: {
      table: "stores",
      local: "store_id",
      foreign: "id",
      localType: "uuid",
      foreignType: "uuid",
      many: false,
    },
  },
  order_items: {
    order_item_options: {
      table: "order_item_options",
      local: "id",
      foreign: "order_item_id",
      localType: "uuid",
      foreignType: "uuid",
      many: true,
    },
  },
  payments: {
    orders: {
      table: "orders",
      local: "order_id",
      foreign: "id",
      localType: "uuid",
      foreignType: "uuid",
      many: false,
    },
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

const MAX_FILTER_DEPTH = 6;
const MAX_FILTER_NODES = 100;
const MAX_IN_FILTER_VALUES = 1_000;
const MAX_ILIKE_PATTERN_LENGTH = 500;

type FilterCompileState = {
  depth: number;
  nodes: number;
};

type QueryActor = NonNullable<Awaited<ReturnType<typeof getActor>>>;
type QueryExecutor = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export const appendFilterSql = (
  table: string,
  filter: QueryFilter,
  params: unknown[],
  state: FilterCompileState = { depth: 0, nodes: 0 },
): string => {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    throw new Error("Filtro invalido.");
  }
  state.nodes += 1;
  if (state.nodes > MAX_FILTER_NODES) throw new Error("Quantidade maxima de filtros excedida.");

  if (filter.op === "and" || filter.op === "or") {
    if (state.depth >= MAX_FILTER_DEPTH)
      throw new Error("Profundidade maxima de filtros excedida.");
    if (!Array.isArray(filter.filters) || filter.filters.length === 0) {
      throw new Error("Grupo de filtros vazio ou invalido.");
    }
    const operator = filter.op === "and" ? " AND " : " OR ";
    const childState: FilterCompileState = { ...state, depth: state.depth + 1 };
    const compiled: string[] = filter.filters.map((child): string =>
      appendFilterSql(table, child, params, childState),
    );
    state.nodes = childState.nodes;
    return `(${compiled.join(operator)})`;
  }

  if (!("column" in filter) || typeof filter.column !== "string") {
    throw new Error("Coluna de filtro invalida.");
  }
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
      if (!Array.isArray(filter.values)) throw new Error("Valores do filtro IN invalidos.");
      if (!filter.values.length) return "FALSE";
      if (filter.values.length > MAX_IN_FILTER_VALUES)
        throw new Error("Filtro IN excede o limite de valores.");
      {
        const arrayCast = arrayCastFor(table, filter.column);
        params.push(filter.values);
        return `${column} = ANY($${params.length}::${arrayCast})`;
      }
    case "is":
      if (filter.value === null) return `${column} IS NULL`;
      params.push(filter.value);
      return `${column} IS NOT DISTINCT FROM ${typedParamSql(table, filter.column, params.length)}`;
    case "ilike":
      if (typeof filter.pattern !== "string" || filter.pattern.length > MAX_ILIKE_PATTERN_LENGTH) {
        throw new Error("Padrao ILIKE invalido.");
      }
      params.push(filter.pattern);
      // Text casting preserves the existing search behavior for numeric fields
      // such as orders.order_number while the pattern remains a bound value.
      return `${column}::text ILIKE $${params.length}::text`;
    default:
      throw new Error("Operador de filtro invalido.");
  }
};

export const relationSelectSql = (relation: Relation, columnsSql: string, paramIndex = 1) =>
  `SELECT ${columnsSql} FROM public.${quoteIdent(relation.table)} WHERE ${quoteIdent(relation.foreign)} = ANY($${paramIndex}::${pgArrayCast(relation.foreignType)})`;

const publicReadable = new Set([
  "stores",
  "store_settings",
  "categories",
  "products",
  "product_options",
  "product_option_items",
  "delivery_zones",
  "plans",
  "store_reviews",
]);

const publicSelectColumns: Record<string, readonly string[]> = {
  stores: [
    "id",
    "name",
    "public_name",
    "slug",
    "description",
    "store_type",
    "phone",
    "whatsapp",
    "whatsapp_number",
    "logo_url",
    "cover_url",
    "address",
    "address_number",
    "address_complement",
    "neighborhood",
    "zip_code",
    "city",
    "state",
    "latitude",
    "longitude",
    "primary_color",
    "secondary_color",
    "font_family",
    "payment_methods",
    "delivery_fee",
    "min_order_amount",
    "is_active",
    "is_suspended",
    "is_verified",
    "status",
    "created_at",
    "updated_at",
  ],
  store_settings: [
    "id",
    "store_id",
    "address",
    "allow_delivery",
    "allow_pickup",
    "accept_pix",
    "accept_cash",
    "accept_card_on_delivery",
    "accept_card_online",
    "accept_orders_when_closed",
    "is_open",
    "delivery_radius_km",
    "delivery_base_fee",
    "delivery_fee",
    "delivery_fee_per_km",
    "delivery_distance_rules",
    "delivery_message",
    "excluded_neighborhoods",
    "min_order_value",
    "min_order_amount",
    "free_delivery_above",
    "avg_prep_time_minutes",
    "business_hours",
    "next_opening_time",
    "payment_methods",
    "payment_instructions",
    "whatsapp_number",
    "pix_key",
    "pix_key_type",
    "created_at",
    "updated_at",
  ],
  categories: ["id", "store_id", "name", "description", "sort_order", "is_active", "created_at"],
  products: [
    "id",
    "store_id",
    "category_id",
    "name",
    "description",
    "price",
    "promo_price",
    "image_url",
    "is_active",
    "is_available",
    "is_featured",
    "prep_time_minutes",
    "sort_order",
    "created_at",
    "updated_at",
  ],
  product_options: [
    "id",
    "product_id",
    "name",
    "is_required",
    "min_choices",
    "max_choices",
    "sort_order",
    "created_at",
  ],
  product_option_items: [
    "id",
    "option_id",
    "name",
    "extra_price",
    "is_active",
    "sort_order",
    "created_at",
  ],
  delivery_zones: [
    "id",
    "store_id",
    "name",
    "city",
    "state",
    "neighborhood",
    "zip_start",
    "zip_end",
    "fee",
    "fee_per_km",
    "min_fee",
    "max_fee",
    "min_order",
    "estimated_minutes",
    "max_radius_km",
    "base_prep_time",
    "minutes_per_km",
    "additional_region_time",
    "priority",
    "is_active",
    "created_at",
  ],
  coupons: [
    "id",
    "store_id",
    "code",
    "discount_type",
    "discount_value",
    "min_order_value",
    "max_discount_amount",
    "usage_count",
    "usage_limit",
    "expires_at",
    "is_active",
    "created_at",
  ],
  plans: [
    "id",
    "name",
    "slug",
    "description",
    "price_monthly",
    "features",
    "max_products",
    "max_orders_per_month",
    "allows_coupons",
    "allows_advanced_reports",
    "allows_custom_branding",
    "is_active",
    "sort_order",
    "created_at",
  ],
  store_reviews: ["id", "store_id", "rating", "comment", "is_visible", "created_at", "updated_at"],
};

const publicFilterExtraColumns: Record<string, ReadonlySet<string>> = {
  store_reviews: new Set(["order_id"]),
};

const neverFilterAsNonAdmin: Record<string, ReadonlySet<string>> = {
  stores: new Set(["document", "email", "verification_notes"]),
  store_settings: new Set([
    "asaas_api_key",
    "asaas_wallet_id",
    "payment_gateway_api_key",
    "payment_gateway_config",
    "pix_key",
  ]),
  delivery_zones: new Set(["internal_notes"]),
};

const publicColumnSql = (table: string, column: string) => {
  if (table === "store_settings" && column === "pix_key") {
    return `CASE WHEN NULLIF(btrim(${quoteIdent(column)}), '') IS NULL THEN NULL ELSE '[configured]' END AS ${quoteIdent(column)}`;
  }
  return quoteIdent(ensureName(column, "coluna"));
};

const requestedBaseColumns = (select = "*") =>
  splitTopLevel(select)
    .filter((item) => !item.includes("("))
    .map((item) => item.trim());

export const publicBaseColumnsSql = (table: string, select = "*") => {
  const allowed = publicSelectColumns[table];
  if (!allowed) throw new Error(`Tabela sem projecao publica: ${table}.`);
  const requested = requestedBaseColumns(select);
  const columns = !requested.length || requested.includes("*") ? [...allowed] : requested;
  const unsafe = columns.find((column) => !allowed.includes(column));
  if (unsafe) throw new Error(`Coluna nao disponivel na projecao publica: ${table}.${unsafe}.`);
  return columns.map((column) => publicColumnSql(table, column)).join(", ");
};

const storeIdTables = new Set([
  "store_settings",
  "categories",
  "products",
  "delivery_zones",
  "delivery_drivers",
  "coupons",
  "customers",
  "orders",
  "order_items",
  "payments",
  "subscriptions",
  "order_status_history",
]);

const platformAdminRoles = new Set(["admin", "super_admin"]);
const assignableNonAdminRoles = new Set([
  "customer",
  "store_owner",
  "store_manager",
  "store_attendant",
]);
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
  "status",
]);

const isPrivilegedContext = (ctx: QueryContext, actor: QueryActor | null) =>
  Boolean(ctx.admin || actor?.admin);

const mayReadOwnedPublicRows = (actor: QueryActor | null) => Boolean(actor?.ownedStoreIds.length);

const shouldUseStrictPublicProjection = (
  table: string,
  ctx: QueryContext,
  actor: QueryActor | null,
) =>
  publicReadable.has(table) && !isPrivilegedContext(ctx, actor) && !mayReadOwnedPublicRows(actor);

const filterGuaranteesOwnedScope = (table: string, filter: any, actor: QueryActor): boolean => {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) return false;
  if (filter.op === "and") {
    return (
      Array.isArray(filter.filters) &&
      filter.filters.some((child: any) => filterGuaranteesOwnedScope(table, child, actor))
    );
  }
  if (filter.op === "or") {
    return (
      Array.isArray(filter.filters) &&
      filter.filters.length > 0 &&
      filter.filters.every((child: any) => filterGuaranteesOwnedScope(table, child, actor))
    );
  }

  if (table === "stores" && filter.column === "owner_user_id") {
    return filter.op === "eq" && String(filter.value || "") === actor.user.id;
  }
  const tenantColumn = table === "stores" ? "id" : "store_id";
  if (filter.column !== tenantColumn) return false;
  if (filter.op === "eq") return actor.ownedStoreIds.includes(String(filter.value || ""));
  if (filter.op === "in" && Array.isArray(filter.values) && filter.values.length > 0) {
    return filter.values.every((value: unknown) =>
      actor.ownedStoreIds.includes(String(value || "")),
    );
  }
  return false;
};

const shouldUseStrictPublicProjectionForPayload = (
  table: string,
  payload: QueryPayload,
  ctx: QueryContext,
  actor: QueryActor | null,
) => {
  if (!publicReadable.has(table) || isPrivilegedContext(ctx, actor)) return false;
  if (!actor?.ownedStoreIds.length) return true;
  return !(payload.filters || []).some((filter) =>
    filterGuaranteesOwnedScope(table, filter, actor),
  );
};

const isPrivateRowForActor = (
  table: string,
  row: Record<string, unknown>,
  actor: QueryActor | null,
) => {
  if (!actor) return false;
  if (actor.admin) return true;
  if (table === "stores") {
    return (
      actor.ownedStoreIds.includes(String(row.id || "")) ||
      String(row.owner_user_id || "") === actor.user.id
    );
  }
  return Boolean(row.store_id && actor.ownedStoreIds.includes(String(row.store_id)));
};

const projectPublicRow = (table: string, row: Record<string, any>) => {
  const allowed = publicSelectColumns[table];
  if (!allowed) return {};
  const projected: Record<string, any> = {};
  for (const column of allowed) {
    if (!(column in row)) continue;
    if (table === "store_settings" && column === "pix_key") {
      projected.pix_key = hasTextValue(row.pix_key) ? "[configured]" : null;
      projected.pix_gateway_configured = hasTextValue(row.pix_key);
    } else {
      projected[column] = row[column];
    }
  }
  for (const [relationName, relation] of Object.entries(relations[table] || {})) {
    if (publicReadable.has(relation.table) && relationName in row)
      projected[relationName] = row[relationName];
  }
  return projected;
};

const sanitizeRowsForActor = (
  table: string,
  rows: any[],
  ctx: QueryContext,
  actor: QueryActor | null,
) => {
  if (isPrivilegedContext(ctx, actor) || !publicReadable.has(table)) return rows;
  return rows.map((row) =>
    isPrivateRowForActor(table, row, actor) ? row : projectPublicRow(table, row),
  );
};

const visitAtomicFilters = (
  filters: unknown,
  visit: (filter: any) => void,
  state: FilterCompileState = { depth: 0, nodes: 0 },
): void => {
  if (!Array.isArray(filters)) throw new Error("Lista de filtros invalida.");
  for (const filter of filters) {
    if (!filter || typeof filter !== "object" || Array.isArray(filter))
      throw new Error("Filtro invalido.");
    state.nodes += 1;
    if (state.nodes > MAX_FILTER_NODES) throw new Error("Quantidade maxima de filtros excedida.");
    if (filter.op === "and" || filter.op === "or") {
      if (state.depth >= MAX_FILTER_DEPTH)
        throw new Error("Profundidade maxima de filtros excedida.");
      if (!Array.isArray(filter.filters) || filter.filters.length === 0)
        throw new Error("Grupo de filtros vazio ou invalido.");
      const childState: FilterCompileState = { ...state, depth: state.depth + 1 };
      visitAtomicFilters(filter.filters, visit, childState);
      state.nodes = childState.nodes;
    } else {
      visit(filter);
    }
  }
};

const assertSafeReadShape = (
  table: string,
  payload: QueryPayload,
  ctx: QueryContext,
  actor: QueryActor | null,
) => {
  if (isPrivilegedContext(ctx, actor)) return;
  const strictPublic = shouldUseStrictPublicProjectionForPayload(table, payload, ctx, actor);
  const allowedPublicFilters = new Set([
    ...(publicSelectColumns[table] || []),
    ...(publicFilterExtraColumns[table] || []),
  ]);

  visitAtomicFilters(payload.filters || [], (filter) => {
    if (typeof filter.column !== "string") throw new Error("Coluna de filtro invalida.");
    const column = ensureName(filter.column, "coluna");
    if (neverFilterAsNonAdmin[table]?.has(column)) {
      throw new Error(`Filtro nao permitido para ${table}.${column}.`);
    }
    if (table === "stores" && column === "owner_user_id") {
      if (!actor || filter.op !== "eq" || String(filter.value || "") !== actor.user.id) {
        throw new Error("Filtro por proprietario nao autorizado.");
      }
      return;
    }
    if (strictPublic && !allowedPublicFilters.has(column)) {
      throw new Error(`Filtro nao disponivel na consulta publica: ${table}.${column}.`);
    }
  });

  if (strictPublic) {
    for (const order of payload.orders || []) {
      const column = ensureName(String(order?.column || ""), "coluna");
      if (!allowedPublicFilters.has(column)) {
        throw new Error(`Ordenacao nao disponivel na consulta publica: ${table}.${column}.`);
      }
    }
  }
};

const accessSql = (
  table: string,
  operation: QueryPayload["operation"],
  ctx: QueryContext,
  params: unknown[],
  actor: QueryActor | null,
) => {
  if (ctx.admin) return "TRUE";
  if (actor?.admin) return "TRUE";

  const mutating = operation !== "select";
  if (!actor) {
    if (!mutating && publicReadable.has(table)) {
      if (table === "stores")
        return `(COALESCE(${quoteIdent("is_active")}, true) IS TRUE AND COALESCE(${quoteIdent("is_suspended")}, false) IS FALSE)`;
      if (
        [
          "categories",
          "products",
          "product_option_items",
          "delivery_zones",
          "coupons",
          "plans",
        ].includes(table)
      ) {
        return `COALESCE(${quoteIdent("is_active")}, true) IS TRUE`;
      }
      if (table === "store_reviews") return `COALESCE(${quoteIdent("is_visible")}, true) IS TRUE`;
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
  if (table === "profiles")
    return `(${quoteIdent("user_id")} = ${userSql()} OR ${quoteIdent("store_id")} = ANY(${storesSql()}::uuid[]))`;
  if (table === "user_roles")
    return `(${quoteIdent("user_id")} = ${userSql()} OR ${quoteIdent("store_id")} = ANY(${storesSql()}::uuid[]))`;
  if (table === "customer_addresses" || table === "customer_favorites")
    return `${quoteIdent("user_id")} = ${userSql()}`;
  if (table === "store_reviews") {
    if (!mutating) return `COALESCE(${quoteIdent("is_visible")}, true) IS TRUE`;
    return `(${quoteIdent("user_id")} = ${userSql()} OR ${quoteIdent("store_id")} = ANY(${storesSql()}::uuid[]))`;
  }
  if (storeIdTables.has(table)) {
    if (!mutating && publicReadable.has(table)) return "TRUE";
    if (table === "customers")
      return `(${quoteIdent("user_id")} = ${userSql()} OR ${quoteIdent("store_id")} = ANY(${storesSql()}::uuid[]))`;
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

const normalizeRows = (values: unknown) =>
  (Array.isArray(values) ? values : [values]).filter(Boolean) as Record<string, unknown>[];

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

export const assertSafePatchForNonAdmin = (
  table: string,
  operation: QueryPayload["operation"],
  values: unknown,
) => {
  if (table === "orders") {
    if (operation === "update" && onlyColumns(values, ["is_seen"])) return;
    throw new Error("Use funcoes seguras para alterar pedidos.");
  }
  if (serverManagedTables.has(table)) {
    throw new Error("Use funcoes seguras para alterar dados financeiros e operacionais.");
  }

  const columns = changedColumns(values);
  if (table === "stores") {
    const blocked = columns.find(
      (column) =>
        protectedStoreColumns.has(column) &&
        !(operation === "insert" && column === "owner_user_id"),
    );
    if (blocked) throw new Error(`Campo de loja protegido: ${blocked}.`);
  }

  if (table === "profiles" || table === "user_roles") {
    for (const row of normalizeRows(values)) assertAssignableRole(row.role);
  }

  if (
    table === "profiles" &&
    columns.some((column) => ["is_exempt", "billing_exemption_pending"].includes(column))
  ) {
    throw new Error("Isencao de assinatura so pode ser alterada por admin da plataforma.");
  }
};

const ensureMutationRowsAllowed = async (
  table: string,
  operation: QueryPayload["operation"],
  values: unknown,
  ctx: QueryContext,
  actor: QueryActor | null,
) => {
  if (ctx.admin) return;
  if (!actor) throw new Error("Nao autorizado.");
  if (actor.admin) return;
  assertSafePatchForNonAdmin(table, operation, values);
  if (operation !== "insert" && operation !== "upsert" && operation !== "update") return;

  const rows = normalizeRows(values);
  const ownsStore = (storeId: unknown) =>
    !!storeId && actor.ownedStoreIds.includes(String(storeId));

  for (const row of rows) {
    // WITH CHECK equivalent for tenant/ownership columns. The WHERE predicate
    // protects the old row; these checks protect the proposed new row.
    if (table === "stores" && row.owner_user_id && String(row.owner_user_id) !== actor.user.id) {
      throw new Error("Loja pertence a outro usuario.");
    }
    if (
      (table === "customer_addresses" || table === "customer_favorites") &&
      row.user_id !== undefined
    ) {
      if (row.user_id !== null && String(row.user_id) !== actor.user.id) {
        throw new Error("Registro de cliente fora do escopo do usuario.");
      }
    }
    if (
      storeIdTables.has(table) &&
      row.store_id !== undefined &&
      row.store_id !== null &&
      !ownsStore(row.store_id)
    ) {
      throw new Error("Tenant da operacao nao pertence ao usuario.");
    }
    if (
      (table === "profiles" || table === "user_roles") &&
      row.store_id !== undefined &&
      row.store_id !== null
    ) {
      if (!ownsStore(row.store_id))
        throw new Error("Perfil/papel aponta para uma loja fora do escopo do usuario.");
    }
    if (
      (table === "profiles" || table === "user_roles") &&
      row.user_id !== undefined &&
      row.user_id !== null
    ) {
      if (String(row.user_id) !== actor.user.id && !ownsStore(row.store_id)) {
        throw new Error("Perfil/papel fora do escopo do usuario.");
      }
    }

    if (operation === "update") {
      if (table === "product_options" && row.product_id) {
        const { rows: products } = await query(
          `SELECT id FROM public.products WHERE id = $1 AND store_id = ANY($2::uuid[])`,
          [row.product_id, actor.ownedStoreIds],
        );
        if (!products[0]) throw new Error("Produto fora do escopo do usuario.");
      }
      if (table === "product_option_items" && row.option_id) {
        const { rows: options } = await query(
          `SELECT po.id
           FROM public.product_options po
           JOIN public.products p ON p.id = po.product_id
           WHERE po.id = $1 AND p.store_id = ANY($2::uuid[])`,
          [row.option_id, actor.ownedStoreIds],
        );
        if (!options[0]) throw new Error("Opcao fora do escopo do usuario.");
      }
      continue;
    }

    if (table === "stores") {
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
    if (table === "store_reviews") {
      if (operation !== "insert" && operation !== "upsert")
        throw new Error("Avaliacao nao pode ser alterada por este usuario.");
      const rating = Number(row.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5)
        throw new Error("Avaliacao deve estar entre 1 e 5.");
      if (!row.order_id || !row.store_id)
        throw new Error("Pedido e loja sao obrigatorios para avaliar.");
      row.user_id = actor.user.id;
      row.is_visible = row.is_visible ?? true;
      const { rows: orders } = await query(
        `SELECT o.id
         FROM public.orders o
         JOIN public.customers c ON c.id = o.customer_id
         WHERE o.id = $1
           AND o.store_id = $2
           AND c.user_id = $3
           AND o.status = 'entregue'
         LIMIT 1`,
        [row.order_id, row.store_id, actor.user.id],
      );
      if (orders[0]) continue;
      throw new Error("Avaliacao permitida apenas apos entrega do seu pedido.");
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
      const { rows: products } = await query(
        `SELECT id FROM public.products WHERE id = $1 AND store_id = ANY($2::uuid[])`,
        [row.product_id, actor.ownedStoreIds],
      );
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

const insertRows = async (table: string, values: unknown, execute: QueryExecutor) => {
  const rows = normalizeRows(values);
  if (!rows.length) return [];
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  if (!columns.length) throw new Error("Insercao sem colunas nao e permitida.");
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
  const result = await execute(sql, params);
  return result.rows;
};

const updateRows = async (
  table: string,
  values: any,
  whereSql: string,
  params: unknown[],
  execute: QueryExecutor,
) => {
  const entries = Object.entries(values || {});
  if (!entries.length) return [];
  const setSql = entries.map(([column, value]) => {
    params.push(value);
    return `${quoteIdent(ensureName(column))} = ${typedParamSql(table, column, params.length)}`;
  });
  const sql = `UPDATE public.${quoteIdent(table)} SET ${setSql.join(", ")} WHERE ${whereSql} RETURNING *`;
  const result = await execute(sql, params);
  return result.rows;
};

const deleteRows = async (
  table: string,
  whereSql: string,
  params: unknown[],
  execute: QueryExecutor,
) => {
  const result = await execute(
    `DELETE FROM public.${quoteIdent(table)} WHERE ${whereSql} RETURNING *`,
    params,
  );
  return result.rows;
};

const upsertRows = async (
  table: string,
  values: unknown,
  onConflict: string | undefined,
  privileged: boolean,
  execute: QueryExecutor,
) => {
  const rows = normalizeRows(values);
  if (!rows.length) return [];
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).map((column) =>
    ensureName(column),
  );
  if (!columns.length) throw new Error("Upsert sem colunas nao e permitido.");
  const conflictColumns = (onConflict || "id")
    .split(",")
    .map((column) => ensureName(column.trim()))
    .filter(Boolean);
  if (
    !conflictColumns.length ||
    conflictColumns.length > 4 ||
    new Set(conflictColumns).size !== conflictColumns.length
  ) {
    throw new Error("Colunas de conflito invalidas.");
  }
  if (!privileged && (table !== "store_reviews" || conflictColumns.join(",") !== "order_id")) {
    throw new Error("Upsert nao permitido para esta tabela ou chave de conflito.");
  }
  const params: unknown[] = [];
  const valueSql = rows.map((row) => {
    const placeholders = columns.map((column) => {
      params.push(row[column] ?? null);
      return typedParamSql(table, column, params.length);
    });
    return `(${placeholders.join(", ")})`;
  });
  const immutableColumns = privileged
    ? new Set<string>()
    : new Set([
        "id",
        "store_id",
        "user_id",
        "owner_user_id",
        "order_id",
        "product_id",
        "option_id",
        "order_item_id",
      ]);
  const updateColumns = columns.filter(
    (column) => !conflictColumns.includes(column) && !immutableColumns.has(column),
  );
  const tenantGuard =
    !privileged && table === "store_reviews"
      ? ` WHERE target.${quoteIdent("user_id")} = EXCLUDED.${quoteIdent("user_id")}
          AND target.${quoteIdent("store_id")} = EXCLUDED.${quoteIdent("store_id")}`
      : "";
  const conflictAction = updateColumns.length
    ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(", ")}${tenantGuard}`
    : "DO NOTHING";
  const sql = `INSERT INTO public.${quoteIdent(table)} AS target (${columns.map(quoteIdent).join(", ")})
    VALUES ${valueSql.join(", ")}
    ON CONFLICT (${conflictColumns.map(quoteIdent).join(", ")})
    ${conflictAction}
    RETURNING *`;
  const result = await execute(sql, params);
  return result.rows;
};

const assertPostMutationAccess = async (
  table: string,
  rows: any[],
  operation: QueryPayload["operation"],
  values: unknown,
  ctx: QueryContext,
  actor: QueryActor | null,
  execute: QueryExecutor,
) => {
  if (!rows.length || isPrivilegedContext(ctx, actor)) return;
  const safeProfileDetach =
    table === "profiles" &&
    operation === "update" &&
    onlyColumns(values, ["store_id"]) &&
    normalizeRows(values).every((row) => row.store_id === null) &&
    rows.every((row) => row.store_id === null);
  if (safeProfileDetach) return;
  const ids = Array.from(new Set(rows.map((row) => row.id).filter(Boolean)));
  if (ids.length !== rows.length) throw new Error("Nao foi possivel validar o escopo da mutacao.");
  const params: unknown[] = [ids];
  const postCheck = accessSql(table, "update", ctx, params, actor);
  const { rows: allowedRows } = await execute(
    `SELECT id FROM public.${quoteIdent(table)} WHERE id = ANY($1::uuid[]) AND (${postCheck})`,
    params,
  );
  const allowedIds = new Set(allowedRows.map((row) => String(row.id)));
  if (ids.some((id) => !allowedIds.has(String(id)))) {
    throw new Error("Mutacao rejeitada: o registro resultante saiu do escopo autorizado.");
  }
};

const assertBillingMutationUsesServerFunction = (
  table: string,
  operation: QueryPayload["operation"],
  values: unknown,
) => {
  if (operation === "select") return;
  const columns = changedColumns(values);
  if (serverManagedTables.has(table)) {
    throw new Error("Use uma funcao segura para alterar dados financeiros e operacionais.");
  }
  if (
    table === "profiles" &&
    columns.some((column) => ["is_exempt", "billing_exemption_pending"].includes(column))
  ) {
    throw new Error("Use a funcao administrativa de cortesia.");
  }
  if (table === "stores" && columns.some((column) => protectedStoreColumns.has(column))) {
    throw new Error("Use a funcao administrativa de loja ou assinatura.");
  }
};

const relationColumnsSql = (
  relation: Relation,
  select: string,
  ctx: QueryContext,
  actor: QueryActor | null,
  forcePublic = false,
) => {
  const requested = requestedBaseColumns(select);
  const projection =
    forcePublic || shouldUseStrictPublicProjection(relation.table, ctx, actor)
      ? publicBaseColumnsSql(relation.table, select)
      : baseColumnsSql(select);
  if (projection === "*") return projection;

  const projectedNames = new Set(requested);
  const required = new Set<string>([relation.foreign]);
  for (const nestedSelection of parseRelationSelections(select)) {
    const nested = relation.nested?.[nestedSelection.name];
    if (nested) required.add(nested.local);
  }
  const missing = [...required].filter(
    (column) => !projectedNames.has("*") && !projectedNames.has(column),
  );
  if (!missing.length) return projection;
  return `${projection}, ${missing.map((column) => quoteIdent(ensureName(column))).join(", ")}`;
};

const relationParentRows = (
  table: string,
  relationName: string,
  rows: any[],
  ctx: QueryContext,
  actor: QueryActor | null,
) => {
  if (isPrivilegedContext(ctx, actor)) return rows;
  if (table === "stores" && relationName === "subscriptions") {
    return rows.filter((row) => isPrivateRowForActor(table, row, actor));
  }
  return rows;
};

const attachRelations = async (
  table: string,
  rows: any[],
  select = "*",
  ctx: QueryContext,
  actor: QueryActor | null,
) => {
  if (!rows.length) return rows;
  const selections = parseRelationSelections(select);
  if (!selections.length) return rows;
  const tableRelations = relations[table] || {};

  for (const selection of selections) {
    const relation = tableRelations[selection.name];
    if (!relation) continue;
    const eligibleRows = relationParentRows(table, selection.name, rows, ctx, actor);
    const eligibleSet = new Set(eligibleRows);
    for (const row of rows) {
      if (!eligibleSet.has(row)) row[selection.name] = relation.many ? [] : null;
    }
    const localValues = Array.from(
      new Set(eligibleRows.map((row) => row[relation.local]).filter(Boolean)),
    );
    if (!localValues.length) continue;
    const forcePublicProjection =
      !isPrivilegedContext(ctx, actor) && table === "stores" && selection.name === "store_settings";
    const columnsSql = relationColumnsSql(
      relation,
      selection.select,
      ctx,
      actor,
      forcePublicProjection,
    );
    const { rows: loadedRows } = await query(relationSelectSql(relation, columnsSql), [
      localValues,
    ]);
    await attachNestedRelations(relation, loadedRows, selection.select, ctx, actor);
    const relatedRows = sanitizeRowsForActor(relation.table, loadedRows, ctx, actor);
    const byForeignValue = new Map<string, any[]>();
    for (const related of relatedRows) {
      const key = String(related[relation.foreign] ?? "");
      const matches = byForeignValue.get(key) || [];
      matches.push(related);
      byForeignValue.set(key, matches);
    }
    for (const row of eligibleRows) {
      const matches = byForeignValue.get(String(row[relation.local] ?? "")) || [];
      row[selection.name] = relation.many ? matches : matches[0] || null;
    }
  }

  return rows;
};

const attachNestedRelations = async (
  parentRelation: Relation,
  rows: any[],
  select: string,
  ctx: QueryContext,
  actor: QueryActor | null,
) => {
  const selections = parseRelationSelections(select);
  if (!rows.length || !selections.length || !parentRelation.nested) return;
  for (const selection of selections) {
    const relation = parentRelation.nested[selection.name];
    if (!relation) continue;
    const localValues = Array.from(new Set(rows.map((row) => row[relation.local]).filter(Boolean)));
    if (!localValues.length) continue;
    const columnsSql = relationColumnsSql(relation, selection.select, ctx, actor);
    const { rows: loadedRows } = await query(relationSelectSql(relation, columnsSql), [
      localValues,
    ]);
    const nestedRows = sanitizeRowsForActor(relation.table, loadedRows, ctx, actor);
    const byForeignValue = new Map<string, any[]>();
    for (const nested of nestedRows) {
      const key = String(nested[relation.foreign] ?? "");
      const matches = byForeignValue.get(key) || [];
      matches.push(nested);
      byForeignValue.set(key, matches);
    }
    for (const row of rows) {
      const matches = byForeignValue.get(String(row[relation.local] ?? "")) || [];
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

const merchantSubscriptionTables = new Set([
  "stores",
  "store_settings",
  "categories",
  "products",
  "product_options",
  "product_option_items",
  "coupons",
  "delivery_zones",
  "delivery_drivers",
  "profiles",
  "user_roles",
  "orders",
]);

const requestedMutationStoreId = (payload: QueryPayload) => {
  const row = normalizeRows(payload.values)[0];
  if (row?.store_id) return String(row.store_id);
  const filter = (payload.filters || []).find(
    (candidate) => candidate.op === "eq" && candidate.column === "store_id",
  );
  return filter && "value" in filter ? String(filter.value || "") : undefined;
};

export const executeQueryPayload = async (payload: QueryPayload, ctx: QueryContext = {}) => {
  try {
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new Error("Consulta invalida.");
    if (!["select", "insert", "update", "delete", "upsert"].includes(payload.operation)) {
      throw new Error("Operacao de consulta invalida.");
    }
    const table = ensureName(payload.table, "tabela");
    if (!ctx.admin) {
      assertBillingMutationUsesServerFunction(table, payload.operation, payload.values);
    }
    const actor = ctx.admin ? null : await getActor(ctx.token);
    if (payload.operation !== "select" && actor && merchantSubscriptionTables.has(table)) {
      await assertActiveMerchantSubscription(actor, requestedMutationStoreId(payload));
    }
    assertSafeReadShape(table, payload, ctx, actor);
    const params: unknown[] = [];
    const filterState: FilterCompileState = { depth: 0, nodes: 0 };
    const filters = [...(payload.filters || [])].map((filter) =>
      appendFilterSql(table, filter, params, filterState),
    );
    const access = accessSql(table, payload.operation, ctx, params, actor);
    const whereSql = [...filters, access].filter(Boolean).join(" AND ") || "TRUE";

    if (payload.operation === "select") {
      if (payload.selectOptions?.head) {
        const count = await query(
          `SELECT count(*)::int AS count FROM public.${quoteIdent(table)} WHERE ${whereSql}`,
          params,
        );
        return { data: null, error: null, count: count.rows[0]?.count ?? 0 };
      }
      const orderSql = (payload.orders || [])
        .map((order) => {
          const direction = order.ascending === false ? "DESC" : "ASC";
          const nulls =
            order.nullsFirst === undefined ? "" : order.nullsFirst ? " NULLS FIRST" : " NULLS LAST";
          return `${quoteIdent(ensureName(order.column, "coluna"))} ${direction}${nulls}`;
        })
        .join(", ");
      const requestedLimit = payload.limit === undefined ? null : Number(payload.limit);
      if (
        requestedLimit !== null &&
        (!Number.isSafeInteger(requestedLimit) || requestedLimit < 0)
      ) {
        throw new Error("Limite de consulta invalido.");
      }
      const maximumLimit = isPrivilegedContext(ctx, actor) ? 10_000 : 5_000;
      const effectiveLimit =
        requestedLimit === null
          ? isPrivilegedContext(ctx, actor)
            ? null
            : maximumLimit
          : Math.min(requestedLimit, maximumLimit);
      const limitSql = effectiveLimit === null ? "" : ` LIMIT ${effectiveLimit}`;
      const columnsSql = shouldUseStrictPublicProjectionForPayload(table, payload, ctx, actor)
        ? publicBaseColumnsSql(table, payload.select)
        : baseColumnsSql(payload.select);
      const result = await query(
        `SELECT ${columnsSql} FROM public.${quoteIdent(table)} WHERE ${whereSql}${orderSql ? ` ORDER BY ${orderSql}` : ""}${limitSql}`,
        params,
      );
      const rowsWithRelations = await attachRelations(
        table,
        result.rows,
        payload.select,
        ctx,
        actor,
      );
      const rows = sanitizeRowsForActor(table, rowsWithRelations, ctx, actor);
      if (payload.single === "single" && rows.length !== 1)
        return { data: null, error: { message: "Registro nao encontrado ou resultado ambiguo." } };
      if (payload.single === "maybeSingle" && rows.length > 1)
        return {
          data: null,
          error: { message: "Resultado ambiguo: mais de um registro encontrado." },
        };
      if (payload.single === "maybeSingle") return { data: rows[0] || null, error: null };
      if (payload.single === "single") return { data: rows[0], error: null };
      return { data: rows, error: null };
    }

    await ensureMutationRowsAllowed(table, payload.operation, payload.values, ctx, actor);
    const changedRows = await withTransaction(async (client) => {
      const execute: QueryExecutor = (text, values = []) => client.query(text, values);
      let rows: any[] = [];
      if (payload.operation === "insert") rows = await insertRows(table, payload.values, execute);
      if (payload.operation === "update")
        rows = await updateRows(table, payload.values, whereSql, params, execute);
      if (payload.operation === "delete") rows = await deleteRows(table, whereSql, params, execute);
      if (payload.operation === "upsert") {
        rows = await upsertRows(
          table,
          payload.values,
          payload.upsertOptions?.onConflict,
          isPrivilegedContext(ctx, actor),
          execute,
        );
      }
      if (payload.operation !== "delete") {
        await assertPostMutationAccess(
          table,
          rows,
          payload.operation,
          payload.values,
          ctx,
          actor,
          execute,
        );
      }
      return rows;
    });

    if (payload.operation === "insert" || payload.operation === "upsert")
      publishRows(table, "INSERT", changedRows);
    if (payload.operation === "update") publishRows(table, "UPDATE", changedRows);
    if (payload.operation === "delete") publishRows(table, "DELETE", changedRows);

    let data: any = payload.returning
      ? sanitizeRowsForActor(
          table,
          await attachRelations(table, changedRows, payload.select, ctx, actor),
          ctx,
          actor,
        )
      : null;
    if (payload.single === "single" || payload.single === "maybeSingle")
      data = Array.isArray(data) ? data[0] || null : data;
    return { data, error: null };
  } catch (error: any) {
    return {
      data: null,
      error: { message: error?.message || "Erro no banco de dados", code: error?.code },
    };
  }
};
