import { copyFileSync, cpSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const distDir = resolve(root, "dist");
const clientDir = resolve(distDir, "client");
const shellFile = resolve(clientDir, "_shell.html");

if (!existsSync(shellFile)) {
  throw new Error("Missing dist/client/_shell.html. Run vite build before copying the client build.");
}

copyFileSync(shellFile, resolve(distDir, "index.html"));

for (const entry of readdirSync(clientDir)) {
  cpSync(resolve(clientDir, entry), resolve(distDir, entry), {
    recursive: true,
    force: true,
  });
}
