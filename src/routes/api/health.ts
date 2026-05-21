import { createFileRoute } from "@tanstack/react-router";
import fs from "node:fs/promises";
import path from "node:path";
import { query } from "@/backend/db";
import { validateRuntimeEnv } from "@/backend/env";

const latestMigrationVersion = async () => {
  const migrationsDir = path.join(process.cwd(), "db", "migrations");
  try {
    const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
    return files.at(-1)?.split("_")[0] || null;
  } catch {
    return null;
  }
};

const checkDb = async () => {
  const ping = await query("SELECT 1 AS ok");
  return ping.rows[0]?.ok === 1;
};

const checkMigrations = async () => {
  const latest = await latestMigrationVersion();
  const table = await query("SELECT to_regclass('public.schema_migrations') AS table_name");
  if (!latest) return { ok: true, latest: null, applied: null };
  if (!table.rows[0]?.table_name) return { ok: false, latest, applied: null };
  const applied = await query(
    "SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1",
  );
  const current = applied.rows[0]?.version || null;
  return { ok: current === latest, latest, applied: current };
};

const checkStorage = async () => {
  const dir = process.env.STORAGE_DIR || path.join(process.cwd(), ".storage-health");
  const filePath = path.join(dir, `.health-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, "ok", "utf8");
  await fs.unlink(filePath);
  return true;
};

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const checks: Record<string, unknown> = {};
        let ok = true;

        try {
          validateRuntimeEnv();
          checks.env = { ok: true };
        } catch (error: any) {
          ok = false;
          checks.env = { ok: false, message: error?.message || "invalid env" };
        }

        try {
          checks.db = { ok: await checkDb() };
        } catch (error: any) {
          ok = false;
          checks.db = { ok: false, code: error?.code || null };
        }

        try {
          const migrations = await checkMigrations();
          checks.migrations = migrations;
          if (!migrations.ok) ok = false;
        } catch (error: any) {
          ok = false;
          checks.migrations = { ok: false, code: error?.code || null };
        }

        try {
          checks.storage = { ok: await checkStorage() };
        } catch {
          ok = false;
          checks.storage = { ok: false };
        }

        return Response.json(
          { status: ok ? "ok" : "error", checks },
          {
            status: ok ? 200 : 500,
            headers: { "Content-Type": "application/json; charset=utf-8" },
          },
        );
      },
    },
  },
});
