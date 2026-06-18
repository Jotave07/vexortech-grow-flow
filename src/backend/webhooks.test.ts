import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const withTransactionMock = vi.fn();
const publishRealtimeMock = vi.fn();
const storeId = "11111111-1111-4111-8111-111111111111";

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
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    process.env.PUBLIC_APP_URL = "https://example.com";
    process.env.ASAAS_ENVIRONMENT = "production";
    process.env.EVOLUTION_API_URL = "https://evolution.example.com";
    process.env.EVOLUTION_API_KEY = "test";
    process.env.EVOLUTION_INSTANCE = "hype";
    process.env.EVOLUTION_AUTOMATION_PHONE = "5511999999999";
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

  it("revokes a platform subscription on refund without touching the order transaction", async () => {
    const revokedRow = {
      id: "sub-1",
      store_id: storeId,
      status: "cancelada",
      external_reference: `platform-subscription:${storeId}`,
    };
    queryMock.mockResolvedValue({ rows: [revokedRow] });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(makeRequest({
      event: "PAYMENT_REFUNDED",
      payment: { id: "pay_1", externalReference: `platform-subscription:${storeId}`, value: 99 },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, subscription: true });
    // O UPDATE de revogacao recebe o flag de revoke=true como ultimo parametro ($7).
    const updateCall = queryMock.mock.calls.find(([sql]) => String(sql).includes("UPDATE public.subscriptions"));
    expect(updateCall).toBeTruthy();
    expect(updateCall?.[1]?.[6]).toBe(true);
    expect(updateCall?.[1]?.[7]).toBe(storeId);
    expect(withTransactionMock).not.toHaveBeenCalled();
    expect(publishRealtimeMock).toHaveBeenCalled();
  });

  it("revokes a platform subscription on chargeback request", async () => {
    queryMock.mockResolvedValue({ rows: [{ id: "sub-1", store_id: storeId, status: "cancelada" }] });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(makeRequest({
      event: "PAYMENT_CHARGEBACK_REQUESTED",
      payment: { id: "pay_2", externalReference: `platform-subscription:${storeId}`, value: 99 },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, subscription: true });
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("returns 500 so Asaas can retry when subscription update fails", async () => {
    queryMock.mockRejectedValueOnce(new Error("database unavailable"));
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(makeRequest({
      event: "PAYMENT_CONFIRMED",
      payment: { id: "pay_3", externalReference: `platform-subscription:${storeId}`, value: 99 },
    }));

    expect(response.status).toBe(500);
    expect(withTransactionMock).not.toHaveBeenCalled();
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
