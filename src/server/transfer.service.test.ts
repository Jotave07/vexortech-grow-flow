import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
  isConfigured: vi.fn(() => true),
  createPixTransfer: vi.fn(),
  mapTransferStatus: vi.fn((status: string) => status),
  normalizePixKeyType: vi.fn((value: string) => value),
  createMerchantTransfer: vi.fn(),
  updateMovementStatus: vi.fn(),
  findMovement: vi.fn(),
}));

vi.mock("@/backend/db", () => ({
  query: mocks.query,
  withTransaction: mocks.withTransaction,
}));

vi.mock("./asaas.central", () => ({
  isAmbiguousAsaasResult: (result: any) => result?.reconciliationRequired === true,
  asaasCentral: {
    isConfigured: mocks.isConfigured,
    createPixTransfer: mocks.createPixTransfer,
    mapTransferStatus: mocks.mapTransferStatus,
  },
  normalizePixKeyType: mocks.normalizePixKeyType,
}));

vi.mock("./financial.ledger", () => ({
  createMerchantTransfer: mocks.createMerchantTransfer,
  updateMovementStatus: mocks.updateMovementStatus,
  findMovement: mocks.findMovement,
  idemKeys: { repasse: (orderId: string) => `REPASSE_ORDER_${orderId}` },
}));

import {
  handleTransferDone,
  handleTransferFailed,
  releaseTransferForDeliveredOrder,
  retryTransfer,
} from "./transfer.service";

const orderId = "11111111-1111-4111-8111-111111111111";
const storeId = "22222222-2222-4222-8222-222222222222";

const baseOrder = {
  id: orderId,
  store_id: storeId,
  order_number: 42,
  status: "entregue",
  payment_status: "pago",
  payment_method: "pix",
  transfer_status: "AGUARDANDO_ENTREGA",
  refund_status: "NAO_SOLICITADO",
  total: 100,
  refunded_amount: 0,
  financeiro_ativo: true,
  pix_key: "11999999999",
  pix_key_type: "PHONE",
  taxa_percentual_plataforma: 10,
  taxa_fixa_plataforma: 0,
  central_payment_confirmed: true,
  central_funded_amount: 100,
  store_public_name: "Loja teste",
};

type MutableOrder = typeof baseOrder & Record<string, unknown>;

