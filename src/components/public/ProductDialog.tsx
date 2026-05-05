import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Minus, Plus } from "lucide-react";
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

  const handleAdd = () => {
    for (const group of groups) {
      const selection = selected[group.id] ?? [];
      if (group.is_required && selection.length < Math.max(1, group.min_choices)) {
        return toast.error(`Selecione em "${group.name}"`);
      }
      if (selection.length < group.min_choices) {
        return toast.error(`Minimo ${group.min_choices} em "${group.name}"`);
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
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto p-0">
        {product.image_url && <img src={product.image_url} alt={product.name} className="h-48 w-full object-cover" />}
        <div className="space-y-4 p-5">
          <DialogHeader>
            <DialogTitle className="pr-8 text-xl text-white">{product.name}</DialogTitle>
          </DialogHeader>
          {product.description && <p className="text-sm text-muted-foreground">{product.description}</p>}
          <div className="border border-border bg-background/65 p-3 text-lg font-bold text-white">
            {product.promo_price ? (
              <>
                {formatBRL(product.promo_price)}{" "}
                <span className="text-sm font-normal text-muted-foreground line-through">{formatBRL(product.price)}</span>
              </>
            ) : (
              formatBRL(product.price)
            )}
          </div>

          {loading ? (
            <div className="py-6 text-center">
              <Loader2 className="inline h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            groups.map((group) => {
              const groupItems = items.filter((item) => item.option_id === group.id);
              if (!groupItems.length) return null;
              const selection = selected[group.id] ?? [];

              return (
                <div key={group.id} className="space-y-2">
                  <div className="flex items-baseline justify-between">
                    <h4 className="text-sm font-medium">
                      {group.name} {group.is_required && <span className="text-destructive">*</span>}
                    </h4>
                    <span className="text-xs text-muted-foreground">
                      {group.max_choices === 1 ? "Escolha 1" : `Ate ${group.max_choices}`}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {groupItems.map((item) => {
                      const checked = selection.includes(item.id);
                      return (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => toggleItem(group, item.id)}
                          className={cn(
                            "flex w-full items-center justify-between border px-3 py-2 text-left text-sm transition-colors",
                            checked ? "border-primary bg-primary/10 text-white" : "border-border hover:bg-secondary",
                          )}
                        >
                          <span>{item.name}</span>
                          <div className="flex items-center gap-2">
                            {Number(item.extra_price) > 0 && (
                              <span className="text-xs text-muted-foreground">+ {formatBRL(item.extra_price)}</span>
                            )}
                            <div className={cn("h-4 w-4 border-2", checked ? "border-primary bg-primary" : "border-muted-foreground")} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}

          <div>
            <h4 className="mb-2 text-sm font-medium">Observacoes</h4>
            <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Ex: sem cebola" rows={2} maxLength={200} />
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
            <Button variant="hero" className="flex-1" onClick={handleAdd} disabled={loading}>
              Adicionar • {formatBRL(total)}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
