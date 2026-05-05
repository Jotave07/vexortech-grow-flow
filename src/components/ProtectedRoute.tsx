import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

export const ProtectedRoute = ({ children, superAdminOnly }: { children: React.ReactNode, superAdminOnly?: boolean }) => {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user && typeof window !== "undefined") {
    return <Navigate to="/entrar" state={{ from: location.pathname }} replace />;
  }

  if (superAdminOnly && profile?.role !== "super_admin" && user?.email !== "jvieira@vexortech.com.br") {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
};
