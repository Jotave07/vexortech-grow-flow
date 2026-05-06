import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, MapPin, Clock, CheckCircle2, Circle, MessageSquare, Copy, QrCode } from "lucide-react";
import { formatBRL, STATUS_LABELS, buildWhatsAppLink } from "@/lib/format";
import { useServerFn } from "@tanstack/react-start";
import { getOrderPaymentInfo, syncPaymentStatus } from "@/functions/asaas";
import { toast } from "sonner";

const STEPS = ["aguardando_pagamento", "novo", "confirmado", "em_preparo", "saiu_para_entrega", "entregue"] as const;
const STEPS_PICKUP = ["aguardando_pagamento", "novo", "confirmado", "em_preparo", "pronto_para_retirada", "entregue"] as const;

const OrderTracking = () => {
  const { token } = useParams();
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pixInfo, setPixInfo] = useState<any>(null);
  const getOrderPaymentInfoFn = useServerFn(getOrderPaymentInfo);
  const syncPaymentStatusFn = useServerFn(syncPaymentStatus);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const [{ data: o, error: oErr }, { data: it, error: itErr }, { data: h, error: hErr }] = await Promise.all([
        supabase.rpc("get_public_order", { _token: token }),
        supabase.rpc("get_public_order_items", { _token: token }),
        supabase.rpc("get_public_order_status_history", { _token: token }),
      ]);

      if (oErr) throw oErr;
      if (itErr) throw itErr;
      if (hErr) throw hErr;

      const orderData = o?.[0] ?? null;
      setOrder(orderData);
      setItems(it ?? []);
      setHistory(h ?? []);
      
      if (orderData && orderData.payment_method === "pix" && orderData.status === "aguardando_pagamento") {
        try {
          const info = await getOrderPaymentInfoFn({ data: { orderId: orderData.id, storeId: orderData.store_id } });
          setPixInfo(info);
        } catch (e) {
          console.error("Error loading PIX info:", e);
        }
      }
    } catch (e) {
      console.error("Error loading order:", e);
      toast.error("Erro ao carregar dados do pedido");
    } finally {
      setLoading(false);
    }
  }, [token, getOrderPaymentInfoFn]);

  useEffect(() => {
    void load();
    const interval = setInterval(load, 15000); // Poll every 15s for status updates
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (order?.status !== "aguardando_pagamento") return;
    
    const interval = setInterval(async () => {
      try {
        const result = await syncPaymentStatusFn({ data: { orderId: order.id, storeId: order.store_id } });
        if (result.status === "paid") {
          toast.success("Pagamento confirmado!");
          void load();
        }
      } catch (e) {
        console.error("Sync error:", e);
      }
    }, 5000); // Check payment every 5s
    
    return () => clearInterval(interval);
  }, [order?.status, order?.id, order?.store_id, syncPaymentStatusFn, load]);

  const copyPix = () => {
    if (pixInfo?.pixCode) {
      navigator.clipboard.writeText(pixInfo.pixCode);
      toast.success("Código PIX copiado!");
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!order) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center space-y-4">
        <div className="h-20 w-20 bg-muted rounded-full flex items-center justify-center text-muted-foreground mb-4">
          <Circle className="h-10 w-10 opacity-20" />
        </div>
        <h1 className="font-black text-2xl uppercase tracking-tighter italic">Pedido não encontrado</h1>
        <p className="text-muted-foreground max-w-xs text-sm">
          Não conseguimos localizar as informações deste pedido. Verifique o link ou entre em contato com a loja.
        </p>
        <Button variant="outline" onClick={() => window.location.reload()} className="border-2 border-black rounded-none font-bold uppercase">
          Tentar Novamente
        </Button>
      </div>
    );
  }

  const steps = order.delivery_type === "retirada" ? STEPS_PICKUP : STEPS;
  const currentIdx = steps.indexOf(order.status);
  const cancelled = order.status === "cancelado";

  return (
    <div className="min-h-screen bg-background pb-10">
      <header className="bg-primary text-primary-foreground p-8 text-center border-b-4 border-black">
        {order.store_logo_url && <img src={order.store_logo_url} alt="" className="w-16 h-16 mx-auto rounded-none mb-3 object-contain bg-white border-2 border-black" />}
        <h1 className="font-black text-xl uppercase tracking-tighter">{order.store_name}</h1>
        <div className="text-xs font-bold opacity-80 uppercase tracking-widest">Pedido #{order.order_number}</div>
      </header>

      <div className="container max-w-xl mx-auto p-4 space-y-4 -mt-6">
        {order.payment_method === "pix" && order.status === "aguardando_pagamento" && pixInfo && (
          <Card className="p-6 border-4 border-emerald-500 bg-emerald-50/30 text-center space-y-6 rounded-none shadow-[8px_8px_0px_0px_rgba(16,185,129,1)]">
            <div className="flex flex-col items-center gap-2">
              <div className="h-14 w-14 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600 mb-2">
                <QrCode className="h-8 w-8" />
              </div>
              <h2 className="font-black uppercase tracking-tight text-xl italic text-emerald-900">Pague com PIX</h2>
              <p className="text-[10px] text-emerald-700 font-bold uppercase tracking-widest">Aguardando confirmação automática</p>
            </div>
            
            {pixInfo.qrCodeUrl && (
              <div className="bg-white p-4 inline-block border-4 border-emerald-100 rounded-2xl shadow-xl">
                <img 
                  src={pixInfo.qrCodeUrl.startsWith('data:') ? pixInfo.qrCodeUrl : `data:image/png;base64,${pixInfo.qrCodeUrl}`} 
                  alt="QR Code PIX" 
                  className="w-48 h-48" 
                />
              </div>
            )}

            <div className="space-y-3 w-full">
              <div className="bg-white border-2 border-emerald-100 p-3 rounded-xl font-mono text-[10px] break-all text-center select-all opacity-70">
                {pixInfo.pixCode}
              </div>
              <Button onClick={copyPix} variant="default" className="w-full h-14 font-black bg-emerald-600 hover:bg-emerald-700 text-white uppercase tracking-tighter text-lg rounded-none border-2 border-black shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-1 active:translate-y-1 active:shadow-none transition-all">
                <Copy className="h-5 w-5 mr-2" /> Copiar Código PIX
              </Button>
            </div>
            
            <div className="p-3 bg-white border-2 border-dashed border-emerald-200 rounded-xl text-[10px] text-emerald-800 font-bold uppercase leading-tight">
              O seu pedido será confirmado em instantes após o pagamento
            </div>
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
            {items.map((it) => {
              const itemOptionsSum = it.options?.reduce((acc: number, opt: any) => acc + Number(opt.extra_price || 0), 0) || 0;
              const itemTotal = (Number(it.unit_price) + itemOptionsSum) * it.quantity;
              
              return (
                <li key={it.id} className="flex flex-col gap-1 border-b border-dashed border-border pb-2">
                  <div className="flex justify-between gap-4">
                    <div className="flex-1">
                      <div className="font-bold text-sm uppercase tracking-tight">{it.quantity}× {it.product_name}</div>
                      {it.notes && <div className="text-[10px] text-muted-foreground italic font-medium leading-tight mt-1">"{it.notes}"</div>}
                    </div>
                    <div className="font-black text-sm">{formatBRL(itemTotal)}</div>
                  </div>
                  {it.options && it.options.length > 0 && (
                    <ul className="text-[10px] text-muted-foreground uppercase font-medium">
                      {it.options.map((opt: any, idx: number) => (
                        <li key={idx}>+ {opt.name} {Number(opt.extra_price) > 0 && `(${formatBRL(opt.extra_price)})`}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="pt-2 space-y-1">
            <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <span>Subtotal</span>
              <span>{formatBRL(order.subtotal || 0)}</span>
            </div>
            {order.delivery_type === "entrega" && (
              <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <span>Entrega</span>
                <span>{Number(order.delivery_fee || 0) === 0 ? "Grátis" : formatBRL(order.delivery_fee)}</span>
              </div>
            )}
            {Number(order.discount_amount) > 0 && (
              <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-emerald-600">
                <span>Desconto</span>
                <span>-{formatBRL(order.discount_amount)}</span>
              </div>
            )}
            {order.payment_method === "dinheiro" && order.change_for && (
              <div className="flex justify-between text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <span>Troco para</span>
                <span>{formatBRL(order.change_for)}</span>
              </div>
            )}
            <div className="flex justify-between font-black text-xl border-t-2 border-black pt-3 mt-3 uppercase tracking-tighter">
              <span>Total</span>
              <span className="text-primary">{formatBRL(order.total || 0)}</span>
            </div>
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
