import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, Clock, CheckCircle2, Circle, MessageSquare, Copy, QrCode } from "lucide-react";
import { formatBRL, STATUS_LABELS, buildWhatsAppLink } from "@/lib/format";
import { useServerFn } from "@tanstack/react-start";
import { getOrderPaymentInfo } from "@/server/asaas.functions";
import { toast } from "sonner";

const STEPS = ["novo", "confirmado", "em_preparo", "saiu_para_entrega", "entregue"] as const;
const STEPS_PICKUP = ["novo", "confirmado", "em_preparo", "pronto_para_retirada", "entregue"] as const;

const OrderTracking = () => {
  const { token } = useParams();
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pixInfo, setPixInfo] = useState<any>(null);
  const getOrderPaymentInfoFn = useServerFn(getOrderPaymentInfo);

  const load = useCallback(async () => {
    if (!token) return;
    const [{ data: o }, { data: it }, { data: h }] = await Promise.all([
      supabase.rpc("get_public_order", { _token: token }),
      supabase.rpc("get_public_order_items", { _token: token }),
      supabase.rpc("get_public_order_status_history", { _token: token }),
    ]);
    const orderData = o?.[0] ?? null;
    setOrder(orderData);
    setItems(it ?? []);
    setHistory(h ?? []);
    
    if (orderData && orderData.payment_method === "pix" && !pixInfo) {
      try {
        const info = await getOrderPaymentInfoFn({ data: { orderId: orderData.id, storeId: orderData.store_id } });
        setPixInfo(info);
      } catch (e) {
        console.error("Error loading PIX:", e);
      }
    }
    
    setLoading(false);
  }, [token, pixInfo, getOrderPaymentInfoFn]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyPix = () => {
    if (pixInfo?.pixCode) {
      navigator.clipboard.writeText(pixInfo.pixCode);
      toast.success("Código PIX copiado!");
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!order) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Pedido não encontrado</div>;

  const steps = order.order_type === "retirada" ? STEPS_PICKUP : STEPS;
  const currentIdx = steps.indexOf(order.status);
  const cancelled = order.status === "cancelado";

  return (
    <div className="min-h-screen bg-background pb-10">
      <header className="bg-primary text-primary-foreground p-8 text-center border-b-4 border-black">
        {order.store_logo_url && <img src={order.store_logo_url} alt="" className="w-16 h-16 mx-auto rounded-none mb-3 object-cover bg-white border-2 border-black" />}
        <h1 className="font-black text-xl uppercase tracking-tighter">{order.store_name}</h1>
        <div className="text-xs font-bold opacity-80 uppercase tracking-widest">Pedido #{order.order_number}</div>
      </header>

      <div className="container max-w-xl mx-auto p-4 space-y-4 -mt-6">
        {order.payment_method === "pix" && order.status === "novo" && pixInfo && (
          <Card className="p-6 border-4 border-primary bg-primary/5 text-center space-y-4">
            <div className="flex flex-col items-center gap-2">
              <QrCode className="h-12 w-12 text-primary" />
              <h2 className="font-black uppercase tracking-tight text-lg">Pague com PIX</h2>
              <p className="text-xs text-muted-foreground">Escaneie o código abaixo ou copie a chave</p>
            </div>
            
            {pixInfo.qrCodeUrl && (
              <div className="bg-white p-2 inline-block border-2 border-black">
                <img src={`data:image/png;base64,${pixInfo.qrCodeUrl}`} alt="QR Code PIX" className="w-48 h-48" />
              </div>
            )}

            <Button onClick={copyPix} variant="outline" className="w-full h-12 font-bold border-2 border-black uppercase">
              <Copy className="h-4 w-4 mr-2" /> Copiar Código PIX
            </Button>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">Aguardando confirmação automática</p>
          </Card>
        )}

        <Card className="p-6 border-2 border-black rounded-none">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-black uppercase tracking-tighter italic">Status do pedido</h2>
            <Badge className="rounded-none border-2 border-black text-xs font-black uppercase px-3 py-1" variant={cancelled ? "destructive" : "default"}>
              {STATUS_LABELS[order.status] ?? order.status}
            </Badge>
          </div>
          
          <div className="space-y-4">
            {steps.map((s, i) => {
              const reached = i <= currentIdx;
              const isCurrent = i === currentIdx;
              return (
                <div key={s} className="flex items-center gap-4">
                  <div className={`w-8 h-8 flex items-center justify-center border-2 border-black ${reached ? "bg-primary text-white" : "bg-muted text-muted-foreground"}`}>
                    {reached ? <CheckCircle2 className="h-5 w-5" /> : <div className="h-2 w-2 bg-current rounded-full" />}
                  </div>
                  <span className={`text-sm uppercase font-black tracking-tight ${reached ? "text-foreground" : "text-muted-foreground"}`}>
                    {STATUS_LABELS[s]}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-6 border-2 border-black rounded-none space-y-4">
          <h3 className="font-black uppercase tracking-tighter italic text-sm">Resumo da Compra</h3>
          <ul className="space-y-3">
            {items.map((it) => (
              <li key={it.item_id} className="flex justify-between gap-4 border-b border-dashed border-border pb-2">
                <div className="flex-1">
                  <div className="font-bold text-sm uppercase tracking-tight">{it.quantity}× {it.product_name}</div>
                  {it.notes && <div className="text-[10px] text-muted-foreground italic font-medium leading-tight mt-1">"{it.notes}"</div>}
                </div>
                <div className="font-black text-sm">{formatBRL(it.subtotal)}</div>
              </li>
            ))}
          </ul>
          <div className="pt-2 space-y-1">
            <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground"><span>Subtotal</span><span>{formatBRL(order.subtotal)}</span></div>
            {order.order_type === "entrega" && <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground"><span>Entrega</span><span>{Number(order.delivery_fee) === 0 ? "Grátis" : formatBRL(order.delivery_fee)}</span></div>}
            <div className="flex justify-between font-black text-xl border-t-2 border-black pt-3 mt-3 uppercase tracking-tighter"><span>Total</span><span className="text-primary">{formatBRL(order.total)}</span></div>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-3">
          {order.store_whatsapp && (
            <Button asChild className="w-full h-14 rounded-none border-2 border-black font-black uppercase tracking-tight bg-[#25D366] hover:bg-[#128C7E] text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              <a href={buildWhatsAppLink(order.store_whatsapp, `Olá! Gostaria de saber sobre meu pedido #${order.order_number}`)} target="_blank" rel="noreferrer">
                <MessageSquare className="h-5 w-5 mr-2" /> Chamar no WhatsApp
              </a>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrderTracking;
