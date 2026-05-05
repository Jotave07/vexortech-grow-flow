import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2, Star, Upload, Settings2 } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { OptionsDialog } from "@/components/app/OptionsDialog";

type Product = any;
type Category = { id: string; name: string };

const Products = () => {
  const { store } = useOutletContext<{ store: any }>();
  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [optionsFor, setOptionsFor] = useState<Product | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<any>({ name: "", description: "", price: "", promo_price: "", category_id: "", prep_time_minutes: "", image_url: "", is_featured: false });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    if (!store?.id) return;
    setLoading(true);
    const [prods, cats] = await Promise.all([
      supabase.from("products").select("*, categories(name)").eq("store_id", store.id).order("sort_order"),
      supabase.from("categories").select("id, name").eq("store_id", store.id).order("sort_order"),
    ]);
    setItems(prods.data ?? []);
    setCategories((cats.data as Category[]) ?? []);
    setLoading(false);
  }, [store?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", description: "", price: "", promo_price: "", category_id: categories[0]?.id ?? "", prep_time_minutes: "", image_url: "", is_featured: false });
    setOpen(true);
  };
  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name, description: p.description ?? "", price: String(p.price), promo_price: p.promo_price ? String(p.promo_price) : "",
      category_id: p.category_id ?? "", prep_time_minutes: p.prep_time_minutes ? String(p.prep_time_minutes) : "",
      image_url: p.image_url ?? "", is_featured: p.is_featured,
    });
    setOpen(true);
  };

  const onUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Selecione uma imagem");
    if (file.size > 4 * 1024 * 1024) return toast.error("Máximo 4MB");
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${store.id}/products/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("store-assets").upload(path, file, { upsert: false });
    setUploading(false);
    if (error) return toast.error(error.message);
    const { data } = supabase.storage.from("store-assets").getPublicUrl(path);
    setForm((f: any) => ({ ...f, image_url: data.publicUrl }));
    toast.success("Imagem enviada");
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Nome obrigatório");
    const price = Number(form.price);
    if (isNaN(price) || price < 0) return toast.error("Preço inválido");
    setSaving(true);
    const payload = {
      store_id: store.id,
      category_id: form.category_id || null,
      name: form.name.trim(),
      description: form.description || null,
      price,
      promo_price: form.promo_price ? Number(form.promo_price) : null,
      prep_time_minutes: form.prep_time_minutes ? Number(form.prep_time_minutes) : null,
      image_url: form.image_url || null,
      is_featured: form.is_featured,
    };
    const { error } = editing
      ? await supabase.from("products").update(payload).eq("id", editing.id)
      : await supabase.from("products").insert({ ...payload, sort_order: items.length });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Produto atualizado" : "Produto criado");
    setOpen(false); load();
  };

  const toggle = async (p: Product, field: "is_active" | "is_available") => {
    const patch: any = { [field]: !p[field] };
    await supabase.from("products").update(patch).eq("id", p.id);
    load();
  };
  const remove = async (p: Product) => {
    if (!confirm(`Excluir "${p.name}"?`)) return;
    await supabase.from("products").delete().eq("id", p.id);
    toast.success("Produto excluído"); load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Cardápio</h1>
          <p className="text-muted-foreground">Gerencie seus produtos.</p>
        </div>
        <Button variant="hero" onClick={openNew}><Plus className="h-4 w-4" /> Novo produto</Button>
      </div>

      {loading ? (
        <div className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin inline text-primary" /></div>
      ) : items.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          {categories.length === 0 ? "Crie uma categoria antes de adicionar produtos." : "Nenhum produto ainda. Clique em \"Novo produto\"."}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((p) => (
            <Card key={p.id} className="p-4 flex gap-4">
              <div className="w-20 h-20 rounded bg-muted shrink-0 overflow-hidden">
                {p.image_url && <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-medium truncate">{p.name}</h3>
                  {p.is_featured && <Star className="h-3 w-3 text-amber-500 fill-amber-500 shrink-0" />}
                </div>
                <div className="text-xs text-muted-foreground">{p.categories?.name ?? "Sem categoria"}</div>
                <div className="text-sm font-medium mt-1">
                  {p.promo_price ? <><span className="text-primary">{formatBRL(p.promo_price)}</span> <span className="line-through text-xs text-muted-foreground">{formatBRL(p.price)}</span></> : formatBRL(p.price)}
                </div>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge variant={p.is_active ? "default" : "secondary"} className="text-xs">{p.is_active ? "Ativo" : "Inativo"}</Badge>
                  {!p.is_available && <Badge variant="destructive" className="text-xs">Esgotado</Badge>}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <Button size="icon" variant="ghost" onClick={() => setOptionsFor(p)} title="Adicionais"><Settings2 className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => remove(p)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} produto</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Imagem</Label>
              <div className="flex items-center gap-3 mt-2">
                <div className="w-20 h-20 rounded bg-muted overflow-hidden flex items-center justify-center">
                  {form.image_url ? <img src={form.image_url} alt="" className="w-full h-full object-cover" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
                </div>
                <label className="cursor-pointer">
                  <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
                  <Button type="button" variant="outline" disabled={uploading} asChild><span>{uploading ? "Enviando..." : "Escolher"}</span></Button>
                </label>
              </div>
            </div>
            <div><Label>Nome *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><Label>Descrição</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Preço *</Label><Input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
              <div><Label>Promocional</Label><Input type="number" step="0.01" value={form.promo_price} onChange={(e) => setForm({ ...form, promo_price: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Categoria</Label>
                <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Tempo (min)</Label><Input type="number" value={form.prep_time_minutes} onChange={(e) => setForm({ ...form, prep_time_minutes: e.target.value })} /></div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_featured} onCheckedChange={(v) => setForm({ ...form, is_featured: v })} />
              <Label>Destaque</Label>
            </div>
            <Button variant="hero" className="w-full" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {optionsFor && <OptionsDialog product={optionsFor} storeId={store.id} onClose={() => setOptionsFor(null)} />}
    </div>
  );
};

export default Products;
