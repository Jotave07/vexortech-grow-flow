import {
  badge,
  button,
  confirmAction,
  createAdminPage,
  dataOf,
  date,
  h,
  money,
  normalizeSearch,
  openDialog,
  statusTone,
  toast,
  withBusy,
} from "./core.js";

const NEXT_STATUS = {
  aguardando_pagamento: ["confirmado", "cancelado"],
  novo: ["confirmado", "cancelado"],
  confirmado: ["em_preparo", "cancelado"],
  em_preparo: ["saiu_para_entrega", "pronto_para_retirada", "cancelado"],
  saiu_para_entrega: ["entregue", "cancelado"],
  pronto_para_retirada: ["entregue", "cancelado"],
};

export const nextOrderStatuses = (status) => NEXT_STATUS[String(status ?? "").toLowerCase()] ?? [];

export function filterOrders(orders, { search = "", status = "all", payment = "all" } = {}) {
  const term = normalizeSearch(search);
  return orders.filter((order) => {
    const haystack = normalizeSearch(
      `${order.order_number || ""} ${order.customer_name || ""} ${order.customer_phone || ""} ${order.stores?.name || ""}`,
    );
    return (
      (!term || haystack.includes(term)) &&
      (status === "all" || order.status === status) &&
      (payment === "all" || order.payment_status === payment)
    );
  });
}

