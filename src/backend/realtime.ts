import { randomUUID } from "node:crypto";
import { getActor } from "./auth";

type RealtimePayload = {
  schema: "public";
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

type Client = {
  id: string;
  send: (payload: RealtimePayload) => void;
};

type RealtimeScope = {
  table?: string | null;
  event?: string | null;
  filterColumn?: string | null;
  filterValue?: string | null;
  publicToken?: string | null;
  ownedStoreIds: string[];
  admin: boolean;
};

type GlobalRealtime = typeof globalThis & {
  __hypeRealtimeClients?: Set<Client>;
};

const clients = () => {
  const g = globalThis as GlobalRealtime;
  if (!g.__hypeRealtimeClients) g.__hypeRealtimeClients = new Set<Client>();
  return g.__hypeRealtimeClients;
};

export const publishRealtime = (payload: RealtimePayload) => {
  for (const client of clients()) {
    try {
      client.send(payload);
    } catch {
      clients().delete(client);
    }
  }
};

const parseFilter = (filter?: string | null) => {
  if (!filter) return { column: null, value: null };
  const [column, value] = filter.split("=eq.");
  return { column: column || null, value: value || null };
};

const rowForPayload = (payload: RealtimePayload) => payload.new || payload.old || {};

const publicOrderPayload = (payload: RealtimePayload): RealtimePayload => {
  const row = rowForPayload(payload);
  return {
    ...payload,
    new: payload.new
      ? {
        id: row.id,
        public_token: row.public_token,
        status: row.status,
        payment_status: row.payment_status,
        updated_at: row.updated_at,
      }
      : null,
    old: null,
  };
};

const payloadForScope = (scope: RealtimeScope, payload: RealtimePayload) => {
  if (scope.table && payload.table !== scope.table) return null;
  if (scope.event && scope.event !== "*" && payload.eventType !== scope.event) return null;

  const row = rowForPayload(payload);
  if (scope.filterColumn && scope.filterValue && String(row[scope.filterColumn] ?? "") !== scope.filterValue) {
    return null;
  }

  if (scope.publicToken) {
    if (payload.table !== "orders" || String(row.public_token || "") !== scope.publicToken) return null;
    return publicOrderPayload(payload);
  }

  if (scope.admin) return payload;
  if (scope.ownedStoreIds.length && row.store_id && scope.ownedStoreIds.includes(String(row.store_id))) return payload;
  return null;
};

export const createRealtimeStream = async (request: Request) => {
  const encoder = new TextEncoder();
  const id = randomUUID();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const url = new URL(request.url);
  const { column, value } = parseFilter(url.searchParams.get("filter"));
  const token = url.searchParams.get("token") || "";
  const actor = await getActor(token);
  const scope: RealtimeScope = {
    table: url.searchParams.get("table"),
    event: url.searchParams.get("event"),
    filterColumn: column,
    filterValue: value,
    publicToken: column === "public_token" ? value : null,
    ownedStoreIds: actor?.ownedStoreIds || [],
    admin: Boolean(actor?.admin),
  };

  const stream = new ReadableStream({
    start(controller) {
      const client: Client = {
        id,
        send(payload) {
          const scopedPayload = payloadForScope(scope, payload);
          if (scopedPayload) controller.enqueue(encoder.encode(`data: ${JSON.stringify(scopedPayload)}\n\n`));
        },
      };
      clients().add(client);
      controller.enqueue(encoder.encode(`event: ready\ndata: {"ok":true}\n\n`));
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));
      }, 25_000);
    },
    cancel() {
      for (const client of clients()) {
        if (client.id === id) clients().delete(client);
      }
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
};
