import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OrderCard } from "@/components/lojista/OrderCard";
import { KitchenView } from "@/components/lojista/KitchenView";
import { OrdersFilterSidebar, type OrdersFilters } from "@/components/lojista/OrdersFilterSidebar";
import { OrdersMetricsBar } from "@/components/lojista/OrdersMetricsBar";
import { OrdersDataTable } from "@/components/lojista/OrdersDataTable";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bell,
  BellOff,
  BellRing,
  CheckCircle2,
  CreditCard,
  LayoutGrid,
  List,
  Loader2,
  MapPin,
  MessageSquare,
  Phone,
  Printer,
  RefreshCw,
  UtensilsCrossed,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { formatBRL, STATUS_LABELS, STATUS_COLORS, PAYMENT_METHOD_LABELS, buildWhatsAppLink, formatDeliveryAddressLines } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useSubscriptionStatus } from "@/hooks/use-subscription-status";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import { AnimatePresence } from "framer-motion";
import { printOrderTicket } from "@/lib/order-print";

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
    helper: "Confirme o pagamento para liberar o pedido.",
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

const ALL_STATUS_KEYS = [
  "aguardando_pagamento", "novo", "confirmado", "em_preparo",
  "saiu_para_entrega", "pronto_para_retirada", "entregue", "cancelado",
];

