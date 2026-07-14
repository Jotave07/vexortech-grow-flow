import { afterEach, describe, expect, it, vi } from "vitest";

const abortAwareFetch = () =>
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

const loadGatewayModule = async () => {
  vi.resetModules();
  vi.stubEnv("ASAAS_ENVIRONMENT", "sandbox");
  vi.spyOn(console, "log").mockImplementation(() => {});
  return import("./payment-gateways");
};

describe("payment gateway connection test", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns a safe failure when the gateway test exceeds 15 seconds", async () => {
    vi.useFakeTimers();
    const fetchMock = abortAwareFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { testPixGatewayConnection, PIX_GATEWAY_TEST_TIMEOUT_MS } = await loadGatewayModule();

    const pending = testPixGatewayConnection("asaas", "gateway-secret-value");
    await vi.advanceTimersByTimeAsync(PIX_GATEWAY_TEST_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({
      success: false,
      message: "Tempo esgotado ao testar a conexao com o gateway. Tente novamente.",
    });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal?.aborted).toBe(true);
    expect(JSON.stringify(await pending)).not.toContain("gateway-secret-value");
  });

  it("preserves cancellation requested by an upstream signal", async () => {
    const fetchMock = abortAwareFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { testPixGatewayConnection } = await loadGatewayModule();
    const controller = new AbortController();
    const reason = new Error("caller_cancelled");

    const pending = testPixGatewayConnection("asaas", "gateway-secret-value", {
      signal: controller.signal,
    });
    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });
});
