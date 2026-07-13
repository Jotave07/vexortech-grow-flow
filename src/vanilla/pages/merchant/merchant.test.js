import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getStoreId, queryValue } from "./core.js";
import { requireActiveSubscription, subscriptionAccessState } from "./access.js";
import { routes } from "./index.js";
import {
  canApproveManualPix,
  filterOrders,
  groupOrders,
  nextOrderLabel,
  nextOrderStatus,
} from "./orders-model.js";
import { buildReport } from "./reports-model.js";
import {
  buildSubscriptionRequest,
  isSubscriptionPlanChangeBlocked,
  isValidCardNumber,
  SUBSCRIPTION_BILLING_TYPES,
} from "./subscription.js";

const merchantDirectory = fileURLToPath(new URL(".", import.meta.url));

describe("merchant route inventory", () => {
  const expectedPatterns = [
    "/lojista/assinatura",
    "/lojista/pedidos",
    "/lojista/cardapio",
    "/lojista/categorias",
    "/lojista/clientes",
    "/lojista/cupons",
    "/lojista/entregas",
    "/lojista/entregadores",
    "/lojista/relatorios",
    "/lojista/configuracoes",
    "/lojista/usuarios",
    "/lojista",
  ];

  it("preserves every current merchant route with the merchant guard and layout", () => {
    expect(routes.map((route) => route.pattern)).toEqual(expectedPatterns);
    expect(new Set(routes.map((route) => route.pattern)).size).toBe(routes.length);
    for (const route of routes) {
      expect(route.auth).toBe("store_owner");
      expect(route.layout).toBe("merchant");
      expect(route.title).toBeTruthy();
      expect(route.render).toEqual(expect.any(Function));
    }
  });
});

describe("merchant shell contract helpers", () => {
  it("reads URLSearchParams and plain query objects", () => {
    expect(queryValue({ query: new URLSearchParams("view=kanban") }, "view")).toBe("kanban");
    expect(queryValue({ query: { range: "90" } }, "range")).toBe("90");
    expect(queryValue({ query: new URLSearchParams() }, "missing", "fallback")).toBe("fallback");
  });

  it("resolves the store selected by the vanilla auth shell", () => {
    expect(getStoreId({ params: {}, auth: { store: { id: "store-a" } } })).toBe("store-a");
    expect(getStoreId({ params: {}, auth: { stores: [{ id: "store-b" }] } })).toBe("store-b");
    expect(() => getStoreId({ params: {}, auth: {} })).toThrow("Loja nao vinculada");
  });
});

