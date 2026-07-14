import crypto from "node:crypto";
import { Buffer } from "node:buffer";
import { parseBearerToken } from "@/backend/db";
import { handleAuthAction } from "@/backend/auth";
import { invokeFunction } from "@/backend/functions";
import { executeQueryPayload } from "@/backend/query";
import { executeRpc } from "@/backend/rpc";
import { createRealtimeStream } from "@/backend/realtime";
import { serveStorageFile, uploadStorageFile } from "@/backend/storage";
import { getSupabaseServerConfig } from "@/backend/supabase";
import { isTrustedEdgeProxyRequest } from "./edge-proxy";

const accessCookieName = "hype_access";
const refreshCookieName = "hype_refresh";
const oauthFlowCookieName = "hype_auth_flow";
const jsonBodyLimit = 1024 * 1024;
const multipartBodyLimit = 6 * 1024 * 1024;

class PayloadTooLargeError extends Error {}

type Bucket = { count: number; resetAt: number };
type AuthFlow = {
  verifier: string;
  challenge: string;
  callbackUrl: string;
  next: string;
  context: "customer" | "merchant" | "merchant_signup" | "recovery" | "signup";
  createdAt: number;
};

type BackendDependencies = {
  handleAuthAction: typeof handleAuthAction;
  invokeFunction: typeof invokeFunction;
  executeQueryPayload: typeof executeQueryPayload;
  executeRpc: typeof executeRpc;
  createRealtimeStream: typeof createRealtimeStream;
  serveStorageFile: typeof serveStorageFile;
  uploadStorageFile: typeof uploadStorageFile;
};

export type BackendHandlerOptions = {
  production?: boolean;
  edgeRuntime?: boolean;
  allowedOrigins?: string[];
  publicAppUrl?: string;
  trustedProxySecret?: string;
  dependencies?: Partial<BackendDependencies>;
};

const defaultDependencies: BackendDependencies = {
  handleAuthAction,
  invokeFunction,
  executeQueryPayload,
  executeRpc,
  createRealtimeStream,
  serveStorageFile,
  uploadStorageFile,
};

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

const rateLimitCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
}, 60_000);
(rateLimitCleanup as unknown as { unref?: () => void }).unref?.();

const runtimeProduction = () =>
  process.env.NODE_ENV === "production" || Boolean(process.env.DENO_DEPLOYMENT_ID);
const isEdgeRuntime = () => Boolean(process.env.DENO_DEPLOYMENT_ID);

const normalizedOrigin = (value?: string | null) => {
  try {
    if (!value) return "";
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
      return "";
    return parsed.origin;
  } catch {
    return "";
  }
};

const configuredOrigins = (options: BackendHandlerOptions) =>
  new Set(
    [
      options.publicAppUrl,
      ...(options.allowedOrigins || []),
      process.env.PUBLIC_APP_URL,
      process.env.PARTNER_APP_URL,
      ...(process.env.APP_ALLOWED_ORIGINS || "").split(","),
    ]
      .map((value) => normalizedOrigin(value?.trim()))
      .filter(Boolean),
  );

const forwardedIp = (request: Request) =>
  request.headers.get("cf-connecting-ip") ||
  request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
  "";

const remoteIp = (request: Request, edgeRuntime: boolean, trustedProxySecret?: string) => {
  const internalIp = request.headers.get("x-hype-client-ip") || "";
  if (!edgeRuntime) {
    return internalIp || request.headers.get("x-real-ip") || forwardedIp(request) || "unknown";
  }

  // A direct Edge request may freely spoof X-Hype-Client-Ip. Trust it only
  // when the same-origin reverse proxy proves possession of a server secret.
  const expectedSecret = trustedProxySecret || process.env.EDGE_PROXY_SECRET || "";
  if (internalIp && isTrustedEdgeProxyRequest(request, expectedSecret)) {
    return internalIp;
  }
  return forwardedIp(request) || "unknown";
};

