import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildConnectionString,
  fetchGatewaySubscription,
  getAsaasConfig,
  getPgClientConfig,
  reconcileContractPrices,
  validateGatewaySubscription,
} from "./reconcile-contract-prices.mjs";

const localSubscription = {
  id: "11111111-1111-4111-8111-111111111111",
  store_id: "22222222-2222-4222-8222-222222222222",
  asaas_subscription_id: "sub_test",
  asaas_customer_id: "cus_test",
  external_reference: "platform-subscription:22222222-2222-4222-8222-222222222222",
  billing_type: "CREDIT_CARD",
};

const remoteSubscription = {
  id: "sub_test",
  customer: "cus_test",
  externalReference: "platform-subscription:22222222-2222-4222-8222-222222222222",
  billingType: "CREDIT_CARD",
  cycle: "MONTHLY",
  value: 9.99,
};

const jsonResponse = (value, init = {}) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    ...init,
  });

const createClient = ({ pending = [localSubscription], updateRowCount = 1, role } = {}) => {
  const queries = [];
  const query = vi.fn(async (input, params) => {
    const sql = String(input);
    queries.push({ sql, params });
    if (sql.includes("current_user::text")) {
      return {
        rows: [
          {
            current_user: role || "vexortech_runtime",
            session_user: role || "vexortech_runtime",
          },
        ],
      };
    }
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("pg_advisory_unlock")) return { rows: [{ pg_advisory_unlock: true }] };
    if (sql.includes("ORDER BY id")) return { rows: pending };
    if (sql.includes("UPDATE public.subscriptions")) {
      return { rows: [], rowCount: updateRowCount };
    }
    if (sql.includes("count(*)::text AS remaining")) return { rows: [{ remaining: "0" }] };
    return { rows: [], rowCount: null };
  });
  return { query, queries };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("contract price validation", () => {
  it("normalizes an authoritative monthly price to two decimal places", () => {
    expect(validateGatewaySubscription(localSubscription, remoteSubscription)).toBe("9.99");
    expect(
      validateGatewaySubscription(localSubscription, { ...remoteSubscription, value: 10 }),
    ).toBe("10.00");
  });

  it.each([
    ["gateway id", { id: "sub_other" }],
    ["external reference", { externalReference: "platform-subscription:other" }],
    ["customer", { customer: "cus_other" }],
    ["billing type", { billingType: "PIX" }],
    ["cycle", { cycle: "YEARLY" }],
    ["numeric type", { value: "9.99" }],
    ["positive value", { value: 0 }],
    ["decimal precision", { value: 9.999 }],
    ["hidden decimal precision", { value: 9.9900000001 }],
  ])("fails closed when %s does not match", (_label, change) => {
    expect(() =>
      validateGatewaySubscription(localSubscription, { ...remoteSubscription, ...change }),
    ).toThrow();
  });

  it("requires the local external reference to use the store identity", () => {
    const invalidLocal = { ...localSubscription, external_reference: "legacy-reference" };
    expect(() =>
      validateGatewaySubscription(invalidLocal, {
        ...remoteSubscription,
        externalReference: "legacy-reference",
      }),
    ).toThrow("Identidade");
  });
});

describe("read-only Asaas request", () => {
  it("uses only GET and does not send a request body", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(remoteSubscription));

    const result = await fetchGatewaySubscription({
      fetchImpl,
      baseUrl: "https://sandbox.asaas.com/api/v3",
      apiKey: "secret-test-key",
      gatewayId: "sub_test",
    });

    expect(result).toEqual(remoteSubscription);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://sandbox.asaas.com/api/v3/subscriptions/sub_test");
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(init.body).toBeUndefined();
    expect(init.headers.access_token).toBe("secret-test-key");
  });

  it.each([
    ["HTTP error", async () => jsonResponse({}, { status: 503 })],
    [
      "non-JSON response",
      async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }),
    ],
    [
      "invalid JSON",
      async () =>
        new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
    ],
  ])("fails closed on %s", async (_label, fetchImpl) => {
    await expect(
      fetchGatewaySubscription({
        fetchImpl,
        baseUrl: "https://sandbox.asaas.com/api/v3",
        apiKey: "secret-test-key",
        gatewayId: "sub_test",
      }),
    ).rejects.toThrow();
  });
});

