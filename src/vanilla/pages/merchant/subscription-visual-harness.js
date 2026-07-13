import { render } from "./subscription.js";

const storeId = "10000000-0000-4000-8000-000000000001";
const tables = {
  plans: [
    {
      id: "30000000-0000-4000-8000-000000000001",
      name: "Essencial",
      description: "Cardapio digital e operacao de pedidos.",
      price_monthly: 39.9,
      features: ["Cardapio digital", "Gestao de pedidos"],
      is_active: true,
      sort_order: 1,
    },
    {
      id: "30000000-0000-4000-8000-000000000002",
      name: "Profissional",
      description: "Automacoes, cupons e relatorios avancados.",
      price_monthly: 79.9,
      features: ["Cupons", "Relatorios", "Automacoes"],
      is_active: true,
      sort_order: 2,
    },
  ],
  subscriptions: [],
  stores: [
    {
      id: storeId,
      name: "Cafe Hype Centro",
      document: "52998224725",
      email: "ana@cafehype.test",
      whatsapp: "11999999999",
      zip_code: "01310100",
      address_number: "100",
      address_complement: "Sala 2",
    },
  ],
};

class MockQuery {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.singleMode = false;
  }
  select() { return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  order() { return this; }
  maybeSingle() { this.singleMode = true; return this; }
  async execute() {
    let rows = [...(tables[this.table] || [])];
    for (const [column, value] of this.filters) rows = rows.filter((row) => row[column] === value);
    return { data: this.singleMode ? rows[0] || null : rows, error: null };
  }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
}

const ctx = {
  api: {
    from: (table) => new MockQuery(table),
    fn: async () => ({ data: { success: true }, error: null }),
  },
  auth: {
    role: "store_owner",
    store: { id: storeId, name: "Cafe Hype Centro" },
    profile: { full_name: "Ana Parceira", document: "52998224725" },
    session: { user: { email: "ana@cafehype.test" } },
    require: async () => true,
  },
  params: {},
  query: new URLSearchParams(),
  navigate: () => {},
  ui: {
    document,
    el: (tag) => document.createElement(tag),
    loading: (message) => Object.assign(document.createElement("p"), { textContent: message }),
    empty: ({ title, description }) =>
      Object.assign(document.createElement("p"), { textContent: `${title}. ${description || ""}` }),
    money: (value) =>
      Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }),
    date: (value) => new Date(value).toLocaleDateString("pt-BR"),
    toast: () => {},
    confirm: async () => true,
  },
};

const page = render(ctx);
document.querySelector("#harness-app").append(page);
await page.ready;
const subscribeButton = [...page.querySelectorAll("button")].find(
  (control) => control.textContent === "Assinar este plano",
);
subscribeButton?.click();
