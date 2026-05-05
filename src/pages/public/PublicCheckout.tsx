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
import { Loader2, ArrowLeft, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { formatBRL, onlyDigits } from "@/lib/format";

type Zone = { id: string; neighborhood: string; city: string | null; fee: number; min_order: number; estimated_minutes: number };

const PublicCheckout = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { items, itemSubtotal, subtotal, clear, count } = useCart();

  const [store, setStore] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // form
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [orderType, setOrderType] = useState<"entrega" | "retirada">("entrega");
  const [zoneId, setZoneId] = useState<string>("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [reference, setReference] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"pix" | "dinheiro" | "cartao_entrega" | "cartao_online">("pix");
  const [changeFor, setChangeFor] = useState("");
  const [notes, setNotes] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [coupon, setCoupon] = useState<any>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);

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

  const validateCoupon = async () => {
    if (!couponCode.trim() || !store) return;
    setValidatingCoupon(true);
    const { data } = await supabase.from("coupons").select("*").eq("store_id", store.id).eq("code", couponCode.trim().toUpperCase()).eq("is_active", true).maybeSingle();
    setValidatingCoupon(false);
    if (!data) { setCoupon(null); return toast.error("Cupom inválido"); }
    if (data.expires_at && new Date(data.expires_at) < new Date()) { setCoupon(null); return toast.error("Cupom expirado"); }
    if (data.starts_at && new Date(data.starts_at) > new Date()) { setCoupon(null); return toast.error("Cupom ainda não disponível"); }
    if (data.usage_limit && data.usage_count >= data.usage_limit) { setCoupon(null); return toast.error("Cupom esgotado"); }
    if (data.min_order_value && subtotal < Number(data.min_order_value)) { setCoupon(null); return toast.error(`Pedido mínimo ${formatBRL(data.min_order_value)}`); }
    setCoupon(data);
    toast.success("Cupom aplicado");
  };

  const submit = async () => {
    if (!store || !settings) return;
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
    if (paymentMethod === "cartao_online" && !settings.accept_card_online) return toast.error("Cartão online não aceito");

    setSubmitting(true);
    try {
      // 1. Customer (upsert by phone)
      const { data: existingCustomer } = await supabase.from("customers").select("id").eq("store_id", store.id).eq("phone", phoneDigits).maybeSingle();
      let customerId = existingCustomer?.id as string | undefined;
      if (!customerId) {
        const { data: newC, error: cErr } = await supabase.from("customers").insert({ store_id: store.id, name: name.trim(), phone: phoneDigits }).select("id").single();
        if (cErr) throw cErr;
        customerId = newC.id;
      }

      // 2. Address (if delivery)
      const deliveryAddress = orderType === "entrega"
        ? `${street.trim()}, ${number.trim()}${complement ? ` - ${complement}` : ""}`
        : null;
      const deliveryNeighborhood = orderType === "entrega" ? (zone?.neighborhood ?? null) : null;

      if (orderType === "entrega" && customerId) {
        await supabase.from("customer_addresses").insert({
          store_id: store.id, customer_id: customerId, street: street.trim(), number: number.trim(),
          complement: complement || null, reference: reference || null,
          neighborhood: zone!.neighborhood, city: zone!.city, is_default: true,
        });
      }

      // 3. Order
      const { data: order, error: oErr } = await supabase.from("orders").insert({
        store_id: store.id,
        customer_id: customerId,
        customer_name: name.trim(),
        customer_phone: phoneDigits,
        order_type: orderType,
        status: "novo",
        delivery_address: deliveryAddress,
        delivery_neighborhood: deliveryNeighborhood,
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

      // 4. Order items + options
      for (const it of items) {
        const optionsTotal = it.options.reduce((s, o) => s + Number(o.extra_price), 0);
        const { data: oi, error: iErr } = await supabase.from("order_items").insert({
          order_id: order.id, store_id: store.id, product_id: it.product_id,
          product_name: it.product_name, unit_price: it.unit_price, quantity: it.quantity,
          options_total: optionsTotal, subtotal: itemSubtotal(it), notes: it.notes ?? null,
        }).select("id").single();
        if (iErr) throw iErr;
        if (it.options.length) {
          await supabase.from("order_item_options").insert(it.options.map((o) => ({
            order_item_id: oi.id, store_id: store.id,
            option_name: o.option_name, item_name: o.item_name, extra_price: o.extra_price,
          })));
        }
      }

      // 5. Initial status history
      await supabase.from("order_status_history").insert({ order_id: order.id, store_id: store.id, status: "novo", notes: "Pedido recebido" });

      // 6. Payment placeholder
      await supabase.from("payments").insert({
        order_id: order.id, store_id: store.id, method: paymentMethod, status: "pendente", amount: total,
      });

      // 7. Notification for store
      await supabase.from("notifications").insert({
        store_id: store.id, type: "new_order",
        title: `Novo pedido #${order.order_number}`,
        message: `${name.trim()} • ${formatBRL(total)}`,
        link: `/app/pedidos`,
        metadata: { order_id: order.id },
      });

      // 8. Bump coupon usage
      if (coupon) await supabase.from("coupons").update({ usage_count: (coupon.usage_count ?? 0) + 1 }).eq("id", coupon.id);

      // 9. Se cartão online, criar Stripe Checkout e redirecionar (sem limpar carrinho ainda)
      if (paymentMethod === "cartao_online") {
        const successUrl = `${window.location.origin}/pedido/${order.public_token}/sucesso?session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${window.location.origin}/pedido/${order.public_token}/cancelado`;
        const { data: ck, error: ckErr } = await supabase.functions.invoke("create-order-checkout", {
          body: { orderId: order.id, successUrl, cancelUrl },
        });
        if (ckErr || !ck?.checkoutUrl) {
          throw new Error(ckErr?.message ?? ck?.error ?? "Falha ao iniciar pagamento online.");
        }
        clear();
        window.location.href = ck.checkoutUrl as string;
        return;
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
  if (count === 0) return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center p-6 gap-3">
      <p className="text-muted-foreground">Seu carrinho está vazio.</p>
      <Button asChild variant="hero"><Link to={`/loja/${slug}`}>Voltar ao cardápio</Link></Button>
    </div>
  );

  return (
    <div className="min-h-screen bg-background pb-32">
      <header className="sticky top-0 z-20 bg-card border-b border-border p-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild><Link to={`/loja/${slug}`}><ArrowLeft className="h-5 w-5" /></Link></Button>
        <h1 className="font-semibold">Finalizar pedido</h1>
      </header>

      <div className="container max-w-xl mx-auto p-4 space-y-4">
        <Card className="p-4 space-y-3">
          <h2 className="font-semibold text-sm">Seus dados</h2>
          <div><Label>Nome *</Label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></div>
          <div><Label>WhatsApp *</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" maxLength={15} /></div>
        </Card>

        <Card className="p-4 space-y-3">
          <h2 className="font-semibold text-sm">Modalidade</h2>
          <RadioGroup value={orderType} onValueChange={(v: any) => setOrderType(v)} className="grid grid-cols-2 gap-2">
            {settings?.allow_delivery && (
              <label className={`flex items-center gap-2 border rounded-md p-3 cursor-pointer ${orderType === "entrega" ? "border-primary bg-primary/5" : "border-border"}`}>
                <RadioGroupItem value="entrega" /> Entrega
              </label>
            )}
            {settings?.allow_pickup && (
              <label className={`flex items-center gap-2 border rounded-md p-3 cursor-pointer ${orderType === "retirada" ? "border-primary bg-primary/5" : "border-border"}`}>
                <RadioGroupItem value="retirada" /> Retirada
              </label>
            )}
          </RadioGroup>

          {orderType === "entrega" && (
            <div className="space-y-3 pt-2">
              <div>
                <Label>Bairro / Região *</Label>
                <Select value={zoneId} onValueChange={setZoneId}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    {zones.length === 0 && <div className="p-2 text-sm text-muted-foreground">Nenhuma região cadastrada</div>}
                    {zones.map((z) => (
                      <SelectItem key={z.id} value={z.id}>
                        {z.neighborhood}{z.city && ` (${z.city})`} — {Number(z.fee) === 0 ? "Grátis" : formatBRL(z.fee)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {zone?.min_order && Number(zone.min_order) > 0 && <p className="text-xs text-muted-foreground mt-1">Mínimo nesta região: {formatBRL(zone.min_order)}</p>}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2"><Label>Rua *</Label><Input value={street} onChange={(e) => setStreet(e.target.value)} maxLength={120} /></div>
                <div><Label>Nº *</Label><Input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={10} /></div>
              </div>
              <div><Label>Complemento</Label><Input value={complement} onChange={(e) => setComplement(e.target.value)} maxLength={60} /></div>
              <div><Label>Ponto de referência</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></div>
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-3">
          <h2 className="font-semibold text-sm">Pagamento</h2>
          <RadioGroup value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)} className="space-y-2">
            {settings?.accept_pix && (
              <label className={`flex items-center gap-2 border rounded-md p-3 cursor-pointer ${paymentMethod === "pix" ? "border-primary bg-primary/5" : "border-border"}`}>
                <RadioGroupItem value="pix" /> Pix
              </label>
            )}
            {settings?.accept_cash && (
              <label className={`flex items-center gap-2 border rounded-md p-3 cursor-pointer ${paymentMethod === "dinheiro" ? "border-primary bg-primary/5" : "border-border"}`}>
                <RadioGroupItem value="dinheiro" /> Dinheiro {orderType === "entrega" ? "(na entrega)" : ""}
              </label>
            )}
            {settings?.accept_card_on_delivery && (
              <label className={`flex items-center gap-2 border rounded-md p-3 cursor-pointer ${paymentMethod === "cartao_entrega" ? "border-primary bg-primary/5" : "border-border"}`}>
                <RadioGroupItem value="cartao_entrega" /> Cartão na entrega
              </label>
            )}
            {settings?.accept_card_online && (
              <label className={`flex items-center gap-2 border rounded-md p-3 cursor-pointer ${paymentMethod === "cartao_online" ? "border-primary bg-primary/5" : "border-border"}`}>
                <RadioGroupItem value="cartao_online" /> Cartão online (pagar agora)
              </label>
            )}
          </RadioGroup>
          {paymentMethod === "dinheiro" && (
            <div><Label>Troco para</Label><Input type="number" step="0.01" value={changeFor} onChange={(e) => setChangeFor(e.target.value)} placeholder="Ex: 50,00" /></div>
          )}
          {paymentMethod === "pix" && settings?.pix_key && (
            <div className="text-xs bg-muted p-3 rounded-md">
              <div className="font-medium mb-1">Chave Pix ({settings.pix_key_type ?? "chave"}):</div>
              <div className="break-all">{settings.pix_key}</div>
              <div className="mt-1 text-muted-foreground">Após pagar, envie o comprovante via WhatsApp da loja.</div>
            </div>
          )}
        </Card>

        <Card className="p-4 space-y-3">
          <h2 className="font-semibold text-sm">Cupom</h2>
          <div className="flex gap-2">
            <Input value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} placeholder="DESCONTO10" maxLength={20} />
            <Button variant="outline" onClick={validateCoupon} disabled={validatingCoupon || !couponCode.trim()}>
              {validatingCoupon ? <Loader2 className="h-4 w-4 animate-spin" /> : "Aplicar"}
            </Button>
          </div>
          {coupon && <div className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Cupom {coupon.code} aplicado: -{formatBRL(discount)}</div>}
        </Card>

        <Card className="p-4 space-y-2">
          <Label>Observações do pedido</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={300} />
        </Card>

        <Card className="p-4 space-y-2 text-sm">
          <div className="flex justify-between"><span>Subtotal</span><span>{formatBRL(subtotal)}</span></div>
          {orderType === "entrega" && <div className="flex justify-between"><span>Entrega</span><span>{deliveryFee === 0 ? "Grátis" : formatBRL(deliveryFee)}</span></div>}
          {discount > 0 && <div className="flex justify-between text-green-600"><span>Desconto</span><span>-{formatBRL(discount)}</span></div>}
          <div className="flex justify-between font-bold text-base pt-2 border-t border-border"><span>Total</span><span className="text-primary">{formatBRL(total)}</span></div>
        </Card>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border p-4">
        <div className="container max-w-xl mx-auto">
          <Button variant="hero" size="lg" className="w-full" onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Confirmar pedido • {formatBRL(total)}
          </Button>
        </div>
      </div>
    </div>
  );
};
export default PublicCheckout;
