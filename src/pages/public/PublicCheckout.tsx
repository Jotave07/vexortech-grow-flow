import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useCart, type CartItem } from "@/contexts/CartContext";
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
import { notifyOrderCreated } from "@/functions/evolution";
import { fetchAddressByCep } from "@/services/cep/viacepService";
import { fetchAddressFromCurrentLocation, geocodeAddressCoordinates, type AddressCoordinates } from "@/services/viacep";
import { calculateDeliveryQuote } from "@/services/delivery/deliveryQuoteService";
import { DeliveryQuote } from "@/types/delivery";
import { cn } from "@/lib/utils";

const toCents = (value: number | string | null | undefined) => Math.round(Number(value ?? 0) * 100);

const parseMoneyInput = (value: string) => Number(value.replace(/[^\d,.-]/g, "").replace(",", ".")) || 0;

const optionLimits = (group: any) => {
  const min = Math.max(group.is_required ? 1 : 0, Number(group.min_choices || 0));
  const max = Math.max(min, Number(group.max_choices || 1));
  return { min, max };
};

type PaymentMethod = "pix" | "dinheiro" | "cartao_credito_entrega" | "cartao_debito_entrega";

const getAvailablePaymentMethods = (settings: any): PaymentMethod[] => {
  if (!settings) return [];
  const methods: PaymentMethod[] = [];
  if (settings.accept_pix) methods.push("pix");
  if (settings.accept_cash) methods.push("dinheiro");
  if (settings.accept_card_on_delivery) {
    methods.push("cartao_credito_entrega", "cartao_debito_entrega");
  }
  return methods;
};

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
  const notifyOrderCreatedFn = useServerFn(notifyOrderCreated);

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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("pix");
  const [changeFor, setChangeFor] = useState("");
  const [notes, setNotes] = useState("");
  const [coupon, setCoupon] = useState<any>(null);
  const [loadingCep, setLoadingCep] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [lastResolvedCep, setLastResolvedCep] = useState("");
  const [customerCoordinates, setCustomerCoordinates] = useState<AddressCoordinates | null>(null);


  useEffect(() => {
    if (slug) setStoreSlug(slug);
  }, [slug, setStoreSlug]);

  useEffect(() => {
    if (!authLoading && !user) {
      toast.info("Você precisa estar logado para finalizar o pedido.");
      navigate(`/entrar?redirect=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    }
  }, [user, authLoading, navigate, location.pathname, location.search]);

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

  useEffect(() => {
    if (!settings) return;
    if (!settings.allow_delivery && settings.allow_pickup) {
      setOrderType("retirada");
    }
  }, [settings]);

  useEffect(() => {
    if (!settings) return;
    const availableMethods = getAvailablePaymentMethods(settings);
    if (availableMethods.length && !availableMethods.includes(paymentMethod)) {
      setPaymentMethod(availableMethods[0]);
    }
  }, [settings, paymentMethod]);

  const updateDeliveryQuote = useCallback(async (
    zip: string,
    neigh: string,
    cty: string,
    st: string,
    coords: AddressCoordinates | null = customerCoordinates,
  ) => {
    if (!store?.id || orderType !== "entrega") return;
    let resolvedCoordinates = coords;
    if (!resolvedCoordinates && street && number && cty && st) {
      resolvedCoordinates = await geocodeAddressCoordinates({
        street,
        number,
        neighborhood: neigh,
        city: cty,
        state: st,
        zipCode: zip,
      });
      if (resolvedCoordinates) setCustomerCoordinates(resolvedCoordinates);
    }

    const quote = await calculateDeliveryQuote({
      storeId: store.id,
      cep: zip,
      neighborhood: neigh,
      city: cty,
      state: st,
      subtotal,
      street,
      number,
      customerCoordinates: resolvedCoordinates,
      store,
      settings,
    });
    setDeliveryQuote(quote);
    if (quote.region?.id) {
      setZoneId(quote.region.id);
    } else {
      setZoneId("");
    }
    return quote;
  }, [customerCoordinates, number, orderType, settings, store, street, subtotal]);

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
  }, [orderType, zipCode, neighborhood, city, state, street, number, itemSubtotal, store?.id, updateDeliveryQuote]);

  const handleCepLookup = useCallback(async (cepOverride?: string, silent = false) => {
    const cleanCep = onlyDigits(cepOverride ?? zipCode);
    if (cleanCep.length !== 8) return;
    setLoadingCep(true);
    try {
      const addr = await fetchAddressByCep(cleanCep);
      setZipCode(cleanCep);
      setStreet(addr.logradouro || "");
      setNeighborhood(addr.bairro || "");
      setCity(addr.localidade || "");
      setState(addr.uf || "");
      const coords = addr.lat && addr.lng ? { lat: addr.lat, lng: addr.lng } : null;
      setCustomerCoordinates(coords);
      setLastResolvedCep(cleanCep);
      
      if (addr.localidade && addr.uf) {
        await updateDeliveryQuote(cleanCep, addr.bairro || "", addr.localidade, addr.uf, coords);
      }
      if (!silent) toast.success("Endereço localizado e frete atualizado.");
    } catch (e: any) {
      toast.error(e.message || "Erro ao buscar CEP");
    } finally {
      setLoadingCep(false);
    }
  }, [updateDeliveryQuote, zipCode]);

  const handleCurrentLocation = async () => {
    setLoadingLocation(true);
    try {
      const addr = await fetchAddressFromCurrentLocation();
      const cleanCep = onlyDigits(addr.cep);
      setZipCode(cleanCep);
      setStreet(addr.street || "");
      setNeighborhood(addr.neighborhood || "");
      setCity(addr.city || "");
      setState(addr.state || "");
      setCustomerCoordinates(addr.lat && addr.lng ? { lat: addr.lat, lng: addr.lng } : null);
      setLastResolvedCep(cleanCep);
      if (addr.city && addr.state) {
        await updateDeliveryQuote(cleanCep, addr.neighborhood || "", addr.city, addr.state, addr.lat && addr.lng ? { lat: addr.lat, lng: addr.lng } : null);
      }
      toast.success("Localização definida e frete atualizado.");
    } catch (e: any) {
      toast.error(e.message || "Não foi possível usar sua localização.");
    } finally {
      setLoadingLocation(false);
    }
  };

  useEffect(() => {
    const cleanCep = onlyDigits(zipCode);
    if (orderType !== "entrega" || cleanCep.length !== 8 || cleanCep === lastResolvedCep) return;
    const timer = window.setTimeout(() => {
      void handleCepLookup(cleanCep, true);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [handleCepLookup, lastResolvedCep, orderType, zipCode]);

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

  const validateCartForCheckout = async () => {
    if (!store?.id) return "Loja não carregada. Atualize a página e tente novamente.";
    if (!items.length) return "Seu carrinho está vazio.";

    for (const item of items) {
      if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
        return `Quantidade inválida em "${item.product_name}".`;
      }
    }

    const productIds = [...new Set(items.map((item) => item.product_id))];
    const { data: productData, error: productError } = await supabase
      .from("products")
      .select("id, name, price, promo_price, is_active, is_available")
      .eq("store_id", store.id)
      .in("id", productIds);

    if (productError) return productError.message;

    const productsById = new Map((productData ?? []).map((product: any) => [product.id, product]));
    const { data: groupsData, error: groupsError } = await supabase
      .from("product_options" as any)
      .select("id, product_id, name, is_required, min_choices, max_choices")
      .in("product_id", productIds);

    if (groupsError) return groupsError.message;

    const groups = groupsData ?? [];
    const groupIds = groups.map((group: any) => group.id);
    const { data: optionItemsData, error: optionItemsError } = groupIds.length
      ? await supabase
        .from("product_option_items" as any)
        .select("id, option_id, name, extra_price, is_active")
        .in("option_id", groupIds)
      : { data: [], error: null };

    if (optionItemsError) return optionItemsError.message;

    const optionItems = optionItemsData ?? [];

    for (const cartItem of items as CartItem[]) {
      const product = productsById.get(cartItem.product_id);
      if (!product) return `Produto "${cartItem.product_name}" não encontrado no cardápio.`;
      if (!product.is_active || product.is_available === false) return `Produto "${product.name}" está indisponível no momento.`;

      const currentUnitPrice = Number(product.promo_price ?? product.price);
      if (toCents(currentUnitPrice) !== toCents(cartItem.unit_price)) {
        return `O preço de "${product.name}" foi alterado. Remova e adicione o produto novamente.`;
      }

      const productGroups = groups.filter((group: any) => group.product_id === cartItem.product_id);
      const selectedByGroup = cartItem.options.reduce<Record<string, typeof cartItem.options>>((acc, option) => {
        acc[option.option_id] = [...(acc[option.option_id] ?? []), option];
        return acc;
      }, {});

      for (const group of productGroups) {
        const { min, max } = optionLimits(group);
        const activeGroupItems = optionItems.filter((option: any) => option.option_id === group.id && option.is_active !== false);
        const selected = selectedByGroup[group.id] ?? [];

        if (min > 0 && activeGroupItems.length === 0) {
          return `Produto "${product.name}" está sem opções disponíveis para "${group.name}".`;
        }
        if (selected.length < min) {
          return `Falta escolher "${group.name}" em "${product.name}".`;
        }
        if (selected.length > max) {
          return `Limite de "${group.name}" excedido em "${product.name}".`;
        }
      }

      for (const selectedOption of cartItem.options) {
        const group = productGroups.find((candidate: any) => candidate.id === selectedOption.option_id);
        if (!group) return `Opção inválida em "${product.name}". Remova e adicione o produto novamente.`;

        const currentOption = optionItems.find((option: any) => option.id === selectedOption.item_id);
        if (!currentOption || currentOption.option_id !== selectedOption.option_id || currentOption.is_active === false) {
          return `A opção "${selectedOption.item_name}" não está mais disponível.`;
        }
        if (toCents(currentOption.extra_price) !== toCents(selectedOption.extra_price)) {
          return `O preço de "${selectedOption.item_name}" foi alterado. Remova e adicione o produto novamente.`;
        }
      }
    }

    return null;
  };

  const submit = async () => {
    if (!store || !settings) return;
    
    if (store.is_suspended) return toast.error("Loja suspensa.");
    if (!isStoreOpen(settings.business_hours, settings.is_open) && !settings.accept_orders_when_closed) {
      return toast.error("Loja fechada.");
    }

    if (!name.trim()) return toast.error("Informe seu nome");
    if (onlyDigits(phone).length < 10) return toast.error("WhatsApp inválido");
    if (!getAvailablePaymentMethods(settings).includes(paymentMethod)) {
      return toast.error("Forma de pagamento indisponível.");
    }
    if (onlyDigits(document).length < 11 && paymentMethod === "pix") return toast.error("CPF/CNPJ obrigatório para pagamento via PIX");
    
    if (orderType === "entrega") {
      if (!deliveryQuote?.available) return toast.error(deliveryQuote?.reason || "Entrega não disponível.");
      if (!street.trim() || !number.trim()) return toast.error("Endereço incompleto");
    }
    if (paymentMethod === "dinheiro" && changeFor.trim() && parseMoneyInput(changeFor) < total) {
      return toast.error("Troco precisa ser maior ou igual ao total do pedido.");
    }

    setSubmitting(true);
    try {
      if (store.owner_user_id === user?.id) {
        return toast.error("Dono da loja não pode comprar de si mesmo.");
      }

      const cartValidationError = await validateCartForCheckout();
      if (cartValidationError) return toast.error(cartValidationError);

      // Garante um cliente exclusivo para este usuário nesta loja, sem misturar históricos por telefone.
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
          const { error: updateCustomerError } = await supabase
            .from("customers")
            .update({
              full_name: name.trim().toUpperCase(),
              phone: onlyDigits(phone),
              document: onlyDigits(document),
              street: street.toUpperCase(),
              number,
              neighborhood: neighborhood.toUpperCase(),
              city: city.toUpperCase(),
              state: state.toUpperCase(),
              zip_code: onlyDigits(zipCode),
              registration_completed: true,
            })
            .eq("id", customerId);

          if (updateCustomerError) throw updateCustomerError;
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
          
          if (cErr) throw cErr;
          customerId = newCustomer?.id ?? null;
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
        change_for: paymentMethod === "dinheiro" && changeFor.trim() ? parseMoneyInput(changeFor) : null,
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
        distance_km: deliveryQuote?.distance_km || null,
      }).select("id, public_token").maybeSingle() as any);
      
      if (oErr) throw oErr;
      if (!order || !order.public_token) {
        throw new Error("Erro ao gerar token do pedido. Tente novamente.");
      }

      for (const it of items) {
        const itemPayload = {
          order_id: order.id, store_id: store.id, product_id: it.product_id,
          product_name: it.product_name, unit_price: it.unit_price, quantity: it.quantity,
          notes: it.notes || null,
        };
        let orderItemResult = await (supabase.from("order_items" as any).insert(itemPayload).select("id").single() as any);
        if (orderItemResult.error?.message?.includes("notes")) {
          const legacyPayload = { ...itemPayload };
          delete (legacyPayload as any).notes;
          orderItemResult = await (supabase.from("order_items" as any).insert(legacyPayload).select("id").single() as any);
        }
        if (orderItemResult.error) throw orderItemResult.error;
        const oi = orderItemResult.data;
        
        if (it.options.length) {
          await supabase.from("order_item_options" as any).insert(it.options.map((o: any) => ({
            order_item_id: oi.id, option_name: o.option_name, item_name: o.item_name, extra_price: o.extra_price,
            name: o.item_name, option_item_id: o.item_id
          })));
        }
      }

      await notifyOrderCreatedFn({ data: { orderId: order.id } }).catch((error) => {
        console.warn("Evolution notification skipped:", error);
        return null;
      });

      if (paymentMethod === "pix") {
        const pixResult = await createOrderPaymentFn({ data: { orderId: order.id, storeId: store.id } }).catch(e => ({ error: e.message }));
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

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-muted"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="min-h-screen bg-[#f6f7f2] pb-32">
      <header className="sticky top-0 z-20 bg-white text-slate-950 p-4 flex items-center gap-3 border-b border-border shadow-sm">
        <Button variant="ghost" size="icon" className="text-slate-700 hover:bg-muted" asChild>
          <Link to={`/loja/${slug}`}><ArrowLeft className="h-5 w-5" /></Link>
        </Button>
        <h1 className="font-black uppercase tracking-tighter italic">Finalizar Pedido</h1>
      </header>

      <div className="container max-w-xl mx-auto p-4 space-y-6 mt-4">
        {/* Identificação */}
        <Card className="p-6 border border-border shadow-panel bg-white overflow-hidden">
          <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
            <div className="h-10 w-10 bg-primary/10 flex items-center justify-center text-primary">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <h2 className="font-black text-xl uppercase tracking-tight italic text-slate-950">Seus dados</h2>
          </div>
          <div className="space-y-4">
            <div>
              <Label className="uppercase text-[10px] font-black tracking-widest text-muted-foreground">Nome Completo</Label>
              <Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} className="border border-border focus:border-primary h-12 font-bold" placeholder="COMO DEVEMOS TE CHAMAR?" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="uppercase text-[10px] font-black tracking-widest text-muted-foreground">CPF ou CNPJ</Label>
                <Input value={formatDoc(document)} onChange={(e) => setDocument(e.target.value)} className="border border-border focus:border-primary h-12 font-bold" placeholder="000.000.000-00" />
              </div>
              <div>
                <Label className="uppercase text-[10px] font-black tracking-widest text-muted-foreground">WhatsApp</Label>
                <Input value={formatPhone(phone)} onChange={(e) => setPhone(e.target.value)} className="border border-border focus:border-primary h-12 font-bold" placeholder="(00) 00000-0000" />
              </div>
            </div>
          </div>
        </Card>

        {/* Entrega ou Retirada */}
        <Card className="p-6 border border-border shadow-panel bg-white">
          <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
            <div className="h-10 w-10 bg-primary/10 flex items-center justify-center text-primary">
              <Truck className="h-6 w-6" />
            </div>
            <h2 className="font-black text-xl uppercase tracking-tight italic text-slate-950">Tipo de Entrega</h2>
          </div>
          <RadioGroup value={orderType} onValueChange={(v: any) => setOrderType(v)} className="grid grid-cols-2 gap-4">
            {settings?.allow_delivery && (
              <div className={cn("relative flex items-center justify-center border p-4 transition-all cursor-pointer", orderType === 'entrega' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground')}>
                <RadioGroupItem value="entrega" id="entrega" className="absolute top-2 right-2" />
                <Label htmlFor="entrega" className="font-black uppercase text-xs tracking-widest cursor-pointer flex flex-col items-center gap-2">
                  <Truck className="h-5 w-5" /> Entrega
                </Label>
              </div>
            )}
            {settings?.allow_pickup && (
              <div className={cn("relative flex items-center justify-center border p-4 transition-all cursor-pointer", orderType === 'retirada' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground')}>
                <RadioGroupItem value="retirada" id="retirada" className="absolute top-2 right-2" />
                <Label htmlFor="retirada" className="font-black uppercase text-xs tracking-widest cursor-pointer flex flex-col items-center gap-2">
                  <ShoppingBag className="h-5 w-5" /> Retirada
                </Label>
              </div>
            )}
          </RadioGroup>

          {orderType === "entrega" && (
            <div className="mt-8 space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
              <Button
                type="button"
                variant="outline"
                className="h-12 w-full border-border bg-white text-primary font-bold uppercase tracking-widest"
                onClick={handleCurrentLocation}
                disabled={loadingLocation}
              >
                {loadingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                Usar minha localização atual
              </Button>

              <div>
                <Label className="uppercase text-[10px] font-black tracking-widest text-muted-foreground">Seu CEP</Label>
                <div className="flex gap-2">
                  <Input value={formatCEP(zipCode)} onChange={(e) => setZipCode(e.target.value)} className="border border-border focus:border-primary h-12 font-bold" placeholder="00000-000" />
                  <Button onClick={() => void handleCepLookup()} disabled={loadingCep} className="h-12 w-12 shrink-0">
                    {loadingCep ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
                  </Button>
                </div>
              </div>

              {deliveryQuote && (
                <div className={cn("p-4 border transition-all", deliveryQuote.available ? "bg-primary/5 border-primary/20" : "bg-red-50 border-red-100")}>
                  {deliveryQuote.available ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase text-primary tracking-widest">Entrega disponível</span>
                        <div className="flex items-center gap-1 text-primary font-black text-sm">
                          <Truck className="h-4 w-4" /> {formatBRL(deliveryQuote.fee)}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-bold text-slate-700">
                        <div className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {deliveryQuote.distance_km ? `${deliveryQuote.distance_km.toFixed(1).replace(".", ",")} km` : deliveryQuote.region?.name || deliveryQuote.region?.neighborhood || deliveryQuote.reason}</div>
                        <div className="flex items-center gap-1"><Clock className="h-3 w-3" /> {deliveryQuote.estimated_min}-{deliveryQuote.estimated_max} min</div>
                      </div>
                      {deliveryQuote.reason && (
                        <p className="text-[11px] font-semibold text-slate-600">{deliveryQuote.reason}</p>
                      )}
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
                  <Label className="uppercase text-[10px] font-black tracking-widest text-muted-foreground">Rua / Av</Label>
                  <Input value={street} onChange={(e) => setStreet(e.target.value.toUpperCase())} className="border border-border focus:border-primary h-12 font-bold" />
                </div>
                <div>
                  <Label className="uppercase text-[10px] font-black tracking-widest text-muted-foreground">Nº</Label>
                  <Input value={number} onChange={(e) => setNumber(e.target.value)} className="border border-border focus:border-primary h-12 font-bold" />
                </div>
              </div>

              <div>
                <Label className="uppercase text-[10px] font-black tracking-widest text-muted-foreground">Complemento (Opcional)</Label>
                <Input value={complement} onChange={(e) => setComplement(e.target.value.toUpperCase())} className="border border-border focus:border-primary h-12 font-bold" placeholder="APTO, BLOCO, FUNDOS..." />
              </div>
            </div>
          )}
        </Card>

        {/* Pagamento */}
        <Card className="p-6 border border-border shadow-panel bg-white">
          <div className="mb-6 flex items-center gap-3 border-b border-border pb-4">
            <div className="h-10 w-10 bg-primary/10 flex items-center justify-center text-primary">
              <CreditCard className="h-6 w-6" />
            </div>
            <h2 className="font-black text-xl uppercase tracking-tight italic text-slate-950">Pagamento</h2>
          </div>
          <div className="space-y-4">
            <RadioGroup value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)} className="space-y-3">
              {settings?.accept_pix && (
                <div className={cn("relative flex items-center gap-3 border p-4 transition-all cursor-pointer", paymentMethod === 'pix' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground')}>
                  <RadioGroupItem value="pix" id="pix" />
                  <Label htmlFor="pix" className="font-black uppercase text-xs tracking-widest cursor-pointer flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-black">PIX</div>
                    PIX (LIBERAÇÃO IMEDIATA)
                  </Label>
                </div>
              )}
              {settings?.accept_cash && (
                <div className={cn("relative flex items-center gap-3 border p-4 transition-all cursor-pointer", paymentMethod === 'dinheiro' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground')}>
                  <RadioGroupItem value="dinheiro" id="dinheiro" />
                  <Label htmlFor="dinheiro" className="font-black uppercase text-xs tracking-widest cursor-pointer flex items-center gap-3">
                    <Wallet className="h-5 w-5" /> Dinheiro
                  </Label>
                </div>
              )}
              {settings?.accept_card_on_delivery && (
                <>
                  <div className={cn("relative flex items-center gap-3 border p-4 transition-all cursor-pointer", paymentMethod === 'cartao_credito_entrega' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground')}>
                    <RadioGroupItem value="cartao_credito_entrega" id="cartao_credito_entrega" />
                    <Label htmlFor="cartao_credito_entrega" className="font-black uppercase text-xs tracking-widest cursor-pointer flex items-center gap-3">
                      <CreditCard className="h-5 w-5" /> Cartão de Crédito (na entrega)
                    </Label>
                  </div>
                  <div className={cn("relative flex items-center gap-3 border p-4 transition-all cursor-pointer", paymentMethod === 'cartao_debito_entrega' ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground')}>
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
                <Label className="uppercase text-[10px] font-black tracking-widest text-muted-foreground">Troco para quanto?</Label>
                <Input value={changeFor} onChange={(e) => setChangeFor(e.target.value)} type="number" className="border border-border h-12 font-bold" placeholder="EX: 100" />
              </div>
            )}
          </div>
        </Card>

        {/* Observações */}
        <Card className="p-6 border border-border shadow-panel bg-white">
          <Label className="uppercase text-[10px] font-black tracking-widest text-muted-foreground mb-2 block">Observações do Pedido</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="border border-border focus:border-primary font-bold min-h-[100px]" placeholder="EX: TIRAR CEBOLA, CAMPAINHA COM DEFEITO..." />
        </Card>

        {/* Footer com Total */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-border z-30 shadow-2xl">
          <div className="container max-w-xl mx-auto flex items-center justify-between gap-4">
            <div className="text-slate-950">
              <p className="text-[10px] uppercase font-black text-muted-foreground tracking-widest leading-none mb-1 italic">Total do Pedido</p>
              <p className="text-2xl font-black tracking-tighter text-slate-950">{formatBRL(total)}</p>
            </div>
            <Button onClick={submit} disabled={submitting || items.length === 0} className="bg-primary hover:bg-primary/90 text-primary-foreground px-8 h-14 font-black uppercase tracking-tighter text-lg rounded-xl shadow-lg transition-transform active:scale-95">
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
        <DialogContent className="max-w-[400px] border border-primary p-0 overflow-hidden bg-white sm:rounded-3xl shadow-2xl">
          <div className="bg-primary p-6 text-center border-b border-primary/20">
            <h2 className="text-xl font-black text-primary-foreground uppercase tracking-tighter italic">Pagamento via Pix</h2>
          </div>
          
          <div className="p-8 flex flex-col items-center gap-6">
            {isPaid ? (
              <div className="flex flex-col items-center gap-4 py-8 animate-in zoom-in duration-500">
                <div className="h-20 w-20 bg-primary/10 text-primary flex items-center justify-center">
                  <CheckCircle2 className="h-12 w-12" />
                </div>
                <h3 className="text-2xl font-black uppercase text-slate-950 italic">Pago com Sucesso!</h3>
                <p className="text-sm text-center text-muted-foreground uppercase font-bold">Redirecionando para o acompanhamento...</p>
              </div>
            ) : (
              <>
                <div className="h-16 w-16 bg-primary/10 flex items-center justify-center text-primary mb-2">
                  <QrCode className="h-10 w-10" />
                </div>

            {pixData?.qrCodeUrl && (
              <div className="bg-white p-4 border border-border shadow-panel">
                <img 
                  src={pixData.qrCodeUrl.startsWith('data:') ? pixData.qrCodeUrl : `data:image/png;base64,${pixData.qrCodeUrl}`} 
                  alt="QR Code PIX" 
                  className="w-48 h-48"
                />
              </div>
            )}

            <div className="w-full space-y-3">
              <p className="text-[10px] font-black uppercase text-muted-foreground tracking-widest text-center">Pix Copia e Cola</p>
              <div className="relative group">
                <Input 
                  readOnly 
                  value={pixData?.pixCode || ""} 
                  className="h-14 border border-border font-bold bg-muted/70 pr-4 focus-visible:ring-primary text-center"
                />
              </div>
            </div>

            <Button 
              className="w-full h-14 bg-primary hover:bg-primary/90 text-primary-foreground font-black uppercase tracking-tight rounded-xl shadow-panel flex items-center justify-center gap-2 text-lg transition-all active:scale-95"
              onClick={() => {
                if (pixData?.pixCode) {
                  navigator.clipboard.writeText(pixData.pixCode);
                  toast.success("Código PIX copiado!");
                }
              }}
            >
              <Copy className="h-5 w-5" /> Copiar Código Pix
            </Button>

            <p className="text-center text-[11px] font-bold text-muted-foreground leading-tight uppercase tracking-tight opacity-80 bg-muted p-4 border border-border">
              Após o pagamento, o seu pedido será confirmado automaticamente.
            </p>

            <div className="w-full pt-2">
              <Button 
                variant="outline"
                className="w-full h-14 border border-primary text-primary font-black uppercase tracking-tighter text-lg rounded-xl hover:bg-muted transition-all active:scale-95 shadow-panel"
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


