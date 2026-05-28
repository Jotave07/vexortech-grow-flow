import type pg from "pg";
import { getActor } from "@/backend/auth";
import { query, withTransaction } from "@/backend/db";
import { publishRealtime } from "@/backend/realtime";
import { sendOrderStatusNotification } from "@/functions/evolution.server";
import { createPixCopyPastePayload } from "./pix";

type DbClient = Pick<pg.PoolClient, "query">;

type PaymentDeps = {
  withTransaction: typeof withTransaction;
  query: typeof query;
  publishRealtime: typeof publishRealtime;
  notifyStatus: typeof sendOrderStatusNotification;
  getActor: typeof getActor;
};

const defaultDeps: PaymentDeps = {
  withTransaction,
  query,
  publishRealtime,
  notifyStatus: sendOrderStatusNotification,
  getActor,
};

const paidStatuses = new Set(["pago", "paid"]);
const blockedOrderStatuses = new Set(["cancelado", "cancelled", "finalizado", "delivered", "entregue"]);

const reserveManualPixPayment = async (
  client: DbClient,
  input: { orderId: string; storeId: string; attemptKey?: string; publicToken?: string },
) => {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [`manual-pix:${input.orderId}`]);

  const { rows: orders } = await client.query(
    `SELECT o.*, ss.pix_key, ss.pix_key_type, ss.payment_instructions, st.name AS store_name, st.city AS store_city
     FROM public.orders o
     JOIN public.store_settings ss ON ss.store_id = o.store_id
     JOIN public.stores st ON st.id = o.store_id
     WHERE o.id = $1
       AND o.store_id = $2
       AND ($3::text IS NULL OR o.public_token = $3::text)
     FOR UPDATE OF o`,
    [input.orderId, input.storeId, input.publicToken || null],
  );

  const order = orders[0];
  if (!order) throw new Error("Pedido nao encontrado.");
  if (order.payment_method !== "pix") throw new Error("Pedido nao usa pagamento PIX.");
  if (!String(order.pix_key || "").trim()) throw new Error("Loja nao cadastrou a chave Pix para receber pedidos.");

  const pixPayload = order.pix_payload || createPixCopyPastePayload({
    pixKey: order.pix_key,
    amount: Number(order.total || 0),
    merchantName: order.store_name || "Hype Delivery",
    merchantCity: order.store_city || "BRASIL",
    txid: String(order.order_number || order.id).replace(/\W/g, "").slice(0, 25) || "PEDIDO",
  });

  const { rows: paymentRows } = await client.query(
    `SELECT *
     FROM public.payments
     WHERE order_id = $1
     FOR UPDATE`,
    [input.orderId],
  );

  const existingPayment = paymentRows[0];
  const idempotencyKey = input.attemptKey || `order:${input.orderId}:manual-pix`;

  let payment = existingPayment;
  if (existingPayment) {
    const { rows } = await client.query(
      `UPDATE public.payments
       SET amount = $3,
           provider = 'manual_pix',
           status = CASE WHEN status IN ('pago', 'paid') THEN status ELSE 'pendente' END,
           idempotency_key = $4,
           last_error = NULL,
           updated_at = now()
       WHERE id = $5
       RETURNING *`,
      [input.orderId, input.storeId, Number(order.total || 0), idempotencyKey, existingPayment.id],
    );
    payment = rows[0];
  } else {
    const { rows } = await client.query(
      `INSERT INTO public.payments (order_id, store_id, amount, provider, status, idempotency_key)
       VALUES ($1, $2, $3, 'manual_pix', 'pendente', $4)
       RETURNING *`,
      [input.orderId, input.storeId, Number(order.total || 0), idempotencyKey],
    );
    payment = rows[0];
  }

  const { rows: updatedOrders } = await client.query(
    `UPDATE public.orders
     SET payment_status = CASE WHEN payment_status IN ('pago', 'paid') THEN payment_status ELSE 'pendente' END,
         status = CASE WHEN payment_status IN ('pago', 'paid') THEN status ELSE 'aguardando_pagamento' END,
         pix_payload = $3,
         pix_qr_code = NULL,
         waiting_payment_since = COALESCE(waiting_payment_since, now()),
         updated_at = now()
     WHERE id = $1 AND store_id = $2
     RETURNING *`,
    [input.orderId, input.storeId, pixPayload],
  );

  return { order: updatedOrders[0] || order, payment, pixPayload };
};

export const createOrderPaymentForOrder = async (
  input: { orderId: string; storeId: string; attemptKey?: string; publicToken?: string },
  deps: PaymentDeps = defaultDeps,
) => {
  const reservation = await deps.withTransaction((client) => reserveManualPixPayment(client, input));

  deps.publishRealtime({ schema: "public", table: "orders", eventType: "UPDATE", new: reservation.order, old: null });
  deps.publishRealtime({ schema: "public", table: "payments", eventType: "UPDATE", new: reservation.payment, old: null });

  return {
    paymentId: reservation.payment.id,
    pixCode: reservation.pixPayload,
    qrCodeUrl: reservation.order.pix_qr_code || null,
    invoiceUrl: null,
    status: paidStatuses.has(String(reservation.payment.status)) ? "paid" : "pending",
    manual: true,
    instructions: reservation.order.payment_instructions || "Apos o pagamento, aguarde a confirmacao da loja.",
  };
};

