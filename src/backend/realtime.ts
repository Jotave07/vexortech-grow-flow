import { randomUUID } from "node:crypto";
import { getActor } from "./auth";
import { parseBearerToken, query } from "./db";

type RealtimePayload = {
  schema: "public";
  table: string;
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
};

type Client = {
  id: string;
  principal: string;
  send: (payload: RealtimePayload) => void;
  close: () => void;
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
  __hypeRealtimeRequestWindows?: Map<string, { startedAt: number; count: number }>;
};

const clients = () => {
  const g = globalThis as GlobalRealtime;
  if (!g.__hypeRealtimeClients) g.__hypeRealtimeClients = new Set<Client>();
  return g.__hypeRealtimeClients;
};

const requestWindows = () => {
  const g = globalThis as GlobalRealtime;
  if (!g.__hypeRealtimeRequestWindows) g.__hypeRealtimeRequestWindows = new Map();
  return g.__hypeRealtimeRequestWindows;
};

export const publishRealtime = (payload: RealtimePayload) => {
  for (const client of clients()) {
    try {
      client.send(payload);
    } catch {
      client.close();
    }
  }
};

const parseFilter = (filter?: string | null) => {
  if (!filter) return { column: null, value: null };
  if (filter.length > 512) throw new Error("Filtro Realtime invalido.");
  const match = filter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)=eq\.(.{1,256})$/s);
  if (!match) throw new Error("Filtro Realtime invalido.");
  return { column: match[1], value: match[2] };
};

const rowForPayload = (payload: RealtimePayload) => payload.new || payload.old || {};

const publicOrderPayload = (payload: RealtimePayload): RealtimePayload => {
  const row = rowForPayload(payload);
  return {
    ...payload,
    new: payload.new
      ? {
        id: row.id,
        status: row.status,
        payment_status: row.payment_status,
        updated_at: row.updated_at,
      }
      : null,
    old: null,
  };
};

const positiveIntegerEnv = (name: string, fallback: number, maximum: number) => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
};

const remoteAddress = (request: Request) =>
  request.headers.get("cf-connecting-ip") ||
  request.headers.get("x-real-ip") ||
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  "unknown";

const errorResponse = (message: string, status: number) =>
  Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

const validEvent = (value: string | null): value is "*" | RealtimePayload["eventType"] =>
  value === "*" || value === "INSERT" || value === "UPDATE" || value === "DELETE";

const validTable = (value: string | null) => Boolean(value && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value));

const consumeConnectionAttempt = (request: Request) => {
  const now = Date.now();
  const windowMs = positiveIntegerEnv("REALTIME_RATE_WINDOW_MS", 60_000, 10 * 60_000);
  const maximum = positiveIntegerEnv("REALTIME_MAX_ATTEMPTS_PER_WINDOW", 60, 1_000);
  const key = remoteAddress(request);
  const windows = requestWindows();
  const current = windows.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    windows.set(key, { startedAt: now, count: 1 });
  } else {
    current.count += 1;
    if (current.count > maximum) return false;
  }
  if (windows.size > 10_000) {
    for (const [windowKey, value] of windows) {
      if (now - value.startedAt >= windowMs) windows.delete(windowKey);
      if (windows.size <= 5_000) break;
    }
  }
  return true;
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
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  let registeredClient: Client | undefined;
  let closed = false;
  const url = new URL(request.url);
  if (url.searchParams.get("stream") !== "realtime") return errorResponse("Rota GET invalida.", 400);
  if (!consumeConnectionAttempt(request)) return errorResponse("Muitas tentativas Realtime.", 429);

  const table = url.searchParams.get("table");
  const event = url.searchParams.get("event") || "*";
  if (!validTable(table) || !validEvent(event)) return errorResponse("Escopo Realtime invalido.", 400);

  let parsedFilter: ReturnType<typeof parseFilter>;
  try {
    parsedFilter = parseFilter(url.searchParams.get("filter"));
  } catch (error: any) {
    return errorResponse(error?.message || "Filtro Realtime invalido.", 400);
  }
  if (parsedFilter.column === "public_token") {
    return errorResponse("Credencial Realtime nao pode ser enviada na URL.", 400);
  }

  const publicToken = String(request.headers.get("x-realtime-public-token") || "").trim();
  if (publicToken.length > 256) return errorResponse("Credencial Realtime invalida.", 400);
  const token = parseBearerToken(request);
  const actor = await getActor(token);
  if (!actor && !publicToken) return errorResponse("Autenticacao obrigatoria.", 401);

  if (publicToken) {
    if (table !== "orders" || (event !== "*" && event !== "UPDATE")) {
      return errorResponse("Escopo publico Realtime invalido.", 403);
    }
    const { rows } = await query(
      `SELECT id FROM public.orders WHERE public_token = $1::text LIMIT 1`,
      [publicToken],
    );
    if (!rows[0]) return errorResponse("Credencial Realtime invalida.", 401);
  }

  const principal = publicToken
    ? `public:${publicToken}`
    : actor
      ? `user:${actor.user.id}`
      : `ip:${remoteAddress(request)}`;
  const maxConnections = positiveIntegerEnv("REALTIME_MAX_CONNECTIONS", 250, 5_000);
  const maxConnectionsPerPrincipal = positiveIntegerEnv("REALTIME_MAX_CONNECTIONS_PER_PRINCIPAL", 5, 50);
  if (clients().size >= maxConnections) return errorResponse("Limite de conexoes Realtime atingido.", 429);
  const principalConnections = [...clients()].filter((client) => client.principal === principal).length;
  if (principalConnections >= maxConnectionsPerPrincipal) {
    return errorResponse("Limite de conexoes Realtime por usuario atingido.", 429);
  }

  const scope: RealtimeScope = {
    table,
    event,
    filterColumn: parsedFilter.column,
    filterValue: parsedFilter.value,
    publicToken: publicToken || null,
    ownedStoreIds: actor?.ownedStoreIds || [],
    admin: Boolean(actor?.admin),
  };

  let cleanup = () => undefined;

  const stream = new ReadableStream({
    start(controller) {
      cleanup = () => {
        if (closed) return;
        closed = true;
        if (registeredClient) clients().delete(registeredClient);
        if (heartbeat) clearInterval(heartbeat);
        if (lifetime) clearTimeout(lifetime);
        request.signal.removeEventListener("abort", cleanup);
        try {
          controller.close();
        } catch {
          // Stream may already be closed by the runtime.
        }
      };
      const client: Client = {
        id,
        principal,
        send(payload) {
          const scopedPayload = payloadForScope(scope, payload);
          if (scopedPayload) controller.enqueue(encoder.encode(`data: ${JSON.stringify(scopedPayload)}\n\n`));
        },
        close: cleanup,
      };
      registeredClient = client;
      clients().add(client);
      controller.enqueue(encoder.encode(`event: ready\ndata: {"ok":true}\n\n`));
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));
        } catch {
          cleanup();
        }
      }, 25_000);
      const defaultLifetime = actor ? 24 * 60 * 60 * 1_000 : 60 * 60 * 1_000;
      lifetime = setTimeout(cleanup, positiveIntegerEnv("REALTIME_MAX_STREAM_MS", defaultLifetime, 24 * 60 * 60 * 1_000));
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "private, no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      Vary: "Authorization, X-Realtime-Public-Token",
    },
  });
};
