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
  foreignType: PgScalarType;
  many: boolean;
  nested?: Record<string, Relation>;
};

export type PgScalarType = "uuid" | "text" | "numeric" | "integer" | "boolean" | "timestamptz";

const pgArrayTypeByScalar: Record<PgScalarType, string> = {
  uuid: "uuid[]",
  text: "text[]",
  numeric: "numeric[]",
  integer: "integer[]",
  boolean: "boolean[]",
  timestamptz: "timestamptz[]",
};

const uuidColumns = new Set([
  "id",
  "store_id",
  "owner_user_id",
  "user_id",
  "customer_id",
  "order_id",
  "product_id",
  "category_id",
  "option_id",
  "option_item_id",
  "order_item_id",
  "plan_id",
  "subscription_id",
  "delivery_region_id",
]);

const textColumns = new Set([
  "asaas_id",
  "external_id",
  "provider",
  "idempotency_key",
  "public_token",
  "slug",
  "code",
  "status",
  "payment_status",
  "payment_method",
  "delivery_type",
  "delivery_source",
  "role",
  "email",
  "phone",
  "document",
  "name",
  "full_name",
  "customer_name",
  "customer_phone",
  "customer_document",
  "customer_email",
  "product_name",
  "option_name",
  "item_name",
  "city",
  "state",
  "neighborhood",
  "street",
  "number",
  "complement",
  "zip_code",
  "whatsapp",
  "whatsapp_number",
  "last_error",
  "notes",
]);

const numericColumns = new Set([
  "price",
  "promo_price",
  "unit_price",
  "subtotal",
  "options_total",
  "delivery_fee",
  "discount_amount",
  "total",
  "change_for",
  "amount",
  "extra_price",
  "min_order_value",
  "min_order_amount",
  "free_delivery_above",
  "distance_km",
]);

const integerColumns = new Set([
  "order_number",
  "quantity",
  "usage_count",
  "usage_limit",
  "priority",
  "estimated_min",
  "estimated_max",
  "estimated_minutes",
  "avg_prep_time_minutes",
  "min_choices",
  "max_choices",
]);

const booleanColumns = new Set([
  "is_active",
  "is_suspended",
  "is_available",
  "is_required",
  "is_open",
  "registration_completed",
  "accept_pix",
  "accept_cash",
  "accept_card_on_delivery",
  "accept_orders_when_closed",
  "allow_pickup",
  "allow_delivery",
]);

const timestampColumns = new Set([
  "created_at",
  "updated_at",
  "paid_at",
  "expires_at",
  "deleted_at",
  "last_login",
]);

const tableColumnTypes: Record<string, Record<string, PgScalarType>> = {
  auth_users: { id: "uuid", email: "text", encrypted_password: "text", deleted_at: "timestamptz" },
  users: { id: "uuid", email: "text" },
  payments: {
    id: "uuid",
    order_id: "uuid",
    store_id: "uuid",
    external_id: "text",
    asaas_id: "text",
    idempotency_key: "text",
    status: "text",
    amount: "numeric",
    paid_at: "timestamptz",
  },
  orders: {
    id: "uuid",
    store_id: "uuid",
    customer_id: "uuid",
    coupon_id: "uuid",
    delivery_region_id: "uuid",
    public_token: "text",
    idempotency_key: "text",
    order_number: "integer",
    status: "text",
    payment_status: "text",
    payment_method: "text",
    total: "numeric",
  },
};

export const getColumnPgType = (table: string, column: string): PgScalarType | null => {
  const normalizedTable = table.replace(/^public\./, "");
  const normalizedColumn = column.trim();
  const tableOverride = tableColumnTypes[normalizedTable]?.[normalizedColumn];
  if (tableOverride) return tableOverride;
  if (uuidColumns.has(normalizedColumn)) return "uuid";
  if (textColumns.has(normalizedColumn)) return "text";
  if (numericColumns.has(normalizedColumn)) return "numeric";
  if (integerColumns.has(normalizedColumn)) return "integer";
  if (booleanColumns.has(normalizedColumn)) return "boolean";
  if (timestampColumns.has(normalizedColumn) || normalizedColumn.endsWith("_at")) return "timestamptz";
  return null;
};

