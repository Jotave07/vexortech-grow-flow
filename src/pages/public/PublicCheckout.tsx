import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/AuthContext";
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
  const location = useLocation();
  const { items, itemSubtotal, subtotal, clear, count, setStoreSlug } = useCart();
  const { user, profile, loading: authLoading } = useAuth();

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
  const [coupon, setCoupon] = useState<any>(null);
  const [loadingCep, setLoadingCep] = useState(false);

  useEffect(() => {
    if (slug) setStoreSlug(slug);
  }, [slug, setStoreSlug]);

  useEffect(() => {
    if (!authLoading && !user) {
      toast.info("Você precisa estar logado para finalizar o pedido.");
      navigate(`/entrar?redirect=${encodeURIComponent(location.pathname)}`, { replace: true });
    }
  }, [user, authLoading, navigate, location.pathname]);

  useEffect(() => {
    if (profile) {
      setName(profile.full_name || "");
      setPhone(profile.phone || "");
      setZipCode((profile as any).zip_code || "");
      setStreet((profile as any).street || "");
      setNumber((profile as any).number || "");
      setComplement((profile as any).complement || "");
      setNeighborhood((profile as any).neighborhood || "");
      setCity((profile as any).city || "");
      setState((profile as any).state || "");
      
      const neighborhoodVal = (profile as any).neighborhood;
      if (neighborhoodVal && zones.length > 0) {
        const neighborhoodLower = neighborhoodVal.toLowerCase().trim();
        const matchingZone = zones.find(z => 
          z.neighborhood.toLowerCase().trim() === neighborhoodLower
        );
        if (matchingZone) setZoneId(matchingZone.id);
      }
    }
  }, [profile, zones]);
  const createOrderPaymentFn = useServerFn(createOrderPayment);

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
      
      const matchingZone = zones.find(z => 
        z.neighborhood.toLowerCase().trim() === addr.neighborhood.toLowerCase().trim()
      );
      if (matchingZone) {
        setZoneId(matchingZone.id);
      } else {
        setZoneId("");
        toast.info("Bairro não encontrado na lista de entregas. Selecione manualmente a região mais próxima.");
      }
    } catch (e: any) {
      toast.error(e.message || "Erro ao buscar CEP");
    } finally {
      setLoadingCep(false);
    }
  };

  const zone = zones.find((z) => z.id === zoneId);
  const deliveryFee = orderType === "entrega" ? Number(zone?.fee ?? settings?.delivery_base_fee ?? 0) : 0;
  const discount = useMemo(() => {
    if (!coupon) return 0;
    if (coupon.discount_type === "percentual") return (subtotal * Number(coupon.discount_value)) / 100;
    return Math.min(Number(coupon.discount_value), subtotal);
  }, [coupon, subtotal]);
  
  // Free delivery logic
  const actualDeliveryFee = useMemo(() => {
    if (settings?.free_delivery_above && subtotal >= Number(settings.free_delivery_above)) return 0;
    return deliveryFee;
  }, [deliveryFee, settings?.free_delivery_above, subtotal]);

  const total = Math.max(0, subtotal + actualDeliveryFee - discount);

  const submit = async () => {
    if (!store || !settings) return;
    
    if (store.is_suspended) {
      return toast.error("Esta loja está com as vendas suspensas temporariamente.");
    }

    if (!isStoreOpen(settings.business_hours, settings.is_open) && !settings.accept_orders_when_closed) {
      return toast.error(`A loja está fechada no momento. Próxima abertura às ${settings.next_opening_time || 'breve'}`);
    }

    if (!name.trim() || name.trim().length < 2) return toast.error("Informe seu nome");
    const phoneDigits = onlyDigits(phone);
    if (phoneDigits.length < 10) return toast.error("Telefone inválido");
    
    if (orderType === "entrega") {
      if (!settings.allow_delivery) return toast.error("Loja não faz entrega");
      if (!zoneId) return toast.error("Escolha a região de entrega");
      if (!street.trim() || !number.trim() || !neighborhood.trim()) return toast.error("Endereço incompleto");
      if (zone && zone.min_order > 0 && subtotal < zone.min_order) {
        return toast.error(`Pedido mínimo para ${zone.neighborhood} é ${formatBRL(zone.min_order)}`);
      }
    } else if (!settings.allow_pickup) {
      return toast.error("Loja não permite retirada");
    }

    if (settings.min_order_value && subtotal < Number(settings.min_order_value)) {
      return toast.error(`Pedido mínimo da loja é ${formatBRL(settings.min_order_value)}`);
    }

    setSubmitting(true);
    try {
      const { data: existingCustomer } = await supabase.from("customers").select("*").eq("store_id", store.id).eq("phone", phoneDigits).maybeSingle();
      let customerId = existingCustomer?.id as string | undefined;
      
      const customerData = {
        store_id: store.id, 
        full_name: name.trim(), 
        phone: phoneDigits,
        zip_code: zipCode,
        street: street.trim(),
        number: number.trim(),
        complement: complement.trim(),
        neighborhood: neighborhood.trim(),
        city: city.trim(),
        state: state.trim(),
        registration_completed: true,
        user_id: user?.id
      };

      if (!customerId) {
        const { data: newC, error: cErr } = await (supabase.from("customers" as any).insert(customerData).select("id").single() as any);
        if (cErr) throw cErr;
        customerId = newC.id;
      } else {
        // Update existing customer info
        const { error: uErr } = await supabase.from("customers").update(customerData).eq("id", customerId);
        if (uErr) throw uErr;
      }

      // Also update the main profile if it's missing info
      if (user) {
        await supabase.from("profiles").update({
          full_name: name.trim(),
          phone: phoneDigits,
          zip_code: zipCode,
          street: street.trim(),
          number: number.trim(),
          complement: complement.trim(),
          neighborhood: neighborhood.trim(),
          city: city.trim(),
          state: state.trim()
        } as any).eq("user_id", user.id);
      }

      const deliveryAddress = orderType === "entrega" 
        ? `${street.trim()}, ${number.trim()}${complement ? ` - ${complement}` : ""}${zipCode ? ` - CEP ${formatCEP(zipCode)}` : ""}` 
        : null;

      const { data: order, error: oErr } = await (supabase.from("orders" as any).insert({
        store_id: store.id,
        customer_id: customerId,
        customer_name: name.trim().toUpperCase(),
        customer_phone: phoneDigits,
        delivery_type: orderType,
        status: paymentMethod === "pix" ? "aguardando_pagamento" : "novo",
        delivery_address: deliveryAddress?.toUpperCase() || null,
        delivery_neighborhood: orderType === "entrega" ? (neighborhood || zone?.neighborhood)?.toUpperCase() : null,
        delivery_fee: actualDeliveryFee,
        subtotal,
        discount_amount: discount,
        total,
        payment_method: paymentMethod,
        notes: notes.trim() || null,
      }).select("id, public_token, order_number").single() as any);
      
      if (oErr) throw oErr;

      for (const it of items) {
        const { data: oi, error: iErr } = await (supabase.from("order_items" as any).insert({
          order_id: order.id, store_id: store.id, product_id: it.product_id,
          product_name: it.product_name, unit_price: it.unit_price, quantity: it.quantity,
        }).select("id").single() as any);
        if (iErr) throw iErr;
        
        if (it.options.length) {
          await supabase.from("order_item_options" as any).insert(it.options.map((o: any) => ({
            order_item_id: oi.id, 
            option_name: o.option_name, item_name: o.item_name, extra_price: o.extra_price,
            name: o.item_name, option_item_id: o.item_id
          })));
        }
      }

      await supabase.from("order_status_history").insert({ 
        order_id: order.id, 
        store_id: store.id, 
        status: paymentMethod === "pix" ? "aguardando_pagamento" : "novo", 
        notes: paymentMethod === "pix" ? "Pedido aguardando pagamento PIX" : "Pedido recebido" 
      });

      await supabase.from("payments" as any).insert({
        order_id: order.id, store_id: store.id, status: "pendente", amount: total,
      });

      if (paymentMethod === "pix" && settings.accept_pix) {
        try {
          await createOrderPaymentFn({ data: { orderId: order.id, storeId: store.id } });
        } catch (error: any) {
          console.error("Asaas PIX error:", error);
          toast.error("Aviso: Houve um problema ao gerar seu QR Code PIX. Por favor, entre em contato com a loja.");
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
        <Card className="p-5 border-border shadow-elegant">
          <div className="mb-4">
            <h2 className="font-bold text-lg uppercase tracking-tight italic">Seus dados</h2>
            <div className="h-1 w-12 bg-primary mt-1"></div>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">Nome *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} maxLength={80} className="border-border focus:ring-0" placeholder="Nome completo" />
            </div>
            <div>
              <Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">WhatsApp *</Label>
              <div className="flex gap-2">
                <Input 
                  value={formatPhone(phone)} 
                  onChange={(e) => setPhone(e.target.value)} 
                  onBlur={async () => {
                    const digits = onlyDigits(phone);
                    if (digits.length >= 10 && store?.id) {
                      const { data } = await supabase
                        .from("customers")
                        .select("*")
                        .eq("store_id", store.id)
                        .eq("phone", digits)
                        .maybeSingle();
                      
                      if (data) {
                        setName(data.full_name || "");
                        setZipCode(data.zip_code || "");
                        setStreet(data.street || "");
                        setNumber(data.number || "");
                        setComplement(data.complement || "");
                        setNeighborhood(data.neighborhood || "");
                        setCity(data.city || "");
                        setState(data.state || "");
                        
                        if (data.neighborhood) {
                          const neighborhoodLower = data.neighborhood.toLowerCase().trim();
                          const matchingZone = zones.find(z => 
                            z.neighborhood.toLowerCase().trim() === neighborhoodLower
                          );
                          if (matchingZone) setZoneId(matchingZone.id);
                        }
                        toast.info("Dados de cadastro carregados!");
                      }
                    }
                  }}
                  placeholder="(11) 99999-9999" 
                  maxLength={15} 
                  className="border-border focus:ring-0" 
                />
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-5 border-border shadow-elegant">
          <div className="mb-4">
            <h2 className="font-bold text-lg uppercase tracking-tight italic">Tipo de pedido</h2>
            <div className="h-1 w-12 bg-primary mt-1"></div>
          </div>
          <RadioGroup value={orderType} onValueChange={(v: any) => setOrderType(v)} className="grid grid-cols-2 gap-4">
            {settings.allow_delivery && (
              <div className={`flex items-center space-x-2 border-2 p-3 rounded-none transition-all ${orderType === 'entrega' ? 'border-primary bg-primary/5' : 'border-black/10'}`}>
                <RadioGroupItem value="entrega" id="entrega" />
                <Label htmlFor="entrega" className="font-black uppercase text-xs tracking-widest cursor-pointer">Entrega</Label>
              </div>
            )}
            {settings.allow_pickup && (
              <div className={`flex items-center space-x-2 border-2 p-3 rounded-none transition-all ${orderType === 'retirada' ? 'border-primary bg-primary/5' : 'border-black/10'}`}>
                <RadioGroupItem value="retirada" id="retirada" />
                <Label htmlFor="retirada" className="font-black uppercase text-xs tracking-widest cursor-pointer">Retirada</Label>
              </div>
            )}
          </RadioGroup>
        </Card>

        {orderType === "entrega" && (
          <Card className="p-5 border-border shadow-elegant">
            <div className="mb-4">
              <h2 className="font-bold text-lg uppercase tracking-tight italic">Endereço</h2>
              <div className="h-1 w-12 bg-primary mt-1"></div>
            </div>
            <div className="space-y-4">
              <div>
                <Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">CEP *</Label>
                <div className="flex gap-2">
                  <Input 
                    value={formatCEP(zipCode)} 
                    onChange={(e) => setZipCode(e.target.value)} 
                    placeholder="00000-000" 
                    maxLength={9}
                  />
                  <Button 
                    type="button" 
                    variant="hero" 
                    size="icon" 
                    onClick={handleCepLookup}
                    disabled={loadingCep || onlyDigits(zipCode).length !== 8}
                  >
                    {loadingCep ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div>
                <Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">Região de entrega *</Label>
                <Select value={zoneId} onValueChange={setZoneId}>
                  <SelectTrigger className="rounded-none border-2 border-black"><SelectValue placeholder="Selecione a região" /></SelectTrigger>
                  <SelectContent>
                    {zones.map(z => <SelectItem key={z.id} value={z.id}>{z.neighborhood} - {formatBRL(z.fee)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {zones.length === 0 && <p className="text-[10px] text-destructive mt-1 uppercase font-bold">Nenhuma região de entrega configurada.</p>}
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">Rua *</Label>
                  <Input value={street} onChange={(e) => setStreet(e.target.value.toUpperCase())} placeholder="Ex: Av. Brasil" />
                </div>
                <div>
                  <Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">Nº *</Label>
                  <Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="123" />
                </div>
              </div>

              <div>
                <Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">Bairro *</Label>
                <Input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value.toUpperCase())} placeholder="Ex: Centro" />
              </div>

              <div>
                <Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">Complemento</Label>
                <Input value={complement} onChange={(e) => setComplement(e.target.value.toUpperCase())} placeholder="Apto, Bloco..." />
              </div>
              <div>
                <Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">Referência</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} placeholder="Próximo a..." />
              </div>
            </div>
          </Card>
        )}

        <Card className="p-5 border-border shadow-elegant">
          <div className="mb-4">
            <h2 className="font-bold text-lg uppercase tracking-tight italic">Pagamento</h2>
            <div className="h-1 w-12 bg-primary mt-1"></div>
          </div>
          <RadioGroup value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)} className="space-y-3">
            {settings.accept_pix && (
              <div className={`flex items-center space-x-2 border-2 p-3 rounded-none transition-all ${paymentMethod === 'pix' ? 'border-primary bg-primary/5' : 'border-black/10'}`}>
                <RadioGroupItem value="pix" id="pix" />
                <Label htmlFor="pix" className="font-black uppercase text-xs tracking-widest cursor-pointer">PIX (Online)</Label>
              </div>
            )}
            {settings.accept_cash && (
              <div className={`flex items-center space-x-2 border-2 p-3 rounded-none transition-all ${paymentMethod === 'dinheiro' ? 'border-primary bg-primary/5' : 'border-black/10'}`}>
                <RadioGroupItem value="dinheiro" id="dinheiro" />
                <Label htmlFor="dinheiro" className="font-black uppercase text-xs tracking-widest cursor-pointer">Dinheiro</Label>
              </div>
            )}
            {settings.accept_card_on_delivery && (
              <div className={`flex items-center space-x-2 border-2 p-3 rounded-none transition-all ${paymentMethod === 'cartao_entrega' ? 'border-primary bg-primary/5' : 'border-black/10'}`}>
                <RadioGroupItem value="cartao_entrega" id="cartao_entrega" />
                <Label htmlFor="cartao_entrega" className="font-black uppercase text-xs tracking-widest cursor-pointer">Cartão na entrega</Label>
              </div>
            )}
          </RadioGroup>
          {paymentMethod === "dinheiro" && (
            <div className="mt-4 animate-fade-in">
              <Label className="uppercase text-[10px] font-bold tracking-widest text-muted-foreground">Troco para quanto?</Label>
              <Input value={changeFor} onChange={(e) => setChangeFor(e.target.value)} placeholder="Ex: 50" type="number" />
            </div>
          )}
        </Card>

        <Card className="p-5 border-border shadow-elegant">
          <div className="mb-4">
            <h2 className="font-bold text-lg uppercase tracking-tight italic">Observações</h2>
            <div className="h-1 w-12 bg-primary mt-1"></div>
          </div>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Alguma observação para o pedido?" className="rounded-none border-2 border-black" />
        </Card>
        
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t-4 border-black z-30 shadow-[0_-4px_10px_rgba(0,0,0,0.1)]">
          <div className="container max-w-xl mx-auto flex items-center justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase font-black text-muted-foreground tracking-widest leading-none mb-1 italic">Total a pagar</div>
              <div className="text-2xl font-black text-primary tracking-tighter">{formatBRL(total)}</div>
              {actualDeliveryFee === 0 && orderType === 'entrega' && <div className="text-[10px] text-green-600 font-black uppercase">Entrega Grátis!</div>}
            </div>
            <Button 
              onClick={submit} 
              disabled={submitting || count === 0} 
              size="lg" 
              variant="hero"
              className="px-10 h-14 font-black uppercase tracking-tighter text-lg"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Finalizar Pedido"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicCheckout;