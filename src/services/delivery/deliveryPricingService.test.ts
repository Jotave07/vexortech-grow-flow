import { describe, expect, it } from "vitest";
import { calculateDeliveryFee } from "./deliveryPricingService";
import type { DeliveryRegion } from "@/types/delivery";

const region = (overrides: Partial<DeliveryRegion>): DeliveryRegion => ({
  id: "region_1",
  store_id: "store_1",
  name: "Centro",
  is_active: true,
  city: "São Paulo",
  state: "SP",
  neighborhood: "Centro",
  zip_start: null,
  zip_end: null,
  max_radius_km: null,
  fee: 5,
  fee_per_km: null,
  min_fee: null,
  max_fee: null,
  min_order: null,
  estimated_minutes: null,
  base_prep_time: null,
  minutes_per_km: null,
  additional_region_time: null,
  priority: null,
  ...overrides,
});

describe("delivery pricing", () => {
  it("adds distance fee and rounds monetary values", () => {
    expect(calculateDeliveryFee(region({ fee: 5, fee_per_km: 1.234 }), 3)).toBe(8.7);
  });

  it("respects minimum and maximum fee boundaries", () => {
    expect(calculateDeliveryFee(region({ fee: 2, min_fee: 7 }), 1)).toBe(7);
    expect(calculateDeliveryFee(region({ fee: 20, max_fee: 12 }), 1)).toBe(12);
  });
});
