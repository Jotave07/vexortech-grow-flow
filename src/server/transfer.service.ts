/**
 * TransferService — repasse (transfer PIX) ao lojista, na conta CENTRAL.
 *
 * Gatilho: pedido ENTREGUE (status='entregue') com pagamento 'pago'.
 * Regra: paga libera producao; entregue libera repasse.
 *
 * Padrao de seguranca (igual ao createOrderPaymentForOrder):
 *   1) RESERVA em transacao (advisory lock + movimento PROCESSANDO + order PROCESSANDO)
 *   2) chama o Asaas FORA da transacao (nao segura lock durante I/O externo)
 *   3) persiste asaas_transfer_id; status final vem do webhook TRANSFER_DONE.
 */

import { withTransaction, query } from "@/backend/db";
import {
  asaasCentral,
  isAmbiguousAsaasResult,
  normalizePixKeyType,
} from "./asaas.central";
import { calcularValorRepasse, toCents } from "./financial.calc";
import {
  createMerchantTransfer,
  updateMovementStatus,
  findMovement,
  idemKeys,
} from "./financial.ledger";
import { orderFinancialLockKey } from "./order-financial-state";
import { verifyCentralPixFunding } from "./central-funding";

const RELEASABLE = new Set(["NAO_LIBERADO", "AGUARDANDO_ENTREGA", "LIBERADO", "FALHOU"]);
const REFUND_BLOCKS = new Set([
  "PENDENTE",
  "PROCESSANDO",
  "ESTORNADO_TOTAL",
  "ESTORNADO_PARCIAL",
  "FALHOU",
]);
const TRANSFER_RECONCILIATION_REASON =
  "Resultado inconclusivo no gateway; reconciliacao obrigatoria antes de nova tentativa.";

export type TransferOutcome =
  | { ok: true; status: "PROCESSANDO" | "ENVIADO"; transferId?: string | null; amount: number }
  | {
      ok: false;
      reason: string;
      status?: string;
      blocked?: boolean;
      reconciliationRequired?: boolean;
      transferId?: string | null;
    };

type OrderRow = Record<string, any>;

const loadOrder = async (
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: any[] }> },
  orderId: string,
): Promise<OrderRow | null> => {
  const { rows } = await client.query(
    `SELECT o.*,
            ss.financeiro_ativo, ss.repasse_automatico, ss.repasse_momento,
            ss.pix_key, ss.pix_key_type,
            ss.taxa_percentual_plataforma, ss.taxa_fixa_plataforma,
            EXISTS (
              SELECT 1
                FROM public.payments p
               WHERE p.order_id = o.id
                 AND p.provider = 'asaas-central'
                 AND p.status = 'pago'
                 AND p.amount >= o.total
                 AND COALESCE(NULLIF(p.external_id, ''), NULLIF(p.asaas_id, '')) IS NOT NULL
            ) AS central_payment_confirmed,
            COALESCE((
              SELECT SUM(fm.amount)
                FROM public.financial_movements fm
               WHERE fm.order_id = o.id
                 AND fm.type = 'ENTRADA_PIX'
                 AND fm.status = 'CONFIRMADO'
            ), 0) AS central_funded_amount,
            s.public_name AS store_public_name, s.name AS store_name
       FROM public.orders o
       JOIN public.store_settings ss ON ss.store_id = o.store_id
       JOIN public.stores s ON s.id = o.store_id
      WHERE o.id = $1
      FOR UPDATE OF o`,
    [orderId],
  );
  return rows[0] ?? null;
};

