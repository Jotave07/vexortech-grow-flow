import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
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
  .handler(async () => {
    throw new Error("Use a function autenticada test-payment-gateway via backend.functions.invoke.");
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
  .handler(async () => {
    throw new Error("Use a function autenticada create-subscription-checkout via backend.functions.invoke.");
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
