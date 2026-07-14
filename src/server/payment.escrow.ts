/**
 * Escrow na confirmacao do pagamento (modelo central).
 *
 * Quando um pagamento PIX e confirmado (PAYMENT_RECEIVED) e a loja opera no
 * modelo central (identificado pelo provider imutavel do pagamento), registramos no ledger:
 *   - ENTRADA_PIX     (credito, total do pedido)
 *   - TAXA_PLATAFORMA (credito da plataforma)
 * e marcamos o repasse como AGUARDANDO_ENTREGA (segura o valor ate a entrega).
 *
 * Idempotente: chaves unicas por pedido garantem que webhooks duplicados nao
 * dupliquem movimentos.
 */

import { calcularTaxaPlataforma } from "./financial.calc";
import { createEntryPix, createPlatformFee, type Db } from "./financial.ledger";

type EscrowOrder = {
  id: string;
  store_id: string;
  total: number | string;
};

/**
 * Aplica o escrow para um pedido recem-pago. Recebe o client da transacao em
 * andamento (o webhook ja esta dentro de withTransaction).
 * O chamador deve invocar somente para um pagamento provider='asaas-central'.
 */
export const applyPaymentEscrow = async (
  client: Db,
  order: EscrowOrder,
  asaasPaymentId?: string | null,
  asaasEventId?: string | null,
): Promise<{ applied: boolean; platformFee?: number }> => {
  const { rows } = await client.query(
    `SELECT taxa_percentual_plataforma, taxa_fixa_plataforma
       FROM public.store_settings WHERE store_id = $1 LIMIT 1`,
    [order.store_id],
  );
  const settings = rows[0];
  if (!settings) return { applied: false };

  const { platformFee } = calcularTaxaPlataforma({
    totalPaid: order.total,
    taxaPercentual: settings.taxa_percentual_plataforma,
    taxaFixa: settings.taxa_fixa_plataforma,
  });

  await createEntryPix(
    { orderId: order.id, storeId: order.store_id, amount: Number(order.total), asaasPaymentId, asaasEventId },
    client,
  );
  await createPlatformFee(
    { orderId: order.id, storeId: order.store_id, amount: platformFee, asaasPaymentId },
    client,
  );

  await client.query(
    `UPDATE public.orders
        SET transfer_status = CASE WHEN transfer_status = 'NAO_LIBERADO' THEN 'AGUARDANDO_ENTREGA' ELSE transfer_status END,
            platform_fee_amount = COALESCE(platform_fee_amount, $2),
            production_released_at = COALESCE(production_released_at, now()),
            updated_at = now()
      WHERE id = $1`,
    [order.id, platformFee],
  );

  return { applied: true, platformFee };
};
