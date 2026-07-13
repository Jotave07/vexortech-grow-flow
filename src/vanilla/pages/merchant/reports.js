import { createPage, dataOf, getStoreId, h, money, queryValue, requireMerchant } from "./core.js";
import { buildReport } from "./reports-model.js";

const startDate = (days) => new Date(Date.now() - Number(days) * 86_400_000).toISOString();
const paymentName = (value) => ({ pix: "Pix", dinheiro: "Dinheiro", cartao_credito_entrega: "Credito", cartao_debito_entrega: "Debito" })[value] ?? value.replaceAll("_", " ");

export function render(ctx) {
  const page = createPage(ctx, { title: "Relatorios", description: "Transforme vendas em decisoes: faturamento, ticket, produtos e forma de recebimento." });
  const requestedRange = queryValue(ctx, "range", "30");
  const state = { range: [7, 30, 90].includes(Number(requestedRange)) ? String(requestedRange) : "30" };

  const load = async () => {
    page.loading("Calculando relatorio...");
    try {
      await requireMerchant(ctx);
      const from = startDate(state.range);
      const storeId = getStoreId(ctx);
      const [orders, items] = await Promise.all([
        dataOf(ctx.api.from("orders").select("created_at, total, status, delivery_type, payment_method").eq("store_id", storeId).gte("created_at", from).order("created_at"), []),
        dataOf(ctx.api.from("order_items").select("order_id, product_name, quantity, subtotal, created_at").eq("store_id", storeId).gte("created_at", from), []),
      ]);
      renderReport(buildReport(orders, items));
    } catch (error) { page.fail(error, load); }
  };

  const renderReport = (report) => {
    const range = h(ctx, "select", { className: "merchant-select", "aria-label": "Periodo do relatorio", onChange: (event) => { state.range = event.currentTarget.value; void load(); } },
      [{ value: "7", label: "Ultimos 7 dias" }, { value: "30", label: "Ultimos 30 dias" }, { value: "90", label: "Ultimos 90 dias" }].map((option) => h(ctx, "option", { value: option.value, selected: state.range === option.value }, option.label)));
    const stat = (label, value, hint) => h(ctx, "div", { className: "merchant-panel merchant-stat" },
      h(ctx, "span", { className: "merchant-stat__label" }, label), h(ctx, "strong", { className: "merchant-stat__value" }, value), hint ? h(ctx, "span", { className: "merchant-stat__hint" }, hint) : null);
    const maxDaily = Math.max(1, ...report.daily.map(([, value]) => value));
    const maxProduct = Math.max(1, ...report.topProducts.map(([, value]) => value.quantity));
    const chart = (rows, max, labeler, valueLabeler) => h(ctx, "div", { className: "merchant-chart" }, rows.map(([label, value]) => {
      const numeric = typeof value === "object" ? value.quantity : value;
      return h(ctx, "div", { className: "merchant-chart__row" },
        h(ctx, "span", {}, labeler(label)),
        h(ctx, "progress", { className: "merchant-chart__progress", max, value: numeric, "aria-label": `${labeler(label)}: ${valueLabeler(value)}` }),
        h(ctx, "strong", {}, valueLabeler(value)));
    }));
    const toolbar = h(ctx, "section", { className: "merchant-panel merchant-toolbar" }, h(ctx, "label", { className: "merchant-field" }, h(ctx, "span", {}, "Periodo"), range));
    const stats = h(ctx, "section", { className: "merchant-grid", "aria-label": "Resumo do periodo" },
      stat("Faturamento", money(ctx, report.revenue), `${report.orderCount} pedidos validos`),
      stat("Ticket medio", money(ctx, report.averageTicket)),
      stat("Entrega", String(report.deliveryCount), `${report.pickupCount} retiradas`),
      stat("Cancelados", String(report.canceledCount), "Excluidos do faturamento"));
    const content = report.orderCount
      ? h(ctx, "div", { className: "merchant-grid" },
        h(ctx, "section", { className: "merchant-panel" }, h(ctx, "h2", { className: "merchant-panel__title" }, "Faturamento por dia"), chart(report.daily, maxDaily, (label) => label.split("-").reverse().slice(0, 2).join("/"), (value) => money(ctx, value))),
        h(ctx, "section", { className: "merchant-panel" }, h(ctx, "h2", { className: "merchant-panel__title" }, "Produtos mais vendidos"), chart(report.topProducts, maxProduct, (label) => label, (value) => `${value.quantity} un.`)),
        h(ctx, "section", { className: "merchant-panel" }, h(ctx, "h2", { className: "merchant-panel__title" }, "Pagamentos"),
          h(ctx, "ul", { className: "merchant-list" }, report.payments.map(([method, count]) => h(ctx, "li", { className: "merchant-list__item" }, paymentName(method), h(ctx, "strong", {}, String(count))))))
      )
      : h(ctx, "div", { className: "merchant-state" }, h(ctx, "strong", {}, "Sem vendas no periodo"), h(ctx, "span", {}, "Amplie o periodo ou aguarde novos pedidos."));
    page.root.dataset.pageState = report.orderCount ? "ready" : "empty";
    page.setContent(toolbar, stats, content);
    page.announce(`${report.orderCount} pedidos validos no relatorio.`);
  };

  page.root.ready = load();
  return page.root;
}

export default render;
