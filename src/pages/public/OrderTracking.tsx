import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MapPin, Clock, CheckCircle2, Circle, MessageSquare, Copy, QrCode, Check, Bike, ChefHat, PackageCheck, Wallet, Star, X } from "lucide-react";
import { formatBRL, STATUS_LABELS, PAYMENT_METHOD_LABELS, buildWhatsAppLink, formatDeliveryAddressLines } from "@/lib/format";
import { useServerFn } from "@tanstack/react-start";
import { getOrderPaymentInfo, syncPaymentStatus } from "@/functions/asaas";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const STEPS = ["aguardando_pagamento", "novo", "confirmado", "em_preparo", "saiu_para_entrega", "entregue"] as const;
const STEPS_PICKUP = ["aguardando_pagamento", "novo", "confirmado", "em_preparo", "pronto_para_retirada", "entregue"] as const;

const TRACKING_STEPS = [
  { id: "payment", label: "Pagamento", icon: Wallet, statuses: ["aguardando_pagamento"] },
  { id: "preparing", label: "Na Cozinha", icon: ChefHat, statuses: ["novo", "confirmado", "em_preparo"] },
  { id: "route", label: "Em Rota", icon: Bike, statuses: ["saiu_para_entrega", "pronto_para_retirada"] },
  { id: "delivered", label: "Entregue", icon: PackageCheck, statuses: ["entregue"] },
];

