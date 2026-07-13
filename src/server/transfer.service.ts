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
import { asaasCentral, normalizePixKeyType } from "./asaas.central";
import { calcularValorRepasse } from "./financial.calc";
import {
  createMerchantTransfer,
  updateMovementStatus,
  findMovement,
  idemKeys,
} from "./financial.ledger";

const lockKey = (orderId: string) => `repasse:${orderId}`;

const RELEASABLE = new Set(["NAO_LIBERADO", "AGUARDANDO_ENTREGA", "LIBERADO", "FALHOU"]);
const REFUND_BLOCKS = new Set(["PENDENTE", "PROCESSANDO", "ESTORNADO_TOTAL", "ESTORNADO_PARCIAL", "FALHOU"]);

export type TransferOutcome =
  | { ok: true; status: "PROCESSANDO" | "ENVIADO"; transferId?: string | null; amount: number }
  | { ok: false; reason: string; status?: string; blocked?: boolean };

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
const validateRelease = (order: OrderRow): { ok: true; pixKeyType: string } | { ok: false; reason: string; blocked?: boolean } => {
  if (!order) return { ok: false, reason: "order_not_found" };
  if (!order.financeiro_ativo) return { ok: false, reason: "financeiro_inativo" };
  if (order.payment_status !== "pago") return { ok: false, reason: "pagamento_nao_confirmado" };
  if (order.status !== "entregue") return { ok: false, reason: "pedido_nao_entregue" };
  if (order.status === "cancelado") return { ok: false, reason: "pedido_cancelado" };
  if (REFUND_BLOCKS.has(String(order.refund_status))) return { ok: false, reason: "reembolso_em_andamento", blocked: true };
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
  `Repasse pedido #${order.order_number ?? order.id} - ${order.store_public_name || order.store_name || "Loja"}`.slice(0, 200);

/**
 * Libera o repasse de um pedido entregue. Idempotente e seguro para concorrencia.
 * attempt: usado no Idempotency-Key do Asaas para permitir nova tentativa apos falha.
 */
export const releaseTransferForDeliveredOrder = async (
  orderId: string,
  opts: { attempt?: number } = {},
): Promise<TransferOutcome> => {
  // ── 1) RESERVA ──────────────────────────────────────────────────────────
  const reservation = await withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [lockKey(orderId)]);
    const order = await loadOrder(client, orderId);
    const check = validateRelease(order as OrderRow);
    if (!check.ok) {
      if (check.blocked) {
        await client.query(
          `UPDATE public.orders SET transfer_status = 'BLOQUEADO', updated_at = now() WHERE id = $1`,
          [orderId],
        );
      }
      return { proceed: false as const, reason: check.reason, blocked: check.blocked };
    }

    const calc = calcularValorRepasse({
      totalPaid: order!.total,
      refundedAmount: order!.refunded_amount,
      taxaPercentual: order!.taxa_percentual_plataforma,
      taxaFixa: order!.taxa_fixa_plataforma,
    });

    if (calc.blocked) {
      await client.query(
        `UPDATE public.orders SET transfer_status = 'BLOQUEADO', transfer_amount = 0, updated_at = now() WHERE id = $1`,
        [orderId],
      );
      return { proceed: false as const, reason: "valor_repasse_invalido", blocked: true };
    }

    await createMerchantTransfer(
      { orderId, storeId: order!.store_id, amount: calc.transferAmount },
      client,
    );
    // (re)coloca o movimento em PROCESSANDO em caso de retry de uma falha anterior
    await updateMovementStatus(
      { idempotencyKey: idemKeys.repasse(orderId) },
      { status: "PROCESSANDO", metadata: { attempt: opts.attempt ?? 1 } },
      client,
    );

    await client.query(
      `UPDATE public.orders
          SET transfer_status = 'PROCESSANDO',
              transfer_amount = $2,
              platform_fee_amount = $3,
              transfer_released_at = COALESCE(transfer_released_at, now()),
              updated_at = now()
        WHERE id = $1`,
      [orderId, calc.transferAmount, calc.platformFee],
    );

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

  const idempotencyKey =
    opts.attempt && opts.attempt > 1
      ? `${idemKeys.repasse(orderId)}:retry:${opts.attempt}`
      : idemKeys.repasse(orderId);

  const transfer = await asaasCentral.createPixTransfer(
    {
      value: reservation.amount,
      pixAddressKey: reservation.pixKey,
      pixAddressKeyType: reservation.pixKeyType as any,
      description: reservation.description,
      externalReference: `TRANSFER_ORDER_${orderId}`,
    },
    { idempotencyKey },
  );

  // ── 3) PERSISTE RESULTADO ────────────────────────────────────────────────
  if (transfer?.errors) {
    const reason = String(transfer.errors[0]?.description || "Falha ao criar transferencia.");
    await markTransferFailed(orderId, reason);
    return { ok: false, reason };
  }

  const transferId = transfer?.id ? String(transfer.id) : null;
  const mappedStatus = asaasCentral.mapTransferStatus(transfer?.status);
  const done = mappedStatus === "ENVIADO";

  await withTransaction(async (client) => {
    await updateMovementStatus(
      { idempotencyKey: idemKeys.repasse(orderId) },
      {
        status: done ? "CONFIRMADO" : "PROCESSANDO",
        asaasTransferId: transferId,
        metadata: { asaasStatus: transfer?.status ?? null },
      },
      client,
    );
    await client.query(
      `UPDATE public.orders
          SET asaas_transfer_id = COALESCE($2, asaas_transfer_id),
              transfer_status = $3,
              transfer_sent_at = CASE WHEN $3 = 'ENVIADO' THEN COALESCE(transfer_sent_at, now()) ELSE transfer_sent_at END,
              updated_at = now()
        WHERE id = $1`,
      [orderId, transferId, done ? "ENVIADO" : "PROCESSANDO"],
    );
  });

  return { ok: true, status: done ? "ENVIADO" : "PROCESSANDO", transferId, amount: reservation.amount };
};

