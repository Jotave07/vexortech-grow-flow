import { supabase } from "@/lib/supabase";
import { DeliveryRegion } from "@/types/delivery";
import { normalizeCep } from "@/utils/zipCode";

export const getDeliveryRegions = async (storeId: string): Promise<DeliveryRegion[]> => {
  const { data, error } = await supabase
    .from("delivery_zones")
    .select("*")
    .eq("store_id", storeId)
    .eq("is_active", true)
    .order("priority", { ascending: false });

  if (error) throw error;
  return data as DeliveryRegion[];
};

export const findBestRegion = (regions: DeliveryRegion[], address: { cep: string, neighborhood: string, city: string, state: string }): DeliveryRegion | null => {
  const normalizedCep = normalizeCep(address.cep);

  // 1. Check by exact ZIP range (highest priority)
  const zipMatch = regions.find(r => {
    if (!r.zip_start || !r.zip_end) return false;
    const start = normalizeCep(r.zip_start);
    const end = normalizeCep(r.zip_end);
    return normalizedCep >= start && normalizedCep <= end;
  });
  if (zipMatch) return zipMatch;

  // 2. Check by Neighborhood + City + State
  const neighborhoodMatch = regions.find(r => 
    r.neighborhood?.toLowerCase().trim() === address.neighborhood.toLowerCase().trim() &&
    r.city.toLowerCase().trim() === address.city.toLowerCase().trim() &&
    r.state.toLowerCase().trim() === address.state.toLowerCase().trim()
  );
  if (neighborhoodMatch) return neighborhoodMatch;

  // 3. Check by City + State (Whole city rule)
  const cityMatch = regions.find(r => 
    (!r.neighborhood || r.neighborhood === "") &&
    r.city.toLowerCase().trim() === address.city.toLowerCase().trim() &&
    r.state.toLowerCase().trim() === address.state.toLowerCase().trim()
  );
  
  return cityMatch || null;
};
