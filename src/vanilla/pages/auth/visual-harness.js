import { ui } from "../../core/ui.js";
import { routes as adminRoutes } from "../admin/index.js";
import { routes as authRoutes } from "./index.js";

const now = new Date().toISOString();
const fixtures = {
  stores: [
    {
      id: "10000000-0000-4000-8000-000000000001",
      owner_user_id: "20000000-0000-4000-8000-000000000001",
      name: "Cafe Hype Centro",
      slug: "cafe-hype-centro",
      email: "contato@cafehype.test",
      is_active: true,
      is_suspended: false,
      created_at: now,
      subscriptions: [
        {
          status: "ativa",
          plan_id: "30000000-0000-4000-8000-000000000001",
          asaas_subscription_id: "sub_visual",
          plans: { name: "Profissional", price_monthly: 79.9 },
        },
      ],
    },
    {
      id: "10000000-0000-4000-8000-000000000002",
      owner_user_id: "20000000-0000-4000-8000-000000000002",
      name: "Mercado Bairro",
      slug: "mercado-bairro",
      is_active: false,
      is_suspended: true,
      created_at: now,
      subscriptions: [],
    },
  ],
  plans: [
    {
      id: "30000000-0000-4000-8000-000000000001",
      name: "Profissional",
      slug: "profissional",
      price_monthly: 79.9,
      max_products: 500,
      max_orders_per_month: 2000,
      is_active: true,
      sort_order: 1,
      features: ["Cupons", "Relatorios"],
    },
    {
      id: "30000000-0000-4000-8000-000000000002",
      name: "Essencial",
      slug: "essencial",
      price_monthly: 39.9,
      max_products: 100,
      max_orders_per_month: 500,
      is_active: true,
      sort_order: 2,
      features: ["Cardapio digital"],
    },
  ],
  profiles: [
    {
      id: "40000000-0000-4000-8000-000000000001",
      user_id: "20000000-0000-4000-8000-000000000001",
      store_id: "10000000-0000-4000-8000-000000000001",
      role: "store_owner",
      full_name: "Ana Parceira",
      email: "ana@cafehype.test",
      document: "12ABC34501DE35",
      is_exempt: false,
      created_at: now,
    },
    {
      id: "40000000-0000-4000-8000-000000000002",
      user_id: "50000000-0000-4000-8000-000000000001",
      role: "customer",
      full_name: "Cliente Visual",
      email: "cliente@exemplo.test",
      document: "52998224725",
      created_at: now,
    },
  ],
  orders: [
    {
      id: "60000000-0000-4000-8000-000000000001",
      order_number: 1042,
      store_id: "10000000-0000-4000-8000-000000000001",
      customer_name: "Marina Costa",
      customer_phone: "11999999999",
      total: 128.5,
      status: "em_preparo",
      payment_status: "pago",
      payment_method: "pix",
      created_at: now,
      stores: { name: "Cafe Hype Centro", slug: "cafe-hype-centro" },
    },
    {
      id: "60000000-0000-4000-8000-000000000002",
      order_number: 1041,
      store_id: "10000000-0000-4000-8000-000000000001",
      customer_name: "Paulo Lima",
      total: 54.9,
      status: "entregue",
      payment_status: "pago",
      payment_method: "credit_card",
      created_at: now,
      stores: { name: "Cafe Hype Centro", slug: "cafe-hype-centro" },
    },
  ],
  subscriptions: [
    {
      id: "70000000-0000-4000-8000-000000000001",
      store_id: "10000000-0000-4000-8000-000000000001",
      status: "ativa",
      asaas_subscription_id: "sub_visual",
      updated_at: now,
      stores: { name: "Cafe Hype Centro" },
      plans: { name: "Profissional", price_monthly: 79.9 },
    },
    {
      id: "70000000-0000-4000-8000-000000000002",
      store_id: "10000000-0000-4000-8000-000000000002",
      status: "pendente_pagamento",
      updated_at: now,
      stores: { name: "Mercado Bairro" },
      plans: { name: "Essencial", price_monthly: 39.9 },
    },
  ],
  order_items: [
    {
      id: "80000000-0000-4000-8000-000000000001",
      product_name: "Combo Hype",
      quantity: 2,
      unit_price: 49.9,
      subtotal: 99.8,
    },
  ],
  order_status_history: [
    { status: "em_preparo", notes: "Cozinha iniciou o preparo", created_at: now },
  ],
  user_roles: [
    { id: "role-admin", user_id: "90000000-0000-4000-8000-000000000001", role: "super_admin" },
  ],
  audit_logs: [
    { id: "audit-1", action: "store.reviewed", entity_type: "store", created_at: now },
    { id: "audit-2", action: "plan.updated", entity_type: "plan", created_at: now },
  ],
};

