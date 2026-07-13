import { createPage, dataOf, date, getStoreId, h, money, requireMerchant } from "./core.js";

const startOfToday = () => {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value.toISOString();
};

const startOfLastDays = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
const validOrder = (order) => !["cancelado", "estornado"].includes(order.status);

export function render(ctx) {
  const page = createPage(ctx, {
    title: "Visao geral",
    description: "Entenda o movimento de hoje e va direto ao proximo ponto de atencao.",
  });
  page.actions.append(
    h(ctx, "button", { type: "button", className: "merchant-button merchant-button--primary", onClick: () => ctx.navigate("/lojista/pedidos") }, "Ver pedidos"),
    h(ctx, "button", { type: "button", className: "merchant-button", onClick: () => ctx.navigate("/lojista/cardapio") }, "Gerenciar cardapio"),
  );

  const load = async () => {
    page.loading("Atualizando indicadores da loja...");
    try {
      await requireMerchant(ctx);
      const storeId = getStoreId(ctx);
      const [todayOrders, recentOrders, products, customers, recentItems] = await Promise.all([
        dataOf(ctx.api.from("orders").select("id, order_number, total, status, created_at").eq("store_id", storeId).gte("created_at", startOfToday()), []),
        dataOf(ctx.api.from("orders").select("id, order_number, total, status, created_at").eq("store_id", storeId).gte("created_at", startOfLastDays(7)), []),
        dataOf(ctx.api.from("products").select("id, is_available").eq("store_id", storeId), []),
        dataOf(ctx.api.from("customers").select("id").eq("store_id", storeId), []),
        dataOf(ctx.api.from("order_items").select("order_id, product_name, quantity, created_at").eq("store_id", storeId).gte("created_at", startOfLastDays(7)), []),
      ]);
      const validToday = todayOrders.filter(validOrder);
      const validRecent = recentOrders.filter(validOrder);
      const revenueToday = validToday.reduce((sum, order) => sum + Number(order.total || 0), 0);
      const revenueSevenDays = validRecent.reduce((sum, order) => sum + Number(order.total || 0), 0);
      const activeOrders = todayOrders.filter((order) => ["novo", "confirmado", "em_preparo", "saiu_para_entrega", "pronto_para_retirada"].includes(order.status));
      const validRecentIds = new Set(validRecent.map((order) => order.id));
      const productCounts = new Map();
      recentItems.filter((item) => validRecentIds.has(item.order_id)).forEach((item) => productCounts.set(item.product_name, (productCounts.get(item.product_name) ?? 0) + Number(item.quantity || 0)));
      const topProducts = [...productCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      const stat = (label, value, hint) => h(ctx, "section", { className: "merchant-panel merchant-stat" },
        h(ctx, "span", { className: "merchant-stat__label" }, label),
        h(ctx, "strong", { className: "merchant-stat__value" }, value),
        h(ctx, "span", { className: "merchant-stat__hint" }, hint));
      const stats = h(ctx, "div", { className: "merchant-grid", "aria-label": "Indicadores da loja" },
        stat("Faturamento hoje", money(ctx, revenueToday), `${validToday.length} pedido${validToday.length === 1 ? "" : "s"} valido${validToday.length === 1 ? "" : "s"}`),
        stat("Pedidos ativos", String(activeOrders.length), activeOrders.length ? "Precisam de acompanhamento" : "Operacao em dia"),
        stat("Ultimos 7 dias", money(ctx, revenueSevenDays), `${validRecent.length} pedidos concluidos ou em curso`),
        stat("Produtos disponiveis", String(products.filter((item) => item.is_available).length), `${products.length} cadastrados`),
        stat("Clientes", String(customers.length), "Base total da loja"));
      const activeList = h(
        ctx,
        "ul",
        { className: "merchant-list" },
        activeOrders.slice(0, 6).map((order) =>
          h(
            ctx,
            "li",
            { className: "merchant-list__item" },
            h(ctx, "span", {}, `Pedido #${order.order_number ?? order.id}`),
            h(
              ctx,
              "span",
              {},
              `${order.status.replaceAll("_", " ")} · ${date(ctx, order.created_at, { hour: "2-digit", minute: "2-digit" })}`,
            ),
          ),
        ),
      );
      const topList = h(
        ctx,
        "ol",
        { className: "merchant-list" },
        topProducts.map(([name, quantity]) =>
          h(
            ctx,
            "li",
            { className: "merchant-list__item" },
            h(ctx, "span", {}, name),
            h(ctx, "strong", {}, `${quantity} un.`),
          ),
        ),
      );
      page.root.dataset.pageState = "ready";
      page.setContent(
        stats,
        h(ctx, "div", { className: "merchant-grid" },
          h(ctx, "section", { className: "merchant-panel" }, h(ctx, "h2", { className: "merchant-panel__title" }, "Fila ativa"),
            activeOrders.length ? activeList : h(ctx, "p", {}, "Nenhum pedido exige acao agora.")),
          h(ctx, "section", { className: "merchant-panel" }, h(ctx, "h2", { className: "merchant-panel__title" }, "Mais vendidos em 7 dias"),
            topProducts.length ? topList : h(ctx, "p", {}, "Os produtos aparecerao apos as primeiras vendas."))),
      );
      page.announce(`Painel atualizado. ${activeOrders.length} pedidos ativos.`);
    } catch (error) { page.fail(error, load); }
  };
  page.root.ready = load();
  return page.root;
}

export default render;
