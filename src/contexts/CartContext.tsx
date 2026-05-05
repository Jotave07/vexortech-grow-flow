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

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [storeSlug, setStoreSlugState] = useState<string | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    if (!storeSlug || typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + storeSlug);
      if (raw) setItems(JSON.parse(raw));
      else setItems([]);
    } catch {
      setItems([]);
    }
  }, [storeSlug]);

  useEffect(() => {
    if (!storeSlug || typeof window === "undefined") return;
    localStorage.setItem(STORAGE_PREFIX + storeSlug, JSON.stringify(items));
  }, [items, storeSlug]);

  const setStoreSlug = (slug: string) => setStoreSlugState(slug);

  const addItem: CartContextValue["addItem"] = (item) => {
    setItems((prev) => [...prev, { ...item, uid: crypto.randomUUID() }]);
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
