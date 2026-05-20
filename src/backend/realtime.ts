import { randomUUID } from "node:crypto";

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

export const createRealtimeStream = () => {
  const encoder = new TextEncoder();
  const id = randomUUID();
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const client: Client = {
        id,
        send(payload) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
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
