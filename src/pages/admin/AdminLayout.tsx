import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getUserRoles } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/BrandMark";
import { BarChart3, Building2, CreditCard, Loader2, LogOut, Menu, ShieldAlert, X, Settings2, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const menu = [
  { to: "/admin", icon: BarChart3, label: "Visão Geral", end: true },
  { to: "/admin/lojas", icon: Building2, label: "Lojas" },
  { to: "/admin/planos", icon: CreditCard, label: "Planos" },
  { to: "/admin/configuracoes", icon: Settings2, label: "Configurações" },
  { to: "/", icon: Globe, label: "Ir para Marketplace" },
];

const AdminLayout = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate("/entrar?redirect=/admin", { replace: true });
      return;
    }
    (async () => {
      const roles = await getUserRoles(user.id);
      if (roles.includes("super_admin")) {
        setIsAdmin(true);
        return;
      }
      setIsAdmin(false);
    })();
  }, [loading, user, navigate]);

  if (loading || isAdmin === null) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <ShieldAlert className="mx-auto mb-3 h-12 w-12 text-destructive" />
          <h1 className="mb-2 text-xl font-bold">Acesso restrito</h1>
          <p className="mb-4 text-sm text-muted-foreground">Voce nao tem permissao de administrador Vexor.</p>
          <Button asChild variant="outline"><a href="/lojista">Voltar</a></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      <button
        type="button"
        aria-label={open ? "Fechar menu" : "Abrir menu"}
        onClick={() => setOpen(!open)}
        className="fixed left-3 top-3 z-50 rounded-md border border-zinc-800 bg-zinc-900 p-2 shadow-lg md:hidden text-zinc-400"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {open && <button aria-label="Fechar menu" className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setOpen(false)} />}

      <aside className={cn(
        "fixed inset-y-0 left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-zinc-800 bg-zinc-900 transition-transform md:sticky md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex flex-col items-center border-b border-zinc-800 p-6">
          <BrandMark compact inverted />
          <Badge variant="outline" className="mt-4 rounded-none border-red-600 text-[10px] font-black uppercase tracking-widest bg-red-600 text-white shadow-[0_0_10px_rgba(220,38,38,0.5)]">
            SYSTEM ADMIN
          </Badge>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {menu.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cn(
                "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-bold transition-all duration-200 group",
                isActive 
                  ? "bg-red-700 text-white shadow-lg shadow-red-900/40" 
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
              )}
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn("h-4 w-4", isActive ? "text-red-200" : "text-zinc-500 group-hover:text-red-400")} /> 
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-zinc-800 p-3">
          <Button variant="ghost" className="w-full justify-start text-zinc-400 hover:bg-red-900/20 hover:text-red-400 font-bold" onClick={async () => { await signOut(); navigate("/"); }}>
            <LogOut className="h-4 w-4 mr-2" /> Sair do Sistema
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 bg-zinc-950">
        <div className="mx-auto w-full max-w-7xl p-4 pt-16 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;
