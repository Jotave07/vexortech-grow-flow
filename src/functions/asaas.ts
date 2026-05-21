import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { asaas } from "@/server/asaas.server";
import { backendAdmin } from "@/integrations/backend/client.server";
import {
  createOrderPaymentForOrder,
  getOrderPaymentInfoForOrder,
  syncOrderPaymentStatus,
} from "@/server/asaas.service";

export const testAsaasConnection = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    apiKey: z.string().min(1),
    isPlatform: z.boolean().optional(),
  }))
  .handler(async ({ data }) => {
    const response = await fetch(`${process.env.ASAAS_ENVIRONMENT === "sandbox" ? "https://sandbox.asaas.com/api/v3" : "https://www.asaas.com/api/v3"}/customers?limit=1`, {
      headers: {
        access_token: data.apiKey,
        "User-Agent": "HypeDelivery/1.0",
      },
    });

    if (response.ok) {
      return { success: true, message: "Conexao estabelecida com sucesso." };
    }

    const errorData = await response.json().catch(() => ({}));
    return {
      success: false,
      message: errorData.errors?.[0]?.description || "Falha ao conectar com o Asaas. Verifique sua chave de API.",
    };
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
  }))
  .handler(async ({ data }) => createOrderPaymentForOrder(data));

export const getOrderPaymentInfo = createServerFn({ method: "GET" })
  .inputValidator(z.object({
    orderId: z.string().uuid(),
    storeId: z.string().uuid(),
  }))
  .handler(async ({ data }) => getOrderPaymentInfoForOrder(data));

export const syncPaymentStatus = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    orderId: z.string().uuid(),
    storeId: z.string().uuid(),
  }))
  .handler(async ({ data }) => syncOrderPaymentStatus(data));

export const refundOrderPayment = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    orderId: z.string().uuid(),
    storeId: z.string().uuid(),
  }))
  .handler(async ({ data }) => {
    const { data: storeSettings } = await backendAdmin
      .from("store_settings")
      .select("asaas_api_key")
      .eq("store_id", data.storeId)
      .single() as any;

    if (!storeSettings?.asaas_api_key) throw new Error("Gateway nao configurado");

    const { data: payment } = await backendAdmin
      .from("payments")
      .select("*")
      .eq("order_id", data.orderId)
      .single();

    if (!payment?.external_id || payment.status !== "pago") {
      return { success: false, message: "Pagamento nao encontrado ou nao esta pago" };
    }

    const { data: order } = await backendAdmin.from("orders").select("total").eq("id", data.orderId).single();

    const refund = await asaas.refundPayment(
      storeSettings.asaas_api_key,
      payment.external_id,
      Number(order?.total || 0),
      "Pedido cancelado pela loja",
    );

    if (refund.errors) {
      throw new Error(`Erro Asaas no estorno: ${refund.errors[0].description}`);
    }

    await backendAdmin.from("payments").update({ status: "estornado" }).eq("id", payment.id);

    return { success: true };
  });
