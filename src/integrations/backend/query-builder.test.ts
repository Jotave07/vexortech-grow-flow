import { describe, expect, it, vi } from "vitest";
import type { QueryFilter, QueryPayload } from "./compat-types";
import { LocalQueryBuilder } from "./query-builder";

const createRecorder = () => {
  let payload: QueryPayload | undefined;
  const executeQuery = vi.fn(async (nextPayload: QueryPayload) => {
    payload = nextPayload;
    return { data: [], error: null };
  });

  return {
    executeQuery,
    getPayload: () => payload,
  };
};

describe("LocalQueryBuilder structured filters", () => {
  it("serializes ilike as a column and pattern instead of a raw expression", async () => {
    const recorder = createRecorder();
    const pattern = `%name' OR 1=1 --%`;

    await new LocalQueryBuilder("products", recorder.executeQuery)
      .select("id, name")
      .ilike("name", pattern)
      .execute();

    expect(recorder.getPayload()?.filters).toEqual([{ op: "ilike", column: "name", pattern }]);
  });

  it("serializes nested boolean groups for cursor pagination", async () => {
    const recorder = createRecorder();

    await new LocalQueryBuilder("orders", recorder.executeQuery)
      .or([
        { op: "lt", column: "created_at", value: "2026-07-10T12:00:00Z" },
        {
          op: "and",
          filters: [
            { op: "eq", column: "created_at", value: "2026-07-10T12:00:00Z" },
            { op: "lt", column: "id", value: "order-id" },
          ],
        },
      ])
      .execute();

    expect(recorder.getPayload()?.filters).toEqual([
      {
        op: "or",
        filters: [
          { op: "lt", column: "created_at", value: "2026-07-10T12:00:00Z" },
          {
            op: "and",
            filters: [
              { op: "eq", column: "created_at", value: "2026-07-10T12:00:00Z" },
              { op: "lt", column: "id", value: "order-id" },
            ],
          },
        ],
      },
    ]);
  });

  it("rejects raw or empty OR groups and snapshots the caller's filter array", async () => {
    const recorder = createRecorder();
    const filters: QueryFilter[] = [{ op: "eq", column: "status", value: "novo" }];
    const query = new LocalQueryBuilder("orders", recorder.executeQuery).or(filters);

    filters.push({ op: "eq", column: "status", value: "cancelado" });
    await query.execute();

    expect(recorder.getPayload()?.filters).toEqual([
      {
        op: "or",
        filters: [{ op: "eq", column: "status", value: "novo" }],
      },
    ]);
    expect(() => new LocalQueryBuilder("orders", recorder.executeQuery).or([])).toThrow(
      "O filtro .or() requer uma lista estruturada de condicoes",
    );
    expect(() =>
      new LocalQueryBuilder("orders", recorder.executeQuery).or(
        "status.eq.novo" as unknown as QueryFilter[],
      ),
    ).toThrow("O filtro .or() requer uma lista estruturada de condicoes");
  });
});
