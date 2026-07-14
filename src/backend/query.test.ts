import { describe, expect, it } from "vitest";
import {
  appendFilterSql,
  arrayCastFor,
  getColumnPgType,
  publicBaseColumnsSql,
  relationSelectSql,
  type Relation,
} from "./query";

describe("backend query SQL generation", () => {
  it("casts uuid arrays for .in filters", () => {
    const params: unknown[] = [];
    const sql = appendFilterSql("orders", {
      op: "in",
      column: "id",
      values: ["11111111-1111-4111-8111-111111111111"],
    }, params);

    expect(sql).toBe("\"id\" = ANY($1::uuid[])");
    expect(params).toEqual([["11111111-1111-4111-8111-111111111111"]]);
  });

  it("casts scalar filters so nullish browser state cannot leave PostgreSQL guessing", () => {
    const params: unknown[] = [];
    const sql = appendFilterSql("stores", {
      op: "eq",
      column: "id",
      value: "11111111-1111-4111-8111-111111111111",
    }, params);

    expect(sql).toBe("\"id\" = $1::uuid");
    expect(params).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });

  it("casts non-null .is filters", () => {
    const params: unknown[] = [];
    const sql = appendFilterSql("orders", {
      op: "is",
      column: "status",
      value: "novo",
    }, params);

    expect(sql).toBe("\"status\" IS NOT DISTINCT FROM $1::text");
  });

  it("casts text arrays for .in filters", () => {
    const params: unknown[] = [];
    const sql = appendFilterSql("orders", {
      op: "in",
      column: "status",
      values: ["novo", "confirmado"],
    }, params);

    expect(sql).toBe("\"status\" = ANY($1::text[])");
    expect(arrayCastFor("orders", "status")).toBe("text[]");
  });

  it("compiles recursive boolean filters and keeps ILIKE patterns bound", () => {
    const params: unknown[] = [];
    const sql = appendFilterSql("orders", {
      op: "or",
      filters: [
        { op: "ilike", column: "order_number", pattern: "%123%" },
        {
          op: "and",
          filters: [
            { op: "eq", column: "status", value: "novo" },
            { op: "ilike", column: "customer_name", pattern: "%maria%" },
          ],
        },
      ],
    }, params);

    expect(sql).toBe(
      '("order_number"::text ILIKE $1::text OR ("status" = $2::text AND "customer_name"::text ILIKE $3::text))',
    );
    expect(params).toEqual(["%123%", "novo", "%maria%"]);
  });

  it("rejects malformed or excessively deep filter ASTs", () => {
    expect(() => appendFilterSql("orders", { op: "or", filters: [] }, [])).toThrow("Grupo de filtros");
    let filter: any = { op: "eq", column: "status", value: "novo" };
    for (let index = 0; index < 8; index += 1) filter = { op: "and", filters: [filter] };
    expect(() => appendFilterSql("orders", filter, [])).toThrow("Profundidade maxima");
  });

  it("throws clearly for unknown .in column types", () => {
    const params: unknown[] = [];
    expect(() => appendFilterSql("stores", {
      op: "in",
      column: "custom_column",
      values: ["a", "b"],
    }, params)).toThrow("Tipo PostgreSQL nao mapeado para stores.custom_column");

    expect(params).toEqual([]);
  });

  it("casts relation loads by foreign key type", () => {
    const relation: Relation = {
      table: "order_item_options",
      local: "id",
      foreign: "order_item_id",
      localType: "uuid",
      foreignType: "uuid",
      many: true,
    };

    expect(relationSelectSql(relation, '"id", "order_item_id"')).toBe(
      "SELECT \"id\", \"order_item_id\" FROM public.\"order_item_options\" WHERE \"order_item_id\" = ANY($1::uuid[])",
    );
    expect(getColumnPgType("payments", "external_id")).toBe("text");
  });

  it("casts subscription relation loads by uuid", () => {
    const relation: Relation = {
      table: "plans",
      local: "plan_id",
      foreign: "id",
      localType: "uuid",
      foreignType: "uuid",
      many: false,
    };

    expect(relationSelectSql(relation, '"id", "name"')).toBe(
      "SELECT \"id\", \"name\" FROM public.\"plans\" WHERE \"id\" = ANY($1::uuid[])",
    );
  });

  it("uses explicit public projections and excludes confidential columns", () => {
    const storesSql = publicBaseColumnsSql("stores", "*");
    expect(storesSql).toContain('"id"');
    expect(storesSql).not.toContain('"owner_user_id"');
    expect(storesSql).not.toContain('"document"');
    expect(storesSql).not.toContain('"email"');

    const settingsSql = publicBaseColumnsSql("store_settings", "*");
    expect(settingsSql).toContain("'[configured]'");
    expect(settingsSql).toContain('AS "pix_checkout_available"');
    expect(settingsSql).not.toContain('AS "asaas_api_key"');
    expect(settingsSql).not.toContain('AS "payment_gateway_api_key"');
    expect(() => publicBaseColumnsSql("store_settings", "payment_gateway_config")).toThrow(
      "Coluna nao disponivel",
    );
  });
});
