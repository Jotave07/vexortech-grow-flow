import { z } from "zod";
import type { getActor } from "@/backend/auth";
import { query as defaultQuery } from "@/backend/db";
import { publishRealtime as defaultPublishRealtime } from "@/backend/realtime";
import { asaas } from "./asaas.server";

const billingTypeSchema = z.enum(["CREDIT_CARD", "BOLETO"]).default("CREDIT_CARD");

const customerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(180),
  cpfCnpj: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().min(11).max(14)),
  mobilePhone: z.string().optional().nullable().transform((value) => value ? value.replace(/\D/g, "") : undefined),
});

const cardDataSchema = z.object({
  creditCard: z.object({
    holderName: z.string().trim().min(2).max(120),
    number: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().min(13).max(19)),
    expiryMonth: z.string().transform((value) => value.replace(/\D/g, "").padStart(2, "0")).pipe(z.string().regex(/^(0[1-9]|1[0-2])$/)),
    expiryYear: z.string()
      .transform((value) => {
        const digits = value.replace(/\D/g, "");
        return digits.length === 2 ? `20${digits}` : digits;
      })
      .pipe(z.string().regex(/^20\d{2}$/)),
    ccv: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().min(3).max(4)),
  }),
  creditCardHolderInfo: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(180),
    cpfCnpj: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().min(11).max(14)),
    postalCode: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().length(8)),
    addressNumber: z.string().trim().min(1).max(20),
    addressComplement: z.string().trim().max(80).optional().nullable().transform((value) => value || null),
    phone: z.string().optional().nullable().transform((value) => value ? value.replace(/\D/g, "") : undefined),
    mobilePhone: z.string().optional().nullable().transform((value) => value ? value.replace(/\D/g, "") : undefined),
  }),
});

const checkoutSchema = z.object({
  storeId: z.string().uuid(),
  planId: z.string().uuid(),
  customerData: customerSchema,
  billingType: billingTypeSchema.optional(),
  cardData: cardDataSchema.optional(),
});

const updatePlanSchema = z.object({
  storeId: z.string().uuid(),
  planId: z.string().uuid(),
  billingType: billingTypeSchema.optional(),
  cardData: cardDataSchema.optional(),
});

const cancelSchema = z.object({
  storeId: z.string().uuid(),
});

type QueryFn = typeof defaultQuery;
type ActorFn = typeof getActor;

type SubscriptionDeps = {
  getActor: ActorFn;
  query: QueryFn;
  publishRealtime: typeof defaultPublishRealtime;
  createCustomer: typeof asaas.createCustomer;
  createSubscription: typeof asaas.createSubscription;
  updateSubscription: typeof asaas.updateSubscription;
  cancelSubscription: typeof asaas.cancelSubscription;
  listSubscriptionPayments: typeof asaas.listSubscriptionPayments;
};

type FunctionContext = {
  remoteIp?: string | null;
};

const defaultDeps = async (): Promise<SubscriptionDeps> => {
  const auth = await import("@/backend/auth");
  return {
    getActor: auth.getActor,
    query: defaultQuery,
    publishRealtime: defaultPublishRealtime,
    createCustomer: asaas.createCustomer,
    createSubscription: asaas.createSubscription,
    updateSubscription: asaas.updateSubscription,
    cancelSubscription: asaas.cancelSubscription,
    listSubscriptionPayments: asaas.listSubscriptionPayments,
  };
};

const todayIsoDate = () => new Date().toISOString().split("T")[0];

const resolveRemoteIp = (context: FunctionContext) => {
  const remoteIp = context.remoteIp?.split(",")[0]?.trim();
  if (remoteIp) return remoteIp;
  if (process.env.NODE_ENV !== "production") return "127.0.0.1";
  throw new Error("Nao foi possivel identificar o IP do titular do cartao.");
};

const assertStoreAccess = async (
  deps: SubscriptionDeps,
  token: string | undefined,
  storeId: string,
) => {
  const actor = await deps.getActor(token);
  if (!actor) throw new Error("Nao autenticado.");
  if (!actor.admin && !actor.ownedStoreIds.includes(storeId)) throw new Error("Acesso negado.");
  return actor;
};