/** Valida pre-condicoes de repasse. Retorna motivo se nao puder repassar. */
const validateRelease = (
  order: OrderRow,
): { ok: true; pixKeyType: string } | { ok: false; reason: string; blocked?: boolean } => {
  if (!order) return { ok: false, reason: "order_not_found" };
  if (!order.financeiro_ativo) return { ok: false, reason: "financeiro_inativo" };
  if (order.payment_status !== "pago") return { ok: false, reason: "pagamento_nao_confirmado" };
  if (order.status !== "entregue") return { ok: false, reason: "pedido_nao_entregue" };
  if (order.status === "cancelado") return { ok: false, reason: "pedido_cancelado" };
  if (order.payment_method !== "pix") {
    return { ok: false, reason: "repasse_sem_funding_central", blocked: true };
  }
  if (order.central_payment_confirmed !== true) {
    return { ok: false, reason: "pagamento_central_nao_comprovado", blocked: true };
  }
  if (toCents(order.central_funded_amount) < toCents(order.total)) {
    return { ok: false, reason: "entrada_pix_confirmada_insuficiente", blocked: true };
  }
  if (REFUND_BLOCKS.has(String(order.refund_status)))
    return { ok: false, reason: "reembolso_em_andamento", blocked: true };
  if (!RELEASABLE.has(String(order.transfer_status))) {
    // PROCESSANDO ou ENVIADO -> aborta sem erro (idempotente)
    return { ok: false, reason: "repasse_ja_em_andamento_ou_enviado" };
  }
  if (!order.pix_key) return { ok: false, reason: "pix_key_ausente", blocked: true };
  const pixKeyType = normalizePixKeyType(order.pix_key_type);
  if (!pixKeyType) return { ok: false, reason: "pix_key_type_invalido", blocked: true };
  return { ok: true, pixKeyType };
};

const transferDescription = (order: OrderRow) =>
  `Repasse pedido #${order.order_number ?? order.id} - ${order.store_public_name || order.store_name || "Loja"}`.slice(
    0,
    200,
  );

/**
 * Libera o repasse de um pedido entregue. Idempotente e seguro para concorrencia.
 * attempt: metadado de auditoria para nova tentativa apos falha definitiva.
 * A Idempotency-Key externa permanece estavel durante toda a vida do pedido.
 */
