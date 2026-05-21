import crypto from "node:crypto";
import { query, withTransaction } from "./db";
import { isProductionRuntime, validateRuntimeEnv } from "./env";
import { publishRealtime } from "./realtime";

const paidEvents = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"]);
const failedEvents = new Set(["PAYMENT_OVERDUE"]);
const cancelledEvents = new Set(["PAYMENT_DELETED", "PAYMENT_CANCELLED"]);
const refundedEvents = new Set(["PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED"]);

const safeEqual = (left?: string | null, right?: string | null) => {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const paymentStatusForEvent = (event: string) => {
  if (paidEvents.has(event)) return "pago";
  if (failedEvents.has(event)) return "falhou";
  if (cancelledEvents.has(event)) return "cancelado";
  if (refundedEvents.has(event)) return "estornado";
  return null;
};

const safeJsonError = (message: string, status: number) => Response.json({ error: message }, { status });

const updateSubscriptionIfPresent = async (event: string, payment: any) => {
  if (!paidEvents.has(event)) return;
  if (!payment.subscription && !payment.externalReference) return;
  const { rows } = await query(
    `UPDATE public.subscriptions
     SET status = 'ativa', last_payment_status = $1, updated_at = now()
     WHERE asaas_subscription_id = $2 OR store_id::text = $3
     RETURNING *`,
    [event, payment.subscription || null, payment.externalReference || null],
  ).catch(() => ({ rows: [] as any[] }));

  for (const subscription of rows) {
    publishRealtime({ schema: "public", table: "subscriptions", eventType: "UPDATE", new: subscription, old: subscription });
  }
};

export const handleAsaasWebhook = async (request: Request) => {
  try {
    validateRuntimeEnv({ requireWebhookSecret: true });
  } catch (error: any) {
    console.error("[asaas:webhook] webhook secret missing or runtime invalid", { production: isProductionRuntime() });
    return safeJsonError(isProductionRuntime() ? "Webhook not configured" : error?.message || "Invalid runtime", 500);
  }

  const secret = process.env.ASAAS_WEBHOOK_SECRET?.trim();
  const accessToken = request.headers.get("asaas-access-token");
  if (secret && !safeEqual(accessToken, secret)) {
    return safeJsonError("Unauthorized", 401);
  }
  if (!secret && isProductionRuntime()) return safeJsonError("Webhook not configured", 500);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return safeJsonError("Invalid JSON", 400);
  }

  const event = String(body?.event || "");
  const payment = body?.payment;
  if (!event || !payment?.id || !payment?.externalReference) {
    return safeJsonError("Invalid payload", 400);
  }

  const mappedStatus = paymentStatusForEvent(event);
  if (!mappedStatus) return Response.json({ success: true, ignored: true });

  await updateSubscriptionIfPresent(event, payment);

  const result = await withTransaction(async (client) => {
    const { rows: payments } = await client.query(
      `SELECT p.*, o.id AS order_exists
       FROM public.payments p
       JOIN public.orders o ON o.id = p.order_id
       WHERE (p.external_id = $1 OR p.asaas_id = $1 OR (p.order_id::text = $2 AND (p.external_id IS NULL OR p.external_id = $1)))
         AND o.id::text = $2
       LIMIT 1
       FOR UPDATE OF p, o`,
      [payment.id, payment.externalReference],
    );
    const localPayment = payments[0];
    if (!localPayment) return { updated: false };

    const wasPaid = localPayment.status === "pago";
    const { rows: updatedPayments } = await client.query(
      `UPDATE public.payments
       SET status = $2,
           external_id = COALESCE(external_id, $3),
           asaas_id = COALESCE(asaas_id, $3),
           paid_at = CASE WHEN $2 = 'pago' THEN COALESCE(paid_at, now()) ELSE paid_at END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [localPayment.id, mappedStatus, payment.id],
    );

    let updatedOrder = null;
    if (mappedStatus === "pago") {
      const { rows: orders } = await client.query(
        `UPDATE public.orders
         SET status = 'novo', payment_status = 'pago', updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [localPayment.order_id],
      );
      updatedOrder = orders[0] || null;

      if (updatedOrder && !wasPaid) {
        await client.query(
          `INSERT INTO public.order_status_history (order_id, store_id, status, notes)
           SELECT $1, $2, 'novo', 'Pagamento PIX confirmado via Webhook (Asaas)'
           WHERE NOT EXISTS (
             SELECT 1 FROM public.order_status_history
             WHERE order_id = $1 AND status = 'novo' AND notes = 'Pagamento PIX confirmado via Webhook (Asaas)'
           )`,
          [localPayment.order_id, localPayment.store_id],
        );
      }
    } else {
      const { rows: orders } = await client.query(
        `UPDATE public.orders
         SET payment_status = $2, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [localPayment.order_id, mappedStatus],
      );
      updatedOrder = orders[0] || null;
    }

    return { updated: true, payment: updatedPayments[0], order: updatedOrder };
  });

  if (!result.updated) {
    console.warn("[asaas:webhook] payment ignored: no matching local payment/order", {
      event,
      paymentId: payment.id,
      hasExternalReference: Boolean(payment.externalReference),
    });
    return Response.json({ success: true, ignored: true });
  }

  if (result.payment) {
    publishRealtime({ schema: "public", table: "payments", eventType: "UPDATE", new: result.payment, old: result.payment });
  }
  if (result.order) {
    publishRealtime({ schema: "public", table: "orders", eventType: "UPDATE", new: result.order, old: result.order });
  }

  return Response.json({ success: true });
};
