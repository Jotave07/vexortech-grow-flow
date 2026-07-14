/**
 * FinancialLedgerService — ledger interno (tabela public.financial_movements).
 *
 * Principios:
 *  - Idempotencia por idempotency_key (unique). Reexecucao nao duplica.
 *  - Nunca exclui movimentos. Correcao = novo movimento de AJUSTE_MANUAL/ESTORNO.
 *  - Funciona dentro de uma transacao (recebe o client) ou avulso (usa query()).
 */

import { query as rootQuery } from "@/backend/db";

/** Interface comum entre o pool (query) e o PoolClient tracado de withTransaction. */
export type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> };

const db = (client?: Db): Db => client ?? { query: (t, p) => rootQuery(t, p as unknown[]) };

export type MovementType =
  | "ENTRADA_PIX"
  | "TAXA_PLATAFORMA"
  | "REPASSE_LOJISTA"
  | "REEMBOLSO_CLIENTE"
  | "AJUSTE_MANUAL"
  | "ESTORNO_REPASSE"
  | "RESERVA_OPERACIONAL";

export type MovementNature = "CREDITO" | "DEBITO";
export type MovementStatus = "PENDENTE" | "PROCESSANDO" | "CONFIRMADO" | "FALHOU" | "CANCELADO";

export type RecordMovementInput = {
  orderId?: string | null;
  storeId?: string | null;
  type: MovementType;
  nature: MovementNature;
  amount: number;
  status?: MovementStatus;
  description?: string | null;
  asaasPaymentId?: string | null;
  asaasTransferId?: string | null;
  asaasRefundId?: string | null;
  asaasEventId?: string | null;
  externalReference?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown> | null;
};

export type Movement = Record<string, any>;

/**
 * Insere um movimento de forma idempotente. Se ja existir (mesma
 * idempotency_key), retorna o existente sem duplicar.
 */
export const recordMovement = async (
  input: RecordMovementInput,
  client?: Db,
): Promise<{ movement: Movement; created: boolean }> => {
  const status = input.status ?? "PENDENTE";
  const confirmedAt = status === "CONFIRMADO" ? "now()" : "NULL";
  const failedAt = status === "FALHOU" ? "now()" : "NULL";

  const { rows } = await db(client).query(
    `INSERT INTO public.financial_movements (
       order_id, store_id, type, nature, amount, status, description,
       asaas_payment_id, asaas_transfer_id, asaas_refund_id, asaas_event_id,
       external_reference, idempotency_key, metadata_json,
       confirmed_at, failed_at, fail_reason
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11,
       $12, $13, $14::jsonb,
       ${confirmedAt}, ${failedAt}, NULL
     )
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING *`,
    [
      input.orderId ?? null,
      input.storeId ?? null,
      input.type,
      input.nature,
      Number(input.amount).toFixed(2),
      status,
      input.description ?? null,
      input.asaasPaymentId ?? null,
      input.asaasTransferId ?? null,
      input.asaasRefundId ?? null,
      input.asaasEventId ?? null,
      input.externalReference ?? null,
      input.idempotencyKey,
      input.metadata ? JSON.stringify(input.metadata) : null,
    ],
  );

  if (rows[0]) return { movement: rows[0], created: true };

  const { rows: existing } = await db(client).query(
    `SELECT * FROM public.financial_movements WHERE idempotency_key = $1 LIMIT 1`,
    [input.idempotencyKey],
  );
  return { movement: existing[0], created: false };
};

