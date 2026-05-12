import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, MapPin, ShoppingBag, User, ChevronDown, Filter } from "lucide-react";
import { Footer } from "@/components/landing/Footer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchAddressByCep } from "@/services/viacep";
import { toast } from "sonner";
import { onlyDigits, formatCEP, formatBRL } from "@/lib/format";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

export default function StoresList() {
  const [stores, setStores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [address, setAddress] = useState<any>(null);
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [tempCep, setTempCep] = useState("");
  const [loadingCep, setLoadingCep] = useState(false);
  const [activeCategory, setActiveCategory] = useState("Restaurantes");

  const { user, profile, signOut } = useAuth();
  const { count, subtotal } = useCart();
  const navigate = useNavigate();

  const categories = [
    { name: "Restaurantes", icon: "🍔" },
    { name: "Mercados", icon: "🛒" },
    { name: "Bebidas", icon: "🥤" },
    { name: "Farmácia", icon: "💊" },
    { name: "Promoções", icon: "🏷️" },
    { name: "Mais pedidos", icon: "⭐" },
  ];

  useEffect(() => {
    const saved = localStorage.getItem("delivery_address");
    if (saved) {
      setAddress(JSON.parse(saved));
    } else {
      setShowAddressModal(true);
    }
  }, []);

  const handleCepLookup = async () => {
    const cleanCep = onlyDigits(tempCep);
    if (cleanCep.length !== 8) return toast.error("CEP inválido");
    setLoadingCep(true);
    try {
      const addr = await fetchAddressByCep(cleanCep);
      const fullAddr = { ...addr, zipCode: cleanCep };
      setAddress(fullAddr);
      localStorage.setItem("delivery_address", JSON.stringify(fullAddr));
      setShowAddressModal(false);
      toast.success("Endereço definido!");
    } catch (e: any) {
      toast.error(e.message || "Erro ao buscar CEP");
    } finally {
      setLoadingCep(false);
    }
  };

  useEffect(() => {
    async function loadStores() {
      const { data } = await supabase
        .from("stores")
        .select(`
          *,
          store_settings(is_open, business_hours, avg_prep_time_minutes)
        `)
        .eq("is_suspended", false);
      
      setStores(data || []);
      setLoading(false);
    }
    loadStores();
  }, []);

  const filteredStores = useMemo(() => {
    return stores.filter(s => {
      const matchesSearch = s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.city?.toLowerCase().includes(search.toLowerCase());
      
      return matchesSearch;
    }).sort((a, b) => {
      if (a.store_settings?.is_open && !b.store_settings?.is_open) return -1;
      if (!a.store_settings?.is_open && b.store_settings?.is_open) return 1;
      return 0;
    });
  }, [stores, search]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="hidden">
        {/* SEO Metadata */}
        <title>Restaurantes | VexorTech</title>
        <meta name="description" content="Encontre restaurantes, explore opções disponíveis e faça seu pedido de forma simples pela VexorTech." />
      </div>
      {/* Header Desktop */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-100 shadow-sm">
        <div className="container mx-auto px-4 h-20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-8 shrink-0">
            <BrandMark to="/" className="scale-90" />
            
            <nav className="hidden lg:flex items-center gap-6">
              <button 
                onClick={() => navigate("/vendas")}
                className={`text-sm font-bold uppercase tracking-widest transition-colors ${activeCategory === "Início" ? "text-primary" : "text-gray-500 hover:text-gray-900"}`}
              >
                Início
              </button>
              <button 
                onClick={() => setActiveCategory("Restaurantes")}
                className={`text-sm font-bold uppercase tracking-widest transition-colors ${activeCategory === "Restaurantes" ? "text-primary" : "text-gray-500 hover:text-gray-900"}`}
              >
                Restaurantes
              </button>
              <button 
                onClick={() => setActiveCategory("Mercados")}
                className={`text-sm font-bold uppercase tracking-widest transition-colors ${activeCategory === "Mercados" ? "text-primary" : "text-gray-500 hover:text-gray-900"}`}
              >
                Mercados
              </button>
            </nav>
          </div>

          <div className="flex-1 max-w-2xl hidden md:flex items-center gap-4 bg-gray-50 px-4 h-12 rounded-lg border border-transparent focus-within:border-gray-200 focus-within:bg-white transition-all">
            <Search className="h-5 w-5 text-gray-400" />
            <input 
              type="text"
              placeholder="Busque por restaurante, item ou categoria"
              className="flex-1 bg-transparent border-none focus:ring-0 text-sm font-medium"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2 lg:gap-4 shrink-0">
            <button 
              onClick={() => setShowAddressModal(true)}
              className="hidden sm:flex items-center gap-2 px-3 h-12 hover:bg-gray-50 rounded-lg transition-colors group"
            >
              <MapPin className="h-5 w-5 text-primary" />
              <div className="text-left hidden lg:block">
                <p className="text-[10px] uppercase font-bold text-gray-400 leading-none mb-0.5">Entregar em</p>
                <p className="text-sm font-bold text-gray-900 leading-none truncate max-w-[150px]">
                  {address ? `${address.neighborhood}, ${address.city}` : "Escolha um endereço"}
                </p>
              </div>
              <ChevronDown className="h-4 w-4 text-gray-400 group-hover:text-primary transition-colors" />
            </button>

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded-full transition-colors">
                    <div className="h-9 w-9 bg-gray-100 rounded-full flex items-center justify-center border border-gray-200">
                      <User className="h-5 w-5 text-gray-600" />
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 mt-2">
                  <DropdownMenuLabel>
                    <p className="text-sm font-bold truncate">{profile?.full_name || user.email}</p>
                    <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mt-1">
                      {profile?.role === 'store_owner' ? 'Lojista' : 'Cliente'}
                    </p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate(profile?.role === 'store_owner' ? "/lojista" : "/cliente")}>
                    Minha Conta
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="text-red-600 focus:text-red-600">
                    Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <button 
                onClick={() => navigate("/entrar")}
                className="text-sm font-bold text-primary hover:bg-primary/5 px-4 h-12 rounded-lg transition-colors"
              >
                Entrar
              </button>
            )}

            <button 
              onClick={() => {
                // Abre o carrinho ou navega para a loja ativa
                const slug = localStorage.getItem("vexor_active_store_slug");
                if (slug) navigate(`/loja/${slug}`);
              }}
              className="flex items-center gap-2 bg-primary text-white px-4 h-12 rounded-lg hover:brightness-110 transition-all shadow-lg shadow-primary/20"
            >
              <div className="relative">
                <ShoppingBag className="h-5 w-5" />
                {count > 0 && (
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[10px] font-bold h-4 w-4 flex items-center justify-center rounded-full border-2 border-primary">
                    {count}
                  </span>
                )}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-[10px] uppercase font-bold text-white/70 leading-none mb-0.5">Carrinho</p>
                <p className="text-sm font-bold leading-none">{formatBRL(subtotal)}</p>
              </div>
            </button>
          </div>
        </div>

        {/* Categories Bar */}
        <div className="bg-white border-t border-gray-100 overflow-hidden">
          <div className="container mx-auto px-4 overflow-x-auto no-scrollbar flex items-center gap-4 py-3">
            {categories.map((cat) => (
              <button
                key={cat.name}
                onClick={() => setActiveCategory(cat.name)}
                className={`flex items-center gap-2 whitespace-nowrap px-4 py-2 rounded-full border transition-all ${
                  activeCategory === cat.name 
                    ? "bg-gray-900 border-gray-900 text-white font-bold" 
                    : "bg-white border-gray-100 text-gray-600 hover:border-gray-300 font-medium"
                }`}
              >
                <span className="text-base">{cat.icon}</span>
                <span className="text-sm uppercase tracking-wider">{cat.name}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Mobile Header Compact */}
      <header className="md:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-100 px-4 py-2">
         <div className="flex items-center justify-between mb-2">
            <BrandMark to="/" className="scale-75 origin-left" />
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setShowAddressModal(true)}
                className="flex items-center gap-1 text-xs font-bold text-gray-600"
              >
                <MapPin className="h-4 w-4 text-primary" />
                <span className="truncate max-w-[100px]">
                  {address ? address.neighborhood : "Endereço"}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>
            </div>
         </div>
         <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input 
              type="text"
              placeholder="Busque por restaurante ou item"
              className="w-full bg-gray-100 border-none rounded-lg py-2 pl-9 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
         </div>
      </header>
      
      <main className="container mx-auto px-4 pt-36 md:pt-44 pb-20">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 uppercase tracking-tight italic">
            {activeCategory}
          </h1>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-400 uppercase tracking-widest">{filteredStores.length} Lojas</span>
            <Button variant="outline" size="sm" className="hidden md:flex gap-2 font-bold uppercase text-[10px] tracking-widest h-9">
              <Filter className="h-3 w-3" /> Filtros
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="animate-pulse bg-gray-50 rounded-2xl h-[340px]" />
            ))}
          </div>
        ) : filteredStores.length === 0 ? (
          <div className="text-center py-24 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100">
            <ShoppingBag className="h-16 w-16 mx-auto text-gray-200 mb-4" />
            <h3 className="text-xl font-bold uppercase text-gray-900 tracking-tight italic">Nenhum restaurante encontrado</h3>
            <p className="text-gray-500 font-medium">Tente ajustar sua busca ou mudar sua localização.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredStores.map(store => (
              <Link key={store.id} to={`/loja/${store.slug}`} className="group block">
                <Card className="overflow-hidden border border-gray-100 shadow-sm group-hover:shadow-xl group-hover:-translate-y-1 transition-all duration-300 rounded-2xl bg-white h-full flex flex-col">
                  <div className="h-44 bg-gray-900 relative">
                    {store.logo_url ? (
                      <img src={store.logo_url} alt={store.name} className="w-full h-full object-cover opacity-80" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ShoppingBag className="h-12 w-12 text-white/20" />
                      </div>
                    )}
                    <div className="absolute top-4 right-4">
                      <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${store.store_settings?.is_open ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/30' : 'bg-gray-500 text-white'}`}>
                        {store.store_settings?.is_open ? 'Aberto' : 'Fechado'}
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-6 flex-1 flex flex-col">
                    <div className="flex items-start justify-between mb-2">
                       <h2 className="text-xl font-bold uppercase tracking-tight italic text-gray-900 group-hover:text-primary transition-colors">
                        {store.name}
                      </h2>
                    </div>
                    
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-gray-500 text-xs font-bold uppercase tracking-widest mb-4">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-primary" />
                        {store.city || 'Cidade não informada'}
                      </div>
                      {store.store_settings?.avg_prep_time_minutes && (
                        <div className="flex items-center gap-1.5 border-l border-gray-200 pl-4">
                          {store.store_settings.avg_prep_time_minutes} min
                        </div>
                      )}
                    </div>

                    <div className="mt-auto pt-4 border-t border-gray-50 flex items-center justify-between">
                       <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                          {store.public_name ? 'Original' : 'Verificado'}
                       </p>
                      <Button variant="ghost" className="text-primary font-bold uppercase text-[10px] tracking-widest h-8 px-0 group-hover:translate-x-1 transition-transform">
                        Cardápio
                      </Button>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </main>

      <Dialog open={showAddressModal} onOpenChange={setShowAddressModal}>
        <DialogContent className="max-w-md rounded-2xl border-none p-0 overflow-hidden">
          <div className="bg-white p-8">
            <div className="flex justify-between items-center mb-6">
               <DialogTitle className="text-xl font-bold text-gray-900 italic uppercase tracking-tight">Onde você quer receber seu pedido?</DialogTitle>
            </div>
            
            <div className="space-y-6">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input 
                  value={formatCEP(tempCep)} 
                  onChange={(e) => setTempCep(e.target.value)} 
                  placeholder="Buscar endereço e número (ou CEP)"
                  className="h-14 pl-12 border-gray-100 bg-gray-50 rounded-xl font-medium focus:bg-white focus:border-primary transition-all"
                />
              </div>

              <Button 
                onClick={handleCepLookup} 
                disabled={loadingCep}
                className="w-full h-14 bg-primary hover:brightness-110 text-white font-bold uppercase tracking-widest rounded-xl shadow-lg shadow-primary/20"
              >
                {loadingCep ? <Loader2 className="h-5 w-5 animate-spin" /> : "Confirmar Localização"}
              </Button>

              <button className="w-full flex items-center justify-center gap-2 text-primary font-bold text-sm uppercase tracking-widest hover:underline">
                 <MapPin className="h-4 w-4" />
                 Usar minha localização atual
              </button>

              {!user && (
                <div className="pt-6 border-t border-gray-100 text-center">
                   <p className="text-sm text-gray-500 font-medium mb-4 text-balance">
                      Entre para ver seus endereços salvos e pedir mais rápido.
                   </p>
                   <Button variant="outline" className="w-full h-12 font-bold uppercase tracking-widest rounded-xl border-gray-200" onClick={() => navigate("/entrar")}>
                      Entrar ou Cadastrar
                   </Button>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Footer />
    </div>
  );
}
