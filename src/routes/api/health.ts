import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () =>
        Response.json(
          { status: "ok" },
          { headers: { "Content-Type": "application/json; charset=utf-8" } },
        ),
    },
  },
});
