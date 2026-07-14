import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/backend/db", () => ({ query: mocks.query }));
vi.mock("@/integrations/backend/client.server", () => ({
  backendAdmin: { from: mocks.from },
}));

const stalledResponse = (signal?: AbortSignal | null) =>
  new Promise<Response>((_resolve, reject) => {
    if (!signal) return;
    const rejectAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal.aborted) rejectAbort();
    else signal.addEventListener("abort", rejectAbort, { once: true });
  });

const configureNotificationPersistence = () => {
  mocks.from.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: {
            id: "store_test",
            name: "Loja Teste",
            public_name: "Loja Teste",
            slug: "loja-teste",
            whatsapp: "27999999999",
          },
        }),
      }),
    }),
  });
  mocks.query.mockImplementation(async (sql: string) =>
    sql.includes("INSERT INTO public.notification_events")
      ? { rows: [{ id: "event_test" }] }
      : { rows: [] },
  );
};

describe("Evolution HTTP boundary", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
    mocks.query.mockReset();
    mocks.from.mockReset();
  });

  it("aborts a stalled message send and persists a normalized timeout", async () => {
    vi.useFakeTimers();
    vi.stubEnv("EVOLUTION_API_URL", "https://evolution.invalid");
    vi.stubEnv("EVOLUTION_API_KEY", "evolution-secret-value");
    vi.stubEnv("EVOLUTION_INSTANCE", "main");
    configureNotificationPersistence();

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/instance/fetchInstances")) {
        return Promise.resolve(
          new Response(JSON.stringify([{ name: "main", connectionStatus: "open" }]), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return stalledResponse(init?.signal);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { notifyStoreCreatedHandler, EVOLUTION_REQUEST_TIMEOUT_MS } =
      await import("./evolution.server");
    const pending = notifyStoreCreatedHandler("store_test");

    for (let index = 0; index < 10 && fetchMock.mock.calls.length < 2; index += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(EVOLUTION_REQUEST_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({ sent: false, reason: "timeout" });
    expect(mocks.query).toHaveBeenLastCalledWith(
      expect.stringContaining("UPDATE public.notification_events"),
      ["event_test", "failed", "timeout"],
    );
    expect(JSON.stringify(await pending)).not.toContain("evolution-secret-value");
  });

  it("normalizes an instance discovery timeout without attempting a message send", async () => {
    vi.useFakeTimers();
    vi.stubEnv("EVOLUTION_API_URL", "https://evolution.invalid");
    vi.stubEnv("EVOLUTION_API_KEY", "evolution-secret-value");
    vi.stubEnv("EVOLUTION_INSTANCE", "main");
    configureNotificationPersistence();

    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      stalledResponse(init?.signal),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { notifyStoreCreatedHandler, EVOLUTION_REQUEST_TIMEOUT_MS } =
      await import("./evolution.server");
    const pending = notifyStoreCreatedHandler("store_test");

    for (let index = 0; index < 10 && fetchMock.mock.calls.length < 1; index += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    await vi.advanceTimersByTimeAsync(EVOLUTION_REQUEST_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({ sent: false, reason: "timeout" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.query).toHaveBeenLastCalledWith(
      expect.stringContaining("UPDATE public.notification_events"),
      ["event_test", "failed", "timeout"],
    );
  });
});
