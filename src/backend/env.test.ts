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
      DATABASE_URL:
        "postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
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

  it("rejects a production database outside Supabase", () => {
    process.env.DATABASE_URL = "postgresql://postgres:secret@db.example.com:5432/postgres";

    expect(() => validateRuntimeEnv()).toThrow("deve pertencer ao projeto Supabase");
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

  it("accepts hosted Edge TLS with plural Supabase keys and the restricted runtime role", () => {
    process.env.DENO_DEPLOYMENT_ID = "project_hype-api_1";
    process.env.DATABASE_URL =
      "postgresql://vexortech_runtime.project:secret@aws-0.pooler.supabase.com:6543/postgres?sslmode=require";
    delete process.env.DATABASE_SSL_ROOT_CERT;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_PUBLISHABLE_KEYS = JSON.stringify({ default: "sb_publishable_edge" });
    process.env.SUPABASE_SECRET_KEYS = JSON.stringify({ default: "sb_secret_edge_value_long_enough" });
    process.env.EDGE_PROXY_SECRET = "edge-proxy-secret-0123456789abcdef";

    expect(() => validateRuntimeEnv()).not.toThrow();
  });

  it("rejects hosted Edge startup without a strong reverse-proxy secret", () => {
    process.env.DENO_DEPLOYMENT_ID = "project_hype-api_1";
    process.env.DATABASE_URL =
      "postgresql://vexortech_runtime.project:secret@aws-0.pooler.supabase.com:6543/postgres?sslmode=require";
    process.env.EDGE_PROXY_SECRET = "short";

    expect(() => validateRuntimeEnv()).toThrow("EDGE_PROXY_SECRET de no minimo 32 caracteres");
  });

  it("does not accept POSTGRES_* as an Edge DATABASE_URL substitute", () => {
    process.env.DENO_DEPLOYMENT_ID = "project_hype-api_1";
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_HOST = "db.project.supabase.co";
    process.env.POSTGRES_DATABASE = "postgres";
    process.env.POSTGRES_USER = "vexortech_runtime";
    process.env.POSTGRES_PASSWORD = "secret";

    expect(() => validateRuntimeEnv()).toThrow("DATABASE_URL do papel restrito");
  });

  it("rejects the privileged default database role in hosted Edge", () => {
    process.env.DENO_DEPLOYMENT_ID = "project_hype-api_1";
    process.env.DATABASE_URL =
      "postgresql://postgres.project:secret@aws-0.pooler.supabase.com:6543/postgres?sslmode=require";

    expect(() => validateRuntimeEnv()).toThrow("papel restrito vexortech_runtime");
  });

  it("rejects a direct or session database port in hosted Edge", () => {
    process.env.DENO_DEPLOYMENT_ID = "project_hype-api_1";
    process.env.DATABASE_URL =
      "postgresql://vexortech_runtime.project:secret@aws-0.pooler.supabase.com:5432/postgres?sslmode=require";

    expect(() => validateRuntimeEnv()).toThrow("pooler transacional na porta 6543");
  });

  it("rejects TLS disabling parameters in hosted Edge", () => {
    process.env.DENO_DEPLOYMENT_ID = "project_hype-api_1";
    process.env.DATABASE_URL =
      "postgresql://vexortech_runtime.project:secret@aws-0.pooler.supabase.com:6543/postgres?sslmode=no-verify";

    expect(() => validateRuntimeEnv()).toThrow("deve validar TLS");
  });

  it("rejects a hosted Edge pooler URL without an explicit sslmode", () => {
    process.env.DENO_DEPLOYMENT_ID = "project_hype-api_1";
    process.env.DATABASE_URL =
      "postgresql://vexortech_runtime.project:secret@aws-0.pooler.supabase.com:6543/postgres";

    expect(() => validateRuntimeEnv()).toThrow("sslmode explicito require, verify-ca ou verify-full");
  });

  it("rejects unknown or duplicated sslmode values in hosted Edge", () => {
    process.env.DENO_DEPLOYMENT_ID = "project_hype-api_1";
    process.env.DATABASE_URL =
      "postgresql://vexortech_runtime.project:secret@aws-0.pooler.supabase.com:6543/postgres?sslmode=prefer";

    expect(() => validateRuntimeEnv()).toThrow("sslmode explicito require, verify-ca ou verify-full");

    process.env.DATABASE_URL =
      "postgresql://vexortech_runtime.project:secret@aws-0.pooler.supabase.com:6543/postgres?sslmode=require&sslmode=disable";
    expect(() => validateRuntimeEnv()).toThrow("sslmode explicito require, verify-ca ou verify-full");
  });

  it.each(["require", "verify-ca", "verify-full"])(
    "accepts the explicit hosted Edge sslmode %s",
    (sslMode) => {
      process.env.DENO_DEPLOYMENT_ID = "project_hype-api_1";
      process.env.DATABASE_URL =
        `postgresql://vexortech_runtime.project:secret@aws-0.pooler.supabase.com:6543/postgres?sslmode=${sslMode}`;
      process.env.EDGE_PROXY_SECRET = "edge-proxy-secret-0123456789abcdef";

      expect(() => validateRuntimeEnv()).not.toThrow();
    },
  );

  it("does not silently fall back to the privileged SUPABASE_DB_URL", () => {
    process.env.DENO_DEPLOYMENT_ID = "project_hype-api_1";
    delete process.env.DATABASE_URL;
    process.env.SUPABASE_DB_URL =
      "postgresql://postgres:secret@db.project.supabase.co:5432/postgres";

    expect(() => validateRuntimeEnv()).toThrow("DATABASE_URL do papel restrito");
  });
});
