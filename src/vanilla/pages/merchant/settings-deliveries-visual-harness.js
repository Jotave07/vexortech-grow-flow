import { render as renderDeliveries } from "./deliveries.js";
import { render as renderSettings } from "./settings.js";

const tables = {
  stores: [{
    id: "store-1", name: "CAFÉ HYPE", public_name: "Café Hype", whatsapp: "11999998888",
    logo_url: "/brand/hype-icon.svg", cover_url: null,
    description: "Café artesanal, almoço fresco e entrega cuidadosa.", zip_code: "01310100",
    address: "Avenida Paulista", address_number: "1000", address_complement: "Loja 2",
    neighborhood: "Bela Vista", city: "São Paulo", state: "SP",
    primary_color: "#b2d83f", secondary_color: "#303938",
  }],
  store_settings: [{
    store_id: "store-1", avg_prep_time_minutes: 30, min_order_value: 20, is_open: true,
    allow_delivery: true, allow_pickup: true, accept_orders_when_closed: false,
    accept_pix: true, pix_key: "financeiro@cafehype.test", pix_key_type: "EMAIL",
    payment_instructions: "Envie o comprovante pelo WhatsApp.", accept_cash: true,
    accept_card_on_delivery: true, delivery_radius_km: 12,
    business_hours: {
      mon: { enabled: true, open: "08:00", close: "19:00" },
      tue: { enabled: true, open: "08:00", close: "19:00" },
      wed: { enabled: true, open: "08:00", close: "19:00" },
      thu: { enabled: true, open: "08:00", close: "19:00" },
      fri: { enabled: true, open: "08:00", close: "20:00" },
      sat: { enabled: true, open: "09:00", close: "18:00" },
      sun: { enabled: false, open: "09:00", close: "18:00" },
    },
  }],
  delivery_zones: [
    {
      id: "zone-1", store_id: "store-1", name: "Centro expandido", neighborhood: "BELA VISTA",
      city: "SÃO PAULO", state: "SP", zip_start: "01000000", zip_end: "01599999",
      max_radius_km: 8, fee: 6, fee_per_km: 1.25, min_fee: 8, max_fee: 24,
      min_order: 30, base_prep_time: 25, minutes_per_km: 4, additional_region_time: 5,
      priority: 20, is_active: true, internal_notes: "Evitar vias expressas no pico.",
    },
    {
      id: "zone-2", store_id: "store-1", name: "Zona oeste", neighborhood: "GERAL",
      city: "SÃO PAULO", state: "SP", zip_start: null, zip_end: null,
      max_radius_km: 12, fee: 9, fee_per_km: 1.5, min_fee: null, max_fee: 32,
      min_order: 40, base_prep_time: 30, minutes_per_km: 5, additional_region_time: 10,
      priority: 5, is_active: true, internal_notes: null,
    },
    {
      id: "zone-3", store_id: "store-1", name: "Regra sazonal", neighborhood: "PINHEIROS",
      city: "SÃO PAULO", state: "SP", zip_start: null, zip_end: null,
      max_radius_km: 6, fee: 5, fee_per_km: 1, min_fee: null, max_fee: null,
      min_order: 25, base_prep_time: 25, minutes_per_km: 4, additional_region_time: 0,
      priority: 10, is_active: false, internal_notes: "Ativar em eventos.",
    },
  ],
  delivery_drivers: [],
};

class MockQuery {
  constructor(table) {
    this.table = table;
    this.operation = "select";
    this.filters = [];
    this.values = null;
    this.singleMode = false;
    this.ordering = null;
  }
  select() { return this; }
  insert(values) { this.operation = "insert"; this.values = values; return this; }
  update(values) { this.operation = "update"; this.values = values; return this; }
  delete() { this.operation = "delete"; return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  order(column, options = {}) { this.ordering = [column, options.ascending !== false]; return this; }
  maybeSingle() { this.singleMode = true; return this; }
  async execute() {
    let rows = [...(tables[this.table] || [])];
    for (const [column, value] of this.filters) rows = rows.filter((row) => row[column] === value);
    if (this.ordering) {
      const [column, ascending] = this.ordering;
      rows.sort((left, right) => (Number(left[column] || 0) - Number(right[column] || 0)) * (ascending ? 1 : -1));
    }
    if (this.operation === "insert") {
      rows = [{ id: `created-${Date.now()}`, ...this.values }];
      tables[this.table].push(...rows);
    }
    if (this.operation === "update") rows.forEach((row) => Object.assign(row, this.values));
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
toastRegion.className = "merchant-live";
document.body.append(toastRegion);

const ctx = {
  api: {
    from: (table) => new MockQuery(table),
    upload: async (_bucket, path) => ({ data: { path }, error: null }),
    fn: async (name, body) => {
      if (name === "merchant-update-settings") return { data: { success: true, body }, error: null };
      if (name === "quote-delivery") {
        const cep = String(body?.address?.cep || "").replace(/\D/g, "");
        const normalizedAddress = cep === "01310100"
          ? { cep, street: "Avenida Paulista", neighborhood: "Bela Vista", city: "São Paulo", state: "SP" }
          : { cep, street: "Rua Harmonia", neighborhood: "Vila Madalena", city: "São Paulo", state: "SP" };
        return {
          data: {
            available: true, fee: 12.25, distanceKm: 5, estimatedMin: 50, estimatedMax: 63,
            regionId: "zone-1", regionName: "Centro expandido", source: "region", normalizedAddress,
          },
          error: null,
        };
      }
      return { data: null, error: { message: "Função não simulada." } };
    },
  },
  auth: {
    role: "store_owner",
    store: { id: "store-1", name: "Café Hype" },
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
    toast: (message) => { toastRegion.textContent = typeof message === "string" ? message : message?.message || ""; },
    confirm: async () => true,
  },
};

const view = new URLSearchParams(location.search).get("view") === "deliveries" ? "deliveries" : "settings";
const page = view === "deliveries" ? renderDeliveries(ctx) : renderSettings(ctx);
document.querySelector("#harness-app").append(page);
await page.ready;
