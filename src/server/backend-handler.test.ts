import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleAuthAction: vi.fn(),
  invokeFunction: vi.fn(),
  executeQueryPayload: vi.fn(),
  executeRpc: vi.fn(),
  createRealtimeStream: vi.fn(),
  serveStorageFile: vi.fn(),
  uploadStorageFile: vi.fn(),
}));

vi.mock("@/backend/db", () => ({
  parseBearerToken: (request: Request) => {
    const header = request.headers.get("authorization") || "";
    return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  },
}));
vi.mock("@/backend/auth", () => ({ handleAuthAction: mocks.handleAuthAction }));
vi.mock("@/backend/functions", () => ({ invokeFunction: mocks.invokeFunction }));
vi.mock("@/backend/query", () => ({ executeQueryPayload: mocks.executeQueryPayload }));
vi.mock("@/backend/rpc", () => ({ executeRpc: mocks.executeRpc }));
vi.mock("@/backend/realtime", () => ({ createRealtimeStream: mocks.createRealtimeStream }));
vi.mock("@/backend/storage", () => ({
  serveStorageFile: mocks.serveStorageFile,
  uploadStorageFile: mocks.uploadStorageFile,
}));
vi.mock("@/backend/supabase", () => ({
  getSupabaseServerConfig: () => ({ secretKey: "s".repeat(48) }),
}));

import { createBackendHandler } from "./backend-handler";

const appOrigin = "https://hypedelivery.com.br";
let requestSequence = 0;

