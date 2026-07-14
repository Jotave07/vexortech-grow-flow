import crypto from "node:crypto";
import { query, withTransaction } from "./db";
import { isProductionRuntime, validateRuntimeEnv, getAsaasWebhookSecret } from "./env";
import { publishRealtime } from "./realtime";
import { applyPaymentEscrow } from "@/server/payment.escrow";
import { handleTransferDone, handleTransferFailed } from "@/server/transfer.service";
import { handleRefundConfirmed, refundCancelledOrder } from "@/server/refund.service";
import {
  createCustomerRefund,
  findMovement,
  idemKeys,
  recordMovement,
  updateMovementStatus,
} from "@/server/financial.ledger";
import { toCents } from "@/server/financial.calc";
import { asaas } from "@/server/asaas.server";
import { nextFutureMonthlyDueDate } from "@/server/billing-date";
import { orderFinancialLockKey } from "@/server/order-financial-state";
import { verifyCentralPixFunding } from "@/server/central-funding";

const paidEvents = new Set(["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"]);
const paidPaymentStatuses = new Set(["pago", "paid"]);
const failedEvents = new Set(["PAYMENT_OVERDUE"]);
const cancelledEvents = new Set(["PAYMENT_DELETED", "PAYMENT_CANCELLED"]);
const refundedEvents = new Set(["PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED"]);
const chargebackEvents = new Set([
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_AWAITING_CHARGEBACK_REVERSAL",
]);
const subscriptionTerminalRevocationEvents = new Set(refundedEvents);
const subscriptionDisputeEvents = new Set(chargebackEvents);
const terminalSubscriptionEvents = new Set(["SUBSCRIPTION_INACTIVATED", "SUBSCRIPTION_DELETED"]);
const platformSubscriptionPrefix = "platform-subscription:";
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const platformStoreIdFromReference = (value: unknown) => {
  const reference = String(value || "");
  if (!reference.startsWith(platformSubscriptionPrefix)) return null;
  const storeId = reference.slice(platformSubscriptionPrefix.length);
  return uuidRe.test(storeId) ? storeId : null;
};

const requiredAmountInCents = (value: unknown) => {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim()))
    return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  const cents = toCents(numeric);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
};

const transferDoneEvents = new Set(["TRANSFER_DONE"]);
const transferFailedEvents = new Set(["TRANSFER_FAILED"]);
const transferCancelledEvents = new Set(["TRANSFER_CANCELLED", "TRANSFER_BLOCKED"]);
const transferPendingEvents = new Set([
  "TRANSFER_CREATED",
  "TRANSFER_PENDING",
  "TRANSFER_IN_BANK_PROCESSING",
]);

