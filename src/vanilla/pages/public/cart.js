import { clampInteger, createId, toCents } from "./shared.js";

export const CART_STORAGE_PREFIX = "vexor_cart_";
export const ACTIVE_STORE_KEY = "vexor_active_store_slug";
export const CART_EVENT = "vexor:cart-change";

export function normalizeNotes(value) {
  return String(value || "").trim().slice(0, 200);
}

export function normalizeOption(option) {
  if (!option?.option_id || !option?.item_id) return null;
  const extra = Number(option.extra_price || 0);
  return {
    option_id: String(option.option_id).slice(0, 120),
    option_name: String(option.option_name || "Opção").slice(0, 120),
    item_id: String(option.item_id).slice(0, 120),
    item_name: String(option.item_name || "Item").slice(0, 120),
    extra_price: Number.isFinite(extra) ? Math.max(0, Math.min(extra, 10_000_000)) : 0,
  };
}

export function normalizeCartItem(item) {
  if (!item?.product_id || !item?.product_name) return null;
  const unitPrice = Number(item.unit_price || 0);
  return {
    uid: String(item.uid || createId("cart")),
    product_id: String(item.product_id).slice(0, 120),
    product_name: String(item.product_name).slice(0, 160),
    unit_price: Number.isFinite(unitPrice) ? Math.max(0, Math.min(unitPrice, 10_000_000)) : 0,
    quantity: clampInteger(item.quantity, 1, 99),
    options: Array.isArray(item.options) ? item.options.slice(0, 30).map(normalizeOption).filter(Boolean) : [],
    ...(normalizeNotes(item.notes) ? { notes: normalizeNotes(item.notes) } : {}),
  };
}

export function optionSignature(options = []) {
  return [...options]
    .map((option) => `${option.option_id}:${option.item_id}:${toCents(option.extra_price)}`)
    .sort()
    .join("|");
}

export function cartLineSignature(item) {
  return [item.product_id, toCents(item.unit_price), normalizeNotes(item.notes), optionSignature(item.options)].join("||");
}

export function itemSubtotal(item) {
  const extras = (item.options || []).reduce((sum, option) => sum + Number(option.extra_price || 0), 0);
  return (Number(item.unit_price || 0) + extras) * Number(item.quantity || 0);
}

export function cartTotals(items = []) {
  return {
    count: items.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    subtotal: items.reduce((sum, item) => sum + itemSubtotal(item), 0),
  };
}

export function parseCart(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 100).map(normalizeCartItem).filter(Boolean) : [];
  } catch { return []; }
}

function getStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

export function createCartStore(slug, { storage = null } = {}) {
  const safeSlug = String(slug || "").trim().toLocaleLowerCase("pt-BR");
  if (!safeSlug) throw new Error("Slug da loja é obrigatório para o carrinho.");
  const key = `${CART_STORAGE_PREFIX}${safeSlug}`;
  const target = getStorage(storage);
  let memory = [];
  try { memory = parseCart(target?.getItem?.(key)); } catch { memory = []; }
  const subscribers = new Set();

  const snapshot = () => memory.map((item) => ({ ...item, options: item.options.map((option) => ({ ...option })) }));
  const persist = () => {
    try {
      target?.setItem?.(ACTIVE_STORE_KEY, safeSlug);
      target?.setItem?.(key, JSON.stringify(memory));
    } catch { /* private mode or quota: keep the in-memory cart usable */ }
    const detail = { slug: safeSlug, items: snapshot(), ...cartTotals(memory) };
    subscribers.forEach((listener) => listener(detail));
    globalThis.dispatchEvent?.(new CustomEvent(CART_EVENT, { detail }));
  };

  return {
    slug: safeSlug,
    key,
    getItems: snapshot,
    getTotals: () => cartTotals(memory),
    add(item) {
      const normalized = normalizeCartItem(item);
      if (!normalized) throw new Error("Item de carrinho inválido.");
      const signature = cartLineSignature(normalized);
      const existing = memory.find((line) => cartLineSignature(line) === signature);
      if (existing) existing.quantity = clampInteger(existing.quantity + normalized.quantity, 1, 99);
      else memory.push(normalized);
      persist();
      return normalized.uid;
    },
    updateQuantity(uid, quantity) {
      const next = Math.floor(Number(quantity) || 0);
      if (next <= 0) memory = memory.filter((item) => item.uid !== uid);
      else memory = memory.map((item) => item.uid === uid ? { ...item, quantity: clampInteger(next, 1, 99) } : item);
      persist();
    },
    remove(uid) {
      memory = memory.filter((item) => item.uid !== uid);
      persist();
    },
    clear() {
      memory = [];
      persist();
    },
    replace(items) {
      memory = Array.isArray(items) ? items.map(normalizeCartItem).filter(Boolean) : [];
      persist();
    },
    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  };
}
