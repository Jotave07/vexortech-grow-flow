import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { asaas } from "@/server/asaas.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const testAsaasConnection = createServerFn({ method: "POST" })
  .inputValidator(z.object({
    apiKey: z.string().min(1),
    isPlatform: z.boolean().optional(),
  }))
  .handler(async ({ data }) => {
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
    const { data: storeSettings } = await supabaseAdmin
      .from("store_settings")
      .select("asaas_api_key")
      .eq("store_id", data.storeId)
      .single() as any;

    if (!storeSettings?.asaas_api_key) {
      throw new Error("Loja não configurou o gateway de pagamento Asaas.");
    }

    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", data.orderId)
      .single();

    if (!order) throw new Error("Pedido não encontrado.");

    const asaasCustomer = await asaas.createCustomer({
      name: (order as any).customer_name || "Cliente",
      email: (order as any).customer_email || "",
      cpfCnpj: (order as any).customer_document || "",
      mobilePhone: (order as any).customer_phone || undefined,
    }, storeSettings.asaas_api_key);

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

    const qrCode = await asaas.getPixQrCode(storeSettings.asaas_api_key, payment.id);

    await supabaseAdmin
      .from("payments")
      .update({ 
        external_id: payment.id,
        status: "pendente" 
      })
      .eq("order_id", order.id);

    return {
      paymentId: payment.id,
      pixCode: qrCode.payload || null,
      qrCodeUrl: qrCode.encodedImage || null,
      invoiceUrl: payment.invoiceUrl || null,
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
    if (qrCode.errors) return null;

    return {
      pixCode: qrCode.payload || null,
      qrCodeUrl: qrCode.encodedImage || null,
    };
  });

export const syncPaymentStatus = createServerFn({ method: "POST" })
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

    if (!storeSettings?.asaas_api_key) return { status: "pending", message: "Gateway não configurado" };

    const { data: payment } = await supabaseAdmin
      .from("payments")
      .select("*")
      .eq("order_id", data.orderId)
      .single();

    if (!payment?.external_id) return { status: "pending", message: "Pagamento não encontrado" };
    if (payment.status === "pago") return { status: "paid" };

    const asaasPayment = await asaas.getPayment(storeSettings.asaas_api_key, payment.external_id);

    if (asaasPayment.status === "RECEIVED" || asaasPayment.status === "CONFIRMED") {
      await supabaseAdmin.from("payments").update({ 
        status: "pago",
        paid_at: new Date().toISOString()
      }).eq("id", payment.id);

      await supabaseAdmin.from("orders").update({ status: "novo" }).eq("id", data.orderId);
      
      await supabaseAdmin.from("order_status_history").insert({ 
        order_id: data.orderId, 
        store_id: data.storeId, 
        status: "novo", 
        notes: "Pagamento PIX confirmado automaticamente" 
      });

      return { status: "paid" };
    }

    return { status: "pending", asaasStatus: asaasPayment.status };
  });

export const refundOrderPayment = createServerFn({ method: "POST" })
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

    if (!storeSettings?.asaas_api_key) throw new Error("Gateway não configurado");

    const { data: payment } = await supabaseAdmin
      .from("payments")
      .select("*")
      .eq("order_id", data.orderId)
      .single();

    if (!payment?.external_id || payment.status !== "pago") {
      return { success: false, message: "Pagamento não encontrado ou não está pago" };
    }

    const { data: order } = await supabaseAdmin.from("orders").select("total").eq("id", data.orderId).single();

    const refund = await asaas.refundPayment(
      storeSettings.asaas_api_key, 
      payment.external_id, 
      Number(order?.total || 0),
      "Pedido cancelado pela loja"
    );

    if (refund.errors) {
      throw new Error(`Erro Asaas no estorno: ${refund.errors[0].description}`);
    }

    await supabaseAdmin.from("payments").update({ status: "estornado" }).eq("id", payment.id);

    return { success: true };
  });
