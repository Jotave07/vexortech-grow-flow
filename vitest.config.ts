import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": path.join(root, "src") } },
  test: {
    environment: "node",
    testTimeout: 15_000,
    maxWorkers: 4,
    exclude: [
      "tests/e2e/**",
      "node_modules/**",
      "dist/**",
      ".output/**",
      "quarantine/**",
    ],
  },
});