export const getOrderPaymentInfoForOrder = async (
  input: { orderId: string; storeId: string; publicToken?: string },
  deps: PaymentDeps = defaultDeps,
) => createOrderPaymentForOrder(input, deps);

export const syncOrderPaymentStatus = async (
  input: { orderId: string; storeId: string; publicToken?: string },
  deps: PaymentDeps = defaultDeps,
) => {
  const { rows } = await deps.query(
    `SELECT o.id, o.status, o.payment_status, o.paid_at, p.status AS payment_row_status
     FROM public.orders o
     LEFT JOIN public.payments p ON p.order_id = o.id
     WHERE o.id = $1
       AND o.store_id = $2
       AND ($3::text IS NULL OR o.public_token = $3::text)
     LIMIT 1`,
    [input.orderId, input.storeId, input.publicToken || null],
  );
  const row = rows[0];
  if (!row) return { status: "pending", message: "Pedido nao encontrado." };
  if (paidStatuses.has(String(row.payment_status)) || paidStatuses.has(String(row.payment_row_status))) {
    return { status: "paid", orderStatus: row.status, paidAt: row.paid_at };
  }
  return {
    status: "pending",
    orderStatus: row.status,
    manual: true,
    message: "Aguardando confirmacao manual da loja.",
  };
};

export const approveManualPixPayment = async (
  input: { orderId: string; storeId: string },
  token?: string,
  deps: PaymentDeps = defaultDeps,
) => {
  const actor = await deps.getActor(token);
  if (!actor) throw new Error("Nao autenticado.");
  if (!actor.admin && !actor.ownedStoreIds.includes(input.storeId)) throw new Error("Acesso negado.");

  const result = await deps.withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [`manual-pix-paid:${input.orderId}`]);

    const { rows: orders } = await client.query(
      `SELECT *
       FROM public.orders
       WHERE id = $1 AND store_id = $2
       FOR UPDATE`,
      [input.orderId, input.storeId],
    );
    const order = orders[0];
    if (!order) throw new Error("Pedido nao encontrado.");
    if (order.payment_method !== "pix") throw new Error("Pedido nao usa pagamento PIX.");
    if (blockedOrderStatuses.has(String(order.status))) throw new Error("Nao e possivel aprovar pagamento de pedido cancelado ou encerrado.");
    if (paidStatuses.has(String(order.payment_status))) {
      return { order, alreadyPaid: true };
    }

    const { rows: payments } = await client.query(
      `SELECT *
       FROM public.payments
       WHERE order_id = $1 AND store_id = $2
       FOR UPDATE`,
      [input.orderId, input.storeId],
    );

    const payment = payments[0];
    if (payment && paidStatuses.has(String(payment.status))) {
      const { rows: updatedOrders } = await client.query(
        `UPDATE public.orders
         SET payment_status = 'pago',
             paid_at = COALESCE(paid_at, now()),
             payment_approved_by = COALESCE(payment_approved_by, $3::uuid),
             status = CASE WHEN status = 'aguardando_pagamento' THEN 'novo' ELSE status END,
             updated_at = now()
         WHERE id = $1 AND store_id = $2
         RETURNING *`,
        [input.orderId, input.storeId, actor.user.id],
      );
      return { order: updatedOrders[0], alreadyPaid: true };
    }

    if (payment) {
      await client.query(
        `UPDATE public.payments
         SET status = 'pago',
             paid_at = COALESCE(paid_at, now()),
             approved_by = $2::uuid,
             updated_at = now()
         WHERE id = $1`,
        [payment.id, actor.user.id],
      );
    } else {
      await client.query(
        `INSERT INTO public.payments (order_id, store_id, amount, provider, status, paid_at, approved_by)
         VALUES ($1, $2, COALESCE((SELECT total FROM public.orders WHERE id = $1), 0), 'manual_pix', 'pago', now(), $3::uuid)`,
        [input.orderId, input.storeId, actor.user.id],
      );
    }

    const { rows: updatedOrders } = await client.query(
      `UPDATE public.orders
       SET payment_status = 'pago',
           paid_at = COALESCE(paid_at, now()),
           payment_approved_by = $3::uuid,
           status = CASE WHEN status = 'aguardando_pagamento' THEN 'novo' ELSE status END,
           updated_at = now()
       WHERE id = $1 AND store_id = $2
       RETURNING *`,
      [input.orderId, input.storeId, actor.user.id],
    );

    await client.query(
      `INSERT INTO public.order_status_history (order_id, store_id, status, notes)
       SELECT $1, $2, 'novo', 'Pagamento PIX aprovado manualmente pela loja'
       WHERE NOT EXISTS (
         SELECT 1 FROM public.order_status_history
         WHERE order_id = $1 AND status = 'novo' AND notes = 'Pagamento PIX aprovado manualmente pela loja'
       )`,
      [input.orderId, input.storeId],
    );

    return { order: updatedOrders[0], alreadyPaid: false };
  });

  if (result.order) {
    deps.publishRealtime({ schema: "public", table: "orders", eventType: "UPDATE", new: result.order, old: null });
  }

  if (!result.alreadyPaid) {
    await deps.notifyStatus(input.orderId, "novo", "Pagamento PIX aprovado manualmente").catch((error) => {
      console.warn("Evolution status notification skipped:", error);
    });
  }

  return { success: true, status: "paid", order: result.order, alreadyPaid: result.alreadyPaid };
};
