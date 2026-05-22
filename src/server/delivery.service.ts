import { z } from "zod";
import { query } from "@/backend/db";
import { geocodeAddressCoordinates, type AddressCoordinates } from "@/services/viacep";
import { getBestDeliveryDistanceKm } from "@/services/distance";

export type DeliveryQuoteInput = {
  storeId: string;
  subtotal: number;
  address: {
    cep?: string | null;
    street?: string | null;
    number?: string | null;
    neighborhood?: string | null;
    city?: string | null;
    state?: string | null;
    complement?: string | null;
  };
  customerCoordinates?: AddressCoordinates | null;
};

export type DeliveryQuoteResult = {
  available: boolean;
  reason?: string;
  fee: number;
  distanceKm?: number;
  estimatedMin?: number;
  estimatedMax?: number;
  regionId?: string | null;
  regionName?: string | null;
  source: "region" | "radius";
  normalizedAddress?: {
    cep?: string;
    street?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
  };
};

type QueryExecutor = typeof query;

type DeliveryQuoteDeps = {
  query?: QueryExecutor;
  geocode?: typeof geocodeAddressCoordinates;
  distance?: typeof getBestDeliveryDistanceKm;
};

const quoteRequestSchema = z.object({
  storeId: z.string().uuid().optional(),
  slug: z.string().min(1).max(160).optional(),
  subtotal: z.number().nonnegative().default(0),
  address: z.object({
    cep: z.string().max(16).optional().nullable(),
    street: z.string().max(200).optional().nullable(),
    number: z.string().max(40).optional().nullable(),
    complement: z.string().max(120).optional().nullable(),
    neighborhood: z.string().max(120).optional().nullable(),
    city: z.string().max(120).optional().nullable(),
    state: z.string().max(2).optional().nullable(),
  }),
  customerCoordinates: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional().nullable(),
}).refine((value) => value.storeId || value.slug, {
  message: "Informe storeId ou slug.",
});

const onlyDigits = (value?: string | null) => String(value || "").replace(/\D/g, "");
const upper = (value?: string | null) => String(value || "").trim().toUpperCase();
const clean = (value?: string | null) => String(value || "").trim();
const money = (value: unknown) => Number(Number(value || 0).toFixed(2));

const readNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readCoordinates = (row: any): AddressCoordinates | null => {
  const lat = readNumber(row?.latitude ?? row?.lat);
  const lng = readNumber(row?.longitude ?? row?.lng);
  return lat !== null && lng !== null ? { lat, lng } : null;
};

const unavailable = (reason: string, extra: Partial<DeliveryQuoteResult> = {}): DeliveryQuoteResult => ({
  available: false,
  reason,
  fee: 0,
  source: "radius",
  ...extra,
});

const normalizeAddress = (address: DeliveryQuoteInput["address"]) => ({
  cep: onlyDigits(address.cep),
  street: clean(address.street),
  number: clean(address.number),
  complement: clean(address.complement),
  neighborhood: upper(address.neighborhood),
  city: upper(address.city),
  state: upper(address.state).slice(0, 2),
});

const addressForGeocode = (address: ReturnType<typeof normalizeAddress>) => ({
  street: address.street,
  number: address.number,
  neighborhood: address.neighborhood,
  city: address.city,
  state: address.state,
  zipCode: address.cep,
});

const zipInRange = (zip: string, start?: string | null, end?: string | null) => {
  const normalizedStart = onlyDigits(start);
  const normalizedEnd = onlyDigits(end);
  if (!zip || !normalizedStart || !normalizedEnd) return false;
  return zip >= normalizedStart && zip <= normalizedEnd;
};

const matchRegionRank = (zone: any, address: ReturnType<typeof normalizeAddress>) => {
  if (zipInRange(address.cep, zone.zip_start, zone.zip_end)) return 3;

  const zoneCity = upper(zone.city);
  const zoneState = upper(zone.state);
  const zoneNeighborhood = upper(zone.neighborhood);
  const cityMatches = (!zoneCity || zoneCity === address.city) && (!zoneState || zoneState === address.state);
  if (!cityMatches) return 0;
  if (zoneNeighborhood && zoneNeighborhood !== "GERAL") {
    return zoneNeighborhood === address.neighborhood ? 2 : 0;
  }
  return zoneCity || zoneState ? 1 : 0;
};

const findBestRegion = (zones: any[], address: ReturnType<typeof normalizeAddress>) =>
  zones
    .map((zone) => ({ zone, rank: matchRegionRank(zone, address), priority: Number(zone.priority || 0) }))
    .filter((match) => match.rank > 0)
    .sort((a, b) => b.rank - a.rank || b.priority - a.priority)[0]?.zone || null;

const applyFeeBounds = (fee: number, zone: any) => {
  let result = fee;
  const minFee = readNumber(zone.min_fee);
  const maxFee = readNumber(zone.max_fee);
  if (minFee !== null) result = Math.max(result, minFee);
  if (maxFee !== null) result = Math.min(result, maxFee);
  return money(result);
};

