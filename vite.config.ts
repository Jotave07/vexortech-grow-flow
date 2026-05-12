import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  server: {
    port: 3000,
    host: "0.0.0.0",
  },
  build: {
    outDir: "dist",
  }
});
