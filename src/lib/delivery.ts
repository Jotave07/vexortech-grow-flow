import {
  buildAddressLabel,
  isWithinDeliveryRadius,
  type AddressCoordinates,
  type AddressWithCoordinates,
} from "@/services/viacep";

export type DeliveryConfiguration = {
  allowDelivery: boolean;
  allowPickup: boolean;
  minimumOrderValue: number;
  averagePrepTimeMinutes: number;
  deliveryRadiusKm: number | null;
  deliveryBaseFee: number;
  deliveryFeePerKm: number;
  deliveryMessage?: string | null;
};

export type DeliveryValidationIssue = {
  field: keyof DeliveryConfiguration;
  message: string;
};

export type DeliveryAvailabilityResult = {
  canDeliver: boolean;
  distanceKm: number | null;
  reason: "ok" | "delivery_disabled" | "missing_coordinates" | "outside_radius" | "missing_radius";
  message: string;
  deliveryFee: number | null;
};

export const validateDeliverySettings = (config: DeliveryConfiguration) => {
  const issues: DeliveryValidationIssue[] = [];

  if (config.allowDelivery) {
    if (config.deliveryRadiusKm === null || config.deliveryRadiusKm <= 0) {
      issues.push({
        field: "deliveryRadiusKm",
        message: "Informe um raio maior que zero para calcular entregas por distância.",
      });
    }
    if (config.deliveryBaseFee < 0) {
      issues.push({ field: "deliveryBaseFee", message: "A taxa base não pode ser negativa." });
    }
    if (config.deliveryFeePerKm < 0) {
      issues.push({ field: "deliveryFeePerKm", message: "O valor por KM não pode ser negativo." });
    }
    if (config.averagePrepTimeMinutes <= 0) {
      issues.push({
        field: "averagePrepTimeMinutes",
        message: "Defina um tempo médio de entrega/preparo válido.",
      });
    }
  }

  if (!config.allowDelivery && !config.allowPickup) {
    issues.push({
      field: "allowPickup",
      message: "Ative entrega ou retirada para continuar recebendo pedidos.",
    });
  }

  return {
    valid: issues.length === 0,
    issues,
  };
};

export const isDeliveryAvailable = (config: Pick<DeliveryConfiguration, "allowDelivery">) =>
  config.allowDelivery;

export const formatDeliveryFeePreview = (
  radiusKm: number | null,
  baseFee: number,
  feePerKm: number,
) => {
  if (radiusKm === null || radiusKm <= 0) {
    return "Defina um raio máximo para ativar o cálculo automático por localização.";
  }

  const variablePart = feePerKm > 0 ? ` + ${formatCurrency(feePerKm)} por km` : "";

  return `Raio máximo configurado: ${radiusKm.toFixed(1).replace(".", ",")} km. Frete: ${formatCurrency(baseFee)}${variablePart}.`;
};

type CanDeliverToAddressInput = {
  storeAddress: Partial<AddressWithCoordinates>;
  customerAddress: Partial<AddressWithCoordinates>;
  maxRadiusKm: number | null | undefined;
  deliveryBaseFee?: number;
  deliveryFeePerKm?: number;
  storeCoordinates?: AddressCoordinates | null;
  customerCoordinates?: AddressCoordinates | null;
};

export const canDeliverToAddress = ({
  storeAddress,
  customerAddress,
  maxRadiusKm,
  deliveryBaseFee = 0,
  deliveryFeePerKm = 0,
  storeCoordinates,
  customerCoordinates,
}: CanDeliverToAddressInput): DeliveryAvailabilityResult => {
  if (maxRadiusKm === null || maxRadiusKm === undefined || maxRadiusKm <= 0) {
    return {
      canDeliver: false,
      distanceKm: null,
      reason: "missing_radius",
      message: "A loja ainda não definiu um raio de entrega.",
      deliveryFee: null,
    };
  }

  if (!storeCoordinates || !customerCoordinates) {
    return {
      canDeliver: false,
      distanceKm: null,
      reason: "missing_coordinates",
      message: `Não foi possível calcular a distância entre ${buildAddressLabel(storeAddress)} e ${buildAddressLabel(customerAddress)}.`,
      deliveryFee: null,
    };
  }

  const distanceKm = getDistance(storeCoordinates, customerCoordinates);
  if (!isWithinDeliveryRadius(storeCoordinates, customerCoordinates, maxRadiusKm)) {
    return {
      canDeliver: false,
      distanceKm,
      reason: "outside_radius",
      message: `Desculpe, esta loja não atende a sua região. O endereço está a ${formatKm(distanceKm)} da loja e o raio atendido é ${formatKm(maxRadiusKm)}.`,
      deliveryFee: null,
    };
  }

  const fee = roundMoney(
    (Number(deliveryBaseFee) || 0) + (Number(deliveryFeePerKm) || 0) * distanceKm,
  );

  return {
    canDeliver: true,
    distanceKm,
    reason: "ok",
    message: `Endereço dentro da área atendida, a aproximadamente ${formatKm(distanceKm)} da loja.`,
    deliveryFee: fee,
  };
};

const formatCurrency = (value: number) => `R$ ${value.toFixed(2).replace(".", ",")}`;

const formatKm = (value: number) => `${value.toFixed(1).replace(".", ",")} km`;

const roundMoney = (value: number) => Number(value.toFixed(2));

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
