import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type CartOption = {
  option_id: string;
  option_name: string;
  item_id: string;
  item_name: string;
  extra_price: number;
};

export type CartItem = {
  uid: string; // uniq cart-line id
  product_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  options: CartOption[];
  notes?: string;
};

type CartContextValue = {
  storeSlug: string | null;
  items: CartItem[];
  addItem: (item: Omit<CartItem, "uid">) => void;
  updateQty: (uid: string, qty: number) => void;
  removeItem: (uid: string) => void;
  clear: () => void;
  setStoreSlug: (slug: string) => void;
  itemSubtotal: (item: CartItem) => number;
  subtotal: number;
  count: number;
};

const CartContext = createContext<CartContextValue | undefined>(undefined);

const STORAGE_PREFIX = "vexor_cart_";

const createUid = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const normalizeNotes = (notes?: string) => notes?.trim() || "";

const optionSignature = (options: CartOption[]) =>
  [...options]
    .map((option) => [
      option.option_id,
      option.item_id,
      Number(option.extra_price).toFixed(2),
    ].join(":"))
    .sort()
    .join("|");

const cartLineSignature = (item: Omit<CartItem, "uid">) =>
  [
    item.product_id,
    Number(item.unit_price).toFixed(2),
    normalizeNotes(item.notes),
    optionSignature(item.options),
  ].join("||");

const normalizeCartItem = (item: Partial<CartItem>): CartItem | null => {
  if (!item.product_id || !item.product_name) return null;
  const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
  return {
    uid: item.uid || createUid(),
    product_id: item.product_id,
    product_name: item.product_name,
    unit_price: Number(item.unit_price || 0),
    quantity,
    options: Array.isArray(item.options) ? item.options : [],
    notes: normalizeNotes(item.notes) || undefined,
  };
};

const parseStoredCartItems = (raw: string | null): CartItem[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeCartItem).filter((item): item is CartItem => Boolean(item));
  } catch {
    return [];
  }
};

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [storeSlug, setStoreSlugState] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("vexor_active_store_slug");
  });
  const [items, setItems] = useState<CartItem[]>(() => {
    if (typeof window === "undefined") return [];
    const slug = localStorage.getItem("vexor_active_store_slug");
    if (!slug) return [];
    const raw = localStorage.getItem(STORAGE_PREFIX + slug);
    return parseStoredCartItems(raw);
  });

  useEffect(() => {
    if (!storeSlug || typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + storeSlug);
      setItems(parseStoredCartItems(raw));
    } catch {
      setItems([]);
    }
  }, [storeSlug]);

  useEffect(() => {
    if (!storeSlug || typeof window === "undefined") return;
    localStorage.setItem(STORAGE_PREFIX + storeSlug, JSON.stringify(items));
  }, [items, storeSlug]);

  const setStoreSlug = (slug: string) => {
    setStoreSlugState(slug);
    if (typeof window !== "undefined") {
      localStorage.setItem("vexor_active_store_slug", slug);
    }
  };

  const addItem: CartContextValue["addItem"] = (item) => {
    const normalizedItem = normalizeCartItem(item);
    if (!normalizedItem) return;
    const nextSignature = cartLineSignature(normalizedItem);

    setItems((prev) => {
      const existing = prev.find((current) => cartLineSignature(current) === nextSignature);
      if (!existing) return [...prev, normalizedItem];
      return prev.map((current) =>
        current.uid === existing.uid
          ? { ...current, quantity: current.quantity + normalizedItem.quantity }
          : current,
      );
    });
  };
  const updateQty = (uid: string, qty: number) => {
    if (qty <= 0) return removeItem(uid);
    setItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, quantity: qty } : i)));
  };
  const removeItem = (uid: string) => setItems((prev) => prev.filter((i) => i.uid !== uid));
  const clear = () => setItems([]);

  const itemSubtotal = (item: CartItem) => {
    const opts = item.options.reduce((s, o) => s + Number(o.extra_price), 0);
    return (Number(item.unit_price) + opts) * item.quantity;
  };

  const subtotal = items.reduce((s, i) => s + itemSubtotal(i), 0);
  const count = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <CartContext.Provider value={{ storeSlug, items, addItem, updateQty, removeItem, clear, setStoreSlug, itemSubtotal, subtotal, count }}>
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside CartProvider");
  return ctx;
};
