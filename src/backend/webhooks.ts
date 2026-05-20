import { query } from "./db";
import { publishRealtime } from "./realtime";

export const handleAsaasWebhook = async (request: Request) => {
  const secret = process.env.ASAAS_WEBHOOK_SECRET?.trim();
  const signature = request.headers.get("asaas-access-token");
  if (secret && signature !== secret) return new Response("Unauthorized", { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { event, payment } = body || {};
  if (!payment) return Response.json({ error: "Payment data missing" }, { status: 400 });

  if (event === "PAYMENT_RECEIVED" || event === "PAYMENT_CONFIRMED") {
    if (payment.subscription || payment.externalReference) {
      const { rows: subscriptions } = await query(
        `UPDATE public.subscriptions
         SET status = 'ativa', last_payment_status = $1, updated_at = now()
         WHERE asaas_subscription_id = $2 OR store_id::text = $3
         RETURNING *`,
        [event, payment.subscription || null, payment.externalReference || null],
      ).catch(() => ({ rows: [] as any[] }));
      for (const subscription of subscriptions) {
        publishRealtime({ schema: "public", table: "subscriptions", eventType: "UPDATE", new: subscription, old: subscription });
      }
    }

    const { rows: payments } = await query(
      `UPDATE public.payments
       SET status = 'pago', paid_at = now(), external_id = COALESCE(external_id, $1), asaas_id = COALESCE(asaas_id, $1)
       WHERE external_id = $1 OR asaas_id = $1 OR order_id::text = $2
       RETURNING *`,
      [payment.id, payment.externalReference || null],
    );

    for (const row of payments) {
      publishRealtime({ schema: "public", table: "payments", eventType: "UPDATE", new: row, old: row });
      const { rows: orders } = await query(
        `UPDATE public.orders SET status = 'novo', payment_status = 'pago', updated_at = now() WHERE id = $1 RETURNING *`,
        [row.order_id],
      );
      if (orders[0]) {
        publishRealtime({ schema: "public", table: "orders", eventType: "UPDATE", new: orders[0], old: orders[0] });
        await query(
          `INSERT INTO public.order_status_history (order_id, store_id, status, notes)
           VALUES ($1, $2, 'novo', 'Pagamento PIX confirmado via Webhook (Asaas)')`,
          [row.order_id, row.store_id],
        ).catch(() => null);
      }
    }
  }

  return Response.json({ success: true });
};
