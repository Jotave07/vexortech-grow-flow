import { backend } from "@/integrations/backend/client";
import { DeliveryQuote } from "@/types/delivery";
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
    const defaults =
      params.store && params.settings
        ? { store: params.store, settings: params.settings }
        : await getStoreDeliveryDefaults(params.storeId);

    return await buildRadiusQuote(params, defaults.store, defaults.settings);
  } catch (error) {
    console.error("Delivery Quote Error:", error);
    return {
      available: false,
      reason: "Erro ao calcular entrega. Tente novamente.",
      fee: 0,
      estimated_min: 0,
      estimated_max: 0,
      source: "radius",
    };
  }
};

const getStoreDeliveryDefaults = async (storeId: string) => {
  const [storeResult, settingsResult] = await Promise.all([
    backend
      .from("stores")
      .select(
        "address,address_number,neighborhood,city,state,zip_code,delivery_fee,min_order_amount,latitude,longitude",
      )
      .eq("id", storeId)
      .maybeSingle(),
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
): Promise<DeliveryQuote> => {
  if (!settings?.allow_delivery) {
    return {
      available: false,
      reason: "Esta loja esta aceitando apenas retirada no momento.",
      fee: 0,
      estimated_min: 0,
      estimated_max: 0,
      source: "radius",
    };
  }

  const radiusKm = toPositiveNumber(settings.delivery_radius_km);
  if (!radiusKm) {
    return {
      available: false,
      reason: "Esta loja ainda nao configurou o raio de entrega.",
      fee: 0,
      estimated_min: 0,
      estimated_max: 0,
      source: "radius",
    };
  }

  const storeCoordinates = await resolveStoreCoordinates(store);
  if (!storeCoordinates) {
    return {
      available: false,
      reason: "A loja precisa configurar uma localizacao valida para calcular o frete.",
      fee: 0,
      estimated_min: 0,
      estimated_max: 0,
      source: "radius",
    };
  }

  const customerCoordinates = await resolveCustomerCoordinates(params);
  if (!customerCoordinates) {
    return {
      available: false,
      reason: "Use sua localizacao atual ou informe um endereco completo para calcular a entrega.",
      fee: 0,
      estimated_min: 0,
      estimated_max: 0,
      source: "radius",
    };
  }

  const { distanceKm, mode } = await getBestDeliveryDistanceKm(
    storeCoordinates,
    customerCoordinates,
  );

  if (distanceKm > radiusKm) {
    return {
      available: false,
      reason:
        settings.delivery_message?.trim() ||
        `Desculpe, esta loja nao atende a sua regiao. Endereco a ${formatKm(distanceKm)} da loja; raio atendido: ${formatKm(radiusKm)}.`,
      fee: 0,
      distance_km: distanceKm,
      estimated_min: 0,
      estimated_max: 0,
      source: "radius",
    };
  }

  const minOrder =
    Number(settings.min_order_value ?? settings.min_order_amount ?? store?.min_order_amount ?? 0) ||
    0;
  const baseFee =
    Number(settings.delivery_base_fee ?? settings.delivery_fee ?? store?.delivery_fee ?? 0) || 0;
  const feePerKm = Number(settings.delivery_fee_per_km ?? 0) || 0;
  const fee = roundMoney(baseFee + feePerKm * distanceKm);

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

const resolveCustomerCoordinates = async (
  params: QuoteParams,
): Promise<AddressCoordinates | null> => {
  if (params.customerCoordinates) return params.customerCoordinates;
  if (!params.street || !params.number || !params.city || !params.state) return null;

  return geocodeAddressCoordinates({
    street: params.street,
    number: params.number,
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