export const releaseTransferForDeliveredOrder = async (
  orderId: string,
  opts: { attempt?: number; requiredTransferStatus?: "LIBERADO" } = {},
): Promise<TransferOutcome> => {
  // ── 1) RESERVA ──────────────────────────────────────────────────────────
  const reservation = await withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      orderFinancialLockKey(orderId),
    ]);
    const order = await loadOrder(client, orderId);
    if (
      opts.requiredTransferStatus &&
      String(order?.transfer_status) !== opts.requiredTransferStatus
    ) {
      return {
        proceed: false as const,
        reason: "repasse_manual_requer_status_liberado",
        blocked: false,
      };
    }
    const check = validateRelease(order as OrderRow);
    if (!check.ok) {
      if (check.blocked) {
        await client.query(
          `UPDATE public.orders
           SET transfer_status = 'BLOQUEADO', updated_at = now()
           WHERE id = $1
             AND transfer_status IN ('NAO_LIBERADO','AGUARDANDO_ENTREGA','LIBERADO','FALHOU')`,
          [orderId],
        );
      }
      return { proceed: false as const, reason: check.reason, blocked: check.blocked };
    }

    const existingMovement = await findMovement(
      { idempotencyKey: idemKeys.repasse(orderId) },
      client,
    );
    if (["PROCESSANDO", "CONFIRMADO"].includes(String(existingMovement?.status))) {
      return {
        proceed: false as const,
        reason: "ledger_repasse_ja_em_andamento_ou_confirmado",
        blocked: false,
      };
    }
    if (
      String(order!.transfer_status) === "FALHOU" &&
      String(existingMovement?.status) !== "FALHOU"
    ) {
      return {
        proceed: false as const,
        reason: "ledger_repasse_incompativel_com_retry",
        blocked: false,
      };
    }
    if (
      existingMovement &&
      String(order!.transfer_status) !== "FALHOU" &&
      !["PENDENTE"].includes(String(existingMovement.status))
    ) {
      return {
        proceed: false as const,
        reason: "ledger_repasse_incompativel",
        blocked: false,
      };
    }

    const calc = calcularValorRepasse({
      totalPaid: order!.total,
      refundedAmount: order!.refunded_amount,
      taxaPercentual: order!.taxa_percentual_plataforma,
      taxaFixa: order!.taxa_fixa_plataforma,
    });

    if (calc.blocked) {
      await client.query(
        `UPDATE public.orders
         SET transfer_status = 'BLOQUEADO', transfer_amount = 0, updated_at = now()
         WHERE id = $1
           AND transfer_status IN ('NAO_LIBERADO','AGUARDANDO_ENTREGA','LIBERADO','FALHOU')`,
        [orderId],
      );
      return { proceed: false as const, reason: "valor_repasse_invalido", blocked: true };
    }

    await createMerchantTransfer(
      { orderId, storeId: order!.store_id, amount: calc.transferAmount },
      client,
    );
    // (re)coloca o movimento em PROCESSANDO em caso de retry de uma falha anterior
    const processingMovement = await updateMovementStatus(
      { idempotencyKey: idemKeys.repasse(orderId) },
      { status: "PROCESSANDO", metadata: { attempt: opts.attempt ?? 1 } },
      client,
    );
    if (!processingMovement) {
      throw new Error("O ledger financeiro nao permitiu reservar o repasse.");
    }

    const { rows: reservedRows } = await client.query(
      `UPDATE public.orders
          SET transfer_status = 'PROCESSANDO',
              transfer_amount = $2,
              platform_fee_amount = $3,
              transfer_released_at = COALESCE(transfer_released_at, now()),
              updated_at = now()
        WHERE id = $1
          AND status = 'entregue'
          AND payment_status = 'pago'
          AND transfer_status IN ('NAO_LIBERADO','AGUARDANDO_ENTREGA','LIBERADO','FALHOU')
          AND refund_status NOT IN ('PENDENTE','PROCESSANDO','ESTORNADO_TOTAL','ESTORNADO_PARCIAL','FALHOU')
        RETURNING id`,
      [orderId, calc.transferAmount, calc.platformFee],
    );
    if (!reservedRows[0]) {
      throw new Error("O estado financeiro do pedido mudou antes da reserva do repasse.");
    }

    return {
      proceed: true as const,
      amount: calc.transferAmount,
      pixKey: order!.pix_key as string,
      pixKeyType: check.pixKeyType,
      description: transferDescription(order as OrderRow),
      storeId: order!.store_id as string,
    };
  });

  if (!reservation.proceed) {
    return { ok: false, reason: reservation.reason, blocked: reservation.blocked };
  }

  // ── 2) CHAMADA EXTERNA (fora da transacao) ───────────────────────────────
  if (!asaasCentral.isConfigured()) {
    await markTransferFailed(orderId, "ASAAS_API_KEY central nao configurada.");
    return { ok: false, reason: "central_key_missing" };
  }

  const transfer = await asaasCentral.createPixTransfer(
    {
      value: reservation.amount,
      pixAddressKey: reservation.pixKey,
      pixAddressKeyType: reservation.pixKeyType as any,
      description: reservation.description,
      externalReference: `TRANSFER_ORDER_${orderId}`,
    },
    { idempotencyKey: idemKeys.repasse(orderId) },
  );

  // ── 3) PERSISTE RESULTADO ────────────────────────────────────────────────
  if (isAmbiguousAsaasResult(transfer)) {
    await markTransferReconciliationRequired(orderId, transfer, opts.attempt ?? 1);
    return {
      ok: false,
      reason: "transfer_reconciliation_required",
      status: "PROCESSANDO",
      reconciliationRequired: true,
    };
  }

  if (transfer?.errors) {
    const reason = String(transfer.errors[0]?.description || "Falha ao criar transferencia.");
    await markTransferFailed(orderId, reason);
    return { ok: false, reason };
  }

  const transferId = String(transfer?.id ?? "").trim() || null;
  if (!transferId) {
    await markTransferReconciliationRequired(
      orderId,
      {
        retryable: true,
        ambiguous: true,
        reconciliationRequired: true,
        failureKind: "invalid_response",
      },
      opts.attempt ?? 1,
    );
    return {
      ok: false,
      reason: "transfer_reconciliation_required",
      status: "PROCESSANDO",
      reconciliationRequired: true,
    };
  }
  const mappedStatus = asaasCentral.mapTransferStatus(transfer?.status);
  const done = mappedStatus === "ENVIADO";

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
      order.status !== "entregue" ||
      order.payment_status !== "pago" ||
      order.payment_method !== "pix" ||
      order.transfer_status !== "PROCESSANDO" ||
      REFUND_BLOCKS.has(String(order.refund_status))
    ) {
      return false;
    }
    const funding = await verifyCentralPixFunding(client, order);
    if (!funding.ok) return false;
    const movement = await findMovement({ idempotencyKey: idemKeys.repasse(orderId) }, client);
    if (
      movement?.status !== "PROCESSANDO" ||
      (movement.asaas_transfer_id && String(movement.asaas_transfer_id) !== transferId)
    ) {
      return false;
    }
    const { rows } = await client.query(
      `UPDATE public.orders
          SET asaas_transfer_id = COALESCE(asaas_transfer_id, $2),
              transfer_status = $3,
              transfer_sent_at = CASE WHEN $3 = 'ENVIADO' THEN COALESCE(transfer_sent_at, now()) ELSE transfer_sent_at END,
              updated_at = now()
        WHERE id = $1
          AND status = 'entregue'
          AND payment_status = 'pago'
          AND payment_method = 'pix'
          AND transfer_status = 'PROCESSANDO'
          AND refund_status NOT IN ('PENDENTE','PROCESSANDO','ESTORNADO_TOTAL','ESTORNADO_PARCIAL','FALHOU')
          AND (asaas_transfer_id IS NULL OR asaas_transfer_id = $2)
        RETURNING id`,
      [orderId, transferId, done ? "ENVIADO" : "PROCESSANDO"],
    );
    if (!rows[0]) return false;
    const updatedMovement = await updateMovementStatus(
      { idempotencyKey: idemKeys.repasse(orderId) },
      {
        status: done ? "CONFIRMADO" : "PROCESSANDO",
        asaasTransferId: transferId,
        metadata: { asaasStatus: transfer?.status ?? null },
      },
      client,
    );
    if (!updatedMovement) {
      throw new Error("O ledger financeiro mudou durante a finalizacao do repasse.");
    }
    return true;
  });

  if (!finalized) {
    console.error(
      JSON.stringify({
        scope: "transfer",
        event: "state_conflict_after_gateway",
        orderId,
        transferId,
        gatewayStatus: transfer?.status ?? null,
      }),
    );
    return {
      ok: false,
      reason: "transfer_state_conflict_after_gateway",
      status: done ? "ENVIADO" : "PROCESSANDO",
      reconciliationRequired: true,
      transferId,
    };
  }

  return {
    ok: true,
    status: done ? "ENVIADO" : "PROCESSANDO",
    transferId,
    amount: reservation.amount,
  };
};

