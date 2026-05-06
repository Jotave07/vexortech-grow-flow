import { useCallback, useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { formatBRL } from "@/lib/format";

const Coupons = () => {
  const { store } = useOutletContext<{ store: any }>();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ code: "", discount_type: "percentual", discount_value: "", min_order_value: "0", usage_limit: "", expires_at: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!store?.id) return;
    setLoading(true);
    const { data } = await supabase.from("coupons").select("*").eq("store_id", store.id).order("created_at", { ascending: false });
    setItems(data ?? []); setLoading(false);
  }, [store?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => { setEditing(null); setForm({ code: "", discount_type: "percentual", discount_value: "", min_order_value: "0", usage_limit: "", expires_at: "" }); setOpen(true); };
  const openEdit = (c: any) => { setEditing(c); setForm({ code: c.code, discount_type: c.discount_type, discount_value: String(c.discount_value), min_order_value: String(c.min_order_value), usage_limit: c.usage_limit ? String(c.usage_limit) : "", expires_at: c.expires_at?.slice(0, 10) ?? "" }); setOpen(true); };

  const save = async () => {
    if (!form.code.trim()) return toast.error("Código obrigatório");
    const v = Number(form.discount_value);
    if (isNaN(v) || v <= 0) return toast.error("Valor inválido");
    setSaving(true);
    const payload = {
      store_id: store.id, code: form.code.trim().toUpperCase(),
      discount_type: form.discount_type, discount_value: v,
      min_order_value: Number(form.min_order_value) || 0,
      usage_limit: form.usage_limit ? Number(form.usage_limit) : null,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
    };
    const { error } = editing
      ? await supabase.from("coupons").update(payload).eq("id", editing.id)
      : await supabase.from("coupons").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message.includes("duplicate") ? "Código já existe" : error.message);
    toast.success("Salvo"); setOpen(false); load();
  };

  const toggle = async (c: any) => { await supabase.from("coupons").update({ is_active: !c.is_active }).eq("id", c.id); load(); };
  const remove = async (c: any) => { if (!confirm(`Excluir cupom ${c.code}?`)) return; await supabase.from("coupons").delete().eq("id", c.id); load(); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl md:text-3xl font-bold">Cupons</h1><p className="text-muted-foreground">Crie descontos para seus clientes.</p></div>
        <Button variant="hero" onClick={openNew}><Plus className="h-4 w-4" /> Novo cupom</Button>
      </div>
      {loading ? <div className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin inline text-primary" /></div> :
        items.length === 0 ? <Card className="p-10 text-center text-muted-foreground">Nenhum cupom ainda.</Card> :
        <div className="space-y-2">
          {items.map((c) => (
            <Card key={c.id} className="p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold">{c.code}</span>
                  <Badge variant={c.is_active ? "default" : "secondary"}>{c.is_active ? "Ativo" : "Inativo"}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {c.discount_type === "percentual" ? `${c.discount_value}% off` : `${formatBRL(c.discount_value)} off`}
                  {" · "} usos: {c.usage_count}{c.usage_limit ? `/${c.usage_limit}` : ""}
                  {c.expires_at && <> · expira {new Date(c.expires_at).toLocaleDateString("pt-BR")}</>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={c.is_active} onCheckedChange={() => toggle(c)} />
                <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                <Button variant="ghost" size="icon" onClick={() => remove(c)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            </Card>
          ))}
        </div>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} cupom</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Código *</Label><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="VEXOR10" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <Select value={form.discount_type} onValueChange={(v) => setForm({ ...form, discount_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentual">Percentual (%)</SelectItem>
                    <SelectItem value="fixo">Valor fixo (R$)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Valor *</Label><Input type="number" step="0.01" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Pedido mín. (R$)</Label><Input type="number" step="0.01" value={form.min_order_value} onChange={(e) => setForm({ ...form, min_order_value: e.target.value })} /></div>
              <div><Label>Limite de uso</Label><Input type="number" value={form.usage_limit} onChange={(e) => setForm({ ...form, usage_limit: e.target.value })} placeholder="ilimitado" /></div>
            </div>
            <div><Label>Expira em</Label><Input type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} /></div>
            <Button variant="hero" className="w-full" onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default Coupons;
