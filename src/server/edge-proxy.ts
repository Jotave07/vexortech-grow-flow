import crypto from "node:crypto";
import { Buffer } from "node:buffer";

export const edgeProxySecretHeader = "x-hype-proxy-secret";

type RequestHandler = (request: Request) => Response | Promise<Response>;

const digest = (value: string) => crypto.createHash("sha256").update(Buffer.from(value)).digest();

export const isTrustedEdgeProxyRequest = (
  request: Request,
  secret = process.env.EDGE_PROXY_SECRET || "",
) => {
  const supplied = request.headers.get(edgeProxySecretHeader) || "";
  const matches = crypto.timingSafeEqual(digest(supplied), digest(secret));
  return secret.length >= 32 && supplied.length > 0 && matches;
};

export const requireTrustedEdgeProxy = (
  handler: RequestHandler,
  options: { enforce?: boolean; secret?: string } = {},
) => {
  const enforce = options.enforce ?? Boolean(process.env.DENO_DEPLOYMENT_ID);
  return async (request: Request): Promise<Response> => {
    if (!enforce || isTrustedEdgeProxyRequest(request, options.secret)) {
      return handler(request);
    }
    return Response.json(
      { error: "Acesso direto a funcao nao permitido." },
      {
        status: 403,
        headers: { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" },
      },
    );
  };
};