const loadStorePlanSubscription = async (deps: SubscriptionDeps, storeId: string, planId?: string) => {
  const [{ rows: storeRows }, { rows: planRows }, { rows: subscriptionRows }] = await Promise.all([
    deps.query(
      `SELECT id, owner_user_id, name, document, whatsapp, plan_id
       FROM public.stores
       WHERE id = $1::uuid
       LIMIT 1`,
      [storeId],
    ),
    planId
      ? deps.query(
          `SELECT id, name, price_monthly
           FROM public.plans
           WHERE id = $1::uuid
             AND COALESCE(is_active, true) IS TRUE
             AND COALESCE(price_monthly, 0) > 0
           LIMIT 1`,
          [planId],
        )
      : Promise.resolve({ rows: [] } as any),
    deps.query(
      `SELECT s.*, p.price_monthly AS current_price_monthly, p.name AS current_plan_name
       FROM public.subscriptions s
       LEFT JOIN public.plans p ON p.id = s.plan_id
       WHERE s.store_id = $1::uuid
       LIMIT 1`,
      [storeId],
    ),
  ]);

  const store = storeRows[0];
  const plan = planRows[0];
  const subscription = subscriptionRows[0];
  if (!store) throw new Error("Loja nao encontrada.");
  if (planId && !plan) throw new Error("Plano pago nao encontrado ou inativo.");
  return { store, plan, subscription };
};

const validateUpgrade = (subscription: any, plan: any) => {
  if (!subscription?.plan_id || subscription.plan_id === plan.id) return;
  const currentPrice = Number(subscription.current_price_monthly || 0);
  const nextPrice = Number(plan.price_monthly || 0);
  if (currentPrice > 0 && nextPrice < currentPrice) {
    throw new Error("Downgrade de plano nao permitido neste fluxo. Escolha um plano superior.");
  }
};

const isActiveSubscription = (subscription: any) => String(subscription?.status || "") === "ativa";

const gatewayPaidPaymentStatuses = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);
const gatewayFailedPaymentStatuses = new Set(["OVERDUE", "REFUNDED", "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE"]);

