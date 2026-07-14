import { describe, expect, it } from "vitest";
import { assertValidDeliveryZone, deliveryZoneValidationError } from "./delivery-zone-validation";

const validZone = {
  id: "11111111-1111-4111-8111-111111111111",
  store_id: "22222222-2222-4222-8222-222222222222",
  name: "Centro",
  city: "VILA VELHA",
  state: "ES",
  neighborhood: "CENTRO",
  zip_start: null,
  zip_end: null,
  fee: "5.00",
  fee_per_km: "1.25",
  min_fee: "5.00",
  max_fee: "30.00",
  min_order: "20.00",
  max_radius_km: "12.5",
  base_prep_time: 30,
  minutes_per_km: "5",
  additional_region_time: 5,
  estimated_minutes: 35,
  priority: 10,
  is_active: true,
};

describe("delivery zone operational validation", () => {
  it("accepts a complete finite region", () => {
    expect(deliveryZoneValidationError(validZone)).toBeNull();
  });

  it.each([
    ["fee", -0.01],
    ["fee", "NaN"],
    ["fee_per_km", "Infinity"],
    ["min_order", "-Infinity"],
    ["max_radius_km", 0],
    ["base_prep_time", 0],
    ["base_prep_time", 1.5],
    ["minutes_per_km", 121],
    ["additional_region_time", -1],
    ["priority", 1.5],
  ])("rejects unsafe %s=%s", (field, value) => {
    expect(() => assertValidDeliveryZone({ ...validZone, [field]: value })).toThrow();
  });

  it("rejects inverted fee bounds", () => {
    expect(() => assertValidDeliveryZone({ ...validZone, min_fee: 30, max_fee: 10 })).toThrow(
      "taxa minima",
    );
  });

  it("rejects active regions without a valid CEP range or city and UF", () => {
    expect(() =>
      assertValidDeliveryZone({
        ...validZone,
        zip_start: null,
        zip_end: null,
        city: null,
        state: null,
      }),
    ).toThrow("cidade e UF");
  });

  it("allows an invalid legacy coverage to be deactivated, but not reactivated", () => {
    const legacy = {
      ...validZone,
      name: null,
      city: null,
      state: null,
      zip_start: null,
      zip_end: null,
      is_active: false,
    };
    expect(deliveryZoneValidationError(legacy)).toBeNull();
    expect(deliveryZoneValidationError({ ...legacy, is_active: true })).toContain("nome");
  });

  it("validates a partial mutation without requiring unchanged columns", () => {
    expect(deliveryZoneValidationError({ fee: 12 }, { partial: true })).toBeNull();
    expect(deliveryZoneValidationError({ fee: "NaN" }, { partial: true })).toContain("taxa base");
  });
});
