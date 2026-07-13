import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  resolve: { alias: { "@": path.join(root, "src") } },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    cssCodeSplit: true,
    assetsInlineLimit: 2048,
    rollupOptions: { external: ["pg", "pg-native"] },
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/storage": "http://127.0.0.1:3000",
    },
  },
});
