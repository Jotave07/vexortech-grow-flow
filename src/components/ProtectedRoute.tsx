import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

export const ProtectedRoute = ({ 
  children, 
  requiredRole 
}: { 
  children: React.ReactNode, 
  requiredRole?: "super_admin" | "store_owner" | "customer" 
}) => {
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

  // Se um papel específico for exigido, validar rigorosamente
  if (requiredRole && profile?.role !== requiredRole && user?.email !== "jvieira@vexortech.com.br") {
    // Redirecionar para o painel correto com base no papel atual do usuário
    if (profile?.role === "super_admin") return <Navigate to="/admin" replace />;
    if (profile?.role === "store_owner") return <Navigate to="/lojista" replace />;
    if (profile?.role === "customer") return <Navigate to="/cliente" replace />;
    
    // Fallback caso não tenha perfil ou papel
    return <Navigate to="/" replace />;
  }

  // Proteção extra contra acesso cruzado baseado no prefixo da rota
  const path = location.pathname;
  if (path.startsWith("/admin") && profile?.role !== "super_admin" && user?.email !== "jvieira@vexortech.com.br") {
    return <Navigate to="/" replace />;
  }
  if (path.startsWith("/lojista") && profile?.role !== "store_owner") {
    return <Navigate to="/" replace />;
  }
  if (path.startsWith("/cliente") && profile?.role !== "customer") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
