import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  isConfigured: vi.fn(() => true),
  refundPayment: vi.fn(),
  mapPaymentStatus: vi.fn((status: string) => status),
  createCustomerRefund: vi.fn(),
  findMovement: vi.fn(),
  updateMovementStatus: vi.fn(),
}));

vi.mock("@/backend/db", () => ({
  query: mocks.query,
  withTransaction: mocks.withTransaction,
}));

vi.mock("./asaas.central", () => ({
  isAmbiguousAsaasResult: (result: any) => result?.reconciliationRequired === true,
  asaasCentral: {
    isConfigured: mocks.isConfigured,
    refundPayment: mocks.refundPayment,
    mapPaymentStatus: mocks.mapPaymentStatus,
  },
}));

vi.mock("./financial.ledger", () => ({
  createCustomerRefund: mocks.createCustomerRefund,
  findMovement: mocks.findMovement,
  updateMovementStatus: mocks.updateMovementStatus,
  idemKeys: {
    reembolso: (orderId: string) => `REEMBOLSO_ORDER_${orderId}`,
    repasse: (orderId: string) => `REPASSE_ORDER_${orderId}`,
  },
}));

import { handleRefundConfirmed, refundCancelledOrder, retryRefund } from "./refund.service";

const orderId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";

const baseOrder = {
  id: orderId,
  store_id: storeId,
  order_number: 42,
  status: "cancelado",
  payment_method: "pix",
  payment_status: "estorno_pendente",
  transfer_status: "BLOQUEADO",
  refund_status: "NAO_SOLICITADO",
  total: 100,
  refunded_amount: 0,
  payment_external_id: "payment-1",
  payment_asaas_id: "payment-1",
};

type MutableOrder = typeof baseOrder & Record<string, unknown>;

