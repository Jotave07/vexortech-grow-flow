import { createFileRoute } from "@tanstack/react-router";
import { serveStorageFile } from "@/backend/storage";

export const Route = createFileRoute("/storage/$")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const splat = params._splat || "";
        const [bucket, ...rest] = splat.split("/");
        return serveStorageFile(bucket || "", rest.join("/"));
      },
    },
  },
});
