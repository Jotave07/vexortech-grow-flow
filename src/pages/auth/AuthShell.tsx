import { ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
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
    customer: "bg-emerald-50 border-emerald-100",
    merchant: "bg-orange-50 border-orange-100",
    admin: "bg-zinc-950 border-zinc-800",
  };

  const cardClasses = {
    customer: "border-emerald-200 shadow-emerald-100",
    merchant: "border-orange-200 shadow-orange-100",
    admin: "border-zinc-800 bg-zinc-900 text-zinc-100 shadow-black/40",
  };

  const titleClasses = {
    customer: "text-emerald-900",
    merchant: "text-orange-900",
    admin: "text-white",
  };

  return (
    <div className={cn("min-h-screen flex flex-col items-center justify-center p-4 transition-colors duration-500", themeClasses[theme])}>
      <BrandMark to="/" className="mb-8 scale-125" inverted={theme === "admin"} />
      
      <Card className={cn("w-full max-w-md p-8 border-2 shadow-xl transition-all duration-300", cardClasses[theme])}>
        <div className="mb-6 text-center">
          <h1 className={cn("text-2xl font-black uppercase tracking-tight italic", titleClasses[theme])}>{title}</h1>
          {subtitle && <p className={cn("mt-2 text-sm font-medium", theme === "admin" ? "text-zinc-400" : "text-muted-foreground")}>{subtitle}</p>}
        </div>
        
        {children}
      </Card>
      
      <div className="mt-8 text-center space-y-2">
        <p className={cn("text-xs font-bold uppercase tracking-widest", theme === "admin" ? "text-zinc-500" : "text-muted-foreground")}>
          © {new Date().getFullYear()} Vexortech Commerce Engine
        </p>
      </div>
    </div>
  );
};
