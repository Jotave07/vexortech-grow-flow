import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Package, MapPin, User, ShoppingBag, MessageSquare, ExternalLink, Save, Search, Store } from "lucide-react";
import { formatBRL, formatDateTime, STATUS_COLORS, STATUS_LABELS, buildWhatsAppLink, formatPhone, formatDeliveryAddressLines } from "@/lib/format";
import { toast } from "sonner";

const PRODUCTION_STATUSES = new Set(["aguardando_pagamento", "novo", "confirmado", "em_preparo", "saiu_para_entrega", "pronto_para_retirada"]);
const DELIVERED_STATUSES = new Set(["entregue"]);

const CustomerDashboard = () => {
  const { user, profile, loading: authLoading, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    full_name: "",
    phone: "",
    document: "",
    zip_code: "",
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
  });

  const isProfileComplete = profile?.full_name && 
    profile?.phone && 
    profile?.document && 
    profile?.zip_code && 
    profile?.street && 
    profile?.number && 
    profile?.neighborhood && 
    profile?.city && 
    profile?.state;
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/entrar", { replace: true });
      return;
    }

    const loadOrders = async () => {
      if (!user?.id) return;
      
      try {
        const { data: customerRecords, error: customerError } = await backend
          .from("customers")
          .select("id")
          .eq("user_id", user.id);

        if (customerError) throw customerError;
        
        const customerIds = customerRecords?.map((c: any) => c.id) || [];

        if (customerIds.length === 0) {
          setOrders([]);
          return;
        }

        const { data, error } = await (backend
          .from("orders" as any)
          .select("*, stores(name, slug, whatsapp)")
          .in("customer_id", customerIds)
          .order("created_at", { ascending: false }) as any);

        if (error) throw error;
        setOrders(data ?? []);
      } catch (error: any) {
        console.error("Error loading orders:", error);
        toast.error("Erro ao carregar seus pedidos");
      } finally {
        setLoading(false);
      }
    };

    if (profile) {
      setFormData({
        full_name: profile.full_name || "",
        phone: profile.phone || "",
        document: profile.document || "",
        zip_code: profile.zip_code || "",
        street: profile.street || "",
        number: profile.number || "",
        complement: profile.complement || "",
        neighborhood: profile.neighborhood || "",
        city: profile.city || "",
        state: profile.state || "",
      });

      if (!isProfileComplete) {
        setEditModalOpen(true);
      }
    }

    loadOrders();

    // Add Real-time subscription for orders
    const channel = backend
      .channel(`customer-orders-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders"
        },
        () => {
          loadOrders();
        }
      )
      .subscribe();

    return () => {
      void backend.removeChannel(channel);
    };
  }, [user, profile, authLoading, navigate, isProfileComplete]);


  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!formData.document || formData.document.replace(/\D/g, "").length < 11) {
      toast.error("Informe um CPF ou CNPJ válido");
      return;
    }

    setSaving(true);
    try {
      const { error } = await (backend
        .from("profiles" as any)
        .update({
          full_name: formData.full_name,
          phone: formData.phone.replace(/\D/g, ""),
          document: formData.document.replace(/\D/g, ""),
          zip_code: formData.zip_code.replace(/\D/g, ""),
          street: formData.street,
          number: formData.number,
          complement: formData.complement,
          neighborhood: formData.neighborhood,
          city: formData.city,
          state: formData.state,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user.id) as any);

      if (error) throw error;

      await refreshProfile();
      toast.success("Perfil atualizado com sucesso!");
      setEditModalOpen(false);
    } catch (error: any) {
      toast.error(error.message || "Erro ao atualizar perfil");
    } finally {
      setSaving(false);
    }
  };

  const productionOrders = orders.filter((order) => PRODUCTION_STATUSES.has(order.status));
  const deliveredOrders = orders.filter((order) => DELIVERED_STATUSES.has(order.status));

  const renderOrders = (items: any[], emptyTitle: string, emptyDescription: string) => (
    items.length === 0 ? (
      <Card className="p-10 text-center border-2 border-dashed border-border bg-card md:p-16">
        <ShoppingBag className="h-12 w-12 mx-auto text-muted-foreground/35 mb-4" />
        <h3 className="font-black uppercase tracking-tight text-xl">{emptyTitle}</h3>
        <p className="text-muted-foreground text-sm">{emptyDescription}</p>
        <Button className="mt-6 font-black uppercase" variant="hero" asChild>
          <Link to="/lojas">Ver lojas disponíveis</Link>
        </Button>
      </Card>
    ) : (
      items.map((order) => (
        <Card key={order.id} className="p-6 border border-border rounded-md bg-card shadow-elegant hover:shadow-elegant transition-all">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 border-b border-border/50 pb-4">
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Pedido #{order.order_number}</div>
              <h3 className="text-lg font-black uppercase tracking-tight italic">{order.stores?.name || "Loja"}</h3>
              <div className="text-xs font-bold text-muted-foreground">{formatDateTime(order.created_at)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge className={`rounded-md border border-border uppercase font-black text-[10px] px-3 py-1 ${STATUS_COLORS[order.status] || ""}`}>
                {STATUS_LABELS[order.status] || order.status}
              </Badge>
              <Button variant="outline" size="sm" className="rounded-md border-border h-8 text-[10px] font-black uppercase" asChild>
                <a href={`/pedido/${order.public_token}`}>
                  <ExternalLink className="h-3 w-3 mr-1" /> Rastrear
                </a>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-bold uppercase text-[10px] tracking-widest text-muted-foreground">
                <MapPin className="h-3 w-3" /> Endereço de entrega
              </div>
              <div className="space-y-0.5 font-medium text-xs leading-relaxed">
                {formatDeliveryAddressLines(order).map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 font-bold uppercase text-[10px] tracking-widest text-muted-foreground">
                <Package className="h-3 w-3" /> Resumo do valor
              </div>
              <p className="font-black text-lg text-primary">{formatBRL(order.total)}</p>
            </div>
          </div>

          <div className="flex gap-2 border-t-2 border-border/40 pt-4 mt-4">
            {order.stores?.whatsapp && (
              <Button variant="outline" size="sm" className="flex-1 rounded-md border-border bg-[#25D366]/10 text-[#128C7E] hover:bg-[#25D366] hover:text-foreground font-black uppercase text-[10px] h-10 transition-colors" asChild>
                <a href={buildWhatsAppLink(order.stores.whatsapp, `Olá! Gostaria de saber sobre meu pedido #${order.order_number}`)} target="_blank" rel="noreferrer">
                  <MessageSquare className="h-4 w-4 mr-2" /> WhatsApp da Loja
                </a>
              </Button>
            )}
          </div>
        </Card>
      ))
    )
  );

  if (authLoading || loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="min-h-screen bg-muted/30 pb-20">
      <header className="bg-background text-foreground p-8 border-b-4 border-primary">
        <div className="container max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter italic">Meu Painel</h1>
            <p className="text-foreground/62 text-sm font-bold uppercase tracking-widest mt-1">Bem-vindo, {profile?.full_name || 'Cliente'}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-md bg-primary/15 border-2 border-primary flex items-center justify-center">
              <User className="h-6 w-6 text-primary" />
            </div>
          </div>
        </div>
      </header>

      <main className="container max-w-4xl mx-auto p-4 -mt-6">
        <Tabs defaultValue="producao" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Button variant="outline" className="h-14 justify-start rounded-md border-border bg-card font-black uppercase" asChild>
              <Link to="/lojas">
                <Store className="h-4 w-4 mr-2 text-primary" /> Lojas disponiveis
              </Link>
            </Button>
            <Button variant="hero" className="h-14 justify-start rounded-md font-black uppercase" asChild>
              <Link to="/lojas">
                <ShoppingBag className="h-4 w-4 mr-2" /> Fazer pedido
              </Link>
            </Button>
          </div>

          <TabsList className="w-full bg-card border border-border rounded-md h-14 p-1 shadow-panel">
            <TabsTrigger value="producao" className="flex-1 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-black uppercase text-xs tracking-widest h-full">
              <Package className="h-4 w-4 mr-2" /> Em producao
            </TabsTrigger>
            <TabsTrigger value="entregues" className="flex-1 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-black uppercase text-xs tracking-widest h-full">
              <ShoppingBag className="h-4 w-4 mr-2" /> Entregues
            </TabsTrigger>
          </TabsList>

          <TabsContent value="producao" className="space-y-4">
            {renderOrders(
              productionOrders,
              "Nenhum pedido em producao",
              "Pedidos aguardando pagamento, em preparo ou em rota aparecem aqui.",
            )}
          </TabsContent>

          <TabsContent value="entregues" className="space-y-4">
            {renderOrders(
              deliveredOrders,
              "Nenhum pedido entregue",
              "Quando uma entrega for concluida, ela aparece neste historico.",
            )}
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={editModalOpen} onOpenChange={isProfileComplete ? setEditModalOpen : () => {}}>
        <DialogContent className="border border-border rounded-md max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black uppercase italic tracking-tighter">
              {!isProfileComplete ? "Complete seu Cadastro" : "Editar Perfil"}
            </DialogTitle>
            <DialogDescription className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              {!isProfileComplete
                ? "Para acessar seu painel e realizar compras, precisamos de alguns dados obrigatórios."
                : "Mantenha seus dados atualizados para facilitar seus pedidos."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateProfile} className="space-y-4 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="full_name" className="text-[10px] font-black uppercase tracking-widest">Nome Completo</Label>
                <Input 
                  id="full_name" 
                  value={formData.full_name} 
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  className="border border-border rounded-md h-11 font-bold"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="document" className="text-[10px] font-black uppercase tracking-widest">CPF ou CNPJ</Label>
                <Input 
                  id="document" 
                  value={formData.document} 
                  onChange={(e) => setFormData({ ...formData, document: e.target.value })}
                  placeholder="000.000.000-00"
                  className="border border-border rounded-md h-11 font-bold"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone" className="text-[10px] font-black uppercase tracking-widest">WhatsApp / Celular</Label>
                <Input 
                  id="phone" 
                  value={formData.phone} 
                  onChange={(e) => setFormData({ ...formData, phone: formatPhone(e.target.value) })}
                  placeholder="(00) 00000-0000"
                  className="border border-border rounded-md h-11 font-bold"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="zip_code" className="text-[10px] font-black uppercase tracking-widest">CEP</Label>
                <div className="flex gap-2">
                  <Input 
                    id="zip_code" 
                    value={formData.zip_code} 
                    onChange={(e) => setFormData({ ...formData, zip_code: e.target.value })}
                    placeholder="00000-000"
                    className="border border-border rounded-md h-11 font-bold flex-1"
                    required
                  />
                  <Button 
                    type="button" 
                    size="icon" 
                    variant="outline" 
                    className="border border-border rounded-md h-11 w-11 shrink-0"
                    onClick={async () => {
                      const cep = formData.zip_code.replace(/\D/g, "");
                      if (cep.length !== 8) return toast.error("CEP inválido");
                      try {
                        const { fetchAddressByCep } = await import("@/services/cep/viacepService");
                        const addr = await fetchAddressByCep(cep);
                        setFormData(prev => ({
                          ...prev,
                          street: addr.logradouro || prev.street,
                          neighborhood: addr.bairro || prev.neighborhood,
                          city: addr.localidade || prev.city,
                          state: addr.uf || prev.state
                        }));
                        toast.success("Endereço localizado!");
                      } catch (e) {
                        toast.error("Erro ao buscar CEP");
                      }
                    }}
                  >
                    <Search className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-3 space-y-2">
                <Label htmlFor="street" className="text-[10px] font-black uppercase tracking-widest">Rua / Logradouro</Label>
                <Input 
                  id="street" 
                  value={formData.street} 
                  onChange={(e) => setFormData({ ...formData, street: e.target.value })}
                  className="border border-border rounded-md h-11 font-bold"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="number" className="text-[10px] font-black uppercase tracking-widest">Número</Label>
                <Input 
                  id="number" 
                  value={formData.number} 
                  onChange={(e) => setFormData({ ...formData, number: e.target.value })}
                  className="border border-border rounded-md h-11 font-bold"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="complement" className="text-[10px] font-black uppercase tracking-widest">Complemento (opcional)</Label>
                <Input 
                  id="complement" 
                  value={formData.complement} 
                  onChange={(e) => setFormData({ ...formData, complement: e.target.value })}
                  className="border border-border rounded-md h-11 font-bold"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="neighborhood" className="text-[10px] font-black uppercase tracking-widest">Bairro</Label>
                <Input 
                  id="neighborhood" 
                  value={formData.neighborhood} 
                  onChange={(e) => setFormData({ ...formData, neighborhood: e.target.value })}
                  className="border border-border rounded-md h-11 font-bold"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="md:col-span-3 space-y-2">
                <Label htmlFor="city" className="text-[10px] font-black uppercase tracking-widest">Cidade</Label>
                <Input 
                  id="city" 
                  value={formData.city} 
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  className="border border-border rounded-md h-11 font-bold"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state" className="text-[10px] font-black uppercase tracking-widest">UF</Label>
                <Input 
                  id="state" 
                  value={formData.state} 
                  onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                  maxLength={2}
                  className="border border-border rounded-md h-11 font-bold"
                  required
                />
              </div>
            </div>

            <DialogFooter className="pt-6">
              {isProfileComplete && (
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setEditModalOpen(false)}
                  className="border border-border rounded-md font-black uppercase tracking-widest text-xs h-12"
                >
                  Cancelar
                </Button>
              )}
              <Button 
                type="submit" 
                variant="hero" 
                disabled={saving}
                className="font-black uppercase tracking-widest text-xs h-12 flex-1"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                {!isProfileComplete ? "Finalizar Cadastro" : "Salvar Alterações"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomerDashboard;