export const quoteDelivery = async (
  input: DeliveryQuoteInput,
  deps: DeliveryQuoteDeps = {},
): Promise<DeliveryQuoteResult> => {
  const runQuery = deps.query || query;
  const geocode = deps.geocode || geocodeAddressCoordinates;
  const distance = deps.distance || getBestDeliveryDistanceKm;

  const { rows: stores } = await runQuery(
    `SELECT *
     FROM public.stores
     WHERE id = $1 AND COALESCE(is_active, true) IS TRUE
     LIMIT 1`,
    [input.storeId],
  );
  const store = stores[0];
  if (!store || store.is_suspended) {
    return unavailable("Loja indisponivel para entrega.");
  }

  const { rows: settingsRows } = await runQuery(
    `SELECT *
     FROM public.store_settings
     WHERE store_id = $1
     LIMIT 1`,
    [input.storeId],
  );
  const settings = settingsRows[0];
  if (!settings?.allow_delivery) {
    return unavailable("Esta loja esta aceitando apenas retirada no momento.");
  }

  const address = normalizeAddress(input.address);
  if (!address.cep && (!address.city || !address.state || !address.street || !address.number)) {
    return unavailable("Informe um CEP ou endereco completo para calcular a entrega.");
  }

  const { rows: zones } = await runQuery(
    `SELECT *
     FROM public.delivery_zones
     WHERE store_id = $1 AND COALESCE(is_active, true) IS TRUE`,
    [input.storeId],
  );
  const region = findBestRegion(zones, address);

  let storeCoordinates = readCoordinates(store);
  let customerCoordinates = input.customerCoordinates || null;
  let distanceKm: number | null = null;

  const resolveDistanceKm = async () => {
    if (!customerCoordinates && (!address.city || !address.state || !address.street || !address.number)) return null;
    if (!customerCoordinates && address.city && address.state && address.street && address.number) {
      customerCoordinates = await geocode(addressForGeocode(address));
    }
    if (!customerCoordinates) return null;
    if (!storeCoordinates) {
      storeCoordinates = await geocode(addressForGeocode(normalizeAddress({
        cep: store.zip_code,
        street: store.address,
        number: store.address_number,
        neighborhood: store.neighborhood,
        city: store.city,
        state: store.state,
      })));
    }
    if (!storeCoordinates || !customerCoordinates) return null;
    const result = await distance(storeCoordinates, customerCoordinates);
    return result.distanceKm;
  };

  if (!region) {
    const globalRadiusKm = readNumber(settings.delivery_radius_km);
    if (!globalRadiusKm || globalRadiusKm <= 0) {
      return unavailable("Esta loja ainda nao configurou uma regiao ou raio maximo de entrega.", {
        normalizedAddress: address,
      });
    }

    distanceKm = await resolveDistanceKm();
    if (distanceKm !== null && distanceKm > globalRadiusKm) {
      return unavailable("Regiao nao atendida. Endereco fora do raio de entrega da loja.", {
        distanceKm,
        normalizedAddress: address,
      });
    }

    return unavailable("Regiao nao atendida. Esta loja ainda nao entrega nesse endereco.", {
      ...(distanceKm !== null ? { distanceKm } : {}),
      normalizedAddress: address,
    });
  }

  distanceKm = await resolveDistanceKm();

  const globalRadiusKm = readNumber(settings.delivery_radius_km);
  if (distanceKm !== null && globalRadiusKm !== null && globalRadiusKm > 0 && distanceKm > globalRadiusKm) {
    return unavailable("Regiao nao atendida. Endereco fora do raio de entrega da loja.", {
      distanceKm,
      regionId: region.id,
      regionName: region.name || region.neighborhood || null,
      source: "region",
      normalizedAddress: address,
    });
  }

  const regionRadiusKm = readNumber(region.max_radius_km);
  if (distanceKm !== null && regionRadiusKm !== null && regionRadiusKm > 0 && distanceKm > regionRadiusKm) {
    return unavailable("Regiao nao atendida. Endereco fora do raio desta regiao de entrega.", {
      distanceKm,
      regionId: region.id,
      regionName: region.name || region.neighborhood || null,
      source: "region",
      normalizedAddress: address,
    });
  }

  const minOrder = readNumber(region.min_order) || 0;
  const rawFee = (readNumber(region.fee) || 0) + (readNumber(region.fee_per_km) || 0) * (distanceKm || 0);
  const fee = applyFeeBounds(rawFee, region);

  if (input.subtotal < minOrder) {
    return unavailable(`Pedido minimo para esta regiao e R$ ${minOrder.toFixed(2)}.`, {
      fee,
      ...(distanceKm !== null ? { distanceKm } : {}),
      regionId: region.id,
      regionName: region.name || region.neighborhood || null,
      source: "region",
      normalizedAddress: address,
    });
  }

  const basePrep = readNumber(region.base_prep_time) ?? readNumber(settings.avg_prep_time_minutes) ?? 30;
  const minutesPerKm = readNumber(region.minutes_per_km) ?? 5;
  const additionalRegionTime = readNumber(region.additional_region_time) ?? 0;
  const estimatedMin = Math.max(1, Math.round(basePrep + minutesPerKm * (distanceKm || 0) + additionalRegionTime));

  return {
    available: true,
    fee,
    ...(distanceKm !== null ? { distanceKm } : {}),
    estimatedMin,
    estimatedMax: Math.round(estimatedMin * 1.25),
    regionId: region.id,
    regionName: region.name || region.neighborhood || null,
    source: "region",
    ...(distanceKm === null ? { reason: "Frete validado pela faixa de CEP." } : {}),
    normalizedAddress: address,
  };
};

export const quoteDeliveryHandler = async (body: unknown) => {
  const input = quoteRequestSchema.parse(body);
  let storeId = input.storeId;

  if (!storeId && input.slug) {
    const { rows } = await query(
      `SELECT id FROM public.stores WHERE slug = $1 AND COALESCE(is_active, true) IS TRUE LIMIT 1`,
      [input.slug],
    );
    storeId = rows[0]?.id;
  }

  if (!storeId) throw new Error("Loja nao encontrada.");

  return quoteDelivery({
    storeId,
    subtotal: input.subtotal,
    address: input.address,
    customerCoordinates: input.customerCoordinates || null,
  });
};
