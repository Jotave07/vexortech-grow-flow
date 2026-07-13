import { createHash } from "node:crypto";
import { z } from "zod";
import { getActor as defaultGetActor } from "@/backend/auth";
import { query as defaultQuery, withTransaction as defaultWithTransaction } from "@/backend/db";
import { publishRealtime as defaultPublishRealtime } from "@/backend/realtime";
import { isValidDocument, normalizeDocument } from "@/lib/validators";
import { asaas } from "./asaas.server";
import {
  businessTodayIsoDate,
  nextFutureMonthlyDueDate,
  normalizeGatewayDate,
} from "./billing-date";
import { toCents } from "./financial.calc";

const billingTypeSchema = z.enum(["CREDIT_CARD", "BOLETO"]).default("CREDIT_CARD");

const customerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(180),
  cpfCnpj: z.string().transform(normalizeDocument).refine(isValidDocument, "CPF ou CNPJ invalido"),
  mobilePhone: z
    .string()
    .optional()
    .nullable()
    .transform((value) => (value ? value.replace(/\D/g, "") : undefined)),
});

const cardDataSchema = z.object({
  creditCard: z.object({
    holderName: z.string().trim().min(2).max(120),
    number: z
      .string()
      .transform((value) => value.replace(/\D/g, ""))
      .pipe(z.string().min(13).max(19)),
    expiryMonth: z
      .string()
      .transform((value) => value.replace(/\D/g, "").padStart(2, "0"))
      .pipe(z.string().regex(/^(0[1-9]|1[0-2])$/)),
    expiryYear: z
      .string()
      .transform((value) => {
        const digits = value.replace(/\D/g, "");
        return digits.length === 2 ? `20${digits}` : digits;
      })
      .pipe(z.string().regex(/^20\d{2}$/)),
    ccv: z
      .string()
      .transform((value) => value.replace(/\D/g, ""))
      .pipe(z.string().min(3).max(4)),
  }),
  creditCardHolderInfo: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(180),
    cpfCnpj: z
      .string()
      .transform(normalizeDocument)
      .refine(isValidDocument, "CPF ou CNPJ invalido"),
    postalCode: z
      .string()
      .transform((value) => value.replace(/\D/g, ""))
      .pipe(z.string().length(8)),
    addressNumber: z.string().trim().min(1).max(20),
    addressComplement: z
      .string()
      .trim()
      .max(80)
      .optional()
      .nullable()
      .transform((value) => value || null),
    phone: z
      .string()
      .optional()
      .nullable()
      .transform((value) => (value ? value.replace(/\D/g, "") : undefined)),
    mobilePhone: z
      .string()
      .optional()
      .nullable()
      .transform((value) => (value ? value.replace(/\D/g, "") : undefined)),
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

const adminSuspensionSchema = z.object({
  storeId: z.string().uuid(),
  suspended: z.boolean(),
});

const adminExemptionSchema = z.object({
  storeId: z.string().uuid(),
  profileId: z.string().uuid(),
  exempt: z.boolean(),
});

type QueryFn = typeof defaultQuery;
type ActorFn = typeof defaultGetActor;

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
  getSubscription: typeof asaas.getSubscription;
  updateSubscription: typeof asaas.updateSubscription;
  cancelSubscription: typeof asaas.cancelSubscription;
  listSubscriptionPayments: typeof asaas.listSubscriptionPayments;
};

type FunctionContext = {
  remoteIp?: string | null;
};

const defaultDeps = async (): Promise<SubscriptionDeps> => {
  return {
    getActor: defaultGetActor,
    query: defaultQuery,
    withTransaction: defaultWithTransaction,
    publishRealtime: defaultPublishRealtime,
    createCustomer: asaas.createCustomer,
    createSubscription: asaas.createSubscription,
    getSubscription: asaas.getSubscription,
    updateSubscription: asaas.updateSubscription,
    cancelSubscription: asaas.cancelSubscription,
    listSubscriptionPayments: asaas.listSubscriptionPayments,
  };
};

const todayIsoDate = businessTodayIsoDate;
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
const profileExemptionLockKey = (profileId: string) => `subscription-exemption:${profileId}`;
const exemptionCancellationAction = "EXEMPT_CANCEL";

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

const loadStorePlanSubscription = async (
  deps: SubscriptionDeps,
  storeId: string,
  planId?: string,
) => {
  const [{ rows: storeRows }, { rows: planRows }, { rows: subscriptionRows }] = await Promise.all([
    deps.query(
      `SELECT store.id,
              store.owner_user_id,
              store.name,
              store.document,
              store.whatsapp,
              store.plan_id,
              COALESCE(store.is_active, true) AS is_active,
              COALESCE(store.is_suspended, false) AS is_suspended,
              EXISTS (
                SELECT 1
                FROM public.profiles owner_profile
                WHERE owner_profile.user_id = store.owner_user_id
                  AND COALESCE(owner_profile.is_exempt, false) IS TRUE
              ) AS owner_is_exempt,
              EXISTS (
                SELECT 1
                FROM public.profiles owner_profile
                WHERE owner_profile.user_id = store.owner_user_id
                  AND COALESCE(owner_profile.billing_exemption_pending, false) IS TRUE
              ) AS owner_exemption_pending
       FROM public.stores store
       WHERE store.id = $1::uuid
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
      `SELECT s.*,
              s.updated_at::text AS updated_at_cas,
              s.last_payment_event_at::text AS last_payment_event_at_cas,
              COALESCE(s.contract_price_monthly, p.price_monthly) AS current_price_monthly,
              p.name AS current_plan_name
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

// Re-le loja, perfil proprietario e assinatura DENTRO da transacao, depois do advisory
// lock. A ordem store -> profile -> subscription tambem e usada pelos fluxos administrativos
// para impedir deadlocks e evitar que uma alteracao de cortesia/suspensao passe entre a
// validacao local e a chamada ao gateway.
const lockAndLoadSubscription = async (q: ScopedQuery, storeId: string) => {
  await q(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
    subscriptionLockKey(storeId),
  ]);
  const { rows: stores } = await q(
    `SELECT id,
            owner_user_id,
            name,
            document,
            whatsapp,
            plan_id,
            COALESCE(is_active, true) AS is_active,
            COALESCE(is_suspended, false) AS is_suspended
     FROM public.stores
     WHERE id = $1::uuid
     LIMIT 1
     FOR UPDATE`,
    [storeId],
  );
  const store = stores[0];
  if (!store) throw new Error("Loja nao encontrada.");

  const { rows: profiles } = store.owner_user_id
    ? await q(
        `SELECT id,
                user_id,
                COALESCE(is_exempt, false) AS is_exempt,
                COALESCE(billing_exemption_pending, false) AS billing_exemption_pending
         FROM public.profiles
         WHERE user_id = $1::uuid
         LIMIT 1
         FOR UPDATE`,
        [store.owner_user_id],
      )
    : { rows: [] };
  const ownerProfile = profiles[0] || null;

  const { rows: subscriptions } = await q(
    `SELECT s.*,
            s.updated_at::text AS updated_at_cas,
            s.last_payment_event_at::text AS last_payment_event_at_cas,
            COALESCE(s.contract_price_monthly, p.price_monthly) AS current_price_monthly,
            p.name AS current_plan_name
     FROM public.subscriptions s
     LEFT JOIN public.plans p ON p.id = s.plan_id
     WHERE s.store_id = $1::uuid
     FOR UPDATE OF s
     LIMIT 1`,
    [storeId],
  );
  return {
    store: {
      ...store,
      owner_is_exempt: Boolean(ownerProfile?.is_exempt),
      owner_exemption_pending: Boolean(ownerProfile?.billing_exemption_pending),
    },
    ownerProfile,
    subscription: subscriptions[0] || null,
  };
};

const lockPaidPlan = async (q: ScopedQuery, planId: string) => {
  const { rows } = await q(
    `SELECT id, name, price_monthly
     FROM public.plans
     WHERE id = $1::uuid
       AND COALESCE(is_active, true) IS TRUE
       AND COALESCE(price_monthly, 0) > 0
     LIMIT 1
     FOR SHARE`,
    [planId],
  );
  if (!rows[0]) throw new Error("Plano pago nao encontrado ou inativo.");
  return rows[0];
};

const assertStoreBillingAllowed = (store: any) => {
  if (store?.is_suspended) {
    throw new Error("Loja suspensa nao pode criar ou alterar cobrancas recorrentes.");
  }
  if (store?.is_active === false) {
    throw new Error("Loja inativa nao pode criar ou alterar cobrancas recorrentes.");
  }
  if (store?.owner_is_exempt) {
    throw new Error("Perfil com cortesia nao pode criar ou alterar cobrancas recorrentes.");
  }
  if (store?.owner_exemption_pending) {
    throw new Error("Concessao de cortesia em andamento. Aguarde a reconciliacao financeira.");
  }
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

const checkoutBlockedStatuses = new Set(["bloqueada", "suspensa", "em_disputa"]);

const assertCheckoutAllowed = (subscription: any) => {
  if (subscription?.gateway_action_pending) {
    throw new Error("Assinatura possui uma acao financeira pendente. Aguarde a reconciliacao.");
  }
  if (checkoutBlockedStatuses.has(String(subscription?.status || "").toLowerCase())) {
    throw new Error(
      "Assinatura bloqueada, suspensa ou em disputa. Regularize a situacao antes de alterar o plano.",
    );
  }
};

const gatewayPaidPaymentStatuses = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);
const gatewayTerminalRefundPaymentStatuses = new Set(["REFUNDED", "PARTIALLY_REFUNDED"]);
const gatewayDisputePaymentStatuses = new Set([
  "CHARGEBACK_REQUESTED",
  "CHARGEBACK_DISPUTE",
  "AWAITING_CHARGEBACK_REVERSAL",
]);
const gatewayFailedPaymentStatuses = new Set([
  "OVERDUE",
  ...gatewayTerminalRefundPaymentStatuses,
  ...gatewayDisputePaymentStatuses,
]);
const terminalSubscriptionStatuses = new Set(["cancelada", "encerrada", "bloqueada", "suspensa"]);

const requiredAmountInCents = (value: unknown) => {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim()))
    return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const cents = toCents(numeric);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
};

const isTerminalSubscription = (subscription: any) =>
  Boolean(subscription?.canceled_at) ||
  terminalSubscriptionStatuses.has(String(subscription?.status || "").toLowerCase());

const subscriptionCasValues = (subscription: any) => [
  subscription.updated_at_cas ?? subscription.updated_at ?? null,
  subscription.last_payment_event_at_cas ?? subscription.last_payment_event_at ?? null,
  subscription.plan_id ?? null,
  subscription.contract_price_monthly ?? null,
];

const subscriptionCasSql = `
  AND updated_at IS NOT DISTINCT FROM $4::timestamptz
  AND last_payment_event_at IS NOT DISTINCT FROM $5::timestamptz
  AND plan_id IS NOT DISTINCT FROM $6::uuid
  AND contract_price_monthly IS NOT DISTINCT FROM $7::numeric`;

const paymentTimestamp = (payment: any) => {
  const value =
    payment?.paymentDate ||
    payment?.confirmedDate ||
    payment?.clientPaymentDate ||
    payment?.dateCreated ||
    payment?.dueDate;
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeGatewayPayments = (response: any) => {
  const payments = Array.isArray(response?.data)
    ? response.data
    : Array.isArray(response)
      ? response
      : [];
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
const cancelGatewaySubscriptionOrThrow = async (
  deps: SubscriptionDeps,
  gatewaySubscriptionId: string,
  fallbackMessage: string,
) => {
  const canceled = await deps.cancelSubscription(gatewaySubscriptionId);
  if (canceled?.errors) {
    throw new Error(canceled.errors[0]?.description || fallbackMessage);
  }
  return canceled;
};

const cancelExistingGatewaySubscription = async (deps: SubscriptionDeps, subscription: any) => {
  if (!subscription?.asaas_subscription_id) return;
  await cancelGatewaySubscriptionOrThrow(
    deps,
    subscription.asaas_subscription_id,
    "Falha ao cancelar a assinatura anterior no gateway. Operacao abortada para evitar cobranca duplicada.",
  );
};

const applyPendingGatewayAction = async (
  deps: SubscriptionDeps,
  subscription: any,
  gatewaySnapshot?: any,
) => {
  const action = String(subscription?.gateway_action_pending || "").toUpperCase();
  if (action === exemptionCancellationAction) return subscription;
  if (!new Set(["CANCEL", "INACTIVE", "ACTIVE"]).has(action)) {
    return subscription;
  }
  if (!subscription?.asaas_subscription_id) {
    throw new Error("Acao pendente da assinatura sem identificador do gateway.");
  }

  let gatewayResult: any;
  let gatewaySubscriptionExpired = false;
  if (action === "CANCEL") {
    gatewayResult = await deps.cancelSubscription(subscription.asaas_subscription_id);
  } else {
    const remote =
      gatewaySnapshot || (await deps.getSubscription(subscription.asaas_subscription_id));
    const remoteStatus = String(remote?.status || "").toUpperCase();
    const remoteSubscriptionIsTerminal = remoteStatus === "EXPIRED";
    if (remote?.errors && !remoteSubscriptionIsTerminal) {
      throw new Error(
        remote.errors[0]?.description || "Nao foi possivel reconciliar o estado da assinatura.",
      );
    }
    if (!remoteSubscriptionIsTerminal && !new Set(["ACTIVE", "INACTIVE"]).has(remoteStatus)) {
      throw new Error("O gateway retornou um estado invalido para reconciliar a assinatura.");
    }
    if (remoteSubscriptionIsTerminal) {
      gatewaySubscriptionExpired = true;
      gatewayResult = { success: true, alreadyExpired: true };
    } else if (remoteStatus === action) {
      gatewayResult = { success: true, alreadyApplied: true };
    } else {
      const nextDueDate =
        action === "ACTIVE"
          ? nextFutureMonthlyDueDate(remote?.nextDueDate || subscription.next_due_date)
          : null;
      if (action === "ACTIVE" && !nextDueDate) {
        throw new Error("Reativacao pendente sem proxima data de vencimento valida.");
      }
      gatewayResult = await deps.updateSubscription(subscription.asaas_subscription_id, {
        status: action as "ACTIVE" | "INACTIVE",
        ...(action === "ACTIVE" ? { nextDueDate: nextDueDate || undefined } : {}),
      });
    }
  }
  if (gatewayResult?.errors) {
    throw new Error(
      gatewayResult.errors[0]?.description ||
        `Nao foi possivel concluir a acao ${action.toLowerCase()} no gateway.`,
    );
  }
  const { rows } = await deps.query(
    `UPDATE public.subscriptions
     SET status = CASE WHEN $5::boolean THEN 'encerrada' ELSE status END,
         cancellation_effective_at = CASE
           WHEN $5::boolean THEN COALESCE(
             cancellation_effective_at,
             current_period_end,
             next_due_date::timestamptz,
             now()
           )
           ELSE cancellation_effective_at
         END,
         gateway_action_pending = NULL,
         gateway_paused_for_dispute = CASE
           WHEN $5::boolean THEN false
           WHEN $4 = 'INACTIVE' THEN true
           WHEN $4 IN ('ACTIVE', 'CANCEL') THEN false
           ELSE gateway_paused_for_dispute
         END,
         updated_at = now()
     WHERE id = $1::uuid
       AND store_id = $2::uuid
       AND asaas_subscription_id = $3
       AND gateway_action_pending = $4
     RETURNING *,
               updated_at::text AS updated_at_cas,
               last_payment_event_at::text AS last_payment_event_at_cas`,
    [
      subscription.id,
      subscription.store_id,
      subscription.asaas_subscription_id,
      action,
      gatewaySubscriptionExpired,
    ],
  );
  if (!rows[0]) {
    throw new Error("A assinatura mudou antes da confirmacao do cancelamento no gateway.");
  }
  return rows[0];
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
    priceMonthly: number;
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
       billing_type, external_reference, status, last_payment_status,
       contract_price_monthly, next_due_date, gateway_action_pending,
       gateway_paused_for_dispute,
       updated_at
     )
     VALUES ($1::uuid, $2::uuid, 'asaas', $3::text, $4::text, $5::text, $6::text,
       $7::text, 'pending', $8::numeric, $9::date, NULL, false, now())
     ON CONFLICT (store_id)
     DO UPDATE SET
       plan_id = EXCLUDED.plan_id,
       provider = EXCLUDED.provider,
       asaas_customer_id = COALESCE(EXCLUDED.asaas_customer_id, public.subscriptions.asaas_customer_id),
       previous_asaas_subscription_ids = CASE
         WHEN public.subscriptions.asaas_subscription_id IS NOT NULL
           AND EXCLUDED.asaas_subscription_id IS NOT NULL
           AND public.subscriptions.asaas_subscription_id <> EXCLUDED.asaas_subscription_id
           AND NOT (
             public.subscriptions.asaas_subscription_id
             = ANY(public.subscriptions.previous_asaas_subscription_ids)
           )
           THEN array_append(
             public.subscriptions.previous_asaas_subscription_ids,
             public.subscriptions.asaas_subscription_id
           )
         ELSE public.subscriptions.previous_asaas_subscription_ids
       END,
       asaas_subscription_id = COALESCE(EXCLUDED.asaas_subscription_id, public.subscriptions.asaas_subscription_id),
       billing_type = EXCLUDED.billing_type,
       external_reference = EXCLUDED.external_reference,
       status = EXCLUDED.status,
       last_payment_status = EXCLUDED.last_payment_status,
       contract_price_monthly = EXCLUDED.contract_price_monthly,
       next_due_date = EXCLUDED.next_due_date,
       canceled_at = NULL,
       cancellation_effective_at = NULL,
       gateway_action_pending = NULL,
       gateway_paused_for_dispute = false,
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
      data.priceMonthly,
      data.nextDueDate,
    ],
  );

  deps.publishRealtime({
    schema: "public",
    table: "subscriptions",
    eventType: "UPDATE",
    new: rows[0],
    old: null,
  });
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
      externalReference: `platform-store:${storeId}`,
    },
    undefined,
    { idempotencyKey: asaasIdempotencyKey("pc", storeId) },
  );
  if (customer.errors)
    throw new Error(customer.errors[0]?.description || "Erro ao criar cliente no gateway.");
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

  const { store, subscription: existingSubscription } = await loadStorePlanSubscription(
    deps,
    data.storeId,
    data.planId,
  );
  assertStoreBillingAllowed(store);
  assertCheckoutAllowed(existingSubscription);
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
    const lockedState = await lockAndLoadSubscription(q, data.storeId);
    const locked = lockedState.subscription;
    const lockedPlan = await lockPaidPlan(q, data.planId);
    assertStoreBillingAllowed(lockedState.store);
    assertCheckoutAllowed(locked);

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
    if (isActiveSubscription(locked)) validateUpgrade(locked, lockedPlan);

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
        plan: lockedPlan,
        nextDueDate,
        externalReference,
        cardData: data.cardData,
        remoteIp,
      }),
      // Defesa em profundidade contra retry/timeout: se a 1a tentativa criou a assinatura
      // mas estourou o timeout, o retry com a mesma chave nao duplica no gateway.
      {
        idempotencyKey: asaasIdempotencyKey(
          "ps",
          data.storeId,
          data.planId,
          nextDueDate,
          locked?.asaas_subscription_id || "new",
        ),
      },
    );
    if (subscription.errors)
      throw new Error(
        subscription.errors[0]?.description || "Erro ao criar assinatura no gateway.",
      );
    if (!subscription.id) throw new Error("Assinatura do gateway nao foi criada para a loja.");

    await persistSubscription(deps, q, {
      storeId: data.storeId,
      planId: data.planId,
      asaasCustomerId: customerId,
      asaasSubscriptionId: subscription.id,
      billingType,
      status: "pendente_pagamento",
      priceMonthly: Number(lockedPlan.price_monthly),
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

  const { store } = await loadStorePlanSubscription(deps, data.storeId, data.planId);
  assertStoreBillingAllowed(store);
  const externalReference = `platform-subscription:${data.storeId}`;

  return await deps.withTransaction(async (client) => {
    const q: ScopedQuery = (text, params) => client.query(text, params as any);
    const lockedState = await lockAndLoadSubscription(q, data.storeId);
    const subscription = lockedState.subscription;
    const lockedPlan = await lockPaidPlan(q, data.planId);
    assertStoreBillingAllowed(lockedState.store);
    if (!subscription?.asaas_subscription_id) {
      throw new Error(
        "Assinatura existente nao encontrada. Inicie uma assinatura antes de alterar plano.",
      );
    }
    assertCheckoutAllowed(subscription);
    validateUpgrade(subscription, lockedPlan);

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
          plan: lockedPlan,
          nextDueDate: todayIsoDate(),
          externalReference: effectiveExternalReference,
          cardData: data.cardData,
          remoteIp: resolveRemoteIp(context),
        }),
        {
          idempotencyKey: asaasIdempotencyKey(
            "ps",
            data.storeId,
            data.planId,
            todayIsoDate(),
            subscription.asaas_subscription_id,
          ),
        },
      );
      if (created.errors)
        throw new Error(created.errors[0]?.description || "Erro ao criar assinatura no gateway.");
      if (!created.id) throw new Error("Assinatura do gateway nao foi criada para a loja.");

      await persistSubscription(deps, q, {
        storeId: data.storeId,
        planId: data.planId,
        asaasCustomerId: customerId,
        asaasSubscriptionId: created.id,
        billingType,
        status: "pendente_pagamento",
        priceMonthly: Number(lockedPlan.price_monthly),
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
      value: Number(lockedPlan.price_monthly),
      nextDueDate,
      cycle: "MONTHLY",
      description: `Assinatura Plano ${lockedPlan.name} - Hype Delivery`,
      externalReference: effectiveExternalReference,
    });
    if (updated.errors)
      throw new Error(updated.errors[0]?.description || "Erro ao atualizar assinatura no gateway.");

    await persistSubscription(deps, q, {
      storeId: data.storeId,
      planId: data.planId,
      asaasCustomerId: subscription.asaas_customer_id || updated.customer || null,
      asaasSubscriptionId: subscription.asaas_subscription_id,
      billingType,
      status: subscription.status === "ativa" ? "ativa" : "pendente_pagamento",
      priceMonthly: Number(lockedPlan.price_monthly),
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

  let { subscription } = await loadStorePlanSubscription(deps, data.storeId);
  if (!subscription) return { success: true, status: "sem_assinatura", synced: false };
  if (!subscription.asaas_subscription_id) {
    return {
      success: true,
      status: subscription.status,
      synced: false,
      message: "Assinatura sem ID do gateway.",
    };
  }
  if (subscription.gateway_action_pending === exemptionCancellationAction) {
    return {
      success: true,
      status: subscription.status,
      synced: false,
      activationBlocked: true,
      reason: "billing_exemption_pending",
      message: "Concessao de cortesia aguardando reconciliacao administrativa.",
    };
  }
  if (isTerminalSubscription(subscription)) {
    let reconciled = subscription;
    if (subscription.gateway_action_pending === "CANCEL") {
      reconciled = await applyPendingGatewayAction(deps, subscription);
    } else if (["ACTIVE", "INACTIVE"].includes(subscription.gateway_action_pending)) {
      const { rows } = await deps.query(
        `UPDATE public.subscriptions
         SET gateway_action_pending = NULL,
             gateway_paused_for_dispute = false,
             updated_at = now()
         WHERE id = $1::uuid
           AND store_id = $2::uuid
           AND asaas_subscription_id = $3
           AND gateway_action_pending = $4
           AND (
             canceled_at IS NOT NULL
             OR lower(COALESCE(status, '')) IN ('cancelada', 'encerrada', 'bloqueada', 'suspensa')
           )
         RETURNING *,
                   updated_at::text AS updated_at_cas,
                   last_payment_event_at::text AS last_payment_event_at_cas`,
        [
          subscription.id,
          subscription.store_id,
          subscription.asaas_subscription_id,
          subscription.gateway_action_pending,
        ],
      );
      if (!rows[0]) {
        throw new Error("A assinatura mudou antes da limpeza da acao terminal pendente.");
      }
      reconciled = rows[0];
    }
    if (reconciled !== subscription) {
      deps.publishRealtime({
        schema: "public",
        table: "subscriptions",
        eventType: "UPDATE",
        new: reconciled,
        old: subscription,
      });
    }
    return {
      success: true,
      status: reconciled.status,
      synced: false,
      activationBlocked: true,
      reason: "terminal_subscription",
      message:
        "Assinatura cancelada ou encerrada nao pode ser reativada por pagamentos anteriores.",
    };
  }
  if (subscription.gateway_action_pending) {
    const beforeReconciliation = subscription;
    subscription = await applyPendingGatewayAction(deps, subscription);
    if (subscription !== beforeReconciliation) {
      deps.publishRealtime({
        schema: "public",
        table: "subscriptions",
        eventType: "UPDATE",
        new: subscription,
        old: beforeReconciliation,
      });
    }
  }
  if (isTerminalSubscription(subscription)) {
    return {
      success: true,
      status: subscription.status,
      synced: false,
      activationBlocked: true,
      reason: "terminal_subscription",
      message: "A assinatura expirou no gateway e foi encerrada localmente.",
    };
  }

  const gatewayResponse = await deps.listSubscriptionPayments(subscription.asaas_subscription_id);
  if (gatewayResponse?.errors) {
    throw new Error(
      gatewayResponse.errors[0]?.description ||
        "Nao foi possivel consultar pagamentos da assinatura.",
    );
  }

  const payments = normalizeGatewayPayments(gatewayResponse);
  const terminalRefundPayment = payments.find((payment: any) =>
    gatewayTerminalRefundPaymentStatuses.has(String(payment.status || "").toUpperCase()),
  );
  const paidPayment = payments.find((payment: any) =>
    gatewayPaidPaymentStatuses.has(String(payment.status || "").toUpperCase()),
  );
  const failedPayment = payments.find((payment: any) =>
    gatewayFailedPaymentStatuses.has(String(payment.status || "").toUpperCase()),
  );

  // Refund confirmado e terminal para esta recorrencia e sempre prevalece. Nos demais
  // estados, decide pelo pagamento acionado mais recente (pago x falho/disputa).
  let actionedPayment: any = null;
  if (terminalRefundPayment) {
    actionedPayment = terminalRefundPayment;
  } else if (paidPayment && failedPayment) {
    actionedPayment =
      paymentTimestamp(failedPayment) > paymentTimestamp(paidPayment) ? failedPayment : paidPayment;
  } else {
    actionedPayment = paidPayment || failedPayment || null;
  }
  const isPaid = Boolean(actionedPayment) && actionedPayment === paidPayment;
  const referencePayment = actionedPayment || payments[0] || null;
  const gatewayStatus = referencePayment?.status
    ? String(referencePayment.status).toUpperCase()
    : null;

  if (!referencePayment) {
    return {
      success: true,
      status: subscription.status,
      synced: false,
      message: "Nenhuma cobranca encontrada para esta assinatura.",
    };
  }

  if (!actionedPayment) {
    const { rows } = await deps.query(
      `UPDATE public.subscriptions
       SET last_payment_status = $8,
           next_due_date = COALESCE($9::date, next_due_date),
           updated_at = now()
       WHERE id = $1::uuid
         AND store_id = $2::uuid
         AND asaas_subscription_id = $3
         ${subscriptionCasSql}
       RETURNING *`,
      [
        subscription.id,
        data.storeId,
        subscription.asaas_subscription_id,
        ...subscriptionCasValues(subscription),
        gatewayStatus,
        dueDateForGatewayPayment(referencePayment, subscription),
      ],
    );
    const updated = rows[0];
    if (!updated) {
      throw new Error("A assinatura mudou durante a sincronizacao. Tente novamente.");
    }
    deps.publishRealtime({
      schema: "public",
      table: "subscriptions",
      eventType: "UPDATE",
      new: updated,
      old: subscription,
    });
    return { success: true, status: updated.status, gatewayStatus, synced: true };
  }

  const terminalRefund = gatewayTerminalRefundPaymentStatuses.has(gatewayStatus || "");
  if (terminalRefund) {
    const { rows } = await deps.query(
      `UPDATE public.subscriptions
       SET status = 'cancelada',
           last_payment_status = $8,
           current_period_end = now(),
           canceled_at = COALESCE(canceled_at, now()),
           cancellation_effective_at = now(),
           gateway_action_pending = 'CANCEL',
           gateway_paused_for_dispute = false,
           updated_at = now()
       WHERE id = $1::uuid
         AND store_id = $2::uuid
         AND asaas_subscription_id = $3
         ${subscriptionCasSql}
       RETURNING *`,
      [
        subscription.id,
        data.storeId,
        subscription.asaas_subscription_id,
        ...subscriptionCasValues(subscription),
        gatewayStatus,
      ],
    );
    const updated = rows[0];
    if (!updated) {
      throw new Error("A assinatura mudou durante a sincronizacao. Tente novamente.");
    }
    const reconciled = await applyPendingGatewayAction(deps, updated);
    deps.publishRealtime({
      schema: "public",
      table: "subscriptions",
      eventType: "UPDATE",
      new: reconciled,
      old: subscription,
    });
    return {
      success: true,
      status: reconciled.status,
      gatewayStatus,
      paymentId: referencePayment.id || null,
      synced: true,
      activationBlocked: true,
      reason: "refunded_payment",
      message: "Assinatura cancelada imediatamente apos estorno confirmado no gateway.",
    };
  }

  const nextStatus = isPaid
    ? "ativa"
    : gatewayDisputePaymentStatuses.has(gatewayStatus || "")
      ? "em_disputa"
      : "inadimplente";
  const paidAt = isPaid ? paidAtForGatewayPayment(actionedPayment) : null;
  let dueDate = dueDateForGatewayPayment(referencePayment, subscription);
  const dispute = gatewayDisputePaymentStatuses.has(gatewayStatus || "");
  const recoveredFromDispute =
    isPaid &&
    (String(subscription.status || "").toLowerCase() === "em_disputa" ||
      Boolean(subscription.gateway_paused_for_dispute));
  let gatewaySubscriptionSnapshot: any = null;
  if (recoveredFromDispute) {
    gatewaySubscriptionSnapshot = await deps.getSubscription(subscription.asaas_subscription_id);
    if (gatewaySubscriptionSnapshot?.errors) {
      throw new Error(
        gatewaySubscriptionSnapshot.errors[0]?.description ||
          "Nao foi possivel consultar a proxima cobranca da assinatura.",
      );
    }
    dueDate = nextFutureMonthlyDueDate(gatewaySubscriptionSnapshot?.nextDueDate || dueDate);
    if (!dueDate) {
      throw new Error("O gateway nao informou uma proxima data valida para reativar a assinatura.");
    }
  }
  const gatewayAction = dispute ? "INACTIVE" : recoveredFromDispute ? "ACTIVE" : null;
  const expectedCents = requiredAmountInCents(subscription.current_price_monthly);
  const receivedCents = isPaid ? requiredAmountInCents(actionedPayment?.value) : null;

  if (
    isPaid &&
    (expectedCents === null || receivedCents === null || expectedCents !== receivedCents)
  ) {
    const { rows } = await deps.query(
      `UPDATE public.subscriptions
       SET status = CASE
             WHEN canceled_at IS NOT NULL
               OR lower(COALESCE(status, '')) IN ('cancelada', 'encerrada', 'bloqueada', 'suspensa')
               THEN status
             ELSE 'inadimplente'
           END,
           last_payment_status = CASE
             WHEN canceled_at IS NOT NULL
               OR lower(COALESCE(status, '')) IN ('cancelada', 'encerrada', 'bloqueada', 'suspensa')
               THEN last_payment_status
             ELSE 'PAYMENT_VALUE_MISMATCH'
           END,
           updated_at = now()
       WHERE id = $1::uuid
         AND store_id = $2::uuid
         AND asaas_subscription_id = $3
         ${subscriptionCasSql}
       RETURNING *`,
      [
        subscription.id,
        data.storeId,
        subscription.asaas_subscription_id,
        ...subscriptionCasValues(subscription),
      ],
    );
    const updated = rows[0];
    if (!updated) {
      throw new Error("A assinatura mudou durante a sincronizacao. Tente novamente.");
    }
    deps.publishRealtime({
      schema: "public",
      table: "subscriptions",
      eventType: "UPDATE",
      new: updated,
      old: subscription,
    });
    console.error(
      JSON.stringify({
        scope: "asaas:subscription-sync",
        storeId: data.storeId,
        paymentId: actionedPayment?.id || null,
        alert: "subscription_payment_value_mismatch",
        expectedCents,
        receivedCents,
      }),
    );
    return {
      success: true,
      status: updated.status,
      gatewayStatus,
      paymentId: referencePayment.id || null,
      synced: true,
      activationBlocked: true,
      reason: "payment_value_mismatch",
      message: "O valor confirmado no gateway diverge do preco esperado do plano.",
    };
  }

  const { rows } = await deps.query(
    `UPDATE public.subscriptions
     SET status = CASE
           WHEN canceled_at IS NOT NULL
             OR lower(COALESCE(status, '')) IN ('cancelada', 'encerrada', 'bloqueada', 'suspensa')
             THEN status
            ELSE $8
         END,
         last_payment_status = CASE
           WHEN canceled_at IS NOT NULL
             OR lower(COALESCE(status, '')) IN ('cancelada', 'encerrada', 'bloqueada', 'suspensa')
             THEN last_payment_status
            ELSE $9
         END,
         current_period_start = CASE
            WHEN $8 = 'ativa'
             AND canceled_at IS NULL
             AND lower(COALESCE(status, '')) NOT IN ('cancelada', 'encerrada', 'bloqueada', 'suspensa')
              THEN COALESCE($10::timestamptz, current_period_start, now())
           ELSE current_period_start
         END,
         current_period_end = CASE
            WHEN $8 = 'ativa'
             AND canceled_at IS NULL
             AND lower(COALESCE(status, '')) NOT IN ('cancelada', 'encerrada', 'bloqueada', 'suspensa')
              THEN COALESCE(($11::date + INTERVAL '30 days')::timestamptz, current_period_end, now() + INTERVAL '30 days')
           ELSE current_period_end
         END,
         next_due_date = CASE
           WHEN canceled_at IS NULL
             AND lower(COALESCE(status, '')) NOT IN ('cancelada', 'encerrada', 'bloqueada', 'suspensa')
              THEN COALESCE($11::date, next_due_date)
           ELSE next_due_date
         END,
         gateway_action_pending = COALESCE($12::text, gateway_action_pending),
         gateway_paused_for_dispute = CASE
           WHEN $12 = 'INACTIVE' THEN true
           ELSE gateway_paused_for_dispute
         END,
         updated_at = now()
     WHERE id = $1::uuid
       AND store_id = $2::uuid
       AND asaas_subscription_id = $3
       ${subscriptionCasSql}
      RETURNING *`,
    [
      subscription.id,
      data.storeId,
      subscription.asaas_subscription_id,
      ...subscriptionCasValues(subscription),
      nextStatus,
      gatewayStatus,
      paidAt,
      dueDate,
      gatewayAction,
    ],
  );
  let updated = rows[0];
  if (!updated) {
    throw new Error("A assinatura mudou durante a sincronizacao. Tente novamente.");
  }
  if (gatewayAction) {
    updated = await applyPendingGatewayAction(deps, updated, gatewaySubscriptionSnapshot);
  }
  deps.publishRealtime({
    schema: "public",
    table: "subscriptions",
    eventType: "UPDATE",
    new: updated,
    old: subscription,
  });
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

  const result = await deps.withTransaction(async (client) => {
    const q: ScopedQuery = (text, params) => client.query(text, params as any);
    const lockedState = await lockAndLoadSubscription(q, data.storeId);
    const subscription = lockedState.subscription;
    if (!subscription) throw new Error("Assinatura nao encontrada.");
    if (subscription.gateway_action_pending === exemptionCancellationAction) {
      throw new Error("Concessao de cortesia em andamento. Conclua a reconciliacao primeiro.");
    }

    if (subscription.asaas_subscription_id) {
      await cancelGatewaySubscriptionOrThrow(
        deps,
        subscription.asaas_subscription_id,
        "Erro ao cancelar assinatura no gateway.",
      );
    }

    if (subscription.status === "cancelada" || subscription.status === "encerrada") {
      const { rows } = await q(
        `UPDATE public.subscriptions
         SET gateway_action_pending = NULL,
             gateway_paused_for_dispute = false,
             updated_at = now()
         WHERE id = $1::uuid
           AND store_id = $2::uuid
           AND asaas_subscription_id IS NOT DISTINCT FROM $3::text
         RETURNING *`,
        [subscription.id, data.storeId, subscription.asaas_subscription_id || null],
      );
      if (!rows[0]) {
        throw new Error("A assinatura mudou durante o cancelamento. Tente novamente.");
      }
      return { previous: subscription, updated: rows[0] };
    }

    const effectiveAt =
      subscription.current_period_end || subscription.next_due_date || new Date().toISOString();
    const { rows } = await q(
      `UPDATE public.subscriptions
       SET status = 'cancelada',
           canceled_at = now(),
           cancellation_effective_at = $4::timestamptz,
           gateway_action_pending = NULL,
           gateway_paused_for_dispute = false,
           updated_at = now()
       WHERE id = $1::uuid
         AND store_id = $2::uuid
         AND asaas_subscription_id IS NOT DISTINCT FROM $3::text
       RETURNING *`,
      [subscription.id, data.storeId, subscription.asaas_subscription_id || null, effectiveAt],
    );
    if (!rows[0]) {
      throw new Error("A assinatura mudou durante o cancelamento. Tente novamente.");
    }
    return { previous: subscription, updated: rows[0] };
  });

  if (result.updated) {
    deps.publishRealtime({
      schema: "public",
      table: "subscriptions",
      eventType: "UPDATE",
      new: result.updated,
      old: result.previous,
    });
  }
  const effectiveSubscription = result.updated || result.previous;
  return {
    success: true,
    status: effectiveSubscription.status,
    cancellationEffectiveAt: effectiveSubscription.cancellation_effective_at,
  };
};

export const adminSetStoreSuspensionHandler = async (
  input: unknown,
  token?: string,
  depsPromise: Promise<SubscriptionDeps> = defaultDeps(),
) => {
  const deps = await depsPromise;
  const data = adminSuspensionSchema.parse(input);
  const actor = await deps.getActor(token);
  if (!actor) throw new Error("Nao autenticado.");
  if (!actor.admin) throw new Error("Acesso negado.");

  const result = await deps.withTransaction(async (client) => {
    const q: ScopedQuery = (text, params) => client.query(text, params as any);
    await q(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      subscriptionLockKey(data.storeId),
    ]);
    const { rows: stores } = await q(
      `SELECT id, is_suspended
       FROM public.stores
       WHERE id = $1::uuid
       LIMIT 1
       FOR UPDATE`,
      [data.storeId],
    );
    const store = stores[0];
    if (!store) throw new Error("Loja nao encontrada.");

    const { rows: subscriptions } = await q(
      `SELECT *
       FROM public.subscriptions
       WHERE store_id = $1::uuid
       LIMIT 1
       FOR UPDATE`,
      [data.storeId],
    );
    const subscription = subscriptions[0] || null;
    if (subscription?.gateway_action_pending === exemptionCancellationAction) {
      throw new Error("Concessao de cortesia em andamento. Conclua a reconciliacao primeiro.");
    }

    if (data.suspended && subscription?.asaas_subscription_id) {
      const canceled = await deps.cancelSubscription(subscription.asaas_subscription_id);
      if (canceled?.errors) {
        throw new Error(
          canceled.errors[0]?.description ||
            "Nao foi possivel interromper a recorrencia antes de suspender a loja.",
        );
      }
    }

    const { rows: updatedStores } = await q(
      `UPDATE public.stores
       SET is_suspended = $2::boolean,
           updated_at = now()
       WHERE id = $1::uuid
       RETURNING *`,
      [data.storeId, data.suspended],
    );

    let updatedSubscription = subscription;
    if (data.suspended && subscription) {
      const { rows } = await q(
        `UPDATE public.subscriptions
         SET status = CASE
               WHEN lower(COALESCE(status, '')) = 'encerrada' THEN status
               ELSE 'cancelada'
             END,
             canceled_at = COALESCE(canceled_at, now()),
             cancellation_effective_at = COALESCE(
               cancellation_effective_at,
               current_period_end,
               next_due_date::timestamptz,
               now()
             ),
             gateway_action_pending = NULL,
             gateway_paused_for_dispute = false,
             updated_at = now()
         WHERE id = $1::uuid
           AND store_id = $2::uuid
         RETURNING *`,
        [subscription.id, data.storeId],
      );
      updatedSubscription = rows[0] || subscription;
    }

    return {
      store: updatedStores[0] || store,
      subscription: updatedSubscription,
    };
  });

  deps.publishRealtime({
    schema: "public",
    table: "stores",
    eventType: "UPDATE",
    new: result.store,
    old: null,
  });
  if (result.subscription) {
    deps.publishRealtime({
      schema: "public",
      table: "subscriptions",
      eventType: "UPDATE",
      new: result.subscription,
      old: null,
    });
  }
  return {
    success: true,
    suspended: Boolean(result.store?.is_suspended),
    subscriptionStatus: result.subscription?.status || null,
  };
};

const lockExemptionScope = async (
  q: ScopedQuery,
  data: z.infer<typeof adminExemptionSchema>,
  expectedProfileVersion: string | Date | null = null,
) => {
  await q(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
    profileExemptionLockKey(data.profileId),
  ]);

  const { rows: preflightRows } = await q(
    `SELECT profile.id,
            profile.user_id,
            COALESCE(profile.is_exempt, false) AS is_exempt,
            requested_store.id AS requested_store_id
     FROM public.profiles profile
     JOIN public.stores requested_store
       ON requested_store.id = $2::uuid
      AND requested_store.owner_user_id = profile.user_id
     WHERE profile.id = $1::uuid
     LIMIT 1`,
    [data.profileId, data.storeId],
  );
  const preflight = preflightRows[0];
  if (!preflight) throw new Error("Perfil responsavel pela loja nao encontrado.");

  const { rows: candidateStores } = await q(
    `SELECT id
     FROM public.stores
     WHERE owner_user_id = $1::uuid
     ORDER BY id`,
    [preflight.user_id],
  );
  const storeIds = candidateStores.map((store: any) => String(store.id)).sort();
  if (!storeIds.includes(data.storeId)) {
    throw new Error("Loja informada nao pertence ao perfil responsavel.");
  }

  for (const ownerStoreId of storeIds) {
    await q(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      subscriptionLockKey(ownerStoreId),
    ]);
  }

  const { rows: lockedStores } = await q(
    `SELECT id
     FROM public.stores
     WHERE owner_user_id = $1::uuid
     ORDER BY id
     FOR UPDATE`,
    [preflight.user_id],
  );
  const lockedStoreIds = lockedStores.map((store: any) => String(store.id)).sort();
  if (
    lockedStoreIds.length !== storeIds.length ||
    lockedStoreIds.some((storeId: string, index: number) => storeId !== storeIds[index])
  ) {
    throw new Error("As lojas do perfil mudaram durante a concessao da cortesia. Tente novamente.");
  }

  const { rows: profiles } = await q(
    `SELECT id,
            user_id,
            COALESCE(is_exempt, false) AS is_exempt,
            COALESCE(billing_exemption_pending, false) AS billing_exemption_pending,
            updated_at,
            updated_at::text AS updated_at_version
     FROM public.profiles
     WHERE id = $1::uuid
       AND user_id = $2::uuid
       AND ($3::timestamptz IS NULL OR updated_at IS NOT DISTINCT FROM $3::timestamptz)
     LIMIT 1
     FOR UPDATE`,
    [data.profileId, preflight.user_id, expectedProfileVersion],
  );
  const profile = profiles[0];
  if (!profile) {
    throw new Error("O perfil mudou durante a concessao da cortesia. Tente novamente.");
  }

  const { rows: subscriptions } = storeIds.length
    ? await q(
        `SELECT *
         FROM public.subscriptions
         WHERE store_id = ANY($1::uuid[])
         ORDER BY store_id
         FOR UPDATE`,
        [storeIds],
      )
    : { rows: [] };

  return { profile, storeIds, subscriptions };
};

