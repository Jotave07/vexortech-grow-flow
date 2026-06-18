import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";

export const ProtectedRoute = ({
  children,
  requiredRole
}: {
  children: React.ReactNode,
  requiredRole?: "super_admin" | "store_owner" | "customer"
}) => {
  const { user, profile, loading, refreshProfile } = useAuth();
  const location = useLocation();
  const path = location.pathname;
  const [profileTimeout, setProfileTimeout] = useState(false);

  // Timeout para evitar loading infinito quando o perfil falha
  useEffect(() => {
    if (user && !profile && !loading) {
      const timer = setTimeout(() => setProfileTimeout(true), 10000);
      return () => clearTimeout(timer);
    }
    if (profile) {
      setProfileTimeout(false);
    }
  }, [user, profile, loading]);

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

  // Se estiver carregando o perfil mas o usuário já estiver autenticado, mostrar timeout com opção de retry
  if (user && !profile) {
    if (profileTimeout) {
      return (
        <div className="flex min-h-screen items-center justify-center p-6">
          <div className="max-w-sm text-center">
            <AlertTriangle className="mx-auto mb-3 h-12 w-12 text-destructive" />
            <h1 className="mb-2 text-xl font-bold">Erro ao carregar perfil</h1>
            <p className="mb-4 text-sm text-muted-foreground">
              Não foi possível carregar seus dados de perfil. Verifique sua conexão e tente novamente.
            </p>
            <Button onClick={() => { setProfileTimeout(false); refreshProfile?.(); }}>
              <RefreshCw className="h-4 w-4 mr-2" /> Tentar novamente
            </Button>
          </div>
        </div>
      );
    }
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

    // Cliente: apenas customers (sem acesso de lojistas/admins como cliente)
    if (requiredRole === "customer") {
      if (!isCustomer) {
        return <Navigate to="/" replace />;
      }
    }
    // Lojista: apenas store_owners e super_admins
    else if (requiredRole === "store_owner") {
      if (!isStoreOwner && !isSuperAdmin) {
        return <Navigate to="/cliente" replace />;
      }
    }
    // Admin: apenas super_admin
    else if (requiredRole === "super_admin") {
      if (!isSuperAdmin) {
        return <Navigate to="/" replace />;
      }
    }
  }

  // Proteção extra contra acesso cruzado baseado no prefixo da rota
  if (path.startsWith("/admin") && profile?.role !== "super_admin") {
    return <Navigate to="/" replace />;
  }
  if (path.startsWith("/lojista") && profile?.role !== "store_owner" && profile?.role !== "super_admin") {
    return <Navigate to="/" replace />;
  }
  if (path.startsWith("/cliente") && profile?.role !== "customer" && profile?.role !== "store_owner" && profile?.role !== "super_admin") {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};
