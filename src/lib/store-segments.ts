export type StoreSegment =
  | "Restaurantes"
  | "Açaí"
  | "Pizza"
  | "Lanches"
  | "Mercados"
  | "Bebidas"
  | "Farmácia"
  | "Pet"
  | "Outros";

export const STORE_SEGMENT_OPTIONS: StoreSegment[] = [
  "Restaurantes",
  "Lanches",
  "Pizza",
  "Açaí",
  "Mercados",
  "Bebidas",
  "Farmácia",
  "Pet",
  "Outros",
];

type StoreLike = {
  name?: string | null;
  public_name?: string | null;
  description?: string | null;
  store_type?: string | null;
};

const SEGMENT_COVERS: Record<StoreSegment, string> = {
  Restaurantes: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?q=80&w=1400&auto=format&fit=crop",
  Açaí: "https://images.unsplash.com/photo-1546039907-7fa05f864c02?q=80&w=1400&auto=format&fit=crop",
  Pizza: "https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=1400&auto=format&fit=crop",
  Lanches: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=1400&auto=format&fit=crop",
  Mercados: "https://images.unsplash.com/photo-1542838132-92c53300491e?q=80&w=1400&auto=format&fit=crop",
  Bebidas: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?q=80&w=1400&auto=format&fit=crop",
  Farmácia: "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?q=80&w=1400&auto=format&fit=crop",
  Pet: "https://images.unsplash.com/photo-1601758228041-f3b2795255f1?q=80&w=1400&auto=format&fit=crop",
  Outros: "https://images.unsplash.com/photo-1526367790999-0150786686a2?q=80&w=1400&auto=format&fit=crop",
};

const normalizeText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

export const normalizeStoreSegment = (value?: string | null): StoreSegment | null => {
  if (!value) return null;
  const normalized = normalizeText(value);
  if (/(restaurante|restaurantes|comida|marmita|refeicao|almoco|jantar)/.test(normalized)) return "Restaurantes";
  if (/(lanche|lanches|lanchonete|hamburguer|hamburger|burger|hot dog|pastel|sanduiche|sandwich)/.test(normalized)) return "Lanches";
  if (/(pizza|pizzaria|calzone|esfiha)/.test(normalized)) return "Pizza";
  if (/(acai|cupacu|sorvete|gelato|milkshake|milk shake)/.test(normalized)) return "Açaí";
  if (/(mercado|mercados|mercearia|hortifruti|padaria|acougue|conveniencia|emporio)/.test(normalized)) return "Mercados";
  if (/(bebida|bebidas|distribuidora|adega|cerveja|vinho|bar|drink|destilado)/.test(normalized)) return "Bebidas";
  if (/(farmacia|drogaria|medicamento|saude|perfumaria)/.test(normalized)) return "Farmácia";
  if (/(pet|racao|veterinario|banho e tosa)/.test(normalized)) return "Pet";
  if (normalized === "outros" || normalized === "outro") return "Outros";
  return null;
};

export const detectStoreSegment = (store: StoreLike, menuCategories: string[] = []): StoreSegment => {
  const configured = normalizeStoreSegment(store.store_type);
  if (configured) return configured;

  const text = normalizeText(
    [store.name, store.public_name, store.description, ...menuCategories].filter(Boolean).join(" "),
  );

  return normalizeStoreSegment(text) ?? "Restaurantes";
};

export const getSegmentCover = (segment: StoreSegment | string) => {
  const normalized = normalizeStoreSegment(segment);
  return SEGMENT_COVERS[normalized ?? "Restaurantes"];
};

export const getStoreCover = (store: StoreLike & { cover_url?: string | null }, menuCategories: string[] = []) =>
  store.cover_url || getSegmentCover(detectStoreSegment(store, menuCategories));
