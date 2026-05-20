import { buildAddressLabel, isWithinDeliveryRadius, type AddressCoordinates, type AddressWithCoordinates } from "@/services/viacep";
import type { Json } from "@/integrations/supabase/types";

export type DeliveryDistanceBand = {
  id: string;
  startKm: number;
  endKm: number;
  fee: number;
};

export type DeliveryConfiguration = {
  allowDelivery: boolean;
  allowPickup: boolean;
  minimumOrderValue: number;
  averagePrepTimeMinutes: number;
  deliveryRadiusKm: number | null;
  deliveryBaseFee: number;
  deliveryFeePerKm: number;
  distanceBands: DeliveryDistanceBand[];
  deliveryMessage?: string | null;
};

export type DeliveryValidationIssue = {
  field: keyof DeliveryConfiguration | "distanceBands";
  message: string;
};

export type DeliveryAvailabilityResult = {
  canDeliver: boolean;
  distanceKm: number | null;
  reason: "ok" | "delivery_disabled" | "missing_coordinates" | "outside_radius" | "missing_radius";
  message: string;
  deliveryFee: number | null;
  matchedBand?: DeliveryDistanceBand | null;
};

export const normalizeDistanceBands = (value: Json | unknown): DeliveryDistanceBand[] => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const source = item as Record<string, unknown>;
      const startKm = Number(source.startKm ?? source.start_km);
      const endKm = Number(source.endKm ?? source.end_km);
      const fee = Number(source.fee);

      if (!Number.isFinite(startKm) || !Number.isFinite(endKm) || !Number.isFinite(fee)) {
        return null;
      }

      return {
        id: typeof source.id === "string" && source.id ? source.id : `band-${index + 1}`,
        startKm,
        endKm,
        fee,
      };
    })
    .filter((item): item is DeliveryDistanceBand => Boolean(item))
    .sort((a, b) => a.startKm - b.startKm);
};

export const validateDistanceBands = (bands: DeliveryDistanceBand[]) => {
  const issues: DeliveryValidationIssue[] = [];
  const sorted = [...bands].sort((a, b) => a.startKm - b.startKm);

  if (sorted.length === 0) {
    issues.push({ field: "distanceBands", message: "Cadastre pelo menos uma faixa de distância para a entrega." });
    return issues;
  }

  sorted.forEach((band, index) => {
    if (band.startKm < 0) {
      issues.push({ field: "distanceBands", message: `A faixa ${index + 1} não pode começar com distância negativa.` });
    }
    if (band.endKm <= band.startKm) {
      issues.push({ field: "distanceBands", message: `A faixa ${index + 1} precisa terminar depois do valor inicial.` });
    }
    if (band.fee < 0) {
      issues.push({ field: "distanceBands", message: `A taxa da faixa ${index + 1} não pode ser negativa.` });
    }
    if (index > 0 && band.startKm < sorted[index - 1].endKm) {
      issues.push({ field: "distanceBands", message: `As faixas ${index} e ${index + 1} estão sobrepostas.` });
    }
  });

  return issues;
};

export const validateDeliverySettings = (config: DeliveryConfiguration) => {
  const issues: DeliveryValidationIssue[] = [];

  if (config.allowDelivery) {
    if (config.distanceBands.length > 0) {
      issues.push(...validateDistanceBands(config.distanceBands));
    } else if (config.deliveryFeePerKm <= 0) {
      issues.push({ field: "deliveryFeePerKm", message: "Informe um valor por KM ou cadastre faixas de distância para a entrega." });
    }

    if (config.deliveryRadiusKm !== null && config.deliveryRadiusKm <= 0) {
      issues.push({ field: "deliveryRadiusKm", message: "Informe um raio maior que zero para usar entrega por distância." });
    }
    if (config.deliveryFeePerKm < 0) {
      issues.push({ field: "deliveryFeePerKm", message: "O valor por KM não pode ser negativo." });
    }
    if (config.averagePrepTimeMinutes <= 0) {
      issues.push({ field: "averagePrepTimeMinutes", message: "Defina um tempo médio de entrega/preparo válido." });
    }

    const maxBandDistance = getMaxBandDistance(config.distanceBands);
    if (config.deliveryRadiusKm !== null && maxBandDistance !== null && config.deliveryRadiusKm < maxBandDistance) {
      issues.push({
        field: "deliveryRadiusKm",
        message: "O raio máximo deve cobrir pelo menos o limite final da última faixa configurada.",
      });
    }
  }

  if (!config.allowDelivery && !config.allowPickup) {
    issues.push({ field: "allowPickup", message: "Ative entrega ou retirada para continuar recebendo pedidos." });
  }

  return {
    valid: issues.length === 0,
    issues,
  };
};

