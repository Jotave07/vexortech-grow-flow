import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";

type OptionTemplate = {
  name: string;
  groups: Array<{
    name: string;
    is_required: boolean;
    min_choices: number;
    max_choices: number;
    items: Array<{ name: string; extra_price: number }>;
  }>;
};

const OPTION_TEMPLATES: OptionTemplate[] = [
  {
    name: "Acai completo",
    groups: [
      { name: "Tamanho", is_required: true, min_choices: 1, max_choices: 1, items: [{ name: "300 ml", extra_price: 0 }, { name: "500 ml", extra_price: 6 }, { name: "700 ml", extra_price: 12 }] },
      { name: "Frutas", is_required: false, min_choices: 0, max_choices: 3, items: [{ name: "Banana", extra_price: 0 }, { name: "Morango", extra_price: 2 }, { name: "Kiwi", extra_price: 3 }] },
      { name: "Complementos", is_required: false, min_choices: 0, max_choices: 4, items: [{ name: "Granola", extra_price: 0 }, { name: "Leite em po", extra_price: 2 }, { name: "Pacoca", extra_price: 2 }, { name: "Confete", extra_price: 2 }] },
      { name: "Coberturas", is_required: false, min_choices: 0, max_choices: 2, items: [{ name: "Leite condensado", extra_price: 0 }, { name: "Chocolate", extra_price: 1.5 }, { name: "Morango", extra_price: 1.5 }] },
    ],
  },
  {
    name: "Pizza",
    groups: [
      { name: "Tamanho", is_required: true, min_choices: 1, max_choices: 1, items: [{ name: "Media", extra_price: 0 }, { name: "Grande", extra_price: 12 }, { name: "Familia", extra_price: 22 }] },
      { name: "Borda", is_required: false, min_choices: 0, max_choices: 1, items: [{ name: "Sem borda", extra_price: 0 }, { name: "Catupiry", extra_price: 8 }, { name: "Cheddar", extra_price: 8 }] },
      { name: "Adicionais", is_required: false, min_choices: 0, max_choices: 5, items: [{ name: "Mussarela extra", extra_price: 5 }, { name: "Bacon", extra_price: 6 }, { name: "Calabresa", extra_price: 5 }] },
    ],
  },
  {
    name: "Burger",
    groups: [
      { name: "Ponto da carne", is_required: true, min_choices: 1, max_choices: 1, items: [{ name: "Ao ponto", extra_price: 0 }, { name: "Bem passado", extra_price: 0 }, { name: "Mal passado", extra_price: 0 }] },
      { name: "Queijos", is_required: false, min_choices: 0, max_choices: 2, items: [{ name: "Cheddar", extra_price: 4 }, { name: "Mussarela", extra_price: 3 }, { name: "Prato", extra_price: 3 }] },
      { name: "Extras", is_required: false, min_choices: 0, max_choices: 5, items: [{ name: "Bacon", extra_price: 5 }, { name: "Ovo", extra_price: 3 }, { name: "Carne extra", extra_price: 9 }] },
    ],
  },
  {
    name: "Bebidas",
    groups: [
      { name: "Temperatura", is_required: true, min_choices: 1, max_choices: 1, items: [{ name: "Gelada", extra_price: 0 }, { name: "Natural", extra_price: 0 }] },
      { name: "Embalagem", is_required: false, min_choices: 0, max_choices: 1, items: [{ name: "Copo descartavel", extra_price: 0.5 }, { name: "Gelo separado", extra_price: 1 }] },
    ],
  },
];

const toMoney = (value: string) => Number(value.replace(",", ".")) || 0;

