import { backend } from "@/integrations/backend/client";

export type CreateSubscriptionCheckoutInput = {
  planId: string;
  storeId: string;
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
    checkoutUrl: result.invoiceUrl,
    subscriptionId: result.subscriptionId,
  };
};
