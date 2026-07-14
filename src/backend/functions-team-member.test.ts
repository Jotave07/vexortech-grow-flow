import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertActiveMerchantSubscription: vi.fn(),
  clientQuery: vi.fn(),
  getActor: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock("./auth", () => ({
  assertActiveMerchantSubscription: mocks.assertActiveMerchantSubscription,
  getActor: mocks.getActor,
  signUp: vi.fn(),
}));

vi.mock("./db", () => ({
  query: vi.fn(),
  withTransaction: mocks.withTransaction,
}));

vi.mock("./realtime", () => ({ publishRealtime: vi.fn() }));

import { invokeFunction } from "./functions";

const STORE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const MEMBER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_STORE_ID = "44444444-4444-4444-8444-444444444444";

const ownerActor = {
  user: { id: OWNER_ID },
  profile: { store_id: STORE_ID, role: "store_owner" },
  roles: new Set(["store_owner"]),
  admin: false,
  ownedStoreIds: [STORE_ID],
  accessibleStoreIds: [STORE_ID],
};

const request = (memberUserId = MEMBER_ID) =>
  invokeFunction("merchant-remove-team-member", { storeId: STORE_ID, memberUserId }, "token");

describe("merchant-remove-team-member", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.getActor.mockResolvedValue(ownerActor);
    mocks.assertActiveMerchantSubscription.mockResolvedValue(undefined);
    mocks.withTransaction.mockImplementation(async (callback) =>
      callback({ query: mocks.clientQuery }),
    );
  });

  it("removes only the linked staff role and detaches the profile in one transaction", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT owner_user_id")) return { rows: [{ owner_user_id: OWNER_ID }] };
      if (sql.includes("FROM public.profiles")) {
        return {
          rows: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              store_id: STORE_ID,
              role: "store_manager",
            },
          ],
        };
      }
      if (sql.includes("FROM public.user_roles") && sql.includes("FOR UPDATE")) {
        return { rows: [{ id: "66666666-6666-4666-8666-666666666666", role: "store_manager" }] };
      }
      return { rows: [] };
    });

    await expect(request()).resolves.toEqual({
      data: { success: true, removedUserId: MEMBER_ID },
      error: null,
    });

    expect(mocks.assertActiveMerchantSubscription).toHaveBeenCalledWith(ownerActor, STORE_ID);
    expect(mocks.withTransaction).toHaveBeenCalledTimes(1);
    expect(
      mocks.clientQuery.mock.calls.some(([sql]) => String(sql).includes("UPDATE public.profiles")),
    ).toBe(true);
    expect(
      mocks.clientQuery.mock.calls.some(([sql]) =>
        String(sql).includes("DELETE FROM public.user_roles"),
      ),
    ).toBe(true);
    expect(
      mocks.clientQuery.mock.calls.find(([sql]) =>
        String(sql).includes("DELETE FROM public.user_roles"),
      )?.[1],
    ).toEqual([MEMBER_ID, STORE_ID]);
  });

  it("fails before the transaction when the subscription is inactive", async () => {
    mocks.assertActiveMerchantSubscription.mockRejectedValueOnce(
      new Error("Assinatura inativa. Regularize o plano para continuar."),
    );

    await expect(request()).resolves.toEqual({
      data: null,
      error: { message: expect.stringContaining("Assinatura inativa") },
    });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it("rejects associated staff because only the actual owner may remove a member", async () => {
    const manager = {
      ...ownerActor,
      user: { id: MEMBER_ID },
      profile: { store_id: STORE_ID, role: "store_manager" },
      roles: new Set(["store_manager"]),
      ownedStoreIds: [],
      accessibleStoreIds: [STORE_ID],
    };
    mocks.getActor.mockResolvedValueOnce(manager);

    await expect(request(OWNER_ID)).resolves.toEqual({
      data: null,
      error: { message: expect.stringContaining("Somente o proprietario") },
    });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it("does not let the owner remove their own access", async () => {
    await expect(request(OWNER_ID)).resolves.toEqual({
      data: null,
      error: { message: expect.stringContaining("proprio acesso") },
    });
    expect(mocks.withTransaction).not.toHaveBeenCalled();
  });

  it("rechecks ownership under lock instead of trusting a stale actor snapshot", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT owner_user_id")) return { rows: [{ owner_user_id: MEMBER_ID }] };
      return { rows: [] };
    });

    await expect(request()).resolves.toEqual({
      data: null,
      error: { message: expect.stringContaining("Somente o proprietario") },
    });
    expect(
      mocks.clientQuery.mock.calls.some(([sql]) => /^\s*(?:UPDATE|DELETE)\b/.test(String(sql))),
    ).toBe(false);
  });

  it.each([
    ["admin profile", "admin", []],
    [
      "super-admin role",
      "customer",
      [{ id: "66666666-6666-4666-8666-666666666666", role: "super_admin" }],
    ],
  ])(
    "blocks removal of a legacy %s instead of detaching a preserved privilege",
    async (_label, profileRole, roles) => {
      mocks.clientQuery.mockImplementation(async (sql: string) => {
        if (sql.includes("SELECT owner_user_id")) return { rows: [{ owner_user_id: OWNER_ID }] };
        if (sql.includes("FROM public.profiles")) {
          return {
            rows: [
              {
                id: "55555555-5555-4555-8555-555555555555",
                store_id: STORE_ID,
                role: profileRole,
              },
            ],
          };
        }
        if (sql.includes("FROM public.user_roles") && sql.includes("FOR UPDATE")) {
          return { rows: roles };
        }
        return { rows: [] };
      });

      await expect(request()).resolves.toEqual({
        data: null,
        error: { message: expect.stringContaining("Acesso administrativo legado") },
      });
      expect(
        mocks.clientQuery.mock.calls.some(([sql]) => /^\s*(?:UPDATE|DELETE)\b/.test(String(sql))),
      ).toBe(false);
    },
  );

  it("blocks a store-owner assignment and an unrelated user", async () => {
    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT owner_user_id")) return { rows: [{ owner_user_id: OWNER_ID }] };
      if (sql.includes("FROM public.profiles")) {
        return {
          rows: [
            { id: "55555555-5555-4555-8555-555555555555", store_id: STORE_ID, role: "store_owner" },
          ],
        };
      }
      if (sql.includes("FROM public.user_roles")) return { rows: [] };
      return { rows: [] };
    });

    await expect(request()).resolves.toEqual({
      data: null,
      error: { message: expect.stringContaining("proprietario da loja nao pode ser removido") },
    });

    mocks.clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT owner_user_id")) return { rows: [{ owner_user_id: OWNER_ID }] };
      if (sql.includes("FROM public.profiles")) {
        return {
          rows: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              store_id: OTHER_STORE_ID,
              role: "store_manager",
            },
          ],
        };
      }
      if (sql.includes("FROM public.user_roles")) return { rows: [] };
      return { rows: [] };
    });

    await expect(request()).resolves.toEqual({
      data: null,
      error: { message: expect.stringContaining("nao esta vinculado") },
    });
    expect(
      mocks.clientQuery.mock.calls.some(([sql]) => /^\s*(?:UPDATE|DELETE)\b/.test(String(sql))),
    ).toBe(false);
  });
});
