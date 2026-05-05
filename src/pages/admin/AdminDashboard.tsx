import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Loader2, Building2, ShoppingBag, DollarSign, CreditCard } from "lucide-react";
import { formatBRL } from "@/lib/format";

const AdminDashboard = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ stores: 0, activeStores: 0, orders30: 0, revenue30: 0, mrr: 0 });

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const [{ count: total }, { count: active }, { data: orders }, { data: subs }] = await Promise.all([
        supabase.from("stores").select("*", { count: "exact", head: true }),
        supabase.from("stores").select("*", { count: "exact", head: true }).eq("is_active", true).eq("is_suspended", false),
        supabase.from("orders").select("total, status").gte("created_at", since).limit(5000),
        supabase.from("subscriptions").select("status, plans(price_monthly)").in("status", ["ativa", "trial"]),
      ]);
      const valid = (orders ?? []).filter((o: any) => o.status !== "cancelado");
      const revenue = valid.reduce((s: number, o: any) => s + Number(o.total), 0);
      const mrr = (subs ?? []).filter((s: any) => s.status === "ativa").reduce((sum: number, s: any) => sum + Number(s.plans?.price_monthly ?? 0), 0);
      setStats({ stores: total ?? 0, activeStores: active ?? 0, orders30: valid.length, revenue30: revenue, mrr });
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="py-20 text-center"><Loader2 className="h-8 w-8 animate-spin inline text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Visão geral Vexor</h1>
        <p className="text-muted-foreground">Métricas globais da plataforma.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-5"><div className="flex justify-between mb-2"><span className="text-xs text-muted-foreground uppercase">Lojas</span><Building2 className="h-4 w-4 text-primary" /></div><div className="text-2xl font-bold">{stats.activeStores}/{stats.stores}</div><div className="text-xs text-muted-foreground">ativas/total</div></Card>
        <Card className="p-5"><div className="flex justify-between mb-2"><span className="text-xs text-muted-foreground uppercase">Pedidos (30d)</span><ShoppingBag className="h-4 w-4 text-primary" /></div><div className="text-2xl font-bold">{stats.orders30}</div></Card>
        <Card className="p-5"><div className="flex justify-between mb-2"><span className="text-xs text-muted-foreground uppercase">GMV (30d)</span><DollarSign className="h-4 w-4 text-primary" /></div><div className="text-2xl font-bold">{formatBRL(stats.revenue30)}</div></Card>
        <Card className="p-5"><div className="flex justify-between mb-2"><span className="text-xs text-muted-foreground uppercase">MRR</span><CreditCard className="h-4 w-4 text-primary" /></div><div className="text-2xl font-bold">{formatBRL(stats.mrr)}</div></Card>
      </div>
    </div>
  );
};
export default AdminDashboard;
