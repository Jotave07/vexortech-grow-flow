import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("./db", () => ({
  query: dbMocks.query,
  quoteIdent: (value: string) => `"${value}"`,
  withTransaction: dbMocks.withTransaction,
}));

import {
  assertActiveMerchantSubscription,
  resolveActorAdmin,
  sanitizePublicSignupMetadata,
} from "./auth";
import { assertSafePatchForNonAdmin } from "./query";

const storeId = "11111111-1111-4111-8111-111111111111";
const merchantActor = (overrides: Record<string, unknown> = {}) =>
  ({
    user: { id: "owner-user" },
    profile: { store_id: storeId, is_exempt: true },
    roles: new Set(["store_owner"]),
    admin: false,
    ownedStoreIds: [storeId],
    ...overrides,
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backend authorization hardening", () => {
  it("forces public signups to start as customer even if a role is supplied", () => {
    expect(sanitizePublicSignupMetadata({
      full_name: "Mallory",
      account_type: "super_admin",
      role: "admin",
      is_admin: true,
    })).toMatchObject({
      full_name: "Mallory",
      account_type: "customer",
      role: "customer",
    });
    expect(sanitizePublicSignupMetadata({ is_admin: true })).not.toHaveProperty("is_admin");
  });

  it("never grants platform admin from an environment e-mail allowlist", () => {
    const previous = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = "admin@example.com";
    try {
      expect(resolveActorAdmin({
        email: "admin@example.com",
        profileRole: "customer",
        profileStoreId: null,
        roleRows: [],
      })).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = previous;
    }
  });

  it("does not treat store-scoped admin roles as platform admin", () => {
    expect(resolveActorAdmin({
      email: "owner@example.com",
      profileRole: "store_owner",
      roleRows: [{ role: "admin", store_id: "11111111-1111-4111-8111-111111111111" }],
    })).toBe(false);

    expect(resolveActorAdmin({
      email: "owner@example.com",
      profileRole: "admin",
      profileStoreId: "11111111-1111-4111-8111-111111111111",
      roleRows: [],
    })).toBe(false);

    expect(resolveActorAdmin({
      email: "admin@example.com",
      profileRole: "customer",
      roleRows: [{ role: "admin", store_id: null }],
    })).toBe(true);
  });

  it("blocks non-admin role escalation through generic mutations", () => {
    expect(() => assertSafePatchForNonAdmin("profiles", "update", { role: "super_admin" })).toThrow(
      "Papel administrativo",
    );
    expect(() => assertSafePatchForNonAdmin("user_roles", "insert", { role: "admin" })).toThrow(
      "Papel administrativo",
    );
    expect(() => assertSafePatchForNonAdmin("profiles", "update", { role: "store_owner" })).not.toThrow();
  });

  it("blocks generic financial and operational mutations", () => {
    expect(() => assertSafePatchForNonAdmin("orders", "update", { status: "entregue" })).toThrow(
      "funcoes seguras",
    );
    expect(() => assertSafePatchForNonAdmin("payments", "update", { status: "pago" })).toThrow(
      "dados financeiros",
    );
    expect(() => assertSafePatchForNonAdmin("subscriptions", "insert", { status: "ativa" })).toThrow(
      "dados financeiros",
    );
    expect(() => assertSafePatchForNonAdmin("orders", "update", { is_seen: true })).not.toThrow();
  });

  it("blocks non-admin subscription exemption changes", () => {
    expect(() => assertSafePatchForNonAdmin("profiles", "update", { is_exempt: true })).toThrow(
      "Isencao de assinatura",
    );
  });

  it("blocks owner updates to platform-controlled store fields", () => {
    expect(() => assertSafePatchForNonAdmin("stores", "update", { plan_id: "11111111-1111-4111-8111-111111111111" })).toThrow(
      "Campo de loja protegido",
    );
    expect(() => assertSafePatchForNonAdmin("stores", "update", { is_suspended: false })).toThrow(
      "Campo de loja protegido",
    );
    expect(() => assertSafePatchForNonAdmin("stores", "update", { is_verified: true })).toThrow(
      "Campo de loja protegido",
    );
    expect(() => assertSafePatchForNonAdmin("stores", "insert", { is_verified: true })).toThrow(
      "Campo de loja protegido",
    );
    expect(() => assertSafePatchForNonAdmin("stores", "insert", { owner_user_id: "self" })).not.toThrow();
  });
});

describe("merchant subscription authorization", () => {
  it("keeps the platform admin bypass without consulting the store", async () => {
    await expect(
      assertActiveMerchantSubscription(
        merchantActor({ admin: true, profile: { store_id: storeId, is_exempt: false } }),
        storeId,
      ),
    ).resolves.toBeUndefined();

    expect(dbMocks.query).not.toHaveBeenCalled();
  });

  it.each([
    ["suspended", { is_active: true, is_suspended: true }],
    ["inactive", { is_active: false, is_suspended: false }],
  ])("blocks an exempt owner when the store is %s", async (_label, storeState) => {
    dbMocks.query.mockResolvedValueOnce({ rows: [storeState] });

    await expect(
      assertActiveMerchantSubscription(merchantActor(), storeId),
    ).rejects.toThrow("Loja inativa ou suspensa");
  });

  it("keeps courtesy active for an operational store without requiring a paid plan", async () => {
    dbMocks.query.mockResolvedValueOnce({
      rows: [{ is_active: true, is_suspended: false, plan_id: null, status: null }],
    });

    await expect(assertActiveMerchantSubscription(merchantActor(), storeId)).resolves.toBeUndefined();
    expect(dbMocks.query).toHaveBeenCalledWith(expect.stringContaining("s.is_active"), [storeId]);
  });
});