export const adminSetStoreExemptionHandler = async (
  input: unknown,
  token?: string,
  depsPromise: Promise<SubscriptionDeps> = defaultDeps(),
) => {
  const deps = await depsPromise;
  const data = adminExemptionSchema.parse(input);
  const actor = await deps.getActor(token);
  if (!actor) throw new Error("Nao autenticado.");
  if (!actor.admin) throw new Error("Acesso negado.");

  // Persist the cancellation intent before any external side effect. If the
  // process stops after one of several gateway calls, every affected row keeps
  // a durable CANCEL outbox and a retry can safely resume the operation.
  const preparedProfileVersion = data.exempt
    ? await deps.withTransaction(async (client) => {
        const q: ScopedQuery = (text, params) => client.query(text, params as any);
        const scope = await lockExemptionScope(q, data);
        const conflictingAction = scope.subscriptions.find(
          (subscription: any) =>
            subscription.gateway_action_pending &&
            subscription.gateway_action_pending !== exemptionCancellationAction,
        );
        if (conflictingAction) {
          throw new Error(
            "Existe uma acao financeira pendente. Reconcilie-a antes de conceder cortesia.",
          );
        }
        await q(
          `UPDATE public.subscriptions
           SET gateway_action_pending = 'EXEMPT_CANCEL',
               updated_at = now()
           WHERE store_id = ANY($1::uuid[])
             AND asaas_subscription_id IS NOT NULL`,
          [scope.storeIds],
        );
        const { rows } = await q(
          `UPDATE public.profiles
           SET billing_exemption_pending = true,
               updated_at = clock_timestamp()
           WHERE id = $1::uuid
             AND user_id = $2::uuid
           RETURNING updated_at::text AS updated_at_version`,
          [data.profileId, scope.profile.user_id],
        );
        if (!rows[0]?.updated_at_version) {
          throw new Error(
            "Perfil responsavel pela loja mudou durante a operacao. Tente novamente.",
          );
        }
        return {
          profileVersion: String(rows[0].updated_at_version),
          storeIds: scope.storeIds,
        };
      })
    : null;

  const result = await deps.withTransaction(async (client) => {
    const q: ScopedQuery = (text, params) => client.query(text, params as any);
    const { profile, storeIds, subscriptions } = await lockExemptionScope(
      q,
      data,
      preparedProfileVersion?.profileVersion || null,
    );

    if (
      preparedProfileVersion &&
      (storeIds.length !== preparedProfileVersion.storeIds.length ||
        storeIds.some(
          (storeId: string, index: number) => storeId !== preparedProfileVersion.storeIds[index],
        ))
    ) {
      throw new Error(
        "As lojas do perfil mudaram durante a concessao da cortesia. Tente novamente.",
      );
    }
    if (data.exempt && !profile.billing_exemption_pending) {
      throw new Error("A preparacao da cortesia foi interrompida. Tente novamente.");
    }
    if (!data.exempt && profile.billing_exemption_pending) {
      throw new Error("Conclua a concessao de cortesia pendente antes de remove-la.");
    }

    if (data.exempt) {
      const unpreparedSubscription = subscriptions.find(
        (subscription: any) =>
          subscription.asaas_subscription_id &&
          subscription.gateway_action_pending !== exemptionCancellationAction,
      );
      if (unpreparedSubscription) {
        throw new Error("Uma assinatura nao foi preparada para a concessao da cortesia.");
      }
      for (const subscription of subscriptions) {
        if (!subscription.asaas_subscription_id) continue;
        await cancelGatewaySubscriptionOrThrow(
          deps,
          subscription.asaas_subscription_id,
          "Nao foi possivel interromper todas as recorrencias antes de conceder a cortesia.",
        );
      }
    }

    const updatedSubscriptions: any[] = [];
    if (data.exempt) {
      for (const subscription of subscriptions) {
        const { rows } = await q(
          `UPDATE public.subscriptions
           SET status = CASE
                 WHEN lower(COALESCE(status, '')) = 'encerrada' THEN status
                 ELSE 'cancelada'
               END,
               canceled_at = COALESCE(canceled_at, now()),
               cancellation_effective_at = COALESCE(
                 cancellation_effective_at,
                 current_period_end,
                 next_due_date::timestamptz,
                 now()
               ),
               gateway_action_pending = NULL,
               gateway_paused_for_dispute = false,
               updated_at = now()
           WHERE id = $1::uuid
             AND store_id = $2::uuid
             AND asaas_subscription_id IS NOT DISTINCT FROM $3::text
           RETURNING *`,
          [subscription.id, subscription.store_id, subscription.asaas_subscription_id || null],
        );
        if (!rows[0]) {
          throw new Error("Uma assinatura mudou durante a concessao da cortesia. Tente novamente.");
        }
        updatedSubscriptions.push(rows[0]);
      }
    }

    const { rows: updatedProfiles } = await q(
      `UPDATE public.profiles
       SET is_exempt = $3::boolean,
           billing_exemption_pending = false,
           updated_at = now()
      WHERE id = $1::uuid
        AND user_id = $2::uuid
       RETURNING *`,
      [data.profileId, profile.user_id, data.exempt],
    );
    if (!updatedProfiles[0]) {
      throw new Error("Perfil responsavel pela loja mudou durante a operacao. Tente novamente.");
    }

    return {
      previousProfile: profile,
      profile: updatedProfiles[0],
      storeIds,
      updatedSubscriptions,
    };
  });

  deps.publishRealtime({
    schema: "public",
    table: "profiles",
    eventType: "UPDATE",
    new: result.profile,
    old: result.previousProfile,
  });
  for (const subscription of result.updatedSubscriptions) {
    deps.publishRealtime({
      schema: "public",
      table: "subscriptions",
      eventType: "UPDATE",
      new: subscription,
      old: null,
    });
  }

  return {
    success: true,
    storeId: data.storeId,
    profileId: result.profile.id,
    isExempt: Boolean(result.profile.is_exempt),
    is_exempt: Boolean(result.profile.is_exempt),
    recurrenceCanceled: data.exempt,
    affectedStoreIds: result.storeIds,
    canceledSubscriptionCount: result.updatedSubscriptions.length,
  };
};
