/**
 * RefundService — estorno ao cliente (conta CENTRAL), por cancelamento.
 *
 * Regras criticas:
 *  - So estorna pedido pago e ainda NAO repassado (transfer_status != ENVIADO).
 *  - Nunca repassa pedido com reembolso PENDENTE/PROCESSANDO/FALHOU/ESTORNADO.
 *  - Saldo insuficiente na conta central -> bloqueia e alerta admin.
 *  - Confirmacao final vem do webhook PAYMENT_REFUNDED / PARTIALLY_REFUNDED.
 */

import { withTransaction, query } from "@/backend/db";
import { asaasCentral, isAmbiguousAsaasResult } from "./asaas.central";
import { toCents } from "./financial.calc";
import {
  createCustomerRefund,
  findMovement,
  updateMovementStatus,
  idemKeys,
} from "./financial.ledger";
import {
  REFUND_BLOCKING_STATUSES,
  REFUND_BLOCKING_TRANSFER_STATUSES,
  orderFinancialLockKey,
} from "./order-financial-state";
import { verifyCentralPixFunding } from "./central-funding";

const isInsufficientBalance = (desc: string) =>
  /saldo insuficiente|insufficient balance|insufficient funds/i.test(desc);
const REFUND_RECONCILIATION_REASON =
  "Resultado inconclusivo no gateway; reconciliacao obrigatoria antes de nova tentativa.";

export type RefundOutcome =
  | {
      ok: true;
      status: "PROCESSANDO" | "ESTORNADO_TOTAL";
      refundId?: string | null;
      amount: number;
    }
  | {
      ok: false;
      reason: string;
      insufficientBalance?: boolean;
      reconciliationRequired?: boolean;
      refundId?: string | null;
    };

const loadOrder = async (
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: any[] }> },
  orderId: string,
) => {
  const { rows } = await client.query(
    `SELECT o.*
       FROM public.orders o
      WHERE o.id = $1
      FOR UPDATE OF o`,
    [orderId],
  );
  return rows[0] ?? null;
};

/**
 * Solicita estorno ao cliente para um pedido cancelado/pago. Idempotente.
 * value: valor a estornar (default = total - ja reembolsado = estorno total).
 */
