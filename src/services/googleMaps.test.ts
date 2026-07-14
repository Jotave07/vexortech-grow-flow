import { afterEach, describe, expect, it, vi } from "vitest";
import { EXTERNAL_REQUEST_TIMEOUT_MS } from "./externalFetch";
import { geocodeAddressWithGoogle, getGoogleMapsApiKey } from "./googleMaps";

const pendingUntilAbort = (signal: AbortSignal) =>
  new Promise<Response>((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        const error = new Error("request aborted");
        error.name = "AbortError";
        reject(error);
      },
      { once: true },
    );
  });

describe("Google Maps server adapter", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("accepts only the private server key", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    vi.stubEnv("VITE_GOOGLE_MAPS_API_KEY", "public-key-must-not-be-used");
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY", "public-key-must-not-be-used");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    expect(getGoogleMapsApiKey()).toBe("");
    await expect(
      geocodeAddressWithGoogle({
        street: "Praca da Se",
        city: "Sao Paulo",
        state: "SP",
      }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts a geocoding request after the external timeout and falls back to null", async () => {
    vi.useFakeTimers();
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "server-secret");
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal || undefined;
        return pendingUntilAbort(requestSignal as AbortSignal);
      }),
    );

    const result = geocodeAddressWithGoogle({
      street: "Praca da Se",
      city: "Sao Paulo",
      state: "SP",
    });

    await vi.advanceTimersByTimeAsync(EXTERNAL_REQUEST_TIMEOUT_MS);

    await expect(result).resolves.toBeNull();
    expect(requestSignal?.aborted).toBe(true);
  });
});
