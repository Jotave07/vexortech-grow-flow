import { supabase } from "@/integrations/supabase/client";

export type BillingProvider = "stripe";

export type CreateSubscriptionCheckoutInput = {
  planId: string;
  storeId: string;
  successUrl: string;
  cancelUrl: string;
  provider?: BillingProvider;
};

export type CreateSubscriptionCheckoutResult = {
  checkoutUrl: string;
  provider: BillingProvider;
  checkoutId?: string | null;
};

export const createSubscriptionCheckout = async ({
  planId,
  storeId,
  successUrl,
  cancelUrl,
  provider = "stripe",
}: CreateSubscriptionCheckoutInput): Promise<CreateSubscriptionCheckoutResult> => {
  const { data, error } = await supabase.functions.invoke("create-subscription-checkout", {
    body: {
      planId,
      storeId,
      successUrl,
      cancelUrl,
      provider,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.checkoutUrl) {
    throw new Error("O backend nao retornou uma URL de checkout para a assinatura.");
  }

  return data as CreateSubscriptionCheckoutResult;
};
