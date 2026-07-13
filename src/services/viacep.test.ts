import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reverseGeocodeWithGoogle } from "@/services/googleMaps";
import {
  ViaCepError,
  calculateDistanceKm,
  fetchAddressFromCurrentLocation,
  isValidCoordinates,
  isWithinDeliveryRadius,
} from "./viacep";

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
    vi.clearAllMocks();
    vi.unstubAllGlobals();
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