describe("database reconciliation", () => {
  it("updates the pending row atomically and proves there are no remaining rows", async () => {
    const client = createClient();
    const fetchImpl = vi.fn(async () => jsonResponse(remoteSubscription));

    const result = await reconcileContractPrices({
      client,
      fetchImpl,
      apiKey: "secret-test-key",
      asaasEnvironment: "sandbox",
    });

    expect(result).toEqual({ pending: 1, updated: 1, remaining: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const update = client.queries.find(({ sql }) => sql.includes("UPDATE public.subscriptions"));
    expect(update.params).toEqual([
      "9.99",
      localSubscription.id,
      localSubscription.store_id,
      localSubscription.asaas_subscription_id,
      localSubscription.asaas_customer_id,
      localSubscription.external_reference,
      localSubscription.billing_type,
    ]);
    expect(update.sql).toContain("IS NOT DISTINCT FROM");
    expect(client.queries.some(({ sql }) => sql === "COMMIT")).toBe(true);
    expect(client.queries.some(({ sql }) => sql.includes("pg_advisory_unlock"))).toBe(true);
  });

  it("is idempotent when no contract is pending", async () => {
    const client = createClient({ pending: [] });
    const fetchImpl = vi.fn();

    await expect(
      reconcileContractPrices({
        client,
        fetchImpl,
        apiKey: "secret-test-key",
        asaasEnvironment: "production",
      }),
    ).resolves.toEqual({ pending: 0, updated: 0, remaining: 0 });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(client.queries.some(({ sql }) => sql.includes("UPDATE public.subscriptions"))).toBe(
      false,
    );
  });

  it("does not begin a write transaction when the gateway identity mismatches", async () => {
    const client = createClient();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ...remoteSubscription, customer: "cus_other" }),
    );

    await expect(
      reconcileContractPrices({
        client,
        fetchImpl,
        apiKey: "secret-test-key",
        asaasEnvironment: "sandbox",
      }),
    ).rejects.toThrow("Identidade");

    expect(client.queries.some(({ sql }) => sql === "BEGIN")).toBe(false);
    expect(client.queries.some(({ sql }) => sql.includes("UPDATE public.subscriptions"))).toBe(
      false,
    );
    expect(client.queries.some(({ sql }) => sql.includes("pg_advisory_unlock"))).toBe(true);
  });

  it("rolls back if the conditional identity update no longer matches", async () => {
    const client = createClient({ updateRowCount: 0 });

    await expect(
      reconcileContractPrices({
        client,
        fetchImpl: async () => jsonResponse(remoteSubscription),
        apiKey: "secret-test-key",
        asaasEnvironment: "sandbox",
      }),
    ).rejects.toThrow("mudou durante");

    expect(client.queries.some(({ sql }) => sql === "ROLLBACK")).toBe(true);
    expect(client.queries.some(({ sql }) => sql === "COMMIT")).toBe(false);
  });

  it("refuses an administrative or inherited database session", async () => {
    const client = createClient({ role: "postgres" });
    const fetchImpl = vi.fn();

    await expect(
      reconcileContractPrices({
        client,
        fetchImpl,
        apiKey: "secret-test-key",
        asaasEnvironment: "production",
      }),
    ).rejects.toThrow("vexortech_runtime");

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(client.queries.some(({ sql }) => sql.includes("pg_try_advisory_lock"))).toBe(false);
  });
});

describe("operational configuration", () => {
  it("forces verify-full with an absolute pinned CA path", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vexortech-reconcile-"));
    const certificatePath = path.join(directory, "root.crt");
    fs.writeFileSync(certificatePath, "test certificate", { mode: 0o600 });
    try {
      const config = getPgClientConfig(
        "postgresql://runtime:secret@db.example.com:5432/postgres?sslmode=no-verify",
        {
          DATABASE_SSL_ROOT_CERT: certificatePath,
          DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
        },
      );
      const configuredUrl = new URL(config.connectionString);
      expect(configuredUrl.searchParams.get("sslmode")).toBe("verify-full");
      expect(configuredUrl.searchParams.get("sslrootcert")).toBe(certificatePath);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects disabling certificate verification when a CA is configured", () => {
    expect(() =>
      getPgClientConfig("postgresql://runtime:secret@db.example.com/postgres", {
        DATABASE_SSL_ROOT_CERT: path.resolve("root.crt"),
        DATABASE_SSL_REJECT_UNAUTHORIZED: "false",
      }),
    ).toThrow("nao pode ser combinado");
  });

  it("builds encoded fallback credentials and requires an explicit Asaas environment", () => {
    expect(
      buildConnectionString({
        POSTGRES_HOST: "db.example.com",
        POSTGRES_DATABASE: "postgres",
        POSTGRES_USER: "runtime",
        POSTGRES_PASSWORD: "p@ss word",
      }),
    ).toBe("postgres://runtime:p%40ss%20word@db.example.com:5432/postgres");
    expect(() => getAsaasConfig({ ASAAS_API_KEY: "key" })).toThrow("ASAAS_ENVIRONMENT");
    expect(getAsaasConfig({ ASAAS_API_KEY: "key", ASAAS_ENVIRONMENT: "SANDBOX" })).toMatchObject({
      asaasEnvironment: "sandbox",
      baseUrl: "https://sandbox.asaas.com/api/v3",
    });
  });
});
