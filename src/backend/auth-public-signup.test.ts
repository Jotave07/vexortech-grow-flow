import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signUpSupabaseUser: vi.fn(),
  createSupabaseAuthUser: vi.fn(),
  signInSupabaseUser: vi.fn(),
  transactionQuery: vi.fn(),
}));

vi.mock("./db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => unknown) =>
    callback({ query: mocks.transactionQuery })),
}));
vi.mock("./supabase", () => ({
  createSupabaseAuthUser: mocks.createSupabaseAuthUser,
  createSupabaseOAuthUrl: vi.fn(),
  exchangeSupabaseAuthCode: vi.fn(),
  fetchSupabaseUserByToken: vi.fn(),
  hasSupabaseAdminConfig: vi.fn(() => true),
  refreshSupabaseSession: vi.fn(),
  sendSupabasePasswordRecoveryEmail: vi.fn(),
  signInSupabaseUser: mocks.signInSupabaseUser,
  signOutSupabaseSession: vi.fn(),
  signUpSupabaseUser: mocks.signUpSupabaseUser,
  updateSupabaseAuthUser: vi.fn(),
}));

import { handleAuthAction } from "./auth";

describe("public signup dispatch", () => {
  beforeEach(() => {
    mocks.signUpSupabaseUser.mockReset();
    mocks.createSupabaseAuthUser.mockReset();
    mocks.signInSupabaseUser.mockReset();
    mocks.transactionQuery.mockReset();
    mocks.transactionQuery.mockResolvedValue({ rows: [] });
  });

  it("never dispatches a public request to the Supabase Admin API", async () => {
    mocks.signUpSupabaseUser.mockResolvedValue({
      user: { id: "user-1", email: "user@example.com", user_metadata: {} },
    });

    const result = await handleAuthAction("signUp", {
      email: "USER@example.com",
      password: "password",
      data: { full_name: "User", role: "admin", account_type: "super_admin", is_admin: true },
    });

    expect(result.error).toBeNull();
    expect(mocks.signUpSupabaseUser).toHaveBeenCalledWith(
      "user@example.com",
      "password",
      { full_name: "User", role: "customer", account_type: "customer" },
      undefined,
      undefined,
    );
    expect(mocks.createSupabaseAuthUser).not.toHaveBeenCalled();
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO public.profiles"),
      ["user-1", "user@example.com", "User", null, "customer"],
    );
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO public.user_roles"),
      ["user-1", "customer"],
    );
  });

  it("grants store_owner only after the trusted merchant flow, even when the trigger already inserted customer", async () => {
    mocks.signUpSupabaseUser.mockResolvedValue({
      user: { id: "merchant-1", email: "merchant@example.com", user_metadata: {} },
    });

    const result = await handleAuthAction("signUpMerchant", {
      email: "MERCHANT@example.com",
      password: "password-strong",
      data: { full_name: "Merchant", role: "store_owner", account_type: "store_owner" },
    });

    expect(result.error).toBeNull();
    expect(mocks.signUpSupabaseUser).toHaveBeenCalledWith(
      "merchant@example.com",
      "password-strong",
      { full_name: "Merchant", role: "customer", account_type: "customer" },
      undefined,
      undefined,
    );
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("EXCLUDED.role = 'store_owner'"),
      ["merchant-1", "merchant@example.com", "Merchant", null, "store_owner"],
    );
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("$2::text = 'store_owner'"),
      ["merchant-1", "store_owner"],
    );
  });

  it("does not promote a common login even when user_metadata maliciously claims store_owner", async () => {
    mocks.signInSupabaseUser.mockResolvedValue({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 3600,
      user: {
        id: "user-2",
        email: "user@example.com",
        user_metadata: { role: "store_owner", account_type: "store_owner", full_name: "User" },
      },
    });

    const result = await handleAuthAction("signInWithPassword", {
      email: "USER@example.com",
      password: "password",
    });

    expect(result.error).toBeNull();
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("INSERT INTO public.profiles"),
      ["user-2", "user@example.com", "User", null, "customer"],
    );
    expect(mocks.transactionQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("INSERT INTO public.user_roles"),
      ["user-2", "customer"],
    );
    const persistedValues = mocks.transactionQuery.mock.calls.flatMap(([, params]) =>
      Array.isArray(params) ? params : []);
    expect(persistedValues).not.toContain("store_owner");
  });
});
