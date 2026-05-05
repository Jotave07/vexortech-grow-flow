import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { formatBRL } from "@/lib/format";

const Zones = () => {
  const { store } = useOutletContext<{ store: any }>();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ neighborhood: "", city: "", fee: "", min_order: "", estimated_minutes: "45" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!store?.id) return;
    setLoading(true);
    const { data } = await supabase.from("delivery_zones").select("*").eq("store_id", store.id).order("neighborhood");
    setItems(data ?? []);
    setLoading(false);
  }, [store?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => { setEditing(null); setForm({ neighborhood: "", city: store.city ?? "", fee: "", min_order: "0", estimated_minutes: "45" }); setOpen(true); };
  const openEdit = (z: any) => { setEditing(z); setForm({ neighborhood: z.neighborhood, city: z.city ?? "", fee: String(z.fee), min_order: String(z.min_order), estimated_minutes: String(z.estimated_minutes) }); setOpen(true); };

  const save = async () => {
    if (!form.neighborhood.trim()) return toast.error("Bairro obrigatório");
    const fee = Number(form.fee);
    if (isNaN(fee) || fee < 0) return toast.error("Taxa inválida");
    setSaving(true);
    const payload = { store_id: store.id, neighborhood: form.neighborhood.trim(), city: form.city || null, fee, min_order: Number(form.min_order) || 0, estimated_minutes: Number(form.estimated_minutes) || 45 };
    const { error } = editing
      ? await supabase.from("delivery_zones").update(payload).eq("id", editing.id)
      : await supabase.from("delivery_zones").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Salvo"); setOpen(false); load();
  };

  const toggle = async (z: any) => { await supabase.from("delivery_zones").update({ is_active: !z.is_active }).eq("id", z.id); load(); };
  const remove = async (z: any) => { if (!confirm(`Excluir "${z.neighborhood}"?`)) return; await supabase.from("delivery_zones").delete().eq("id", z.id); load(); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl md:text-3xl font-bold">Entregas</h1><p className="text-muted-foreground">Bairros atendidos e taxas.</p></div>
        <Button variant="hero" onClick={openNew}><Plus className="h-4 w-4" /> Novo bairro</Button>
      </div>
      {loading ? <div className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin inline text-primary" /></div> :
        items.length === 0 ? <Card className="p-10 text-center text-muted-foreground">Nenhum bairro cadastrado ainda.</Card> :
        <div className="space-y-2">
          {items.map((z) => (
            <Card key={z.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{z.neighborhood}{z.city && <span className="text-muted-foreground"> · {z.city}</span>}</div>
                <div className="text-xs text-muted-foreground">{formatBRL(z.fee)} · {z.estimated_minutes} min · mín {formatBRL(z.min_order)}</div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={z.is_active} onCheckedChange={() => toggle(z)} />
                <Button variant="ghost" size="icon" onClick={() => openEdit(z)}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => remove(z)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </Card>
          ))}
        </div>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} bairro</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Bairro *</Label><Input value={form.neighborhood} onChange={(e) => setForm({ ...form, neighborhood: e.target.value })} /></div>
            <div><Label>Cidade</Label><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Taxa (R$)</Label><Input type="number" step="0.01" value={form.fee} onChange={(e) => setForm({ ...form, fee: e.target.value })} /></div>
              <div><Label>Mín. (R$)</Label><Input type="number" step="0.01" value={form.min_order} onChange={(e) => setForm({ ...form, min_order: e.target.value })} /></div>
              <div><Label>Min</Label><Input type="number" value={form.estimated_minutes} onChange={(e) => setForm({ ...form, estimated_minutes: e.target.value })} /></div>
            </div>
            <Button variant="hero" className="w-full" onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default Zones;
