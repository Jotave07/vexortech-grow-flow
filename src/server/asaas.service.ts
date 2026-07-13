import type pg from "pg";
import { getActor } from "@/backend/auth";
import { query, withTransaction } from "@/backend/db";
import { publishRealtime } from "@/backend/realtime";
import { sendOrderStatusNotification } from "@/functions/evolution.server";
import {
  pixPaymentGateways,
  resolvePixGatewayConfig,
  type PixPaymentGateway,
} from "./payment-gateways";
import { asaasCentral } from "./asaas.central";
import { applyPaymentEscrow } from "./payment.escrow";
import { createPixCopyPastePayload } from "./pix";
import { normalizeDocument } from "@/lib/validators";

type DbClient = Pick<pg.PoolClient, "query">;

type PaymentDeps = {
  withTransaction: typeof withTransaction;
  query: typeof query;
  gateways: Record<string, PixPaymentGateway>;
  publishRealtime: typeof publishRealtime;
  notifyStatus: typeof sendOrderStatusNotification;
  getActor: typeof getActor;
};

const defaultDeps: PaymentDeps = {
  withTransaction,
  query,
  gateways: pixPaymentGateways,
  publishRealtime,
  notifyStatus: sendOrderStatusNotification,
  getActor,
};

const paidStatuses = new Set(["pago", "paid"]);
const reusableStatuses = new Set(["payment_creating", "criando", "pendente", "pago", "paid"]);
const blockedOrderStatuses = new Set(["cancelado", "cancelled", "finalizado", "delivered", "entregue"]);

const todayIsoDate = () => new Date().toISOString().split("T")[0];

const errorDescription = (value: any, fallback = "Falha ao processar pagamento.") =>
  String(value?.errors?.[0]?.description || value?.message || fallback);

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

const fetchQrCode = async (
  gatewayConfig: NonNullable<ReturnType<typeof resolvePixGatewayConfig>>,
  paymentId: string,
) => {
  const qrCode = await gatewayConfig.gateway.getPixQrCode(gatewayConfig, paymentId);
  if (qrCode?.errors) {
    return {
      paymentId,
      pixCode: null,
      qrCodeUrl: null,
      invoiceUrl: null,
      status: "pendente",
      error: errorDescription(qrCode, "Pagamento criado, mas o QR Code ainda nao esta disponivel."),
      manual: false,
    };
  }

  return {
    paymentId,
    pixCode: qrCode?.payload || null,
    qrCodeUrl: qrCode?.encodedImage || null,
    invoiceUrl: null,
    status: "pendente",
    error: null,
    manual: false,
  };
};

const fetchCentralQrCode = async (paymentId: string) => {
  const qrCode = await asaasCentral.getPixQrCode(paymentId);
  if (qrCode?.errors) {
    return {
      paymentId,
      pixCode: null,
      qrCodeUrl: null,
      invoiceUrl: null,
      status: "pendente",
      error: errorDescription(qrCode, "Pagamento criado, mas o QR Code ainda nao esta disponivel."),
      manual: false,
    };
  }
  return {
    paymentId,
    pixCode: qrCode?.payload || null,
    qrCodeUrl: qrCode?.encodedImage || null,
    invoiceUrl: null,
    status: "pendente",
    error: null,
    manual: false,
  };
};

