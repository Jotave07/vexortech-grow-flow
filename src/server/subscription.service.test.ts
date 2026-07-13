import { describe, expect, it, vi } from "vitest";
import {
  adminSetStoreExemptionHandler,
  adminSetStoreSuspensionHandler,
  cancelSubscriptionHandler,
  createSubscriptionCheckoutHandler,
  syncSubscriptionStatusHandler,
  updateSubscriptionPlanHandler,
} from "./subscription.service";

const storeId = "11111111-1111-4111-8111-111111111111";
const secondStoreId = "33333333-3333-4333-8333-333333333333";
const planId = "22222222-2222-4222-8222-222222222222";
const profileId = "44444444-4444-4444-8444-444444444444";
const ownerUserId = "55555555-5555-4555-8555-555555555555";

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
      cpfCnpj: "529.982.247-25",
      postalCode: "29000-000",
      addressNumber: "10",
      addressComplement: null,
      mobilePhone: "(11) 99999-9999",
    },
  },
  customerData: {
    name: "Loja QA",
    email: "qa@example.com",
    cpfCnpj: "529.982.247-25",
    mobilePhone: "(11) 99999-9999",
  },
};

const createDeps = (actor: any) => {
  const query = vi.fn(async (sql: string, _params?: unknown[]): Promise<any> => {
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
    // Executa o callback com um "client" cujo query delega ao mesmo mock, de modo que as
    // escritas dentro da transacao (advisory lock, FOR UPDATE, persist) continuem visiveis
    // nas assercoes sobre deps.query.
    withTransaction: vi.fn(async (fn: any) => fn({ query })),
    publishRealtime: vi.fn(),
    createCustomer: vi.fn(async () => ({ id: "asaas-customer" })),
    createSubscription: vi.fn(async (_payload: any) => ({
      id: "asaas-subscription",
      invoiceUrl: "https://checkout.example",
    })),
    getSubscription: vi.fn(
      async (): Promise<any> => ({ status: "ACTIVE", nextDueDate: "2099-01-15" }),
    ),
    updateSubscription: vi.fn(),
    cancelSubscription: vi.fn(async () => ({})),
    listSubscriptionPayments: vi.fn(async (): Promise<any> => ({ data: [] })),
  };
};

const configureSyncSubscription = (
  deps: ReturnType<typeof createDeps>,
  subscriptionOverrides: Record<string, unknown> = {},
  updatedOverrides: Record<string, unknown> = {},
) => {
  const subscription = {
    id: "local-subscription",
    store_id: storeId,
    plan_id: planId,
    status: "pendente_pagamento",
    asaas_subscription_id: "asaas-subscription",
    next_due_date: "2026-05-27",
    updated_at: "2026-07-13T10:00:00.000Z",
    last_payment_event_at: "2026-07-12T10:00:00.000Z",
    contract_price_monthly: 79.9,
    current_price_monthly: 79.9,
    ...subscriptionOverrides,
  };
  deps.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM public.stores")) {
      return { rows: [{ id: storeId, owner_user_id: "owner-user", name: "Loja QA" }] };
    }
    if (sql.includes("FROM public.subscriptions")) return { rows: [subscription] };
    if (sql.includes("UPDATE public.subscriptions")) {
      return {
        rows: [
          {
            ...subscription,
            status: "inadimplente",
            last_payment_status: "PAYMENT_VALUE_MISMATCH",
            ...updatedOverrides,
          },
        ],
      };
    }
    return { rows: [] };
  });
  return subscription;
};

