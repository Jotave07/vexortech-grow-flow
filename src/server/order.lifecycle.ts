/**
 * Funcoes de ciclo de vida do pedido e financeiro (modelo central).
 *
 * Expostas via registry invokeFunction (POST /api/backend, kind:"function"),
 * que injeta o token autenticado -> getActor. Cada funcao recebe (body, actor)
 * e aplica authz (dono da loja ou admin).
 *
 * Convencoes de retorno: retornam o objeto de dados (ou lancam Error). O
 * registry envolve em { data, error }.
 */

import { query, withTransaction } from "@/backend/db";
import { getActor } from "@/backend/auth";
import { publishRealtime } from "@/backend/realtime";
import { sendOrderStatusNotification } from "@/functions/evolution.server";
import { normalizePixKeyType } from "./asaas.central";
import {
  releaseTransferForDeliveredOrder,
  retryTransfer,
  handleTransferFailed,
} from "./transfer.service";
import { refundCancelledOrder, retryRefund } from "./refund.service";
import {
  CANCELLATION_BLOCKING_TRANSFER_STATUSES,
  orderFinancialLockKey,
} from "./order-financial-state";
import {
  recordMovement,
  updateMovementStatus,
  getMerchantBalance,
  getOrderFinancialSummary,
  findMovement,
  idemKeys,
} from "./financial.ledger";
import { verifyCentralPixFunding } from "./central-funding";

type Actor = NonNullable<Awaited<ReturnType<typeof getActor>>>;

