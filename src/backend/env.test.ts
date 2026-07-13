import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { validateRuntimeEnv } from "./env";

const pathToNonexistentAbsoluteCertificate = path.resolve("nonexistent-supabase-root.crt");

describe("production runtime environment", () => {
  const originalEnv = { ...process.env };
  let certificateDirectory = "";
  let certificatePath = "";

  beforeAll(() => {
    certificateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vexortech-env-"));
    certificatePath = path.join(certificateDirectory, "postgres-root.crt");
    fs.writeFileSync(
      certificatePath,
      "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n",
      { mode: 0o600 },
    );
  });

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://postgres:secret@db.example.com:5432/postgres",
      PUBLIC_APP_URL: "https://hypedelivery.com.br",
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      SUPABASE_SECRET_KEY: "test-private-key-without-provider-prefix",
      AUTH_FLOW_SECRET: "0123456789abcdef0123456789abcdef",
      ASAAS_API_KEY: "asaas_test_key",
      ASAAS_ENVIRONMENT: "production",
      DATABASE_SSL_ROOT_CERT: certificatePath,
      DATABASE_SSL_REJECT_UNAUTHORIZED: "true",
    };
    delete process.env.POSTGRES_SSL_ROOT_CERT;
    delete process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  afterAll(() => {
    fs.rmSync(certificateDirectory, { recursive: true, force: true });
  });

  it("accepts a complete billing environment", () => {
    expect(() => validateRuntimeEnv()).not.toThrow();
  });

  it("fails readiness when the Asaas API key is absent", () => {
    delete process.env.ASAAS_API_KEY;

    expect(() => validateRuntimeEnv()).toThrow("ASAAS_API_KEY obrigatoria");
  });

  it("fails readiness when the PostgreSQL root certificate is absent", () => {
    delete process.env.DATABASE_SSL_ROOT_CERT;

    expect(() => validateRuntimeEnv()).toThrow("DATABASE_SSL_ROOT_CERT obrigatorio");
  });

  it("fails closed for an unknown Asaas environment", () => {
    process.env.ASAAS_ENVIRONMENT = "prodution";

    expect(() => validateRuntimeEnv()).toThrow("ASAAS_ENVIRONMENT deve ser sandbox ou production");
  });

  it("rejects a relative PostgreSQL root certificate path", () => {
    process.env.DATABASE_SSL_ROOT_CERT = "certificates/supabase-root.crt";

    expect(() => validateRuntimeEnv()).toThrow("caminho absoluto");
  });

  it("rejects disabling certificate validation when a root certificate is pinned", () => {
    process.env.DATABASE_SSL_ROOT_CERT = pathToNonexistentAbsoluteCertificate;
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = "false";

    expect(() => validateRuntimeEnv()).toThrow("nao pode ser combinado");
  });

  it("rejects an absent PostgreSQL root certificate file", () => {
    process.env.DATABASE_SSL_ROOT_CERT = pathToNonexistentAbsoluteCertificate;

    expect(() => validateRuntimeEnv()).toThrow("nao existe ou nao pode ser lido");
  });

  it("accepts the POSTGRES_SSL_ROOT_CERT alias", () => {
    delete process.env.DATABASE_SSL_ROOT_CERT;
    process.env.POSTGRES_SSL_ROOT_CERT = certificatePath;

    expect(() => validateRuntimeEnv()).not.toThrow();
  });
});
