import {
  deliveryAddressLines,
  orderItemOptions,
  orderItemTotal,
  orderOptionLabel,
} from "./orders-model.js";

const ORDER_PRINT_STYLESHEET = new URL("./orders-print.css", import.meta.url).href;
const paymentName = (method) => ({
  pix: "Pix",
  dinheiro: "Dinheiro",
  cartao_credito_entrega: "Credito na entrega",
  cartao_debito_entrega: "Debito na entrega",
})[method] ?? method ?? "Nao informado";

const append = (parent, ...children) => {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child?.nodeType ? child : parent.ownerDocument.createTextNode(String(child)));
  }
  return parent;
};

const element = (doc, tag, { className, text } = {}, ...children) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return append(node, children);
};

const row = (doc, label, value, className = "") => element(doc, "div", { className: `merchant-print__row ${className}`.trim() },
  element(doc, "span", { text: label }),
  element(doc, "strong", { text: value }));

export function buildOrderPrintDocument(doc, { order, items, storeName, title = "Pedido", formatMoney }) {
  doc.title = `Pedido ${order.order_number ?? order.id ?? ""}`;
  const meta = doc.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  const stylesheet = doc.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = ORDER_PRINT_STYLESHEET;
  doc.head.replaceChildren(meta, stylesheet);

  const ticket = element(doc, "main", { className: "merchant-print-ticket" });
  const heading = element(doc, "header", { className: "merchant-print__header" },
    element(doc, "h1", { text: storeName || title }),
    element(doc, "p", { text: order.delivery_type === "entrega" ? "ENTREGA" : "RETIRADA NO LOCAL" }));
  const identity = element(doc, "section", { className: "merchant-print__section" },
    element(doc, "h2", { text: `${title} #${order.order_number ?? order.id ?? ""}` }),
    element(doc, "p", { text: new Date(order.created_at ?? Date.now()).toLocaleString("pt-BR") }),
    element(doc, "p", { text: order.customer_name ?? "Cliente" }),
    order.customer_phone ? element(doc, "p", { text: `Telefone: ${order.customer_phone}` }) : null);
  const delivery = element(doc, "section", { className: "merchant-print__section" },
    element(doc, "h2", { text: order.delivery_type === "entrega" ? "Endereco de entrega" : "Retirada" }),
    deliveryAddressLines(order).map((line) => element(doc, "p", { text: line })),
    order.delivery_reference ? element(doc, "p", { text: `Referencia: ${order.delivery_reference}` }) : null);
  const itemSection = element(doc, "section", { className: "merchant-print__section" }, element(doc, "h2", { text: "Itens" }));
  for (const item of items ?? []) {
    const itemNode = element(doc, "article", { className: "merchant-print__item" },
      row(doc, `${item.quantity}x ${item.product_name}`, formatMoney(orderItemTotal(item))),
      item.notes ? element(doc, "p", { text: `Observacao: ${item.notes}` }) : null);
    const options = orderItemOptions(item);
    if (options.length) {
      itemNode.append(element(doc, "ul", { className: "merchant-print__options" }, options.map((option) =>
        element(doc, "li", { text: `${orderOptionLabel(option)}${Number(option.extra_price ?? option.price ?? 0) > 0 ? ` (+${formatMoney(option.extra_price ?? option.price)})` : ""}` }))));
    }
    itemSection.append(itemNode);
  }
  const totals = element(doc, "section", { className: "merchant-print__section" },
    element(doc, "h2", { text: "Resumo" }),
    row(doc, "Subtotal", formatMoney(order.subtotal)),
    Number(order.delivery_fee) > 0 ? row(doc, "Entrega", formatMoney(order.delivery_fee)) : null,
    Number(order.discount_amount) > 0 ? row(doc, `Desconto${order.coupon_code ? ` (${order.coupon_code})` : ""}`, `-${formatMoney(order.discount_amount)}`) : null,
    row(doc, "Total", formatMoney(order.total), "merchant-print__total"),
    element(doc, "p", { text: `Pagamento: ${paymentName(order.payment_method)}` }),
    Number(order.change_for) > 0 ? element(doc, "p", { text: `Troco para: ${formatMoney(order.change_for)}` }) : null,
    order.notes ? element(doc, "p", { text: `Observacoes: ${order.notes}` }) : null);
  ticket.append(heading, identity, delivery, itemSection, totals,
    element(doc, "footer", { className: "merchant-print__footer", text: "Hype Delivery" }));
  doc.body.className = "merchant-print";
  doc.body.replaceChildren(ticket);
  return { ticket, stylesheet };
}

export function printOrderTicket(ctx, { order, items, storeName, title = "Pedido" }) {
  const ownerDocument = ctx.ui?.document ?? globalThis.document;
  const view = ownerDocument?.defaultView ?? globalThis.window;
  const printWindow = view?.open?.("", "_blank", "width=420,height=760");
  if (!printWindow?.document) return false;
  try { printWindow.opener = null; } catch { /* browser may expose a read-only opener */ }
  const { stylesheet } = buildOrderPrintDocument(printWindow.document, {
    order,
    items,
    storeName,
    title,
    formatMoney: (value) => ctx.ui.money?.(Number(value ?? 0))
      ?? Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
  });
  let requested = false;
  const requestPrint = () => {
    if (requested || printWindow.closed) return;
    requested = true;
    printWindow.focus();
    printWindow.print();
  };
  stylesheet.addEventListener("load", () => view.setTimeout(requestPrint, 80), { once: true });
  printWindow.addEventListener?.("afterprint", () => printWindow.close(), { once: true });
  view.setTimeout(requestPrint, 900);
  return true;
}
