import { describe, expect, it } from "vitest";
import { getPlanLimits, getSubscriptionAccessState, normalizePlan } from "./subscription";

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

  it("keeps unknown paid plans within coherent default limits", () => {
    const plan = normalizePlan({
      id: "plan_custom",
      slug: "plano-loja",
      name: "Plano Loja",
      price_monthly: 79,
      allows_coupons: true,
    });

    expect(plan?.limits.products).toBe(120);
    expect(plan?.limits.monthlyOrders).toBe(600);
    expect(plan?.capabilities.coupons).toBe(true);
  });

  it("respects an explicit unlimited product limit from the plan catalog", () => {
    const plan = normalizePlan({
      id: "plan_unlimited",
      slug: "premium",
      name: "Premium",
      price_monthly: 199,
      max_products: null,
    });

    expect(plan?.limits.products).toBeNull();
  });

  it("does not recalculate limits from presets after a plan is already normalized", () => {
    const plan = normalizePlan({
      id: "plan_custom_limit",
      slug: "basico",
      name: "Basico personalizado",
      price_monthly: 5,
      max_products: null,
    });

    expect(getPlanLimits(plan).products).toBeNull();
  });
});