const createHarness = (overrides: Partial<MutableOrder> = {}) => {
  const order: MutableOrder = { ...baseOrder, ...overrides };
  let refundMovement: Record<string, any> | null =
    order.refund_movement_status === null
      ? null
      : {
          status:
            order.refund_movement_status ??
            (order.refund_status === "FALHOU" ? "FALHOU" : null),
          order_id: orderId,
        };
  if (!refundMovement?.status) refundMovement = null;
  const transferMovement = order.transfer_movement_status
    ? { status: order.transfer_movement_status, order_id: orderId }
    : null;

  mocks.findMovement.mockImplementation(async (ref) =>
    String(ref?.idempotencyKey || "").startsWith("REEMBOLSO_")
      ? refundMovement
        ? { ...refundMovement }
        : null
      : transferMovement
        ? { ...transferMovement }
        : null,
  );
  mocks.createCustomerRefund.mockImplementation(async () => {
    if (!refundMovement) refundMovement = { status: "PROCESSANDO", order_id: orderId };
    return { movement: { ...refundMovement }, created: true };
  });
  mocks.updateMovementStatus.mockImplementation(async (ref, patch) => {
    if (!String(ref?.idempotencyKey || "").startsWith("REEMBOLSO_") || !refundMovement) {
      return null;
    }
    refundMovement = {
      ...refundMovement,
      status: patch.status,
      asaas_refund_id: patch.asaasRefundId ?? refundMovement.asaas_refund_id,
    };
    return { ...refundMovement };
  });

  const clientQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("FROM public.orders o") && sql.includes("FOR UPDATE OF o")) {
      return { rows: [{ ...order }] };
    }
    if (sql.includes("SELECT * FROM public.orders WHERE id = $1 FOR UPDATE")) {
      return { rows: [{ ...order }] };
    }
    if (sql.includes("FROM public.payments") && sql.includes("ORDER BY created_at ASC")) {
      return {
        rows: (order.payment_rows as any[]) ?? [
          {
            id: "payment-row-1",
            provider: "asaas-central",
            status: "pago",
            amount: order.total,
            external_id: order.payment_external_id,
            asaas_id: order.payment_asaas_id,
          },
        ],
      };
    }
    if (sql.includes("FROM public.financial_movements") && sql.includes("type = 'ENTRADA_PIX'")) {
      return {
        rows: (order.entry_rows as any[]) ?? [
          { id: "entry-1", status: "CONFIRMADO", amount: order.total },
        ],
      };
    }

    if (sql.includes("SET refund_status = 'PROCESSANDO'")) {
      const compatible =
        order.status === "cancelado" &&
        !["LIBERADO", "PROCESSANDO", "ENVIADO"].includes(String(order.transfer_status)) &&
        !["PROCESSANDO", "ESTORNADO_TOTAL", "ESTORNADO_PARCIAL"].includes(
          String(order.refund_status),
        );
      if (!compatible) return { rows: [] };
      order.refund_status = "PROCESSANDO";
      order.transfer_status = "BLOQUEADO";
      return { rows: [{ id: orderId }] };
    }

    if (sql.includes("SET refund_status = 'ESTORNADO_TOTAL'")) {
      const compatible =
        order.status === "cancelado" &&
        order.refund_status === "PROCESSANDO" &&
        !["LIBERADO", "PROCESSANDO", "ENVIADO"].includes(String(order.transfer_status));
      if (!compatible) return { rows: [] };
      order.refund_status = "ESTORNADO_TOTAL";
      order.payment_status = "estornado";
      order.transfer_status = "CANCELADO";
      order.refunded_amount = Number(params[1]);
      return { rows: [{ id: orderId }] };
    }

    if (sql.includes("SET updated_at = now()") && sql.includes("refund_status = 'PROCESSANDO'")) {
      const compatible =
        order.status === "cancelado" &&
        order.payment_method === "pix" &&
        order.refund_status === "PROCESSANDO" &&
        !["LIBERADO", "PROCESSANDO", "ENVIADO"].includes(String(order.transfer_status));
      return { rows: compatible ? [{ id: orderId }] : [] };
    }

    if (sql.includes("refund_status = $2")) {
      const transferConflict = Boolean(params[5]);
      const compatible = transferConflict
        ? ["PROCESSANDO", "ENVIADO"].includes(String(order.transfer_status))
        : ["NAO_SOLICITADO", "NAO_APLICAVEL", "PENDENTE", "PROCESSANDO", "FALHOU"].includes(
            String(order.refund_status),
          ) && !["PROCESSANDO", "ENVIADO"].includes(String(order.transfer_status));
      if (!compatible) return { rows: [] };
      if (!transferConflict) order.status = "cancelado";
      order.refund_status = String(params[1]);
      order.payment_status = "estornado";
      if (!transferConflict) order.transfer_status = "CANCELADO";
      return { rows: [{ id: orderId }] };
    }

    if (sql.includes("SET refund_status = 'FALHOU'")) {
      if (order.status === "cancelado" && order.refund_status === "PROCESSANDO") {
        order.refund_status = "FALHOU";
        order.transfer_status = "BLOQUEADO";
        return { rows: [{ id: orderId }] };
      }
      return { rows: [] };
    }

    throw new Error(`SQL inesperado no teste de estorno: ${sql}`);
  });

  mocks.withTransaction.mockImplementation(
    async (callback: (client: { query: typeof clientQuery }) => unknown) =>
      callback({ query: clientQuery }),
  );
  mocks.query.mockResolvedValue({ rows: [] });

  return {
    order,
    clientQuery,
    getRefundMovement: () => (refundMovement ? { ...refundMovement } : null),
  };
};

