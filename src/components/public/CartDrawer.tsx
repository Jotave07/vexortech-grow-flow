import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/AuthContext";
import { formatBRL } from "@/lib/format";
import { Minus, Plus, Trash2, ShoppingBag } from "lucide-react";
import { useNavigate } from "react-router-dom";

export const CartDrawer = ({
  open,
  onOpenChange,
  slug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
}) => {
  const { items, itemSubtotal, subtotal, updateQty, removeItem, count } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border p-5">
          <SheetTitle>Seu carrinho</SheetTitle>
        </SheetHeader>
        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center p-6 text-center text-muted-foreground">
            <ShoppingBag className="mb-3 h-10 w-10" />
            <p>Carrinho vazio</p>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {items.map((item) => (
                <div key={item.uid} className="border-b border-border pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{item.product_name}</div>
                      {item.options.length > 0 && (
                        <ul className="mt-1 text-xs text-muted-foreground">
                          {item.options.map((option, index) => (
                            <li key={index}>
                              + {option.item_name}
                              {Number(option.extra_price) > 0 && ` (${formatBRL(option.extra_price)})`}
                            </li>
                          ))}
                        </ul>
                      )}
                      {item.notes && <div className="mt-1 text-xs italic text-muted-foreground">"{item.notes}"</div>}
                    </div>
                    <button onClick={() => removeItem(item.uid)} className="p-1 text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-1 border border-border">
                      <button onClick={() => updateQty(item.uid, item.quantity - 1)} className="px-2 py-1">
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-6 text-center text-sm">{item.quantity}</span>
                      <button onClick={() => updateQty(item.uid, item.quantity + 1)} className="px-2 py-1">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <span className="text-sm font-semibold">{formatBRL(itemSubtotal(item))}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-3 border-t border-border p-5">
              <div className="flex justify-between text-sm">
                <span>
                  Subtotal ({count} {count === 1 ? "item" : "itens"})
                </span>
                <span className="font-bold">{formatBRL(subtotal)}</span>
              </div>
              <Button
                variant="hero"
                className="w-full"
                onClick={() => {
                  onOpenChange(false);
                  if (!user) {
                    navigate(`/entrar?redirect=${encodeURIComponent(`/vendas/loja/${slug}/checkout`)}`);
                  } else {
                    navigate(`/vendas/loja/${slug}/checkout`);
                  }
                }}
              >
                Continuar para checkout
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