/** Atualiza status/ids de um movimento existente (por id ou idempotency_key). */
export const updateMovementStatus = async (
  ref: { id?: string; idempotencyKey?: string },
  patch: {
    status: MovementStatus;
    asaasTransferId?: string | null;
    asaasRefundId?: string | null;
    asaasEventId?: string | null;
    failReason?: string | null;
    metadata?: Record<string, unknown> | null;
  },
  client?: Db,
): Promise<Movement | null> => {
  const whereCol = ref.id ? "id" : "idempotency_key";
  const whereVal = ref.id ?? ref.idempotencyKey;
  const { rows } = await db(client).query(
    `UPDATE public.financial_movements
        SET status = $2,
            asaas_transfer_id = COALESCE($3, asaas_transfer_id),
            asaas_refund_id   = COALESCE($4, asaas_refund_id),
            asaas_event_id    = COALESCE($5, asaas_event_id),
            confirmed_at = CASE WHEN $2 = 'CONFIRMADO' THEN COALESCE(confirmed_at, now()) ELSE confirmed_at END,
            failed_at    = CASE WHEN $2 = 'FALHOU'     THEN COALESCE(failed_at, now())    ELSE failed_at END,
            fail_reason  = COALESCE($6, fail_reason),
            metadata_json = COALESCE($7::jsonb, metadata_json)
      WHERE ${whereCol} = $1
        AND (
          status = $2
          OR (status = 'PENDENTE' AND $2 IN ('PROCESSANDO','CONFIRMADO','FALHOU','CANCELADO'))
          OR (status = 'PROCESSANDO' AND $2 IN ('CONFIRMADO','FALHOU','CANCELADO'))
          OR (status = 'FALHOU' AND $2 IN ('PROCESSANDO','CONFIRMADO','CANCELADO'))
          OR (status = 'CANCELADO' AND $2 = 'CONFIRMADO')
        )
      RETURNING *`,
    [
      whereVal,
      patch.status,
      patch.asaasTransferId ?? null,
      patch.asaasRefundId ?? null,
      patch.asaasEventId ?? null,
      patch.failReason ?? null,
      patch.metadata ? JSON.stringify(patch.metadata) : null,
    ],
  );
  return rows[0] ?? null;
};

export const findMovement = async (
  ref: { idempotencyKey?: string; asaasTransferId?: string; externalReference?: string; type?: MovementType; orderId?: string },
  client?: Db,
): Promise<Movement | null> => {
  const conds: string[] = [];
  const params: unknown[] = [];
  const push = (sql: string, val: unknown) => {
    params.push(val);
    conds.push(sql.replace("$?", `$${params.length}`));
  };
  if (ref.idempotencyKey) push("idempotency_key = $?", ref.idempotencyKey);
  if (ref.asaasTransferId) push("asaas_transfer_id = $?", ref.asaasTransferId);
  if (ref.externalReference) push("external_reference = $?", ref.externalReference);
  if (ref.type) push("type = $?", ref.type);
  if (ref.orderId) push("order_id = $?", ref.orderId);
  if (!conds.length) return null;
  const { rows } = await db(client).query(
    `SELECT * FROM public.financial_movements WHERE ${conds.join(" AND ")} ORDER BY created_at DESC LIMIT 1`,
    params,
  );
  return rows[0] ?? null;
};

// ── Movimentos de alto nivel (chaves de idempotencia padronizadas) ──────────

export const idemKeys = {
  entradaPix: (orderId: string) => `ENTRADA_PIX_ORDER_${orderId}`,
  taxaPlataforma: (orderId: string) => `TAXA_PLATAFORMA_ORDER_${orderId}`,
  repasse: (orderId: string) => `REPASSE_ORDER_${orderId}`,
  reembolso: (orderId: string) => `REEMBOLSO_ORDER_${orderId}`,
};

export const createEntryPix = (
  args: { orderId: string; storeId: string; amount: number; asaasPaymentId?: string | null; asaasEventId?: string | null },
  client?: Db,
) =>
  recordMovement(
    {
      orderId: args.orderId,
      storeId: args.storeId,
      type: "ENTRADA_PIX",
      nature: "CREDITO",
      amount: args.amount,
      status: "CONFIRMADO",
      description: "Entrada PIX confirmada na conta central",
      asaasPaymentId: args.asaasPaymentId ?? null,
      asaasEventId: args.asaasEventId ?? null,
      externalReference: `ORDER_${args.orderId}`,
      idempotencyKey: idemKeys.entradaPix(args.orderId),
    },
    client,
  );

