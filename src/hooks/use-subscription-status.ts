import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { getSubscriptionAccessMessage, getSubscriptionAccessState, type SubscriptionAccessState } from "@/lib/subscription";

type PlanRow = Tables<"plans">;
type StoreRow = Tables<"stores">;
type SubscriptionRow = Tables<"subscriptions"> & { plans?: PlanRow | null };

type SubscriptionStatusResult = {
  loading: boolean;
  accessState: SubscriptionAccessState;
  message: string;
  subscription: SubscriptionRow | null;
  plan: PlanRow | null;
  store: StoreRow | null;
  isPlatformAdmin: boolean;
  user: any;
  profile: any;
  refresh: () => Promise<void>;
};

export const useSubscriptionStatus = (): SubscriptionStatusResult => {
  const { user, profile, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [accessState, setAccessState] = useState<SubscriptionAccessState>("no_plan");
  const [message, setMessage] = useState("Escolha um plano para ativar sua loja.");
  const [subscription, setSubscription] = useState<SubscriptionRow | null>(null);
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [store, setStore] = useState<StoreRow | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);

  const refresh = useCallback(async () => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      setAccessState("no_plan");
      setMessage(getSubscriptionAccessMessage("no_plan"));
      return;
    }

    setLoading(true);
    const [adminRes, storeRes] = await Promise.all([
      user.email === "jvieira@vexortech.com.br" ? Promise.resolve({ data: true }) : (supabase.rpc("is_vexor_admin" as any, { _user_id: user.id }) as any),
      profile?.store_id ? (supabase.from("stores" as any).select("*").eq("id", profile.store_id).maybeSingle() as any) : Promise.resolve({ data: null, error: null }),
    ]);

    const isAdmin = Boolean(adminRes.data);
    const currentStore = (storeRes as { data: StoreRow | null }).data ?? null;
    const subscriptionRes = currentStore
      ? await (supabase.from("subscriptions" as any).select("*, plans(*)").eq("store_id", currentStore.id).maybeSingle() as any)
      : { data: null, error: null };

    const currentSubscription = (subscriptionRes.data as SubscriptionRow | null) ?? null;
    const currentPlan = currentSubscription?.plans ?? null;
    const nextState = getSubscriptionAccessState({
      subscription: currentSubscription,
      plan: currentPlan,
      isPlatformAdmin: isAdmin,
      storeSuspended: Boolean(currentStore?.is_suspended),
      isExempt: Boolean(profile?.is_exempt),
    });

    setIsPlatformAdmin(isAdmin);
    setStore(currentStore);
    setSubscription(currentSubscription);
    setPlan(currentPlan);
    setAccessState(nextState);
    setMessage(getSubscriptionAccessMessage(nextState));
    setLoading(false);
  }, [authLoading, profile?.store_id, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    loading: authLoading || loading,
    accessState,
    message,
    subscription,
    plan,
    store,
    isPlatformAdmin,
    user,
    profile,
    refresh,
  };
};