const OrderTracking = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pixInfo, setPixInfo] = useState<any>(null);
  const [isPaidSuccess, setIsPaidSuccess] = useState(false);
  const lastStatus = useRef<string | null>(null);
  const pixInfoRef = useRef<any>(null);

  // Review dialog state
  const [showReview, setShowReview] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const reviewShownRef = useRef(false);
  const { user } = useAuth();
  const getOrderPaymentInfoFn = useServerFn(getOrderPaymentInfo);
  const syncPaymentStatusFn = useServerFn(syncPaymentStatus);

  useEffect(() => {
    pixInfoRef.current = pixInfo;
  }, [pixInfo]);

  const load = useCallback(async (isAutoRefresh = false) => {
    if (!token || token === "undefined") return;

    try {
      const { data: o, error: oErr } = await backend.rpc("get_public_order", { _token: token });
      if (oErr) {
        if (import.meta.env.DEV) console.warn("Pedido não encontrado ou indisponível:", oErr.message);
        throw oErr;
      }

      const orderData = o?.[0] ?? null;
      if (!orderData) {
        if (import.meta.env.DEV) console.warn("No order found for token:", token);
        setOrder(null);
        setLoading(false);
        return;
      }

      if (lastStatus.current === "aguardando_pagamento" && orderData.status !== "aguardando_pagamento") {
        setIsPaidSuccess(true);
        confetti({
          particleCount: 150,
          spread: 70,
          origin: { y: 0.6 },
          colors: ["#10b981", "#059669", "#34d399"],
        });
        setTimeout(() => setIsPaidSuccess(false), 5000);
      }

      lastStatus.current = orderData.status;
      setOrder(orderData);

      const [{ data: it }, { data: h }] = await Promise.all([
        backend.rpc("get_public_order_items", { _token: token }),
        backend.rpc("get_public_order_status_history", { _token: token }),
      ]);

      setItems(it ?? []);
      setHistory(h ?? []);

      if (orderData.status === "entregue") {
        const { data: existingReview } = await backend
          .from("store_reviews" as any)
          .select("id, rating, comment")
          .eq("order_id", orderData.id)
          .maybeSingle();

        if (existingReview) {
          setReviewSubmitted(true);
          setReviewRating(Number((existingReview as any).rating || 0));
          setReviewComment(String((existingReview as any).comment || ""));
        } else if (!reviewShownRef.current) {
          setShowReview(true);
          reviewShownRef.current = true;
        }
      }

      if (orderData.payment_method === "pix" && orderData.status === "aguardando_pagamento" && !pixInfoRef.current) {
        try {
          const info = await getOrderPaymentInfoFn({ data: { orderId: orderData.id, storeId: orderData.store_id, publicToken: token } });
          setPixInfo(info);
        } catch (e) {
          if (import.meta.env.DEV) console.warn("Não foi possível carregar o PIX:", e);
        }
      }
    } catch (e: any) {
      if (import.meta.env.DEV) console.warn("Não foi possível carregar o pedido:", e?.message || e);
      if (!isAutoRefresh) {
        toast.error("Erro ao carregar dados do pedido");
      }
    } finally {
      setLoading(false);
    }
  }, [token, getOrderPaymentInfoFn]);

  useEffect(() => {
    if (!token) return;
    void load();

    const channel = backend
      .channel(`order-tracking-${token}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `public_token=eq.${token}`,
        },
        (payload) => {
          if (import.meta.env.DEV) console.debug("Order updated:", payload.new);
          const newOrder = payload.new as any;
          setOrder((prev: any) => ({ ...prev, ...newOrder }));

          if (newOrder.status === "novo" || newOrder.payment_status === "pago") {
            toast.success("Pagamento confirmado!");
          }

          void load();
        },
      )
      .subscribe();

    const interval = setInterval(load, 30000);

    return () => {
      void backend.removeChannel(channel);
      clearInterval(interval);
    };
  }, [token, load]);

  useEffect(() => {
    if (order?.status !== "aguardando_pagamento" || !order?.id) return;

    const interval = setInterval(async () => {
      try {
        const result = await syncPaymentStatusFn({ data: { orderId: order.id, storeId: order.store_id, publicToken: token } });
        if (result.status === "paid") {
          void load();
        }
      } catch (e) {
        if (import.meta.env.DEV) console.warn("Sync error:", e);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [order?.status, order?.id, order?.store_id, syncPaymentStatusFn, load, token]);

  const copyPix = () => {
    if (pixInfo?.pixCode) {
      navigator.clipboard.writeText(pixInfo.pixCode);
      toast.success("Código PIX copiado!");
    }
  };

  const submitReview = async () => {
    if (!order || order.status !== "entregue") return;
    if (!user) {
      toast.info("Entre com a conta usada no pedido para avaliar.");
      navigate(`/entrar?redirect=/pedido/${token}`);
      return;
    }
    if (reviewRating < 1 || reviewRating > 5) {
      toast.error("Escolha uma nota de 1 a 5.");
      return;
    }

    setReviewSubmitting(true);
    const { error } = await backend
      .from("store_reviews" as any)
      .upsert({
        store_id: order.store_id,
        order_id: order.id,
        rating: reviewRating,
        comment: reviewComment.trim() || null,
        is_visible: true,
      }, { onConflict: "order_id" })
      .select("id")
      .maybeSingle();
    setReviewSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setReviewSubmitted(true);
    setShowReview(false);
    toast.success("Avaliacao enviada. Obrigado!");
  };

  // Shared dark card style
  const cardClass = "rounded-xl border border-border bg-card p-5";

  if (loading) return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-[var(--hype-green)]" />
    </div>
  );

  if (!order || !token || token === "undefined") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-4 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-secondary/60">
          <Circle className="h-8 w-8 text-foreground/20" />
        </div>
        <h1 className="text-xl font-bold uppercase text-foreground">Pedido não encontrado</h1>
        <p className="mt-2 max-w-xs text-sm text-foreground/40">
          {!token || token === "undefined"
            ? "O link do pedido parece estar incompleto. Por favor, feche esta aba e tente novamente pelo checkout."
            : "Não conseguimos localizar as informações deste pedido. Verifique o link ou entre em contato com a loja."}
        </p>
        <Button variant="outline" onClick={() => window.location.reload()} className="mt-4 rounded-lg border-border text-foreground/70 hover:bg-secondary hover:text-foreground">
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
      {/* Payment success overlay */}
      {isPaidSuccess && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/90 backdrop-blur-sm">
          <div className="max-w-sm space-y-4 p-6 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--hype-green)]/20 text-[var(--hype-green)] shadow-lg">
              <Check className="h-8 w-8 stroke-[3px]" />
            </div>
            <h2 className="text-2xl font-bold uppercase text-foreground">Pagamento Confirmado!</h2>
            <p className="text-sm font-medium text-foreground/50">Seu pedido já foi enviado para a cozinha.</p>
            <Button onClick={() => setIsPaidSuccess(false)} variant="hero" className="w-full rounded-xl">
              Acompanhar Preparo
            </Button>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="relative overflow-hidden border-b border-[var(--hype-green)]/30 bg-card p-6 text-center">
        <div className="absolute right-3 top-3">
          <Badge variant="outline" className="border-border/80 text-foreground/40 text-[9px] font-bold uppercase tracking-wider">
            Live Tracking
          </Badge>
        </div>
        {order.store_logo_url && (
          <img
            src={order.store_logo_url}
            alt={order.store_name}
            loading="eager"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
            className="mx-auto mb-3 h-14 w-14 rounded-xl object-contain border border-border bg-secondary/60"
          />
        )}
        <h1 className="text-lg font-bold uppercase text-foreground">{order.store_name}</h1>
        <div className="text-xs font-medium text-foreground/40 uppercase tracking-wider">Pedido #{order.order_number}</div>
      </header>

      <div className="container max-w-xl mx-auto p-4 space-y-4 -mt-4">
        {/* PIX payment section */}
        {order.payment_method === "pix" && order.status === "aguardando_pagamento" && (
          <div className="rounded-xl border-2 border-[var(--hype-green)]/30 bg-card p-6 text-center space-y-5">
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--hype-green)]/10 text-[var(--hype-green)]">
                <QrCode className="h-7 w-7" />
              </div>
              <h2 className="text-lg font-bold uppercase text-foreground">Pague com PIX</h2>
              <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Aguardando confirmação da loja</p>
            </div>

            {!pixInfo ? (
              <div className="flex flex-col items-center gap-4 py-6">
                <Loader2 className="h-7 w-7 animate-spin text-[var(--hype-green)]" />
                <p className="text-xs font-medium text-foreground/40">Gerando informações de pagamento...</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => load()}
                  className="rounded-lg border-[var(--hype-green)]/30 text-[var(--hype-green)] hover:bg-[var(--hype-green)]/10"
                >
                  Tentar Carregar Novamente
                </Button>
              </div>
            ) : pixInfo.error ? (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-4">
                <p className="text-sm font-bold text-red-400">Erro ao carregar Pix: {pixInfo.error}</p>
                <p className="text-xs text-foreground/40">Tente atualizar a página ou entre em contato com a loja.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => { pixInfoRef.current = null; setPixInfo(null); void load(); }}
                  className="rounded-lg border-border text-foreground/60 hover:bg-secondary"
                >
                  Tentar Novamente
                </Button>
              </div>
            ) : (
              <>
                {pixInfo.qrCodeUrl && (
                  <div className="inline-block rounded-xl border border-border bg-card p-4">
                    <img
                      src={pixInfo.qrCodeUrl.startsWith("data:") ? pixInfo.qrCodeUrl : `data:image/png;base64,${pixInfo.qrCodeUrl}`}
                      alt="QR Code PIX"
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                      className="h-44 w-44"
                    />
                  </div>
                )}

                <div className="w-full space-y-3">
                  <div className="rounded-lg border border-border bg-secondary/40 p-3 font-mono text-[10px] text-foreground/60 break-all text-center select-all">
                    {pixInfo.pixCode}
                  </div>
                  <Button onClick={copyPix} className="w-full h-12 rounded-xl bg-[var(--hype-green)] font-bold text-black hover:bg-[var(--hype-green-dark)] transition-all active:scale-95">
                    <Copy className="mr-2 h-4 w-4" /> Copiar Código PIX
                  </Button>
                </div>
              </>
            )}

            <div className="rounded-lg border border-dashed border-border bg-secondary/30 p-3 text-[10px] font-bold text-foreground/40 uppercase leading-tight">
              Após pagar, aguarde a loja confirmar o recebimento.
            </div>
          </div>
        )}

        {/* Tracking card */}
        <div className={cardClass}>
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-base font-bold uppercase text-foreground">Acompanhe seu pedido</h2>
              <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/40">Atualizações em tempo real</p>
            </div>
            <Badge className={`rounded-lg text-[10px] font-bold uppercase px-3 py-1 ${cancelled ? "bg-red-500/20 text-red-400" : "bg-[var(--hype-green)] text-black"}`}>
              {STATUS_LABELS[order.status] ?? order.status}
            </Badge>
          </div>

          {/* Progress bar */}
          <div className="relative pt-2 pb-8">
            <div className="absolute top-7 left-0 w-full h-1 bg-secondary rounded-full" />
            <motion.div
              className="absolute top-7 left-0 h-1 bg-[var(--hype-green)] rounded-full"
              initial={{ width: 0 }}
              animate={{
                width: `${(TRACKING_STEPS.findIndex(s => s.statuses.includes(order.status)) / (TRACKING_STEPS.length - 1)) * 100}%`,
              }}
              transition={{ duration: 1, ease: "circOut" }}
            />

            <div className="relative flex justify-between">
              {TRACKING_STEPS.map((step, idx) => {
                const stepIdx = TRACKING_STEPS.findIndex(s => s.statuses.includes(order.status));
                const isCompleted = idx < stepIdx;
                const isCurrent = idx === stepIdx;
                const Icon = step.icon;

                let label = step.label;
                if (step.id === "route" && order.delivery_type === "retirada") label = "Pronto";

                return (
                  <div key={step.id} className="flex flex-col items-center">
                    <motion.div
                      initial={false}
                      animate={{
                        scale: isCurrent ? [1, 1.08, 1] : 1,
                        backgroundColor: isCompleted || isCurrent ? "var(--hype-green)" : "transparent",
                        borderColor: isCompleted || isCurrent ? "var(--hype-green)" : "rgb(255 255 255 / 0.15)",
                      }}
                      transition={{
                        scale: isCurrent ? { repeat: Infinity, duration: 2 } : { duration: 0.3 },
                      }}
                      className="w-12 h-12 rounded-xl border-2 flex items-center justify-center z-10"
                    >
                      <Icon className={`h-5 w-5 ${isCompleted || isCurrent ? "text-black" : "text-foreground/30"}`} />
                      {isCompleted && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute -top-1 -right-1 rounded-lg bg-[var(--hype-green)] p-0.5"
                        >
                          <Check className="h-3 w-3 text-black stroke-[4px]" />
                        </motion.div>
                      )}
                    </motion.div>
                    <div className="mt-3 text-center">
                      <span className={`text-[10px] font-bold uppercase tracking-tight ${isCurrent ? "text-[var(--hype-green)]" : "text-foreground/40"}`}>
                        {label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* History */}
          <div className="mt-4 space-y-3 pt-4 border-t border-dashed border-border">
            <h4 className="text-[9px] font-bold uppercase tracking-[0.2em] text-foreground/30">Histórico Detalhado</h4>
            {history.slice(0, 3).map((h) => (
              <motion.div
                key={h.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex items-start gap-3"
              >
                <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[var(--hype-green)] ring-4 ring-[var(--hype-green)]/10 shrink-0" />
                <div>
                  <p className="text-[11px] font-bold uppercase text-foreground/70">{STATUS_LABELS[h.status] || h.status}</p>
                  <p className="text-[9px] text-foreground/30">{new Date(h.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Delivery address */}
        {order.delivery_type === "entrega" && (
          <div className={cardClass}>
            <div className="flex items-center gap-2 mb-3">
              <MapPin className="h-4 w-4 text-[var(--hype-green)]" />
              <h3 className="text-sm font-bold uppercase text-foreground">Endereço de Entrega</h3>
            </div>
            <div className="text-xs font-medium leading-relaxed text-foreground/50">
              {formatDeliveryAddressLines(order).map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          </div>
        )}

        {/* Order summary */}
        <div className={cardClass}>
          <h3 className="text-sm font-bold uppercase text-foreground mb-4">Resumo da Compra</h3>
          <ul className="space-y-3">
            {items.map((it) => {
              const itemOptionsSum = it.options?.reduce((acc: number, opt: any) => acc + Number(opt.extra_price || 0), 0) || 0;
              const itemUnitTotal = Number(it.unit_price || 0) + itemOptionsSum;
              const itemTotal = Number(it.item_subtotal || 0) > 0 ? Number(it.item_subtotal) : itemUnitTotal * it.quantity;

              return (
                <li key={it.id} className="flex flex-col gap-1 border-b border-dashed border-border pb-2">
                  <div className="flex justify-between gap-4">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-foreground">{it.quantity}× {it.product_name}</div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-foreground/30">
                        {formatBRL(itemUnitTotal)} cada
                      </div>
                      {it.notes && <div className="mt-1 text-[10px] italic text-foreground/30">"{it.notes}"</div>}
                    </div>
                    <div className="text-sm font-bold text-foreground">{formatBRL(itemTotal)}</div>
                  </div>
                  {it.options && it.options.length > 0 && (
                    <ul className="text-[10px] font-medium text-foreground/40">
                      {it.options.map((opt: any, idx: number) => (
                        <li key={idx}>+ {opt.name} {Number(opt.extra_price) > 0 && `(${formatBRL(opt.extra_price)})`}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-4 pt-3 space-y-1.5 border-t border-border">
            <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-foreground/40">
              <span>Subtotal</span>
              <span>{formatBRL(order.subtotal || 0)}</span>
            </div>
            {order.delivery_type === "entrega" && (
              <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-foreground/40">
                <span>Entrega</span>
                <span>{Number(order.delivery_fee || 0) === 0 ? "Grátis" : formatBRL(order.delivery_fee)}</span>
              </div>
            )}
            {Number(order.discount_amount) > 0 && (
              <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-[var(--hype-green)]">
                <span>Desconto</span>
                <span>-{formatBRL(order.discount_amount)}</span>
              </div>
            )}
            {order.payment_method === "dinheiro" && order.change_for && (
              <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-foreground/40">
                <span>Troco para</span>
                <span>{formatBRL(order.change_for)}</span>
              </div>
            )}
            <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-foreground/40 pt-1">
              <span>Pagamento</span>
              <span>{PAYMENT_METHOD_LABELS[order.payment_method] || order.payment_method}</span>
            </div>
            <div className="flex justify-between items-baseline pt-3 mt-2 border-t border-border">
              <span className="text-sm font-bold uppercase text-foreground">Total</span>
              <span className="text-xl font-bold text-[var(--hype-green)]">{formatBRL(order.total || 0)}</span>
            </div>
          </div>
        </div>

        {/* Review */}
        {order.status === "entregue" && (
          <div className={cardClass}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold uppercase text-foreground">Avalie sua experiência</h3>
                <p className="mt-1 text-xs font-medium text-foreground/40">
                  {reviewSubmitted ? "Sua avaliação já foi registrada." : "Sua nota ajuda outras pessoas a escolherem melhor."}
                </p>
              </div>
              {showReview && !reviewSubmitted && (
                <button
                  type="button"
                  onClick={() => setShowReview(false)}
                  className="rounded-lg p-1 text-foreground/40 hover:bg-secondary hover:text-foreground"
                  aria-label="Fechar avaliacao"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  disabled={reviewSubmitted}
                  onClick={() => {
                    setReviewRating(value);
                    setShowReview(true);
                  }}
                  className="rounded-lg border border-border bg-secondary/40 p-2 text-[var(--hype-green)] disabled:cursor-default"
                  aria-label={`Nota ${value}`}
                >
                  <Star className={cn("h-6 w-6", value <= reviewRating ? "fill-current" : "opacity-30")} />
                </button>
              ))}
            </div>

            {(showReview || reviewSubmitted) && (
              <div className="mt-4 space-y-3">
                <Textarea
                  value={reviewComment}
                  disabled={reviewSubmitted}
                  onChange={(event) => setReviewComment(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Conte como foi seu pedido"
                  className="rounded-lg border-border bg-secondary/40 text-sm"
                />
                {!reviewSubmitted && (
                  <Button
                    variant="hero"
                    className="w-full rounded-xl"
                    onClick={submitReview}
                    disabled={reviewSubmitting || reviewRating < 1}
                  >
                    {reviewSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />}
                    Enviar avaliacao
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {/* WhatsApp CTA */}
        {order.store_whatsapp && (
          <Button asChild className="w-full h-12 rounded-xl font-bold uppercase bg-[#25D366] hover:bg-[#128C7E] text-foreground shadow-lg">
            <a href={buildWhatsAppLink(order.store_whatsapp, `Olá! Gostaria de saber sobre meu pedido #${order.order_number}`)} target="_blank" rel="noreferrer">
              <MessageSquare className="mr-2 h-4 w-4" /> Chamar no WhatsApp
            </a>
          </Button>
        )}
      </div>
    </div>
  );
};

export default OrderTracking;
