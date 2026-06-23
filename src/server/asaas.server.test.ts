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

  it("reuses an existing customer before creating another one", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit): Promise<Response> => new Response(
      JSON.stringify({ data: [{ id: "cus_existing", cpfCnpj: "12345678901" }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const asaas = await loadAsaas();
    const result = await asaas.createCustomer({
      name: "Joao Vitor",
      email: "jvitor@example.com",
      cpfCnpj: "12345678901",
      mobilePhone: "27995288081",
      externalReference: "platform-store:store-1",
    });

    expect(result).toMatchObject({ id: "cus_existing" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/customers?");
    expect(init).toMatchObject({ method: "GET" });
  });

  it("reconciles a customer creation conflict by locating the existing customer", async () => {
    let cpfLookups = 0;
    const fetchMock = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      const method = init?.method || "GET";
      if (method === "POST") {
        return new Response(
          JSON.stringify({ errors: [{ description: "Conflict" }] }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }
      if (String(url).includes("cpfCnpj=12345678901")) {
        cpfLookups += 1;
        return new Response(
          JSON.stringify({ data: cpfLookups === 1 ? [] : [{ id: "cus_reconciled" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const asaas = await loadAsaas();
    const result = await asaas.createCustomer({
      name: "Joao Vitor",
      email: "",
      cpfCnpj: "12345678901",
      mobilePhone: "27995288081",
    });

    expect(result).toMatchObject({ id: "cus_reconciled" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/customers"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
