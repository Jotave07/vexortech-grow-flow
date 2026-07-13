import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { routes } from "./index.js";
import { calculateDashboardMetrics } from "./dashboard.js";
import { FINANCIAL_BUCKETS, subscriptionSummary } from "./finance.js";
import { filterOrders, nextOrderStatuses } from "./orders.js";
import { parseFeatures, planPayload } from "./plans.js";
import { platformHealthSummary } from "./platform.js";
import { filterStores } from "./stores.js";

describe("contrato das rotas administrativas vanilla", () => {
  it("preserva aliases existentes e protege todas as rotas como super_admin", () => {
    const patterns = routes.map((route) => route.pattern);
    expect(patterns).toEqual(
      expect.arrayContaining([
        "/admin",
        "/admin/lojas",
        "/admin/parceiros",
        "/admin/planos",
        "/admin/configuracoes",
        "/admin/cadastros",
        "/admin/pedidos",
        "/admin/financeiro",
      ]),
    );
    expect(
      routes.every((route) => route.auth === "super_admin" && typeof route.render === "function"),
    ).toBe(true);
    const settingsRoute = routes.find((route) => route.pattern === "/admin/configuracoes");
    const financeRoute = routes.find((route) => route.pattern === "/admin/financeiro");
    expect(settingsRoute).toMatchObject({
      title: "Configuracoes e saude",
      render: expect.any(Function),
    });
    expect(settingsRoute.render).not.toBe(financeRoute.render);
  });
});

describe("metricas e filtros administrativos", () => {
  it("exclui pedidos cancelados do GMV e calcula MRR somente de cobrancas ativas", () => {
    const metrics = calculateDashboardMetrics({
      totalStores: 3,
      activeStores: 2,
      orders: [
        { status: "entregue", total: 120 },
        { status: "cancelado", total: 80 },
      ],
      subscriptions: [
        { status: "ativa", asaas_subscription_id: "sub-1", plans: { price_monthly: 59.9 } },
        { status: "trial", asaas_subscription_id: null, plans: { price_monthly: 99 } },
        { status: "inadimplente", asaas_subscription_id: "sub-2", plans: { price_monthly: 39 } },
      ],
    });
    expect(metrics).toEqual(
      expect.objectContaining({ orders30: 1, revenue30: 120, mrr: 59.9, atRisk: 1 }),
    );
  });

  it("filtra lojas e pedidos sem alterar a colecao de origem", () => {
    const stores = [
      {
        name: "Cafe Hype",
        is_active: true,
        is_suspended: false,
        subscriptions: [{ plan_id: "p1" }],
      },
      { name: "Loja B", is_active: false, is_suspended: true, subscriptions: [] },
    ];
    expect(filterStores(stores, { search: "cafe", status: "active", plan: "p1" })).toHaveLength(1);
    const orders = [
      { order_number: 10, status: "novo", payment_status: "pago", stores: { name: "Cafe Hype" } },
      { order_number: 11, status: "entregue", payment_status: "pago", stores: { name: "Loja B" } },
    ];
    expect(filterOrders(orders, { search: "cafe", status: "novo", payment: "pago" })).toHaveLength(
      1,
    );
    expect(stores).toHaveLength(2);
  });
});

describe("contratos de gestao financeira e planos", () => {
  it("routes suspension and courtesy through billing-aware server functions", async () => {
    const source = await readFile(new URL("./stores.js", import.meta.url), "utf8");
    expect(source).toContain('ctx.api.fn("admin-set-store-suspension"');
    expect(source).toContain('ctx.api.fn("admin-set-store-exemption"');
    expect(source).not.toContain(".update({ is_suspended: suspending })");
    expect(source).not.toContain(".update({ is_exempt: next })");
  });

  it("limita transicoes de pedido ao proximo estado conhecido", () => {
    expect(nextOrderStatuses("novo")).toEqual(["confirmado", "cancelado"]);
    expect(nextOrderStatuses("entregue")).toEqual([]);
    expect(FINANCIAL_BUCKETS.map(([value]) => value)).toContain("reembolso_falho");
  });

  it("normaliza recursos e valores do plano", () => {
    expect(parseFeatures("Cupons\n\n Relatorios ")).toEqual(["Cupons", "Relatorios"]);
    expect(
      planPayload({
        name: "Pro",
        slug: "PRO",
        price_monthly: "49.90",
        features: "Cupons",
        is_active: true,
      }),
    ).toEqual(
      expect.objectContaining({
        slug: "pro",
        price_monthly: 49.9,
        features: ["Cupons"],
        is_active: true,
      }),
    );
  });

  it("calcula resumo de assinatura sem contar trial sem cobranca no MRR", () => {
    expect(
      subscriptionSummary([
        { status: "ativa", asaas_subscription_id: "sub", plans: { price_monthly: 50 } },
        { status: "trial", asaas_subscription_id: null, plans: { price_monthly: 90 } },
        { status: "pendente_pagamento", asaas_subscription_id: null, plans: { price_monthly: 30 } },
      ]),
    ).toEqual({ active: 2, risk: 1, mrr: 50 });
  });

  it("resume saude da plataforma sem expor configuracoes secretas", () => {
    expect(
      platformHealthSummary({
        apiStatus: "ok",
        totalPlans: 3,
        activePlans: 2,
        platformAdmins: 1,
        recentAudits: [{ action: "store.reviewed" }],
      }),
    ).toEqual(
      expect.objectContaining({
        state: "operational",
        issues: [],
        activePlans: 2,
        platformAdmins: 1,
      }),
    );
    expect(
      platformHealthSummary({
        apiStatus: "error",
        totalPlans: 1,
        activePlans: 0,
        platformAdmins: 0,
      }),
    ).toEqual(
      expect.objectContaining({
        state: "attention",
        issues: expect.arrayContaining([
          "API ou banco de dados indisponivel",
          "nenhum plano ativo publicado",
          "nenhum administrador de plataforma registrado",
        ]),
      }),
    );
  });
});
