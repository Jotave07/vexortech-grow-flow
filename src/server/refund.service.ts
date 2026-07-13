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
import { asaasCentral } from "./asaas.central";
import { toCents } from "./financial.calc";
import {
  createCustomerRefund,
  updateMovementStatus,
  idemKeys,
} from "./financial.ledger";

const lockKey = (orderId: string) => `reembolso:${orderId}`;

const isInsufficientBalance = (desc: string) =>
  /saldo insuficiente|insufficient balance|insufficient funds/i.test(desc);

export type RefundOutcome =
  | { ok: true; status: "PROCESSANDO" | "ESTORNADO_TOTAL"; refundId?: string | null; amount: number }
  | { ok: false; reason: string; insufficientBalance?: boolean };

const loadOrderWithPayment = async (
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: any[] }> },
  orderId: string,
) => {
  const { rows } = await client.query(
    `SELECT o.*,
            p.external_id AS payment_external_id, p.asaas_id AS payment_asaas_id,
            p.status AS payment_row_status
       FROM public.orders o
       LEFT JOIN public.payments p ON p.order_id = o.id
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
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [lockKey(orderId)]);
    const order = await loadOrderWithPayment(client, orderId);
    if (!order) return { proceed: false as const, reason: "order_not_found" };

    if (order.transfer_status === "ENVIADO") {
      // dinheiro ja repassado: NAO estorna automaticamente, exige analise manual
      return { proceed: false as const, reason: "repasse_ja_enviado_revisao_manual" };
    }
    // Aceita 'pago' e 'estorno_pendente' (o handler de status marca pix pago
    // cancelado como estorno_pendente antes deste gatilho rodar).
    if (!["pago", "estorno_pendente"].includes(String(order.payment_status))) {
      return { proceed: false as const, reason: "pagamento_nao_confirmado" };
    }
    if (["ESTORNADO_TOTAL", "PROCESSANDO", "PENDENTE"].includes(String(order.refund_status))) {
      return { proceed: false as const, reason: "reembolso_ja_em_andamento" };
    }

    const paymentId = order.payment_external_id || order.payment_asaas_id;
    if (!paymentId) return { proceed: false as const, reason: "asaas_payment_id_ausente" };

    const totalCents = toCents(order.total);
    const refundedCents = toCents(order.refunded_amount);
    const requestedCents = opts.value != null ? toCents(opts.value) : totalCents - refundedCents;
    if (requestedCents <= 0) return { proceed: false as const, reason: "valor_estorno_invalido" };
    const value = requestedCents / 100;

    await createCustomerRefund(
      { orderId, storeId: order.store_id, amount: value, asaasPaymentId: paymentId },
      client,
    );
    await updateMovementStatus(
      { idempotencyKey: idemKeys.reembolso(orderId) },
      { status: "PROCESSANDO" },
      client,
    );

    await client.query(
      `UPDATE public.orders
          SET refund_status = 'PROCESSANDO',
              transfer_status = CASE WHEN transfer_status = 'ENVIADO' THEN transfer_status ELSE 'BLOQUEADO' END,
              updated_at = now()
        WHERE id = $1`,
      [orderId],
    );

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
  );

  // ── 3) PERSISTE RESULTADO ────────────────────────────────────────────────
  if (refund?.errors) {
    const desc = String(refund.errors[0]?.description || "Falha ao estornar.");
    const insufficient = isInsufficientBalance(desc);
    await markRefundFailed(orderId, desc, insufficient);
    return { ok: false, reason: desc, insufficientBalance: insufficient };
  }

  const refundId = refund?.id ? String(refund.id) : null;
  const mappedStatus = asaasCentral.mapPaymentStatus(refund?.status);
  const alreadyRefunded = mappedStatus === "estornado";

  await withTransaction(async (client) => {
    await updateMovementStatus(
      { idempotencyKey: idemKeys.reembolso(orderId) },
      {
        status: alreadyRefunded ? "CONFIRMADO" : "PROCESSANDO",
        asaasRefundId: refundId,
        metadata: { asaasStatus: refund?.status ?? null },
      },
      client,
    );
    if (alreadyRefunded) {
      await client.query(
        `UPDATE public.orders
            SET refund_status = 'ESTORNADO_TOTAL',
                payment_status = 'estornado',
                transfer_status = CASE WHEN transfer_status = 'ENVIADO' THEN transfer_status ELSE 'CANCELADO' END,
                refunded_amount = $2,
                refunded_at = COALESCE(refunded_at, now()),
                updated_at = now()
          WHERE id = $1`,
        [orderId, reservation.value],
      );
    }
  });

  return {
    ok: true,
    status: alreadyRefunded ? "ESTORNADO_TOTAL" : "PROCESSANDO",
    refundId,
    amount: reservation.value,
  };
};

const markRefundFailed = async (orderId: string, reason: string, insufficientBalance: boolean) => {
  await withTransaction(async (client) => {
    await updateMovementStatus(
      { idempotencyKey: idemKeys.reembolso(orderId) },
      { status: "FALHOU", failReason: reason.slice(0, 1000), metadata: { insufficientBalance } },
      client,
    );
    await client.query(
      `UPDATE public.orders
          SET refund_status = 'FALHOU',
              transfer_status = CASE WHEN transfer_status = 'ENVIADO' THEN transfer_status ELSE 'BLOQUEADO' END,
              updated_at = now()
        WHERE id = $1`,
      [orderId],
    );
  }).catch(() => null);
  if (insufficientBalance) {
    console.error(JSON.stringify({
      scope: "refund", event: "insufficient_balance", orderId,
      message: "Saldo insuficiente na conta central para estorno. Aumentar saldo Asaas e reprocessar.",
    }));
  }
};

/** Webhook PAYMENT_REFUNDED / PAYMENT_PARTIALLY_REFUNDED. */
export const handleRefundConfirmed = async (
  payment: any,
  eventId?: string | null,
  partial = false,
) => {
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
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [lockKey(orderId)]);
    const refundStatus = partial ? "ESTORNADO_PARCIAL" : "ESTORNADO_TOTAL";
    const refundedValue = Number(payment?.value ?? 0);

    await updateMovementStatus(
      { idempotencyKey: idemKeys.reembolso(orderId) },
      { status: "CONFIRMADO", asaasEventId: eventId ?? null, asaasRefundId: payment?.id ? String(payment.id) : null },
      client,
    );
    const { rows } = await client.query(
      `UPDATE public.orders
          SET refund_status = $2,
              payment_status = 'estornado',
              transfer_status = CASE WHEN transfer_status = 'ENVIADO' THEN transfer_status ELSE 'CANCELADO' END,
              refunded_amount = CASE WHEN $4 = true THEN COALESCE(refunded_amount,0) + $3 ELSE GREATEST(COALESCE(refunded_amount,0), $3) END,
              refunded_at = COALESCE(refunded_at, now()),
              asaas_event_id_ultimo = COALESCE($5, asaas_event_id_ultimo),
              updated_at = now()
        WHERE id = $1
        RETURNING id`,
      [orderId, refundStatus, refundedValue, partial, eventId ?? null],
    );
    return { updated: Boolean(rows[0]), orderId };
  });
};

/** Reprocessa reembolso FALHOU (acao administrativa). */
export const retryRefund = async (orderId: string): Promise<RefundOutcome> => {
  const { rows } = await query(
    `SELECT refund_status, transfer_status, cancel_reason FROM public.orders WHERE id = $1`,
    [orderId],
  );
  const o = rows[0];
  if (!o) return { ok: false, reason: "order_not_found" };
  if (o.refund_status !== "FALHOU") return { ok: false, reason: "reembolso_nao_esta_falho" };
  if (o.transfer_status === "ENVIADO") return { ok: false, reason: "repasse_ja_enviado_revisao_manual" };
  return refundCancelledOrder(orderId, { reason: o.cancel_reason || "Reprocessamento de estorno" });
};
