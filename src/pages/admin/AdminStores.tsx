import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Search, ExternalLink, Pause, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";

const AdminStores = () => {
  const [stores, setStores] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: s }, { data: p }] = await Promise.all([
      supabase.from("stores").select("*, subscriptions(status, plan_id, plans(name, price_monthly))").order("created_at", { ascending: false }),
      supabase.from("plans").select("*").order("sort_order"),
    ]);
    setStores(s ?? []);
    setPlans(p ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter((s) => s.name.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q));
  }, [stores, search]);

  const toggleSuspend = async (store: any) => {
    const { error } = await supabase.from("stores").update({ is_suspended: !store.is_suspended }).eq("id", store.id);
    if (error) return toast.error(error.message);
    toast.success(store.is_suspended ? "Loja reativada" : "Loja suspensa");
    load();
  };

  const changePlan = async (store: any, planId: string) => {
    const sub = store.subscriptions?.[0];
    if (sub) {
      await supabase.from("subscriptions").update({ plan_id: planId, status: "ativa" }).eq("store_id", store.id);
    } else {
      await supabase.from("subscriptions").insert({ store_id: store.id, plan_id: planId, status: "ativa" });
    }
    await supabase.from("stores").update({ plan_id: planId }).eq("id", store.id);
    toast.success("Plano alterado");
    load();
  };

  const remove = async (store: any) => {
    if (!confirm(`EXCLUIR PERMANENTEMENTE a loja "${store.name}"? Isso apaga TODOS os dados.`)) return;
    const { error } = await supabase.from("stores").delete().eq("id", store.id);
    if (error) return toast.error(error.message);
    toast.success("Loja excluída");
    setSelected(null); load();
  };

  if (loading) return <div className="py-20 text-center"><Loader2 className="h-8 w-8 animate-spin inline text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Lojas</h1>
        <p className="text-muted-foreground">{stores.length} lojas no total.</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="space-y-2">
        {filtered.map((s) => {
          const sub = s.subscriptions?.[0];
          return (
            <Card key={s.id} className="p-4 flex items-center gap-4 cursor-pointer hover:border-primary/50" onClick={() => setSelected(s)}>
              <div className="h-12 w-12 rounded-lg bg-muted overflow-hidden shrink-0">
                {s.logo_url && <img src={s.logo_url} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium truncate">{s.name}</div>
                  {s.is_suspended && <Badge variant="destructive">Suspensa</Badge>}
                  {!s.is_active && <Badge variant="secondary">Inativa</Badge>}
                </div>
                <div className="text-xs text-muted-foreground truncate">/{s.slug} · {s.email}</div>
              </div>
              <div className="text-right hidden md:block">
                <div className="text-sm font-medium">{sub?.plans?.name ?? "Sem plano"}</div>
                {sub?.plans?.price_monthly && <div className="text-xs text-muted-foreground">{formatBRL(sub.plans.price_monthly)}/mês</div>}
              </div>
            </Card>
          );
        })}
        {filtered.length === 0 && <Card className="p-10 text-center text-muted-foreground">Nada encontrado.</Card>}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{selected?.name}</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Slug: <span className="font-mono text-foreground">/{selected.slug}</span></div>
                <div>E-mail: {selected.email ?? "—"}</div>
                <div>Telefone: {selected.phone ?? "—"}</div>
                <div>Cidade: {selected.city ?? "—"} {selected.state && `/${selected.state}`}</div>
                <div>Criada em: {new Date(selected.created_at).toLocaleDateString("pt-BR")}</div>
              </div>

              <div>
                <label className="text-xs font-medium">Plano</label>
                <Select value={selected.subscriptions?.[0]?.plan_id ?? ""} onValueChange={(v) => changePlan(selected, v)}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>
                    {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name} — {formatBRL(p.price_monthly)}/mês</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <Button asChild variant="outline">
                  <a href={`/loja/${selected.slug}`} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Abrir loja pública</a>
                </Button>
                <Button variant={selected.is_suspended ? "default" : "outline"} onClick={() => toggleSuspend(selected)}>
                  {selected.is_suspended ? <><Play className="h-4 w-4" /> Reativar</> : <><Pause className="h-4 w-4" /> Suspender</>}
                </Button>
                <Button variant="destructive" onClick={() => remove(selected)}><Trash2 className="h-4 w-4" /> Excluir loja</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default AdminStores;