const REFUND_BLOCKS = new Set([
  "PENDENTE",
  "PROCESSANDO",
  "ESTORNADO_TOTAL",
  "ESTORNADO_PARCIAL",
  "FALHOU",
]);
const DELIVERY_SOURCE_STATUSES = new Set(["saiu_para_entrega", "pronto_para_retirada"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const requireActor = (actor: Actor | null): Actor => {
  if (!actor) throw new Error("Nao autenticado.");
  return actor;
};

const requireAdmin = (actor: Actor | null): Actor => {
  const a = requireActor(actor);
  if (!a.admin) throw new Error("Acesso negado.");
  return a;
};

const loadOrderScoped = async (actor: Actor, orderId: string) => {
  if (!UUID_PATTERN.test(String(orderId || ""))) throw new Error("Pedido invalido.");
  const { rows } = await query(
    `SELECT o.*, ss.financeiro_ativo, ss.repasse_automatico, ss.repasse_momento,
            ss.pix_key, ss.pix_key_type
       FROM public.orders o
       LEFT JOIN public.store_settings ss ON ss.store_id = o.store_id
      WHERE o.id = $1`,
    [orderId],
  );
  const order = rows[0];
  if (!order) throw new Error("Pedido nao encontrado.");
  if (!actor.admin && !actor.ownedStoreIds.includes(order.store_id)) {
    throw new Error("Pedido fora do escopo do usuario.");
  }
  return order;
};

const addStatusHistory = (
  client: { query: (t: string, p?: unknown[]) => Promise<{ rows: any[] }> },
  orderId: string,
  storeId: string,
  status: string,
  notes: string,
) =>
  client.query(
    `INSERT INTO public.order_status_history (order_id, store_id, status, notes)
   SELECT $1, $2, $3, $4
   WHERE NOT EXISTS (
     SELECT 1 FROM public.order_status_history
     WHERE order_id = $1 AND status = $3
   )`,
    [orderId, storeId, status, notes],
  );

// ── Marcar entregue -> libera repasse ──────────────────────────────────────

export const markOrderDelivered = async (
  body: { orderId: string; note?: string | null },
  actor: Actor | null,
) => {
  const a = requireActor(actor);
  await loadOrderScoped(a, body.orderId);

  const decision = await withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text,0::bigint))`, [
      orderFinancialLockKey(body.orderId),
    ]);
    const { rows } = await client.query(
      `SELECT o.*, COALESCE(ss.financeiro_ativo, false) AS financeiro_ativo,
              COALESCE(ss.repasse_automatico, false) AS repasse_automatico,
              COALESCE(ss.repasse_momento, 'MANUAL') AS repasse_momento
         FROM public.orders o
         LEFT JOIN public.store_settings ss ON ss.store_id = o.store_id
        WHERE o.id = $1
        FOR UPDATE OF o`,
      [body.orderId],
    );
    const o = rows[0];
    if (!o) throw new Error("Pedido nao encontrado.");
    if (o.status === "cancelado") throw new Error("Pedido cancelado nao pode ser entregue.");
    if (o.status !== "entregue" && !DELIVERY_SOURCE_STATUSES.has(String(o.status))) {
      throw new Error(
        "Conclua as etapas de preparo e saida antes de marcar o pedido como entregue.",
      );
    }
    if (o.payment_method === "pix" && o.payment_status !== "pago") {
      throw new Error("PIX precisa estar pago antes de concluir o pedido.");
    }

    let updatedOrder = o;
    const transitioned = o.status !== "entregue";
    if (o.status !== "entregue") {
      const { rows: updatedRows } = await client.query(
        `UPDATE public.orders
            SET status = 'entregue',
                payment_status = CASE WHEN payment_method = 'pix' THEN payment_status ELSE 'pago' END,
                paid_at = CASE WHEN payment_method = 'pix' THEN paid_at ELSE COALESCE(paid_at, now()) END,
                delivered_at = COALESCE(delivered_at, now()),
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [body.orderId],
      );
      updatedOrder = updatedRows[0];
      await addStatusHistory(
        client,
        body.orderId,
        o.store_id,
        "entregue",
        String(body.note || "Pedido marcado como entregue").slice(0, 500),
      );
      if (updatedOrder.customer_id) {
        await client.query(
          `UPDATE public.customers
              SET total_orders = COALESCE(total_orders, 0) + 1,
                  total_spent = COALESCE(total_spent, 0) + $2,
                  last_order_at = now(), updated_at = now()
            WHERE id = $1`,
          [updatedOrder.customer_id, Number(updatedOrder.total || 0)],
        );
      }
    } else if (o.payment_method !== "pix" && o.payment_status !== "pago") {
      const { rows: healedRows } = await client.query(
        `UPDATE public.orders
            SET payment_status = 'pago', paid_at = COALESCE(paid_at, now()), updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [body.orderId],
      );
      updatedOrder = healedRows[0];
    }

    if (updatedOrder.payment_method !== "pix") {
      await client.query(
        `UPDATE public.payments
            SET status = 'pago', paid_at = COALESCE(paid_at, now()), updated_at = now()
          WHERE order_id = $1`,
        [body.orderId],
      );
    }

    const central = Boolean(o.financeiro_ativo);
    const centralFundingMethod = updatedOrder.payment_method === "pix";
    if (
      central &&
      !centralFundingMethod &&
      ["NAO_LIBERADO", "AGUARDANDO_ENTREGA", "LIBERADO", "FALHOU"].includes(
        String(updatedOrder.transfer_status),
      )
    ) {
      const { rows: blockedRows } = await client.query(
        `UPDATE public.orders
            SET transfer_status = 'BLOQUEADO', updated_at = now()
          WHERE id = $1
            AND transfer_status IN ('NAO_LIBERADO','AGUARDANDO_ENTREGA','LIBERADO','FALHOU')
          RETURNING *`,
        [body.orderId],
      );
      updatedOrder = blockedRows[0] || updatedOrder;
    }
    const paid = updatedOrder.payment_status === "pago";
    const refundBlocking = REFUND_BLOCKS.has(String(updatedOrder.refund_status));
    const transferLocked = ["PROCESSANDO", "ENVIADO", "BLOQUEADO", "CANCELADO", "FALHOU"].includes(
      String(updatedOrder.transfer_status),
    );

    if (!central || !centralFundingMethod || !paid || refundBlocking || transferLocked) {
      return {
        release: false as const,
        reason: !central
          ? "loja_descentralizada"
          : !centralFundingMethod
            ? "metodo_sem_funding_central"
            : !paid
              ? "nao_pago"
              : refundBlocking
                ? "reembolso_em_andamento"
                : updatedOrder.transfer_status === "FALHOU"
                  ? "repasse_falho_requer_admin"
                  : "repasse_bloqueado_ou_em_andamento",
        oldOrder: o,
        updatedOrder,
        transitioned,
      };
    }

    const auto = o.repasse_automatico && o.repasse_momento === "APOS_ENTREGA";
    if (!auto) {
      const { rows: releasedRows } = await client.query(
        `UPDATE public.orders
            SET transfer_status = CASE
                  WHEN transfer_status IN ('NAO_LIBERADO','AGUARDANDO_ENTREGA') THEN 'LIBERADO'
                  ELSE transfer_status
                END,
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [body.orderId],
      );
      return {
        release: false as const,
        reason: "repasse_manual_liberado",
        oldOrder: o,
        updatedOrder: releasedRows[0],
        transitioned,
      };
    }
    return { release: true as const, oldOrder: o, updatedOrder, transitioned };
  });

  let transfer = null;
  if (decision.release) {
    transfer = await releaseTransferForDeliveredOrder(body.orderId);
  }
  const { rows: finalRows } = await query(`SELECT * FROM public.orders WHERE id = $1 LIMIT 1`, [
    body.orderId,
  ]);
  const finalOrder = finalRows[0] || decision.updatedOrder;
  publishRealtime({
    schema: "public",
    table: "orders",
    eventType: "UPDATE",
    old: decision.oldOrder,
    new: finalOrder,
  });
  if (decision.transitioned) {
    await sendOrderStatusNotification(body.orderId, "entregue", body.note || null).catch(
      (error) => {
        console.warn("Evolution status notification skipped:", error);
      },
    );
  }
  return {
    orderId: body.orderId,
    status: "entregue",
    releaseTriggered: decision.release,
    transfer,
    note: decision.release ? undefined : decision.reason,
    order: finalOrder,
  };
};

