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

const hashPayload = (payload: unknown) =>
  crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

const redactPayload = (body: any) => ({
  event: body?.event || null,
  payment: body?.payment
    ? {
      id: body.payment.id || null,
      status: body.payment.status || null,
      externalReference: body.payment.externalReference || null,
      value: body.payment.value ?? null,
      billingType: body.payment.billingType || null,
      dateCreated: body.payment.dateCreated || null,
      paymentDate: body.payment.paymentDate || null,
    }
    : null,
});

const insertPaymentEvent = async (
  client: { query: (sql: string, params?: unknown[]) => Promise<any> },
  input: { event: string; payment: any; body: any; orderId?: string | null; storeId?: string | null },
) => {
  const redacted = redactPayload(input.body);
  const { rows } = await client.query(
    `INSERT INTO public.payment_events (
       provider, event_type, external_payment_id, order_id, store_id, payload_hash, payload_redacted
     )
     VALUES ('asaas', $1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      input.event,
      input.payment?.id || null,
      input.orderId || null,
      input.storeId || null,
      hashPayload(redacted),
      JSON.stringify(redacted),
    ],
  );
  return Boolean(rows[0]);
};

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
      `SELECT p.*, o.id AS order_exists, o.total AS order_total
       FROM public.payments p
       JOIN public.orders o ON o.id = p.order_id
       WHERE (p.external_id = $1 OR p.asaas_id = $1 OR (p.order_id::text = $2 AND (p.external_id IS NULL OR p.external_id = $1)))
         AND o.id::text = $2
       LIMIT 1
       FOR UPDATE OF p, o`,
      [payment.id, payment.externalReference],
    );
    const localPayment = payments[0];
    if (!localPayment) {
      await insertPaymentEvent(client, { event, payment, body });
      return { updated: false };
    }

    await insertPaymentEvent(client, {
      event,
      payment,
      body,
      orderId: localPayment.order_id,
      storeId: localPayment.store_id,
    });

    if (mappedStatus === "pago") {
      const expected = Number(localPayment.order_total || 0);
      const received = Number(payment.value);
      if (!Number.isFinite(received) || Math.abs(received - expected) > 0.01) {
        await client.query(
          `UPDATE public.payments
           SET last_error = $2, updated_at = now()
           WHERE id = $1`,
          [localPayment.id, `Valor divergente no webhook Asaas. Esperado ${expected}, recebido ${payment.value ?? "ausente"}`],
        );
        return { updated: false, suspicious: true };
      }
    }

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
      suspicious: Boolean((result as any).suspicious),
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
