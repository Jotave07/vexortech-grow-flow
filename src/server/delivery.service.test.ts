import { describe, expect, it, vi } from "vitest";
import {
  deliveryConfigurationFingerprint,
  quoteDelivery,
  resolveRadiusDeliveryPricing,
} from "./delivery.service";

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
  delivery_base_fee: 4,
  delivery_fee_per_km: 1.5,
  min_order_value: 0,
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

const createDeps = (
  overrides: {
    zones?: any[];
    settings?: any;
    distanceKm?: number;
  } = {},
) => ({
  query: vi.fn(async (sql: string) => {
    if (sql.includes("FROM public.stores")) return { rows: [store] };
    if (sql.includes("FROM public.store_settings"))
      return { rows: [{ ...settings, ...overrides.settings }] };
    if (sql.includes("FROM public.delivery_zones")) return { rows: overrides.zones ?? [] };
    return { rows: [] };
  }),
  cepLookup: vi.fn(async (cep: string) => ({
    cep,
    street: "Praca da Se",
    neighborhood: "SE",
    city: "SAO PAULO",
    state: "SP",
    lat: -23.55,
    lng: -46.63,
  })),
  geocode: vi.fn(async () => ({ lat: -23.56, lng: -46.64 })),
  distance: vi.fn(async () => ({ distanceKm: overrides.distanceKm ?? 2, mode: "route" as const })),
});

