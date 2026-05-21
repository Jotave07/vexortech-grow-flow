import { backend } from "@/integrations/backend/client";
import { DeliveryQuote } from "@/types/delivery";
import type { AddressCoordinates } from "@/services/viacep";

interface QuoteParams {
  storeId: string;
  cep: string;
  neighborhood: string;
  city: string;
  state: string;
  subtotal: number;
  street?: string;
  number?: string;
  customerCoordinates?: AddressCoordinates | null;
  distanceKm?: number;
  store?: any;
  settings?: any;
}

export const calculateDeliveryQuote = async (params: QuoteParams): Promise<DeliveryQuote> => {
  const { data, error } = await backend.functions.invoke("quote-delivery", {
    body: {
      storeId: params.storeId,
      subtotal: params.subtotal,
      address: {
        cep: params.cep,
        street: params.street,
        number: params.number,
        neighborhood: params.neighborhood,
        city: params.city,
        state: params.state,
      },
      customerCoordinates: params.customerCoordinates || null,
    },
  });

  if (error) {
    return {
      available: false,
      reason: error.message || "Erro ao calcular entrega. Tente novamente.",
      fee: 0,
      estimated_min: 0,
      estimated_max: 0,
      source: "radius",
    };
  }

  return {
    available: Boolean(data?.available),
    reason: data?.reason,
    fee: Number(data?.fee || 0),
    distance_km: data?.distanceKm,
    estimated_min: Number(data?.estimatedMin || 0),
    estimated_max: Number(data?.estimatedMax || 0),
    region: data?.regionId
      ? {
        id: data.regionId,
        store_id: params.storeId,
        name: data.regionName || null,
        is_active: true,
        city: data.normalizedAddress?.city || params.city || null,
        state: data.normalizedAddress?.state || params.state || null,
        neighborhood: data.normalizedAddress?.neighborhood || params.neighborhood || null,
        zip_start: null,
        zip_end: null,
        max_radius_km: null,
        fee: Number(data?.fee || 0),
        fee_per_km: null,
        min_fee: null,
        max_fee: null,
        min_order: null,
        estimated_minutes: null,
        base_prep_time: null,
        minutes_per_km: null,
        additional_region_time: null,
        priority: null,
      }
      : undefined,
    source: data?.source || "radius",
  };
};
