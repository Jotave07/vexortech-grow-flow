import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBearerToken, query, queryWithStatementTimeout } from "@/backend/db";
import { handleAuthAction } from "@/backend/auth";
import { invokeFunction } from "@/backend/functions";
import { executeQueryPayload } from "@/backend/query";
import { executeRpc } from "@/backend/rpc";
import { createRealtimeStream } from "@/backend/realtime";
import { serveStorageFile, uploadStorageFile } from "@/backend/storage";
import { handleAsaasWebhook } from "@/backend/webhooks";
import { validateRuntimeEnv } from "@/backend/env";
import {
  createCachedHealthEvaluator,
  evaluateHealth,
  HEALTH_QUERY_TIMEOUT_MS,
  isHealthRequestMethodAllowed,
} from "./health";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(process.env.CLIENT_DIR || path.join(serverDir, "../../dist"));
const port = Number(process.env.PORT || 3000);
const production = process.env.NODE_ENV === "production";
const listenHost = process.env.HOST || (production ? "127.0.0.1" : "0.0.0.0");
const jsonLimit = 1024 * 1024;
const uploadLimit = 6 * 1024 * 1024;
const accessCookieName = "hype_access";
const refreshCookieName = "hype_refresh";
const oauthFlowCookieName = "hype_auth_flow";

const securityHeaders: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
  ].join("; "),
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(self), payment=(self)",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
};

type Bucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, Bucket>();
const takeRateLimit = (key: string, maximum: number, windowMs = 60_000) => {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (!bucket && rateBuckets.size >= 20_000) {
      const oldest = rateBuckets.keys().next().value;
      if (oldest) rateBuckets.delete(oldest);
    }
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= maximum;
};

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
}, 60_000).unref();

const remoteIp = (request: Request) => request.headers.get("x-hype-client-ip") || "unknown";

const normalizedIp = (value?: string | null) =>
  String(value || "unknown")
    .replace(/^::ffff:/, "")
    .trim();
const trustedProxyIps = new Set([
  "127.0.0.1",
  "::1",
  ...(process.env.TRUSTED_PROXY_IPS || "")
    .split(",")
    .map((value) => normalizedIp(value))
    .filter(Boolean),
]);

const requestIp = (incoming: IncomingMessage) => {
  const peer = normalizedIp(incoming.socket.remoteAddress);
  if (!trustedProxyIps.has(peer)) return peer;
  // Nginx overwrites X-Real-IP with $remote_addr. Never use the client-controlled
  // first X-Forwarded-For entry for security decisions.
  return normalizedIp(
    String(incoming.headers["x-real-ip"] || peer)
      .split(",")
      .at(-1),
  );
};

const cookieValue = (request: Request, name: string) => {
  const cookies = request.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
};

const authToken = (request: Request) =>
  parseBearerToken(request) || cookieValue(request, accessCookieName);
const cookie = (name: string, value: string, maxAge: number) =>
  [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    production ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");

type AuthFlow = {
  verifier: string;
  challenge: string;
  callbackUrl: string;
  next: string;
  context: "customer" | "merchant" | "merchant_signup" | "recovery" | "signup";
  createdAt: number;
};

const authFlowSecret = () => {
  const value =
    process.env.AUTH_FLOW_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "";
  if (value.length < 32)
    throw new Error(
      "AUTH_FLOW_SECRET ou uma chave secreta Supabase forte e obrigatoria para PKCE.",
    );
  return value;
};

const createAuthFlow = (request: Request, context: AuthFlow["context"], next: string): AuthFlow => {
  const verifier = crypto.randomBytes(48).toString("base64url");
  return {
    verifier,
    challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
    callbackUrl: new URL("/auth/callback", request.url).toString(),
    next,
    context,
    createdAt: Date.now(),
  };
};

const sealAuthFlow = (flow: AuthFlow) => {
  const payload = Buffer.from(JSON.stringify(flow)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", authFlowSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
};

const openAuthFlow = (request: Request): AuthFlow | null => {
  const sealed = cookieValue(request, oauthFlowCookieName);
  const [payload, signature] = sealed.split(".");
  if (!payload || !signature) return null;
  const expected = crypto.createHmac("sha256", authFlowSecret()).update(payload).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected))
    return null;
  try {
    const flow = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthFlow;
    if (
      !flow.verifier ||
      !flow.challenge ||
      !flow.callbackUrl ||
      Date.now() - Number(flow.createdAt) > 24 * 60 * 60 * 1_000
    )
      return null;
    return flow;
  } catch {
    return null;
  }
};