export const OptionsDialog = ({ product, storeId, onClose }: { product: any; storeId: string; onClose: () => void }) => {
  const [groups, setGroups] = useState<any[]>([]);
  const [items, setItems] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newGroup, setNewGroup] = useState({
    name: "",
    is_required: false,
    min_choices: 0,
    max_choices: 1,
  });
  const [draftItems, setDraftItems] = useState<Record<string, { name: string; extra_price: string }>>({});

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
    if (!newGroup.name.trim()) return toast.error("Informe o nome do grupo");
    if (newGroup.max_choices < 1) return toast.error("Maximo precisa ser maior que zero");
    if (newGroup.min_choices > newGroup.max_choices) return toast.error("Minimo nao pode ser maior que maximo");

    setSaving(true);
    const { error } = await supabase.from("product_options" as any).insert({
      product_id: product.id,
      store_id: storeId,
      name: newGroup.name.trim(),
      is_required: newGroup.is_required,
      min_choices: newGroup.is_required ? Math.max(1, newGroup.min_choices) : newGroup.min_choices,
      max_choices: newGroup.max_choices,
      sort_order: groups.length,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    setNewGroup({ name: "", is_required: false, min_choices: 0, max_choices: 1 });
    await load();
  };

  const applyTemplate = async (template: OptionTemplate) => {
    setSaving(true);
    try {
      for (const [groupIndex, group] of template.groups.entries()) {
        const { data: createdGroup, error: groupError } = await supabase
          .from("product_options" as any)
          .insert({
            product_id: product.id,
            store_id: storeId,
            name: group.name,
            is_required: group.is_required,
            min_choices: group.min_choices,
            max_choices: group.max_choices,
            sort_order: groups.length + groupIndex,
          })
          .select("id")
          .single();

        if (groupError) throw groupError;

        if (createdGroup?.id && group.items.length) {
          const { error: itemsError } = await supabase.from("product_option_items" as any).insert(
            group.items.map((item, itemIndex) => ({
              option_id: createdGroup.id,
              store_id: storeId,
              name: item.name,
              extra_price: item.extra_price,
              sort_order: itemIndex,
              is_active: true,
            })),
          );
          if (itemsError) throw itemsError;
        }
      }

      toast.success(`Modelo ${template.name} aplicado`);
      await load();
    } catch (error: any) {
      toast.error(error.message || "Erro ao aplicar modelo");
    } finally {
      setSaving(false);
    }
  };

  const removeGroup = async (id: string) => {
    if (!confirm("Excluir este grupo e todos os itens dele?")) return;
    const { error: itemsError } = await supabase.from("product_option_items" as any).delete().eq("option_id", id);
    if (itemsError) return toast.error(itemsError.message);
    const { error } = await supabase.from("product_options" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    await load();
  };

  const updateGroup = async (id: string, patch: any) => {
    const { error } = await supabase.from("product_options" as any).update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    await load();
  };

  const addItem = async (groupId: string) => {
    const draft = draftItems[groupId] || { name: "", extra_price: "0" };
    if (!draft.name.trim()) return toast.error("Informe o nome do item");
    const price = toMoney(draft.extra_price);
    if (price < 0) return toast.error("Preco invalido");
    const { error } = await supabase.from("product_option_items" as any).insert({
      option_id: groupId,
      store_id: storeId,
      name: draft.name.trim(),
      extra_price: price,
      sort_order: (items[groupId]?.length ?? 0),
      is_active: true,
    });
    if (error) return toast.error(error.message);
    setDraftItems((current) => ({ ...current, [groupId]: { name: "", extra_price: "0" } }));
    await load();
  };

  const updateItem = async (id: string, patch: any) => {
    const { error } = await supabase.from("product_option_items" as any).update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    await load();
  };

  const removeItem = async (id: string) => {
    const { error } = await supabase.from("product_option_items" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    await load();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto rounded-3xl border-[#e1d7c7] bg-[#f6f7f2] p-0">
        <DialogHeader className="border-b border-[#e6e8de] bg-white px-6 py-5">
          <DialogTitle className="text-xl font-black uppercase tracking-tight text-stone-950">
            Opcoes do produto: {product.name}
          </DialogTitle>
          <p className="text-sm font-medium text-muted-foreground">
            Monte grupos obrigatorios ou opcionais, defina minimo/maximo e cadastre adicionais com preco.
          </p>
        </DialogHeader>

        {loading ? (
          <div className="py-12 text-center"><Loader2 className="inline h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-5 p-5 sm:p-6">
            <Card className="rounded-3xl border-[#e1d7c7] bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-stone-800">
                <Wand2 className="h-4 w-4 text-primary" />
                Modelos rapidos
              </div>
              <div className="flex flex-wrap gap-2">
                {OPTION_TEMPLATES.map((template) => (
                  <Button
                    key={template.name}
                    type="button"
                    variant="outline"
                    className="h-10 rounded-xl border-[#e1d7c7] bg-white text-xs font-bold uppercase tracking-widest"
                    onClick={() => void applyTemplate(template)}
                    disabled={saving}
                  >
                    {template.name}
                  </Button>
                ))}
              </div>
            </Card>

            <Card className="rounded-3xl border-[#e1d7c7] bg-white p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_8rem_auto] md:items-end">
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Novo grupo</Label>
                  <Input
                    value={newGroup.name}
                    onChange={(event) => setNewGroup((current) => ({ ...current, name: event.target.value }))}
                    className="h-11 rounded-xl border-[#e1d7c7] font-semibold"
                    placeholder="Ex.: Complementos, Frutas, Coberturas"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Minimo</Label>
                  <Input
                    type="number"
                    min={0}
                    value={newGroup.min_choices}
                    onChange={(event) => setNewGroup((current) => ({ ...current, min_choices: Number(event.target.value) }))}
                    className="h-11 rounded-xl border-[#e1d7c7] font-semibold"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Maximo</Label>
                  <Input
                    type="number"
                    min={1}
                    value={newGroup.max_choices}
                    onChange={(event) => setNewGroup((current) => ({ ...current, max_choices: Number(event.target.value) }))}
                    className="h-11 rounded-xl border-[#e1d7c7] font-semibold"
                  />
                </div>
                <div className="flex items-center gap-3 pb-1">
                  <Switch checked={newGroup.is_required} onCheckedChange={(value) => setNewGroup((current) => ({ ...current, is_required: value, min_choices: value ? Math.max(1, current.min_choices) : current.min_choices }))} />
                  <span className="text-xs font-black uppercase tracking-widest text-stone-700">Obrigatorio</span>
                </div>
              </div>
              <Button onClick={addGroup} disabled={saving} className="mt-4 h-11 rounded-xl font-black uppercase tracking-widest">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Criar grupo
              </Button>
            </Card>

            {groups.length === 0 && (
              <Card className="rounded-3xl border-dashed border-[#e1d7c7] bg-white p-8 text-center text-sm font-medium text-muted-foreground">
                Este produto ainda nao tem opcoes. Use um modelo rapido ou crie o primeiro grupo.
              </Card>
            )}

            <div className="grid gap-4">
              {groups.map((g) => {
                const draft = draftItems[g.id] || { name: "", extra_price: "0" };
                return (
                  <Card key={g.id} className="rounded-3xl border-[#e1d7c7] bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="grid flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_5rem_5rem]">
                        <div className="space-y-2">
                          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Grupo</Label>
                          <Input
                            value={g.name}
                            onChange={(event) => setGroups((prev) => prev.map((x) => x.id === g.id ? { ...x, name: event.target.value } : x))}
                            onBlur={(event) => void updateGroup(g.id, { name: event.target.value })}
                            className="h-10 rounded-xl border-[#e1d7c7] font-semibold"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Min</Label>
                          <Input
                            type="number"
                            min={0}
                            value={g.min_choices ?? 0}
                            onChange={(event) => setGroups((prev) => prev.map((x) => x.id === g.id ? { ...x, min_choices: Number(event.target.value) } : x))}
                            onBlur={(event) => void updateGroup(g.id, { min_choices: Number(event.target.value) })}
                            className="h-10 rounded-xl border-[#e1d7c7] font-semibold"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Max</Label>
                          <Input
                            type="number"
                            min={1}
                            value={g.max_choices ?? 1}
                            onChange={(event) => setGroups((prev) => prev.map((x) => x.id === g.id ? { ...x, max_choices: Number(event.target.value) } : x))}
                            onBlur={(event) => void updateGroup(g.id, { max_choices: Number(event.target.value) })}
                            className="h-10 rounded-xl border-[#e1d7c7] font-semibold"
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-3 md:pt-7">
                        <label className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-stone-700">
                          <Switch checked={Boolean(g.is_required)} onCheckedChange={(value) => void updateGroup(g.id, { is_required: value, min_choices: value ? Math.max(1, Number(g.min_choices || 0)) : Number(g.min_choices || 0) })} />
                          Obrigatorio
                        </label>
                        <Button size="icon" variant="ghost" onClick={() => void removeGroup(g.id)} className="h-9 w-9 rounded-xl">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Badge variant={g.is_required ? "default" : "secondary"} className="rounded-full">
                        {g.is_required ? "Obrigatorio" : "Opcional"}
                      </Badge>
                      <Badge variant="outline" className="rounded-full">
                        Escolha {g.min_choices || 0} a {g.max_choices || 1}
                      </Badge>
                    </div>

                    <div className="mt-4 space-y-2">
                      {(items[g.id] ?? []).map((it) => (
                        <div key={it.id} className="grid gap-2 rounded-2xl border border-[#e6e8de] bg-[#f6f7f2] p-3 md:grid-cols-[minmax(0,1fr)_8rem_auto_auto] md:items-center">
                          <Input
                            value={it.name}
                            onChange={(event) => setItems((current) => ({
                              ...current,
                              [g.id]: (current[g.id] || []).map((item) => item.id === it.id ? { ...item, name: event.target.value } : item),
                            }))}
                            onBlur={(event) => void updateItem(it.id, { name: event.target.value })}
                            className="h-10 rounded-xl border-[#e1d7c7] bg-white font-semibold"
                          />
                          <Input
                            value={String(it.extra_price ?? 0)}
                            onChange={(event) => setItems((current) => ({
                              ...current,
                              [g.id]: (current[g.id] || []).map((item) => item.id === it.id ? { ...item, extra_price: event.target.value } : item),
                            }))}
                            onBlur={(event) => void updateItem(it.id, { extra_price: toMoney(event.target.value) })}
                            className="h-10 rounded-xl border-[#e1d7c7] bg-white font-semibold"
                          />
                          <span className="text-xs font-bold text-muted-foreground md:text-right">{formatBRL(it.extra_price || 0)}</span>
                          <div className="flex items-center justify-between gap-2">
                            <Switch checked={Boolean(it.is_active)} onCheckedChange={(value) => void updateItem(it.id, { is_active: value })} />
                            <Button size="icon" variant="ghost" className="h-9 w-9 rounded-xl" onClick={() => void removeItem(it.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      ))}

                      <div className="grid gap-2 rounded-2xl border border-dashed border-[#e1d7c7] bg-white p-3 md:grid-cols-[minmax(0,1fr)_8rem_auto] md:items-center">
                        <Input
                          value={draft.name}
                          onChange={(event) => setDraftItems((current) => ({ ...current, [g.id]: { ...draft, name: event.target.value } }))}
                          className="h-10 rounded-xl border-[#e1d7c7] font-semibold"
                          placeholder="Novo item"
                        />
                        <Input
                          value={draft.extra_price}
                          onChange={(event) => setDraftItems((current) => ({ ...current, [g.id]: { ...draft, extra_price: event.target.value } }))}
                          className="h-10 rounded-xl border-[#e1d7c7] font-semibold"
                          placeholder="Preco extra"
                        />
                        <Button variant="outline" onClick={() => void addItem(g.id)} className="h-10 rounded-xl border-[#e1d7c7] font-black uppercase tracking-widest">
                          <Plus className="h-4 w-4" />
                          Item
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