// ── Cancelar pelo lojista -> bloqueia repasse e (se pago) estorna ───────────

export const cancelOrderByMerchant = async (
  body: { orderId: string; reason?: string },
  actor: Actor | null,
) => {
  const a = requireActor(actor);
  await loadOrderScoped(a, body.orderId);
  const reason = String(body.reason || "Cancelado pela loja").slice(0, 500);

  const result = await withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text,0::bigint))`, [
      orderFinancialLockKey(body.orderId),
    ]);
    const { rows } = await client.query(`SELECT * FROM public.orders WHERE id = $1 FOR UPDATE`, [
      body.orderId,
    ]);
    const o = rows[0];
    if (!o) throw new Error("Pedido nao encontrado.");
    const wasPaid = ["pago", "estorno_pendente"].includes(String(o.payment_status));
    if (
      o.status !== "cancelado" &&
      CANCELLATION_BLOCKING_TRANSFER_STATUSES.has(String(o.transfer_status))
    ) {
      throw new Error(
        o.transfer_status === "ENVIADO"
          ? "Pedido ja repassado ao lojista. Cancelamento exige analise manual do admin."
          : "Pedido possui repasse liberado ou em processamento. Aguarde a conciliacao financeira antes de cancelar.",
      );
    }
    const funding = wasPaid
      ? await verifyCentralPixFunding(client, o)
      : ({ ok: false, reason: "pagamento_nao_confirmado", manual: false } as const);
    const refundMode = !wasPaid
      ? ("none" as const)
      : funding.ok
        ? ("central" as const)
        : o.payment_method === "pix"
          ? ("manual" as const)
          : ("none" as const);

    if (o.status === "cancelado") {
      return {
        alreadyCancelled: true,
        wasPaid,
        refundMode,
        refundStatus: String(o.refund_status || ""),
        oldOrder: o,
        updatedOrder: o,
      };
    }

    let updatedOrder;
    if (!wasPaid) {
      const { rows: updatedRows } = await client.query(
        `UPDATE public.orders
            SET status = 'cancelado', cancelled_at = now(), cancel_reason = $2,
                payment_status = CASE WHEN payment_status IN ('pendente') THEN 'cancelado' ELSE payment_status END,
                transfer_status = 'CANCELADO', refund_status = 'NAO_APLICAVEL', updated_at = now()
          WHERE id = $1
            AND status <> 'cancelado'
            AND COALESCE(transfer_status, 'NAO_LIBERADO') NOT IN ('LIBERADO','PROCESSANDO','ENVIADO')
          RETURNING *`,
        [body.orderId, reason],
      );
      updatedOrder = updatedRows[0];
    } else if (refundMode === "central") {
      const { rows: updatedRows } = await client.query(
        `UPDATE public.orders
            SET status = 'cancelado', cancelled_at = now(), cancel_reason = $2,
                payment_status = 'estorno_pendente',
                transfer_status = CASE WHEN transfer_status = 'ENVIADO' THEN transfer_status ELSE 'BLOQUEADO' END,
                updated_at = now()
          WHERE id = $1
            AND status <> 'cancelado'
            AND COALESCE(transfer_status, 'NAO_LIBERADO') NOT IN ('LIBERADO','PROCESSANDO','ENVIADO')
          RETURNING *`,
        [body.orderId, reason],
      );
      updatedOrder = updatedRows[0];
    } else if (refundMode === "manual") {
      const { rows: updatedRows } = await client.query(
        `UPDATE public.orders
            SET status = 'cancelado', cancelled_at = now(), cancel_reason = $2,
                payment_status = 'estorno_pendente',
                transfer_status = 'CANCELADO', refund_status = 'PENDENTE', updated_at = now()
          WHERE id = $1
            AND status <> 'cancelado'
            AND COALESCE(transfer_status, 'NAO_LIBERADO') NOT IN ('LIBERADO','PROCESSANDO','ENVIADO')
          RETURNING *`,
        [body.orderId, reason],
      );
      updatedOrder = updatedRows[0];
    } else {
      const { rows: updatedRows } = await client.query(
        `UPDATE public.orders
            SET status = 'cancelado', cancelled_at = now(), cancel_reason = $2,
                transfer_status = 'CANCELADO', refund_status = 'NAO_APLICAVEL', updated_at = now()
          WHERE id = $1
            AND status <> 'cancelado'
            AND COALESCE(transfer_status, 'NAO_LIBERADO') NOT IN ('LIBERADO','PROCESSANDO','ENVIADO')
          RETURNING *`,
        [body.orderId, reason],
      );
      updatedOrder = updatedRows[0];
    }
    if (!updatedOrder) {
      throw new Error("O estado financeiro do pedido mudou. Atualize a tela antes de cancelar.");
    }
    if (!wasPaid) {
      await client.query(
        `UPDATE public.payments
            SET status = 'cancelado', updated_at = now()
          WHERE order_id = $1
            AND status NOT IN ('pago','paid','estornado')`,
        [body.orderId],
      );
    }
    await addStatusHistory(
      client,
      body.orderId,
      o.store_id,
      "cancelado",
      `Cancelado pela loja: ${reason}`,
    );
    return {
      alreadyCancelled: false,
      wasPaid,
      refundMode,
      refundStatus: String(updatedOrder.refund_status || ""),
      oldOrder: o,
      updatedOrder,
    };
  });

  let refund = null;
  const canStartRefund =
    !result.alreadyCancelled || ["", "NAO_SOLICITADO", "PENDENTE"].includes(result.refundStatus);
  if (result.refundMode === "central" && canStartRefund) {
    refund = await refundCancelledOrder(body.orderId, { reason });
  }
  const { rows: finalRows } = await query(`SELECT * FROM public.orders WHERE id = $1 LIMIT 1`, [
    body.orderId,
  ]);
  const finalOrder = finalRows[0] || result.updatedOrder;
  publishRealtime({
    schema: "public",
    table: "orders",
    eventType: "UPDATE",
    old: result.oldOrder,
    new: finalOrder,
  });
  if (!result.alreadyCancelled) {
    await sendOrderStatusNotification(body.orderId, "cancelado", reason).catch((error) => {
      console.warn("Evolution status notification skipped:", error);
    });
  }
  return {
    orderId: body.orderId,
    cancelled: true,
    refund,
    note: result.alreadyCancelled ? "ja_cancelado" : undefined,
    order: finalOrder,
  };
};

// ── Admin: reprocessamentos / ajustes ──────────────────────────────────────

export const adminRetryTransfer = async (body: { orderId: string }, actor: Actor | null) => {
  requireAdmin(actor);
  return retryTransfer(body.orderId);
};

export const adminReleaseTransfer = async (body: { orderId: string }, actor: Actor | null) => {
  requireAdmin(actor);
  return releaseTransferForDeliveredOrder(body.orderId, {
    requiredTransferStatus: "LIBERADO",
  });
};

export const adminRetryRefund = async (body: { orderId: string }, actor: Actor | null) => {
  requireAdmin(actor);
  return retryRefund(body.orderId);
};

export const adminBlockTransfer = async (
  body: { orderId: string; reason?: string },
  actor: Actor | null,
) => {
  requireAdmin(actor);
  const reason = String(body.reason || "Bloqueado pelo admin").slice(0, 1000);
  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text,0::bigint))`, [
      orderFinancialLockKey(body.orderId),
    ]);
    const { rows: currentRows } = await client.query(
      `SELECT id, transfer_status FROM public.orders WHERE id = $1 FOR UPDATE`,
      [body.orderId],
    );
    const current = currentRows[0];
    if (!current) throw new Error("Pedido nao encontrado.");
    const movement = await findMovement(
      { idempotencyKey: idemKeys.repasse(body.orderId) },
      client,
    );
    if (["PROCESSANDO", "CONFIRMADO"].includes(String(movement?.status))) {
      throw new Error(
        "O ledger registra repasse em processamento ou confirmado. Concilie o movimento antes de bloquear.",
      );
    }
    if (current.transfer_status === "BLOQUEADO") {
      return { orderId: body.orderId, transfer_status: "BLOQUEADO", alreadyBlocked: true };
    }
    if (["PROCESSANDO", "ENVIADO"].includes(String(current.transfer_status))) {
      throw new Error(
        "Repasse em processamento ou ja enviado nao pode ser bloqueado automaticamente. Concilie o estado financeiro.",
      );
    }

    const { rows } = await client.query(
      `UPDATE public.orders
          SET transfer_status = 'BLOQUEADO', updated_at = now()
        WHERE id = $1
          AND transfer_status IN ('NAO_LIBERADO','AGUARDANDO_ENTREGA','LIBERADO','FALHOU')
        RETURNING id`,
      [body.orderId],
    );
    if (!rows[0]) {
      throw new Error("Estado atual do repasse nao permite bloqueio administrativo.");
    }
    if (movement) {
      const updatedMovement = await updateMovementStatus(
        { idempotencyKey: idemKeys.repasse(body.orderId) },
        { status: "CANCELADO", failReason: reason },
        client,
      );
      if (!updatedMovement) {
        throw new Error("O ledger financeiro mudou durante o bloqueio administrativo.");
      }
    }
    return { orderId: body.orderId, transfer_status: "BLOQUEADO", alreadyBlocked: false };
  });
};

