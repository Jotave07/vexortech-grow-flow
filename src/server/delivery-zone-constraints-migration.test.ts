import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "db/migrations/20260714144500_delivery_zones_operational_constraints.sql"),
  "utf8",
);
const schemaGate = readFileSync(resolve(process.cwd(), "scripts/check-schema.mjs"), "utf8");
const deliveryService = readFileSync(
  resolve(process.cwd(), "src/server/delivery.service.ts"),
  "utf8",
);
const checkoutService = readFileSync(
  resolve(process.cwd(), "src/server/order.functions.ts"),
  "utf8",
);

const constraintNames = [
  "delivery_zones_fee_chk",
  "delivery_zones_fee_per_km_chk",
  "delivery_zones_fee_bounds_chk",
  "delivery_zones_min_order_chk",
  "delivery_zones_max_radius_km_chk",
  "delivery_zones_timing_chk",
  "delivery_zones_priority_chk",
  "delivery_zones_coverage_chk",
];

describe("delivery zone operational constraint migration", () => {
  it("deactivates unsafe legacy rules before normalizing them", () => {
    expect(migration).toContain("SET is_active = false");
    expect(migration).toContain("WHERE is_active IS NULL");
    expect(migration).toContain("fee::text IN ('NaN', 'Infinity', '-Infinity')");
    expect(migration).toContain("min_fee > max_fee");
    expect(migration).toContain("regexp_replace");
  });

  it("makes active-state semantics explicit and fail-closed", () => {
    expect(migration).toContain("ALTER COLUMN is_active SET DEFAULT true");
    expect(migration).toContain("ALTER COLUMN is_active SET NOT NULL");
    expect(deliveryService).toContain("WHERE store_id = $1 AND is_active IS TRUE");
    expect(checkoutService).toContain("WHERE store_id = $1 AND is_active IS TRUE");
    expect(schemaGate).toContain("active_column.attnotnull IS TRUE");
    expect(schemaGate).toContain("active_column.atttypid = 'boolean'::regtype");
  });

  it("installs and validates every operational CHECK", () => {
    for (const name of constraintNames) {
      expect(migration).toContain(`ADD CONSTRAINT ${name} CHECK`);
      expect(migration).toContain(`VALIDATE CONSTRAINT ${name}`);
    }
  });

  it("keeps invalid inactive coverage quarantined while active rules remain complete", () => {
    expect(migration).toContain("is_active IS NOT TRUE");
    expect(migration).toContain("zip_start <= zip_end");
    expect(migration).toContain("NULLIF(btrim(city), '') IS NOT NULL");
  });
});
