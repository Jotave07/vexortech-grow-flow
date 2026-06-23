import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import { Loader2, MapPin, Clock, ShoppingBag, Search, Star, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/format";
import { ProductDialog } from "@/components/public/ProductDialog";
import { CartDrawer } from "@/components/public/CartDrawer";
import { StoreHeader, type StoreHeaderInfo } from "@/components/public/StoreHeader";
import { BottomNav } from "@/components/public/BottomNav";
import { useCart } from "@/contexts/CartContext";
import { useAuth } from "@/contexts/AuthContext";
import { isStoreOpen } from "@/lib/opening-hours";
import { toast } from "sonner";
import { detectStoreSegment, getSegmentCover } from "@/lib/store-segments";
import { getStoreProfileVerification } from "@/lib/profile-verification";
import { cn } from "@/lib/utils";

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
  const [reviews, setReviews] = useState<any[]>([]);
  const [avgRating, setAvgRating] = useState(0);
  const [reviewsCount, setReviewsCount] = useState(0);

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
      const [settingsRes, categoryRes, productRes, reviewsRes] = await Promise.all([
        backend.from("store_settings").select("*").eq("store_id", storeData.id).maybeSingle(),
        backend.from("categories").select("*").eq("store_id", storeData.id).eq("is_active", true).order("sort_order"),
        backend.from("products").select("*").eq("store_id", storeData.id).eq("is_active", true).order("sort_order"),
        backend.from("store_reviews").select("*").eq("store_id", storeData.id).eq("is_visible", true).order("created_at", { ascending: false }).limit(10),
      ]);

      setSettings(settingsRes.data);
      setCategories(categoryRes.data ?? []);
      setProducts(productRes.data ?? []);
      const reviewsData = (reviewsRes.data ?? []) as any[];
      setReviews(reviewsData);
      setReviewsCount(reviewsData.length);
      setAvgRating(reviewsData.length > 0 ? parseFloat((reviewsData.reduce((sum: number, r: any) => sum + Number(r.rating || 0), 0) / reviewsData.length).toFixed(1)) : 0);
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
    const uncategorizedProducts = filteredProducts.filter(
      (product) => !product.category_id || !categoryIds.has(product.category_id),
    );
    return uncategorizedProducts.length
      ? [...categorySections, { id: "uncategorized", name: "Outros", items: uncategorizedProducts }]
      : categorySections;
  }, [categories, filteredProducts]);

  /** Featured products (top 6 by sort_order or promo_price) */
  const featuredProducts = useMemo(() => {
    return products
      .filter((p) => p.is_available && p.is_active)
      .sort((a, b) => {
        if (a.promo_price && !b.promo_price) return -1;
        if (!a.promo_price && b.promo_price) return 1;
        return (a.sort_order ?? 0) - (b.sort_order ?? 0);
      })
      .slice(0, 6);
  }, [products]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--hype-green)]" />
      </div>
    );
  }

  if (!store) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loja não encontrada
      </div>
    );
  }

  const isOpen = settings ? isStoreOpen(settings.business_hours, settings.is_open) : false;
  const isSuspended = store.is_suspended;
  const acceptOrders = !isSuspended && (isOpen || settings?.accept_orders_when_closed);
  const publicStoreName = store.public_name || store.name;
  const storeSegment = detectStoreSegment(store, categories.map((c) => c.name));
  const coverUrl = store.cover_url || getSegmentCover(storeSegment);
  const verification = getStoreProfileVerification(store, settings);

  const headerInfo: StoreHeaderInfo = {
    slug: store.slug,
    name: publicStoreName,
    logoUrl: store.logo_url,
    coverUrl,
    storeType: storeSegment,
    isOpen,
    isVerified: verification.status === "verified" || verification.status === "complete",
    minOrder: settings?.min_order_value ?? 0,
    avgPrep: settings?.avg_prep_time_minutes ?? 0,
    deliveryFee: settings?.delivery_fee,
    city: store.city,
    state: store.state,
    whatsapp: settings?.whatsapp,
  };

  const isAdmin = profile?.role === "super_admin" || profile?.role === "store_owner";
  const isStoreOwner = store.owner_user_id && user?.id === store.owner_user_id;

  return (
    <div className="min-h-screen bg-background pb-20 text-foreground">
      {/* Top header with hamburger menu */}
      <StoreHeader
        store={headerInfo}
        isLoggedIn={!!user}
        isAdmin={isAdmin}
        onSignOut={async () => {
          await signOut();
          toast.success("Você saiu da conta.");
          navigate("/");
        }}
        onSearch={(term) => setSearch(term)}
      />

      {/* Hero / Banner section */}
      <section className="relative overflow-hidden border-b border-border">
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(178,216,63,0.08)_0%,transparent_40%,rgba(13,17,16,0.9)_100%)]" />

        <div className="container relative mx-auto px-4 pb-6 pt-4">
          {/* Cover + info card */}
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {/* Cover image */}
            <div className="relative h-36 overflow-hidden sm:h-44">
              <img
                src={coverUrl}
                alt={publicStoreName}
                loading="eager"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-card via-card/40 to-transparent" />
              <Badge
                variant={isOpen ? "default" : "secondary"}
                className="absolute right-4 top-4 rounded-md px-3 py-1 text-xs font-bold"
              >
                {isOpen ? "Aberto agora" : "Fechado"}
              </Badge>
              <div className="absolute bottom-3 left-4 rounded-md bg-black/70 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-foreground/80 backdrop-blur-sm">
                {storeSegment}
              </div>
            </div>

            {/* Store info row */}
            <div className="grid gap-4 p-4 pt-0 sm:grid-cols-[8rem_minmax(0,1fr)] sm:p-5 sm:pt-0">
              {/* Logo — fully overlapping banner */}
              <div className="relative z-10 mx-auto -mt-24 h-32 w-32 overflow-hidden rounded-2xl border-[5px] border-card bg-card shadow-2xl sm:mx-0 sm:h-32 sm:w-32">
                {store.logo_url ? (
                  <img src={store.logo_url} alt={publicStoreName} loading="eager" className="h-full w-full rounded-xl object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center rounded-xl bg-secondary/60">
                    <ShoppingBag className="h-10 w-10 text-[var(--hype-green)]" />
                  </div>
                )}
              </div>

              {/* Name + description + stats */}
              <div className="min-w-0 text-center sm:text-left">
                <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{publicStoreName}</h1>
                {store.description && (
                  <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">{store.description}</p>
                )}

                {/* Quick stats row */}
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5 rounded-md bg-secondary/60 px-2.5 py-1.5">
                    <MapPin className="h-3.5 w-3.5 text-[var(--hype-green)]" />
                    {store.city}{store.state ? `/${store.state}` : ""}
                  </div>
                  <div className="flex items-center gap-1.5 rounded-md bg-secondary/60 px-2.5 py-1.5">
                    <Clock className="h-3.5 w-3.5 text-[var(--hype-green)]" />
                    {settings?.avg_prep_time_minutes ? `~${settings.avg_prep_time_minutes} min` : "Sob demanda"}
                  </div>
                  <div className="flex items-center gap-1.5 rounded-md bg-secondary/60 px-2.5 py-1.5">
                    <ShoppingBag className="h-3.5 w-3.5 text-[var(--hype-green)]" />
                    {settings?.min_order_value > 0 ? `Mín. ${formatBRL(settings.min_order_value)}` : "Sem mín."}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Reviews bar */}
      {reviewsCount > 0 && (
        <div className="container mx-auto px-4 pt-4">
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-1.5">
              <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
              <span className="text-lg font-bold text-foreground">{avgRating}</span>
              <span className="text-xs text-muted-foreground">({reviewsCount} {reviewsCount === 1 ? "avaliação" : "avaliações"})</span>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 overflow-x-auto">
              {reviews.slice(0, 3).map((review: any) => (
                <span key={review.id} className="shrink-0 text-xs text-muted-foreground/70 italic">
                  "{review.comment || `${review.rating} estrelas`}"
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Search + Categories */}
      <div className="sticky top-[57px] z-30 border-b border-border bg-background/95 backdrop-blur-xl">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/45" />
              <Input
                className="h-10 rounded-lg border-border bg-secondary/60 pl-9 text-sm text-foreground placeholder:text-muted-foreground/45 focus:border-[var(--hype-green)]/50"
                placeholder="Buscar no cardápio..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {/* Category pills */}
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => setActiveCategory("all")}
              className={cn(
                "shrink-0 rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors",
                activeCategory === "all"
                  ? "bg-[var(--hype-green)] text-black"
                  : "bg-secondary/60 text-muted-foreground/80 hover:bg-secondary hover:text-foreground",
              )}
            >
              Tudo
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  "shrink-0 rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors",
                  activeCategory === cat.id
                    ? "bg-[var(--hype-green)] text-black"
                    : "bg-secondary/60 text-muted-foreground/80 hover:bg-secondary hover:text-foreground",
                )}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="container mx-auto px-4 pt-6">
        {/* Admin banner */}
        {user && isStoreOwner && (
          <div className="mb-6 rounded-lg border border-[var(--hype-green)]/20 bg-[var(--hype-green)]/5 p-4 text-center">
            <p className="text-sm text-[var(--hype-green)]">
              Você está visualizando sua loja como <strong>Administrador</strong>.{" "}
              <button onClick={() => signOut()} className="underline font-bold hover:text-foreground">
                Sair da conta
              </button>
            </p>
          </div>
        )}

        {/* Suspended banner */}
        {isSuspended && (
          <div className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-6 text-center">
            <h3 className="text-xl font-black uppercase italic text-red-400 mb-2">Operação Suspensa</h3>
            <p className="text-sm text-red-300/80">Esta loja não está aceitando pedidos no momento.</p>
          </div>
        )}

        {/* Closed banner */}
        {!isSuspended && !acceptOrders && (
          <div className="mb-6 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-center">
            <p className="text-sm font-semibold text-amber-400">Loja fechada — não está aceitando pedidos no momento.</p>
          </div>
        )}

        {/* Featured products (Destaques) */}
        {featuredProducts.length > 0 && activeCategory === "all" && !search && (
          <section className="mb-8">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-foreground">Destaques</h2>
                <p className="text-xs text-muted-foreground/60">Os mais pedidos da casa</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/45" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {featuredProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => acceptOrders && product.is_available && setSelectedProduct(product)}
                  disabled={!acceptOrders || !product.is_available}
                  className="text-left disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="group flex items-center gap-3 rounded-xl border border-border bg-card p-3 transition-all hover:border-[var(--hype-green)]/30 hover:bg-secondary/70">
                    <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-secondary/60 p-1.5">
                      {product.image_url ? (
                        <img src={product.image_url} alt={product.name} loading="lazy" className="h-full w-full rounded-md object-contain" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Star className="h-6 w-6 text-[var(--hype-green)]/40" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-foreground">{product.name}</h3>
                      {product.description && (
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground/60">{product.description}</p>
                      )}
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className="text-sm font-bold text-[var(--hype-green)]">
                          {formatBRL(product.promo_price ?? product.price)}
                        </span>
                        {product.promo_price && (
                          <span className="text-xs text-muted-foreground/45 line-through">{formatBRL(product.price)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Menu sections */}
        {sections.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card p-12 text-center">
            <ShoppingBag className="mx-auto mb-3 h-10 w-10 text-foreground/20" />
            <p className="text-sm text-muted-foreground/60">
              {products.length === 0 ? "Cardápio em construção." : "Nenhum produto encontrado."}
            </p>
          </div>
        ) : (
          <div className="space-y-10 pb-6">
            {sections.map((section) => (
              <section key={section.id}>
                {/* Section header */}
                <div className="mb-4 flex items-end justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{section.name}</h2>
                    <p className="text-xs text-muted-foreground/45">{section.items.length} {section.items.length === 1 ? "item" : "itens"}</p>
                  </div>
                </div>

                {/* Product grid */}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {section.items.map((product: any) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => acceptOrders && product.is_available && setSelectedProduct(product)}
                      disabled={!acceptOrders || !product.is_available}
                      className="h-full text-left disabled:cursor-not-allowed disabled:opacity-55"
                    >
                      <div className="group flex h-full flex-col rounded-xl border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-[var(--hype-green)]/30 hover:shadow-lg hover:shadow-[var(--hype-green)]/5">
                        {/* Product image */}
                        <div className="relative mx-auto h-28 w-28 overflow-hidden rounded-lg bg-secondary/60 p-3 sm:h-32 sm:w-32">
                          {product.image_url ? (
                            <img
                              src={product.image_url}
                              alt={product.name}
                              loading="lazy"
                              onError={(e) => { e.currentTarget.style.display = "none"; }}
                              className="h-full w-full rounded-md object-contain transition-transform group-hover:scale-[1.04]"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <ShoppingBag className="h-8 w-8 text-foreground/15" />
                            </div>
                          )}
                          {!product.is_available && (
                            <Badge variant="destructive" className="absolute inset-x-3 bottom-1 justify-center rounded-md py-0.5 text-[10px] font-bold">
                              Esgotado
                            </Badge>
                          )}
                          {product.promo_price && product.is_available && (
                            <Badge className="absolute right-1 top-1 rounded-md bg-[var(--hype-green)] px-1.5 py-0 text-[9px] font-bold text-black">
                              OFERTA
                            </Badge>
                          )}
                        </div>

                        {/* Product info */}
                        <div className="mt-4 flex flex-1 flex-col text-center">
                          <h3 className="text-sm font-semibold text-foreground">{product.name}</h3>
                          {product.description && (
                            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground/60">
                              {product.description}
                            </p>
                          )}

                          <div className="mt-auto pt-4">
                            <div className="flex items-baseline justify-center gap-2">
                              <span className="text-xl font-bold text-[var(--hype-green)]">
                                {formatBRL(product.promo_price ?? product.price)}
                              </span>
                              {product.promo_price && (
                                <span className="text-xs text-muted-foreground/45 line-through">{formatBRL(product.price)}</span>
                              )}
                            </div>
                            <div className="mt-3 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs font-semibold text-muted-foreground/80 transition-colors group-hover:border-[var(--hype-green)]/30 group-hover:text-[var(--hype-green)]">
                              {acceptOrders && product.is_available ? "Adicionar" : "Indisponível"}
                            </div>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Cart floating button */}
      {count > 0 && (
        <div className="fixed bottom-20 left-1/2 z-30 w-[calc(100%-2rem)] max-w-md -translate-x-1/2">
          <Button
            variant="hero"
            size="lg"
            className="w-full justify-between rounded-xl shadow-lg shadow-[var(--hype-green)]/20"
            onClick={() => setCartOpen(true)}
          >
            <span className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4" /> Ver carrinho ({count})
            </span>
            <span>{formatBRL(subtotal)}</span>
          </Button>
        </div>
      )}

      {/* Bottom navigation */}
      <BottomNav storeSlug={slug} />

      {/* Product detail dialog + Cart drawer */}
      {selectedProduct && <ProductDialog product={selectedProduct} onClose={() => setSelectedProduct(null)} />}
      {slug && <CartDrawer open={cartOpen} onOpenChange={setCartOpen} slug={slug} />}
    </div>
  );
};

export default PublicStore;
