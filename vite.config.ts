import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tanstackStart({
      spa: {
        enabled: true,
      },
    }),
    nitro(),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  server: {
    port: 3000,
    host: "0.0.0.0",
  },
});
