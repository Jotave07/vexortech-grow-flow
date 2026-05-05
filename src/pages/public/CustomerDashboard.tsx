import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Package, MapPin, User, ShoppingBag, MessageSquare, ExternalLink, Save, LogOut } from "lucide-react";
import { formatBRL, formatDateTime, STATUS_COLORS, STATUS_LABELS, buildWhatsAppLink, formatPhone } from "@/lib/format";
import { toast } from "sonner";

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
  });

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate("/entrar", { replace: true });
      return;
    }

    const loadOrders = async () => {
      // Find orders by phone or user_id
      // Priority 1: profile.phone
      // Priority 2: user.id (if we start linking orders to user_id in the future)
      if (profile?.phone || user?.id) {
        let query = supabase
          .from("orders" as any)
          .select("*, stores(name, slug, whatsapp)");
          
        if (user?.id) {
          query = query.or(`customer_id.in.(select id from customers where user_id.eq.${user.id}),customer_phone.eq.${profile?.phone?.replace(/\D/g, "") || 'none'}`);
        } else {
          query = query.eq("customer_phone", profile?.phone?.replace(/\D/g, "") || 'none');
        }

        const { data } = await (query.order("created_at", { ascending: false }) as any);
        setOrders(data ?? []);
      }
      setLoading(false);
    };

    if (profile) {
      setFormData({
        full_name: profile.full_name || "",
        phone: profile.phone || "",
      });
    }

    loadOrders();
  }, [user, profile, authLoading, navigate]);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    try {
      const { error } = await (supabase
        .from("profiles" as any)
        .update({
          full_name: formData.full_name,
          phone: formData.phone.replace(/\D/g, ""),
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

  if (authLoading || loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="min-h-screen bg-muted/30 pb-20">
      <header className="bg-black text-white p-8 border-b-4 border-primary">
        <div className="container max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-black uppercase tracking-tighter italic">Meu Painel</h1>
            <p className="text-white/60 text-sm font-bold uppercase tracking-widest mt-1">Bem-vindo, {profile?.full_name || 'Cliente'}</p>
          </div>
          <div className="flex items-center gap-4">
            <User className="h-10 w-10 text-primary" />
            <Button 
              variant="ghost" 
              size="icon" 
              className="text-white hover:bg-white/10" 
              onClick={() => signOut()}
              title="Sair"
            >
              <LogOut className="h-6 w-6" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container max-w-4xl mx-auto p-4 -mt-6">
        <Tabs defaultValue="pedidos" className="space-y-6">
          <TabsList className="w-full bg-white border-2 border-black rounded-none h-14 p-1 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <TabsTrigger value="pedidos" className="flex-1 rounded-none data-[state=active]:bg-black data-[state=active]:text-white font-black uppercase text-xs tracking-widest h-full">
              <Package className="h-4 w-4 mr-2" /> Meus Pedidos
            </TabsTrigger>
            <TabsTrigger value="perfil" className="flex-1 rounded-none data-[state=active]:bg-black data-[state=active]:text-white font-black uppercase text-xs tracking-widest h-full">
              <User className="h-4 w-4 mr-2" /> Meu Perfil
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pedidos" className="space-y-4">
            {orders.length === 0 ? (
              <Card className="p-20 text-center border-2 border-dashed border-black/20 bg-white">
                <ShoppingBag className="h-12 w-12 mx-auto text-black/10 mb-4" />
                <h3 className="font-black uppercase tracking-tight text-xl">Nenhum pedido ainda</h3>
                <p className="text-muted-foreground text-sm">Seus pedidos aparecerão aqui assim que você realizar sua primeira compra.</p>
                <Button className="mt-6 font-black uppercase" variant="hero" asChild>
                  <Link to="/">Ver lojas disponíveis</Link>
                </Button>
              </Card>
            ) : (
              orders.map((order) => (
                <Card key={order.id} className="p-6 border-2 border-black rounded-none bg-white shadow-elegant hover:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] transition-all">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 border-b-2 border-black/5 pb-4">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1">Pedido #{order.order_number}</div>
                      <h3 className="text-lg font-black uppercase tracking-tight italic">{order.stores?.name || 'Loja'}</h3>
                      <div className="text-xs font-bold text-muted-foreground">{formatDateTime(order.created_at)}</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge className={`rounded-none border-2 border-black uppercase font-black text-[10px] px-3 py-1 ${STATUS_COLORS[order.status] || ''}`}>
                        {STATUS_LABELS[order.status] || order.status}
                      </Badge>
                      <Button variant="outline" size="sm" className="rounded-none border-black h-8 text-[10px] font-black uppercase" asChild>
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
                      <p className="font-medium text-xs leading-relaxed">{order.delivery_address || 'Retirada no local'}</p>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 font-bold uppercase text-[10px] tracking-widest text-muted-foreground">
                        <Package className="h-3 w-3" /> Resumo do valor
                      </div>
                      <p className="font-black text-lg text-primary">{formatBRL(order.total)}</p>
                    </div>
                  </div>

                  <div className="flex gap-2 border-t-2 border-black/5 pt-4 mt-4">
                    {order.stores?.whatsapp && (
                      <Button variant="outline" size="sm" className="flex-1 rounded-none border-black bg-[#25D366]/10 text-[#128C7E] hover:bg-[#25D366] hover:text-white font-black uppercase text-[10px] h-10 transition-colors" asChild>
                        <a href={buildWhatsAppLink(order.stores.whatsapp, `Olá! Gostaria de saber sobre meu pedido #${order.order_number}`)} target="_blank" rel="noreferrer">
                          <MessageSquare className="h-4 w-4 mr-2" /> WhatsApp da Loja
                        </a>
                      </Button>
                    )}
                  </div>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="perfil" className="space-y-6">
            <Card className="p-8 border-2 border-black rounded-none bg-white shadow-elegant">
              <h2 className="text-xl font-black uppercase tracking-tight mb-6 italic border-b-2 border-black pb-2">Informações Pessoais</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Nome Completo</label>
                  <p className="font-bold text-lg">{profile?.full_name || 'Não informado'}</p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">E-mail</label>
                  <p className="font-bold text-lg">{user?.email || 'Não informado'}</p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">WhatsApp</label>
                  <p className="font-bold text-lg">{profile?.phone ? formatPhone(profile.phone) : 'Não informado'}</p>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Endereço Principal</label>
                  <p className="font-bold text-sm">
                    {profile?.street ? (
                      `${profile.street}, ${profile.number}${profile.complement ? ` - ${profile.complement}` : ''} | ${profile.neighborhood} - ${profile.city}/${profile.state}`
                    ) : 'Endereço não cadastrado'}
                  </p>
                </div>
              </div>
              <Button 
                className="mt-8 font-black uppercase" 
                variant="hero" 
                onClick={() => setEditModalOpen(true)}
              >
                Editar Perfil
              </Button>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={editModalOpen} onOpenChange={setEditModalOpen}>
        <DialogContent className="border-2 border-black rounded-none max-w-md">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black uppercase italic italic tracking-tighter">Editar Perfil</DialogTitle>
            <DialogDescription className="font-bold text-xs uppercase tracking-widest text-muted-foreground">
              Mantenha seus dados atualizados para facilitar seus pedidos.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateProfile} className="space-y-6 py-4">
            <div className="space-y-2">
              <Label htmlFor="full_name" className="text-[10px] font-black uppercase tracking-widest">Nome Completo</Label>
              <Input 
                id="full_name" 
                value={formData.full_name} 
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                className="border-2 border-black rounded-none h-12 font-bold"
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
                className="border-2 border-black rounded-none h-12 font-bold"
                required
              />
            </div>
            <DialogFooter className="pt-4">
              <Button 
                type="button" 
                variant="outline" 
                onClick={() => setEditModalOpen(false)}
                className="border-2 border-black rounded-none font-black uppercase tracking-widest text-xs h-12"
              >
                Cancelar
              </Button>
              <Button 
                type="submit" 
                variant="hero" 
                disabled={saving}
                className="font-black uppercase tracking-widest text-xs h-12"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                Salvar Alterações
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomerDashboard;