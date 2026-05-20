import { supabase } from "@/integrations/supabase/client";
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
  const normalizeText = (value?: string | null) =>
    (value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();

  // 1. Check by exact ZIP range (highest priority)
  const zipMatch = regions.find(r => {
    if (!normalizedCep || !r.zip_start) return false;
    const start = normalizeCep(r.zip_start);
    const end = normalizeCep(r.zip_end || r.zip_start);
    return normalizedCep >= start && normalizedCep <= end;
  });
  if (zipMatch) return zipMatch;

  // 2. Check by Neighborhood + City + State
  const neighborhoodMatch = regions.find(r => 
    normalizeText(r.neighborhood) === normalizeText(address.neighborhood) &&
    normalizeText(r.city) === normalizeText(address.city) &&
    normalizeText(r.state) === normalizeText(address.state)
  );
  if (neighborhoodMatch) return neighborhoodMatch;

  // 3. Check by City + State (Whole city rule)
  const cityMatch = regions.find(r => 
    (!r.neighborhood || r.neighborhood === "") &&
    normalizeText(r.city) === normalizeText(address.city) &&
    normalizeText(r.state) === normalizeText(address.state)
  );
  
  return cityMatch || null;
};
