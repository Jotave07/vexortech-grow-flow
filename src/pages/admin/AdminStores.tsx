import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Search, ExternalLink, Pause, Play, Trash2, ShieldCheck, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

const AdminStores = () => {
  const [stores, setStores] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newStore, setNewStore] = useState({
    email: "",
    password: "",
    full_name: "",
    name: "",
    slug: "",
    whatsapp: "",
    document: "",
    city: "",
    state: "",
  });

  const load = async () => {
    setLoading(true);
    const [{ data: s }, { data: p }, { data: profilesData }] = await Promise.all([
      supabase.from("stores").select("*, subscriptions(status, plan_id, plans(name, price_monthly))").order("created_at", { ascending: false }),
      supabase.from("plans").select("*").order("sort_order"),
      supabase.from("profiles").select("id, store_id, is_exempt").eq("role", "store_owner")
    ]);
    
    // Attach is_exempt from owner profile to store
    const storesWithExempt = (s ?? []).map(store => {
      const ownerProfile = (profilesData ?? []).find(prof => prof.store_id === store.id);
      return { ...store, is_exempt: ownerProfile?.is_exempt || false, owner_profile_id: ownerProfile?.id };
    });

    setStores(storesWithExempt);
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

  const toggleExempt = async (store: any) => {
    if (!store.owner_profile_id) {
      return toast.error("Dono da loja não encontrado no sistema de perfis.");
    }
    const newValue = !store.is_exempt;
    const { error } = await supabase.from("profiles").update({ is_exempt: newValue }).eq("id", store.owner_profile_id);
    if (error) return toast.error(error.message);
    toast.success(newValue ? "Loja marcada como Isenta (Acesso Total)" : "Isenção removida");
    load();
  };

  const changePlan = async (store: any, planId: string) => {
    if (planId === "cortesia") {
      // Find or create a "cortesia" plan record if it doesn't exist, or just update the sub status
      // For now, let's just mark it as active without a specific plan_id if it's courtesy, 
      // but the best way is to have a specific plan.
      const courtesyPlan = plans.find(p => p.slug?.toLowerCase() === 'premium_cortesia' || p.slug?.toLowerCase() === 'isento');
      const targetPlanId = courtesyPlan?.id || plans[0]?.id;
      
      const sub = store.subscriptions?.[0];
      if (sub) {
        await supabase.from("subscriptions").update({ 
          plan_id: targetPlanId, 
          status: "ativa",
          trial_ends_at: null
        }).eq("store_id", store.id);
      } else {
        await supabase.from("subscriptions").insert({ 
          store_id: store.id, 
          plan_id: targetPlanId, 
          status: "ativa" 
        });
      }
      // Also update the store's plan_id to keep it in sync
      if (targetPlanId) {
        await supabase.from("stores").update({ plan_id: targetPlanId, is_active: true }).eq("id", store.id);
      }
      toast.success("Plano Cortesia ativado");
    } else {
      const sub = store.subscriptions?.[0];
      if (sub) {
        await supabase.from("subscriptions").update({ plan_id: planId, status: "ativa" }).eq("store_id", store.id);
      } else {
        await supabase.from("subscriptions").insert({ store_id: store.id, plan_id: planId, status: "ativa" });
      }
      await supabase.from("stores").update({ plan_id: planId, is_active: true }).eq("id", store.id);
      toast.success("Plano alterado");
    }
    load();
  };

  const remove = async (store: any) => {
    if (!confirm(`EXCLUIR PERMANENTEMENTE a loja "${store.name}"? Isso apaga TODOS os dados, inclusive o acesso do lojista.`)) return;
    
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-delete-store", {
      body: { store_id: store.id }
    });

    if (error || data?.error) {
      setLoading(false);
      return toast.error(error?.message || data?.error || "Erro ao excluir loja");
    }

    toast.success("Loja e usuário excluídos com sucesso");
    setSelected(null);
    load();
  };

  const handleCreateStore = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-store", {
        body: newStore
      });

      if (error || data?.error) throw new Error(error?.message || data?.error || "Erro ao criar loja");

      toast.success("Loja e empresário criados com sucesso!");
      setCreateModalOpen(false);
      setNewStore({
        email: "",
        password: "",
        full_name: "",
        name: "",
        slug: "",
        whatsapp: "",
        document: "",
        city: "",
        state: "",
      });
      load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="py-20 text-center"><Loader2 className="h-8 w-8 animate-spin inline text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Lojas</h1>
          <p className="text-muted-foreground">{stores.length} lojas no total.</p>
        </div>
        <Button onClick={() => setCreateModalOpen(true)}>
          <Plus className="h-4 w-4 mr-2" /> Nova Loja
        </Button>
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
                {s.logo_url && <img src={s.logo_url} alt="" className="w-full h-full object-contain" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="font-medium truncate">{s.name}</div>
                  {s.is_exempt && <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-200"><ShieldCheck className="h-3 w-3 mr-1" /> Isenta</Badge>}
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

              <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
                <div className="space-y-0.5">
                  <Label htmlFor="exempt-mode" className="text-sm font-medium flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-green-600" /> Usuário Isento
                  </Label>
                  <p className="text-[10px] text-muted-foreground">Bypassa todas as travas de assinatura e pagamento.</p>
                </div>
                <Switch 
                  id="exempt-mode" 
                  checked={selected.is_exempt} 
                  onCheckedChange={() => toggleExempt(selected)} 
                />
              </div>

              <div>
                <label className="text-xs font-medium">Plano de Referência</label>
                <Select value={selected.subscriptions?.[0]?.plan_id || (selected.subscriptions?.[0]?.status === 'ativa' && !selected.subscriptions?.[0]?.plan_id ? 'cortesia' : '')} onValueChange={(v) => changePlan(selected, v)}>
                  <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cortesia">Cortesia (Plano Isento)</SelectItem>
                    {plans.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} — {formatBRL(p.price_monthly)}/mês
                      </SelectItem>
                    ))}
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

      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="max-w-2xl overflow-y-auto max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Cadastrar Nova Loja e Empresário</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateStore} className="space-y-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>E-mail do Empresário</Label>
                <Input 
                  type="email" 
                  value={newStore.email} 
                  onChange={(e) => setNewStore({ ...newStore, email: e.target.value })}
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label>Senha Temporária</Label>
                <Input 
                  type="password" 
                  value={newStore.password} 
                  onChange={(e) => setNewStore({ ...newStore, password: e.target.value })}
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label>Nome Completo do Empresário</Label>
                <Input 
                  value={newStore.full_name} 
                  onChange={(e) => setNewStore({ ...newStore, full_name: e.target.value })}
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label>Nome da Loja</Label>
                <Input 
                  value={newStore.name} 
                  onChange={(e) => setNewStore({ ...newStore, name: e.target.value })}
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label>Slug (URL da loja)</Label>
                <Input 
                  value={newStore.slug} 
                  onChange={(e) => setNewStore({ ...newStore, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                  required 
                />
              </div>
              <div className="space-y-2">
                <Label>WhatsApp</Label>
                <Input 
                  value={newStore.whatsapp} 
                  onChange={(e) => setNewStore({ ...newStore, whatsapp: e.target.value })}
                  placeholder="(00) 00000-0000"
                />
              </div>
              <div className="space-y-2">
                <Label>CPF ou CNPJ</Label>
                <Input 
                  value={newStore.document} 
                  onChange={(e) => setNewStore({ ...newStore, document: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Cidade</Label>
                  <Input 
                    value={newStore.city} 
                    onChange={(e) => setNewStore({ ...newStore, city: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>UF</Label>
                  <Input 
                    value={newStore.state} 
                    onChange={(e) => setNewStore({ ...newStore, state: e.target.value.toUpperCase().slice(0, 2) })}
                    maxLength={2}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateModalOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={creating}>
                {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Criar Loja
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default AdminStores;
