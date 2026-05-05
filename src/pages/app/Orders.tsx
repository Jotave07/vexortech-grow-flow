import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Phone, MapPin, Clock, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { formatBRL, STATUS_LABELS, buildWhatsAppLink } from "@/lib/format";

const COLUMNS: { key: string; label: string; nextStatus?: string; nextLabel?: string }[] = [
  { key: "novo", label: "Novos", nextStatus: "confirmado", nextLabel: "Confirmar" },
  { key: "confirmado", label: "Confirmados", nextStatus: "em_preparo", nextLabel: "Iniciar preparo" },
  { key: "em_preparo", label: "Em preparo", nextStatus: "saiu_para_entrega", nextLabel: "Saiu/Pronto" },
  { key: "saiu_para_entrega", label: "Em entrega/Retirada", nextStatus: "entregue", nextLabel: "Concluir" },
  { key: "entregue", label: "Entregues" },
];

const Orders = () => {
  const { store } = useOutletContext<{ store: any }>();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);

  const load = async () => {
    const { data } = await supabase.from("orders").select("*").eq("store_id", store.id)
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false }).limit(200);
    setOrders(data ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (!store?.id) return;
    load();
    const ch = supabase.channel(`orders-${store.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `store_id=eq.${store.id}` }, (payload) => {
        if (payload.eventType === "INSERT") {
          toast.success(`🔔 Novo pedido #${(payload.new as any).order_number}`, { duration: 6000 });
          try {
            new Audio("data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQ==").play().catch(() => undefined);
          } catch {
            // Audio feedback is optional and can be blocked by the browser.
          }
        }
        load();
      }).subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [store?.id]);

  const openDetails = async (o: any) => {
    setSelected(o);
    const { data } = await supabase.from("order_items").select("*, order_item_options(*)").eq("order_id", o.id);
    setItems(data ?? []);
    if (!o.is_seen) await supabase.from("orders").update({ is_seen: true }).eq("id", o.id);
  };

  const updateStatus = async (orderId: string, status: any, note?: string) => {
    const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);
    if (error) return toast.error(error.message);
    await supabase.from("order_status_history").insert({ order_id: orderId, store_id: store.id, status, notes: note ?? null } as any);
    if (status === "entregue") {
      const order = orders.find((x) => x.id === orderId);
      if (order?.customer_id) {
        const { data: customer } = await supabase.from("customers").select("total_orders, total_spent").eq("id", order.customer_id).maybeSingle();
        if (customer) {
          await supabase.from("customers").update({
            total_orders: (customer.total_orders ?? 0) + 1,
            total_spent: Number(customer.total_spent ?? 0) + Number(order.total),
            last_order_at: new Date().toISOString(),
          }).eq("id", order.customer_id);
        }
      }
      await supabase.from("payments").update({ status: "pago", paid_at: new Date().toISOString() }).eq("order_id", orderId);
    }
    toast.success("Status atualizado");
    if (selected?.id === orderId) setSelected({ ...selected, status });
  };

  const cancelOrder = async (orderId: string) => {
    if (!confirm("Cancelar este pedido?")) return;
    await updateStatus(orderId, "cancelado", "Cancelado pela loja");
  };

  if (loading) return <div className="py-20 text-center"><Loader2 className="h-8 w-8 animate-spin inline text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Pedidos</h1>
          <p className="text-muted-foreground">Atualiza em tempo real.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /> Atualizar</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {COLUMNS.map((col) => {
          const colOrders = orders.filter((o) => col.key === "saiu_para_entrega"
            ? (o.status === "saiu_para_entrega" || o.status === "pronto_para_retirada")
            : o.status === col.key);
          return (
            <div key={col.key} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h3 className="font-semibold text-sm">{col.label}</h3>
                <Badge variant="secondary">{colOrders.length}</Badge>
              </div>
              <div className="space-y-2 min-h-[200px]">
                {colOrders.map((o) => (
                  <Card key={o.id} className={`p-3 cursor-pointer hover:border-primary/50 ${!o.is_seen && col.key === "novo" ? "border-primary animate-pulse" : ""}`} onClick={() => openDetails(o)}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm">#{o.order_number}</span>
                      <span className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="text-sm truncate">{o.customer_name}</div>
                    <div className="text-xs text-muted-foreground capitalize">{o.order_type}</div>
                    <div className="text-sm font-semibold text-primary mt-1">{formatBRL(o.total)}</div>
                    {col.nextStatus && (
                      <Button size="sm" variant="outline" className="w-full mt-2 text-xs h-7" onClick={(e) => { e.stopPropagation(); updateStatus(o.id, o.order_type === "retirada" && col.key === "em_preparo" ? "pronto_para_retirada" : col.nextStatus!); }}>
                        {col.nextLabel}
                      </Button>
                    )}
                  </Card>
                ))}
                {colOrders.length === 0 && <div className="text-xs text-center text-muted-foreground py-6">—</div>}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Pedido #{selected?.order_number}</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-4 text-sm">
              <Badge>{STATUS_LABELS[selected.status] ?? selected.status}</Badge>

              <div className="space-y-1">
                <div className="font-medium">{selected.customer_name}</div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" /> {selected.customer_phone}</div>
                {selected.delivery_address && <div className="flex items-start gap-1 text-xs text-muted-foreground"><MapPin className="h-3 w-3 mt-0.5" /> <span>{selected.delivery_address}{selected.delivery_neighborhood && ` — ${selected.delivery_neighborhood}`}{selected.delivery_reference && ` (Ref: ${selected.delivery_reference})`}</span></div>}
                <div className="text-xs capitalize"><Clock className="h-3 w-3 inline" /> {selected.order_type}</div>
              </div>

              <div className="border-t border-border pt-3 space-y-2">
                {items.map((it: any) => (
                  <div key={it.id}>
                    <div className="flex justify-between font-medium">
                      <span>{it.quantity}× {it.product_name}</span>
                      <span>{formatBRL(it.subtotal)}</span>
                    </div>
                    {it.order_item_options?.length > 0 && (
                      <ul className="text-xs text-muted-foreground pl-4">
                        {it.order_item_options.map((op: any) => <li key={op.id}>+ {op.item_name}{Number(op.extra_price) > 0 && ` (${formatBRL(op.extra_price)})`}</li>)}
                      </ul>
                    )}
                    {it.notes && <div className="text-xs italic text-muted-foreground pl-4">"{it.notes}"</div>}
                  </div>
                ))}
              </div>

              <div className="border-t border-border pt-3 space-y-1">
                <div className="flex justify-between"><span>Subtotal</span><span>{formatBRL(selected.subtotal)}</span></div>
                {selected.order_type === "entrega" && <div className="flex justify-between"><span>Entrega</span><span>{formatBRL(selected.delivery_fee)}</span></div>}
                {Number(selected.discount) > 0 && <div className="flex justify-between text-green-600"><span>Desconto {selected.coupon_code && `(${selected.coupon_code})`}</span><span>-{formatBRL(selected.discount)}</span></div>}
                <div className="flex justify-between font-bold text-base pt-1"><span>Total</span><span className="text-primary">{formatBRL(selected.total)}</span></div>
              </div>

              <div className="text-xs">
                <div>Pagamento: <span className="font-medium capitalize">{selected.payment_method.replace("_", " ")}</span></div>
                {selected.change_for && <div>Troco para: {formatBRL(selected.change_for)}</div>}
                {selected.notes && <div className="mt-1 italic">Obs: "{selected.notes}"</div>}
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <Button asChild variant="outline" size="sm">
                  <a href={buildWhatsAppLink(selected.customer_phone, `Olá ${selected.customer_name}, sobre seu pedido #${selected.order_number}`)} target="_blank" rel="noreferrer">Chamar no WhatsApp</a>
                </Button>
                {selected.status !== "entregue" && selected.status !== "cancelado" && (
                  <Button variant="destructive" size="sm" onClick={() => cancelOrder(selected.id)}>Cancelar pedido</Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Orders;
