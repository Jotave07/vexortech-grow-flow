import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2, Minus, Plus, Sparkles } from "lucide-react";
import { formatBRL } from "@/lib/format";
import { useCart, CartOption } from "@/contexts/CartContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type OptGroup = { id: string; name: string; is_required: boolean; min_choices: number; max_choices: number };
type OptItem = { id: string; option_id: string; name: string; extra_price: number; is_active: boolean };

export const ProductDialog = ({ product, onClose }: { product: any; onClose: () => void }) => {
  const { addItem } = useCart();
  const [groups, setGroups] = useState<OptGroup[]>([]);
  const [items, setItems] = useState<OptItem[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: groupData } = await supabase
        .from("product_options")
        .select("*")
        .eq("product_id", product.id)
        .order("sort_order");

      const loadedGroups = (groupData ?? []) as OptGroup[];
      setGroups(loadedGroups);

      if (loadedGroups.length) {
        const { data: itemData } = await supabase
          .from("product_option_items")
          .select("*")
          .in("option_id", loadedGroups.map((group) => group.id))
          .eq("is_active", true)
          .order("sort_order");
        setItems((itemData ?? []) as OptItem[]);
      }

      setLoading(false);
    })();
  }, [product.id]);

  const toggleItem = (group: OptGroup, itemId: string) => {
    setSelected((previous) => {
      const current = previous[group.id] ?? [];
      if (group.max_choices === 1) {
        return { ...previous, [group.id]: current[0] === itemId ? [] : [itemId] };
      }

      const hasItem = current.includes(itemId);
      if (hasItem) {
        return { ...previous, [group.id]: current.filter((value) => value !== itemId) };
      }

      if (current.length >= group.max_choices) {
        toast.error(`Maximo ${group.max_choices} em ${group.name}`);
        return previous;
      }

      return { ...previous, [group.id]: [...current, itemId] };
    });
  };

  const unitPrice = Number(product.promo_price ?? product.price);
  const optionsExtra = Object.values(selected).flat().reduce((sum, id) => {
    const item = items.find((candidate) => candidate.id === id);
    return sum + Number(item?.extra_price ?? 0);
  }, 0);
  const total = (unitPrice + optionsExtra) * qty;
  const optionalSuggestions = groups
    .filter((group) => !group.is_required)
    .flatMap((group) => items.filter((item) => item.option_id === group.id).map((item) => ({ group, item })))
    .slice(0, 4);
  const quickNotes = ["Sem cebola", "Molho separado", "Caprichar no molho", "Talher descartavel"];
  const choiceGroups = groups.filter((group) => items.some((item) => item.option_id === group.id));
  const requiredMinimum = (group: OptGroup) => Math.max(group.is_required ? 1 : 0, group.min_choices || 0);
  const missingRequiredGroups = choiceGroups.filter((group) => (selected[group.id] ?? []).length < requiredMinimum(group));

  const handleAdd = () => {
    for (const group of choiceGroups) {
      const selection = selected[group.id] ?? [];
      const minimum = requiredMinimum(group);
      if (minimum > 0 && selection.length < minimum) {
        return toast.error(`Selecione em "${group.name}"`);
      }
    }

    const options: CartOption[] = [];
    for (const group of groups) {
      for (const itemId of selected[group.id] ?? []) {
        const item = items.find((candidate) => candidate.id === itemId);
        if (!item) continue;
        options.push({
          option_id: group.id,
          option_name: group.name,
          item_id: item.id,
          item_name: item.name,
          extra_price: Number(item.extra_price),
        });
      }
    }

    addItem({
      product_id: product.id,
      product_name: product.name,
      unit_price: unitPrice,
      quantity: qty,
      options,
      notes: notes.trim() || undefined,
    });
    toast.success("Adicionado ao carrinho");
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto p-0">
        {product.image_url && <img src={product.image_url} alt={product.name} className="h-56 w-full object-cover" />}
        <div className="space-y-5 p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle className="pr-8 text-2xl font-bold tracking-tight text-stone-950">{product.name}</DialogTitle>
          </DialogHeader>
          {product.description && <p className="text-sm leading-relaxed text-muted-foreground">{product.description}</p>}
          <div className="grid gap-3 border border-[#e6e8de] bg-[#f6f7f2] p-4 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Valor base</div>
              <div className="text-xl font-bold text-stone-950">
            {product.promo_price ? (
              <>
                {formatBRL(product.promo_price)}{" "}
                <span className="text-sm font-normal text-muted-foreground line-through">{formatBRL(product.price)}</span>
              </>
            ) : (
              formatBRL(product.price)
            )}
              </div>
            </div>
            {optionsExtra > 0 && (
              <div className="border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary">
                Adicionais: {formatBRL(optionsExtra)}
              </div>
            )}
          </div>

          {loading ? (
            <div className="py-6 text-center">
              <Loader2 className="inline h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            choiceGroups.map((group) => {
              const groupItems = items.filter((item) => item.option_id === group.id);
              if (!groupItems.length) return null;
              const selection = selected[group.id] ?? [];
              const minimum = requiredMinimum(group);
              const missing = Math.max(0, minimum - selection.length);

              return (
                <div key={group.id} className="space-y-3 border border-[#e6e8de] bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="text-sm font-bold text-stone-950">{group.name}</h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {minimum > 0
                          ? `Escolha pelo menos ${minimum}${group.max_choices > minimum ? ` e ate ${group.max_choices}` : ""}`
                          : `Escolha ate ${group.max_choices} opcao${group.max_choices > 1 ? "es" : ""}`}
                      </p>
                    </div>
                    <span className={cn(
                      "border px-2 py-1 text-[10px] font-bold uppercase tracking-widest",
                      missing > 0 ? "border-primary/25 bg-primary/10 text-primary" : "border-[#e6e8de] bg-[#f6f7f2] text-stone-500",
                    )}>
                      {missing > 0 ? `Faltam ${missing}` : "Ok"} {selection.length}/{group.max_choices}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {groupItems.map((item) => {
                      const checked = selection.includes(item.id);
                      return (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => toggleItem(group, item.id)}
                          className={cn(
                            "flex w-full items-center justify-between border px-3 py-3 text-left text-sm transition-colors",
                            checked ? "border-primary bg-primary/10 text-stone-950 font-semibold" : "border-[#e6e8de] hover:bg-[#f6f7f2]",
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            {checked && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
                            <span className="truncate">{item.name}</span>
                          </span>
                          <div className="flex items-center gap-2">
                            {Number(item.extra_price) > 0 && (
                              <span className="text-xs text-muted-foreground">+ {formatBRL(item.extra_price)}</span>
                            )}
                            <div className={cn("h-4 w-4 border-2", checked ? "border-primary bg-primary" : "border-muted-foreground/50")} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}

          {!loading && optionalSuggestions.length > 0 && (
            <div className="space-y-3 border border-[#e6e8de] bg-[#f6f7f2] p-4">
              <div className="flex items-center gap-2 text-sm font-bold text-stone-950">
                <Sparkles className="h-4 w-4 text-primary" />
                Sugestoes para incluir no pedido
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {optionalSuggestions.map(({ group, item }) => {
                  const checked = (selected[group.id] ?? []).includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => toggleItem(group, item.id)}
                      className={cn(
                        "border px-3 py-2 text-left text-xs font-semibold transition-colors",
                        checked ? "border-primary bg-primary/10 text-primary" : "border-[#e6e8de] bg-white text-stone-600 hover:border-primary/35",
                      )}
                    >
                      {item.name}
                      {Number(item.extra_price) > 0 && <span className="ml-1 text-muted-foreground">+ {formatBRL(item.extra_price)}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {!loading && missingRequiredGroups.length > 0 && (
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3 text-xs font-bold text-primary">
              Complete: {missingRequiredGroups.map((group) => group.name).join(", ")}
            </div>
          )}

          <div>
            <h4 className="mb-2 text-sm font-medium">Observacoes</h4>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ex: sem cebola" rows={2} maxLength={200} />
            <div className="mt-2 flex flex-wrap gap-2">
              {quickNotes.map((note) => (
                <button
                  key={note}
                  type="button"
                  onClick={() => setNotes((current) => current.includes(note) ? current : [current, note].filter(Boolean).join("; "))}
                  className="border border-[#e6e8de] bg-white px-2 py-1 text-xs font-semibold text-stone-600 hover:border-primary/35"
                >
                  {note}
                </button>
              ))}
            </div>
          </div>

          <div className="sticky bottom-0 -mx-5 -mb-5 flex items-center gap-3 border-t border-border bg-card px-5 py-4">
            <div className="flex items-center gap-2 border border-border">
              <Button size="icon" variant="ghost" onClick={() => setQty(Math.max(1, qty - 1))} className="h-9 w-9">
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-6 text-center font-medium">{qty}</span>
              <Button size="icon" variant="ghost" onClick={() => setQty(qty + 1)} className="h-9 w-9">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="hero" className="flex-1" onClick={handleAdd} disabled={loading || missingRequiredGroups.length > 0}>
              Adicionar â€¢ {formatBRL(total)}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

