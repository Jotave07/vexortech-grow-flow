import { DeliveryRegion } from "@/types/delivery";

export const calculateDeliveryFee = (region: DeliveryRegion, distanceKm?: number): number => {
  let fee = Number(region.fee) || 0;

  if (distanceKm && region.fee_per_km) {
    fee += distanceKm * Number(region.fee_per_km);
  }

  if (region.min_fee !== null && region.min_fee !== undefined) {
    fee = Math.max(fee, Number(region.min_fee));
  }

  if (region.max_fee !== null && region.max_fee !== undefined) {
    fee = Math.min(fee, Number(region.max_fee));
  }

  return parseFloat(fee.toFixed(2));
};
