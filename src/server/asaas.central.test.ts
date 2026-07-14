import { afterEach, describe, expect, it, vi } from "vitest";

const stalledFetch = () =>
  vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) return;
        const rejectAbort = () =>
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        if (signal.aborted) rejectAbort();
        else signal.addEventListener("abort", rejectAbort, { once: true });
      }),
  );

describe("Asaas central HTTP boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("aborts a stalled financial request after 25 seconds and marks it retryable", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ASAAS_API_KEY", "central-secret-value");
    vi.stubEnv("ASAAS_ENVIRONMENT", "sandbox");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = stalledFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { asaasCentral, ASAAS_CENTRAL_REQUEST_TIMEOUT_MS } = await import("./asaas.central");
    const pending = asaasCentral.createPixPayment(
      {
        customer: "cus_test",
        value: 42,
        dueDate: "2026-07-14",
        externalReference: "order_test",
      },
      { idempotencyKey: "order:order_test:pix:central" },
    );

    await vi.advanceTimersByTimeAsync(ASAAS_CENTRAL_REQUEST_TIMEOUT_MS);

    await expect(pending).resolves.toMatchObject({
      timeout: true,
      retryable: true,
      ambiguous: true,
      reconciliationRequired: true,
      failureKind: "timeout",
      errors: [{ description: "Tempo esgotado na comunicacao com o gateway de pagamento." }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("central-secret-value");
  });

  it.each([408, 425, 429, 500, 503])(
    "classifies HTTP %s as ambiguous without persisting the provider payload",
    async (status) => {
      vi.stubEnv("ASAAS_API_KEY", "central-secret-value");
      vi.stubEnv("ASAAS_ENVIRONMENT", "sandbox");
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({ errors: [{ description: "provider-sensitive-detail" }] }),
              {
                status,
                headers: { "content-type": "application/json" },
              },
            ),
        ),
      );

      const { asaasCentral } = await import("./asaas.central");
      const result = await asaasCentral.createPixTransfer(
        {
          value: 10,
          pixAddressKey: "11999999999",
          pixAddressKeyType: "PHONE",
          externalReference: "TRANSFER_ORDER_order_test",
        },
        { idempotencyKey: "REPASSE_ORDER_order_test" },
      );

      expect(result).toMatchObject({
        status,
        retryable: true,
        ambiguous: true,
        reconciliationRequired: true,
        failureKind: "http_retryable",
      });
      expect(JSON.stringify(result)).not.toContain("provider-sensitive-detail");
    },
  );

  it.each([200, 400])(
    "classifies invalid JSON on HTTP %s as ambiguous before HTTP status handling",
    async (status) => {
      vi.stubEnv("ASAAS_API_KEY", "central-secret-value");
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response("provider-sensitive-invalid-body", {
              status,
              headers: { "content-type": "application/json" },
            }),
        ),
      );

      const { asaasCentral } = await import("./asaas.central");
      const result = await asaasCentral.createPixTransfer(
        { value: 10, pixAddressKey: "11999999999", pixAddressKeyType: "PHONE" },
        { idempotencyKey: "REPASSE_ORDER_order_test" },
      );

      expect(result).toMatchObject({
        status,
        retryable: true,
        ambiguous: true,
        reconciliationRequired: true,
        failureKind: "invalid_response",
      });
      expect(JSON.stringify(result)).not.toContain("provider-sensitive-invalid-body");
    },
  );

  it.each([
    ["transfer DONE", { status: "DONE" }],
    ["refund REFUNDED", { status: "REFUNDED" }],
    ["empty object", {}],
  ])("classifies successful POST without id as ambiguous: %s", async (_label, payload) => {
    vi.stubEnv("ASAAS_API_KEY", "central-secret-value");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const { asaasCentral } = await import("./asaas.central");
    const result = await asaasCentral.refundPayment("payment_test", 10, "refund", {
      idempotencyKey: "REEMBOLSO_ORDER_order_test",
    });

    expect(result).toMatchObject({
      status: 200,
      retryable: true,
      ambiguous: true,
      reconciliationRequired: true,
      failureKind: "invalid_response",
    });
  });

  it("classifies network failures as ambiguous without exposing error details", async () => {
    vi.stubEnv("ASAAS_API_KEY", "central-secret-value");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new Error("network-sensitive-detail"))),
    );

    const { asaasCentral } = await import("./asaas.central");
    const result = await asaasCentral.refundPayment("payment_test", 10, "refund", {
      idempotencyKey: "REEMBOLSO_ORDER_order_test",
    });

    expect(result).toMatchObject({
      retryable: true,
      ambiguous: true,
      reconciliationRequired: true,
      failureKind: "network",
    });
    expect(JSON.stringify(result)).not.toContain("network-sensitive-detail");
  });

  it("keeps a definitive HTTP 400 eligible for the controlled failure path", async () => {
    vi.stubEnv("ASAAS_API_KEY", "central-secret-value");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ errors: [{ description: "Chave PIX invalida" }] }), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const { asaasCentral } = await import("./asaas.central");
    const result = await asaasCentral.createPixTransfer(
      {
        value: 10,
        pixAddressKey: "invalid",
        pixAddressKeyType: "EVP",
      },
      { idempotencyKey: "REPASSE_ORDER_order_test" },
    );

    expect(result).toMatchObject({
      status: 400,
      retryable: false,
      ambiguous: false,
      reconciliationRequired: false,
      errors: [{ description: "Chave PIX invalida" }],
    });
  });

  it("classifies caller cancellation as ambiguous", async () => {
    vi.stubEnv("ASAAS_API_KEY", "central-secret-value");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", stalledFetch());
    const controller = new AbortController();

    const { asaasCentral } = await import("./asaas.central");
    const pending = asaasCentral.createPixTransfer(
      {
        value: 10,
        pixAddressKey: "11999999999",
        pixAddressKeyType: "PHONE",
      },
      { idempotencyKey: "REPASSE_ORDER_order_test", signal: controller.signal },
    );
    controller.abort(new Error("caller_cancelled"));

    await expect(pending).resolves.toMatchObject({
      cancelled: true,
      retryable: true,
      ambiguous: true,
      reconciliationRequired: true,
      failureKind: "cancelled",
    });
  });
});
