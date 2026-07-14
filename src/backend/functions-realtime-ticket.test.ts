import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  assertActiveMerchantSubscription: vi.fn(),
  issueOrderRealtimeTicket: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("./auth", () => ({
  getActor: mocks.getActor,
  assertActiveMerchantSubscription: mocks.assertActiveMerchantSubscription,
  signUp: mocks.signUp,
}));

vi.mock("./realtime-ticket", () => ({
  issueOrderRealtimeTicket: mocks.issueOrderRealtimeTicket,
}));

import { invokeFunction } from "./functions";

const storeId = "11111111-1111-4111-8111-111111111111";

describe("get-realtime-ticket BFF function", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  it("validates the HttpOnly-cookie actor and subscription before issuing a ticket", async () => {
    const actor = {
      user: { id: "22222222-2222-4222-8222-222222222222" },
      admin: false,
      roles: new Set(["store_owner"]),
      ownedStoreIds: [storeId],
    };
    const ticket = {
      topic: "hype:store-orders:opaque",
      private: true,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    };
    mocks.getActor.mockResolvedValue(actor);
    mocks.assertActiveMerchantSubscription.mockResolvedValue(undefined);
    mocks.issueOrderRealtimeTicket.mockResolvedValue(ticket);

    await expect(
      invokeFunction("get-realtime-ticket", { storeId }, "server-side-cookie-access-token"),
    ).resolves.toEqual({ data: ticket, error: null });
    expect(mocks.getActor).toHaveBeenCalledWith("server-side-cookie-access-token");
    expect(mocks.assertActiveMerchantSubscription).toHaveBeenCalledWith(actor, storeId);
    expect(mocks.issueOrderRealtimeTicket).toHaveBeenCalledWith({ storeId }, actor);
  });

  it("fails closed before issuing a private ticket when merchant access is rejected", async () => {
    const actor = {
      user: { id: "22222222-2222-4222-8222-222222222222" },
      admin: false,
      roles: new Set(["customer"]),
      ownedStoreIds: [],
    };
    mocks.getActor.mockResolvedValue(actor);
    mocks.assertActiveMerchantSubscription.mockRejectedValue(new Error("Assinatura inativa."));

    await expect(invokeFunction("get-realtime-ticket", { storeId }, "token")).resolves.toEqual({
      data: null,
      error: { message: "Assinatura inativa." },
    });
    expect(mocks.issueOrderRealtimeTicket).not.toHaveBeenCalled();
  });
});
