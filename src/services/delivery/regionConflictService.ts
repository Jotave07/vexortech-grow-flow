export interface DeliveryRegion {
  id?: string;
  name: string;
  city: string;
  state: string;
  neighborhood: string;
  zip_start: string;
  zip_end: string;
  max_radius_km: number;
  is_active: boolean;
}

export interface RegionConflict {
  type: "cep_overlap" | "neighborhood_duplicate" | "city_duplicate";
  regionA: string; // region name
  regionB: string; // region name
  detail: string;
}

/**
 * Detect conflicts between delivery regions for the same store.
 * Checks CEP range overlaps and neighborhood/city duplicates.
 */
export const detectRegionConflicts = (
  regions: DeliveryRegion[],
  currentRegionId?: string,
): RegionConflict[] => {
  const conflicts: RegionConflict[] = [];
  const active = regions.filter((r) => r.is_active);

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];

      // Skip self-comparison
      if (currentRegionId && (a.id === currentRegionId || b.id === currentRegionId)) continue;

      // Check CEP range overlap
      if (a.zip_start && a.zip_end && b.zip_start && b.zip_end) {
        const aStart = normalizeCep(a.zip_start);
        const aEnd = normalizeCep(a.zip_end);
        const bStart = normalizeCep(b.zip_start);
        const bEnd = normalizeCep(b.zip_end);

        if (rangesOverlap(aStart, aEnd, bStart, bEnd)) {
          conflicts.push({
            type: "cep_overlap",
            regionA: a.name,
            regionB: b.name,
            detail: `CEP ${a.zip_start}-${a.zip_end} sobrepõe ${b.zip_start}-${b.zip_end}`,
          });
        }
      }

      // Check neighborhood duplicate in same city
      if (
        normalizeText(a.city) === normalizeText(b.city) &&
        normalizeText(a.state) === normalizeText(b.state) &&
        normalizeText(a.neighborhood) === normalizeText(b.neighborhood) &&
        a.neighborhood.toLowerCase() !== "geral"
      ) {
        conflicts.push({
          type: "neighborhood_duplicate",
          regionA: a.name,
          regionB: b.name,
          detail: `Bairro "${a.neighborhood}" duplicado em ${a.city}/${a.state}`,
        });
      }
    }
  }

  return conflicts;
};

const normalizeCep = (cep: string): number => {
  return parseInt(cep.replace(/\D/g, ""), 10) || 0;
};

const normalizeText = (text: string): string => {
  return (text || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
};

const rangesOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number): boolean => {
  return aStart <= bEnd && bStart <= aEnd;
};
