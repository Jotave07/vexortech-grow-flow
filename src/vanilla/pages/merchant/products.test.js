import { describe, expect, it, vi } from "vitest";
import {
  productImagePath,
  storageObjectUrl,
  uploadProductImage,
  validateProductImage,
} from "./product-assets.js";
import {
  canRemoveActiveItem,
  loadProductOptionTree,
  normalizeGroupInput,
  normalizeOptionItemInput,
} from "./product-options.js";
import { filterProducts, normalizeProductInput } from "./products.js";

describe("merchant product validation", () => {
  it("normalizes prices and optional fields without trusting raw form values", () => {
    expect(normalizeProductInput({
      name: " pizza especial ",
      description: " Massa artesanal ",
      category_id: "category-1",
      price: "49.999",
      promo_price: "39.90",
      prep_time_minutes: "35",
      is_featured: true,
      is_available: true,
    })).toEqual({
      name: "PIZZA ESPECIAL",
      description: "Massa artesanal",
      category_id: "category-1",
      price: 50,
      promo_price: 39.9,
      prep_time_minutes: 35,
      is_featured: true,
      is_available: true,
    });
    expect(() => normalizeProductInput({ name: "Pizza", price: 20, promo_price: 25 })).toThrow("promocional");
    expect(() => normalizeProductInput({ name: "Pizza", price: 20, prep_time_minutes: 0 })).toThrow("preparo");
  });

  it("searches product name, description and category", () => {
    const products = [
      { id: "1", name: "PIZZA", description: "Massa fina", categories: { name: "Jantar" } },
      { id: "2", name: "SUCO", description: "Laranja", categories: { name: "Bebidas" } },
    ];
    expect(filterProducts(products, "massa").map((item) => item.id)).toEqual(["1"]);
    expect(filterProducts(products, "bebidas").map((item) => item.id)).toEqual(["2"]);
  });
});

describe("product image upload contract", () => {
  const image = { name: "produto.jpg", type: "image/jpeg", size: 1024 };

  it("accepts only matching image types under 5 MB and creates store-scoped paths", () => {
    expect(validateProductImage(image)).toBeNull();
    expect(validateProductImage({ ...image, type: "image/png" })).toContain("nao corresponde");
    expect(validateProductImage({ ...image, size: 6 * 1024 * 1024 })).toContain("5 MB");
    expect(productImagePath("store-1", "product-1", image, () => "asset-1"))
      .toBe("store-1/products/product-1/asset-1.jpg");
    expect(storageObjectUrl("store-assets", "store-1/products/a b.jpg"))
      .toBe("/storage/store-assets/store-1/products/a%20b.jpg");
  });

  it("uses the authenticated upload gateway without upsert", async () => {
    const upload = vi.fn(async (bucket, path) => ({ data: { path }, error: null }));
    const url = await uploadProductImage({ api: { upload } }, {
      file: image,
      storeId: "store-1",
      productId: "product-1",
    });
    expect(upload).toHaveBeenCalledOnce();
    expect(upload.mock.calls[0][0]).toBe("store-assets");
    expect(upload.mock.calls[0][1]).toMatch(/^store-1\/products\/product-1\/.+\.jpg$/);
    expect(upload.mock.calls[0][3]).toEqual({ upsert: false });
    expect(url).toMatch(/^\/storage\/store-assets\/store-1\/products\/product-1\/.+\.jpg$/);
  });
});

describe("product option validation and tenant scoping", () => {
  it("enforces coherent required/optional choice bounds", () => {
    expect(normalizeGroupInput({ name: "Tamanho", is_required: true, min_choices: 1, max_choices: 2, sort_order: 0 }))
      .toMatchObject({ name: "Tamanho", min_choices: 1, max_choices: 2 });
    expect(() => normalizeGroupInput({ name: "Tamanho", is_required: true, min_choices: 0, max_choices: 1 }))
      .toThrow("obrigatorio");
    expect(() => normalizeGroupInput({ name: "Extras", is_required: false, min_choices: 1, max_choices: 2 }))
      .toThrow("opcional");
    expect(() => normalizeGroupInput({ name: "Extras", is_required: false, min_choices: 0, max_choices: 51 }))
      .toThrow("50");
  });

  it("normalizes additional prices and protects the minimum active inventory", () => {
    expect(normalizeOptionItemInput({ name: " Bacon ", extra_price: "4,50", is_active: true, sort_order: 2 }))
      .toEqual({ name: "Bacon", extra_price: 4.5, is_active: true, sort_order: 2 });
    expect(() => normalizeOptionItemInput({ name: "Bacon", extra_price: -1 })).toThrow("nao negativo");
    const group = { min_choices: 1 };
    const item = { id: "i1", is_active: true };
    expect(canRemoveActiveItem(group, [item], item)).toBe(false);
    expect(canRemoveActiveItem(group, [item, { id: "i2", is_active: true }], item)).toBe(true);
  });

  it("verifies product ownership and scopes option queries to the selected product", async () => {
    const calls = [];
    const rows = {
      products: [{ id: "product-1", store_id: "store-1" }],
      product_options: [{ id: "group-1", product_id: "product-1", name: "Tamanho", sort_order: 0 }],
      product_option_items: [{ id: "item-1", option_id: "group-1", name: "Grande", sort_order: 0 }],
    };
    const api = {
      from(table) {
        const filters = [];
        let maybeSingle = false;
        const builder = {
          select() { return builder; },
          eq(column, value) { filters.push(["eq", column, value]); return builder; },
          in(column, value) { filters.push(["in", column, value]); return builder; },
          order() { return builder; },
          maybeSingle() { maybeSingle = true; return builder; },
          then(resolve, reject) {
            calls.push({ table, filters });
            let data = rows[table] || [];
            for (const [, column, value] of filters.filter(([operation]) => operation === "eq")) {
              data = data.filter((row) => row[column] === value);
            }
            const result = { data: maybeSingle ? data[0] || null : data, error: null };
            return Promise.resolve(result).then(resolve, reject);
          },
        };
        return builder;
      },
    };
    const tree = await loadProductOptionTree({ api }, { productId: "product-1", storeId: "store-1" });
    expect(tree[0].items).toEqual([expect.objectContaining({ id: "item-1" })]);
    expect(calls[0]).toEqual({
      table: "products",
      filters: [["eq", "id", "product-1"], ["eq", "store_id", "store-1"]],
    });
    expect(calls[1].filters).toContainEqual(["eq", "product_id", "product-1"]);
    expect(calls[2].filters).toContainEqual(["in", "option_id", ["group-1"]]);
  });
});
