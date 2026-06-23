import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Flame, Package, ChefHat, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { calculateKitchenQueue, type KitchenOrder, type BatchGroup } from "@/services/kitchen/kitchenQueueService";
import { printOrderTicket } from "@/lib/order-print";

const URGENCY_META: Record<KitchenOrder["urgency"], { label: string; bg: string; border: string; text: string }> = {
  low: { label: "Em fila", bg: "bg-slate-50", border: "border-slate-200", text: "text-slate-600" },
  medium: { label: "Atenção", bg: "bg-amber-50", border: "border-amber-300", text: "text-amber-700" },
  high: { label: "Urgente", bg: "bg-orange-50", border: "border-orange-400", text: "text-orange-700" },
  critical: { label: "Crítico", bg: "bg-red-50", border: "border-red-400", text: "text-red-700" },
};

const STATUS_LABEL: Record<string, string> = {
  em_preparo: "Preparando",
  confirmado: "Confirmado",
  novo: "Novo",
};

interface KitchenViewProps {
  orders: any[];
  itemsMap: Map<string, any[]>;
  storeName?: string;
}

export const KitchenView = ({ orders, itemsMap: rawItemsMap, storeName }: KitchenViewProps) => {
  const { queue, batches } = useMemo(() => {
    const cookingOrders = orders.filter((o) =>
      ["em_preparo", "confirmado", "novo"].includes(o.status),
    );

    const itemsByOrder = new Map<string, any[]>();
    for (const order of cookingOrders) {
      const items = rawItemsMap.get(order.id) || [];
      itemsByOrder.set(order.id, items.map((item: any) => ({
        product_name: item.product_name,
        quantity: item.quantity,
        notes: item.notes,
        order_item_options: item.order_item_options || [],
      })));
    }

    return calculateKitchenQueue(cookingOrders, itemsByOrder);
  }, [orders, rawItemsMap]);

  if (queue.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-border">
        <div className="text-center text-sm text-muted-foreground">
          <ChefHat className="mx-auto mb-2 h-10 w-10" />
          <p className="font-medium">Fila de cozinha vazia</p>
          <p className="text-xs">Novos pedidos aparecerão aqui automaticamente.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Batching suggestions */}
      {batches.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800">
            <Package className="h-4 w-4" />
            Preparo em lote sugerido
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {batches.map((batch) => (
              <div key={batch.product_name} className="rounded-md border border-amber-300 bg-card p-2 text-xs">
                <span className="font-bold text-amber-800">{batch.total_quantity}x</span>{" "}
                <span className="font-medium">{batch.product_name}</span>
                <div className="mt-1 text-amber-600">
                  Pedidos: {batch.orderNumbers.map((n) => `#${n}`).join(", ")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Queue */}
      <div className="grid gap-3">
        {queue.map((order, index) => {
          const meta = URGENCY_META[order.urgency];
          const isNext = index === 0 && order.status === "em_preparo";

          return (
            <Card
              key={order.id}
              className={cn(
                "border-l-[4px] p-4 transition-all duration-200",
                meta.border,
                meta.bg,
                isNext && "ring-2 ring-primary ring-offset-1",
              )}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  {/* Header */}
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-lg font-bold">#{order.order_number}</span>
                    <Badge className={cn("text-[10px]", meta.text, meta.bg, "border", meta.border)}>
                      {meta.label}
                    </Badge>
                    <Badge variant="status" className="text-[10px]">
                      {STATUS_LABEL[order.status] || order.status}
                    </Badge>
                    {isNext && (
                      <Badge className="bg-primary text-primary-foreground text-[10px]">
                        <Flame className="mr-1 h-3 w-3" /> Próximo
                      </Badge>
                    )}
                  </div>

                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="mb-3 h-9 rounded-lg bg-slate-800 text-white hover:bg-slate-700 px-4 text-[11px] font-bold uppercase tracking-widest shadow-sm"
                      onClick={() => printOrderTicket({ order: { ...order, store_name: storeName || (order as any).store_name }, items: order.items, title: "Cozinha" })}
                    >
                      <Printer className="mr-1.5 h-4 w-4" /> Imprimir
                    </Button>
                  {/* Customer + Time */}
                  <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
                    <span className="font-medium">{order.customer_name}</span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" /> {order.age_minutes} min
                    </span>
                    {order.estimated_min && (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-semibold text-blue-700">
                        {order.estimated_min}-{order.estimated_max} min
                      </span>
                    )}
                  </div>

                  {/* Items */}
                  <div className="space-y-2">
                    {order.items.map((item, i) => (
                      <div key={i} className="rounded-md border border-border/70 bg-card p-3 text-sm">
                        <span className="font-semibold">{item.quantity}x</span>{" "}
                        {item.product_name}
                        {item.notes && (
                          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-bold uppercase text-amber-800">
                            — {item.notes}
                          </div>
                        )}
                        {item.order_item_options?.length > 0 && (
                          <ul className="mt-2 space-y-1 text-xs font-medium text-muted-foreground">
                            {item.order_item_options.map((opt: any) => (
                              <li key={opt.id}>
                                + {opt.option_name ? `${opt.option_name}: ` : ""}{opt.item_name}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
