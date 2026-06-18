import { afterEach, describe, expect, it, vi } from "vitest";

const loadAsaas = async () => {
  vi.resetModules();
  vi.stubEnv("ASAAS_API_KEY", "test-key");
  vi.stubEnv("ASAAS_ENVIRONMENT", "sandbox");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const module = await import("./asaas.server");
  return module.asaas;
};

const subscriptionPayload = {
  customer: "cus_test",
  billingType: "CREDIT_CARD" as const,
  value: 79.9,
  nextDueDate: "2026-06-18",
  cycle: "MONTHLY" as const,
};

describe("asaas server client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("treats invalid JSON on a 2xx create response as an indeterminate gateway error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>ok</html>", { status: 200, headers: { "content-type": "text/html" } })),
    );

    const asaas = await loadAsaas();
    const result = await asaas.createSubscription(subscriptionPayload);

    expect(result).toEqual({
      status: 200,
      retryable: true,
      errors: [{ description: "Resposta invalida do gateway de pagamento." }],
    });
  });

  it("accepts an empty successful DELETE response when cancelling a subscription", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    const asaas = await loadAsaas();
    const result = await asaas.cancelSubscription("sub_test");

    expect(result).toEqual({ success: true });
  });
});
