import { describe, expect, it, vi } from "vitest";
import { createSubscriptionCheckoutHandler } from "./subscription.service";

const storeId = "11111111-1111-4111-8111-111111111111";
const planId = "22222222-2222-4222-8222-222222222222";

const input = {
  storeId,
  planId,
  customerData: {
    name: "Loja QA",
    email: "qa@example.com",
    cpfCnpj: "123.456.789-01",
    mobilePhone: "(11) 99999-9999",
  },
};

const createDeps = (actor: any) => {
  const query = vi.fn(async (sql: string) => {
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
    createCustomer: vi.fn(async () => ({ id: "asaas-customer" })),
    createSubscription: vi.fn(async () => ({ id: "asaas-subscription", invoiceUrl: "https://checkout.example" })),
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

    const result = await createSubscriptionCheckoutHandler(input, "token", Promise.resolve(deps as any));

    expect(result).toEqual({ invoiceUrl: "https://checkout.example", subscriptionId: "asaas-subscription" });
    expect(deps.createCustomer).toHaveBeenCalledWith(expect.objectContaining({ cpfCnpj: "12345678901" }));
    expect(deps.createSubscription).toHaveBeenCalledWith(expect.objectContaining({
      externalReference: storeId,
      value: 79.9,
    }));
    expect(deps.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE public.stores"), [storeId, planId]);
    expect(deps.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO public.subscriptions"), [storeId, planId, "asaas-subscription"]);
  });
});
