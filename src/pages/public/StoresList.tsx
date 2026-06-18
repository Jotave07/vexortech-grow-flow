import { useCallback, useEffect, useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search, MapPin, ShoppingBag, User, ChevronDown, Filter, Utensils, ShoppingBasket, Wine, Pill, Tag, Star, LocateFixed, Clock, Heart, ShieldCheck, ChevronRight } from "lucide-react";
import { Footer } from "@/components/landing/Footer";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchAddressByCep, fetchAddressFromCurrentLocation } from "@/services/viacep";
import { toast } from "sonner";
import { onlyDigits, formatCEP, formatBRL } from "@/lib/format";
import { BrandMark } from "@/components/BrandMark";
import { useAuth } from "@/contexts/AuthContext";
import { useCart } from "@/contexts/CartContext";
import { detectStoreSegment, getSegmentCover } from "@/lib/store-segments";
import { isStoreOpen } from "@/lib/opening-hours";
import { getStoreProfileVerification } from "@/lib/profile-verification";
import { normalizeHexColor } from "@/lib/store-theme";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

const normalizeCategoryName = (value: string) =>
  value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const numberValue = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getDeliveryFeeLabel = (store: any) => {
  const settings = store.store_settings;
  const fee = numberValue(settings?.delivery_base_fee ?? settings?.delivery_fee ?? store.delivery_fee);
  return fee > 0 ? formatBRL(fee) : "Gratis";
};

const getMinOrderLabel = (store: any) => {
  const value = numberValue(store.store_settings?.min_order_value ?? store.min_order_amount);
  return value > 0 ? `Min. ${formatBRL(value)}` : "Sem minimo";
};

const getPrepRangeLabel = (store: any) => {
  const minutes = numberValue(store.store_settings?.avg_prep_time_minutes) || 30;
  const min = Math.max(10, minutes - 10);
  const max = minutes + 10;
  return `${min}-${max} min`;
};

