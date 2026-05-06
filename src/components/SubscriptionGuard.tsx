import { Navigate, Outlet, useLocation, useOutletContext } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useSubscriptionStatus } from "@/hooks/use-subscription-status";

export const SubscriptionGuard = () => {
  const location = useLocation();
  const ctx = useOutletContext();
  const { loading, accessState, isPlatformAdmin, profile } = useSubscriptionStatus() as any;

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (accessState !== "active" && !isPlatformAdmin && !profile?.is_exempt) {
    const redirect = encodeURIComponent(location.pathname);
    return <Navigate to={`/lojista/assinatura?state=${accessState}&redirect=${redirect}`} replace />;
  }

  return <Outlet context={ctx} />;
};
