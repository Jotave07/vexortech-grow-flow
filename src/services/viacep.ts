import { geocodeAddressWithGoogle, reverseGeocodeWithGoogle } from "@/services/googleMaps";

const VIACEP_BASE_URL = "https://viacep.com.br/ws";
const BRASILAPI_CEP_BASE_URL = "https://brasilapi.com.br/api/cep/v2";
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

export type ViaCepAddress = {
  cep: string;
  street: string;
  neighborhood: string;
  city: string;
  state: string;
  complement?: string;
  ibgeCode?: string;
  ddd?: string;
};

export type AddressCoordinates = {
  lat: number;
  lng: number;
};

export type AddressWithCoordinates = ViaCepAddress & Partial<AddressCoordinates> & {
  number?: string;
  reference?: string;
};

type ViaCepResponse = {
  bairro?: string;
  cep?: string;
  complemento?: string;
  ddd?: string;
  erro?: boolean;
  ibge?: string;
  localidade?: string;
  logradouro?: string;
  uf?: string;
};

type BrasilApiCepResponse = {
  cep?: string;
  city?: string;
  location?: {
    coordinates?: {
      latitude?: string | number;
      longitude?: string | number;
    };
  };
  neighborhood?: string;
  service?: string;
  state?: string;
  street?: string;
};

type NominatimReverseResponse = {
  address?: Record<string, string | undefined>;
  lat?: string;
  lon?: string;
};

export class ViaCepError extends Error {
  code: "invalid_cep" | "not_found" | "network_error" | "unexpected_response";

  constructor(code: ViaCepError["code"], message: string) {
    super(message);
    this.name = "ViaCepError";
    this.code = code;
  }
}

export const normalizeCep = (value: string) => value.replace(/\D/g, "");

export const isValidCep = (value: string) => /^[0-9]{8}$/.test(normalizeCep(value));

export const normalizeAddress = (address: Partial<ViaCepAddress>): ViaCepAddress => ({
  cep: formatCep(address.cep ?? ""),
  street: (address.street ?? "").trim(),
  neighborhood: (address.neighborhood ?? "").trim(),
  city: (address.city ?? "").trim(),
  state: (address.state ?? "").trim().toUpperCase().slice(0, 2),
  complement: address.complement?.trim() || undefined,
  ibgeCode: address.ibgeCode?.trim() || undefined,
  ddd: address.ddd?.trim() || undefined,
});

export const fetchAddressByCep = async (cep: string): Promise<AddressWithCoordinates> => {
  const normalizedCep = normalizeCep(cep);

  if (!isValidCep(normalizedCep)) {
    throw new ViaCepError("invalid_cep", "Informe um CEP com 8 digitos.");
  }

  const errors: ViaCepError[] = [];

  try {
    const viaCepAddress = await fetchViaCepAddress(normalizedCep);
    return await enrichAddressWithCoordinates(normalizedCep, viaCepAddress);
  } catch (error) {
    if (error instanceof ViaCepError) errors.push(error);
  }

  try {
    return await fetchBrasilApiAddress(normalizedCep);
  } catch (error) {
    if (error instanceof ViaCepError) errors.push(error);
  }

  const notFound = errors.find((error) => error.code === "not_found");
  const invalid = errors.find((error) => error.code === "invalid_cep");
  throw invalid ?? notFound ?? errors[0] ?? new ViaCepError("network_error", "Nao foi possivel consultar o CEP agora.");
};

const enrichAddressWithCoordinates = async (normalizedCep: string, address: ViaCepAddress): Promise<AddressWithCoordinates> => {
  try {
    const brasilApiAddress = await fetchBrasilApiAddress(normalizedCep);
    return {
      ...address,
      ...("lat" in brasilApiAddress && "lng" in brasilApiAddress
        ? { lat: brasilApiAddress.lat, lng: brasilApiAddress.lng }
      : {}),
    };
  } catch {
    const googleCoordinates = await geocodeAddressWithGoogle({
      street: address.street,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      zipCode: normalizedCep,
    });
    return googleCoordinates ? { ...address, ...googleCoordinates } : address;
  }
};

