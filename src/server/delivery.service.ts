import { z } from "zod";
import crypto from "node:crypto";
import { query } from "@/backend/db";
import {
  fetchAddressByCep,
  geocodeAddressCoordinates,
  isValidCep,
  type AddressCoordinates,
  type AddressWithCoordinates,
} from "@/services/viacep";
import { getBestDeliveryDistanceKm } from "@/services/distance";
import { deliveryZoneValidationError } from "./delivery-zone-validation";

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
  configurationFingerprint?: string;
};

type QueryExecutor = typeof query;

type DeliveryQuoteDeps = {
  query?: QueryExecutor;
  geocode?: typeof geocodeAddressCoordinates;
  distance?: typeof getBestDeliveryDistanceKm;
  cepLookup?: typeof fetchAddressByCep;
};

const quoteRequestSchema = z
  .object({
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
    customerCoordinates: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .optional()
      .nullable(),
  })
  .refine((value) => value.storeId || value.slug, {
    message: "Informe storeId ou slug.",
  });

const onlyDigits = (value?: string | null) => String(value || "").replace(/\D/g, "");
const upper = (value?: string | null) =>
  String(value || "")
    .trim()
    .toUpperCase();
const clean = (value?: string | null) => String(value || "").trim();
const money = (value: unknown) => Number(Number(value || 0).toFixed(2));
const DEFAULT_DELIVERY_MINUTES_PER_KM = 5;

export const deliveryConfigurationFingerprint = (store: any, settings: any, zones: any[]) =>
  crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        store: [
          store?.id,
          store?.is_active,
          store?.is_suspended,
          store?.latitude,
          store?.longitude,
          store?.zip_code,
          store?.address,
          store?.address_number,
          store?.neighborhood,
          store?.city,
          store?.state,
        ],
        settings: [
          settings?.allow_delivery,
          settings?.delivery_radius_km,
          settings?.free_delivery_above,
          settings?.delivery_base_fee,
          settings?.delivery_fee_per_km,
          settings?.delivery_fee,
          settings?.min_order_value,
          settings?.min_order_amount,
          settings?.avg_prep_time_minutes,
        ],
        zones: [...zones]
          .sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")))
          .map((zone) => [
            zone?.id,
            zone?.is_active,
            zone?.zip_start,
            zone?.zip_end,
            zone?.city,
            zone?.state,
            zone?.neighborhood,
            zone?.priority,
            zone?.fee,
            zone?.fee_per_km,
            zone?.min_fee,
            zone?.max_fee,
            zone?.min_order,
            zone?.max_radius_km,
            zone?.base_prep_time,
            zone?.minutes_per_km,
            zone?.additional_region_time,
          ]),
      }),
    )
    .digest("hex");

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

