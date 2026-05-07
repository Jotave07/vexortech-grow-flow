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
  name: string | null;
  is_active: boolean | null;
  city: string | null;
  state: string | null;
  neighborhood: string | null;
  zip_start: string | null;
  zip_end: string | null;
  max_radius_km: number | null;
  fee: number | null;
  fee_per_km: number | null;
  min_fee: number | null;
  max_fee: number | null;
  min_order: number | null;
  estimated_minutes: number | null;
  base_prep_time: number | null;
  minutes_per_km: number | null;
  additional_region_time: number | null;
  priority: number | null;
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
