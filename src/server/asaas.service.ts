import type pg from "pg";
import { query, withTransaction } from "@/backend/db";
import { publishRealtime } from "@/backend/realtime";
import { sendOrderStatusNotification } from "@/functions/evolution.server";
import { asaas } from "./asaas.server";

type DbClient = Pick<pg.PoolClient, "query">;

type PaymentDeps = {
  withTransaction: typeof withTransaction;
  query: typeof query;
  gateway: typeof asaas;
  publishRealtime: typeof publishRealtime;
  notifyStatus: typeof sendOrderStatusNotification;
};

const defaultDeps: PaymentDeps = {
  withTransaction,
  query,
  gateway: asaas,
  publishRealtime,
  notifyStatus: sendOrderStatusNotification,
};

const paidStatuses = new Set(["pago"]);
const reusableStatuses = new Set(["payment_creating", "criando", "pendente", "pago"]);

const todayIsoDate = () => new Date().toISOString().split("T")[0];

const errorDescription = (value: any, fallback = "Falha ao processar pagamento.") =>
  String(value?.errors?.[0]?.description || value?.message || fallback);

const toPublicPaymentStatus = (asaasStatus?: string) => {
  if (asaasStatus === "RECEIVED" || asaasStatus === "CONFIRMED" || asaasStatus === "RECEIVED_IN_CASH") return "pago";
  if (asaasStatus === "REFUNDED" || asaasStatus === "PARTIALLY_REFUNDED") return "estornado";
  if (asaasStatus === "DELETED" || asaasStatus === "CANCELLED") return "cancelado";
  if (asaasStatus === "OVERDUE") return "falhou";
  return "pendente";
};

const updatePaymentFailure = async (
  orderId: string,
  message: string,
  deps: PaymentDeps,
) => {
  await deps.query(
    `UPDATE public.payments
     SET status = 'falhou', last_error = $2, updated_at = now()
     WHERE order_id = $1`,
    [orderId, message.slice(0, 1000)],
  ).catch(() => null);
};

const fetchQrCode = async (apiKey: string, paymentId: string, deps: PaymentDeps) => {
  const qrCode = await deps.gateway.getPixQrCode(apiKey, paymentId);
  if (qrCode?.errors) {
    return {
      paymentId,
      pixCode: null,
      qrCodeUrl: null,
      invoiceUrl: null,
      status: "pendente",
      error: errorDescription(qrCode, "Pagamento criado, mas o QR Code ainda nao esta disponivel."),
    };
  }

  return {
    paymentId,
    pixCode: qrCode?.payload || null,
    qrCodeUrl: qrCode?.encodedImage || null,
    invoiceUrl: null,
    status: "pendente",
    error: null,
  };
};

const reserveLocalPayment = async (
  client: DbClient,
  input: { orderId: string; storeId: string; attemptKey?: string },
) => {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`payment:${input.orderId}`]);

  const { rows: orders } = await client.query(
    `SELECT o.*, ss.asaas_api_key
     FROM public.orders o
     JOIN public.store_settings ss ON ss.store_id = o.store_id
     WHERE o.id = $1 AND o.store_id = $2
     FOR UPDATE OF o`,
    [input.orderId, input.storeId],
  );
  const order = orders[0];
  if (!order) throw new Error("Pedido nao encontrado.");
  if (order.payment_method !== "pix") throw new Error("Pedido nao usa pagamento PIX.");

  const { rows: paymentRows } = await client.query(
    `SELECT *
     FROM public.payments
     WHERE order_id = $1
     FOR UPDATE`,
    [input.orderId],
  );
  const existingPayment = paymentRows[0];
  const externalId = existingPayment?.external_id || existingPayment?.asaas_id;

  if (externalId && reusableStatuses.has(String(existingPayment.status))) {
    return { order, payment: existingPayment, externalId, shouldCreate: false };
  }

  const idempotencyKey = input.attemptKey || `order:${input.orderId}:pix`;
  const params = [
    input.orderId,
    input.storeId,
    Number(order.total || 0),
    idempotencyKey,
  ];

  if (existingPayment) {
    const { rows } = await client.query(
      `UPDATE public.payments
       SET amount = $3, status = 'payment_creating', idempotency_key = $4, last_error = NULL, updated_at = now()
       WHERE id = $5
       RETURNING *`,
      [...params, existingPayment.id],
    );
    return { order, payment: rows[0], externalId: null, shouldCreate: true };
  }

  const { rows } = await client.query(
    `INSERT INTO public.payments (order_id, store_id, amount, status, idempotency_key)
     VALUES ($1, $2, $3, 'payment_creating', $4)
     RETURNING *`,
    params,
  );
  return { order, payment: rows[0], externalId: null, shouldCreate: true };
};

