import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertActiveMerchantSubscription: vi.fn(),
  clientQuery: vi.fn(),
  getActor: vi.fn(),
  publishRealtime: vi.fn(),
  signUp: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("./auth", () => ({
  assertActiveMerchantSubscription: mocks.assertActiveMerchantSubscription,
  getActor: mocks.getActor,
  signUp: mocks.signUp,
}));

vi.mock("./db", () => ({
  query: vi.fn(),
  withTransaction: mocks.withTransaction,
}));

vi.mock("./realtime", () => ({
  publishRealtime: mocks.publishRealtime,
}));

import { invokeFunction } from "./functions";

const storeId = "11111111-1111-4111-8111-111111111111";
const actor = {
  user: { id: "22222222-2222-4222-8222-222222222222" },
  admin: false,
  roles: new Set(["store_owner"]),
  ownedStoreIds: [storeId],
};

const validBody = () => ({
  storeId,
  store: {
    public_name: "Cafe Hype",
    whatsapp: "11999998888",
    logo_url: null,
    cover_url: null,
    description: "Cafe e entrega.",
    zip_code: "01310100",
    address: "Avenida Paulista",
    address_number: "1000",
    address_complement: null,
    neighborhood: "Bela Vista",
    city: "Sao Paulo",
    state: "SP",
    primary_color: "#b2d83f",
    secondary_color: "#303938",
  },
  settings: {
    avg_prep_time_minutes: 30,
    min_order_value: 20,
    is_open: true,
    allow_delivery: true,
    allow_pickup: true,
    accept_orders_when_closed: false,
    accept_pix: false,
    pix_key: null,
    pix_key_type: "KEY",
    payment_instructions: null,
    accept_cash: true,
    accept_card_on_delivery: true,
    delivery_radius_km: 12,
    delivery_base_fee: 4.75,
    delivery_fee_per_km: 1.25,
    business_hours: {},
  },
});

describe("merchant-update-settings radius pricing", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getActor.mockResolvedValue(actor);
    mocks.assertActiveMerchantSubscription.mockResolvedValue(undefined);
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT s.id")) {
        return {
          rows: [
            {
              id: storeId,
              financeiro_ativo: false,
              payment_gateway_api_key: null,
              asaas_api_key: null,
              delivery_base_fee: 0,
              delivery_fee_per_km: 0,
              delivery_fee: 7.5,
            },
          ],
        };
      }
      if (sql.includes("UPDATE public.stores SET")) return { rows: [{ id: storeId }] };
      return { rows: [] };
    });
    mocks.withTransaction.mockImplementation(async (callback) =>
      callback({ query: mocks.clientQuery }),
    );
  });

  it("persists base and per-km values while synchronizing the legacy fixed fee", async () => {
    await expect(invokeFunction("merchant-update-settings", validBody(), "token")).resolves.toEqual(
      { data: { success: true }, error: null },
    );

    const insertCall = mocks.clientQuery.mock.calls.find(([statement]) =>
      statement.includes("INSERT INTO public.store_settings"),
    );
    expect(insertCall).toBeDefined();
    const [sql, parameters] = insertCall!;
    expect(sql).toContain("delivery_base_fee, delivery_fee_per_km");
    expect(sql).toContain("delivery_fee=EXCLUDED.delivery_fee");
    expect(parameters.slice(15, 18)).toEqual([4.75, 1.25, 4.75]);
  });

  it("preserves a legacy fixed fee when an older client omits the new fields", async () => {
    const body = validBody();
    const settings = body.settings as Record<string, unknown>;
    delete settings.delivery_base_fee;
    delete settings.delivery_fee_per_km;

    await expect(invokeFunction("merchant-update-settings", body, "token")).resolves.toEqual({
      data: { success: true },
      error: null,
    });

    const insertCall = mocks.clientQuery.mock.calls.find(([statement]) =>
      statement.includes("INSERT INTO public.store_settings"),
    );
    expect(insertCall).toBeDefined();
    const [, parameters] = insertCall!;
    expect(parameters.slice(15, 18)).toEqual([7.5, 0, 7.5]);
  });

  it.each([
    ["delivery_base_fee", Number.POSITIVE_INFINITY, "A taxa base"],
    ["delivery_base_fee", false, "A taxa base"],
    ["delivery_base_fee", -0.01, "A taxa base"],
    ["delivery_base_fee", 1_000.01, "A taxa base"],
    ["delivery_fee_per_km", Number.NaN, "A taxa por km"],
    ["delivery_fee_per_km", -0.01, "A taxa por km"],
    ["delivery_fee_per_km", 100.01, "A taxa por km"],
  ])("rejects invalid %s values", async (field, value, message) => {
    const body = validBody();
    (body.settings as Record<string, unknown>)[field] = value;

    await expect(invokeFunction("merchant-update-settings", body, "token")).resolves.toEqual({
      data: null,
      error: { message: expect.stringContaining(message) },
    });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["avg_prep_time_minutes", 30.5, "minutos inteiros"],
    ["avg_prep_time_minutes", "1e2", "numero valido"],
    ["min_order_value", Number.POSITIVE_INFINITY, "pedido minimo"],
    ["min_order_value", -0.01, "pedido minimo"],
    ["delivery_radius_km", "0x10", "numero valido"],
    ["delivery_radius_km", 0, "raio de entrega"],
    ["delivery_radius_km", 500.01, "raio de entrega"],
  ])("rejects invalid bounded setting %s values", async (field, value, message) => {
    const body = validBody();
    (body.settings as Record<string, unknown>)[field] = value;

    await expect(invokeFunction("merchant-update-settings", body, "token")).resolves.toEqual({
      data: null,
      error: { message: expect.stringContaining(message) },
    });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });
});
