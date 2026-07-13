import { describe, expect, it } from "vitest";
import { cartLineSignature, cartTotals, createCartStore, itemSubtotal, parseCart } from "./cart.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe("vanilla public cart", () => {
  it("merges only identical product configurations", () => {
    const cart = createCartStore("teste", { storage: memoryStorage() });
    const item = {
      product_id: "p1",
      product_name: "Produto",
      unit_price: 10,
      quantity: 1,
      notes: "sem cebola",
      options: [{ option_id: "g1", option_name: "Tamanho", item_id: "i1", item_name: "Grande", extra_price: 2 }],
    };
    cart.add(item);
    cart.add({ ...item, quantity: 2 });
    cart.add({ ...item, notes: "com cebola" });
    expect(cart.getItems()).toHaveLength(2);
    expect(cart.getItems()[0].quantity).toBe(3);
    expect(cart.getTotals()).toEqual({ count: 4, subtotal: 48 });
  });

  it("normalizes corrupted persisted values without executing content", () => {
    expect(parseCart("not-json")).toEqual([]);
    expect(parseCart('{"items":[]}')).toEqual([]);
    expect(parseCart('[{"product_id":"p","product_name":"X","quantity":-4}]')[0].quantity).toBe(1);
  });

  it("uses options in line signatures and totals", () => {
    const base = { product_id: "p", unit_price: 5, notes: "", options: [] };
    const configured = { ...base, options: [{ option_id: "g", item_id: "i", extra_price: 1.5 }] };
    expect(cartLineSignature(base)).not.toBe(cartLineSignature(configured));
    expect(itemSubtotal({ ...configured, quantity: 2 })).toBe(13);
    expect(cartTotals([{ ...configured, quantity: 2 }])).toEqual({ count: 2, subtotal: 13 });
  });
});
