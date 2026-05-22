import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const hardeningMigration = readFileSync(
  resolve(process.cwd(), "db/migrations/20260521143000_production_hardening.sql"),
  "utf8",
);
const ordersDeliveryMigration = readFileSync(
  resolve(process.cwd(), "db/migrations/20260521190000_orders_delivery_evolution.sql"),
  "utf8",
);

describe("secure checkout migration", () => {
  it("makes order public tokens generated, non-null and unique", () => {
    expect(hardeningMigration).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    expect(hardeningMigration).toContain("ALTER COLUMN public_token SET DEFAULT gen_random_uuid()::text");
    expect(hardeningMigration).toContain("ALTER COLUMN public_token SET NOT NULL");
    expect(hardeningMigration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS orders_public_token_unique");
  });

  it("adds local idempotency and unique payment constraints", () => {
    expect(hardeningMigration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_idempotency_unique");
    expect(ordersDeliveryMigration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS orders_store_customer_idempotency_unique");
    expect(hardeningMigration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS payments_order_id_unique");
    expect(hardeningMigration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS payments_external_id_unique");
    expect(hardeningMigration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS payments_asaas_id_unique");
  });

  it("keeps public order reads token-scoped and removes broad anon grants", () => {
    expect(hardeningMigration).toContain("DROP FUNCTION IF EXISTS public.get_public_order()");
    expect(hardeningMigration).toContain("AND btrim(_token) <> ''");
    expect(hardeningMigration).toContain("o.public_token = _token");
    expect(hardeningMigration).toContain("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon");
  });
});
