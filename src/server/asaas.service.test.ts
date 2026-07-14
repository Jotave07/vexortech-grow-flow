import { describe, expect, it, vi } from "vitest";
import { approveManualPixPayment, createOrderPaymentForOrder } from "./asaas.service";

const order = {
  id: "order-1",
  store_id: "store-1",
  total: 42.5,
  order_number: 77,
  customer_name: "MARIA",
  payment_method: "pix",
  payment_status: "pendente",
  status: "aguardando_pagamento",
  pix_key: "pix@loja.com.br",
  pix_payload: null,
  pix_qr_code: null,
  store_name: "Loja Teste",
  store_city: "Sao Paulo",
};

const createDeps = (options: { existingPayment?: any; orderOverride?: any } = {}) => {
  const currentOrder = { ...order, ...(options.orderOverride || {}) };
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM public.orders o")) return { rows: [currentOrder] };
      if (sql.includes("FROM public.orders") && sql.includes("FOR UPDATE")) return { rows: [currentOrder] };
      if (sql.includes("FROM public.payments") && sql.includes("FOR UPDATE")) {
        return { rows: options.existingPayment ? [options.existingPayment] : [] };
      }
      if (sql.includes("INSERT INTO public.payments")) return { rows: [{ id: "local-payment", status: "pendente" }] };
      if (sql.includes("SET amount")) return { rows: [{ id: "local-payment", status: "pendente" }] };
      if (sql.includes("UPDATE public.payments")) return { rows: [{ id: "local-payment", status: "pago" }] };
      if (sql.includes("pix_payload")) return { rows: [currentOrder] };
      if (sql.includes("UPDATE public.orders")) return { rows: [{ ...currentOrder, payment_status: "pago", status: "novo" }] };
      return { rows: [] };
    }),
  };

  const deps = {
    withTransaction: vi.fn(async (fn: any) => fn(client)),
    query: vi.fn(async () => ({ rows: [] })),
    publishRealtime: vi.fn(),
    notifyStatus: vi.fn(async () => null),
    getActor: vi.fn(async () => ({
      user: { id: "11111111-1111-4111-8111-111111111111" },
      admin: false,
      ownedStoreIds: [order.store_id],
    })),
  };

  return { deps, client };
};

describe("manual Pix order payment service", () => {
  it("creates a local manual Pix payment with a copy-paste payload", async () => {
    const { deps, client } = createDeps();

    const result = await createOrderPaymentForOrder({ orderId: order.id, storeId: order.store_id }, deps as any);

    expect(result.paymentId).toBe("local-payment");
    expect(result.status).toBe("pending");
    expect(result.manual).toBe(true);
    expect(result.pixCode).toContain("BR.GOV.BCB.PIX");
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO public.payments"), expect.any(Array));
  });

  it("reuses an existing pending manual Pix payment", async () => {
    const { deps } = createDeps({
      existingPayment: { id: "local-payment", status: "pendente", provider: "manual_pix" },
    });

    const result = await createOrderPaymentForOrder({ orderId: order.id, storeId: order.store_id }, deps as any);

    expect(result).toMatchObject({ paymentId: "local-payment", status: "pending", manual: true });
  });

  it("requires a store Pix key", async () => {
    const { deps } = createDeps({ orderOverride: { pix_key: "" } });

    await expect(
      createOrderPaymentForOrder({ orderId: order.id, storeId: order.store_id }, deps as any),
    ).rejects.toThrow("chave Pix");
  });

  it.each(["cancelado", "expirado", "entregue"])(
    "does not create or reopen payment for a terminal %s order",
    async (status) => {
      const { deps, client } = createDeps({
        orderOverride: { status },
        existingPayment: { id: "local-payment", status: "pendente", provider: "manual_pix" },
      });

      await expect(
        createOrderPaymentForOrder({ orderId: order.id, storeId: order.store_id }, deps as any),
      ).rejects.toThrow("Pedido encerrado");

      const sql = client.query.mock.calls.map(([statement]) => String(statement)).join("\n");
      expect(sql).not.toContain("FROM public.payments");
      expect(sql).not.toContain("INSERT INTO public.payments");
      expect(sql).not.toContain("UPDATE public.orders");
      expect(deps.publishRealtime).not.toHaveBeenCalled();
    },
  );

  it("approves pending Pix manually and is idempotent for paid orders", async () => {
    const { deps } = createDeps({
      existingPayment: { id: "local-payment", status: "pendente", provider: "manual_pix" },
    });

    const result = await approveManualPixPayment({ orderId: order.id, storeId: order.store_id }, "token", deps as any);

    expect(result).toMatchObject({ success: true, status: "paid" });
    expect(deps.notifyStatus).toHaveBeenCalledTimes(1);
  });

  it("rejects manual approval for a payment managed by a gateway", async () => {
    const { deps } = createDeps({
      existingPayment: { id: "gateway-payment", status: "pendente", provider: "asaas-central" },
    });

    await expect(
      approveManualPixPayment({ orderId: order.id, storeId: order.store_id }, "token", deps as any),
    ).rejects.toThrow("nao possui uma cobranca PIX manual");
    expect(deps.notifyStatus).not.toHaveBeenCalled();
  });

  it("rejects manual approval for a store using the central financial account", async () => {
    const { deps } = createDeps({
      orderOverride: { store_financeiro_ativo: true },
      existingPayment: { id: "local-payment", status: "pendente", provider: "manual_pix" },
    });

    await expect(
      approveManualPixPayment({ orderId: order.id, storeId: order.store_id }, "token", deps as any),
    ).rejects.toThrow("conta central");
  });
});
