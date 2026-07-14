import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { queryWithStatementTimeout } from "@/backend/db";
import { serveStorageFile } from "@/backend/storage";
import { handleAsaasWebhook } from "@/backend/webhooks";
import { validateRuntimeEnv } from "@/backend/env";
import { authorizeCookieRequest, backendHandler } from "./backend-handler";
import { createSecurityHeaders } from "./security-headers";
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

const securityHeaders = createSecurityHeaders();

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
