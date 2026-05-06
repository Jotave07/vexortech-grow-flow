import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Search, Phone, MessageSquare, ShoppingBag } from "lucide-react";
import { formatBRL, formatPhone, buildWhatsAppLink, STATUS_LABELS } from "@/lib/format";

const Customers = () => {
  const { store } = useOutletContext<{ store: any }>();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    if (!store?.id) return;
    (async () => {
      const { data } = await supabase.from("customers").select("*").eq("store_id", store.id)
        .order("last_order_at", { ascending: false, nullsFirst: false }).limit(500);
      setItems(data ?? []);
      setLoading(false);
    })();
  }, [store?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => c.name?.toLowerCase().includes(q) || c.phone?.includes(q));
  }, [items, search]);

  const openHistory = async (c: any) => {
    setSelected(c);
    const { data } = await supabase.from("orders").select("id, order_number, status, total, created_at, delivery_type")
      .eq("store_id", store.id).eq("customer_id", c.id).order("created_at", { ascending: false }).limit(50);
    setOrders(data ?? []);
  };

  if (loading) return <div className="py-20 text-center"><Loader2 className="h-8 w-8 animate-spin inline text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Clientes</h1>
        <p className="text-muted-foreground">Sua base de clientes ({items.length}).</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por nome ou telefone..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          {items.length === 0 ? "Ainda não há clientes. Eles serão criados automaticamente nos pedidos." : "Nenhum cliente encontrado."}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((c) => (
            <Card key={c.id} className="p-4 cursor-pointer hover:border-primary/50" onClick={() => openHistory(c)}>
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-medium truncate">{c.name}</h3>
                <Badge variant="secondary">{c.total_orders} {c.total_orders === 1 ? "pedido" : "pedidos"}</Badge>
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" /> {formatPhone(c.phone)}</div>
              <div className="flex items-center justify-between mt-2 text-sm">
                <span className="text-muted-foreground">Total gasto</span>
                <span className="font-semibold text-primary">{formatBRL(c.total_spent)}</span>
              </div>
              {c.last_order_at && <div className="text-xs text-muted-foreground mt-1">Último: {new Date(c.last_order_at).toLocaleDateString("pt-BR")}</div>}
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{selected?.name}</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Card className="p-3"><div className="text-xs text-muted-foreground">Pedidos</div><div className="text-xl font-bold">{selected.total_orders}</div></Card>
                <Card className="p-3"><div className="text-xs text-muted-foreground">Total gasto</div><div className="text-xl font-bold text-primary">{formatBRL(selected.total_spent)}</div></Card>
              </div>
              <Button asChild variant="outline" className="w-full">
                <a href={buildWhatsAppLink(selected.phone, `Olá ${selected.name}!`)} target="_blank" rel="noreferrer">
                  <MessageSquare className="h-4 w-4" /> Abrir WhatsApp
                </a>
              </Button>
              <div>
                <h3 className="font-semibold text-sm mb-2 flex items-center gap-1"><ShoppingBag className="h-4 w-4" /> Histórico</h3>
                {orders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem pedidos.</p>
                ) : (
                  <ul className="space-y-2">
                    {orders.map((o) => (
                      <li key={o.id} className="flex justify-between items-center text-sm border-b border-border pb-2">
                        <div>
                          <div className="font-medium">#{o.order_number} <Badge variant="outline" className="text-xs ml-1">{STATUS_LABELS[o.status]}</Badge></div>
                          <div className="text-xs text-muted-foreground">{new Date(o.created_at).toLocaleString("pt-BR")} · {o.delivery_type}</div>
                        </div>
                        <span className="font-semibold">{formatBRL(o.total)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
export default Customers;
