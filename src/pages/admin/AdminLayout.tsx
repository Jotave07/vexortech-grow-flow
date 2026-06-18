import { useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getUserRoles } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/BrandMark";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { BarChart3, Building2, CreditCard, Loader2, LogOut, Menu, ShieldAlert, Users, X, Settings2, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const menu = [
  { to: "/admin", icon: BarChart3, label: "Visão Geral", end: true },
  { to: "/admin/lojas", icon: Building2, label: "Lojas" },
  { to: "/admin/parceiros", icon: Users, label: "Parceiros" },
  { to: "/admin/planos", icon: CreditCard, label: "Planos" },
  { to: "/admin/configuracoes", icon: Settings2, label: "Configurações" },
  { to: "/", icon: Globe, label: "Ir para Marketplace" },
];

const AdminLayout = () => {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

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
          <p className="mb-4 text-sm text-muted-foreground">Você não tem permissão de administrador Hype.</p>
          <Button asChild variant="outline"><a href="/lojista">Voltar</a></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100">
      {/* Top Navigation Header */}
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-900/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
          {/* Brand + Badge */}
          <div className="flex items-center gap-3 shrink-0">
            <BrandMark compact inverted />
            <Badge className="border-red-600 bg-red-600 text-[10px] font-black uppercase tracking-widest text-white shadow-[0_0_10px_rgba(220,38,38,0.5)]">
              SYSTEM ADMIN
            </Badge>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex flex-1 items-center justify-center gap-1">
            {menu.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => cn(
                  "flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all duration-200",
                  isActive
                    ? "bg-red-700 text-white shadow-lg shadow-red-900/40"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Sign Out */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              className="text-zinc-400 hover:bg-red-900/20 hover:text-red-400 font-bold"
              onClick={async () => { await signOut(); navigate("/"); }}
            >
              <LogOut className="h-4 w-4 mr-2" /> Sair
            </Button>
          </div>

          {/* Mobile Menu Trigger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild className="md:hidden ml-auto">
              <Button variant="ghost" size="icon" className="text-zinc-400 hover:text-white">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 bg-zinc-900 border-zinc-800 text-zinc-100 p-0">
              <div className="flex flex-col h-full">
                <div className="flex flex-col items-center border-b border-zinc-800 p-6">
                  <BrandMark compact inverted />
                  <Badge className="mt-4 border-red-600 bg-red-600 text-[10px] font-black uppercase tracking-widest text-white shadow-[0_0_10px_rgba(220,38,38,0.5)]">
                    SYSTEM ADMIN
                  </Badge>
                </div>
                <nav className="flex-1 space-y-1 p-3">
                  {menu.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) => cn(
                        "flex items-center gap-3 px-4 py-3 text-sm font-bold transition-all duration-200",
                        isActive
                          ? "bg-red-700 text-white shadow-lg shadow-red-900/40"
                          : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
                      )}
                    >
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </NavLink>
                  ))}
                </nav>
                <div className="border-t border-zinc-800 p-3">
                  <Button
                    variant="ghost"
                    className="w-full justify-start text-zinc-400 hover:bg-red-900/20 hover:text-red-400 font-bold"
                    onClick={async () => { await signOut(); navigate("/"); }}
                  >
                    <LogOut className="h-4 w-4 mr-2" /> Sair do Sistema
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 bg-zinc-950">
        <div className="mx-auto w-full max-w-7xl p-4 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default AdminLayout;