const post = (body: unknown, headers: HeadersInit = {}) =>
  new Request("https://project.supabase.co/functions/v1/hype-api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: appOrigin,
      "X-Hype-Client-Ip": `test-${++requestSequence}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });

const handler = () =>
  createBackendHandler({
    production: true,
    publicAppUrl: appOrigin,
    allowedOrigins: [appOrigin, "https://parceiros.hypedelivery.com.br"],
  });

const streamingPost = (contentType: string, bytes: number, headers: HeadersInit = {}) => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  const init: RequestInit & { duplex: "half" } = {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      Origin: appOrigin,
      "CF-Connecting-IP": `stream-${++requestSequence}`,
      ...headers,
    },
    body: stream,
    duplex: "half",
  };
  return new Request("https://project.supabase.co/functions/v1/hype-api", init);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shared backend Request/Response handler", () => {
  it("rejects a cross-origin mutation before dispatching application logic", async () => {
    const response = await handler()(
      post(
        { kind: "query", query: { table: "stores", operation: "select" } },
        { Origin: "https://evil.example" },
      ),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Origem da solicitacao invalida." });
    expect(mocks.executeQueryPayload).not.toHaveBeenCalled();
  });

  it("enforces the 1 MiB JSON limit while streaming without Content-Length", async () => {
    const request = streamingPost("application/json", 1024 * 1024 + 1);
    expect(request.headers.has("content-length")).toBe(false);

    const response = await handler()(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Payload muito grande." });
    expect(mocks.invokeFunction).not.toHaveBeenCalled();
  });

  it("enforces the 6 MiB multipart limit while streaming without Content-Length", async () => {
    const request = streamingPost("multipart/form-data; boundary=hype", 6 * 1024 * 1024 + 1);
    expect(request.headers.has("content-length")).toBe(false);

    const response = await handler()(request);

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Payload muito grande." });
    expect(mocks.uploadStorageFile).not.toHaveBeenCalled();
  });

  it("keeps access and refresh tokens only in secure HttpOnly cookies", async () => {
    mocks.handleAuthAction.mockResolvedValue({
      data: {
        user: { id: "user-1", email: "user@example.com" },
        session: {
          access_token: "access-secret",
          refresh_token: "refresh-secret",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: 4_000_000_000,
          user: { id: "user-1", email: "user@example.com" },
        },
      },
      error: null,
    });

    const response = await handler()(
      post({ kind: "auth", action: "signInWithPassword", email: "user@example.com" }),
    );
    const payload = await response.json();
    const cookies = response.headers.get("set-cookie") || "";

    expect(response.status).toBe(200);
    expect(JSON.stringify(payload)).not.toContain("access-secret");
    expect(JSON.stringify(payload)).not.toContain("refresh-secret");
    expect(cookies).toContain("hype_access=access-secret");
    expect(cookies).toContain("hype_refresh=refresh-secret");
    expect(cookies).toContain("HttpOnly");
    expect(cookies).toContain("SameSite=Lax");
    expect(cookies).toContain("Secure");
  });

  it("binds PKCE callback and sealed flow cookie to the allowed application origin", async () => {
    mocks.handleAuthAction.mockImplementation(async (_action, _body, _token, context) => ({
      data: { url: "https://project.supabase.co/auth/v1/authorize", next: `${appOrigin}/lojista` },
      error: null,
      context,
    }));

    const response = await handler()(
      post({ kind: "auth", action: "getOAuthUrl", context: "merchant" }),
    );
    const authContext = mocks.handleAuthAction.mock.calls[0][3];

    expect(authContext.pkce.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authContext.pkce.callbackUrl).toBe(`${appOrigin}/auth/callback`);
    expect(response.headers.get("set-cookie")).toContain("hype_auth_flow=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("rejects an OAuth next URL outside the exact application origin allowlist", async () => {
    const response = await handler()(
      post({
        kind: "auth",
        action: "getOAuthUrl",
        provider: "google",
        redirectTo: "https://evil.example/steal-session",
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_redirect" } });
    expect(mocks.handleAuthAction).not.toHaveBeenCalled();
  });

  it("ignores a spoofed internal client IP on direct Edge requests", async () => {
    mocks.invokeFunction.mockResolvedValue({ data: { ok: true }, error: null });
    const edgeHandler = createBackendHandler({
      production: true,
      edgeRuntime: true,
      publicAppUrl: appOrigin,
      allowedOrigins: [appOrigin],
    });

    const response = await edgeHandler(
      post(
        { kind: "function", name: "lookup-cep", body: { cep: "01310100" } },
        {
          "X-Hype-Client-Ip": "198.51.100.66",
          "CF-Connecting-IP": "203.0.113.24",
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.invokeFunction).toHaveBeenCalledWith("lookup-cep", { cep: "01310100" }, "", {
      remoteIp: "203.0.113.24",
    });
  });

  it("preserves authenticated multipart Storage dispatch", async () => {
    mocks.uploadStorageFile.mockResolvedValue({
      data: { path: "store-1/logo.png", fullPath: "logos/store-1/logo.png" },
      error: null,
    });
    const form = new FormData();
    form.set("kind", "storage");
    form.set("action", "upload");
    form.set("bucket", "logos");
    form.set("path", "store-1/logo.png");
    form.set(
      "file",
      new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }),
      "logo.png",
    );

    const response = await handler()(
      new Request("https://project.supabase.co/functions/v1/hype-api", {
        method: "POST",
        headers: {
          Origin: appOrigin,
          Cookie: "hype_access=access-cookie",
          "X-Hype-Client-Ip": `test-${++requestSequence}`,
        },
        body: form,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.uploadStorageFile).toHaveBeenCalledWith(expect.any(FormData), "access-cookie");
    expect(await response.json()).toMatchObject({ data: { fullPath: "logos/store-1/logo.png" } });
  });

  it("forwards the cookie token as Authorization for the legacy realtime stream", async () => {
    mocks.createRealtimeStream.mockImplementation(async (request: Request) =>
      Response.json({ authorization: request.headers.get("authorization") }),
    );

    const response = await handler()(
      new Request(
        "https://project.supabase.co/functions/v1/hype-api?stream=realtime&table=orders",
        { headers: { Cookie: "hype_access=realtime-token" } },
      ),
    );

    expect(await response.json()).toEqual({ authorization: "Bearer realtime-token" });
  });

  it("serves Supabase Storage objects from the Edge function with cookie authorization", async () => {
    mocks.serveStorageFile.mockImplementation(
      async (_bucket: string, _path: string, request: Request) =>
        Response.json({ authorization: request.headers.get("authorization") }),
    );

    const response = await handler()(
      new Request(
        "https://project.supabase.co/functions/v1/hype-api/storage/documents/store-1%2Fnota.pdf",
        { headers: { Cookie: "hype_access=storage-token" } },
      ),
    );

    expect(mocks.serveStorageFile).toHaveBeenCalledWith(
      "documents",
      "store-1/nota.pdf",
      expect.any(Request),
    );
    expect(await response.json()).toEqual({ authorization: "Bearer storage-token" });
    expect(mocks.createRealtimeStream).not.toHaveBeenCalled();
  });
});
