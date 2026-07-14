import { describe, expect, it, vi } from "vitest";
import { isPrivateOrderRealtimeTicket, subscribePrivateOrderBroadcast } from "./realtime.js";

const ticket = {
  transport: "supabase-broadcast-v1",
  endpoint: "wss://sjzdvlqnhhgbqdsvwiqt.supabase.co/realtime/v1",
  publishableKey: "sb_publishable_test",
  topic: "hype:store-orders:22222222-2222-4222-8222-222222222222",
  event: "orders-invalidated",
  private: true,
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
};

const fakeRealtime = () => {
  const state = {};
  const channel = {
    on: vi.fn((type, filter, callback) => {
      state.type = type;
      state.filter = filter;
      state.message = callback;
      return channel;
    }),
    subscribe: vi.fn((callback) => {
      state.status = callback;
      return channel;
    }),
  };
  class Client {
    constructor(endpoint, options) {
      state.endpoint = endpoint;
      state.options = options;
      state.client = this;
    }
    channel(topic, options) {
      state.topic = topic;
      state.channelOptions = options;
      return channel;
    }
    removeChannel = vi.fn().mockResolvedValue("ok");
    disconnect = vi.fn().mockResolvedValue(undefined);
  }
  return { Client, channel, state };
};

describe("Supabase private order Broadcast client", () => {
  it("joins as anon using only the publishable API key and no session JWT", () => {
    const fake = fakeRealtime();
    const onStatus = vi.fn();

    const stop = subscribePrivateOrderBroadcast({ ticket, onStatus }, fake.Client);
    fake.state.status("SUBSCRIBED");

    expect(fake.state.endpoint).toBe(ticket.endpoint);
    expect(fake.state.options).toEqual({ params: { apikey: ticket.publishableKey } });
    expect(fake.state.options).not.toHaveProperty("accessToken");
    expect(fake.state.channelOptions).toEqual({
      config: { private: true, broadcast: { ack: false, self: false } },
    });
    expect(fake.state.type).toBe("broadcast");
    expect(fake.state.filter).toEqual({ event: "orders-invalidated" });
    expect(onStatus).toHaveBeenCalledWith("connected");
    stop();
  });

  it("turns every server event into a data-free invalidation marker", () => {
    const fake = fakeRealtime();
    const onMessage = vi.fn();
    const stop = subscribePrivateOrderBroadcast({ ticket, onMessage }, fake.Client);

    fake.state.message({
      payload: {
        table: "orders",
        customer_name: "must never reach the UI event",
        total: 999,
      },
    });

    expect(onMessage).toHaveBeenCalledWith({
      schema: "public",
      table: "orders",
      eventType: "UPDATE",
      new: null,
      old: null,
      invalidated: true,
    });
    expect(JSON.stringify(onMessage.mock.calls)).not.toContain("customer_name");
    stop();
  });

  it("rejects public, malformed or non-WebSocket tickets", () => {
    expect(isPrivateOrderRealtimeTicket(ticket)).toBe(true);
    expect(isPrivateOrderRealtimeTicket({ ...ticket, private: false })).toBe(false);
    expect(
      isPrivateOrderRealtimeTicket({ ...ticket, endpoint: "https://evil.example/realtime/v1" }),
    ).toBe(false);
    expect(
      isPrivateOrderRealtimeTicket({
        ...ticket,
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    ).toBe(false);
    expect(() =>
      subscribePrivateOrderBroadcast({ ticket: { ...ticket, topic: "hype:store-orders:guess" } }),
    ).toThrow("invalido");
  });

  it("requests a reconnect before the short-lived ticket expires", () => {
    vi.useFakeTimers();
    try {
      const fake = fakeRealtime();
      const onStatus = vi.fn();
      const expiringTicket = {
        ...ticket,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      };
      const stop = subscribePrivateOrderBroadcast(
        { ticket: expiringTicket, onStatus },
        fake.Client,
      );

      vi.advanceTimersByTime(9 * 60_000 - 1);
      expect(onStatus).not.toHaveBeenCalledWith("ticket-expiring");
      vi.advanceTimersByTime(1);
      expect(onStatus).toHaveBeenCalledWith("ticket-expiring");
      stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes the channel and disconnects during page cleanup", async () => {
    const fake = fakeRealtime();
    const stop = subscribePrivateOrderBroadcast({ ticket }, fake.Client);

    stop();
    stop();

    expect(fake.state.client.removeChannel).toHaveBeenCalledTimes(1);
    expect(fake.state.client.removeChannel).toHaveBeenCalledWith(fake.channel);
    await vi.waitFor(() => expect(fake.state.client.disconnect).toHaveBeenCalledTimes(1));
  });
});