const reserveLocalPayment = async (
  client: DbClient,
  input: { orderId: string; storeId: string; attemptKey?: string; publicToken?: string },
) => {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [`payment:${input.orderId}`]);

  const { rows: orders } = await client.query(
    `SELECT o.*, ss.asaas_api_key, ss.payment_gateway_provider, ss.payment_gateway_api_key,
            ss.payment_gateway_config, ss.financeiro_ativo, ss.pix_key, ss.pix_key_type,
            ss.payment_instructions, st.name AS store_name, st.city AS store_city
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

const createOrFetchManualPayment = async (
  input: { orderId: string; storeId: string; attemptKey?: string; publicToken?: string },
  deps: PaymentDeps,
) => deps.withTransaction(async (client) => {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`,
    [`manual-pix:${input.orderId}`],
  );

  const { rows: orders } = await client.query(
    `SELECT o.*, ss.pix_key, ss.pix_key_type, ss.payment_instructions,
            st.name AS store_name, st.city AS store_city
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
  if (!String(order.pix_key || "").trim()) {
    throw new Error("Loja nao cadastrou a chave Pix para receber pedidos.");
  }

  const pixPayload = order.pix_payload || createPixCopyPastePayload({
    pixKey: order.pix_key,
    pixKeyType: order.pix_key_type,
    amount: Number(order.total || 0),
    merchantName: order.store_name || "Hype Delivery",
    merchantCity: order.store_city || "BRASIL",
    txid: `PEDIDO${String(order.order_number || order.id).replace(/\W/g, "").slice(0, 19)}`.slice(0, 25) || "PEDIDO",
    description: `Pedido #${order.order_number || order.id} - ${order.customer_name || "Cliente"}`,
  });
  const idempotencyKey = input.attemptKey || `order:${input.orderId}:manual-pix`;

  const { rows: payments } = await client.query(
    `INSERT INTO public.payments (order_id, store_id, amount, provider, status, idempotency_key)
     VALUES ($1, $2, $3, 'manual_pix', 'pendente', $4)
     ON CONFLICT (order_id) WHERE order_id IS NOT NULL DO UPDATE SET
       amount = EXCLUDED.amount,
       provider = 'manual_pix',
       status = CASE WHEN public.payments.status IN ('pago', 'paid') THEN public.payments.status ELSE 'pendente' END,
       idempotency_key = EXCLUDED.idempotency_key,
       last_error = NULL,
       updated_at = now()
     WHERE public.payments.provider = 'manual_pix'
        OR (
          public.payments.status IN ('payment_creating', 'criando')
          AND public.payments.external_id IS NULL
          AND public.payments.asaas_id IS NULL
        )
     RETURNING *`,
    [input.orderId, input.storeId, Number(order.total || 0), idempotencyKey],
  );
  if (!payments[0]) {
    throw new Error("Este pedido ja possui uma cobranca gerenciada automaticamente.");
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

  return {
    order: updatedOrders[0] || order,
    payment: payments[0],
    pixPayload,
    instructions: order.payment_instructions || "Apos o pagamento, aguarde a confirmacao da loja.",
  };
});

// ── Modelo CENTRAL: cobranca PIX na conta da plataforma ────────────────────

const createOrFetchCentralPayment = async (
  reservation: Awaited<ReturnType<typeof reserveLocalPayment>>,
  input: { orderId: string },
  deps: PaymentDeps,
) => {
  if (!asaasCentral.isConfigured()) {
    const message = "Conta Asaas central nao configurada (ASAAS_API_KEY).";
    await updatePaymentFailure(input.orderId, message, deps);
    throw new Error(message);
  }
  const order = reservation.order;

  if (reservation.externalId) {
    return fetchCentralQrCode(reservation.externalId);
  }

  // reaproveita cobranca remota se ja existir para este pedido
  const remoteExisting = await asaasCentral.findPaymentByExternalReference(order.id);
  const remotePayment = !remoteExisting?.errors ? remoteExisting?.data?.[0] : null;
  if (remotePayment?.id) {
    await deps.query(
      `UPDATE public.payments
       SET external_id = $2, asaas_id = $2, provider = 'asaas-central', status = $3, last_error = NULL, updated_at = now()
       WHERE order_id = $1`,
      [input.orderId, remotePayment.id, asaasCentral.mapPaymentStatus(remotePayment.status)],
    );
    return fetchCentralQrCode(remotePayment.id);
  }

  // cliente na conta central (find-or-create por documento)
  const doc = normalizeDocument(order.customer_document || "");
  let customerId: string | null = null;
  if (doc) {
    const found = await asaasCentral.findCustomerByDocument(doc);
    customerId = !found?.errors ? found?.data?.[0]?.id || null : null;
  }
  if (!customerId) {
    const customer = await asaasCentral.createCustomer({
      name: order.customer_name || "Cliente",
      email: order.customer_email || "cliente@sememail.com.br",
      cpfCnpj: doc,
      mobilePhone: order.customer_phone || undefined,
    });
    if (customer?.errors || !customer?.id) {
      const message = `Erro do gateway central (cliente): ${errorDescription(customer)}`;
      await updatePaymentFailure(input.orderId, message, deps);
      throw new Error(message);
    }
    customerId = customer.id;
  }

  if (!customerId) {
    const message = "Erro do gateway central: nao foi possivel resolver o cliente.";
    await updatePaymentFailure(input.orderId, message, deps);
    throw new Error(message);
  }

  const idempotencyKey = `order:${input.orderId}:pix:central`;
  const payment = await asaasCentral.createPixPayment(
    {
      customer: customerId,
      value: Number(order.total),
      dueDate: todayIsoDate(),
      description: `Pedido #${order.order_number} - ${order.customer_name}`,
      externalReference: order.id,
    },
    { idempotencyKey },
  );
  if (payment?.errors || !payment?.id) {
    const message = `Erro do gateway central: ${errorDescription(payment)}`;
    await updatePaymentFailure(input.orderId, message, deps);
    throw new Error(message);
  }

  await deps.query(
    `UPDATE public.payments
     SET external_id = $2, asaas_id = $2, provider = 'asaas-central', status = 'pendente', last_error = NULL, updated_at = now()
     WHERE order_id = $1`,
    [input.orderId, payment.id],
  );
  return {
    ...(await fetchCentralQrCode(payment.id)),
    invoiceUrl: payment.invoiceUrl || null,
  };
};

