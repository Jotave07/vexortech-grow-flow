import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
  resolveActorAccessibleStoreIds,
  resolveActorAdmin,
  sanitizePublicSignupMetadata,
} from "./auth";
import { assertSafePatchForNonAdmin } from "./query";

const storeId = "11111111-1111-4111-8111-111111111111";
const signupRoleMigration = readFileSync(
  resolve(process.cwd(), "db/migrations/20260714124758_reject_untrusted_signup_roles.sql"),
  "utf8",
);
const merchantActor = (overrides: Record<string, unknown> = {}) =>
  ({
    user: { id: "owner-user" },
    profile: { store_id: storeId, is_exempt: true },
    roles: new Set(["store_owner"]),
    admin: false,
    ownedStoreIds: [storeId],
    accessibleStoreIds: [storeId],
    ...overrides,
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backend authorization hardening", () => {
  it("forces a direct malicious Supabase signup to customer without demoting existing roles", () => {
    const normalizedMigration = signupRoleMigration.replace(/\s+/g, " ");

    expect(signupRoleMigration).not.toMatch(/raw_user_meta_data\s*->>\s*'(role|account_type)'/);
    expect(normalizedMigration).toContain("SELECT 'customer'::text");
    expect(normalizedMigration).toContain("VALUES (NEW.id, 'customer') ON CONFLICT DO NOTHING");
    expect(normalizedMigration).toContain(
      "role = COALESCE(NULLIF(public.profiles.role, ''), EXCLUDED.role)",
    );
  });

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

  it("derives merchant stores only from ownership or an explicit staff assignment", () => {
    const otherStoreId = "22222222-2222-4222-8222-222222222222";

    expect(resolveActorAccessibleStoreIds({
      profileRole: "customer",
      profileStoreId: storeId,
      ownedStoreIds: [storeId],
      roleRows: [],
    })).toEqual([]);
    expect(resolveActorAccessibleStoreIds({
      profileRole: "store_owner",
      profileStoreId: otherStoreId,
      ownedStoreIds: [storeId],
      roleRows: [],
    })).toEqual([storeId]);
    expect(resolveActorAccessibleStoreIds({
      profileRole: "customer",
      profileStoreId: null,
      ownedStoreIds: [],
      roleRows: [{ role: "store_manager", store_id: otherStoreId }],
    })).toEqual([otherStoreId]);
  });

  it.each([
    ["profiles", "insert", { user_id: "self", role: "customer" }],
    ["profiles", "update", { role: "store_owner" }],
    ["profiles", "update", { role: "admin" }],
    ["profiles", "update", { full_name: "Novo nome" }],
    ["profiles", "delete", undefined],
    ["user_roles", "insert", { user_id: "self", role: "store_owner" }],
    ["user_roles", "update", { role: "admin" }],
    ["user_roles", "delete", undefined],
  ] as const)("blocks non-admin generic %s %s", (table, operation, values) => {
    expect(() => assertSafePatchForNonAdmin(table, operation, values)).toThrow(
      "somente por fluxo seguro do servidor",
    );
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

  it("blocks non-admin profile exemption changes with every other generic profile mutation", () => {
    expect(() => assertSafePatchForNonAdmin("profiles", "update", { is_exempt: true })).toThrow(
      "somente por fluxo seguro do servidor",
    );
  });

  it("reserves every generic store mutation for the dedicated server workflows", () => {
    expect(() => assertSafePatchForNonAdmin("stores", "update", { plan_id: "11111111-1111-4111-8111-111111111111" })).toThrow(
      "somente por fluxo seguro do servidor",
    );
    expect(() => assertSafePatchForNonAdmin("stores", "update", { is_suspended: false })).toThrow(
      "somente por fluxo seguro do servidor",
    );
    expect(() => assertSafePatchForNonAdmin("stores", "update", { is_verified: true })).toThrow(
      "somente por fluxo seguro do servidor",
    );
    expect(() => assertSafePatchForNonAdmin("stores", "insert", { is_verified: true })).toThrow(
      "somente por fluxo seguro do servidor",
    );
    expect(() => assertSafePatchForNonAdmin("stores", "insert", { owner_user_id: "self" })).toThrow(
      "somente por fluxo seguro do servidor",
    );
    expect(() => assertSafePatchForNonAdmin("stores", "delete", undefined)).toThrow(
      "somente por fluxo seguro do servidor",
    );
  });
});

describe("merchant subscription authorization", () => {
  it("rejects a customer with a stale owned-store row before any subscription lookup", async () => {
    await expect(
      assertActiveMerchantSubscription({
        user: { id: "customer-user" },
        profile: { store_id: null, role: "customer" },
        roles: new Set(["customer"]),
        admin: false,
        ownedStoreIds: [storeId],
        accessibleStoreIds: [],
      } as any),
    ).rejects.toThrow("Permissao de lojista");

    expect(dbMocks.query).not.toHaveBeenCalled();
  });

  it("accepts associated merchant staff and rejects the same role for another store", async () => {
    const staff = merchantActor({
      profile: { store_id: storeId, role: "store_manager", is_exempt: true },
      roles: new Set(["store_manager"]),
      ownedStoreIds: [],
      accessibleStoreIds: [storeId],
    });
    dbMocks.query.mockResolvedValueOnce({
      rows: [{
        is_active: true,
        is_suspended: false,
        owner_is_exempt: false,
        plan_id: "33333333-3333-4333-8333-333333333333",
        status: "ativa",
        last_payment_status: "confirmed",
      }],
    });

    await expect(assertActiveMerchantSubscription(staff, storeId)).resolves.toBeUndefined();
    await expect(
      assertActiveMerchantSubscription(staff, "22222222-2222-4222-8222-222222222222"),
    ).rejects.toThrow("Loja fora do escopo");
    expect(dbMocks.query).toHaveBeenCalledTimes(1);
  });

  it("never applies a staff profile exemption to the target store owner", async () => {
    const staff = merchantActor({
      profile: { store_id: storeId, role: "store_manager", is_exempt: true },
      roles: new Set(["store_manager"]),
      ownedStoreIds: [],
      accessibleStoreIds: [storeId],
    });
    dbMocks.query.mockResolvedValueOnce({
      rows: [{ is_active: true, is_suspended: false, owner_is_exempt: false }],
    });

    await expect(assertActiveMerchantSubscription(staff, storeId)).rejects.toThrow(
      "Assinatura inativa",
    );
  });

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
      rows: [{
        is_active: true,
        is_suspended: false,
        owner_is_exempt: true,
        plan_id: null,
        status: null,
      }],
    });

    await expect(assertActiveMerchantSubscription(merchantActor(), storeId)).resolves.toBeUndefined();
    expect(dbMocks.query).toHaveBeenCalledWith(expect.stringContaining("s.is_active"), [storeId]);
  });

  it("locks the target owner exemption with the store in transactional checks", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({
        rows: [{ owner_user_id: "owner-user", is_active: true, is_suspended: false }],
      })
      .mockResolvedValueOnce({ rows: [{ is_exempt: true }] });

    await expect(
      assertActiveMerchantSubscription(merchantActor(), storeId, { execute, lock: true }),
    ).resolves.toBeUndefined();

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0]).toContain("FOR SHARE");
    expect(execute.mock.calls[1]).toEqual([
      expect.stringContaining("FROM public.profiles"),
      ["owner-user"],
    ]);
  });
});
