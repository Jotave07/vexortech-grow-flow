import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useOutletContext } from "react-router-dom";
import { backend } from "@/integrations/backend/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Star,
  Upload,
  Settings2,
  PackageCheck,
  CircleOff,
  Layers3,
  GripVertical,
  Search,
  ImagePlus,
  Sparkles,
  UtensilsCrossed,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/format";
import { OptionsDialog } from "@/components/lojista/OptionsDialog";

type Product = any;
type Category = { id: string; name: string };

const Products = () => {
  const { store } = useOutletContext<{ store: any }>();
  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [optionsFor, setOptionsFor] = useState<Product | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<any>({ name: "", description: "", price: "", promo_price: "", category_id: "", prep_time_minutes: "", image_url: "", is_featured: false, is_available: true });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Presentation-only state (sem impacto na camada de dados)
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [search, setSearch] = useState("");

  const stats = useMemo(() => ({
    activeCategories: categories.length,
    activeProducts: items.filter((item) => item.is_active !== false).length,
    unavailable: items.filter((item) => item.is_available === false).length,
    featured: items.filter((item) => item.is_featured).length,
  }), [categories.length, items]);

  const sections = useMemo(() => {
    const knownCategories = new Map(categories.map((category) => [category.id, category.name]));
    const grouped = categories
      .map((category) => ({
        id: category.id,
        name: category.name,
        items: items.filter((item) => item.category_id === category.id),
      }))
      .filter((section) => section.items.length > 0);
    const uncategorized = items.filter((item) => !item.category_id || !knownCategories.has(item.category_id));
    return uncategorized.length ? [...grouped, { id: "uncategorized", name: "Sem categoria", items: uncategorized }] : grouped;
  }, [categories, items]);

  // Contagem por categoria para a sidebar (inclui categorias vazias)
  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item) => {
      const key = item.category_id ?? "uncategorized";
      map.set(key, (map.get(key) ?? 0) + 1);
    });
    return map;
  }, [items]);

  const uncategorizedCount = useMemo(() => {
    const known = new Set(categories.map((c) => c.id));
    return items.filter((item) => !item.category_id || !known.has(item.category_id)).length;
  }, [categories, items]);

  // Lista plana filtrada para o grid principal (busca + categoria selecionada)
  const filteredProducts = useMemo(() => {
    const known = new Set(categories.map((c) => c.id));
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      const itemCat = !item.category_id || !known.has(item.category_id) ? "uncategorized" : item.category_id;
      if (selectedCategory !== "all" && itemCat !== selectedCategory) return false;
      if (term) {
        const haystack = `${item.name ?? ""} ${item.description ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [items, categories, selectedCategory, search]);

  const load = useCallback(async () => {
    if (!store?.id) return;
    setLoading(true);
    const [prods, cats] = await Promise.all([
      backend.from("products").select("*, categories(name)").eq("store_id", store.id).order("sort_order"),
      backend.from("categories").select("id, name").eq("store_id", store.id).order("sort_order"),
    ]);
    setItems(prods.data ?? []);
    setCategories((cats.data as Category[]) ?? []);
    setLoading(false);
  }, [store?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", description: "", price: "", promo_price: "", category_id: categories[0]?.id ?? "", prep_time_minutes: "", image_url: "", is_featured: false, is_available: true });
    setOpen(true);
  };
  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      name: p.name, description: p.description ?? "", price: String(p.price), promo_price: p.promo_price ? String(p.promo_price) : "",
      category_id: p.category_id ?? "", prep_time_minutes: p.prep_time_minutes ? String(p.prep_time_minutes) : "",
      image_url: p.image_url ?? "", is_featured: p.is_featured, is_available: p.is_available ?? true,
    });
    setOpen(true);
  };

  const onUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) return toast.error("Selecione uma imagem");
    if (file.size > 4 * 1024 * 1024) return toast.error("Máximo 4MB");
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${store.id}/products/${crypto.randomUUID()}.${ext}`;
    const { error } = await backend.storage.from("store-assets").upload(path, file, { upsert: false });
    setUploading(false);
    if (error) return toast.error(error.message);
    const { data } = backend.storage.from("store-assets").getPublicUrl(path);
    setForm((f: any) => ({ ...f, image_url: data.publicUrl }));
    toast.success("Imagem enviada");
  };

  const save = async () => {
    if (!form.name.trim()) return toast.error("Nome obrigatório");
    const price = Number(form.price);
    if (isNaN(price) || price < 0) return toast.error("Preço inválido");
    setSaving(true);
    const payload = {
      store_id: store.id,
      category_id: form.category_id || null,
      name: form.name.trim().toUpperCase(),
      description: form.description || null,
      price,
      promo_price: form.promo_price ? Number(form.promo_price) : null,
      prep_time_minutes: form.prep_time_minutes ? Number(form.prep_time_minutes) : null,
      image_url: form.image_url || null,
      is_featured: form.is_featured,
      is_available: form.is_available,
    };
    const { error } = editing
      ? await backend.from("products").update(payload).eq("id", editing.id)
      : await backend.from("products").insert({ ...payload, sort_order: items.length });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Produto atualizado" : "Produto criado");
    setOpen(false); load();
  };

  const toggle = async (p: Product, field: "is_active" | "is_available") => {
    const patch: any = { [field]: !p[field] };
    await backend.from("products").update(patch).eq("id", p.id);
    load();
  };
  const remove = async (p: Product) => {
    if (!confirm(`Excluir "${p.name}"?`)) return;
    await backend.from("products").delete().eq("id", p.id);
    toast.success("Produto excluído"); load();
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-tight">Cardápio</h1>
          <p className="font-medium text-muted-foreground">Organize categorias, pratos, fotos e disponibilidade com clareza.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="h-10 font-black uppercase tracking-widest text-xs" onClick={openNew}>
            <Upload className="h-4 w-4" /> Importar
          </Button>
          <Button variant="hero" className="h-10 font-black uppercase tracking-widest text-xs" onClick={openNew}>
            <Plus className="h-4 w-4" /> Novo produto
          </Button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MenuStat icon={Layers3} label="Categorias ativas" value={stats.activeCategories} detail="Separação do cardápio" />
        <MenuStat icon={PackageCheck} label="Produtos ativos" value={stats.activeProducts} detail="Visíveis na loja" />
        <MenuStat icon={CircleOff} label="Indisponíveis" value={stats.unavailable} detail="Ocultos para compra" tone="warning" />
        <MenuStat icon={Star} label="Destaques" value={stats.featured} detail="Itens promovidos" />
      </div>

      {loading ? (
        <div className="py-20 text-center"><Loader2 className="h-7 w-7 animate-spin inline text-primary" /></div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          {/* Sidebar de categorias */}
          <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
            <Card className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-border bg-muted/30 p-4">
                <h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-widest">
                  <Layers3 className="h-4 w-4 text-primary" /> Categorias
                </h2>
              </div>
              <div className="p-3">
                <Button
                  variant="hero"
                  className="mb-3 w-full justify-center font-black uppercase tracking-widest text-xs"
                  onClick={openNew}
                >
                  <Plus className="h-4 w-4" /> Nova categoria
                </Button>
                <div className="space-y-1">
                  <CategoryRow
                    label="Todos os produtos"
                    count={items.length}
                    active={selectedCategory === "all"}
                    onSelect={() => setSelectedCategory("all")}
                    isAll
                  />
                  {categories.map((category) => (
                    <CategoryRow
                      key={category.id}
                      label={category.name}
                      count={categoryCounts.get(category.id) ?? 0}
                      active={selectedCategory === category.id}
                      onSelect={() => setSelectedCategory(category.id)}
                    />
                  ))}
                  {uncategorizedCount > 0 && (
                    <CategoryRow
                      label="Sem categoria"
                      count={uncategorizedCount}
                      active={selectedCategory === "uncategorized"}
                      onSelect={() => setSelectedCategory("uncategorized")}
                    />
                  )}
                  {categories.length === 0 && uncategorizedCount === 0 && (
                    <p className="px-2 py-6 text-center text-xs font-medium text-muted-foreground">
                      Nenhuma categoria cadastrada ainda.
                    </p>
                  )}
                </div>
              </div>
            </Card>
          </aside>

          {/* Painel principal */}
          <div className="space-y-5">
            {/* Busca */}
            <Card className="p-4">
              <div className="relative w-full md:max-w-sm">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar produto..."
                  className="pl-9"
                />
              </div>
            </Card>

            {/* Grade de produtos / estados vazios */}
            {items.length === 0 ? (
              <EmptyState
                title={categories.length === 0 ? "Comece criando uma categoria" : "Nenhum produto ainda"}
                description={
                  categories.length === 0
                    ? "Crie uma categoria antes de adicionar produtos ao seu cardápio."
                    : 'Clique em "Novo produto" para montar o seu cardápio.'
                }
                action={<Button variant="hero" onClick={openNew} className="font-black uppercase tracking-widest text-xs"><Plus className="h-4 w-4" /> Novo produto</Button>}
              />
            ) : filteredProducts.length === 0 ? (
              <EmptyState
                title="Nada por aqui"
                description="Nenhum produto corresponde à categoria ou busca selecionada."
                action={<Button variant="outline" onClick={() => { setSelectedCategory("all"); setSearch(""); }} className="font-black uppercase tracking-widest text-xs">Limpar filtros</Button>}
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
                {filteredProducts.map((p, i) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    index={i}
                    onEdit={() => openEdit(p)}
                    onRemove={() => remove(p)}
                    onOptions={() => setOptionsFor(p)}
                    onToggleAvailable={() => toggle(p, "is_available")}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Editar" : "Novo"} produto</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Imagem</Label>
              <div className="flex items-center gap-3 mt-2">
                <div className="w-20 h-20 rounded-none bg-muted overflow-hidden flex items-center justify-center">
                  {form.image_url ? <img src={form.image_url} alt={form.name || 'Preview do produto'} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="w-full h-full object-cover" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
                </div>
                <label className="cursor-pointer">
                  <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
                  <Button type="button" variant="outline" disabled={uploading} asChild><span>{uploading ? "Enviando..." : "Escolher"}</span></Button>
                </label>
              </div>
            </div>
            <div><Label>Nome *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase() })} /></div>
            <div><Label>Descrição</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Preço *</Label><Input type="number" step="0.01" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
              <div><Label>Promocional</Label><Input type="number" step="0.01" value={form.promo_price} onChange={(e) => setForm({ ...form, promo_price: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Categoria</Label>
                <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Tempo (min)</Label><Input type="number" value={form.prep_time_minutes} onChange={(e) => setForm({ ...form, prep_time_minutes: e.target.value })} /></div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Switch checked={form.is_featured} onCheckedChange={(v) => setForm({ ...form, is_featured: v })} />
                <Label>Destaque</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.is_available} onCheckedChange={(v) => setForm({ ...form, is_available: v })} />
                <Label>Disponível</Label>
              </div>
            </div>
            <Button variant="hero" className="w-full" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {optionsFor && <OptionsDialog product={optionsFor} storeId={store.id} onClose={() => setOptionsFor(null)} />}
    </div>
  );
};

const MenuStat = ({
  icon: Icon,
  label,
  value,
  detail,
  tone = "default",
}: {
  icon: any;
  label: string;
  value: number;
  detail: string;
  tone?: "default" | "warning";
}) => (
  <Card className="rounded-none border-border p-4 shadow-sm">
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="mt-1 text-2xl font-black tracking-tight">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
      </div>
      <div className={tone === "warning" ? "rounded-none bg-amber-100 p-3 text-amber-700" : "rounded-none bg-primary/15 p-3 text-foreground"}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  </Card>
);

const CategoryRow = ({
  label,
  count,
  active,
  onSelect,
  isAll = false,
}: {
  label: string;
  count: number;
  active: boolean;
  onSelect: () => void;
  isAll?: boolean;
}) => (
  <div
    className={cn(
      "group flex items-center gap-2 rounded-none border px-2 py-2 transition-smooth",
      active
        ? "border-primary bg-primary/15"
        : "border-transparent hover:border-border hover:bg-muted/40",
    )}
  >
    {!isAll && (
      <button
        type="button"
        className="cursor-grab text-muted-foreground/50 transition-colors hover:text-muted-foreground"
        aria-label="Arrastar categoria"
        tabIndex={-1}
      >
        <GripVertical className="h-4 w-4" />
      </button>
    )}
    <button
      type="button"
      onClick={onSelect}
      className="flex min-w-0 flex-1 items-center gap-2 text-left"
    >
      <span className={cn("truncate text-sm font-bold", active ? "text-foreground" : "text-foreground/80")}>{label}</span>
      <span
        className={cn(
          "ml-auto shrink-0 rounded-none px-2 py-0.5 text-[10px] font-black tracking-widest",
          active ? "bg-primary/20 text-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  </div>
);

const ProductCard = ({
  product: p,
  index,
  onEdit,
  onRemove,
  onOptions,
  onToggleAvailable,
}: {
  product: Product;
  index: number;
  onEdit: () => void;
  onRemove: () => void;
  onOptions: () => void;
  onToggleAvailable: () => void;
}) => {
  const unavailable = p.is_available === false;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index * 0.03, 0.3) }}
    >
      <Card
        className={cn(
          "group flex h-full flex-col overflow-hidden p-0 transition-smooth hover:border-primary",
          unavailable && "opacity-80",
        )}
      >
        {/* Imagem com botão de editar no hover */}
        <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
          {p.image_url ? (
            <img src={p.image_url} alt={p.name} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground">
              <UtensilsCrossed className="h-6 w-6 text-primary" />
              <span className="text-[10px] font-black uppercase tracking-widest">Sem foto</span>
            </div>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-none bg-black/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white opacity-0 transition-opacity group-hover:opacity-100"
          >
            <ImagePlus className="h-3 w-3" /> Imagem
          </button>
          {/* Badges sobre a imagem */}
          <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
            {p.is_featured && (
              <Badge className="rounded-none bg-amber-400 text-[10px] font-black uppercase tracking-widest text-black hover:bg-amber-400">
                Mais vendido
              </Badge>
            )}
            {unavailable && (
              <Badge variant="destructive" className="rounded-none text-[10px] font-black uppercase tracking-widest">
                Indisponível
              </Badge>
            )}
          </div>
        </div>

        {/* Corpo */}
        <div className="flex flex-1 flex-col gap-3 p-4">
          <div className="min-w-0">
            <div className="flex items-start gap-2">
              <h3 className="min-w-0 flex-1 truncate text-sm font-black uppercase tracking-tight">{p.name}</h3>
              {p.categories?.name && (
                <Badge variant="secondary" className="shrink-0 rounded-none text-[9px] font-black uppercase tracking-widest">
                  {p.categories.name}
                </Badge>
              )}
            </div>
            <p className="mt-1 line-clamp-2 text-xs font-medium text-muted-foreground">
              {p.description || "Sem descrição cadastrada."}
            </p>
          </div>

          {/* Preço destacado */}
          <div className="text-base font-black tracking-tight">
            {p.promo_price ? (
              <span className="inline-flex items-center gap-2">
                <span className="text-foreground">{formatBRL(p.promo_price)}</span>
                <span className="text-xs font-bold text-muted-foreground line-through">{formatBRL(p.price)}</span>
              </span>
            ) : (
              <span className="text-foreground">{formatBRL(p.price)}</span>
            )}
          </div>

          {/* Tempo de preparo */}
          {p.prep_time_minutes ? (
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-none border border-border bg-muted px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
                {p.prep_time_minutes} min
              </span>
            </div>
          ) : null}

          {/* Ações */}
          <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">
            <div className="flex items-center gap-2">
              <Switch checked={!unavailable} onCheckedChange={onToggleAvailable} />
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                {unavailable ? "Indisponível" : "Disponível"}
              </span>
            </div>
            <Button size="sm" variant="outline" className="ml-auto h-8 px-2.5" onClick={onOptions}>
              <Settings2 className="h-3.5 w-3.5" /> Adicionais
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit} aria-label="Editar produto">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onRemove} aria-label="Excluir produto">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </Card>
    </motion.div>
  );
};

const EmptyState = ({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) => (
  <Card className="flex flex-col items-center justify-center gap-3 p-12 text-center">
    <div className="rounded-none bg-primary/15 p-4 text-foreground">
      <Sparkles className="h-7 w-7" />
    </div>
    <div>
      <h3 className="text-base font-black uppercase tracking-tight">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-sm font-medium text-muted-foreground">{description}</p>
    </div>
    {action}
  </Card>
);

export default Products;
