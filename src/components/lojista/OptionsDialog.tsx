import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";

export const OptionsDialog = ({ product, storeId, onClose }: { product: any; storeId: string; onClose: () => void }) => {
  const [groups, setGroups] = useState<any[]>([]);
  const [items, setItems] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: g } = await supabase.from("product_options" as any).select("*").eq("product_id", product.id).order("sort_order");
    const groupsData = g ?? [];
    setGroups(groupsData);
    if (groupsData.length) {
      const { data: itemsData } = await supabase.from("product_option_items" as any).select("*").in("option_id", groupsData.map((x: any) => x.id)).order("sort_order");
      const map: Record<string, any[]> = {};
      groupsData.forEach((gr: any) => { map[gr.id] = (itemsData ?? []).filter((it: any) => it.option_id === gr.id); });
      setItems(map);
    } else {
      setItems({});
    }
    setLoading(false);
  }, [product.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const addGroup = async () => {
    const name = prompt("Nome do grupo (ex.: Adicionais):");
    if (!name?.trim()) return;
    const { error } = await supabase.from("product_options" as any).insert({ product_id: product.id, store_id: storeId, name: name.trim(), sort_order: groups.length });
    if (error) return toast.error(error.message);
    load();
  };
  const removeGroup = async (id: string) => {
    if (!confirm("Excluir este grupo de adicionais?")) return;
    await supabase.from("product_options" as any).delete().eq("id", id);
    load();
  };
  const updateGroup = async (id: string, patch: any) => {
    await supabase.from("product_options" as any).update(patch).eq("id", id); load();
  };
  const addItem = async (groupId: string) => {
    const name = prompt("Nome do item:");
    if (!name?.trim()) return;
    const priceStr = prompt("Preço extra (R$):", "0");
    const price = Number(priceStr);
    if (isNaN(price) || price < 0) return toast.error("Preço inválido");
    await supabase.from("product_option_items" as any).insert({ option_id: groupId, store_id: storeId, name: name.trim(), extra_price: price, sort_order: (items[groupId]?.length ?? 0) });
    load();
  };
  const removeItem = async (id: string) => {
    await supabase.from("product_option_items" as any).delete().eq("id", id); load();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Adicionais — {product.name}</DialogTitle></DialogHeader>
        {loading ? (
          <div className="py-8 text-center"><Loader2 className="h-6 w-6 animate-spin inline text-primary" /></div>
        ) : (
          <div className="space-y-4">
            {groups.length === 0 && <p className="text-sm text-muted-foreground">Sem grupos de adicionais ainda.</p>}
            {groups.map((g) => (
              <Card key={g.id} className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Input value={g.name} onChange={(e) => setGroups((prev) => prev.map((x) => x.id === g.id ? { ...x, name: e.target.value } : x))} onBlur={(e) => updateGroup(g.id, { name: e.target.value })} className="font-medium" />
                  <Button size="icon" variant="ghost" onClick={() => removeGroup(g.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <label className="flex items-center gap-2"><Switch checked={g.is_required} onCheckedChange={(v) => updateGroup(g.id, { is_required: v })} /> Obrigatório</label>
                  <label className="flex items-center gap-1">Min <Input type="number" className="h-7 w-14" value={g.min_choices} onChange={(e) => updateGroup(g.id, { min_choices: Number(e.target.value) })} /></label>
                  <label className="flex items-center gap-1">Max <Input type="number" className="h-7 w-14" value={g.max_choices} onChange={(e) => updateGroup(g.id, { max_choices: Number(e.target.value) })} /></label>
                </div>
                <div className="space-y-1">
                  {(items[g.id] ?? []).map((it) => (
                    <div key={it.id} className="flex items-center justify-between text-sm border-t border-border pt-2">
                      <span>{it.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{formatBRL(it.extra_price)}</span>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeItem(it.id)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                      </div>
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" className="w-full" onClick={() => addItem(g.id)}><Plus className="h-3 w-3" /> Adicionar item</Button>
                </div>
              </Card>
            ))}
            <Button variant="outline" className="w-full" onClick={addGroup}><Plus className="h-4 w-4" /> Novo grupo</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
