import { toCents } from "./financial.calc";

export type FinancialClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

export type CentralFundingProof =
  | {
      ok: true;
      paymentId: string;
      paymentAmount: number;
      fundedAmount: number;
    }
  | {
      ok: false;
      reason:
        | "metodo_sem_funding_central"
        | "pagamento_unico_nao_comprovado"
        | "pagamento_nao_pertence_a_conta_central"
        | "pagamento_central_nao_confirmado"
        | "asaas_payment_id_ausente"
        | "pagamento_central_insuficiente"
        | "entrada_pix_confirmada_insuficiente";
      manual: boolean;
    };

type ProofOptions = {
  requiredAmount?: number;
  acceptedPaymentStatuses?: readonly string[];
};

const nonEmptyId = (value: unknown) => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};

/**
 * Verifica a origem imutavel dos recursos de um pedido. A funcao deve ser
 * chamada dentro da transacao que ja possui o advisory lock financeiro do
 * pedido. As linhas de pagamento e entrada sao bloqueadas junto da decisao.
 */
export const verifyCentralPixFunding = async (
  client: FinancialClient,
  order: Record<string, any>,
  options: ProofOptions = {},
): Promise<CentralFundingProof> => {
  if (order.payment_method !== "pix") {
    return { ok: false, reason: "metodo_sem_funding_central", manual: false };
  }

  const { rows: payments } = await client.query(
    `SELECT id, provider, status, amount, external_id, asaas_id
       FROM public.payments
      WHERE order_id = $1
      ORDER BY created_at ASC NULLS LAST, id ASC
      FOR UPDATE`,
    [order.id],
  );
  if (payments.length !== 1) {
    return { ok: false, reason: "pagamento_unico_nao_comprovado", manual: true };
  }

  const payment = payments[0];
  if (payment.provider !== "asaas-central") {
    return { ok: false, reason: "pagamento_nao_pertence_a_conta_central", manual: true };
  }

  const acceptedStatuses = options.acceptedPaymentStatuses ?? ["pago"];
  if (!acceptedStatuses.includes(String(payment.status))) {
    return { ok: false, reason: "pagamento_central_nao_confirmado", manual: true };
  }

  const paymentId = nonEmptyId(payment.external_id) || nonEmptyId(payment.asaas_id);
  if (!paymentId) {
    return { ok: false, reason: "asaas_payment_id_ausente", manual: true };
  }

  const totalCents = toCents(order.total);
  const requiredCents = toCents(options.requiredAmount ?? order.total);
  const paymentCents = toCents(payment.amount);
  if (
    totalCents <= 0 ||
    requiredCents <= 0 ||
    paymentCents < totalCents ||
    paymentCents < requiredCents
  ) {
    return { ok: false, reason: "pagamento_central_insuficiente", manual: true };
  }

  const { rows: entries } = await client.query(
    `SELECT id, amount, status
       FROM public.financial_movements
      WHERE order_id = $1
        AND type = 'ENTRADA_PIX'
      ORDER BY created_at ASC, id ASC
      FOR UPDATE`,
    [order.id],
  );
  const fundedCents = entries
    .filter((entry) => entry.status === "CONFIRMADO")
    .reduce((sum, entry) => sum + toCents(entry.amount), 0);
  if (fundedCents < totalCents || fundedCents < requiredCents) {
    return { ok: false, reason: "entrada_pix_confirmada_insuficiente", manual: true };
  }

  return {
    ok: true,
    paymentId,
    paymentAmount: paymentCents / 100,
    fundedAmount: fundedCents / 100,
  };
};
