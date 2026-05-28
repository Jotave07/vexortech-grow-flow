import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const withTransactionMock = vi.fn();
const publishRealtimeMock = vi.fn();

vi.mock("./db", () => ({
  query: queryMock,
  withTransaction: withTransactionMock,
}));

vi.mock("./realtime", () => ({
  publishRealtime: publishRealtimeMock,
}));

const makeRequest = (body: any, token = "secret") =>
  new Request("http://localhost/api/webhooks/asaas", {
    method: "POST",
    headers: token ? { "asaas-access-token": token } : {},
    body: JSON.stringify(body),
  });

describe("Asaas webhook", () => {
  const oldEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    queryMock.mockReset();
    withTransactionMock.mockReset();
    publishRealtimeMock.mockReset();
    process.env = { ...oldEnv, NODE_ENV: "test", ASAAS_WEBHOOK_SECRET: "secret" };
  });

  afterEach(() => {
    process.env = oldEnv;
  });

  it("rejects production webhooks when the secret is missing", async () => {
    process.env.NODE_ENV = "production";
    process.env.JWT_SECRET = "a".repeat(40);
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    delete process.env.ASAAS_WEBHOOK_SECRET;
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(makeRequest({
      event: "PAYMENT_CONFIRMED",
      payment: { id: "pay_1", externalReference: "order-1" },
    }, ""));

    expect(response.status).toBe(500);
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("confirms a matching payment and writes history once", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT p.*, o.id AS order_exists")) {
          return { rows: [{ id: "local-payment", order_id: "order-1", store_id: "store-1", status: "pendente", order_total: 42.5 }] };
        }
        if (sql.includes("UPDATE public.payments")) return { rows: [{ id: "local-payment", status: "pago" }] };
        if (sql.includes("UPDATE public.orders")) return { rows: [{ id: "order-1", status: "novo" }] };
        return { rows: [] };
      }),
    };
    withTransactionMock.mockImplementation(async (fn: any) => fn(client));
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(makeRequest({
      event: "PAYMENT_CONFIRMED",
      payment: { id: "pay_1", externalReference: "order-1", value: 42.5 },
    }));

    expect(response.status).toBe(200);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO public.order_status_history"), ["order-1", "store-1"]);
    expect(publishRealtimeMock).toHaveBeenCalled();
  });

  it("acknowledges subscription-only events without interrupting the webhook queue", async () => {
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(makeRequest({
      event: "SUBSCRIPTION_UPDATED",
      subscription: { id: "sub_1", status: "ACTIVE" },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, ignored: true, subscription: true });
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("is idempotent when receiving the same paid event twice", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT p.*, o.id AS order_exists")) {
          return { rows: [{ id: "local-payment", order_id: "order-1", store_id: "store-1", status: "pago", order_total: 42.5 }] };
        }
        if (sql.includes("UPDATE public.payments")) return { rows: [{ id: "local-payment", status: "pago" }] };
        if (sql.includes("UPDATE public.orders")) return { rows: [{ id: "order-1", status: "novo" }] };
        return { rows: [] };
      }),
    };
    withTransactionMock.mockImplementation(async (fn: any) => fn(client));
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(makeRequest({
      event: "PAYMENT_CONFIRMED",
      payment: { id: "pay_1", externalReference: "order-1", value: 42.5 },
    }));

    expect(response.status).toBe(200);
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO public.order_status_history"), expect.any(Array));
  });

  it("does not mark an order as paid when Asaas value diverges", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT p.*, o.id AS order_exists")) {
          return { rows: [{ id: "local-payment", order_id: "order-1", store_id: "store-1", status: "pendente", order_total: 42.5 }] };
        }
        return { rows: [] };
      }),
    };
    withTransactionMock.mockImplementation(async (fn: any) => fn(client));
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(makeRequest({
      event: "PAYMENT_CONFIRMED",
      payment: { id: "pay_1", externalReference: "order-1", value: 10 },
    }));

    expect(response.status).toBe(200);
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("last_error"), expect.arrayContaining(["local-payment"]));
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining("SET status = 'novo'"), expect.any(Array));
  });
});
