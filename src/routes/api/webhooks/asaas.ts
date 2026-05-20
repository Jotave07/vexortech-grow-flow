import { createFileRoute } from "@tanstack/react-router";
import { handleAsaasWebhook } from "@/backend/webhooks";

export const Route = createFileRoute("/api/webhooks/asaas")({
  server: {
    handlers: {
      POST: async ({ request }) => handleAsaasWebhook(request),
      OPTIONS: async () => new Response("ok"),
    },
  },
});
