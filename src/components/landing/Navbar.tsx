import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/contexts/AuthContext";
import { getUserRoles } from "@/lib/auth/roles";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { User, LogOut, LayoutDashboard, Store, ShoppingBag, Settings } from "lucide-react";

export const Navbar = () => {
  const { user, profile, signOut } = useAuth();
  const navigate = useNavigate();
  
  const isAdmin = user?.email === "jvieira@vexortech.com.br" || profile?.role === "super_admin";
  const isMerchant = profile?.role === "store_owner";
  
  const dashboardPath = isAdmin 
    ? "/admin" 
    : isMerchant
      ? "/lojista" 
      : "/cliente";

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-border bg-background/92 backdrop-blur-xl">
      <nav className="container mx-auto flex h-16 items-center justify-between px-4">
        <BrandMark to="/" animated className="max-w-[10rem]" />
        <div className="hidden items-center gap-7 md:flex">
          <Link to="/lojas" className="text-sm font-bold text-emerald-600 transition-smooth hover:text-emerald-800 uppercase tracking-widest italic">Comprar Agora</Link>
          <a href="#beneficios" className="text-sm text-muted-foreground transition-smooth hover:text-foreground">Beneficios</a>
          <a href="#nichos" className="text-sm text-muted-foreground transition-smooth hover:text-foreground">Segmentos</a>
          <a href="#planos" className="text-sm text-muted-foreground transition-smooth hover:text-foreground">Planos</a>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="hero" size="sm" className="gap-2">
                  <User className="h-4 w-4" />
                  <span className="hidden sm:inline">Minha Conta</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{profile?.full_name || user.email}</p>
                    <p className="text-xs leading-none text-muted-foreground lowercase">{profile?.role || "Cliente"}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                
                {isAdmin && (
                  <DropdownMenuItem asChild>
                    <Link to="/admin" className="cursor-pointer">
                      <Settings className="mr-2 h-4 w-4" />
                      <span>Painel Administrador</span>
                    </Link>
                  </DropdownMenuItem>
                )}

                {isMerchant && (
                  <DropdownMenuItem asChild>
                    <Link to="/lojista" className="cursor-pointer">
                      <Store className="mr-2 h-4 w-4" />
                      <span>Painel da Loja</span>
                    </Link>
                  </DropdownMenuItem>
                )}

                <DropdownMenuItem asChild>
                  <Link to="/cliente" className="cursor-pointer">
                    <ShoppingBag className="mr-2 h-4 w-4" />
                    <span>Minhas Compras</span>
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Sair</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
                <Link to="/entrar">Entrar</Link>
              </Button>
              <Button variant="hero" size="sm" asChild>
                <Link to="/cadastrar">Começar Agora</Link>
              </Button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
};

