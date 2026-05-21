import { describe, expect, it } from "vitest";
import { appendFilterSql, arrayCastFor, getColumnPgType, relationSelectSql, type Relation } from "./query";

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

    expect(relationSelectSql(relation)).toBe(
      "SELECT * FROM public.\"order_item_options\" WHERE \"order_item_id\" = ANY($1::uuid[])",
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

    expect(relationSelectSql(relation)).toBe(
      "SELECT * FROM public.\"plans\" WHERE \"id\" = ANY($1::uuid[])",
    );
  });
});
