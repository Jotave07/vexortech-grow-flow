import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Download, TrendingUp, ShoppingBag, DollarSign, Users } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar, CartesianGrid } from "recharts";

const RANGES = [
  { key: "7", label: "7 dias" },
  { key: "30", label: "30 dias" },
  { key: "90", label: "90 dias" },
];

const Reports = () => {
  const { store } = useOutletContext<{ store: any }>();
  const [range, setRange] = useState("30");
  const [orders, setOrders] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!store?.id) return;
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - Number(range) * 24 * 60 * 60 * 1000).toISOString();
      const [{ data: o }, { data: it }] = await Promise.all([
        supabase.from("orders").select("created_at, total, status, order_type, payment_method, customer_id")
          .eq("store_id", store.id).gte("created_at", since).limit(2000),
        supabase.from("order_items").select("product_name, quantity, subtotal, created_at")
          .eq("store_id", store.id).gte("created_at", since).limit(5000),
      ]);
      setOrders(o ?? []);
      setItems(it ?? []);
      setLoading(false);
    })();
  }, [store?.id, range]);

  const valid = useMemo(() => orders.filter((o) => o.status !== "cancelado"), [orders]);

  const totals = useMemo(() => {
    const revenue = valid.reduce((s, o) => s + Number(o.total), 0);
    const count = valid.length;
    const avgTicket = count ? revenue / count : 0;
    const uniqCustomers = new Set(valid.map((o) => o.customer_id).filter(Boolean)).size;
    return { revenue, count, avgTicket, uniqCustomers };
  }, [valid]);

  const byDay = useMemo(() => {
    const map = new Map<string, { date: string; revenue: number; count: number }>();
    const days = Number(range);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      map.set(key, { date: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), revenue: 0, count: 0 });
    }
    valid.forEach((o) => {
      const k = o.created_at.slice(0, 10);
      const e = map.get(k);
      if (e) { e.revenue += Number(o.total); e.count += 1; }
    });
    return [...map.values()];
  }, [valid, range]);

  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    items.forEach((it) => {
      const cur = map.get(it.product_name) ?? { name: it.product_name, qty: 0, revenue: 0 };
      cur.qty += it.quantity;
      cur.revenue += Number(it.subtotal);
      map.set(it.product_name, cur);
    });
    return [...map.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);
  }, [items]);

  const byPayment = useMemo(() => {
    const map = new Map<string, number>();
    valid.forEach((o) => map.set(o.payment_method, (map.get(o.payment_method) ?? 0) + 1));
    return [...map.entries()].map(([method, count]) => ({ method, count }));
  }, [valid]);

  const exportCSV = () => {
    const headers = ["data", "pedidos", "faturamento"];
    const rows = byDay.map((d) => [d.date, d.count, d.revenue.toFixed(2)]);
    const csv = [headers, ...rows].map((r) => r.join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `relatorio-${range}d.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <div className="py-20 text-center"><Loader2 className="h-8 w-8 animate-spin inline text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Relatórios</h1>
          <p className="text-muted-foreground">Análises do seu delivery.</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex border border-border rounded-md overflow-hidden">
            {RANGES.map((r) => (
              <button key={r.key} onClick={() => setRange(r.key)}
                className={`px-3 py-1.5 text-sm ${range === r.key ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>
                {r.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={exportCSV}><Download className="h-4 w-4" /> CSV</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-5"><div className="flex justify-between mb-2"><span className="text-xs text-muted-foreground uppercase">Faturamento</span><DollarSign className="h-4 w-4 text-primary" /></div><div className="text-2xl font-bold">{formatBRL(totals.revenue)}</div></Card>
        <Card className="p-5"><div className="flex justify-between mb-2"><span className="text-xs text-muted-foreground uppercase">Pedidos</span><ShoppingBag className="h-4 w-4 text-primary" /></div><div className="text-2xl font-bold">{totals.count}</div></Card>
        <Card className="p-5"><div className="flex justify-between mb-2"><span className="text-xs text-muted-foreground uppercase">Ticket médio</span><TrendingUp className="h-4 w-4 text-primary" /></div><div className="text-2xl font-bold">{formatBRL(totals.avgTicket)}</div></Card>
        <Card className="p-5"><div className="flex justify-between mb-2"><span className="text-xs text-muted-foreground uppercase">Clientes únicos</span><Users className="h-4 w-4 text-primary" /></div><div className="text-2xl font-bold">{totals.uniqCustomers}</div></Card>
      </div>

      <Card className="p-5">
        <h2 className="font-semibold mb-4">Faturamento por dia</h2>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={byDay}>
            <defs>
              <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickFormatter={(v) => `R$${v}`} />
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
              formatter={(v: any) => formatBRL(v)} />
            <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#g1)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-5">
          <h2 className="font-semibold mb-4">Top 10 produtos</h2>
          {topProducts.length === 0 ? <p className="text-sm text-muted-foreground">Sem dados.</p> : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topProducts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis dataKey="name" type="category" stroke="hsl(var(--muted-foreground))" fontSize={11} width={120} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Bar dataKey="qty" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold mb-4">Pagamento</h2>
          {byPayment.length === 0 ? <p className="text-sm text-muted-foreground">Sem dados.</p> : (
            <ul className="space-y-2">
              {byPayment.map((p) => (
                <li key={p.method} className="flex justify-between items-center py-2 border-b border-border last:border-0">
                  <span className="capitalize text-sm">{p.method.replace("_", " ")}</span>
                  <span className="font-semibold">{p.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
};
export default Reports;
