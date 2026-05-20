import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, MapPin, Clock, ShoppingBag, Search, User, LogOut } from "lucide-react";
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
      const { data: storeData } = await supabase.from("stores").select("*").eq("slug", slug).maybeSingle();
      if (!storeData) {
        setLoading(false);
        return;
      }

      setStore(storeData);
      const [settingsRes, categoryRes, productRes] = await Promise.all([
        supabase.from("store_settings").select("*").eq("store_id", storeData.id).maybeSingle(),
        supabase.from("categories").select("*").eq("store_id", storeData.id).eq("is_active", true).order("sort_order"),
        supabase.from("products").select("*").eq("store_id", storeData.id).eq("is_active", true).order("sort_order"),
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
        product.name.toLowerCase().includes(query) ||
        (product.description ?? "").toLowerCase().includes(query);
      const matchesCategory = activeCategory === "all" || product.category_id === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [activeCategory, products, search]);

  const sections = useMemo(
    () =>
      categories
        .map((category) => ({
          ...category,
          items: filteredProducts.filter((product) => product.category_id === category.id),
        }))
        .filter((category) => category.items.length > 0),
    [categories, filteredProducts],
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!store) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loja nao encontrada</div>;
  }

  const isOpen = settings ? isStoreOpen(settings.business_hours, settings.is_open) : false;
  const isSuspended = store.is_suspended;
  const acceptOrders = !isSuspended && (isOpen || settings?.accept_orders_when_closed);
  const publicStoreName = store.public_name || store.name;
  const storeSegment = detectStoreSegment(store, categories.map((category) => category.name));
  const coverUrl = store.cover_url || getSegmentCover(storeSegment);

  return (
    <div className="min-h-screen bg-[#f6f7f2] pb-32">
      <header className="sticky top-0 z-40 bg-[#ffffff]/95 backdrop-blur-xl border-b border-[#e6e8de] py-3">
        <div className="container mx-auto px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {store.logo_url && <img src={store.logo_url} alt="" className="h-9 w-9 rounded-xl object-cover" />}
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
                    toast.success("VocÃª saiu da conta.");
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
            <Card className="overflow-hidden rounded-3xl border-[#e1d7c7] bg-white p-0 shadow-sm">
              <div className="relative h-40 overflow-hidden sm:h-48">
                <img src={coverUrl} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
                <Badge variant={isOpen ? "default" : "secondary"} className="absolute right-4 top-4 rounded-full px-3 py-1">
                  {isOpen ? "Aberto agora" : "Fechado"}
                </Badge>
                <div className="absolute bottom-4 left-4 rounded-full bg-white/95 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-stone-700 shadow-sm">
                  {storeSegment}
                </div>
              </div>

              <div className="grid gap-4 p-4 sm:grid-cols-[5rem_minmax(0,1fr)] sm:p-5">
                <div className="-mt-12 h-24 w-24 overflow-hidden rounded-3xl border-4 border-white bg-white shadow-lg sm:h-20 sm:w-20">
                  {store.logo_url ? (
                    <img src={store.logo_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-[#f6f7f2] text-primary">
                      <ShoppingBag className="h-7 w-7" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <h1 className="text-2xl font-bold tracking-tight text-stone-950 md:text-3xl">{publicStoreName}</h1>
                  {store.description && (
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                      {store.description}
                    </p>
                  )}
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-2xl border border-[#e6e8de] bg-[#f6f7f2] p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Regiao</div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-black">
                        <MapPin className="h-4 w-4 text-primary" />
                        <span>{store.city || "Cidade"}{store.state ? `/${store.state}` : ""}</span>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[#e6e8de] bg-[#f6f7f2] p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Preparo</div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-black">
                        <Clock className="h-4 w-4 text-primary" />
                        <span>{settings?.avg_prep_time_minutes ? `~${settings.avg_prep_time_minutes} min` : "Sob demanda"}</span>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-[#e6e8de] bg-[#f6f7f2] p-3">
                      <div className="mb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Minimo</div>
                      <div className="text-sm font-semibold text-black">
                        {settings?.min_order_value > 0 ? formatBRL(settings.min_order_value) : "Livre"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="rounded-3xl border-[#e1d7c7] bg-white p-5 shadow-sm">
              <div className="mb-4 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Cardapio</div>
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="h-11 rounded-xl border-[#e6e8de] pl-9"
                    placeholder="Buscar no cardapio"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                  <Button
                    variant={activeCategory === "all" ? "default" : "outline"}
                    onClick={() => setActiveCategory("all")}
                    className="h-9 rounded-xl px-4 text-xs font-bold uppercase tracking-widest"
                  >
                    Tudo
                  </Button>
                  {categories.map((category) => (
                    <Button
                      key={category.id}
                      variant={activeCategory === category.id ? "default" : "outline"}
                      onClick={() => setActiveCategory(category.id)}
                      className="h-9 rounded-xl px-4 text-xs font-bold uppercase tracking-widest"
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
              VocÃª estÃ¡ visualizando sua loja como <strong>Administrador</strong>. 
              Para testar o fluxo de compra completo como cliente, por favor use uma conta de cliente ou <button onClick={() => signOut()} className="underline font-bold hover:text-blue-600">saia da conta</button>.
            </p>
          </div>
        )}

        {isSuspended && (
          <div className="mb-6 border-4 border-destructive bg-destructive/10 p-6 text-center text-destructive">
            <h3 className="text-xl font-black uppercase tracking-tight italic mb-2">OperaÃ§Ã£o Temporariamente Suspensa</h3>
            <p className="font-bold text-sm">Esta loja nÃ£o estÃ¡ aceitando pedidos no momento por questÃµes administrativas.</p>
          </div>
        )}

        {!isSuspended && !acceptOrders && (
          <div className="mb-6 border border-warning/35 bg-warning/10 p-4 text-center text-sm text-warning font-bold uppercase tracking-widest">
            A loja estÃ¡ fechada e nÃ£o estÃ¡ aceitando pedidos no momento.
          </div>
        )}

        <div className="space-y-8">
          {sections.length === 0 ? (
            <Card className="rounded-3xl border-[#e6e8de] p-10 text-center text-muted-foreground">
              {products.length === 0 ? "Cardapio em construcao." : "Nenhum produto encontrado."}
            </Card>
          ) : (
            sections.map((section) => (
              <section key={section.id} className="space-y-4">
                <div className="flex items-end justify-between gap-4 border-b border-[#e6e8de] pb-3">
                  <div>
                    <div className="mb-1 text-[11px] uppercase tracking-[0.14em] text-primary">Secao do cardapio</div>
                    <h2 className="text-2xl font-bold text-stone-950">{section.name}</h2>
                  </div>
                  <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                    {section.items.length} {section.items.length === 1 ? "item" : "itens"}
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {section.items.map((product: any) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => acceptOrders && product.is_available && setSelectedProduct(product)}
                      disabled={!acceptOrders || !product.is_available}
                      className="text-left disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <Card className="group h-full overflow-hidden rounded-3xl border-[#e6e8de] bg-white p-0 shadow-sm transition-smooth hover:-translate-y-1 hover:border-primary/45 hover:shadow-lg">
                        <div className="grid h-full min-h-[13rem] grid-cols-[1fr_7rem]">
                          <div className="flex flex-col justify-between p-4">
                            <div>
                              <div className="mb-2 flex items-start justify-between gap-3">
                                <h3 className="text-lg font-semibold leading-tight text-black">{product.name}</h3>
                                {!product.is_available && (
                                  <Badge variant="destructive" className="shrink-0">
                                    Esgotado
                                  </Badge>
                                )}
                              </div>
                              {product.description && (
                                <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                                  {product.description}
                                </p>
                              )}
                            </div>

                            <div className="mt-5 border-t border-[#e6e8de] pt-4">
                              <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Valor</div>
                              <div className="flex items-end gap-2">
                                <span className="text-2xl font-bold text-black">
                                  {formatBRL(product.promo_price ?? product.price)}
                                </span>
                                {product.promo_price && (
                                  <span className="pb-1 text-xs text-muted-foreground line-through">
                                    {formatBRL(product.price)}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="border-l border-[#e6e8de] bg-[#f6f7f2]">
                            {product.image_url ? (
                              <img src={product.image_url} alt="" className="h-full w-full object-cover transition-smooth group-hover:scale-[1.03]" />
                            ) : (
                              <div className="flex h-full items-end justify-start bg-[linear-gradient(135deg,rgba(182,255,0,0.22),transparent_46%),linear-gradient(180deg,#111111,#080808)] p-3 text-[10px] uppercase tracking-[0.18em] text-white/45">
                                {product.name}
                              </div>
                            )}
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