export const adminManualAdjustment = async (
  body: {
    orderId?: string;
    storeId: string;
    amount: number;
    nature: "CREDITO" | "DEBITO";
    description: string;
    idempotencyKey?: string;
  },
  actor: Actor | null,
) => {
  requireAdmin(actor);
  if (!body.storeId) throw new Error("storeId obrigatorio.");
  if (!(Number(body.amount) > 0)) throw new Error("amount deve ser positivo.");
  if (!["CREDITO", "DEBITO"].includes(body.nature)) throw new Error("nature invalida.");
  if (!body.idempotencyKey || body.idempotencyKey.length < 8)
    throw new Error("idempotencyKey obrigatoria.");
  if (body.orderId) {
    const { rows } = await query(`SELECT store_id FROM public.orders WHERE id = $1 LIMIT 1`, [
      body.orderId,
    ]);
    if (!rows[0]) throw new Error("Pedido nao encontrado.");
    if (rows[0].store_id !== body.storeId) throw new Error("Pedido nao pertence a loja informada.");
  }
  const { movement } = await recordMovement({
    orderId: body.orderId ?? null,
    storeId: body.storeId,
    type: "AJUSTE_MANUAL",
    nature: body.nature,
    amount: Number(body.amount),
    status: "CONFIRMADO",
    description: String(body.description || "Ajuste manual"),
    idempotencyKey: `AJUSTE_${body.storeId}_${body.idempotencyKey}`,
  });
  return { movement };
};

