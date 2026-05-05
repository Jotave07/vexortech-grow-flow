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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Visão geral do seu delivery hoje.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground uppercase">Vendas hoje</span>
            <DollarSign className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold">{formatBRL(stats.todayRevenue)}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground uppercase">Pedidos hoje</span>
            <ShoppingBag className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold">{stats.todayOrders}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground uppercase">Ticket médio</span>
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold">{formatBRL(stats.avgTicket)}</div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground uppercase">Faturamento mês</span>
            <DollarSign className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold">{formatBRL(stats.monthRevenue)}</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="text-xs text-muted-foreground mb-1">Pendentes</div>
          <div className="text-3xl font-bold text-blue-500">{stats.pending}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground mb-1">Em preparo</div>
          <div className="text-3xl font-bold text-amber-500">{stats.preparing}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground mb-1">Em entrega/retirada</div>
          <div className="text-3xl font-bold text-cyan-500">{stats.delivering}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted-foreground mb-1">Entregues</div>
          <div className="text-3xl font-bold text-green-500">{stats.delivered}</div>
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2"><Clock className="h-4 w-4" /> Mais vendidos do mês</h2>
        {topProducts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum pedido neste mês ainda.</p>
        ) : (
          <ul className="space-y-2">
            {topProducts.map((p, i) => (
              <li key={p.name} className="flex justify-between items-center py-2 border-b border-border last:border-0">
                <span className="text-sm">{i + 1}. {p.name}</span>
                <span className="text-sm font-medium">{p.qty} un.</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default Dashboard;