export function renderAdminOrders(ctx) {
  const page = createAdminPage(ctx, {
    title: "Pedidos da plataforma",
    description:
      "Acompanhe pedidos de todas as lojas. Mudancas de status passam pelo servico de transicao e preservam historico.",
  });
  let orders = [];
  const filters = { search: "", status: "all", payment: "all" };
  const results = h(ctx, "section");
  const search = h(ctx, "input", {
    type: "search",
    className: "admin-input",
    placeholder: "Numero, cliente, telefone ou loja",
    "aria-label": "Pesquisar pedidos",
  });
  const status = h(
    ctx,
    "select",
    { className: "admin-select", "aria-label": "Filtrar status do pedido" },
    [
      ["all", "Todos os status"],
      ["aguardando_pagamento", "Aguardando pagamento"],
      ["novo", "Novo"],
      ["confirmado", "Confirmado"],
      ["em_preparo", "Em preparo"],
      ["saiu_para_entrega", "Saiu para entrega"],
      ["pronto_para_retirada", "Pronto para retirada"],
      ["entregue", "Entregue"],
      ["cancelado", "Cancelado"],
    ].map(([value, label]) => h(ctx, "option", { value }, label)),
  );
  const payment = h(
    ctx,
    "select",
    { className: "admin-select", "aria-label": "Filtrar status do pagamento" },
    [
      ["all", "Todos os pagamentos"],
      ["pendente", "Pendente"],
      ["pago", "Pago"],
      ["falhou", "Falhou"],
      ["cancelado", "Cancelado"],
      ["estornado", "Estornado"],
    ].map(([value, label]) => h(ctx, "option", { value }, label)),
  );

  const showDetails = async (order) => {
    const loading =
      ctx.ui.loading?.("Carregando itens e historico...") ??
      h(ctx, "div", { className: "admin-state" }, "Carregando detalhes...");
    const modal = openDialog(ctx, { title: `Pedido #${order.order_number}`, content: loading });
    page.onCleanup(modal.close);
    try {
      const [items, history] = await Promise.all([
        dataOf(
          ctx.api
            .from("order_items")
            .select("id,product_name,quantity,unit_price,subtotal,notes")
            .eq("order_id", order.id)
            .order("created_at"),
          [],
        ),
        dataOf(
          ctx.api
            .from("order_status_history")
            .select("status,notes,created_at")
            .eq("order_id", order.id)
            .order("created_at", { ascending: false })
            .limit(100),
          [],
        ),
      ]);
      if (!modal.dialog.isConnected) return;
      const itemNodes = items.map((item) =>
        h(
          ctx,
          "li",
          { className: "admin-list__item" },
          h(ctx, "span", {}, `${item.quantity}x ${item.product_name || "Produto"}`),
          h(
            ctx,
            "strong",
            {},
            money(ctx, item.subtotal ?? Number(item.unit_price || 0) * Number(item.quantity || 0)),
          ),
        ),
      );
      const itemList = h(ctx, "ul", { className: "admin-list" }, itemNodes);
      const historyNodes = history.map((entry) =>
        h(
          ctx,
          "li",
          { className: "admin-list__item" },
          h(
            ctx,
            "span",
            {},
            badge(ctx, entry.status, statusTone(entry.status)),
            entry.notes ? h(ctx, "div", { className: "admin-field__hint" }, entry.notes) : null,
          ),
          h(ctx, "time", { datetime: entry.created_at }, date(ctx, entry.created_at, true)),
        ),
      );
      const historyList = h(ctx, "ol", { className: "admin-list" }, historyNodes);
      loading.replaceWith(
        h(
          ctx,
          "section",
          { className: "admin-panel" },
          h(ctx, "h3", { className: "admin-panel__title" }, "Resumo"),
          h(
            ctx,
            "p",
            {},
            `${order.stores?.name || "Loja"} · ${order.customer_name || "Cliente nao identificado"}`,
          ),
          h(
            ctx,
            "p",
            {},
            `${money(ctx, order.total)} · ${order.payment_method || "Pagamento nao informado"}`,
          ),
        ),
        h(
          ctx,
          "section",
          { className: "admin-panel" },
          h(ctx, "h3", { className: "admin-panel__title" }, "Itens"),
          itemList,
        ),
        h(
          ctx,
          "section",
          { className: "admin-panel" },
          h(ctx, "h3", { className: "admin-panel__title" }, "Historico"),
          history.length ? historyList : h(ctx, "p", {}, "Sem eventos registrados."),
        ),
      );
    } catch (error) {
      loading.replaceWith(
        h(ctx, "div", { className: "admin-alert", role: "alert" }, error.message),
      );
    }
  };

  const updateStatus = async (order, next, control) =>
    withBusy(control, async () => {
      if (!next) return;
      if (
        ["cancelado", "entregue"].includes(next) &&
        !(await confirmAction(ctx, {
          title:
            next === "cancelado"
              ? `Cancelar pedido #${order.order_number}?`
              : `Concluir pedido #${order.order_number}?`,
          message:
            next === "cancelado"
              ? "O pedido sera encerrado. Pagamentos PIX confirmados podem iniciar fluxo de estorno e repasses serao bloqueados."
              : "O pedido sera marcado como entregue. Conforme a configuracao financeira, isso pode liberar o repasse ao lojista.",
          confirmLabel: next === "cancelado" ? "Cancelar pedido" : "Marcar entregue",
          danger: next === "cancelado",
        }))
      ) {
        control.value = "";
        return;
      }
      const result = await ctx.api.fn("update-order-status", {
        orderId: order.id,
        storeId: order.store_id,
        status: next,
        note: "Atualizado pelo administrador",
      });
      if (result.error || result.data?.error) {
        control.value = "";
        return toast(
          ctx,
          result.error?.message || result.data?.error || "Falha ao atualizar pedido.",
          "error",
        );
      }
      toast(ctx, "Status atualizado.", "success");
      await load();
    });

  function renderResults() {
    const visible = filterOrders(orders, filters);
    const rows = visible.map((order) => {
      const details = button(ctx, "Detalhes", { onClick: () => showDetails(order) });
      const next = nextOrderStatuses(order.status);
      const select = h(
        ctx,
        "select",
        {
          className: "admin-select",
          disabled: !next.length,
          "aria-label": `Alterar status do pedido ${order.order_number}`,
        },
        h(ctx, "option", { value: "" }, next.length ? "Alterar status" : "Status final"),
        next.map((value) => h(ctx, "option", { value }, value.replaceAll("_", " "))),
      );
      select.addEventListener("change", () => updateStatus(order, select.value, select));
      return h(
        ctx,
        "tr",
        {},
        h(
          ctx,
          "td",
          {},
          h(ctx, "strong", {}, `#${order.order_number}`),
          h(ctx, "div", { className: "admin-field__hint" }, date(ctx, order.created_at, true)),
        ),
        h(ctx, "td", {}, order.stores?.name || "Loja"),
        h(
          ctx,
          "td",
          {},
          order.customer_name || "—",
          h(ctx, "div", { className: "admin-field__hint" }, order.customer_phone || ""),
        ),
        h(ctx, "td", {}, money(ctx, order.total)),
        h(
          ctx,
          "td",
          {},
          badge(ctx, String(order.status || "—").replaceAll("_", " "), statusTone(order.status)),
        ),
        h(ctx, "td", {}, badge(ctx, order.payment_status || "—", statusTone(order.payment_status))),
        h(ctx, "td", {}, h(ctx, "div", { className: "admin-actions" }, details, select)),
      );
    });
    results.replaceChildren(
      visible.length
        ? h(
            ctx,
            "div",
            { className: "admin-table-wrap" },
            h(
              ctx,
              "table",
              { className: "admin-table" },
              h(ctx, "caption", {}, `${visible.length} de ${orders.length} pedidos recentes`),
              h(
                ctx,
                "thead",
                {},
                h(
                  ctx,
                  "tr",
                  {},
                  ["Pedido", "Loja", "Cliente", "Total", "Status", "Pagamento", "Acoes"].map(
                    (label) => h(ctx, "th", { scope: "col" }, label),
                  ),
                ),
              ),
              h(ctx, "tbody", {}, rows),
            ),
          )
        : (ctx.ui.empty?.("Nenhum pedido", "Nao ha pedidos para os filtros selecionados.") ??
            h(ctx, "div", { className: "admin-state" }, "Nenhum pedido encontrado.")),
    );
    page.announce(`${visible.length} pedidos exibidos.`);
  }

  const load = async () => {
    results.replaceChildren(
      ctx.ui.loading?.("Carregando pedidos...") ??
        h(ctx, "div", { className: "admin-state" }, "Carregando pedidos..."),
    );
    try {
      orders = await dataOf(
        ctx.api
          .from("orders")
          .select(
            "id,order_number,store_id,customer_name,customer_phone,total,status,payment_status,payment_method,created_at,stores(name,slug)",
          )
          .order("created_at", { ascending: false })
          .limit(500),
        [],
      );
      if (page.active()) renderResults();
    } catch (error) {
      results.replaceChildren(
        h(ctx, "div", { className: "admin-alert", role: "alert" }, error.message),
      );
    }
  };
  const updateFilters = () => {
    filters.search = search.value;
    filters.status = status.value;
    filters.payment = payment.value;
    renderResults();
  };
  search.addEventListener("input", updateFilters);
  status.addEventListener("change", updateFilters);
  payment.addEventListener("change", updateFilters);
  page.actions.append(button(ctx, "Atualizar", { primary: true, onClick: load }));
  page.setContent(
    h(
      ctx,
      "section",
      { className: "admin-panel admin-toolbar", "aria-label": "Filtros de pedidos" },
      search,
      status,
      payment,
    ),
    results,
  );
  void load();
  return page.root;
}
