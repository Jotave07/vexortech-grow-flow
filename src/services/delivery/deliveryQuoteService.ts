import { DeliveryQuote, DeliveryRegion } from "@/types/delivery";
import { getDeliveryRegions, findBestRegion } from "./deliveryRegionService";
import { calculateDeliveryFee } from "./deliveryPricingService";
import { estimateDeliveryTime } from "./deliveryEstimateService";

interface QuoteParams {
  storeId: string;
  cep: string;
  neighborhood: string;
  city: string;
  state: string;
  subtotal: number;
  distanceKm?: number;
}

export const calculateDeliveryQuote = async (params: QuoteParams): Promise<DeliveryQuote> => {
  try {
    const regions = await getDeliveryRegions(params.storeId);
    const region = findBestRegion(regions, {
      cep: params.cep,
      neighborhood: params.neighborhood,
      city: params.city,
      state: params.state
    });

    if (!region) {
      return {
        available: false,
        reason: "Desculpe, não entregamos nesta região.",
        fee: 0,
        estimated_min: 0,
        estimated_max: 0,
        source: 'region'
      };
    }

    // Check minimum order
    const minOrder = Number(region.min_order || 0);
    if (params.subtotal < minOrder) {
      return {
        available: false,
        reason: `Pedido mínimo para esta região é R$ ${minOrder.toFixed(2)}`,
        region,
        fee: calculateDeliveryFee(region, params.distanceKm),
        min_order: minOrder,
        amount_to_min: minOrder - params.subtotal,
        estimated_min: 0,
        estimated_max: 0,
        source: 'region'
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
      source: params.distanceKm ? 'radius' : 'region'
    };
  } catch (error) {
    console.error("Delivery Quote Error:", error);
    return {
      available: false,
      reason: "Erro ao calcular entrega. Tente novamente.",
      fee: 0,
      estimated_min: 0,
      estimated_max: 0,
      source: 'region'
    };
  }
};
