import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, FilterX, Truck, PackageOpen } from "lucide-react";
import { STATUS_LABELS } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface OrdersFilters {
  search: string;
  period: string;
  statuses: string[];
  deliveryType: string;
}

interface OrdersFilterSidebarProps {
  filters: OrdersFilters;
  onChange: (filters: OrdersFilters) => void;
  statusCounts: Record<string, number>;
}

const OPERATIONAL_STATUSES = [
  "aguardando_pagamento",
  "novo",
  "confirmado",
  "em_preparo",
  "saiu_para_entrega",
  "pronto_para_retirada",
  "entregue",
  "cancelado",
];

const STATUS_ICONS: Record<string, string> = {
  novo: "bg-status-blue/50",
  aguardando_pagamento: "bg-status-amber/50",
  confirmado: "bg-primary/50",
  em_preparo: "bg-primary/50",
  saiu_para_entrega: "bg-status-blue/50",
  pronto_para_retirada: "bg-status-emerald/50",
  entregue: "bg-status-emerald/50",
  cancelado: "bg-destructive/50",
};

export function OrdersFilterSidebar({ filters, onChange, statusCounts }: OrdersFilterSidebarProps) {
  const update = (partial: Partial<OrdersFilters>) => onChange({ ...filters, ...partial });

  const toggleStatus = (status: string) => {
    const next = filters.statuses.includes(status)
      ? filters.statuses.filter((s) => s !== status)
      : [...filters.statuses, status];
    update({ statuses: next });
  };

  const clearFilters = () => {
    onChange({ search: "", period: "all", statuses: [], deliveryType: "all" });
  };

  const hasActiveFilters = filters.search || filters.period !== "all" || filters.statuses.length > 0 || filters.deliveryType !== "all";

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-5 rounded-lg border border-border bg-card/60 p-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Buscar pedido..."
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
          className="h-9 pl-8 text-xs"
        />
      </div>

      {/* Period */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Período</span>
        <Select value={filters.period} onValueChange={(v) => update({ period: v })}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os pedidos</SelectItem>
            <SelectItem value="1">Hoje</SelectItem>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Status filter */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Status</span>
        <div className="space-y-0.5">
          {OPERATIONAL_STATUSES.map((status) => {
            const count = statusCounts[status] ?? 0;
            const isChecked = filters.statuses.includes(status);
            return (
              <label
                key={status}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors hover:bg-muted/40",
                  isChecked && "bg-primary/5",
                )}
              >
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => toggleStatus(status)}
                  className="h-3.5 w-3.5"
                />
                <span className={cn("h-2 w-2 rounded-full shrink-0", STATUS_ICONS[status] || "bg-muted-foreground/30")} />
                <span className="flex-1 truncate">{STATUS_LABELS[status] || status}</span>
                {count > 0 && (
                  <span className="text-[10px] font-semibold text-muted-foreground tabular-nums">{count}</span>
                )}
              </label>
            );
          })}
        </div>
      </div>

      {/* Delivery type */}
      <div className="space-y-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Tipo de entrega</span>
        <div className="space-y-0.5">
          <label
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors hover:bg-muted/40",
              filters.deliveryType === "entrega" && "bg-primary/5",
            )}
          >
            <Checkbox
              checked={filters.deliveryType === "entrega"}
              onCheckedChange={() => update({ deliveryType: filters.deliveryType === "entrega" ? "all" : "entrega" })}
              className="h-3.5 w-3.5"
            />
            <Truck className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Entrega</span>
          </label>
          <label
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors hover:bg-muted/40",
              filters.deliveryType === "retirada" && "bg-primary/5",
            )}
          >
            <Checkbox
              checked={filters.deliveryType === "retirada"}
              onCheckedChange={() => update({ deliveryType: filters.deliveryType === "retirada" ? "all" : "retirada" })}
              className="h-3.5 w-3.5"
            />
            <PackageOpen className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Retirada</span>
          </label>
        </div>
      </div>

      {/* Clear */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-full text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
          onClick={clearFilters}
        >
          <FilterX className="mr-1.5 h-3.5 w-3.5" />
          Limpar filtros
        </Button>
      )}
    </aside>
  );
}
