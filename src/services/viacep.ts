const VIACEP_BASE_URL = "https://viacep.com.br/ws";

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

export const fetchAddressByCep = async (cep: string): Promise<ViaCepAddress> => {
  const normalizedCep = normalizeCep(cep);

  if (!isValidCep(normalizedCep)) {
    throw new ViaCepError("invalid_cep", "Informe um CEP com 8 digitos.");
  }

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
  if (!provider) return null;
  return provider(address);
};

const formatCep = (value: string) => {
  const digits = normalizeCep(value);
  if (digits.length !== 8) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
};
