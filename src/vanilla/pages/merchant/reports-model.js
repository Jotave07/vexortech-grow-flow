const validOrder = (order) => !["cancelado", "estornado"].includes(order.status);

export function buildReport(orders, items) {
  const validOrders = orders.filter(validOrder);
  const validOrderIds = new Set(validOrders.map((order) => order.id).filter(Boolean));
  const revenue = validOrders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const daily = new Map();
  validOrders.forEach((order) => {
    const key = String(order.created_at ?? "").slice(0, 10);
    if (key) daily.set(key, (daily.get(key) ?? 0) + Number(order.total || 0));
  });
  const products = new Map();
  items.filter((item) => !item.order_id || validOrderIds.has(item.order_id)).forEach((item) => {
    const current = products.get(item.product_name) ?? { quantity: 0, revenue: 0 };
    current.quantity += Number(item.quantity || 0);
    current.revenue += Number(item.subtotal || 0);
    products.set(item.product_name, current);
  });
  const payments = new Map();
  validOrders.forEach((order) => payments.set(order.payment_method ?? "nao_informado", (payments.get(order.payment_method ?? "nao_informado") ?? 0) + 1));
  return {
    orderCount: validOrders.length,
    revenue,
    averageTicket: validOrders.length ? revenue / validOrders.length : 0,
    canceledCount: orders.length - validOrders.length,
    deliveryCount: validOrders.filter((order) => order.delivery_type === "entrega").length,
    pickupCount: validOrders.filter((order) => order.delivery_type === "retirada").length,
    daily: [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    topProducts: [...products.entries()].sort((a, b) => b[1].quantity - a[1].quantity).slice(0, 10),
    payments: [...payments.entries()].sort((a, b) => b[1] - a[1]),
  };
}
