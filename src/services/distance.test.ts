import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGoogleDrivingDistanceKm } from "@/services/googleMaps";
import { EXTERNAL_REQUEST_TIMEOUT_MS } from "./externalFetch";
import { getBestDeliveryDistanceKm } from "./distance";

vi.mock("@/services/googleMaps", () => ({
  fetchGoogleDrivingDistanceKm: vi.fn().mockResolvedValue(null),
}));

const googleDistanceMock = vi.mocked(fetchGoogleDrivingDistanceKm);

describe("delivery distance provider fallback", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    googleDistanceMock.mockResolvedValue(null);
  });

  it("aborts a stalled OSRM request and falls back to straight-line distance", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requestSignal = init?.signal || undefined;
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener(
            "abort",
            () => {
              const error = new Error("request aborted");
              error.name = "AbortError";
              reject(error);
            },
            { once: true },
          );
        });
      }),
    );

    const result = getBestDeliveryDistanceKm(
      { lat: -23.5505, lng: -46.6333 },
      { lat: -23.5605, lng: -46.6433 },
    );

    await vi.advanceTimersByTimeAsync(EXTERNAL_REQUEST_TIMEOUT_MS);

    await expect(result).resolves.toMatchObject({ mode: "straight" });
    expect((await result).distanceKm).toBeGreaterThan(0);
    expect(requestSignal?.aborted).toBe(true);
  });
});