export const refundCancelledOrder = async (
  orderId: string,
  opts: { reason: string; value?: number },
): Promise<RefundOutcome> => {
  // ── 1) RESERVA ──────────────────────────────────────────────────────────
  const reservation = await withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      orderFinancialLockKey(orderId),
    ]);
    const order = await loadOrder(client, orderId);
    if (!order) return { proceed: false as const, reason: "order_not_found" };

    if (order.status !== "cancelado") {
      return { proceed: false as const, reason: "pedido_nao_cancelado" };
    }
    if (REFUND_BLOCKING_TRANSFER_STATUSES.has(String(order.transfer_status))) {
      // LIBERADO/PROCESSANDO can already represent an in-flight external
      // transfer even when the gateway id has not been persisted yet.
      return { proceed: false as const, reason: "repasse_liberado_ou_em_andamento_revisao_manual" };
    }
    // Aceita 'pago' e 'estorno_pendente' (o handler de status marca pix pago
    // cancelado como estorno_pendente antes deste gatilho rodar).
    if (!["pago", "estorno_pendente"].includes(String(order.payment_status))) {
      return { proceed: false as const, reason: "pagamento_nao_confirmado" };
    }
    if (REFUND_BLOCKING_STATUSES.has(String(order.refund_status))) {
      return { proceed: false as const, reason: "reembolso_ja_em_andamento" };
    }

    const totalCents = toCents(order.total);
    const refundedCents = toCents(order.refunded_amount);
    const remainingCents = totalCents - refundedCents;
    const requestedCents = opts.value != null ? toCents(opts.value) : remainingCents;
    if (requestedCents <= 0 || requestedCents > remainingCents) {
      return { proceed: false as const, reason: "valor_estorno_invalido" };
    }
    const value = requestedCents / 100;

    const funding = await verifyCentralPixFunding(client, order, { requiredAmount: value });
    if (!funding.ok) return { proceed: false as const, reason: funding.reason };
    const paymentId = funding.paymentId;

    const existingMovement = await findMovement(
      { idempotencyKey: idemKeys.reembolso(orderId) },
      client,
    );
    if (["PROCESSANDO", "CONFIRMADO"].includes(String(existingMovement?.status))) {
      return { proceed: false as const, reason: "ledger_reembolso_ja_em_andamento_ou_confirmado" };
    }
    if (
      String(order.refund_status) === "FALHOU" &&
      String(existingMovement?.status) !== "FALHOU"
    ) {
      return { proceed: false as const, reason: "ledger_reembolso_incompativel_com_retry" };
    }
    if (
      existingMovement &&
      String(order.refund_status) !== "FALHOU" &&
      !["PENDENTE"].includes(String(existingMovement.status))
    ) {
      return { proceed: false as const, reason: "ledger_reembolso_incompativel" };
    }

    await createCustomerRefund(
      { orderId, storeId: order.store_id, amount: value, asaasPaymentId: paymentId },
      client,
    );
    const processingMovement = await updateMovementStatus(
      { idempotencyKey: idemKeys.reembolso(orderId) },
      { status: "PROCESSANDO" },
      client,
    );
    if (!processingMovement) {
      throw new Error("O ledger financeiro nao permitiu reservar o reembolso.");
    }

    const { rows: reservedRows } = await client.query(
      `UPDATE public.orders
          SET refund_status = 'PROCESSANDO',
              transfer_status = 'BLOQUEADO',
              updated_at = now()
        WHERE id = $1
          AND status = 'cancelado'
          AND payment_method = 'pix'
          AND transfer_status NOT IN ('LIBERADO','PROCESSANDO','ENVIADO')
          AND refund_status NOT IN ('PROCESSANDO','ESTORNADO_TOTAL','ESTORNADO_PARCIAL')
        RETURNING id`,
      [orderId],
    );
    if (!reservedRows[0]) {
      return { proceed: false as const, reason: "estado_financeiro_alterado_antes_do_estorno" };
    }

    return {
      proceed: true as const,
      paymentId: String(paymentId),
      value,
      orderNumber: order.order_number,
    };
  });

  if (!reservation.proceed) return { ok: false, reason: reservation.reason };

  // ── 2) CHAMADA EXTERNA ───────────────────────────────────────────────────
  if (!asaasCentral.isConfigured()) {
    await markRefundFailed(orderId, "ASAAS_API_KEY central nao configurada.", false);
    return { ok: false, reason: "central_key_missing" };
  }

  const refund = await asaasCentral.refundPayment(
    reservation.paymentId,
    reservation.value,
    `Reembolso pedido #${reservation.orderNumber ?? orderId} cancelado pela loja`.slice(0, 200),
    { idempotencyKey: idemKeys.reembolso(orderId) },
  );

  // ── 3) PERSISTE RESULTADO ────────────────────────────────────────────────
  if (isAmbiguousAsaasResult(refund)) {
    await markRefundReconciliationRequired(orderId, refund);
    return {
      ok: false,
      reason: "refund_reconciliation_required",
      reconciliationRequired: true,
    };
  }

  if (refund?.errors) {
    const desc = String(refund.errors[0]?.description || "Falha ao estornar.");
    const insufficient = isInsufficientBalance(desc);
    await markRefundFailed(orderId, desc, insufficient);
    return { ok: false, reason: desc, insufficientBalance: insufficient };
  }

  const refundId = String(refund?.id ?? "").trim() || null;
  if (!refundId) {
    await markRefundReconciliationRequired(orderId, {
      retryable: true,
      ambiguous: true,
      reconciliationRequired: true,
      failureKind: "invalid_response",
    });
    return {
      ok: false,
      reason: "refund_reconciliation_required",
      reconciliationRequired: true,
    };
  }
  const mappedStatus = asaasCentral.mapPaymentStatus(refund?.status);
  const alreadyRefunded = mappedStatus === "estornado";

  const finalized = await withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      orderFinancialLockKey(orderId),
    ]);
    const { rows: orderRows } = await client.query(
      `SELECT * FROM public.orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = orderRows[0];
    if (
      !order ||
      order.status !== "cancelado" ||
      order.payment_method !== "pix" ||
      !["pago", "estorno_pendente"].includes(String(order.payment_status)) ||
      order.refund_status !== "PROCESSANDO" ||
      ["LIBERADO", "PROCESSANDO", "ENVIADO"].includes(String(order.transfer_status))
    ) {
      return false;
    }
    const funding = await verifyCentralPixFunding(client, order, {
      requiredAmount: reservation.value,
      acceptedPaymentStatuses: ["pago", "estornado"],
    });
    if (!funding.ok || funding.paymentId !== reservation.paymentId) return false;
    const movement = await findMovement({ idempotencyKey: idemKeys.reembolso(orderId) }, client);
    if (
      movement?.status !== "PROCESSANDO" ||
      (movement.asaas_refund_id && String(movement.asaas_refund_id) !== refundId)
    ) {
      return false;
    }
    const { rows } = alreadyRefunded
      ? await client.query(
          `UPDATE public.orders
            SET refund_status = 'ESTORNADO_TOTAL',
                payment_status = 'estornado',
                transfer_status = 'CANCELADO',
                refunded_amount = $2,
                refunded_at = COALESCE(refunded_at, now()),
                updated_at = now()
          WHERE id = $1
            AND status = 'cancelado'
            AND payment_method = 'pix'
            AND payment_status IN ('pago','estorno_pendente')
            AND refund_status = 'PROCESSANDO'
            AND transfer_status NOT IN ('LIBERADO','PROCESSANDO','ENVIADO')
          RETURNING id`,
          [orderId, reservation.value],
        )
      : await client.query(
          `UPDATE public.orders
              SET updated_at = now()
            WHERE id = $1
              AND status = 'cancelado'
              AND payment_method = 'pix'
              AND payment_status IN ('pago','estorno_pendente')
              AND refund_status = 'PROCESSANDO'
              AND transfer_status NOT IN ('LIBERADO','PROCESSANDO','ENVIADO')
            RETURNING id`,
          [orderId],
        );
    if (!rows[0]) return false;
    const updatedMovement = await updateMovementStatus(
      { idempotencyKey: idemKeys.reembolso(orderId) },
      {
        status: alreadyRefunded ? "CONFIRMADO" : "PROCESSANDO",
        asaasRefundId: refundId,
        metadata: { asaasStatus: refund?.status ?? null },
      },
      client,
    );
    if (!updatedMovement) {
      throw new Error("O ledger financeiro mudou durante a finalizacao do reembolso.");
    }
    return true;
  });

  if (!finalized) {
    console.error(
      JSON.stringify({
        scope: "refund",
        event: "state_conflict_after_gateway",
        orderId,
        refundId,
        gatewayStatus: refund?.status ?? null,
      }),
    );
    return {
      ok: false,
      reason: "refund_state_conflict_after_gateway",
      reconciliationRequired: true,
      refundId,
    };
  }

  return {
    ok: true,
    status: alreadyRefunded ? "ESTORNADO_TOTAL" : "PROCESSANDO",
    refundId,
    amount: reservation.value,
  };
};

const safeAmbiguousMetadata = (result: any) => {
  const allowedFailureKinds = new Set([
    "timeout",
    "cancelled",
    "network",
    "http_retryable",
    "invalid_response",
  ]);
  const failureKind = allowedFailureKinds.has(String(result?.failureKind))
    ? String(result.failureKind)
    : "ambiguous";
  return {
    reconciliationRequired: true,
    retryable: true,
    failureKind,
    gatewayHttpStatus: Number.isInteger(result?.status) ? Number(result.status) : null,
  };
};

const markRefundReconciliationRequired = async (orderId: string, result: any) => {
  await withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      orderFinancialLockKey(orderId),
    ]);
    const movement = await findMovement({ idempotencyKey: idemKeys.reembolso(orderId) }, client);
    if (movement?.status !== "PROCESSANDO") return;
    await updateMovementStatus(
      { idempotencyKey: idemKeys.reembolso(orderId) },
      {
        status: "PROCESSANDO",
        failReason: REFUND_RECONCILIATION_REASON,
        metadata: safeAmbiguousMetadata(result),
      },
      client,
    );
  });
};

const markRefundFailed = async (orderId: string, reason: string, insufficientBalance: boolean) => {
  await withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      orderFinancialLockKey(orderId),
    ]);
    const movement = await findMovement({ idempotencyKey: idemKeys.reembolso(orderId) }, client);
    if (movement?.status !== "PROCESSANDO") return;
    const { rows } = await client.query(
      `UPDATE public.orders
          SET refund_status = 'FALHOU',
              transfer_status = 'BLOQUEADO',
              updated_at = now()
        WHERE id = $1
          AND status = 'cancelado'
          AND refund_status = 'PROCESSANDO'
          AND transfer_status NOT IN ('LIBERADO','PROCESSANDO','ENVIADO')
        RETURNING id`,
      [orderId],
    );
    if (!rows[0]) return;
    const updatedMovement = await updateMovementStatus(
      { idempotencyKey: idemKeys.reembolso(orderId) },
      { status: "FALHOU", failReason: reason.slice(0, 1000), metadata: { insufficientBalance } },
      client,
    );
    if (!updatedMovement) {
      throw new Error("O ledger financeiro mudou durante a falha do reembolso.");
    }
  }).catch(() => null);
  if (insufficientBalance) {
    console.error(
      JSON.stringify({
        scope: "refund",
        event: "insufficient_balance",
        orderId,
        message:
          "Saldo insuficiente na conta central para estorno. Aumentar saldo Asaas e reprocessar.",
      }),
    );
  }
};

/** Webhook PAYMENT_REFUNDED / PAYMENT_PARTIALLY_REFUNDED. */
export const handleRefundConfirmed = async (
  payment: any,
  eventId?: string | null,
  partial = false,
) => {
  const paymentId = String(payment?.id ?? "").trim();
  if (!paymentId) return { updated: false, reason: "payment_id_ausente" };
  const orderId =
    String(payment?.externalReference || "") ||
    (await (async () => {
      const { rows } = await query(
        `SELECT order_id FROM public.payments WHERE external_id = $1 OR asaas_id = $1 LIMIT 1`,
        [payment?.id],
      );
      return rows[0]?.order_id || "";
    })());
  if (!orderId) return { updated: false, reason: "order_not_found" };

  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      orderFinancialLockKey(orderId),
    ]);
    const refundStatus = partial ? "ESTORNADO_PARCIAL" : "ESTORNADO_TOTAL";
    const refundedValue = Number(payment?.value ?? 0);
    const { rows: orderRows } = await client.query(
      `SELECT * FROM public.orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = orderRows[0];
    if (!order) return { updated: false, reason: "order_not_found" };
    if (
      order.payment_method !== "pix" ||
      !Number.isFinite(refundedValue) ||
      refundedValue <= 0 ||
      toCents(refundedValue) > toCents(order.total)
    ) {
      return { updated: false, reason: "refund_proof_invalid", stateConflict: true, orderId };
    }
    const funding = await verifyCentralPixFunding(client, order, {
      requiredAmount: refundedValue,
      acceptedPaymentStatuses: ["pago", "estornado"],
    });
    if (!funding.ok || funding.paymentId !== paymentId) {
      return { updated: false, reason: "refund_proof_invalid", stateConflict: true, orderId };
    }

    let movement = await findMovement({ idempotencyKey: idemKeys.reembolso(orderId) }, client);
    if (!movement) {
      await createCustomerRefund(
        { orderId, storeId: order.store_id, amount: refundedValue, asaasPaymentId: paymentId },
        client,
      );
      movement = await findMovement({ idempotencyKey: idemKeys.reembolso(orderId) }, client);
    }
    const transferMovement = await findMovement(
      { idempotencyKey: idemKeys.repasse(orderId) },
      client,
    );
    const transferConflict =
      ["PROCESSANDO", "ENVIADO"].includes(String(order.transfer_status)) ||
      ["PROCESSANDO", "CONFIRMADO"].includes(String(transferMovement?.status));
    const duplicate =
      movement?.status === "CONFIRMADO" &&
      ["ESTORNADO_TOTAL", "ESTORNADO_PARCIAL"].includes(String(order.refund_status));
    if (duplicate) {
      await updateMovementStatus(
        { idempotencyKey: idemKeys.reembolso(orderId) },
        {
          status: "CONFIRMADO",
          asaasEventId: eventId ?? null,
          asaasRefundId: paymentId,
        },
        client,
      );
      return { updated: true, duplicate: true, financialConflict: transferConflict, orderId };
    }
    if (!movement || !["PENDENTE", "PROCESSANDO", "FALHOU"].includes(String(movement.status))) {
      return { updated: false, reason: "refund_ledger_conflict", stateConflict: true, orderId };
    }

    const { rows } = await client.query(
      `UPDATE public.orders
          SET status = CASE WHEN $6 THEN status ELSE 'cancelado' END,
              cancelled_at = CASE WHEN $6 THEN cancelled_at ELSE COALESCE(cancelled_at, now()) END,
              cancel_reason = CASE WHEN $6 THEN cancel_reason ELSE COALESCE(cancel_reason, 'Estorno confirmado fora do fluxo normal') END,
              refund_status = $2,
              payment_status = 'estornado',
              transfer_status = CASE WHEN $6 THEN transfer_status ELSE 'CANCELADO' END,
              refunded_amount = CASE WHEN $4 = true THEN COALESCE(refunded_amount,0) + $3 ELSE GREATEST(COALESCE(refunded_amount,0), $3) END,
              refunded_at = COALESCE(refunded_at, now()),
              asaas_event_id_ultimo = COALESCE($5, asaas_event_id_ultimo),
              updated_at = now()
        WHERE id = $1
          AND payment_method = 'pix'
          AND payment_status IN ('pago','estorno_pendente','estornado')
          AND (
            ($6 = false AND refund_status IN ('NAO_SOLICITADO','NAO_APLICAVEL','PENDENTE','PROCESSANDO','FALHOU')
              AND transfer_status NOT IN ('PROCESSANDO','ENVIADO'))
            OR ($6 = true AND transfer_status IN ('PROCESSANDO','ENVIADO'))
          )
        RETURNING id`,
      [orderId, refundStatus, refundedValue, partial, eventId ?? null, transferConflict],
    );
    if (!rows[0]) {
      console.error(
        JSON.stringify({
          scope: "refund",
          event: "webhook_state_conflict",
          orderId,
          refundId: paymentId,
        }),
      );
      return { updated: false, stateConflict: true, orderId };
    }
    const updatedMovement = await updateMovementStatus(
      { idempotencyKey: idemKeys.reembolso(orderId) },
      {
        status: "CONFIRMADO",
        asaasEventId: eventId ?? null,
        asaasRefundId: paymentId,
      },
      client,
    );
    if (!updatedMovement) {
      throw new Error("O ledger financeiro mudou durante o webhook de reembolso.");
    }
    if (transferConflict) {
      console.error(
        JSON.stringify({
          scope: "refund",
          event: "refund_after_transfer_sent",
          orderId,
          paymentId,
        }),
      );
    }
    return {
      updated: true,
      stateConflict: false,
      financialConflict: transferConflict,
      orderId,
    };
  });
};

