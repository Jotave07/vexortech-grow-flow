/**
 * Shared financial state contract for every operation that can move money for
 * an order. The same advisory-lock namespace must be used by delivery,
 * cancellation, transfer and refund flows; otherwise independent transactions
 * can reserve contradictory operations for the same order.
 */
export const orderFinancialLockKey = (orderId: string) => `order-financial:${orderId}`;

/**
 * A merchant cancellation cannot proceed once a transfer has been released or
 * submitted. PROCESSANDO is especially important: the external request may be
 * in flight even though an Asaas transfer id has not been persisted yet.
 */
export const CANCELLATION_BLOCKING_TRANSFER_STATUSES = new Set([
  "LIBERADO",
  "PROCESSANDO",
  "ENVIADO",
]);

export const REFUND_BLOCKING_TRANSFER_STATUSES = CANCELLATION_BLOCKING_TRANSFER_STATUSES;

/**
 * PENDENTE is a durable hand-off, not an in-flight gateway call. The refund
 * worker is therefore allowed to atomically promote PENDENTE to PROCESSANDO.
 */
export const REFUND_BLOCKING_STATUSES = new Set([
  "PROCESSANDO",
  "ESTORNADO_TOTAL",
  "ESTORNADO_PARCIAL",
]);