const clearAuthCookies = (response: Response) => {
  response.headers.append("Set-Cookie", cookie(accessCookieName, "", 0));
  response.headers.append("Set-Cookie", cookie(refreshCookieName, "", 0));
};

const clearAuthFlowCookie = (response: Response) => {
  response.headers.append("Set-Cookie", cookie(oauthFlowCookieName, "", 0));
};

const appendSessionCookies = (response: Response, session: any) => {
  response.headers.append(
    "Set-Cookie",
    cookie(accessCookieName, session.access_token, Number(session.expires_in || 3600)),
  );
  if (session.refresh_token) {
    response.headers.append(
      "Set-Cookie",
      cookie(refreshCookieName, session.refresh_token, 60 * 60 * 24 * 30),
    );
  }
};

const authorizeCookieRequest = (request: Request) => {
  const token = authToken(request);
  if (!token || request.headers.has("authorization")) return request;
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return new Request(request, { headers });
};

const hasValidOrigin = (request: Request) => {
  const origin = request.headers.get("origin");
  if (!origin) return !production || request.headers.has("authorization");
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
};

const readBody = async (incoming: IncomingMessage, maximum: number) => {
  const declared = Number(incoming.headers["content-length"] || 0);
  if (declared > maximum) throw Object.assign(new Error("Payload muito grande."), { status: 413 });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximum) throw Object.assign(new Error("Payload muito grande."), { status: 413 });
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
};

const toRequest = async (incoming: IncomingMessage, signal: AbortSignal) => {
  const protocol = String(
    incoming.headers["x-forwarded-proto"] || (production ? "https" : "http"),
  ).split(",")[0];
  const host = incoming.headers.host || "localhost";
  const contentType = String(incoming.headers["content-type"] || "");
  const maximum = contentType.includes("multipart/form-data") ? uploadLimit : jsonLimit;
  const body = ["GET", "HEAD"].includes(incoming.method || "GET")
    ? undefined
    : await readBody(incoming, maximum);
  const headers = new Headers(incoming.headers as HeadersInit);
  headers.set("x-hype-client-ip", requestIp(incoming));
  return new Request(`${protocol}://${host}${incoming.url || "/"}`, {
    method: incoming.method,
    headers,
    body,
    signal,
  });
};

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const AUTH_ACTIONS = new Set([
  "signUp",
  "signUpMerchant",
  "signInWithPassword",
  "refreshSession",
  "signOut",
  "getOAuthUrl",
  "exchangeOAuthCode",
  "sessionFromToken",
  "updateUser",
  "resetPasswordForEmail",
  "getClaims",
]);

const authActionLimit = (action: string) => {
  if (["sessionFromToken", "getClaims", "refreshSession"].includes(action)) return 120;
  if (["signOut", "updateUser", "exchangeOAuthCode"].includes(action)) return 30;
  return 12;
};

const publicAuthResult = (result: any, session: any, extras: Record<string, unknown> = {}) => {
  if (!session?.access_token)
    return extras && Object.keys(extras).length
      ? { ...result, data: { ...(result?.data || {}), ...extras } }
      : result;
  const safeSession = {
    token_type: "bearer",
    expires_at: session.expires_at,
    expires_in: session.expires_in,
    user: session.user,
  };
  const originalData = result?.data || {};
  const {
    session: _privateSession,
    access_token: _access,
    refresh_token: _refresh,
    ...safeData
  } = originalData;
  return { ...result, data: { ...safeData, session: safeSession, user: session.user, ...extras } };
};

