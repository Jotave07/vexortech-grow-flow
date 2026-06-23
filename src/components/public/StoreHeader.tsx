import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Menu,
  Search,
  ShoppingBag,
  Clock,
  MapPin,
  Store,
  User,
  LogOut,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface StoreHeaderInfo {
  slug: string;
  name: string;
  logoUrl?: string;
  coverUrl?: string;
  storeType?: string;
  isOpen: boolean;
  isVerified: boolean;
  minOrder: number;
  avgPrep: number;
  deliveryFee?: number;
  city?: string;
  state?: string;
  whatsapp?: string;
}

interface StoreHeaderProps {
  store: StoreHeaderInfo;
  isLoggedIn: boolean;
  isAdmin: boolean;
  onSignOut: () => void;
  onSearch?: (term: string) => void;
  className?: string;
}

export const StoreHeader = ({
  store,
  isLoggedIn,
  isAdmin,
  onSignOut,
  onSearch,
  className,
}: StoreHeaderProps) => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      {/* Top header bar */}
      <header
        className={cn(
          "hype-shell sticky top-0 z-40",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          {/* Hamburger menu */}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-foreground"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-72 border-r border-border bg-background p-0 text-foreground"
            >
              {/* Store brand in menu */}
              <div className="border-b border-border p-6">
                <div className="flex items-center gap-3">
                  {store.logoUrl ? (
                    <img
                      src={store.logoUrl}
                      alt={store.name}
                      className="h-12 w-12 rounded-lg border border-border object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
                      <Store className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">
                      {store.name}
                    </p>
                    <p className="text-[10px] uppercase text-muted-foreground">
                      {store.storeType || "Delivery"}
                    </p>
                  </div>
                </div>
                {store.isVerified && (
                  <Badge className="mt-3 bg-primary text-primary-foreground text-[10px] font-bold">
                    <ShieldCheck className="mr-1 h-3 w-3" /> Verificada
                  </Badge>
                )}
              </div>

              {/* Menu links */}
              <nav className="flex flex-col p-3">
                <button
                  onClick={() => { navigate("/"); setMenuOpen(false); }}
                  className="flex items-center gap-3 rounded-md px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <ShoppingBag className="h-4 w-4" /> Início
                </button>
                <button
                  onClick={() => {
                    navigate(`/loja/${store.slug}`);
                    setMenuOpen(false);
                  }}
                  className="flex items-center gap-3 rounded-md px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Store className="h-4 w-4" /> Cardápio
                </button>
                <button
                  onClick={() => { navigate("/cliente"); setMenuOpen(false); }}
                  className="flex items-center gap-3 rounded-md px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <User className="h-4 w-4" /> Meu Perfil
                </button>

                <div className="my-2 border-t border-border" />

                {/* Store info section */}
                <div className="px-4 py-2">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                    Informações
                  </p>
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" />
                      {store.city}, {store.state}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      Preparo ~{store.avgPrep} min
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ShoppingBag className="h-3.5 w-3.5" />
                      Mín. R$ {(Number(store.minOrder) || 0).toFixed(2)}
                    </div>
                  </div>
                </div>

                <div className="my-2 border-t border-border" />

                {/* Auth */}
                {isLoggedIn ? (
                  <>
                    {isAdmin && (
                      <button
                        onClick={() => { navigate("/admin"); setMenuOpen(false); }}
                        className="flex items-center gap-3 rounded-md px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      >
                        <ShieldCheck className="h-4 w-4" /> Admin
                      </button>
                    )}
                    <button
                      onClick={() => { onSignOut(); setMenuOpen(false); }}
                      className="flex items-center gap-3 rounded-md px-4 py-3 text-sm font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
                    >
                      <LogOut className="h-4 w-4" /> Sair
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      navigate(`/entrar?redirect=/loja/${store.slug}`);
                      setMenuOpen(false);
                    }}
                    className="flex items-center gap-3 rounded-md px-4 py-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
                  >
                    <User className="h-4 w-4" /> Entrar / Cadastrar
                  </button>
                )}
              </nav>
            </SheetContent>
          </Sheet>

          {/* Brand + Store name (center) */}
          <button
            onClick={() => navigate(`/loja/${store.slug}`)}
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            {store.logoUrl && (
              <img
                src={store.logoUrl}
                alt={store.name}
                className="h-7 w-7 rounded-md object-cover"
              />
            )}
            <div className="min-w-0 text-left">
              <h1 className="truncate text-sm font-bold leading-tight text-foreground">
                {store.name}
              </h1>
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    store.isOpen ? "bg-primary" : "bg-red-400",
                  )}
                />
                <span className="text-[10px] text-muted-foreground">
                  {store.isOpen ? "Aberto" : "Fechado"}
                </span>
              </div>
            </div>
          </button>

          {/* Search + Login */}
          <div className="flex items-center gap-1">
            {onSearch && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
                onClick={() => {
                  const term = prompt("Buscar no cardápio:");
                  if (term) onSearch(term);
                }}
              >
                <Search className="h-4 w-4" />
              </Button>
            )}
            <ThemeToggle />
            {!isLoggedIn && (
              <Button
                variant="ghost"
                size="sm"
                className="rounded-md text-xs font-semibold text-muted-foreground hover:text-foreground"
                onClick={() => navigate(`/entrar?redirect=/loja/${store.slug}`)}
              >
                Entrar
              </Button>
            )}
          </div>
        </div>
      </header>
    </>
  );
};