const fetchViaCepAddress = async (normalizedCep: string): Promise<ViaCepAddress> => {
  let response: Response;

  try {
    response = await fetch(`${VIACEP_BASE_URL}/${normalizedCep}/json/`);
  } catch {
    throw new ViaCepError("network_error", "Nao foi possivel consultar o CEP agora. Tente novamente em instantes.");
  }

  if (!response.ok) {
    throw new ViaCepError("network_error", "O servico de CEP nao respondeu como esperado.");
  }

  const payload = (await response.json()) as ViaCepResponse;

  if (payload.erro) {
    throw new ViaCepError("not_found", "CEP nao encontrado. Confira os numeros informados.");
  }

  if (!payload.cep || !payload.localidade || !payload.uf) {
    throw new ViaCepError("unexpected_response", "O retorno do CEP veio incompleto. Tente novamente.");
  }

  return normalizeAddress({
    cep: payload.cep,
    street: payload.logradouro ?? "",
    neighborhood: payload.bairro ?? "",
    city: payload.localidade,
    state: payload.uf,
    complement: payload.complemento ?? undefined,
    ibgeCode: payload.ibge ?? undefined,
    ddd: payload.ddd ?? undefined,
  });
};

const fetchBrasilApiAddress = async (normalizedCep: string): Promise<AddressWithCoordinates> => {
  let response: Response;

  try {
    response = await fetch(`${BRASILAPI_CEP_BASE_URL}/${normalizedCep}`);
  } catch {
    throw new ViaCepError("network_error", "Nao foi possivel consultar o CEP agora. Tente novamente em instantes.");
  }

  if (response.status === 404) {
    throw new ViaCepError("not_found", "CEP nao encontrado. Confira os numeros informados.");
  }

  if (!response.ok) {
    throw new ViaCepError("network_error", "O servico de CEP nao respondeu como esperado.");
  }

  const payload = (await response.json()) as BrasilApiCepResponse;

  if (!payload.cep || !payload.city || !payload.state) {
    throw new ViaCepError("unexpected_response", "O retorno do CEP veio incompleto. Tente novamente.");
  }

  const lat = Number(payload.location?.coordinates?.latitude);
  const lng = Number(payload.location?.coordinates?.longitude);

  return {
    ...normalizeAddress({
      cep: payload.cep,
      street: payload.street ?? "",
      neighborhood: payload.neighborhood ?? "",
      city: payload.city,
      state: payload.state,
    }),
    ...(Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {}),
  };
};

export const buildAddressLabel = (address: Partial<AddressWithCoordinates>) => {
  const parts = [
    address.street,
    address.number,
    address.neighborhood,
    address.city,
    address.state,
  ].filter(Boolean);

  return parts.join(", ");
};

export const calculateDistanceKm = (origin: AddressCoordinates, destination: AddressCoordinates) => {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const latDiff = toRadians(destination.lat - origin.lat);
  const lngDiff = toRadians(destination.lng - origin.lng);
  const originLat = toRadians(origin.lat);
  const destinationLat = toRadians(destination.lat);

  const haversine =
    Math.sin(latDiff / 2) * Math.sin(latDiff / 2) +
    Math.sin(lngDiff / 2) * Math.sin(lngDiff / 2) * Math.cos(originLat) * Math.cos(destinationLat);

  const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return earthRadiusKm * centralAngle;
};

export const isWithinDeliveryRadius = (
  origin: AddressCoordinates | null | undefined,
  destination: AddressCoordinates | null | undefined,
  radiusKm: number | null | undefined,
) => {
  if (!origin || !destination || radiusKm === null || radiusKm === undefined) {
    return false;
  }

  return calculateDistanceKm(origin, destination) <= radiusKm;
};

export type GeocodeAddressInput = {
  street: string;
  number?: string;
  neighborhood?: string;
  city: string;
  state: string;
  zipCode?: string;
};