const readBodyWithinLimit = async (request: Request, maximum: number) => {
  const declaredHeader = request.headers.get("content-length");
  const declared = declaredHeader === null ? 0 : Number(declaredHeader);
  if (Number.isFinite(declared) && declared > maximum) throw new PayloadTooLargeError();
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel("Payload muito grande.").catch(() => undefined);
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

const readJsonBody = async (request: Request) => {
  const bytes = await readBodyWithinLimit(request, jsonBodyLimit);
  return JSON.parse(new TextDecoder().decode(bytes));
};

const readMultipartBody = async (request: Request) => {
  const bytes = await readBodyWithinLimit(request, multipartBodyLimit);
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, { method: "POST", headers, body: bytes }).formData();
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

const cookie = (name: string, value: string, maxAge: number, production: boolean) =>
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

const authFlowSecret = () => {
  const value = process.env.AUTH_FLOW_SECRET || getSupabaseServerConfig().secretKey || "";
  if (value.length < 32) {
    throw new Error(
      "AUTH_FLOW_SECRET ou uma chave secreta Supabase forte e obrigatoria para PKCE.",
    );
  }
  return value;
};

const clientOrigin = (request: Request, origins: Set<string>, publicAppUrl?: string) => {
  const requestOrigin = normalizedOrigin(request.url);
  const headerOrigin = normalizedOrigin(request.headers.get("origin"));
  if (headerOrigin && (headerOrigin === requestOrigin || origins.has(headerOrigin))) {
    return headerOrigin;
  }
  return normalizedOrigin(publicAppUrl || process.env.PUBLIC_APP_URL) || requestOrigin;
};

const allowedRedirect = (value: string, baseOrigin: string, origins: Set<string>) => {
  try {
    if (!value.trim()) return null;
    const candidate = new URL(value, baseOrigin);
    const allowedOrigins = new Set(origins);
    allowedOrigins.add(normalizedOrigin(baseOrigin));
    if (
      !["http:", "https:"].includes(candidate.protocol) ||
      candidate.username ||
      candidate.password ||
      !allowedOrigins.has(candidate.origin)
    ) {
      return null;
    }
    return candidate.toString();
  } catch {
    return null;
  }
};

const createAuthFlow = (
  request: Request,
  context: AuthFlow["context"],
  next: string,
  origins: Set<string>,
  publicAppUrl?: string,
): AuthFlow => {
  const verifier = crypto.randomBytes(48).toString("base64url");
  return {
    verifier,
    challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
    callbackUrl: new URL("/auth/callback", clientOrigin(request, origins, publicAppUrl)).toString(),
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

const openAuthFlow = (request: Request, origins: Set<string>): AuthFlow | null => {
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
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    return null;
  }
  try {
    const flow = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthFlow;
    if (
      !flow.verifier ||
      !flow.challenge ||
      !flow.callbackUrl ||
      Date.now() - Number(flow.createdAt) > 24 * 60 * 60 * 1_000
    ) {
      return null;
    }
    const safeNext = allowedRedirect(flow.next, normalizedOrigin(flow.callbackUrl), origins);
    if (!safeNext) return null;
    flow.next = safeNext;
    return flow;
  } catch {
    return null;
  }
};

const authorizeCookieRequestWithToken = (request: Request) => {
  const token = authToken(request);
  if (!token || request.headers.has("authorization")) return request;
  const headers = new Headers(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return new Request(request, { headers });
};

export const authorizeCookieRequest = authorizeCookieRequestWithToken;

const hasValidOrigin = (request: Request, production: boolean, origins: Set<string>) => {
  const origin = normalizedOrigin(request.headers.get("origin"));
  if (!origin) return !production || request.headers.has("authorization");
  return origin === normalizedOrigin(request.url) || origins.has(origin);
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
  if (!session?.access_token) {
    return extras && Object.keys(extras).length
      ? { ...result, data: { ...(result?.data || {}), ...extras } }
      : result;
  }
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

export const createBackendHandler = (options: BackendHandlerOptions = {}) => {
  const production = options.production ?? runtimeProduction();
  const edgeRuntime = options.edgeRuntime ?? isEdgeRuntime();
  const origins = configuredOrigins(options);
  const dependencies = { ...defaultDependencies, ...(options.dependencies || {}) };

  const appendSessionCookies = (response: Response, session: any) => {
    response.headers.append(
      "Set-Cookie",
      cookie(
        accessCookieName,
        session.access_token,
        Number(session.expires_in || 3600),
        production,
      ),
    );
    if (session.refresh_token) {
      response.headers.append(
        "Set-Cookie",
        cookie(refreshCookieName, session.refresh_token, 60 * 60 * 24 * 30, production),
      );
    }
  };

  const clearAuthCookies = (response: Response) => {
    response.headers.append("Set-Cookie", cookie(accessCookieName, "", 0, production));
    response.headers.append("Set-Cookie", cookie(refreshCookieName, "", 0, production));
  };

  const clearAuthFlowCookie = (response: Response) => {
    response.headers.append("Set-Cookie", cookie(oauthFlowCookieName, "", 0, production));
  };

  return async (request: Request): Promise<Response> => {
    if (request.method === "GET") {
      const pathname = new URL(request.url).pathname;
      const storageMarker = "/storage/";
      const storageIndex = pathname.indexOf(storageMarker);
      if (storageIndex >= 0) {
        const [bucket, ...parts] = pathname.slice(storageIndex + storageMarker.length).split("/");
        if (!bucket || !parts.length) return new Response("Not found", { status: 404 });
        try {
          return dependencies.serveStorageFile(
            decodeURIComponent(bucket),
            decodeURIComponent(parts.join("/")),
            authorizeCookieRequestWithToken(request),
          );
        } catch {
          return new Response("Bad request", { status: 400 });
        }
      }
      return dependencies.createRealtimeStream(authorizeCookieRequestWithToken(request));
    }
    if (request.method !== "POST") return json({ error: "Metodo nao permitido." }, 405);
    if (!hasValidOrigin(request, production, origins)) {
      return json({ error: "Origem da solicitacao invalida." }, 403);
    }

    const ip = remoteIp(request, edgeRuntime, options.trustedProxySecret);
    if (!takeRateLimit(`api:${ip}`, 120)) {
      return json({ error: "Muitas solicitacoes. Aguarde um instante." }, 429);
    }

    let token = authToken(request);
    let rotatedSession: any = null;
    const refreshToken = cookieValue(request, refreshCookieName);
    const contentType = (request.headers.get("content-type") || "").toLowerCase();

    if (contentType.includes("multipart/form-data")) {
      let form: FormData;
      try {
        form = await readMultipartBody(request);
      } catch (error) {
        return error instanceof PayloadTooLargeError
          ? json({ error: "Payload muito grande." }, 413)
          : json({ error: "Multipart invalido." }, 400);
      }
      if (
        String(form.get("kind") || "") !== "storage" ||
        String(form.get("action") || "") !== "upload"
      ) {
        return json({ error: "Acao multipart desconhecida." }, 400);
      }
      if (!token && refreshToken) {
        const refreshed: any = await dependencies.handleAuthAction("refreshSession", {
          refreshToken,
        });
        rotatedSession = refreshed?.data?.session || null;
        token = rotatedSession?.access_token || "";
      }
      const response = json(await dependencies.uploadStorageFile(form, token));
      if (rotatedSession) appendSessionCookies(response, rotatedSession);
      return response;
    }

    let body: any;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      return error instanceof PayloadTooLargeError
        ? json({ error: "Payload muito grande." }, 413)
        : json({ error: "JSON invalido." }, 400);
    }
    if (!body || typeof body !== "object") return json({ error: "JSON invalido." }, 400);
    const kind = String(body.kind || "");

    if (kind === "auth") {
      const action = String(body.action || "");
      if (!AUTH_ACTIONS.has(action)) {
        return json({ error: "Acao de autenticacao desconhecida." }, 400);
      }
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
        const baseOrigin = clientOrigin(request, origins, options.publicAppUrl);
        const requestedNext = allowedRedirect(
          body.redirectTo ? String(body.redirectTo) : defaultNext,
          baseOrigin,
          origins,
        );
        if (!requestedNext) {
          return json(
            {
              data: null,
              error: {
                message: "Redirect de autenticacao invalido.",
                code: "invalid_redirect",
              },
            },
            400,
          );
        }
        body.redirectTo = requestedNext;
        flow = createAuthFlow(request, context, requestedNext, origins, options.publicAppUrl);
      } else if (action === "exchangeOAuthCode") {
        flow = openAuthFlow(request, origins);
        if (!flow) {
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
      let result: any = await dependencies.handleAuthAction(action, body, token, {
        pkce,
        intentRole,
      });
      if (action === "sessionFromToken" && result?.error && refreshToken) {
        result = await dependencies.handleAuthAction("refreshSession", { refreshToken });
      }

      const session = result?.data?.session || (result?.data?.access_token ? result.data : null);
      const extras =
        action === "exchangeOAuthCode" && flow
          ? { oauth_context: flow.context, next: flow.next }
          : {};
      result = publicAuthResult(result, session, extras);
      const response = json(result, result?.error?.code === "invalid_pkce_flow" ? 400 : 200);
      if (session?.access_token) {
        appendSessionCookies(response, {
          ...session,
          refresh_token: session.refresh_token || body.refreshToken || refreshToken,
        });
      }

      if (flow && result?.data?.next) {
        const resultNext = allowedRedirect(String(result.data.next), flow.next, origins);
        if (resultNext) flow.next = resultNext;
      }
      const keepFlow =
        flow &&
        !result?.error &&
        (action === "getOAuthUrl" ||
          action === "resetPasswordForEmail" ||
          ((action === "signUp" || action === "signUpMerchant") && !session?.access_token));
      if (keepFlow && flow) {
        response.headers.append(
          "Set-Cookie",
          cookie(oauthFlowCookieName, sealAuthFlow(flow), 24 * 60 * 60, production),
        );
      }
      if (action === "exchangeOAuthCode" || (flow && !keepFlow)) clearAuthFlowCookie(response);
      if (action === "signOut" || (action === "refreshSession" && result?.error)) {
        clearAuthCookies(response);
      }
      return response;
    }

    if (!token && refreshToken) {
      const refreshed: any = await dependencies.handleAuthAction("refreshSession", {
        refreshToken,
      });
      rotatedSession = refreshed?.data?.session || null;
      token = rotatedSession?.access_token || "";
    }

    let response: Response;
    if (kind === "query") {
      response = json(await dependencies.executeQueryPayload(body.query, { token }));
    } else if (kind === "rpc") {
      response = json(
        await dependencies.executeRpc(String(body.name || ""), body.args || {}, { token }),
      );
    } else if (kind === "function") {
      const name = String(body.name || "");
      const operationLimit =
        name === "get-realtime-ticket"
          ? 20
          : name === "create-checkout-order"
            ? 12
            : name === "quote-delivery"
              ? 30
              : name === "reverse-geocode"
                ? 20
                : name === "lookup-cep"
                  ? 40
                  : 90;
      if (!takeRateLimit(`function:${ip}:${name}`, operationLimit)) {
        return json({ error: "Muitas solicitacoes para esta operacao." }, 429);
      }
      response = json(
        await dependencies.invokeFunction(name, body.body || {}, token, { remoteIp: ip }),
      );
    } else {
      response = json({ error: "Acao desconhecida." }, 400);
    }
    if (rotatedSession) appendSessionCookies(response, rotatedSession);
    return response;
  };
};

export const backendHandler = createBackendHandler();
