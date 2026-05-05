import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";

const AdminPlans = () => {
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("plans").select("*").order("sort_order");
    setPlans(data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const openEdit = (p: any) => {
    setEditing(p);
    setForm({ ...p, price_monthly: String(p.price_monthly), max_products: p.max_products ?? "" });
    setOpen(true);
  };
  const openNew = () => {
    setEditing(null);
    setForm({ name: "", slug: "", description: "", price_monthly: "0", max_products: "", is_active: true, allows_coupons: false, allows_advanced_reports: false, allows_custom_branding: false, allows_custom_domain: false });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name || !form.slug) return toast.error("Nome e slug obrigatórios");
    setSaving(true);
    const payload: any = {
      name: form.name, slug: form.slug, description: form.description || null,
      price_monthly: Number(form.price_monthly) || 0,
      max_products: form.max_products ? Number(form.max_products) : null,
      is_active: form.is_active,
      allows_coupons: form.allows_coupons, allows_advanced_reports: form.allows_advanced_reports,
      allows_custom_branding: form.allows_custom_branding, allows_custom_domain: form.allows_custom_domain,
    };
    const { error } = editing
      ? await supabase.from("plans").update(payload).eq("id", editing.id)
      : await supabase.from("plans").insert({ ...payload, sort_order: plans.length });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Salvo"); setOpen(false); load();
  };

  if (loading) return <div className="py-20 text-center"><Loader2 className="h-8 w-8 animate-spin inline text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Planos</h1>
          <p className="text-muted-foreground">Catálogo de planos Vexor.</p>
        </div>
        <Button variant="hero" onClick={openNew}><Plus className="h-4 w-4" /> Novo plano</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            {[["allows_coupons", "Cupons"], ["allows_advanced_reports", "Relatórios avançados"], ["allows_custom_branding", "Marca personalizada"], ["allows_custom_domain", "Domínio próprio"], ["is_active", "Ativo"]].map(([k, l]) => (
              <div key={k} className="flex items-center justify-between"><Label>{l}</Label><Switch checked={!!form[k]} onCheckedChange={(v) => setForm({ ...form, [k]: v })} /></div>
            ))}
            <Button variant="hero" className="w-full" onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default AdminPlans;
