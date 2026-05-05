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
    const asaasCustomer = await asaas.createCustomer(data.customerData);
    if (asaasCustomer.errors) throw new Error(asaasCustomer.errors[0].description);

    const { data: plan } = await supabaseAdmin.from("plans").select("*").eq("id", data.planId).single();
    if (!plan) throw new Error("Plan not found");

    const subscription = await asaas.createSubscription({
      customer: asaasCustomer.id,
      billingType: "PIX",
      value: Number(plan.price_monthly),
      nextDueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      cycle: "MONTHLY",
      description: `Assinatura Plano ${plan.name} - Vexortech Delivery`,
      externalReference: data.storeId,
    });
    if (subscription.errors) throw new Error(subscription.errors[0].description);

    await supabaseAdmin.from("subscriptions").insert({
      store_id: data.storeId,
      plan_id: data.planId,
      external_subscription_id: subscription.id,
      status: "pendente_pagamento",
    });

    return { invoiceUrl: subscription.invoiceUrl, subscriptionId: subscription.id };
  });

export const createOrderPayment = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    orderId: z.string().uuid(),
    storeId: z.string().uuid(),
  }))
  .handler(async ({ data }) => {
    // 1. Get Store settings for Asaas API Key
    const { data: storeSettings } = await supabaseAdmin
      .from("store_settings")
      .select("asaas_api_key")
      .eq("store_id", data.storeId)
      .single() as any;

    if (!storeSettings?.asaas_api_key) {
      throw new Error("Loja não configurou o gateway de pagamento Asaas.");
    }

    // 2. Get Order details
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", data.orderId)
      .single();

    if (!order) throw new Error("Pedido não encontrado.");

    // 3. Create or get customer in store's Asaas
    const asaasCustomer = await asaas.createCustomer({
      name: order.customer_name,
      email: order.customer_email || "",
      cpfCnpj: "", // Note: Asaas may require this depending on account settings
      mobilePhone: order.customer_phone,
    }, storeSettings.asaas_api_key);

    if (asaasCustomer.errors) {
      console.error("Erro ao criar cliente no Asaas:", asaasCustomer.errors);
      // If customer creation fails, we try to proceed or throw a better error
      // Some Asaas accounts allow creating payments with just name/email if configured, 
      // but usually they require a customerId.
    }

    // 4. Create PIX payment in store's Asaas
    const payment = await asaas.createStorePayment(storeSettings.asaas_api_key, {
      customer: asaasCustomer.id,
      value: Number(order.total),
      dueDate: new Date().toISOString().split('T')[0],
      description: `Pedido #${order.order_number} - ${order.customer_name}`,
      externalReference: order.id,
    });

    if (payment.errors) {
      throw new Error(`Erro Asaas: ${payment.errors[0].description}`);
    }

    // 4. Get QR Code
    const qrCode = await asaas.getPixQrCode(storeSettings.asaas_api_key, payment.id);

    // 5. Update payment in DB
    await supabaseAdmin
      .from("payments")
      .update({ external_id: payment.id })
      .eq("order_id", order.id);

    return {
      paymentId: payment.id,
      pixCode: qrCode.payload,
      qrCodeUrl: qrCode.encodedImage,
      invoiceUrl: payment.invoiceUrl,
    };
  });

export const getOrderPaymentInfo = createServerFn({ method: "GET" })
  .inputValidator(z.object({
    orderId: z.string().uuid(),
    storeId: z.string().uuid(),
  }))
  .handler(async ({ data }) => {
    const { data: storeSettings } = await supabaseAdmin
      .from("store_settings")
      .select("asaas_api_key")
      .eq("store_id", data.storeId)
      .single() as any;

    if (!storeSettings?.asaas_api_key) throw new Error("Configuração ausente");

    const { data: payment } = await supabaseAdmin
      .from("payments")
      .select("external_id")
      .eq("order_id", data.orderId)
      .single();

    if (!payment?.external_id) return null;

    const qrCode = await asaas.getPixQrCode(storeSettings.asaas_api_key, payment.external_id);

    return {
      pixCode: qrCode.payload,
      qrCodeUrl: qrCode.encodedImage,
    };
  });
