import { createAdminPage, dataOf, h, money } from "./core.js";

export function calculateDashboardMetrics({
  totalStores = 0,
  activeStores = 0,
  orders = [],
  subscriptions = [],
} = {}) {
  const validOrders = orders.filter(
    (order) => !["cancelado", "cancelled"].includes(String(order.status).toLowerCase()),
  );
  const billable = subscriptions.filter(
    (subscription) =>
      subscription.status === "ativa" && Boolean(subscription.asaas_subscription_id),
  );
  return {
    totalStores: Number(totalStores || 0),
    activeStores: Number(activeStores || 0),
    orders30: validOrders.length,
    revenue30: validOrders.reduce((sum, order) => sum + Number(order.total || 0), 0),
    mrr: billable.reduce(
      (sum, subscription) => sum + Number(subscription.plans?.price_monthly || 0),
      0,
    ),
    atRisk: subscriptions.filter((subscription) =>
      ["inadimplente", "pendente_pagamento"].includes(subscription.status),
    ).length,
  };
}

const stat = (ctx, label, value, hint) =>
  h(
    ctx,
    "section",
    { className: "admin-panel admin-stat" },
    h(ctx, "span", { className: "admin-stat__label" }, label),
    h(ctx, "strong", { className: "admin-stat__value" }, value),
    hint ? h(ctx, "span", { className: "admin-stat__hint" }, hint) : null,
  );

export function renderAdminDashboard(ctx) {
  const page = createAdminPage(ctx, {
    title: "Visao geral Hype",
    description: "Indicadores globais calculados somente a partir dos dados reais da plataforma.",
  });
  const load = async () => {
    page.loading("Calculando indicadores...");
    try {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const [totalResult, activeResult, orders, subscriptions] = await Promise.all([
        ctx.api.from("stores").select("*", { count: "exact", head: true }),
        ctx.api
          .from("stores")
          .select("*", { count: "exact", head: true })
          .eq("is_active", true)
          .eq("is_suspended", false),
        dataOf(
          ctx.api.from("orders").select("total,status").gte("created_at", since).limit(10_000),
          [],
        ),
        dataOf(
          ctx.api
            .from("subscriptions")
            .select("status,asaas_subscription_id,plans(price_monthly)")
            .in("status", ["ativa", "trial", "inadimplente", "pendente_pagamento"])
            .limit(10_000),
          [],
        ),
      ]);
      if (totalResult.error) throw new Error(totalResult.error.message);
      if (activeResult.error) throw new Error(activeResult.error.message);
      if (!page.active()) return;
      const metrics = calculateDashboardMetrics({
        totalStores: totalResult.count,
        activeStores: activeResult.count,
        orders,
        subscriptions,
      });
      page.root.dataset.pageState = "ready";
      page.setContent(
        h(
          ctx,
          "section",
          { className: "admin-grid", "aria-label": "Indicadores principais" },
          stat(ctx, "Lojas", `${metrics.activeStores}/${metrics.totalStores}`, "ativas / total"),
          stat(ctx, "Pedidos em 30 dias", String(metrics.orders30), "cancelados nao entram"),
          stat(ctx, "GMV em 30 dias", money(ctx, metrics.revenue30), "volume bruto valido"),
          stat(ctx, "MRR", money(ctx, metrics.mrr), "assinaturas ativas cobradas"),
          stat(ctx, "Assinaturas em risco", String(metrics.atRisk), "pendentes ou inadimplentes"),
        ),
        h(
          ctx,
          "section",
          { className: "admin-panel" },
          h(ctx, "h2", { className: "admin-panel__title" }, "Leitura operacional"),
          h(
            ctx,
            "p",
            {},
            metrics.totalStores
              ? `${Math.round((metrics.activeStores / metrics.totalStores) * 100)}% das lojas cadastradas estao ativas e nao suspensas.`
              : "Ainda nao ha lojas cadastradas.",
          ),
        ),
      );
      page.announce("Indicadores atualizados.");
    } catch (error) {
      if (page.active()) page.fail(error, load);
    }
  };
  void load();
  return page.root;
}