class MockQuery {
  constructor(table) {
    this.table = table;
    this.head = false;
  }
  select(columns = "*", options = {}) {
    void columns;
    this.head = Boolean(options.head);
    return this;
  }
  insert() {
    return this;
  }
  update() {
    return this;
  }
  delete() {
    return this;
  }
  upsert() {
    return this;
  }
  eq() {
    return this;
  }
  neq() {
    return this;
  }
  gte() {
    return this;
  }
  in() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybeSingle";
    return this;
  }
  async execute() {
    const rows = fixtures[this.table] || [];
    if (this.head) return { data: null, error: null, count: rows.length };
    if (this.mode === "single")
      return { data: rows[0] || null, error: rows[0] ? null : { message: "Nao encontrado" } };
    if (this.mode === "maybeSingle") return { data: rows[0] || null, error: null };
    return { data: rows, error: null };
  }
  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

const api = {
  from: (table) => new MockQuery(table),
  fn: async (name) =>
    name === "admin-financial-orders"
      ? {
          data: {
            orders: [
              {
                ...fixtures.orders[0],
                store_name: "Cafe Hype Centro",
                transfer_status: "FALHOU",
                refund_status: "NAO_SOLICITADO",
                pix_key: "financeiro@cafehype.test",
                pix_key_type: "EMAIL",
              },
            ],
          },
          error: null,
        }
      : { data: { success: true }, error: null },
};

const auth = {
  session: { user: { id: "90000000-0000-4000-8000-000000000001", email: "admin@hype.test" } },
  profile: { role: "super_admin", full_name: "Admin Visual" },
  role: "super_admin",
  require: () => true,
  signIn: async () => ({ data: { session: {} }, error: null }),
  signUp: async () => ({ data: { session: null }, error: null }),
  signUpMerchant: async () => ({ data: { session: null }, error: null }),
  resetPassword: async () => ({ data: { sent: true }, error: null }),
  updateUser: async () => ({ data: {}, error: null }),
  oauth: async () => ({ data: { url: "#oauth-simulado" }, error: null }),
  refresh: async () => auth,
  signOut: async () => {},
};

const pageName = new URLSearchParams(location.search).get("page") || "login";
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.url, location.origin);
  if (pageName === "settings" && url.pathname === "/api/health") {
    return Promise.resolve(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }
  return realFetch(input, init);
};
const routeByPage = {
  login: authRoutes.find((route) => route.pattern === "/entrar"),
  signup: authRoutes.find((route) => route.pattern === "/cadastrar"),
  merchant: authRoutes.find((route) => route.pattern === "/cadastrar-loja"),
  forgot: authRoutes.find((route) => route.pattern === "/recuperar-senha"),
  onboarding: authRoutes.find((route) => route.pattern === "/onboarding"),
  dashboard: adminRoutes.find((route) => route.pattern === "/admin"),
  stores: adminRoutes.find((route) => route.pattern === "/admin/lojas"),
  plans: adminRoutes.find((route) => route.pattern === "/admin/planos"),
  orders: adminRoutes.find((route) => route.pattern === "/admin/pedidos"),
  finance: adminRoutes.find((route) => route.pattern === "/admin/financeiro"),
  registrations: adminRoutes.find((route) => route.pattern === "/admin/cadastros"),
  settings: adminRoutes.find((route) => route.pattern === "/admin/configuracoes"),
};
const route = routeByPage[pageName] || routeByPage.login;
const ctx = {
  api,
  auth:
    pageName === "login" ||
    pageName === "signup" ||
    pageName === "merchant" ||
    pageName === "forgot"
      ? { ...auth, session: null, profile: null, role: null }
      : auth,
  ui,
  params: {},
  query: new URLSearchParams(),
  path: route.pattern,
  navigate: (path) => ui.toast(`Navegacao simulada para ${path}`, "info"),
};
const rendered = await route.render(ctx);
document.querySelector("#app").replaceChildren(rendered);