export const createOrderPaymentForOrder = async (
  input: { orderId: string; storeId: string; attemptKey?: string; publicToken?: string },
  deps: PaymentDeps = defaultDeps,
) => {
  const reservation = await deps.withTransaction((client) => reserveLocalPayment(client, input));

  // Modelo central: usa a conta da plataforma (escrow + repasse pos-entrega).
  if (reservation.order.financeiro_ativo) {
    return createOrFetchCentralPayment(reservation, input, deps);
  }

  // Modelo descentralizado (legado): usa a chave Asaas da propria loja.
  const gatewayConfig = resolvePixGatewayConfig(reservation.order, deps.gateways);
  if (!gatewayConfig) {
    if (!String(reservation.order.pix_key || "").trim()) {
      const message = "Loja nao cadastrou a chave Pix para receber pedidos.";
      await updatePaymentFailure(input.orderId, message, deps);
      throw new Error(message);
    }

    const manualPayment = await createOrFetchManualPayment(input, deps);
    deps.publishRealtime({ schema: "public", table: "orders", eventType: "UPDATE", new: manualPayment.order, old: null });
    deps.publishRealtime({ schema: "public", table: "payments", eventType: "UPDATE", new: manualPayment.payment, old: null });
    return {
      paymentId: manualPayment.payment.id,
      pixCode: manualPayment.pixPayload,
      qrCodeUrl: manualPayment.order.pix_qr_code || null,
      invoiceUrl: null,
      status: paidStatuses.has(String(manualPayment.payment.status)) ? "paid" : "pending",
      error: null,
      manual: true,
      instructions: manualPayment.instructions,
    };
  }

  if (reservation.externalId) {
    return fetchQrCode(gatewayConfig, reservation.externalId);
  }

  const remoteExisting = await gatewayConfig.gateway.findPaymentByExternalReference(gatewayConfig, input.orderId);
  const remotePayment = !remoteExisting?.errors ? remoteExisting?.data?.[0] : null;
  if (remotePayment?.id) {
    await deps.query(
      `UPDATE public.payments
       SET external_id = $2, asaas_id = $2, provider = $3, status = $4, last_error = NULL, updated_at = now()
       WHERE order_id = $1`,
      [input.orderId, remotePayment.id, gatewayConfig.provider, gatewayConfig.gateway.mapPaymentStatus(remotePayment.status)],
    );
    return fetchQrCode(gatewayConfig, remotePayment.id);
  }

  const customer = await gatewayConfig.gateway.createCustomer(
    gatewayConfig,
    {
      name: reservation.order.customer_name || "Cliente",
      email: reservation.order.customer_email || "cliente@sememail.com.br",
      cpfCnpj: reservation.order.customer_document || "",
      mobilePhone: reservation.order.customer_phone || undefined,
    },
  );

  if (customer?.errors || !customer?.id) {
    const message = `Erro do gateway (cliente): ${errorDescription(customer)}`;
    await updatePaymentFailure(input.orderId, message, deps);
    throw new Error(message);
  }

  const idempotencyKey = input.attemptKey || `order:${input.orderId}:pix`;
  const payment = await gatewayConfig.gateway.createPixPayment(
    gatewayConfig,
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
    const message = `Erro do gateway da loja: ${errorDescription(payment)}`;
    await updatePaymentFailure(input.orderId, message, deps);
    throw new Error(message);
  }

  await deps.query(
    `UPDATE public.payments
     SET external_id = $2, asaas_id = $2, provider = $3, status = 'pendente', last_error = NULL, updated_at = now()
     WHERE order_id = $1`,
    [input.orderId, payment.id, gatewayConfig.provider],
  );

  return {
    ...(await fetchQrCode(gatewayConfig, payment.id)),
    invoiceUrl: payment.invoiceUrl || null,
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
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`,
      [`manual-pix-paid:${input.orderId}`],
    );
    const { rows: orders } = await client.query(
      `SELECT o.*, COALESCE(ss.financeiro_ativo, false) AS store_financeiro_ativo
       FROM public.orders o
       JOIN public.store_settings ss ON ss.store_id = o.store_id
       WHERE o.id = $1 AND o.store_id = $2
       FOR UPDATE OF o`,
      [input.orderId, input.storeId],
    );
    const order = orders[0];
    if (!order) throw new Error("Pedido nao encontrado.");
    if (order.payment_method !== "pix") throw new Error("Pedido nao usa pagamento PIX.");
    if (order.store_financeiro_ativo) {
      throw new Error("A confirmacao manual nao e permitida para cobrancas da conta central.");
    }
    if (blockedOrderStatuses.has(String(order.status))) {
      throw new Error("Nao e possivel aprovar pagamento de pedido cancelado ou encerrado.");
    }
    const { rows: payments } = await client.query(
      `SELECT * FROM public.payments WHERE order_id = $1 AND store_id = $2 FOR UPDATE`,
      [input.orderId, input.storeId],
    );
    const payment = payments[0];
    if (!payment || payment.provider !== "manual_pix") {
      throw new Error("Este pedido nao possui uma cobranca PIX manual pendente.");
    }
    if (paidStatuses.has(String(order.payment_status))) return { order, alreadyPaid: true };

    await client.query(
      `UPDATE public.payments
       SET status = 'pago', paid_at = COALESCE(paid_at, now()), approved_by = $2::uuid, updated_at = now()
       WHERE id = $1 AND provider = 'manual_pix'`,
      [payment.id, actor.user.id],
    );

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

export const getOrderPaymentInfoForOrder = async (
  input: { orderId: string; storeId: string; publicToken?: string },
  deps: PaymentDeps = defaultDeps,
) => {
  return createOrderPaymentForOrder(input, deps);
};

/** Transicao idempotente para "pago" + escrow (modelo central). */
const confirmOrderPaid = async (
  input: { orderId: string; storeId: string },
  ctx: { paymentId: string; storeId: string; total: number; central: boolean; asaasPaymentId?: string | null },
  deps: PaymentDeps,
) => {
  await deps.withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [`payment-paid:${input.orderId}`]);

    const { rows: lockedPayments } = await client.query(
      `SELECT * FROM public.payments WHERE id = $1 FOR UPDATE`,
      [ctx.paymentId],
    );
    const locked = lockedPayments[0];
    if (!locked) throw new Error("Pagamento nao encontrado.");
    const wasPaid = locked.status === "pago";

    await client.query(
      `UPDATE public.payments
       SET status = 'pago', paid_at = COALESCE(paid_at, now()), updated_at = now()
       WHERE id = $1`,
      [ctx.paymentId],
    );
    const { rows: orders } = await client.query(
      `UPDATE public.orders
       SET status = CASE WHEN status = 'aguardando_pagamento' THEN 'novo' ELSE status END,
           payment_status = 'pago', updated_at = now()
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

    if (orders[0] && ctx.central) {
      await applyPaymentEscrow(
        client,
        { id: input.orderId, store_id: input.storeId, total: ctx.total },
        ctx.asaasPaymentId ?? null,
        null,
      ).catch((e: any) => console.error("[sync] escrow error", e?.message));
    }
  });

  await deps.notifyStatus(input.orderId, "novo", "Pagamento PIX confirmado automaticamente").catch((error) => {
    console.warn("Evolution status notification skipped:", error);
  });
};

