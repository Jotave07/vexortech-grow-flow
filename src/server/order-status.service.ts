import { z } from "zod";
import { getActor } from "@/backend/auth";
import { publishRealtime } from "@/backend/realtime";
import { withTransaction } from "@/backend/db";
import { sendOrderStatusNotification } from "@/functions/evolution.server";

const statuses = [
  "confirmado",
  "em_preparo",
  "saiu_para_entrega",
  "pronto_para_retirada",
  "entregue",
  "cancelado",
] as const;

const inputSchema = z.object({
  orderId: z.string().uuid(),
  storeId: z.string().uuid(),
  status: z.enum(statuses),
  note: z.string().max(500).optional().nullable(),
});

const finalStatuses = new Set(["entregue", "cancelado", "estornado"]);

const transitionAllowed = (current: string, next: string, paymentStatus?: string) => {
  if (finalStatuses.has(current)) return false;
  if (next === "cancelado") return true;
  if (current === "aguardando_pagamento") return next === "confirmado" && paymentStatus === "pago";
  if (current === "novo") return next === "confirmado";
  if (current === "confirmado") return next === "em_preparo";
  if (current === "em_preparo") return next === "saiu_para_entrega" || next === "pronto_para_retirada";
  if (current === "saiu_para_entrega") return next === "entregue";
  if (current === "pronto_para_retirada") return next === "entregue";
  return false;
};

const timestampColumnByStatus: Record<string, string> = {
  confirmado: "accepted_at",
  em_preparo: "preparation_started_at",
  saiu_para_entrega: "out_for_delivery_at",
  pronto_para_retirada: "ready_at",
  entregue: "delivered_at",
  cancelado: "cancelled_at",
};

let optionalWriteCounter = 0;

const runOptionalWrite = async (
  client: { query: (text: string, params?: unknown[]) => Promise<unknown> },
  label: string,
  text: string,
  params: unknown[] = [],
) => {
  const savepoint = `optional_order_status_${++optionalWriteCounter}`;
  try {
    await client.query(`SAVEPOINT ${savepoint}`);
    await client.query(text, params);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (error: any) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => null);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => null);
    console.warn(`Optional order status write skipped (${label}):`, error?.message || error);
  }
};

export const updateOrderStatusHandler = async (body: unknown, token?: string) => {
  const input = inputSchema.parse(body);
  const actor = await getActor(token);
  if (!actor) throw new Error("Nao autenticado.");
  if (!actor.admin && !actor.ownedStoreIds.includes(input.storeId)) throw new Error("Acesso negado.");

  const updated = await withTransaction(async (client) => {
    const { rows: orderRows } = await client.query(
      `SELECT *
       FROM public.orders
       WHERE id = $1 AND store_id = $2
       FOR UPDATE`,
      [input.orderId, input.storeId],
    );
    const order = orderRows[0];
    if (!order) throw new Error("Pedido nao encontrado.");
    if (!transitionAllowed(order.status, input.status, order.payment_status)) {
      throw new Error("Transicao de status invalida para este pedido.");
    }

    const timestampColumn = timestampColumnByStatus[input.status];
    const updates = ["status = $3", "updated_at = now()"];
    const params: unknown[] = [input.orderId, input.storeId, input.status];
    if (timestampColumn) updates.push(`${timestampColumn} = COALESCE(${timestampColumn}, now())`);

    if (input.status === "entregue") {
      if (order.payment_method === "pix" && order.payment_status !== "pago") {
        throw new Error("PIX precisa estar pago antes de concluir o pedido.");
      }
      if (order.payment_method !== "pix") updates.push("payment_status = 'pago'");
    }
    if (input.status === "cancelado") {
      updates.push(order.payment_method === "pix" && order.payment_status === "pago"
        ? "payment_status = 'estorno_pendente'"
        : "payment_status = 'cancelado'");
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE public.orders
       SET ${updates.join(", ")}
       WHERE id = $1 AND store_id = $2
       RETURNING *`,
      params,
    );
    const updatedOrder = updatedRows[0];

    if (input.status === "entregue" && updatedOrder.customer_id && order.status !== "entregue") {
      await runOptionalWrite(client, "customer_totals",
        `UPDATE public.customers
         SET total_orders = COALESCE(total_orders, 0) + 1,
             total_spent = COALESCE(total_spent, 0) + $2,
             last_order_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [updatedOrder.customer_id, Number(updatedOrder.total || 0)],
      );
    }

    if (input.status === "entregue" && updatedOrder.payment_method !== "pix") {
      await runOptionalWrite(client, "cash_or_card_payment_paid",
        `UPDATE public.payments
         SET status = 'pago', paid_at = COALESCE(paid_at, now()), updated_at = now()
         WHERE order_id = $1`,
        [input.orderId],
      );
    }

    if (input.status === "cancelado") {
      const paymentStatus = order.payment_method === "pix" && order.payment_status === "pago"
        ? "estorno_pendente"
        : "cancelado";
      await runOptionalWrite(client, "cancel_payment",
        `UPDATE public.payments
         SET status = $2, updated_at = now()
         WHERE order_id = $1`,
        [input.orderId, paymentStatus],
      );
    }

    await client.query(
      `INSERT INTO public.order_status_history (order_id, store_id, status, notes)
       SELECT $1, $2, $3, $4
       WHERE NOT EXISTS (
         SELECT 1
         FROM public.order_status_history
         WHERE order_id = $1 AND status = $3 AND COALESCE(notes, '') = COALESCE($4::text, '')
       )`,
      [input.orderId, input.storeId, input.status, input.note || null],
    );

    return { oldOrder: order, updatedOrder };
  });

  publishRealtime({
    schema: "public",
    table: "orders",
    eventType: "UPDATE",
    old: updated.oldOrder,
    new: updated.updatedOrder,
  });

  await sendOrderStatusNotification(input.orderId, input.status, input.note || null).catch((error) => {
    console.warn("Evolution status notification skipped:", error);
  });

  return updated.updatedOrder;
};
