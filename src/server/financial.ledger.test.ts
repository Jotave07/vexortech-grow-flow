import { describe, expect, it, vi } from "vitest";

import { updateMovementStatus } from "./financial.ledger";

describe("financial ledger monotonic transitions", () => {
  it("protege CONFIRMADO contra downgrade e permite DONE posterior promover FALHOU", async () => {
    const client = {
      query: vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] })),
    };

    await updateMovementStatus(
      { idempotencyKey: "REPASSE_ORDER_order-1" },
      { status: "FALHOU" },
      client,
    );

    const sql = String(client.query.mock.calls[0]?.[0]);
    expect(sql).toContain("status = $2");
    expect(sql).toContain(
      "status = 'PROCESSANDO' AND $2 IN ('CONFIRMADO','FALHOU','CANCELADO')",
    );
    expect(sql).toContain(
      "status = 'FALHOU' AND $2 IN ('PROCESSANDO','CONFIRMADO','CANCELADO')",
    );
    expect(sql).toContain("status = 'CANCELADO' AND $2 = 'CONFIRMADO'");
    expect(sql).not.toContain("status = 'CONFIRMADO' AND $2 = 'FALHOU'");
  });
});
