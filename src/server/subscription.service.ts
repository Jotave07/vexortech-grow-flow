import { createHash } from "node:crypto";
import { z } from "zod";
import type { getActor } from "@/backend/auth";
import { query as defaultQuery, withTransaction as defaultWithTransaction } from "@/backend/db";
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

// Funcao de query escopada (pool global ou client de transacao). Usada por persistSubscription
// para que as escritas rodem DENTRO da mesma transacao/lock do checkout.
type ScopedQuery = (text: string, params?: unknown[]) => Promise<any>;

type SubscriptionDeps = {
  getActor: ActorFn;
  query: QueryFn;
  withTransaction: typeof defaultWithTransaction;
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
    withTransaction: defaultWithTransaction,
    publishRealtime: defaultPublishRealtime,
    createCustomer: asaas.createCustomer,
    createSubscription: asaas.createSubscription,
    updateSubscription: asaas.updateSubscription,
    cancelSubscription: asaas.cancelSubscription,
    listSubscriptionPayments: asaas.listSubscriptionPayments,
  };
};

const todayIsoDate = () => new Date().toISOString().split("T")[0];
const ASAAS_IDEMPOTENCY_KEY_MAX_LENGTH = 48;

const asaasIdempotencyKey = (scope: "pc" | "ps", ...parts: string[]) => {
  const digest = createHash("sha256").update(parts.join(":")).digest("hex").slice(0, 32);
  const key = `${scope}_${digest}`;
  if (key.length > ASAAS_IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new Error("Chave de idempotencia do Asaas excede o limite permitido.");
  }
  return key;
};

// Chave de lock por loja, serializando checkouts concorrentes da MESMA loja (duplo-clique/retry).
// Espelha o padrao usado no fluxo de Pix manual (asaas.service.ts: `manual-pix:${orderId}`).
const subscriptionLockKey = (storeId: string) => `subscription:${storeId}`;

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