const safeAmbiguousMetadata = (result: any, attempt: number) => {
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
    attempt,
  };
};

const markTransferReconciliationRequired = async (
  orderId: string,
  result: any,
  attempt: number,
) => {
  await withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      orderFinancialLockKey(orderId),
    ]);
    const movement = await findMovement({ idempotencyKey: idemKeys.repasse(orderId) }, client);
    if (movement?.status !== "PROCESSANDO") return;
    await updateMovementStatus(
      { idempotencyKey: idemKeys.repasse(orderId) },
      {
        status: "PROCESSANDO",
        failReason: TRANSFER_RECONCILIATION_REASON,
        metadata: safeAmbiguousMetadata(result, attempt),
      },
      client,
    );
  });
};

const markTransferFailed = async (orderId: string, reason: string) => {
  await withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      orderFinancialLockKey(orderId),
    ]);
    const movement = await findMovement({ idempotencyKey: idemKeys.repasse(orderId) }, client);
    if (movement?.status !== "PROCESSANDO") return;
    const { rows } = await client.query(
      `UPDATE public.orders
       SET transfer_status = 'FALHOU', updated_at = now()
       WHERE id = $1
         AND status = 'entregue'
         AND transfer_status = 'PROCESSANDO'
         AND refund_status NOT IN ('PENDENTE','PROCESSANDO','ESTORNADO_TOTAL','ESTORNADO_PARCIAL','FALHOU')
       RETURNING id`,
      [orderId],
    );
    if (!rows[0]) return;
    const updatedMovement = await updateMovementStatus(
      { idempotencyKey: idemKeys.repasse(orderId) },
      { status: "FALHOU", failReason: reason.slice(0, 1000) },
      client,
    );
    if (!updatedMovement) {
      throw new Error("O ledger financeiro mudou durante a falha do repasse.");
    }
  }).catch(() => null);
};

// ── Webhooks de transferencia ─────────────────────────────────────────────

/** Localiza o pedido por asaas_transfer_id ou external_reference (TRANSFER_ORDER_<id>). */
const resolveOrderIdFromTransfer = async (transfer: any): Promise<string | null> => {
  const extRef = String(transfer?.externalReference || "");
  const m = extRef.match(/^TRANSFER_ORDER_(.+)$/);
  if (m) return m[1];
  if (transfer?.id) {
    const { rows } = await query(
      `SELECT id FROM public.orders WHERE asaas_transfer_id = $1 LIMIT 1`,
      [transfer.id],
    );
    if (rows[0]) return rows[0].id;
    const mov = await findMovement({ asaasTransferId: String(transfer.id) });
    if (mov?.order_id) return mov.order_id;
  }
  return null;
};

