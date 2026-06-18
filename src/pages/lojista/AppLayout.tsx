import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { backend } from "@/integrations/backend/client";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { BarChart3, Bell, CalendarDays, CreditCard, ExternalLink, LayoutDashboard, Loader2, LogOut, Menu, Search, Settings, ShieldCheck, ShoppingBag, Tags, Ticket, Truck, UserCog, Users, UtensilsCrossed, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildDeliveryUrl } from "@/lib/domains";

const menu = [
  { to: "/lojista", icon: LayoutDashboard, label: "Dashboard", end: true },
  { to: "/lojista/pedidos", icon: ShoppingBag, label: "Pedidos" },
  { to: "/lojista/cardapio", icon: UtensilsCrossed, label: "Cardápio" },
  { to: "/lojista/categorias", icon: Tags, label: "Categorias" },
  { to: "/lojista/clientes", icon: Users, label: "Clientes" },
  { to: "/lojista/cupons", icon: Ticket, label: "Cupons" },
  { to: "/lojista/entregas", icon: Truck, label: "Entregas" },
  { to: "/lojista/relatorios", icon: BarChart3, label: "Relatórios" },
  { to: "/lojista/configuracoes", icon: Settings, label: "Configurações" },
  { to: "/lojista/assinatura", icon: CreditCard, label: "Assinatura" },
  { to: "/lojista/usuarios", icon: UserCog, label: "Usuários" },
  { to: "/", icon: ExternalLink, label: "Ver Marketplace" },
  { to: "/admin", icon: ShieldCheck, label: "Global Admin", superAdminOnly: true },
];

const AppLayout = () => {
  const navigate = useNavigate();
  const { user, profile, loading, signOut } = useAuth();
  const [store, setStore] = useState<any>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    let cancelled = false;

    const loadStore = async () => {
      if (!profile?.store_id) {
        if (profile?.role === "super_admin") {
          navigate("/admin", { replace: true });
          return;
        }

        if (!user?.id) {
          navigate("/lojista/entrar", { replace: true });
          return;
        }

        const { data: ownedStore, error: ownerError } = await backend
          .from("stores" as any)
          .select("*")
          .eq("owner_user_id", user.id)
          .maybeSingle();

        if (ownerError) console.error("Error fetching owned store:", ownerError);

        if (ownedStore) {
          await backend
            .from("profiles" as any)
            .update({ store_id: ownedStore.id, role: "store_owner" })
            .eq("user_id", user.id);

          if (!cancelled) setStore(ownedStore);
          return;
        }

        navigate("/onboarding", { replace: true });
        return;
      }

      const { data, error } = await backend
        .from("stores" as any)
        .select("*")
        .eq("id", profile.store_id)
        .maybeSingle();

      if (error) {
        console.error("Error fetching store:", error);
        return;
      }

      if (!data) {
        navigate("/onboarding", { replace: true });
        return;
      }

      if (!cancelled) setStore(data);
    };

    loadStore();

    return () => {
      cancelled = true;
    };
  }, [loading, profile, user?.id, navigate]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  if (loading || !store) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const filteredMenu = menu.filter(item => !item.superAdminOnly || profile?.role === "super_admin");

  return (
    <div className="flex min-h-screen flex-col bg-muted/60">
      {/* Top Navigation Header - Row 1: Brand, Store Info, Actions */}
      <header className="sticky top-0 z-50 border-b border-border bg-white/95 backdrop-blur-xl">
        {/* Row 1: Store info bar */}
        <div className="border-b border-border">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
            {/* Brand + Store Identity */}
            <div className="flex items-center gap-3 shrink-0 min-w-0">
              <BrandMark compact />
              <span className="hidden sm:block h-5 w-px bg-border" />
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-9 w-9 shrink-0 overflow-hidden border border-border bg-muted">
                  {store.logo_url ? (
                    <img src={store.logo_url} alt={store.name} className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-primary">
                      <ShoppingBag className="h-4 w-4" />
                    </div>
                  )}
                </div>
                <div className="min-w-0 hidden sm:block">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-xs font-black uppercase tracking-tight">{store.public_name || store.name}</h1>
                    <span className={cn(
                      "px-2 py-0.5 text-[9px] font-black uppercase tracking-widest border",
                      store.is_active && !store.is_suspended ? "bg-primary/15 text-foreground border-primary/30" : "bg-destructive/10 text-destructive border-destructive/30"
                    )}>
                      {store.is_active && !store.is_suspended ? "Ativa" : "Bloqueada"}
                    </span>
                  </div>
                  <a href={buildDeliveryUrl(`/loja/${store.slug}`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground hover:text-primary">
                    Ver loja pública <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Search (desktop) */}
            <div className="hidden lg:flex h-9 min-w-[14rem] items-center gap-2 border border-border bg-card px-3">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Buscar pedidos, clientes...</span>
            </div>

            {/* Date */}
            <div className="hidden sm:flex h-9 items-center gap-2 border border-border bg-card px-3 text-xs font-semibold text-foreground">
              <CalendarDays className="h-3.5 w-3.5 text-primary" />
              {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}
            </div>

            {/* Bell */}
            <button className="relative flex h-9 w-9 items-center justify-center border border-border bg-card text-foreground">
              <Bell className="h-4 w-4" />
              <span className="absolute right-1.5 top-1.5 h-2 w-2 bg-primary" />
            </button>

            {/* User */}
            <div className="hidden sm:flex items-center gap-2 border border-border bg-card px-2.5 py-1.5">
              <div className="h-7 w-7 bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                {(profile?.full_name || user?.email || "L")[0].toUpperCase()}
              </div>
              <div className="leading-tight hidden md:block">
                <div className="max-w-[8rem] truncate text-[11px] font-black">{profile?.full_name || user?.email}</div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Lojista</div>
              </div>
            </div>

            {/* Mobile Menu Trigger */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild className="md:hidden shrink-0">
                <Button variant="ghost" size="icon" className="text-foreground">
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72 bg-white p-0">
                <div className="flex flex-col h-full">
                  <div className="border-b border-border p-5">
                    <BrandMark compact className="mb-5" />
                    <div className="border border-border bg-muted p-3">
                      <div className="truncate text-xs font-black uppercase tracking-tight text-foreground">{store.name}</div>
                      <a href={buildDeliveryUrl(`/loja/${store.slug}`)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-foreground hover:text-primary hover:underline">
                        Visualizar loja <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                  <nav className="flex-1 space-y-1 overflow-y-auto p-3">
                    {filteredMenu.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive }) => cn(
                          "flex items-center gap-3 px-3 py-2.5 text-sm font-semibold transition-all duration-200",
                          isActive
                            ? "bg-primary text-primary-foreground shadow-[var(--shadow-green)]"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                        {item.label}
                      </NavLink>
                    ))}
                  </nav>
                  <div className="border-t border-border p-3">
                    <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:bg-red-50 hover:text-red-600" onClick={handleSignOut}>
                      <LogOut className="h-4 w-4 mr-2" /> Sair
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        {/* Row 2: Desktop Navigation Bar */}
        <nav className="hidden md:block border-b border-border bg-white">
          <div className="mx-auto flex max-w-7xl items-center gap-0.5 px-4 overflow-x-auto">
            {filteredMenu.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => cn(
                  "flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap transition-all duration-200 border-b-2",
                  isActive
                    ? "border-primary text-primary bg-primary/5"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
          <Outlet context={{ store }} />
        </div>
      </main>
    </div>
  );
};

export default AppLayout;
