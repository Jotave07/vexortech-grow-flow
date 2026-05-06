import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { LayoutDashboard, ShoppingBag, User, LogOut, Menu, X, Home } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const menu = [
  { to: "/cliente", icon: LayoutDashboard, label: "Meu Painel", end: true },
  { to: "/", icon: Home, label: "Ir para Início" },
];

const CustomerLayout = () => {
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/", { replace: true });
  };

  return (
    <div className="flex min-h-screen bg-[#F0FDF4]"> {/* Light green background */}
      <button
        type="button"
        aria-label={open ? "Fechar menu" : "Abrir menu"}
        onClick={() => setOpen(!open)}
        className="fixed left-3 top-3 z-50 rounded-md border border-emerald-200 bg-white p-2 shadow-sm md:hidden text-emerald-600"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && <button aria-label="Fechar menu" className="fixed inset-0 z-30 bg-emerald-900/20 md:hidden" onClick={() => setOpen(false)} />}

      <aside className={cn(
        "fixed inset-y-0 left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-emerald-100 bg-white transition-transform md:sticky md:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="border-b border-emerald-50 p-6 flex flex-col items-center">
          <BrandMark compact className="mb-4" />
          <div className="w-full rounded-xl bg-emerald-50 p-4 border border-emerald-100">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-emerald-500 flex items-center justify-center text-white shadow-sm">
                <User className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-emerald-800 uppercase tracking-wider truncate">
                  {profile?.full_name?.split(' ')[0] || 'Cliente'}
                </p>
                <p className="text-[10px] text-emerald-600 font-medium truncate italic">Área do Cliente</p>
              </div>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {menu.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cn(
                "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition-all duration-200",
                isActive 
                  ? "bg-emerald-600 text-white shadow-md shadow-emerald-200" 
                  : "text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
              )}
            >
              <item.icon className={cn("h-5 w-5", isActive ? "text-emerald-100" : "text-emerald-400")} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-emerald-50 p-4">
          <Button 
            variant="ghost" 
            className="w-full justify-start rounded-lg text-emerald-600 hover:bg-red-50 hover:text-red-600 transition-colors" 
            onClick={handleSignOut}
          >
            <LogOut className="h-5 w-5 mr-3" /> Sair da conta
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 flex flex-col">
        <div className="mx-auto w-full max-w-7xl p-4 md:p-8 flex-1">
          <Outlet />
        </div>
      </main>
    </div>
  );
};

export default CustomerLayout;
