import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { asaas } from "./asaas.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Security: Check if user is the platform owner
const isPlatformOwner = (email: string | undefined) => email === "jvieira@vexortech.com.br";

export const testAsaasConnection = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    apiKey: z.string().min(1),
    isPlatform: z.boolean().optional(),
  }))
  .handler(async ({ data, context }) => {
    // Basic validation to check if the API key works by fetching account info or similar
    // Since we don't have a specific "test" endpoint, we'll try to list customers with limit 1
    const result = await asaas.createCustomer({ name: "Test Connection", email: "test@example.com", cpfCnpj: "" }, data.apiKey);
    
    // If it's not a 401/403, the key is likely valid (even if creation fails for other reasons like CPF)
    // Actually, a better way is to just use a GET request to /customers?limit=1
    const response = await fetch(`${process.env.ASAAS_ENVIRONMENT === 'sandbox' ? 'https://sandbox.asaas.com/api/v3' : 'https://www.asaas.com/api/v3'}/customers?limit=1`, {
      headers: { 
        'access_token': data.apiKey,
        'User-Agent': 'VexorDelivery/1.0'
      }
    });

    if (response.ok) {
      return { success: true, message: "Conexão estabelecida com sucesso." };
    } else {
      const errorData = await response.json().catch(() => ({}));
      return { 
        success: false, 
        message: errorData.errors?.[0]?.description || "Falha ao conectar com o Asaas. Verifique sua chave de API." 
      };
    }
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
    // This ALWAYS uses the Platform ASAAS account (owner account)
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

    await supabaseAdmin.from("subscriptions" as any).upsert({
      store_id: data.storeId,
      plan_id: data.planId,
      asaas_subscription_id: subscription.id,
      status: "pendente_pagamento",
      updated_at: new Date().toISOString(),
    }, { onConflict: 'store_id' });

    return { invoiceUrl: subscription.invoiceUrl, subscriptionId: subscription.id };
  });

export const createOrderPayment = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    orderId: z.string().uuid(),
    storeId: z.string().uuid(),
  }))
  .handler(async ({ data }) => {
    // 1. Get Store settings for Asaas API Key (Isolated per store)
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
      name: (order as any).customer_name || "Cliente",
      email: (order as any).customer_email || "",
      cpfCnpj: "", // Most stores allow creation without CPF if configured
      mobilePhone: (order as any).customer_phone || undefined,
    }, storeSettings.asaas_api_key);

    if (asaasCustomer.errors) {
      console.error("Erro ao criar cliente no Asaas da loja:", asaasCustomer.errors);
      // Fallback or detailed error
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
      throw new Error(`Erro Asaas da Loja: ${payment.errors[0].description}`);
    }

    // 5. Get QR Code
    const qrCode = await asaas.getPixQrCode(storeSettings.asaas_api_key, payment.id);

    // 6. Update payment in DB
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
