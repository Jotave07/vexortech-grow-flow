import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpRequestTimeoutError } from "@/server/http-timeout";
import {
  createSupabaseAuthUser,
  downloadObjectFromSupabaseStorage,
  fetchSupabaseUserByToken,
  signInSupabaseUser,
  SUPABASE_AUTH_REQUEST_TIMEOUT_MS,
  SUPABASE_STORAGE_REQUEST_TIMEOUT_MS,
  uploadObjectToSupabaseStorage,
} from "./supabase";

const ENV_KEYS = [
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "VITE_SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_PUBLISHABLE_KEYS",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "VITE_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SECRET_KEYS",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
] as const;

const abortAwareFetch = () =>
  vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        const rejectAbort = () =>
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        if (signal.aborted) rejectAbort();
        else signal.addEventListener("abort", rejectAbort, { once: true });
      }),
  );

const expectSafeTimeout = async (pending: Promise<unknown>, timeoutMs: number, secret: string) => {
  const observed = pending.catch((caught: unknown) => caught);
  await vi.advanceTimersByTimeAsync(timeoutMs);
  const error = await observed;
  expect(error).toBeInstanceOf(HttpRequestTimeoutError);
  expect((error as HttpRequestTimeoutError).timeoutMs).toBe(timeoutMs);
  expect(String(error)).not.toContain(secret);
};

describe.sequential("Supabase HTTP timeouts", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) vi.stubEnv(key, "");
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("bounds public Auth requests at 15 seconds without exposing the key", async () => {
    vi.useFakeTimers();
    const secret = "sb_publishable_sensitive_value";
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", secret);
    const fetchMock = abortAwareFetch();
    vi.stubGlobal("fetch", fetchMock);

    const pending = signInSupabaseUser("user@example.com", "password");
    await expectSafeTimeout(pending, SUPABASE_AUTH_REQUEST_TIMEOUT_MS, secret);

    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("bounds Admin Auth requests at the same 15-second limit", async () => {
    vi.useFakeTimers();
    const secret = "sb_secret_sensitive_value";
    vi.stubEnv("SUPABASE_SECRET_KEY", secret);
    vi.stubGlobal("fetch", abortAwareFetch());

    const pending = createSupabaseAuthUser("merchant@example.com", "password", {
      role: "store_owner",
    });
    await expectSafeTimeout(pending, SUPABASE_AUTH_REQUEST_TIMEOUT_MS, secret);
  });

  it("keeps the nullable user lookup contract on an internal timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_sensitive_value");
    vi.stubGlobal("fetch", abortAwareFetch());

    const pending = fetchSupabaseUserByToken("access-token-sensitive-value");
    await vi.advanceTimersByTimeAsync(SUPABASE_AUTH_REQUEST_TIMEOUT_MS);

    await expect(pending).resolves.toBeNull();
  });

  it("bounds Storage uploads at 30 seconds", async () => {
    vi.useFakeTimers();
    const secret = "sb_secret_sensitive_value";
    vi.stubEnv("SUPABASE_SECRET_KEY", secret);
    vi.stubGlobal("fetch", abortAwareFetch());

    const pending = uploadObjectToSupabaseStorage({
      bucket: "private-files",
      path: "store/file.txt",
      bytes: Buffer.from("test"),
      contentType: "text/plain",
    });
    await expectSafeTimeout(pending, SUPABASE_STORAGE_REQUEST_TIMEOUT_MS, secret);
  });

  it("bounds Storage downloads at 30 seconds", async () => {
    vi.useFakeTimers();
    const secret = "sb_secret_sensitive_value";
    vi.stubEnv("SUPABASE_SECRET_KEY", secret);
    vi.stubGlobal("fetch", abortAwareFetch());

    const pending = downloadObjectFromSupabaseStorage("private-files", "store/file.txt");
    await expectSafeTimeout(pending, SUPABASE_STORAGE_REQUEST_TIMEOUT_MS, secret);
  });

  it("preserves caller cancellation instead of reporting it as a timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_sensitive_value");
    const fetchMock = abortAwareFetch();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const reason = new Error("caller_cancelled");

    const pending = signInSupabaseUser("user@example.com", "password", {
      signal: controller.signal,
    });
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });
});