const paymentTimestamp = (payment: any) => {
  const value = payment?.paymentDate || payment?.confirmedDate || payment?.clientPaymentDate || payment?.dateCreated || payment?.dueDate;
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeGatewayPayments = (response: any) => {
  const payments = Array.isArray(response?.data) ? response.data : Array.isArray(response) ? response : [];
  return payments
    .filter((payment: any) => payment && typeof payment === "object")
    .sort((left: any, right: any) => paymentTimestamp(right) - paymentTimestamp(left));
};

const paidAtForGatewayPayment = (payment: any) =>
  payment?.paymentDate || payment?.confirmedDate || payment?.clientPaymentDate || null;

const dueDateForGatewayPayment = (payment: any, subscription: any) =>
  payment?.dueDate || payment?.originalDueDate || subscription?.next_due_date || null;

const buildGatewaySubscriptionPayload = (input: {
  customerId: string;
  billingType: "CREDIT_CARD" | "BOLETO";
  plan: any;
  nextDueDate: string;
  externalReference: string;
  cardData?: z.infer<typeof cardDataSchema>;
  remoteIp: string;
}) => ({
  customer: input.customerId,
  billingType: input.billingType,
  value: Number(input.plan.price_monthly),
  nextDueDate: input.nextDueDate,
  cycle: "MONTHLY" as const,
  description: `Assinatura Plano ${input.plan.name} - Hype Delivery`,
  externalReference: input.externalReference,
  ...(input.billingType === "CREDIT_CARD"
    ? {
        creditCard: input.cardData?.creditCard,
        creditCardHolderInfo: input.cardData?.creditCardHolderInfo,
        remoteIp: input.remoteIp,
      }
    : {}),
});

const cancelExistingGatewaySubscription = async (deps: SubscriptionDeps, subscription: any) => {
  if (!subscription?.asaas_subscription_id) return;
  const status = String(subscription.status || "");
  if (status === "cancelada" || status === "encerrada") return;
  const canceled = await deps.cancelSubscription(subscription.asaas_subscription_id).catch(() => null);
  if (canceled?.errors) {
    console.warn("Existing Asaas subscription cancel skipped:", canceled.errors[0]?.description || "unknown_error");
  }
};

const persistSubscription = async (
  deps: SubscriptionDeps,
  data: {
    storeId: string;
    planId: string;
    asaasCustomerId: string | null;
    asaasSubscriptionId: string | null;
    billingType: "CREDIT_CARD" | "BOLETO";
    status: string;
    nextDueDate: string | null;
    externalReference: string;
  },
) => {
  await deps.query(
    `UPDATE public.stores
     SET plan_id = $2::uuid, updated_at = now()
     WHERE id = $1::uuid`,
    [data.storeId, data.planId],
  );

  const { rows } = await deps.query(
    `INSERT INTO public.subscriptions (
       store_id, plan_id, provider, asaas_customer_id, asaas_subscription_id,
       billing_type, external_reference, status, last_payment_status, next_due_date,
       updated_at
     )
     VALUES ($1::uuid, $2::uuid, 'asaas', $3::text, $4::text, $5::text, $6::text,
       $7::text, 'pending', $8::date, now())
     ON CONFLICT (store_id)
     DO UPDATE SET
       plan_id = EXCLUDED.plan_id,
       provider = EXCLUDED.provider,
       asaas_customer_id = COALESCE(EXCLUDED.asaas_customer_id, public.subscriptions.asaas_customer_id),
       asaas_subscription_id = COALESCE(EXCLUDED.asaas_subscription_id, public.subscriptions.asaas_subscription_id),
       billing_type = EXCLUDED.billing_type,
       external_reference = EXCLUDED.external_reference,
       status = EXCLUDED.status,
       last_payment_status = EXCLUDED.last_payment_status,
       next_due_date = EXCLUDED.next_due_date,
       canceled_at = NULL,
       cancellation_effective_at = NULL,
       updated_at = now()
     RETURNING *`,
    [
      data.storeId,
      data.planId,
      data.asaasCustomerId,
      data.asaasSubscriptionId,
      data.billingType,
      data.externalReference,
      data.status,
      data.nextDueDate,
    ],
  );

  deps.publishRealtime({ schema: "public", table: "subscriptions", eventType: "UPDATE", new: rows[0], old: null });
  return rows[0];
};

export const createSubscriptionCheckoutHandler = async (
  input: unknown,
  token?: string,
  depsPromise: Promise<SubscriptionDeps> = defaultDeps(),
  context: FunctionContext = {},
) => {
  const deps = await depsPromise;
  const data = checkoutSchema.parse(input);
  const billingType = data.billingType || "CREDIT_CARD";
  await assertStoreAccess(deps, token, data.storeId);

  if (billingType === "CREDIT_CARD" && !data.cardData) {
    throw new Error("Informe os dados do cartao para validar a assinatura.");
  }

  const { plan, subscription: existingSubscription } = await loadStorePlanSubscription(deps, data.storeId, data.planId);
  if (isActiveSubscription(existingSubscription)) {
    if (existingSubscription.plan_id === data.planId) {
      return {
        invoiceUrl: null,
        checkoutUrl: null,
        subscriptionId: existingSubscription.asaas_subscription_id,
        billingType: existingSubscription.billing_type || billingType,
        mode: "active",
      };
    }
    validateUpgrade(existingSubscription, plan);
  }

  const nextDueDate = todayIsoDate();
  const externalReference = `platform-subscription:${data.storeId}`;
  const remoteIp = billingType === "CREDIT_CARD" ? resolveRemoteIp(context) : "";

  let customerId = existingSubscription?.asaas_customer_id || null;
  if (!customerId) {
    const customer = await deps.createCustomer({
      name: data.customerData.name,
      email: data.customerData.email,
      cpfCnpj: data.customerData.cpfCnpj,
      mobilePhone: data.customerData.mobilePhone,
    });
    if (customer.errors) throw new Error(customer.errors[0]?.description || "Erro ao criar cliente no gateway.");
    customerId = customer.id || null;
  }
  if (!customerId) throw new Error("Cliente do gateway nao foi criado para a assinatura.");

  const subscription = await deps.createSubscription(buildGatewaySubscriptionPayload({
    customerId,
    billingType,
    plan,
    nextDueDate,
    externalReference,
    cardData: data.cardData,
    remoteIp,
  }));
  if (subscription.errors) throw new Error(subscription.errors[0]?.description || "Erro ao criar assinatura no gateway.");

  await persistSubscription(deps, {
    storeId: data.storeId,
    planId: data.planId,
    asaasCustomerId: customerId,
    asaasSubscriptionId: subscription.id || null,
    billingType,
    status: "pendente_pagamento",
    nextDueDate: subscription.nextDueDate || nextDueDate,
    externalReference,
  });

  if (
    existingSubscription?.asaas_subscription_id
    && existingSubscription.asaas_subscription_id !== subscription.id
  ) {
    await cancelExistingGatewaySubscription(deps, existingSubscription);
  }

  return {
    invoiceUrl: subscription.invoiceUrl || null,
    checkoutUrl: subscription.invoiceUrl || null,
    subscriptionId: subscription.id,
    billingType,
    mode: "card_validated",
  };
};

export const updateSubscriptionPlanHandler = async (
  input: unknown,
  token?: string,
  depsPromise: Promise<SubscriptionDeps> = defaultDeps(),
  context: FunctionContext = {},
) => {
  const deps = await depsPromise;
  const data = updatePlanSchema.parse(input);
  const billingType = data.billingType || "CREDIT_CARD";
  await assertStoreAccess(deps, token, data.storeId);

  const { plan, subscription } = await loadStorePlanSubscription(deps, data.storeId, data.planId);
  if (!subscription?.asaas_subscription_id) {
    throw new Error("Assinatura existente nao encontrada. Inicie uma assinatura antes de alterar plano.");
  }
  validateUpgrade(subscription, plan);

  const nextDueDate = subscription.next_due_date
    ? new Date(subscription.next_due_date).toISOString().split("T")[0]
    : todayIsoDate();
  const externalReference = subscription.external_reference || `platform-subscription:${data.storeId}`;

  if (billingType === "CREDIT_CARD" && data.cardData) {
    const customerId = subscription.asaas_customer_id;
    if (!customerId) {
      throw new Error("Cliente do gateway nao encontrado. Inicie uma nova assinatura.");
    }

    const created = await deps.createSubscription(buildGatewaySubscriptionPayload({
      customerId,
      billingType,
      plan,
      nextDueDate: todayIsoDate(),
      externalReference,
      cardData: data.cardData,
      remoteIp: resolveRemoteIp(context),
    }));
    if (created.errors) throw new Error(created.errors[0]?.description || "Erro ao criar assinatura no gateway.");

    await persistSubscription(deps, {
      storeId: data.storeId,
      planId: data.planId,
      asaasCustomerId: customerId,
      asaasSubscriptionId: created.id || null,
      billingType,
      status: "pendente_pagamento",
      nextDueDate: created.nextDueDate || todayIsoDate(),
      externalReference,
    });

    await cancelExistingGatewaySubscription(deps, subscription);

    return {
      invoiceUrl: created.invoiceUrl || null,
      checkoutUrl: created.invoiceUrl || null,
      subscriptionId: created.id,
      billingType,
      mode: "card_validated",
    };
  }

  const updated = await deps.updateSubscription(subscription.asaas_subscription_id, {
    billingType,
    value: Number(plan.price_monthly),
    nextDueDate,
    cycle: "MONTHLY",
    description: `Assinatura Plano ${plan.name} - Hype Delivery`,
    externalReference,
  });
  if (updated.errors) throw new Error(updated.errors[0]?.description || "Erro ao atualizar assinatura no gateway.");

  await persistSubscription(deps, {
    storeId: data.storeId,
    planId: data.planId,
    asaasCustomerId: subscription.asaas_customer_id || updated.customer || null,
    asaasSubscriptionId: subscription.asaas_subscription_id,
    billingType,
    status: subscription.status === "ativa" ? "ativa" : "pendente_pagamento",
    nextDueDate: updated.nextDueDate || nextDueDate,
    externalReference,
  });

  return {
    invoiceUrl: updated.invoiceUrl || null,
    checkoutUrl: updated.invoiceUrl || null,
    subscriptionId: subscription.asaas_subscription_id,
    billingType,
    mode: "updated",
  };
};

export const syncSubscriptionStatusHandler = async (
  input: unknown,
  token?: string,
  depsPromise: Promise<SubscriptionDeps> = defaultDeps(),
) => {
  const deps = await depsPromise;
  const data = cancelSchema.parse(input);
  await assertStoreAccess(deps, token, data.storeId);

  const { subscription } = await loadStorePlanSubscription(deps, data.storeId);
  if (!subscription) return { success: true, status: "sem_assinatura", synced: false };
  if (!subscription.asaas_subscription_id) {
    return { success: true, status: subscription.status, synced: false, message: "Assinatura sem ID do gateway." };
  }

  const gatewayResponse = await deps.listSubscriptionPayments(subscription.asaas_subscription_id);
  if (gatewayResponse?.errors) {
    throw new Error(gatewayResponse.errors[0]?.description || "Nao foi possivel consultar pagamentos da assinatura.");
  }

  const payments = normalizeGatewayPayments(gatewayResponse);
  const paidPayment = payments.find((payment: any) => gatewayPaidPaymentStatuses.has(String(payment.status || "").toUpperCase()));
  const failedPayment = payments.find((payment: any) => gatewayFailedPaymentStatuses.has(String(payment.status || "").toUpperCase()));
  const referencePayment = paidPayment || failedPayment || payments[0] || null;
  const gatewayStatus = referencePayment?.status ? String(referencePayment.status).toUpperCase() : null;

  if (!referencePayment) {
    return { success: true, status: subscription.status, synced: false, message: "Nenhuma cobranca encontrada para esta assinatura." };
  }

  if (!paidPayment && !failedPayment) {
    const { rows } = await deps.query(
      `UPDATE public.subscriptions
       SET last_payment_status = $2,
           next_due_date = COALESCE($3::date, next_due_date),
           updated_at = now()
       WHERE store_id = $1::uuid
       RETURNING *`,
      [data.storeId, gatewayStatus, dueDateForGatewayPayment(referencePayment, subscription)],
    );
    const updated = rows[0] || subscription;
    deps.publishRealtime({ schema: "public", table: "subscriptions", eventType: "UPDATE", new: updated, old: subscription });
    return { success: true, status: updated.status, gatewayStatus, synced: true };
  }

  const nextStatus = paidPayment ? "ativa" : "inadimplente";
  const paidAt = paidPayment ? paidAtForGatewayPayment(paidPayment) : null;
  const dueDate = dueDateForGatewayPayment(referencePayment, subscription);
  const { rows } = await deps.query(
    `UPDATE public.subscriptions
     SET status = $2,
         last_payment_status = $3,
         current_period_start = CASE
           WHEN $2 = 'ativa' THEN COALESCE($4::timestamptz, current_period_start, now())
           ELSE current_period_start
         END,
         current_period_end = CASE
           WHEN $2 = 'ativa' THEN COALESCE(($5::date + INTERVAL '30 days')::timestamptz, current_period_end, now() + INTERVAL '30 days')
           ELSE current_period_end
         END,
         next_due_date = COALESCE($5::date, next_due_date),
         updated_at = now()
     WHERE store_id = $1::uuid
     RETURNING *`,
    [data.storeId, nextStatus, gatewayStatus, paidAt, dueDate],
  );
  const updated = rows[0] || subscription;
  deps.publishRealtime({ schema: "public", table: "subscriptions", eventType: "UPDATE", new: updated, old: subscription });
  return {
    success: true,
    status: updated.status,
    gatewayStatus,
    paymentId: referencePayment.id || null,
    synced: true,
  };
};

export const cancelSubscriptionHandler = async (
  input: unknown,
  token?: string,
  depsPromise: Promise<SubscriptionDeps> = defaultDeps(),
) => {
  const deps = await depsPromise;
  const data = cancelSchema.parse(input);
  await assertStoreAccess(deps, token, data.storeId);

  const { subscription } = await loadStorePlanSubscription(deps, data.storeId);
  if (!subscription) throw new Error("Assinatura nao encontrada.");
  if (subscription.status === "cancelada" || subscription.status === "encerrada") {
    return { success: true, status: subscription.status, cancellationEffectiveAt: subscription.cancellation_effective_at };
  }

  if (subscription.asaas_subscription_id) {
    const canceled = await deps.cancelSubscription(subscription.asaas_subscription_id);
    if (canceled.errors) throw new Error(canceled.errors[0]?.description || "Erro ao cancelar assinatura no gateway.");
  }

  const effectiveAt = subscription.current_period_end || subscription.next_due_date || new Date().toISOString();
  const { rows } = await deps.query(
    `UPDATE public.subscriptions
     SET status = 'cancelada',
         canceled_at = now(),
         cancellation_effective_at = $2::timestamptz,
         updated_at = now()
     WHERE store_id = $1::uuid
     RETURNING *`,
    [data.storeId, effectiveAt],
  );

  deps.publishRealtime({ schema: "public", table: "subscriptions", eventType: "UPDATE", new: rows[0], old: subscription });
  return { success: true, status: "cancelada", cancellationEffectiveAt: rows[0]?.cancellation_effective_at };
};
