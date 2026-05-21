import { describe, expect, it } from "vitest";
import { getSubscriptionAccessState } from "./subscription";

const activePlan = {
  id: "plan_1",
  slug: "profissional",
  name: "Profissional",
  price_monthly: 99,
};

describe("subscription access state", () => {
  it("blocks suspended stores even when they have a plan", () => {
    expect(
      getSubscriptionAccessState({
        subscription: { status: "ativa", last_payment_status: "paid" },
        plan: activePlan,
        storeSuspended: true,
      }),
    ).toBe("blocked");
  });

  it("allows platform admins and exempt profiles", () => {
    expect(getSubscriptionAccessState({ subscription: null, plan: null, isPlatformAdmin: true })).toBe(
      "active",
    );
    expect(getSubscriptionAccessState({ subscription: null, plan: null, isExempt: true })).toBe("active");
  });

  it("maps payment states to merchant access states", () => {
    expect(getSubscriptionAccessState({ subscription: null, plan: null })).toBe("no_plan");
    expect(
      getSubscriptionAccessState({
        subscription: { status: "pendente_pagamento", last_payment_status: null },
        plan: activePlan,
      }),
    ).toBe("pending_payment");
    expect(
      getSubscriptionAccessState({
        subscription: { status: "inadimplente", last_payment_status: "failed" },
        plan: activePlan,
      }),
    ).toBe("past_due");
  });
});
