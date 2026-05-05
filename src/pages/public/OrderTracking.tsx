import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, Phone, Clock, CheckCircle2, Circle, MessageSquare } from "lucide-react";
import { formatBRL, STATUS_LABELS, buildWhatsAppLink } from "@/lib/format";

const STEPS = ["novo", "confirmado", "em_preparo", "saiu_para_entrega", "entregue"] as const;
const STEPS_PICKUP = ["novo", "confirmado", "em_preparo", "pronto_para_retirada", "entregue"] as const;

const OrderTracking = () => {
  const { token } = useParams();
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!token) return;
    const [{ data: o }, { data: it }, { data: h }] = await Promise.all([
      supabase.rpc("get_public_order", { _token: token }),
      supabase.rpc("get_public_order_items", { _token: token }),
      supabase.rpc("get_public_order_status_history", { _token: token }),
    ]);
    setOrder(o?.[0] ?? null);
    setItems(it ?? []);
    setHistory(h ?? []);
    setLoading(false);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const id = setInterval(() => {
      void load();
    }, 15000);
    return () => clearInterval(id);
  }, [load]);

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!order) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Pedido não encontrado</div>;

  const steps = order.order_type === "retirada" ? STEPS_PICKUP : STEPS;
  const currentIdx = steps.indexOf(order.status);
  const cancelled = order.status === "cancelado";

  return (
    <div className="min-h-screen bg-background pb-10">
      <header className="bg-gradient-primary text-primary-foreground p-6 text-center">
        {order.store_logo_url && <img src={order.store_logo_url} alt="" className="w-12 h-12 mx-auto rounded-full mb-2 object-cover bg-white" />}
        <h1 className="font-bold text-lg">{order.store_name}</h1>
        <div className="text-sm opacity-90">Pedido #{order.order_number}</div>
      </header>

      <div className="container max-w-xl mx-auto p-4 space-y-4 -mt-4">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Status do pedido</h2>
            <Badge variant={cancelled ? "destructive" : "default"}>{STATUS_LABELS[order.status] ?? order.status}</Badge>
          </div>
          {order.payment_status && order.payment_status !== "pendente" && (
            <div className="mb-3 text-xs">
              Pagamento:{" "}
              <span
                className={
                  order.payment_status === "pago"
                    ? "text-green-600 font-semibold"
                    : order.payment_status === "processando"
                      ? "text-primary font-semibold"
                      : "text-destructive font-semibold"
                }
              >
                {order.payment_status === "pago"
                  ? "Confirmado"
                  : order.payment_status === "processando"
                    ? "Processando…"
                    : order.payment_status === "expirado"
                      ? "Sessão expirou"
                      : order.payment_status === "reembolsado"
                        ? "Reembolsado"
                        : order.payment_status === "falhou"
                          ? "Falhou"
                          : "Cancelado"}
              </span>
            </div>
          )}
          {cancelled ? (
            <p className="text-sm text-destructive">Este pedido foi cancelado.</p>
          ) : (
            <div className="space-y-3">
              {steps.map((s, i) => {
                const reached = i <= currentIdx;
                const isCurrent = i === currentIdx;
                return (
                  <div key={s} className="flex items-center gap-3">
                    {reached ? <CheckCircle2 className={`h-5 w-5 ${isCurrent ? "text-primary animate-pulse" : "text-green-600"}`} /> : <Circle className="h-5 w-5 text-muted-foreground" />}
                    <span className={`text-sm ${reached ? "font-medium" : "text-muted-foreground"}`}>{STATUS_LABELS[s]}</span>
                  </div>
                );
              })}
            </div>
          )}
          {order.estimated_minutes && !cancelled && order.status !== "entregue" && (
            <div className="mt-4 text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Tempo estimado: ~{order.estimated_minutes} min</div>
          )}
        </Card>

        <Card className="p-5 space-y-2">
          <h3 className="font-semibold text-sm">Resumo</h3>
          <ul className="space-y-2 text-sm">
            {items.map((it) => (
              <li key={it.item_id} className="flex justify-between gap-2">
                <span>{it.quantity}× {it.product_name}{it.notes && <span className="block text-xs text-muted-foreground italic">"{it.notes}"</span>}</span>
                <span>{formatBRL(it.subtotal)}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-border pt-2 mt-2 space-y-1 text-sm">
            <div className="flex justify-between"><span>Subtotal</span><span>{formatBRL(order.subtotal)}</span></div>
            {order.order_type === "entrega" && <div className="flex justify-between"><span>Entrega</span><span>{Number(order.delivery_fee) === 0 ? "Grátis" : formatBRL(order.delivery_fee)}</span></div>}
            {Number(order.discount) > 0 && <div className="flex justify-between text-green-600"><span>Desconto</span><span>-{formatBRL(order.discount)}</span></div>}
            <div className="flex justify-between font-bold text-base pt-1"><span>Total</span><span className="text-primary">{formatBRL(order.total)}</span></div>
          </div>
        </Card>

        {order.order_type === "entrega" && order.delivery_address && (
          <Card className="p-5">
            <h3 className="font-semibold text-sm mb-2 flex items-center gap-1"><MapPin className="h-4 w-4" /> Entrega</h3>
            <p className="text-sm">{order.delivery_address}</p>
            {order.delivery_neighborhood && <p className="text-xs text-muted-foreground">{order.delivery_neighborhood}</p>}
          </Card>
        )}

        {order.store_whatsapp && (
          <Button asChild variant="outline" className="w-full">
            <a href={buildWhatsAppLink(order.store_whatsapp, `Olá! Sobre meu pedido #${order.order_number}`)} target="_blank" rel="noreferrer">
              <MessageSquare className="h-4 w-4" /> Falar com a loja
            </a>
          </Button>
        )}

        {history.length > 0 && (
          <Card className="p-5">
            <h3 className="font-semibold text-sm mb-3">Linha do tempo</h3>
            <ul className="space-y-2 text-xs">
              {history.map((h: any, i: number) => (
                <li key={i} className="flex justify-between">
                  <span>{STATUS_LABELS[h.status] ?? h.status}{h.notes && ` — ${h.notes}`}</span>
                  <span className="text-muted-foreground">{new Date(h.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
};
export default OrderTracking;
