import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { asaas } from "./asaas.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const createSubscriptionCheckout = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    storeId: z.string().uuid(),
    planId: z.string().uuid(),
    customerData: z.object({
      name: z.string(),
      email: z.string().email(),
      cpfCnpj: z.string(),
      mobilePhone: z.string().optional(),
    }),
  }))
  .handler(async ({ data }) => {
    // 1. Create or get customer in Asaas
    const asaasCustomer = await asaas.createCustomer(data.customerData);
    
    if (asaasCustomer.errors) {
      throw new Error(asaasCustomer.errors[0].description);
    }

    // 2. Get Plan details
    const { data: plan } = await supabaseAdmin
      .from("plans")
      .select("*")
      .eq("id", data.planId)
      .single();

    if (!plan) throw new Error("Plan not found");

    // 3. Create Subscription in Asaas
    const subscription = await asaas.createSubscription({
      customer: asaasCustomer.id,
      billingType: "PIX",
      value: Number(plan.price_monthly),
      nextDueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Tomorrow
      cycle: "MONTHLY",
      description: `Assinatura Plano ${plan.name} - Vexortech Delivery`,
      externalReference: data.storeId,
    });

    if (subscription.errors) {
      throw new Error(subscription.errors[0].description);
    }

    // 4. Record subscription in DB
    await supabaseAdmin
      .from("subscriptions")
      .insert({
        store_id: data.storeId,
        plan_id: data.planId,
        external_subscription_id: subscription.id,
        status: "pendente",
      });

    return {
      invoiceUrl: subscription.invoiceUrl,
      subscriptionId: subscription.id,
    };
  });