const getStoreRating = (store: any) => ({
  rating: numberValue(store.rating) || 4.8,
  count: numberValue(store.reviews_count),
});

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
      const { data } = await backend
        .from("stores")
        .select(`
          *,
          store_settings(is_open, business_hours, avg_prep_time_minutes, min_order_value, delivery_radius_km, delivery_base_fee, delivery_fee_per_km)
        `)
        .eq("is_active", true)
        .eq("is_suspended", false);
      
      const loadedStores = data || [];
      const storeIds = loadedStores.map((store: any) => store.id).filter(Boolean);
      let categoryMap = new Map<string, string[]>();
      let ratingMap = new Map<string, { sum: number; reviewsCount: number }>();

      if (storeIds.length > 0) {
        const [{ data: menuCategories }, { data: reviews }] = await Promise.all([
          backend
            .from("categories")
            .select("store_id, name")
            .in("store_id", storeIds)
            .eq("is_active", true),
          backend
            .from("store_reviews")
            .select("store_id, rating")
            .in("store_id", storeIds),
        ]);

        categoryMap = (menuCategories || []).reduce((map: Map<string, string[]>, category: any) => {
          const current = map.get(category.store_id) || [];
          map.set(category.store_id, [...current, category.name]);
          return map;
        }, new Map<string, string[]>());

        ratingMap = (reviews || []).reduce((map: Map<string, { sum: number; reviewsCount: number }>, review: any) => {
          const current = map.get(review.store_id) || { sum: 0, reviewsCount: 0 };
          map.set(review.store_id, {
            sum: current.sum + Number(review.rating || 0),
            reviewsCount: current.reviewsCount + 1,
          });
          return map;
        }, new Map<string, { sum: number; reviewsCount: number }>());
      }

      setStores(loadedStores.map((store: any) => {
        const settings = Array.isArray(store.store_settings) ? store.store_settings[0] : store.store_settings;
        const menuCategories = categoryMap.get(store.id) || [];
        const rating = ratingMap.get(store.id);
        const verification = getStoreProfileVerification(store, settings);
        return {
          ...store,
          store_settings: settings,
          menu_categories: menuCategories,
          delivery_kind: detectStoreSegment(store, menuCategories),
          store_is_open: settings ? isStoreOpen(settings.business_hours, settings.is_open) : false,
          rating: rating?.reviewsCount ? Number((rating.sum / rating.reviewsCount).toFixed(1)) : 4.8,
          reviews_count: rating?.reviewsCount ?? 0,
          profile_verification: verification,
        };
      }));
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
      if (a.store_is_open && !b.store_is_open) return -1;
      if (!a.store_is_open && b.store_is_open) return 1;
      return 0;
    });
  }, [stores, search, activeCategory]);

  // Destaques: lojas abertas com melhor avaliação (apresentação derivada da mesma fonte de dados)
  const featuredStores = useMemo(() => {
    return [...stores]
      .sort((a, b) => {
        if (a.store_is_open && !b.store_is_open) return -1;
        if (!a.store_is_open && b.store_is_open) return 1;
        return numberValue(b.rating) - numberValue(a.rating);
      })
      .slice(0, 8);
  }, [stores]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-[var(--hype-bg,#f6f7f2)] bg-muted/20">
      <div className="hidden">
        {/* SEO Metadata */}
        <title>Marketplace | Hype Delivery</title>
        <meta name="description" content="Encontre restaurantes, explore opções disponíveis e faça seu pedido de forma simples pela Hype Delivery." />
      </div>

      {/* Header Desktop */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border bg-background/95 shadow-sm backdrop-blur-xl">
        <div className="container mx-auto px-4 h-20 flex items-center justify-between gap-4">
          <div className="flex items-center gap-8 shrink-0">
            <BrandMark to="/" className="scale-90" />

            <nav className="hidden lg:flex items-center gap-6">
              <button
                onClick={() => navigate("/")}
                className={cn(
                  "text-sm font-bold uppercase tracking-widest transition-colors",
                  activeCategory === "Início" ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Início
              </button>
              <button
                onClick={() => setActiveCategory("Restaurantes")}
                className={cn(
                  "text-sm font-bold uppercase tracking-widest transition-colors",
                  activeCategory === "Restaurantes" ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Restaurantes
              </button>
              <button
                onClick={() => setActiveCategory("Mercados")}
                className={cn(
                  "text-sm font-bold uppercase tracking-widest transition-colors",
                  activeCategory === "Mercados" ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Mercados
              </button>
            </nav>
          </div>

          <div className="flex-1 max-w-2xl hidden md:flex items-center gap-4 bg-background px-4 h-12 rounded-none border border-border focus-within:border-primary/45 transition-all">
            <Search className="h-5 w-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Busque por restaurante, item ou categoria"
              className="flex-1 bg-transparent border-none focus:ring-0 text-sm font-medium outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2 lg:gap-4 shrink-0">
            <button
              onClick={() => setShowAddressModal(true)}
              className="hidden sm:flex items-center gap-2 px-3 h-12 hover:bg-muted rounded-none transition-colors group"
            >
              <MapPin className="h-5 w-5 text-primary" />
              <div className="text-left hidden lg:block">
                <p className="text-[10px] uppercase font-bold text-muted-foreground leading-none mb-0.5">Entregar em</p>
                <p className="text-sm font-bold text-foreground leading-none truncate max-w-[150px]">
                  {address ? `${address.neighborhood}, ${address.city}` : "Escolha um endereço"}
                </p>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
            </button>

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="flex items-center gap-2 p-2 hover:bg-muted rounded-none transition-colors">
                    <div className="h-9 w-9 bg-muted rounded-none flex items-center justify-center border border-border">
                      <User className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56 mt-2">
                  <DropdownMenuLabel>
                    <p className="text-sm font-bold truncate">{profile?.full_name || user.email}</p>
                    <p className="text-xs text-muted-foreground uppercase tracking-widest font-bold mt-1">
                      {profile?.role === 'store_owner' ? 'Lojista' : 'Cliente'}
                    </p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate(profile?.role === 'store_owner' ? "/lojista" : "/cliente")}>
                    Minha Conta
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:text-destructive">
                    Sair
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <button
                onClick={() => navigate("/entrar")}
                className="text-sm font-bold text-primary hover:bg-primary/5 px-4 h-12 rounded-none transition-colors"
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
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 h-12 rounded-none hover:brightness-110 transition-all shadow-lg shadow-primary/20"
            >
              <div className="relative">
                <ShoppingBag className="h-5 w-5" />
                {count > 0 && (
                  <span className="absolute -top-2 -right-2 bg-foreground text-background text-[10px] font-bold h-4 w-4 flex items-center justify-center rounded-none border-2 border-primary">
                    {count}
                  </span>
                )}
              </div>
              <div className="hidden sm:block text-left">
                <p className="text-[10px] uppercase font-bold text-primary-foreground/60 leading-none mb-0.5">Carrinho</p>
                <p className="text-sm font-bold leading-none">{formatBRL(subtotal)}</p>
              </div>
            </button>
          </div>
        </div>

        {/* Categories Bar */}
        <div className="bg-background border-t border-border overflow-hidden">
          <div className="container mx-auto px-4 overflow-x-auto no-scrollbar flex items-center gap-3 py-3">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const active = activeCategory === cat.name;
              return (
                <button
                  key={cat.name}
                  onClick={() => setActiveCategory(cat.name)}
                  className={cn(
                    "flex items-center gap-2 whitespace-nowrap border rounded-none px-4 py-2 transition-all",
                    active
                      ? "bg-primary border-primary text-primary-foreground font-bold"
                      : "bg-background border-border text-muted-foreground hover:border-primary/30 font-medium"
                  )}
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
      <header className="md:hidden fixed top-0 left-0 right-0 z-50 bg-background border-b border-border px-4 py-2">
         <div className="flex items-center justify-between mb-2">
            <BrandMark to="/" className="scale-75 origin-left" />
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddressModal(true)}
                className="flex items-center gap-1 text-xs font-bold text-muted-foreground"
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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Busque por restaurante ou item"
              className="w-full bg-muted border-none rounded-none py-2 pl-9 text-sm outline-none"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
         </div>
      </header>

      <main className="pt-32 md:pt-44 pb-20">
        {/* Hero — banner editável com busca proeminente */}
        <section className="container mx-auto px-4">
          <HeroBanner address={address} search={search} onSearch={setSearch} onOpenAddress={() => setShowAddressModal(true)} />
        </section>

        {/* Faixa de categorias em círculos */}
        <section className="container mx-auto px-4 mt-8 md:mt-10">
          <SectionTitle title="Categorias" hint="Explore por tipo" />
          <div className="overflow-x-auto no-scrollbar -mx-4 px-4">
            <div className="flex items-start gap-4 md:gap-5 pb-2">
              {categories.map((cat) => {
                const Icon = cat.icon;
                const active = activeCategory === cat.name;
                return (
                  <button
                    key={cat.name}
                    onClick={() => setActiveCategory(cat.name)}
                    className="group flex w-[68px] shrink-0 flex-col items-center gap-2 text-center"
                  >
                    <span
                      className={cn(
                        "flex h-16 w-16 items-center justify-center rounded-none border transition-all",
                        active
                          ? "border-primary bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                          : "border-border bg-background text-foreground group-hover:border-primary/40 group-hover:-translate-y-0.5"
                      )}
                    >
                      <Icon className="h-6 w-6" />
                    </span>
                    <span className={cn(
                      "text-[11px] font-bold uppercase tracking-wider leading-tight",
                      active ? "text-foreground" : "text-muted-foreground"
                    )}>
                      {cat.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {/* Destaques / Ofertas — scroll horizontal */}
        {!loading && featuredStores.length > 0 && (
          <section className="container mx-auto px-4 mt-10 md:mt-12">
            <SectionTitle
              title="Destaques e ofertas"
              hint="Selecionados para você"
              action={
                <button
                  onClick={() => setActiveCategory("Promoções")}
                  className="inline-flex items-center gap-1 text-xs font-black uppercase tracking-widest text-foreground hover:text-primary"
                >
                  Ver promoções <ChevronRight className="h-3.5 w-3.5" />
                </button>
              }
            />
            <div className="overflow-x-auto no-scrollbar -mx-4 px-4">
              <div className="flex gap-4 pb-2">
                {featuredStores.map((store) => (
                  <FeaturedCard key={store.id} store={store} />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Grade de parceiros */}
        <section className="container mx-auto px-4 mt-12 md:mt-14">
          <div className="flex items-end justify-between mb-6">
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-primary">Parceiros</p>
              <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tight text-foreground">
                {activeCategory}
              </h2>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-muted-foreground uppercase tracking-widest">{filteredStores.length} Lojas</span>
              <Button variant="outline" size="sm" className="hidden md:flex gap-2 font-bold uppercase text-[10px] tracking-widest h-9 rounded-none">
                <Filter className="h-3 w-3" /> Filtros
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="h-44 animate-pulse rounded-none border border-border bg-background" />
              ))}
            </div>
          ) : filteredStores.length === 0 ? (
            <div className="text-center py-24 bg-muted/40 rounded-none border-2 border-dashed border-border">
              <ShoppingBag className="h-16 w-16 mx-auto text-muted-foreground/40 mb-4" />
              <h3 className="text-xl font-black uppercase text-foreground tracking-tight">Nenhum restaurante encontrado</h3>
              <p className="text-muted-foreground font-medium">Tente ajustar sua busca ou mudar sua localização.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredStores.map((store, index) => (
                <PartnerCard key={store.id} store={store} index={index} />
              ))}
            </div>
          )}
        </section>
      </main>

      <Dialog open={showAddressModal} onOpenChange={setShowAddressModal}>
        <DialogContent className="max-w-md rounded-none border-none p-0 overflow-hidden">
          <div className="bg-background p-8">
            <DialogHeader className="mb-6 text-left">
               <DialogTitle className="text-xl font-black text-foreground uppercase tracking-tight">Onde você quer receber seu pedido?</DialogTitle>
               <DialogDescription className="text-sm font-medium text-muted-foreground text-balance">
                 Informe um CEP ou use sua localização para encontrar parceiros próximos.
               </DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  value={formatCEP(tempCep)}
                  onChange={(e) => setTempCep(e.target.value)}
                  placeholder="Buscar endereço e número (ou CEP)"
                  className="h-14 pl-12 border-border bg-muted/40 rounded-none font-medium focus:bg-background focus:border-primary transition-all"
                />
              </div>

              <Button
                onClick={() => void handleCepLookup()}
                disabled={loadingCep}
                className="w-full h-14 bg-primary hover:brightness-110 text-primary-foreground font-bold uppercase tracking-widest"
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
                <div className="pt-6 border-t border-border text-center">
                   <p className="text-sm text-muted-foreground font-medium mb-4 text-balance">
                      Entre para ver seus endereços salvos e pedir mais rápido.
                   </p>
                   <Button variant="outline" className="w-full h-12 font-bold uppercase tracking-widest rounded-none border-border" onClick={() => navigate("/entrar")}>
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

/* ---------- Subcomponentes de apresentação (inline) ---------- */

const SectionTitle = ({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) => (
  <div className="mb-4 flex items-end justify-between gap-4">
    <div>
      {hint && <p className="text-[11px] font-black uppercase tracking-widest text-primary">{hint}</p>}
      <h2 className="text-xl md:text-2xl font-black uppercase tracking-tight text-foreground">{title}</h2>
    </div>
    {action}
  </div>
);

const HeroBanner = ({
  address,
  search,
  onSearch,
  onOpenAddress,
}: {
  address: any;
  search: string;
  onSearch: (value: string) => void;
  onOpenAddress: () => void;
}) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4 }}
    className="relative overflow-hidden rounded-none border border-primary/20 bg-[var(--hype-dark,#080808)] bg-foreground text-background shadow-elegant"
  >
    {/* Imagem editável (placeholder se vazia) + glow verde */}
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute -right-24 -top-24 h-72 w-72 rounded-none bg-primary/25 blur-3xl" />
      <div className="absolute -bottom-24 -left-10 h-64 w-64 rounded-none bg-primary/10 blur-3xl" />
    </div>
    <div className="relative grid gap-6 p-6 md:grid-cols-[1fr_auto] md:items-center md:p-10">
      <div className="max-w-xl">
        <span className="inline-flex items-center gap-2 rounded-none bg-primary/20 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-primary">
          <ShoppingBag className="h-3.5 w-3.5" /> Hype Delivery
        </span>
        <h1 className="mt-4 text-3xl font-black uppercase leading-tight tracking-tight md:text-4xl">
          Peça do seu jeito, <span className="text-primary">chega voando</span>
        </h1>
        <p className="mt-3 text-sm font-medium text-background/70 md:text-base">
          Restaurantes, mercados e muito mais perto de você. Escolha, peça e acompanhe em tempo real.
        </p>

        {/* Busca proeminente */}
        <div className="mt-6 flex items-center gap-3 rounded-none border border-background/15 bg-background px-4 h-14 text-foreground">
          <Search className="h-5 w-5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="O que você quer comer hoje?"
            className="flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-muted-foreground"
          />
          <Button
            type="button"
            className="hidden sm:inline-flex h-9 rounded-none bg-primary px-5 font-black uppercase tracking-widest text-xs text-primary-foreground hover:brightness-110"
          >
            Buscar
          </Button>
        </div>

        <button
          onClick={onOpenAddress}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-background/70 hover:text-primary transition-colors"
        >
          <MapPin className="h-3.5 w-3.5 text-primary" />
          {address ? `${address.neighborhood}, ${address.city}` : "Definir endereço de entrega"}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Bloco visual editável (placeholder) */}
      <div className="hidden md:block">
        <div className="flex h-44 w-72 items-center justify-center rounded-none border border-background/15 bg-background/5 text-background/40">
          <div className="text-center">
            <ShoppingBag className="mx-auto h-10 w-10 text-primary" />
            <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-background/50">Banner em destaque</p>
          </div>
        </div>
      </div>
    </div>
  </motion.div>
);

const FeaturedCard = ({ store }: { store: any }) => {
  const accent = normalizeHexColor(store.primary_color, "#b6ff00");
  const cover = store.cover_url || store.logo_url || getSegmentCover(store.delivery_kind);
  const rating = getStoreRating(store);
  return (
    <Link to={`/loja/${store.slug}`} className="group block w-56 shrink-0 sm:w-64">
      <Card className="overflow-hidden rounded-none border border-border bg-card p-0 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary hover:shadow-lg">
        <div className="relative h-32 overflow-hidden bg-muted">
          {cover ? (
            <img src={cover} alt={store.public_name || store.name} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-muted text-primary">
              <ShoppingBag className="h-8 w-8" />
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent" />
          {/* Badge promo (pink) */}
          <span className="absolute left-3 top-3 rounded-none bg-[#ff2d55] px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white shadow-sm">
            Oferta
          </span>
          <span className={cn(
            "absolute right-3 top-3 rounded-none px-2.5 py-1 text-[10px] font-black uppercase tracking-widest",
            store.store_is_open ? "bg-primary text-primary-foreground" : "bg-stone-700 text-white"
          )}>
            {store.store_is_open ? "Aberto" : "Fechado"}
          </span>
          <div
            className="absolute -bottom-5 left-3 h-12 w-12 overflow-hidden rounded-none border-4 border-card bg-card shadow-md"
            style={{ borderColor: accent }}
          >
            {store.logo_url ? (
              <img src={store.logo_url} alt={store.public_name || store.name} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-muted text-primary">
                <ShoppingBag className="h-5 w-5" />
              </div>
            )}
          </div>
        </div>
        <div className="p-4 pt-7">
          <h3 className="truncate text-sm font-black uppercase tracking-tight text-foreground group-hover:text-primary transition-colors">
            {store.public_name || store.name}
          </h3>
          <p className="mt-0.5 truncate text-xs font-medium text-muted-foreground">{store.delivery_kind}</p>
          <div className="mt-2 flex items-center justify-between text-xs font-bold">
            <span className="inline-flex items-center gap-1 text-foreground">
              <Star className="h-3.5 w-3.5 fill-[#ffc857] text-[#ffc857]" />
              {rating.rating.toFixed(1)}
            </span>
            <span className={getDeliveryFeeLabel(store) === "Gratis" ? "text-emerald-600" : "text-muted-foreground"}>
              Entrega {getDeliveryFeeLabel(store)}
            </span>
          </div>
        </div>
      </Card>
    </Link>
  );
};

const PartnerCard = ({ store, index }: { store: any; index: number }) => {
  const rating = getStoreRating(store);
  const verification = store.profile_verification || getStoreProfileVerification(store, store.store_settings);
  const accent = normalizeHexColor(store.primary_color, "#b6ff00");
  const logo = store.logo_url || store.cover_url || getSegmentCover(store.delivery_kind);
  const verified = verification.status === "verified" || verification.status === "complete";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.3) }}
    >
      <Link to={`/loja/${store.slug}`} className="group block h-full">
        <Card className="flex h-full flex-col gap-4 rounded-none border border-border bg-card p-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary hover:shadow-lg">
          <div className="flex items-start gap-4">
            {/* Logo padronizado */}
            <div
              className="h-16 w-16 shrink-0 overflow-hidden rounded-none border bg-background shadow-sm"
              style={{ borderColor: accent }}
            >
              {logo ? (
                <img src={logo} alt={store.public_name || store.name} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted text-primary">
                  <ShoppingBag className="h-6 w-6" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h2 className="min-w-0 truncate text-base font-black uppercase tracking-tight text-foreground transition-colors group-hover:text-primary">
                  {store.public_name || store.name}
                </h2>
                <span className={cn(
                  "shrink-0 rounded-none px-2.5 py-1 text-[10px] font-black uppercase tracking-widest",
                  store.store_is_open ? "bg-primary/15 text-foreground" : "bg-muted text-muted-foreground"
                )}>
                  {store.store_is_open ? "Aberto" : "Fechado"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="rounded-none bg-muted px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {store.delivery_kind}
                </span>
                {verified && (
                  <span className="inline-flex items-center gap-1 rounded-none bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-foreground">
                    <ShieldCheck className="h-3 w-3 text-primary" />
                    {verification.label}
                  </span>
                )}
              </div>
            </div>
          </div>

          {store.description && (
            <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{store.description}</p>
          )}

          {/* Metadados: avaliação, tempo, taxa */}
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border pt-3 text-xs font-bold text-foreground">
            <span className="inline-flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-[#ffc857] text-[#ffc857]" />
              {rating.rating.toFixed(1)}
              <span className="font-medium text-muted-foreground">{rating.count ? `(${rating.count})` : "Novo"}</span>
            </span>
            <span className="text-border">•</span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3.5 w-3.5 text-primary" />
              {getPrepRangeLabel(store)}
            </span>
            <span className="text-border">•</span>
            <span className={getDeliveryFeeLabel(store) === "Gratis" ? "text-emerald-600" : "text-muted-foreground"}>
              {getDeliveryFeeLabel(store)}
            </span>
            <span className="ml-auto inline-flex items-center gap-1 text-foreground group-hover:text-primary">
              Ver cardápio <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
        </Card>
      </Link>
    </motion.div>
  );
};
