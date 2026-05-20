import type { QueryFilter, QueryPayload } from "@/integrations/supabase/compat-types";
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

type Relation = {
  table: string;
  local: string;
  foreign: string;
  many: boolean;
  nested?: Record<string, Relation>;
};

const relations: Record<string, Record<string, Relation>> = {
  stores: {
    store_settings: { table: "store_settings", local: "id", foreign: "store_id", many: true },
    subscriptions: {
      table: "subscriptions",
      local: "id",
      foreign: "store_id",
      many: true,
      nested: {
        plans: { table: "plans", local: "plan_id", foreign: "id", many: false },
      },
    },
  },
  subscriptions: {
    plans: { table: "plans", local: "plan_id", foreign: "id", many: false },
    stores: { table: "stores", local: "store_id", foreign: "id", many: false },
  },
  products: {
    categories: { table: "categories", local: "category_id", foreign: "id", many: false },
  },
  orders: {
    stores: { table: "stores", local: "store_id", foreign: "id", many: false },
  },
  order_items: {
    order_item_options: { table: "order_item_options", local: "id", foreign: "order_item_id", many: true },
  },
  payments: {
    orders: { table: "orders", local: "order_id", foreign: "id", many: false },
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

const appendFilterSql = (filter: QueryFilter, params: unknown[]) => {
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
      params.push(filter.values);
      return `${column} = ANY($${params.length})`;
    case "is":
      if (filter.value === null) return `${column} IS NULL`;
      params.push(filter.value);
      return `${column} IS NOT DISTINCT FROM $${params.length}`;
    default:
      return "TRUE";
  }
};

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
  params.push(actor.user.id);
  const userParam = `$${params.length}`;
  params.push(owned);
  const storesParam = `$${params.length}`;

  if (table === "stores") {
    return mutating
      ? `${quoteIdent("owner_user_id")} = ${userParam}`
      : `(${quoteIdent("owner_user_id")} = ${userParam} OR (COALESCE(${quoteIdent("is_active")}, true) IS TRUE AND COALESCE(${quoteIdent("is_suspended")}, false) IS FALSE))`;
  }
  if (table === "profiles") return `(${quoteIdent("user_id")} = ${userParam} OR ${quoteIdent("store_id")} = ANY(${storesParam}::uuid[]))`;
  if (table === "user_roles") return `(${quoteIdent("user_id")} = ${userParam} OR ${quoteIdent("store_id")} = ANY(${storesParam}::uuid[]))`;
  if (table === "customer_addresses" || table === "customer_favorites") return `${quoteIdent("user_id")} = ${userParam}`;
  if (storeIdTables.has(table)) {
    if (!mutating && publicReadable.has(table)) return "TRUE";
    if (table === "customers") return `(${quoteIdent("user_id")} = ${userParam} OR ${quoteIdent("store_id")} = ANY(${storesParam}::uuid[]))`;
    if (table === "orders") {
      return `(${quoteIdent("store_id")} = ANY(${storesParam}::uuid[]) OR EXISTS (SELECT 1 FROM public.customers c WHERE c.id = ${quoteIdent("customer_id")} AND c.user_id = ${userParam}))`;
    }
    if (table === "order_items") {
      return `(${quoteIdent("store_id")} = ANY(${storesParam}::uuid[]) OR EXISTS (
        SELECT 1 FROM public.orders o
        JOIN public.customers c ON c.id = o.customer_id
        WHERE o.id = ${quoteIdent("order_id")} AND c.user_id = ${userParam}
      ))`;
    }
    if (table === "payments") {
      return `(${quoteIdent("store_id")} = ANY(${storesParam}::uuid[]) OR EXISTS (
        SELECT 1 FROM public.orders o
        JOIN public.customers c ON c.id = o.customer_id
        WHERE o.id = ${quoteIdent("order_id")} AND c.user_id = ${userParam}
      ))`;
    }
    return `${quoteIdent("store_id")} = ANY(${storesParam}::uuid[])`;
  }
  if (table === "product_options") {
    if (!mutating) return "TRUE";
    return `EXISTS (SELECT 1 FROM public.products p WHERE p.id = ${quoteIdent("product_id")} AND p.store_id = ANY(${storesParam}::uuid[]))`;
  }
  if (table === "product_option_items") {
    if (!mutating) return "TRUE";
    return `EXISTS (
      SELECT 1 FROM public.product_options po
      JOIN public.products p ON p.id = po.product_id
      WHERE po.id = ${quoteIdent("option_id")} AND p.store_id = ANY(${storesParam}::uuid[])
    )`;
  }
  if (table === "order_item_options") {
    return `EXISTS (
      SELECT 1 FROM public.order_items oi
      LEFT JOIN public.orders o ON o.id = oi.order_id
      LEFT JOIN public.customers c ON c.id = o.customer_id
      WHERE oi.id = ${quoteIdent("order_item_id")}
        AND (oi.store_id = ANY(${storesParam}::uuid[]) OR c.user_id = ${userParam})
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
    if (table === "orders" && row.customer_id) {
      const { rows: customers } = await query(`SELECT id FROM public.customers WHERE id = $1 AND user_id = $2`, [row.customer_id, actor.user.id]);
      if (customers[0]) continue;
    }
    if ((table === "order_items" || table === "payments") && row.order_id) {
      const { rows: orders } = await query(
        `SELECT o.id
         FROM public.orders o
         LEFT JOIN public.customers c ON c.id = o.customer_id
         WHERE o.id = $1 AND (o.store_id = ANY($2::uuid[]) OR c.user_id = $3)`,
        [row.order_id, actor.ownedStoreIds, actor.user.id],
      );
      if (orders[0]) continue;
    }
    if (table === "order_item_options" && row.order_item_id) {
      const { rows: items } = await query(
        `SELECT oi.id
         FROM public.order_items oi
         LEFT JOIN public.orders o ON o.id = oi.order_id
         LEFT JOIN public.customers c ON c.id = o.customer_id
         WHERE oi.id = $1 AND (oi.store_id = ANY($2::uuid[]) OR c.user_id = $3)`,
        [row.order_item_id, actor.ownedStoreIds, actor.user.id],
      );
      if (items[0]) continue;
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

const insertRows = async (table: string, values: unknown, returning: boolean) => {
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
  return returning ? result.rows : [];
};

const updateRows = async (table: string, values: any, whereSql: string, params: unknown[], returning: boolean) => {
  const entries = Object.entries(values || {});
  if (!entries.length) return [];
  const setSql = entries.map(([column, value]) => {
    params.push(value);
    return `${quoteIdent(ensureName(column))} = $${params.length}`;
  });
  const sql = `UPDATE public.${quoteIdent(table)} SET ${setSql.join(", ")} WHERE ${whereSql} RETURNING *`;
  const result = await query(sql, params);
  return returning ? result.rows : [];
};

const deleteRows = async (table: string, whereSql: string, params: unknown[], returning: boolean) => {
  const result = await query(`DELETE FROM public.${quoteIdent(table)} WHERE ${whereSql} RETURNING *`, params);
  return returning ? result.rows : [];
};

const upsertRows = async (table: string, values: unknown, onConflict?: string, returning = false) => {
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
  const sql = `INSERT INTO public.${quoteIdent(table)} (${columns.map((column) => quoteIdent(ensureName(column))).join(", ")})
    VALUES ${valueSql.join(", ")}
    ON CONFLICT (${conflictColumns.map(quoteIdent).join(", ")})
    DO UPDATE SET ${updateColumns.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(", ")}
    RETURNING *`;
  const result = await query(sql, params);
  return returning ? result.rows : [];
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
    const { rows: relatedRows } = await query(
      `SELECT * FROM public.${quoteIdent(relation.table)} WHERE ${quoteIdent(relation.foreign)} = ANY($1)`,
      [localValues],
    );
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
    const { rows: nestedRows } = await query(`SELECT * FROM public.${quoteIdent(relation.table)} WHERE ${quoteIdent(relation.foreign)} = ANY($1)`, [localValues]);
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
    const filters = [...(payload.filters || [])].map((filter) => appendFilterSql(filter, params));
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
      changedRows = await insertRows(table, payload.values, Boolean(payload.returning));
    }
    if (payload.operation === "update") changedRows = await updateRows(table, payload.values, whereSql, params, Boolean(payload.returning));
    if (payload.operation === "delete") changedRows = await deleteRows(table, whereSql, params, Boolean(payload.returning));
    if (payload.operation === "upsert") {
      await ensureMutationRowsAllowed(table, payload.values, ctx);
      changedRows = await upsertRows(table, payload.values, payload.upsertOptions?.onConflict, Boolean(payload.returning));
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