// ── Consultas (admin / lojista) ────────────────────────────────────────────

export const getOrderFinancial = async (body: { orderId: string }, actor: Actor | null) => {
  const a = requireActor(actor);
  const order = await loadOrderScoped(a, body.orderId);
  const movements = await getOrderFinancialSummary(body.orderId);
  return {
    order: {
      id: order.id,
      total: order.total,
      payment_status: order.payment_status,
      status: order.status,
      transfer_status: order.transfer_status,
      refund_status: order.refund_status,
      platform_fee_amount: order.platform_fee_amount,
      transfer_amount: order.transfer_amount,
      refunded_amount: order.refunded_amount,
      asaas_transfer_id: order.asaas_transfer_id,
    },
    movements,
  };
};

export const getMerchantStatement = async (
  body: { storeId: string; limit?: number },
  actor: Actor | null,
) => {
  const a = requireActor(actor);
  if (!a.admin && !a.ownedStoreIds.includes(body.storeId))
    throw new Error("Loja fora do escopo do usuario.");
  const limit = Math.min(Math.max(Number(body.limit || 100), 1), 500);
  const [{ rows: movements }, balance] = await Promise.all([
    query(
      `SELECT id, order_id, type, nature, amount, status, description,
              asaas_transfer_id, asaas_refund_id, created_at, confirmed_at, failed_at, fail_reason
         FROM public.financial_movements
        WHERE store_id = $1
        ORDER BY created_at DESC
        LIMIT ${limit}`,
      [body.storeId],
    ),
    getMerchantBalance(body.storeId),
  ]);
  return { balance, movements };
};