export type GeocodeProvider = (address: GeocodeAddressInput) => Promise<AddressCoordinates | null>;

export const geocodeAddress = async (
  address: GeocodeAddressInput,
  provider?: GeocodeProvider,
) => {
  return provider ? provider(address) : geocodeAddressCoordinates(address);
};

export const geocodeAddressCoordinates = async (address: GeocodeAddressInput): Promise<AddressCoordinates | null> => {
  const googleCoordinates = await geocodeAddressWithGoogle(address);
  if (googleCoordinates) return googleCoordinates;

  const queryParts = [
    address.street && address.number ? `${address.street}, ${address.number}` : address.street,
    address.neighborhood,
    address.city,
    address.state,
    address.zipCode,
    "Brasil",
  ].filter(Boolean);

  if (!address.city || !address.state || queryParts.length < 3) return null;

  try {
    const url = new URL(NOMINATIM_SEARCH_URL);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "1");
    url.searchParams.set("countrycodes", "br");
    url.searchParams.set("accept-language", "pt-BR");
    url.searchParams.set("q", queryParts.join(", "));

    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;

    const payload = (await response.json()) as Array<{ lat?: string; lon?: string }>;
    const match = payload[0];
    const lat = Number(match?.lat);
    const lng = Number(match?.lon);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  } catch {
    return null;
  }
};

export const fetchAddressFromCurrentLocation = async (): Promise<AddressWithCoordinates> => {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new ViaCepError("network_error", "Localizacao atual indisponivel neste navegador.");
  }

  const coordinates = await new Promise<GeolocationCoordinates>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position.coords),
      () => reject(new ViaCepError("network_error", "Nao foi possivel acessar sua localizacao.")),
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 12000 },
    );
  });

  const googleAddress = await reverseGeocodeWithGoogle({
    lat: coordinates.latitude,
    lng: coordinates.longitude,
  });
  if (googleAddress) {
    return {
      ...googleAddress,
      cep: googleAddress.cep ? formatCep(googleAddress.cep) : "",
      lat: coordinates.latitude,
      lng: coordinates.longitude,
    };
  }

  let response: Response;

  try {
    const url = new URL(NOMINATIM_REVERSE_URL);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("accept-language", "pt-BR");
    url.searchParams.set("lat", String(coordinates.latitude));
    url.searchParams.set("lon", String(coordinates.longitude));
    response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  } catch {
    throw new ViaCepError("network_error", "Nao foi possivel transformar sua localizacao em endereco.");
  }

  if (!response.ok) {
    throw new ViaCepError("network_error", "O servico de localizacao nao respondeu como esperado.");
  }

  const payload = (await response.json()) as NominatimReverseResponse;
  const reverseAddress = payload.address ?? {};
  const postcode = normalizeCep(reverseAddress.postcode ?? "");

  if (postcode.length === 8) {
    try {
      const cepAddress = await fetchAddressByCep(postcode);
      return {
        ...cepAddress,
        lat: coordinates.latitude,
        lng: coordinates.longitude,
      };
    } catch {
      // Keep the reverse-geocoded address below when CEP lookup is unavailable.
    }
  }

  const isoState = reverseAddress["ISO3166-2-lvl4"];
  const state = reverseAddress.state_code || (isoState?.includes("-") ? isoState.split("-").pop() : reverseAddress.state);

  return {
    cep: postcode ? formatCep(postcode) : "",
    street: reverseAddress.road ?? reverseAddress.pedestrian ?? reverseAddress.residential ?? "",
    neighborhood: reverseAddress.suburb ?? reverseAddress.neighbourhood ?? reverseAddress.city_district ?? "",
    city: reverseAddress.city ?? reverseAddress.town ?? reverseAddress.village ?? reverseAddress.municipality ?? "",
    state: (state ?? "").toUpperCase().slice(0, 2),
    lat: coordinates.latitude,
    lng: coordinates.longitude,
  };
};

const formatCep = (value: string) => {
  const digits = normalizeCep(value);
  if (digits.length !== 8) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};