describe("merchant access precedence", () => {
  const exemptProfile = { is_exempt: true };

  it("keeps admin bypass while suspension and inactivity override owner courtesy", () => {
    expect(
      subscriptionAccessState({
        store: { is_active: false, is_suspended: true },
        profile: exemptProfile,
        role: "super_admin",
      }),
    ).toBe("active");
    expect(
      subscriptionAccessState({
        store: { is_active: true, is_suspended: true },
        profile: exemptProfile,
        role: "store_owner",
      }),
    ).toBe("blocked");
    expect(
      subscriptionAccessState({
        store: { is_active: false, is_suspended: false },
        profile: exemptProfile,
        role: "store_owner",
      }),
    ).toBe("blocked");
  });

  it("keeps owner courtesy active for an operational store", () => {
    expect(
      subscriptionAccessState({
        store: { is_active: true, is_suspended: false },
        profile: exemptProfile,
        role: "store_owner",
      }),
    ).toBe("active");
  });

  it("loads is_active before granting courtesy in the route guard", async () => {
    const selections = new Map();
    const ctx = {
      path: "/lojista/cardapio",
      params: {},
      auth: {
        role: "store_owner",
        profile: { store_id: "store-a", is_exempt: true },
      },
      api: {
        from(table) {
          return {
            select(columns) {
              selections.set(table, columns);
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      return {
                        data:
                          table === "stores"
                            ? { id: "store-a", is_active: true, is_suspended: false }
                            : null,
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        },
      },
    };

    await expect(requireActiveSubscription(ctx)).resolves.toBe(true);
    expect(selections.get("stores")).toBe("id, is_active, is_suspended");
  });
});

describe("merchant order workflow", () => {
  const orders = [
    {
      id: "1",
      order_number: 42,
      customer_name: "Ana",
      status: "novo",
      delivery_type: "entrega",
      created_at: "2026-07-10T12:00:00Z",
    },
    {
      id: "2",
      order_number: 41,
      customer_name: "Bruno",
      status: "em_preparo",
      delivery_type: "retirada",
      created_at: "2026-07-10T11:00:00Z",
    },
    {
      id: "3",
      order_number: 40,
      customer_name: "Carla",
      status: "confirmado",
      delivery_type: "entrega",
      created_at: "2026-07-10T10:00:00Z",
    },
  ];

  it("applies the same search, status and delivery filters used by table and Kanban", () => {
    expect(
      filterOrders(orders, { search: "ana", status: "novo", deliveryType: "entrega" }).map(
        (order) => order.id,
      ),
    ).toEqual(["1"]);
    expect(filterOrders(orders, { search: "41" }).map((order) => order.id)).toEqual(["2"]);
    expect(
      groupOrders(filterOrders(orders, { deliveryType: "retirada" })).preparing.map(
        (order) => order.id,
      ),
    ).toEqual(["2"]);
  });

  it("uses explicit status transitions for delivery and pickup", () => {
    expect(nextOrderStatus(orders[0])).toBe("confirmado");
    expect(nextOrderLabel(orders[0])).toBe("Aceitar pedido");
    expect(nextOrderStatus(orders[1])).toBe("pronto_para_retirada");
    expect(nextOrderLabel(orders[1])).toBe("Marcar pronto");
    expect(nextOrderStatus({ status: "entregue" })).toBeNull();
  });

  it("fails closed when manual Pix provenance is absent or belongs to a gateway", () => {
    const pix = { payment_method: "pix", status: "aguardando_pagamento" };
    expect(canApproveManualPix({ ...pix, payment: { provider: "manual_pix" } })).toBe(true);
    expect(canApproveManualPix({ ...pix, payment: { provider: "asaas" } })).toBe(false);
    expect(canApproveManualPix(pix)).toBe(false);
    expect(canApproveManualPix({ ...pix, status: "novo", payment_provider: "manual_pix" })).toBe(
      false,
    );
  });
});

describe("merchant reports", () => {
  it("excludes canceled revenue and canceled order items", () => {
    const report = buildReport(
      [
        {
          id: "paid",
          status: "entregue",
          total: 80,
          delivery_type: "entrega",
          payment_method: "pix",
          created_at: "2026-07-09T12:00:00Z",
        },
        {
          id: "canceled",
          status: "cancelado",
          total: 200,
          delivery_type: "retirada",
          payment_method: "dinheiro",
          created_at: "2026-07-09T13:00:00Z",
        },
      ],
      [
        { order_id: "paid", product_name: "Pizza", quantity: 2, subtotal: 80 },
        { order_id: "canceled", product_name: "Produto cancelado", quantity: 10, subtotal: 200 },
      ],
    );

    expect(report).toMatchObject({
      orderCount: 1,
      revenue: 80,
      averageTicket: 80,
      canceledCount: 1,
      deliveryCount: 1,
      pickupCount: 0,
    });
    expect(report.topProducts).toEqual([["Pizza", { quantity: 2, revenue: 80 }]]);
    expect(report.payments).toEqual([["pix", 1]]);
  });
});

describe("merchant subscription checkout", () => {
  const identity = {
    customerName: "Ana Parceira",
    customerEmail: "ana@example.com",
    customerDocument: "529.982.247-25",
    customerPhone: "(11) 99999-9999",
  };

  it("blocks plan changes for suspended or blocked subscriptions", () => {
    expect(isSubscriptionPlanChangeBlocked({ status: "bloqueada" })).toBe(true);
    expect(isSubscriptionPlanChangeBlocked({ status: "SUSPENSA" })).toBe(true);
    expect(isSubscriptionPlanChangeBlocked({ status: "em_disputa" })).toBe(true);
    expect(isSubscriptionPlanChangeBlocked({ status: "cancelada" })).toBe(false);
    expect(isSubscriptionPlanChangeBlocked({ status: "ativa" })).toBe(false);
  });

  it("offers the two backend billing contracts and sends boleto without card fields", () => {
    expect(SUBSCRIPTION_BILLING_TYPES).toEqual(["BOLETO", "CREDIT_CARD"]);
    const request = buildSubscriptionRequest({
      storeId: "10000000-0000-4000-8000-000000000001",
      planId: "30000000-0000-4000-8000-000000000001",
      billingType: "BOLETO",
      values: identity,
    });
    expect(request).toMatchObject({
      ok: true,
      functionName: "create-subscription-checkout",
      body: {
        billingType: "BOLETO",
        customerData: {
          name: "Ana Parceira",
          email: "ana@example.com",
          cpfCnpj: "52998224725",
          mobilePhone: "11999999999",
        },
      },
    });
    expect(request.body).not.toHaveProperty("cardData");
  });

  it("uses the lean backend contract when an existing subscription changes to boleto", () => {
    const request = buildSubscriptionRequest({
      storeId: "10000000-0000-4000-8000-000000000001",
      planId: "30000000-0000-4000-8000-000000000002",
      billingType: "BOLETO",
      operation: "update",
      values: {},
    });
    expect(request).toMatchObject({
      ok: true,
      functionName: "update-subscription-plan",
      body: { billingType: "BOLETO" },
    });
    expect(request.body).not.toHaveProperty("customerData");
    expect(request.body).not.toHaveProperty("cardData");
  });

  it("normalizes and validates the complete credit-card contract before update", () => {
    expect(isValidCardNumber("4111 1111 1111 1111")).toBe(true);
    expect(isValidCardNumber("4111 1111 1111 1112")).toBe(false);
    const request = buildSubscriptionRequest({
      storeId: "10000000-0000-4000-8000-000000000001",
      planId: "30000000-0000-4000-8000-000000000002",
      billingType: "CREDIT_CARD",
      operation: "update",
      now: new Date("2026-07-10T12:00:00Z"),
      values: {
        ...identity,
        cardHolderName: "ANA PARCEIRA",
        cardNumber: "4111 1111 1111 1111",
        expiryMonth: "08",
        expiryYear: "28",
        ccv: "123",
        postalCode: "01310-100",
        addressNumber: "100",
        addressComplement: "Sala 2",
      },
    });
    expect(request).toMatchObject({
      ok: true,
      functionName: "update-subscription-plan",
      body: {
        billingType: "CREDIT_CARD",
        cardData: {
          creditCard: {
            holderName: "ANA PARCEIRA",
            number: "4111111111111111",
            expiryMonth: "08",
            expiryYear: "2028",
            ccv: "123",
          },
          creditCardHolderInfo: {
            cpfCnpj: "52998224725",
            postalCode: "01310100",
            addressNumber: "100",
          },
        },
      },
    });
    expect(request.body).not.toHaveProperty("customerData");
  });

  it("fails closed for unsupported billing, invalid identity and expired card", () => {
    const request = buildSubscriptionRequest({
      storeId: "store",
      planId: "plan",
      billingType: "PIX",
      now: new Date("2026-07-10T12:00:00Z"),
      values: {
        customerName: "A",
        customerEmail: "invalid",
        customerDocument: "111.111.111-11",
        cardNumber: "123",
        expiryMonth: "01",
        expiryYear: "2020",
      },
    });
    expect(request.ok).toBe(false);
    expect(request.body).toBeNull();
    expect(request.errors).toEqual(
      expect.arrayContaining(["Escolha boleto ou cartao de credito."]),
    );
  });
});

describe("merchant vanilla and CSP boundaries", () => {
  it("does not import component frameworks or use unsafe HTML sinks", async () => {
    const files = (await readdir(merchantDirectory)).filter(
      (name) => name.endsWith(".js") && !name.endsWith(".test.js"),
    );
    const source = (
      await Promise.all(files.map((name) => readFile(new URL(name, import.meta.url), "utf8")))
    ).join("\n");
    expect(source).not.toMatch(
      /from\s+["'](?:react|react-dom|@radix-ui|framer-motion|tailwindcss)/,
    );
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });

  it("loads a static stylesheet without creating style elements", async () => {
    const [indexSource, stylesSource, reportsSource] = await Promise.all([
      readFile(new URL("index.js", import.meta.url), "utf8"),
      readFile(new URL("styles.js", import.meta.url), "utf8"),
      readFile(new URL("reports.js", import.meta.url), "utf8"),
    ]);
    expect(indexSource).toContain('import "./merchant.css"');
    expect(stylesSource).not.toContain('createElement("style")');
    expect(stylesSource).not.toContain("ensureStyles(");
    expect(reportsSource).not.toMatch(/style\s*:/);
  });
});
