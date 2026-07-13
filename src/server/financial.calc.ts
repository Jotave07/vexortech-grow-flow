/**
 * Calculo de valores financeiros do fluxo Asaas centralizado.
 *
 * REGRA DE OURO: dinheiro NUNCA em float binario. Todo calculo e feito em
 * centavos inteiros e so convertido para reais (numeric) no limite de I/O.
 */

export const toCents = (value: number | string | null | undefined): number =>
  Math.round(Number(value ?? 0) * 100);

export const toReais = (cents: number): number => Math.round(cents) / 100;

export type RepasseInput = {
  /** total pago pelo cliente (reais) */
  totalPaid: number | string | null | undefined;
  /** valor ja reembolsado ao cliente (reais), se houver */
  refundedAmount?: number | string | null | undefined;
  /** taxa percentual da plataforma (ex.: 8.5 = 8,5%) */
  taxaPercentual?: number | string | null | undefined;
  /** taxa fixa da plataforma (reais) */
  taxaFixa?: number | string | null | undefined;
};

export type RepasseResult = {
  /** base de calculo (reais) = total pago - reembolsado */
  baseAmount: number;
  /** taxa percentual aplicada (reais) */
  feePercentAmount: number;
  /** taxa fixa aplicada (reais) */
  feeFixedAmount: number;
  /** soma das taxas da plataforma (reais) */
  platformFee: number;
  /** valor liquido a repassar ao lojista (reais) */
  transferAmount: number;
  /** true quando o repasse nao pode ser feito automaticamente (<= 0) */
  blocked: boolean;
  blockReason?: string;
};

/**
 * Calcula o valor liquido de repasse ao lojista.
 *
 *   base            = totalPaid - refunded
 *   taxaPercentual  = base * pct / 100
 *   taxaFixa        = fixa
 *   repasse         = base - taxaPercentual - taxaFixa
 *
 * Se repasse <= 0, marca blocked (exige revisao manual). Nunca retorna negativo.
 */
export const calcularValorRepasse = (input: RepasseInput): RepasseResult => {
  const baseCents = Math.max(0, toCents(input.totalPaid) - toCents(input.refundedAmount));

  const pct = Number(input.taxaPercentual ?? 0);
  const feePercentCents = pct > 0 ? Math.round((baseCents * pct) / 100) : 0;
  const feeFixedCents = Math.max(0, toCents(input.taxaFixa));
  const platformFeeCents = feePercentCents + feeFixedCents;

  const transferCents = baseCents - platformFeeCents;

  const result: RepasseResult = {
    baseAmount: toReais(baseCents),
    feePercentAmount: toReais(feePercentCents),
    feeFixedAmount: toReais(feeFixedCents),
    platformFee: toReais(platformFeeCents),
    transferAmount: toReais(Math.max(0, transferCents)),
    blocked: false,
  };

  if (transferCents <= 0) {
    result.blocked = true;
    result.transferAmount = 0;
    result.blockReason =
      "Valor liquido de repasse menor ou igual a zero apos taxas/reembolsos. Revisao manual necessaria.";
  }

  return result;
};

/**
 * Calcula apenas a taxa da plataforma (usada na entrada do pagamento, antes da
 * entrega), sobre o total pago integral (sem reembolsos).
 */
export const calcularTaxaPlataforma = (input: {
  totalPaid: number | string | null | undefined;
  taxaPercentual?: number | string | null | undefined;
  taxaFixa?: number | string | null | undefined;
}): { platformFee: number; feePercentAmount: number; feeFixedAmount: number } => {
  const baseCents = Math.max(0, toCents(input.totalPaid));
  const pct = Number(input.taxaPercentual ?? 0);
  const feePercentCents = pct > 0 ? Math.round((baseCents * pct) / 100) : 0;
  const feeFixedCents = Math.max(0, toCents(input.taxaFixa));
  return {
    platformFee: toReais(feePercentCents + feeFixedCents),
    feePercentAmount: toReais(feePercentCents),
    feeFixedAmount: toReais(feeFixedCents),
  };
};

/** Compara dois valores monetarios (reais) com tolerancia de 1 centavo. */
export const moneyEquals = (
  a: number | string | null | undefined,
  b: number | string | null | undefined,
): boolean => Math.abs(toCents(a) - toCents(b)) <= 1;