export const isDeliveryAvailable = (config: Pick<DeliveryConfiguration, "allowDelivery">) => config.allowDelivery;

export const getMaxBandDistance = (bands: DeliveryDistanceBand[]) =>
  bands.length ? Math.max(...bands.map((band) => band.endKm)) : null;

export const formatDeliveryFeePreview = (bands: DeliveryDistanceBand[], radiusKm: number | null) => {
  if (bands.length === 0) {
    return radiusKm === null
      ? "Nenhuma faixa de distância configurada ainda."
      : `Raio máximo configurado: ${radiusKm.toFixed(1).replace(".", ",")} km. O valor por KM será usado quando estiver preenchido.`;
  }

  const preview = bands
    .map((band) => `${formatBandLabel(band)}: ${formatCurrency(band.fee)}`)
    .join(" | ");

  if (radiusKm === null) {
    return `${preview}. O bloqueio por distância real só será aplicado quando a loja e o cliente tiverem coordenadas confiáveis.`;
  }

  return `${preview}. Raio máximo configurado: ${radiusKm.toFixed(1).replace(".", ",")} km.`;
};

export const getDistanceBandForDistance = (distanceKm: number, bands: DeliveryDistanceBand[]) =>
  [...bands]
    .sort((a, b) => a.startKm - b.startKm)
    .find((band) => distanceKm >= band.startKm && distanceKm <= band.endKm) ?? null;

export const calculateDeliveryFeeByDistance = (distanceKm: number, bands: DeliveryDistanceBand[]) => {
  const matchedBand = getDistanceBandForDistance(distanceKm, bands);
  return matchedBand ? matchedBand.fee : null;
};

type CanDeliverToAddressInput = {
  storeAddress: Partial<AddressWithCoordinates>;
  customerAddress: Partial<AddressWithCoordinates>;
  maxRadiusKm: number | null | undefined;
  distanceBands?: DeliveryDistanceBand[];
  storeCoordinates?: AddressCoordinates | null;
  customerCoordinates?: AddressCoordinates | null;
};

export const canDeliverToAddress = ({
  storeAddress,
  customerAddress,
  maxRadiusKm,
  distanceBands = [],
  storeCoordinates,
  customerCoordinates,
}: CanDeliverToAddressInput): DeliveryAvailabilityResult => {
  const fallbackRadius = maxRadiusKm ?? getMaxBandDistance(distanceBands);

  if (fallbackRadius === null || fallbackRadius === undefined) {
    return {
      canDeliver: true,
      distanceKm: null,
      reason: "missing_radius",
      message: "A loja ainda não definiu um raio de entrega por distância.",
      deliveryFee: null,
      matchedBand: null,
    };
  }

  if (!storeCoordinates || !customerCoordinates) {
    return {
      canDeliver: true,
      distanceKm: null,
      reason: "missing_coordinates",
      message: `Endereço salvo para validação futura por distância: ${buildAddressLabel(storeAddress)} -> ${buildAddressLabel(customerAddress)}.`,
      deliveryFee: null,
      matchedBand: null,
    };
  }

  const canDeliver = isWithinDeliveryRadius(storeCoordinates, customerCoordinates, fallbackRadius);
  const distanceKm = getDistance(storeCoordinates, customerCoordinates);

  if (!canDeliver) {
    return {
      canDeliver: false,
      distanceKm,
      reason: "outside_radius",
      message: `No momento, esta loja atende entregas em um raio de até ${fallbackRadius} km. O endereço informado está fora da área de atendimento.`,
      deliveryFee: null,
      matchedBand: null,
    };
  }

  const matchedBand = getDistanceBandForDistance(distanceKm, distanceBands);
  const fee = matchedBand?.fee ?? null;

  return {
    canDeliver: true,
    distanceKm,
    reason: "ok",
    message: matchedBand
      ? `Endereço dentro da área configurada, a aproximadamente ${distanceKm.toFixed(2).replace(".", ",")} km da loja.`
      : `Endereço dentro da área configurada, a aproximadamente ${distanceKm.toFixed(2).replace(".", ",")} km da loja.`,
    deliveryFee: fee,
    matchedBand,
  };
};

export const formatBandLabel = (band: DeliveryDistanceBand) =>
  `${band.startKm.toFixed(1).replace(".", ",")} km até ${band.endKm.toFixed(1).replace(".", ",")} km`;

const formatCurrency = (value: number) => `R$ ${value.toFixed(2).replace(".", ",")}`;

const getDistance = (origin: AddressCoordinates, destination: AddressCoordinates) => {
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