describe("quoteDelivery", () => {
  it("calculates fixed and per-km fee inside global radius and CEP region", async () => {
    const deps = createDeps({
      zones: [
        {
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
        },
      ],
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

  it("matches CEP range and resolves distance when only CEP is provided", async () => {
    const deps = createDeps({
      settings: { delivery_radius_km: null },
      zones: [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          name: "Vila Velha",
          zip_start: "29126-000",
          zip_end: "29154999",
          fee: 7,
          fee_per_km: 0,
          min_order: 0,
          base_prep_time: 25,
          priority: 0,
        },
      ],
    });

    const quote = await quoteDelivery(
      {
        ...input,
        address: {
          cep: "29154-312",
          street: "",
          number: "",
          neighborhood: "",
          city: "",
          state: "",
        },
        customerCoordinates: null,
      },
      deps as any,
    );

    expect(quote).toMatchObject({
      available: true,
      fee: 7,
      distanceKm: 2,
      estimatedMin: 35,
      regionName: "Vila Velha",
      source: "region",
    });
    expect(deps.distance).toHaveBeenCalled();
    expect(deps.cepLookup).toHaveBeenCalledWith("29154312");
  });

  it("resolves CEP server-side when the tester sends only CEP and the region is city based", async () => {
    const deps = createDeps({
      zones: [
        {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          name: "Se",
          city: "SAO PAULO",
          state: "SP",
          neighborhood: "SE",
          fee: 9,
          min_order: 0,
          base_prep_time: 30,
        },
      ],
    });

    const quote = await quoteDelivery(
      {
        ...input,
        address: {
          cep: "01001000",
          street: "",
          number: "",
          neighborhood: "",
          city: "",
          state: "",
        },
        customerCoordinates: null,
      },
      deps as any,
    );

    expect(quote).toMatchObject({
      available: true,
      fee: 9,
      regionName: "Se",
    });
    expect(deps.cepLookup).toHaveBeenCalledWith("01001000");
  });

  it("applies store-level free delivery in the same backend quote used by checkout and tests", async () => {
    const deps = createDeps({
      settings: { free_delivery_above: 80 },
      zones: [
        {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          name: "Centro",
          city: "SAO PAULO",
          state: "SP",
          neighborhood: "SE",
          fee: 12,
          min_order: 0,
        },
      ],
    });

    const quote = await quoteDelivery(input, deps as any);

    expect(quote.available).toBe(true);
    expect(quote.fee).toBe(0);
  });

  it("rejects addresses outside the global delivery radius", async () => {
    const deps = createDeps({ distanceKm: 11 });

    const quote = await quoteDelivery(input, deps as any);

    expect(quote.available).toBe(false);
    expect(quote.reason).toContain("fora do raio");
  });

  it("quotes addresses inside the global radius when no active region matches", async () => {
    const deps = createDeps({
      zones: [],
      distanceKm: 4,
      settings: { free_delivery_above: 150 },
    });

    const quote = await quoteDelivery(input, deps as any);

    expect(quote).toMatchObject({
      available: true,
      fee: 10,
      distanceKm: 4,
      estimatedMin: 50,
      estimatedMax: 63,
      regionId: null,
      regionName: null,
      source: "radius",
    });
    expect(quote.configurationFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses the legacy fixed fee only when radius pricing was never configured", async () => {
    const legacyDeps = createDeps({
      zones: [],
      distanceKm: 4,
      settings: { delivery_base_fee: 0, delivery_fee_per_km: 0, delivery_fee: 6 },
    });
    const currentDeps = createDeps({
      zones: [],
      distanceKm: 4,
      settings: { delivery_base_fee: 0, delivery_fee_per_km: 2, delivery_fee: 6 },
    });

    expect(
      resolveRadiusDeliveryPricing({
        delivery_base_fee: 0,
        delivery_fee_per_km: 0,
        delivery_fee: 6,
      }),
    ).toEqual({ baseFee: 6, feePerKm: 0 });
    await expect(quoteDelivery(input, legacyDeps as any)).resolves.toMatchObject({
      available: true,
      fee: 6,
      source: "radius",
    });
    await expect(quoteDelivery(input, currentDeps as any)).resolves.toMatchObject({
      available: true,
      fee: 8,
      source: "radius",
    });
  });

  it("includes the legacy fee in quote invalidation fingerprints", () => {
    const first = deliveryConfigurationFingerprint(
      store,
      {
        ...settings,
        delivery_base_fee: 0,
        delivery_fee_per_km: 0,
        delivery_fee: 5,
      },
      [],
    );
    const second = deliveryConfigurationFingerprint(
      store,
      {
        ...settings,
        delivery_base_fee: 0,
        delivery_fee_per_km: 0,
        delivery_fee: 6,
      },
      [],
    );
    expect(first).not.toBe(second);
  });

  it("applies store-level free delivery to a radius fallback quote", async () => {
    const deps = createDeps({
      zones: [],
      distanceKm: 4,
      settings: { free_delivery_above: 80 },
    });

    const quote = await quoteDelivery(input, deps as any);

    expect(quote.available).toBe(true);
    expect(quote.fee).toBe(0);
    expect(quote.source).toBe("radius");
  });

  it("fails closed when distance is unavailable for the global radius fallback", async () => {
    const deps = createDeps({ zones: [] });
    deps.cepLookup.mockResolvedValueOnce({
      cep: "01001000",
      street: "Praca da Se",
      neighborhood: "SE",
      city: "SAO PAULO",
      state: "SP",
    } as any);
    deps.geocode.mockResolvedValueOnce(null as any);

    const quote = await quoteDelivery(input, deps as any);

    expect(quote.available).toBe(false);
    expect(quote.reason).toContain("calcular a distancia");
    expect(deps.distance).not.toHaveBeenCalled();
  });

  it("enforces the store minimum order on the global radius fallback", async () => {
    const deps = createDeps({
      zones: [],
      distanceKm: 2,
      settings: { min_order_value: 120 },
    });

    const quote = await quoteDelivery(input, deps as any);

    expect(quote).toMatchObject({
      available: false,
      fee: 7,
      distanceKm: 2,
      source: "radius",
    });
    expect(quote.reason).toContain("Pedido minimo");
  });

  it("fails closed when the server cannot validate the CEP", async () => {
    const deps = createDeps({
      zones: [{ city: "SAO PAULO", state: "SP", neighborhood: "CENTRO", fee: 1 }],
    });
    deps.cepLookup.mockRejectedValueOnce(new Error("provider unavailable"));

    const quote = await quoteDelivery(input, deps as any);

    expect(quote.available).toBe(false);
    expect(quote.reason).toContain("validar o CEP");
    expect(deps.distance).not.toHaveBeenCalled();
  });

  it("fails closed when a matched distance-based region cannot calculate distance", async () => {
    const deps = createDeps({
      settings: { delivery_radius_km: null },
      zones: [
        {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          name: "Centro por distancia",
          city: "SAO PAULO",
          state: "SP",
          neighborhood: "SE",
          fee: 5,
          fee_per_km: 2,
          max_radius_km: 8,
          min_order: 0,
        },
      ],
    });
    deps.cepLookup.mockResolvedValueOnce({
      cep: "01001000",
      street: "Praca da Se",
      neighborhood: "SE",
      city: "SAO PAULO",
      state: "SP",
    } as any);
    deps.geocode.mockResolvedValueOnce(null as any);

    const quote = await quoteDelivery({ ...input, customerCoordinates: null }, deps as any);

    expect(quote).toMatchObject({
      available: false,
      fee: 0,
      regionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      source: "region",
    });
    expect(quote.reason).toContain("calcular a distancia");
    expect(deps.distance).not.toHaveBeenCalled();
  });

  it("keeps a purely fixed matched region available when distance is unavailable", async () => {
    const deps = createDeps({
      settings: { delivery_radius_km: null },
      zones: [
        {
          id: "99999999-9999-4999-8999-999999999999",
          name: "Centro fixo",
          city: "SAO PAULO",
          state: "SP",
          neighborhood: "SE",
          fee: 7,
          fee_per_km: 0,
          max_radius_km: null,
          min_order: 0,
        },
      ],
    });
    deps.cepLookup.mockResolvedValueOnce({
      cep: "01001000",
      street: "Praca da Se",
      neighborhood: "SE",
      city: "SAO PAULO",
      state: "SP",
    } as any);
    deps.geocode.mockResolvedValueOnce(null as any);

    const quote = await quoteDelivery({ ...input, customerCoordinates: null }, deps as any);

    expect(quote).toMatchObject({
      available: true,
      fee: 7,
      regionId: "99999999-9999-4999-8999-999999999999",
      source: "region",
    });
    expect(quote).not.toHaveProperty("distanceKm");
  });

  it("matches neighborhood fallback and applies min and max fee", async () => {
    const deps = createDeps({
      zones: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Bairro",
          city: "SAO PAULO",
          state: "SP",
          neighborhood: "SE",
          fee: 2,
          fee_per_km: 10,
          min_fee: 15,
          max_fee: 20,
          min_order: 0,
          base_prep_time: 30,
          minutes_per_km: 1,
          additional_region_time: 0,
        },
      ],
      distanceKm: 3,
    });

    const quote = await quoteDelivery(input, deps as any);

    expect(quote.available).toBe(true);
    expect(quote.fee).toBe(20);
  });

  it("validates minimum order", async () => {
    const deps = createDeps({
      zones: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          name: "Cidade",
          city: "SAO PAULO",
          state: "SP",
          fee: 3,
          min_order: 120,
        },
      ],
    });

    const quote = await quoteDelivery(input, deps as any);

    expect(quote.available).toBe(false);
    expect(quote.reason).toContain("Pedido minimo");
  });

  it.each([
    ["negative fee", { fee: -1 }],
    ["NaN fee", { fee: "NaN" }],
    ["infinite per-km fee", { fee_per_km: "Infinity" }],
    ["inverted bounds", { min_fee: 20, max_fee: 10 }],
    ["invalid radius", { max_radius_km: -1 }],
    ["invalid timing", { minutes_per_km: -1 }],
  ])("fails closed for an active region with %s", async (_label, invalidValues) => {
    const deps = createDeps({
      zones: [
        {
          id: "abababab-abab-4bab-8bab-abababababab",
          name: "Centro invalido",
          city: "SAO PAULO",
          state: "SP",
          neighborhood: "SE",
          fee: 5,
          fee_per_km: 0,
          min_order: 0,
          base_prep_time: 30,
          minutes_per_km: 5,
          additional_region_time: 0,
          priority: 0,
          is_active: true,
          ...invalidValues,
        },
      ],
    });

    const quote = await quoteDelivery(input, deps as any);

    expect(quote).toMatchObject({ available: false, fee: 0 });
    expect(quote.reason).toContain("configuracao das regioes");
    expect(deps.distance).not.toHaveBeenCalled();
  });
});
