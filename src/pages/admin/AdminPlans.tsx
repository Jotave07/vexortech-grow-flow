import { useEffect, useState } from "react";
import { backend } from "@/integrations/backend/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";
import { normalizePlan } from "@/lib/subscription";

const stringifyFeatures = (features: unknown) =>
  Array.isArray(features)
    ? features.filter((item): item is string => typeof item === "string" && item.trim().length > 0).join("\n")
    : "";

const parseFeatures = (value: string) =>
  value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

const AdminPlans = () => {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await backend.from("plans").select("*").order("sort_order");
    setPlans(data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openEdit = (p: any) => {
    setEditing(p);
    setForm({
      ...p,
      price_monthly: String(p.price_monthly),
      max_products: p.max_products ?? "",
      sort_order: p.sort_order ?? 0,
      featuresText: stringifyFeatures(p.features),
    });
    setOpen(true);
  };
  const openNew = () => {
    setEditing(null);
    setForm({
      name: "",
      slug: "",
      description: "",
      price_monthly: "0",
      max_products: "",
      featuresText: "",
      is_active: true,
      allows_coupons: false,
      allows_advanced_reports: false,
      allows_custom_branding: false,
      allows_custom_domain: false,
      sort_order: plans.length,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name || !form.slug) return toast.error("Nome e slug obrigatórios");
    setSaving(true);
    const payload: any = {
      name: form.name, slug: form.slug, description: form.description || null,
      price_monthly: Number(form.price_monthly) || 0,
      max_products: form.max_products ? Number(form.max_products) : null,
      features: parseFeatures(form.featuresText),
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active,
      allows_coupons: form.allows_coupons, allows_advanced_reports: form.allows_advanced_reports,
      allows_custom_branding: form.allows_custom_branding, allows_custom_domain: form.allows_custom_domain,
    };
    const { error } = editing
      ? await backend.from("plans").update(payload).eq("id", editing.id)
      : await backend.from("plans").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Salvo"); setOpen(false); load();
  };

  const removePlan = async (plan: any) => {
    if (!confirm(`Excluir o plano "${plan.name}"? Se ele estiver em uso, sera apenas arquivado para preservar assinaturas existentes.`)) return;
    setDeletingPlanId(plan.id);
    try {
      const [{ data: storesUsing }, { data: subscriptionsUsing }] = await Promise.all([
        backend.from("stores").select("id").eq("plan_id", plan.id).limit(1),
        backend.from("subscriptions").select("id").eq("plan_id", plan.id).limit(1),
      ]);
      const inUse = Boolean(storesUsing?.length || subscriptionsUsing?.length);
      const { error } = inUse
        ? await backend.from("plans").update({ is_active: false }).eq("id", plan.id)
        : await backend.from("plans").delete().eq("id", plan.id);

      if (error) throw error;
      toast.success(inUse ? "Plano arquivado porque ja existe assinatura vinculada." : "Plano excluido.");
      await load();
    } catch (error: any) {
      toast.error(error?.message || "Nao foi possivel excluir o plano.");
    } finally {
      setDeletingPlanId(null);
    }
  };

  if (loading) return <div className="py-20 text-center"><Loader2 className="h-8 w-8 animate-spin inline text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Planos</h1>
          <p className="text-muted-foreground">Catálogo de planos Hype.</p>
        </div>
        <Button variant="hero" onClick={openNew}><Plus className="h-4 w-4" /> Novo plano</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((p) => {
          const normalized = normalizePlan(p);
          const features = normalized?.marketingFeatures?.length ? normalized.marketingFeatures : [
            p.allows_coupons ? "Cupons" : "",
            p.allows_advanced_reports ? "Relatorios avancados" : "",
            p.allows_custom_branding ? "Personalizacao visual" : "",
            p.allows_custom_domain ? "Dominio proprio" : "",
          ].filter(Boolean);

          return (
            <Card key={p.id} className={`p-5 ${p.is_active ? "" : "opacity-70"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-bold">{p.name}</h3>
                    <Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "Ativo" : "Arquivado"}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">/{p.slug}</div>
                </div>
                <div className="flex shrink-0">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => void removePlan(p)} disabled={deletingPlanId === p.id} className="text-destructive hover:text-destructive">
                    {deletingPlanId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
              <div className="mt-2 text-2xl font-bold">{formatBRL(p.price_monthly)}<span className="text-xs text-muted-foreground font-normal">/mes</span></div>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                <li>{normalized?.limits.products ? `${normalized.limits.products} produtos` : "Produtos ilimitados"}</li>
                <li>{normalized?.limits.monthlyOrders ? `${normalized.limits.monthlyOrders} pedidos/mes` : "Pedidos ilimitados"}</li>
                <li>{normalized?.limits.internalUsers ? `${normalized.limits.internalUsers} usuario(s)` : "Usuarios ilimitados"}</li>
                {features.slice(0, 4).map((feature) => <li key={feature}>- {feature}</li>)}
              </ul>
            </Card>
          );
        })}
      </div>

      <div className="hidden">
        {plans.map((p) => (
          <Card key={p.id} className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold">{p.name}</h3>
                <div className="text-xs text-muted-foreground">/{p.slug}</div>
              </div>
              <Button size="icon" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
            </div>
            <div className="mt-2 text-2xl font-bold">{formatBRL(p.price_monthly)}<span className="text-xs text-muted-foreground font-normal">/mês</span></div>
            <ul className="mt-3 text-xs text-muted-foreground space-y-1">
              <li>{p.max_products ? `${p.max_products} produtos` : "Produtos ilimitados"}</li>
              {p.allows_coupons && <li>✓ Cupons</li>}
              {p.allows_advanced_reports && <li>✓ Relatórios avançados</li>}
              {p.allows_custom_branding && <li>✓ Marca personalizada</li>}
              {p.allows_custom_domain && <li>✓ Domínio próprio</li>}
            </ul>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} plano</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Slug</Label><Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></div>
            <div><Label>Descrição</Label><Input value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Preço/mês</Label><Input type="number" step="0.01" value={form.price_monthly} onChange={(e) => setForm({ ...form, price_monthly: e.target.value })} /></div>
              <div><Label>Máx. produtos</Label><Input type="number" value={form.max_products} onChange={(e) => setForm({ ...form, max_products: e.target.value })} placeholder="∞" /></div>
            </div>
            {[["allows_coupons", "Cupons"], ["allows_advanced_reports", "Relatórios avançados"], ["allows_custom_branding", "Marca personalizada"], ["allows_custom_domain", "Domínio próprio"], ["is_active", "Público"]].map(([k, l]) => (
              <div key={k} className="flex items-center justify-between"><Label>{l}</Label><Switch checked={!!form[k]} onCheckedChange={(v) => setForm({ ...form, [k]: v })} /></div>
            ))}
            <div><Label>Ordem</Label><Input type="number" value={form.sort_order ?? 0} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} /></div>
            <div>
              <Label>Recursos exibidos</Label>
              <Textarea
                value={form.featuresText ?? ""}
                onChange={(e) => setForm({ ...form, featuresText: e.target.value })}
                placeholder={"Um recurso por linha\nEx.: Produtos ilimitados\nRelatorios avancados"}
                className="min-h-24"
              />
            </div>
            <div className="pt-2">
              <div className="mb-3 flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Alterar preco ou recursos nao mexe em cobrancas ja emitidas. O fluxo de assinatura usa o valor do plano selecionado no momento da assinatura.
              </div>
              <p className="text-[10px] text-muted-foreground uppercase font-bold mb-2">Dica: Planos com slug "premium_cortesia" ou "isento" não geram cobrança.</p>
              <Button variant="hero" className="w-full" onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default AdminPlans;
