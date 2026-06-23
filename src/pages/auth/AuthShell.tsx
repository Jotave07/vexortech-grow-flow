import { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type AuthShellProps = {
  children: ReactNode;
  theme?: "customer" | "merchant" | "admin";
  title: string;
  subtitle?: string;
};

export const AuthShell = ({ children, theme = "customer", title, subtitle }: AuthShellProps) => {
  const themeClasses = {
    customer: "bg-background border-border",
    merchant: "bg-background border-border",
    admin: "bg-background border-border",
  };

  const cardClasses = {
    customer: "border-border shadow-[var(--shadow-panel)]",
    merchant: "border-border shadow-[var(--shadow-panel)]",
    admin: "border-border bg-card text-card-foreground shadow-black/40",
  };

  const titleClasses = {
    customer: "text-foreground",
    merchant: "text-foreground",
    admin: "text-foreground",
  };

  return (
    <div className={cn("min-h-screen flex flex-col items-center justify-center p-4 transition-colors duration-500", themeClasses[theme])}>
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <BrandMark to="/" className="mb-8 scale-125" />
      
      <Card className={cn("w-full max-w-md rounded-xl p-8 border shadow-xl transition-all duration-300", cardClasses[theme])}>
        <div className="mb-6 text-center">
          <h1 className={cn("font-display text-2xl font-black uppercase tracking-tight", titleClasses[theme])}>{title}</h1>
          {subtitle && <p className="mt-2 text-sm font-medium text-muted-foreground">{subtitle}</p>}
        </div>
        
        {children}
      </Card>
      
      <div className="mt-8 text-center space-y-2">
        <p className="text-xs font-bold uppercase text-muted-foreground">
          © {new Date().getFullYear()} Hype Delivery
        </p>
      </div>
    </div>
  );
};
