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
import { Loader2, ArrowLeft, CheckCircle2, Search, MapPin, Truck, ShoppingBag, CreditCard, Wallet, Copy, QrCode, AlertTriangle, Clock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatBRL, onlyDigits, formatCEP, formatPhone, formatDoc } from "@/lib/format";
import { isStoreOpen } from "@/lib/opening-hours";
import { useServerFn } from "@tanstack/react-start";
import { createOrderPayment, syncPaymentStatus } from "@/functions/asaas";
import { fetchAddressByCep } from "@/services/cep/viacepService";
import { calculateDeliveryQuote } from "@/services/delivery/deliveryQuoteService";
import { DeliveryQuote } from "@/types/delivery";
import { cn } from "@/lib/utils";

const PublicCheckout = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { items, itemSubtotal, subtotal, clear, setStoreSlug } = useCart();
  const { user, profile, loading: authLoading, signOut } = useAuth();

  const [store, setStore] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPixModal, setShowPixModal] = useState(false);
  const [pixData, setPixData] = useState<any>(null);
  const [createdOrder, setCreatedOrder] = useState<any>(null);
  const [isPaid, setIsPaid] = useState(false);
  const syncPaymentStatusFn = useServerFn(syncPaymentStatus);
  const createOrderPaymentFn = useServerFn(createOrderPayment);

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
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "dinheiro" | "cartao_credito_entrega" | "cartao_debito_entrega">("pix");
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
  
  // Real-time payment verification while modal is open
  useEffect(() => {
    if (!showPixModal || !createdOrder?.id || isPaid) return;
    
    const interval = setInterval(async () => {
      try {
        const result = await syncPaymentStatusFn({ 
          data: { 
            orderId: createdOrder.id, 
            storeId: store.id 
          } 
        });
        
        if (result.status === "paid") {
          setIsPaid(true);
          toast.success("Pagamento confirmado!");
          setTimeout(() => {
            setShowPixModal(false);
            navigate(`/pedido/${createdOrder.public_token}`, { replace: true });
          }, 2000);
        }
      } catch (e) {
        console.error("Error syncing payment:", e);
      }
    }, 4000); // Check every 4s
    
    return () => clearInterval(interval);
  }, [showPixModal, createdOrder, store?.id, isPaid, navigate, syncPaymentStatusFn]);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data: s } = await supabase.from("stores").select("*").eq("slug", slug).maybeSingle();
      if (!s) { setLoading(false); return; }
      setStore(s);
      const { data: sett } = await supabase.from("store_settings").select("*").eq("store_id", s.id).maybeSingle();
      setSettings(sett);
      setLoading(false);
    })();
  }, [slug]);

  const updateDeliveryQuote = async (zip: string, neigh: string, cty: string, st: string) => {
    if (!store?.id || orderType !== "entrega") return;
    const quote = await calculateDeliveryQuote({
      storeId: store.id,
      cep: zip,
      neighborhood: neigh,
      city: cty,
      state: st,
      subtotal: subtotal
    });
    setDeliveryQuote(quote);
    if (quote.region?.id) {
      setZoneId(quote.region.id);
    } else {
      setZoneId("");
    }
    return quote;
  };

  useEffect(() => {
    if (orderType === "entrega" && zipCode && neighborhood && city && state) {
      const timer = setTimeout(() => {
        updateDeliveryQuote(zipCode, neighborhood, city, state);
      }, 500);
      return () => clearTimeout(timer);
    } else if (orderType === "retirada") {
      setDeliveryQuote(null);
      setZoneId("");
    }
  }, [orderType, zipCode, neighborhood, city, state, itemSubtotal, store?.id]);

  const handleCepLookup = async () => {
    const cleanCep = onlyDigits(zipCode);
    if (cleanCep.length !== 8) return;
    setLoadingCep(true);
    try {
      const addr = await fetchAddressByCep(cleanCep);
      setStreet(addr.logradouro || "");
      setNeighborhood(addr.bairro || "");
      setCity(addr.localidade || "");
      setState(addr.uf || "");
      
      if (addr.localidade && addr.uf) {
        await updateDeliveryQuote(cleanCep, addr.bairro || "", addr.localidade, addr.uf);
      }
    } catch (e: any) {
      toast.error(e.message || "Erro ao buscar CEP");
    } finally {
      setLoadingCep(false);
    }
  };

  const zone = deliveryQuote?.region;
  
  const discount = useMemo(() => {
    if (!coupon) return 0;
    if (coupon.discount_type === "percentual") return (subtotal * Number(coupon.discount_value)) / 100;
    return Math.min(Number(coupon.discount_value), subtotal);
  }, [coupon, subtotal]);
  
  const actualDeliveryFee = useMemo(() => {
    if (orderType === "retirada") return 0;
    if (settings?.free_delivery_above && subtotal >= Number(settings.free_delivery_above)) return 0;
    return deliveryQuote?.fee || 0;
  }, [deliveryQuote?.fee, settings?.free_delivery_above, subtotal, orderType]);

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
      if (!deliveryQuote?.available) return toast.error(deliveryQuote?.reason || "Entrega não disponível.");
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
        // Try to find by user_id first
        const { data: existingCustomer } = await supabase
          .from("customers")
          .select("id")
          .eq("store_id", store.id)
          .eq("user_id", user.id)
          .maybeSingle();
        
        if (existingCustomer) {
          customerId = existingCustomer.id;
        } else {
          // Try to find by phone if not found by user_id
          const { data: phoneCustomer } = await supabase
            .from("customers")
            .select("id")
            .eq("store_id", store.id)
            .eq("phone", onlyDigits(phone))
            .maybeSingle();

          if (phoneCustomer) {
            customerId = phoneCustomer.id;
            // Link this customer to the user
            await supabase
              .from("customers")
              .update({ user_id: user.id })
              .eq("id", customerId);
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
        // Novos campos de entrega
        zip_code: onlyDigits(zipCode),
        neighborhood: neighborhood.toUpperCase(),
        city: city.toUpperCase(),
        state: state.toUpperCase(),
        street: street.toUpperCase(),
        number: number,
        complement: complement.trim() || null,
        delivery_region_id: deliveryQuote?.region?.id || null,
        estimated_min: deliveryQuote?.estimated_min || null,
        estimated_max: deliveryQuote?.estimated_max || null,
        delivery_source: deliveryQuote?.source || null,
      }).select("id, public_token").maybeSingle() as any);
      
      if (oErr) throw oErr;
      if (!order || !order.public_token) {
        throw new Error("Erro ao gerar token do pedido. Tente novamente.");
      }

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
        const pixResult = await createOrderPaymentFn({ data: { orderId: order.id, storeId: store.id } });
        if ((pixResult as any).error) {
          toast.error(`Aviso: Pedido criado, mas houve erro no PIX: ${(pixResult as any).error}. Você poderá tentar pagar na tela de acompanhamento.`);
        }
        setPixData(pixResult);
        setCreatedOrder(order);
        setShowPixModal(true);
        clear();
        return;
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

              {deliveryQuote && (
                <div className={cn("p-4 rounded-xl border-2 transition-all", deliveryQuote.available ? "bg-emerald-50 border-emerald-100" : "bg-red-50 border-red-100")}>
                  {deliveryQuote.available ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase text-emerald-700 tracking-widest">Entrega Disponível</span>
                        <div className="flex items-center gap-1 text-emerald-600 font-black text-sm">
                          <Truck className="h-4 w-4" /> {formatBRL(deliveryQuote.fee)}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-bold text-emerald-800">
                        <div className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {deliveryQuote.region?.name || deliveryQuote.region?.neighborhood}</div>
                        <div className="flex items-center gap-1"><Clock className="h-3 w-3" /> {deliveryQuote.estimated_min}-{deliveryQuote.estimated_max} min</div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 text-red-700">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-xs font-black uppercase tracking-tight">{deliveryQuote.reason}</p>
                        {deliveryQuote.amount_to_min && (
                          <p className="text-[10px] font-bold">Faltam {formatBRL(deliveryQuote.amount_to_min)} para atingir o mínimo.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

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

              <div>
                <Label className="uppercase text-[10px] font-black tracking-widest text-emerald-700">Complemento (Opcional)</Label>
                <Input value={complement} onChange={(e) => setComplement(e.target.value.toUpperCase())} className="border-2 border-emerald-50 focus:border-emerald-500 h-12 font-bold rounded-xl" placeholder="APTO, BLOCO, FUNDOS..." />
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
              {settings?.accept_card_on_delivery && (
                <>
                  <div className={cn("relative flex items-center gap-3 border-2 p-4 rounded-xl transition-all cursor-pointer", paymentMethod === 'cartao_credito_entrega' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-emerald-50 text-emerald-400')}>
                    <RadioGroupItem value="cartao_credito_entrega" id="cartao_credito_entrega" />
                    <Label htmlFor="cartao_credito_entrega" className="font-black uppercase text-xs tracking-widest cursor-pointer flex items-center gap-3">
                      <CreditCard className="h-5 w-5" /> Cartão de Crédito (na entrega)
                    </Label>
                  </div>
                  <div className={cn("relative flex items-center gap-3 border-2 p-4 rounded-xl transition-all cursor-pointer", paymentMethod === 'cartao_debito_entrega' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-emerald-50 text-emerald-400')}>
                    <RadioGroupItem value="cartao_debito_entrega" id="cartao_debito_entrega" />
                    <Label htmlFor="cartao_debito_entrega" className="font-black uppercase text-xs tracking-widest cursor-pointer flex items-center gap-3">
                      <CreditCard className="h-5 w-5" /> Cartão de Débito (na entrega)
                    </Label>
                  </div>
                </>
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

      <Dialog open={showPixModal} onOpenChange={(open) => {
        if (!open && createdOrder?.public_token) {
          navigate(`/pedido/${createdOrder.public_token}`, { replace: true });
        }
        setShowPixModal(open);
      }}>
        <DialogContent className="max-w-[400px] border-2 border-emerald-500 rounded-3xl p-0 overflow-hidden bg-white sm:rounded-3xl shadow-2xl">
          <div className="bg-emerald-900 p-6 text-center border-b-4 border-emerald-400">
            <h2 className="text-xl font-black text-white uppercase tracking-tighter italic">Pagamento via Pix</h2>
          </div>
          
          <div className="p-8 flex flex-col items-center gap-6">
            {isPaid ? (
              <div className="flex flex-col items-center gap-4 py-8 animate-in zoom-in duration-500">
                <div className="h-20 w-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center">
                  <CheckCircle2 className="h-12 w-12" />
                </div>
                <h3 className="text-2xl font-black uppercase text-emerald-900 italic">Pago com Sucesso!</h3>
                <p className="text-sm text-center text-muted-foreground uppercase font-bold">Redirecionando para o acompanhamento...</p>
              </div>
            ) : (
              <>
                <div className="h-16 w-16 bg-emerald-100 rounded-2xl flex items-center justify-center text-emerald-600 mb-2">
                  <QrCode className="h-10 w-10" />
                </div>

            {pixData?.qrCodeUrl && (
              <div className="bg-white p-4 border-4 border-emerald-50 rounded-2xl shadow-xl shadow-emerald-900/10">
                <img 
                  src={pixData.qrCodeUrl.startsWith('data:') ? pixData.qrCodeUrl : `data:image/png;base64,${pixData.qrCodeUrl}`} 
                  alt="QR Code PIX" 
                  className="w-48 h-48"
                />
              </div>
            )}

            <div className="w-full space-y-3">
              <p className="text-[10px] font-black uppercase text-emerald-700 tracking-widest text-center">Pix Copia e Cola</p>
              <div className="relative group">
                <Input 
                  readOnly 
                  value={pixData?.pixCode || ""} 
                  className="h-14 border-2 border-emerald-100 rounded-xl font-bold bg-emerald-50/50 pr-4 focus-visible:ring-emerald-500 text-center"
                />
              </div>
            </div>

            <Button 
              className="w-full h-14 bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase tracking-tight rounded-xl shadow-lg shadow-emerald-200 flex items-center justify-center gap-2 text-lg transition-all active:scale-95"
              onClick={() => {
                if (pixData?.pixCode) {
                  navigator.clipboard.writeText(pixData.pixCode);
                  toast.success("Código PIX copiado!");
                }
              }}
            >
              <Copy className="h-5 w-5" /> Copiar Código Pix
            </Button>

            <p className="text-center text-[11px] font-bold text-emerald-800 leading-tight uppercase tracking-tight opacity-70 bg-emerald-50 p-4 rounded-xl border border-emerald-100">
              Após o pagamento, o seu pedido será confirmado automaticamente.
            </p>

            <div className="w-full pt-2">
              <Button 
                variant="outline"
                className="w-full h-14 border-2 border-emerald-900 text-emerald-900 font-black uppercase tracking-tighter text-lg rounded-xl hover:bg-emerald-50 transition-all active:scale-95 shadow-[4px_4px_0px_0px_rgba(6,78,59,1)]"
                onClick={() => {
                  if (createdOrder?.public_token) {
                    navigate(`/pedido/${createdOrder.public_token}`, { replace: true });
                  } else {
                    toast.error("Erro ao localizar token do pedido. Tente fechar e abrir novamente.");
                  }
                }}
              >
                Acompanhar Pedido
              </Button>
            </div>
          </>
        )}
      </div>
    </DialogContent>
      </Dialog>
    </div>
  );
};

export default PublicCheckout;
