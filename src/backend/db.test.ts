import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPgPoolConfig } from "./db";

describe("PostgreSQL TLS connection config", () => {
  const originalEnv = { ...process.env };
  let certificateDirectory = "";
  let certificatePath = "";
  const certificatePem = "-----BEGIN CERTIFICATE-----\nTEST-CA\n-----END CERTIFICATE-----\n";

  beforeEach(() => {
    certificateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vexortech-db-"));
    certificatePath = path.join(certificateDirectory, "postgres-root.crt");
    fs.writeFileSync(certificatePath, certificatePem, { mode: 0o600 });
    process.env = {
      ...originalEnv,
      DATABASE_SSL_ROOT_CERT: certificatePath,
      DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
    };
    delete process.env.POSTGRES_SSL_ROOT_CERT;
    delete process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED;
  });

  afterEach(() => {
    process.env = originalEnv;
    fs.rmSync(certificateDirectory, { recursive: true, force: true });
  });

  it("overrides a legacy no-verify URL with verify-full and the pinned CA", () => {
    const config = getPgPoolConfig(
      "postgresql://postgres:secret@db.example.com:5432/postgres?sslmode=no-verify",
    );
    const configuredUrl = new URL(String(config.connectionString));

    expect(configuredUrl.searchParams.get("sslmode")).toBe("verify-full");
    expect(configuredUrl.searchParams.get("sslrootcert")).toBe(certificatePath);
    expect(config.ssl).toBeUndefined();

    const client = new pg.Client(config);
    const connectionParameters = (client as unknown as { connectionParameters: { ssl: unknown } })
      .connectionParameters;
    expect(connectionParameters.ssl).toMatchObject({ ca: certificatePem });
  });

  it("fails closed when certificate validation is explicitly disabled", () => {
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = "false";

    expect(() =>
      getPgPoolConfig("postgresql://postgres:secret@db.example.com:5432/postgres"),
    ).toThrow("nao pode ser combinado");
  });

  it.each([
    "postgresql://vexortech_runtime.project:secret@aws-0.pooler.supabase.com:6543/postgres",
    "postgresql://vexortech_runtime.project:secret@aws-0.pooler.supabase.com:6543/postgres?sslmode=require",
  ])("activates certificate-validated TLS for a Supabase pooler URL: %s", (connectionString) => {
    delete process.env.DATABASE_SSL_ROOT_CERT;
    delete process.env.POSTGRES_SSL_ROOT_CERT;

    const config = getPgPoolConfig(connectionString);

    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(new URL(String(config.connectionString)).searchParams.has("sslmode")).toBe(false);
    const client = new pg.Client(config);
    const connectionParameters = (client as unknown as { connectionParameters: { ssl: unknown } })
      .connectionParameters;
    expect(connectionParameters.ssl).toEqual({ rejectUnauthorized: true });
  });
});
