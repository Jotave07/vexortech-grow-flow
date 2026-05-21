import { describe, expect, it, vi } from "vitest";
import { quoteDelivery } from "./delivery.service";

const storeId = "22222222-2222-4222-8222-222222222222";

const store = {
  id: storeId,
  is_active: true,
  is_suspended: false,
  latitude: -23.55,
  longitude: -46.63,
  address: "Rua da Loja",
  address_number: "10",
  city: "SAO PAULO",
  state: "SP",
};

const settings = {
  store_id: storeId,
  allow_delivery: true,
  delivery_radius_km: 10,
  avg_prep_time_minutes: 30,
};

const input = {
  storeId,
  subtotal: 100,
  address: {
    cep: "01001000",
    street: "Rua Cliente",
    number: "123",
    neighborhood: "Centro",
    city: "Sao Paulo",
    state: "SP",
  },
  customerCoordinates: { lat: -23.56, lng: -46.64 },
};

const createDeps = (overrides: {
  zones?: any[];
  settings?: any;
  distanceKm?: number;
} = {}) => ({
  query: vi.fn(async (sql: string) => {
    if (sql.includes("FROM public.stores")) return { rows: [store] };
    if (sql.includes("FROM public.store_settings")) return { rows: [{ ...settings, ...overrides.settings }] };
    if (sql.includes("FROM public.delivery_zones")) return { rows: overrides.zones ?? [] };
    return { rows: [] };
  }),
  geocode: vi.fn(async () => ({ lat: -23.56, lng: -46.64 })),
  distance: vi.fn(async () => ({ distanceKm: overrides.distanceKm ?? 2, mode: "route" as const })),
});

describe("quoteDelivery", () => {
  it("calculates fixed and per-km fee inside global radius and CEP region", async () => {
    const deps = createDeps({
      zones: [{
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        name: "Centro",
        zip_start: "01000000",
        zip_end: "01099999",
        fee: 5,
        fee_per_km: 2,
        min_fee: null,
        max_fee: null,
        min_order: 0,
        base_prep_time: 20,
        minutes_per_km: 5,
        additional_region_time: 3,
        priority: 0,
      }],
      distanceKm: 2.5,
    });

    const quote = await quoteDelivery(input, deps as any);

    expect(quote).toMatchObject({
      available: true,
      fee: 10,
      distanceKm: 2.5,
      estimatedMin: 36,
      regionName: "Centro",
      source: "region",
    });
  });

  it("rejects addresses outside the global delivery radius", async () => {
    const deps = createDeps({ distanceKm: 11 });

    const quote = await quoteDelivery(input, deps as any);

    expect(quote.available).toBe(false);
    expect(quote.reason).toContain("fora do raio");
  });

  it("rejects addresses inside radius but outside active regions", async () => {
    const deps = createDeps({ zones: [] });

    const quote = await quoteDelivery(input, deps as any);

    expect(quote.available).toBe(false);
    expect(quote.reason).toContain("ainda nao entrega");
  });

  it("matches neighborhood fallback and applies min and max fee", async () => {
    const deps = createDeps({
      zones: [{
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Bairro",
        city: "SAO PAULO",
        state: "SP",
        neighborhood: "CENTRO",
        fee: 2,
        fee_per_km: 10,
        min_fee: 15,
        max_fee: 20,
        min_order: 0,
        base_prep_time: 30,
        minutes_per_km: 1,
        additional_region_time: 0,
      }],
      distanceKm: 3,
    });

    const quote = await quoteDelivery(input, deps as any);

    expect(quote.available).toBe(true);
    expect(quote.fee).toBe(20);
  });

  it("validates minimum order", async () => {
    const deps = createDeps({
      zones: [{
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        name: "Cidade",
        city: "SAO PAULO",
        state: "SP",
        fee: 3,
        min_order: 120,
      }],
    });

    const quote = await quoteDelivery(input, deps as any);

    expect(quote.available).toBe(false);
    expect(quote.reason).toContain("Pedido minimo");
  });
});
