import { describe, expect, it, vi } from "vitest";
import { createSubscriptionCheckoutHandler, syncSubscriptionStatusHandler } from "./subscription.service";

const storeId = "11111111-1111-4111-8111-111111111111";
const planId = "22222222-2222-4222-8222-222222222222";

const input = {
  storeId,
  planId,
  cardData: {
    creditCard: {
      holderName: "Loja QA",
      number: "4111111111111111",
      expiryMonth: "12",
      expiryYear: "2030",
      ccv: "123",
    },
    creditCardHolderInfo: {
      name: "Loja QA",
      email: "qa@example.com",
      cpfCnpj: "123.456.789-01",
      postalCode: "29000-000",
      addressNumber: "10",
      addressComplement: null,
      mobilePhone: "(11) 99999-9999",
    },
  },
  customerData: {
    name: "Loja QA",
    email: "qa@example.com",
    cpfCnpj: "123.456.789-01",
    mobilePhone: "(11) 99999-9999",
  },
};

const createDeps = (actor: any) => {
  const query = vi.fn(async (sql: string): Promise<any> => {
    if (sql.includes("FROM public.stores")) {
      return { rows: [{ id: storeId, owner_user_id: "owner-user", name: "Loja QA" }] };
    }
    if (sql.includes("FROM public.plans")) {
      return { rows: [{ id: planId, name: "PRO", price_monthly: 79.9 }] };
    }
    return { rows: [] };
  });
  return {
    getActor: vi.fn(async () => actor),
    query,
    publishRealtime: vi.fn(),
    createCustomer: vi.fn(async () => ({ id: "asaas-customer" })),
    createSubscription: vi.fn(async (_payload: any) => ({ id: "asaas-subscription", invoiceUrl: "https://checkout.example" })),
    updateSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
    listSubscriptionPayments: vi.fn(async (): Promise<any> => ({ data: [] })),
  };
};

describe("subscription checkout service", () => {
  it("requires an authenticated owner or admin", async () => {
    const anonymousDeps = createDeps(null);
    await expect(createSubscriptionCheckoutHandler(input, undefined, Promise.resolve(anonymousDeps as any))).rejects.toThrow("Nao autenticado");

    const wrongOwnerDeps = createDeps({ admin: false, ownedStoreIds: ["other-store"] });
    await expect(createSubscriptionCheckoutHandler(input, "token", Promise.resolve(wrongOwnerDeps as any))).rejects.toThrow("Acesso negado");
  });

  it("creates the gateway checkout and persists the pending subscription for the owner store", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });

    const result = await createSubscriptionCheckoutHandler(input, "token", Promise.resolve(deps as any), { remoteIp: "203.0.113.10" });

    expect(result).toEqual({
      invoiceUrl: "https://checkout.example",
      checkoutUrl: "https://checkout.example",
      subscriptionId: "asaas-subscription",
      billingType: "CREDIT_CARD",
      mode: "card_validated",
    });
    expect(deps.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ cpfCnpj: "12345678901" }));
    expect(deps.createSubscription).toHaveBeenCalledWith(expect.objectContaining({
      externalReference: `platform-subscription:${storeId}`,
      value: 79.9,
      billingType: "CREDIT_CARD",
      remoteIp: "203.0.113.10",
      creditCard: expect.objectContaining({ number: "4111111111111111" }),
      creditCardHolderInfo: expect.objectContaining({ cpfCnpj: "12345678901", postalCode: "29000000" }),
    }));
    expect(deps.createSubscription.mock.calls[0][0]).not.toHaveProperty("creditCardToken");
    expect(deps.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE public.stores"), [storeId, planId]);
    expect(deps.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO public.subscriptions"), [
      storeId,
      planId,
      "asaas-customer",
      "asaas-subscription",
      "CREDIT_CARD",
      `platform-subscription:${storeId}`,
      "pendente_pagamento",
      expect.any(String),
    ]);
  });

  it("reconciles a confirmed gateway payment into an active subscription", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.stores")) {
        return { rows: [{ id: storeId, owner_user_id: "owner-user", name: "Loja QA" }] };
      }
      if (sql.includes("FROM public.subscriptions")) {
        return {
          rows: [{
            id: "local-subscription",
            store_id: storeId,
            plan_id: planId,
            status: "pendente_pagamento",
            asaas_subscription_id: "asaas-subscription",
            next_due_date: "2026-05-27",
          }],
        };
      }
      if (sql.includes("UPDATE public.subscriptions")) {
        return {
          rows: [{
            id: "local-subscription",
            store_id: storeId,
            plan_id: planId,
            status: "ativa",
            last_payment_status: "CONFIRMED",
          }],
        };
      }
      return { rows: [] };
    });
    deps.listSubscriptionPayments.mockResolvedValueOnce({
      data: [{
        id: "pay-subscription",
        status: "CONFIRMED",
        confirmedDate: "2026-05-27",
        dueDate: "2026-05-27",
      }],
    });

    const result = await syncSubscriptionStatusHandler({ storeId }, "token", Promise.resolve(deps as any));

    expect(result).toMatchObject({
      success: true,
      status: "ativa",
      gatewayStatus: "CONFIRMED",
      paymentId: "pay-subscription",
      synced: true,
    });
    expect(deps.listSubscriptionPayments).toHaveBeenCalledWith("asaas-subscription");
    expect(deps.query).toHaveBeenCalledWith(expect.stringContaining("SET status = $2"), [
      storeId,
      "ativa",
      "CONFIRMED",
      "2026-05-27",
      "2026-05-27",
    ]);
  });
});
