import { formatBRL, formatDeliveryAddressLines, PAYMENT_METHOD_LABELS } from "@/lib/format";

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const optionRows = (item: any) => {
  const options = item.order_item_options || item.options || [];
  if (!options.length) return "";
  return options.map((o: any) => {
    const group = o.option_name ? `${o.option_name}: ` : "";
    const name = o.item_name || o.name || "";
    const price = Number(o.extra_price || 0) > 0 ? ` (+${formatBRL(o.extra_price)})` : "";
    return `  ${escapeHtml(group)}${escapeHtml(name)}${escapeHtml(price)}`;
  }).join("\n");
};

const itemTotal = (item: any) => {
  const optionsTotal = (item.order_item_options || item.options || []).reduce(
    (sum: number, o: any) => sum + Number(o.extra_price || 0),
    0,
  );
  const calculated = (Number(item.unit_price || 0) + optionsTotal) * Number(item.quantity || 0);
  return Number(item.subtotal || item.item_subtotal || 0) > 0 ? Number(item.subtotal || item.item_subtotal) : calculated;
};

export const printOrderTicket = ({ order, items, title = "Pedido" }: { order: any; items: any[]; title?: string }) => {
  if (typeof window === "undefined") return;
  const printWindow = window.open("", "_blank", "width=340,height=720");
  if (!printWindow) return;

  const storeName = order.store_name || "";
  const orderNum = order.order_number || order.id || "";
  const createdAt = order.created_at ? new Date(order.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : new Date().toLocaleString("pt-BR");

  const deliveryLines = order.delivery_type === "entrega" ? formatDeliveryAddressLines(order) : [];
  const isDelivery = order.delivery_type === "entrega";
  const isPickup = !isDelivery;

  const paymentLabel = PAYMENT_METHOD_LABELS[order.payment_method] || order.payment_method || "";
  const changeFor = Number(order.change_for || 0);

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8"/>
<title>Pedido ${escapeHtml(String(orderNum))}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { color: #000; font: 11px/1.35 "Courier New", monospace; width: 80mm; margin: 0 auto; padding: 4mm 2mm; }
  .center { text-align: center; }
  .right { text-align: right; }
  .dashed { border-top: 1px dashed #000; margin: 3mm 0; }
  .solid { border-top: 1px solid #000; margin: 3mm 0; }
  .bold { font-weight: bold; }
  .big { font-size: 14px; }
  .sm { font-size: 9px; color: #333; }
  .row { display: flex; justify-content: space-between; }
  .mt { margin-top: 2mm; }
  .mb { margin-bottom: 2mm; }
  @media print {
    @page { margin: 0; size: 80mm auto; }
    body { padding: 4mm 2mm; }
  }
</style>
</head>
<body>

<div class="center">
  <div class="big bold">${escapeHtml(storeName || title)}</div>
  ${isDelivery ? '<div class="sm bold">ENTREGA</div>' : ''}
  ${isPickup ? '<div class="sm bold">RETIRADA NO LOCAL</div>' : ''}
</div>

<div class="dashed"></div>

<div>
  <div><strong>Pedido:</strong> #${escapeHtml(String(orderNum))}</div>
  <div><strong>Data:</strong> ${createdAt}</div>
  ${paymentLabel ? `<div><strong>Pagamento:</strong> ${escapeHtml(paymentLabel)}${changeFor > 0 ? ` · Troco para R$ ${changeFor.toFixed(2).replace(".", ",")}` : ""}</div>` : ""}
</div>

<div class="dashed"></div>
<div class="bold">CLIENTE</div>
<div>${escapeHtml(order.customer_name)}</div>
${order.customer_phone ? `<div>Tel: ${escapeHtml(order.customer_phone)}</div>` : ""}

${isDelivery ? `<div class="dashed"></div>
<div class="bold">ENDEREÇO DE ENTREGA</div>
${deliveryLines.map((l: string) => `<div>${escapeHtml(l)}</div>`).join("\n")}
${order.delivery_reference ? `<div class="sm mt">Ref: ${escapeHtml(order.delivery_reference)}</div>` : ""}` : ""}

<div class="dashed"></div>
<div class="bold mb">ITENS</div>

${(items || []).map((item: any) => {
  const opts = optionRows(item);
  return `<div class="row mb">
  <div>
    <span class="bold">${escapeHtml(String(item.quantity))}x</span> ${escapeHtml(item.product_name)}
    ${opts ? `<br/><span class="sm">${opts}</span>` : ""}
    ${item.notes ? `<br/><span class="sm">Obs: ${escapeHtml(item.notes)}</span>` : ""}
  </div>
  <div class="bold right">${formatBRL(itemTotal(item))}</div>
</div>`;
}).join("\n")}

${order.notes ? `<div class="dashed"></div><div class="bold">OBSERVAÇÕES</div><div>${escapeHtml(order.notes)}</div>` : ""}

<div class="dashed"></div>
<div class="row">
  <span>Subtotal</span>
  <span>${formatBRL(order.subtotal || 0)}</span>
</div>
${Number(order.delivery_fee || 0) > 0 ? `<div class="row">
  <span>Taxa de entrega</span>
  <span>${formatBRL(order.delivery_fee)}</span>
</div>` : ""}
${Number(order.discount_amount || 0) > 0 ? `<div class="row">
  <span>Desconto ${order.coupon_code ? `(${escapeHtml(order.coupon_code)})` : ""}</span>
  <span>-${formatBRL(order.discount_amount)}</span>
</div>` : ""}

<div class="solid"></div>
<div class="row big bold">
  <span>TOTAL</span>
  <span>${formatBRL(order.total || 0)}</span>
</div>

<div class="dashed"></div>
<div class="center sm">
  ${storeName ? `${escapeHtml(storeName)} · ` : ""}Hype Delivery<br/>
  Obrigado pela preferência!
</div>

</body>
</html>`;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 350);
};
