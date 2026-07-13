import { dataOf, getStoreId } from "./core.js";

export const subscriptionAccessState = ({ subscription, store, profile, role, now = Date.now() }) => {
  if (role === "super_admin" || role === "admin") return "active";
  if (!store || store.is_active === false || store.is_suspended) return "blocked";
  if (profile?.is_exempt) return "active";
  if (!subscription?.plans?.id) return "no_plan";
  if (subscription.status === "ativa" || subscription.status === "trial") return "active";
  if (subscription.status === "cancelada") {
    const end = new Date(subscription.current_period_end || 0).getTime();
    return end > now ? "active" : "canceled";
  }
  if (subscription.status === "inadimplente" || ["failed", "past_due"].includes(subscription.last_payment_status)) return "past_due";
  if (["bloqueada", "suspensa"].includes(subscription.status)) return "blocked";
  return "pending_payment";
};

export const requireActiveSubscription = async (ctx) => {
  if (["super_admin", "admin"].includes(ctx.auth.role)) return true;
  const storeId = getStoreId(ctx);
  try {
    const [store, subscription] = await Promise.all([
      dataOf(
        ctx.api
          .from("stores")
          .select("id, is_active, is_suspended")
          .eq("id", storeId)
          .maybeSingle(),
        null,
      ),
      dataOf(ctx.api.from("subscriptions").select("status, last_payment_status, current_period_end, plans(id, price_monthly, slug)").eq("store_id", storeId).maybeSingle(), null),
    ]);
    const state = subscriptionAccessState({ subscription, store, profile: ctx.auth.profile, role: ctx.auth.role });
    if (state === "active") return true;
    return `/lojista/assinatura?state=${encodeURIComponent(state)}&redirect=${encodeURIComponent(ctx.path)}`;
  } catch {
    return `/lojista/assinatura?state=verification_failed&redirect=${encodeURIComponent(ctx.path)}`;
  }
};
