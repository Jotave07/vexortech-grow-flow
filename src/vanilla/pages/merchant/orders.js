import {
  badge,
  button,
  confirmAction,
  createPage,
  dataOf,
  date,
  getStoreId,
  h,
  money,
  openDialog,
  queryValue,
  requireMerchant,
  statusTone,
  toast,
  withBusy,
} from "./core.js";
import {
  COOKING_STATUSES,
  HISTORY_STATUSES,
  OPERATIONAL_STATUSES,
  ORDER_COLUMNS,
  STATUS_LABELS,
  URGENCY_LABELS,
  buildMapUrl,
  buildWhatsAppUrl,
  calculateKitchenQueue,
  canApproveManualPix,
  countOrderStatuses,
  deliveryAddressLines,
  filterOrders,
  groupItemsByOrder,
  groupOrders,
  historyDateRange,
  mergeOrderPayments,
  nextOrderLabel,
  nextOrderStatus,
  orderItemOptions,
  orderItemTotal,
  orderItemUnitTotal,
  orderMutationForStatus,
  orderOptionLabel,
  paginate,
} from "./orders-model.js";
import { printOrderTicket } from "./orders-print.js";

const ACTIVE_LOOKBACK_DAYS = 14;
const TABLE_PAGE_SIZE = 15;
const HISTORY_PAGE_SIZE = 25;
const POLL_INTERVAL_MS = 20_000;
const REALTIME_STALE_MS = 55_000;

const paymentLabel = (method) => ({
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao_credito_entrega: "Credito na entrega",
  cartao_debito_entrega: "Debito na entrega",
})[method] ?? method ?? "Nao informado";

