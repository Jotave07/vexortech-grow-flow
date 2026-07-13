import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const withTransactionMock = vi.fn();
const publishRealtimeMock = vi.fn();
const cancelSubscriptionMock = vi.fn();
const updateSubscriptionMock = vi.fn();
const getSubscriptionMock = vi.fn();
const storeId = "11111111-1111-4111-8111-111111111111";
const eventRowId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const successfulClaimQuery = async (sql: string) => {
  if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
  return { rows: [] };
};

vi.mock("./db", () => ({
  query: queryMock,
  withTransaction: withTransactionMock,
}));

vi.mock("./realtime", () => ({
  publishRealtime: publishRealtimeMock,
}));

vi.mock("@/server/asaas.server", () => ({
  asaas: {
    cancelSubscription: cancelSubscriptionMock,
    getSubscription: getSubscriptionMock,
    updateSubscription: updateSubscriptionMock,
  },
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
    cancelSubscriptionMock.mockReset();
    updateSubscriptionMock.mockReset();
    getSubscriptionMock.mockReset();
    cancelSubscriptionMock.mockResolvedValue({ success: true });
    updateSubscriptionMock.mockResolvedValue({ success: true });
    getSubscriptionMock.mockResolvedValue({ status: "ACTIVE", nextDueDate: "2026-08-15" });
    process.env = { ...oldEnv, NODE_ENV: "test", ASAAS_WEBHOOK_SECRET: "secret" };
    queryMock.mockImplementation(successfulClaimQuery);
    withTransactionMock.mockImplementation(async (fn: any) => fn({ query: queryMock }));
  });

  afterEach(() => {
    process.env = oldEnv;
  });

  it("rejects production webhooks when the secret is missing", async () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    process.env.SUPABASE_SECRET_KEY = "test-private-key-without-provider-prefix";
    process.env.PUBLIC_APP_URL = "https://example.com";
    process.env.ASAAS_ENVIRONMENT = "production";
    process.env.EVOLUTION_API_URL = "https://evolution.example.com";
    process.env.EVOLUTION_API_KEY = "test";
    process.env.EVOLUTION_INSTANCE = "hype";
    process.env.EVOLUTION_AUTOMATION_PHONE = "5511999999999";
    delete process.env.ASAAS_WEBHOOK_SECRET;
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest(
        {
          event: "PAYMENT_CONFIRMED",
          payment: { id: "pay_1", externalReference: "order-1" },
        },
        "",
      ),
    );

    expect(response.status).toBe(500);
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("confirms a matching payment and writes history once", async () => {
    queryMock.mockImplementation(successfulClaimQuery);
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT p.*, o.id AS order_exists")) {
          return {
            rows: [
              {
                id: "local-payment",
                order_id: "order-1",
                store_id: "store-1",
                status: "pendente",
                order_total: 42.5,
              },
            ],
          };
        }
        if (sql.includes("UPDATE public.payments"))
          return { rows: [{ id: "local-payment", status: "pago" }] };
        if (sql.includes("UPDATE public.orders"))
          return { rows: [{ id: "order-1", status: "novo" }] };
        return { rows: [] };
      }),
    };
    withTransactionMock.mockImplementation(async (fn: any) => fn(client));
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        event: "PAYMENT_CONFIRMED",
        payment: { id: "pay_1", externalReference: "order-1", value: 42.5 },
      }),
    );

    expect(response.status).toBe(200);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO public.order_status_history"),
      ["order-1", "store-1"],
    );
    expect(publishRealtimeMock).toHaveBeenCalled();
  });

  it("acknowledges subscription-only events without interrupting the webhook queue", async () => {
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        event: "SUBSCRIPTION_UPDATED",
        subscription: { id: "sub_1", status: "ACTIVE" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, ignored: true, subscription: true });
    expect(withTransactionMock).not.toHaveBeenCalled();
    expect(
      queryMock.mock.calls.some(([sql]) => String(sql).includes("UPDATE public.subscriptions")),
    ).toBe(false);
  });

  it.each(["SUBSCRIPTION_INACTIVATED", "SUBSCRIPTION_DELETED"])(
    "closes a local subscription on %s while preserving its paid period",
    async (event) => {
      let committed = false;
      withTransactionMock.mockImplementation(async (fn: any) => {
        const result = await fn({ query: queryMock });
        expect(publishRealtimeMock).not.toHaveBeenCalled();
        committed = true;
        return result;
      });
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes("INSERT INTO public.payment_events"))
          return { rows: [{ id: eventRowId }] };
        if (sql.includes("UPDATE public.subscriptions s")) {
          return {
            rows: [
              {
                store_id: storeId,
                retired_gateway_id: false,
                dispute_pause_ack: false,
                subscription_row: {
                  id: "local-subscription",
                  store_id: storeId,
                  status: "cancelada",
                  current_period_end: "2026-08-01T00:00:00.000Z",
                },
              },
            ],
          };
        }
        return { rows: [] };
      });
      const { handleAsaasWebhook } = await import("./webhooks");

      const response = await handleAsaasWebhook(
        makeRequest({
          id: `evt_${event.toLowerCase()}`,
          event,
          dateCreated: "2026-07-13T12:00:00Z",
          subscription: {
            id: "sub_1",
            status: "INACTIVE",
            externalReference: `platform-subscription:${storeId}`,
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        success: true,
        subscription: true,
        terminal: true,
        updated: true,
      });
      const updateCall = queryMock.mock.calls.find(([sql]) =>
        String(sql).includes("UPDATE public.subscriptions s"),
      );
      expect(updateCall?.[0]).toContain("s.current_period_end");
      expect(updateCall?.[1]).toEqual([
        "sub_1",
        storeId,
        `platform-subscription:${storeId}`,
        "2026-07-13T12:00:00.000Z",
        event === "SUBSCRIPTION_INACTIVATED",
        event === "SUBSCRIPTION_DELETED",
      ]);
      expect(committed).toBe(true);
      expect(publishRealtimeMock).toHaveBeenCalledTimes(1);
      expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock"), [
        `subscription:${storeId}`,
      ]);
    },
  );

  it("acknowledges a terminal lifecycle event for a retired subscription id", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("UPDATE public.subscriptions s")) {
        return {
          rows: [
            {
              store_id: storeId,
              retired_gateway_id: true,
              dispute_pause_ack: false,
              subscription_row: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_retired_lifecycle",
        event: "SUBSCRIPTION_DELETED",
        subscription: {
          id: "sub_retired",
          status: "INACTIVE",
          externalReference: `platform-subscription:${storeId}`,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      subscription: true,
      terminal: true,
      retired: true,
      ignored: true,
      updated: false,
    });
    expect(publishRealtimeMock).not.toHaveBeenCalled();
  });

  it("acknowledges lifecycle inactivation caused by a chargeback pause", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("UPDATE public.subscriptions s")) {
        return {
          rows: [
            {
              store_id: storeId,
              retired_gateway_id: false,
              dispute_pause_ack: true,
              subscription_row: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_dispute_pause_inactivated",
        event: "SUBSCRIPTION_INACTIVATED",
        subscription: {
          id: "asaas-subscription",
          status: "INACTIVE",
          externalReference: `platform-subscription:${storeId}`,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      terminal: true,
      disputePause: true,
      ignored: true,
      updated: false,
    });
    expect(publishRealtimeMock).not.toHaveBeenCalled();
  });

  it("ignores a delayed inactivation emitted before a newer paid recovery", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("UPDATE public.subscriptions s")) {
        return {
          rows: [
            {
              store_id: storeId,
              retired_gateway_id: false,
              dispute_pause_ack: false,
              stale_recovery_ack: true,
              ambiguous_inactivation: false,
              subscription_row: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_delayed_dispute_pause",
        event: "SUBSCRIPTION_INACTIVATED",
        dateCreated: "2026-07-14T12:00:00Z",
        subscription: {
          id: "asaas-subscription",
          status: "INACTIVE",
          externalReference: `platform-subscription:${storeId}`,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      terminal: true,
      staleRecovery: true,
      ignored: true,
      updated: false,
      reason: "stale_after_recovery",
    });
    const lifecycleCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes("stale_recovery_ack"),
    );
    expect(lifecycleCall?.[0]).toContain("$4::timestamptz <= s.last_payment_event_at");
    expect(lifecycleCall?.[0]).toContain("lower(COALESCE(s.status, '')) = 'ativa'");
    expect(lifecycleCall?.[0]).toContain(
      "s.last_payment_event_type IN ('PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED')",
    );
    expect(publishRealtimeMock).not.toHaveBeenCalled();
  });

  it("fails closed for an unowned inactivation without a trustworthy timestamp", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("UPDATE public.subscriptions s")) {
        return {
          rows: [
            {
              store_id: storeId,
              retired_gateway_id: false,
              dispute_pause_ack: false,
              stale_recovery_ack: false,
              ambiguous_inactivation: true,
              subscription_row: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_ambiguous_inactivation",
        event: "SUBSCRIPTION_INACTIVATED",
        subscription: {
          id: "asaas-subscription",
          status: "INACTIVE",
          externalReference: `platform-subscription:${storeId}`,
        },
      }),
    );

    expect(response.status).toBe(500);
    expect(
      queryMock.mock.calls.some(
        ([sql, params]) =>
          String(sql).includes("processing_error = $3") &&
          params?.[2] === "subscription inactivation has no trustworthy event timestamp",
      ),
    ).toBe(true);
    expect(publishRealtimeMock).not.toHaveBeenCalled();
  });

  it("keeps SUBSCRIPTION_DELETED terminal even when dateCreated is absent", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("UPDATE public.subscriptions s")) {
        return {
          rows: [
            {
              store_id: storeId,
              retired_gateway_id: false,
              dispute_pause_ack: false,
              stale_recovery_ack: false,
              ambiguous_inactivation: false,
              subscription_row: {
                id: "local-subscription",
                store_id: storeId,
                status: "cancelada",
              },
            },
          ],
        };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_deleted_without_timestamp",
        event: "SUBSCRIPTION_DELETED",
        subscription: {
          id: "asaas-subscription",
          status: "INACTIVE",
          externalReference: `platform-subscription:${storeId}`,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      terminal: true,
      ignored: false,
      updated: true,
    });
    const lifecycleUpdate = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes("gateway_action_pending = CASE"),
    );
    expect(lifecycleUpdate?.[0]).toContain("IN ('ACTIVE', 'INACTIVE')");
    expect(lifecycleUpdate?.[0]).toContain("$6::boolean");
    expect(lifecycleUpdate?.[1]?.[5]).toBe(true);
    expect(publishRealtimeMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a terminal lifecycle event cannot be mapped locally", async () => {
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_unknown_terminal_subscription",
        event: "SUBSCRIPTION_DELETED",
        subscription: { id: "sub_unknown", status: "INACTIVE" },
      }),
    );

    expect(response.status).toBe(500);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes("processing_error"))).toBe(
      true,
    );
  });

  it("activates a platform subscription only when the paid value matches the plan in cents", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("WITH target AS")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              status: "ativa",
              expected_cents: 9900,
              amount_mismatch: false,
              terminal_blocked: false,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        event: "PAYMENT_CONFIRMED",
        payment: {
          id: "pay_subscription",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );
    const body = await response.json();

    expect(body).toMatchObject({
      success: true,
      subscription: true,
      updated: true,
      ignored: false,
    });
    const updateCall = queryMock.mock.calls.find(([sql]) => String(sql).includes("WITH target AS"));
    expect(updateCall?.[0]).toContain(
      "round(COALESCE(s.contract_price_monthly, p.price_monthly) * 100)::bigint",
    );
    expect(updateCall?.[1]?.[9]).toBe(9900);
  });

  it.each([
    ["lower", 10, 1000],
    ["missing", undefined, null],
  ])(
    "does not activate a platform subscription when the paid value is %s",
    async (_label, value, expectedParam) => {
      queryMock.mockImplementation(async (sql: string) => {
        if (sql.includes("INSERT INTO public.payment_events"))
          return { rows: [{ id: eventRowId }] };
        if (sql.includes("WITH target AS")) {
          return {
            rows: [
              {
                id: "local-subscription",
                store_id: storeId,
                status: "inadimplente",
                expected_cents: 9900,
                amount_mismatch: true,
                terminal_blocked: false,
              },
            ],
          };
        }
        return { rows: [] };
      });
      const { handleAsaasWebhook } = await import("./webhooks");

      const response = await handleAsaasWebhook(
        makeRequest({
          event: "PAYMENT_CONFIRMED",
          payment: {
            id: "pay_subscription",
            externalReference: `platform-subscription:${storeId}`,
            value,
          },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        success: true,
        subscription: true,
        updated: false,
        ignored: true,
        reason: "payment_value_mismatch",
      });
      const updateCall = queryMock.mock.calls.find(([sql]) =>
        String(sql).includes("WITH target AS"),
      );
      expect(updateCall?.[0]).toContain("THEN 'inadimplente'");
      expect(updateCall?.[1]?.[9]).toBe(expectedParam);
    },
  );

  it("does not reactivate a canceled subscription from a later paid webhook", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("WITH target AS")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              status: "cancelada",
              canceled_at: "2026-07-13T10:00:00.000Z",
              expected_cents: 9900,
              amount_mismatch: false,
              terminal_blocked: true,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay_old",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );
    const body = await response.json();

    expect(body).toMatchObject({
      success: true,
      subscription: true,
      updated: false,
      ignored: true,
      reason: "terminal_subscription",
    });
  });

  it("recovers a disputed subscription after a newer confirmed payment event", async () => {
    getSubscriptionMock.mockResolvedValueOnce({
      status: "INACTIVE",
      nextDueDate: "2026-08-15",
    });
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("WITH target AS")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              status: "ativa",
              asaas_subscription_id: "asaas-subscription",
              gateway_action_pending: "ACTIVE",
              next_due_date: "2026-08-15",
              expected_cents: 9900,
              amount_mismatch: false,
              terminal_blocked: false,
            },
          ],
        };
      }
      if (sql.includes("gateway_action_pending = NULL")) {
        return { rows: [{ id: "local-subscription" }] };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_chargeback_recovered",
        event: "PAYMENT_CONFIRMED",
        dateCreated: "2026-07-15T12:00:00Z",
        payment: {
          id: "pay_subscription",
          subscription: "asaas-subscription",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ updated: true, ignored: false });
    const updateCall = queryMock.mock.calls.find(([sql]) => String(sql).includes("WITH target AS"));
    expect(updateCall?.[0]).not.toContain("'em_disputa') AS is_terminal");
    expect(updateCall?.[1]?.[0]).toBe("ativa");
    expect(updateSubscriptionMock).toHaveBeenCalledWith("asaas-subscription", {
      status: "ACTIVE",
      nextDueDate: "2026-08-15",
    });
  });

  it("acks an ACTIVE webhook replay already applied without moving the gateway due date", async () => {
    getSubscriptionMock.mockResolvedValueOnce({
      status: "ACTIVE",
      nextDueDate: "2026-07-15",
    });
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("WITH target AS")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              status: "ativa",
              asaas_subscription_id: "asaas-subscription",
              gateway_action_pending: "ACTIVE",
              next_due_date: "2026-07-15",
              expected_cents: 9900,
              amount_mismatch: false,
              terminal_blocked: false,
            },
          ],
        };
      }
      if (sql.includes("gateway_action_pending = NULL")) {
        return { rows: [{ id: "local-subscription" }] };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_active_replay",
        event: "PAYMENT_CONFIRMED",
        dateCreated: "2026-07-15T12:00:00Z",
        payment: {
          id: "pay_active_replay",
          subscription: "asaas-subscription",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(
      queryMock.mock.calls.some(([sql]) => String(sql).includes("gateway_action_pending = NULL")),
    ).toBe(true);
  });

  it("ends an expired gateway subscription instead of retrying an ACTIVE action forever", async () => {
    getSubscriptionMock.mockResolvedValueOnce({
      status: "EXPIRED",
      nextDueDate: "2026-07-15",
    });
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("WITH target AS")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              status: "ativa",
              asaas_subscription_id: "asaas-subscription",
              gateway_action_pending: "ACTIVE",
              next_due_date: "2026-07-15",
              expected_cents: 9900,
              amount_mismatch: false,
              terminal_blocked: false,
            },
          ],
        };
      }
      if (sql.includes("gateway_action_pending = NULL")) {
        return { rows: [{ id: "local-subscription" }] };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_expired_active_replay",
        event: "PAYMENT_CONFIRMED",
        dateCreated: "2026-07-15T12:00:00Z",
        payment: {
          id: "pay_expired_active_replay",
          subscription: "asaas-subscription",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("SET status = CASE WHEN $4::boolean THEN 'encerrada'"),
      ["local-subscription", "asaas-subscription", "ACTIVE", true],
    );
  });

  it("serializes concurrent INACTIVE and ACTIVE actions under the subscription advisory lock", async () => {
    let activeTransactions = 0;
    let transactionTail: Promise<unknown> = Promise.resolve();
    withTransactionMock.mockImplementation((fn: any) => {
      const run = transactionTail.then(async () => {
        activeTransactions += 1;
        try {
          return await fn({ query: queryMock });
        } finally {
          activeTransactions -= 1;
        }
      });
      transactionTail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    });

    let releaseInactive!: () => void;
    const inactiveGate = new Promise<void>((resolve) => {
      releaseInactive = resolve;
    });
    updateSubscriptionMock
      .mockImplementationOnce(async () => {
        expect(activeTransactions).toBe(1);
        await inactiveGate;
        return { success: true };
      })
      .mockImplementationOnce(async () => {
        expect(activeTransactions).toBe(1);
        return { success: true };
      });
    getSubscriptionMock
      .mockResolvedValueOnce({ status: "ACTIVE", nextDueDate: "2026-08-15" })
      .mockResolvedValueOnce({ status: "INACTIVE", nextDueDate: "2026-08-15" });
    queryMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("INSERT INTO public.payment_events")) {
        return { rows: [{ id: eventRowId }] };
      }
      if (sql.includes("WITH target AS")) {
        expect(activeTransactions).toBe(1);
        const activating = params?.[0] === "ativa";
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              status: activating ? "ativa" : "em_disputa",
              asaas_subscription_id: "asaas-subscription",
              gateway_action_pending: activating ? "ACTIVE" : "INACTIVE",
              next_due_date: activating ? "2026-08-15" : null,
              expected_cents: 9900,
              amount_mismatch: false,
              terminal_blocked: false,
            },
          ],
        };
      }
      if (sql.includes("gateway_action_pending = NULL")) {
        expect(activeTransactions).toBe(1);
        return { rows: [{ id: "local-subscription" }] };
      }
      if (sql.includes("SET processed = true")) {
        expect(activeTransactions).toBe(1);
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const inactivation = handleAsaasWebhook(
      makeRequest({
        id: "evt_concurrent_chargeback",
        event: "PAYMENT_CHARGEBACK_REQUESTED",
        dateCreated: "2026-07-14T12:00:00Z",
        payment: {
          id: "pay_chargeback",
          subscription: "asaas-subscription",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );
    await vi.waitFor(() => expect(updateSubscriptionMock).toHaveBeenCalledTimes(1));

    const recovery = handleAsaasWebhook(
      makeRequest({
        id: "evt_concurrent_recovery",
        event: "PAYMENT_CONFIRMED",
        dateCreated: "2026-07-15T12:00:00Z",
        payment: {
          id: "pay_recovery",
          subscription: "asaas-subscription",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );
    await vi.waitFor(() =>
      expect(
        queryMock.mock.calls.filter(([sql]) =>
          String(sql).includes("INSERT INTO public.payment_events"),
        ),
      ).toHaveLength(2),
    );
    expect(updateSubscriptionMock).toHaveBeenCalledTimes(1);

    releaseInactive();
    const [inactiveResponse, recoveryResponse] = await Promise.all([inactivation, recovery]);

    expect(inactiveResponse.status).toBe(200);
    expect(recoveryResponse.status).toBe(200);
    expect(updateSubscriptionMock.mock.calls).toEqual([
      ["asaas-subscription", { status: "INACTIVE" }],
      ["asaas-subscription", { status: "ACTIVE", nextDueDate: "2026-08-15" }],
    ]);
    expect(
      queryMock.mock.calls.filter(
        ([sql, params]) =>
          String(sql).includes("pg_advisory_xact_lock") &&
          params?.[0] === `subscription:${storeId}`,
      ),
    ).toHaveLength(2);
    expect(
      queryMock.mock.calls.filter(([sql]) => String(sql).includes("SET LOCAL lock_timeout")),
    ).toHaveLength(2);
    expect(
      queryMock.mock.calls
        .filter(
          ([sql]) =>
            String(sql).includes("pg_advisory_xact_lock") || String(sql).includes("WITH target AS"),
        )
        .map(([sql, params]) =>
          String(sql).includes("pg_advisory_xact_lock") ? "lock" : params?.[0],
        ),
    ).toEqual(["lock", "em_disputa", "lock", "ativa"]);
    expect(publishRealtimeMock).toHaveBeenCalledTimes(2);
  });

  it("acknowledges a guarded stale subscription event instead of retrying it forever", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("WITH target AS")) return { rows: [] };
      if (sql.includes("previous_asaas_subscription_ids")) {
        return {
          rows: [{ id: "local-subscription", store_id: storeId, retired_gateway_id: false }],
        };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_stale_subscription_overdue",
        event: "PAYMENT_OVERDUE",
        dateCreated: "2026-07-01T12:00:00Z",
        payment: {
          id: "pay_subscription",
          subscription: "asaas-subscription",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      subscription: true,
      updated: false,
      ignored: true,
      reason: "stale_or_state_guard",
    });
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock"), [
      `subscription:${storeId}`,
    ]);
  });

  it("does not let an old chargeback event overwrite a newer recovery", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("WITH target AS")) return { rows: [] };
      if (sql.includes("previous_asaas_subscription_ids")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              asaas_subscription_id: "asaas-subscription",
              retired_gateway_id: false,
              gateway_action_pending: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_old_chargeback",
        event: "PAYMENT_CHARGEBACK_REQUESTED",
        dateCreated: "2026-07-01T12:00:00Z",
        payment: {
          id: "pay_subscription",
          subscription: "asaas-subscription",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      updated: false,
      ignored: true,
      reason: "stale_or_state_guard",
    });
    const updateCall = queryMock.mock.calls.find(([sql]) => String(sql).includes("WITH target AS"));
    expect(updateCall?.[1]?.[6]).toBe(false);
    expect(updateCall?.[1]?.[11]).toBe(true);
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
  });

  it("acknowledges a late event for a retired gateway subscription id", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("WITH target AS")) return { rows: [] };
      if (sql.includes("previous_asaas_subscription_ids")) {
        return {
          rows: [{ id: "local-subscription", store_id: storeId, retired_gateway_id: true }],
        };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_retired_subscription",
        event: "PAYMENT_OVERDUE",
        payment: {
          id: "pay_old_subscription",
          subscription: "asaas-subscription-old",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      updated: false,
      ignored: true,
      reason: "retired_subscription",
    });
  });

  it("idempotently cancels a retired gateway subscription on a late refund", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("WITH target AS")) return { rows: [] };
      if (sql.includes("previous_asaas_subscription_ids")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              asaas_subscription_id: "asaas-subscription-current",
              retired_gateway_id: true,
              gateway_action_pending: null,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_retired_refund",
        event: "PAYMENT_REFUNDED",
        payment: {
          id: "pay_old_subscription",
          subscription: "asaas-subscription-old",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      updated: false,
      ignored: true,
      reason: "retired_subscription",
    });
    expect(cancelSubscriptionMock).toHaveBeenCalledWith("asaas-subscription-old");
    const tombstoneLookup = queryMock.mock.calls.find(
      ([sql]) =>
        String(sql).includes("previous_asaas_subscription_ids") &&
        !String(sql).includes("WITH target AS"),
    );
    expect(tombstoneLookup?.[0]).toContain("FOR UPDATE OF s");
  });

  it("is idempotent when receiving the same paid event twice", async () => {
    queryMock.mockImplementation(successfulClaimQuery);
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT p.*, o.id AS order_exists")) {
          return {
            rows: [
              {
                id: "local-payment",
                order_id: "order-1",
                store_id: "store-1",
                status: "pago",
                order_total: 42.5,
              },
            ],
          };
        }
        if (sql.includes("UPDATE public.payments"))
          return { rows: [{ id: "local-payment", status: "pago" }] };
        if (sql.includes("UPDATE public.orders"))
          return { rows: [{ id: "order-1", status: "novo" }] };
        return { rows: [] };
      }),
    };
    withTransactionMock.mockImplementation(async (fn: any) => fn(client));
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        event: "PAYMENT_CONFIRMED",
        payment: { id: "pay_1", externalReference: "order-1", value: 42.5 },
      }),
    );

    expect(response.status).toBe(200);
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO public.order_status_history"),
      expect.any(Array),
    );
  });

  it("revokes a platform subscription on refund without touching the order transaction", async () => {
    let committed = false;
    withTransactionMock.mockImplementation(async (fn: any) => {
      const result = await fn({ query: queryMock });
      expect(publishRealtimeMock).not.toHaveBeenCalled();
      committed = true;
      return result;
    });
    const revokedRow = {
      id: "sub-1",
      store_id: storeId,
      status: "cancelada",
      asaas_subscription_id: "asaas-subscription",
      gateway_action_pending: "CANCEL",
      external_reference: `platform-subscription:${storeId}`,
    };
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("WITH target AS")) return { rows: [revokedRow] };
      if (sql.includes("gateway_action_pending = NULL")) return { rows: [{ id: "sub-1" }] };
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        event: "PAYMENT_REFUNDED",
        payment: {
          id: "pay_1",
          subscription: "asaas-subscription",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, subscription: true });
    // Estorno terminal bloqueia imediatamente ($7) e marca revogacao definitiva ($11).
    const updateCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE public.subscriptions"),
    );
    expect(updateCall).toBeTruthy();
    expect(updateCall?.[1]?.[6]).toBe(true);
    expect(updateCall?.[1]?.[7]).toBe(storeId);
    expect(updateCall?.[1]?.[10]).toBe(true);
    expect(updateCall?.[1]?.[11]).toBe(false);
    expect(cancelSubscriptionMock).toHaveBeenCalledWith("asaas-subscription");
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
    expect(committed).toBe(true);
    expect(publishRealtimeMock).toHaveBeenCalled();
  });

  it("preserves a pending exemption cancellation for the administrative reconciler", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("WITH target AS")) {
        return {
          rows: [
            {
              id: "sub-1",
              store_id: storeId,
              status: "cancelada",
              asaas_subscription_id: "asaas-subscription",
              gateway_action_pending: "EXEMPT_CANCEL",
              external_reference: `platform-subscription:${storeId}`,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        event: "PAYMENT_REFUNDED",
        payment: {
          id: "pay_exemption_pending",
          subscription: "asaas-subscription",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(cancelSubscriptionMock).not.toHaveBeenCalled();
    expect(updateSubscriptionMock).not.toHaveBeenCalled();
    expect(
      queryMock.mock.calls.some(([sql]) => String(sql).includes("gateway_action_pending = NULL")),
    ).toBe(false);
    expect(
      queryMock.mock.calls.some(([sql]) =>
        String(sql).includes("s.gateway_action_pending = 'EXEMPT_CANCEL'"),
      ),
    ).toBe(true);
  });

  it("revokes a platform subscription on chargeback request", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("WITH target AS")) {
        return {
          rows: [
            {
              id: "sub-1",
              store_id: storeId,
              status: "em_disputa",
              asaas_subscription_id: "asaas-subscription",
              gateway_action_pending: "INACTIVE",
            },
          ],
        };
      }
      if (sql.includes("gateway_action_pending = NULL")) return { rows: [{ id: "sub-1" }] };
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        event: "PAYMENT_CHARGEBACK_REQUESTED",
        payment: {
          id: "pay_2",
          subscription: "asaas-subscription",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ success: true, subscription: true });
    const updateCall = queryMock.mock.calls.find(([sql]) => String(sql).includes("WITH target AS"));
    expect(updateCall?.[1]?.[0]).toBe("em_disputa");
    expect(updateCall?.[1]?.[10]).toBe(false);
    expect(updateCall?.[1]?.[6]).toBe(false);
    expect(updateCall?.[1]?.[11]).toBe(true);
    expect(updateSubscriptionMock).toHaveBeenCalledWith("asaas-subscription", {
      status: "INACTIVE",
    });
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("revokes a platform subscription on a partial refund instead of retrying forever", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("WITH target AS")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              status: "cancelada",
              asaas_subscription_id: "asaas-subscription",
              gateway_action_pending: "CANCEL",
              amount_mismatch: false,
              terminal_blocked: false,
            },
          ],
        };
      }
      if (sql.includes("gateway_action_pending = NULL")) {
        return { rows: [{ id: "local-subscription" }] };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_partial_subscription_refund",
        event: "PAYMENT_PARTIALLY_REFUNDED",
        payment: {
          id: "pay_subscription",
          subscription: "asaas-subscription",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      subscription: true,
      updated: true,
    });
    const updateCall = queryMock.mock.calls.find(([sql]) => String(sql).includes("WITH target AS"));
    expect(updateCall?.[1]?.[6]).toBe(true);
    expect(cancelSubscriptionMock).toHaveBeenCalledWith("asaas-subscription");
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a refunded subscription event retryable until gateway cancellation succeeds", async () => {
    cancelSubscriptionMock.mockResolvedValueOnce({
      errors: [{ description: "temporary gateway failure" }],
    });
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [{ id: eventRowId }] };
      if (sql.includes("WITH target AS")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              status: "cancelada",
              asaas_subscription_id: "asaas-subscription",
              gateway_action_pending: "CANCEL",
              amount_mismatch: false,
              terminal_blocked: false,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_refund_retry_gateway",
        event: "PAYMENT_REFUNDED",
        payment: {
          id: "pay_subscription",
          subscription: "asaas-subscription",
          externalReference: `platform-subscription:${storeId}`,
          value: 99,
        },
      }),
    );

    expect(response.status).toBe(500);
    expect(cancelSubscriptionMock).toHaveBeenCalledWith("asaas-subscription");
    expect(
      queryMock.mock.calls.some(([sql]) => String(sql).includes("processing_error = $3")),
    ).toBe(true);
    expect(
      queryMock.mock.calls.some(([sql]) => String(sql).includes("gateway_action_pending = NULL")),
    ).toBe(false);
  });

  it("returns 500 so Asaas can retry when subscription update fails", async () => {
    queryMock
      .mockImplementationOnce(successfulClaimQuery)
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValue({ rows: [] });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        event: "PAYMENT_CONFIRMED",
        payment: { id: "pay_3", externalReference: `platform-subscription:${storeId}`, value: 99 },
      }),
    );

    expect(response.status).toBe(500);
    expect(withTransactionMock).toHaveBeenCalledTimes(1);
  });

  it("does not mark an order as paid when Asaas value diverges", async () => {
    queryMock.mockImplementation(successfulClaimQuery);
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT p.*, o.id AS order_exists")) {
          return {
            rows: [
              {
                id: "local-payment",
                order_id: "order-1",
                store_id: "store-1",
                status: "pendente",
                order_total: 42.5,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    withTransactionMock.mockImplementation(async (fn: any) => fn(client));
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        event: "PAYMENT_CONFIRMED",
        payment: { id: "pay_1", externalReference: "order-1", value: 10 },
      }),
    );

    expect(response.status).toBe(200);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("last_error"),
      expect.arrayContaining(["local-payment"]),
    );
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'novo'"),
      expect.any(Array),
    );
  });

  it("never downgrades an already paid payment on a late overdue event", async () => {
    queryMock.mockImplementation(successfulClaimQuery);
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT p.*, o.id AS order_exists")) {
          return {
            rows: [
              {
                id: "local-payment",
                order_id: "order-1",
                store_id: "store-1",
                status: "pago",
                order_total: 42.5,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };
    withTransactionMock.mockImplementation(async (fn: any) => fn(client));
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_late_overdue",
        event: "PAYMENT_OVERDUE",
        dateCreated: "2026-07-10T15:00:00Z",
        payment: { id: "pay_1", externalReference: "order-1", value: 42.5 },
      }),
    );

    expect(response.status).toBe(200);
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("SET status = $2"),
      expect.any(Array),
    );
  });

  it("reconciles partial refunds from cumulative DONE items instead of the charge value", async () => {
    queryMock.mockImplementation(successfulClaimQuery);
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("SELECT p.*, o.id AS order_exists")) {
          return {
            rows: [
              {
                id: "local-payment",
                order_id: "order-1",
                store_id: "store-1",
                status: "pago",
                order_total: 42.5,
              },
            ],
          };
        }
        if (sql.includes("SELECT id, total, refunded_amount")) {
          return { rows: [{ id: "order-1", total: 42.5, refunded_amount: 5 }] };
        }
        if (sql.includes("UPDATE public.payments"))
          return { rows: [{ id: "local-payment", status: "estornado" }] };
        if (sql.includes("UPDATE public.orders"))
          return {
            rows: [{ id: "order-1", refunded_amount: 12, refund_status: "ESTORNADO_PARCIAL" }],
          };
        return { rows: [] };
      }),
    };
    withTransactionMock.mockImplementation(async (fn: any) => fn(client));
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_partial_2",
        event: "PAYMENT_PARTIALLY_REFUNDED",
        payment: {
          id: "pay_1",
          externalReference: "order-1",
          value: 42.5,
          refunds: [
            { status: "DONE", value: 5, dateCreated: "2026-07-09 10:00:00" },
            { status: "DONE", value: 7, dateCreated: "2026-07-10 10:00:00" },
            { status: "CANCELLED", value: 30.5 },
          ],
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("refunded_amount = GREATEST"),
      ["order-1", 12, false, "evt_partial_2"],
    );
  });

  it("returns 503 with Retry-After when a crashed or concurrent claim is still unprocessed", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [] };
      if (sql.includes("WITH candidate AS")) return { rows: [] };
      if (sql.includes("retry_after_seconds")) {
        return {
          rows: [{ id: eventRowId, processed: false, retry_after_seconds: 37 }],
        };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_duplicate",
        event: "PAYMENT_CONFIRMED",
        payment: { id: "pay_1", externalReference: "order-1", value: 42.5 },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("37");
    expect(body).toMatchObject({
      success: false,
      duplicate: true,
      processing: true,
      retryable: true,
    });
    expect(withTransactionMock).not.toHaveBeenCalled();
    const reclaimCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes("WITH candidate AS"),
    );
    expect(reclaimCall?.[0]).toContain("FOR UPDATE SKIP LOCKED");
    expect(reclaimCall?.[1]?.[5]).toBe(45);
  });

  it("returns 200 only when the duplicate event is already processed", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [] };
      if (sql.includes("WITH candidate AS")) return { rows: [] };
      if (sql.includes("retry_after_seconds")) {
        return {
          rows: [{ id: eventRowId, processed: true, retry_after_seconds: 45 }],
        };
      }
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        event: "PAYMENT_PARTIALLY_REFUNDED",
        payment: { id: "pay_1", externalReference: "order-1", value: 42.5 },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      duplicate: true,
      processed: true,
    });
    expect(withTransactionMock).not.toHaveBeenCalled();
  });

  it("atomically reclaims an expired lease and resumes processing", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO public.payment_events")) return { rows: [] };
      if (sql.includes("WITH candidate AS")) return { rows: [{ id: eventRowId }] };
      return { rows: [] };
    });
    const { handleAsaasWebhook } = await import("./webhooks");

    const response = await handleAsaasWebhook(
      makeRequest({
        id: "evt_expired_lease",
        event: "PAYMENT_UPDATED",
        payment: { id: "pay_1", externalReference: "order-1", value: 42.5 },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, ignored: true });
    const reclaimCall = queryMock.mock.calls.find(([sql]) =>
      String(sql).includes("WITH candidate AS"),
    );
    expect(reclaimCall?.[0]).toContain("attempt_count = payment_event.attempt_count + 1");
    expect(reclaimCall?.[0]).toContain("make_interval(secs => $6::integer)");
  });
});
