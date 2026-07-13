import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createSupabaseAuthUser,
  createSupabaseOAuthUrl,
  exchangeSupabaseAuthCode,
  signUpSupabaseUser,
} from "./supabase";

const ENV_KEYS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "VITE_SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
] as const;

describe.sequential("Supabase auth endpoint separation", () => {
  let previous: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

  beforeEach(() => {
    previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.SUPABASE_URL = "https://project.supabase.co";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("uses the regular signup endpoint and never sends a secret Authorization header", async () => {
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_public";
    process.env.SUPABASE_SECRET_KEY = "test-private-key-without-provider-prefix";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ user: { id: "user-1" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await signUpSupabaseUser("user@example.com", "password", { role: "customer" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://project.supabase.co/auth/v1/signup");
    expect(init.headers).toMatchObject({ apikey: "sb_publishable_public" });
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("does not fall back to a secret key for public signup", async () => {
    process.env.SUPABASE_SECRET_KEY = "test-private-key-without-provider-prefix";
    await expect(signUpSupabaseUser("user@example.com", "password", {})).rejects.toThrow(
      "SUPABASE_PUBLISHABLE_KEY",
    );
  });

  it("binds signup and OAuth redirects to a PKCE challenge", async () => {
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_public";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ user: { id: "user-1" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await signUpSupabaseUser(
      "user@example.com",
      "password",
      { role: "customer" },
      "https://app.example.com/auth/callback",
      { codeChallenge: "challenge-value", codeChallengeMethod: "s256" },
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      code_challenge: "challenge-value",
      code_challenge_method: "s256",
    });
    const oauth = new URL(createSupabaseOAuthUrl("google", "https://app.example.com/auth/callback", {
      codeChallenge: "challenge-value",
      codeChallengeMethod: "s256",
    }));
    expect(oauth.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(oauth.searchParams.get("code_challenge_method")).toBe("s256");
  });

  it("exchanges an auth code with the verifier through the PKCE grant", async () => {
    process.env.SUPABASE_PUBLISHABLE_KEY = "sb_publishable_public";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: "access",
      refresh_token: "refresh",
      user: { id: "user-1" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await exchangeSupabaseAuthCode("auth-code", "code-verifier");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://project.supabase.co/auth/v1/token?grant_type=pkce");
    expect(JSON.parse(String(init.body))).toEqual({ auth_code: "auth-code", code_verifier: "code-verifier" });
    expect(init.headers).toMatchObject({ apikey: "sb_publishable_public" });
  });

  it("keeps the Admin API available only through the explicit server provisioning primitive", async () => {
    process.env.SUPABASE_SECRET_KEY = "test-private-key-without-provider-prefix";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "user-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await createSupabaseAuthUser("merchant@example.com", "password", { role: "store_owner" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://project.supabase.co/auth/v1/admin/users");
    expect(init.headers).toMatchObject({
      apikey: "test-private-key-without-provider-prefix",
      Authorization: "Bearer test-private-key-without-provider-prefix",
    });
  });
});
