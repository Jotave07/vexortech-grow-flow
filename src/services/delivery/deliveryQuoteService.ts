import { backend } from "@/integrations/backend/client";
import { DeliveryQuote } from "@/types/delivery";
import { getDeliveryRegions, findBestRegion } from "./deliveryRegionService";
import { calculateDeliveryFee } from "./deliveryPricingService";
import { estimateDeliveryTime } from "./deliveryEstimateService";
import { normalizeDistanceBands, calculateDeliveryFeeByDistance } from "@/lib/delivery";
import { geocodeAddressCoordinates, type AddressCoordinates } from "@/services/viacep";
import { getBestDeliveryDistanceKm } from "@/services/distance";

interface QuoteParams {
  storeId: string;
  cep: string;
  neighborhood: string;
  city: string;
  state: string;
  subtotal: number;
  distanceKm?: number;
  street?: string;
  number?: string;
  customerCoordinates?: AddressCoordinates | null;
  store?: any;
  settings?: any;
}

export const calculateDeliveryQuote = async (params: QuoteParams): Promise<DeliveryQuote> => {
  try {
    const [regions, defaults] = await Promise.all([
      getDeliveryRegions(params.storeId),
      params.store && params.settings
        ? Promise.resolve({ store: params.store, settings: params.settings })
        : getStoreDeliveryDefaults(params.storeId),
    ]);

    const radiusQuote = await buildRadiusQuote(params, defaults.store, defaults.settings);
    if (radiusQuote) return radiusQuote;

    const region = findBestRegion(regions, {
      cep: params.cep,
      neighborhood: params.neighborhood,
      city: params.city,
      state: params.state,
    });

    if (!region) {
      const fallback = buildSettingsQuote(params, defaults.store, defaults.settings, regions.length);
      if (fallback) return fallback;

      return {
        available: false,
        reason: "Desculpe, nao entregamos nesta regiao.",
        fee: 0,
        estimated_min: 0,
        estimated_max: 0,
        source: "region",
      };
    }

    const minOrder = Number(region.min_order || 0);
    if (params.subtotal < minOrder) {
      return {
        available: false,
        reason: `Pedido minimo para esta regiao e R$ ${minOrder.toFixed(2)}`,
        region,
        fee: calculateDeliveryFee(region, params.distanceKm),
        min_order: minOrder,
        amount_to_min: minOrder - params.subtotal,
        estimated_min: 0,
        estimated_max: 0,
        source: "region",
      };
    }

    const fee = calculateDeliveryFee(region, params.distanceKm);
    const { min, max } = estimateDeliveryTime(region, params.distanceKm);

    return {
      available: true,
      region,
      fee,
      distance_km: params.distanceKm,
      estimated_min: min,
      estimated_max: max,
      source: params.distanceKm ? "radius" : "region",
    };
  } catch (error) {
    console.error("Delivery Quote Error:", error);
    return {
      available: false,
      reason: "Erro ao calcular entrega. Tente novamente.",
      fee: 0,
      estimated_min: 0,
      estimated_max: 0,
      source: "region",
    };
  }
};

const getStoreDeliveryDefaults = async (storeId: string) => {
  const [storeResult, settingsResult] = await Promise.all([
    backend.from("stores").select("address,address_number,neighborhood,city,state,zip_code,delivery_fee,min_order_amount,latitude,longitude").eq("id", storeId).maybeSingle(),
    backend.from("store_settings").select("*").eq("store_id", storeId).maybeSingle(),
  ]);

  if (storeResult.error) throw storeResult.error;
  if (settingsResult.error) throw settingsResult.error;

  return {
    store: storeResult.data,
    settings: settingsResult.data,
  };
};

