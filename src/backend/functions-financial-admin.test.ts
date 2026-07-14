import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  adminReleaseTransfer: vi.fn(),
}));

vi.mock("./auth", () => ({
  assertActiveMerchantSubscription: vi.fn(),
  getActor: mocks.getActor,
  signUp: vi.fn(),
}));

vi.mock("@/server/order.lifecycle", () => ({
  markOrderDelivered: vi.fn(),
  cancelOrderByMerchant: vi.fn(),
  adminReleaseTransfer: mocks.adminReleaseTransfer,
  adminRetryTransfer: vi.fn(),
  adminRetryRefund: vi.fn(),
  adminBlockTransfer: vi.fn(),
  adminManualAdjustment: vi.fn(),
  getOrderFinancial: vi.fn(),
  getMerchantStatement: vi.fn(),
  listFinancialOrders: vi.fn(),
  merchantUpdatePixConfig: vi.fn(),
  adminUpdateStoreFinancials: vi.fn(),
}));

import { invokeFunction } from "./functions";

const orderId = "11111111-1111-4111-8111-111111111111";

describe("admin-release-transfer BFF function", () => {
  beforeEach(() => {
    mocks.getActor.mockReset();
    mocks.adminReleaseTransfer.mockReset();
  });

  it("rejects non-admin actors before reaching the financial handler", async () => {
    mocks.getActor.mockResolvedValue({
      user: { id: "22222222-2222-4222-8222-222222222222" },
      admin: false,
      roles: new Set(["store_owner"]),
      ownedStoreIds: [],
    });

    await expect(invokeFunction("admin-release-transfer", { orderId }, "token")).resolves.toEqual({
      data: null,
      error: { message: "Acesso negado." },
    });
    expect(mocks.adminReleaseTransfer).not.toHaveBeenCalled();
  });

  it("routes an authenticated admin through the explicit handler", async () => {
    const actor = {
      user: { id: "33333333-3333-4333-8333-333333333333" },
      admin: true,
      roles: new Set(["admin"]),
      ownedStoreIds: [],
    };
    const outcome = { ok: true, status: "PROCESSANDO" };
    mocks.getActor.mockResolvedValue(actor);
    mocks.adminReleaseTransfer.mockResolvedValue(outcome);

    await expect(invokeFunction("admin-release-transfer", { orderId }, "token")).resolves.toEqual({
      data: outcome,
      error: null,
    });
    expect(mocks.adminReleaseTransfer).toHaveBeenCalledWith({ orderId }, actor);
  });
});
