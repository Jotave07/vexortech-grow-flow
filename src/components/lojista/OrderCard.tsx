import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, Loader2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL, STATUS_LABELS, PAYMENT_METHOD_LABELS, formatDeliveryAddressLines, buildWhatsAppLink } from "@/lib/format";

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pago: "Pago",
  pendente: "Pendente",
  cancelado: "Cancelado",
  estornado: "Estornado",
};

const PAYMENT_STATUS_CLASSES: Record<string, string> = {
  pago: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pendente: "border-amber-200 bg-amber-50 text-amber-700",
  cancelado: "border-red-200 bg-red-50 text-red-700",
  estornado: "border-slate-200 bg-slate-50 text-slate-700",
};

const orderAgeInMinutes = (order: any) =>
  Math.max(0, Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000));

const formatOrderAge = (order: any) => {
  const minutes = orderAgeInMinutes(order);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${rest ? ` ${rest}m` : ""}`;
};

const getAgeUrgency = (order: any): "normal" | "amber" | "red" => {
  const minutes = orderAgeInMinutes(order);
  if (minutes >= 25) return "red";
  if (minutes >= 15) return "amber";
  return "normal";
};

const URGENCY_BORDER: Record<string, string> = {
  normal: "border-l-transparent",
  amber: "border-l-amber-400",
  red: "border-l-red-500",
};

const URGENCY_TIMER: Record<string, string> = {
  normal: "text-muted-foreground",
  amber: "text-amber-600 font-bold",
  red: "text-red-600 font-bold animate-pulse",
};

export interface OrderCardProps {
  order: any;
  action?: { status: string; label: string } | null;
  updatingId: string | null;
  syncing: boolean;
  onOpenDetail: (order: any) => void;
  onAdvance: (orderId: string, status: string) => void;
  onApprovePix: (order: any) => void;
}

export const OrderCard = ({
  order,
  action,
  updatingId,
  syncing,
  onOpenDetail,
  onAdvance,
  onApprovePix,
}: OrderCardProps) => {
  const urgency = getAgeUrgency(order);
  const paymentStatus = order.payment_status || "pendente";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.18 } }}
    >
      <Card
        className={cn(
          "group relative cursor-pointer overflow-hidden rounded-md border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-panel border-l-[3px]",
          URGENCY_BORDER[urgency],
          !order.is_seen && order.status === "novo" ? "ring-2 ring-primary ring-offset-1" : "",
        )}
        onClick={() => onOpenDetail(order)}
      >
        {!order.is_seen && order.status === "novo" && (
          <Badge className="absolute right-2 top-2 bg-primary px-2 text-[9px] font-bold">Novo</Badge>
        )}

        {/* Header: Order number + age */}
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="rounded bg-foreground px-2 py-0.5 text-xs font-bold tracking-tight text-background">
            #{order.order_number}
          </span>
          <span className={cn("text-[10px] font-medium", URGENCY_TIMER[urgency])}>
            {formatOrderAge(order)}
          </span>
        </div>

        {/* Customer info */}
        <div className="mb-3 space-y-1">
          <div className="truncate text-sm font-semibold">{order.customer_name}</div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {new Date(order.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>

        {/* Badges */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Badge variant="status" className="text-[9px]">
            {order.delivery_type === "retirada" ? "Retirada" : "Entrega"}
          </Badge>
          <Badge variant="outline" className={cn("text-[9px]", PAYMENT_STATUS_CLASSES[paymentStatus] || PAYMENT_STATUS_CLASSES.pendente)}>
            {PAYMENT_STATUS_LABELS[paymentStatus] || paymentStatus}
          </Badge>
          <Badge variant="status" className="text-[9px]">
            {PAYMENT_METHOD_LABELS[order.payment_method] || order.payment_method}
          </Badge>
        </div>

        {/* Address (delivery only) */}
        {order.delivery_type === "entrega" && (
          <div className="mb-3 flex gap-2 rounded border border-border bg-muted/30 p-2 text-[10px] leading-snug text-muted-foreground">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
            <div className="min-w-0">
              {formatDeliveryAddressLines(order).map((line: string) => (
                <div key={line} className="break-words">{line}</div>
              ))}
            </div>
          </div>
        )}

        {/* Bottom: Total + ETA + Action */}
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-medium uppercase text-muted-foreground">Total</div>
            <div className="text-lg font-bold">{formatBRL(order.total)}</div>
          </div>
          {order.estimated_min && (
            <div className="rounded bg-blue-50 px-2 py-1 text-right text-[10px] font-semibold text-blue-700">
              {order.estimated_min}-{order.estimated_max} min
            </div>
          )}
        </div>

        {/* Action buttons */}
        {action && (
          <Button
            size="sm"
            variant="hero"
            className="mt-4 h-9 w-full text-[11px] font-bold uppercase tracking-wide"
            disabled={updatingId === order.id}
            onClick={(e) => {
              e.stopPropagation();
              onAdvance(order.id, action.status);
            }}
          >
            {updatingId === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : action.label}
          </Button>
        )}
        {order.status === "aguardando_pagamento" && order.payment_method === "pix" && (
          <Button
            size="sm"
            variant="hero"
            className="mt-4 h-9 w-full text-[11px] font-bold uppercase tracking-wide"
            disabled={updatingId === order.id || syncing}
            onClick={(e) => {
              e.stopPropagation();
              onApprovePix(order);
            }}
          >
            {updatingId === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirmar Pix"}
          </Button>
        )}
      </Card>
    </motion.div>
  );
};