export const syncOrderPaymentStatus = async (
  input: { orderId: string; storeId: string; publicToken?: string },
  deps: PaymentDeps = defaultDeps,
) => {
  const { rows: contextRows } = await deps.query(
    `SELECT p.*, ss.asaas_api_key, ss.payment_gateway_provider, ss.payment_gateway_api_key,
            ss.payment_gateway_config, ss.financeiro_ativo, o.total AS order_total
     FROM public.payments p
     JOIN public.store_settings ss ON ss.store_id = p.store_id
     JOIN public.orders o ON o.id = p.order_id
     WHERE p.order_id = $1 AND p.store_id = $2
       AND ($3::text IS NULL OR o.public_token = $3::text)
     LIMIT 1`,
    [input.orderId, input.storeId, input.publicToken || null],
  );
  const payment = contextRows[0];
  if (!payment) return { status: "pending", message: "Pagamento nao encontrado" };
  if (paidStatuses.has(String(payment.status))) return { status: "paid" };

  const externalId = payment.external_id || payment.asaas_id;
  if (!externalId) return { status: "pending", message: "Pagamento nao encontrado" };

  const central = Boolean(payment.financeiro_ativo);

  // Obtem pagamento no gateway correto (central ou da loja).
  let gatewayPayment: any;
  if (central) {
    if (!asaasCentral.isConfigured()) return { status: "pending", message: "Conta central nao configurada" };
    gatewayPayment = await asaasCentral.getPayment(externalId);
  } else {
    const gatewayConfig = resolvePixGatewayConfig(payment, deps.gateways);
    if (!gatewayConfig) return { status: "pending", message: "Gateway de pagamento nao configurado" };
    gatewayPayment = await gatewayConfig.gateway.getPayment(gatewayConfig, externalId);
  }

  if (gatewayPayment?.errors) {
    return { status: "pending", message: errorDescription(gatewayPayment), gatewayStatus: null };
  }

  const mappedStatus = central
    ? asaasCentral.mapPaymentStatus(gatewayPayment.status)
    : resolvePixGatewayConfig(payment, deps.gateways)!.gateway.mapPaymentStatus(gatewayPayment.status);

  if (mappedStatus === "pago") {
    const expected = Number(payment.order_total || payment.amount || 0);
    const received = Number(gatewayPayment.value);
    if (!Number.isFinite(received) || Math.abs(received - expected) > 0.01) {
      await deps.query(
        `UPDATE public.payments SET last_error = $2, updated_at = now() WHERE id = $1`,
        [payment.id, `Valor divergente no sync do gateway. Esperado ${expected}, recebido ${gatewayPayment.value ?? "ausente"}`],
      );
      return { status: "pending", message: "Valor do pagamento divergente", gatewayStatus: gatewayPayment.status };
    }
  }

  if (mappedStatus !== "pago") {
    await deps.query(
      `UPDATE public.payments SET status = $2, updated_at = now() WHERE id = $1`,
      [payment.id, mappedStatus],
    ).catch(() => null);
    return { status: "pending", gatewayStatus: gatewayPayment.status };
  }

  await confirmOrderPaid(
    { orderId: input.orderId, storeId: input.storeId },
    { paymentId: payment.id, storeId: input.storeId, total: Number(payment.order_total || 0), central, asaasPaymentId: externalId },
    deps,
  );

  return { status: "paid" };
};