const Orders = () => {
  const { store } = useOutletContext<{ store: any }>();
  const { accessState, message } = useSubscriptionStatus();
  const { play, muted, toggleMute, soundReady, unlock } = useNotificationSound();
  const [viewMode, setViewMode] = useState<"table" | "kanban" | "kitchen">("table");
  const [kitchenItems, setKitchenItems] = useState<any[]>([]);
  const [kitchenLoading, setKitchenLoading] = useState(false);
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
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const initialLoadCompleteRef = useRef(false);
  const notifiedOrderKeysRef = useRef<Set<string>>(new Set());

  // Filter, sort, pagination state
  const [filters, setFilters] = useState<OrdersFilters>({
    search: "",
    period: "all",
    statuses: [],
    deliveryType: "all",
  });
  const [metricFilter, setMetricFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<{ column: string; direction: "asc" | "desc" }>({ column: "created_at", direction: "desc" });
  const [tablePage, setTablePage] = useState(1);

  const notifyOrder = useCallback((order: any, key: string, message: string) => {
    if (!order?.id || notifiedOrderKeysRef.current.has(key)) return;
    notifiedOrderKeysRef.current.add(key);
    knownOrderIdsRef.current.add(String(order.id));
    toast.success(message, { duration: 8000 });
    play();
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      (navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }).vibrate?.([160, 80, 160]);
    }
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Hype Delivery", { body: message });
    }
  }, [play]);

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

    const sorted = sortOrders(data ?? []);
    if (initialLoadCompleteRef.current) {
      const previousIds = knownOrderIdsRef.current;
      [...sorted]
        .reverse()
        .filter((order) => operationalStatuses.includes(order.status) && !previousIds.has(String(order.id)))
        .forEach((order) => notifyOrder(order, `new:${order.id}`, `Novo pedido #${order.order_number}`));
    } else {
      initialLoadCompleteRef.current = true;
    }
    knownOrderIdsRef.current = new Set(sorted.map((order) => String(order.id)));
    setOrders(sorted);
    setLastSync(new Date());
    setLoading(false);
  }, [notifyOrder, store?.id]);

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
        toast.error("Informe um intervalo válido para o histórico.");
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
              notifyOrder(newOrder, `new:${newOrder.id}`, `Novo pedido #${newOrder.order_number}`);
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
              notifyOrder(newOrder, `paid:${newOrder.id}`, `Pagamento confirmado! Pedido #${newOrder.order_number}`);
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
  }, [store?.id, load, notifyOrder]);

  // Filtered & sorted orders
  const effectiveStatuses = useMemo(() => {
    if (metricFilter) return [metricFilter];
    if (filters.statuses.length > 0) return filters.statuses;
    return ALL_STATUS_KEYS;
  }, [filters.statuses, metricFilter]);

  const filteredOrders = useMemo(() => {
    let result = [...orders];

    // Search filter
    if (filters.search.trim()) {
      const s = filters.search.trim().toLowerCase();
      result = result.filter(
        (o) =>
          String(o.customer_name || "").toLowerCase().includes(s) ||
          String(o.order_number || "").includes(s),
      );
    }

    // Period filter
    if (filters.period !== "all") {
      const days = Number(filters.period) || 0;
      if (days > 0) {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        result = result.filter((o) => o.created_at >= cutoff);
      }
    }

    // Status filter from sidebar or metric click
    if (effectiveStatuses.length > 0 && effectiveStatuses.length < ALL_STATUS_KEYS.length) {
      result = result.filter((o) => effectiveStatuses.includes(o.status));
    } else if (viewMode !== "kanban") {
      // Default: only operational statuses (not entregue/cancelado)
      result = result.filter((o) => operationalStatuses.includes(o.status));
    }

    // Delivery type filter
    if (filters.deliveryType !== "all") {
      result = result.filter((o) => o.delivery_type === filters.deliveryType);
    }

    // Sort
    result.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sort.column) {
        case "order_number": aVal = a.order_number; bVal = b.order_number; break;
        case "customer_name": aVal = (a.customer_name || "").toLowerCase(); bVal = (b.customer_name || "").toLowerCase(); break;
        case "total": aVal = Number(a.total); bVal = Number(b.total); break;
        case "status": aVal = a.status || ""; bVal = b.status || ""; break;
        case "created_at":
        default: aVal = new Date(a.created_at).getTime(); bVal = new Date(b.created_at).getTime(); break;
      }
      if (aVal < bVal) return sort.direction === "asc" ? -1 : 1;
      if (aVal > bVal) return sort.direction === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [orders, filters, sort, effectiveStatuses, viewMode]);

  // Status counts across ALL orders
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const key of ALL_STATUS_KEYS) {
      if (key === "saiu_para_entrega") {
        counts[key] = orders.filter((o) => o.status === "saiu_para_entrega" || o.status === "pronto_para_retirada").length;
      } else {
        counts[key] = orders.filter((o) => o.status === key).length;
      }
    }
    return counts;
  }, [orders]);

  const handleMetricClick = (statusKey: string) => {
    if (metricFilter === statusKey) {
      setMetricFilter(null);
    } else {
      setMetricFilter(statusKey);
    }
    setTablePage(1);
  };

  const handleSort = (column: string) => {
    setSort((prev) => ({
      column,
      direction: prev.column === column && prev.direction === "desc" ? "asc" : "desc",
    }));
  };

  const handleSoundToggle = useCallback(async () => {
    if (muted) {
      toggleMute();
      const ready = await unlock();
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        await Notification.requestPermission().catch(() => null);
      }
      if (ready) toast.success("Som de novos pedidos ativado.");
      return;
    }

    if (!soundReady) {
      const ready = await unlock();
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        await Notification.requestPermission().catch(() => null);
      }
      if (ready) {
        toast.success("Som de novos pedidos ativado.");
        play();
      } else {
        toast.error("O navegador bloqueou o som. Clique novamente ou verifique as permissoes do site.");
      }
      return;
    }

    toggleMute();
    toast.info("Som de novos pedidos silenciado.");
  }, [muted, play, soundReady, toggleMute, unlock]);

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

  const loadKitchenItems = useCallback(async (orderIds: string[]) => {
    if (!orderIds.length) {
      setKitchenItems([]);
      return;
    }
    setKitchenLoading(true);
    const { data } = await backend
      .from("order_items")
      .select("*, order_item_options(*)")
      .in("order_id", orderIds);
    setKitchenItems(data ?? []);
    setKitchenLoading(false);
  }, []);

  useEffect(() => {
    if (viewMode === "kitchen") {
      const cookingIds = orders
        .filter((o) => ["em_preparo", "confirmado", "novo"].includes(o.status))
        .map((o) => o.id);
      loadKitchenItems(cookingIds);
    }
  }, [viewMode, orders, loadKitchenItems]);

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
      toast.success(res?.alreadyPaid ? "Pagamento já estava aprovado." : "Pagamento Pix aprovado.");
      await load();
      if (selected?.id === order.id) {
        setSelected({ ...selected, ...(res?.order ?? {}), payment_status: "pago", status: res?.order?.status ?? "novo" });
      }
    } catch {
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
        <div className="rounded-lg border-2 border-amber-200 bg-amber-50 p-4 text-amber-600">
          <AlertTriangle className="h-12 w-12" />
        </div>
        <div className="max-w-md">
          <h2 className="text-2xl font-bold tracking-tight">Acesso restrito</h2>
          <p className="mt-2 font-medium text-muted-foreground">{message}</p>
        </div>
        <Button variant="hero" className="h-12 px-8" asChild>
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-tight">Gestor de Pedidos</h1>
          <p className="text-sm font-medium text-muted-foreground">Gerencie todos os pedidos com visão completa e ações rápidas.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Realtime indicator */}
          <div className={cn(
            "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold",
            realtimeState === "online" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700",
          )}>
            <div className={cn("h-2 w-2 rounded-full", realtimeState === "online" ? "bg-emerald-500 animate-pulse" : "bg-amber-500")} />
            {realtimeState === "online" ? "Ao vivo" : "Reconectando"}
            {lastSync && realtimeState === "online" && (
              <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                · {lastSync.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-md font-bold uppercase tracking-widest text-[10px]"
            onClick={handleSoundToggle}
            title={muted ? "Ativar sons" : soundReady ? "Silenciar sons" : "Liberar som de novos pedidos"}
          >
            {muted ? <BellOff className="h-4 w-4" /> : soundReady ? <Bell className="h-4 w-4" /> : <BellRing className="h-4 w-4 text-primary" />}
            {muted || !soundReady ? "Ativar som" : "Som ativo"}
          </Button>

          <Button variant="outline" size="sm" className="rounded-md" onClick={() => setHistoryOpen(true)}>
            Histórico
          </Button>
          <Button variant="outline" size="sm" className="rounded-md" onClick={load}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Atualizar
          </Button>
        </div>
      </div>

      {/* Main layout: Sidebar + Content */}
      <div className="flex gap-5">
        {/* Filter Sidebar */}
        <OrdersFilterSidebar
          filters={filters}
          onChange={(f) => { setFilters(f); setTablePage(1); setMetricFilter(null); }}
          statusCounts={statusCounts}
        />

        {/* Content area */}
        <div className="min-w-0 flex-1 space-y-4">
          {/* Metrics Bar */}
          <OrdersMetricsBar
            counts={statusCounts}
            activeFilter={metricFilter}
            onFilterClick={handleMetricClick}
          />

          {/* View mode tabs */}
          <div className="flex items-center justify-between border-b border-border pb-2">
            <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "table" | "kanban" | "kitchen")}>
              <TabsList>
                <TabsTrigger value="table">
                  <List className="mr-1.5 h-3.5 w-3.5" /> Tabela
                </TabsTrigger>
                <TabsTrigger value="kanban">
                  <LayoutGrid className="mr-1.5 h-3.5 w-3.5" /> Kanban
                </TabsTrigger>
                <TabsTrigger value="kitchen">
                  <UtensilsCrossed className="mr-1.5 h-3.5 w-3.5" /> Cozinha
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {viewMode === "kanban" && (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md" onClick={() => boardRef.current?.scrollBy({ left: -360, behavior: "smooth" })}>
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-md" onClick={() => boardRef.current?.scrollBy({ left: 360, behavior: "smooth" })}>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          {/* TABLE VIEW */}
          {viewMode === "table" && (
            <OrdersDataTable
              orders={filteredOrders}
              loading={false}
              sort={sort}
              onSort={handleSort}
              page={tablePage}
              pageSize={15}
              onPageChange={setTablePage}
              onOpenDetail={openDetails}
              onAdvance={updateStatus}
              onCancel={cancelOrder}
              updatingId={updatingId}
              syncing={syncing}
            />
          )}

          {/* KANBAN VIEW */}
          {viewMode === "kanban" && (
            <div ref={boardRef} className="-mx-4 flex h-[calc(100vh-340px)] gap-4 overflow-x-auto overflow-y-hidden overscroll-contain px-4 pb-4 md:mx-0 md:px-0 snap-x">
              {OPERATIONAL_COLUMNS.map((col) => {
                const colOrders = orders.filter((order) => col.statuses.includes(order.status));

                return (
                  <div key={col.key} className="flex h-full min-w-[320px] max-w-[380px] shrink-0 snap-start flex-col gap-3">
                    <div className="px-1">
                      <div className="flex items-center justify-between border-b border-border pb-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wider">{col.label}</h3>
                        <span className="rounded-md bg-foreground px-2 py-0.5 text-[11px] font-semibold text-background">{colOrders.length}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{col.helper}</p>
                    </div>

                    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-dashed border-border bg-muted/30 p-2">
                      <AnimatePresence mode="popLayout">
                        {colOrders.map((order) => {
                          const action = getNextAction(order);
                          return (
                            <OrderCard
                              key={order.id}
                              order={order}
                              action={action}
                              updatingId={updatingId}
                              syncing={syncing}
                              onOpenDetail={openDetails}
                              onAdvance={updateStatus}
                              onApprovePix={approvePixPayment}
                            />
                          );
                        })}
                      </AnimatePresence>

                      {colOrders.length === 0 && (
                        <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-border text-xs font-medium text-muted-foreground/50">
                          Sem pedidos
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* KITCHEN VIEW */}
          {viewMode === "kitchen" && (
            kitchenLoading ? (
              <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <KitchenView
                orders={orders}
                storeName={store.name}
                itemsMap={(() => {
                  const map = new Map<string, any[]>();
                  for (const item of kitchenItems) {
                    const existing = map.get(item.order_id) || [];
                    existing.push(item);
                    map.set(item.order_id, existing);
                  }
                  return map;
                })()}
              />
            )
          )}
        </div>
      </div>

      {/* HISTORY DIALOG */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle>Histórico de pedidos</DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 md:grid-cols-[160px_180px_1fr_auto]">
            <Select value={historyPeriod} onValueChange={setHistoryPeriod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Hoje</SelectItem>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
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
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Buscar por cliente ou número"
            />
            <Button variant="outline" onClick={loadHistory} disabled={historyLoading}>
              {historyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Atualizar
            </Button>
          </div>

          {historyPeriod === "custom" && (
            <div className="grid gap-3 md:grid-cols-2">
              <Input type="date" value={historyStartDate} onChange={(e) => setHistoryStartDate(e.target.value)} aria-label="Data inicial" />
              <Input type="date" value={historyEndDate} onChange={(e) => setHistoryEndDate(e.target.value)} aria-label="Data final" />
            </div>
          )}

          <div className="space-y-2">
            {visibleHistory.map((order) => (
              <div key={order.id} className="grid gap-3 rounded-lg border border-border bg-card p-3 text-sm md:grid-cols-[90px_1fr_120px_120px] md:items-center">
                <div className="font-bold">#{order.order_number}</div>
                <div>
                  <div className="font-semibold">{order.customer_name}</div>
                  <div className="text-xs text-muted-foreground">{new Date(order.created_at).toLocaleString("pt-BR")}</div>
                  {order.delivery_type === "entrega" && (
                    <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
                      {formatDeliveryAddressLines(order).map((line: string) => (
                        <div key={line}>{line}</div>
                      ))}
                    </div>
                  )}
                </div>
                <Badge variant="outline" className={cn("w-fit text-[10px] font-semibold uppercase", STATUS_COLORS[order.status] || "")}>
                  {STATUS_LABELS[order.status] || order.status}
                </Badge>
                <div className="font-bold">{formatBRL(order.total)}</div>
              </div>
            ))}
            {!historyLoading && visibleHistory.length === 0 && (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm font-medium text-muted-foreground">
                Nenhum pedido no histórico
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs font-medium text-muted-foreground">
              Página {historyPage} de {historyTotalPages}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={historyPage <= 1} onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={historyPage >= historyTotalPages} onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}>Próxima</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ORDER DETAIL DIALOG */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              Pedido #{selected?.order_number}
              {selected && (
                <Badge className={cn("text-[10px] font-semibold uppercase", STATUS_COLORS[selected.status] || "")}>
                  {STATUS_LABELS[selected.status] ?? selected.status}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="grid gap-4 text-sm lg:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                {/* Customer & Delivery */}
                <section className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Cliente e entrega</div>
                  <div className="space-y-2">
                    <div className="font-semibold">{selected.customer_name}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Phone className="h-3.5 w-3.5" /> {selected.customer_phone}
                    </div>
                    {selected.delivery_type === "entrega" && (
                      <div className="flex items-start gap-2 text-xs text-muted-foreground">
                        <MapPin className="mt-0.5 h-3.5 w-3.5" />
                        <div>
                          {formatDeliveryAddressLines(selected).map((line: string) => (
                            <div key={line}>{line}</div>
                          ))}
                          {selected.delivery_reference && <div className="text-[10px] italic">Ref: {selected.delivery_reference}</div>}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Badge variant="status" className="text-[10px]">
                        {selected.delivery_type === "retirada" ? "Retirada" : "Entrega"}
                      </Badge>
                      {selected.estimated_min && (
                        <Badge variant="outline" className="border-blue-200 bg-blue-50 text-[10px] font-semibold text-blue-700">
                          {selected.estimated_min}-{selected.estimated_max} min
                        </Badge>
                      )}
                    </div>
                  </div>
                </section>

                {/* Items */}
                <section className="rounded-lg border border-border bg-card p-4">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Itens</div>
                  <div className="space-y-3">
                    {items.map((item: any) => (
                      <div key={item.id} className="border-b border-dashed border-border pb-3 last:border-0 last:pb-0">
                        <div className="flex justify-between gap-4 font-medium">
                          <span>{item.quantity}x {item.product_name}</span>
                          <span>{formatBRL(getItemTotal(item))}</span>
                        </div>
                        <div className="mt-0.5 pl-4 text-xs text-muted-foreground">
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
                {/* Payment */}
                <section className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pagamento</div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2 font-medium">
                        {selected.payment_method === "dinheiro" ? <Wallet className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
                        {PAYMENT_METHOD_LABELS[selected.payment_method] || selected.payment_method}
                      </span>
                      <Badge variant="outline" className={cn("text-[10px] font-semibold uppercase", PAYMENT_STATUS_CLASSES[selected.payment_status || "pendente"] || PAYMENT_STATUS_CLASSES.pendente)}>
                        {PAYMENT_STATUS_LABELS[selected.payment_status || "pendente"] || selected.payment_status}
                      </Badge>
                    </div>
                    {selected.change_for && <div className="text-xs text-muted-foreground">Troco para: {formatBRL(selected.change_for)}</div>}
                    {selected.payment_method !== "pix" && selected.status !== "entregue" && (
                      <div className="rounded-lg border border-dashed border-border bg-card p-3 text-[11px] text-muted-foreground">
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

                {/* Financial summary */}
                <section className="rounded-lg border border-border bg-card p-4">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Resumo financeiro</div>
                  <div className="space-y-1.5 text-sm">
                    {items.length > 0 && <div className="flex justify-between"><span>Itens</span><span>{formatBRL(selectedItemsTotal)}</span></div>}
                    <div className="flex justify-between"><span>Subtotal</span><span>{formatBRL(selected.subtotal)}</span></div>
                    {selected.delivery_type === "entrega" && <div className="flex justify-between"><span>Entrega</span><span>{formatBRL(selected.delivery_fee)}</span></div>}
                    {Number(selected.discount_amount) > 0 && (
                      <div className="flex justify-between text-emerald-600">
                        <span>Desconto {selected.coupon_code && `(${selected.coupon_code})`}</span>
                        <span>-{formatBRL(selected.discount_amount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
                      <span>Total</span>
                      <span className="text-primary">{formatBRL(selected.total)}</span>
                    </div>
                  </div>
                  {selected.notes && <div className="mt-3 rounded-md bg-muted p-3 text-xs italic text-muted-foreground">Obs: "{selected.notes}"</div>}
                </section>

                {/* Quick actions */}
                <section className="rounded-lg border border-border bg-muted/30 p-4">
                  <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ações rápidas</div>
                  <div className="flex flex-col gap-2">
                    {selectedAction && (
                      <Button variant="hero" size="sm" onClick={() => updateStatus(selected.id, selectedAction.status)} disabled={updatingId === selected.id}>
                        {updatingId === selected.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        {selectedAction.label}
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" className="h-9 rounded-lg bg-slate-800 text-white hover:bg-slate-700 px-4 text-[11px] font-bold uppercase tracking-widest shadow-sm" onClick={() => printOrderTicket({ order: { ...selected, store_name: store.name }, items, title: "Pedido" })}>
                      <Printer className="mr-1.5 h-4 w-4" /> Imprimir pedido
                    </Button>
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

export default Orders;
