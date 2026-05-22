import { z } from "zod";
import type { getActor } from "@/backend/auth";
import { query as defaultQuery } from "@/backend/db";
import { asaas } from "./asaas.server";

const checkoutSchema = z.object({
  storeId: z.string().uuid(),
  planId: z.string().uuid(),
  customerData: z.object({
    name: z.string().trim().min(2).max(160),
    email: z.string().trim().email().max(180),
    cpfCnpj: z.string().transform((value) => value.replace(/\D/g, "")).pipe(z.string().min(11).max(14)),
    mobilePhone: z.string().optional().nullable().transform((value) => value ? value.replace(/\D/g, "") : undefined),
  }),
});

type QueryFn = typeof defaultQuery;
type ActorFn = typeof getActor;

type SubscriptionDeps = {
  getActor: ActorFn;
  query: QueryFn;
  createCustomer: typeof asaas.createCustomer;
  createSubscription: typeof asaas.createSubscription;
};

const defaultDeps = async (): Promise<SubscriptionDeps> => {
  const auth = await import("@/backend/auth");
  return {
    getActor: auth.getActor,
    query: defaultQuery,
    createCustomer: asaas.createCustomer,
    createSubscription: asaas.createSubscription,
  };
};

export const createSubscriptionCheckoutHandler = async (
  input: unknown,
  token?: string,
  depsPromise: Promise<SubscriptionDeps> = defaultDeps(),
) => {
  const deps = await depsPromise;
  const actor = await deps.getActor(token);
  if (!actor) throw new Error("Nao autenticado.");

  const data = checkoutSchema.parse(input);
  if (!actor.admin && !actor.ownedStoreIds.includes(data.storeId)) {
    throw new Error("Acesso negado.");
  }

  const [{ rows: storeRows }, { rows: planRows }] = await Promise.all([
    deps.query(
      `SELECT id, owner_user_id, name, document, whatsapp
       FROM public.stores
       WHERE id = $1::uuid
       LIMIT 1`,
      [data.storeId],
    ),
    deps.query(
      `SELECT id, name, price_monthly
       FROM public.plans
       WHERE id = $1::uuid
         AND COALESCE(is_active, true) IS TRUE
         AND COALESCE(price_monthly, 0) > 0
       LIMIT 1`,
      [data.planId],
    ),
  ]);

  const store = storeRows[0];
  const plan = planRows[0];
  if (!store) throw new Error("Loja nao encontrada.");
  if (!plan) throw new Error("Plano pago nao encontrado ou inativo.");

  const customer = await deps.createCustomer({
    name: data.customerData.name,
    email: data.customerData.email,
    cpfCnpj: data.customerData.cpfCnpj,
    mobilePhone: data.customerData.mobilePhone,
  });
  if (customer.errors) throw new Error(customer.errors[0]?.description || "Erro ao criar cliente no gateway.");

  const subscription = await deps.createSubscription({
    customer: customer.id,
    billingType: "PIX",
    value: Number(plan.price_monthly),
    nextDueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0],
    cycle: "MONTHLY",
    description: `Assinatura Plano ${plan.name} - Hype Delivery`,
    externalReference: data.storeId,
  });
  if (subscription.errors) throw new Error(subscription.errors[0]?.description || "Erro ao criar assinatura no gateway.");

  await deps.query(
    `UPDATE public.stores
     SET plan_id = $2::uuid, updated_at = now()
     WHERE id = $1::uuid`,
    [data.storeId, data.planId],
  );
  await deps.query(
    `INSERT INTO public.subscriptions (
       store_id, plan_id, provider, asaas_subscription_id, status, last_payment_status, updated_at
     )
     VALUES ($1::uuid, $2::uuid, 'asaas', $3::text, 'pendente_pagamento', 'pending', now())
     ON CONFLICT (store_id)
     DO UPDATE SET
       plan_id = EXCLUDED.plan_id,
       provider = EXCLUDED.provider,
       asaas_subscription_id = EXCLUDED.asaas_subscription_id,
       status = EXCLUDED.status,
       last_payment_status = EXCLUDED.last_payment_status,
       updated_at = now()`,
    [data.storeId, data.planId, subscription.id],
  );

  return {
    invoiceUrl: subscription.invoiceUrl,
    subscriptionId: subscription.id,
  };
};
