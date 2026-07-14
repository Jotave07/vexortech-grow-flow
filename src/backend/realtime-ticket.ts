import { query } from "./db";
import { getSupabaseServerConfig } from "./supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const ORDER_REALTIME_EVENT = "orders-invalidated";
export const ORDER_REALTIME_TOPIC_PREFIX = "hype:store-orders:";

export type RealtimeTicketActor = {
  user: { id: string };
  admin: boolean;
  roles: Set<string>;
  ownedStoreIds: string[];
};

type TicketDependencies = {
  query: typeof query;
  getConfig: typeof getSupabaseServerConfig;
};

const defaultDependencies: TicketDependencies = {
  query,
  getConfig: getSupabaseServerConfig,
};

const realtimeEndpoint = (projectUrl: string) => {
  const endpoint = new URL("/realtime/v1", projectUrl);
  if (endpoint.protocol === "https:") endpoint.protocol = "wss:";
  else if (endpoint.protocol === "http:") endpoint.protocol = "ws:";
  else throw new Error("URL publica do Supabase invalida para Realtime.");
  return endpoint.toString().replace(/\/$/, "");
};

export const issueOrderRealtimeTicket = async (
  body: { storeId?: unknown; store_id?: unknown },
  actor: RealtimeTicketActor | null,
  dependencies: TicketDependencies = defaultDependencies,
) => {
  if (!actor) throw new Error("Nao autenticado.");

  const storeId = String(body?.storeId || body?.store_id || "").trim();
  if (!UUID_PATTERN.test(storeId)) throw new Error("Loja invalida para o canal em tempo real.");

  const ownsStore = actor.roles.has("store_owner") && actor.ownedStoreIds.includes(storeId);
  if (!actor.admin && !ownsStore) throw new Error("Loja fora do escopo do usuario.");

  const actorUserId = String(actor.user?.id || "").trim();
  if (!UUID_PATTERN.test(actorUserId))
    throw new Error("Usuario invalido para o canal em tempo real.");

  const config = dependencies.getConfig();
  if (!config.url || !config.publishableKey) {
    throw new Error("Supabase Realtime nao configurado.");
  }

  const { rows } = await dependencies.query(
    `SELECT issued.ticket_id, issued.expires_at
     FROM hype_private.issue_order_realtime_ticket($1::uuid, $2::uuid) AS issued`,
    [storeId, actorUserId],
  );
  const ticketId = String(rows[0]?.ticket_id || "").trim();
  const expiresAtMs = Date.parse(String(rows[0]?.expires_at || ""));
  const now = Date.now();
  if (
    !UUID_PATTERN.test(ticketId) ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= now ||
    expiresAtMs > now + 16 * 60_000
  ) {
    throw new Error("Ticket Supabase Realtime invalido ou expirado.");
  }

  return {
    transport: "supabase-broadcast-v1",
    endpoint: realtimeEndpoint(config.url),
    publishableKey: config.publishableKey,
    topic: `${ORDER_REALTIME_TOPIC_PREFIX}${ticketId.toLowerCase()}`,
    event: ORDER_REALTIME_EVENT,
    private: true,
    expiresAt: new Date(expiresAtMs).toISOString(),
  } as const;
};