const backendHandler = async (request: Request) => {
  if (request.method === "GET") return createRealtimeStream(authorizeCookieRequest(request));
  if (request.method !== "POST") return json({ error: "Metodo nao permitido." }, 405);
  if (!hasValidOrigin(request)) return json({ error: "Origem da solicitacao invalida." }, 403);
  const ip = remoteIp(request);
  if (!takeRateLimit(`api:${ip}`, 120))
    return json({ error: "Muitas solicitacoes. Aguarde um instante." }, 429);
  let token = authToken(request);
  let rotatedSession: any = null;
  const refreshToken = cookieValue(request, refreshCookieName);
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    if (
      String(form.get("kind") || "") !== "storage" ||
      String(form.get("action") || "") !== "upload"
    ) {
      return json({ error: "Acao multipart desconhecida." }, 400);
    }
    if (!token && refreshToken) {
      const refreshed: any = await handleAuthAction("refreshSession", { refreshToken });
      rotatedSession = refreshed?.data?.session || null;
      token = rotatedSession?.access_token || "";
    }
    const response = json(await uploadStorageFile(form, token));
    if (rotatedSession) appendSessionCookies(response, rotatedSession);
    return response;
  }

  const body: any = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "JSON invalido." }, 400);
  const kind = String(body.kind || "");

  if (kind === "auth") {
    const action = String(body.action || "");
    if (!AUTH_ACTIONS.has(action))
      return json({ error: "Acao de autenticacao desconhecida." }, 400);
    const identityKey = crypto
      .createHash("sha256")
      .update(
        String(body.email || "")
          .trim()
          .toLowerCase(),
      )
      .digest("hex")
      .slice(0, 16);
    if (!takeRateLimit(`auth:${ip}:${action}:${identityKey}`, authActionLimit(action))) {
      return json({ error: "Muitas tentativas. Aguarde antes de tentar novamente." }, 429);
    }

    let flow: AuthFlow | null = null;
    if (["getOAuthUrl", "resetPasswordForEmail", "signUp", "signUpMerchant"].includes(action)) {
      const requestedContext = String(body.context || "");
      const context: AuthFlow["context"] =
        action === "resetPasswordForEmail"
          ? "recovery"
          : action === "signUpMerchant"
            ? "merchant_signup"
            : action === "signUp"
              ? "signup"
              : requestedContext === "merchant" || requestedContext === "merchant_signup"
                ? requestedContext
                : "customer";
      const defaultNext =
        context === "recovery"
          ? "/redefinir-senha"
          : context === "merchant"
            ? "/lojista"
            : context === "merchant_signup"
              ? "/onboarding"
              : "/";
      const requestedNext =
        action === "getOAuthUrl" && body.redirectTo
          ? String(body.redirectTo)
          : new URL(defaultNext, request.url).toString();
      flow = createAuthFlow(request, context, requestedNext);
    } else if (action === "exchangeOAuthCode") {
      flow = openAuthFlow(request);
      if (!flow)
        return json(
          {
            data: null,
            error: {
              message: "Fluxo de autenticacao ausente ou expirado.",
              code: "invalid_pkce_flow",
            },
          },
          400,
        );
    }

    if (action === "refreshSession" && !body.refreshToken) body.refreshToken = refreshToken;
    const pkce = flow
      ? {
          codeChallenge: flow.challenge,
          codeVerifier: action === "exchangeOAuthCode" ? flow.verifier : undefined,
          callbackUrl: flow.callbackUrl,
        }
      : undefined;
    const intentRole =
      flow && ["merchant", "merchant_signup"].includes(flow.context) ? "store_owner" : "customer";
    let result: any = await handleAuthAction(action, body, token, { pkce, intentRole });
    if (action === "sessionFromToken" && result?.error && refreshToken) {
      result = await handleAuthAction("refreshSession", { refreshToken });
    }

    const session = result?.data?.session || (result?.data?.access_token ? result.data : null);
    const extras =
      action === "exchangeOAuthCode" && flow
        ? { oauth_context: flow.context, next: flow.next }
        : {};
    result = publicAuthResult(result, session, extras);
    const response = json(result, result?.error?.code === "invalid_pkce_flow" ? 400 : 200);
    if (session?.access_token)
      appendSessionCookies(response, {
        ...session,
        refresh_token: session.refresh_token || body.refreshToken || refreshToken,
      });

    if (flow && result?.data?.next) flow.next = String(result.data.next);
    const keepFlow =
      flow &&
      !result?.error &&
      (action === "getOAuthUrl" ||
        action === "resetPasswordForEmail" ||
        ((action === "signUp" || action === "signUpMerchant") && !session?.access_token));
    if (keepFlow && flow)
      response.headers.append(
        "Set-Cookie",
        cookie(oauthFlowCookieName, sealAuthFlow(flow), 24 * 60 * 60),
      );
    if (action === "exchangeOAuthCode" || (flow && !keepFlow)) clearAuthFlowCookie(response);
    if (action === "signOut" || (action === "refreshSession" && result?.error))
      clearAuthCookies(response);
    return response;
  }

  if (!token && refreshToken) {
    const refreshed: any = await handleAuthAction("refreshSession", { refreshToken });
    rotatedSession = refreshed?.data?.session || null;
    token = rotatedSession?.access_token || "";
  }

  let response: Response;
  if (kind === "query") response = json(await executeQueryPayload(body.query, { token }));
  else if (kind === "rpc")
    response = json(await executeRpc(String(body.name || ""), body.args || {}, { token }));
  else if (kind === "function") {
    const name = String(body.name || "");
    const operationLimit =
      name === "create-checkout-order"
        ? 12
        : name === "quote-delivery"
          ? 30
          : name === "reverse-geocode"
            ? 20
            : name === "lookup-cep"
              ? 40
              : 90;
    if (!takeRateLimit(`function:${ip}:${name}`, operationLimit))
      return json({ error: "Muitas solicitacoes para esta operacao." }, 429);
    response = json(await invokeFunction(name, body.body || {}, token, { remoteIp: ip }));
  } else response = json({ error: "Acao desconhecida." }, 400);
  if (rotatedSession) appendSessionCookies(response, rotatedSession);
  return response;
};