export const createOrderPaymentForOrder = async (
  input: { orderId: string; storeId: string; attemptKey?: string },
  deps: PaymentDeps = defaultDeps,
) => {
  const reservation = await deps.withTransaction((client) => reserveLocalPayment(client, input));
  const apiKey = reservation.order.asaas_api_key;

  if (!apiKey) {
    const message = "Loja nao configurou o gateway de pagamento Asaas.";
    await updatePaymentFailure(input.orderId, message, deps);
    throw new Error(message);
  }

  if (reservation.externalId) {
    return fetchQrCode(apiKey, reservation.externalId, deps);
  }

  const remoteExisting = await deps.gateway.findPaymentByExternalReference(apiKey, input.orderId);
  const remotePayment = !remoteExisting?.errors ? remoteExisting?.data?.[0] : null;
  if (remotePayment?.id) {
    await deps.query(
      `UPDATE public.payments
       SET external_id = $2, asaas_id = $2, status = $3, last_error = NULL, updated_at = now()
       WHERE order_id = $1`,
      [input.orderId, remotePayment.id, toPublicPaymentStatus(remotePayment.status)],
    );
    return fetchQrCode(apiKey, remotePayment.id, deps);
  }

  const customer = await deps.gateway.createCustomer(
    {
      name: reservation.order.customer_name || "Cliente",
      email: reservation.order.customer_email || "cliente@sememail.com.br",
      cpfCnpj: reservation.order.customer_document || "",
      mobilePhone: reservation.order.customer_phone || undefined,
    },
    apiKey,
  );

  if (customer?.errors || !customer?.id) {
    const message = `Erro Asaas (Cliente): ${errorDescription(customer)}`;
    await updatePaymentFailure(input.orderId, message, deps);
    throw new Error(message);
  }

  const idempotencyKey = input.attemptKey || `order:${input.orderId}:pix`;
  const payment = await deps.gateway.createStorePayment(
    apiKey,
    {
      customer: customer.id,
      value: Number(reservation.order.total),
      dueDate: todayIsoDate(),
      description: `Pedido #${reservation.order.order_number} - ${reservation.order.customer_name}`,
      externalReference: reservation.order.id,
    },
    { idempotencyKey },
  );

  if (payment?.errors || !payment?.id) {
    const message = `Erro Asaas da Loja: ${errorDescription(payment)}`;
    await updatePaymentFailure(input.orderId, message, deps);
    throw new Error(message);
  }

  await deps.query(
    `UPDATE public.payments
     SET external_id = $2, asaas_id = $2, status = 'pendente', last_error = NULL, updated_at = now()
     WHERE order_id = $1`,
    [input.orderId, payment.id],
  );

  return {
    ...(await fetchQrCode(apiKey, payment.id, deps)),
    invoiceUrl: payment.invoiceUrl || null,
  };
};

export const getOrderPaymentInfoForOrder = async (
  input: { orderId: string; storeId: string },
  deps: PaymentDeps = defaultDeps,
) => {
  return createOrderPaymentForOrder(input, deps);
};

export const syncOrderPaymentStatus = async (
  input: { orderId: string; storeId: string },
  deps: PaymentDeps = defaultDeps,
) => {
  const { rows: contextRows } = await deps.query(
    `SELECT p.*, ss.asaas_api_key
     FROM public.payments p
     JOIN public.store_settings ss ON ss.store_id = p.store_id
     WHERE p.order_id = $1 AND p.store_id = $2
     LIMIT 1`,
    [input.orderId, input.storeId],
  );
  const payment = contextRows[0];
  if (!payment?.asaas_api_key) return { status: "pending", message: "Gateway nao configurado" };
  const externalId = payment.external_id || payment.asaas_id;
  if (!externalId) return { status: "pending", message: "Pagamento nao encontrado" };
  if (paidStatuses.has(String(payment.status))) return { status: "paid" };

  const asaasPayment = await deps.gateway.getPayment(payment.asaas_api_key, externalId);
  if (asaasPayment?.errors) {
    return { status: "pending", message: errorDescription(asaasPayment), asaasStatus: null };
  }

  const mappedStatus = toPublicPaymentStatus(asaasPayment.status);
  if (mappedStatus !== "pago") {
    await deps.query(
      `UPDATE public.payments SET status = $2, updated_at = now() WHERE id = $1`,
      [payment.id, mappedStatus],
    ).catch(() => null);
    return { status: "pending", asaasStatus: asaasPayment.status };
  }

  await deps.withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`payment-paid:${input.orderId}`]);

    const { rows: lockedPayments } = await client.query(
      `SELECT * FROM public.payments WHERE id = $1 FOR UPDATE`,
      [payment.id],
    );
    const locked = lockedPayments[0];
    if (!locked) throw new Error("Pagamento nao encontrado.");
    const wasPaid = locked.status === "pago";

    await client.query(
      `UPDATE public.payments
       SET status = 'pago', paid_at = COALESCE(paid_at, now()), updated_at = now()
       WHERE id = $1`,
      [payment.id],
    );
    const { rows: orders } = await client.query(
      `UPDATE public.orders
       SET status = 'novo', payment_status = 'pago', updated_at = now()
       WHERE id = $1 AND store_id = $2
       RETURNING *`,
      [input.orderId, input.storeId],
    );

    if (orders[0] && !wasPaid) {
      await client.query(
        `INSERT INTO public.order_status_history (order_id, store_id, status, notes)
         SELECT $1, $2, 'novo', 'Pagamento PIX confirmado automaticamente'
         WHERE NOT EXISTS (
           SELECT 1 FROM public.order_status_history
           WHERE order_id = $1 AND status = 'novo' AND notes = 'Pagamento PIX confirmado automaticamente'
         )`,
        [input.orderId, input.storeId],
      );
    }
  });

  await deps.notifyStatus(input.orderId, "novo", "Pagamento PIX confirmado automaticamente").catch((error) => {
    console.warn("Evolution status notification skipped:", error);
  });

  return { status: "paid" };
};
