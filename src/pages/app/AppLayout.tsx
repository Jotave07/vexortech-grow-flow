import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { BarChart3, CreditCard, ExternalLink, LayoutDashboard, Loader2, LogOut, Menu, Settings, ShoppingBag, Tags, Ticket, Truck, UserCog, Users, UtensilsCrossed, X } from "lucide-react";
import { cn } from "@/lib/utils";

const menu = [
  { to: "/app", icon: LayoutDashboard, label: "Dashboard", end: true },
  { to: "/app/pedidos", icon: ShoppingBag, label: "Pedidos" },
  { to: "/app/cardapio", icon: UtensilsCrossed, label: "Cardapio" },
  { to: "/app/categorias", icon: Tags, label: "Categorias" },
  { to: "/app/clientes", icon: Users, label: "Clientes" },
  { to: "/app/cupons", icon: Ticket, label: "Cupons" },
  { to: "/app/entregas", icon: Truck, label: "Entregas" },
  { to: "/app/relatorios", icon: BarChart3, label: "Relatorios" },
  { to: "/app/configuracoes", icon: Settings, label: "Configuracoes" },
  { to: "/app/assinatura", icon: CreditCard, label: "Assinatura" },
  { to: "/app/usuarios", icon: UserCog, label: "Usuarios" },
];

const AppLayout = () => {
  const navigate = useNavigate();
  const { profile, loading, signOut } = useAuth();
  const [store, setStore] = useState<any>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!profile?.store_id) {
      navigate("/onboarding", { replace: true });
      return;
    }
    supabase.from("stores").select("*").eq("id", profile.store_id).maybeSingle().then(({ data }) => setStore(data));
  }, [loading, profile, navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  if (loading || !store) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="flex min-h-screen bg-background">
      <button
        type="button"
        aria-label={open ? "Fechar menu" : "Abrir menu"}
        onClick={() => setOpen(!open)}
        className="fixed left-3 top-3 z-50 rounded-md border border-border bg-card p-2 shadow-card md:hidden"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && <button aria-label="Fechar menu" className="fixed inset-0 z-30 bg-foreground/35 md:hidden" onClick={() => setOpen(false)} />}

      <aside className={cn(
        "dark fixed inset-y-0 left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-elegant transition-transform md:sticky md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="border-b border-sidebar-border p-5">
          <BrandMark compact className="mb-5" />
          <div className="rounded-lg border border-sidebar-border bg-sidebar-accent/65 p-3">
            <div className="truncate text-sm font-semibold">{store.name}</div>
            <a href={`/loja/${store.slug}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-sidebar-primary hover:underline">
              Abrir loja <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {menu.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-smooth",
                isActive ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold" : "text-sidebar-foreground/74 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <Button variant="ghost" className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" /> Sair
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto w-full max-w-7xl p-4 pt-16 md:p-8">
          <Outlet context={{ store }} />
        </div>
      </main>
    </div>
  );
};

export default AppLayout;