const safeEqual = (left?: string | null, right?: string | null) => {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const paymentStatusForEvent = (event: string) => {
  if (paidEvents.has(event)) return "pago";
  if (failedEvents.has(event)) return "falhou";
  if (cancelledEvents.has(event)) return "cancelado";
  if (refundedEvents.has(event)) return "estornado";
  if (chargebackEvents.has(event)) return "estornado";
  return null;
};

const safeJsonError = (message: string, status: number) =>
  Response.json({ error: message }, { status });

const hashPayload = (payload: unknown) =>
  crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");

const parseEventTimestamp = (value: unknown) => {
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

const redactPayload = (body: any) => ({
  event: body?.event || null,
  id: body?.id || null,
  payment: body?.payment
    ? {
        id: body.payment.id || null,
        status: body.payment.status || null,
        externalReference: body.payment.externalReference || null,
        value: body.payment.value ?? null,
        billingType: body.payment.billingType || null,
        dateCreated: body.payment.dateCreated || null,
        paymentDate: body.payment.paymentDate || null,
        refunds: Array.isArray(body.payment.refunds)
          ? body.payment.refunds.slice(0, 50).map((refund: any) => ({
              status: refund?.status || null,
              value: refund?.value ?? null,
              dateCreated: refund?.dateCreated || null,
              endToEndIdentifier: refund?.endToEndIdentifier || null,
            }))
          : null,
      }
    : null,
  transfer: body?.transfer
    ? {
        id: body.transfer.id || null,
        status: body.transfer.status || null,
        externalReference: body.transfer.externalReference || null,
        value: body.transfer.value ?? null,
        failReason: body.transfer.failReason || null,
      }
    : null,
  subscription: body?.subscription
    ? {
        id: body.subscription.id || null,
        status: body.subscription.status || null,
        externalReference: body.subscription.externalReference || null,
        value: body.subscription.value ?? null,
        billingType: body.subscription.billingType || null,
        cycle: body.subscription.cycle || null,
        nextDueDate: body.subscription.nextDueDate || null,
        deleted: body.subscription.deleted ?? null,
      }
    : null,
});

type DbLike = { query: (sql: string, params?: unknown[]) => Promise<any> };

const eventProcessingLeaseSeconds = 45;
const eventRetryAfterSeconds = 5;

const claimEvent = async (input: {
  event: string;
  resourceType: "payment" | "transfer" | "subscription";
  resourceId: string;
  eventId?: string | null;
  body: any;
}) => {
  const redacted = redactPayload(input.body);
  const payloadHash = hashPayload(redacted);
  const params = [
    input.event,
    input.resourceType,
    input.resourceId,
    input.eventId || null,
    payloadHash,
    JSON.stringify(redacted),
  ];
  const { rows: inserted } = await query(
    `INSERT INTO public.payment_events (
       provider, event_type, resource_type, external_payment_id, asaas_event_id,
       payload_hash, payload_redacted, processed, processed_at, processing_error,
       processing_started_at, attempt_count
     )
     VALUES ('asaas', $1, $2, $3, $4, $5, $6::jsonb, false, NULL, NULL, now(), 1)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    params,
  );
  if (inserted[0]?.id) {
    return {
      claimed: true,
      processed: false,
      rowId: inserted[0].id as string,
      retryAfterSeconds: null,
    };
  }

  // A failed delivery can be retried immediately. The lease is deliberately a
  // little longer than the Asaas HTTP timeout (25s), so an active request keeps
  // exclusive claim while a crashed request becomes reclaimable quickly.
  const { rows: reclaimed } = await query(
    `WITH candidate AS (
       SELECT id
       FROM public.payment_events
       WHERE provider = 'asaas'
         AND processed = false
         AND (
           processing_started_at IS NULL
           OR processing_started_at < now() - make_interval(secs => $6::integer)
         )
         AND (
           ($4::text IS NOT NULL AND asaas_event_id = $4)
           OR (event_type = $1 AND external_payment_id = $3 AND payload_hash = $5)
         )
       ORDER BY ($4::text IS NOT NULL AND asaas_event_id = $4) DESC, id
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE public.payment_events AS payment_event
     SET processing_started_at = now(),
         processing_error = NULL,
         attempt_count = payment_event.attempt_count + 1
     FROM candidate
     WHERE payment_event.id = candidate.id
     RETURNING payment_event.id`,
    [...params.slice(0, 5), eventProcessingLeaseSeconds],
  );
  if (reclaimed[0]?.id) {
    return {
      claimed: true,
      processed: false,
      rowId: reclaimed[0].id as string,
      retryAfterSeconds: null,
    };
  }

  const { rows: existing } = await query(
    `SELECT id,
            processed,
            CASE
              WHEN processed OR processing_started_at IS NULL THEN $6::integer
              ELSE GREATEST(
                1,
                CEIL(EXTRACT(EPOCH FROM (
                  processing_started_at
                  + make_interval(secs => $6::integer)
                  - now()
                )))::integer
              )
            END AS retry_after_seconds
     FROM public.payment_events
     WHERE provider = 'asaas'
       AND (
         ($4::text IS NOT NULL AND asaas_event_id = $4)
         OR (event_type = $1 AND external_payment_id = $3 AND payload_hash = $5)
       )
     ORDER BY ($4::text IS NOT NULL AND asaas_event_id = $4) DESC, id
     LIMIT 1`,
    [...params.slice(0, 5), eventProcessingLeaseSeconds],
  );
  const current = existing[0] || null;
  return {
    claimed: false,
    processed: Boolean(current?.processed),
    rowId: (current?.id as string | undefined) || null,
    retryAfterSeconds: Math.max(
      eventRetryAfterSeconds,
      Number(current?.retry_after_seconds) || eventRetryAfterSeconds,
    ),
  };
};

const markEventProcessed = async (
  client: DbLike,
  eventId?: string | null,
  rowId?: string | null,
) => {
  if (!eventId && !rowId) return;
  await client.query(
    `UPDATE public.payment_events
     SET processed = true, processed_at = now(), processing_error = NULL, processing_started_at = NULL
     WHERE ($1::text IS NOT NULL AND asaas_event_id = $1)
        OR ($2::uuid IS NOT NULL AND id = $2::uuid)`,
    [eventId || null, rowId || null],
  );
};

const markEventFailedWithClient = async (
  client: DbLike,
  eventId: string | null | undefined,
  rowId: string | null | undefined,
  message: string,
) => {
  if (!eventId && !rowId) return;
  await client.query(
    `UPDATE public.payment_events
     SET processed = false, processed_at = NULL, processing_error = $3, processing_started_at = NULL
     WHERE ($1::text IS NOT NULL AND asaas_event_id = $1)
        OR ($2::uuid IS NOT NULL AND id = $2::uuid)`,
    [eventId || null, rowId || null, message.slice(0, 1000)],
  );
};

const markEventFailed = async (
  eventId: string | null | undefined,
  rowId: string | null | undefined,
  message: string,
) => {
  await markEventFailedWithClient({ query }, eventId, rowId, message).catch(() => null);
};

type SubscriptionPaymentUpdateResult = {
  matched: boolean;
  updated: boolean;
  amountMismatch: boolean;
  terminalBlocked: boolean;
  ignoredByGuard: boolean;
  retiredGatewayId: boolean;
  storeId: string | null;
  subscriptionId: string | null;
  gatewaySubscriptionId: string | null;
  gatewayActionPending: "CANCEL" | "INACTIVE" | "ACTIVE" | "EXEMPT_CANCEL" | null;
  nextDueDate: string | null;
  subscriptionRow: any | null;
};

const emptySubscriptionPaymentUpdate = (): SubscriptionPaymentUpdateResult => ({
  matched: false,
  updated: false,
  amountMismatch: false,
  terminalBlocked: false,
  ignoredByGuard: false,
  retiredGatewayId: false,
  storeId: null,
  subscriptionId: null,
  gatewaySubscriptionId: null,
  gatewayActionPending: null,
  nextDueDate: null,
  subscriptionRow: null,
});

const subscriptionLockKey = (storeId: string) => `subscription:${storeId}`;

const resolveSubscriptionStoreId = async (
  db: DbLike,
  gatewaySubscriptionId: unknown,
  externalReference: unknown,
) => {
  const referencedStoreId = platformStoreIdFromReference(externalReference);
  if (referencedStoreId) return referencedStoreId;

  const gatewayId = String(gatewaySubscriptionId || "");
  if (!gatewayId) return null;
  const { rows } = await db.query(
    `SELECT s.store_id
     FROM public.subscriptions s
     WHERE s.asaas_subscription_id = $1
        OR $1 = ANY(s.previous_asaas_subscription_ids)
     ORDER BY (s.asaas_subscription_id = $1) DESC
     LIMIT 1`,
    [gatewayId],
  );
  return rows[0]?.store_id ? String(rows[0].store_id) : null;
};

const acquireSubscriptionLock = async (db: DbLike, storeId: string) => {
  await db.query(`SET LOCAL lock_timeout = '5s'`);
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
    subscriptionLockKey(storeId),
  ]);
};

const updateSubscriptionIfPresent = async (
  db: DbLike,
  event: string,
  payment: any,
  eventOccurredAt: string | null,
  lockedStoreId: string,
): Promise<SubscriptionPaymentUpdateResult> => {
  const externalReference = String(payment.externalReference || "");
  const safePlatformStoreId = platformStoreIdFromReference(externalReference);
  if (!payment.subscription && !safePlatformStoreId) {
    return emptySubscriptionPaymentUpdate();
  }

  const terminalRevoke = subscriptionTerminalRevocationEvents.has(event);
  const dispute = subscriptionDisputeEvents.has(event);
  const status = paidEvents.has(event)
    ? "ativa"
    : failedEvents.has(event)
      ? "inadimplente"
      : cancelledEvents.has(event)
        ? "cancelada"
        : terminalRevoke
          ? "cancelada"
          : subscriptionDisputeEvents.has(event)
            ? "em_disputa"
            : null;
  if (!status) {
    return emptySubscriptionPaymentUpdate();
  }

  const paidAt = payment.paymentDate || payment.confirmedDate || payment.clientPaymentDate || null;
  const dueDate = payment.dueDate || payment.originalDueDate || null;
  const receivedCents = paidEvents.has(event) ? requiredAmountInCents(payment.value) : null;
  const identityPredicate = safePlatformStoreId
    ? `s.store_id = $8::uuid
       AND s.external_reference = $6
       AND ($3::text IS NULL OR s.asaas_subscription_id = $3)`
    : `s.store_id = $13::uuid
       AND s.asaas_subscription_id = $3
       AND $3::text IS NOT NULL
       AND $8::uuid IS NULL`;
  const { rows } = await db.query(
    `WITH target AS (
       SELECT s.id,
              CASE
                WHEN COALESCE(s.contract_price_monthly, p.price_monthly) IS NULL
                  OR COALESCE(s.contract_price_monthly, p.price_monthly) <= 0 THEN NULL
                ELSE round(COALESCE(s.contract_price_monthly, p.price_monthly) * 100)::bigint
              END AS expected_cents,
              (
                s.canceled_at IS NOT NULL
                OR lower(COALESCE(s.status, '')) IN ('cancelada', 'encerrada', 'bloqueada', 'suspensa')
              ) AS is_terminal,
              lower(COALESCE(s.status, '')) = 'em_disputa' AS was_disputed
       FROM public.subscriptions s
       LEFT JOIN public.plans p ON p.id = s.plan_id
       WHERE ${identityPredicate}
       LIMIT 1
       FOR UPDATE OF s
     )
     UPDATE public.subscriptions s
     SET status = CASE
           WHEN target.is_terminal THEN s.status
           WHEN $1 = 'ativa'
             AND ($10::bigint IS NULL OR target.expected_cents IS NULL OR $10::bigint <> target.expected_cents)
             THEN 'inadimplente'
           ELSE $1
         END,
         last_payment_status = CASE
           WHEN target.is_terminal AND $1 = 'ativa' THEN s.last_payment_status
           WHEN $1 = 'ativa'
             AND ($10::bigint IS NULL OR target.expected_cents IS NULL OR $10::bigint <> target.expected_cents)
             THEN 'PAYMENT_VALUE_MISMATCH'
           ELSE $2
         END,
         current_period_start = CASE
           WHEN $1 = 'ativa'
             AND NOT target.is_terminal
             AND $10::bigint IS NOT NULL
             AND target.expected_cents IS NOT NULL
             AND $10::bigint = target.expected_cents
             THEN COALESCE($4::timestamptz, now())
           ELSE s.current_period_start
         END,
         current_period_end = CASE
           WHEN $1 = 'ativa'
             AND NOT target.is_terminal
             AND $10::bigint IS NOT NULL
             AND target.expected_cents IS NOT NULL
             AND $10::bigint = target.expected_cents
             THEN COALESCE($4::timestamptz, now()) + INTERVAL '30 days'
           WHEN $7 THEN now()
           ELSE s.current_period_end
         END,
         next_due_date = CASE
           WHEN $1 = 'ativa'
             AND NOT target.is_terminal
             AND $10::bigint IS NOT NULL
             AND target.expected_cents IS NOT NULL
             AND $10::bigint = target.expected_cents
             THEN (COALESCE($4::timestamptz, now()) + INTERVAL '30 days')::date
           ELSE COALESCE($5::date, s.next_due_date)
         END,
         canceled_at = CASE
           WHEN target.is_terminal THEN s.canceled_at
           WHEN $1 = 'cancelada' THEN COALESCE(s.canceled_at, now())
           ELSE s.canceled_at
         END,
         cancellation_effective_at = CASE
           WHEN $11 THEN now()
           WHEN $1 = 'cancelada' THEN COALESCE(s.cancellation_effective_at, s.current_period_end, s.next_due_date::timestamptz, now())
           ELSE s.cancellation_effective_at
         END,
         last_payment_event_at = CASE
           WHEN $9::timestamptz IS NULL THEN s.last_payment_event_at
           ELSE GREATEST(COALESCE(s.last_payment_event_at, $9::timestamptz), $9::timestamptz)
         END,
         last_payment_event_type = CASE
           WHEN $9::timestamptz IS NULL OR s.last_payment_event_at IS NULL OR $9::timestamptz >= s.last_payment_event_at
              THEN $2
            ELSE s.last_payment_event_type
         END,
         gateway_action_pending = CASE
           WHEN s.gateway_action_pending = 'EXEMPT_CANCEL' THEN s.gateway_action_pending
           WHEN $11::boolean THEN 'CANCEL'
           WHEN $12::boolean AND NOT target.is_terminal THEN 'INACTIVE'
           WHEN $1 = 'ativa'
             AND NOT target.is_terminal
             AND $10::bigint IS NOT NULL
             AND target.expected_cents IS NOT NULL
             AND $10::bigint = target.expected_cents
             AND (target.was_disputed OR s.gateway_action_pending = 'ACTIVE')
             THEN 'ACTIVE'
           ELSE s.gateway_action_pending
         END,
         gateway_paused_for_dispute = CASE
           WHEN $11::boolean THEN false
           WHEN $12::boolean AND NOT target.is_terminal THEN true
           ELSE s.gateway_paused_for_dispute
         END,
         updated_at = now()
     FROM target
     WHERE s.id = target.id
       AND (
         $7::boolean = true
         OR $9::timestamptz IS NULL
         OR s.last_payment_event_at IS NULL
         OR $9::timestamptz >= s.last_payment_event_at
       )
       AND ($7::boolean = true OR $12::boolean = true OR s.status <> 'ativa' OR $1 = 'ativa')
     RETURNING s.*,
       target.expected_cents,
       ($1 = 'ativa' AND target.is_terminal) AS terminal_blocked,
       (
         $1 = 'ativa'
         AND NOT target.is_terminal
         AND ($10::bigint IS NULL OR target.expected_cents IS NULL OR $10::bigint <> target.expected_cents)
       ) AS amount_mismatch`,
    [
      status,
      event,
      payment.subscription || null,
      paidAt,
      dueDate,
      externalReference || null,
      terminalRevoke,
      safePlatformStoreId,
      eventOccurredAt,
      receivedCents,
      terminalRevoke,
      dispute,
      lockedStoreId,
    ],
  );

  // A matching row can legitimately be left untouched by the ordering/state
  // guards above (for example, a late OVERDUE after an already confirmed
  // payment). Distinguish that case from an unknown subscription so the
  // gateway event is acknowledged instead of being retried forever.
  if (!rows[0]) {
    const lookup = safePlatformStoreId
      ? await db.query(
          `SELECT s.id,
                  s.store_id,
                  s.asaas_subscription_id,
                  s.gateway_action_pending,
                  s.next_due_date,
                  ($3::text IS NOT NULL AND $3 = ANY(s.previous_asaas_subscription_ids)) AS retired_gateway_id
           FROM public.subscriptions s
           WHERE s.store_id = $1::uuid
             AND s.external_reference = $2
             AND (
               $3::text IS NULL
               OR s.asaas_subscription_id = $3
               OR $3 = ANY(s.previous_asaas_subscription_ids)
             )
           LIMIT 1
           FOR UPDATE OF s`,
          [safePlatformStoreId, externalReference, payment.subscription || null],
        )
      : await db.query(
          `SELECT s.id,
                  s.store_id,
                  s.asaas_subscription_id,
                  s.gateway_action_pending,
                  s.next_due_date,
                  ($1 = ANY(s.previous_asaas_subscription_ids)) AS retired_gateway_id
            FROM public.subscriptions s
            WHERE s.store_id = $2::uuid
              AND (
                s.asaas_subscription_id = $1
                OR $1 = ANY(s.previous_asaas_subscription_ids)
              )
            LIMIT 1
            FOR UPDATE OF s`,
          [payment.subscription, lockedStoreId],
        );
    const matched = lookup.rows[0] || null;
    return {
      matched: Boolean(matched),
      updated: false,
      amountMismatch: false,
      terminalBlocked: false,
      ignoredByGuard: Boolean(matched),
      retiredGatewayId: Boolean(matched?.retired_gateway_id),
      storeId: matched?.store_id || safePlatformStoreId || null,
      subscriptionId: matched?.id || null,
      gatewaySubscriptionId: matched?.asaas_subscription_id || null,
      gatewayActionPending: matched?.retired_gateway_id
        ? null
        : matched?.gateway_action_pending || null,
      nextDueDate: matched?.next_due_date || null,
      subscriptionRow: null,
    };
  }

  const subscription = rows[0] || null;
  const amountMismatch = Boolean(subscription?.amount_mismatch);
  const terminalBlocked = Boolean(subscription?.terminal_blocked);
  if (amountMismatch) {
    console.error(
      JSON.stringify({
        scope: "asaas:webhook",
        event,
        paymentId: payment.id || null,
        storeId: subscription?.store_id || safePlatformStoreId,
        alert: "subscription_payment_value_mismatch",
        expectedCents: subscription?.expected_cents ?? null,
        receivedCents,
      }),
    );
  }
  return {
    matched: Boolean(subscription),
    updated: Boolean(subscription) && !amountMismatch && !terminalBlocked,
    amountMismatch,
    terminalBlocked,
    ignoredByGuard: false,
    retiredGatewayId: false,
    storeId: subscription?.store_id || safePlatformStoreId || null,
    subscriptionId: subscription?.id || null,
    gatewaySubscriptionId: subscription?.asaas_subscription_id || null,
    gatewayActionPending: subscription?.gateway_action_pending || null,
    nextDueDate: subscription?.next_due_date || null,
    subscriptionRow: subscription,
  };
};

const applyPendingSubscriptionGatewayAction = async (
  db: DbLike,
  event: string,
  payment: any,
  update: SubscriptionPaymentUpdateResult,
) => {
  const retiredTerminalRefund =
    update.retiredGatewayId && subscriptionTerminalRevocationEvents.has(event);
  const action = retiredTerminalRefund ? "CANCEL" : update.gatewayActionPending;
  if (!action) return;
  if (action === "EXEMPT_CANCEL") return;
  if (!new Set(["CANCEL", "INACTIVE", "ACTIVE"]).has(action)) {
    throw new Error("unsupported subscription gateway action");
  }

  const gatewaySubscriptionId = retiredTerminalRefund
    ? String(payment.subscription || "")
    : String(update.gatewaySubscriptionId || payment.subscription || "");
  if (!gatewaySubscriptionId) {
    throw new Error("subscription gateway action has no gateway identity");
  }

  let gatewayResult: any;
  let gatewaySubscriptionExpired = false;
  if (action === "CANCEL") {
    gatewayResult = await asaas.cancelSubscription(gatewaySubscriptionId);
  } else {
    const remote = await asaas.getSubscription(gatewaySubscriptionId);
    const remoteStatus = String(remote?.status || "").toUpperCase();
    const remoteSubscriptionIsTerminal = remoteStatus === "EXPIRED";
    if (remote?.errors && !remoteSubscriptionIsTerminal) {
      throw new Error("subscription gateway state lookup failed");
    }
    if (!remoteSubscriptionIsTerminal && !new Set(["ACTIVE", "INACTIVE"]).has(remoteStatus)) {
      throw new Error("subscription gateway returned an invalid state");
    }
    if (remoteSubscriptionIsTerminal) {
      gatewaySubscriptionExpired = true;
      gatewayResult = { success: true, alreadyExpired: true };
    } else if (remoteStatus === action) {
      gatewayResult = { success: true, alreadyApplied: true };
    } else {
      const activeNextDueDate =
        action === "ACTIVE"
          ? nextFutureMonthlyDueDate(remote?.nextDueDate || update.nextDueDate)
          : null;
      if (action === "ACTIVE" && !activeNextDueDate) {
        throw new Error("subscription gateway activation has no next due date");
      }
      gatewayResult = await asaas.updateSubscription(gatewaySubscriptionId, {
        status: action,
        ...(action === "ACTIVE" ? { nextDueDate: activeNextDueDate || undefined } : {}),
      });
    }
  }
  if (gatewayResult?.errors) {
    throw new Error(`subscription gateway ${action.toLowerCase()} action failed`);
  }

  if (!retiredTerminalRefund && update.subscriptionId) {
    const { rows } = await db.query(
      `UPDATE public.subscriptions
       SET status = CASE WHEN $4::boolean THEN 'encerrada' ELSE status END,
           cancellation_effective_at = CASE
             WHEN $4::boolean THEN COALESCE(
               cancellation_effective_at,
               current_period_end,
               next_due_date::timestamptz,
               now()
             )
             ELSE cancellation_effective_at
           END,
           gateway_action_pending = NULL,
           gateway_paused_for_dispute = CASE
             WHEN $4::boolean THEN false
             WHEN $3 = 'INACTIVE' THEN true
             WHEN $3 IN ('ACTIVE', 'CANCEL') THEN false
             ELSE gateway_paused_for_dispute
           END,
           updated_at = now()
       WHERE id = $1::uuid
         AND asaas_subscription_id = $2
         AND gateway_action_pending = $3
       RETURNING id`,
      [update.subscriptionId, gatewaySubscriptionId, action, gatewaySubscriptionExpired],
    );
    if (!rows[0]) {
      throw new Error("subscription changed before gateway action acknowledgement");
    }
  }
};

const completedRefundTotal = (payment: any) => {
  if (!Array.isArray(payment?.refunds)) return null;
  const completed = payment.refunds.filter(
    (refund: any) => String(refund?.status || "").toUpperCase() === "DONE",
  );
  if (!completed.length) return null;
  const total = completed.reduce((sum: number, refund: any) => sum + Number(refund?.value || 0), 0);
  return Number.isFinite(total) && total > 0 ? Number(total.toFixed(2)) : null;
};

const handlePartialRefundConfirmed = async (payment: any, eventId?: string | null) => {
  const cumulativeRefund = completedRefundTotal(payment);
  if (cumulativeRefund === null) {
    throw new Error("Webhook de estorno parcial sem item refunds DONE.");
  }
  const orderId =
    String(payment?.externalReference || "") ||
    (await (async () => {
      const { rows } = await query(
        `SELECT order_id FROM public.payments WHERE external_id = $1 OR asaas_id = $1 LIMIT 1`,
        [payment?.id],
      );
      return rows[0]?.order_id || "";
    })());
  if (!orderId) return { updated: false, reason: "order_not_found" };

  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      orderFinancialLockKey(orderId),
    ]);
    const { rows: orders } = await client.query(
      `SELECT *
         FROM public.orders WHERE id = $1 FOR UPDATE`,
      [orderId],
    );
    const order = orders[0];
    if (!order) return { updated: false, reason: "order_not_found" };
    const orderTotal = Number(order.total || 0);
    if (cumulativeRefund > orderTotal + 0.01) {
      throw new Error("Valor acumulado de estorno excede o total do pedido.");
    }
    const paymentId = String(payment?.id ?? "").trim();
    const funding = await verifyCentralPixFunding(client, order, {
      requiredAmount: cumulativeRefund,
      acceptedPaymentStatuses: ["pago", "estornado"],
    });
    if (!paymentId || !funding.ok || funding.paymentId !== paymentId) {
      return { updated: false, reason: "refund_proof_invalid", stateConflict: true, orderId };
    }
    let refundMovement = await findMovement(
      { idempotencyKey: idemKeys.reembolso(orderId) },
      client,
    );
    if (!refundMovement) {
      await createCustomerRefund(
        { orderId, storeId: order.store_id, amount: cumulativeRefund, asaasPaymentId: paymentId },
        client,
      );
      refundMovement = await findMovement(
        { idempotencyKey: idemKeys.reembolso(orderId) },
        client,
      );
    }
    if (!refundMovement) {
      return { updated: false, reason: "refund_ledger_conflict", stateConflict: true, orderId };
    }
    const transferMovement = await findMovement(
      { idempotencyKey: idemKeys.repasse(orderId) },
      client,
    );
    const transferConflict =
      ["PROCESSANDO", "ENVIADO"].includes(String(order.transfer_status)) ||
      ["PROCESSANDO", "CONFIRMADO"].includes(String(transferMovement?.status));
    if (
      refundMovement.status === "CONFIRMADO" &&
      cumulativeRefund <= Number(order.refunded_amount || 0) + 0.001
    ) {
      return {
        updated: true,
        duplicate: true,
        financialConflict: transferConflict,
        orderId,
        cumulativeRefund,
      };
    }
    const fullRefund = Math.abs(cumulativeRefund - orderTotal) <= 0.01;
    const { rows: updated } = await client.query(
      `UPDATE public.orders
       SET status = CASE WHEN $5 THEN status ELSE 'cancelado' END,
           cancelled_at = CASE WHEN $5 THEN cancelled_at ELSE COALESCE(cancelled_at, now()) END,
           cancel_reason = CASE WHEN $5 THEN cancel_reason ELSE COALESCE(cancel_reason, 'Estorno confirmado fora do fluxo normal') END,
           refund_status = CASE WHEN $3 THEN 'ESTORNADO_TOTAL' ELSE 'ESTORNADO_PARCIAL' END,
           payment_status = 'estornado',
           transfer_status = CASE WHEN $5 THEN transfer_status ELSE 'CANCELADO' END,
           refunded_amount = GREATEST(COALESCE(refunded_amount, 0), $2),
           refunded_at = COALESCE(refunded_at, now()),
           asaas_event_id_ultimo = COALESCE($4, asaas_event_id_ultimo),
           updated_at = now()
       WHERE id = $1
         AND payment_method = 'pix'
         AND payment_status IN ('pago','estorno_pendente','estornado')
         AND (
           ($5 = false
             AND refund_status IN ('NAO_SOLICITADO','NAO_APLICAVEL','PENDENTE','PROCESSANDO','ESTORNADO_PARCIAL','FALHOU')
             AND transfer_status NOT IN ('PROCESSANDO','ENVIADO'))
           OR ($5 = true AND transfer_status IN ('PROCESSANDO','ENVIADO'))
         )
       RETURNING id, refunded_amount, refund_status`,
      [orderId, cumulativeRefund, fullRefund, eventId || null, transferConflict],
    );
    if (!updated[0]) {
      console.error(
        JSON.stringify({
          scope: "refund",
          event: "partial_webhook_state_conflict",
          orderId,
          refundId: payment?.id ? String(payment.id) : null,
        }),
      );
      return {
        updated: false,
        stateConflict: true,
        orderId,
        cumulativeRefund,
      };
    }
    const updatedMovement = await updateMovementStatus(
      { idempotencyKey: idemKeys.reembolso(orderId) },
      {
        status: "CONFIRMADO",
        asaasEventId: eventId || null,
        asaasRefundId: paymentId,
        metadata: { cumulativeRefund, source: "payment.refunds[DONE]" },
      },
      client,
    );
    if (!updatedMovement) {
      throw new Error("O ledger financeiro mudou durante o webhook de estorno parcial.");
    }
    return {
      updated: true,
      stateConflict: false,
      financialConflict: transferConflict,
      orderId,
      cumulativeRefund,
    };
  });
};

// ── Transferencias (repasse) ────────────────────────────────────────────────

const handleSubscriptionWebhook = async (
  event: string,
  subscription: any,
  eventId: string | null,
  eventRowId: string | null,
  eventOccurredAt: string | null,
) => {
  const db = { query: (s: string, p?: unknown[]) => query(s, p as unknown[]) };
  if (!terminalSubscriptionEvents.has(event)) {
    try {
      await markEventProcessed(db, eventId, eventRowId);
      return { ignored: true, terminal: false, updated: false };
    } catch (error: any) {
      await markEventFailed(eventId, eventRowId, error?.message || "subscription handler failed");
      throw error;
    }
  }

  let outcome: any;
  try {
    const externalReference = String(subscription.externalReference || "");
    const safeStoreId = platformStoreIdFromReference(externalReference);
    outcome = await withTransaction(async (client) => {
      const transactionDb = { query: (s: string, p?: unknown[]) => client.query(s, p) };
      const lockedStoreId =
        safeStoreId ||
        (await resolveSubscriptionStoreId(transactionDb, subscription.id, externalReference));
      if (!lockedStoreId) {
        throw new Error("terminal subscription event has no matching local subscription");
      }
      await acquireSubscriptionLock(transactionDb, lockedStoreId);

      const { rows } = await transactionDb.query(
        `WITH matched AS (
           SELECT s.id,
                  s.store_id,
                  s.asaas_subscription_id IS DISTINCT FROM $1 AS retired_gateway_id,
                  ($5::boolean AND s.gateway_paused_for_dispute) AS dispute_pause_ack,
                  (
                    $5::boolean
                    AND NOT s.gateway_paused_for_dispute
                    AND lower(COALESCE(s.status, '')) = 'ativa'
                    AND $4::timestamptz IS NOT NULL
                    AND s.last_payment_event_at IS NOT NULL
                    AND $4::timestamptz <= s.last_payment_event_at
                    AND s.last_payment_event_type IN ('PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED')
                  ) AS stale_recovery_ack,
                  (
                    $5::boolean
                    AND s.asaas_subscription_id = $1
                    AND NOT s.gateway_paused_for_dispute
                    AND $4::timestamptz IS NULL
                  ) AS ambiguous_inactivation
           FROM public.subscriptions s
           WHERE s.store_id = $2::uuid
             AND (
               s.asaas_subscription_id = $1
               OR $1 = ANY(s.previous_asaas_subscription_ids)
             )
             AND ($3::text IS NULL OR s.external_reference = $3)
           ORDER BY (s.asaas_subscription_id = $1) DESC
           LIMIT 1
           FOR UPDATE OF s
         ), updated AS (
           UPDATE public.subscriptions s
           SET status = CASE WHEN lower(COALESCE(s.status, '')) = 'encerrada' THEN s.status ELSE 'cancelada' END,
               canceled_at = COALESCE(s.canceled_at, $4::timestamptz, now()),
               cancellation_effective_at = COALESCE(
                 s.cancellation_effective_at,
                 s.current_period_end,
                 $4::timestamptz,
                 now()
               ),
               gateway_action_pending = CASE
                 WHEN s.gateway_action_pending = 'EXEMPT_CANCEL'
                   THEN s.gateway_action_pending
                 WHEN s.gateway_action_pending IN ('ACTIVE', 'INACTIVE')
                   THEN NULL
                 WHEN $6::boolean AND s.gateway_action_pending = 'CANCEL'
                   THEN NULL
                 ELSE s.gateway_action_pending
               END,
               gateway_paused_for_dispute = CASE
                 WHEN s.gateway_action_pending = 'EXEMPT_CANCEL'
                   THEN s.gateway_paused_for_dispute
                 ELSE false
               END,
               updated_at = now()
           FROM matched
           WHERE s.id = matched.id
             AND matched.retired_gateway_id IS FALSE
             AND matched.dispute_pause_ack IS FALSE
             AND matched.stale_recovery_ack IS FALSE
             AND matched.ambiguous_inactivation IS FALSE
           RETURNING to_jsonb(s) AS subscription_row
         )
         SELECT matched.store_id,
                matched.retired_gateway_id,
                matched.dispute_pause_ack,
                matched.stale_recovery_ack,
                matched.ambiguous_inactivation,
                updated.subscription_row
         FROM matched
         LEFT JOIN updated ON true`,
        [
          String(subscription.id),
          lockedStoreId,
          safeStoreId ? externalReference : null,
          eventOccurredAt,
          event === "SUBSCRIPTION_INACTIVATED",
          event === "SUBSCRIPTION_DELETED",
        ],
      );
      const matched = rows[0] || null;
      if (!matched?.store_id) {
        throw new Error("terminal subscription event has no matching local subscription");
      }
      if (matched.ambiguous_inactivation) {
        throw new Error("subscription inactivation has no trustworthy event timestamp");
      }

      await transactionDb.query(
        `UPDATE public.payment_events SET store_id = $2::uuid WHERE id = $1::uuid`,
        [eventRowId, matched.store_id],
      );
      await markEventProcessed(transactionDb, eventId, eventRowId);
      const updated = matched.subscription_row || null;
      return {
        ignored: Boolean(
          matched.retired_gateway_id || matched.dispute_pause_ack || matched.stale_recovery_ack,
        ),
        retired: Boolean(matched.retired_gateway_id),
        disputePause: Boolean(matched.dispute_pause_ack),
        staleRecovery: Boolean(matched.stale_recovery_ack),
        reason: matched.retired_gateway_id
          ? "retired_subscription"
          : matched.dispute_pause_ack
            ? "dispute_pause_ack"
            : matched.stale_recovery_ack
              ? "stale_after_recovery"
              : undefined,
        terminal: true,
        updated: Boolean(updated),
        subscriptionRow: updated,
      };
    });
  } catch (error: any) {
    await markEventFailed(eventId, eventRowId, error?.message || "subscription handler failed");
    throw error;
  }

  if (outcome.subscriptionRow) {
    publishRealtime({
      schema: "public",
      table: "subscriptions",
      eventType: "UPDATE",
      new: outcome.subscriptionRow,
      old: outcome.subscriptionRow,
    });
  }
  const { subscriptionRow: _subscriptionRow, ...response } = outcome;
  return response;
};

const handleTransferWebhook = async (
  event: string,
  transfer: any,
  eventId: string | null,
  eventRowId: string | null,
) => {
  const db = { query: (s: string, p?: unknown[]) => query(s, p as unknown[]) };
  try {
    let result: any;
    if (transferDoneEvents.has(event)) result = await handleTransferDone(transfer, eventId);
    else if (transferFailedEvents.has(event))
      result = await handleTransferFailed(transfer, eventId, "FALHOU");
    else if (transferCancelledEvents.has(event)) {
      if (event === "TRANSFER_BLOCKED") {
        console.error(
          JSON.stringify({
            scope: "asaas:webhook",
            event,
            transferId: transfer?.id,
            alert: "transferencia_bloqueada",
          }),
        );
      }
      result = await handleTransferFailed(transfer, eventId, "CANCELADO");
    } else {
      result = { updated: false, pending: transferPendingEvents.has(event) };
    }
    await markEventProcessed(db, eventId, eventRowId);
    return result;
  } catch (error: any) {
    await markEventFailed(eventId, eventRowId, error?.message || "transfer handler failed");
    throw error;
  }
};

export const handleAsaasWebhook = async (request: Request) => {
  try {
    validateRuntimeEnv({ requireWebhookSecret: true });
  } catch (error: any) {
    console.error("[asaas:webhook] webhook secret missing or runtime invalid", {
      production: isProductionRuntime(),
    });
    return safeJsonError(
      isProductionRuntime() ? "Webhook not configured" : error?.message || "Invalid runtime",
      500,
    );
  }

  const secret = getAsaasWebhookSecret();
  const accessToken = request.headers.get("asaas-access-token");
  if (secret && !safeEqual(accessToken, secret)) {
    return safeJsonError("Unauthorized", 401);
  }
  if (!secret && isProductionRuntime()) return safeJsonError("Webhook not configured", 500);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return safeJsonError("Invalid JSON", 400);
  }

  const event = String(body?.event || "");
  const eventId = body?.id ? String(body.id) : null;
  const eventOccurredAt = parseEventTimestamp(body?.dateCreated);
  if (!event) return safeJsonError("Invalid payload", 400);

  const resourceType: "payment" | "transfer" | "subscription" = event.startsWith("TRANSFER_")
    ? "transfer"
    : event.startsWith("SUBSCRIPTION_")
      ? "subscription"
      : "payment";
  const resource =
    resourceType === "transfer"
      ? body?.transfer
      : resourceType === "subscription"
        ? body?.subscription
        : body?.payment;
  if (!resource?.id) return safeJsonError("Invalid payload", 400);
  if (resourceType === "payment" && !resource.externalReference && !resource.subscription) {
    return safeJsonError("Invalid payload", 400);
  }

  let claim: Awaited<ReturnType<typeof claimEvent>>;
  try {
    claim = await claimEvent({
      event,
      resourceType,
      resourceId: String(resource.id),
      eventId,
      body,
    });
  } catch (error: any) {
    console.error("[asaas:webhook] event claim failed", error?.message);
    return safeJsonError("Webhook processing failed", 500);
  }
  if (!claim.claimed) {
    if (claim.processed) {
      return Response.json({ success: true, duplicate: true, processed: true });
    }
    const retryAfterSeconds = Math.max(
      eventRetryAfterSeconds,
      Number(claim.retryAfterSeconds) || eventRetryAfterSeconds,
    );
    return Response.json(
      { success: false, duplicate: true, processing: true, retryable: true },
      {
        status: 503,
        headers: { "Retry-After": String(retryAfterSeconds) },
      },
    );
  }

  if (event.startsWith("SUBSCRIPTION_") && body?.subscription?.id) {
    try {
      const result = await handleSubscriptionWebhook(
        event,
        body.subscription,
        eventId,
        claim.rowId,
        eventOccurredAt,
      );
      return Response.json({ success: true, subscription: true, ...result });
    } catch (error: any) {
      console.error("[asaas:webhook] subscription lifecycle handler error", error?.message);
      return safeJsonError("Webhook processing failed", 500);
    }
  }

  // ── Eventos de transferencia (repasse) ─────────────────────────────────
  if (event.startsWith("TRANSFER_")) {
    const transfer = body?.transfer;
    if (!transfer?.id) return safeJsonError("Invalid payload", 400);
    try {
      const result = await handleTransferWebhook(event, transfer, eventId, claim.rowId);
      return Response.json({ success: true, transfer: result });
    } catch (e: any) {
      console.error("[asaas:webhook] transfer handler error", e?.message);
      return safeJsonError("Webhook processing failed", 500);
    }
  }

  // ── Eventos de pagamento ───────────────────────────────────────────────
  const payment = body?.payment;
  if (!payment?.id || (!payment?.externalReference && !payment?.subscription)) {
    return safeJsonError("Invalid payload", 400);
  }

  const mappedStatus = paymentStatusForEvent(event);
  if (!mappedStatus) {
    await markEventProcessed({ query: (s, p) => query(s, p as unknown[]) }, eventId, claim.rowId);
    return Response.json({ success: true, ignored: true });
  }

  const platformStoreId = platformStoreIdFromReference(payment.externalReference);
  const isSubscriptionPayment = Boolean(payment.subscription || platformStoreId);
  if (isSubscriptionPayment) {
    let transactionOutcome: {
      subscriptionUpdate: SubscriptionPaymentUpdateResult;
      gatewayError: Error | null;
    };
    try {
      transactionOutcome = await withTransaction(async (client) => {
        const transactionDb = { query: (s: string, p?: unknown[]) => client.query(s, p) };
        const lockedStoreId =
          platformStoreId ||
          (await resolveSubscriptionStoreId(
            transactionDb,
            payment.subscription,
            payment.externalReference,
          ));
        if (!lockedStoreId) {
          throw new Error("subscription not found for webhook identity");
        }
        await acquireSubscriptionLock(transactionDb, lockedStoreId);

        const subscriptionUpdate = await updateSubscriptionIfPresent(
          transactionDb,
          event,
          payment,
          eventOccurredAt,
          lockedStoreId,
        );
        if (!subscriptionUpdate.matched) {
          throw new Error("subscription not found for webhook identity");
        }

        await transactionDb.query(
          `UPDATE public.payment_events SET store_id = $2::uuid WHERE id = $1::uuid`,
          [claim.rowId, subscriptionUpdate.storeId || lockedStoreId],
        );
        try {
          await applyPendingSubscriptionGatewayAction(
            transactionDb,
            event,
            payment,
            subscriptionUpdate,
          );
          await markEventProcessed(transactionDb, eventId, claim.rowId);
          return { subscriptionUpdate, gatewayError: null };
        } catch (error: any) {
          const gatewayError =
            error instanceof Error
              ? error
              : new Error(error?.message || "subscription gateway reconciliation failed");
          await markEventFailedWithClient(
            transactionDb,
            eventId,
            claim.rowId,
            gatewayError.message,
          );
          return { subscriptionUpdate, gatewayError };
        }
      });
    } catch (error: any) {
      console.error("[asaas:webhook] subscription update failed", {
        event,
        paymentId: payment.id,
        message: error?.message || "subscription update failed",
      });
      await markEventFailed(eventId, claim.rowId, error?.message || "subscription update failed");
      return safeJsonError("Webhook processing failed", 500);
    }

    const subscriptionUpdate = transactionOutcome.subscriptionUpdate;
    if (subscriptionUpdate.subscriptionRow) {
      publishRealtime({
        schema: "public",
        table: "subscriptions",
        eventType: "UPDATE",
        new: subscriptionUpdate.subscriptionRow,
        old: subscriptionUpdate.subscriptionRow,
      });
    }
    if (transactionOutcome.gatewayError) {
      console.error("[asaas:webhook] subscription gateway reconciliation failed", {
        event,
        paymentId: payment.id,
        message: transactionOutcome.gatewayError.message,
      });
      return safeJsonError("Webhook processing failed", 500);
    }

    return Response.json({
      success: true,
      subscription: true,
      updated: subscriptionUpdate.updated,
      ignored:
        subscriptionUpdate.amountMismatch ||
        subscriptionUpdate.terminalBlocked ||
        subscriptionUpdate.ignoredByGuard,
      reason: subscriptionUpdate.amountMismatch
        ? "payment_value_mismatch"
        : subscriptionUpdate.terminalBlocked
          ? "terminal_subscription"
          : subscriptionUpdate.retiredGatewayId
            ? "retired_subscription"
            : subscriptionUpdate.ignoredByGuard
              ? "stale_or_state_guard"
              : undefined,
    });
  }

  const result = await withTransaction(async (client) => {
    // Cancellation, delivery, transfer and refund all use this namespace. The
    // external reference is validated against o.id by the locked query below.
    await client.query(`SET LOCAL lock_timeout = '5s'`);
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0::bigint))`, [
      orderFinancialLockKey(String(payment.externalReference)),
    ]);
    const { rows: payments } = await client.query(
      `SELECT p.*, o.id AS order_exists, o.total AS order_total, o.store_id AS order_store_id,
              o.status AS order_status, o.payment_status AS order_payment_status,
              o.transfer_status AS order_transfer_status, o.refund_status AS order_refund_status
       FROM public.payments p
       JOIN public.orders o ON o.id = p.order_id
       WHERE (p.external_id = $1 OR p.asaas_id = $1 OR (p.order_id::text = $2 AND (p.external_id IS NULL OR p.external_id = $1)))
         AND o.id::text = $2
       LIMIT 1
       FOR UPDATE OF p, o`,
      [payment.id, payment.externalReference],
    );
    const localPayment = payments[0];
    if (!localPayment) {
      return { updated: false, eventRowId: claim.rowId };
    }

    await client.query(
      `UPDATE public.payment_events
       SET order_id = $2::uuid, store_id = $3::uuid
       WHERE id = $1::uuid`,
      [claim.rowId, localPayment.order_id, localPayment.store_id],
    );
    const eventRowId = claim.rowId;

    const currentStatus = String(localPayment.status || "").toLowerCase();
    const currentEventAt = localPayment.last_webhook_at
      ? new Date(localPayment.last_webhook_at).getTime()
      : null;
    const incomingEventAt = eventOccurredAt ? new Date(eventOccurredAt).getTime() : null;
    const refundTransition = mappedStatus === "estornado";
    const staleByTime =
      !refundTransition &&
      currentEventAt !== null &&
      incomingEventAt !== null &&
      incomingEventAt < currentEventAt;
    const invalidDowngrade =
      (paidPaymentStatuses.has(currentStatus) && !["pago", "estornado"].includes(mappedStatus)) ||
      (currentStatus === "estornado" && mappedStatus !== "estornado");
    if (staleByTime || invalidDowngrade) {
      return { updated: false, stale: true, eventRowId };
    }

    if (mappedStatus === "pago") {
      const expected = Number(localPayment.order_total || 0);
      const received = Number(payment.value);
      if (!Number.isFinite(received) || Math.abs(received - expected) > 0.01) {
        await client.query(
          `UPDATE public.payments SET last_error = $2, updated_at = now() WHERE id = $1`,
          [
            localPayment.id,
            `Valor divergente no webhook Asaas. Esperado ${expected}, recebido ${payment.value ?? "ausente"}`,
          ],
        );
        // valor divergente bloqueia o fluxo financeiro do pedido
        await client.query(
          `UPDATE public.orders
              SET transfer_status = 'BLOQUEADO', updated_at = now()
            WHERE id = $1
              AND transfer_status NOT IN ('PROCESSANDO','ENVIADO')`,
          [localPayment.order_id],
        );
        return { updated: false, suspicious: true, eventRowId };
      }
    }

    const wasPaid = paidPaymentStatuses.has(currentStatus);
    const { rows: updatedPayments } = await client.query(
      `UPDATE public.payments
       SET status = $2,
           external_id = COALESCE(external_id, $3),
           asaas_id = COALESCE(asaas_id, $3),
           paid_at = CASE WHEN $2 = 'pago' THEN COALESCE(paid_at, now()) ELSE paid_at END,
           last_webhook_at = CASE
             WHEN $4::timestamptz IS NULL THEN last_webhook_at
             ELSE GREATEST(COALESCE(last_webhook_at, $4::timestamptz), $4::timestamptz)
           END,
           last_webhook_event = CASE
             WHEN $4::timestamptz IS NULL OR last_webhook_at IS NULL OR $4::timestamptz >= last_webhook_at
               THEN $5
             ELSE last_webhook_event
           END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [localPayment.id, mappedStatus, payment.id, eventOccurredAt, event],
    );

    let updatedOrder = null;
    let latePaymentRefund: null | {
      required: true;
      automatic: boolean;
      orderId: string;
    } = null;
    if (mappedStatus === "pago") {
      const canceledBeforePayment = String(localPayment.order_status) === "cancelado";
      if (canceledBeforePayment) {
        const { rows: canceledOrders } = await client.query(
          `UPDATE public.orders
           SET payment_status = 'estorno_pendente',
               transfer_status = CASE
                 WHEN transfer_status IN ('LIBERADO','PROCESSANDO','ENVIADO') THEN transfer_status
                 ELSE 'BLOQUEADO'
               END,
               refund_status = CASE
                 WHEN refund_status IN ('PROCESSANDO','ESTORNADO_TOTAL','ESTORNADO_PARCIAL') THEN refund_status
                 ELSE 'PENDENTE'
               END,
               asaas_event_id_ultimo = COALESCE($2, asaas_event_id_ultimo),
               updated_at = now()
           WHERE id = $1
             AND status = 'cancelado'
             AND payment_status <> 'estornado'
           RETURNING *`,
          [localPayment.order_id, eventId],
        );
        updatedOrder = canceledOrders[0] || null;
        if (!updatedOrder) {
          return {
            updated: false,
            stale: true,
            eventRowId,
            payment: updatedPayments[0],
          };
        }

        // A canceled sale must not accrue a platform fee or re-enter production.
        // Record only the external receipt and its mandatory compensation.
        const automaticRefund = localPayment.provider === "asaas-central";
        if (automaticRefund) {
          await recordMovement(
            {
              orderId: localPayment.order_id,
              storeId: localPayment.store_id,
              type: "ENTRADA_PIX",
              nature: "CREDITO",
              amount: Number(localPayment.order_total),
              status: "CONFIRMADO",
              description: "Entrada PIX tardia confirmada na conta central",
              asaasPaymentId: payment.id,
              asaasEventId: eventId,
              externalReference: `ORDER_${localPayment.order_id}`,
              idempotencyKey: idemKeys.entradaPix(localPayment.order_id),
              metadata: { reason: "late_payment_after_cancellation" },
            },
            client,
          );
        }
        await recordMovement(
          {
            orderId: localPayment.order_id,
            storeId: localPayment.store_id,
            type: "REEMBOLSO_CLIENTE",
            nature: "DEBITO",
            amount: Number(localPayment.order_total),
            status: "PENDENTE",
            description: "Pagamento PIX recebido apos o cancelamento; estorno obrigatorio",
            asaasPaymentId: payment.id,
            asaasEventId: eventId,
            externalReference: `REFUND_ORDER_${localPayment.order_id}`,
            idempotencyKey: idemKeys.reembolso(localPayment.order_id),
            metadata: {
              reason: "late_payment_after_cancellation",
              automatic: automaticRefund,
            },
          },
          client,
        );
        latePaymentRefund = {
          required: true,
          automatic: automaticRefund,
          orderId: String(localPayment.order_id),
        };
      } else {
        const { rows: orders } = await client.query(
          `UPDATE public.orders
           SET status = CASE WHEN status = 'aguardando_pagamento' THEN 'novo' ELSE status END,
               payment_status = 'pago',
               updated_at = now()
           WHERE id = $1
             AND status <> 'cancelado'
           RETURNING *`,
          [localPayment.order_id],
        );
        updatedOrder = orders[0] || null;

        if (updatedOrder && !wasPaid) {
          await client.query(
            `INSERT INTO public.order_status_history (order_id, store_id, status, notes)
             SELECT $1, $2, 'novo', 'Pagamento PIX confirmado via Webhook (Asaas)'
             WHERE NOT EXISTS (
               SELECT 1 FROM public.order_status_history
               WHERE order_id = $1 AND status = 'novo' AND notes = 'Pagamento PIX confirmado via Webhook (Asaas)'
             )`,
            [localPayment.order_id, localPayment.store_id],
          );
        }

        // Escrow (modelo central): registra ENTRADA_PIX + TAXA_PLATAFORMA e
        // segura o repasse ate a entrega. No-op se a loja nao for central.
        if (updatedOrder && localPayment.provider === "asaas-central") {
          await applyPaymentEscrow(
            client,
            {
              id: localPayment.order_id,
              store_id: localPayment.store_id,
              total: localPayment.order_total,
            },
            payment.id,
            eventId,
          );
        }
      }
    } else if (chargebackEvents.has(event)) {
      const transferMovement = await findMovement(
        { idempotencyKey: idemKeys.repasse(localPayment.order_id) },
        client,
      );
      const financialConflict =
        ["PROCESSANDO", "ENVIADO"].includes(String(localPayment.order_transfer_status)) ||
        ["PROCESSANDO", "CONFIRMADO"].includes(String(transferMovement?.status));
      const { rows: orders } = await client.query(
        `UPDATE public.orders
            SET payment_status = 'estornado',
                refund_status = 'FALHOU',
                transfer_status = CASE
                  WHEN transfer_status IN ('PROCESSANDO','ENVIADO') THEN transfer_status
                  ELSE 'BLOQUEADO'
                END,
                asaas_event_id_ultimo = COALESCE($2, asaas_event_id_ultimo),
                updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [localPayment.order_id, eventId],
      );
      updatedOrder = orders[0] || null;
      if (financialConflict) {
        console.error(
          JSON.stringify({
            scope: "payment",
            event: "chargeback_after_transfer_reservation",
            orderId: localPayment.order_id,
            transferStatus: localPayment.order_transfer_status,
            transferMovementStatus: transferMovement?.status ?? null,
          }),
        );
      }
      return {
        updated: Boolean(updatedOrder),
        payment: updatedPayments[0],
        order: updatedOrder,
        eventRowId,
        latePaymentRefund,
        financialConflict,
      };
    } else {
      const { rows: orders } = await client.query(
        `UPDATE public.orders SET payment_status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
        [localPayment.order_id, mappedStatus],
      );
      updatedOrder = orders[0] || null;
    }

    return {
      updated: true,
      payment: updatedPayments[0],
      order: updatedOrder,
      eventRowId,
      latePaymentRefund,
    };
  });

  const latePaymentRefund = (result as any).latePaymentRefund as
    | { required: true; automatic: boolean; orderId: string }
    | null
    | undefined;
  let latePaymentRefundOutcome: Awaited<ReturnType<typeof refundCancelledOrder>> | null = null;
  if (latePaymentRefund?.automatic) {
    try {
      latePaymentRefundOutcome = await refundCancelledOrder(latePaymentRefund.orderId, {
        reason: "Pagamento PIX recebido apos o cancelamento",
      });
    } catch (error: any) {
      const message = error?.message || "late payment refund failed";
      await markEventFailed(eventId, claim.rowId, message);
      return safeJsonError("Webhook processing failed", 500);
    }

    const durableHandoff = latePaymentRefundOutcome.ok
      ? true
      : ["reembolso_ja_em_andamento", "valor_estorno_invalido"].includes(
          latePaymentRefundOutcome.reason,
        );
    if (!durableHandoff && !latePaymentRefundOutcome.ok) {
      await markEventFailed(
        eventId,
        claim.rowId,
        `late payment refund pending: ${latePaymentRefundOutcome.reason}`,
      );
      return safeJsonError("Webhook processing failed", 500);
    }
  }

  // Ledger de reembolso (modelo central) — fora da txn principal, idempotente.
  if (refundedEvents.has(event)) {
    try {
      const refundOutcome =
        event === "PAYMENT_PARTIALLY_REFUNDED"
          ? await handlePartialRefundConfirmed(payment, eventId)
          : await handleRefundConfirmed(payment, eventId, false);
      if ((refundOutcome as any).financialConflict) {
        (result as any).financialConflict = true;
      }
      if ((refundOutcome as any).stateConflict && !(refundOutcome as any).financialConflict) {
        throw new Error((refundOutcome as any).reason || "refund state conflict");
      }
    } catch (error: any) {
      console.error("[asaas:webhook] refund ledger error", error?.message);
      await markEventFailed(eventId, claim.rowId, error?.message || "refund ledger failed");
      return safeJsonError("Webhook processing failed", 500);
    }
  }

  await markEventProcessed(
    { query: (s, p) => query(s, p as unknown[]) },
    eventId,
    (result as any).eventRowId || claim.rowId,
  );

  if (!result.updated) {
    console.warn("[asaas:webhook] payment ignored: no matching local payment/order", {
      event,
      paymentId: payment.id,
      hasExternalReference: Boolean(payment.externalReference),
      suspicious: Boolean((result as any).suspicious),
    });
    return Response.json({ success: true, ignored: true });
  }

  if (result.payment) {
    publishRealtime({
      schema: "public",
      table: "payments",
      eventType: "UPDATE",
      new: result.payment,
      old: result.payment,
    });
  }
  if (result.order) {
    publishRealtime({
      schema: "public",
      table: "orders",
      eventType: "UPDATE",
      new: result.order,
      old: result.order,
    });
  }

  return Response.json({
    success: true,
    financialConflict: Boolean((result as any).financialConflict),
    latePaymentRefund: latePaymentRefund
      ? {
          required: true,
          automatic: latePaymentRefund.automatic,
          status: latePaymentRefundOutcome?.ok
            ? latePaymentRefundOutcome.status
            : latePaymentRefund?.automatic
              ? "PROCESSANDO"
              : "PENDENTE_RECONCILIACAO",
        }
      : undefined,
  });
};
