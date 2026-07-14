import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, setSessionExpiredHandler, setTokenProvider } from "./api.js";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("vanilla API session recovery", () => {
  beforeEach(() => {
    setTokenProvider(() => null);
    setSessionExpiredHandler(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renews the HttpOnly cookie and retries once after an unauthorized envelope", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: null, error: { message: "Nao autorizado." } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { session: { expires_in: 3600, user: { id: "merchant-1" } } },
          error: null,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: "subscription-1" }], error: null }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.from("subscriptions").select("id")).resolves.toEqual({
      data: [{ id: "subscription-1" }],
      error: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      kind: "query",
      query: { table: "subscriptions", operation: "select" },
    });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      kind: "auth",
      action: "refreshSession",
    });
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({
      kind: "query",
      query: { table: "subscriptions", operation: "select" },
    });
  });

  it("clears the client identity when cookie renewal also fails", async () => {
    const expired = vi.fn();
    setSessionExpiredHandler(expired);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ data: null, error: { message: "Não autorizado." } }))
        .mockResolvedValueOnce(
          jsonResponse({
            data: null,
            error: { message: "Sessão expirada.", code: "invalid_token" },
          }),
        ),
    );

    const result = await api.from("subscriptions").select("id");

    expect(result.error?.message).toBe("Não autorizado.");
    expect(expired).toHaveBeenCalledTimes(1);
  });
});
