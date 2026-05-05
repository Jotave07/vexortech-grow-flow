import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/contexts/AuthContext";

export const Navbar = () => {
  const { user, profile } = useAuth();
  
  const dashboardPath = user?.email === "jvieira@vexortech.com.br" 
    ? "/admin" 
    : profile?.store_id 
      ? "/app" 
      : "/meu-painel";

  return (
    <header className="fixed left-0 right-0 top-0 z-50 border-b border-border bg-background/92 backdrop-blur-xl">
      <nav className="container mx-auto flex h-16 items-center justify-between px-4">
        <BrandMark to="/" animated className="max-w-[10rem]" />
        <div className="hidden items-center gap-7 md:flex">
          <a href="#beneficios" className="text-sm text-muted-foreground transition-smooth hover:text-foreground">Beneficios</a>
          <a href="#como-funciona" className="text-sm text-muted-foreground transition-smooth hover:text-foreground">Fluxo</a>
          <a href="#nichos" className="text-sm text-muted-foreground transition-smooth hover:text-foreground">Segmentos</a>
          <a href="#planos" className="text-sm text-muted-foreground transition-smooth hover:text-foreground">Planos</a>
        </div>
        <div className="flex items-center gap-2">
          {user ? (
            <Button variant="hero" size="sm" asChild>
              <Link to={dashboardPath}>Meu Painel</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="hidden sm:inline-flex" asChild>
                <Link to="/entrar">Entrar</Link>
              </Button>
              <Button variant="hero" size="sm" asChild>
                <Link to="/cadastrar">Comecar</Link>
              </Button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
};