export const arrayCastFor = (table: string, column: string) => {
  const type = getColumnPgType(table, column);
  return type ? pgArrayTypeByScalar[type] : null;
};

const relations: Record<string, Record<string, Relation>> = {
  stores: {
    store_settings: { table: "store_settings", local: "id", foreign: "store_id", foreignType: "uuid", many: true },
    subscriptions: {
      table: "subscriptions",
      local: "id",
      foreign: "store_id",
      foreignType: "uuid",
      many: true,
      nested: {
        plans: { table: "plans", local: "plan_id", foreign: "id", foreignType: "uuid", many: false },
      },
    },
  },
  subscriptions: {
    plans: { table: "plans", local: "plan_id", foreign: "id", foreignType: "uuid", many: false },
    stores: { table: "stores", local: "store_id", foreign: "id", foreignType: "uuid", many: false },
  },
  products: {
    categories: { table: "categories", local: "category_id", foreign: "id", foreignType: "uuid", many: false },
  },
  orders: {
    stores: { table: "stores", local: "store_id", foreign: "id", foreignType: "uuid", many: false },
  },
  order_items: {
    order_item_options: { table: "order_item_options", local: "id", foreign: "order_item_id", foreignType: "uuid", many: true },
  },
  payments: {
    orders: { table: "orders", local: "order_id", foreign: "id", foreignType: "uuid", many: false },
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
      return `${column} = $${params.length}`;
    case "neq":
      params.push(filter.value);
      return `${column} <> $${params.length}`;
    case "gt":
      params.push(filter.value);
      return `${column} > $${params.length}`;
    case "gte":
      params.push(filter.value);
      return `${column} >= $${params.length}`;
    case "lt":
      params.push(filter.value);
      return `${column} < $${params.length}`;
    case "lte":
      params.push(filter.value);
      return `${column} <= $${params.length}`;
    case "in":
      if (!filter.values.length) return "FALSE";
      {
        const arrayCast = arrayCastFor(table, filter.column);
        if (arrayCast) {
          params.push(filter.values);
          return `${column} = ANY($${params.length}::${arrayCast})`;
        }
        const placeholders = filter.values.map((value) => {
          params.push(value);
          return `$${params.length}`;
        });
        return `${column} IN (${placeholders.join(", ")})`;
      }
    case "is":
      if (filter.value === null) return `${column} IS NULL`;
      params.push(filter.value);
      return `${column} IS NOT DISTINCT FROM $${params.length}`;
    default:
      return "TRUE";
  }
};

export const relationSelectSql = (relation: Relation, paramIndex = 1) =>
  `SELECT * FROM public.${quoteIdent(relation.table)} WHERE ${quoteIdent(relation.foreign)} = ANY($${paramIndex}::${pgArrayTypeByScalar[relation.foreignType]})`;

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

const ensureMutationRowsAllowed = async (table: string, values: unknown, ctx: QueryContext) => {
  if (ctx.admin) return;
  const actor = await getActor(ctx.token);
  if (!actor) throw new Error("Nao autorizado.");
  if (actor.admin) return;
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
      return `$${params.length}`;
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
    return `${quoteIdent(ensureName(column))} = $${params.length}`;
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
      return `$${params.length}`;
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
      const rows = await attachRelations(table, result.rows, payload.select);
      if (payload.single === "single" && rows.length !== 1) return { data: null, error: { message: "Registro nao encontrado ou resultado ambiguo." } };
      if (payload.single === "maybeSingle") return { data: rows[0] || null, error: null };
      if (payload.single === "single") return { data: rows[0], error: null };
      return { data: rows, error: null };
    }

    let changedRows: any[] = [];
    if (payload.operation === "insert") {
      await ensureMutationRowsAllowed(table, payload.values, ctx);
      changedRows = await insertRows(table, payload.values);
    }
    if (payload.operation === "update") changedRows = await updateRows(table, payload.values, whereSql, params);
    if (payload.operation === "delete") changedRows = await deleteRows(table, whereSql, params);
    if (payload.operation === "upsert") {
      await ensureMutationRowsAllowed(table, payload.values, ctx);
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
