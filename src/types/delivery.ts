export interface Address {
  cep: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
}

export interface DeliveryRegion {
  id: string;
  store_id: string;
  name: string;
  is_active: boolean;
  city: string;
  state: string;
  neighborhood?: string;
  zip_start?: string;
  zip_end?: string;
  max_radius_km?: number;
  fee: number;
  fee_per_km?: number;
  min_fee?: number;
  max_fee?: number;
  min_order: number;
  estimated_minutes: number;
  base_prep_time: number;
  minutes_per_km: number;
  additional_region_time: number;
  priority: number;
}

export interface DeliveryQuote {
  available: boolean;
  reason?: string;
  region?: DeliveryRegion;
  fee: number;
  distance_km?: number;
  estimated_min: number;
  estimated_max: number;
  min_order?: number;
  amount_to_min?: number;
  source: 'region' | 'radius' | 'external';
}
