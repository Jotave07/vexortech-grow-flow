import { calculateDistanceKm, type AddressCoordinates } from "@/services/viacep";
import { fetchGoogleDrivingDistanceKm } from "@/services/googleMaps";

const OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving";

export const fetchDrivingDistanceKm = async (
  origin: AddressCoordinates,
  destination: AddressCoordinates,
): Promise<number | null> => {
  const googleDistance = await fetchGoogleDrivingDistanceKm(origin, destination);
  if (googleDistance !== null) return googleDistance;

  try {
    const url = new URL(`${OSRM_ROUTE_URL}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}`);
    url.searchParams.set("overview", "false");
    url.searchParams.set("alternatives", "false");
    url.searchParams.set("steps", "false");

    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) return null;

    const payload = (await response.json()) as { routes?: Array<{ distance?: number }> };
    const meters = payload.routes?.[0]?.distance;
    return typeof meters === "number" && Number.isFinite(meters) ? meters / 1000 : null;
  } catch {
    return null;
  }
};

export const getBestDeliveryDistanceKm = async (
  origin: AddressCoordinates,
  destination: AddressCoordinates,
) => {
  const drivingDistance = await fetchDrivingDistanceKm(origin, destination);
  if (drivingDistance !== null) {
    return {
      distanceKm: Number(drivingDistance.toFixed(2)),
      mode: "route" as const,
    };
  }

  return {
    distanceKm: Number(calculateDistanceKm(origin, destination).toFixed(2)),
    mode: "straight" as const,
  };
};
