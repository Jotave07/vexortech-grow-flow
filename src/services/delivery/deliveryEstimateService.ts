import { DeliveryRegion } from "@/types/delivery";

export const estimateDeliveryTime = (region: DeliveryRegion, distanceKm?: number): { min: number, max: number } => {
  const baseTime = Number(region.base_prep_time) || 30;
  const additionalRegionTime = Number(region.additional_region_time) || 0;
  
  let travelTime = 0;
  if (distanceKm && region.minutes_per_km) {
    travelTime = distanceKm * Number(region.minutes_per_km);
  } else if (region.estimated_minutes) {
    // Fallback if no distance but region has a legacy estimated_minutes
    return {
      min: region.estimated_minutes,
      max: Math.round(region.estimated_minutes * 1.2)
    };
  }

  const totalMin = baseTime + additionalRegionTime + travelTime;
  const totalMax = Math.round(totalMin * 1.25); // 25% margin

  return {
    min: Math.round(totalMin),
    max: Math.round(totalMax)
  };
};
