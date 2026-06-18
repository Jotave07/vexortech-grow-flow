import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  MapPin,
  MessageSquare,
  Phone,
  RefreshCw,
  TimerReset,
  Truck,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatBRL, STATUS_LABELS, STATUS_COLORS, PAYMENT_METHOD_LABELS, buildWhatsAppLink, formatDeliveryAddressLines } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSubscriptionStatus } from "@/hooks/use-subscription-status";
import { motion, AnimatePresence } from "framer-motion";

type OrderColumn = {
  key: string;
  label: string;
  helper: string;
  statuses: string[];
  nextStatus?: string;
  nextLabel?: string | ((order: any) => string);
};

const OPERATIONAL_COLUMNS: OrderColumn[] = [
  {
    key: "aguardando_pagamento",
    label: "Aguardando PIX",
    helper: "So entra na cozinha depois da aprovacao manual.",
    statuses: ["aguardando_pagamento"],
  },
  {
    key: "novo",
    label: "Entrada",
    helper: "Pedidos liberados para aceitar.",
    statuses: ["novo"],
    nextStatus: "confirmado",
    nextLabel: "Aceitar pedido",
  },
  {
    key: "confirmado",
    label: "Confirmados",
    helper: "Organize a fila antes de preparar.",
    statuses: ["confirmado"],
    nextStatus: "em_preparo",
    nextLabel: "Iniciar preparo",
  },
  {
    key: "em_preparo",
    label: "Em preparo",
    helper: "Acompanhe o tempo estimado.",
    statuses: ["em_preparo"],
    nextStatus: "saiu_para_entrega",
    nextLabel: (order) => order.delivery_type === "retirada" ? "Marcar pronto" : "Saiu para entrega",
  },
  {
    key: "saiu_para_entrega",
    label: "Rota / retirada",
    helper: "Finalize quando entregar ou retirar.",
    statuses: ["saiu_para_entrega", "pronto_para_retirada"],
    nextStatus: "entregue",
    nextLabel: "Concluir pedido",
  },
];

const operationalStatuses = [
  "aguardando_pagamento",
  "novo",
  "confirmado",
  "em_preparo",
  "saiu_para_entrega",
  "pronto_para_retirada",
];

const historyStatuses = ["entregue", "cancelado", "estornado"];

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pago: "Pago",
  pendente: "Pendente",
  cancelado: "Cancelado",
  estornado: "Estornado",
};

const PAYMENT_STATUS_CLASSES: Record<string, string> = {
  pago: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pendente: "border-amber-200 bg-amber-50 text-amber-700",
  cancelado: "border-red-200 bg-red-50 text-red-700",
  estornado: "border-slate-200 bg-slate-50 text-slate-700",
};

const sortOrders = (items: any[]) =>
  [...items].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

const orderAgeInMinutes = (order: any) =>
  Math.max(0, Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000));

