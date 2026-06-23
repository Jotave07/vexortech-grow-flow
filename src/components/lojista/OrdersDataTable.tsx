import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MessageSquare,
  XCircle,
} from "lucide-react";
import { formatBRL, STATUS_LABELS, STATUS_COLORS, PAYMENT_METHOD_LABELS, buildWhatsAppLink } from "@/lib/format";
import { cn } from "@/lib/utils";

interface SortState {
  column: string;
  direction: "asc" | "desc";
}

interface OrdersDataTableProps {
  orders: any[];
  loading: boolean;
  sort: SortState;
  onSort: (column: string) => void;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onOpenDetail: (order: any) => void;
  onAdvance: (orderId: string, status: string) => void;
  onCancel: (orderId: string) => void;
  updatingId: string | null;
  syncing: boolean;
}

const COLUMNS = [
  { key: "order_number", label: "Pedido", sortable: true },
  { key: "customer_name", label: "Cliente", sortable: true },
  { key: "items", label: "Itens", sortable: false },
  { key: "total", label: "Total", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "created_at", label: "Data/Hora", sortable: true },
  { key: "actions", label: "Ações", sortable: false },
];

function getNextAction(order: any) {
  const transitions: Record<string, { status: string; label: string | ((o: any) => string) }> = {
    aguardando_pagamento: { status: "novo", label: "Confirmar PIX" },
    novo: { status: "confirmado", label: "Aceitar" },
    confirmado: { status: "em_preparo", label: "Preparar" },
    em_preparo: { status: "saiu_para_entrega", label: (o) => o.delivery_type === "retirada" ? "Pronto" : "Saiu p/ entrega" },
    saiu_para_entrega: { status: "entregue", label: "Entregue" },
    pronto_para_retirada: { status: "entregue", label: "Retirado" },
  };
  return transitions[order.status] || null;
}

function SortIcon({ column, sort }: { column: string; sort: SortState }) {
  if (sort.column !== column)
    return <ArrowUpDown className="ml-1 inline h-3 w-3 text-muted-foreground/40" />;
  return sort.direction === "asc"
    ? <ArrowUp className="ml-1 inline h-3 w-3 text-primary" />
    : <ArrowDown className="ml-1 inline h-3 w-3 text-primary" />;
}

export function OrdersDataTable({
  orders,
  loading,
  sort,
  onSort,
  page,
  pageSize,
  onPageChange,
  onOpenDetail,
  onAdvance,
  onCancel,
  updatingId,
  syncing,
}: OrdersDataTableProps) {
  const totalPages = Math.max(1, Math.ceil(orders.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const visible = orders.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="flex flex-1 flex-col rounded-lg border border-border bg-card shadow-card">
      <div className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              {COLUMNS.map((col) => (
                <TableHead
                  key={col.key}
                  className={cn(
                    "text-[10px] font-bold uppercase tracking-widest",
                    col.sortable && "cursor-pointer select-none hover:text-foreground",
                    col.key === "actions" && "text-right",
                  )}
                  onClick={() => col.sortable && onSort(col.key)}
                >
                  {col.label}
                  {col.sortable && <SortIcon column={col.key} sort={sort} />}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} className="h-32 text-center">
                  <Loader2 className="inline h-6 w-6 animate-spin text-primary" />
                </TableCell>
              </TableRow>
            ) : visible.length === 0 ? (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} className="h-32 text-center text-sm text-muted-foreground">
                  Nenhum pedido encontrado
                </TableCell>
              </TableRow>
            ) : (
              visible.map((order) => {
                const action = getNextAction(order);
                const itemCount = order.order_items?.length ?? order.meta?.item_count;
                const itemsLabel = itemCount != null ? `${itemCount} ite${itemCount === 1 ? "m" : "ns"}` : "-";
                const paymentLabel = PAYMENT_METHOD_LABELS[order.payment_method] || order.payment_method || "-";

                return (
                  <TableRow
                    key={order.id}
                    className="cursor-pointer border-border transition-colors hover:bg-muted/30"
                    onClick={() => onOpenDetail(order)}
                  >
                    <TableCell className="font-bold tabular-nums">#{order.order_number}</TableCell>
                    <TableCell>
                      <div className="font-semibold">{order.customer_name}</div>
                      <div className="text-[10px] text-muted-foreground">{paymentLabel}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{itemsLabel}</TableCell>
                    <TableCell className="font-bold tabular-nums">{formatBRL(order.total)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn("text-[10px] font-semibold uppercase", STATUS_COLORS[order.status] || "")}
                      >
                        {STATUS_LABELS[order.status] || order.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(order.created_at).toLocaleString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        {action && action.label !== "Confirmar PIX" && (
                          <Button
                            size="sm"
                            variant="hero"
                            className="h-7 text-[10px]"
                            onClick={() => onAdvance(order.id, action.status)}
                            disabled={updatingId === order.id || syncing}
                          >
                            {updatingId === order.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              typeof action.label === "function" ? action.label(order) : action.label
                            )}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px]"
                          asChild
                        >
                          <a
                            href={buildWhatsAppLink(
                              order.customer_phone,
                              `Olá ${order.customer_name}, sobre seu pedido #${order.order_number}`,
                            )}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <MessageSquare className="h-3 w-3" />
                          </a>
                        </Button>
                        {!["entregue", "cancelado"].includes(order.status) && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 text-[10px]"
                            onClick={() => onCancel(order.id)}
                          >
                            <XCircle className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-4 py-2">
          <span className="text-[10px] font-medium text-muted-foreground">
            {orders.length} pedido{orders.length !== 1 ? "s" : ""} &middot; Página {safePage} de {totalPages}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 rounded-md p-0"
              disabled={safePage <= 1}
              onClick={() => onPageChange(safePage - 1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 rounded-md p-0"
              disabled={safePage >= totalPages}
              onClick={() => onPageChange(safePage + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
