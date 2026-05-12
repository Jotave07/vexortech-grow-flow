import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { BarChart3, CreditCard, ExternalLink, LayoutDashboard, Loader2, LogOut, Menu, Settings, ShoppingBag, Tags, Ticket, Truck, UserCog, Users, UtensilsCrossed, X, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const menu = [
  { to: "/lojista", icon: LayoutDashboard, label: "Dashboard", end: true },
  { to: "/lojista/pedidos", icon: ShoppingBag, label: "Pedidos" },
  { to: "/lojista/cardapio", icon: UtensilsCrossed, label: "Cardapio" },
  { to: "/lojista/categorias", icon: Tags, label: "Categorias" },
  { to: "/lojista/clientes", icon: Users, label: "Clientes" },
  { to: "/lojista/cupons", icon: Ticket, label: "Cupons" },
  { to: "/lojista/entregas", icon: Truck, label: "Entregas" },
  { to: "/lojista/relatorios", icon: BarChart3, label: "Relatorios" },
  { to: "/lojista/configuracoes", icon: Settings, label: "Configuracoes" },
  { to: "/lojista/assinatura", icon: CreditCard, label: "Assinatura" },
  { to: "/lojista/usuarios", icon: UserCog, label: "Usuarios" },
  { to: "/", icon: ExternalLink, label: "Ver Marketplace" },
  { to: "/admin", icon: ShieldCheck, label: "Global Admin", superAdminOnly: true },
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
    supabase.from("stores" as any).select("*").eq("id", profile.store_id).maybeSingle().then(({ data, error }) => {
      if (error) {
        console.error("Error fetching store:", error);
        return;
      }
      setStore(data);
    });
  }, [loading, profile, navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/vendas", { replace: true });
  };

  if (loading || !store) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="flex min-h-screen bg-orange-50/30">
      <button
        type="button"
        aria-label={open ? "Fechar menu" : "Abrir menu"}
        onClick={() => setOpen(!open)}
        className="fixed left-3 top-3 z-50 rounded-md border border-orange-200 bg-white p-2 shadow-sm md:hidden text-orange-600"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && <button aria-label="Fechar menu" className="fixed inset-0 z-30 bg-orange-900/20 md:hidden" onClick={() => setOpen(false)} />}

      <aside className={cn(
        "fixed inset-y-0 left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-orange-100 bg-white transition-transform md:sticky md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="border-b border-orange-100 p-5">
          <BrandMark compact className="mb-5" />
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 shadow-sm">
            <div className="truncate text-xs font-black uppercase tracking-tight text-orange-900">{store.name}</div>
            <a href={`/loja/${store.slug}`} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-orange-600 hover:text-orange-700 hover:underline">
              Visualizar loja <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {menu.filter(item => !item.superAdminOnly || profile?.role === "super_admin").map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all duration-200 group",
                isActive 
                  ? "bg-orange-500 text-white shadow-md shadow-orange-200" 
                  : "text-orange-800 hover:bg-orange-50 hover:text-orange-900"
              )}
            >
              {({ isActive }) => (
                <>
                  <item.icon className={cn("h-4 w-4", isActive ? "text-orange-100" : "text-orange-400 group-hover:text-orange-600")} />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-orange-100 p-3">
          <Button variant="ghost" className="w-full justify-start rounded-lg text-orange-700 hover:bg-red-50 hover:text-red-600" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" /> Sair
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