export const createPlatformFee = (
  args: { orderId: string; storeId: string; amount: number; asaasPaymentId?: string | null },
  client?: Db,
) =>
  recordMovement(
    {
      orderId: args.orderId,
      storeId: args.storeId,
      type: "TAXA_PLATAFORMA",
      nature: "CREDITO",
      amount: args.amount,
      status: "CONFIRMADO",
      description: "Taxa da plataforma sobre o pedido",
      asaasPaymentId: args.asaasPaymentId ?? null,
      externalReference: `ORDER_${args.orderId}`,
      idempotencyKey: idemKeys.taxaPlataforma(args.orderId),
    },
    client,
  );

export const createMerchantTransfer = (
  args: { orderId: string; storeId: string; amount: number },
  client?: Db,
) =>
  recordMovement(
    {
      orderId: args.orderId,
      storeId: args.storeId,
      type: "REPASSE_LOJISTA",
      nature: "DEBITO",
      amount: args.amount,
      status: "PROCESSANDO",
      description: "Repasse PIX ao lojista (pos-entrega)",
      externalReference: `TRANSFER_ORDER_${args.orderId}`,
      idempotencyKey: idemKeys.repasse(args.orderId),
    },
    client,
  );

export const createCustomerRefund = (
  args: { orderId: string; storeId: string; amount: number; asaasPaymentId?: string | null },
  client?: Db,
) =>
  recordMovement(
    {
      orderId: args.orderId,
      storeId: args.storeId,
      type: "REEMBOLSO_CLIENTE",
      nature: "DEBITO",
      amount: args.amount,
      status: "PROCESSANDO",
      description: "Reembolso ao cliente por cancelamento",
      asaasPaymentId: args.asaasPaymentId ?? null,
      externalReference: `REFUND_ORDER_${args.orderId}`,
      idempotencyKey: idemKeys.reembolso(args.orderId),
    },
    client,
  );

// ── Consultas ────────────────────────────────────────────────────────────────

/**
 * Saldo do lojista = creditos CONFIRMADOS - debitos CONFIRMADOS.
 * (ENTRADA_PIX credita; REPASSE/REEMBOLSO debitam; TAXA_PLATAFORMA e credito da
 *  plataforma, portanto debita do saldo do lojista — tratada como retencao.)
 */
export const getMerchantBalance = async (storeId: string, client?: Db) => {
  const { rows } = await db(client).query(
    `SELECT
        COALESCE(SUM(CASE WHEN type = 'ENTRADA_PIX'  AND status = 'CONFIRMADO' THEN amount ELSE 0 END),0) AS entradas,
        COALESCE(SUM(CASE WHEN type = 'TAXA_PLATAFORMA' AND status = 'CONFIRMADO' THEN amount ELSE 0 END),0) AS taxas,
        COALESCE(SUM(CASE WHEN type = 'REPASSE_LOJISTA' AND status IN ('PROCESSANDO','CONFIRMADO') THEN amount ELSE 0 END),0) AS repasses,
        COALESCE(SUM(CASE WHEN type = 'REEMBOLSO_CLIENTE' AND status IN ('PROCESSANDO','CONFIRMADO') THEN amount ELSE 0 END),0) AS reembolsos
     FROM public.financial_movements
     WHERE store_id = $1`,
    [storeId],
  );
  const r = rows[0] || {};
  const entradas = Number(r.entradas || 0);
  const taxas = Number(r.taxas || 0);
  const repasses = Number(r.repasses || 0);
  const reembolsos = Number(r.reembolsos || 0);
  const available = Number((entradas - taxas - repasses - reembolsos).toFixed(2));
  return { entradas, taxas, repasses, reembolsos, available };
};

export const getOrderFinancialSummary = async (orderId: string, client?: Db) => {
  const { rows } = await db(client).query(
    `SELECT id, type, nature, amount, status, asaas_transfer_id, asaas_refund_id,
            external_reference, created_at, confirmed_at, failed_at, fail_reason
       FROM public.financial_movements
      WHERE order_id = $1
      ORDER BY created_at ASC`,
    [orderId],
  );
  return rows;
};
