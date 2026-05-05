import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { formatBRL } from "@/lib/format";
import { ShoppingBag, DollarSign, TrendingUp, Clock, Loader2 } from "lucide-react";

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
  const [stats, setStats] = useState<Stats | null>(null);
  const [topProducts, setTopProducts] = useState<{ name: string; qty: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!store?.id) return;
    const load = async () => {
      const startToday = new Date();
      startToday.setHours(0, 0, 0, 0);
      const startMonth = new Date(startToday.getFullYear(), startToday.getMonth(), 1);

      const { data: today } = await supabase
        .from("orders")
        .select("total, status")
        .eq("store_id", store.id)
        .gte("created_at", startToday.toISOString());
      const { data: month } = await supabase
        .from("orders")
        .select("total")
        .eq("store_id", store.id)
        .gte("created_at", startMonth.toISOString())
        .neq("status", "cancelado");
      const { data: countByStatus } = await supabase
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

      const { data: items } = await supabase
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

  return (
    <div className="space-y-8 max-w-6xl">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tight">Painel de Controle</h1>
          <p className="text-muted-foreground font-medium">Performance do seu delivery em tempo real.</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground bg-muted/30 px-3 py-1.5 border border-border">
          <Clock className="h-3.5 w-3.5" /> Atualizado agora
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          label="Receita Hoje" 
          value={formatBRL(stats.todayRevenue)} 
          icon={DollarSign} 
          color="text-emerald-600"
        />
        <StatCard 
          label="Pedidos Hoje" 
          value={String(stats.todayOrders)} 
          icon={ShoppingBag} 
          color="text-blue-600"
        />
        <StatCard 
          label="Ticket Médio" 
          value={formatBRL(stats.avgTicket)} 
          icon={TrendingUp} 
          color="text-indigo-600"
        />
        <StatCard 
          label="Total no Mês" 
          value={formatBRL(stats.monthRevenue)} 
          icon={DollarSign} 
          color="text-primary"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatusMiniCard label="Pendentes" value={stats.pending} color="bg-blue-500" />
        <StatusMiniCard label="Em preparo" value={stats.preparing} color="bg-amber-500" />
        <StatusMiniCard label="Em rota" value={stats.delivering} color="bg-cyan-500" />
        <StatusMiniCard label="Finalizados" value={stats.delivered} color="bg-emerald-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2 p-0 overflow-hidden">
          <div className="border-b border-black bg-muted/30 p-4">
            <h2 className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Produtos em Destaque
            </h2>
          </div>
          <div className="p-6">
            {topProducts.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm italic">
                Aguardando os primeiros pedidos do mês...
              </div>
            ) : (
              <div className="space-y-4">
                {topProducts.map((p, i) => (
                  <div key={p.name} className="group relative">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-bold truncate pr-10">{i + 1}. {p.name}</span>
                      <span className="text-sm font-black">{p.qty} un.</span>
                    </div>
                    <div className="h-2 w-full bg-muted overflow-hidden border border-black/5">
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

        <Card className="p-6 flex flex-col items-center justify-center text-center bg-primary text-white border-primary shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
          <div className="rounded-full bg-white/20 p-4 mb-4">
            <ShoppingBag className="h-8 w-8" />
          </div>
          <h3 className="text-lg font-black uppercase tracking-tight mb-2">Sua Loja está Online</h3>
          <p className="text-sm text-white/80 mb-6">
            Continue oferecendo o melhor serviço para seus clientes.
          </p>
          <Button variant="outline" className="w-full bg-white text-primary border-white hover:bg-white/90 font-bold uppercase tracking-widest text-xs" asChild>
            <a href={`/loja/${store.slug}`} target="_blank" rel="noreferrer">
              Abrir Visualização
            </a>
          </Button>
        </Card>
      </div>
    </div>
  );
};

const StatCard = ({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) => (
  <Card className="p-6 group hover:border-primary transition-smooth">
    <div className="flex items-center justify-between mb-4">
      <div className="p-2 bg-muted group-hover:bg-primary/10 transition-smooth">
        <Icon className={cn("h-5 w-5", color)} />
      </div>
      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Global</span>
    </div>
    <div className="text-sm font-bold text-muted-foreground uppercase tracking-widest mb-1">{label}</div>
    <div className="text-3xl font-black tracking-tighter">{value}</div>
  </Card>
);

const StatusMiniCard = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <Card className="p-4 flex items-center gap-4">
    <div className={cn("h-3 w-3 shrink-0 rounded-full animate-pulse", color)} />
    <div>
      <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground leading-none mb-1">{label}</div>
      <div className="text-xl font-black">{value}</div>
    </div>
  </Card>
);

export default Dashboard;