// Re-le a assinatura da loja DENTRO da transacao, travando a linha (FOR UPDATE) apos o
// advisory lock. Esta e a leitura autoritativa para decidir criar/atualizar, evitando a
// janela de corrida entre a leitura inicial e a gravacao.
const lockAndLoadSubscription = async (q: ScopedQuery, storeId: string) => {
  await q(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [subscriptionLockKey(storeId)]);
  const { rows } = await q(
    `SELECT s.*, p.price_monthly AS current_price_monthly, p.name AS current_plan_name
     FROM public.subscriptions s
     LEFT JOIN public.plans p ON p.id = s.plan_id
     WHERE s.store_id = $1::uuid
     FOR UPDATE OF s
     LIMIT 1`,
    [storeId],
  );
  return rows[0] || null;
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

// Cancela a assinatura anterior no gateway ANTES de criar a nova. Diferente da versao
// anterior, NAO engole o erro: se o cancelamento falhar, a operacao e abortada (a
// transacao do checkout faz rollback) para nunca deixar duas assinaturas cobrando em
// paralelo. Retorno antecipado quando nao ha o que cancelar.
const cancelExistingGatewaySubscription = async (deps: SubscriptionDeps, subscription: any) => {
  if (!subscription?.asaas_subscription_id) return;
  const status = String(subscription.status || "");
  if (status === "cancelada" || status === "encerrada") return;
  const canceled = await deps.cancelSubscription(subscription.asaas_subscription_id);
  if (canceled?.errors) {
    throw new Error(
      canceled.errors[0]?.description
        || "Falha ao cancelar a assinatura anterior no gateway. Operacao abortada para evitar cobranca duplicada.",
    );
  }
};

const persistSubscription = async (
  deps: SubscriptionDeps,
  q: ScopedQuery,
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
  await q(
    `UPDATE public.stores
     SET plan_id = $2::uuid, updated_at = now()
     WHERE id = $1::uuid`,
    [data.storeId, data.planId],
  );

  const { rows } = await q(
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

// Resolve o customerId do gateway, criando o cliente apenas quando ainda nao existir.
const resolveGatewayCustomerId = async (
  deps: SubscriptionDeps,
  storeId: string,
  existingCustomerId: string | null,
  customerData: z.infer<typeof customerSchema>,
) => {
  if (existingCustomerId) return existingCustomerId;
  const customer = await deps.createCustomer(
    {
      name: customerData.name,
      email: customerData.email,
      cpfCnpj: customerData.cpfCnpj,
      mobilePhone: customerData.mobilePhone,
    },
    undefined,
    { idempotencyKey: asaasIdempotencyKey("pc", storeId) },
  );
  if (customer.errors) throw new Error(customer.errors[0]?.description || "Erro ao criar cliente no gateway.");
  const customerId = customer.id || null;
  if (!customerId) throw new Error("Cliente do gateway nao foi criado para a assinatura.");
  return customerId;
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
  // Atalho rapido (sem transacao) quando ja esta ativo no mesmo plano.
  if (isActiveSubscription(existingSubscription) && existingSubscription.plan_id === data.planId) {
    return {
      invoiceUrl: null,
      checkoutUrl: null,
      subscriptionId: existingSubscription.asaas_subscription_id,
      billingType: existingSubscription.billing_type || billingType,
      mode: "active",
    };
  }

  const nextDueDate = todayIsoDate();
  const externalReference = `platform-subscription:${data.storeId}`;
  const remoteIp = billingType === "CREDIT_CARD" ? resolveRemoteIp(context) : "";

  // Secao critica serializada por loja: advisory lock + re-leitura FOR UPDATE garantem que
  // dois checkouts concorrentes da mesma loja nao criem duas assinaturas no gateway.
  return await deps.withTransaction(async (client) => {
    const q: ScopedQuery = (text, params) => client.query(text, params as any);
    const locked = await lockAndLoadSubscription(q, data.storeId);

    // Outro request concorrente pode ter ativado a assinatura enquanto aguardavamos o lock.
    if (isActiveSubscription(locked) && locked.plan_id === data.planId) {
      return {
        invoiceUrl: null,
        checkoutUrl: null,
        subscriptionId: locked.asaas_subscription_id,
        billingType: locked.billing_type || billingType,
        mode: "active",
      };
    }
    if (isActiveSubscription(locked)) validateUpgrade(locked, plan);

    const customerId = await resolveGatewayCustomerId(
      deps,
      data.storeId,
      locked?.asaas_customer_id || existingSubscription?.asaas_customer_id || null,
      data.customerData,
    );

    // Cancela qualquer assinatura anterior do gateway ANTES de criar a nova (propagando erro).
    await cancelExistingGatewaySubscription(deps, locked);

    const subscription = await deps.createSubscription(
      buildGatewaySubscriptionPayload({
        customerId,
        billingType,
        plan,
        nextDueDate,
        externalReference,
        cardData: data.cardData,
        remoteIp,
      }),
      // Defesa em profundidade contra retry/timeout: se a 1a tentativa criou a assinatura
      // mas estourou o timeout, o retry com a mesma chave nao duplica no gateway.
      { idempotencyKey: asaasIdempotencyKey("ps", data.storeId, data.planId, nextDueDate) },
    );
    if (subscription.errors) throw new Error(subscription.errors[0]?.description || "Erro ao criar assinatura no gateway.");
    if (!subscription.id) throw new Error("Assinatura do gateway nao foi criada para a loja.");

    await persistSubscription(deps, q, {
      storeId: data.storeId,
      planId: data.planId,
      asaasCustomerId: customerId,
      asaasSubscriptionId: subscription.id,
      billingType,
      status: "pendente_pagamento",
      nextDueDate: subscription.nextDueDate || nextDueDate,
      externalReference,
    });

    return {
      invoiceUrl: subscription.invoiceUrl || null,
      checkoutUrl: subscription.invoiceUrl || null,
      subscriptionId: subscription.id,
      billingType,
      mode: "card_validated",
    };
  });
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

  const { plan } = await loadStorePlanSubscription(deps, data.storeId, data.planId);
  const externalReference = `platform-subscription:${data.storeId}`;

  return await deps.withTransaction(async (client) => {
    const q: ScopedQuery = (text, params) => client.query(text, params as any);
    const subscription = await lockAndLoadSubscription(q, data.storeId);
    if (!subscription?.asaas_subscription_id) {
      throw new Error("Assinatura existente nao encontrada. Inicie uma assinatura antes de alterar plano.");
    }
    validateUpgrade(subscription, plan);

    const nextDueDate = subscription.next_due_date
      ? new Date(subscription.next_due_date).toISOString().split("T")[0]
      : todayIsoDate();
    const effectiveExternalReference = subscription.external_reference || externalReference;

    if (billingType === "CREDIT_CARD" && data.cardData) {
      const customerId = subscription.asaas_customer_id;
      if (!customerId) {
        throw new Error("Cliente do gateway nao encontrado. Inicie uma nova assinatura.");
      }

      // Cancela a assinatura atual ANTES de criar a nova com o cartao informado.
      await cancelExistingGatewaySubscription(deps, subscription);

      const created = await deps.createSubscription(
        buildGatewaySubscriptionPayload({
          customerId,
          billingType,
          plan,
          nextDueDate: todayIsoDate(),
          externalReference: effectiveExternalReference,
          cardData: data.cardData,
          remoteIp: resolveRemoteIp(context),
        }),
        { idempotencyKey: asaasIdempotencyKey("ps", data.storeId, data.planId, todayIsoDate()) },
      );
      if (created.errors) throw new Error(created.errors[0]?.description || "Erro ao criar assinatura no gateway.");
      if (!created.id) throw new Error("Assinatura do gateway nao foi criada para a loja.");

      await persistSubscription(deps, q, {
        storeId: data.storeId,
        planId: data.planId,
        asaasCustomerId: customerId,
        asaasSubscriptionId: created.id,
        billingType,
        status: "pendente_pagamento",
        nextDueDate: created.nextDueDate || todayIsoDate(),
        externalReference: effectiveExternalReference,
      });

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
      externalReference: effectiveExternalReference,
    });
    if (updated.errors) throw new Error(updated.errors[0]?.description || "Erro ao atualizar assinatura no gateway.");

    await persistSubscription(deps, q, {
      storeId: data.storeId,
      planId: data.planId,
      asaasCustomerId: subscription.asaas_customer_id || updated.customer || null,
      asaasSubscriptionId: subscription.asaas_subscription_id,
      billingType,
      status: subscription.status === "ativa" ? "ativa" : "pendente_pagamento",
      nextDueDate: updated.nextDueDate || nextDueDate,
      externalReference: effectiveExternalReference,
    });

    return {
      invoiceUrl: updated.invoiceUrl || null,
      checkoutUrl: updated.invoiceUrl || null,
      subscriptionId: subscription.asaas_subscription_id,
      billingType,
      mode: "updated",
    };
  });
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

  // Decide pelo pagamento ACIONADO mais recente (pago x falho/estornado). Antes, "qualquer
  // pago vence" reativava uma assinatura estornada mesmo quando o estorno era mais recente.
  let actionedPayment: any = null;
  if (paidPayment && failedPayment) {
    actionedPayment = paymentTimestamp(failedPayment) > paymentTimestamp(paidPayment) ? failedPayment : paidPayment;
  } else {
    actionedPayment = paidPayment || failedPayment || null;
  }
  const isPaid = Boolean(actionedPayment) && actionedPayment === paidPayment;
  const referencePayment = actionedPayment || payments[0] || null;
  const gatewayStatus = referencePayment?.status ? String(referencePayment.status).toUpperCase() : null;

  if (!referencePayment) {
    return { success: true, status: subscription.status, synced: false, message: "Nenhuma cobranca encontrada para esta assinatura." };
  }

  if (!actionedPayment) {
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

  const nextStatus = isPaid ? "ativa" : "inadimplente";
  const paidAt = isPaid ? paidAtForGatewayPayment(actionedPayment) : null;
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
