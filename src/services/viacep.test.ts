import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reverseGeocodeWithGoogle } from "@/services/googleMaps";
import {
  ViaCepError,
  calculateDistanceKm,
  fetchAddressByCep,
  fetchAddressFromCurrentLocation,
  geocodeAddressCoordinates,
  isValidCoordinates,
  isWithinDeliveryRadius,
} from "./viacep";
import { EXTERNAL_REQUEST_TIMEOUT_MS } from "./externalFetch";

vi.mock("@/services/googleMaps", () => ({
  geocodeAddressWithGoogle: vi.fn().mockResolvedValue(null),
  reverseGeocodeWithGoogle: vi.fn(),
}));

const reverseGeocodeMock = vi.mocked(reverseGeocodeWithGoogle);

describe("viacep coordinate safeguards", () => {
  beforeEach(() => {
    reverseGeocodeMock.mockResolvedValue({
      cep: "01001-000",
      street: "Praça da Sé",
      neighborhood: "Sé",
      city: "São Paulo",
      state: "SP",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("aborts a stalled ViaCEP request and continues with BrasilAPI", async () => {
    vi.useFakeTimers();
    let firstSignal: AbortSignal | undefined;
    const fetchMock = vi.fn()
      .mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
        firstSignal = init?.signal || undefined;
        return new Promise<Response>((_resolve, reject) => {
          firstSignal?.addEventListener("abort", () => {
            const error = new Error("request aborted");
            error.name = "AbortError";
            reject(error);
          }, { once: true });
        });
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          cep: "01001000",
          street: "Praca da Se",
          neighborhood: "Se",
          city: "Sao Paulo",
          state: "SP",
        }),
      } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = fetchAddressByCep("01001-000");
    await vi.advanceTimersByTimeAsync(EXTERNAL_REQUEST_TIMEOUT_MS);

    await expect(result).resolves.toMatchObject({ cep: "01001-000", city: "Sao Paulo", state: "SP" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(firstSignal?.aborted).toBe(true);
  });

  it("aborts stalled Nominatim geocoding and returns no coordinates", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal || undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener("abort", () => {
          const error = new Error("request aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }));

    const result = geocodeAddressCoordinates({
      street: "Praca da Se",
      city: "Sao Paulo",
      state: "SP",
    });
    await vi.advanceTimersByTimeAsync(EXTERNAL_REQUEST_TIMEOUT_MS);

    await expect(result).resolves.toBeNull();
    expect(requestSignal?.aborted).toBe(true);
  });

  it("accepts only finite coordinates inside latitude and longitude ranges", () => {
    expect(isValidCoordinates({ lat: -23.5505, lng: -46.6333 })).toBe(true);
    expect(isValidCoordinates({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidCoordinates({ lat: 0, lng: -181 })).toBe(false);
    expect(isValidCoordinates({ lat: Number.NaN, lng: 0 })).toBe(false);
  });

  it("rejects invalid coordinates before distance checks", () => {
    expect(() => calculateDistanceKm({ lat: 100, lng: 0 }, { lat: 0, lng: 0 })).toThrow(ViaCepError);
    expect(isWithinDeliveryRadius({ lat: -23.5, lng: -46.6 }, { lat: -23.6, lng: -46.7 }, -1)).toBe(false);
  });

  it("retries position-unavailable errors by the browser error code", async () => {
    const getCurrentPosition = vi.fn()
      .mockImplementationOnce((_success, error) => error({ code: 2 }))
      .mockImplementationOnce((success) => success({ coords: { latitude: -23.5505, longitude: -46.6333 } }));
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });

    const address = await fetchAddressFromCurrentLocation();

    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(getCurrentPosition.mock.calls[1]?.[2]).toMatchObject({ timeout: 15000, maximumAge: 600000 });
    expect(address).toMatchObject({ lat: -23.5505, lng: -46.6333, city: "São Paulo" });
  });

  it("does not retry when geolocation permission is denied", async () => {
    const getCurrentPosition = vi.fn().mockImplementation((_success, error) => error({ code: 1 }));
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });

    await expect(fetchAddressFromCurrentLocation()).rejects.toMatchObject({
      name: "BrowserGeolocationError",
      geolocationCode: 1,
    });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });
});