const formatOrderAge = (order: any) => {
  const minutes = orderAgeInMinutes(order);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}h${rest ? ` ${rest}m` : ""}`;
};

const dateInputValue = (date: Date) => date.toISOString().slice(0, 10);
const startOfDayIso = (value: string) => new Date(`${value}T00:00:00`).toISOString();
const endOfDayIso = (value: string) => new Date(`${value}T23:59:59.999`).toISOString();

const getItemTotal = (item: any) => {
  const optionsTotal = (item.order_item_options || []).reduce(
    (sum: number, option: any) => sum + Number(option.extra_price || 0),
    0,
  );
  const calculated = (Number(item.unit_price || 0) + optionsTotal) * Number(item.quantity || 0);
  return Number(item.subtotal || 0) > 0 ? Number(item.subtotal) : calculated;
};

const getItemUnitTotal = (item: any) => {
  const optionsTotal = (item.order_item_options || []).reduce(
    (sum: number, option: any) => sum + Number(option.extra_price || 0),
    0,
  );
  return Number(item.unit_price || 0) + optionsTotal;
};

const getNextAction = (order: any) => {
  const column = OPERATIONAL_COLUMNS.find((candidate) => candidate.statuses.includes(order.status));
  if (!column?.nextStatus) return null;
  const nextStatus = column.nextStatus;
  return {
    status: nextStatus,
    label: typeof column.nextLabel === "function" ? column.nextLabel(order) : column.nextLabel || "Avançar",
  };
};

const Orders = () => {
  const { store } = useOutletContext<{ store: any }>();
  const { accessState, message } = useSubscriptionStatus();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [realtimeState, setRealtimeState] = useState<"connecting" | "online" | "offline">("connecting");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyOrders, setHistoryOrders] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPeriod, setHistoryPeriod] = useState("7");
  const [historyStartDate, setHistoryStartDate] = useState(() => dateInputValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)));
  const [historyEndDate, setHistoryEndDate] = useState(() => dateInputValue(new Date()));
  const [historyStatus, setHistoryStatus] = useState("todos");
  const [historySearch, setHistorySearch] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const boardRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    if (!store?.id) return;
    const { data, error } = await backend
      .from("orders")
      .select("*")
      .eq("store_id", store.id)
      .in("status", operationalStatuses)
      .gte("created_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(250);

    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }

    setOrders(sortOrders(data ?? []));
    setLastSync(new Date());
    setLoading(false);
  }, [store?.id]);

  const loadHistory = useCallback(async () => {
    if (!store?.id) return;
    setHistoryLoading(true);
    try {
      const statuses = historyStatus === "todos" ? historyStatuses : [historyStatus];
      const today = dateInputValue(new Date());
      const fromDate = historyPeriod === "custom"
        ? startOfDayIso(historyStartDate)
        : historyPeriod === "1"
          ? startOfDayIso(today)
          : new Date(Date.now() - Number(historyPeriod) * 24 * 60 * 60 * 1000).toISOString();
      const toDate = historyPeriod === "custom" ? endOfDayIso(historyEndDate) : null;

      if (historyPeriod === "custom" && (!historyStartDate || !historyEndDate || fromDate > toDate!)) {
        toast.error("Informe um intervalo valido para o historico.");
        return;
      }

      let query = backend
      .from("orders")
      .select("*")
      .eq("store_id", store.id)
      .in("status", statuses)
        .gte("created_at", fromDate);

      if (toDate) query = query.lte("created_at", toDate);

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(250);

      if (error) toast.error(error.message);
      setHistoryOrders(sortOrders(data ?? []));
    } finally {
      setHistoryLoading(false);
    }
  }, [historyEndDate, historyPeriod, historyStartDate, historyStatus, store?.id]);

  useEffect(() => {
    if (historyOpen) void loadHistory();
  }, [historyOpen, loadHistory]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historyEndDate, historyPeriod, historyStartDate, historyStatus, historySearch]);

  useEffect(() => {
    if (!store?.id) return;

    void load();

    const playNotificationSound = () => {
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const playTone = (freq: number, startTime: number, duration: number) => {
          const osc = audioContext.createOscillator();
          const gain = audioContext.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, startTime);
          gain.gain.setValueAtTime(0.45, startTime);
          gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
          osc.connect(gain);
          gain.connect(audioContext.destination);
          osc.start(startTime);
          osc.stop(startTime + duration);
        };

        const now = audioContext.currentTime;
        playTone(880, now, 0.1);
        playTone(1108.73, now + 0.18, 0.22);
      } catch (error) {
        console.error("Notification sound failed:", error);
      }
    };

    const channel = backend.channel(`orders-store-${store.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `store_id=eq.${store.id}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newOrder = payload.new as any;
            if (operationalStatuses.includes(newOrder.status)) {
              setOrders((current) => sortOrders([newOrder, ...current.filter((item) => item.id !== newOrder.id)]));
              toast.success(`Novo pedido #${newOrder.order_number}`, { duration: 8000 });
              playNotificationSound();
            }
          }

          if (payload.eventType === "UPDATE") {
            const oldOrder = payload.old as any;
            const newOrder = payload.new as any;
            setOrders((current) => {
              const withoutOrder = current.filter((item) => item.id !== newOrder.id);
              return operationalStatuses.includes(newOrder.status)
                ? sortOrders([{ ...oldOrder, ...newOrder }, ...withoutOrder])
                : sortOrders(withoutOrder);
            });
            setSelected((current: any) => current?.id === newOrder.id ? { ...current, ...newOrder } : current);

            if (oldOrder.status === "aguardando_pagamento" && newOrder.status === "novo") {
              toast.success(`Pagamento confirmado! Pedido #${newOrder.order_number}`, { duration: 8000 });
              playNotificationSound();
            }
          }

          setLastSync(new Date());
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setRealtimeState("online");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setRealtimeState("offline");
      });

    const pollInterval = window.setInterval(load, 20000);

    return () => {
      void backend.removeChannel(channel);
      window.clearInterval(pollInterval);
    };
  }, [store?.id, load]);

  const summary = useMemo(() => {
    const active = orders.filter((order) => operationalStatuses.includes(order.status));
    const waitingPayment = orders.filter((order) => order.status === "aguardando_pagamento").length;
    const production = orders.filter((order) => ["novo", "confirmado", "em_preparo"].includes(order.status)).length;
    const route = orders.filter((order) => ["saiu_para_entrega", "pronto_para_retirada"].includes(order.status)).length;
    const completedRevenue = orders
      .filter((order) => order.status === "entregue" || order.payment_status === "pago")
      .reduce((sum, order) => sum + Number(order.total || 0), 0);
    const urgent = active.filter((order) => orderAgeInMinutes(order) >= 25).length;

    return { active: active.length, waitingPayment, production, route, completedRevenue, urgent };
  }, [orders]);

  const openDetails = async (order: any) => {
    setSelected(order);
    const { data } = await backend
      .from("order_items")
      .select("*, order_item_options(*)")
      .eq("order_id", order.id);

    setItems(data ?? []);

    if (!order.is_seen) {
      await backend.from("orders").update({ is_seen: true }).eq("id", order.id);
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, is_seen: true } : item));
    }
  };

  const updateStatus = async (orderId: string, status: string, note?: string) => {
    const order = orders.find((item) => item.id === orderId) || selected;
    if (!order) return;

    let finalStatus = status;
    if (status === "saiu_para_entrega" && order.delivery_type === "retirada") {
      finalStatus = "pronto_para_retirada";
    }

    setUpdatingId(orderId);
    try {
      const { data: updatedOrder, error } = await backend.functions.invoke("update-order-status", {
        body: {
          orderId,
          storeId: store.id,
          status: finalStatus,
          note: note ?? null,
        },
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      const mergedOrder = { ...order, ...(updatedOrder ?? {}), status: finalStatus };
      setOrders((current) => {
        const withoutOrder = current.filter((item) => item.id !== orderId);
        return operationalStatuses.includes(finalStatus) ? sortOrders([mergedOrder, ...withoutOrder]) : sortOrders(withoutOrder);
      });
      if (selected?.id === orderId) setSelected(mergedOrder);
      toast.success("Status atualizado e cliente avisado");
    } finally {
      setUpdatingId(null);
    }
  };

  const cancelOrder = async (orderId: string) => {
    if (!confirm("Cancelar este pedido?")) return;

    await updateStatus(orderId, "cancelado", "Cancelado pela loja");
  };

  const approvePixPayment = async (order: any) => {
    if (!order) return;
    if (!confirm("Confirmar que o pagamento Pix deste pedido foi recebido?")) return;
    setSyncing(true);
    setUpdatingId(order.id);
    try {
      const { data: res, error } = await backend.functions.invoke("approve-manual-pix", {
        body: { orderId: order.id, storeId: store.id },
      });
      if (error) throw error;
      toast.success(res?.alreadyPaid ? "Pagamento ja estava aprovado." : "Pagamento Pix aprovado.");
      await load();
      if (selected?.id === order.id) {
        setSelected({ ...selected, ...(res?.order ?? {}), payment_status: "pago", status: res?.order?.status ?? "novo" });
      }
    } catch (error) {
      toast.error("Erro ao aprovar pagamento Pix");
    } finally {
      setSyncing(false);
      setUpdatingId(null);
    }
  };

  if (loading) {
    return (
      <div className="py-20 text-center">
        <Loader2 className="inline h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (accessState !== "active") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-4 p-6 text-center">
        <div className="rounded-none border-2 border-amber-200 bg-amber-50 p-4 text-amber-600">
          <AlertTriangle className="h-12 w-12" />
        </div>
        <div className="max-w-md">
          <h2 className="text-2xl font-black uppercase tracking-tight italic">Acesso restrito</h2>
          <p className="mt-2 font-medium text-muted-foreground">{message}</p>
        </div>
        <Button variant="hero" className="h-12 px-8 text-xs font-black uppercase tracking-widest" asChild>
          <Link to="/lojista/assinatura">
            Regularizar assinatura <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    );
  }

  const selectedAction = selected ? getNextAction(selected) : null;
  const selectedItemsTotal = items.reduce((sum, item) => sum + getItemTotal(item), 0);
  const filteredHistory = historyOrders.filter((order) => {
    const search = historySearch.trim().toLowerCase();
    if (!search) return true;
    return String(order.customer_name || "").toLowerCase().includes(search) ||
      String(order.order_number || "").includes(search);
  });
  const historyTotalPages = Math.max(1, Math.ceil(filteredHistory.length / 25));
  const visibleHistory = filteredHistory.slice((historyPage - 1) * 25, historyPage * 25);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tight">Gestão de pedidos</h1>
          <p className="font-medium text-muted-foreground">Fila operacional com pagamento, entrega e avisos automáticos ao cliente.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className={cn(
            "flex items-center gap-1.5 rounded-none border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest",
            realtimeState === "online" ? "border-primary/30 bg-primary/10 text-foreground" : "border-amber-200 bg-amber-50 text-amber-700",
          )}>
            <div className={cn("h-2 w-2 rounded-none", realtimeState === "online" ? "animate-pulse bg-primary" : "bg-amber-500")} />
            {realtimeState === "online" ? "Tempo real ativo" : "Reconectando"}
          </div>
          {lastSync && (
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Sync {lastSync.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)} className="rounded-none border-border text-[10px] font-bold uppercase tracking-widest">
            Historico
          </Button>
          <Button variant="outline" size="sm" onClick={load} className="rounded-none border-border text-[10px] font-bold uppercase tracking-widest">
            <RefreshCw className="h-3.5 w-3.5" /> Atualizar
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <SummaryCard icon={Activity} label="Ativos" value={String(summary.active)} helper="Na fila agora" />
        <SummaryCard icon={Wallet} label="PIX pendente" value={String(summary.waitingPayment)} helper="Aguardando loja" />
        <SummaryCard icon={TimerReset} label="Atenção" value={String(summary.urgent)} helper="Mais de 25 min" tone={summary.urgent > 0 ? "warning" : "default"} />
        <SummaryCard icon={Truck} label="Rota/pronto" value={String(summary.route)} helper="Saída ou retirada" />
        <SummaryCard icon={CheckCircle2} label="Vendas" value={formatBRL(summary.completedRevenue)} helper="Pagas/concluídas" />
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="icon" className="h-9 w-9 rounded-none" onClick={() => boardRef.current?.scrollBy({ left: -360, behavior: "smooth" })}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" className="h-9 w-9 rounded-none" onClick={() => boardRef.current?.scrollBy({ left: 360, behavior: "smooth" })}>
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      <div ref={boardRef} className="-mx-4 flex h-[calc(100vh-260px)] gap-4 overflow-x-auto overflow-y-hidden overscroll-contain px-4 pb-4 md:mx-0 md:px-0">
        {OPERATIONAL_COLUMNS.map((col) => {
          const colOrders = orders.filter((order) => col.statuses.includes(order.status));

          return (
            <div key={col.key} className="flex h-full min-w-[300px] max-w-[340px] shrink-0 flex-col gap-3">
              <div className="px-1">
                <div className="flex items-center justify-between border-b border-border pb-2">
                  <h3 className="text-xs font-black uppercase tracking-widest">{col.label}</h3>
                  <span className="rounded-none bg-foreground px-2 py-0.5 text-[10px] font-black text-background">{colOrders.length}</span>
                </div>
                <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{col.helper}</p>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-none border border-dashed border-border bg-muted/20 p-2">
                <AnimatePresence mode="popLayout">
                  {colOrders.map((order) => {
                    const action = getNextAction(order);
                    const paymentStatus = order.payment_status || "pendente";

                    return (
                      <motion.div
                        key={order.id}
                        layout
                        initial={{ opacity: 0, y: 16, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.18 } }}
                      >
                        <Card
                          className={cn(
                            "relative cursor-pointer overflow-hidden rounded-none border border-border bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-elegant",
                            !order.is_seen && order.status === "novo" ? "ring-2 ring-primary" : "",
                          )}
                          onClick={() => openDetails(order)}
                        >
                          {!order.is_seen && order.status === "novo" && (
                            <Badge className="absolute right-2 top-2 h-5 bg-primary px-2 text-[8px]">Novo</Badge>
                          )}

                          <div className="mb-3 flex items-center justify-between gap-2">
                            <span className="rounded-none bg-foreground px-2 py-0.5 text-xs font-black tracking-tighter text-background">#{order.order_number}</span>
                            <span className="text-[10px] font-bold uppercase text-muted-foreground">{formatOrderAge(order)}</span>
                          </div>

                          <div className="mb-3 space-y-1">
                            <div className="truncate font-black uppercase tracking-tight">{order.customer_name}</div>
                            <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {new Date(order.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </div>
                          </div>

                          <div className="mb-3 flex flex-wrap gap-1.5">
                            <Badge variant="outline" className="h-5 rounded-none border-border text-[9px] font-black uppercase tracking-widest">
                              {order.delivery_type === "retirada" ? "Retirada" : "Entrega"}
                            </Badge>
                            <Badge variant="outline" className={cn("h-5 rounded-none text-[9px] font-black uppercase tracking-widest", PAYMENT_STATUS_CLASSES[paymentStatus] || PAYMENT_STATUS_CLASSES.pendente)}>
                              {PAYMENT_STATUS_LABELS[paymentStatus] || paymentStatus}
                            </Badge>
                            <Badge variant="outline" className="h-5 rounded-none border-border text-[9px] font-black uppercase tracking-widest">
                              {PAYMENT_METHOD_LABELS[order.payment_method] || order.payment_method}
                            </Badge>
                          </div>

                          {order.delivery_type === "entrega" && (
                            <div className="mb-3 flex gap-2 rounded-none border border-border bg-muted/20 p-2 text-[10px] font-bold leading-snug text-muted-foreground">
                              <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                              <div className="min-w-0">
                                {formatDeliveryAddressLines(order).map((line) => (
                                  <div key={line} className="break-words">{line}</div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="flex items-end justify-between gap-3">
                            <div>
                              <div className="text-[10px] font-bold uppercase text-muted-foreground">Total</div>
                              <div className="text-lg font-black">{formatBRL(order.total)}</div>
                            </div>
                            {order.estimated_min && (
                              <div className="rounded-none bg-blue-50 px-2 py-1 text-right text-[10px] font-black uppercase text-blue-700">
                                {order.estimated_min}-{order.estimated_max} min
                              </div>
                            )}
                          </div>

                          {action && (
                            <Button
                              size="sm"
                              variant="hero"
                              className="mt-4 h-9 w-full text-[10px] font-black uppercase tracking-widest"
                              disabled={updatingId === order.id}
                              onClick={(event) => {
                                event.stopPropagation();
                                void updateStatus(order.id, action.status);
                              }}
                            >
                              {updatingId === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : action.label}
                            </Button>
                          )}
                          {order.status === "aguardando_pagamento" && order.payment_method === "pix" && (
                            <Button
                              size="sm"
                              variant="hero"
                              className="mt-4 h-9 w-full text-[10px] font-black uppercase tracking-widest"
                              disabled={updatingId === order.id || syncing}
                              onClick={(event) => {
                                event.stopPropagation();
                                void approvePixPayment(order);
                              }}
                            >
                              {updatingId === order.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Confirmar pagamento Pix"}
                            </Button>
                          )}
                        </Card>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>

                {colOrders.length === 0 && (
                  <div className="flex h-24 items-center justify-center rounded-none border border-dashed border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground/45">
                    Sem pedidos
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Historico de pedidos</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-[160px_180px_1fr_auto]">
            <Select value={historyPeriod} onValueChange={setHistoryPeriod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Hoje</SelectItem>
                <SelectItem value="7">Ultimos 7 dias</SelectItem>
                <SelectItem value="30">Ultimos 30 dias</SelectItem>
                <SelectItem value="custom">Intervalo personalizado</SelectItem>
              </SelectContent>
            </Select>
            <Select value={historyStatus} onValueChange={setHistoryStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos status</SelectItem>
                {historyStatuses.map((status) => (
                  <SelectItem key={status} value={status}>{STATUS_LABELS[status] || status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
              placeholder="Buscar por cliente ou numero"
            />
            <Button variant="outline" onClick={loadHistory} disabled={historyLoading}>
              {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar
            </Button>
          </div>

          {historyPeriod === "custom" && (
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                type="date"
                value={historyStartDate}
                onChange={(event) => setHistoryStartDate(event.target.value)}
                aria-label="Data inicial do historico"
              />
              <Input
                type="date"
                value={historyEndDate}
                onChange={(event) => setHistoryEndDate(event.target.value)}
                aria-label="Data final do historico"
              />
            </div>
          )}

          <div className="space-y-2">
            {visibleHistory.map((order) => (
              <div key={order.id} className="grid gap-3 rounded-none border border-border bg-white p-3 text-sm md:grid-cols-[90px_1fr_120px_120px] md:items-center">
                <div className="font-black">#{order.order_number}</div>
                <div>
                  <div className="font-bold uppercase">{order.customer_name}</div>
                  <div className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString("pt-BR")}</div>
                  {order.delivery_type === "entrega" && (
                    <div className="mt-1 text-[10px] font-medium leading-snug text-muted-foreground">
                      {formatDeliveryAddressLines(order).map((line) => (
                        <div key={line}>{line}</div>
                      ))}
                    </div>
                  )}
                </div>
                <Badge variant="outline" className={cn("w-fit rounded-none text-[10px] font-black uppercase", STATUS_COLORS[order.status] || "")}>
                  {STATUS_LABELS[order.status] || order.status}
                </Badge>
                <div className="font-black">{formatBRL(order.total)}</div>
              </div>
            ))}
            {!historyLoading && visibleHistory.length === 0 && (
              <div className="rounded-none border border-dashed border-border p-8 text-center text-sm font-bold uppercase tracking-widest text-muted-foreground">
                Nenhum pedido no historico
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Pagina {historyPage} de {historyTotalPages}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={historyPage <= 1} onClick={() => setHistoryPage((page) => Math.max(1, page - 1))}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={historyPage >= historyTotalPages} onClick={() => setHistoryPage((page) => Math.min(historyTotalPages, page + 1))}>Proxima</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              Pedido #{selected?.order_number}
              {selected && (
                <Badge className={cn("rounded-none border text-[10px] font-black uppercase", STATUS_COLORS[selected.status] || "")}>
                  {STATUS_LABELS[selected.status] ?? selected.status}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="grid gap-4 text-sm lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                <section className="rounded-none border border-border bg-muted/20 p-4">
                  <div className="mb-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Cliente e entrega</div>
                  <div className="space-y-2">
                    <div className="font-black uppercase">{selected.customer_name}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" /> {selected.customer_phone}
                    </div>
                    {selected.delivery_type === "entrega" && (
                      <div className="flex items-start gap-2 text-xs text-muted-foreground">
                        <MapPin className="mt-0.5 h-3.5 w-3.5" />
                        <div>
                          {formatDeliveryAddressLines(selected).map((line) => (
                            <div key={line} className="text-[10px] first:text-xs">{line}</div>
                          ))}
                          {selected.delivery_reference && <div className="text-[10px] italic">Ref: {selected.delivery_reference}</div>}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Badge variant="outline" className="rounded-none border-border text-[10px] font-black uppercase">
                        {selected.delivery_type === "retirada" ? "Retirada" : "Entrega"}
                      </Badge>
                      {selected.estimated_min && (
                        <Badge variant="outline" className="rounded-none border-blue-200 bg-blue-50 text-[10px] font-black uppercase text-blue-700">
                          {selected.estimated_min}-{selected.estimated_max} min
                        </Badge>
                      )}
                    </div>
                  </div>
                </section>

                <section className="rounded-none border border-border bg-white p-4">
                  <div className="mb-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Itens</div>
                  <div className="space-y-3">
                    {items.map((item: any) => (
                      <div key={item.id} className="border-b border-dashed border-border pb-3 last:border-0 last:pb-0">
                        <div className="flex justify-between gap-4 font-medium">
                          <span>{item.quantity}x {item.product_name}</span>
                          <span>{formatBRL(getItemTotal(item))}</span>
                        </div>
                        <div className="mt-0.5 pl-4 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          {formatBRL(getItemUnitTotal(item))} cada
                        </div>
                        {item.order_item_options?.length > 0 && (
                          <ul className="mt-1 pl-4 text-xs text-muted-foreground">
                            {item.order_item_options.map((option: any) => (
                              <li key={option.id}>+ {option.item_name}{Number(option.extra_price) > 0 && ` (${formatBRL(option.extra_price)})`}</li>
                            ))}
                          </ul>
                        )}
                        {item.notes && <div className="mt-1 pl-4 text-xs italic text-muted-foreground">"{item.notes}"</div>}
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <div className="space-y-4">
                <section className="rounded-none border border-border bg-muted/20 p-4">
                  <div className="mb-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Pagamento</div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 font-medium">
                        {selected.payment_method === "dinheiro" ? <Wallet className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
                        {PAYMENT_METHOD_LABELS[selected.payment_method] || selected.payment_method}
                      </span>
                      <Badge variant="outline" className={cn("rounded-none text-[10px] font-black uppercase", PAYMENT_STATUS_CLASSES[selected.payment_status || "pendente"] || PAYMENT_STATUS_CLASSES.pendente)}>
                        {PAYMENT_STATUS_LABELS[selected.payment_status || "pendente"] || selected.payment_status}
                      </Badge>
                    </div>
                    {selected.change_for && <div className="text-xs text-muted-foreground">Troco para: {formatBRL(selected.change_for)}</div>}
                    {selected.payment_method !== "pix" && selected.status !== "entregue" && (
                      <div className="rounded-none border border-dashed border-border bg-white p-3 text-[11px] font-medium text-muted-foreground">
                        Receba no ato da entrega/retirada. Ao concluir o pedido, o pagamento será marcado como pago automaticamente.
                      </div>
                    )}
                    {selected.status === "aguardando_pagamento" && selected.payment_method === "pix" && (
                      <Button variant="hero" size="sm" className="w-full" onClick={() => approvePixPayment(selected)} disabled={syncing}>
                        {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        Confirmar pagamento Pix
                      </Button>
                    )}
                  </div>
                </section>

                <section className="rounded-none border border-border bg-white p-4">
                  <div className="mb-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Resumo financeiro</div>
                  <div className="space-y-1">
                    {items.length > 0 && <div className="flex justify-between"><span>Itens</span><span>{formatBRL(selectedItemsTotal)}</span></div>}
                    <div className="flex justify-between"><span>Subtotal</span><span>{formatBRL(selected.subtotal)}</span></div>
                    {selected.delivery_type === "entrega" && <div className="flex justify-between"><span>Entrega</span><span>{formatBRL(selected.delivery_fee)}</span></div>}
                    {Number(selected.discount_amount) > 0 && (
                      <div className="flex justify-between text-green-600">
                        <span>Desconto {selected.coupon_code && `(${selected.coupon_code})`}</span>
                        <span>-{formatBRL(selected.discount_amount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-border pt-2 text-base font-black">
                      <span>Total</span>
                      <span className="text-primary">{formatBRL(selected.total)}</span>
                    </div>
                  </div>
                  {selected.notes && <div className="mt-3 rounded-none bg-muted p-3 text-xs italic text-muted-foreground">Obs: "{selected.notes}"</div>}
                </section>

                <section className="rounded-none border border-border bg-muted/20 p-4">
                  <div className="mb-3 text-[10px] font-black uppercase tracking-widest text-muted-foreground">Ações rápidas</div>
                  <div className="flex flex-col gap-2">
                    {selectedAction && (
                      <Button variant="hero" size="sm" onClick={() => updateStatus(selected.id, selectedAction.status)} disabled={updatingId === selected.id}>
                        {updatingId === selected.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        {selectedAction.label}
                      </Button>
                    )}
                    <Button asChild variant="outline" size="sm">
                      <a href={buildWhatsAppLink(selected.customer_phone, `Olá ${selected.customer_name}, sobre seu pedido #${selected.order_number}`)} target="_blank" rel="noreferrer">
                        <MessageSquare className="h-4 w-4" /> Chamar no WhatsApp
                      </a>
                    </Button>
                    {!["entregue", "cancelado"].includes(selected.status) && (
                      <Button variant="destructive" size="sm" onClick={() => cancelOrder(selected.id)}>
                        <XCircle className="h-4 w-4" /> Cancelar pedido
                      </Button>
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

type SummaryCardProps = {
  icon: typeof Activity;
  label: string;
  value: string;
  helper: string;
  tone?: "default" | "warning";
};

const SummaryCard = ({ icon: Icon, label, value, helper, tone = "default" }: SummaryCardProps) => (
  <Card className={cn(
    "rounded-none border p-4",
    tone === "warning" ? "border-amber-200 bg-amber-50" : "border-border bg-white",
  )}>
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="mt-1 text-xl font-black tracking-tight">{value}</div>
        <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{helper}</div>
      </div>
      <div className={cn(
        "rounded-none p-2",
        tone === "warning" ? "bg-amber-100 text-amber-700" : "bg-primary/10 text-primary",
      )}>
        <Icon className="h-4 w-4" />
      </div>
    </div>
  </Card>
);

export default Orders;
