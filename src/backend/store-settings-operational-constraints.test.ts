import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL(
  "../../db/migrations/20260714143000_store_settings_operational_constraints.sql",
  import.meta.url,
);
const schemaGateUrl = new URL("../../scripts/check-schema.mjs", import.meta.url);

const constraints = [
  "store_settings_avg_prep_time_minutes_chk",
  "store_settings_min_order_value_chk",
  "store_settings_delivery_radius_km_chk",
  "store_settings_delivery_base_fee_chk",
  "store_settings_delivery_fee_per_km_chk",
  "store_settings_delivery_fee_chk",
];

describe("store settings operational constraints migration", () => {
  it("normalizes only invalid non-null legacy values to NULL", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    const compact = sql.replace(/\s+/g, " ");

    expect(compact).toContain(
      "avg_prep_time_minutes = CASE WHEN avg_prep_time_minutes >= 1 AND avg_prep_time_minutes <= 240 THEN avg_prep_time_minutes ELSE NULL END",
    );
    expect(compact).toContain(
      "min_order_value = CASE WHEN min_order_value >= 0 AND min_order_value <= 1000000 THEN min_order_value ELSE NULL END",
    );
    expect(compact).toContain(
      "delivery_radius_km = CASE WHEN delivery_radius_km >= 0.1 AND delivery_radius_km <= 500 THEN delivery_radius_km ELSE NULL END",
    );
    expect(compact).toContain(
      "delivery_base_fee = CASE WHEN delivery_base_fee >= 0 AND delivery_base_fee <= 1000 THEN delivery_base_fee ELSE NULL END",
    );
    expect(compact).toContain(
      "delivery_fee_per_km = CASE WHEN delivery_fee_per_km >= 0 AND delivery_fee_per_km <= 100 THEN delivery_fee_per_km ELSE NULL END",
    );
    expect(compact).toContain(
      "delivery_fee = CASE WHEN delivery_fee >= 0 AND delivery_fee <= 1000 THEN delivery_fee ELSE NULL END",
    );
    expect(sql).not.toMatch(/\b(?:DELETE|TRUNCATE|LEAST|GREATEST)\b/i);
  });

  it("adds stable NOT VALID checks, commits, then validates them", async () => {
    const sql = await readFile(migrationUrl, "utf8");

    for (const constraint of constraints) {
      expect(sql).toContain(`DROP CONSTRAINT IF EXISTS ${constraint}`);
      expect(sql).toMatch(new RegExp(`ADD CONSTRAINT ${constraint}[\\s\\S]{1,300}NOT VALID`));
      expect(sql).toContain(`VALIDATE CONSTRAINT ${constraint}`);
    }

    expect(sql.match(/\)\s+NOT VALID/g)).toHaveLength(6);
    const addPosition = sql.indexOf(`ADD CONSTRAINT ${constraints[0]}`);
    const commitPosition = sql.indexOf("COMMIT;", addPosition);
    const validatePosition = sql.indexOf(`VALIDATE CONSTRAINT ${constraints[0]}`);
    expect(addPosition).toBeGreaterThan(0);
    expect(commitPosition).toBeGreaterThan(addPosition);
    expect(validatePosition).toBeGreaterThan(commitPosition);
  });

  it("requires every constraint to be present and validated in the schema gate", async () => {
    const schemaGate = await readFile(schemaGateUrl, "utf8");

    expect(schemaGate).toContain('"20260714143000 validated store settings operational checks"');
    expect(schemaGate).toMatch(
      /\(\s*'20260714143000',\s*'20260714143000_store_settings_operational_constraints[.]sql'\s*\)/,
    );
    for (const constraint of constraints) {
      expect(schemaGate).toMatch(
        new RegExp(`name: "${constraint}",[\\s\\S]{1,160}validated: true`),
      );
    }
  });
});