export const handleTransferDone = async (transfer: any, eventId?: string | null) => {
  const orderId = await resolveOrderIdFromTransfer(transfer);
  if (!orderId) return { updated: false, reason: "order_not_found" };
  const transferId = String(transfer?.id ?? "").trim();
  if (!transferId) return { updated: false, reason: "transfer_id_ausente" };

  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      orderFinancialLockKey(orderId),
    ]);
    const { rows: orderRows } = await client.query(
      `SELECT * FROM public.orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = orderRows[0];
    const mov = await findMovement({ idempotencyKey: idemKeys.repasse(orderId) }, client);
    const idConflict =
      (order?.asaas_transfer_id && String(order.asaas_transfer_id) !== transferId) ||
      (mov?.asaas_transfer_id && String(mov.asaas_transfer_id) !== transferId);
    const duplicate =
      order?.transfer_status === "ENVIADO" &&
      mov?.status === "CONFIRMADO" &&
      !idConflict;

    if (duplicate) {
      await updateMovementStatus(
        { idempotencyKey: idemKeys.repasse(orderId) },
        {
          status: "CONFIRMADO",
          asaasTransferId: transferId,
          asaasEventId: eventId ?? null,
          metadata: {
            transactionReceiptUrl: transfer?.transactionReceiptUrl ?? null,
            effectiveDate: transfer?.effectiveDate ?? null,
            endToEndIdentifier: transfer?.endToEndIdentifier ?? null,
          },
        },
        client,
      );
      return { updated: true, duplicate: true, orderId };
    }

    if (
      !order ||
      idConflict ||
      order.status !== "entregue" ||
      order.payment_status !== "pago" ||
      order.payment_method !== "pix" ||
      !["PROCESSANDO", "FALHOU"].includes(String(order.transfer_status)) ||
      !["PROCESSANDO", "FALHOU"].includes(String(mov?.status)) ||
      REFUND_BLOCKS.has(String(order.refund_status))
    ) {
      console.error(
        JSON.stringify({ scope: "transfer", event: "webhook_state_conflict", orderId, transferId }),
      );
      return { updated: false, duplicate: false, stateConflict: true, orderId };
    }
    const funding = await verifyCentralPixFunding(client, order);
    if (!funding.ok) {
      console.error(
        JSON.stringify({
          scope: "transfer",
          event: "webhook_funding_conflict",
          orderId,
          transferId,
          reason: funding.reason,
        }),
      );
      return { updated: false, duplicate: false, stateConflict: true, orderId };
    }
    const { rows } = await client.query(
      `UPDATE public.orders
          SET transfer_status = 'ENVIADO',
              asaas_transfer_id = COALESCE(asaas_transfer_id, $2),
              asaas_event_id_ultimo = COALESCE($3, asaas_event_id_ultimo),
              transfer_sent_at = COALESCE(transfer_sent_at, now()),
              updated_at = now()
        WHERE id = $1
          AND status = 'entregue'
          AND payment_status = 'pago'
          AND payment_method = 'pix'
          AND transfer_status IN ('PROCESSANDO','FALHOU')
          AND refund_status NOT IN ('PENDENTE','PROCESSANDO','ESTORNADO_TOTAL','ESTORNADO_PARCIAL','FALHOU')
          AND (asaas_transfer_id IS NULL OR asaas_transfer_id = $2)
        RETURNING id`,
      [orderId, transferId, eventId ?? null],
    );
    if (!rows[0]) {
      console.error(
        JSON.stringify({
          scope: "transfer",
          event: "webhook_state_conflict",
          orderId,
          transferId,
        }),
      );
      return { updated: false, duplicate: false, stateConflict: true, orderId };
    }
    const updatedMovement = await updateMovementStatus(
      { idempotencyKey: idemKeys.repasse(orderId) },
      {
        status: "CONFIRMADO",
        asaasTransferId: transferId,
        asaasEventId: eventId ?? null,
        metadata: {
          transactionReceiptUrl: transfer?.transactionReceiptUrl ?? null,
          effectiveDate: transfer?.effectiveDate ?? null,
          endToEndIdentifier: transfer?.endToEndIdentifier ?? null,
        },
      },
      client,
    );
    if (!updatedMovement) {
      throw new Error("O ledger financeiro mudou durante o webhook de repasse concluido.");
    }
    return { updated: true, duplicate: false, orderId };
  });
};

export const handleTransferFailed = async (
  transfer: any,
  eventId?: string | null,
  finalStatus: "FALHOU" | "CANCELADO" = "FALHOU",
) => {
  const orderId = await resolveOrderIdFromTransfer(transfer);
  if (!orderId) return { updated: false, reason: "order_not_found" };
  const reason = String(transfer?.failReason || transfer?.status || "Transferencia nao concluida");

  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      orderFinancialLockKey(orderId),
    ]);
    const { rows: orderRows } = await client.query(
      `SELECT * FROM public.orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = orderRows[0];
    const movement = await findMovement({ idempotencyKey: idemKeys.repasse(orderId) }, client);
    const transferId = String(transfer?.id ?? "").trim() || null;
    const idConflict = Boolean(
      transferId &&
        ((order?.asaas_transfer_id && String(order.asaas_transfer_id) !== transferId) ||
          (movement?.asaas_transfer_id && String(movement.asaas_transfer_id) !== transferId)),
    );
    if (order?.transfer_status === "ENVIADO" || movement?.status === "CONFIRMADO") {
      return {
        updated: false,
        stateConflict: true,
        orderId,
        reason: "repasse_confirmado_nao_pode_ser_rebaixado",
      };
    }
    if (
      !order ||
      idConflict ||
      order.status !== "entregue" ||
      order.transfer_status !== "PROCESSANDO" ||
      movement?.status !== "PROCESSANDO" ||
      REFUND_BLOCKS.has(String(order.refund_status))
    ) {
      return { updated: false, stateConflict: true, orderId, reason };
    }
    const { rows } = await client.query(
      `UPDATE public.orders
          SET transfer_status = $2,
              asaas_event_id_ultimo = COALESCE($3, asaas_event_id_ultimo),
              updated_at = now()
        WHERE id = $1
          AND status = 'entregue'
          AND transfer_status = 'PROCESSANDO'
          AND refund_status NOT IN ('PENDENTE','PROCESSANDO','ESTORNADO_TOTAL','ESTORNADO_PARCIAL','FALHOU')
        RETURNING id`,
      [orderId, finalStatus, eventId ?? null],
    );
    if (!rows[0]) return { updated: false, stateConflict: true, orderId, reason };
    const updatedMovement = await updateMovementStatus(
      { idempotencyKey: idemKeys.repasse(orderId) },
      { status: "FALHOU", asaasEventId: eventId ?? null, failReason: reason.slice(0, 1000) },
      client,
    );
    if (!updatedMovement) {
      throw new Error("O ledger financeiro mudou durante o webhook de falha do repasse.");
    }
    return {
      updated: true,
      stateConflict: false,
      orderId,
      reason,
    };
  });
};

