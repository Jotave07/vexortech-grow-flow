import { useCallback, useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, MapPin, ShoppingBag, User, ChevronDown, Filter, Utensils, ShoppingBasket, Wine, Pill, Tag, Star, LocateFixed, Clock } from "lucide-react";
import { Footer } from "@/components/landing/Footer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchAddressByCep, fetchAddressFromCurrentLocation } from "@/services/viacep";
import { toast } from "sonner";
import { onlyDigits, formatCEP, formatBRL } from "@/lib/format";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import { detectStoreSegment, getSegmentCover } from "@/lib/store-segments";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

const normalizeCategoryName = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default function StoresList() {
  const [stores, setStores] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [address, setAddress] = useState<any>(null);
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [tempCep, setTempCep] = useState("");
  const [loadingCep, setLoadingCep] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [lastResolvedCep, setLastResolvedCep] = useState("");
  const [activeCategory, setActiveCategory] = useState("Todos");

  const { user, profile, signOut } = useAuth();
  const { count, subtotal } = useCart();
  const navigate = useNavigate();

  const categories = [
    { name: "Todos", icon: ShoppingBag },
    { name: "Restaurantes", icon: Utensils },
    { name: "Açaí", icon: Star },
    { name: "Pizza", icon: Utensils },
    { name: "Lanches", icon: ShoppingBag },
    { name: "Mercados", icon: ShoppingBasket },
    { name: "Bebidas", icon: Wine },
    { name: "Farmácia", icon: Pill },
    { name: "Promoções", icon: Tag },
    { name: "Mais pedidos", icon: Star },
  ];

  useEffect(() => {
    const saved = localStorage.getItem("delivery_address");
    if (saved) {
      setAddress(JSON.parse(saved));
    } else {
      setShowAddressModal(true);
    }
  }, []);

  const saveAddress = useCallback((addr: any, cleanCep?: string) => {
    const fullAddr = { ...addr, zipCode: cleanCep || onlyDigits(addr.cep || addr.zipCode || "") };
    setAddress(fullAddr);
    localStorage.setItem("delivery_address", JSON.stringify(fullAddr));
    setShowAddressModal(false);
  }, []);

  const handleCepLookup = useCallback(async (cepOverride?: string, silent = false) => {
    const cleanCep = onlyDigits(cepOverride ?? tempCep);
    if (cleanCep.length !== 8) return toast.error("CEP inválido");
    setLoadingCep(true);
    try {
      const addr = await fetchAddressByCep(cleanCep);
      saveAddress(addr, cleanCep);
      setTempCep(cleanCep);
      setLastResolvedCep(cleanCep);
      if (!silent) toast.success("Endereço definido!");
    } catch (e: any) {
      toast.error(e.message || "Erro ao buscar CEP");
    } finally {
      setLoadingCep(false);
    }
  }, [saveAddress, tempCep]);

  useEffect(() => {
    const cleanCep = onlyDigits(tempCep);
    if (cleanCep.length !== 8 || cleanCep === lastResolvedCep) return;
    const timer = window.setTimeout(() => {
      void handleCepLookup(cleanCep, true);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [handleCepLookup, lastResolvedCep, tempCep]);

  const handleCurrentLocation = async () => {
    setLoadingLocation(true);
    try {
      const addr = await fetchAddressFromCurrentLocation();
      saveAddress(addr, onlyDigits(addr.cep));
      setTempCep(onlyDigits(addr.cep));
      toast.success("Localização definida automaticamente.");
    } catch (e: any) {
      toast.error(e.message || "Não foi possível usar sua localização.");
    } finally {
      setLoadingLocation(false);
    }
  };

  useEffect(() => {
    async function loadStores() {
      const { data } = await supabase
        .from("stores")
        .select(`
          *,
          store_settings(is_open, business_hours, avg_prep_time_minutes, min_order_value, delivery_radius_km, delivery_base_fee, delivery_fee_per_km)
        `)
        .eq("is_active", true)
        .eq("is_suspended", false);
      
      const loadedStores = data || [];
      const storeIds = loadedStores.map((store) => store.id).filter(Boolean);
      let categoryMap = new Map<string, string[]>();

      if (storeIds.length > 0) {
        const { data: menuCategories } = await supabase
          .from("categories")
          .select("store_id, name")
          .in("store_id", storeIds)
          .eq("is_active", true);

        categoryMap = (menuCategories || []).reduce((map, category: any) => {
          const current = map.get(category.store_id) || [];
          map.set(category.store_id, [...current, category.name]);
          return map;
        }, new Map<string, string[]>());
      }

      setStores(loadedStores.map((store) => ({
        ...store,
        menu_categories: categoryMap.get(store.id) || [],
        delivery_kind: detectStoreSegment(store, categoryMap.get(store.id) || []),
      })));
      setLoading(false);
    }
    loadStores();
  }, []);

  const filteredStores = useMemo(() => {
    return stores.filter(s => {
      const searchable = [
        s.name,
        s.public_name,
        s.description,
        s.city,
        s.delivery_kind,
        ...(s.menu_categories || []),
      ].filter(Boolean).join(" ").toLowerCase();
      const matchesSearch = searchable.includes(search.toLowerCase());
      const matchesCategory =
        activeCategory === "Todos" ||
        activeCategory === "Mais pedidos" ||
        activeCategory === "Promoções" ||
        normalizeCategoryName(s.delivery_kind) === normalizeCategoryName(activeCategory);
      
      return matchesSearch && matchesCategory;
    }).sort((a, b) => {
      if (a.store_settings?.is_open && !b.store_settings?.is_open) return -1;
      if (!a.store_settings?.is_open && b.store_settings?.is_open) return 1;
      return 0;
    });
  }, [stores, search, activeCategory]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-[#f6f7f2]">
      <div className="hidden">
        {/* SEO Metadata */}
        <title>Marketplace | Hype Delivery</title>
        <meta name="description" content="Encontre restaurantes, explore opções disponíveis e faça seu pedido de forma simples pela Hype Delivery." />
      </div>
      {/* Header Desktop */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#ffffff]/95 border-b border-[#e6e8de] shadow-sm backdrop-blur-xl">
        <div className="container mx-auto px-4 h-20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-8 shrink-0">
            <BrandMark to="/" className="scale-90" />
            
            <nav className="hidden lg:flex items-center gap-6">
              <button 
                onClick={() => navigate("/")}
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

          <div className="flex-1 max-w-2xl hidden md:flex items-center gap-4 bg-white px-4 h-12 rounded-xl border border-[#e6e8de] focus-within:border-primary/45 transition-all">
            <Search className="h-5 w-5 text-stone-400" />
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
              className="hidden sm:flex items-center gap-2 px-3 h-12 hover:bg-gray-50 rounded-xl transition-colors group"
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
                  <button className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded-xl transition-colors">
                    <div className="h-9 w-9 bg-gray-100 rounded-xl flex items-center justify-center border border-gray-200">
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
                className="text-sm font-bold text-primary hover:bg-primary/5 px-4 h-12 rounded-xl transition-colors"
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
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 h-12 rounded-xl hover:brightness-110 transition-all shadow-lg shadow-primary/20"
            >
              <div className="relative">
                <ShoppingBag className="h-5 w-5" />
                {count > 0 && (
                  <span className="absolute -top-2 -right-2 bg-slate-900 text-white text-[10px] font-bold h-4 w-4 flex items-center justify-center rounded-xl border-2 border-primary">
                    {count}
                  </span>
                )}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-[10px] uppercase font-bold text-black/60 leading-none mb-0.5">Carrinho</p>
                <p className="text-sm font-bold leading-none">{formatBRL(subtotal)}</p>
              </div>
            </button>
          </div>
        </div>

        {/* Categories Bar */}
        <div className="bg-[#ffffff] border-t border-[#e6e8de] overflow-hidden">
          <div className="container mx-auto px-4 overflow-x-auto no-scrollbar flex items-center gap-4 py-3">
            {categories.map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.name}
                  onClick={() => setActiveCategory(cat.name)}
                  className={`flex items-center gap-2 whitespace-nowrap border px-4 py-2 transition-all ${
                    activeCategory === cat.name
                      ? "bg-primary border-primary text-primary-foreground font-bold"
                      : "bg-white border-[#e6e8de] text-stone-600 hover:border-primary/30 font-medium"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="text-sm uppercase tracking-wider">{cat.name}</span>
                </button>
              );
            })}
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
              className="w-full bg-gray-100 border-none rounded-xl py-2 pl-9 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
         </div>
      </header>
      
      <main className="container mx-auto px-4 pt-36 md:pt-44 pb-20">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-stone-950 tracking-tight">
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
              <div key={i} className="animate-pulse bg-white rounded-2xl h-[260px] border border-[#e6e8de]" />
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
                <Card className="overflow-hidden border border-[#e6e8de] shadow-sm group-hover:shadow-lg group-hover:-translate-y-1 transition-all duration-300 rounded-2xl bg-white h-full flex flex-col">
                  <div className="h-32 bg-stone-900 relative">
                    <img src={store.cover_url || getSegmentCover(store.delivery_kind)} alt={store.name} className="w-full h-full object-cover opacity-90" />
                    <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent" />
                    <div className="absolute top-3 right-3">
                      <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${store.store_settings?.is_open ? 'bg-primary text-primary-foreground shadow-panel' : 'bg-stone-600 text-white'}`}>
                        {store.store_settings?.is_open ? 'Aberto' : 'Fechado'}
                      </div>
                    </div>
                    <div className="absolute left-4 -bottom-8 flex items-end gap-3">
                      <div className="h-16 w-16 overflow-hidden rounded-2xl border-4 border-white bg-white shadow-md">
                        {store.logo_url ? (
                          <img src={store.logo_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-[#f6f7f2] text-primary">
                            <ShoppingBag className="h-6 w-6" />
                          </div>
                        )}
                      </div>
                      <div className="mb-1 rounded-full bg-white/95 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-stone-700 shadow-sm">
                        {store.delivery_kind}
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-5 pt-11 flex-1 flex flex-col">
                    <div className="flex items-start justify-between mb-2">
                       <h2 className="text-lg font-bold tracking-tight text-stone-950 group-hover:text-primary transition-colors">
                        {store.public_name || store.name}
                      </h2>
                    </div>
                    {store.description && (
                      <p className="line-clamp-2 text-sm leading-relaxed text-stone-500 mb-4">{store.description}</p>
                    )}
                    
                    <div className="grid grid-cols-2 gap-2 text-stone-600 text-xs font-bold mb-4">
                      <div className="flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-primary" />
                        {store.city || 'Cidade não informada'}
                      </div>
                      {store.store_settings?.avg_prep_time_minutes && (
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-primary" />
                          {store.store_settings.avg_prep_time_minutes} min
                        </div>
                      )}
                    </div>

                    <div className="mt-auto pt-4 border-t border-[#e6e8de] flex items-center justify-between gap-3">
                       <p className="text-xs font-bold text-stone-400 uppercase tracking-widest">
                          {store.store_settings?.delivery_radius_km ? `Raio ${store.store_settings.delivery_radius_km} km` : 'Cardápio online'}
                       </p>
                      <Button variant="ghost" className="text-primary font-bold text-xs h-8 px-0 group-hover:translate-x-1 transition-transform">
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
        <DialogContent className="max-w-md rounded-xl border-none p-0 overflow-hidden">
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
                onClick={() => void handleCepLookup()}
                disabled={loadingCep}
                className="w-full h-14 bg-primary hover:brightness-110 text-primary-foreground font-bold uppercase tracking-widest shadow-panel"
              >
                {loadingCep ? <Loader2 className="h-5 w-5 animate-spin" /> : "Confirmar localização"}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full h-12 text-primary font-bold text-sm uppercase tracking-widest"
                onClick={handleCurrentLocation}
                disabled={loadingLocation}
              >
                {loadingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                Usar localização atual
              </Button>

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


