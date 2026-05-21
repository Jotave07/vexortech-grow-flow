import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { asaas } from "@/server/asaas.server";
import { backendAdmin } from "@/integrations/backend/client.server";
import { testPixGatewayConnection } from "@/server/payment-gateways";
import {
  createOrderPaymentForOrder,
  getOrderPaymentInfoForOrder,
  syncOrderPaymentStatus,
} from "@/server/asaas.service";

export const testAsaasConnection = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    apiKey: z.string().min(1),
    provider: z.string().optional(),
    isPlatform: z.boolean().optional(),
  }))
  .handler(async ({ data }) => {
    return testPixGatewayConnection(data.provider, data.apiKey);
  });

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
    const asaasCustomer = await asaas.createCustomer(data.customerData);
    if (asaasCustomer.errors) throw new Error(asaasCustomer.errors[0].description);

    const { data: plan } = await backendAdmin.from("plans").select("*").eq("id", data.planId).single();
    if (!plan) throw new Error("Plan not found");

    const subscription = await asaas.createSubscription({
      customer: asaasCustomer.id,
      billingType: "PIX",
      value: Number(plan.price_monthly),
      nextDueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      cycle: "MONTHLY",
      description: `Assinatura Plano ${plan.name} - Hype Delivery`,
      externalReference: data.storeId,
    });
    if (subscription.errors) throw new Error(subscription.errors[0].description);

    await backendAdmin.from("subscriptions" as any).upsert({
      store_id: data.storeId,
      plan_id: data.planId,
      asaas_subscription_id: subscription.id,
      status: "pendente_pagamento",
      updated_at: new Date().toISOString(),
    }, { onConflict: "store_id" });

    return { invoiceUrl: subscription.invoiceUrl, subscriptionId: subscription.id };
  });

export const createOrderPayment = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    orderId: z.string().uuid(),
    storeId: z.string().uuid(),
    attemptKey: z.string().min(8).max(160).optional(),
    publicToken: z.string().min(8).max(200).optional(),
  }))
  .handler(async ({ data }) => {
    if (!data.publicToken) throw new Error("publicToken obrigatorio para pagamento publico.");
    return createOrderPaymentForOrder(data);
  });

export const getOrderPaymentInfo = createServerFn({ method: "GET" })
  .inputValidator(z.object({
    orderId: z.string().uuid(),
    storeId: z.string().uuid(),
    publicToken: z.string().min(8).max(200).optional(),
  }))
  .handler(async ({ data }) => {
    if (!data.publicToken) throw new Error("publicToken obrigatorio para consulta publica.");
    return getOrderPaymentInfoForOrder(data);
  });

export const syncPaymentStatus = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    orderId: z.string().uuid(),
    storeId: z.string().uuid(),
    publicToken: z.string().min(8).max(200).optional(),
  }))
  .handler(async ({ data }) => {
    if (!data.publicToken) throw new Error("publicToken obrigatorio para sincronizacao publica.");
    return syncOrderPaymentStatus(data);
  });

export const refundOrderPayment = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    orderId: z.string().uuid(),
    storeId: z.string().uuid(),
  }))
  .handler(async () => {
    throw new Error("Estorno deve ser executado pelo painel autenticado via update-order-status.");
  });
