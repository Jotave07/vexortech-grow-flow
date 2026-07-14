import { describe, expect, it, vi } from "vitest";
import { issueOrderRealtimeTicket } from "./realtime-ticket";

const storeId = "11111111-1111-4111-8111-111111111111";
const ticketId = "22222222-2222-4222-8222-222222222222";
const actorUserId = "33333333-3333-4333-8333-333333333333";
const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();

const owner = {
  user: { id: actorUserId },
  admin: false,
  roles: new Set(["store_owner"]),
  ownedStoreIds: [storeId],
};

const dependencies = (overrides: Record<string, unknown> = {}) => ({
  query: vi.fn().mockResolvedValue({ rows: [{ ticket_id: ticketId, expires_at: expiresAt }] }),
  getConfig: vi.fn().mockReturnValue({
    url: "https://sjzdvlqnhhgbqdsvwiqt.supabase.co",
    publishableKey: "sb_publishable_test",
  }),
  ...overrides,
});

describe("private order Realtime ticket", () => {
  it("returns only public connection data and the opaque private topic to the store owner", async () => {
    const deps = dependencies();

    const ticket = await issueOrderRealtimeTicket({ storeId }, owner, deps as any);

    expect(ticket).toEqual({
      transport: "supabase-broadcast-v1",
      endpoint: "wss://sjzdvlqnhhgbqdsvwiqt.supabase.co/realtime/v1",
      publishableKey: "sb_publishable_test",
      topic: `hype:store-orders:${ticketId}`,
      event: "orders-invalidated",
      private: true,
      expiresAt,
    });
    expect(ticket).not.toHaveProperty("accessToken");
    expect(ticket).not.toHaveProperty("refreshToken");
    expect(deps.query).toHaveBeenCalledWith(
      expect.stringContaining("hype_private.issue_order_realtime_ticket"),
      [storeId, actorUserId],
    );
  });

  it("rejects a customer or a merchant from another store before reading the capability", async () => {
    const deps = dependencies();
    const customer = {
      user: { id: actorUserId },
      admin: false,
      roles: new Set(["customer"]),
      ownedStoreIds: [],
    };

    await expect(issueOrderRealtimeTicket({ storeId }, customer, deps as any)).rejects.toThrow(
      "fora do escopo",
    );
    expect(deps.query).not.toHaveBeenCalled();
  });

  it("allows a platform admin to request a ticket for a specific store", async () => {
    const deps = dependencies();
    const admin = {
      user: { id: actorUserId },
      admin: true,
      roles: new Set(["admin"]),
      ownedStoreIds: [],
    };

    await expect(issueOrderRealtimeTicket({ storeId }, admin, deps as any)).resolves.toMatchObject({
      topic: `hype:store-orders:${ticketId}`,
      private: true,
      expiresAt,
    });
  });

  it("fails closed when the database returns a malformed or expired ticket", async () => {
    const deps = dependencies({
      query: vi.fn().mockResolvedValue({ rows: [{ ticket_id: null, expires_at: null }] }),
    });

    await expect(issueOrderRealtimeTicket({ storeId }, owner, deps as any)).rejects.toThrow(
      "invalido ou expirado",
    );
  });
});
