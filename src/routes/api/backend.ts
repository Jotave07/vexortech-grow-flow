import { createFileRoute } from "@tanstack/react-router";
import { parseBearerToken } from "@/backend/db";
import { handleAuthAction } from "@/backend/auth";
import { invokeFunction } from "@/backend/functions";
import { executeQueryPayload } from "@/backend/query";
import { executeRpc } from "@/backend/rpc";
import { createRealtimeStream } from "@/backend/realtime";
import { uploadStorageFile } from "@/backend/storage";

const jsonResponse = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });

const getRemoteIp = (request: Request) => {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || request.headers.get("x-real-ip") || request.headers.get("cf-connecting-ip") || null;
};

export const Route = createFileRoute("/api/backend")({
  server: {
    handlers: {
      GET: async ({ request }) => createRealtimeStream(request),
      POST: async ({ request }) => {
        const token = parseBearerToken(request);
        const contentType = request.headers.get("content-type") || "";

        if (contentType.includes("multipart/form-data")) {
          const form = await request.formData();
          const kind = String(form.get("kind") || "");
          const action = String(form.get("action") || "");
          if (kind === "storage" && action === "upload") {
            const result = await uploadStorageFile(form, token);
            return jsonResponse(result);
          }
          return jsonResponse({ error: "Ação multipart desconhecida" }, 400);
        }

        const body = await request.json().catch(() => ({}));
        const kind = String(body.kind || "");

        if (kind === "auth") {
          const result = await handleAuthAction(String(body.action || ""), body, token || body.token);
          return jsonResponse(result);
        }
        if (kind === "query") {
          const result = await executeQueryPayload(body.query, { token });
          return jsonResponse(result);
        }
        if (kind === "rpc") {
          const result = await executeRpc(String(body.name || ""), body.args || {}, { token });
          return jsonResponse(result);
        }
        if (kind === "function") {
          const result = await invokeFunction(String(body.name || ""), body.body || {}, token, {
            remoteIp: getRemoteIp(request),
          });
          return jsonResponse(result);
        }

        return jsonResponse({ error: "Ação desconhecida" }, 400);
      },
    },
  },
});
