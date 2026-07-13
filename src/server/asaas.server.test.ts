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
      vi.fn(
        async () =>
          new Response("<html>ok</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      ),
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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );

    const asaas = await loadAsaas();
    const result = await asaas.cancelSubscription("sub_test");

    expect(result).toEqual({ success: true });
  });

  it("treats an already absent subscription as an idempotent cancellation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ errors: [{ description: "not found" }] }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const asaas = await loadAsaas();
    const result = await asaas.cancelSubscription("sub_missing");

    expect(result).toEqual({ success: true, alreadyAbsent: true });
  });

  it("reuses an existing customer before creating another one", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({ data: [{ id: "cus_existing", cpfCnpj: "12345678901" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
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
        return new Response(JSON.stringify({ errors: [{ description: "Conflict" }] }), {
          status: 409,
          headers: { "content-type": "application/json" },
        });
      }
      if (String(url).includes("cpfCnpj=12345678901")) {
        cpfLookups += 1;
        return new Response(
          JSON.stringify({
            data: cpfLookups === 1 ? [] : [{ id: "cus_reconciled", cpfCnpj: "12345678901" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
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

  it("does not create a customer when the identity lookup fails", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ errors: [{ description: "temporary" }] }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const asaas = await loadAsaas();
    const result = await asaas.createCustomer({
      name: "Joao Vitor",
      email: "jvitor@example.com",
      cpfCnpj: "12345678901",
      externalReference: "platform-store:store-1",
    });

    expect(result).toMatchObject({
      retryable: true,
      reconciliationRequired: true,
      errors: [{ description: expect.stringMatching(/reconciliar o cliente/i) }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("does not reuse or create a customer returned with a different document", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(
          JSON.stringify({ data: [{ id: "cus_conflicting", cpfCnpj: "99999999999" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const asaas = await loadAsaas();
    const result = await asaas.createCustomer({
      name: "Joao Vitor",
      email: "jvitor@example.com",
      cpfCnpj: "12345678901",
      externalReference: "platform-store:store-1",
    });

    expect(result).toMatchObject({
      reconciliationRequired: true,
      errors: [{ description: expect.stringMatching(/documento.*reconciliacao/i) }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses an active subscription found by external reference before creating another", async () => {
    const existing = {
      id: "sub_existing",
      customer: "cus_test",
      billingType: "CREDIT_CARD",
      value: 79.9,
      externalReference: "platform-subscription:store-1",
    };
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ data: [existing] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const asaas = await loadAsaas();
    const result = await asaas.createSubscription({
      ...subscriptionPayload,
      externalReference: "platform-subscription:store-1",
    });

    expect(result).toMatchObject({ id: "sub_existing" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("externalReference=platform-subscription%3Astore-1"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("fails closed when reconciliation finds more than one active subscription", async () => {
    const duplicate = (id: string) => ({
      id,
      customer: "cus_test",
      billingType: "CREDIT_CARD",
      value: 79.9,
      externalReference: "platform-subscription:store-1",
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [duplicate("sub_a"), duplicate("sub_b")] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const asaas = await loadAsaas();
    const result = await asaas.createSubscription({
      ...subscriptionPayload,
      externalReference: "platform-subscription:store-1",
    });

    expect(result).toMatchObject({
      reconciliationRequired: true,
      errors: [{ description: "Mais de uma assinatura ativa foi encontrada para esta loja." }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when an active subscription has the same reference but a different contract", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "sub_conflicting",
                customer: "cus_other",
                billingType: "CREDIT_CARD",
                value: 79.9,
                externalReference: "platform-subscription:store-1",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const asaas = await loadAsaas();
    const result = await asaas.createSubscription({
      ...subscriptionPayload,
      externalReference: "platform-subscription:store-1",
    });

    expect(result).toMatchObject({
      reconciliationRequired: true,
      errors: [{ description: expect.stringMatching(/divergente.*reconciliacao/i) }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not create a subscription when the active-subscription lookup fails", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ errors: [{ description: "temporary" }] }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const asaas = await loadAsaas();
    const result = await asaas.createSubscription({
      ...subscriptionPayload,
      externalReference: "platform-subscription:store-1",
    });

    expect(result).toMatchObject({
      status: 503,
      retryable: true,
      reconciliationRequired: true,
      errors: [{ description: expect.stringMatching(/reconciliar assinaturas ativas/i) }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("reconciles an indeterminate subscription create response without issuing a second POST", async () => {
    let lookupCount = 0;
    const reconciled = {
      id: "sub_reconciled",
      customer: "cus_test",
      billingType: "CREDIT_CARD",
      value: 79.9,
      externalReference: "platform-subscription:store-1",
    };
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.method === "POST") {
        return new Response(JSON.stringify({ errors: [{ description: "temporary" }] }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      lookupCount += 1;
      return new Response(JSON.stringify({ data: lookupCount === 1 ? [] : [reconciled] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const asaas = await loadAsaas();
    const result = await asaas.createSubscription(
      {
        ...subscriptionPayload,
        externalReference: "platform-subscription:store-1",
      },
      { idempotencyKey: "ps_test" },
    );

    expect(result).toMatchObject({ id: "sub_reconciled" });
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init.method === "GET")).toHaveLength(2);
  });

  it("rejects an unknown Asaas environment instead of falling back to production", async () => {
    vi.resetModules();
    vi.stubEnv("ASAAS_API_KEY", "test-key");
    vi.stubEnv("ASAAS_ENVIRONMENT", "typo-production");

    await expect(import("./asaas.server")).rejects.toThrow(
      "ASAAS_ENVIRONMENT deve ser sandbox ou production",
    );
  });
});
