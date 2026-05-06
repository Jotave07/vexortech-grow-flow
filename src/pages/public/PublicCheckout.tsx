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
import { Loader2, ArrowLeft, CheckCircle2, Search, MapPin, Truck, ShoppingBag, CreditCard, Wallet } from "lucide-react";
import { toast } from "sonner";
import { formatBRL, onlyDigits, formatCEP, formatPhone, formatDoc } from "@/lib/format";
import { isStoreOpen } from "@/lib/opening-hours";
import { useServerFn } from "@tanstack/react-start";
import { createOrderPayment } from "@/functions/asaas";
import { fetchAddressByCep } from "@/services/viacep";
import { cn } from "@/lib/utils";

type Zone = { id: string; neighborhood: string; city: string | null; fee: number; min_order: number; estimated_minutes: number };

const PublicCheckout = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { items, itemSubtotal, subtotal, clear, setStoreSlug } = useCart();
  const { user, profile, loading: authLoading, signOut } = useAuth();

  const [store, setStore] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
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

  const createOrderPaymentFn = useServerFn(createOrderPayment);

  useEffect(() => {
    if (slug) setStoreSlug(slug);
  }, [slug, setStoreSlug]);

  useEffect(() => {
    if (!authLoading && !user) {
      toast.info("Você precisa estar logado para finalizar o pedido.");
      navigate(`/entrar?redirect=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    }
  }, [user, authLoading, navigate, location.pathname]);

  useEffect(() => {
    if (profile) {
      setName(profile.full_name || "");
      setPhone(profile.phone || "");
      setDocument((profile as any).document || "");
      setZipCode((profile as any).zip_code || "");
      setStreet((profile as any).street || "");
      setNumber((profile as any).number || "");
      setComplement((profile as any).complement || "");
      setNeighborhood((profile as any).neighborhood || "");
      setCity((profile as any).city || "");
      setState((profile as any).state || "");
    }
  }, [profile]);

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
        toast.info("Bairro não encontrado na lista de entregas da loja. Selecione a região manualmente.");
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
  
  const actualDeliveryFee = useMemo(() => {
    if (settings?.free_delivery_above && subtotal >= Number(settings.free_delivery_above)) return 0;
    return deliveryFee;
  }, [deliveryFee, settings?.free_delivery_above, subtotal]);

  const total = Math.max(0, subtotal + actualDeliveryFee - discount);

  const submit = async () => {
    if (!store || !settings) return;
    
    if (store.is_suspended) return toast.error("Loja suspensa.");
    if (!isStoreOpen(settings.business_hours, settings.is_open) && !settings.accept_orders_when_closed) {
      return toast.error("Loja fechada.");
    }

    if (!name.trim()) return toast.error("Informe seu nome");
    if (onlyDigits(phone).length < 10) return toast.error("WhatsApp inválido");
    if (onlyDigits(document).length < 11 && paymentMethod === "pix") return toast.error("CPF/CNPJ obrigatório para pagamento via PIX");
    
    if (orderType === "entrega") {
      if (!zoneId) return toast.error("Selecione o bairro");
      if (!street.trim() || !number.trim()) return toast.error("Endereço incompleto");
    }

    setSubmitting(true);
    try {
      if (store.owner_user_id === user?.id) {
        setSubmitting(false);
        return toast.error("Dono da loja não pode comprar de si mesmo.");
      }

      // 1. Garantir que existe um registro na tabela 'customers' para este usuário nesta loja
      let customerId = null;
      if (user) {
        const { data: existingCustomer } = await supabase
          .from("customers")
          .select("id")
          .eq("store_id", store.id)
          .eq("user_id", user.id)
          .maybeSingle();
        
        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          const { data: newCustomer, error: cErr } = await supabase
            .from("customers")
            .insert({
              store_id: store.id,
              user_id: user.id,
              full_name: name.trim().toUpperCase(),
              phone: onlyDigits(phone),
              document: onlyDigits(document),
              street: street.toUpperCase(),
              number: number,
              neighborhood: neighborhood.toUpperCase(),
              city: city.toUpperCase(),
              state: state.toUpperCase(),
              zip_code: onlyDigits(zipCode),
              registration_completed: true
            })
            .select("id")
            .single();
          
          if (!cErr && newCustomer) {
            customerId = newCustomer.id;
          }
        }
      }

      const { data: order, error: oErr } = await (supabase.from("orders" as any).insert({
        store_id: store.id,
        customer_id: customerId,
        customer_name: name.trim().toUpperCase(),
        customer_phone: onlyDigits(phone),
        customer_document: onlyDigits(document),
        delivery_type: orderType,
        status: paymentMethod === "pix" ? "aguardando_pagamento" : "novo",
        payment_status: "pendente",
        delivery_address: orderType === "entrega" ? `${street}, ${number}${complement ? ` (${complement})` : ''} - ${neighborhood}`.toUpperCase() : "RETIRADA",
        delivery_fee: actualDeliveryFee,
        subtotal,
        discount_amount: discount,
        total,
        payment_method: paymentMethod,
        change_for: paymentMethod === "dinheiro" ? Number(onlyDigits(changeFor)) / 100 || null : null,
        notes: notes.trim() || null,
      }).select("id, public_token").single() as any);
      
      if (oErr) throw oErr;

      for (const it of items) {
        const { data: oi } = await (supabase.from("order_items" as any).insert({
          order_id: order.id, store_id: store.id, product_id: it.product_id,
          product_name: it.product_name, unit_price: it.unit_price, quantity: it.quantity,
        }).select("id").single() as any);
        
        if (it.options.length) {
          await supabase.from("order_item_options" as any).insert(it.options.map((o: any) => ({
            order_item_id: oi.id, option_name: o.option_name, item_name: o.item_name, extra_price: o.extra_price,
            name: o.item_name, option_item_id: o.item_id
          })));
        }
      }

      if (paymentMethod === "pix") {
        await createOrderPaymentFn({ data: { orderId: order.id, storeId: store.id } });
      }

      clear();
      toast.success("Pedido realizado!");
      navigate(`/pedido/${order.public_token}`, { replace: true });
    } catch (e: any) {
      toast.error(e.message || "Erro ao finalizar");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-emerald-50"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>;

  return (
    <div className="min-h-screen bg-[#F0FDF4] pb-32">
      <header className="sticky top-0 z-20 bg-emerald-900 text-white p-4 flex items-center gap-3 border-b-4 border-emerald-400">
        <Button variant="ghost" size="icon" className="text-white hover:bg-white/10" asChild>
          <Link to={`/loja/${slug}`}><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <h1 className="font-black uppercase tracking-tighter italic">Finalizar Pedido</h1>
      </header>

      <div className="container max-w-xl mx-auto p-4 space-y-6 mt-4">
        {/* Identificação */}
        <Card className="p-6 border-2 border-emerald-100 shadow-xl shadow-emerald-900/5 bg-white rounded-2xl overflow-hidden">
          <div className="mb-6 flex items-center gap-3 border-b-2 border-emerald-50 pb-4">
            <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h2 className="font-black text-xl uppercase tracking-tight italic text-emerald-900">Seus dados</h2>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="uppercase text-[10px] font-black tracking-widest text-emerald-700">Nome Completo</Label>
              <Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} className="border-2 border-emerald-50 focus:border-emerald-500 h-12 font-bold rounded-xl" placeholder="COMO DEVEMOS TE CHAMAR?" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="uppercase text-[10px] font-black tracking-widest text-emerald-700">CPF ou CNPJ</Label>
                <Input value={formatDoc(document)} onChange={(e) => setDocument(e.target.value)} className="border-2 border-emerald-50 focus:border-emerald-500 h-12 font-bold rounded-xl" placeholder="000.000.000-00" />
              </div>
              <div>
                <Label className="uppercase text-[10px] font-black tracking-widest text-emerald-700">WhatsApp</Label>
                <Input value={formatPhone(phone)} onChange={(e) => setPhone(e.target.value)} className="border-2 border-emerald-50 focus:border-emerald-500 h-12 font-bold rounded-xl" placeholder="(00) 00000-0000" />
              </div>
            </div>
          </div>
        </Card>

        {/* Entrega ou Retirada */}
        <Card className="p-6 border-2 border-emerald-100 shadow-xl shadow-emerald-900/5 bg-white rounded-2xl">
          <div className="mb-6 flex items-center gap-3 border-b-2 border-emerald-50 pb-4">
            <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
              <Truck className="h-6 w-6" />
            </div>
            <h2 className="font-black text-xl uppercase tracking-tight italic text-emerald-900">Tipo de Entrega</h2>
          </div>
          <RadioGroup value={orderType} onValueChange={(v: any) => setOrderType(v)} className="grid grid-cols-2 gap-4">
            {settings?.allow_delivery && (
              <div className={cn("relative flex items-center justify-center border-2 p-4 rounded-xl transition-all cursor-pointer", orderType === 'entrega' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-emerald-50 text-emerald-400')}>
                <RadioGroupItem value="entrega" id="entrega" className="absolute top-2 right-2" />
                <Label htmlFor="entrega" className="font-black uppercase text-xs tracking-widest cursor-pointer flex flex-col items-center gap-2">
                  <Truck className="h-5 w-5" /> Entrega
                </Label>
              </div>
            )}
            {settings?.allow_pickup && (
              <div className={cn("relative flex items-center justify-center border-2 p-4 rounded-xl transition-all cursor-pointer", orderType === 'retirada' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-emerald-50 text-emerald-400')}>
                <RadioGroupItem value="retirada" id="retirada" className="absolute top-2 right-2" />
                <Label htmlFor="retirada" className="font-black uppercase text-xs tracking-widest cursor-pointer flex flex-col items-center gap-2">
                  <ShoppingBag className="h-5 w-5" /> Retirada
                </Label>
              </div>
            )}
          </RadioGroup>

          {orderType === "entrega" && (
            <div className="mt-8 space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
              <div>
                <Label className="uppercase text-[10px] font-black tracking-widest text-emerald-700">Seu CEP</Label>
                <div className="flex gap-2">
                  <Input value={formatCEP(zipCode)} onChange={(e) => setZipCode(e.target.value)} className="border-2 border-emerald-50 focus:border-emerald-500 h-12 font-bold rounded-xl" placeholder="00000-000" />
                  <Button onClick={handleCepLookup} disabled={loadingCep} className="bg-emerald-600 hover:bg-emerald-700 h-12 w-12 rounded-xl shrink-0 shadow-lg shadow-emerald-200">
                    {loadingCep ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                  </Button>
                </div>
              </div>
              <div>
                <Label className="uppercase text-[10px] font-black tracking-widest text-emerald-700">Seu Bairro (Taxa)</Label>
                <Select value={zoneId} onValueChange={setZoneId}>
                  <SelectTrigger className="border-2 border-emerald-50 h-12 font-bold rounded-xl bg-white"><SelectValue placeholder="ONDE VOCÊ ESTÁ?" /></SelectTrigger>
                  <SelectContent className="rounded-xl border-emerald-100">
                    {zones.map(z => <SelectItem key={z.id} value={z.id} className="font-bold">{z.neighborhood.toUpperCase()} ({formatBRL(z.fee)})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-3">
                  <Label className="uppercase text-[10px] font-black tracking-widest text-emerald-700">Rua / Av</Label>
                  <Input value={street} onChange={(e) => setStreet(e.target.value.toUpperCase())} className="border-2 border-emerald-50 focus:border-emerald-500 h-12 font-bold rounded-xl" />
                </div>
                <div>
                  <Label className="uppercase text-[10px] font-black tracking-widest text-emerald-700">Nº</Label>
                  <Input value={number} onChange={(e) => setNumber(e.target.value)} className="border-2 border-emerald-50 focus:border-emerald-500 h-12 font-bold rounded-xl" />
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Pagamento */}
        <Card className="p-6 border-2 border-emerald-100 shadow-xl shadow-emerald-900/5 bg-white rounded-2xl">
          <div className="mb-6 flex items-center gap-3 border-b-2 border-emerald-50 pb-4">
            <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600">
              <CreditCard className="h-6 w-6" />
            </div>
            <h2 className="font-black text-xl uppercase tracking-tight italic text-emerald-900">Pagamento</h2>
          </div>
          <div className="space-y-4">
            <RadioGroup value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)} className="space-y-3">
              {settings?.accept_pix && (
                <div className={cn("relative flex items-center gap-3 border-2 p-4 rounded-xl transition-all cursor-pointer", paymentMethod === 'pix' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-emerald-50 text-emerald-400')}>
                  <RadioGroupItem value="pix" id="pix" />
                  <Label htmlFor="pix" className="font-black uppercase text-xs tracking-widest cursor-pointer flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-emerald-100 flex items-center justify-center text-emerald-600 font-black">PIX</div>
                    PIX (LIBERAÇÃO IMEDIATA)
                  </Label>
                </div>
              )}
              {settings?.accept_cash && (
                <div className={cn("relative flex items-center gap-3 border-2 p-4 rounded-xl transition-all cursor-pointer", paymentMethod === 'dinheiro' ? 'border-emerald-50 text-emerald-700' : 'border-emerald-50 text-emerald-400')}>
                  <RadioGroupItem value="dinheiro" id="dinheiro" />
                  <Label htmlFor="dinheiro" className="font-black uppercase text-xs tracking-widest cursor-pointer flex items-center gap-3">
                    <Wallet className="h-5 w-5" /> Dinheiro
                  </Label>
                </div>
              )}
            </RadioGroup>
            {paymentMethod === "dinheiro" && (
              <div className="animate-in slide-in-from-left-4">
                <Label className="uppercase text-[10px] font-black tracking-widest text-emerald-700">Troco para quanto?</Label>
                <Input value={changeFor} onChange={(e) => setChangeFor(e.target.value)} type="number" className="border-2 border-emerald-50 h-12 font-bold rounded-xl" placeholder="EX: 100" />
              </div>
            )}
          </div>
        </Card>

        {/* Observações */}
        <Card className="p-6 border-2 border-emerald-100 shadow-xl shadow-emerald-900/5 bg-white rounded-2xl">
          <Label className="uppercase text-[10px] font-black tracking-widest text-emerald-700 mb-2 block">Observações do Pedido</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="border-2 border-emerald-50 focus:border-emerald-500 rounded-xl font-bold min-h-[100px]" placeholder="EX: TIRAR CEBOLA, CAMPAINHA COM DEFEITO..." />
        </Card>

        {/* Footer com Total */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-emerald-900 border-t-4 border-emerald-400 z-30 shadow-2xl">
          <div className="container max-w-xl mx-auto flex items-center justify-between gap-4">
            <div className="text-white">
              <p className="text-[10px] uppercase font-black text-emerald-300 tracking-widest leading-none mb-1 italic">Total do Pedido</p>
              <p className="text-2xl font-black tracking-tighter text-white">{formatBRL(total)}</p>
            </div>
            <Button onClick={submit} disabled={submitting || items.length === 0} className="bg-emerald-400 hover:bg-emerald-300 text-emerald-950 px-8 h-14 font-black uppercase tracking-tighter text-lg rounded-xl shadow-lg transition-transform active:scale-95">
              {submitting ? <Loader2 className="h-6 w-6 animate-spin" /> : "ENVIAR PEDIDO"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PublicCheckout;