const createHarness = (overrides: Partial<MutableOrder> = {}) => {
  const order: MutableOrder = { ...baseOrder, ...overrides };
  let movement: Record<string, any> | null =
    order.transfer_movement_status === null
      ? null
      : {
          status:
            order.transfer_movement_status ??
            (order.transfer_status === "FALHOU" ? "FALHOU" : null),
          order_id: orderId,
          metadata_json: { attempt: 1 },
        };
  if (!movement?.status) movement = null;

  mocks.findMovement.mockImplementation(async () => (movement ? { ...movement } : null));
  mocks.createMerchantTransfer.mockImplementation(async () => {
    if (!movement) {
      movement = { status: "PROCESSANDO", order_id: orderId, metadata_json: { attempt: 1 } };
    }
    return { movement: { ...movement }, created: true };
  });
  mocks.updateMovementStatus.mockImplementation(async (_ref, patch) => {
    if (!movement) return null;
    movement = {
      ...movement,
      status: patch.status,
      asaas_transfer_id: patch.asaasTransferId ?? movement.asaas_transfer_id,
      metadata_json: patch.metadata ?? movement.metadata_json,
    };
    return { ...movement };
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
            external_id: "payment-1",
            asaas_id: "payment-1",
          },
        ],
      };
    }
    if (sql.includes("FROM public.financial_movements") && sql.includes("type = 'ENTRADA_PIX'")) {
      return {
        rows: (order.entry_rows as any[]) ?? [
          { id: "entry-1", status: "CONFIRMADO", amount: order.central_funded_amount },
        ],
      };
    }

    if (sql.includes("SET transfer_status = 'PROCESSANDO'")) {
      const compatible =
        order.status === "entregue" &&
        order.payment_status === "pago" &&
        ["NAO_LIBERADO", "AGUARDANDO_ENTREGA", "LIBERADO", "FALHOU"].includes(
          String(order.transfer_status),
        ) &&
        !["PENDENTE", "PROCESSANDO", "ESTORNADO_TOTAL", "ESTORNADO_PARCIAL", "FALHOU"].includes(
          String(order.refund_status),
        );
      if (!compatible) return { rows: [] };
      order.transfer_status = "PROCESSANDO";
      order.transfer_amount = params[1];
      order.platform_fee_amount = params[2];
      return { rows: [{ id: orderId }] };
    }

    if (sql.includes("SET asaas_transfer_id")) {
      const compatible =
        order.status === "entregue" &&
        order.transfer_status === "PROCESSANDO" &&
        !["PENDENTE", "PROCESSANDO", "ESTORNADO_TOTAL", "ESTORNADO_PARCIAL", "FALHOU"].includes(
          String(order.refund_status),
        );
      if (!compatible) return { rows: [] };
      order.asaas_transfer_id = params[1];
      order.transfer_status = String(params[2]);
      return { rows: [{ id: orderId }] };
    }

    if (sql.includes("SET transfer_status = 'ENVIADO'")) {
      const compatible =
        order.status === "entregue" &&
        order.payment_status === "pago" &&
        order.payment_method === "pix" &&
        ["PROCESSANDO", "FALHOU"].includes(String(order.transfer_status)) &&
        !["PENDENTE", "PROCESSANDO", "ESTORNADO_TOTAL", "ESTORNADO_PARCIAL", "FALHOU"].includes(
          String(order.refund_status),
        );
      if (!compatible) return { rows: [] };
      order.transfer_status = "ENVIADO";
      order.asaas_transfer_id = params[1];
      return { rows: [{ id: orderId }] };
    }

    if (sql.includes("SET transfer_status = $2")) {
      const compatible =
        order.status === "entregue" &&
        order.transfer_status === "PROCESSANDO" &&
        !["PENDENTE", "PROCESSANDO", "ESTORNADO_TOTAL", "ESTORNADO_PARCIAL", "FALHOU"].includes(
          String(order.refund_status),
        );
      if (!compatible) return { rows: [] };
      order.transfer_status = String(params[1]);
      return { rows: [{ id: orderId }] };
    }

    if (sql.includes("SET transfer_status = 'FALHOU'")) {
      if (order.status === "entregue" && order.transfer_status === "PROCESSANDO") {
        order.transfer_status = "FALHOU";
        return { rows: [{ id: orderId }] };
      }
      return { rows: [] };
    }

    if (sql.includes("SET transfer_status = 'BLOQUEADO'")) {
      if (
        ["NAO_LIBERADO", "AGUARDANDO_ENTREGA", "LIBERADO", "FALHOU"].includes(
          String(order.transfer_status),
        )
      ) {
        order.transfer_status = "BLOQUEADO";
      }
      return { rows: [] };
    }

    throw new Error(`SQL inesperado no teste de repasse: ${sql}`);
  });

  mocks.withTransaction.mockImplementation(
    async (callback: (client: { query: typeof clientQuery }) => unknown) =>
      callback({ query: clientQuery }),
  );
  mocks.query.mockResolvedValue({ rows: [] });

  return { order, clientQuery, getMovement: () => (movement ? { ...movement } : null) };
};

describe("transfer financial state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isConfigured.mockReturnValue(true);
    mocks.mapTransferStatus.mockImplementation((status: string) => status);
    mocks.createPixTransfer.mockResolvedValue({ id: "transfer-1", status: "PROCESSANDO" });
    mocks.findMovement.mockResolvedValue(null);
    mocks.createMerchantTransfer.mockResolvedValue({});
    mocks.updateMovementStatus.mockResolvedValue({});
  });

  it("reserva PROCESSANDO com o lock financeiro unico antes de chamar o gateway", async () => {
    const { order, clientQuery } = createHarness();

    const result = await releaseTransferForDeliveredOrder(orderId);

    expect(result).toMatchObject({ ok: true, status: "PROCESSANDO", amount: 90 });
    expect(order.transfer_status).toBe("PROCESSANDO");
    expect(mocks.createPixTransfer).toHaveBeenCalledTimes(1);
    const fundingQuery = clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes("central_payment_confirmed"),
    );
    expect(fundingQuery?.[0]).toContain("p.provider = 'asaas-central'");
    expect(fundingQuery?.[0]).toContain("fm.type = 'ENTRADA_PIX'");
    expect(fundingQuery?.[0]).toContain("fm.status = 'CONFIRMADO'");
    const lockCalls = clientQuery.mock.calls.filter(([sql]) =>
      String(sql).includes("pg_advisory_xact_lock"),
    );
    expect(lockCalls.length).toBeGreaterThanOrEqual(2);
    expect(lockCalls.every(([, params]) => params?.[0] === `order-financial:${orderId}`)).toBe(
      true,
    );
  });

  it("faz o CAS final do pedido antes de promover o ledger", async () => {
    const { clientQuery } = createHarness();

    await releaseTransferForDeliveredOrder(orderId);

    const casIndex = clientQuery.mock.calls.findIndex(([sql]) =>
      String(sql).includes("SET asaas_transfer_id"),
    );
    const ledgerIndex = mocks.updateMovementStatus.mock.calls.findIndex(
      ([, patch]) => patch.asaasTransferId === "transfer-1",
    );
    expect(casIndex).toBeGreaterThanOrEqual(0);
    expect(ledgerIndex).toBeGreaterThanOrEqual(0);
    expect(clientQuery.mock.invocationCallOrder[casIndex]).toBeLessThan(
      mocks.updateMovementStatus.mock.invocationCallOrder[ledgerIndex],
    );
  });

  it.each(["dinheiro", "cartao_credito_entrega", "cartao_debito_entrega"])(
    "bloqueia repasse de pedido %s sem funding central",
    async (paymentMethod) => {
      const { order } = createHarness({ payment_method: paymentMethod });

      await expect(releaseTransferForDeliveredOrder(orderId)).resolves.toMatchObject({
        ok: false,
        reason: "repasse_sem_funding_central",
        blocked: true,
      });
      expect(order.transfer_status).toBe("BLOQUEADO");
      expect(mocks.createPixTransfer).not.toHaveBeenCalled();
    },
  );

  it("bloqueia PIX sem pagamento Asaas central confirmado", async () => {
    const { order } = createHarness({ central_payment_confirmed: false });

    await expect(releaseTransferForDeliveredOrder(orderId)).resolves.toMatchObject({
      ok: false,
      reason: "pagamento_central_nao_comprovado",
      blocked: true,
    });
    expect(order.transfer_status).toBe("BLOQUEADO");
    expect(mocks.createPixTransfer).not.toHaveBeenCalled();
  });

  it("bloqueia PIX sem ENTRADA_PIX CONFIRMADO cobrindo o pedido", async () => {
    const { order } = createHarness({ central_funded_amount: 99.99 });

    await expect(releaseTransferForDeliveredOrder(orderId)).resolves.toMatchObject({
      ok: false,
      reason: "entrada_pix_confirmada_insuficiente",
      blocked: true,
    });
    expect(order.transfer_status).toBe("BLOQUEADO");
    expect(mocks.createPixTransfer).not.toHaveBeenCalled();
  });

  it.each([
    ["timeout", { timeout: true, failureKind: "timeout" }],
    ["http_503", { status: 503, failureKind: "http_retryable" }],
  ])("mantem PROCESSANDO para resultado ambiguo %s", async (_label, gatewayResult) => {
    const { order } = createHarness();
    mocks.createPixTransfer.mockResolvedValue({
      ...gatewayResult,
      retryable: true,
      ambiguous: true,
      reconciliationRequired: true,
      errors: [{ description: "mensagem externa nao persistida" }],
    });

    const result = await releaseTransferForDeliveredOrder(orderId);

    expect(result).toMatchObject({
      ok: false,
      reason: "transfer_reconciliation_required",
      status: "PROCESSANDO",
      reconciliationRequired: true,
    });
    expect(order.transfer_status).toBe("PROCESSANDO");
    expect(mocks.updateMovementStatus).toHaveBeenLastCalledWith(
      { idempotencyKey: `REPASSE_ORDER_${orderId}` },
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

  it("mantem PROCESSANDO quando resposta DONE nao traz id", async () => {
    const { order, getMovement } = createHarness();
    mocks.createPixTransfer.mockResolvedValue({ status: "DONE" });

    await expect(releaseTransferForDeliveredOrder(orderId)).resolves.toMatchObject({
      ok: false,
      reason: "transfer_reconciliation_required",
      status: "PROCESSANDO",
      reconciliationRequired: true,
    });
    expect(order.transfer_status).toBe("PROCESSANDO");
    expect(getMovement()?.status).toBe("PROCESSANDO");
  });

  it("nao repete POST depois de resultado ambiguo", async () => {
    createHarness();
    mocks.createPixTransfer.mockResolvedValue({
      timeout: true,
      retryable: true,
      ambiguous: true,
      reconciliationRequired: true,
      failureKind: "timeout",
      errors: [{ description: "timeout" }],
    });

    await releaseTransferForDeliveredOrder(orderId);
    await expect(releaseTransferForDeliveredOrder(orderId)).resolves.toMatchObject({
      ok: false,
      reason: "repasse_ja_em_andamento_ou_enviado",
    });
    expect(mocks.createPixTransfer).toHaveBeenCalledTimes(1);
  });

  it("mantem a mesma Idempotency-Key em tentativa posterior a falha definitiva", async () => {
    createHarness({ transfer_status: "FALHOU" });

    await releaseTransferForDeliveredOrder(orderId, { attempt: 2 });

    expect(mocks.createPixTransfer).toHaveBeenCalledWith(expect.anything(), {
      idempotencyKey: `REPASSE_ORDER_${orderId}`,
    });
  });

  it("liberacao manual aceita somente o estado LIBERADO sob o lock", async () => {
    createHarness({ transfer_status: "AGUARDANDO_ENTREGA" });

    await expect(
      releaseTransferForDeliveredOrder(orderId, { requiredTransferStatus: "LIBERADO" }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "repasse_manual_requer_status_liberado",
    });
    expect(mocks.createPixTransfer).not.toHaveBeenCalled();
  });

  it("liberacao manual inicia repasse funded quando o estado e LIBERADO", async () => {
    createHarness({ transfer_status: "LIBERADO" });

    await expect(
      releaseTransferForDeliveredOrder(orderId, { requiredTransferStatus: "LIBERADO" }),
    ).resolves.toMatchObject({ ok: true, status: "PROCESSANDO" });
    expect(mocks.createPixTransfer).toHaveBeenCalledTimes(1);
  });

  it("retry administrativo rejeita movimento ainda PROCESSANDO sem novo POST", async () => {
    createHarness({
      transfer_status: "PROCESSANDO",
      transfer_movement_status: "PROCESSANDO",
    });

    await expect(retryTransfer(orderId)).resolves.toMatchObject({
      ok: false,
      reason: "ledger_repasse_ja_em_andamento_ou_confirmado",
    });
    expect(mocks.createPixTransfer).not.toHaveBeenCalled();
  });

  it("retry administrativo rejeita pedido FALHOU quando o ledger ja esta CONFIRMADO", async () => {
    createHarness({ transfer_status: "FALHOU", transfer_movement_status: "CONFIRMADO" });

    await expect(retryTransfer(orderId)).resolves.toMatchObject({
      ok: false,
      reason: "ledger_repasse_ja_em_andamento_ou_confirmado",
    });
    expect(mocks.createPixTransfer).not.toHaveBeenCalled();
  });

  it("permite retry somente depois de falha definitiva e preserva a chave", async () => {
    const { order } = createHarness();
    mocks.createPixTransfer.mockResolvedValueOnce({
      status: 400,
      retryable: false,
      reconciliationRequired: false,
      errors: [{ description: "Chave PIX invalida" }],
    });

    await releaseTransferForDeliveredOrder(orderId);
    expect(order.transfer_status).toBe("FALHOU");

    mocks.createPixTransfer.mockResolvedValueOnce({ id: "transfer-retry", status: "PROCESSANDO" });

    await expect(retryTransfer(orderId)).resolves.toMatchObject({
      ok: true,
      status: "PROCESSANDO",
    });
    expect(mocks.createPixTransfer).toHaveBeenCalledTimes(2);
    expect(mocks.createPixTransfer.mock.calls.map(([, options]) => options)).toEqual([
      { idempotencyKey: `REPASSE_ORDER_${orderId}` },
      { idempotencyKey: `REPASSE_ORDER_${orderId}` },
    ]);
  });

  it("nao sobrescreve cancelamento/estorno que apareceu enquanto o gateway estava em voo", async () => {
    const { order } = createHarness();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createPixTransfer.mockImplementation(async () => {
      Object.assign(order, {
        status: "cancelado",
        transfer_status: "BLOQUEADO",
        refund_status: "PROCESSANDO",
      });
      return { id: "transfer-race", status: "ENVIADO" };
    });

    const result = await releaseTransferForDeliveredOrder(orderId);

    expect(result).toMatchObject({
      ok: false,
      reason: "transfer_state_conflict_after_gateway",
      reconciliationRequired: true,
      transferId: "transfer-race",
    });
    expect(order).toMatchObject({
      status: "cancelado",
      transfer_status: "BLOQUEADO",
      refund_status: "PROCESSANDO",
    });
    consoleError.mockRestore();
  });

  it("webhook de transferencia concluida usa compare-and-set e preserva estado incompatível", async () => {
    const { order } = createHarness({
      status: "cancelado",
      transfer_status: "BLOQUEADO",
      refund_status: "PROCESSANDO",
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await handleTransferDone(
      {
        id: "transfer-webhook",
        externalReference: `TRANSFER_ORDER_${orderId}`,
      },
      "event-1",
    );

    expect(result).toMatchObject({ updated: false, stateConflict: true, orderId });
    expect(order).toMatchObject({
      status: "cancelado",
      transfer_status: "BLOQUEADO",
      refund_status: "PROCESSANDO",
    });
    consoleError.mockRestore();
  });

  it("webhook de falha nao reabre repasse de pedido em estorno", async () => {
    const { order } = createHarness({
      status: "cancelado",
      transfer_status: "BLOQUEADO",
      refund_status: "PROCESSANDO",
    });

    const result = await handleTransferFailed(
      {
        id: "transfer-webhook",
        externalReference: `TRANSFER_ORDER_${orderId}`,
        failReason: "falha externa",
      },
      "event-2",
    );

    expect(result).toMatchObject({ updated: false, stateConflict: true, orderId });
    expect(order.transfer_status).toBe("BLOQUEADO");
  });

  it("TRANSFER_DONE seguido de falha tardia nunca rebaixa pedido nem ledger CONFIRMADO", async () => {
    const { order, getMovement } = createHarness({
      transfer_status: "PROCESSANDO",
      transfer_movement_status: "PROCESSANDO",
    });

    await expect(
      handleTransferDone(
        { id: "transfer-ordered", externalReference: `TRANSFER_ORDER_${orderId}` },
        "event-done",
      ),
    ).resolves.toMatchObject({ updated: true, duplicate: false });
    await expect(
      handleTransferFailed(
        {
          id: "transfer-ordered",
          externalReference: `TRANSFER_ORDER_${orderId}`,
          failReason: "evento antigo",
        },
        "event-failed-late",
      ),
    ).resolves.toMatchObject({
      updated: false,
      stateConflict: true,
      reason: "repasse_confirmado_nao_pode_ser_rebaixado",
    });
    expect(order.transfer_status).toBe("ENVIADO");
    expect(getMovement()?.status).toBe("CONFIRMADO");
  });

  it("TRANSFER_DONE posterior promove com seguranca um FAILED recebido antes", async () => {
    const { order, getMovement } = createHarness({
      transfer_status: "PROCESSANDO",
      transfer_movement_status: "PROCESSANDO",
    });

    await expect(
      handleTransferFailed(
        {
          id: "transfer-reordered",
          externalReference: `TRANSFER_ORDER_${orderId}`,
          failReason: "falha temporaria",
        },
        "event-failed-first",
      ),
    ).resolves.toMatchObject({ updated: true });
    expect(order.transfer_status).toBe("FALHOU");
    expect(getMovement()?.status).toBe("FALHOU");

    await expect(
      handleTransferDone(
        { id: "transfer-reordered", externalReference: `TRANSFER_ORDER_${orderId}` },
        "event-done-later",
      ),
    ).resolves.toMatchObject({ updated: true, duplicate: false });
    expect(order.transfer_status).toBe("ENVIADO");
    expect(getMovement()?.status).toBe("CONFIRMADO");
  });

  it("TRANSFER_DONE recusa chargeback/refund que surgiu antes do CAS final", async () => {
    const { order, getMovement } = createHarness({
      payment_status: "estornado",
      refund_status: "FALHOU",
      transfer_status: "PROCESSANDO",
      transfer_movement_status: "PROCESSANDO",
    });

    await expect(
      handleTransferDone(
        { id: "transfer-after-chargeback", externalReference: `TRANSFER_ORDER_${orderId}` },
        "event-done-after-chargeback",
      ),
    ).resolves.toMatchObject({ updated: false, stateConflict: true });
    expect(order.transfer_status).toBe("PROCESSANDO");
    expect(getMovement()?.status).toBe("PROCESSANDO");
  });
});
