type ValidationOptions = {
  partial?: boolean;
};

type NumericRule = {
  field: string;
  label: string;
  min: number;
  max: number;
  integer?: boolean;
  nullable?: boolean;
};

const numericRules: NumericRule[] = [
  { field: "fee", label: "taxa base", min: 0, max: 100_000 },
  { field: "fee_per_km", label: "taxa por km", min: 0, max: 10_000 },
  { field: "min_fee", label: "taxa minima", min: 0, max: 100_000, nullable: true },
  { field: "max_fee", label: "taxa maxima", min: 0, max: 100_000, nullable: true },
  { field: "min_order", label: "pedido minimo", min: 0, max: 1_000_000 },
  { field: "max_radius_km", label: "raio maximo", min: 0.1, max: 500, nullable: true },
  { field: "base_prep_time", label: "tempo base de preparo", min: 1, max: 240, integer: true },
  { field: "minutes_per_km", label: "minutos por km", min: 0, max: 120 },
  { field: "additional_region_time", label: "tempo adicional", min: 0, max: 240, integer: true },
  {
    field: "estimated_minutes",
    label: "tempo estimado",
    min: 1,
    max: 480,
    integer: true,
    nullable: true,
  },
  { field: "priority", label: "prioridade", min: 0, max: 1_000, integer: true },
];

const hasOwn = (row: Record<string, unknown>, field: string) =>
  Object.prototype.hasOwnProperty.call(row, field);

const numericValue = (value: unknown) => {
  if (typeof value === "boolean" || (typeof value === "string" && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizedZip = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const clean = (value: unknown) => String(value ?? "").trim();

export const deliveryZoneValidationError = (
  candidate: unknown,
  options: ValidationOptions = {},
): string | null => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return "Regiao de entrega invalida.";
  }
  const row = candidate as Record<string, unknown>;
  const partial = options.partial === true;
  const active = row.is_active !== false;

  for (const rule of numericRules) {
    if (partial && !hasOwn(row, rule.field)) continue;
    const value = row[rule.field];
    if (value === undefined) continue;
    if (value === null || value === "") {
      if (rule.nullable) continue;
      return `A ${rule.label} da regiao deve ser informada.`;
    }
    const parsed = numericValue(value);
    if (
      parsed === null ||
      parsed < rule.min ||
      parsed > rule.max ||
      (rule.integer && !Number.isInteger(parsed))
    ) {
      return `A ${rule.label} da regiao deve ficar entre ${rule.min} e ${rule.max}${rule.integer ? " e ser inteira" : ""}.`;
    }
  }

  const minFee = numericValue(row.min_fee);
  const maxFee = numericValue(row.max_fee);
  if (minFee !== null && maxFee !== null && minFee > maxFee) {
    return "A taxa minima da regiao nao pode superar a taxa maxima.";
  }

  if (active && ((!partial && row.name !== undefined) || hasOwn(row, "name"))) {
    if (!clean(row.name)) return "A regiao de entrega precisa de um nome.";
  }
  if (hasOwn(row, "state") && clean(row.state) && !/^[A-Za-z]{2}$/.test(clean(row.state))) {
    return "A UF da regiao deve ter 2 letras.";
  }

  const hasZipStart = hasOwn(row, "zip_start");
  const hasZipEnd = hasOwn(row, "zip_end");
  if (active && (!partial || (hasZipStart && hasZipEnd))) {
    const start = normalizedZip(row.zip_start);
    const end = normalizedZip(row.zip_end);
    if (Boolean(start) !== Boolean(end)) return "A faixa da regiao exige CEP inicial e final.";
    if (start && (!/^\d{8}$/.test(start) || !/^\d{8}$/.test(end) || start > end)) {
      return "A faixa de CEP da regiao e invalida.";
    }
    if (!start && (!clean(row.city) || !/^[A-Za-z]{2}$/.test(clean(row.state)))) {
      return "Sem faixa de CEP, a regiao exige cidade e UF validas.";
    }
  }

  return null;
};

export const assertValidDeliveryZone = (candidate: unknown, options: ValidationOptions = {}) => {
  const error = deliveryZoneValidationError(candidate, options);
  if (error) throw new Error(error);
};