const inputDate = (value) => {
  const dateValue = new Date(value);
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, "0");
  const day = String(dateValue.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function render(ctx) {
  const page = createPage(ctx, {
    title: "Gestor de pedidos",
    description: "Acompanhe a operacao ao vivo, organize a cozinha e conclua cada pedido com seguranca financeira.",
  });
  const requestedView = queryValue(ctx, "view", "table");
  const requestedStatus = queryValue(ctx, "status", "all");
  const today = new Date();
  const state = {
    orders: [],
    view: ["table", "kanban", "kitchen"].includes(requestedView) ? requestedView : "table",
    search: queryValue(ctx, "search"),
    status: [...OPERATIONAL_STATUSES, "route"].includes(requestedStatus) ? requestedStatus : "all",
    deliveryType: "all",
    period: "all",
    tablePage: 1,
    busy: new Set(),
    detailRequest: 0,
    loadPromise: null,
    initialized: false,
    knownOrderIds: new Set(),
    notificationKeys: new Set(),
    realtimeState: "connecting",
    lastRealtimeAt: 0,
    lastSync: null,
    streamStop: null,
    reconnectTimer: null,
    pollTimer: null,
    soundEnabled: false,
    audioContext: null,
    kitchenItems: new Map(),
    kitchenLoading: false,
    kitchenRequest: 0,
    dialogs: new Set(),
    storeName: ctx.auth.store?.name ?? ctx.auth.stores?.[0]?.name ?? "Loja",
    history: {
      orders: [],
      period: "7",
      status: "todos",
      search: "",
      startDate: inputDate(new Date(today.getTime() - 7 * 86_400_000)),
      endDate: inputDate(today),
      page: 1,
      loading: false,
      results: null,
    },
  };

  const connectionIndicator = h(ctx, "span", {
    className: "merchant-order-connection",
    role: "status",
    "aria-live": "polite",
  });
  const soundControl = button(ctx, "Ativar som", { onClick: (event) => void toggleSound(event.currentTarget) });
  soundControl.setAttribute("aria-pressed", "false");
  const historyControl = button(ctx, "Historico", { onClick: openHistory });
  const refreshControl = button(ctx, "Atualizar", { onClick: (event) => void withBusy(event.currentTarget, () => load({ detectNew: true })) });
  page.actions.append(connectionIndicator, soundControl, historyControl, refreshControl);

  const registerDialog = (modal) => {
    state.dialogs.add(modal.dialog);
    return modal;
  };

  const updateConnectionIndicator = () => {
    const online = state.realtimeState === "online";
    const label = online ? "Ao vivo" : state.realtimeState === "connecting" ? "Conectando" : "Polling de seguranca";
    connectionIndicator.dataset.state = state.realtimeState;
    connectionIndicator.replaceChildren(
      h(ctx, "span", { className: "merchant-order-connection__dot", "aria-hidden": "true" }),
      label,
      state.lastSync ? h(ctx, "small", {}, date(ctx, state.lastSync, { hour: "2-digit", minute: "2-digit" })) : null,
    );
  };
  updateConnectionIndicator();

  const load = ({ silent = false, detectNew = false } = {}) => {
    if (state.loadPromise) return state.loadPromise;
    const task = (async () => {
      if (!silent) page.loading("Carregando pedidos...");
      try {
        await requireMerchant(ctx);
        const storeId = getStoreId(ctx);
        const from = new Date(Date.now() - ACTIVE_LOOKBACK_DAYS * 86_400_000).toISOString();
        const orders = await dataOf(ctx.api.from("orders")
          .select("*")
          .eq("store_id", storeId)
          .in("status", OPERATIONAL_STATUSES)
          .gte("created_at", from)
          .order("created_at", { ascending: false })
          .limit(250), []);
        const ids = orders.map((order) => order.id).filter(Boolean);
        let payments = [];
        if (ids.length) {
          try {
            payments = await dataOf(ctx.api.from("payments")
              .select("order_id, provider, status")
              .eq("store_id", storeId)
              .in("order_id", ids), []);
          } catch {
            payments = [];
          }
        }
        if (page.signal.aborted) return;
        const merged = mergeOrderPayments(orders, payments);
        if (state.initialized && detectNew) {
          [...merged].reverse()
            .filter((order) => !state.knownOrderIds.has(String(order.id)))
            .forEach((order) => notifyOrder(order, `new:${order.id}`, `Novo pedido #${order.order_number}`));
        }
        for (const order of merged) state.knownOrderIds.add(String(order.id));
        state.orders = merged;
        state.initialized = true;
        state.lastSync = new Date();
        updateConnectionIndicator();
        if (state.view === "kitchen") await loadKitchenItems({ renderAfter: false });
        renderBoard();
      } catch (error) {
        if (!silent && !page.signal.aborted) page.fail(error, () => load());
      }
    })();
    state.loadPromise = task;
    task.finally(() => { if (state.loadPromise === task) state.loadPromise = null; });
    return task;
  };

  const actionButton = (order, { onDone } = {}) => {
    if (canApproveManualPix(order)) {
      return button(ctx, "Confirmar Pix manual", {
        primary: true,
        onClick: (event) => void approveManualPix(order, event.currentTarget, onDone),
      });
    }
    const status = nextOrderStatus(order);
    if (!status) return null;
    return button(ctx, nextOrderLabel(order), {
      primary: true,
      onClick: (event) => {
        if (status === "entregue") void completeOrder(order, event.currentTarget, onDone);
        else void changeStatus(order, status, event.currentTarget, onDone);
      },
    });
  };

  const renderMetrics = () => {
    const counts = countOrderStatuses(state.orders);
    const definitions = [
      { status: "novo", label: "Novos", count: counts.novo },
      { status: "confirmado", label: "Confirmados", count: counts.confirmado },
      { status: "em_preparo", label: "Em preparo", count: counts.em_preparo },
      { status: "route", label: "Rota / retirada", count: counts.saiu_para_entrega + counts.pronto_para_retirada },
    ];
    return h(ctx, "section", { className: "merchant-order-metrics", "aria-label": "Resumo da fila" }, definitions.map((metric) => {
      const active = state.status === metric.status;
      const control = button(ctx, `${metric.label}: ${metric.count}`, {
        quiet: true,
        onClick: () => {
          state.status = active ? "all" : metric.status;
          state.tablePage = 1;
          renderBoard();
        },
      });
      control.classList.add("merchant-order-metric");
      control.setAttribute("aria-pressed", String(active));
      return control;
    }));
  };

  const renderBoard = ({ restoreSearch = false, caret = null } = {}) => {
    const orders = filterOrders(state.orders, state);
    const search = h(ctx, "input", {
      className: "merchant-input",
      type: "search",
      value: state.search,
      placeholder: "Numero ou cliente",
      "aria-label": "Buscar pedidos",
      dataset: { orderSearch: "true" },
      onInput: (event) => {
        state.search = event.currentTarget.value;
        state.tablePage = 1;
        renderBoard({ restoreSearch: true, caret: event.currentTarget.selectionStart });
      },
    });
    const status = h(ctx, "select", {
      className: "merchant-select",
      "aria-label": "Filtrar por status",
      onChange: (event) => { state.status = event.currentTarget.value; state.tablePage = 1; renderBoard(); },
    }, h(ctx, "option", { value: "all", selected: state.status === "all" }, "Todos os status"),
    h(ctx, "option", { value: "route", selected: state.status === "route" }, "Rota ou retirada"),
    OPERATIONAL_STATUSES.map((value) => h(ctx, "option", { value, selected: state.status === value }, STATUS_LABELS[value])));
    const delivery = h(ctx, "select", {
      className: "merchant-select",
      "aria-label": "Filtrar por modalidade",
      onChange: (event) => { state.deliveryType = event.currentTarget.value; state.tablePage = 1; renderBoard(); },
    }, [
      { value: "all", label: "Entrega e retirada" },
      { value: "entrega", label: "Entrega" },
      { value: "retirada", label: "Retirada" },
    ].map((item) => h(ctx, "option", { value: item.value, selected: state.deliveryType === item.value }, item.label)));
    const period = h(ctx, "select", {
      className: "merchant-select",
      "aria-label": "Filtrar por periodo",
      onChange: (event) => { state.period = event.currentTarget.value; state.tablePage = 1; renderBoard(); },
    }, [
      { value: "all", label: "Ultimos 14 dias" },
      { value: "1", label: "Hoje" },
      { value: "7", label: "Ultimos 7 dias" },
      { value: "14", label: "Ultimos 14 dias" },
    ].map((item) => h(ctx, "option", { value: item.value, selected: state.period === item.value }, item.label)));
    const tabs = h(ctx, "div", { className: "merchant-tabs", role: "tablist", "aria-label": "Visualizacao dos pedidos" },
      [
        { value: "table", label: "Tabela" },
        { value: "kanban", label: "Kanban" },
        { value: "kitchen", label: "Cozinha" },
      ].map(({ value, label }) => {
        const tab = button(ctx, label, { onClick: () => switchView(value) });
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-selected", String(state.view === value));
        return tab;
      }));
    const toolbar = h(ctx, "section", { className: "merchant-panel merchant-toolbar" },
      h(ctx, "label", { className: "merchant-field" }, h(ctx, "span", {}, "Busca"), search),
      h(ctx, "label", { className: "merchant-field" }, h(ctx, "span", {}, "Status"), status),
      h(ctx, "label", { className: "merchant-field" }, h(ctx, "span", {}, "Modalidade"), delivery),
      h(ctx, "label", { className: "merchant-field" }, h(ctx, "span", {}, "Periodo"), period),
      tabs,
      h(ctx, "p", { role: "status" }, `${orders.length} pedido${orders.length === 1 ? "" : "s"}`));
    const view = state.view === "kanban"
      ? renderKanban(orders)
      : state.view === "kitchen"
        ? renderKitchen()
        : renderTable(orders);
    page.root.dataset.pageState = orders.length || state.view === "kitchen" ? "ready" : "empty";
    page.setContent(renderMetrics(), toolbar, view);
    page.announce(`${orders.length} pedidos exibidos em ${state.view === "kitchen" ? "cozinha" : state.view}.`);
    if (restoreSearch) {
      const nextSearch = page.content.querySelector?.("[data-order-search]");
      nextSearch?.focus();
      if (Number.isInteger(caret)) nextSearch?.setSelectionRange?.(caret, caret);
    }
  };

  const switchView = (view) => {
    state.view = view;
    state.tablePage = 1;
    if (view === "kitchen") {
      state.kitchenLoading = true;
      renderBoard();
      void loadKitchenItems();
    } else renderBoard();
  };

  const renderTable = (orders) => {
    if (!orders.length) return emptyOrders();
    const pagination = paginate(orders, state.tablePage, TABLE_PAGE_SIZE);
    state.tablePage = pagination.page;
    const table = h(ctx, "table", { className: "merchant-table" },
      h(ctx, "caption", {}, "Pedidos operacionais. Abra um pedido para ver itens, endereco e acoes seguras."),
      h(ctx, "thead", {}, h(ctx, "tr", {}, ["Pedido", "Cliente", "Modalidade", "Total", "Status", "Horario", "Acao"].map((label) => h(ctx, "th", { scope: "col" }, label)))),
      h(ctx, "tbody", {}, pagination.items.map((order) => h(ctx, "tr", {},
        h(ctx, "td", {}, button(ctx, `#${order.order_number}`, { quiet: true, ariaLabel: `Abrir pedido ${order.order_number}`, onClick: () => void openDetails(order) })),
        h(ctx, "td", {}, order.customer_name ?? "Cliente"),
        h(ctx, "td", {}, order.delivery_type === "retirada" ? "Retirada" : "Entrega"),
        h(ctx, "td", {}, money(ctx, order.total)),
        h(ctx, "td", {}, badge(ctx, STATUS_LABELS[order.status] ?? order.status, statusTone(order.status))),
        h(ctx, "td", {}, date(ctx, order.created_at, { hour: "2-digit", minute: "2-digit" })),
        h(ctx, "td", {}, actionButton(order))))));
    return h(ctx, "div", { className: "merchant-order-results" },
      h(ctx, "div", { className: "merchant-table-wrap" }, table),
      renderPagination(pagination, (pageNumber) => { state.tablePage = pageNumber; renderBoard(); }));
  };

  const renderKanban = (orders) => {
    const groups = groupOrders(orders);
    return h(ctx, "div", { className: "merchant-kanban", "aria-label": "Kanban de pedidos" }, ORDER_COLUMNS.map((column) => h(ctx, "section", {
      className: "merchant-kanban__column",
      "aria-labelledby": `column-${column.id}`,
    },
    h(ctx, "header", { className: "merchant-kanban__header" },
      h(ctx, "div", {}, h(ctx, "h2", { id: `column-${column.id}`, className: "merchant-panel__title" }, column.label), h(ctx, "small", {}, column.helper)),
      badge(ctx, String(groups[column.id].length))),
    h(ctx, "div", { className: "merchant-kanban__items" }, groups[column.id].length
      ? groups[column.id].map((order) => h(ctx, "article", { className: "merchant-order-card" },
        h(ctx, "strong", {}, `#${order.order_number} - ${order.customer_name ?? "Cliente"}`),
        h(ctx, "span", {}, `${order.delivery_type === "retirada" ? "Retirada" : "Entrega"} - ${money(ctx, order.total)}`),
        h(ctx, "span", {}, date(ctx, order.created_at, { hour: "2-digit", minute: "2-digit" })),
        h(ctx, "div", { className: "merchant-actions" }, button(ctx, "Detalhes", { onClick: () => void openDetails(order) }), actionButton(order))))
      : h(ctx, "p", { className: "merchant-state merchant-state--compact" }, "Sem pedidos nesta etapa.")))));
  };

  const renderKitchen = () => {
    if (state.kitchenLoading) return h(ctx, "div", { className: "merchant-state", role: "status" }, h(ctx, "strong", {}, "Montando fila da cozinha..."));
    const { queue, batches } = calculateKitchenQueue(state.orders, state.kitchenItems);
    if (!queue.length) return h(ctx, "div", { className: "merchant-state" }, h(ctx, "strong", {}, "Fila de cozinha vazia"), h(ctx, "span", {}, "Novos pedidos aparecerao aqui automaticamente."));
    const batchPanel = batches.length ? h(ctx, "section", { className: "merchant-kitchen-batches", "aria-labelledby": "kitchen-batches-title" },
      h(ctx, "h2", { id: "kitchen-batches-title", className: "merchant-panel__title" }, "Preparo em lote sugerido"),
      h(ctx, "div", { className: "merchant-grid" }, batches.map((batch) => h(ctx, "article", { className: "merchant-kitchen-batch" },
        h(ctx, "strong", {}, `${batch.totalQuantity}x ${batch.productName}`),
        h(ctx, "span", {}, `Pedidos: ${batch.orderNumbers.map((number) => `#${number}`).join(", ")}`))))) : null;
    const queueList = h(ctx, "section", { className: "merchant-kitchen-queue", "aria-label": "Fila priorizada da cozinha" }, queue.map((order, index) => h(ctx, "article", {
      className: "merchant-kitchen-card",
      dataset: { urgency: order.urgency },
    },
    h(ctx, "header", { className: "merchant-page__header" },
      h(ctx, "div", {}, h(ctx, "h2", { className: "merchant-panel__title" }, `#${order.order_number} - ${order.customer_name ?? "Cliente"}`),
        h(ctx, "div", { className: "merchant-actions" }, badge(ctx, URGENCY_LABELS[order.urgency], order.urgency === "critical" || order.urgency === "high" ? "danger" : order.urgency === "medium" ? "warning" : "info"), badge(ctx, STATUS_LABELS[order.status] ?? order.status), index === 0 && order.status === "em_preparo" ? badge(ctx, "Proximo", "success") : null)),
      h(ctx, "div", { className: "merchant-actions" },
        button(ctx, "Imprimir", { onClick: () => printTicket(order, order.items, "Cozinha") }),
        actionButton(order))),
    h(ctx, "p", {}, `${order.ageMinutes} min na fila${order.estimated_min ? ` - estimativa ${order.estimated_min}-${order.estimated_max ?? order.estimated_min} min` : ""}`),
    h(ctx, "div", { className: "merchant-kitchen-items" }, order.items.map((item) => renderKitchenItem(item))))));
    return h(ctx, "div", { className: "merchant-order-results" }, batchPanel, queueList);
  };

  const renderKitchenItem = (item) => h(ctx, "article", { className: "merchant-kitchen-item" },
    h(ctx, "strong", {}, `${item.quantity}x ${item.product_name}`),
    item.notes ? h(ctx, "p", { className: "merchant-kitchen-note" }, `Observacao: ${item.notes}`) : null,
    orderItemOptions(item).length ? h(ctx, "ul", { className: "merchant-order-options" }, orderItemOptions(item).map((option) => h(ctx, "li", {}, orderOptionLabel(option)))) : null);

  const loadKitchenItems = async ({ renderAfter = true } = {}) => {
    const requestId = ++state.kitchenRequest;
    const orderIds = state.orders.filter((order) => COOKING_STATUSES.includes(order.status)).map((order) => order.id);
    if (!orderIds.length) {
      state.kitchenItems = new Map();
      state.kitchenLoading = false;
      if (renderAfter && state.view === "kitchen") renderBoard();
      return;
    }
    state.kitchenLoading = true;
    try {
      const items = await dataOf(ctx.api.from("order_items")
        .select("*, order_item_options(*)")
        .eq("store_id", getStoreId(ctx))
        .in("order_id", orderIds), []);
      if (requestId !== state.kitchenRequest) return;
      state.kitchenItems = groupItemsByOrder(items);
    } catch (error) {
      toast(ctx, error.message, "error");
    } finally {
      if (requestId === state.kitchenRequest) {
        state.kitchenLoading = false;
        if (renderAfter && state.view === "kitchen") renderBoard();
      }
    }
  };

  const openDetails = async (order) => {
    const requestId = ++state.detailRequest;
    const body = h(ctx, "div", { className: "merchant-state", role: "status" }, "Carregando itens do pedido...");
    const modal = registerDialog(openDialog(ctx, { title: `Pedido #${order.order_number}`, content: body }));
    modal.dialog.classList.add("merchant-dialog--wide");
    try {
      const items = await dataOf(ctx.api.from("order_items")
        .select("*, order_item_options(*)")
        .eq("store_id", getStoreId(ctx))
        .eq("order_id", order.id), []);
      if (requestId !== state.detailRequest || !modal.dialog.isConnected) return;
      renderDetails(order, items, body, modal);
      if (!order.is_seen) {
        order.is_seen = true;
        void dataOf(ctx.api.from("orders").update({ is_seen: true }).eq("id", order.id).eq("store_id", getStoreId(ctx))).catch(() => null);
      }
    } catch (error) {
      body.className = "merchant-alert";
      body.textContent = error.message;
    }
  };

  const renderDetails = (order, items, body, modal) => {
    const addressLines = deliveryAddressLines(order);
    const mapUrl = buildMapUrl(order);
    const whatsappUrl = buildWhatsAppUrl(order.customer_phone, `Ola ${order.customer_name ?? ""}, sobre seu pedido #${order.order_number}.`);
    const itemList = h(ctx, "div", { className: "merchant-order-detail-items" }, items.length
      ? items.map((item) => h(ctx, "article", { className: "merchant-order-detail-item" },
        h(ctx, "div", { className: "merchant-list__item" },
          h(ctx, "span", {}, `${item.quantity}x ${item.product_name}`),
          h(ctx, "strong", {}, money(ctx, orderItemTotal(item)))),
        h(ctx, "small", {}, `${money(ctx, orderItemUnitTotal(item))} cada`),
        orderItemOptions(item).length ? h(ctx, "ul", { className: "merchant-order-options" }, orderItemOptions(item).map((option) => h(ctx, "li", {},
          `+ ${orderOptionLabel(option)}${Number(option.extra_price ?? option.price ?? 0) > 0 ? ` (${money(ctx, option.extra_price ?? option.price)})` : ""}`))) : null,
        item.notes ? h(ctx, "p", { className: "merchant-page__description" }, `Observacao do item: ${item.notes}`) : null))
      : h(ctx, "p", {}, "Nenhum item encontrado."));
    const customer = h(ctx, "section", { className: "merchant-panel" },
      h(ctx, "h3", { className: "merchant-panel__title" }, "Cliente e entrega"),
      h(ctx, "p", {}, order.customer_name ?? "Cliente"),
      h(ctx, "p", {}, order.customer_phone ?? "Telefone nao informado"),
      h(ctx, "div", { className: "merchant-order-address" }, addressLines.map((line) => h(ctx, "span", {}, line))),
      order.delivery_reference ? h(ctx, "p", {}, `Referencia: ${order.delivery_reference}`) : null,
      h(ctx, "div", { className: "merchant-actions" },
        whatsappUrl ? h(ctx, "a", { className: "merchant-button", href: whatsappUrl, target: "_blank", rel: "noopener noreferrer" }, "Chamar no WhatsApp") : null,
        mapUrl ? h(ctx, "a", { className: "merchant-button", href: mapUrl, target: "_blank", rel: "noopener noreferrer" }, "Abrir no mapa") : null));
    const payment = h(ctx, "section", { className: "merchant-panel" },
      h(ctx, "h3", { className: "merchant-panel__title" }, "Pagamento"),
      h(ctx, "p", {}, paymentLabel(order.payment_method)),
      badge(ctx, order.payment_status ?? "pendente", statusTone(order.payment_status)),
      order.refund_status ? h(ctx, "p", {}, `Estorno: ${String(order.refund_status).replaceAll("_", " ")}`) : null,
      order.transfer_status ? h(ctx, "p", {}, `Repasse: ${String(order.transfer_status).replaceAll("_", " ")}`) : null,
      Number(order.change_for) > 0 ? h(ctx, "p", {}, `Troco para: ${money(ctx, order.change_for)}`) : null);
    const summary = h(ctx, "section", { className: "merchant-panel" },
      h(ctx, "h3", { className: "merchant-panel__title" }, "Resumo financeiro"),
      h(ctx, "div", { className: "merchant-order-summary" },
        summaryRow("Subtotal", money(ctx, order.subtotal)),
        order.delivery_type === "entrega" ? summaryRow("Entrega", money(ctx, order.delivery_fee)) : null,
        Number(order.discount_amount) > 0 ? summaryRow(`Desconto${order.coupon_code ? ` (${order.coupon_code})` : ""}`, `-${money(ctx, order.discount_amount)}`) : null,
        summaryRow("Total", money(ctx, order.total), true)),
      order.notes ? h(ctx, "p", { className: "merchant-page__description" }, `Observacao: ${order.notes}`) : null,
      order.cancel_reason ? h(ctx, "p", { className: "merchant-page__description" }, `Motivo do cancelamento: ${order.cancel_reason}`) : null);
    const quickActions = h(ctx, "section", { className: "merchant-panel" },
      h(ctx, "h3", { className: "merchant-panel__title" }, "Acoes rapidas"),
      h(ctx, "div", { className: "merchant-actions" },
        actionButton(order, { onDone: modal.close }),
        button(ctx, "Imprimir pedido", { onClick: () => printTicket(order, items) }),
        !["entregue", "cancelado", "estornado"].includes(order.status)
          ? button(ctx, "Cancelar pedido", { danger: true, onClick: () => openCancelDialog(order, modal.close) })
          : null,
        order.status === "entregue" && ["NAO_LIBERADO", "AGUARDANDO_ENTREGA", "LIBERADO", "FALHOU", "BLOQUEADO"].includes(order.transfer_status)
          ? button(ctx, "Verificar conclusao financeira", { onClick: (event) => void retryFinancialCompletion(order, event.currentTarget) })
          : null));
    body.className = "merchant-order-detail";
    body.replaceChildren(
      h(ctx, "div", { className: "merchant-grid" }, customer, payment),
      h(ctx, "section", { className: "merchant-panel" }, h(ctx, "h3", { className: "merchant-panel__title" }, "Itens"), itemList),
      summary,
      quickActions,
    );
  };

  const summaryRow = (label, value, total = false) => h(ctx, "div", { className: total ? "merchant-order-summary__total" : "" }, h(ctx, "span", {}, label), h(ctx, "strong", {}, value));

  const printTicket = (order, items, title = "Pedido") => {
    const opened = printOrderTicket(ctx, { order, items, storeName: state.storeName, title });
    if (!opened) toast(ctx, "O navegador bloqueou a janela de impressao.", "error");
  };

  const runOrderAction = async (order, control, task) => {
    if (state.busy.has(order.id) || control?.disabled) return;
    state.busy.add(order.id);
    try { return await withBusy(control, task); }
    finally { state.busy.delete(order.id); }
  };

  const changeStatus = async (order, status, control, onDone) => {
    if (orderMutationForStatus(status) !== "update-order-status") {
      toast(ctx, "Estados finais exigem o fluxo financeiro seguro.", "error");
      return;
    }
    await runOrderAction(order, control, async () => {
      try {
        await dataOf(ctx.api.fn("update-order-status", {
          orderId: order.id,
          storeId: getStoreId(ctx),
          status,
          note: null,
        }));
        toast(ctx, "Status atualizado e cliente avisado.", "success");
        await load({ silent: true });
        onDone?.();
      } catch (error) {
        toast(ctx, error.message, "error");
      }
    });
  };

  const completeOrder = async (order, control, onDone) => {
    const label = order.delivery_type === "retirada" ? "retirada" : "entrega";
    if (!await confirmAction(ctx, `Confirmar a ${label} do pedido #${order.order_number}? Esta acao pode liberar o repasse.`)) return;
    await runOrderAction(order, control, async () => {
      try {
        const result = await dataOf(ctx.api.fn("merchant-mark-delivered", {
          orderId: order.id,
          note: `${label} confirmada pela loja`,
        }), {});
        if (result.transfer?.ok === false) {
          toast(ctx, `Pedido concluido; o repasse requer revisao: ${result.transfer.reason ?? "falha financeira"}.`, "warning");
        } else {
          toast(ctx, result.releaseTriggered
            ? "Pedido concluido e repasse iniciado."
            : "Pedido concluido; o financeiro foi atualizado.", "success");
        }
        await load({ silent: true });
        onDone?.();
      } catch (error) {
        toast(ctx, error.message, "error");
        await load({ silent: true });
      }
    });
  };

  const retryFinancialCompletion = async (order, control) => {
    if (!await confirmAction(ctx, `Verificar a conclusao financeira do pedido #${order.order_number}?`)) return;
    await runOrderAction(order, control, async () => {
      try {
        const result = await dataOf(ctx.api.fn("merchant-mark-delivered", { orderId: order.id }), {});
        toast(ctx, result.releaseTriggered ? "Repasse iniciado." : "Conclusao financeira verificada.", "success");
      } catch (error) {
        toast(ctx, error.message, "error");
      }
    });
  };

  const approveManualPix = async (order, control, onDone) => {
    if (!canApproveManualPix(order)) {
      toast(ctx, "Somente Pix manual pendente pode ser confirmado aqui.", "error");
      return;
    }
    if (!await confirmAction(ctx, "Confirma que o Pix manual foi recebido?")) return;
    await runOrderAction(order, control, async () => {
      try {
        const result = await dataOf(ctx.api.fn("approve-manual-pix", { orderId: order.id, storeId: getStoreId(ctx) }), {});
        toast(ctx, result.alreadyPaid ? "Pagamento ja estava aprovado." : "Pagamento Pix confirmado.", "success");
        await load({ silent: true });
        onDone?.();
      } catch (error) {
        toast(ctx, error.message, "error");
      }
    });
  };

  const openCancelDialog = (order, onDone) => {
    const reason = h(ctx, "textarea", {
      className: "merchant-textarea",
      name: "reason",
      required: true,
      minlength: 3,
      maxlength: 500,
      placeholder: "Explique o motivo para a equipe e para o registro financeiro.",
    });
    const confirmation = h(ctx, "input", { type: "checkbox", name: "confirmed", value: "yes", required: true });
    const submit = button(ctx, "Confirmar cancelamento", { danger: true, type: "submit" });
    const form = h(ctx, "form", { className: "merchant-form" },
      h(ctx, "p", {}, order.payment_status === "pago"
        ? "O pedido esta pago. O cancelamento bloqueara o repasse e iniciara o fluxo de estorno."
        : "O pedido sera removido da fila operacional."),
      h(ctx, "label", { className: "merchant-field" }, h(ctx, "span", {}, "Motivo do cancelamento"), reason),
      h(ctx, "label", { className: "merchant-order-confirm" }, confirmation, h(ctx, "span", {}, "Confirmo o cancelamento definitivo deste pedido.")),
      submit);
    const modal = registerDialog(openDialog(ctx, { title: `Cancelar pedido #${order.order_number}`, content: form }));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const cancelReason = reason.value.trim();
      if (cancelReason.length < 3 || !confirmation.checked) {
        toast(ctx, "Informe o motivo e confirme o cancelamento.", "error");
        return;
      }
      void runOrderAction(order, submit, async () => {
        try {
          const result = await dataOf(ctx.api.fn("merchant-cancel-order", { orderId: order.id, reason: cancelReason }), {});
          if (result.refund?.ok === false) {
            toast(ctx, `Pedido cancelado; estorno pendente: ${result.refund.reason ?? "revisao financeira necessaria"}.`, "warning");
          } else if (result.refund) {
            toast(ctx, "Pedido cancelado e estorno iniciado.", "success");
          } else {
            toast(ctx, "Pedido cancelado.", "success");
          }
          modal.close();
          onDone?.();
          await load({ silent: true });
        } catch (error) {
          toast(ctx, error.message, "error");
        }
      });
    });
  };

  function openHistory() {
    const period = selectControl("Periodo", "history-period", [
      ["1", "Hoje"],
      ["7", "Ultimos 7 dias"],
      ["30", "Ultimos 30 dias"],
      ["custom", "Intervalo personalizado"],
    ], state.history.period);
    const status = selectControl("Status", "history-status", [
      ["todos", "Todos os status finais"],
      ...HISTORY_STATUSES.map((value) => [value, STATUS_LABELS[value]]),
    ], state.history.status);
    const search = h(ctx, "input", { className: "merchant-input", name: "history-search", type: "search", value: state.history.search, placeholder: "Cliente ou numero" });
    const start = h(ctx, "input", { className: "merchant-input", name: "history-start", type: "date", value: state.history.startDate });
    const end = h(ctx, "input", { className: "merchant-input", name: "history-end", type: "date", value: state.history.endDate });
    const customDates = h(ctx, "div", { className: "merchant-form__grid" },
      h(ctx, "label", { className: "merchant-field" }, h(ctx, "span", {}, "Data inicial"), start),
      h(ctx, "label", { className: "merchant-field" }, h(ctx, "span", {}, "Data final"), end));
    customDates.hidden = state.history.period !== "custom";
    period.control.addEventListener("change", () => { customDates.hidden = period.control.value !== "custom"; });
    const apply = button(ctx, "Aplicar filtros", { primary: true, type: "submit" });
    const results = h(ctx, "div", { className: "merchant-history-results", role: "region", "aria-live": "polite", "aria-label": "Resultados do historico" });
    state.history.results = results;
    const form = h(ctx, "form", { className: "merchant-form" },
      h(ctx, "div", { className: "merchant-toolbar" },
        period.field,
        status.field,
        h(ctx, "label", { className: "merchant-field" }, h(ctx, "span", {}, "Busca"), search),
        apply),
      customDates,
      results);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      state.history.period = period.control.value;
      state.history.status = status.control.value;
      state.history.search = search.value;
      state.history.startDate = start.value;
      state.history.endDate = end.value;
      state.history.page = 1;
      void loadHistory();
    });
    const modal = registerDialog(openDialog(ctx, { title: "Historico de pedidos", content: form }));
    modal.dialog.classList.add("merchant-dialog--wide");
    void loadHistory();
  }

  const selectControl = (label, name, options, value) => {
    const control = h(ctx, "select", { className: "merchant-select", name }, options.map(([optionValue, optionLabel]) => h(ctx, "option", {
      value: optionValue,
      selected: optionValue === value,
    }, optionLabel)));
    return { control, field: h(ctx, "label", { className: "merchant-field" }, h(ctx, "span", {}, label), control) };
  };

  const loadHistory = async () => {
    const results = state.history.results;
    if (!results || state.history.loading) return;
    state.history.loading = true;
    results.setAttribute("aria-busy", "true");
    results.replaceChildren(h(ctx, "div", { className: "merchant-state", role: "status" }, "Carregando historico..."));
    try {
      const range = historyDateRange(state.history);
      let query = ctx.api.from("orders")
        .select("*")
        .eq("store_id", getStoreId(ctx))
        .gte("created_at", range.from);
      query = state.history.status === "todos"
        ? query.in("status", HISTORY_STATUSES)
        : query.eq("status", state.history.status);
      if (range.to) query = query.lte("created_at", range.to);
      state.history.orders = await dataOf(query.order("created_at", { ascending: false }).limit(250), []);
      renderHistoryResults();
    } catch (error) {
      results.replaceChildren(h(ctx, "div", { className: "merchant-alert", role: "alert" }, error.message));
    } finally {
      state.history.loading = false;
      results.removeAttribute("aria-busy");
    }
  };

  const renderHistoryResults = () => {
    const search = state.history.search.trim().toLocaleLowerCase("pt-BR");
    const filtered = state.history.orders.filter((order) => !search
      || String(order.order_number ?? "").includes(search)
      || String(order.customer_name ?? "").toLocaleLowerCase("pt-BR").includes(search));
    const pagination = paginate(filtered, state.history.page, HISTORY_PAGE_SIZE);
    state.history.page = pagination.page;
    const list = pagination.items.length
      ? h(ctx, "div", { className: "merchant-history-list" }, pagination.items.map((order) => h(ctx, "article", { className: "merchant-history-card" },
        h(ctx, "div", {}, h(ctx, "strong", {}, `#${order.order_number} - ${order.customer_name ?? "Cliente"}`), h(ctx, "small", {}, date(ctx, order.created_at, true))),
        badge(ctx, STATUS_LABELS[order.status] ?? order.status, statusTone(order.status)),
        h(ctx, "strong", {}, money(ctx, order.total)),
        button(ctx, "Detalhes", { onClick: () => void openDetails(order) }))))
      : h(ctx, "div", { className: "merchant-state" }, h(ctx, "strong", {}, "Nenhum pedido no historico"));
    state.history.results.replaceChildren(
      h(ctx, "p", { role: "status" }, `${pagination.totalItems} pedido${pagination.totalItems === 1 ? "" : "s"} encontrado${pagination.totalItems === 1 ? "" : "s"}.`),
      list,
      renderPagination(pagination, (pageNumber) => { state.history.page = pageNumber; renderHistoryResults(); }),
    );
  };

  const renderPagination = (pagination, onPage) => h(ctx, "nav", { className: "merchant-pagination", "aria-label": "Paginacao" },
    h(ctx, "span", {}, `Pagina ${pagination.page} de ${pagination.totalPages}`),
    h(ctx, "div", { className: "merchant-actions" },
      button(ctx, "Anterior", { disabled: pagination.page <= 1, onClick: () => onPage(pagination.page - 1) }),
      button(ctx, "Proxima", { disabled: pagination.page >= pagination.totalPages, onClick: () => onPage(pagination.page + 1) })));

  const emptyOrders = () => h(ctx, "div", { className: "merchant-state" },
    h(ctx, "strong", {}, "Nenhum pedido encontrado"),
    h(ctx, "span", {}, "Revise os filtros ou aguarde um novo pedido."));

  const notifyOrder = (order, key, message) => {
    if (!order?.id || state.notificationKeys.has(key)) return;
    state.notificationKeys.add(key);
    state.knownOrderIds.add(String(order.id));
    toast(ctx, message, "success");
    page.announce(message);
    playAlert();
  };

  const toggleSound = async () => {
    if (state.soundEnabled) {
      state.soundEnabled = false;
      await state.audioContext?.close?.().catch(() => null);
      state.audioContext = null;
      soundControl.textContent = "Ativar som";
      soundControl.setAttribute("aria-pressed", "false");
      soundControl.setAttribute("aria-label", "Ativar alertas sonoros");
      toast(ctx, "Alertas sonoros desativados.", "info");
      return;
    }
    const ownerDocument = ctx.ui?.document ?? globalThis.document;
    const view = ownerDocument?.defaultView ?? globalThis;
    const AudioContext = view.AudioContext ?? view.webkitAudioContext;
    if (!AudioContext) {
      toast(ctx, "Este navegador nao oferece alertas sonoros.", "error");
      return;
    }
    try {
      state.audioContext = new AudioContext();
      await state.audioContext.resume?.();
      state.soundEnabled = true;
      soundControl.textContent = "Som ativo";
      soundControl.setAttribute("aria-pressed", "true");
      soundControl.setAttribute("aria-label", "Desativar alertas sonoros");
      playAlert();
      toast(ctx, "Alertas sonoros ativados.", "success");
    } catch {
      state.audioContext = null;
      toast(ctx, "O navegador bloqueou o som. Tente novamente.", "error");
    }
  };

  const playAlert = () => {
    const audio = state.audioContext;
    if (!state.soundEnabled || !audio) return;
    try {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const now = audio.currentTime;
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, now);
      oscillator.frequency.setValueAtTime(660, now + 0.14);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.31);
      const navigatorObject = (ctx.ui?.document ?? globalThis.document)?.defaultView?.navigator ?? globalThis.navigator;
      navigatorObject?.vibrate?.([120, 60, 120]);
    } catch {
      // A visual toast and live-region announcement remain available.
    }
  };

  const handleRealtimeMessage = (payload) => {
    state.lastRealtimeAt = Date.now();
    if (payload?.table !== "orders" || !["INSERT", "UPDATE", "DELETE"].includes(payload.eventType)) return;
    const row = payload.new ?? payload.old;
    if (!row?.id) return;
    const previous = state.orders.find((order) => order.id === row.id);
    if (payload.eventType === "INSERT" && !state.knownOrderIds.has(String(row.id))) {
      notifyOrder(row, `new:${row.id}`, `Novo pedido #${row.order_number}`);
    }
    if (payload.eventType === "UPDATE" && previous?.status === "aguardando_pagamento" && row.status === "novo") {
      notifyOrder(row, `paid:${row.id}`, `Pagamento confirmado no pedido #${row.order_number}`);
    }
    void load({ silent: true, detectNew: false });
  };

  const scheduleReconnect = () => {
    if (page.signal.aborted || state.reconnectTimer) return;
    state.reconnectTimer = globalThis.setTimeout?.(() => {
      state.reconnectTimer = null;
      connectRealtime();
    }, 5_000);
  };

  const connectRealtime = () => {
    state.streamStop?.();
    state.streamStop = null;
    if (page.signal.aborted || typeof ctx.api.stream !== "function") {
      state.realtimeState = "offline";
      updateConnectionIndicator();
      return;
    }
    state.realtimeState = "connecting";
    updateConnectionIndicator();
    state.streamStop = ctx.api.stream({
      table: "orders",
      event: "*",
      filter: `store_id=eq.${getStoreId(ctx)}`,
      onMessage: (payload) => {
        state.lastRealtimeAt = Date.now();
        handleRealtimeMessage(payload);
      },
      onStatus: (status) => {
        if (status === "connected") {
          state.realtimeState = "online";
          state.lastRealtimeAt = Date.now();
          updateConnectionIndicator();
        } else {
          state.realtimeState = "offline";
          updateConnectionIndicator();
          scheduleReconnect();
        }
      },
    });
  };

  const startSynchronization = () => {
    if (page.signal.aborted) return;
    connectRealtime();
    state.pollTimer = globalThis.setInterval?.(() => {
      const documentObject = ctx.ui?.document ?? globalThis.document;
      if (documentObject?.hidden) return;
      const stale = state.realtimeState === "online" && Date.now() - state.lastRealtimeAt > REALTIME_STALE_MS;
      if (stale) {
        state.realtimeState = "offline";
        updateConnectionIndicator();
        scheduleReconnect();
      }
      void load({ silent: true, detectNew: true });
    }, POLL_INTERVAL_MS);
  };

  page.onCleanup(() => {
    state.detailRequest += 1;
    state.kitchenRequest += 1;
    state.streamStop?.();
    globalThis.clearTimeout?.(state.reconnectTimer);
    globalThis.clearInterval?.(state.pollTimer);
    void state.audioContext?.close?.().catch(() => null);
    for (const dialog of state.dialogs) dialog.remove();
    state.dialogs.clear();
  });
  page.root.ready = load().then(startSynchronization);
  return page.root;
}

export default render;
