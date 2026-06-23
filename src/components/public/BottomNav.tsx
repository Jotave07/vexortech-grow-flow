import { Home, ShoppingBag, User } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

type BottomNavProps = {
  storeSlug?: string;
  orderToken?: string;
};

export const BottomNav = ({ storeSlug, orderToken }: BottomNavProps) => {
  const location = useLocation();
  const currentPath = location.pathname;

  const navItems = [
    {
      to: "/",
      icon: Home,
      label: "Início",
      active: currentPath === "/" || currentPath === "/lojas" || (!!storeSlug && currentPath === `/loja/${storeSlug}`),
    },
    {
      to: orderToken ? `/pedido/${orderToken}` : "/cliente",
      icon: ShoppingBag,
      label: "Pedidos",
      active: currentPath.startsWith("/pedido"),
    },
    {
      to: "/cliente",
      icon: User,
      label: "Perfil",
      active: currentPath.startsWith("/cliente"),
    },
  ];

  return (
    <nav className="hype-bottom-nav fixed bottom-0 left-0 right-0 z-40 safe-area-bottom">
      <div className="mx-auto flex h-16 max-w-lg items-center justify-around px-4">
        {navItems.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            className={cn(
              "flex flex-col items-center gap-0.5 transition-colors duration-200 min-w-0 px-3 py-1 rounded-md",
              item.active
                ? "text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <item.icon className="h-5 w-5" strokeWidth={item.active ? 2.5 : 1.5} />
            <span className="text-[10px] font-semibold">{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
};
