import { useEffect, useState } from "react";
import { useOutletContext, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Phone, MapPin, Clock, RefreshCw, AlertTriangle, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { formatBRL, STATUS_LABELS, buildWhatsAppLink } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSubscriptionStatus } from "@/hooks/use-subscription-status";
import { syncPaymentStatus, refundOrderPayment } from "@/functions/asaas";
import { useServerFn } from "@tanstack/react-start";

const COLUMNS: { key: string; label: string; nextStatus?: string; nextLabel?: string }[] = [
  { key: "aguardando_pagamento", label: "Aguardando PIX" },
  { key: "novo", label: "Novos", nextStatus: "confirmado", nextLabel: "Aceitar" },
  { key: "confirmado", label: "Confirmados", nextStatus: "em_preparo", nextLabel: "Preparar" },
  { key: "em_preparo", label: "Em preparo", nextStatus: "saiu_para_entrega", nextLabel: "Enviar/Pronto" },
  { key: "saiu_para_entrega", label: "Saiu/Pronto", nextStatus: "entregue", nextLabel: "Concluir" },
  { key: "entregue", label: "Entregues" },
];

const Orders = () => {
  const { store } = useOutletContext<{ store: any }>();
  const { accessState, message } = useSubscriptionStatus();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const syncPaymentStatusFn = useServerFn(syncPaymentStatus);
  const refundOrderPaymentFn = useServerFn(refundOrderPayment);

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
    const playNotificationSound = () => {
      try {
        // Um som de notificação mais robusto e "alto"
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const playTone = (freq: number, startTime: number, duration: number) => {
          const osc = audioContext.createOscillator();
          const gain = audioContext.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, startTime);
          gain.gain.setValueAtTime(0.5, startTime);
          gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
          osc.connect(gain);
          gain.connect(audioContext.destination);
          osc.start(startTime);
          osc.stop(startTime + duration);
        };

        // Sequência de "bi-bi" alto
        const now = audioContext.currentTime;
        playTone(880, now, 0.1);
        playTone(880, now + 0.2, 0.1);
        playTone(1108.73, now + 0.4, 0.3);
      } catch (e) {
        console.error("Erro ao tocar som:", e);
      }
    };

    const ch = supabase.channel(`orders-${store.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "orders", filter: `store_id=eq.${store.id}` }, (payload) => {
        if (payload.eventType === "INSERT") {
          if ((payload.new as any).status === "novo") {
            toast.success(`🔔 Novo pedido #${(payload.new as any).order_number}`, { duration: 8000 });
            playNotificationSound();
          }
        } else if (payload.eventType === "UPDATE") {
          if ((payload.old as any).status === "aguardando_pagamento" && (payload.new as any).status === "novo") {
            toast.success(`✅ Pagamento confirmado! Pedido #${(payload.new as any).order_number}`, { duration: 8000 });
            playNotificationSound();
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
    // Validar transição para pronto_para_retirada
    let finalStatus = status;
    const order = orders.find(o => o.id === orderId);
    if (status === "saiu_para_entrega" && order?.delivery_type === "retirada") {
      finalStatus = "pronto_para_retirada";
    }

    const { error } = await supabase.from("orders").update({ status: finalStatus }).eq("id", orderId);
    if (error) return toast.error(error.message);
    
    await supabase.from("order_status_history").insert({ 
      order_id: orderId, 
      store_id: store.id, 
      status: finalStatus, 
      notes: note ?? null 
    } as any);

    if (finalStatus === "entregue") {
      if (order?.customer_id) {
        if (order.status !== "entregue") {
          const { data: customer } = await supabase.from("customers").select("total_orders, total_spent").eq("id", order.customer_id).maybeSingle();
          if (customer) {
            await supabase.from("customers").update({
              total_orders: (customer.total_orders ?? 0) + 1,
              total_spent: Number(customer.total_spent ?? 0) + Number(order.total),
              last_order_at: new Date().toISOString(),
            }).eq("id", order.customer_id);
          }
        }
      }
      await supabase.from("payments").update({ status: "pago", paid_at: new Date().toISOString() }).eq("order_id", orderId);
    }
    
    toast.success("Status atualizado");
    if (selected?.id === orderId) setSelected({ ...selected, status: finalStatus });
    load();
  };

  const cancelOrder = async (orderId: string) => {
    if (!confirm("Cancelar este pedido? Isso irá estornar o PIX automaticamente se já estiver pago.")) return;
    
    const order = orders.find(o => o.id === orderId);
    if (order?.payment_method === "pix") {
      try {
        const refundRes = await refundOrderPaymentFn({ data: { orderId, storeId: store.id } });
        if (refundRes.success) {
          toast.success("Pagamento PIX estornado com sucesso");
        }
      } catch (e: any) {
        console.error("Erro no estorno:", e);
        // We continue with cancellation even if refund fails, but inform the user
        toast.error("Aviso: O estorno automático falhou. Verifique no painel do Asaas.");
      }
    }
    
    await updateStatus(orderId, "cancelado", "Cancelado pela loja");
  };

  if (loading) return <div className="py-20 text-center"><Loader2 className="h-8 w-8 animate-spin inline text-primary" /></div>;

  if (accessState !== "active") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 space-y-4">
        <div className="bg-amber-50 text-amber-600 p-4 rounded-full border-2 border-amber-200">
          <AlertTriangle className="h-12 w-12" />
        </div>
        <div className="max-w-md">
          <h2 className="text-2xl font-black uppercase tracking-tight italic">Acesso Restrito</h2>
          <p className="text-muted-foreground mt-2 font-medium">{message}</p>
        </div>
        <Button variant="hero" className="font-black uppercase tracking-widest text-xs h-12 px-8" asChild>
          <Link to="/lojista/assinatura">
            Regularizar Assinatura <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tight">Gestão de Pedidos</h1>
          <p className="text-muted-foreground font-medium">Acompanhe e processe as vendas do seu delivery.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-none text-[10px] font-black uppercase tracking-widest">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            Em Tempo Real
          </div>
          <Button variant="outline" size="sm" onClick={load} className="rounded-none border-black font-bold uppercase tracking-widest text-[10px]">
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar
          </Button>
        </div>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0">
        {COLUMNS.map((col) => {
          const colOrders = orders.filter((o) => {
            if (col.key === "saiu_para_entrega") {
              return o.status === "saiu_para_entrega" || o.status === "pronto_para_retirada";
            }
            return o.status === col.key;
          });
          
          return (
            <div key={col.key} className="flex-shrink-0 w-80 flex flex-col gap-4">
              <div className="flex items-center justify-between border-b-2 border-black pb-2 px-1">
                <h3 className="font-black text-xs uppercase tracking-widest">{col.label}</h3>
                <span className="bg-black text-white text-[10px] font-black px-2 py-0.5">{colOrders.length}</span>
              </div>
              
              <div className="space-y-3 min-h-[500px] bg-muted/20 p-2 border-x border-b border-dashed border-black/10">
                {colOrders.map((o) => (
                  <Card 
                    key={o.id} 
                    className={cn(
                      "p-4 cursor-pointer hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] transition-all duration-200 border-2 border-black rounded-none bg-white",
                      !o.is_seen && col.key === "novo" ? "ring-2 ring-primary animate-pulse" : ""
                    )} 
                    onClick={() => openDetails(o)}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-black text-xs bg-black text-white px-2 py-0.5 tracking-tighter">#{o.order_number}</span>
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">{new Date(o.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    
                    <div className="font-black uppercase tracking-tight truncate mb-1">{o.customer_name}</div>
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="rounded-none border-black/20 text-[9px] font-black uppercase tracking-widest h-5">
                        {o.delivery_type}
                      </Badge>
                      <div className="font-black text-sm">{formatBRL(o.total)}</div>
                    </div>
                    
                    {col.nextStatus && (
                      <Button 
                        size="sm" 
                        variant="hero" 
                        className="w-full mt-4 text-[10px] h-8 font-black uppercase tracking-widest" 
                        onClick={(e) => { 
                          e.stopPropagation(); 
                          updateStatus(o.id, (o.delivery_type || o.order_type) === "retirada" && col.key === "em_preparo" ? "pronto_para_retirada" : col.nextStatus!); 
                        }}
                      >
                        {col.nextLabel}
                      </Button>
                    )}
                  </Card>
                ))}
                {colOrders.length === 0 && (
                  <div className="h-20 flex items-center justify-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40 border border-dashed border-black/10">
                    Vazio
                  </div>
                )}
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
                <div className="text-xs capitalize"><Clock className="h-3 w-3 inline" /> {selected.delivery_type || selected.order_type}</div>
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
                {(selected.delivery_type || selected.order_type) === "entrega" && <div className="flex justify-between"><span>Entrega</span><span>{formatBRL(selected.delivery_fee)}</span></div>}
                {Number(selected.discount_amount || selected.discount) > 0 && <div className="flex justify-between text-green-600"><span>Desconto {selected.coupon_code && `(${selected.coupon_code})`}</span><span>-{formatBRL(selected.discount_amount || selected.discount)}</span></div>}
                <div className="flex justify-between font-bold text-base pt-1"><span>Total</span><span className="text-primary">{formatBRL(selected.total)}</span></div>
              </div>

              <div className="text-xs">
                <div>Pagamento: <span className="font-medium capitalize">{selected.payment_method.replace("_", " ")}</span></div>
                {selected.change_for && <div>Troco para: {formatBRL(selected.change_for)}</div>}
                {selected.notes && <div className="mt-1 italic">Obs: "{selected.notes}"</div>}
              </div>

              <div className="flex flex-col gap-2 pt-2">
                {selected.status === "aguardando_pagamento" && (
                  <Button 
                    variant="hero" 
                    size="sm" 
                    onClick={async () => {
                      setSyncing(true);
                      try {
                        const res = await syncPaymentStatusFn({ data: { orderId: selected.id, storeId: store.id } });
                        if (res.status === "paid") {
                          toast.success("Pagamento confirmado!");
                          setSelected(null);
                          load();
                        } else {
                          toast.info("Pagamento ainda não identificado.");
                        }
                      } catch (e) {
                        toast.error("Erro ao verificar pagamento");
                      } finally {
                        setSyncing(false);
                      }
                    }} 
                    disabled={syncing}
                  >
                    {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    Verificar Pagamento PIX
                  </Button>
                )}
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
