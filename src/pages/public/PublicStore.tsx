import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import { Loader2, MapPin, Clock, ShoppingBag, Search, User, LogOut, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format";
import { ProductDialog } from "@/components/public/ProductDialog";
import { CartDrawer } from "@/components/public/CartDrawer";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/AuthContext";
import { isStoreOpen } from "@/lib/opening-hours";
import { toast } from "sonner";
import { detectStoreSegment, getSegmentCover } from "@/lib/store-segments";
import { getStoreProfileVerification } from "@/lib/profile-verification";
import { getStoreThemeStyle } from "@/lib/store-theme";

const PublicStore = () => {
  const { slug } = useParams<{ slug: string }>();
  const { setStoreSlug, count, subtotal } = useCart();
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();
  const [store, setStore] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  useEffect(() => {
    if (slug) setStoreSlug(slug);
  }, [slug, setStoreSlug]);

  useEffect(() => {
    if (!slug) return;

    (async () => {
      setLoading(true);
      const { data: storeData } = await backend.from("stores").select("*").eq("slug", slug).maybeSingle();
      if (!storeData) {
        setLoading(false);
        return;
      }

      setStore(storeData);
      const [settingsRes, categoryRes, productRes] = await Promise.all([
        backend.from("store_settings").select("*").eq("store_id", storeData.id).maybeSingle(),
        backend.from("categories").select("*").eq("store_id", storeData.id).eq("is_active", true).order("sort_order"),
        backend.from("products").select("*").eq("store_id", storeData.id).eq("is_active", true).order("sort_order"),
      ]);

      setSettings(settingsRes.data);
      setCategories(categoryRes.data ?? []);
      setProducts(productRes.data ?? []);
      setLoading(false);
    })();
  }, [slug]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const matchesSearch =
        !query ||
        String(product.name ?? "").toLowerCase().includes(query) ||
        String(product.description ?? "").toLowerCase().includes(query);
      const matchesCategory = activeCategory === "all" || product.category_id === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [activeCategory, products, search]);

  const sections = useMemo(() => {
    const categoryIds = new Set(categories.map((category) => category.id));
    const categorySections = categories
      .map((category) => ({
        ...category,
        items: filteredProducts.filter((product) => product.category_id === category.id),
      }))
      .filter((category) => category.items.length > 0);
    const uncategorizedProducts = filteredProducts.filter((product) => !product.category_id || !categoryIds.has(product.category_id));
    return uncategorizedProducts.length
      ? [...categorySections, { id: "uncategorized", name: "Outros", items: uncategorizedProducts }]
      : categorySections;
  }, [categories, filteredProducts]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!store) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loja não encontrada</div>;
  }

  const isOpen = settings ? isStoreOpen(settings.business_hours, settings.is_open) : false;
  const isSuspended = store.is_suspended;
  const acceptOrders = !isSuspended && (isOpen || settings?.accept_orders_when_closed);
  const publicStoreName = store.public_name || store.name;
  const storeSegment = detectStoreSegment(store, categories.map((category) => category.name));
  const coverUrl = store.cover_url || getSegmentCover(storeSegment);
  const themeStyle = getStoreThemeStyle(store);
  const verification = getStoreProfileVerification(store, settings);

  return (
    <div className="min-h-screen bg-[#f6f7f2] pb-32" style={themeStyle}>
      <header className="sticky top-0 z-40 bg-[#ffffff]/95 backdrop-blur-xl border-b border-[#e6e8de] py-3">
        <div className="container mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {store.logo_url && <img src={store.logo_url} alt={publicStoreName} loading="eager" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="h-9 w-9 rounded-none object-cover" />}
            <span className="font-black uppercase tracking-tighter text-sm italic cursor-pointer" onClick={() => navigate("/")}>{publicStoreName}</span>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" asChild className="hidden sm:flex gap-2 font-bold uppercase text-[10px] tracking-widest border border-border">
                  <Link to={profile?.role === 'super_admin' ? "/admin" : (profile?.role === 'store_owner' ? "/lojista" : "/cliente")}>
                    <User className="h-3 w-3" />
                    {profile?.role === 'store_owner' ? 'Painel Admin' : (profile?.full_name?.split(' ')[0] || 'Minha Conta')}
                  </Link>
                </Button>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={async () => {
                    await signOut();
                    toast.success("Você saiu da conta.");
                    navigate("/");
                  }}
                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/5"
                  title="Sair"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button variant="hero" size="sm" asChild className="font-black uppercase text-[10px] tracking-widest px-4">
                <Link to={`/entrar?redirect=${encodeURIComponent(window.location.pathname)}`}>
                  Entrar / Cadastrar
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-[#e6e8de] bg-[#f6f7f2]">
        <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(182,255,0,0.16),transparent_52%),linear-gradient(180deg,rgba(255,255,255,0.76),rgba(246,247,242,0.96))]" />
        <div className="container relative mx-auto px-4 pb-8 pt-6">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <Card className="overflow-hidden rounded-none border-[#e1d7c7] bg-white p-0 shadow-sm">
              <div className="relative h-40 overflow-hidden sm:h-48">
                <img src={coverUrl} alt={publicStoreName} loading="eager" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
                <Badge variant={isOpen ? "default" : "secondary"} className="absolute right-4 top-4 rounded-none px-3 py-1">
                  {isOpen ? "Aberto agora" : "Fechado"}
                </Badge>
                <div className="absolute bottom-4 left-4 rounded-none bg-white/95 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-stone-700 shadow-sm">
                  {storeSegment}
                </div>
              </div>

              <div className="grid gap-4 p-4 sm:grid-cols-[5rem_minmax(0,1fr)] sm:p-5">
                <div className="-mt-12 h-24 w-24 overflow-hidden rounded-none border-4 border-white bg-white shadow-lg sm:h-20 sm:w-20">
                  {store.logo_url ? (
                    <img src={store.logo_url} alt={publicStoreName} loading="eager" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-[#f6f7f2] text-primary">
                      <ShoppingBag className="h-7 w-7" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-bold tracking-tight text-stone-950 md:text-3xl">{publicStoreName}</h1>
                    {(verification.status === "verified" || verification.status === "complete") && (
                      <Badge className="rounded-none bg-primary/15 px-3 py-1 text-xs font-bold text-stone-900 hover:bg-primary/15">
                        <ShieldCheck className="mr-1 h-3.5 w-3.5 text-primary" />
                        {verification.label}
                      </Badge>
                    )}
                  </div>
                  {store.description && (
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                      {store.description}
                    </p>
                  )}
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-none border border-[#e6e8de] bg-[#f6f7f2] p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Região</div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-black">
                        <MapPin className="h-4 w-4 text-primary" />
                        <span>{store.city || "Cidade"}{store.state ? `/${store.state}` : ""}</span>
                      </div>
                    </div>
                    <div className="rounded-none border border-[#e6e8de] bg-[#f6f7f2] p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Preparo</div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-black">
                        <Clock className="h-4 w-4 text-primary" />
                        <span>{settings?.avg_prep_time_minutes ? `~${settings.avg_prep_time_minutes} min` : "Sob demanda"}</span>
                      </div>
                    </div>
                    <div className="rounded-none border border-[#e6e8de] bg-[#f6f7f2] p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Mínimo</div>
                      <div className="text-sm font-semibold text-black">
                        {settings?.min_order_value > 0 ? formatBRL(settings.min_order_value) : "Livre"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="rounded-none border-[#e1d7c7] bg-white p-5 shadow-sm">
              <div className="mb-4 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Cardápio</div>
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-11 rounded-none border-[#e6e8de] pl-9"
                    placeholder="Buscar no cardápio"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                  <Button
                    variant={activeCategory === "all" ? "default" : "outline"}
                    onClick={() => setActiveCategory("all")}
                    className="h-9 rounded-none px-4 text-xs font-bold uppercase tracking-widest"
                  >
                    Tudo
                  </Button>
                  {categories.map((category) => (
                    <Button
                      key={category.id}
                      variant={activeCategory === category.id ? "default" : "outline"}
                      onClick={() => setActiveCategory(category.id)}
                      className="h-9 rounded-none px-4 text-xs font-bold uppercase tracking-widest"
                    >
                      {category.name}
                    </Button>
                  ))}
                </div>
              </div>
            </Card>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 pt-8">
        {user && store.owner_user_id === user.id && (
          <div className="mb-6 border border-blue-200 bg-blue-50 p-4 text-center">
            <p className="text-sm text-blue-800 font-medium">
              Você está visualizando sua loja como <strong>Administrador</strong>.
              Para testar o fluxo de compra completo como cliente, por favor use uma conta de cliente ou <button onClick={() => signOut()} className="underline font-bold hover:text-blue-600">saia da conta</button>.
            </p>
          </div>
        )}

        {isSuspended && (
          <div className="mb-6 border-4 border-destructive bg-destructive/10 p-6 text-center text-destructive">
            <h3 className="text-xl font-black uppercase tracking-tight italic mb-2">Operação Temporariamente Suspensa</h3>
            <p className="font-bold text-sm">Esta loja não está aceitando pedidos no momento por questões administrativas.</p>
          </div>
        )}

        {!isSuspended && !acceptOrders && (
          <div className="mb-6 border border-warning/35 bg-warning/10 p-4 text-center text-sm text-warning font-bold uppercase tracking-widest">
            A loja está fechada e não está aceitando pedidos no momento.
          </div>
        )}

        <div className="space-y-8">
          {sections.length === 0 ? (
            <Card className="rounded-none border-[#e6e8de] p-10 text-center text-muted-foreground">
              {products.length === 0 ? "Cardápio em construção." : "Nenhum produto encontrado."}
            </Card>
          ) : (
            sections.map((section) => (
              <section key={section.id} className="space-y-4">
                <div className="flex items-end justify-between gap-4 border-b border-[#e6e8de] pb-3">
                  <div>
                    <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-primary">Seção do cardápio</div>
                    <h2 className="text-2xl font-bold text-stone-950">{section.name}</h2>
                  </div>
                  <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    {section.items.length} {section.items.length === 1 ? "item" : "itens"}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {section.items.map((product: any) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => acceptOrders && product.is_available && setSelectedProduct(product)}
                      disabled={!acceptOrders || !product.is_available}
                      className="h-full text-left disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <Card className="group h-full overflow-hidden rounded-none border-[#e6e8de] bg-white p-4 shadow-sm transition-smooth hover:-translate-y-1 hover:border-primary/45 hover:shadow-lg">
                        <div className="flex h-full flex-col">
                          <div className="relative mx-auto h-28 w-28 overflow-hidden rounded-none border border-[#e6e8de] bg-[#f6f7f2] p-2 shadow-sm sm:h-32 sm:w-32">
                            {product.image_url ? (
                              <img src={product.image_url} alt={product.name} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="h-full w-full rounded-none object-contain transition-smooth group-hover:scale-[1.03]" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center rounded-none bg-white text-primary">
                                <ShoppingBag className="h-8 w-8" />
                              </div>
                            )}
                            {!product.is_available && (
                              <Badge variant="destructive" className="absolute inset-x-3 bottom-1 justify-center rounded-none px-2 py-0.5 text-[10px]">
                                Esgotado
                              </Badge>
                            )}
                          </div>

                          <div className="mt-4 flex flex-1 flex-col text-center">
                            <div className="flex flex-wrap items-center justify-center gap-2">
                              <h3 className="text-lg font-semibold leading-tight text-black">{product.name}</h3>
                              {product.promo_price && (
                                <Badge className="rounded-none bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-stone-900 hover:bg-primary/15">
                                  Oferta
                                </Badge>
                              )}
                            </div>
                            {product.description && (
                              <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                                {product.description}
                              </p>
                            )}

                            <div className="mt-auto pt-4">
                              <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Valor</div>
                              <div className="flex flex-wrap items-end justify-center gap-2">
                                <span className="text-2xl font-bold text-black">
                                  {formatBRL(product.promo_price ?? product.price)}
                                </span>
                                {product.promo_price && (
                                  <span className="pb-1 text-xs text-muted-foreground line-through">
                                    {formatBRL(product.price)}
                                  </span>
                                )}
                              </div>
                              <div className="mt-3 rounded-none border border-[#e6e8de] bg-[#f6f7f2] px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] text-stone-700">
                                {acceptOrders && product.is_available ? "Personalizar item" : "Indisponivel"}
                              </div>
                            </div>
                          </div>
                        </div>
                      </Card>
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>

      {count > 0 && (
        <div className="fixed bottom-4 left-1/2 z-30 w-[calc(100%-2rem)] max-w-md -translate-x-1/2">
          <Button variant="hero" size="lg" className="w-full justify-between" onClick={() => setCartOpen(true)}>
            <span className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4" /> Ver carrinho ({count})
            </span>
            <span>{formatBRL(subtotal)}</span>
          </Button>
        </div>
      )}

      {selectedProduct && <ProductDialog product={selectedProduct} onClose={() => setSelectedProduct(null)} />}
      {slug && <CartDrawer open={cartOpen} onOpenChange={setCartOpen} slug={slug} />}
    </div>
  );
};

export default PublicStore;

