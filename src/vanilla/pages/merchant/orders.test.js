import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildMapUrl,
  buildWhatsAppUrl,
  calculateKitchenQueue,
  calculateUrgency,
  canApproveManualPix,
  deliveryAddressLines,
  filterOrders,
  historyDateRange,
  mergeOrderPayments,
  orderItemTotal,
  orderItemUnitTotal,
  orderMutationForStatus,
  paginate,
} from "./orders-model.js";

describe("merchant order financial lifecycle", () => {
  it("routes final states through financial lifecycle functions", () => {
    expect(orderMutationForStatus("confirmado")).toBe("update-order-status");
    expect(orderMutationForStatus("em_preparo")).toBe("update-order-status");
    expect(orderMutationForStatus("entregue")).toBe("merchant-mark-delivered");
    expect(orderMutationForStatus("cancelado")).toBe("merchant-cancel-order");
  });

  it("keeps manual Pix approval fail-closed and prefers manual provenance", () => {
    const orders = [{ id: "order-1", payment_method: "pix", status: "aguardando_pagamento" }];
    const [order] = mergeOrderPayments(orders, [
      { order_id: "order-1", provider: "asaas", status: "pendente" },
      { order_id: "order-1", provider: "manual_pix", status: "pendente" },
    ]);
    expect(canApproveManualPix(order)).toBe(true);
    expect(canApproveManualPix({ ...order, payment: { provider: "asaas" } })).toBe(false);
    expect(canApproveManualPix({ ...order, status: "novo" })).toBe(false);
  });
});

describe("merchant order item details", () => {
  it("uses persisted subtotal and calculates a safe legacy fallback with additions", () => {
    const item = {
      unit_price: 20,
      quantity: 2,
      order_item_options: [
        { option_name: "Tamanho", item_name: "Grande", extra_price: 5 },
        { name: "Borda", price: 2 },
      ],
    };
    expect(orderItemUnitTotal(item)).toBe(27);
    expect(orderItemTotal(item)).toBe(54);
    expect(orderItemTotal({ ...item, subtotal: 49 })).toBe(49);
  });
});

describe("merchant kitchen queue", () => {
  const now = Date.parse("2026-07-10T12:30:00Z");
  const orders = [
    { id: "preparing", order_number: 3, customer_name: "Ana", status: "em_preparo", created_at: "2026-07-10T12:25:00Z", estimated_min: 20 },
    { id: "confirmed", order_number: 2, customer_name: "Bia", status: "confirmado", created_at: "2026-07-10T12:10:00Z", estimated_min: 20 },
    { id: "new", order_number: 1, customer_name: "Caio", status: "novo", created_at: "2026-07-10T12:00:00Z", estimated_min: 30 },
  ];
  const items = new Map([
    ["preparing", [{ product_name: "Pizza", quantity: 1 }]],
    ["confirmed", [{ product_name: "Pizza", quantity: 2 }]],
    ["new", [{ product_name: "Suco", quantity: 1 }]],
  ]);

  it("calculates thresholds and prioritizes status, urgency and FIFO", () => {
    expect(calculateUrgency({ ageMinutes: 25, estimatedMin: 60 })).toBe("critical");
    expect(calculateUrgency({ ageMinutes: 15, estimatedMin: 60 })).toBe("high");
    expect(calculateUrgency({ ageMinutes: 7, estimatedMin: 10 })).toBe("medium");
    expect(calculateUrgency({ ageMinutes: 2, estimatedMin: 10 })).toBe("low");
    const result = calculateKitchenQueue(orders, items, now);
    expect(result.queue.map((order) => order.id)).toEqual(["preparing", "confirmed", "new"]);
    expect(result.queue.map((order) => order.urgency)).toEqual(["low", "high", "critical"]);
  });

  it("suggests batches only when a product appears in multiple orders", () => {
    const { batches } = calculateKitchenQueue(orders, items, now);
    expect(batches).toEqual([{
      productName: "Pizza",
      totalQuantity: 3,
      orderNumbers: [2, 3],
    }]);
  });
});

describe("merchant history and filters", () => {
  it("filters route and pickup as one operational group", () => {
    const orders = [
      { id: "delivery", status: "saiu_para_entrega", delivery_type: "entrega", created_at: "2026-07-10T12:00:00Z" },
      { id: "pickup", status: "pronto_para_retirada", delivery_type: "retirada", created_at: "2026-07-10T11:00:00Z" },
      { id: "new", status: "novo", delivery_type: "entrega", created_at: "2026-07-10T10:00:00Z" },
    ];
    expect(filterOrders(orders, { status: "route" }).map((order) => order.id)).toEqual(["delivery", "pickup"]);
  });

  it("validates custom date ranges and paginates deterministically", () => {
    const range = historyDateRange({ period: "custom", startDate: "2026-07-01", endDate: "2026-07-10" });
    expect(new Date(range.from).getTime()).toBeLessThan(new Date(range.to).getTime());
    expect(() => historyDateRange({ period: "custom", startDate: "2026-07-11", endDate: "2026-07-10" })).toThrow("intervalo valido");
    expect(paginate(Array.from({ length: 51 }, (_, id) => id), 2, 25)).toMatchObject({ page: 2, totalPages: 3, totalItems: 51, items: Array.from({ length: 25 }, (_, index) => index + 25) });
  });
});

describe("merchant order external actions", () => {
  const order = {
    delivery_type: "entrega",
    street: "Rua das Flores",
    number: "10",
    neighborhood: "Centro",
    city: "Sao Paulo",
    state: "SP",
    zip_code: "01001000",
  };

  it("builds fixed-origin map and WhatsApp URLs from validated data", () => {
    expect(deliveryAddressLines(order)).toContain("Rua das Flores, 10");
    expect(buildMapUrl(order)).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
    expect(buildWhatsAppUrl("(11) 99999-9999", "Pedido #42")).toBe("https://wa.me/5511999999999?text=Pedido%20%2342");
    expect(buildWhatsAppUrl("123", "Pedido")).toBeNull();
    expect(buildMapUrl({ delivery_type: "retirada" })).toBeNull();
  });
});

describe("merchant order CSP and realtime implementation", () => {
  it("uses lifecycle, SSE cleanup and polling without unsafe printing APIs", async () => {
    const [ordersSource, printSource] = await Promise.all([
      readFile(new URL("orders.js", import.meta.url), "utf8"),
      readFile(new URL("orders-print.js", import.meta.url), "utf8"),
    ]);
    expect(ordersSource).toContain('ctx.api.fn("merchant-mark-delivered"');
    expect(ordersSource).toContain('ctx.api.fn("merchant-cancel-order"');
    expect(ordersSource).toContain("ctx.api.stream({");
    expect(ordersSource).toContain("state.streamStop?.()");
    expect(ordersSource).toContain("clearInterval");
    expect(ordersSource).toContain("soundEnabled: false");
    expect(printSource).not.toContain("document.write");
    expect(printSource).not.toContain("innerHTML");
    expect(printSource).not.toContain("<style");
    expect(printSource).toContain("doc.createElement");
  });
});