const loadHealthReport = createCachedHealthEvaluator(() =>
  evaluateHealth({
    validateRuntimeEnv: () => validateRuntimeEnv({ requireWebhookSecret: true }),
    runtimeConfig: {
      production,
      nextPublicSupabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      databaseUrl: process.env.DATABASE_URL,
      postgresHost: process.env.POSTGRES_HOST,
      postgresUser: process.env.POSTGRES_USER,
    },
    query: (text, params) => queryWithStatementTimeout(text, params, HEALTH_QUERY_TIMEOUT_MS - 250),
  }),
);

const healthHandler = async (head = false) => {
  const report = await loadHealthReport();
  const response = json(report, report.status === "ok" ? 200 : 503);
  return head
    ? new Response(null, { status: response.status, headers: response.headers })
    : response;
};

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const staticResponse = async (pathname: string, head = false) => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const relative = decoded.replace(/^\/+/, "");
  const candidate = path.resolve(clientDir, relative || "index.html");
  if (
    !candidate.startsWith(`${clientDir}${path.sep}`) &&
    candidate !== path.join(clientDir, "index.html")
  ) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const stat = await fs.stat(candidate);
    if (stat.isFile()) {
      const immutable = relative.startsWith("assets/") && /-[A-Za-z0-9_-]{8,}\./.test(relative);
      const html = path.extname(candidate).toLowerCase() === ".html";
      return new Response(head ? null : await fs.readFile(candidate), {
        headers: {
          "Content-Type":
            mimeTypes[path.extname(candidate).toLowerCase()] || "application/octet-stream",
          "Content-Length": String(stat.size),
          "Cache-Control": html
            ? "no-cache, no-store, must-revalidate"
            : immutable
              ? "public, max-age=31536000, immutable"
              : "public, max-age=300",
        },
      });
    }
  } catch {
    /* SPA fallback */
  }
  // Missing scripts, styles and images must fail explicitly. Returning the SPA
  // document for an asset masks deploy errors and produces misleading MIME failures.
  if (relative.startsWith("assets/") || path.extname(relative)) {
    return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const index = path.join(clientDir, "index.html");
    const stat = await fs.stat(index);
    return new Response(head ? null : await fs.readFile(index), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": String(stat.size),
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch {
    return new Response("Frontend build not found", { status: 503 });
  }
};

const route = async (request: Request) => {
  const url = new URL(request.url);
  if (production && url.pathname !== "/api/health") {
    const allowedOrigins = new Set(
      [
        process.env.PUBLIC_APP_URL,
        process.env.PARTNER_APP_URL,
        ...(process.env.APP_ALLOWED_ORIGINS || "").split(","),
      ]
        .filter(Boolean)
        .map((value) => new URL(String(value)).origin),
    );
    if (!allowedOrigins.has(url.origin)) return json({ error: "Host nao autorizado." }, 421);
  }
  if (url.pathname === "/api/backend") return backendHandler(request);
  if (url.pathname === "/api/health") {
    if (!isHealthRequestMethodAllowed(request.method)) {
      const response = json({ error: "Metodo nao permitido." }, 405);
      response.headers.set("Allow", "GET, HEAD");
      return response;
    }
    return healthHandler(request.method === "HEAD");
  }
  if (url.pathname === "/api/webhooks/asaas") return handleAsaasWebhook(request);
  if (url.pathname.startsWith("/storage/")) {
    const [, , bucket, ...parts] = url.pathname.split("/");
    if (!bucket || !parts.length) return new Response("Not found", { status: 404 });
    return serveStorageFile(
      decodeURIComponent(bucket),
      decodeURIComponent(parts.join("/")),
      authorizeCookieRequest(request),
    );
  }
  if (!["GET", "HEAD"].includes(request.method))
    return json({ error: "Metodo nao permitido." }, 405);
  return staticResponse(url.pathname, request.method === "HEAD");
};

const send = async (response: Response, outgoing: ServerResponse) => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders))
    if (!headers.has(name)) headers.set(name, value);
  if (production)
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  const outgoingHeaders: Record<string, string | string[]> = Object.fromEntries(headers.entries());
  const setCookies =
    typeof (headers as any).getSetCookie === "function"
      ? (headers as any).getSetCookie()
      : (headers.get("set-cookie") || "")
          .split(/,\s*(?=hype_(?:access|refresh|auth_flow)=)/)
          .filter(Boolean);
  if (setCookies.length) outgoingHeaders["set-cookie"] = setCookies;
  outgoing.writeHead(response.status, outgoingHeaders);
  if (!response.body) return outgoing.end();
  Readable.fromWeb(response.body as any).pipe(outgoing);
};

const server = createServer(async (incoming, outgoing) => {
  const controller = new AbortController();
  incoming.once("aborted", () => controller.abort());
  outgoing.once("close", () => controller.abort());
  try {
    await send(await route(await toRequest(incoming, controller.signal)), outgoing);
  } catch (error: any) {
    const status = Number(error?.status || 500);
    if (status >= 500)
      console.error("request failed", { message: error?.message, path: incoming.url });
    await send(
      json({ error: status === 413 ? "Payload muito grande." : "Erro interno." }, status),
      outgoing,
    );
  }
});

validateRuntimeEnv({ requireWebhookSecret: true });
server.listen(port, listenHost, () =>
  console.log(`Hype Delivery listening on ${listenHost}:${port}`),
);
