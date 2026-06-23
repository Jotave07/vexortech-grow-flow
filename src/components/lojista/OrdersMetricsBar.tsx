import { cn } from "@/lib/utils";
import {
  Package,
  CheckCircle2,
  CookingPot,
  Truck,
  PackageCheck,
  XCircle,
} from "lucide-react";

interface MetricCard {
  key: string;
  label: string;
  icon: React.ElementType;
  accentClass: string;
}

const METRICS: MetricCard[] = [
  {
    key: "novo",
    label: "Novos",
    icon: Package,
    accentClass: "text-blue-500",
  },
  {
    key: "confirmado",
    label: "Confirmados",
    icon: CheckCircle2,
    accentClass: "text-primary",
  },
  {
    key: "em_preparo",
    label: "Em preparo",
    icon: CookingPot,
    accentClass: "text-amber-500",
  },
  {
    key: "saiu_para_entrega",
    label: "Em rota",
    icon: Truck,
    accentClass: "text-cyan-500",
  },
  {
    key: "entregue",
    label: "Entregues",
    icon: PackageCheck,
    accentClass: "text-status-emerald",
  },
  {
    key: "cancelado",
    label: "Cancelados",
    icon: XCircle,
    accentClass: "text-destructive",
  },
];

interface OrdersMetricsBarProps {
  counts: Record<string, number>;
  activeFilter: string | null;
  onFilterClick: (statusKey: string) => void;
}

export function OrdersMetricsBar({ counts, activeFilter, onFilterClick }: OrdersMetricsBarProps) {
  return (
    <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
      {METRICS.map((metric) => {
        const Icon = metric.icon;
        const count = counts[metric.key] ?? 0;
        const isActive = activeFilter === metric.key;
        const isRouteGroup = metric.key === "saiu_para_entrega";

        return (
          <button
            key={metric.key}
            onClick={() => onFilterClick(metric.key)}
            className={cn(
              "group flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left shadow-card transition-all duration-200 hover:shadow-panel",
              isActive && "border-primary/50 bg-primary/5 ring-1 ring-primary/20",
            )}
          >
            <div className="flex items-center justify-between">
              <Icon className={cn("h-4 w-4", metric.accentClass)} />
              <span
                className={cn(
                  "text-2xl font-black tabular-nums tracking-tighter",
                  metric.accentClass,
                )}
              >
                {count}
              </span>
            </div>
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {metric.label}
              {isRouteGroup && (
                <span className="ml-1 text-[9px] font-normal normal-case tracking-normal">
                  + retirada
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
