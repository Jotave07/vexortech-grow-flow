import { afterEach, describe, expect, it } from "vitest";
import { buildConnectSources, createSecurityHeaders } from "./security-headers";

describe("browser connection security policy", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("admits only the exact HTTPS and WSS Supabase origin", () => {
    expect(buildConnectSources("https://project-ref.supabase.co/rest/v1")).toEqual([
      "'self'",
      "https://project-ref.supabase.co",
      "wss://project-ref.supabase.co",
    ]);
  });

  it("does not admit an insecure remote or malformed Supabase URL", () => {
    process.env.NODE_ENV = "production";
    expect(buildConnectSources("http://project-ref.supabase.co")).toEqual(["'self'"]);
    expect(buildConnectSources("not-a-url")).toEqual(["'self'"]);
  });

  it("centralizes the exact sources in connect-src", () => {
    process.env.NODE_ENV = "production";
    process.env.SUPABASE_URL = "https://project-ref.supabase.co";
    expect(createSecurityHeaders()["Content-Security-Policy"]).toContain(
      "connect-src 'self' https://project-ref.supabase.co wss://project-ref.supabase.co",
    );
  });
});
