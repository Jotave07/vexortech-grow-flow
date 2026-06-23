import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, Link, useLocation } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import { useCart, type CartItem } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2, ArrowLeft, CheckCircle2, Search, MapPin, Truck, ShoppingBag, CreditCard, Wallet, Copy, QrCode, AlertTriangle, Clock } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatBRL, onlyDigits, formatCEP, formatPhone, formatDoc } from "@/lib/format";
import { isStoreOpen } from "@/lib/opening-hours";
import { useServerFn } from "@tanstack/react-start";
import { syncPaymentStatus } from "@/functions/asaas";
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

const hasStorePixKey = (settings: any) => {
  if (!settings) return false;
  return Boolean(String(settings.pix_key || "").trim());
};

const isPixCheckoutEnabled = (settings: any) => Boolean(settings?.accept_pix && hasStorePixKey(settings));

const createBrowserIdempotencyKey = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const random = globalThis.crypto?.getRandomValues
    ? Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4))).map((part) => part.toString(16)).join("")
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `checkout-${random}`;
};

const getAvailablePaymentMethods = (settings: any): PaymentMethod[] => {
  if (!settings) return [];
  const methods: PaymentMethod[] = [];
  if (isPixCheckoutEnabled(settings)) methods.push("pix");
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
  const { user, profile, loading: authLoading } = useAuth();

  const [store, setStore] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [deliveryQuote, setDeliveryQuote] = useState<DeliveryQuote | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPixModal, setShowPixModal] = useState(false);
  const [pixData, setPixData] = useState<any>(null);
  const [createdOrder, setCreatedOrder] = useState<any>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [checkoutIdempotencyKey, setCheckoutIdempotencyKey] = useState(createBrowserIdempotencyKey);
  const syncPaymentStatusFn = useServerFn(syncPaymentStatus);

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

  useEffect(() => {
    if (!showPixModal || !createdOrder?.id || isPaid) return;

    const interval = setInterval(async () => {
      try {
        const result = await syncPaymentStatusFn({
          data: {
            orderId: createdOrder.id,
            storeId: store.id,
            publicToken: createdOrder.public_token,
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
    }, 4000);

    return () => clearInterval(interval);
  }, [showPixModal, createdOrder, store?.id, isPaid, navigate, syncPaymentStatusFn]);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      const { data: s } = await backend.from("stores").select("*").eq("slug", slug).maybeSingle();
      if (!s) { setLoading(false); return; }
      setStore(s);
      const { data: sett } = await backend.from("store_settings").select("*").eq("store_id", s.id).maybeSingle();
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
    addressOverride: { street?: string; number?: string } = {},
  ) => {
    if (!store?.id || orderType !== "entrega") return;
    const quoteStreet = addressOverride.street ?? street;
    const quoteNumber = addressOverride.number ?? number;
    let resolvedCoordinates = coords;
    if (!resolvedCoordinates && quoteStreet && quoteNumber && cty && st) {
      resolvedCoordinates = await geocodeAddressCoordinates({
        street: quoteStreet,
        number: quoteNumber,
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
      street: quoteStreet,
      number: quoteNumber,
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
        await updateDeliveryQuote(cleanCep, addr.bairro || "", addr.localidade, addr.uf, coords, {
          street: addr.logradouro || "",
          number,
        });
      }
      if (!silent) toast.success("Endereço localizado e frete atualizado.");
    } catch (e: any) {
      toast.error(e.message || "Erro ao buscar CEP");
    } finally {
      setLoadingCep(false);
    }
  }, [number, updateDeliveryQuote, zipCode]);

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
    const { data: productData, error: productError } = await backend
      .from("products")
      .select("id, name, price, promo_price, is_active, is_available")
      .eq("store_id", store.id)
      .in("id", productIds);

    if (productError) return productError.message;

    const productsById = new Map<string, any>((productData ?? []).map((product: any) => [product.id, product]));
    const { data: groupsData, error: groupsError } = await backend
      .from("product_options" as any)
      .select("id, product_id, name, is_required, min_choices, max_choices")
      .in("product_id", productIds);

    if (groupsError) return groupsError.message;

    const groups = groupsData ?? [];
    const groupIds = groups.map((group: any) => group.id);
    const { data: optionItemsData, error: optionItemsError } = groupIds.length
      ? await backend
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
    if (paymentMethod === "pix" && !isPixCheckoutEnabled(settings)) {
      return toast.error("PIX nao habilitado para esta loja.");
    }
    if (!getAvailablePaymentMethods(settings).includes(paymentMethod)) {
      return toast.error("Forma de pagamento indisponível.");
    }

    let quoteForCheckout = deliveryQuote;
    if (orderType === "entrega") {
      if (onlyDigits(zipCode).length !== 8) return toast.error("Informe um CEP válido.");
      if (!street.trim() || !number.trim()) return toast.error("Endereço incompleto");
      quoteForCheckout = await updateDeliveryQuote(onlyDigits(zipCode), neighborhood, city, state, customerCoordinates, {
        street,
        number,
      }) ?? null;
      if (!quoteForCheckout?.available) return toast.error(quoteForCheckout?.reason || "Entrega não disponível.");
    }
    if (paymentMethod === "dinheiro" && changeFor.trim() && parseMoneyInput(changeFor) < total) {
      return toast.error("Troco precisa ser maior ou igual ao total do pedido.");
    }

    setSubmitting(true);
    try {
      if (store.owner_user_id === user?.id) {
        return toast.error("Dono da loja não pode comprar de si mesmo.");
      }

      const checkoutPayload = {
        storeId: store.id,
        idempotencyKey: checkoutIdempotencyKey,
        items: items.map((item) => ({
          productId: item.product_id,
          quantity: item.quantity,
          notes: item.notes || null,
          options: item.options.map((option: any) => ({
            optionId: option.option_id,
            itemId: option.item_id,
          })),
        })),
        customer: {
          name: name.trim(),
          phone: onlyDigits(phone),
          document: onlyDigits(document),
          email: user?.email || null,
        },
        delivery: {
          type: orderType,
          zipCode: onlyDigits(zipCode),
          street,
          number,
          complement,
          neighborhood,
          city,
          state,
          regionId: quoteForCheckout?.region?.id || null,
          reference: reference.trim() || null,
          customerCoordinates,
        },
        paymentMethod,
        changeFor: paymentMethod === "dinheiro" && changeFor.trim() ? parseMoneyInput(changeFor) : null,
        couponCode: coupon?.code || null,
        notes: notes.trim() || null,
        reference: reference.trim() || null,
      };

      const { data: checkout, error: checkoutError } = await backend.functions.invoke("create-checkout-order", {
        body: checkoutPayload,
      });

      if (checkoutError) throw checkoutError;
      if (!checkout?.publicToken || !checkout?.orderId) {
        throw new Error("Pedido criado sem token publico. Tente novamente.");
      }

      const order = {
        id: checkout.orderId,
        store_id: store.id,
        public_token: checkout.publicToken,
        order_number: checkout.orderNumber,
      };

      if (paymentMethod === "pix") {
        const pixResult = checkout.payment;
        if ((pixResult as any)?.error) {
          clear();
          setCheckoutIdempotencyKey(createBrowserIdempotencyKey());
          toast.error(`Pedido criado, mas houve erro no PIX: ${(pixResult as any).error}. Voce podera tentar novamente no acompanhamento.`);
          navigate(`/pedido/${order.public_token}`, { replace: true });
          return;
        }
        setPixData(pixResult);
        setCreatedOrder(order);
        setShowPixModal(true);
        clear();
        setCheckoutIdempotencyKey(createBrowserIdempotencyKey());
        return;
      }

      clear();
      setCheckoutIdempotencyKey(createBrowserIdempotencyKey());
      toast.success("Pedido realizado!");
      navigate(`/pedido/${order.public_token}`, { replace: true });
      return;
    } catch (e: any) {
      toast.error(e.message || "Erro ao finalizar");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-background"><Loader2 className="h-8 w-8 animate-spin text-[var(--hype-green)]" /></div>;

  // Shared card style for dark theme
  const cardClass = "rounded-xl border border-border bg-card p-5";
  const headerClass = "mb-5 flex items-center gap-3 border-b border-border pb-4";
  const sectionIconClass = "flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--hype-green)]/10 text-[var(--hype-green)]";
  const sectionTitleClass = "text-lg font-bold tracking-tight text-foreground";
  const inputClass = "rounded-lg border-border bg-secondary/60 text-foreground placeholder:text-foreground/25 focus:border-[var(--hype-green)]/50 h-11 text-sm font-medium";
  const labelClass = "mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-foreground/40";

  return (
    <div className="min-h-screen bg-background pb-28 text-foreground">
      {/* Header */}
      <header className="hype-shell sticky top-0 z-20">
        <div className="flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground" asChild>
            <Link to={`/loja/${slug}`}><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <h1 className="text-base font-bold tracking-tight text-foreground">Finalizar Pedido</h1>
          <ThemeToggle className="ml-auto" />
        </div>
      </header>

      <div className="container max-w-xl mx-auto p-4 space-y-5 mt-4">
        {/* Identificação */}
        <div className={cardClass}>
          <div className={headerClass}>
            <div className={sectionIconClass}>
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <h2 className={sectionTitleClass}>Seus dados</h2>
          </div>
          <div className="space-y-4">
            <div>
              <Label className={labelClass}>Nome Completo</Label>
              <Input value={name} onChange={(e) => setName(e.target.value.toUpperCase())} className={inputClass} placeholder="COMO DEVEMOS TE CHAMAR?" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className={labelClass}>CPF ou CNPJ</Label>
                <Input value={formatDoc(document)} onChange={(e) => setDocument(e.target.value)} className={inputClass} placeholder="000.000.000-00" />
              </div>
              <div>
                <Label className={labelClass}>WhatsApp</Label>
                <Input value={formatPhone(phone)} onChange={(e) => setPhone(e.target.value)} className={inputClass} placeholder="(00) 00000-0000" />
              </div>
            </div>
          </div>
        </div>

        {/* Entrega ou Retirada */}
        <div className={cardClass}>
          <div className={headerClass}>
            <div className={sectionIconClass}>
              <Truck className="h-5 w-5" />
            </div>
            <h2 className={sectionTitleClass}>Tipo de Entrega</h2>
          </div>
          <RadioGroup value={orderType} onValueChange={(v: any) => setOrderType(v)} className="grid grid-cols-2 gap-3">
            {settings?.allow_delivery && (
              <div className={cn(
                "relative flex items-center justify-center rounded-lg border p-4 transition-all cursor-pointer",
                orderType === "entrega"
                  ? "border-[var(--hype-green)]/50 bg-[var(--hype-green)]/5 text-[var(--hype-green)]"
                  : "border-border text-foreground/40 hover:border-primary/40",
              )}>
                <RadioGroupItem value="entrega" id="entrega" className="absolute top-2 right-2 border-border" />
                <Label htmlFor="entrega" className="flex cursor-pointer flex-col items-center gap-2 text-xs font-bold uppercase tracking-wider">
                  <Truck className="h-5 w-5" /> Entrega
                </Label>
              </div>
            )}
            {settings?.allow_pickup && (
              <div className={cn(
                "relative flex items-center justify-center rounded-lg border p-4 transition-all cursor-pointer",
                orderType === "retirada"
                  ? "border-[var(--hype-green)]/50 bg-[var(--hype-green)]/5 text-[var(--hype-green)]"
                  : "border-border text-foreground/40 hover:border-primary/40",
              )}>
                <RadioGroupItem value="retirada" id="retirada" className="absolute top-2 right-2 border-border" />
                <Label htmlFor="retirada" className="flex cursor-pointer flex-col items-center gap-2 text-xs font-bold uppercase tracking-wider">
                  <ShoppingBag className="h-5 w-5" /> Retirada
                </Label>
              </div>
            )}
          </RadioGroup>

          {orderType === "entrega" && (
            <div className="mt-6 space-y-4">
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full rounded-lg border-border bg-secondary/60 text-foreground/70 hover:bg-secondary hover:text-foreground text-xs font-semibold"
                onClick={handleCurrentLocation}
                disabled={loadingLocation}
              >
                {loadingLocation ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MapPin className="mr-2 h-4 w-4" />}
                Usar minha localização atual
              </Button>

              <div>
                <Label className={labelClass}>Seu CEP</Label>
                <div className="flex gap-2">
                  <Input value={formatCEP(zipCode)} onChange={(e) => setZipCode(e.target.value)} className={inputClass} placeholder="00000-000" />
                  <Button onClick={() => void handleCepLookup()} disabled={loadingCep} className="h-11 w-11 shrink-0 rounded-lg">
                    {loadingCep ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              {deliveryQuote && (
                <div className={cn(
                  "rounded-lg border p-4 transition-all",
                  deliveryQuote.available
                    ? "border-[var(--hype-green)]/20 bg-[var(--hype-green)]/5"
                    : "border-red-500/20 bg-red-500/5",
                )}>
                  {deliveryQuote.available ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--hype-green)]">Entrega disponível</span>
                        <div className="flex items-center gap-1 text-[var(--hype-green)] font-bold text-sm">
                          <Truck className="h-4 w-4" /> {actualDeliveryFee > 0 ? formatBRL(actualDeliveryFee) : (settings?.free_delivery_above && subtotal >= Number(settings.free_delivery_above) ? `Grátis (pedido acima de ${formatBRL(Number(settings.free_delivery_above))})` : "Grátis")}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-medium text-foreground/50">
                        <div className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {deliveryQuote.distance_km ? `${deliveryQuote.distance_km.toFixed(1).replace(".", ",")} km` : deliveryQuote.region?.name || deliveryQuote.region?.neighborhood || deliveryQuote.reason}</div>
                        <div className="flex items-center gap-1"><Clock className="h-3 w-3" /> {deliveryQuote.estimated_min}-{deliveryQuote.estimated_max} min</div>
                      </div>
                      {deliveryQuote.reason && (
                        <p className="text-[11px] font-medium text-foreground/50">{deliveryQuote.reason}</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-start gap-2 text-red-400">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-xs font-bold uppercase">{deliveryQuote.reason}</p>
                        {deliveryQuote.amount_to_min && (
                          <p className="text-[10px]">Faltam {formatBRL(deliveryQuote.amount_to_min)} para atingir o mínimo.</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-3">
                  <Label className={labelClass}>Rua / Av</Label>
                  <Input value={street} onChange={(e) => setStreet(e.target.value.toUpperCase())} className={inputClass} />
                </div>
                <div>
                  <Label className={labelClass}>Nº</Label>
                  <Input value={number} onChange={(e) => setNumber(e.target.value)} className={inputClass} />
                </div>
              </div>

              <div>
                <Label className={labelClass}>Complemento (Opcional)</Label>
                <Input value={complement} onChange={(e) => setComplement(e.target.value.toUpperCase())} className={inputClass} placeholder="APTO, BLOCO, FUNDOS..." />
              </div>

              <div>
                <Label className={labelClass}>Referência para entrega (Opcional)</Label>
                <Input value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} className={inputClass} placeholder="PORTARIA, PONTO DE REFERÊNCIA..." />
              </div>
            </div>
          )}
        </div>

        {/* Pagamento */}
        <div className={cardClass}>
          <div className={headerClass}>
            <div className={sectionIconClass}>
              <CreditCard className="h-5 w-5" />
            </div>
            <h2 className={sectionTitleClass}>Pagamento</h2>
          </div>
          <div className="space-y-3">
            <RadioGroup value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethod)} className="space-y-3">
              {settings?.accept_pix && !hasStorePixKey(settings) && (
                <div className="flex items-start gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-red-400">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold uppercase">PIX não habilitado</p>
                    <p className="text-[11px]">A loja ainda não cadastrou a chave Pix para receber pedidos.</p>
                  </div>
                </div>
              )}
              {isPixCheckoutEnabled(settings) && (
                <div className={cn(
                  "relative flex items-center gap-3 rounded-lg border p-4 transition-all cursor-pointer",
                  paymentMethod === "pix" ? "border-[var(--hype-green)]/50 bg-[var(--hype-green)]/5 text-[var(--hype-green)]" : "border-border text-foreground/40 hover:border-primary/40",
                )}>
                  <RadioGroupItem value="pix" id="pix" className="border-border" />
                  <Label htmlFor="pix" className="flex cursor-pointer items-center gap-3 text-xs font-bold uppercase tracking-wider">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--hype-green)]/10 font-bold text-[var(--hype-green)]">PIX</div>
                    PIX (APROVAÇÃO DA LOJA)
                  </Label>
                </div>
              )}
              {settings?.accept_cash && (
                <div className={cn(
                  "relative flex items-center gap-3 rounded-lg border p-4 transition-all cursor-pointer",
                  paymentMethod === "dinheiro" ? "border-[var(--hype-green)]/50 bg-[var(--hype-green)]/5 text-[var(--hype-green)]" : "border-border text-foreground/40 hover:border-primary/40",
                )}>
                  <RadioGroupItem value="dinheiro" id="dinheiro" className="border-border" />
                  <Label htmlFor="dinheiro" className="flex cursor-pointer items-center gap-3 text-xs font-bold uppercase tracking-wider">
                    <Wallet className="h-5 w-5" /> Dinheiro
                  </Label>
                </div>
              )}
              {settings?.accept_card_on_delivery && (
                <>
                  <div className={cn(
                    "relative flex items-center gap-3 rounded-lg border p-4 transition-all cursor-pointer",
                    paymentMethod === "cartao_credito_entrega" ? "border-[var(--hype-green)]/50 bg-[var(--hype-green)]/5 text-[var(--hype-green)]" : "border-border text-foreground/40 hover:border-primary/40",
                  )}>
                    <RadioGroupItem value="cartao_credito_entrega" id="cartao_credito_entrega" className="border-border" />
                    <Label htmlFor="cartao_credito_entrega" className="flex cursor-pointer items-center gap-3 text-xs font-bold uppercase tracking-wider">
                      <CreditCard className="h-5 w-5" /> Cartão de Crédito (na entrega)
                    </Label>
                  </div>
                  <div className={cn(
                    "relative flex items-center gap-3 rounded-lg border p-4 transition-all cursor-pointer",
                    paymentMethod === "cartao_debito_entrega" ? "border-[var(--hype-green)]/50 bg-[var(--hype-green)]/5 text-[var(--hype-green)]" : "border-border text-foreground/40 hover:border-primary/40",
                  )}>
                    <RadioGroupItem value="cartao_debito_entrega" id="cartao_debito_entrega" className="border-border" />
                    <Label htmlFor="cartao_debito_entrega" className="flex cursor-pointer items-center gap-3 text-xs font-bold uppercase tracking-wider">
                      <CreditCard className="h-5 w-5" /> Cartão de Débito (na entrega)
                    </Label>
                  </div>
                </>
              )}
            </RadioGroup>
            {paymentMethod === "dinheiro" && (
              <div className="mt-3">
                <Label className={labelClass}>Troco para quanto?</Label>
                <Input value={changeFor} onChange={(e) => setChangeFor(e.target.value)} type="number" className={inputClass} placeholder="EX: 100" />
              </div>
            )}
          </div>
        </div>

        {/* Observações */}
        <div className={cardClass}>
          <Label className={labelClass}>Observações do Pedido</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="mt-1.5 min-h-[80px] rounded-lg border-border bg-secondary/60 text-foreground placeholder:text-foreground/25 focus:border-[var(--hype-green)]/50 text-sm font-medium"
            placeholder="EX: TIRAR CEBOLA, CAMPAINHA COM DEFEITO..."
          />
        </div>

        {/* Footer com Total */}
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-card/95 backdrop-blur-xl p-4">
          <div className="container max-w-xl mx-auto flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] font-semibold text-foreground/60">
                <span>Subtotal</span>
                <span>{formatBRL(subtotal)}</span>
              </div>
              {orderType === "entrega" && (
                <div className="flex items-center gap-2 text-[10px] font-semibold text-foreground/60">
                  <span>Entrega</span>
                  <span className={actualDeliveryFee === 0 ? "text-status-emerald" : ""}>{actualDeliveryFee > 0 ? formatBRL(actualDeliveryFee) : "Grátis"}</span>
                </div>
              )}
              {discount > 0 && (
                <div className="flex items-center gap-2 text-[10px] font-semibold text-status-emerald">
                  <span>Desconto {coupon?.code ? `(${coupon.code})` : ""}</span>
                  <span>-{formatBRL(discount)}</span>
                </div>
              )}
              <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/40 mb-0.5 mt-1">Total do Pedido</p>
              <p className="text-xl font-bold text-[var(--hype-green)]">{formatBRL(total)}</p>
            </div>
            <Button
              onClick={submit}
              disabled={submitting || items.length === 0}
              className="h-12 shrink-0 rounded-xl bg-[var(--hype-green)] px-8 font-bold text-black hover:bg-[var(--hype-green-dark)] transition-all active:scale-95 shadow-lg shadow-[var(--hype-green)]/20"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "ENVIAR PEDIDO"}
            </Button>
          </div>
        </div>
      </div>

      {/* PIX Modal */}
      <Dialog open={showPixModal} onOpenChange={(open) => {
        if (!open && !isPaid) return;
        if (!open && createdOrder?.public_token) {
          navigate(`/pedido/${createdOrder.public_token}`, { replace: true });
        }
        setShowPixModal(open);
      }}>
        <DialogContent className="max-w-[400px] border-border bg-card p-0 overflow-hidden rounded-xl">
          <div className="bg-[var(--hype-green)] p-6 text-center">
            <h2 className="text-xl font-bold text-black uppercase">Pagamento via Pix</h2>
          </div>

          <div className="p-6 flex flex-col items-center gap-5">
            {isPaid ? (
              <div className="flex flex-col items-center gap-4 py-8">
                <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--hype-green)]/20 text-[var(--hype-green)]">
                  <CheckCircle2 className="h-10 w-10" />
                </div>
                <h3 className="text-xl font-bold uppercase text-foreground">Pago com Sucesso!</h3>
                <p className="text-sm text-foreground/50">Redirecionando para o acompanhamento...</p>
              </div>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[var(--hype-green)]/10 text-[var(--hype-green)]">
                  <QrCode className="h-8 w-8" />
                </div>

                {pixData?.qrCodeUrl && (
                  <div className="rounded-xl border border-border bg-card p-4">
                    <img
                      src={pixData.qrCodeUrl.startsWith("data:") ? pixData.qrCodeUrl : `data:image/png;base64,${pixData.qrCodeUrl}`}
                      alt="QR Code PIX"
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                      className="h-48 w-48"
                    />
                  </div>
                )}

                <div className="w-full space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/40 text-center">Pix Copia e Cola</p>
                  <Input
                    readOnly
                    value={pixData?.pixCode || ""}
                    className="h-12 rounded-lg border-border bg-secondary/60 text-center text-xs text-foreground/70"
                  />
                </div>

                <Button
                  className="w-full h-12 rounded-xl bg-[var(--hype-green)] font-bold text-black hover:bg-[var(--hype-green-dark)] flex items-center justify-center gap-2 transition-all active:scale-95"
                  onClick={() => {
                    if (pixData?.pixCode) {
                      navigator.clipboard.writeText(pixData.pixCode);
                      toast.success("Código PIX copiado!");
                    }
                  }}
                >
                  <Copy className="h-4 w-4" /> Copiar Código Pix
                </Button>

                <p className="text-center text-[11px] font-medium text-foreground/40 leading-tight rounded-lg border border-border/50 bg-secondary/30 p-3">
                  Aguardando confirmação do pagamento Pix. Após o pagamento, aguarde a confirmação da loja.
                </p>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default PublicCheckout;
