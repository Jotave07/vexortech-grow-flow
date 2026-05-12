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
  const path = location.pathname;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user && typeof window !== "undefined") {
    let loginPath = "/entrar";
    if (path.startsWith("/admin")) loginPath = "/admin/entrar";
    else if (path.startsWith("/lojista")) loginPath = "/lojista/entrar";
    
    return <Navigate to={loginPath} state={{ from: location.pathname }} replace />;
  }

  // Se estiver carregando o perfil mas o usuário já estiver autenticado, esperar um pouco
  if (user && !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Se um papel específico for exigido, validar rigorosamente
  if (requiredRole) {
    const isSuperAdmin = profile?.role === "super_admin";
    const isStoreOwner = profile?.role === "store_owner";
    const isCustomer = profile?.role === "customer";

    // Se a rota exige ser cliente, lojistas e admins também podem acessar
    if (requiredRole === "customer") {
      if (!isCustomer && !isStoreOwner && !isSuperAdmin) {
        return <Navigate to="/vendas" replace />;
      }
    } 
    // Se a rota exige ser lojista, apenas lojistas e admins podem acessar (admins podem acessar tudo)
    else if (requiredRole === "store_owner") {
      if (!isStoreOwner && !isSuperAdmin) {
        return <Navigate to="/cliente" replace />;
      }
    }
    // Se a rota exige ser admin, apenas admins podem acessar
    else if (requiredRole === "super_admin") {
      if (!isSuperAdmin) {
        return <Navigate to="/vendas" replace />;
      }
    }
  }

  // Proteção extra contra acesso cruzado baseado no prefixo da rota
  if (path.startsWith("/admin") && profile?.role !== "super_admin") {
    return <Navigate to="/vendas" replace />;
  }
  if (path.startsWith("/lojista") && profile?.role !== "store_owner" && profile?.role !== "super_admin") {
    return <Navigate to="/vendas" replace />;
  }
  if (path.startsWith("/cliente") && profile?.role !== "customer" && profile?.role !== "store_owner" && profile?.role !== "super_admin") {
    return <Navigate to="/vendas" replace />;
  }

  return <>{children}</>;
};
