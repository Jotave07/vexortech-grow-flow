import { createSubscriptionCheckout as createServerSubscriptionCheckout } from "@/server/asaas.functions";

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
  const result = await createServerSubscriptionCheckout({ data: input });
  return {
    checkoutUrl: result.invoiceUrl,
    subscriptionId: result.subscriptionId,
  };
};
