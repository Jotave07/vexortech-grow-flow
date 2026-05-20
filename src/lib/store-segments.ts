export type StoreSegment =
  | "Restaurantes"
  | "Acai"
  | "Pizza"
  | "Lanches"
  | "Mercados"
  | "Bebidas"
  | "Farmacia"
  | "Pet";

type StoreLike = {
  name?: string | null;
  public_name?: string | null;
  description?: string | null;
};

const SEGMENT_COVERS: Record<StoreSegment, string> = {
  Restaurantes: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=1400&auto=format&fit=crop",
  Acai: "https://images.unsplash.com/photo-1546039907-7fa05f864c02?q=80&w=1400&auto=format&fit=crop",
  Pizza: "https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=1400&auto=format&fit=crop",
  Lanches: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=1400&auto=format&fit=crop",
  Mercados: "https://images.unsplash.com/photo-1542838132-92c53300491e?q=80&w=1400&auto=format&fit=crop",
  Bebidas: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?q=80&w=1400&auto=format&fit=crop",
  Farmacia: "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?q=80&w=1400&auto=format&fit=crop",
  Pet: "https://images.unsplash.com/photo-1601758228041-f3b2795255f1?q=80&w=1400&auto=format&fit=crop",
};

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const detectStoreSegment = (store: StoreLike, menuCategories: string[] = []): StoreSegment => {
  const text = normalizeText(
    [store.name, store.public_name, store.description, ...menuCategories].filter(Boolean).join(" "),
  );

  if (/(acai|cupacu|smoothie|sorvete|gelato|milk shake|milkshake)/.test(text)) return "Acai";
  if (/(pizza|pizzaria|calzone|esfiha)/.test(text)) return "Pizza";
  if (/(lanche|hamburguer|burger|hot dog|pastel|batata|sandwich|sanduiche)/.test(text)) return "Lanches";
  if (/(mercado|mercearia|hortifruti|padaria|acougue|conveniencia|emporio)/.test(text)) return "Mercados";
  if (/(bebida|adega|cerveja|vinho|bar|drink|destilado)/.test(text)) return "Bebidas";
  if (/(farmacia|drogaria|medicamento|saude|perfumaria)/.test(text)) return "Farmacia";
  if (/(pet|racao|veterinario|banho e tosa)/.test(text)) return "Pet";
  return "Restaurantes";
};

export const getSegmentCover = (segment: StoreSegment | string) =>
  SEGMENT_COVERS[(segment as StoreSegment) in SEGMENT_COVERS ? (segment as StoreSegment) : "Restaurantes"];

export const getStoreCover = (store: StoreLike & { cover_url?: string | null }, menuCategories: string[] = []) =>
  store.cover_url || getSegmentCover(detectStoreSegment(store, menuCategories));
