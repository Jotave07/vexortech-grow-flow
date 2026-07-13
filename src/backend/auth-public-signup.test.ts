import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signUpSupabaseUser: vi.fn(),
  createSupabaseAuthUser: vi.fn(),
}));

vi.mock("./db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => unknown) => callback({ query: vi.fn() })),
}));
vi.mock("./supabase", () => ({
  createSupabaseAuthUser: mocks.createSupabaseAuthUser,
  fetchSupabaseUserByToken: vi.fn(),
  hasSupabaseAdminConfig: vi.fn(() => true),
  sendSupabasePasswordRecoveryEmail: vi.fn(),
  signUpSupabaseUser: mocks.signUpSupabaseUser,
  updateSupabaseAuthUser: vi.fn(),
}));

import { handleAuthAction } from "./auth";

describe("public signup dispatch", () => {
  beforeEach(() => {
    mocks.signUpSupabaseUser.mockReset();
    mocks.createSupabaseAuthUser.mockReset();
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
  });
});