const markTransferFailed = async (orderId: string, reason: string) => {
  await withTransaction(async (client) => {
    await updateMovementStatus(
      { idempotencyKey: idemKeys.repasse(orderId) },
      { status: "FALHOU", failReason: reason.slice(0, 1000) },
      client,
    );
    await client.query(
      `UPDATE public.orders SET transfer_status = 'FALHOU', updated_at = now() WHERE id = $1`,
      [orderId],
    );
  }).catch(() => null);
};

// ── Webhooks de transferencia ─────────────────────────────────────────────

/** Localiza o pedido por asaas_transfer_id ou external_reference (TRANSFER_ORDER_<id>). */
const resolveOrderIdFromTransfer = async (transfer: any): Promise<string | null> => {
  const extRef = String(transfer?.externalReference || "");
  const m = extRef.match(/^TRANSFER_ORDER_(.+)$/);
  if (m) return m[1];
  if (transfer?.id) {
    const { rows } = await query(`SELECT id FROM public.orders WHERE asaas_transfer_id = $1 LIMIT 1`, [transfer.id]);
    if (rows[0]) return rows[0].id;
    const mov = await findMovement({ asaasTransferId: String(transfer.id) });
    if (mov?.order_id) return mov.order_id;
  }
  return null;
};

export const handleTransferDone = async (transfer: any, eventId?: string | null) => {
  const orderId = await resolveOrderIdFromTransfer(transfer);
  if (!orderId) return { updated: false, reason: "order_not_found" };

  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [lockKey(orderId)]);
    const mov = await findMovement({ idempotencyKey: idemKeys.repasse(orderId) }, client);
    if (mov?.status === "CONFIRMADO") return { updated: false, duplicate: true };

    await updateMovementStatus(
      { idempotencyKey: idemKeys.repasse(orderId) },
      {
        status: "CONFIRMADO",
        asaasTransferId: transfer?.id ? String(transfer.id) : null,
        asaasEventId: eventId ?? null,
        metadata: {
          transactionReceiptUrl: transfer?.transactionReceiptUrl ?? null,
          effectiveDate: transfer?.effectiveDate ?? null,
          endToEndIdentifier: transfer?.endToEndIdentifier ?? null,
        },
      },
      client,
    );
    await client.query(
      `UPDATE public.orders
          SET transfer_status = 'ENVIADO',
              asaas_transfer_id = COALESCE($2, asaas_transfer_id),
              asaas_event_id_ultimo = COALESCE($3, asaas_event_id_ultimo),
              transfer_sent_at = COALESCE(transfer_sent_at, now()),
              updated_at = now()
        WHERE id = $1`,
      [orderId, transfer?.id ? String(transfer.id) : null, eventId ?? null],
    );
    return { updated: true, orderId };
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
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [lockKey(orderId)]);
    await updateMovementStatus(
      { idempotencyKey: idemKeys.repasse(orderId) },
      { status: "FALHOU", asaasEventId: eventId ?? null, failReason: reason.slice(0, 1000) },
      client,
    );
    await client.query(
      `UPDATE public.orders
          SET transfer_status = $2,
              asaas_event_id_ultimo = COALESCE($3, asaas_event_id_ultimo),
              updated_at = now()
        WHERE id = $1`,
      [orderId, finalStatus, eventId ?? null],
    );
    return { updated: true, orderId, reason };
  });
};

/** Reprocessa repasse FALHOU (acao administrativa controlada). */
export const retryTransfer = async (orderId: string): Promise<TransferOutcome> => {
  const { rows } = await query(
    `SELECT transfer_status, status, payment_status, refund_status FROM public.orders WHERE id = $1`,
    [orderId],
  );
  const o = rows[0];
  if (!o) return { ok: false, reason: "order_not_found" };
  if (o.transfer_status !== "FALHOU") return { ok: false, reason: "repasse_nao_esta_falho" };
  if (o.status === "cancelado") return { ok: false, reason: "pedido_cancelado" };
  if (o.payment_status === "estornado") return { ok: false, reason: "pagamento_estornado" };
  if (REFUND_BLOCKS.has(String(o.refund_status))) return { ok: false, reason: "reembolso_em_andamento" };

  const mov = await findMovement({ idempotencyKey: idemKeys.repasse(orderId) });
  const attempt = Number(mov?.metadata_json?.attempt || 1) + 1;
  // permite o release reprocessar: aceita transfer_status FALHOU
  return releaseTransferForDeliveredOrder(orderId, { attempt });
};
