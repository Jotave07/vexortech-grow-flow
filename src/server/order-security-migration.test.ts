import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "migrations/20260521123000_secure_checkout_orders_payments.sql"),
  "utf8",
);

describe("secure checkout migration", () => {
  it("makes order public tokens generated, non-null and unique", () => {
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    expect(migration).toContain("ALTER COLUMN public_token SET DEFAULT gen_random_uuid()::text");
    expect(migration).toContain("ALTER COLUMN public_token SET NOT NULL");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS orders_public_token_unique");
  });

  it("adds local idempotency and unique payment constraints", () => {
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_unique");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS payments_order_id_unique");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS payments_external_id_unique");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS payments_asaas_id_unique");
  });

  it("keeps public order reads token-scoped and removes broad anon grants", () => {
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.get_public_order()");
    expect(migration).toContain("AND btrim(_token) <> ''");
    expect(migration).toContain("o.public_token = _token");
    expect(migration).toContain("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon");
  });
});
