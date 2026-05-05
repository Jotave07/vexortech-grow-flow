import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useStoreStatus(storeId?: string) {
  return useQuery({
    queryKey: ["store-status", storeId],
    queryFn: async () => {
      if (!storeId) return null;

      const { data: store, error: storeError } = await supabase
        .from("stores")
        .select("is_active, is_suspended, plan_id")
        .eq("id", storeId)
        .single();

      if (storeError) throw storeError;

      const { data: subscription, error: subError } = await supabase
        .from("subscriptions")
        .select("status, current_period_end")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (subError) throw subError;

      const isActive = store.is_active && !store.is_suspended && 
                      (subscription?.status === "ativa" || subscription?.status === "trial");

      return {
        isActive,
        isSuspended: store.is_suspended,
        subscriptionStatus: subscription?.status || "pendente",
        currentPeriodEnd: subscription?.current_period_end,
      };
    },
    enabled: !!storeId,
  });
}
