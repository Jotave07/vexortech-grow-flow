import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  getActor: vi.fn(),
  publishRealtime: vi.fn(),
  sendOrderStatusNotification: vi.fn(),
  normalizePixKeyType: vi.fn((value: string) => value),
  releaseTransferForDeliveredOrder: vi.fn(),
  retryTransfer: vi.fn(),
  handleTransferFailed: vi.fn(),
  refundCancelledOrder: vi.fn(),
  retryRefund: vi.fn(),
  recordMovement: vi.fn(),
  updateMovementStatus: vi.fn(),
  getMerchantBalance: vi.fn(),
  getOrderFinancialSummary: vi.fn(),
}));

vi.mock("@/backend/db", () => ({
  query: mocks.query,
  withTransaction: mocks.withTransaction,
}));

vi.mock("@/backend/auth", () => ({
  getActor: mocks.getActor,
}));

vi.mock("@/backend/realtime", () => ({
  publishRealtime: mocks.publishRealtime,
}));

vi.mock("@/functions/evolution.server", () => ({
  sendOrderStatusNotification: mocks.sendOrderStatusNotification,
}));

vi.mock("./asaas.central", () => ({
  normalizePixKeyType: mocks.normalizePixKeyType,
}));

vi.mock("./transfer.service", () => ({
  releaseTransferForDeliveredOrder: mocks.releaseTransferForDeliveredOrder,
  retryTransfer: mocks.retryTransfer,
  handleTransferFailed: mocks.handleTransferFailed,
}));

vi.mock("./refund.service", () => ({
  refundCancelledOrder: mocks.refundCancelledOrder,
  retryRefund: mocks.retryRefund,
}));

vi.mock("./financial.ledger", () => ({
  recordMovement: mocks.recordMovement,
  updateMovementStatus: mocks.updateMovementStatus,
  getMerchantBalance: mocks.getMerchantBalance,
  getOrderFinancialSummary: mocks.getOrderFinancialSummary,
}));

import { cancelOrderByMerchant, markOrderDelivered } from "./order.lifecycle";

const orderId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";
const customerId = "33333333-3333-4333-8333-333333333333";

const actor = {
  user: { id: "44444444-4444-4444-8444-444444444444", email: "owner@example.com" },
  profile: null,
  roles: new Set(["merchant"]),
  admin: false,
  ownedStoreIds: [storeId],
};

const baseOrder = {
  id: orderId,
  store_id: storeId,
  customer_id: customerId,
  status: "saiu_para_entrega",
  payment_method: "dinheiro",
  payment_status: "pendente",
  total: 125.5,
  refund_status: "NAO_SOLICITADO",
  transfer_status: "AGUARDANDO_ENTREGA",
  financeiro_ativo: false,
  repasse_automatico: false,
  repasse_momento: "MANUAL",
};

type TestOrder = typeof baseOrder & Record<string, unknown>;

const sqlCallsContaining = (fn: ReturnType<typeof vi.fn>, fragment: string) =>
  fn.mock.calls.filter(([sql]) => String(sql).includes(fragment));

const createHarness = (overrides: Partial<TestOrder> = {}) => {
  const order: TestOrder = { ...baseOrder, ...overrides };

  const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };

    if (sql.includes("FOR UPDATE OF o")) return { rows: [{ ...order }] };
    if (sql.includes("SELECT * FROM public.orders WHERE id = $1 FOR UPDATE")) {
      return { rows: [{ ...order }] };
    }

    if (sql.includes("SET status = 'entregue'")) {
      Object.assign(order, {
        status: "entregue",
        payment_status: order.payment_method === "pix" ? order.payment_status : "pago",
        paid_at: order.payment_method === "pix" ? order.paid_at : order.paid_at || "2026-07-10T12:00:00Z",
        delivered_at: order.delivered_at || "2026-07-10T12:00:00Z",
      });
      return { rows: [{ ...order }] };
    }

    if (sql.includes("SET payment_status = 'pago'")) {
      Object.assign(order, {
        payment_status: "pago",
        paid_at: order.paid_at || "2026-07-10T12:00:00Z",
      });
      return { rows: [{ ...order }] };
    }

    if (sql.includes("SET transfer_status = CASE")) {
      if (["NAO_LIBERADO", "AGUARDANDO_ENTREGA"].includes(String(order.transfer_status))) {
        order.transfer_status = "LIBERADO";
      }
      return { rows: [{ ...order }] };
    }

    if (sql.includes("SET status = 'cancelado'")) {
      const wasPaid = sql.includes("payment_status = 'estorno_pendente'");
      Object.assign(order, {
        status: "cancelado",
        cancel_reason: params?.[1],
        payment_status: wasPaid ? "estorno_pendente" : "cancelado",
        transfer_status: wasPaid ? "BLOQUEADO" : "CANCELADO",
        refund_status: wasPaid ? order.refund_status : "NAO_APLICAVEL",
      });
      return { rows: [{ ...order }] };
    }

    if (
      sql.includes("INSERT INTO public.order_status_history") ||
      sql.includes("UPDATE public.customers") ||
      sql.includes("UPDATE public.payments")
    ) {
      return { rows: [] };
    }

    throw new Error(`SQL transacional inesperado no teste: ${sql}`);
  });

  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM public.orders o") && sql.includes("LEFT JOIN public.store_settings")) {
      return { rows: [{ ...order }] };
    }
    if (sql.includes("SELECT * FROM public.orders WHERE id = $1 LIMIT 1")) {
      return { rows: [{ ...order }] };
    }
    if (sql.includes("UPDATE public.orders SET refund_status = 'PENDENTE'")) {
      order.refund_status = "PENDENTE";
      return { rows: [] };
    }
    throw new Error(`SQL raiz inesperado no teste: ${sql}`);
  });
  mocks.withTransaction.mockImplementation(async (callback: (client: { query: typeof clientQuery }) => unknown) =>
    callback({ query: clientQuery }),
  );

  return { order, clientQuery };
};

