import { RealtimeClient } from "@supabase/realtime-js";

const TOPIC_PATTERN =
  /^hype:store-orders:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RENEW_BEFORE_EXPIRY_MS = 60_000;
const MAX_TICKET_LIFETIME_MS = 16 * 60_000;

export const isPrivateOrderRealtimeTicket = (ticket) => {
  if (
    ticket?.transport !== "supabase-broadcast-v1" ||
    ticket?.private !== true ||
    ticket?.event !== "orders-invalidated" ||
    typeof ticket?.publishableKey !== "string" ||
    !ticket.publishableKey.trim() ||
    !TOPIC_PATTERN.test(String(ticket?.topic || "")) ||
    !Number.isFinite(Date.parse(String(ticket?.expiresAt || ""))) ||
    Date.parse(String(ticket.expiresAt)) <= Date.now() ||
    Date.parse(String(ticket.expiresAt)) > Date.now() + MAX_TICKET_LIFETIME_MS
  ) {
    return false;
  }

  try {
    const endpoint = new URL(ticket.endpoint);
    return ["wss:", "ws:"].includes(endpoint.protocol) && endpoint.pathname === "/realtime/v1";
  } catch {
    return false;
  }
};

export const subscribePrivateOrderBroadcast = (
  { ticket, onMessage, onStatus },
  RealtimeClientConstructor = RealtimeClient,
) => {
  if (!isPrivateOrderRealtimeTicket(ticket)) {
    throw new Error("Ticket Supabase Realtime invalido.");
  }

  const client = new RealtimeClientConstructor(ticket.endpoint, {
    params: { apikey: ticket.publishableKey },
  });
  const channel = client.channel(ticket.topic, {
    config: {
      private: true,
      broadcast: { ack: false, self: false },
    },
  });
  let stopped = false;
  const renewalDelay = Math.max(
    1_000,
    Date.parse(ticket.expiresAt) - Date.now() - RENEW_BEFORE_EXPIRY_MS,
  );
  const renewalTimer = globalThis.setTimeout?.(() => {
    if (!stopped) onStatus?.("ticket-expiring");
  }, renewalDelay);

  channel
    .on("broadcast", { event: ticket.event }, (message) => {
      if (stopped || message?.payload?.table !== "orders") return;
      // Never forward arbitrary Broadcast fields. The UI receives only a local
      // invalidation marker and obtains every order field again through the BFF.
      onMessage?.({
        schema: "public",
        table: "orders",
        eventType: "UPDATE",
        new: null,
        old: null,
        invalidated: true,
      });
    })
    .subscribe((status, error) => {
      if (stopped) return;
      if (status === "SUBSCRIBED") onStatus?.("connected");
      else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        onStatus?.("error", error || new Error(`Canal Supabase Realtime: ${status}.`));
      }
    });

  return () => {
    if (stopped) return;
    stopped = true;
    globalThis.clearTimeout?.(renewalTimer);
    void client
      .removeChannel(channel)
      .catch(() => undefined)
      .then(() => client.disconnect())
      .catch(() => undefined);
  };
};