/** Reprocessa repasse FALHOU (acao administrativa controlada). */
export const retryTransfer = async (orderId: string): Promise<TransferOutcome> => {
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
    const movement = await findMovement({ idempotencyKey: idemKeys.repasse(orderId) }, client);
    if (["PROCESSANDO", "CONFIRMADO"].includes(String(movement?.status))) {
      return { ok: false as const, reason: "ledger_repasse_ja_em_andamento_ou_confirmado" };
    }
    if (order.transfer_status !== "FALHOU") {
      return { ok: false as const, reason: "repasse_nao_esta_falho" };
    }
    if (movement?.status !== "FALHOU") {
      return { ok: false as const, reason: "ledger_repasse_nao_esta_falho" };
    }
    if (order.status === "cancelado") return { ok: false as const, reason: "pedido_cancelado" };
    if (order.payment_status === "estornado") {
      return { ok: false as const, reason: "pagamento_estornado" };
    }
    if (REFUND_BLOCKS.has(String(order.refund_status))) {
      return { ok: false as const, reason: "reembolso_em_andamento" };
    }
    return {
      ok: true as const,
      attempt: Number(movement.metadata_json?.attempt || 1) + 1,
    };
  });
  if (!eligibility.ok) return { ok: false, reason: eligibility.reason };
  // permite o release reprocessar: aceita transfer_status FALHOU
  return releaseTransferForDeliveredOrder(orderId, { attempt: eligibility.attempt });
};