const unavailable = (
  reason: string,
  extra: Partial<DeliveryQuoteResult> = {},
): DeliveryQuoteResult => ({
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

const mergeCepAddress = (
  address: ReturnType<typeof normalizeAddress>,
  cepAddress: AddressWithCoordinates,
) => ({
  ...address,
  // The requested CEP is the trust anchor for the lookup. Never let an
  // inconsistent provider response silently move the quote to another range.
  cep: address.cep || onlyDigits(cepAddress.cep),
  street: clean(cepAddress.street) || address.street,
  neighborhood: upper(cepAddress.neighborhood) || address.neighborhood,
  city: upper(cepAddress.city) || address.city,
  state: upper(cepAddress.state).slice(0, 2) || address.state,
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
  const cityMatches =
    (!zoneCity || zoneCity === address.city) && (!zoneState || zoneState === address.state);
  if (!cityMatches) return 0;
  if (zoneNeighborhood && zoneNeighborhood !== "GERAL") {
    return zoneNeighborhood === address.neighborhood ? 2 : 0;
  }
  return zoneCity || zoneState ? 1 : 0;
};

const findBestRegion = (zones: any[], address: ReturnType<typeof normalizeAddress>) =>
  zones
    .map((zone) => ({
      zone,
      rank: matchRegionRank(zone, address),
      priority: Number(zone.priority || 0),
    }))
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

const applyStoreFreeDelivery = (fee: number, subtotal: number, settings: any) => {
  const freeDeliveryAbove = readNumber(settings?.free_delivery_above);
  if (freeDeliveryAbove !== null && freeDeliveryAbove > 0 && subtotal >= freeDeliveryAbove)
    return 0;
  return fee;
};

export const resolveRadiusDeliveryPricing = (settings: any) => {
  const baseFee = Math.max(0, readNumber(settings?.delivery_base_fee) ?? 0);
  const feePerKm = Math.max(0, readNumber(settings?.delivery_fee_per_km) ?? 0);
  const legacyFee = Math.max(0, readNumber(settings?.delivery_fee) ?? 0);
  const hasCurrentPricing = baseFee > 0 || feePerKm > 0 || legacyFee === 0;
  return { baseFee: hasCurrentPricing ? baseFee : legacyFee, feePerKm };
};

export const quoteDelivery = async (
  input: DeliveryQuoteInput,
  deps: DeliveryQuoteDeps = {},
): Promise<DeliveryQuoteResult> => {
  const runQuery = deps.query || query;
  const geocode = deps.geocode || geocodeAddressCoordinates;
  const distance = deps.distance || getBestDeliveryDistanceKm;
  const cepLookup = deps.cepLookup || fetchAddressByCep;

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

  let address = normalizeAddress(input.address);
  let cepCoordinates: AddressCoordinates | null = null;
  if (!isValidCep(address.cep)) {
    return unavailable("Informe um CEP valido para calcular a entrega.");
  }

  const { rows: zones } = await runQuery(
    `SELECT *
     FROM public.delivery_zones
     WHERE store_id = $1 AND is_active IS TRUE`,
    [input.storeId],
  );
  const invalidZone = zones.find((zone) => deliveryZoneValidationError(zone));
  if (invalidZone) {
    return unavailable(
      "A configuracao das regioes de entrega e invalida. A loja precisa revisa-la.",
      {
        normalizedAddress: address,
      },
    );
  }
  const configurationFingerprint = deliveryConfigurationFingerprint(store, settings, zones);
  const resolveCepIntoAddress = async () => {
    try {
      const resolvedAddress = await cepLookup(address.cep);
      const resolvedCep = onlyDigits(resolvedAddress.cep);
      if (resolvedCep && resolvedCep !== address.cep) return false;
      address = mergeCepAddress(address, resolvedAddress);
      const lat = readNumber(resolvedAddress.lat);
      const lng = readNumber(resolvedAddress.lng);
      if (lat !== null && lng !== null) {
        cepCoordinates = { lat, lng };
      }
      return true;
    } catch {
      return false;
    }
  };

  // CEP data is resolved server-side even when the client sent a complete address.
  // This prevents a client from pairing a valid delivery zone with another city/street.
  if (!(await resolveCepIntoAddress())) {
    return unavailable("Nao foi possivel validar o CEP informado. Tente novamente.", {
      normalizedAddress: { cep: address.cep },
    });
  }
  const region = findBestRegion(zones, address);

  let storeCoordinates = readCoordinates(store);
  // Client GPS coordinates are UX hints only. Pricing and radius checks use
  // coordinates derived from the server-normalized delivery address.
  let customerCoordinates: AddressCoordinates | null = cepCoordinates;
  let distanceKm: number | null = null;

  const resolveDistanceKm = async () => {
    const hasGeocodableAddress = Boolean(
      address.city && address.state && (address.street || address.neighborhood || address.cep),
    );
    if (!customerCoordinates && !hasGeocodableAddress) return null;
    if (!customerCoordinates && hasGeocodableAddress) {
      customerCoordinates = await geocode(addressForGeocode(address));
    }
    if (!customerCoordinates) return null;
    if (!storeCoordinates) {
      storeCoordinates = await geocode(
        addressForGeocode(
          normalizeAddress({
            cep: store.zip_code,
            street: store.address,
            number: store.address_number,
            neighborhood: store.neighborhood,
            city: store.city,
            state: store.state,
          }),
        ),
      );
    }
    if (!storeCoordinates || !customerCoordinates) return null;
    const result = await distance(storeCoordinates, customerCoordinates);
    return Number.isFinite(result.distanceKm) && result.distanceKm >= 0 ? result.distanceKm : null;
  };

  if (!region) {
    const globalRadiusKm = readNumber(settings.delivery_radius_km);
    if (!globalRadiusKm || globalRadiusKm <= 0) {
      return unavailable("Esta loja ainda nao configurou uma regiao ou raio maximo de entrega.", {
        normalizedAddress: address,
      });
    }

    distanceKm = await resolveDistanceKm();
    if (distanceKm === null) {
      return unavailable("Nao foi possivel calcular a distancia para validar o raio de entrega.", {
        normalizedAddress: address,
      });
    }

    if (distanceKm > globalRadiusKm) {
      return unavailable("Regiao nao atendida. Endereco fora do raio de entrega da loja.", {
        distanceKm,
        normalizedAddress: address,
      });
    }

    const minOrder =
      readNumber(settings.min_order_value) ?? readNumber(settings.min_order_amount) ?? 0;
    const radiusPricing = resolveRadiusDeliveryPricing(settings);
    const rawFee = radiusPricing.baseFee + radiusPricing.feePerKm * distanceKm;
    const fee = applyStoreFreeDelivery(money(rawFee), input.subtotal, settings);
    if (!Number.isFinite(fee) || fee < 0) {
      return unavailable("A configuracao do frete por raio e invalida.", {
        distanceKm,
        normalizedAddress: address,
      });
    }

    if (input.subtotal < minOrder) {
      return unavailable(`Pedido minimo para entrega e R$ ${minOrder.toFixed(2)}.`, {
        fee,
        distanceKm,
        source: "radius",
        normalizedAddress: address,
      });
    }

    const basePrep = readNumber(settings.avg_prep_time_minutes) ?? 30;
    const estimatedMin = Math.max(
      1,
      Math.round(basePrep + DEFAULT_DELIVERY_MINUTES_PER_KM * distanceKm),
    );

    return {
      available: true,
      fee,
      distanceKm,
      estimatedMin,
      estimatedMax: Math.round(estimatedMin * 1.25),
      regionId: null,
      regionName: null,
      source: "radius",
      normalizedAddress: address,
      configurationFingerprint,
    };
  }

  distanceKm = await resolveDistanceKm();

  const globalRadiusKm = readNumber(settings.delivery_radius_km);
  const regionRadiusKm = readNumber(region.max_radius_km);
  const feePerKm = readNumber(region.fee_per_km) ?? 0;
  if (
    distanceKm === null &&
    ((globalRadiusKm ?? 0) > 0 || (regionRadiusKm ?? 0) > 0 || feePerKm > 0)
  ) {
    return unavailable(
      "Nao foi possivel calcular a distancia exigida para esta regiao de entrega.",
      {
        regionId: region.id,
        regionName: region.name || region.neighborhood || null,
        source: "region",
        normalizedAddress: address,
      },
    );
  }

  if (
    distanceKm !== null &&
    globalRadiusKm !== null &&
    globalRadiusKm > 0 &&
    distanceKm > globalRadiusKm
  ) {
    return unavailable("Regiao nao atendida. Endereco fora do raio de entrega da loja.", {
      distanceKm,
      regionId: region.id,
      regionName: region.name || region.neighborhood || null,
      source: "region",
      normalizedAddress: address,
    });
  }

  if (
    distanceKm !== null &&
    regionRadiusKm !== null &&
    regionRadiusKm > 0 &&
    distanceKm > regionRadiusKm
  ) {
    return unavailable("Regiao nao atendida. Endereco fora do raio desta regiao de entrega.", {
      distanceKm,
      regionId: region.id,
      regionName: region.name || region.neighborhood || null,
      source: "region",
      normalizedAddress: address,
    });
  }

  const minOrder = readNumber(region.min_order) || 0;
  const rawFee = (readNumber(region.fee) || 0) + feePerKm * (distanceKm || 0);
  const fee = applyStoreFreeDelivery(applyFeeBounds(rawFee, region), input.subtotal, settings);
  if (!Number.isFinite(fee) || fee < 0) {
    return unavailable("A configuracao de preco desta regiao de entrega e invalida.", {
      ...(distanceKm !== null ? { distanceKm } : {}),
      regionId: region.id,
      regionName: region.name || region.neighborhood || null,
      source: "region",
      normalizedAddress: address,
    });
  }

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

  const basePrep =
    readNumber(region.base_prep_time) ?? readNumber(settings.avg_prep_time_minutes) ?? 30;
  const minutesPerKm = readNumber(region.minutes_per_km) ?? 5;
  const additionalRegionTime = readNumber(region.additional_region_time) ?? 0;
  const estimatedMin = Math.max(
    1,
    Math.round(basePrep + minutesPerKm * (distanceKm || 0) + additionalRegionTime),
  );

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
    configurationFingerprint,
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
