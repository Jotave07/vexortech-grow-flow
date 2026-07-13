export const ORDER_COLUMNS = Object.freeze([
  { id: "awaiting", label: "Aguardando Pix", helper: "Confirme apenas pagamentos Pix manuais comprovados.", statuses: ["aguardando_pagamento"] },
  { id: "new", label: "Novos", helper: "Pedidos liberados para aceite.", statuses: ["novo"] },
  { id: "confirmed", label: "Confirmados", helper: "Organize a fila antes do preparo.", statuses: ["confirmado"] },
  { id: "preparing", label: "Em preparo", helper: "Acompanhe o tempo de cada pedido.", statuses: ["em_preparo"] },
  { id: "route", label: "Rota ou retirada", helper: "Conclua somente após entregar ou retirar.", statuses: ["saiu_para_entrega", "pronto_para_retirada"] },
]);

export const OPERATIONAL_STATUSES = Object.freeze(ORDER_COLUMNS.flatMap((column) => column.statuses));
export const HISTORY_STATUSES = Object.freeze(["entregue", "cancelado", "estornado"]);
export const COOKING_STATUSES = Object.freeze(["em_preparo", "confirmado", "novo"]);

export const STATUS_LABELS = Object.freeze({
  aguardando_pagamento: "Aguardando pagamento",
  novo: "Novo",
  confirmado: "Confirmado",
  em_preparo: "Em preparo",
  saiu_para_entrega: "Saiu para entrega",
  pronto_para_retirada: "Pronto para retirada",
  entregue: "Entregue",
  cancelado: "Cancelado",
  estornado: "Estornado",
});

export const URGENCY_LABELS = Object.freeze({
  low: "Em fila",
  medium: "Atencao",
  high: "Urgente",
  critical: "Critico",
});

export function paymentProvider(order) {
  const relation = Array.isArray(order?.payments) ? order.payments[0] : order?.payments;
  return order?.payment?.provider ?? relation?.provider ?? order?.payment_provider ?? null;
}

export function canApproveManualPix(order) {
  return Boolean(order
    && order.payment_method === "pix"
    && order.status === "aguardando_pagamento"
    && paymentProvider(order) === "manual_pix");
}

export function nextOrderStatus(order) {
  const next = {
    novo: "confirmado",
    confirmado: "em_preparo",
    em_preparo: order?.delivery_type === "retirada" ? "pronto_para_retirada" : "saiu_para_entrega",
    saiu_para_entrega: "entregue",
    pronto_para_retirada: "entregue",
  };
  return next[order?.status] ?? null;
}

export function nextOrderLabel(order) {
  return {
    confirmado: "Aceitar pedido",
    em_preparo: "Iniciar preparo",
    saiu_para_entrega: "Saiu para entrega",
    pronto_para_retirada: "Marcar pronto",
    entregue: order?.delivery_type === "retirada" ? "Confirmar retirada" : "Confirmar entrega",
  }[nextOrderStatus(order)] ?? null;
}

export function orderMutationForStatus(status) {
  if (status === "entregue") return "merchant-mark-delivered";
  if (status === "cancelado") return "merchant-cancel-order";
  return "update-order-status";
}

export function filterOrders(orders, filters = {}) {
  const search = String(filters.search ?? "").trim().toLocaleLowerCase("pt-BR");
  const periodDays = Number(filters.period);
  const now = Number(filters.now ?? Date.now());
  const cutoff = Number.isFinite(periodDays) && periodDays > 0
    ? now - periodDays * 86_400_000
    : null;
  return [...orders]
    .filter((order) => !search
      || String(order.order_number ?? "").includes(search)
      || String(order.customer_name ?? "").toLocaleLowerCase("pt-BR").includes(search))
    .filter((order) => !filters.status
      || filters.status === "all"
      || (filters.status === "route"
        ? ["saiu_para_entrega", "pronto_para_retirada"].includes(order.status)
        : order.status === filters.status))
    .filter((order) => !filters.deliveryType || filters.deliveryType === "all" || order.delivery_type === filters.deliveryType)
    .filter((order) => cutoff === null || new Date(order.created_at).getTime() >= cutoff)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function groupOrders(orders) {
  return Object.fromEntries(ORDER_COLUMNS.map((column) => [column.id, orders.filter((order) => column.statuses.includes(order.status))]));
}

export function countOrderStatuses(orders) {
  const counts = Object.fromEntries([...OPERATIONAL_STATUSES, ...HISTORY_STATUSES].map((status) => [status, 0]));
  for (const order of orders) counts[order.status] = (counts[order.status] ?? 0) + 1;
  return counts;
}

export function paginate(items, page = 1, pageSize = 25) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(totalPages, Math.max(1, Number(page) || 1));
  return {
    page: safePage,
    pageSize,
    totalPages,
    totalItems: items.length,
    items: items.slice((safePage - 1) * pageSize, safePage * pageSize),
  };
}

export function selectPayment(payments) {
  return payments.find((payment) => payment.provider === "manual_pix") ?? payments[0] ?? null;
}

export function mergeOrderPayments(orders, payments) {
  const byOrder = new Map();
  for (const payment of payments) {
    const current = byOrder.get(payment.order_id) ?? [];
    current.push(payment);
    byOrder.set(payment.order_id, current);
  }
  return orders.map((order) => ({ ...order, payment: selectPayment(byOrder.get(order.id) ?? []) }));
}