describe("subscription checkout service", () => {
  it("requires an authenticated owner or admin", async () => {
    const anonymousDeps = createDeps(null);
    await expect(
      createSubscriptionCheckoutHandler(input, undefined, Promise.resolve(anonymousDeps as any)),
    ).rejects.toThrow("Nao autenticado");

    const wrongOwnerDeps = createDeps({ admin: false, ownedStoreIds: ["other-store"] });
    await expect(
      createSubscriptionCheckoutHandler(input, "token", Promise.resolve(wrongOwnerDeps as any)),
    ).rejects.toThrow("Acesso negado");
  });

  it("creates the gateway checkout and persists the pending subscription for the owner store", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });

    const result = await createSubscriptionCheckoutHandler(
      input,
      "token",
      Promise.resolve(deps as any),
      { remoteIp: "203.0.113.10" },
    );

    expect(result).toEqual({
      invoiceUrl: "https://checkout.example",
      checkoutUrl: "https://checkout.example",
      subscriptionId: "asaas-subscription",
      billingType: "CREDIT_CARD",
      mode: "card_validated",
    });
    expect(deps.createCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        cpfCnpj: "52998224725",
        externalReference: `platform-store:${storeId}`,
      }),
      undefined,
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(deps.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        externalReference: `platform-subscription:${storeId}`,
        value: 79.9,
        billingType: "CREDIT_CARD",
        remoteIp: "203.0.113.10",
        creditCard: expect.objectContaining({ number: "4111111111111111" }),
        creditCardHolderInfo: expect.objectContaining({
          cpfCnpj: "52998224725",
          postalCode: "29000000",
        }),
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    const customerCall = deps.createCustomer.mock.calls[0] as any[];
    const subscriptionCall = deps.createSubscription.mock.calls[0] as any[];
    const customerIdempotencyKey = customerCall[2].idempotencyKey;
    const subscriptionIdempotencyKey = subscriptionCall[1].idempotencyKey;
    expect(customerIdempotencyKey).toMatch(/^pc_[a-f0-9]{32}$/);
    expect(subscriptionIdempotencyKey).toMatch(/^ps_[a-f0-9]{32}$/);
    expect(customerIdempotencyKey).toHaveLength(35);
    expect(subscriptionIdempotencyKey).toHaveLength(35);
    expect(deps.createSubscription.mock.calls[0][0]).not.toHaveProperty("creditCardToken");
    expect(deps.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE public.stores"), [
      storeId,
      planId,
    ]);
    expect(deps.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO public.subscriptions"),
      [
        storeId,
        planId,
        "asaas-customer",
        "asaas-subscription",
        "CREDIT_CARD",
        `platform-subscription:${storeId}`,
        "pendente_pagamento",
        79.9,
        expect.any(String),
      ],
    );
    expect(
      deps.query.mock.calls.some(([sql]) =>
        String(sql).includes("previous_asaas_subscription_ids = CASE"),
      ),
    ).toBe(true);
  });

  it("uses a new idempotency generation after a previously canceled gateway subscription", async () => {
    const checkoutKeyFor = async (previousGatewayId: string | null) => {
      const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
      const previous = previousGatewayId
        ? {
            id: `local-${previousGatewayId}`,
            store_id: storeId,
            plan_id: planId,
            status: "cancelada",
            asaas_customer_id: "asaas-customer",
            asaas_subscription_id: previousGatewayId,
          }
        : null;
      deps.query.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM public.stores")) {
          return {
            rows: [
              {
                id: storeId,
                owner_user_id: ownerUserId,
                name: "Loja QA",
                is_active: true,
                is_suspended: false,
              },
            ],
          };
        }
        if (sql.includes("FROM public.plans")) {
          return { rows: [{ id: planId, name: "PRO", price_monthly: 79.9 }] };
        }
        if (sql.includes("FROM public.profiles")) return { rows: [] };
        if (sql.includes("FROM public.subscriptions")) {
          return { rows: previous ? [previous] : [] };
        }
        if (sql.includes("INSERT INTO public.subscriptions")) {
          return {
            rows: [
              {
                ...previous,
                id: previous?.id || "local-new",
                store_id: storeId,
                plan_id: planId,
                asaas_subscription_id: "asaas-subscription",
                status: "pendente_pagamento",
              },
            ],
          };
        }
        return { rows: [] };
      });

      await createSubscriptionCheckoutHandler(input, "token", Promise.resolve(deps as any), {
        remoteIp: "203.0.113.10",
      });
      return (deps.createSubscription.mock.calls[0] as any[])[1].idempotencyKey as string;
    };

    const firstGeneration = await checkoutKeyFor(null);
    const retriedGeneration = await checkoutKeyFor("asaas-old-a");
    const nextGeneration = await checkoutKeyFor("asaas-old-b");

    expect(firstGeneration).toMatch(/^ps_[a-f0-9]{32}$/);
    expect(new Set([firstGeneration, retriedGeneration, nextGeneration]).size).toBe(3);
  });

  it("does not persist a local subscription when the gateway create response has no id", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    deps.createSubscription.mockResolvedValueOnce({
      invoiceUrl: "https://checkout.example",
    } as any);

    await expect(
      createSubscriptionCheckoutHandler(input, "token", Promise.resolve(deps as any), {
        remoteIp: "203.0.113.10",
      }),
    ).rejects.toThrow("Assinatura do gateway nao foi criada");

    expect(deps.query).not.toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO public.subscriptions"),
      expect.any(Array),
    );
  });

  it("does not create a duplicate checkout when the same plan is already active", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.stores")) {
        return { rows: [{ id: storeId, owner_user_id: "owner-user", name: "Loja QA" }] };
      }
      if (sql.includes("FROM public.plans")) {
        return { rows: [{ id: planId, name: "PRO", price_monthly: 79.9 }] };
      }
      if (sql.includes("FROM public.subscriptions")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              plan_id: planId,
              status: "ativa",
              billing_type: "CREDIT_CARD",
              asaas_subscription_id: "asaas-subscription",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await createSubscriptionCheckoutHandler(
      input,
      "token",
      Promise.resolve(deps as any),
      { remoteIp: "203.0.113.10" },
    );

    expect(result).toMatchObject({
      checkoutUrl: null,
      subscriptionId: "asaas-subscription",
      billingType: "CREDIT_CARD",
      mode: "active",
    });
    expect(deps.createCustomer).not.toHaveBeenCalled();
    expect(deps.createSubscription).not.toHaveBeenCalled();
  });

  it.each(["bloqueada", "suspensa", "em_disputa"])(
    "does not let checkout replace a %s subscription",
    async (status) => {
      const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
      deps.query.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM public.stores")) {
          return { rows: [{ id: storeId, owner_user_id: "owner-user", name: "Loja QA" }] };
        }
        if (sql.includes("FROM public.plans")) {
          return { rows: [{ id: planId, name: "PRO", price_monthly: 79.9 }] };
        }
        if (sql.includes("FROM public.subscriptions")) {
          return {
            rows: [
              {
                id: "local-subscription",
                store_id: storeId,
                plan_id: planId,
                status,
                asaas_subscription_id: "asaas-subscription",
              },
            ],
          };
        }
        return { rows: [] };
      });

      await expect(
        createSubscriptionCheckoutHandler(input, "token", Promise.resolve(deps as any), {
          remoteIp: "203.0.113.10",
        }),
      ).rejects.toThrow("Regularize a situacao");
      expect(deps.createCustomer).not.toHaveBeenCalled();
      expect(deps.createSubscription).not.toHaveBeenCalled();
    },
  );

  it("blocks checkout while a financial gateway action is pending", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.stores")) {
        return { rows: [{ id: storeId, owner_user_id: ownerUserId, name: "Loja QA" }] };
      }
      if (sql.includes("FROM public.plans")) {
        return { rows: [{ id: planId, name: "PRO", price_monthly: 79.9 }] };
      }
      if (sql.includes("FROM public.subscriptions")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              plan_id: planId,
              status: "ativa",
              asaas_subscription_id: "asaas-subscription",
              gateway_action_pending: "EXEMPT_CANCEL",
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      createSubscriptionCheckoutHandler(input, "token", Promise.resolve(deps as any), {
        remoteIp: "203.0.113.10",
      }),
    ).rejects.toThrow("acao financeira pendente");
    expect(deps.cancelSubscription).not.toHaveBeenCalled();
    expect(deps.createSubscription).not.toHaveBeenCalled();
  });

  it.each([
    ["suspensa", { is_suspended: true }],
    ["inativa", { is_active: false }],
    ["com cortesia", { owner_is_exempt: true }],
  ])("blocks checkout when the store is %s", async (_label, storeState) => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.stores")) {
        return {
          rows: [
            {
              id: storeId,
              owner_user_id: ownerUserId,
              name: "Loja QA",
              is_active: true,
              is_suspended: false,
              owner_is_exempt: false,
              ...storeState,
            },
          ],
        };
      }
      if (sql.includes("FROM public.plans")) {
        return { rows: [{ id: planId, name: "PRO", price_monthly: 79.9 }] };
      }
      return { rows: [] };
    });

    await expect(
      createSubscriptionCheckoutHandler(input, "token", Promise.resolve(deps as any), {
        remoteIp: "203.0.113.10",
      }),
    ).rejects.toThrow(/suspensa|inativa|cortesia/i);
    expect(deps.withTransaction).not.toHaveBeenCalled();
    expect(deps.createSubscription).not.toHaveBeenCalled();
  });

  it.each([
    ["suspensa", { is_suspended: true }],
    ["inativa", { is_active: false }],
    ["com cortesia", { owner_is_exempt: true }],
  ])("blocks plan updates when the store is %s", async (_label, storeState) => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.stores")) {
        return {
          rows: [
            {
              id: storeId,
              owner_user_id: ownerUserId,
              name: "Loja QA",
              is_active: true,
              is_suspended: false,
              owner_is_exempt: false,
              ...storeState,
            },
          ],
        };
      }
      if (sql.includes("FROM public.plans")) {
        return { rows: [{ id: planId, name: "PRO", price_monthly: 79.9 }] };
      }
      if (sql.includes("FROM public.subscriptions")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              plan_id: planId,
              status: "ativa",
              asaas_subscription_id: "asaas-subscription",
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      updateSubscriptionPlanHandler(
        { storeId, planId, billingType: "BOLETO" },
        "token",
        Promise.resolve(deps as any),
      ),
    ).rejects.toThrow(/suspensa|inativa|cortesia/i);
    expect(deps.withTransaction).not.toHaveBeenCalled();
    expect(deps.updateSubscription).not.toHaveBeenCalled();
  });

  it("rechecks suspension under the subscription advisory lock before checkout side effects", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.stores") && sql.includes("FOR UPDATE")) {
        return {
          rows: [
            {
              id: storeId,
              owner_user_id: ownerUserId,
              name: "Loja QA",
              is_active: true,
              is_suspended: true,
            },
          ],
        };
      }
      if (sql.includes("FROM public.stores")) {
        return {
          rows: [
            {
              id: storeId,
              owner_user_id: ownerUserId,
              name: "Loja QA",
              is_active: true,
              is_suspended: false,
              owner_is_exempt: false,
            },
          ],
        };
      }
      if (sql.includes("FROM public.plans")) {
        return { rows: [{ id: planId, name: "PRO", price_monthly: 79.9 }] };
      }
      if (sql.includes("FROM public.profiles")) return { rows: [] };
      if (sql.includes("FROM public.subscriptions")) return { rows: [] };
      return { rows: [] };
    });

    await expect(
      createSubscriptionCheckoutHandler(input, "token", Promise.resolve(deps as any), {
        remoteIp: "203.0.113.10",
      }),
    ).rejects.toThrow("Loja suspensa");
    expect(deps.createCustomer).not.toHaveBeenCalled();
    expect(deps.cancelSubscription).not.toHaveBeenCalled();
    expect(deps.createSubscription).not.toHaveBeenCalled();
  });

  it("re-reads and locks the paid plan before sending its price to the gateway", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.stores")) {
        return {
          rows: [
            {
              id: storeId,
              owner_user_id: ownerUserId,
              name: "Loja QA",
              is_active: true,
              is_suspended: false,
              owner_is_exempt: false,
            },
          ],
        };
      }
      if (sql.includes("FROM public.plans") && sql.includes("FOR SHARE")) {
        return { rows: [{ id: planId, name: "PRO ATUALIZADO", price_monthly: 89.9 }] };
      }
      if (sql.includes("FROM public.plans")) {
        return { rows: [{ id: planId, name: "PRO", price_monthly: 79.9 }] };
      }
      if (sql.includes("FROM public.profiles")) return { rows: [] };
      if (sql.includes("FROM public.subscriptions")) return { rows: [] };
      if (sql.includes("INSERT INTO public.subscriptions")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              plan_id: planId,
              asaas_subscription_id: "asaas-subscription",
            },
          ],
        };
      }
      return { rows: [] };
    });

    await createSubscriptionCheckoutHandler(input, "token", Promise.resolve(deps as any), {
      remoteIp: "203.0.113.10",
    });

    expect(deps.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ value: 89.9, description: expect.stringContaining("ATUALIZADO") }),
      expect.any(Object),
    );
    expect(deps.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO public.subscriptions"),
      expect.arrayContaining([89.9]),
    );
  });

  it("rechecks owner exemption under the advisory lock before a plan update", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.stores")) {
        return {
          rows: [
            {
              id: storeId,
              owner_user_id: ownerUserId,
              name: "Loja QA",
              is_active: true,
              is_suspended: false,
              owner_is_exempt: false,
            },
          ],
        };
      }
      if (sql.includes("FROM public.plans")) {
        return { rows: [{ id: planId, name: "PRO", price_monthly: 79.9 }] };
      }
      if (sql.includes("FROM public.profiles")) {
        return { rows: [{ id: profileId, user_id: ownerUserId, is_exempt: true }] };
      }
      if (sql.includes("FROM public.subscriptions")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              plan_id: planId,
              status: "ativa",
              asaas_subscription_id: "asaas-subscription",
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      updateSubscriptionPlanHandler(
        { storeId, planId, billingType: "BOLETO" },
        "token",
        Promise.resolve(deps as any),
      ),
    ).rejects.toThrow("Perfil com cortesia");
    expect(deps.updateSubscription).not.toHaveBeenCalled();
  });

  it("short-circuits inside the lock when a concurrent request already activated the subscription", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.stores")) {
        return { rows: [{ id: storeId, owner_user_id: "owner-user", name: "Loja QA" }] };
      }
      if (sql.includes("FROM public.plans")) {
        return { rows: [{ id: planId, name: "PRO", price_monthly: 79.9 }] };
      }
      // Leitura travada (FOR UPDATE): uma requisicao concorrente ja ativou a assinatura.
      if (sql.includes("FROM public.subscriptions") && sql.includes("FOR UPDATE")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              plan_id: planId,
              status: "ativa",
              billing_type: "CREDIT_CARD",
              asaas_subscription_id: "asaas-subscription",
            },
          ],
        };
      }
      // Leitura inicial (sem lock): ainda pendente, nao dispara o atalho rapido.
      if (sql.includes("FROM public.subscriptions")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              plan_id: planId,
              status: "pendente_pagamento",
              billing_type: "CREDIT_CARD",
              asaas_subscription_id: "asaas-subscription",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await createSubscriptionCheckoutHandler(
      input,
      "token",
      Promise.resolve(deps as any),
      { remoteIp: "203.0.113.10" },
    );

    expect(result).toMatchObject({ mode: "active", subscriptionId: "asaas-subscription" });
    expect(deps.withTransaction).toHaveBeenCalled();
    expect(deps.createSubscription).not.toHaveBeenCalled();
    expect(deps.createCustomer).not.toHaveBeenCalled();
  });

  it("reconciles a confirmed gateway payment into an active subscription", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.stores")) {
        return { rows: [{ id: storeId, owner_user_id: "owner-user", name: "Loja QA" }] };
      }
      if (sql.includes("FROM public.subscriptions")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              plan_id: planId,
              status: "pendente_pagamento",
              asaas_subscription_id: "asaas-subscription",
              next_due_date: "2026-05-27",
              current_price_monthly: 79.9,
            },
          ],
        };
      }
      if (sql.includes("UPDATE public.subscriptions")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              plan_id: planId,
              status: "ativa",
              last_payment_status: "CONFIRMED",
            },
          ],
        };
      }
      return { rows: [] };
    });
    deps.listSubscriptionPayments.mockResolvedValueOnce({
      data: [
        {
          id: "pay-subscription",
          status: "CONFIRMED",
          value: 79.9,
          confirmedDate: "2026-05-27",
          dueDate: "2026-05-27",
        },
      ],
    });

    const result = await syncSubscriptionStatusHandler(
      { storeId },
      "token",
      Promise.resolve(deps as any),
    );

    expect(result).toMatchObject({
      success: true,
      status: "ativa",
      gatewayStatus: "CONFIRMED",
      paymentId: "pay-subscription",
      synced: true,
    });
    expect(deps.listSubscriptionPayments).toHaveBeenCalledWith("asaas-subscription");
    expect(
      deps.query.mock.calls.some(([sql]) =>
        String(sql).includes("COALESCE(s.contract_price_monthly, p.price_monthly)"),
      ),
    ).toBe(true);
    expect(deps.query).toHaveBeenCalledWith(
      expect.stringContaining("updated_at IS NOT DISTINCT FROM $4::timestamptz"),
      [
        "local-subscription",
        storeId,
        "asaas-subscription",
        null,
        null,
        planId,
        null,
        "ativa",
        "CONFIRMED",
        "2026-05-27",
        "2026-05-27",
        null,
      ],
    );
  });

  it("does not apply an old gateway response after the local subscription changes", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    const subscription = configureSyncSubscription(deps);
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.stores")) {
        return { rows: [{ id: storeId, owner_user_id: "owner-user", name: "Loja QA" }] };
      }
      if (sql.includes("FROM public.subscriptions")) return { rows: [subscription] };
      if (sql.includes("UPDATE public.subscriptions")) return { rows: [] };
      return { rows: [] };
    });
    deps.listSubscriptionPayments.mockResolvedValueOnce({
      data: [
        {
          id: "pay-old-subscription",
          status: "CONFIRMED",
          value: 79.9,
          confirmedDate: "2026-05-27",
          dueDate: "2026-05-27",
        },
      ],
    });

    await expect(
      syncSubscriptionStatusHandler({ storeId }, "token", Promise.resolve(deps as any)),
    ).rejects.toThrow("mudou durante a sincronizacao");
    expect(deps.query).toHaveBeenCalledWith(
      expect.stringContaining("contract_price_monthly IS NOT DISTINCT FROM $7::numeric"),
      expect.arrayContaining([
        "local-subscription",
        storeId,
        "asaas-subscription",
        "2026-07-13T10:00:00.000Z",
        "2026-07-12T10:00:00.000Z",
        planId,
        79.9,
      ]),
    );
    expect(deps.publishRealtime).not.toHaveBeenCalled();
  });

  it.each([
    ["lower", 10],
    ["missing", undefined],
  ])(
    "does not activate a subscription when the reconciled paid value is %s",
    async (_label, value) => {
      const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
      configureSyncSubscription(deps);
      deps.listSubscriptionPayments.mockResolvedValueOnce({
        data: [
          {
            id: "pay-subscription",
            status: "CONFIRMED",
            value,
            confirmedDate: "2026-05-27",
            dueDate: "2026-05-27",
          },
        ],
      });

      const result = await syncSubscriptionStatusHandler(
        { storeId },
        "token",
        Promise.resolve(deps as any),
      );

      expect(result).toMatchObject({
        success: true,
        status: "inadimplente",
        activationBlocked: true,
        reason: "payment_value_mismatch",
        synced: true,
      });
      expect(deps.query).toHaveBeenCalledWith(expect.stringContaining("PAYMENT_VALUE_MISMATCH"), [
        "local-subscription",
        storeId,
        "asaas-subscription",
        "2026-07-13T10:00:00.000Z",
        "2026-07-12T10:00:00.000Z",
        planId,
        79.9,
      ]);
    },
  );

  it("never reactivates a canceled subscription from an old paid charge", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    configureSyncSubscription(deps, {
      status: "cancelada",
      canceled_at: "2026-07-13T10:00:00.000Z",
      current_period_end: "2026-08-01T00:00:00.000Z",
    });

    const result = await syncSubscriptionStatusHandler(
      { storeId },
      "token",
      Promise.resolve(deps as any),
    );

    expect(result).toMatchObject({
      success: true,
      status: "cancelada",
      activationBlocked: true,
      reason: "terminal_subscription",
      synced: false,
    });
    expect(deps.listSubscriptionPayments).not.toHaveBeenCalled();
    expect(
      deps.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE public.subscriptions")),
    ).toBe(false);
  });

  it.each(["ACTIVE", "INACTIVE"])(
    "clears stale terminal %s actions without calling the gateway",
    async (gatewayAction) => {
      const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
      configureSyncSubscription(
        deps,
        {
          status: "cancelada",
          canceled_at: "2026-07-13T10:00:00.000Z",
          gateway_action_pending: gatewayAction,
        },
        {
          status: "cancelada",
          gateway_action_pending: null,
          gateway_paused_for_dispute: false,
        },
      );

      const result = await syncSubscriptionStatusHandler(
        { storeId },
        "token",
        Promise.resolve(deps as any),
      );

      expect(result).toMatchObject({
        status: "cancelada",
        activationBlocked: true,
        reason: "terminal_subscription",
      });
      expect(deps.updateSubscription).not.toHaveBeenCalled();
      expect(deps.cancelSubscription).not.toHaveBeenCalled();
      const terminalCleanup = deps.query.mock.calls.find(([sql]) =>
        String(sql).includes("lower(COALESCE(status, '')) IN"),
      );
      expect(terminalCleanup?.[1]).toEqual([
        "local-subscription",
        storeId,
        "asaas-subscription",
        gatewayAction,
      ]);
    },
  );

  it("keeps a subscription disputed when a chargeback state is newer than an old payment", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    configureSyncSubscription(
      deps,
      {
        updated_at_cas: "2026-07-13 10:00:00.123456+00",
        last_payment_event_at_cas: "2026-07-12 10:00:00.654321+00",
      },
      {
        status: "em_disputa",
        last_payment_status: "AWAITING_CHARGEBACK_REVERSAL",
        gateway_action_pending: "INACTIVE",
        gateway_paused_for_dispute: true,
      },
    );
    deps.listSubscriptionPayments.mockResolvedValueOnce({
      data: [
        {
          id: "pay-old-confirmed",
          status: "CONFIRMED",
          value: 79.9,
          confirmedDate: "2026-07-01",
        },
        {
          id: "pay-disputed",
          status: "AWAITING_CHARGEBACK_REVERSAL",
          value: 79.9,
          dateCreated: "2026-07-10",
        },
      ],
    });

    const result = await syncSubscriptionStatusHandler(
      { storeId },
      "token",
      Promise.resolve(deps as any),
    );

    expect(result).toMatchObject({
      success: true,
      status: "em_disputa",
      gatewayStatus: "AWAITING_CHARGEBACK_REVERSAL",
      synced: true,
    });
    expect(deps.query).toHaveBeenCalledWith(
      expect.stringContaining("ELSE $8"),
      expect.arrayContaining([
        "2026-07-13 10:00:00.123456+00",
        "2026-07-12 10:00:00.654321+00",
        "em_disputa",
        "AWAITING_CHARGEBACK_REVERSAL",
        "INACTIVE",
      ]),
    );
    expect(deps.updateSubscription).toHaveBeenCalledWith("asaas-subscription", {
      status: "INACTIVE",
    });
  });

  it("allows a newer confirmed payment to recover a disputed subscription", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    configureSyncSubscription(
      deps,
      { status: "em_disputa", gateway_paused_for_dispute: true },
      {
        status: "ativa",
        last_payment_status: "CONFIRMED",
        gateway_action_pending: "ACTIVE",
        gateway_paused_for_dispute: true,
        next_due_date: "2026-08-15",
      },
    );
    deps.listSubscriptionPayments.mockResolvedValueOnce({
      data: [
        {
          id: "pay-recovered",
          status: "CONFIRMED",
          value: 79.9,
          confirmedDate: "2026-07-15",
          dueDate: "2026-07-15",
        },
      ],
    });
    deps.getSubscription.mockResolvedValueOnce({ status: "INACTIVE", nextDueDate: "2026-08-15" });

    const result = await syncSubscriptionStatusHandler(
      { storeId },
      "token",
      Promise.resolve(deps as any),
    );

    expect(result).toMatchObject({ status: "ativa", gatewayStatus: "CONFIRMED", synced: true });
    expect(deps.updateSubscription).toHaveBeenCalledWith("asaas-subscription", {
      status: "ACTIVE",
      nextDueDate: "2026-08-15",
    });
  });

  it("does not reactivate a disputed subscription when its next gateway due date is unavailable", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    configureSyncSubscription(deps, {
      status: "em_disputa",
      gateway_paused_for_dispute: true,
    });
    deps.listSubscriptionPayments.mockResolvedValueOnce({
      data: [
        {
          id: "pay-recovered",
          status: "CONFIRMED",
          value: 79.9,
          confirmedDate: "2026-07-15",
          dueDate: "2026-07-15",
        },
      ],
    });
    deps.getSubscription.mockResolvedValueOnce({
      errors: [{ description: "gateway unavailable" }],
    });

    await expect(
      syncSubscriptionStatusHandler({ storeId }, "token", Promise.resolve(deps as any)),
    ).rejects.toThrow("gateway unavailable");

    expect(deps.updateSubscription).not.toHaveBeenCalled();
    expect(
      deps.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE public.subscriptions")),
    ).toBe(false);
  });

  it.each(["REFUNDED", "PARTIALLY_REFUNDED"])(
    "terminally cancels a subscription synchronized as %s and cancels its recurrence",
    async (gatewayStatus) => {
      const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
      const subscription = {
        id: "local-subscription",
        store_id: storeId,
        plan_id: planId,
        status: "ativa",
        asaas_subscription_id: "asaas-subscription",
        updated_at: "2026-07-13T10:00:00.000Z",
        last_payment_event_at: "2026-07-12T10:00:00.000Z",
        contract_price_monthly: 79.9,
        current_price_monthly: 79.9,
      };
      deps.query.mockImplementation(async (sql: string) => {
        if (sql.includes("FROM public.stores")) {
          return { rows: [{ id: storeId, owner_user_id: ownerUserId, name: "Loja QA" }] };
        }
        if (sql.includes("FROM public.subscriptions")) return { rows: [subscription] };
        if (sql.includes("SET status = 'cancelada'")) {
          return {
            rows: [
              {
                ...subscription,
                status: "cancelada",
                last_payment_status: gatewayStatus,
                canceled_at: "2026-07-13T11:00:00.000Z",
                cancellation_effective_at: "2026-07-13T11:00:00.000Z",
                gateway_action_pending: "CANCEL",
              },
            ],
          };
        }
        if (sql.includes("gateway_action_pending = NULL")) {
          return {
            rows: [
              {
                ...subscription,
                status: "cancelada",
                last_payment_status: gatewayStatus,
                gateway_action_pending: null,
              },
            ],
          };
        }
        return { rows: [] };
      });
      deps.listSubscriptionPayments.mockResolvedValueOnce({
        data: [
          {
            id: "pay-refunded",
            status: gatewayStatus,
            value: 79.9,
            dateCreated: "2026-07-13T11:00:00.000Z",
          },
          {
            id: "pay-newer-confirmed",
            status: "CONFIRMED",
            value: 79.9,
            confirmedDate: "2026-07-14T11:00:00.000Z",
          },
        ],
      });

      const result = await syncSubscriptionStatusHandler(
        { storeId },
        "token",
        Promise.resolve(deps as any),
      );

      expect(result).toMatchObject({
        status: "cancelada",
        gatewayStatus,
        synced: true,
        activationBlocked: true,
        reason: "refunded_payment",
      });
      expect(deps.cancelSubscription).toHaveBeenCalledWith("asaas-subscription");
      expect(deps.query).toHaveBeenCalledWith(
        expect.stringContaining("current_period_end = now()"),
        [
          "local-subscription",
          storeId,
          "asaas-subscription",
          "2026-07-13T10:00:00.000Z",
          "2026-07-12T10:00:00.000Z",
          planId,
          79.9,
          gatewayStatus,
        ],
      );
      expect(deps.query).toHaveBeenCalledWith(
        expect.stringContaining("gateway_action_pending = NULL"),
        ["local-subscription", storeId, "asaas-subscription", "CANCEL", false],
      );
    },
  );

  it("retries a pending gateway cancellation before returning an already terminal sync", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    const subscription = {
      id: "local-subscription",
      store_id: storeId,
      plan_id: planId,
      status: "cancelada",
      canceled_at: "2026-07-13T10:00:00.000Z",
      asaas_subscription_id: "asaas-subscription",
      gateway_action_pending: "CANCEL",
    };
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.stores")) {
        return { rows: [{ id: storeId, owner_user_id: ownerUserId, name: "Loja QA" }] };
      }
      if (sql.includes("FROM public.subscriptions")) return { rows: [subscription] };
      if (sql.includes("gateway_action_pending = NULL")) {
        return { rows: [{ ...subscription, gateway_action_pending: null }] };
      }
      return { rows: [] };
    });

    const result = await syncSubscriptionStatusHandler(
      { storeId },
      "token",
      Promise.resolve(deps as any),
    );

    expect(result).toMatchObject({ status: "cancelada", reason: "terminal_subscription" });
    expect(deps.cancelSubscription).toHaveBeenCalledWith("asaas-subscription");
    expect(deps.listSubscriptionPayments).not.toHaveBeenCalled();
  });

  it("does not consume an exemption cancellation intent during manual sync", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    configureSyncSubscription(deps, { gateway_action_pending: "EXEMPT_CANCEL" });

    const result = await syncSubscriptionStatusHandler(
      { storeId },
      "token",
      Promise.resolve(deps as any),
    );

    expect(result).toMatchObject({
      success: true,
      synced: false,
      activationBlocked: true,
      reason: "billing_exemption_pending",
    });
    expect(deps.cancelSubscription).not.toHaveBeenCalled();
    expect(deps.updateSubscription).not.toHaveBeenCalled();
    expect(deps.listSubscriptionPayments).not.toHaveBeenCalled();
  });

  it("acknowledges an ACTIVE replay already applied by the gateway without changing its calendar", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    configureSyncSubscription(
      deps,
      {
        status: "em_disputa",
        gateway_action_pending: "ACTIVE",
        next_due_date: "2026-08-15",
      },
      {
        status: "em_disputa",
        gateway_action_pending: null,
        next_due_date: "2026-08-15",
      },
    );
    deps.getSubscription.mockResolvedValueOnce({
      status: "ACTIVE",
      nextDueDate: "2026-07-15",
    });

    const result = await syncSubscriptionStatusHandler(
      { storeId },
      "token",
      Promise.resolve(deps as any),
    );

    expect(result).toMatchObject({
      synced: false,
      message: expect.stringContaining("Nenhuma cobranca encontrada"),
    });
    expect(deps.updateSubscription).not.toHaveBeenCalled();
    expect(deps.query).toHaveBeenCalledWith(
      expect.stringContaining("gateway_action_pending = NULL"),
      ["local-subscription", storeId, "asaas-subscription", "ACTIVE", false],
    );
  });

  it("ends an expired gateway subscription and clears an incompatible ACTIVE replay", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    configureSyncSubscription(
      deps,
      {
        status: "em_disputa",
        gateway_action_pending: "ACTIVE",
        next_due_date: "2026-08-15",
      },
      {
        status: "encerrada",
        gateway_action_pending: null,
      },
    );
    deps.getSubscription.mockResolvedValueOnce({
      status: "EXPIRED",
      nextDueDate: "2026-07-15",
    });

    const result = await syncSubscriptionStatusHandler(
      { storeId },
      "token",
      Promise.resolve(deps as any),
    );

    expect(result).toMatchObject({
      success: true,
      status: "encerrada",
      synced: false,
      activationBlocked: true,
      reason: "terminal_subscription",
    });
    expect(deps.updateSubscription).not.toHaveBeenCalled();
    expect(deps.listSubscriptionPayments).not.toHaveBeenCalled();
    expect(deps.query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = CASE WHEN $5::boolean THEN 'encerrada'"),
      ["local-subscription", storeId, "asaas-subscription", "ACTIVE", true],
    );
  });

  it("keeps a subscription pending when the gateway charge is not paid yet", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.stores")) {
        return { rows: [{ id: storeId, owner_user_id: "owner-user", name: "Loja QA" }] };
      }
      if (sql.includes("FROM public.subscriptions")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              plan_id: planId,
              status: "pendente_pagamento",
              asaas_subscription_id: "asaas-subscription",
              next_due_date: "2026-05-27",
            },
          ],
        };
      }
      if (sql.includes("UPDATE public.subscriptions")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              plan_id: planId,
              status: "pendente_pagamento",
              last_payment_status: "PENDING",
            },
          ],
        };
      }
      return { rows: [] };
    });
    deps.listSubscriptionPayments.mockResolvedValueOnce({
      data: [
        {
          id: "pay-subscription",
          status: "PENDING",
          dueDate: "2026-05-27",
        },
      ],
    });

    const result = await syncSubscriptionStatusHandler(
      { storeId },
      "token",
      Promise.resolve(deps as any),
    );

    expect(result).toMatchObject({
      success: true,
      status: "pendente_pagamento",
      gatewayStatus: "PENDING",
      synced: true,
    });
    expect(deps.query).toHaveBeenCalledWith(
      expect.stringContaining("SET last_payment_status = $8"),
      [
        "local-subscription",
        storeId,
        "asaas-subscription",
        null,
        null,
        planId,
        null,
        "PENDING",
        "2026-05-27",
      ],
    );
  });

  it("marks the subscription as delinquent when the gateway payment failed", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.stores")) {
        return { rows: [{ id: storeId, owner_user_id: "owner-user", name: "Loja QA" }] };
      }
      if (sql.includes("FROM public.subscriptions")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              plan_id: planId,
              status: "pendente_pagamento",
              asaas_subscription_id: "asaas-subscription",
              next_due_date: "2026-05-27",
            },
          ],
        };
      }
      if (sql.includes("UPDATE public.subscriptions")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              plan_id: planId,
              status: "inadimplente",
              last_payment_status: "OVERDUE",
            },
          ],
        };
      }
      return { rows: [] };
    });
    deps.listSubscriptionPayments.mockResolvedValueOnce({
      data: [
        {
          id: "pay-subscription",
          status: "OVERDUE",
          dueDate: "2026-05-27",
        },
      ],
    });

    const result = await syncSubscriptionStatusHandler(
      { storeId },
      "token",
      Promise.resolve(deps as any),
    );

    expect(result).toMatchObject({
      success: true,
      status: "inadimplente",
      gatewayStatus: "OVERDUE",
      paymentId: "pay-subscription",
      synced: true,
    });
    expect(deps.query).toHaveBeenCalledWith(expect.stringContaining("ELSE $8"), [
      "local-subscription",
      storeId,
      "asaas-subscription",
      null,
      null,
      planId,
      null,
      "inadimplente",
      "OVERDUE",
      null,
      "2026-05-27",
      null,
    ]);
  });

  it("cancels recurring billing before an admin suspends a store", async () => {
    const deps = createDeps({ admin: true, ownedStoreIds: [] });
    const subscription = {
      id: "local-subscription",
      store_id: storeId,
      status: "ativa",
      asaas_subscription_id: "asaas-subscription",
      current_period_end: "2026-08-01T00:00:00.000Z",
    };
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("SELECT id, is_suspended")) {
        return { rows: [{ id: storeId, is_suspended: false }] };
      }
      if (sql.includes("SELECT *") && sql.includes("FROM public.subscriptions")) {
        return { rows: [subscription] };
      }
      if (sql.includes("UPDATE public.stores")) {
        return { rows: [{ id: storeId, is_suspended: true }] };
      }
      if (sql.includes("UPDATE public.subscriptions")) {
        return { rows: [{ ...subscription, status: "cancelada" }] };
      }
      return { rows: [] };
    });

    const result = await adminSetStoreSuspensionHandler(
      { storeId, suspended: true },
      "admin-token",
      Promise.resolve(deps as any),
    );

    expect(deps.cancelSubscription).toHaveBeenCalledWith("asaas-subscription");
    expect(result).toEqual({
      success: true,
      suspended: true,
      subscriptionStatus: "cancelada",
    });
    expect(deps.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE public.stores"), [
      storeId,
      true,
    ]);
  });

  it("does not suspend locally when recurring billing cancellation fails", async () => {
    const deps = createDeps({ admin: true, ownedStoreIds: [] });
    deps.cancelSubscription.mockResolvedValueOnce({
      errors: [{ description: "gateway unavailable" }],
    } as any);
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (sql.includes("SELECT id, is_suspended")) {
        return { rows: [{ id: storeId, is_suspended: false }] };
      }
      if (sql.includes("SELECT *") && sql.includes("FROM public.subscriptions")) {
        return {
          rows: [
            {
              id: "local-subscription",
              store_id: storeId,
              status: "ativa",
              asaas_subscription_id: "asaas-subscription",
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      adminSetStoreSuspensionHandler(
        { storeId, suspended: true },
        "admin-token",
        Promise.resolve(deps as any),
      ),
    ).rejects.toThrow("gateway unavailable");
    expect(
      deps.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE public.stores")),
    ).toBe(false);
  });

  it("reconciles gateway cancellation even when the local subscription is already canceled", async () => {
    const deps = createDeps({ admin: true, ownedStoreIds: [] });
    configureSyncSubscription(
      deps,
      {
        status: "cancelada",
        cancellation_effective_at: "2026-08-01T00:00:00.000Z",
        gateway_action_pending: "CANCEL",
        gateway_paused_for_dispute: true,
      },
      {
        status: "cancelada",
        cancellation_effective_at: "2026-08-01T00:00:00.000Z",
        gateway_action_pending: null,
        gateway_paused_for_dispute: false,
      },
    );

    const result = await cancelSubscriptionHandler(
      { storeId },
      "admin-token",
      Promise.resolve(deps as any),
    );

    expect(deps.cancelSubscription).toHaveBeenCalledWith("asaas-subscription");
    expect(result).toMatchObject({ status: "cancelada" });
    const reconciliationUpdate = deps.query.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE public.subscriptions"),
    );
    expect(reconciliationUpdate?.[0]).toContain("gateway_action_pending = NULL");
    expect(reconciliationUpdate?.[0]).toContain("gateway_paused_for_dispute = false");
  });

  it("serializes cancellation and updates only the locked subscription identity", async () => {
    const deps = createDeps({ admin: false, ownedStoreIds: [storeId] });
    const subscription = {
      id: "local-subscription",
      store_id: storeId,
      status: "ativa",
      asaas_subscription_id: "asaas-subscription",
      current_period_end: "2026-08-01T00:00:00.000Z",
    };
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.stores")) {
        return {
          rows: [
            {
              id: storeId,
              owner_user_id: ownerUserId,
              is_active: true,
              is_suspended: false,
            },
          ],
        };
      }
      if (sql.includes("FROM public.profiles")) return { rows: [] };
      if (sql.includes("FROM public.subscriptions")) return { rows: [subscription] };
      if (sql.includes("UPDATE public.subscriptions")) {
        return {
          rows: [
            {
              ...subscription,
              status: "cancelada",
              cancellation_effective_at: "2026-08-01T00:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await cancelSubscriptionHandler(
      { storeId },
      "token",
      Promise.resolve(deps as any),
    );

    expect(result).toMatchObject({
      status: "cancelada",
      cancellationEffectiveAt: "2026-08-01T00:00:00.000Z",
    });
    expect(deps.query).toHaveBeenCalledWith(expect.stringContaining("pg_advisory_xact_lock"), [
      expect.stringContaining(`subscription:${storeId}`),
    ]);
    expect(deps.query).toHaveBeenCalledWith(
      expect.stringContaining("asaas_subscription_id IS NOT DISTINCT FROM $3::text"),
      ["local-subscription", storeId, "asaas-subscription", "2026-08-01T00:00:00.000Z"],
    );
    const identityUpdate = deps.query.mock.calls.find(([sql]) =>
      String(sql).includes("asaas_subscription_id IS NOT DISTINCT FROM $3::text"),
    );
    expect(identityUpdate?.[0]).toContain("gateway_action_pending = NULL");
    expect(identityUpdate?.[0]).toContain("gateway_paused_for_dispute = false");
  });

  it("validates the owner profile before any exemption gateway side effect", async () => {
    const deps = createDeps({ admin: true, ownedStoreIds: [] });
    deps.query.mockResolvedValue({ rows: [] });

    await expect(
      adminSetStoreExemptionHandler(
        { storeId, profileId, exempt: true },
        "admin-token",
        Promise.resolve(deps as any),
      ),
    ).rejects.toThrow("Perfil responsavel");

    expect(deps.cancelSubscription).not.toHaveBeenCalled();
    expect(
      deps.query.mock.calls.some(([sql]) => String(sql).includes("UPDATE public.profiles")),
    ).toBe(false);
  });

  it("grants a global exemption only after canceling every owner-store recurrence under sorted locks", async () => {
    const deps = createDeps({ admin: true, ownedStoreIds: [] });
    const preparedProfileVersion = "2026-07-13 12:00:00.123456+00";
    const subscriptions = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        store_id: storeId,
        status: "ativa",
        asaas_subscription_id: "asaas-subscription-one",
        gateway_action_pending: "EXEMPT_CANCEL",
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        store_id: secondStoreId,
        status: "ativa",
        asaas_subscription_id: "asaas-subscription-two",
        gateway_action_pending: "EXEMPT_CANCEL",
      },
    ];
    deps.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM public.profiles profile")) {
        return {
          rows: [
            {
              id: profileId,
              user_id: ownerUserId,
              is_exempt: false,
              requested_store_id: storeId,
            },
          ],
        };
      }
      if (sql.includes("FROM public.stores") && sql.includes("owner_user_id = $1::uuid")) {
        return { rows: [{ id: storeId }, { id: secondStoreId }] };
      }
      if (sql.includes("FROM public.profiles")) {
        return {
          rows: [
            {
              id: profileId,
              user_id: ownerUserId,
              is_exempt: false,
              updated_at: preparedProfileVersion,
              billing_exemption_pending: Boolean(params?.[2]),
            },
          ],
        };
      }
      if (sql.includes("FROM public.subscriptions")) return { rows: subscriptions };
      if (sql.includes("SET gateway_action_pending = 'EXEMPT_CANCEL'")) {
        return { rows: [] };
      }
      if (sql.includes("UPDATE public.subscriptions")) {
        const subscription = subscriptions.find((item) => item.id === params?.[0]);
        return {
          rows: subscription
            ? [
                {
                  ...subscription,
                  status: "cancelada",
                  gateway_action_pending: null,
                  gateway_paused_for_dispute: false,
                },
              ]
            : [],
        };
      }
      if (sql.includes("SET billing_exemption_pending = true")) {
        return { rows: [{ updated_at_version: preparedProfileVersion }] };
      }
      if (sql.includes("SET is_exempt = $3::boolean")) {
        return {
          rows: [{ id: profileId, user_id: ownerUserId, is_exempt: true }],
        };
      }
      return { rows: [] };
    });

    const result = await adminSetStoreExemptionHandler(
      { storeId, profileId, exempt: true },
      "admin-token",
      Promise.resolve(deps as any),
    );

    expect(result).toMatchObject({
      success: true,
      profileId,
      isExempt: true,
      recurrenceCanceled: true,
      affectedStoreIds: [storeId, secondStoreId],
      canceledSubscriptionCount: 2,
    });
    expect(deps.cancelSubscription.mock.calls).toEqual([
      ["asaas-subscription-one"],
      ["asaas-subscription-two"],
    ]);
    const outboxCallIndex = deps.query.mock.calls.findIndex(([sql]) =>
      String(sql).includes("SET gateway_action_pending = 'EXEMPT_CANCEL'"),
    );
    expect(outboxCallIndex).toBeGreaterThanOrEqual(0);
    expect(deps.query.mock.calls[outboxCallIndex]?.[1]).toEqual([[storeId, secondStoreId]]);
    expect(deps.query.mock.invocationCallOrder[outboxCallIndex]).toBeLessThan(
      deps.cancelSubscription.mock.invocationCallOrder[0] || Number.POSITIVE_INFINITY,
    );
    const profileCasCall = deps.query.mock.calls.find(
      ([sql, params]) =>
        String(sql).includes("updated_at IS NOT DISTINCT FROM $3::timestamptz") &&
        params?.[2] === preparedProfileVersion,
    );
    expect(profileCasCall?.[1]).toEqual([profileId, ownerUserId, preparedProfileVersion]);
    const advisoryKeys = (deps.query.mock.calls as unknown as Array<[string, unknown[]?]>)
      .filter(([sql]) => String(sql).includes("pg_advisory_xact_lock"))
      .map(([, params]) => params?.[0]);
    expect(advisoryKeys).toEqual([
      `subscription-exemption:${profileId}`,
      `subscription:${storeId}`,
      `subscription:${secondStoreId}`,
      `subscription-exemption:${profileId}`,
      `subscription:${storeId}`,
      `subscription:${secondStoreId}`,
    ]);
    const subscriptionUpdates = deps.query.mock.calls.filter(([sql]) =>
      String(sql).includes("SET status = CASE"),
    );
    expect(subscriptionUpdates).toHaveLength(2);
    for (const [sql] of subscriptionUpdates) {
      expect(String(sql)).toContain("asaas_subscription_id IS NOT DISTINCT FROM $3::text");
      expect(String(sql)).toContain("gateway_action_pending = NULL");
      expect(String(sql)).toContain("gateway_paused_for_dispute = false");
    }
  });

  it("does not mutate exemption state when one of multiple recurrence cancellations fails", async () => {
    const deps = createDeps({ admin: true, ownedStoreIds: [] });
    const preparedProfileVersion = "2026-07-13 12:00:00.123456+00";
    const subscriptions = [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        store_id: storeId,
        status: "ativa",
        asaas_subscription_id: "asaas-subscription-one",
        gateway_action_pending: "EXEMPT_CANCEL",
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        store_id: secondStoreId,
        status: "ativa",
        asaas_subscription_id: "asaas-subscription-two",
        gateway_action_pending: "EXEMPT_CANCEL",
      },
    ];
    deps.cancelSubscription
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ errors: [{ description: "gateway unavailable" }] } as any);
    deps.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM public.profiles profile")) {
        return {
          rows: [{ id: profileId, user_id: ownerUserId, is_exempt: false }],
        };
      }
      if (sql.includes("FROM public.stores") && sql.includes("owner_user_id = $1::uuid")) {
        return { rows: [{ id: storeId }, { id: secondStoreId }] };
      }
      if (sql.includes("FROM public.profiles")) {
        return {
          rows: [
            {
              id: profileId,
              user_id: ownerUserId,
              is_exempt: false,
              updated_at: preparedProfileVersion,
              billing_exemption_pending: Boolean(params?.[2]),
            },
          ],
        };
      }
      if (sql.includes("FROM public.subscriptions")) return { rows: subscriptions };
      if (sql.includes("SET gateway_action_pending = 'EXEMPT_CANCEL'")) return { rows: [] };
      if (sql.includes("SET billing_exemption_pending = true")) {
        return { rows: [{ updated_at_version: preparedProfileVersion }] };
      }
      return { rows: [] };
    });

    await expect(
      adminSetStoreExemptionHandler(
        { storeId, profileId, exempt: true },
        "admin-token",
        Promise.resolve(deps as any),
      ),
    ).rejects.toThrow("gateway unavailable");
    expect(
      deps.query.mock.calls.some(([sql]) => String(sql).includes("SET is_exempt = $3::boolean")),
    ).toBe(false);
    expect(
      deps.query.mock.calls.some(([sql]) =>
        String(sql).includes("SET gateway_action_pending = 'EXEMPT_CANCEL'"),
      ),
    ).toBe(true);
    expect(deps.query.mock.calls.some(([sql]) => String(sql).includes("SET status = CASE"))).toBe(
      false,
    );
  });

  it("does not call the gateway when the profile changes after the durable outbox commit", async () => {
    const deps = createDeps({ admin: true, ownedStoreIds: [] });
    const preparedProfileVersion = "2026-07-13 12:00:00.123456+00";
    deps.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM public.profiles profile")) {
        return { rows: [{ id: profileId, user_id: ownerUserId, is_exempt: false }] };
      }
      if (sql.includes("FROM public.stores") && sql.includes("owner_user_id = $1::uuid")) {
        return { rows: [{ id: storeId }] };
      }
      if (sql.includes("FROM public.profiles") && sql.includes("FOR UPDATE")) {
        return params?.[2] === null
          ? {
              rows: [
                {
                  id: profileId,
                  user_id: ownerUserId,
                  is_exempt: false,
                  updated_at: "2026-07-13T11:00:00.000Z",
                },
              ],
            }
          : { rows: [] };
      }
      if (sql.includes("FROM public.subscriptions")) {
        return {
          rows: [
            {
              id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              store_id: storeId,
              status: "ativa",
              asaas_subscription_id: "asaas-subscription-one",
              gateway_action_pending: "EXEMPT_CANCEL",
            },
          ],
        };
      }
      if (sql.includes("SET gateway_action_pending = 'EXEMPT_CANCEL'")) return { rows: [] };
      if (sql.includes("SET billing_exemption_pending = true")) {
        return { rows: [{ updated_at_version: preparedProfileVersion }] };
      }
      return { rows: [] };
    });

    await expect(
      adminSetStoreExemptionHandler(
        { storeId, profileId, exempt: true },
        "admin-token",
        Promise.resolve(deps as any),
      ),
    ).rejects.toThrow("O perfil mudou");

    expect(deps.cancelSubscription).not.toHaveBeenCalled();
    expect(
      deps.query.mock.calls.some(([sql]) => String(sql).includes("SET is_exempt = $3::boolean")),
    ).toBe(false);
  });

  it("removes an exemption without touching gateway recurrence state", async () => {
    const deps = createDeps({ admin: true, ownedStoreIds: [] });
    deps.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM public.profiles profile")) {
        return { rows: [{ id: profileId, user_id: ownerUserId, is_exempt: true }] };
      }
      if (sql.includes("FROM public.stores") && sql.includes("owner_user_id = $1::uuid")) {
        return { rows: [{ id: storeId }] };
      }
      if (sql.includes("FROM public.profiles")) {
        return {
          rows: [
            {
              id: profileId,
              user_id: ownerUserId,
              is_exempt: true,
              updated_at: "2026-07-13T12:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("FROM public.subscriptions")) return { rows: [] };
      if (sql.includes("SET is_exempt = $3::boolean")) {
        return { rows: [{ id: profileId, user_id: ownerUserId, is_exempt: false }] };
      }
      return { rows: [] };
    });

    const result = await adminSetStoreExemptionHandler(
      { storeId, profileId, exempt: false },
      "admin-token",
      Promise.resolve(deps as any),
    );

    expect(result).toMatchObject({
      success: true,
      isExempt: false,
      recurrenceCanceled: false,
      canceledSubscriptionCount: 0,
    });
    expect(deps.withTransaction).toHaveBeenCalledTimes(1);
    expect(deps.cancelSubscription).not.toHaveBeenCalled();
    expect(
      deps.query.mock.calls.some(([sql]) =>
        String(sql).includes("SET gateway_action_pending = 'EXEMPT_CANCEL'"),
      ),
    ).toBe(false);
  });
});
