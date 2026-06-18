import { useEffect, useState } from "react";
import { useOutletContext, Link } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ShoppingBag,
  DollarSign,
  TrendingUp,
  Clock,
  Loader2,
  AlertTriangle,
  ArrowRight,
  Truck,
  UtensilsCrossed,
  BarChart3,
  Ticket,
} from "lucide-react";
import { useSubscriptionStatus } from "@/hooks/use-subscription-status";
import { buildDeliveryUrl } from "@/lib/domains";

type Stats = {
  todayOrders: number;
  todayRevenue: number;
  avgTicket: number;
  pending: number;
  preparing: number;
  delivering: number;
  delivered: number;
  monthRevenue: number;
};

const Dashboard = () => {
  const { store } = useOutletContext<{ store: any }>();
  const { accessState, message } = useSubscriptionStatus();
  const [stats, setStats] = useState<Stats | null>(null);
  const [topProducts, setTopProducts] = useState<{ name: string; qty: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!store?.id) return;
    const load = async () => {
      const startToday = new Date();
      startToday.setHours(0, 0, 0, 0);
      const startMonth = new Date(startToday.getFullYear(), startToday.getMonth(), 1);

      const { data: today } = await backend
        .from("orders")
        .select("total, status")
        .eq("store_id", store.id)
        .gte("created_at", startToday.toISOString());
      const { data: month } = await backend
        .from("orders")
        .select("total")
        .eq("store_id", store.id)
        .gte("created_at", startMonth.toISOString())
        .neq("status", "cancelado");
      const { data: countByStatus } = await backend
        .from("orders")
        .select("status")
        .eq("store_id", store.id)
        .in("status", ["novo", "confirmado", "em_preparo", "saiu_para_entrega", "pronto_para_retirada", "entregue"]);

      const todayValid = (today ?? []).filter((o: any) => o.status !== "cancelado");
      const todayRevenue = todayValid.reduce((s: number, o: any) => s + Number(o.total), 0);
      const monthRevenue = (month ?? []).reduce((s: number, o: any) => s + Number(o.total), 0);

      const counts = (countByStatus ?? []).reduce((acc: any, o: any) => {
        acc[o.status] = (acc[o.status] ?? 0) + 1;
        return acc;
      }, {});

      setStats({
        todayOrders: todayValid.length,
        todayRevenue,
        avgTicket: todayValid.length ? todayRevenue / todayValid.length : 0,
        pending: (counts.novo ?? 0) + (counts.confirmado ?? 0),
        preparing: counts.em_preparo ?? 0,
        delivering: (counts.saiu_para_entrega ?? 0) + (counts.pronto_para_retirada ?? 0),
        delivered: counts.entregue ?? 0,
        monthRevenue,
      });

      const { data: items } = await backend
        .from("order_items")
        .select("product_name, quantity")
        .eq("store_id", store.id)
        .gte("created_at", startMonth.toISOString())
        .limit(1000);
      const map = new Map<string, number>();
      (items ?? []).forEach((it: any) => map.set(it.product_name, (map.get(it.product_name) ?? 0) + it.quantity));
      const top = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty }));
      setTopProducts(top);

      setLoading(false);
    };
    load();
  }, [store?.id]);

  if (loading || !stats) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (accessState !== "active") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 space-y-4">
        <div className="bg-amber-50 text-amber-600 p-4 rounded-none border-2 border-amber-200">
          <AlertTriangle className="h-12 w-12" />
        </div>
        <div className="max-w-md">
          <h2 className="text-2xl font-black uppercase tracking-tight italic">Acesso Restrito</h2>
          <p className="text-muted-foreground mt-2 font-medium">{message}</p>
        </div>
        <Button variant="hero" className="font-black uppercase tracking-widest text-xs h-12 px-8" asChild>
          <Link to="/lojista/assinatura">
            Regularizar Assinatura <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    );
  }

  const activeOrders = stats.pending + stats.preparing + stats.delivering;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tight">Visão Geral</h1>
          <p className="font-medium text-muted-foreground">Performance do seu delivery em tempo real.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-none border border-border bg-muted/40 px-3 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            <Clock className="h-3.5 w-3.5 text-primary" /> Atualizado agora
          </div>
          <Button variant="hero" className="h-10 font-black uppercase tracking-widest text-xs" asChild>
            <Link to="/lojista/pedidos">
              Ver pedidos <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI cards — dados reais */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Faturamento Hoje" value={formatBRL(stats.todayRevenue)} icon={DollarSign} tone="primary" hint="Hoje" />
        <StatCard label="Pedidos Hoje" value={String(stats.todayOrders)} icon={ShoppingBag} tone="info" hint="Hoje" />
        <StatCard label="Ticket Médio" value={formatBRL(stats.avgTicket)} icon={TrendingUp} tone="indigo" hint="Hoje" />
        <StatCard label="Em Rota" value={String(stats.delivering)} icon={Truck} tone="cyan" hint="Agora" />
        <StatCard label="Pendentes" value={String(stats.pending)} icon={Clock} tone="amber" hint="Agora" />
        <StatCard label="Total no Mês" value={formatBRL(stats.monthRevenue)} icon={DollarSign} tone="primary" hint="Mês" />
      </div>

      {/* Board de status (estilo kanban da referência) */}
      <Card className="overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-border bg-muted/30 p-4">
          <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest">
            <ShoppingBag className="h-4 w-4 text-primary" /> Pedidos por status
          </h2>
          <span className="rounded-none bg-primary/15 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-foreground">
            {activeOrders} ativos
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 p-4 lg:grid-cols-4">
          <StatusColumn label="Novos / Pendentes" value={stats.pending} accent="bg-blue-500" />
          <StatusColumn label="Em Preparo" value={stats.preparing} accent="bg-amber-500" />
          <StatusColumn label="Em Rota / Prontos" value={stats.delivering} accent="bg-cyan-500" />
          <StatusColumn label="Finalizados" value={stats.delivered} accent="bg-primary" />
        </div>
        <div className="border-t border-border p-3 text-center">
          <Link
            to="/lojista/pedidos"
            className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-foreground hover:text-primary"
          >
            Gerenciar todos os pedidos <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Card>

      {/* Mais vendidos + lateral */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <Card className="overflow-hidden p-0 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border bg-muted/30 p-4">
            <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest">
              <TrendingUp className="h-4 w-4 text-primary" /> Produtos mais vendidos
            </h2>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Mês atual</span>
          </div>
          <div className="p-6">
            {topProducts.length === 0 ? (
              <div className="py-10 text-center text-sm italic text-muted-foreground">
                Aguardando os primeiros pedidos do mês...
              </div>
            ) : (
              <div className="space-y-4">
                {topProducts.map((p, i) => (
                  <div key={p.name} className="group relative">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="truncate pr-10 text-sm font-bold">
                        <span className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-none bg-primary/15 text-[10px] font-black text-foreground">{i + 1}</span>
                        {p.name}
                      </span>
                      <span className="text-sm font-black">{p.qty} un.</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-none border border-border bg-muted">
                      <div
                        className="h-full bg-primary transition-all duration-1000 ease-out"
                        style={{ width: `${(p.qty / (topProducts[0]?.qty || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <div className="space-y-6">
          {/* Ações rápidas */}
          <Card className="p-5">
            <h3 className="mb-4 text-sm font-black uppercase tracking-widest">Ações rápidas</h3>
            <div className="grid grid-cols-2 gap-3">
              <QuickAction to="/lojista/cardapio" icon={UtensilsCrossed} label="Cardápio" />
              <QuickAction to="/lojista/pedidos" icon={ShoppingBag} label="Pedidos" />
              <QuickAction to="/lojista/cupons" icon={Ticket} label="Cupons" />
              <QuickAction to="/lojista/relatorios" icon={BarChart3} label="Relatórios" />
            </div>
          </Card>

          {/* Loja online */}
          <Card className="flex flex-col items-center justify-center border-primary/20 bg-[var(--hype-dark)] p-6 text-center text-white shadow-elegant">
            <div className="mb-4 rounded-none bg-primary/20 p-4">
              <ShoppingBag className="h-8 w-8 text-primary" />
            </div>
            <h3 className="mb-2 text-lg font-black uppercase tracking-tight">Sua loja está online</h3>
            <p className="mb-6 text-sm text-white/80">Continue oferecendo o melhor serviço para seus clientes.</p>
            <Button
              variant="outline"
              className="w-full border-primary bg-primary text-primary-foreground font-bold uppercase tracking-widest text-xs hover:bg-[var(--hype-green-dark)]"
              asChild
            >
              <a href={buildDeliveryUrl(`/loja/${store.slug}`)} target="_blank" rel="noreferrer">
                Abrir visualização
              </a>
            </Button>
          </Card>
        </div>
      </div>
    </div>
  );
};

const TONES: Record<string, string> = {
  primary: "text-[var(--hype-green-dark)] bg-primary/10 group-hover:bg-primary/20",
  info: "text-blue-600 bg-blue-50 group-hover:bg-blue-100",
  indigo: "text-indigo-600 bg-indigo-50 group-hover:bg-indigo-100",
  cyan: "text-cyan-600 bg-cyan-50 group-hover:bg-cyan-100",
  amber: "text-amber-600 bg-amber-50 group-hover:bg-amber-100",
};

const StatCard = ({
  label,
  value,
  icon: Icon,
  tone,
  hint,
}: {
  label: string;
  value: string;
  icon: any;
  tone: keyof typeof TONES;
  hint: string;
}) => (
  <Card className="group p-5 transition-smooth hover:border-primary">
    <div className="mb-3 flex items-center justify-between">
      <div className={cn("rounded-none p-2 transition-smooth", TONES[tone])}>
        <Icon className="h-5 w-5" />
      </div>
      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{hint}</span>
    </div>
    <div className="mb-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
    <div className="text-2xl font-black tracking-tighter">{value}</div>
  </Card>
);

const StatusColumn = ({ label, value, accent }: { label: string; value: number; accent: string }) => (
  <div className="rounded-none border border-border bg-card p-4">
    <div className="mb-3 flex items-center gap-2">
      <span className={cn("h-2.5 w-2.5 rounded-none", accent)} />
      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</span>
    </div>
    <div className="text-3xl font-black tracking-tighter">{value}</div>
  </div>
);

const QuickAction = ({ to, icon: Icon, label }: { to: string; icon: any; label: string }) => (
  <Link
    to={to}
    className="flex flex-col items-center justify-center gap-2 rounded-none border border-border bg-muted/30 p-4 text-center transition-smooth hover:border-primary hover:bg-primary/10"
  >
    <Icon className="h-5 w-5 text-primary" />
    <span className="text-[11px] font-black uppercase tracking-widest">{label}</span>
  </Link>
);

export default Dashboard;