describe("order lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendOrderStatusNotification.mockResolvedValue(null);
    mocks.releaseTransferForDeliveredOrder.mockResolvedValue({ ok: true });
    mocks.refundCancelledOrder.mockResolvedValue({ ok: true, status: "PROCESSANDO" });
  });

  describe("markOrderDelivered", () => {
    it.each(["novo", "aceito", "em_preparo", "pronto"])(
      "rejeita entrega diretamente a partir de %s",
      async (status) => {
        const { clientQuery } = createHarness({ status });

        await expect(markOrderDelivered({ orderId }, actor as never)).rejects.toThrow(
          "Conclua as etapas de preparo e saida",
        );

        expect(sqlCallsContaining(clientQuery, "SET status = 'entregue'")).toHaveLength(0);
        expect(mocks.publishRealtime).not.toHaveBeenCalled();
        expect(mocks.sendOrderStatusNotification).not.toHaveBeenCalled();
        expect(mocks.releaseTransferForDeliveredOrder).not.toHaveBeenCalled();
      },
    );

    it("rejeita PIX ainda nao pago mesmo quando o pedido saiu para entrega", async () => {
      const { clientQuery } = createHarness({
        status: "saiu_para_entrega",
        payment_method: "pix",
        payment_status: "pendente",
      });

      await expect(markOrderDelivered({ orderId }, actor as never)).rejects.toThrow(
        "PIX precisa estar pago",
      );

      expect(sqlCallsContaining(clientQuery, "SET status = 'entregue'")).toHaveLength(0);
      expect(mocks.publishRealtime).not.toHaveBeenCalled();
      expect(mocks.sendOrderStatusNotification).not.toHaveBeenCalled();
    });

    it("conclui pedido nao-PIX, contabiliza cliente e publica a mudanca uma unica vez", async () => {
      const { order, clientQuery } = createHarness({
        status: "saiu_para_entrega",
        payment_method: "dinheiro",
        payment_status: "pendente",
      });

      const result = await markOrderDelivered({ orderId, note: "Entregue ao cliente" }, actor as never);

      expect(result).toMatchObject({
        orderId,
        status: "entregue",
        releaseTriggered: false,
        note: "loja_descentralizada",
      });
      expect(order).toMatchObject({ status: "entregue", payment_status: "pago" });
      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE public.customers"),
        [customerId, 125.5],
      );
      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO public.order_status_history"),
        [orderId, storeId, "entregue", "Entregue ao cliente"],
      );
      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE public.payments"),
        [orderId],
      );
      expect(mocks.publishRealtime).toHaveBeenCalledTimes(1);
      expect(mocks.publishRealtime).toHaveBeenCalledWith(expect.objectContaining({
        table: "orders",
        eventType: "UPDATE",
        old: expect.objectContaining({ status: "saiu_para_entrega" }),
        new: expect.objectContaining({ status: "entregue", payment_status: "pago" }),
      }));
      expect(mocks.sendOrderStatusNotification).toHaveBeenCalledTimes(1);
      expect(mocks.sendOrderStatusNotification).toHaveBeenCalledWith(
        orderId,
        "entregue",
        "Entregue ao cliente",
      );
      expect(mocks.releaseTransferForDeliveredOrder).not.toHaveBeenCalled();
    });

    it("tambem permite concluir retirada a partir de pronto_para_retirada", async () => {
      const { order } = createHarness({
        status: "pronto_para_retirada",
        payment_method: "pix",
        payment_status: "pago",
        customer_id: undefined,
      });

      await expect(markOrderDelivered({ orderId }, actor as never)).resolves.toMatchObject({
        status: "entregue",
      });

      expect(order.status).toBe("entregue");
      expect(mocks.sendOrderStatusNotification).toHaveBeenCalledWith(orderId, "entregue", null);
    });

    it("e idempotente no retry de pedido ja entregue e nao duplica totais nem historico", async () => {
      const { clientQuery } = createHarness({
        status: "entregue",
        payment_method: "dinheiro",
        payment_status: "pago",
        paid_at: "2026-07-10T11:00:00Z",
        delivered_at: "2026-07-10T11:30:00Z",
      });

      const result = await markOrderDelivered({ orderId }, actor as never);

      expect(result).toMatchObject({ status: "entregue", releaseTriggered: false });
      expect(sqlCallsContaining(clientQuery, "UPDATE public.customers")).toHaveLength(0);
      expect(sqlCallsContaining(clientQuery, "INSERT INTO public.order_status_history")).toHaveLength(0);
      expect(sqlCallsContaining(clientQuery, "SET status = 'entregue'")).toHaveLength(0);
      expect(mocks.sendOrderStatusNotification).not.toHaveBeenCalled();
      expect(mocks.publishRealtime).toHaveBeenCalledTimes(1);
    });
  });

  describe("cancelOrderByMerchant", () => {
    it("cancela pedido pago, bloqueia repasse, agenda estorno e publica/notifica", async () => {
      const { order, clientQuery } = createHarness({
        status: "saiu_para_entrega",
        payment_method: "pix",
        payment_status: "pago",
        financeiro_ativo: true,
        transfer_status: "AGUARDANDO_ENTREGA",
        refund_status: "NAO_SOLICITADO",
      });

      const result = await cancelOrderByMerchant(
        { orderId, reason: "Cliente solicitou o cancelamento" },
        actor as never,
      );

      expect(result).toMatchObject({
        orderId,
        cancelled: true,
        refund: { ok: true, status: "PROCESSANDO" },
      });
      expect(order).toMatchObject({
        status: "cancelado",
        payment_status: "estorno_pendente",
        transfer_status: "BLOQUEADO",
      });
      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE public.payments"),
        [orderId, "estorno_pendente"],
      );
      expect(clientQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO public.order_status_history"),
        [
          orderId,
          storeId,
          "cancelado",
          "Cancelado pela loja: Cliente solicitou o cancelamento",
        ],
      );
      expect(mocks.refundCancelledOrder).toHaveBeenCalledTimes(1);
      expect(mocks.refundCancelledOrder).toHaveBeenCalledWith(orderId, {
        reason: "Cliente solicitou o cancelamento",
      });
      expect(mocks.releaseTransferForDeliveredOrder).not.toHaveBeenCalled();
      expect(mocks.publishRealtime).toHaveBeenCalledTimes(1);
      expect(mocks.publishRealtime).toHaveBeenCalledWith(expect.objectContaining({
        table: "orders",
        eventType: "UPDATE",
        old: expect.objectContaining({ status: "saiu_para_entrega" }),
        new: expect.objectContaining({
          status: "cancelado",
          payment_status: "estorno_pendente",
          transfer_status: "BLOQUEADO",
        }),
      }));
      expect(mocks.sendOrderStatusNotification).toHaveBeenCalledTimes(1);
      expect(mocks.sendOrderStatusNotification).toHaveBeenCalledWith(
        orderId,
        "cancelado",
        "Cliente solicitou o cancelamento",
      );
    });

    it("nao repete pagamento, historico, estorno nem notificacao para pedido ja cancelado", async () => {
      const { clientQuery } = createHarness({
        status: "cancelado",
        payment_method: "pix",
        payment_status: "estorno_pendente",
        financeiro_ativo: true,
        transfer_status: "BLOQUEADO",
        refund_status: "PROCESSANDO",
      });

      const result = await cancelOrderByMerchant({ orderId, reason: "Retry" }, actor as never);

      expect(result).toMatchObject({
        orderId,
        cancelled: true,
        refund: null,
        note: "ja_cancelado",
      });
      expect(sqlCallsContaining(clientQuery, "SET status = 'cancelado'")).toHaveLength(0);
      expect(sqlCallsContaining(clientQuery, "UPDATE public.payments")).toHaveLength(0);
      expect(sqlCallsContaining(clientQuery, "INSERT INTO public.order_status_history")).toHaveLength(0);
      expect(mocks.refundCancelledOrder).not.toHaveBeenCalled();
      expect(mocks.sendOrderStatusNotification).not.toHaveBeenCalled();
      expect(mocks.publishRealtime).toHaveBeenCalledTimes(1);
    });
  });
});
