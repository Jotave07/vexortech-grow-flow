/// <reference path="./node-globals.d.ts" />

import { Buffer } from "node:buffer";
import { validateRuntimeEnv } from "../../../src/backend/env.ts";
import { handleAsaasWebhook } from "../../../src/backend/webhooks.ts";
import { requireTrustedEdgeProxy } from "../../../src/server/edge-proxy.ts";

// Deno does not expose Buffer globally to application modules. The existing
// webhook uses it only while processing a request for constant-time token
// comparison; expose the pinned Node-compatible implementation without
// changing the concurrently maintained webhook module.
if (!("Buffer" in globalThis)) {
  Object.defineProperty(globalThis, "Buffer", {
    value: Buffer,
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

validateRuntimeEnv({ requireWebhookSecret: true });
Deno.serve(requireTrustedEdgeProxy(handleAsaasWebhook, { enforce: true }));