/** Reprocessa reembolso FALHOU (acao administrativa). */
export const retryRefund = async (orderId: string): Promise<RefundOutcome> => {
  const eligibility = await withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      orderFinancialLockKey(orderId),
    ]);
    const { rows } = await client.query(
      `SELECT * FROM public.orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = rows[0];
    if (!order) return { ok: false as const, reason: "order_not_found" };
    const movement = await findMovement({ idempotencyKey: idemKeys.reembolso(orderId) }, client);
    if (["PROCESSANDO", "CONFIRMADO"].includes(String(movement?.status))) {
      return { ok: false as const, reason: "ledger_reembolso_ja_em_andamento_ou_confirmado" };
    }
    if (order.refund_status !== "FALHOU") {
      return { ok: false as const, reason: "reembolso_nao_esta_falho" };
    }
    if (movement?.status !== "FALHOU") {
      return { ok: false as const, reason: "ledger_reembolso_nao_esta_falho" };
    }
    if (order.transfer_status === "ENVIADO") {
      return { ok: false as const, reason: "repasse_ja_enviado_revisao_manual" };
    }
    return {
      ok: true as const,
      reason: String(order.cancel_reason || "Reprocessamento de estorno"),
    };
  });
  if (!eligibility.ok) return { ok: false, reason: eligibility.reason };
  return refundCancelledOrder(orderId, { reason: eligibility.reason });
};