export const listFinancialOrders = async (
  body: {
    bucket?: "aguardando_entrega" | "aguardando_repasse" | "repasse_falho" | "reembolso_falho";
    storeId?: string;
    limit?: number;
  },
  actor: Actor | null,
) => {
  requireAdmin(actor);
  const limit = Math.min(Math.max(Number(body.limit || 100), 1), 500);
  const where: string[] = [];
  const params: unknown[] = [];
  const bucketSql: Record<string, string> = {
    aguardando_entrega: "o.transfer_status = 'AGUARDANDO_ENTREGA'",
    aguardando_repasse: "o.transfer_status IN ('LIBERADO','PROCESSANDO')",
    repasse_falho: "o.transfer_status = 'FALHOU'",
    reembolso_falho: "o.refund_status = 'FALHOU'",
  };
  where.push(bucketSql[body.bucket || "repasse_falho"] || bucketSql.repasse_falho);
  if (body.storeId) {
    params.push(body.storeId);
    where.push(`o.store_id = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT o.id, o.order_number, o.store_id, o.total, o.status, o.payment_status,
            o.transfer_status, o.refund_status, o.transfer_amount, o.platform_fee_amount,
            o.asaas_transfer_id, o.delivered_at, o.created_at,
            s.name AS store_name, ss.pix_key, ss.pix_key_type,
            transfer_movement.status AS transfer_movement_status,
            refund_movement.status AS refund_movement_status
       FROM public.orders o
       JOIN public.stores s ON s.id = o.store_id
       JOIN public.store_settings ss ON ss.store_id = o.store_id
       LEFT JOIN LATERAL (
         SELECT fm.status
           FROM public.financial_movements fm
          WHERE fm.order_id = o.id AND fm.type = 'REPASSE_LOJISTA'
          ORDER BY fm.created_at DESC
          LIMIT 1
       ) transfer_movement ON true
       LEFT JOIN LATERAL (
         SELECT fm.status
           FROM public.financial_movements fm
          WHERE fm.order_id = o.id AND fm.type = 'REEMBOLSO_CLIENTE'
          ORDER BY fm.created_at DESC
          LIMIT 1
       ) refund_movement ON true
      WHERE ${where.join(" AND ")}
      ORDER BY o.created_at DESC
      LIMIT ${limit}`,
    params,
  );
  return { orders: rows };
};

// ── Config financeira ──────────────────────────────────────────────────────

export const merchantUpdatePixConfig = async (
  body: {
    storeId: string;
    pixKey?: string | null;
    pixKeyType?: string | null;
    repasseAutomatico?: boolean;
    repasseMomento?: "APOS_ENTREGA" | "MANUAL";
  },
  actor: Actor | null,
) => {
  const a = requireActor(actor);
  if (!a.admin && !a.ownedStoreIds.includes(body.storeId))
    throw new Error("Loja fora do escopo do usuario.");

  let pixKeyType: string | null = null;
  if (body.pixKey) {
    pixKeyType = normalizePixKeyType(body.pixKeyType);
    if (!pixKeyType)
      throw new Error("Tipo de chave PIX invalido. Use CPF, CNPJ, EMAIL, PHONE ou EVP.");
  }
  const repasseMomento = body.repasseMomento === "MANUAL" ? "MANUAL" : "APOS_ENTREGA";

  const { rows } = await query(
    `UPDATE public.store_settings
        SET pix_key = $2,
            pix_key_type = $3,
            repasse_automatico = COALESCE($4, repasse_automatico),
            repasse_momento = $5,
            updated_at = now()
      WHERE store_id = $1
      RETURNING store_id, pix_key, pix_key_type, repasse_automatico, repasse_momento, financeiro_ativo`,
    [body.storeId, body.pixKey || null, pixKeyType, body.repasseAutomatico ?? null, repasseMomento],
  );
  if (!rows[0]) throw new Error("Configuracoes da loja nao encontradas.");
  return { settings: rows[0] };
};

export const adminUpdateStoreFinancials = async (
  body: {
    storeId: string;
    financeiroAtivo?: boolean;
    taxaPercentual?: number;
    taxaFixa?: number;
  },
  actor: Actor | null,
) => {
  requireAdmin(actor);
  if (body.taxaPercentual != null && Number(body.taxaPercentual) < 0)
    throw new Error("Taxa percentual nao pode ser negativa.");
  if (body.taxaFixa != null && Number(body.taxaFixa) < 0)
    throw new Error("Taxa fixa nao pode ser negativa.");
  const { rows } = await query(
    `UPDATE public.store_settings
        SET financeiro_ativo = COALESCE($2, financeiro_ativo),
            taxa_percentual_plataforma = COALESCE($3, taxa_percentual_plataforma),
            taxa_fixa_plataforma = COALESCE($4, taxa_fixa_plataforma),
            updated_at = now()
      WHERE store_id = $1
      RETURNING store_id, financeiro_ativo, taxa_percentual_plataforma, taxa_fixa_plataforma`,
    [
      body.storeId,
      body.financeiroAtivo ?? null,
      body.taxaPercentual ?? null,
      body.taxaFixa ?? null,
    ],
  );
  if (!rows[0]) throw new Error("Configuracoes da loja nao encontradas.");
  return { settings: rows[0] };
};

// re-export para uso no webhook
export { handleTransferFailed };
