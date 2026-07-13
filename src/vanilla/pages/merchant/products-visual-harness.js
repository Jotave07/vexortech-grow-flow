import { render } from "./products.js";

const categories = [
  { id: "category-1", name: "Pizzas", store_id: "store-1", is_active: true, sort_order: 0 },
  { id: "category-2", name: "Bebidas", store_id: "store-1", is_active: true, sort_order: 1 },
];
const products = [
  {
    id: "product-1", store_id: "store-1", category_id: "category-1", name: "PIZZA ESPECIAL",
    description: "Massa artesanal, molho da casa e queijo gratinado.", price: 49.9, promo_price: 42.9,
    prep_time_minutes: 35, is_available: true, is_featured: true, sort_order: 0,
    image_url: "/brand/hype-icon.svg", categories: { name: "Pizzas" },
  },
  {
    id: "product-2", store_id: "store-1", category_id: "category-2", name: "SUCO DE LARANJA",
    description: "Feito na hora, sem acucar.", price: 9.5, promo_price: null,
    prep_time_minutes: 8, is_available: false, is_featured: false, sort_order: 1,
    image_url: null, categories: { name: "Bebidas" },
  },
];
const optionGroups = [
  { id: "group-1", product_id: "product-1", name: "Tamanho", is_required: true, min_choices: 1, max_choices: 1, sort_order: 0 },
  { id: "group-2", product_id: "product-1", name: "Borda", is_required: false, min_choices: 0, max_choices: 1, sort_order: 1 },
];
const optionItems = [
  { id: "item-1", option_id: "group-1", name: "Media", extra_price: 0, is_active: true, sort_order: 0 },
  { id: "item-2", option_id: "group-1", name: "Grande", extra_price: 12, is_active: true, sort_order: 1 },
  { id: "item-3", option_id: "group-2", name: "Catupiry", extra_price: 8, is_active: true, sort_order: 0 },
];

const tables = { products, categories, product_options: optionGroups, product_option_items: optionItems };

class MockQuery {
  constructor(table) {
    this.table = table;
    this.operation = "select";
    this.filters = [];
    this.values = null;
    this.singleMode = false;
  }
  select() { return this; }
  insert(values) { this.operation = "insert"; this.values = values; return this; }
  update(values) { this.operation = "update"; this.values = values; return this; }
  delete() { this.operation = "delete"; return this; }
  eq(column, value) { this.filters.push(["eq", column, value]); return this; }
  in(column, values) { this.filters.push(["in", column, values]); return this; }
  order() { return this; }
  limit() { return this; }
  single() { this.singleMode = true; return this; }
  maybeSingle() { this.singleMode = true; return this; }
  async execute() {
    let rows = [...(tables[this.table] || [])];
    for (const [operation, column, value] of this.filters) {
      if (operation === "eq") rows = rows.filter((row) => row[column] === value);
      if (operation === "in") rows = rows.filter((row) => value.includes(row[column]));
    }
    if (this.operation === "insert") {
      const values = Array.isArray(this.values) ? this.values : [this.values];
      rows = values.map((value, index) => ({ id: `created-${Date.now()}-${index}`, ...value }));
      tables[this.table].push(...rows);
    }
    if (this.operation === "update") {
      rows.forEach((row) => Object.assign(row, this.values));
    }
    if (this.operation === "delete") {
      const ids = new Set(rows.map((row) => row.id));
      tables[this.table] = tables[this.table].filter((row) => !ids.has(row.id));
    }
    return { data: this.singleMode ? rows[0] || null : rows, error: null };
  }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
}

const toastRegion = document.createElement("div");
toastRegion.setAttribute("aria-live", "polite");
document.body.append(toastRegion);

const ctx = {
  api: {
    from: (table) => new MockQuery(table),
    upload: async (_bucket, path) => ({ data: { path }, error: null }),
  },
  auth: {
    role: "store_owner",
    store: { id: "store-1", name: "Loja QA" },
    require: async () => true,
  },
  params: {},
  query: new URLSearchParams(),
  navigate: () => {},
  ui: {
    document,
    el: (tag) => document.createElement(tag),
    loading: (message) => Object.assign(document.createElement("p"), { textContent: message }),
    empty: ({ title, description }) => Object.assign(document.createElement("p"), { textContent: `${title}. ${description || ""}` }),
    money: (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    toast: (message) => { toastRegion.textContent = message; },
    confirm: async () => true,
  },
};

const page = render(ctx);
document.querySelector("#harness-app").append(page);
await page.ready;