const buildRadiusQuote = async (
  params: QuoteParams,
  store: any,
  settings: any,
): Promise<DeliveryQuote | null> => {
  if (!settings?.allow_delivery) {
    return {
      available: false,
      reason: "Esta loja esta aceitando apenas retirada no momento.",
      fee: 0,
      estimated_min: 0,
      estimated_max: 0,
      source: "external",
    };
  }

  const radiusKm = toPositiveNumber(settings.delivery_radius_km);
  const baseFee = Number(settings.delivery_base_fee ?? settings.delivery_fee ?? store?.delivery_fee ?? 0) || 0;
  const feePerKm = Number(settings.delivery_fee_per_km ?? 0) || 0;
  const distanceBands = normalizeDistanceBands(settings.delivery_distance_rules);
  const hasRadiusPricing = Boolean(radiusKm) || feePerKm > 0 || distanceBands.length > 0;
  if (!hasRadiusPricing) return null;

  const storeCoordinates = await resolveStoreCoordinates(store);
  const customerCoordinates = await resolveCustomerCoordinates(params);
  if (!storeCoordinates || !customerCoordinates) {
    return null;
  }

  const { distanceKm, mode } = await getBestDeliveryDistanceKm(storeCoordinates, customerCoordinates);
  const bandRadius = Math.max(...distanceBands.map((band) => band.endKm), 0) || null;
  const effectiveRadius = radiusKm ?? bandRadius;

  if (effectiveRadius && distanceKm > effectiveRadius) {
    return {
      available: false,
      reason: `Endereco a ${formatKm(distanceKm)} da loja. Esta loja atende ate ${formatKm(effectiveRadius)}.`,
      fee: 0,
      distance_km: distanceKm,
      estimated_min: 0,
      estimated_max: 0,
      source: "radius",
    };
  }

  const minOrder = Number(settings.min_order_value ?? settings.min_order_amount ?? store?.min_order_amount ?? 0) || 0;
  const perKmFee = feePerKm > 0 ? baseFee + (feePerKm * distanceKm) : null;
  const bandFee = calculateDeliveryFeeByDistance(distanceKm, distanceBands);
  const fee = roundMoney(perKmFee ?? bandFee ?? baseFee);

  if (params.subtotal < minOrder) {
    return {
      available: false,
      reason: `Pedido minimo para entrega e R$ ${minOrder.toFixed(2)}`,
      fee,
      min_order: minOrder,
      amount_to_min: minOrder - params.subtotal,
      distance_km: distanceKm,
      estimated_min: 0,
      estimated_max: 0,
      source: "radius",
    };
  }

  const prepTime = Number(settings.avg_prep_time_minutes ?? 30) || 30;
  const minutesPerKm = 5;
  const estimatedMin = Math.round(prepTime + distanceKm * minutesPerKm);

  return {
    available: true,
    reason: `${mode === "route" ? "Rota" : "Distancia"} de aproximadamente ${formatKm(distanceKm)}.`,
    fee,
    distance_km: distanceKm,
    estimated_min: estimatedMin,
    estimated_max: Math.round(estimatedMin * 1.25),
    source: "radius",
  };
};

const resolveStoreCoordinates = async (store: any): Promise<AddressCoordinates | null> => {
  const storedCoordinates = readCoordinates(store);
  if (storedCoordinates) return storedCoordinates;

  return geocodeAddressCoordinates({
    street: store?.address ?? "",
    number: store?.address_number ?? "",
    neighborhood: store?.neighborhood ?? "",
    city: store?.city ?? "",
    state: store?.state ?? "",
    zipCode: store?.zip_code ?? "",
  });
};

const resolveCustomerCoordinates = async (params: QuoteParams): Promise<AddressCoordinates | null> => {
  if (params.customerCoordinates) return params.customerCoordinates;

  return geocodeAddressCoordinates({
    street: params.street ?? "",
    number: params.number ?? "",
    neighborhood: params.neighborhood,
    city: params.city,
    state: params.state,
    zipCode: params.cep,
  });
};

const readCoordinates = (value: any): AddressCoordinates | null => {
  const lat = Number(value?.latitude ?? value?.lat);
  const lng = Number(value?.longitude ?? value?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

const toPositiveNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const roundMoney = (value: number) => Number(value.toFixed(2));

const formatKm = (value: number) => `${value.toFixed(1).replace(".", ",")} km`;

const normalizePlace = (value?: string | null) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const samePlace = (left?: string | null, right?: string | null) => {
  if (!left || !right) return true;
  return normalizePlace(left) === normalizePlace(right);
};

const buildSettingsQuote = (
  params: QuoteParams,
  store: any,
  settings: any,
  activeRegionCount: number,
): DeliveryQuote | null => {
  if (!settings?.allow_delivery) {
    return {
      available: false,
      reason: "Esta loja esta aceitando apenas retirada no momento.",
      fee: 0,
      estimated_min: 0,
      estimated_max: 0,
      source: "external",
    };
  }

  if (activeRegionCount > 0) return null;

  if (!samePlace(store?.city, params.city) || !samePlace(store?.state, params.state)) {
    return {
      available: false,
      reason: store?.city && store?.state
        ? `Esta loja atende entregas em ${store.city}/${store.state}.`
        : "Endereco fora da area de entrega configurada.",
      fee: 0,
      estimated_min: 0,
      estimated_max: 0,
      source: "external",
    };
  }

  const minOrder = Number(settings.min_order_value ?? settings.min_order_amount ?? store?.min_order_amount ?? 0);
  const baseFee = Number(settings.delivery_fee ?? settings.delivery_base_fee ?? store?.delivery_fee ?? 0);
  const prepTime = Number(settings.avg_prep_time_minutes ?? 30);

  if (params.subtotal < minOrder) {
    return {
      available: false,
      reason: `Pedido minimo para entrega e R$ ${minOrder.toFixed(2)}`,
      fee: baseFee,
      min_order: minOrder,
      amount_to_min: minOrder - params.subtotal,
      estimated_min: 0,
      estimated_max: 0,
      source: "external",
    };
  }

  return {
    available: true,
    reason: "Entrega calculada pela configuracao padrao da loja.",
    fee: baseFee,
    estimated_min: prepTime,
    estimated_max: Math.round(prepTime * 1.25),
    source: "external",
  };
};