export function orderItemOptions(item) {
  const options = item?.order_item_options ?? item?.options ?? [];
  return Array.isArray(options) ? options : [];
}

export function orderItemUnitTotal(item) {
  const extras = orderItemOptions(item).reduce((sum, option) => sum + Number(option.extra_price ?? option.price ?? 0), 0);
  return Number(item?.unit_price ?? 0) + extras;
}

export function orderItemTotal(item) {
  const saved = Number(item?.subtotal ?? item?.item_subtotal ?? 0);
  return saved > 0 ? saved : orderItemUnitTotal(item) * Number(item?.quantity ?? 0);
}

export function orderOptionLabel(option) {
  const group = String(option?.option_name ?? "").trim();
  const item = String(option?.item_name ?? option?.name ?? "Opcao").trim();
  return group ? `${group}: ${item}` : item;
}

export function groupItemsByOrder(items) {
  const grouped = new Map();
  for (const item of items) {
    const current = grouped.get(item.order_id) ?? [];
    current.push(item);
    grouped.set(item.order_id, current);
  }
  return grouped;
}

export function calculateUrgency({ ageMinutes, estimatedMin }) {
  if (ageMinutes >= 25) return "critical";
  if (ageMinutes >= 15) return "high";
  if (estimatedMin && ageMinutes >= Number(estimatedMin) * 0.7) return "medium";
  return "low";
}

export function findBatchingOpportunities(orders) {
  const productMap = new Map();
  for (const order of orders) {
    for (const item of order.items ?? []) {
      const name = String(item.product_name ?? "Produto").trim();
      const key = name.toLocaleLowerCase("pt-BR");
      const current = productMap.get(key) ?? { productName: name, totalQuantity: 0, orderNumbers: [] };
      current.totalQuantity += Number(item.quantity ?? 0);
      if (!current.orderNumbers.includes(order.order_number)) current.orderNumbers.push(order.order_number);
      productMap.set(key, current);
    }
  }
  return [...productMap.values()]
    .filter((batch) => batch.orderNumbers.length >= 2)
    .sort((a, b) => b.totalQuantity - a.totalQuantity)
    .map((batch) => ({ ...batch, orderNumbers: [...batch.orderNumbers].sort((a, b) => Number(a) - Number(b)) }));
}

export function calculateKitchenQueue(rawOrders, itemsMap, now = Date.now()) {
  const statusPriority = { em_preparo: 0, confirmado: 1, novo: 2 };
  const urgencyPriority = { critical: 0, high: 1, medium: 2, low: 3 };
  const queue = rawOrders
    .filter((order) => COOKING_STATUSES.includes(order.status))
    .map((order) => {
      const ageMinutes = Math.max(0, Math.floor((Number(now) - new Date(order.created_at).getTime()) / 60_000));
      return {
        ...order,
        items: itemsMap.get(order.id) ?? [],
        ageMinutes,
        urgency: calculateUrgency({ ageMinutes, estimatedMin: order.estimated_min }),
      };
    })
    .sort((a, b) => (statusPriority[a.status] ?? 99) - (statusPriority[b.status] ?? 99)
      || urgencyPriority[a.urgency] - urgencyPriority[b.urgency]
      || new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return { queue, batches: findBatchingOpportunities(queue) };
}

const localDateInput = (value) => {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export function historyDateRange(filters = {}, now = new Date()) {
  const period = String(filters.period ?? "7");
  if (period === "custom") {
    const start = String(filters.startDate ?? "");
    const end = String(filters.endDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) {
      throw new Error("Informe um intervalo valido para o historico.");
    }
    return {
      from: new Date(`${start}T00:00:00`).toISOString(),
      to: new Date(`${end}T23:59:59.999`).toISOString(),
    };
  }
  if (period === "1") {
    const today = localDateInput(now);
    return { from: new Date(`${today}T00:00:00`).toISOString(), to: null };
  }
  const days = Math.max(1, Number(period) || 7);
  return { from: new Date(new Date(now).getTime() - days * 86_400_000).toISOString(), to: null };
}

const addressValue = (value) => String(value ?? "").trim();

export function deliveryAddressLines(order) {
  if (order?.delivery_type !== "entrega") return ["Retirada na loja"];
  const direct = addressValue(order.delivery_address);
  const street = addressValue(order.street);
  const number = addressValue(order.number);
  const complement = addressValue(order.complement);
  const neighborhood = addressValue(order.delivery_neighborhood ?? order.neighborhood);
  const city = addressValue(order.delivery_city ?? order.city);
  const state = addressValue(order.delivery_state ?? order.state).toUpperCase();
  const zip = addressValue(order.delivery_zip_code ?? order.zip_code);
  const primary = direct || [street, number].filter(Boolean).join(", ");
  const secondary = [complement, neighborhood, [city, state].filter(Boolean).join("/")].filter(Boolean).join(" - ");
  const lines = [primary, secondary, zip ? `CEP: ${zip}` : ""].filter(Boolean);
  return lines.length ? lines : ["Endereco nao informado"];
}

export function buildMapUrl(order) {
  if (order?.delivery_type !== "entrega") return null;
  const query = deliveryAddressLines(order).filter((line) => line !== "Endereco nao informado").join(", ");
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}

export function buildWhatsAppUrl(phone, message) {
  let digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (!/^55\d{10,11}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(String(message ?? ""))}`;
}
