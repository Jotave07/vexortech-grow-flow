import { backendHandler } from "../../../src/server/backend-handler.ts";
import { validateRuntimeEnv } from "../../../src/backend/env.ts";
import { requireTrustedEdgeProxy } from "../../../src/server/edge-proxy.ts";

// Authentication, authorization, PKCE, HttpOnly cookies, origin validation and
// operation-specific rate limits are owned by the shared BFF handler. The
// function intentionally keeps verify_jwt=false so public signup/menu routes
// retain the same contract as /api/backend behind the same-origin proxy.
validateRuntimeEnv();
Deno.serve(requireTrustedEdgeProxy(backendHandler, { enforce: true }));
