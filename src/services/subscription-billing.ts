import { backend } from "@/integrations/backend/client";

export type SubscriptionCardData = {
  creditCard: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  creditCardHolderInfo: {
    name: string;
    email: string;
    cpfCnpj: string;
    postalCode: string;
    addressNumber: string;
    addressComplement?: string | null;
    phone?: string;
    mobilePhone?: string;
  };
};

export type CreateSubscriptionCheckoutInput = {
  planId: string;
  storeId: string;
  billingType?: "CREDIT_CARD" | "BOLETO";
  cardData?: SubscriptionCardData;
  customerData: {
    name: string;
    email: string;
    cpfCnpj: string;
    mobilePhone?: string;
  };
};

export const createSubscriptionCheckout = async (input: CreateSubscriptionCheckoutInput) => {
  const { data: result, error } = await backend.functions.invoke("create-subscription-checkout", { body: input });
  if (error || !result) throw new Error(error?.message || "Nao foi possivel iniciar o checkout da assinatura.");
  return {
    checkoutUrl: result.checkoutUrl || result.invoiceUrl,
    subscriptionId: result.subscriptionId,
    billingType: result.billingType,
    mode: result.mode,
  };
};

export const cancelSubscription = async (storeId: string) => {
  const { data: result, error } = await backend.functions.invoke("cancel-subscription", { body: { storeId } });
  if (error || !result) throw new Error(error?.message || "Nao foi possivel cancelar a assinatura.");
  return result;
};

export const syncSubscriptionStatus = async (storeId: string) => {
  const { data: result, error } = await backend.functions.invoke("sync-subscription-status", { body: { storeId } });
  if (error || !result) throw new Error(error?.message || "Nao foi possivel atualizar o status da assinatura.");
  return result;
};

export const updateSubscriptionPlan = async (input: {
  storeId: string;
  planId: string;
  billingType?: "CREDIT_CARD" | "BOLETO";
  cardData?: SubscriptionCardData;
}) => {
  const { data: result, error } = await backend.functions.invoke("update-subscription-plan", { body: input });
  if (error || !result) throw new Error(error?.message || "Nao foi possivel atualizar a assinatura.");
  return result;
};
