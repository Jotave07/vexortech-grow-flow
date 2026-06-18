import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { LayoutDashboard, CreditCard, User, LogOut, Menu, Home } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const menu = [
  { to: "/cliente", icon: LayoutDashboard, label: "Meu Painel", end: true },
  { to: "/cliente/assinatura", icon: CreditCard, label: "Assinatura" },
  { to: "/", icon: Home, label: "Ir para Início" },
];

const CustomerLayout = () => {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-muted/60">
      {/* Top Navigation Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-white/95 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4">
          {/* Brand */}
          <div className="shrink-0">
            <BrandMark compact />
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex flex-1 items-center justify-center gap-1">
            {menu.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => cn(
                  "flex items-center gap-2 px-4 py-2 text-sm font-semibold uppercase tracking-wider transition-all duration-200",
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

          {/* User + Sign Out */}
          <div className="hidden md:flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2 px-3 py-1.5 border border-border bg-muted">
              <div className="h-7 w-7 bg-primary flex items-center justify-center text-primary-foreground">
                <User className="h-4 w-4" />
              </div>
              <span className="text-xs font-bold text-foreground uppercase tracking-wider max-w-[120px] truncate">
                {profile?.full_name?.split(' ')[0] || 'Cliente'}
              </span>
            </div>
            <Button
              variant="ghost"
              className="text-muted-foreground hover:bg-red-50 hover:text-red-600"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4 mr-2" /> Sair
            </Button>
          </div>

          {/* Mobile Menu Trigger */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild className="md:hidden ml-auto">
              <Button variant="ghost" size="icon" className="text-foreground">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 bg-white p-0">
              <div className="flex flex-col h-full">
                <div className="border-b border-border p-6 flex flex-col items-center">
                  <BrandMark compact />
                  <div className="w-full mt-4 bg-muted p-4 border border-border">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 bg-primary flex items-center justify-center text-primary-foreground">
                        <User className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-foreground uppercase tracking-wider truncate">
                          {profile?.full_name?.split(' ')[0] || 'Cliente'}
                        </p>
                        <p className="text-[10px] text-muted-foreground font-medium truncate italic">Área do Cliente</p>
                      </div>
                    </div>
                  </div>
                </div>
                <nav className="flex-1 space-y-1 p-4">
                  {menu.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) => cn(
                        "flex items-center gap-3 px-4 py-3 text-sm font-semibold transition-all duration-200",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-[var(--shadow-green)]"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      {item.label}
                    </NavLink>
                  ))}
                </nav>
                <div className="border-t border-border p-4">
                  <Button
                    variant="ghost"
                    className="w-full justify-start text-muted-foreground hover:bg-red-50 hover:text-red-600"
                    onClick={handleSignOut}
                  >
                    <LogOut className="h-5 w-5 mr-3" /> Sair da conta
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        <div className="mx-auto w-full max-w-7xl p-4 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default CustomerLayout;