describe("refund financial state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isConfigured.mockReturnValue(true);
    mocks.mapPaymentStatus.mockImplementation((status: string) => status);
    mocks.refundPayment.mockResolvedValue({ id: "refund-1", status: "PROCESSANDO" });
    mocks.createCustomerRefund.mockResolvedValue({});
    mocks.findMovement.mockResolvedValue(null);
    mocks.updateMovementStatus.mockResolvedValue({});
  });

  it("reserva o estorno somente para pedido cancelado e usa o lock financeiro unico", async () => {
    const { order, clientQuery } = createHarness();

    const result = await refundCancelledOrder(orderId, { reason: "Cancelado pela loja" });

    expect(result).toMatchObject({ ok: true, status: "PROCESSANDO", amount: 100 });
    expect(order).toMatchObject({ refund_status: "PROCESSANDO", transfer_status: "BLOQUEADO" });
    const lockCalls = clientQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("pg_advisory_xact_lock"),
    );
    expect(lockCalls.length).toBeGreaterThanOrEqual(2);
    expect(lockCalls.every(([, params]) => params?.[0] === `order-financial:${orderId}`)).toBe(
      true,
    );
  });

  it("faz o CAS final do pedido antes de atualizar o ledger com o refund id", async () => {
    const { clientQuery } = createHarness();

    await refundCancelledOrder(orderId, { reason: "Cancelado" });

    const casIndex = clientQuery.mock.calls.findIndex(
      ([sql]) =>
        String(sql).includes("SET updated_at = now()") &&
        String(sql).includes("refund_status = 'PROCESSANDO'"),
    );
    const ledgerIndex = mocks.updateMovementStatus.mock.calls.findIndex(
      ([, patch]) => patch.asaasRefundId === "refund-1",
    );
    expect(casIndex).toBeGreaterThanOrEqual(0);
    expect(ledgerIndex).toBeGreaterThanOrEqual(0);
    expect(clientQuery.mock.invocationCallOrder[casIndex]).toBeLessThan(
      mocks.updateMovementStatus.mock.invocationCallOrder[ledgerIndex],
    );
  });

  it("promove o hand-off duravel PENDENTE para PROCESSANDO antes de chamar o gateway", async () => {
    const { order } = createHarness({ refund_status: "PENDENTE" });

    const result = await refundCancelledOrder(orderId, { reason: "Pagamento apos cancelamento" });

    expect(result).toMatchObject({ ok: true, status: "PROCESSANDO", amount: 100 });
    expect(order.refund_status).toBe("PROCESSANDO");
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1);
  });

  it("usa Idempotency-Key logica estavel no POST de estorno", async () => {
    createHarness();

    await refundCancelledOrder(orderId, { reason: "Cancelado" });

    expect(mocks.refundPayment).toHaveBeenCalledWith(
      "payment-1",
      100,
      expect.stringContaining("Reembolso pedido #42"),
      { idempotencyKey: `REEMBOLSO_ORDER_${orderId}` },
    );
  });

  it.each([
    ["metodo dinheiro", { payment_method: "dinheiro" }, "metodo_sem_funding_central"],
    [
      "provider da loja",
      {
        payment_rows: [
          {
            id: "payment-row-1",
            provider: "asaas",
            status: "pago",
            amount: 100,
            external_id: "payment-1",
          },
        ],
      },
      "pagamento_nao_pertence_a_conta_central",
    ],
    [
      "status pendente",
      {
        payment_rows: [
          {
            id: "payment-row-1",
            provider: "asaas-central",
            status: "pendente",
            amount: 100,
            external_id: "payment-1",
          },
        ],
      },
      "pagamento_central_nao_confirmado",
    ],
    [
      "id externo vazio",
      {
        payment_rows: [
          {
            id: "payment-row-1",
            provider: "asaas-central",
            status: "pago",
            amount: 100,
            external_id: "   ",
            asaas_id: null,
          },
        ],
      },
      "asaas_payment_id_ausente",
    ],
    [
      "valor do pagamento insuficiente",
      {
        payment_rows: [
          {
            id: "payment-row-1",
            provider: "asaas-central",
            status: "pago",
            amount: 99.99,
            external_id: "payment-1",
          },
        ],
      },
      "pagamento_central_insuficiente",
    ],
    ["nenhum pagamento", { payment_rows: [] }, "pagamento_unico_nao_comprovado"],
    [
      "mais de um pagamento",
      {
        payment_rows: [
          {
            id: "payment-row-1",
            provider: "asaas-central",
            status: "pago",
            amount: 100,
            external_id: "payment-1",
          },
          {
            id: "payment-row-2",
            provider: "asaas-central",
            status: "pago",
            amount: 100,
            external_id: "payment-2",
          },
        ],
      },
      "pagamento_unico_nao_comprovado",
    ],
    ["entrada ausente", { entry_rows: [] }, "entrada_pix_confirmada_insuficiente"],
    [
      "entrada ainda pendente",
      { entry_rows: [{ id: "entry-1", status: "PENDENTE", amount: 100 }] },
      "entrada_pix_confirmada_insuficiente",
    ],
    [
      "entrada confirmada insuficiente",
      { entry_rows: [{ id: "entry-1", status: "CONFIRMADO", amount: 99.99 }] },
      "entrada_pix_confirmada_insuficiente",
    ],
  ])("nao envia POST sem prova central: %s", async (_label, overrides, reason) => {
    createHarness(overrides as Partial<MutableOrder>);

    await expect(refundCancelledOrder(orderId, { reason: "Cancelado" })).resolves.toMatchObject({
      ok: false,
      reason,
    });
    expect(mocks.refundPayment).not.toHaveBeenCalled();
    expect(mocks.createCustomerRefund).not.toHaveBeenCalled();
  });

  it("usa a origem imutavel do pagamento mesmo se financeiro_ativo foi desligado depois", async () => {
    createHarness({ financeiro_ativo: false });

    await expect(refundCancelledOrder(orderId, { reason: "Cancelado" })).resolves.toMatchObject({
      ok: true,
      status: "PROCESSANDO",
    });
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1);
  });

  it("mantem PROCESSANDO quando resposta REFUNDED nao traz id", async () => {
    const { order, getRefundMovement } = createHarness();
    mocks.refundPayment.mockResolvedValue({ status: "REFUNDED" });

    await expect(refundCancelledOrder(orderId, { reason: "Cancelado" })).resolves.toMatchObject({
      ok: false,
      reason: "refund_reconciliation_required",
      reconciliationRequired: true,
    });
    expect(order.refund_status).toBe("PROCESSANDO");
    expect(getRefundMovement()?.status).toBe("PROCESSANDO");
  });

  it.each([
    ["timeout", { timeout: true, failureKind: "timeout" }],
    ["http_503", { status: 503, failureKind: "http_retryable" }],
  ])("mantem PROCESSANDO para resultado ambiguo %s", async (_label, gatewayResult) => {
    const { order } = createHarness();
    mocks.refundPayment.mockResolvedValue({
      ...gatewayResult,
      retryable: true,
      ambiguous: true,
      reconciliationRequired: true,
      errors: [{ description: "mensagem externa nao persistida" }],
    });

    const result = await refundCancelledOrder(orderId, { reason: "Cancelado" });

    expect(result).toMatchObject({
      ok: false,
      reason: "refund_reconciliation_required",
      reconciliationRequired: true,
    });
    expect(order).toMatchObject({ refund_status: "PROCESSANDO", transfer_status: "BLOQUEADO" });
    expect(mocks.updateMovementStatus).toHaveBeenLastCalledWith(
      { idempotencyKey: `REEMBOLSO_ORDER_${orderId}` },
      expect.objectContaining({
        status: "PROCESSANDO",
        failReason: expect.stringContaining("reconciliacao obrigatoria"),
        metadata: expect.objectContaining({ reconciliationRequired: true }),
      }),
      expect.anything(),
    );
    expect(JSON.stringify(mocks.updateMovementStatus.mock.calls)).not.toContain(
      "mensagem externa nao persistida",
    );
  });

  it("nao repete POST de estorno depois de resultado ambiguo", async () => {
    createHarness();
    mocks.refundPayment.mockResolvedValue({
      timeout: true,
      retryable: true,
      ambiguous: true,
      reconciliationRequired: true,
      failureKind: "timeout",
      errors: [{ description: "timeout" }],
    });

    await refundCancelledOrder(orderId, { reason: "Cancelado" });
    await expect(refundCancelledOrder(orderId, { reason: "Retry" })).resolves.toMatchObject({
      ok: false,
      reason: "reembolso_ja_em_andamento",
    });
    expect(mocks.refundPayment).toHaveBeenCalledTimes(1);
  });

  it("retry administrativo rejeita estorno PROCESSANDO sem novo POST", async () => {
    createHarness({
      refund_status: "PROCESSANDO",
      refund_movement_status: "PROCESSANDO",
      transfer_status: "BLOQUEADO",
    });

    await expect(retryRefund(orderId)).resolves.toMatchObject({
      ok: false,
      reason: "ledger_reembolso_ja_em_andamento_ou_confirmado",
    });
    expect(mocks.refundPayment).not.toHaveBeenCalled();
  });

  it("retry administrativo rejeita pedido FALHOU quando o ledger ja esta CONFIRMADO", async () => {
    createHarness({ refund_status: "FALHOU", refund_movement_status: "CONFIRMADO" });

    await expect(retryRefund(orderId)).resolves.toMatchObject({
      ok: false,
      reason: "ledger_reembolso_ja_em_andamento_ou_confirmado",
    });
    expect(mocks.refundPayment).not.toHaveBeenCalled();
  });

  it("permite retry somente depois de falha definitiva e preserva a chave", async () => {
    const { order } = createHarness();
    mocks.refundPayment.mockResolvedValueOnce({
      status: 400,
      retryable: false,
      reconciliationRequired: false,
      errors: [{ description: "Reembolso rejeitado" }],
    });

    await refundCancelledOrder(orderId, { reason: "Cancelado" });
    expect(order.refund_status).toBe("FALHOU");

    mocks.refundPayment.mockResolvedValueOnce({ id: "refund-retry", status: "PROCESSANDO" });

    await expect(retryRefund(orderId)).resolves.toMatchObject({
      ok: true,
      status: "PROCESSANDO",
    });
    expect(mocks.refundPayment).toHaveBeenCalledTimes(2);
    expect(mocks.refundPayment.mock.calls.map((call) => call[3])).toEqual([
      { idempotencyKey: `REEMBOLSO_ORDER_${orderId}` },
      { idempotencyKey: `REEMBOLSO_ORDER_${orderId}` },
    ]);
  });

  it.each([
    ["entregue", "BLOQUEADO", "pedido_nao_cancelado"],
    ["cancelado", "LIBERADO", "repasse_liberado_ou_em_andamento_revisao_manual"],
    ["cancelado", "PROCESSANDO", "repasse_liberado_ou_em_andamento_revisao_manual"],
    ["cancelado", "ENVIADO", "repasse_liberado_ou_em_andamento_revisao_manual"],
  ])("nao chama gateway para estado incompatível %s/%s", async (status, transferStatus, reason) => {
    createHarness({ status, transfer_status: transferStatus });

    await expect(refundCancelledOrder(orderId, { reason: "Cancelado" })).resolves.toMatchObject({
      ok: false,
      reason,
    });
    expect(mocks.refundPayment).not.toHaveBeenCalled();
  });

  it("nao sobrescreve repasse que apareceu enquanto o estorno estava no gateway", async () => {
    const { order } = createHarness();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.refundPayment.mockImplementation(async () => {
      Object.assign(order, {
        transfer_status: "ENVIADO",
        refund_status: "PROCESSANDO",
      });
      return { id: "refund-race", status: "estornado" };
    });

    const result = await refundCancelledOrder(orderId, { reason: "Cancelado" });

    expect(result).toMatchObject({
      ok: false,
      reason: "refund_state_conflict_after_gateway",
      reconciliationRequired: true,
      refundId: "refund-race",
    });
    expect(order).toMatchObject({ transfer_status: "ENVIADO", refund_status: "PROCESSANDO" });
    consoleError.mockRestore();
  });

  it("webhook de estorno usa compare-and-set e nao apaga estado de repasse incompatível", async () => {
    const { order } = createHarness({
      transfer_status: "ENVIADO",
      refund_status: "PROCESSANDO",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await handleRefundConfirmed(
      {
        id: "refund-webhook",
        externalReference: orderId,
        value: 100,
      },
      "event-1",
    );

    expect(result).toMatchObject({ updated: false, stateConflict: true, orderId });
    expect(order).toMatchObject({ transfer_status: "ENVIADO", refund_status: "PROCESSANDO" });
    consoleError.mockRestore();
  });

  it("webhook de estorno posterior ao repasse preserva ENVIADO e sinaliza conflito financeiro", async () => {
    const { order, getRefundMovement } = createHarness({
      transfer_status: "ENVIADO",
      transfer_movement_status: "CONFIRMADO",
      refund_status: "PROCESSANDO",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await handleRefundConfirmed(
      { id: "payment-1", externalReference: orderId, value: 100 },
      "event-refund-after-transfer",
    );

    expect(result).toMatchObject({ updated: true, financialConflict: true, orderId });
    expect(order).toMatchObject({
      transfer_status: "ENVIADO",
      refund_status: "ESTORNADO_TOTAL",
      payment_status: "estornado",
    });
    expect(getRefundMovement()?.status).toBe("CONFIRMADO");
    consoleError.mockRestore();
  });

  it("estorno fora de banda cancela o pedido ainda nao repassado e confirma o ledger", async () => {
    const { order, getRefundMovement } = createHarness({
      status: "em_preparo",
      payment_status: "estornado",
      transfer_status: "BLOQUEADO",
      refund_status: "NAO_SOLICITADO",
      refund_movement_status: null,
    });

    const result = await handleRefundConfirmed(
      { id: "payment-1", externalReference: orderId, value: 100 },
      "event-out-of-band-refund",
    );

    expect(result).toMatchObject({ updated: true, financialConflict: false, orderId });
    expect(order).toMatchObject({
      status: "cancelado",
      payment_status: "estornado",
      transfer_status: "CANCELADO",
      refund_status: "ESTORNADO_TOTAL",
    });
    expect(getRefundMovement()?.status).toBe("CONFIRMADO");
  });

  it("webhook confirmado promove ledger e pedido FALHOU para o estado terminal", async () => {
    const { order, getRefundMovement } = createHarness({
      refund_status: "FALHOU",
      refund_movement_status: "FALHOU",
    });

    const result = await handleRefundConfirmed(
      { id: "payment-1", externalReference: orderId, value: 100 },
      "event-refund-confirmed",
    );

    expect(result).toMatchObject({ updated: true, financialConflict: false, orderId });
    expect(order).toMatchObject({
      refund_status: "ESTORNADO_TOTAL",
      transfer_status: "CANCELADO",
    });
    expect(getRefundMovement()?.status).toBe("CONFIRMADO");
  });
});
