import type { AddressCoordinates, GeocodeAddressInput, AddressWithCoordinates } from "@/services/viacep";
import { fetchExternal } from "@/services/externalFetch";

type GoogleGeocodeResult = {
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  address_components?: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
};

type GoogleGeocodeResponse = {
  results?: GoogleGeocodeResult[];
  status?: string;
  error_message?: string;
};

type DistanceMatrixResponse = {
  status?: string;
  rows?: Array<{
    elements?: Array<{
      status?: string;
      distance?: { value?: number };
    }>;
  }>;
};

const readServerEnv = (key: string) => {
  if (typeof process === "undefined") return undefined;
  return process.env?.[key];
};

export const getGoogleMapsApiKey = () =>
  readServerEnv("GOOGLE_MAPS_API_KEY") || "";

const hasUsableKey = () => Boolean(getGoogleMapsApiKey());

const addressQuery = (address: GeocodeAddressInput) =>
  [
    address.street && address.number ? `${address.street}, ${address.number}` : address.street,
    address.neighborhood,
    address.city,
    address.state,
    address.zipCode,
    "Brasil",
  ]
    .filter(Boolean)
    .join(", ");

const component = (result: GoogleGeocodeResult, type: string, short = false) => {
  const item = result.address_components?.find((entry) => entry.types.includes(type));
  return short ? item?.short_name || "" : item?.long_name || "";
};

const normalizeGoogleAddress = (
  result: GoogleGeocodeResult,
  coordinates: AddressCoordinates,
): AddressWithCoordinates => ({
  cep: component(result, "postal_code"),
  street: component(result, "route"),
  neighborhood:
    component(result, "sublocality_level_1") ||
    component(result, "sublocality") ||
    component(result, "neighborhood"),
  city:
    component(result, "administrative_area_level_2") ||
    component(result, "locality"),
  state: component(result, "administrative_area_level_1", true).toUpperCase().slice(0, 2),
  lat: coordinates.lat,
  lng: coordinates.lng,
});

const firstCoordinates = (payload: GoogleGeocodeResponse): AddressCoordinates | null => {
  if (payload.status !== "OK") return null;
  const location = payload.results?.[0]?.geometry?.location;
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

export const geocodeAddressWithGoogle = async (
  address: GeocodeAddressInput,
): Promise<AddressCoordinates | null> => {
  if (!hasUsableKey()) return null;
  const query = addressQuery(address);
  if (!query || !address.city || !address.state) return null;

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", query);
    url.searchParams.set("region", "br");
    url.searchParams.set("language", "pt-BR");
    url.searchParams.set("key", getGoogleMapsApiKey());

    const response = await fetchExternal(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    return firstCoordinates((await response.json()) as GoogleGeocodeResponse);
  } catch {
    return null;
  }
};

export const reverseGeocodeWithGoogle = async (
  coordinates: AddressCoordinates,
): Promise<AddressWithCoordinates | null> => {
  if (!hasUsableKey()) return null;

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${coordinates.lat},${coordinates.lng}`);
    url.searchParams.set("language", "pt-BR");
    url.searchParams.set("key", getGoogleMapsApiKey());

    const response = await fetchExternal(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const payload = (await response.json()) as GoogleGeocodeResponse;
    if (payload.status !== "OK" || !payload.results?.[0]) return null;
    return normalizeGoogleAddress(payload.results[0], coordinates);
  } catch {
    return null;
  }
};

export const fetchGoogleDrivingDistanceKm = async (
  origin: AddressCoordinates,
  destination: AddressCoordinates,
): Promise<number | null> => {
  if (!hasUsableKey()) return null;

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
    url.searchParams.set("origins", `${origin.lat},${origin.lng}`);
    url.searchParams.set("destinations", `${destination.lat},${destination.lng}`);
    url.searchParams.set("mode", "driving");
    url.searchParams.set("units", "metric");
    url.searchParams.set("language", "pt-BR");
    url.searchParams.set("key", getGoogleMapsApiKey());

    const response = await fetchExternal(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    const payload = (await response.json()) as DistanceMatrixResponse;
    const element = payload.rows?.[0]?.elements?.[0];
    const meters = element?.status === "OK" ? element.distance?.value : null;
    return typeof meters === "number" && Number.isFinite(meters) ? meters / 1000 : null;
  } catch {
    return null;
  }
};
