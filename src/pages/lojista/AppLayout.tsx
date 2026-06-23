import { NavLink, Outlet, useNavigate, Link } from "react-router-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { backend } from "@/integrations/backend/client";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BarChart3, Bell, BellRing, CalendarDays, Clock, CreditCard, ExternalLink, LayoutDashboard, Loader2, LogOut, Menu, Search, Settings, ShieldCheck, ShoppingBag, Tags, Ticket, Truck, UserCog, Users, UtensilsCrossed } from "lucide-react";
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
  { to: "/lojista/entregadores", icon: Users, label: "Entregadores" },
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unseenCount, setUnseenCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const channelRef = useRef<any>(null);

  // Subscribe to new orders for notifications
  useEffect(() => {
    if (!store?.id) return;
    const channel = backend.channel(`notif-${store.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "orders", filter: `store_id=eq.${store.id}` },
        (payload: any) => {
          const order = payload.new;
          setNotifications((prev) => [{ ...order, _notifAt: Date.now() }, ...prev].slice(0, 20));
          setUnseenCount((c) => {
            // Don't count if popover is open (user is looking)
            return c + 1;
          });
        })
      .subscribe();
    channelRef.current = channel;
    return () => { channel.close(); };
  }, [store?.id]);

  const handleBellClick = useCallback(() => {
    setUnseenCount(0);
    setNotifOpen((prev) => !prev);
  }, []);

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
    <div className="hype-page flex min-h-screen flex-col">
      {/* Top Navigation Header */}
      <header className="hype-shell sticky top-0 z-50">
        <div className="border-b border-border">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
            <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0 rounded-md border-border bg-card/80 text-foreground"
                  aria-label="Abrir menu de funcionalidades"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[20rem] max-w-[calc(100vw-2rem)] bg-background p-0">
                <div className="flex h-full flex-col">
                  <div className="border-b border-border p-5">
                    <BrandMark compact className="mb-5" />
                    <div className="rounded-md border border-border bg-card p-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
                          {store.logo_url ? (
                            <img src={store.logo_url} alt={store.name} className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-primary">
                              <ShoppingBag className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-black uppercase tracking-tight text-foreground">{store.public_name || store.name}</div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Portal do lojista</div>
                        </div>
                      </div>
                      <a
                        href={buildDeliveryUrl(`/loja/${store.slug}`)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-muted-foreground hover:text-primary"
                      >
                        Ver loja pública <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>

                  <div className="border-b border-border px-5 py-3">
                    <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Funcionalidades</div>
                  </div>

                  <nav className="flex-1 space-y-1 overflow-y-auto p-3">
                    {filteredMenu.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        onClick={() => setMenuOpen(false)}
                        className={({ isActive }) => cn(
                          "flex items-center gap-3 rounded-md px-3 py-3 text-sm font-semibold transition-all duration-200",
                          isActive
                            ? "bg-primary text-primary-foreground shadow-[var(--shadow-green)]"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        <item.icon className="h-4 w-4" />
                        <span>{item.label}</span>
                      </NavLink>
                    ))}
                  </nav>

                  <div className="border-t border-border p-3">
                    <Button variant="ghost" className="w-full justify-start text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={handleSignOut}>
                      <LogOut className="h-4 w-4 mr-2" /> Sair
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>

            {/* Brand + Store Identity */}
            <div className="flex items-center gap-3 shrink-0 min-w-0">
              <BrandMark compact />
              <span className="hidden sm:block h-5 w-px bg-border" />
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border bg-muted">
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
            <div className="hidden h-9 min-w-[14rem] items-center gap-2 rounded-full border border-border bg-card/70 px-3 lg:flex">
              <Search className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Buscar pedidos, clientes...</span>
            </div>

            {/* Date */}
            <div className="hidden h-9 items-center gap-2 rounded-full border border-border bg-card/70 px-3 text-xs font-semibold text-foreground sm:flex">
              <CalendarDays className="h-3.5 w-3.5 text-primary" />
              {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}
            </div>

            {/* Notifications */}
            <ThemeToggle />

            <Popover open={notifOpen} onOpenChange={(open) => { setNotifOpen(open); if (open) setUnseenCount(0); }}>
              <PopoverTrigger asChild>
                <button
                  className="relative flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card/70 text-foreground hover:bg-card"
                  onClick={handleBellClick}
                >
                  {unseenCount > 0 ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                  {unseenCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                      {unseenCount > 9 ? "9+" : unseenCount}
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <span className="text-xs font-bold uppercase tracking-wider">Notificações</span>
                  {notifications.length > 0 && (
                    <button
                      className="text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                      onClick={() => setNotifications([])}
                    >
                      Limpar todas
                    </button>
                  )}
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                      <Bell className="h-8 w-8 text-muted-foreground/40" />
                      <p className="text-xs text-muted-foreground">Nenhuma notificação ainda</p>
                      <p className="text-[10px] text-muted-foreground/60">Novos pedidos aparecerão aqui</p>
                    </div>
                  ) : (
                    notifications.map((n, i) => (
                      <Link
                        key={n.id || i}
                        to={`/lojista/pedidos`}
                        onClick={() => setNotifOpen(false)}
                        className="flex items-start gap-3 border-b border-border/50 px-4 py-3 hover:bg-muted/50 transition-colors"
                      >
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                          <ShoppingBag className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate">
                            Novo pedido #{n.order_number || n.id?.slice(0, 8)}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {n.customer_name || "Cliente"}
                          </p>
                          <p className="text-[10px] text-muted-foreground/60 flex items-center gap-1 mt-0.5">
                            <Clock className="h-2.5 w-2.5" />
                            {n._notifAt ? new Date(n._notifAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-[10px] font-bold text-primary">
                          {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n.total || 0)}
                        </span>
                      </Link>
                    ))
                  )}
                </div>
                {notifications.length > 0 && (
                  <div className="border-t border-border p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-[10px] font-bold uppercase tracking-wider"
                      asChild
                    >
                      <Link to="/lojista/pedidos" onClick={() => setNotifOpen(false)}>
                        Ver todos os pedidos
                      </Link>
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>

            {/* User */}
            <div className="hidden items-center gap-2 rounded-full border border-border bg-card/70 px-2.5 py-1.5 sm:flex">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-black text-primary-foreground">
                {(profile?.full_name || user?.email || "L")[0].toUpperCase()}
              </div>
              <div className="leading-tight hidden md:block">
                <div className="max-w-[8rem] truncate text-[11px] font-black">{profile?.full_name || user?.email}</div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Lojista</div>
              </div>
            </div>

          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 bg-background">
        <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
          <Outlet context={{ store }} />
        </div>
      </main>
    </div>
  );
};

export default AppLayout;
