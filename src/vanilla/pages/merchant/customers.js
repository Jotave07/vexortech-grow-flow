import { button, createPage, dataOf, date, getStoreId, h, money, normalizeSearch, openDialog, requireMerchant } from "./core.js";

const customerTotal = (orders) => orders.filter((order) => !["cancelado", "estornado"].includes(order.status)).reduce((sum, order) => sum + Number(order.total || 0), 0);

export function render(ctx) {
  const page = createPage(ctx, { title: "Clientes", description: "Consulte historico, recorrencia e dados de contato sem expor informacoes desnecessarias." });
  const state = { customers: [], search: "", detailRequest: 0 };

  const load = async () => {
    page.loading("Carregando clientes...");
    try {
      await requireMerchant(ctx);
      state.customers = await dataOf(ctx.api.from("customers").select("*").eq("store_id", getStoreId(ctx)).order("created_at", { ascending: false }), []);
      renderList();
    } catch (error) { page.fail(error, load); }
  };

  const renderList = ({ restoreSearch = false, caret = null } = {}) => {
    const search = normalizeSearch(state.search);
    const customers = state.customers.filter((customer) => !search
      || normalizeSearch(customer.name ?? customer.full_name).includes(search)
      || normalizeSearch(customer.phone).includes(search));
    const searchField = h(ctx, "input", {
      className: "merchant-input",
      type: "search",
      value: state.search,
      placeholder: "Nome ou telefone",
      "aria-label": "Buscar clientes",
      dataset: { customerSearch: "true" },
      onInput: (event) => {
        state.search = event.currentTarget.value;
        renderList({ restoreSearch: true, caret: event.currentTarget.selectionStart });
      },
    });
    const toolbar = h(ctx, "section", { className: "merchant-panel merchant-toolbar" },
      h(ctx, "label", { className: "merchant-field" }, h(ctx, "span", {}, "Busca"), searchField),
      h(ctx, "p", { role: "status" }, `${customers.length} cliente${customers.length === 1 ? "" : "s"}`));
    if (!state.customers.length) return page.empty("Nenhum cliente ainda", "A base sera criada conforme os primeiros pedidos chegarem.");
    if (!customers.length) {
      page.root.dataset.pageState = "empty";
      page.setContent(toolbar, h(ctx, "div", { className: "merchant-state" },
        h(ctx, "strong", {}, "Nenhum cliente encontrado"),
        h(ctx, "span", {}, "Revise o nome ou telefone informado.")));
      restoreSearchControl();
      return;
    }
    const table = h(
      ctx,
      "table",
      { className: "merchant-table" },
      h(ctx, "caption", {}, "Clientes da loja. Abra um registro para consultar o historico."),
      h(
        ctx,
        "thead",
        {},
        h(
          ctx,
          "tr",
          {},
          ["Cliente", "Contato", "Desde", "Acao"].map((label) =>
            h(ctx, "th", { scope: "col" }, label),
          ),
        ),
      ),
      h(
        ctx,
        "tbody",
        {},
        customers.map((customer) =>
          h(
            ctx,
            "tr",
            {},
            h(ctx, "td", {}, customer.name ?? customer.full_name ?? "Cliente sem nome"),
            h(
              ctx,
              "td",
              {},
              h(ctx, "div", {}, customer.phone ?? "Sem telefone"),
            ),
            h(ctx, "td", {}, date(ctx, customer.created_at, { dateStyle: "short" })),
            h(
              ctx,
              "td",
              {},
              button(ctx, "Ver historico", { onClick: () => openCustomer(customer) }),
            ),
          ),
        ),
      ),
    );
    page.root.dataset.pageState = "ready";
    page.setContent(toolbar, h(ctx, "div", { className: "merchant-table-wrap" }, table));
    page.announce(`${customers.length} clientes exibidos.`);

    function restoreSearchControl() {
      if (!restoreSearch) return;
      const nextSearch = page.content.querySelector?.("[data-customer-search]");
      nextSearch?.focus();
      if (Number.isInteger(caret)) nextSearch?.setSelectionRange?.(caret, caret);
    }
  };

  const openCustomer = async (customer) => {
    const requestId = ++state.detailRequest;
    const body = h(ctx, "div", { className: "merchant-state", role: "status" }, "Carregando historico...");
    const modal = openDialog(ctx, { title: customer.name ?? customer.full_name ?? "Cliente", content: body });
    try {
      const orders = await dataOf(ctx.api.from("orders").select("id, order_number, status, total, created_at, delivery_type").eq("store_id", getStoreId(ctx)).eq("customer_id", customer.id).order("created_at", { ascending: false }).limit(100), []);
      if (requestId !== state.detailRequest || !modal.dialog.isConnected) return;
      const validOrders = orders.filter((order) => !["cancelado", "estornado"].includes(order.status));
      body.className = "merchant-form";
      body.replaceChildren(
        h(ctx, "section", { className: "merchant-grid" },
          h(ctx, "div", { className: "merchant-panel merchant-stat" }, h(ctx, "span", { className: "merchant-stat__label" }, "Pedidos validos"), h(ctx, "strong", { className: "merchant-stat__value" }, String(validOrders.length))),
          h(ctx, "div", { className: "merchant-panel merchant-stat" }, h(ctx, "span", { className: "merchant-stat__label" }, "Total comprado"), h(ctx, "strong", { className: "merchant-stat__value" }, money(ctx, customerTotal(orders))))),
        h(ctx, "section", { className: "merchant-panel" }, h(ctx, "h3", { className: "merchant-panel__title" }, "Contato"),
          customer.phone ? h(ctx, "a", { className: "merchant-button", href: `https://wa.me/55${String(customer.phone).replace(/\D/g, "")}`, target: "_blank", rel: "noreferrer" }, "Abrir WhatsApp") : h(ctx, "p", {}, "Telefone nao informado"),
        ),
        h(ctx, "section", { className: "merchant-panel" }, h(ctx, "h3", { className: "merchant-panel__title" }, "Ultimos pedidos"),
          orders.length ? h(ctx, "ul", { className: "merchant-list" }, orders.slice(0, 20).map((order) => h(ctx, "li", { className: "merchant-list__item" },
            h(ctx, "span", {}, `#${order.order_number} · ${order.status.replaceAll("_", " ")}`), h(ctx, "strong", {}, money(ctx, order.total))))) : h(ctx, "p", {}, "Nenhum pedido encontrado.")),
      );
    } catch (error) { body.className = "merchant-alert"; body.textContent = error.message; }
  };

  page.root.ready = load();
  return page.root;
}

export default render;
