import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stop: vi.fn(),
  subscribePrivateOrderBroadcast: vi.fn(),
}));

vi.mock("./realtime.js", () => ({
  subscribePrivateOrderBroadcast: mocks.subscribePrivateOrderBroadcast,
}));

import { api } from "./api.js";

const ticket = {
  transport: "supabase-broadcast-v1",
  endpoint: "wss://sjzdvlqnhhgbqdsvwiqt.supabase.co/realtime/v1",
  publishableKey: "sb_publishable_test",
  topic: "hype:store-orders:22222222-2222-4222-8222-222222222222",
  event: "orders-invalidated",
  private: true,
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
};

describe("api.stream private order transport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mocks.stop.mockReset();
    mocks.subscribePrivateOrderBroadcast.mockReset();
  });

  it("obtains a ticket through the cookie-authenticated BFF before opening Broadcast", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: ticket, error: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mocks.subscribePrivateOrderBroadcast.mockReturnValue(mocks.stop);
    const onMessage = vi.fn();

    const stop = api.stream({
      table: "orders",
      event: "*",
      filter: "store_id=eq.11111111-1111-4111-8111-111111111111",
      onMessage,
    });

    await vi.waitFor(() => expect(mocks.subscribePrivateOrderBroadcast).toHaveBeenCalledTimes(1));
    const [, requestInit] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe("/api/backend");
    expect(requestInit.credentials).toBe("same-origin");
    expect(JSON.parse(requestInit.body)).toEqual({
      kind: "function",
      name: "get-realtime-ticket",
      body: { storeId: "11111111-1111-4111-8111-111111111111" },
    });
    expect(requestInit.headers).not.toHaveProperty("Authorization");
    expect(mocks.subscribePrivateOrderBroadcast).toHaveBeenCalledWith({
      ticket,
      onMessage,
      onStatus: undefined,
    });

    stop();
    expect(mocks.stop).toHaveBeenCalledTimes(1);
  });

  it("reports ticket failure so the portal can continue with polling", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ data: null, error: { message: "Realtime indisponivel." } }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        ),
    );
    const onStatus = vi.fn();

    api.stream({
      table: "orders",
      filter: "store_id=eq.11111111-1111-4111-8111-111111111111",
      onStatus,
    });

    await vi.waitFor(() => expect(onStatus).toHaveBeenCalledWith("error", expect.any(Error)));
    expect(mocks.subscribePrivateOrderBroadcast).not.toHaveBeenCalled();
  });
});
