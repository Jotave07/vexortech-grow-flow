import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  query: vi.fn(),
}));

vi.mock("./auth", () => ({ getActor: mocks.getActor }));
vi.mock("./db", () => ({
  query: mocks.query,
  parseBearerToken: (request: Request) => {
    const header = request.headers.get("authorization") || "";
    return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  },
}));

import { createRealtimeStream, publishRealtime } from "./realtime";

const TOKEN = "tracking-token-opaque";
const streamRequest = (options: { filter?: string; publicToken?: string } = {}) => {
  const url = new URL("http://localhost/api/backend");
  url.searchParams.set("stream", "realtime");
  url.searchParams.set("table", "orders");
  url.searchParams.set("event", "UPDATE");
  if (options.filter) url.searchParams.set("filter", options.filter);
  return new Request(url, {
    headers: options.publicToken ? { "X-Realtime-Public-Token": options.publicToken } : undefined,
  });
};

describe("Realtime stream security", () => {
  beforeEach(() => {
    mocks.getActor.mockReset();
    mocks.query.mockReset();
    mocks.getActor.mockResolvedValue(null);
  });

  it("rejects anonymous streams without an authenticated user or public order credential", async () => {
    const response = await createRealtimeStream(streamRequest());
    expect(response.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejects legacy public tokens in the URL", async () => {
    const request = streamRequest({ filter: `public_token=eq.${TOKEN}` });
    const response = await createRealtimeStream(request);
    expect(response.status).toBe(400);
    expect(mocks.getActor).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("validates a header credential before opening a public order stream", async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: "order-1" }] });
    const response = await createRealtimeStream(streamRequest({ publicToken: TOKEN }));
    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith(
      "SELECT id FROM public.orders WHERE public_token = $1::text LIMIT 1",
      [TOKEN],
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
    await response.body?.cancel();
  });

  it("redacts the tracking token and order PII from public events", async () => {
    mocks.query.mockResolvedValue({ rows: [{ id: "order-1" }] });
    const response = await createRealtimeStream(streamRequest({ publicToken: TOKEN }));
    const reader = response.body!.getReader();
    await reader.read(); // ready frame

    publishRealtime({
      schema: "public",
      table: "orders",
      eventType: "UPDATE",
      new: {
        id: "order-1",
        public_token: TOKEN,
        status: "confirmado",
        payment_status: "pago",
        customer_name: "Sensitive Name",
        customer_phone: "5511999999999",
      },
      old: null,
    });

    const event = await reader.read();
    const text = new TextDecoder().decode(event.value);
    expect(text).toContain('"status":"confirmado"');
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("Sensitive Name");
    expect(text).not.toContain("5511999999999");
    await reader.cancel();
  });
});
