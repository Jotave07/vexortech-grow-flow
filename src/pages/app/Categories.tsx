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

type Category = { id: string; name: string; description: string | null; is_active: boolean; sort_order: number };

const Categories = () => {
  const { store } = useOutletContext<{ store: any }>();
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: "", description: "", sort_order: 0 });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!store?.id) return;
    setLoading(true);
    const { data } = await supabase.from("categories").select("*").eq("store_id", store.id).order("sort_order");
    setItems((data as Category[]) ?? []);
    setLoading(false);
  }, [store?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => { setEditing(null); setForm({ name: "", description: "", sort_order: items.length }); setOpen(true); };
  const openEdit = (c: Category) => { setEditing(c); setForm({ name: c.name, description: c.description ?? "", sort_order: c.sort_order }); setOpen(true); };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Nome obrigatório");
    setSaving(true);
    if (editing) {
      const { error } = await supabase.from("categories").update({ name: form.name.trim(), description: form.description || null, sort_order: form.sort_order }).eq("id", editing.id);
      setSaving(false);
      if (error) return toast.error(error.message);
      toast.success("Categoria atualizada");
    } else {
      const { error } = await supabase.from("categories").insert({ store_id: store.id, name: form.name.trim(), description: form.description || null, sort_order: form.sort_order });
      setSaving(false);
      if (error) return toast.error(error.message);
      toast.success("Categoria criada");
    }
    setOpen(false); load();
  };

  const toggle = async (c: Category) => {
    await supabase.from("categories").update({ is_active: !c.is_active }).eq("id", c.id);
    load();
  };

  const remove = async (c: Category) => {
    if (!confirm(`Excluir categoria "${c.name}"?`)) return;
    const { error } = await supabase.from("categories").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success("Categoria excluída");
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Categorias</h1>
          <p className="text-muted-foreground">Organize seu cardápio em seções.</p>
        </div>
        <Button variant="hero" onClick={openNew}><Plus className="h-4 w-4" /> Nova</Button>
      </div>

      {loading ? (
        <div className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin inline text-primary" /></div>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">Nenhuma categoria ainda. Clique em "Nova" para começar.</Card>
      ) : (
        <div className="space-y-2">
          {items.map((c) => (
            <Card key={c.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="font-medium">{c.name}</div>
                {c.description && <div className="text-sm text-muted-foreground">{c.description}</div>}
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Switch checked={c.is_active} onCheckedChange={() => toggle(c)} />
                  <span className="text-xs text-muted-foreground hidden sm:inline">{c.is_active ? "Ativa" : "Inativa"}</span>
                </div>
                <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => remove(c)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Nova"} categoria</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Nome *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Descrição</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div><Label>Ordem</Label><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></div>
            <Button variant="hero" className="w-full" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Categories;
