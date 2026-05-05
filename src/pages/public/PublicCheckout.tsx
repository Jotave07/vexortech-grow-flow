import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCart } from "@/contexts/CartContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, CheckCircle2, Search } from "lucide-react";
import { toast } from "sonner";
import { formatBRL, onlyDigits, formatCEP, formatPhone } from "@/lib/format";
import { isStoreOpen } from "@/lib/opening-hours";
import { useServerFn } from "@tanstack/react-start";
import { createOrderPayment } from "@/server/asaas.functions";
import { fetchAddressByCep } from "@/services/viacep";

type Zone = { id: string; neighborhood: string; city: string | null; fee: number; min_order: number; estimated_minutes: number };

const PublicCheckout = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { items, itemSubtotal, subtotal, clear, count } = useCart();
  const createOrderPaymentFn = useServerFn(createOrderPayment);

  const [store, setStore] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [orderType, setOrderType] = useState<"entrega" | "retirada">("entrega");
  const [zoneId, setZoneId] = useState<string>("");
  const [zipCode, setZipCode] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [reference, setReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "dinheiro" | "cartao_entrega">("pix");
  const [changeFor, setChangeFor] = useState("");
  const [notes, setNotes] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<any>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [loadingCep, setLoadingCep] = useState(false);

  const handleCepLookup = async () => {
    const cleanCep = onlyDigits(zipCode);
    if (cleanCep.length !== 8) return;
    setLoadingCep(true);
    try {
      const addr = await fetchAddressByCep(cleanCep);
      setStreet(addr.street);
      setNeighborhood(addr.neighborhood);
      setCity(addr.city);
      setState(addr.state);
      
      // Try to find a matching delivery zone by neighborhood
      const matchingZone = zones.find(z => 
        z.neighborhood.toLowerCase().trim() === addr.neighborhood.toLowerCase().trim()
      );
      if (matchingZone) {
        setZoneId(matchingZone.id);
      } else {
        setZoneId("");
        toast.info("Bairro não encontrado na lista de entregas. Verifique as regiões atendidas.");
      }
    } catch (e: any) {
      toast.error(e.message || "Erro ao buscar CEP");
    } finally {
      setLoadingCep(false);
    }
  };

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data: s } = await supabase.from("stores").select("*").eq("slug", slug).maybeSingle();
      if (!s) { setLoading(false); return; }
      setStore(s);
      const [settRes, zoneRes] = await Promise.all([
        supabase.from("store_settings").select("*").eq("store_id", s.id).maybeSingle(),
        supabase.from("delivery_zones").select("*").eq("store_id", s.id).eq("is_active", true).order("neighborhood"),
      ]);
      setSettings(settRes.data);
      setZones((zoneRes.data ?? []) as Zone[]);
      setLoading(false);
    })();
  }, [slug]);

  const zone = zones.find((z) => z.id === zoneId);
  const deliveryFee = orderType === "entrega" ? Number(zone?.fee ?? 0) : 0;
  const discount = useMemo(() => {
    if (!coupon) return 0;
    if (coupon.discount_type === "percentual") return (subtotal * Number(coupon.discount_value)) / 100;
    return Math.min(Number(coupon.discount_value), subtotal);
  }, [coupon, subtotal]);
  const total = Math.max(0, subtotal + deliveryFee - discount);

  const submit = async () => {
    if (!store || !settings) return;
    
    if (!isStoreOpen(settings.business_hours, settings.is_open) && !settings.accept_orders_when_closed) {
      return toast.error("A loja está fechada no momento e não aceita pedidos.");
    }

    if (!name.trim() || name.trim().length < 2) return toast.error("Informe seu nome");
    const phoneDigits = onlyDigits(phone);
    if (phoneDigits.length < 10) return toast.error("Telefone inválido");
    if (orderType === "entrega") {
      if (!settings.allow_delivery) return toast.error("Loja não faz entrega");
      if (!zoneId) return toast.error("Escolha a região");
      if (!street.trim() || !number.trim()) return toast.error("Endereço incompleto");
    } else if (!settings.allow_pickup) return toast.error("Loja não permite retirada");
    if (settings.min_order_value && subtotal < Number(settings.min_order_value)) return toast.error(`Pedido mínimo ${formatBRL(settings.min_order_value)}`);
    if (paymentMethod === "pix" && !settings.accept_pix) return toast.error("Pix não aceito");
    if (paymentMethod === "dinheiro" && !settings.accept_cash) return toast.error("Dinheiro não aceito");
    if (paymentMethod === "cartao_entrega" && !settings.accept_card_on_delivery) return toast.error("Cartão na entrega não aceito");

    setSubmitting(true);
    try {
      const { data: existingCustomer } = await supabase.from("customers").select("id").eq("store_id", store.id).eq("phone", phoneDigits).maybeSingle();
      let customerId = existingCustomer?.id as string | undefined;
      if (!customerId) {
        const { data: newC, error: cErr } = await supabase.from("customers").insert({ store_id: store.id, name: name.trim(), phone: phoneDigits }).select("id").single();
        if (cErr) throw cErr;
        customerId = newC.id;
      }

      const deliveryAddress = orderType === "entrega" ? `${street.trim()}, ${number.trim()}${complement ? ` - ${complement}` : ""}` : null;
      const { data: order, error: oErr } = await supabase.from("orders").insert({
        store_id: store.id,
        customer_id: customerId,
        customer_name: name.trim(),
        customer_phone: phoneDigits,
        order_type: orderType,
        status: "novo",
        delivery_address: deliveryAddress,
        delivery_neighborhood: orderType === "entrega" ? zone?.neighborhood : null,
        delivery_reference: reference || null,
        delivery_zone_id: orderType === "entrega" ? zoneId : null,
        delivery_fee: deliveryFee,
        subtotal,
        discount,
        total,
        coupon_id: coupon?.id ?? null,
        coupon_code: coupon?.code ?? null,
        payment_method: paymentMethod,
        change_for: paymentMethod === "dinheiro" && changeFor ? Number(changeFor) : null,
        notes: notes.trim() || null,
        estimated_minutes: orderType === "entrega" ? (zone?.estimated_minutes ?? settings.avg_prep_time_minutes) : settings.avg_prep_time_minutes,
      }).select("id, public_token, order_number").single();
      if (oErr) throw oErr;

      for (const it of items) {
        const optionsTotal = it.options.reduce((s: number, o: any) => s + Number(o.extra_price), 0);
        const { data: oi, error: iErr } = await supabase.from("order_items").insert({
          order_id: order.id, store_id: store.id, product_id: it.product_id,
          product_name: it.product_name, unit_price: it.unit_price, quantity: it.quantity,
          options_total: optionsTotal, subtotal: itemSubtotal(it), notes: it.notes ?? null,
        }).select("id").single();
        if (iErr) throw iErr;
        if (it.options.length) {
          await supabase.from("order_item_options").insert(it.options.map((o: any) => ({
            order_item_id: oi.id, store_id: store.id,
            option_name: o.option_name, item_name: o.item_name, extra_price: o.extra_price,
          })));
        }
      }

      await supabase.from("order_status_history").insert({ order_id: order.id, store_id: store.id, status: "novo", notes: "Pedido recebido" });
      await supabase.from("payments").insert({
        order_id: order.id, store_id: store.id, method: paymentMethod, status: "pendente", amount: total,
      });

      if (paymentMethod === "pix" && settings.asaas_api_key) {
        try {
          await createOrderPaymentFn({ data: { orderId: order.id, storeId: store.id } });
        } catch (error: any) {
          console.error("Asaas PIX error:", error);
          toast.error("Erro ao gerar QR Code PIX, mas o pedido foi enviado.");
        }
      }

      clear();
      toast.success("Pedido enviado!");
      navigate(`/pedido/${order.public_token}`, { replace: true });
    } catch (e: any) {
      console.error(e);
      toast.error(e.message ?? "Erro ao enviar pedido");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!store) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loja não encontrada</div>;

  return (
    <div className="min-h-screen bg-background pb-32">
      <header className="sticky top-0 z-20 bg-card border-b border-border p-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild><Link to={`/loja/${slug}`}><ArrowLeft className="h-5 w-5" /></Link></Button>
        <h1 className="font-semibold uppercase tracking-wider text-sm">Finalizar pedido</h1>
      </header>

      <div className="container max-w-xl mx-auto p-4 space-y-4">
        <Card className="p-5 border-border">
          <div className="mb-4">
            <h2 className="font-bold text-lg uppercase tracking-tight">Seus dados</h2>
            <div className="h-1 w-12 bg-primary mt-1"></div>
          </div>
          <div className="space-y-4">
            <div><Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">Nome *</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="border-border focus:ring-0" /></div>
            <div><Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">WhatsApp *</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" maxLength={15} className="border-border focus:ring-0" /></div>
          </div>
        </Card>

        <Card className="p-5 border-border">
          <div className="mb-4">
            <h2 className="font-bold text-lg uppercase tracking-tight">Tipo de pedido</h2>
            <div className="h-1 w-12 bg-primary mt-1"></div>
          </div>
          <RadioGroup value={orderType} onValueChange={(v: any) => setOrderType(v)} className="grid grid-cols-2 gap-4">
            {settings.allow_delivery && (
              <div className="flex items-center space-x-2 border p-3 rounded-sm">
                <RadioGroupItem value="entrega" id="entrega" />
                <Label htmlFor="entrega">Entrega</Label>
              </div>
            )}
            {settings.allow_pickup && (
              <div className="flex items-center space-x-2 border p-3 rounded-sm">
                <RadioGroupItem value="retirada" id="retirada" />
                <Label htmlFor="retirada">Retirada</Label>
              </div>
            )}
          </RadioGroup>
        </Card>

        {orderType === "entrega" && (
          <Card className="p-5 border-border">
            <div className="mb-4">
              <h2 className="font-bold text-lg uppercase tracking-tight">Endereço</h2>
              <div className="h-1 w-12 bg-primary mt-1"></div>
            </div>
            <div className="space-y-4">
              <div>
                <Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">Região *</Label>
                <Select value={zoneId} onValueChange={setZoneId}>
                  <SelectTrigger><SelectValue placeholder="Selecione a região" /></SelectTrigger>
                  <SelectContent>
                    {zones.map(z => <SelectItem key={z.id} value={z.id}>{z.neighborhood} - {formatBRL(z.fee)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2"><Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">Rua *</Label><Input value={street} onChange={(e) => setStreet(e.target.value)} /></div>
                <div><Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">Nº *</Label><Input value={number} onChange={(e) => setNumber(e.target.value)} /></div>
              </div>
              <div><Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">Complemento</Label><Input value={complement} onChange={(e) => setComplement(e.target.value)} /></div>
              <div><Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">Referência</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} /></div>
            </div>
          </Card>
        )}

        <Card className="p-5 border-border">
          <div className="mb-4">
            <h2 className="font-bold text-lg uppercase tracking-tight">Pagamento</h2>
            <div className="h-1 w-12 bg-primary mt-1"></div>
          </div>
          <RadioGroup value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)} className="space-y-2">
            {settings.accept_pix && <div className="flex items-center space-x-2 border p-3 rounded-sm"><RadioGroupItem value="pix" id="pix" /><Label htmlFor="pix">PIX</Label></div>}
            {settings.accept_cash && <div className="flex items-center space-x-2 border p-3 rounded-sm"><RadioGroupItem value="dinheiro" id="dinheiro" /><Label htmlFor="dinheiro">Dinheiro</Label></div>}
            {settings.accept_card_on_delivery && <div className="flex items-center space-x-2 border p-3 rounded-sm"><RadioGroupItem value="cartao_entrega" id="cartao_entrega" /><Label htmlFor="cartao_entrega">Cartão na entrega</Label></div>}
          </RadioGroup>
          {paymentMethod === "dinheiro" && (
            <div className="mt-4"><Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">Troco para quanto?</Label><Input value={changeFor} onChange={(e) => setChangeFor(e.target.value)} placeholder="Ex: 50" /></div>
          )}
        </Card>

        <Card className="p-5 border-border">
          <div className="mb-4">
            <h2 className="font-bold text-lg uppercase tracking-tight">Observações</h2>
            <div className="h-1 w-12 bg-primary mt-1"></div>
          </div>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Alguma observação para o pedido?" />
        </Card>
        
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-card border-t border-border z-30">
          <div className="container max-w-xl mx-auto flex items-center justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest leading-none mb-1">Total a pagar</div>
              <div className="text-2xl font-black text-primary">{formatBRL(total)}</div>
            </div>
            <Button 
              onClick={submit} 
              disabled={submitting || count === 0} 
              size="lg" 
              className="px-10 h-14 font-black uppercase tracking-tighter text-lg"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Enviar Pedido"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicCheckout;
