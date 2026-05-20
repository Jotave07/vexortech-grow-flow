import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { query } from "./db";
import type { BackendError, BackendResult, LocalSession, LocalUser } from "@/integrations/backend/compat-types";

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;
const RESET_TTL_SECONDS = 60 * 30;

const base64Url = (input: Buffer | string) =>
  Buffer.from(input).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");

const readJwtSecret = () => {
  const secret = process.env.JWT_SECRET?.trim() || process.env.AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET nao configurado no ambiente de producao.");
  }
  return "hype-delivery-local-dev-secret";
};

const signJwt = (payload: Record<string, unknown>, ttlSeconds = TOKEN_TTL_SECONDS) => {
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + ttlSeconds };
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify(fullPayload));
  const signature = crypto
    .createHmac("sha256", readJwtSecret())
    .update(`${header}.${body}`)
    .digest("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
  return `${header}.${body}.${signature}`;
};

export const verifyJwt = (token?: string) => {
  if (!token) return null;
  const [header, body, signature] = token.split(".");
  if (!header || !body || !signature) return null;
  const expected = crypto
    .createHmac("sha256", readJwtSecret())
    .update(`${header}.${body}`)
    .digest("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body.replaceAll("-", "+").replaceAll("_", "/"), "base64").toString("utf8"));
  if (Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) return null;
  return payload as Record<string, any>;
};

const hashPassword = async (password: string) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
  return `scrypt$16384$8$1$${salt}$${key.toString("hex")}`;
};

const verifyPassword = async (password: string, stored?: string | null) => {
  if (!stored) return false;
  const [scheme, n, r, p, salt, key] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: Number(n), r: Number(r), p: Number(p) }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
  return crypto.timingSafeEqual(Buffer.from(key, "hex"), derived);
};

const userFromRow = (row: any): LocalUser => ({
  id: row.id,
  email: row.email,
  role: "authenticated",
  app_metadata: row.raw_app_meta_data || {},
  user_metadata: row.raw_user_meta_data || {},
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const createSession = (user: LocalUser, ttlSeconds = TOKEN_TTL_SECONDS): LocalSession => {
  const access_token = signJwt(
    {
      sub: user.id,
      email: user.email,
      role: "authenticated",
      user_metadata: user.user_metadata || {},
    },
    ttlSeconds,
  );
  const expires_at = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { access_token, token_type: "bearer", expires_at, expires_in: ttlSeconds, user };
};

const errorResult = (message: string, code?: string): BackendResult => ({
  data: null,
  error: { message, code } satisfies BackendError,
});

export const getUserByToken = async (token?: string) => {
  const claims = verifyJwt(token);
  if (!claims?.sub) return null;
  const { rows } = await query(
    `SELECT id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at
     FROM auth.users
     WHERE id = $1`,
    [claims.sub],
  );
  return rows[0] ? userFromRow(rows[0]) : null;
};

export const getActor = async (token?: string) => {
  const user = await getUserByToken(token);
  if (!user) return null;
  const [{ rows: profileRows }, { rows: roleRows }, { rows: storeRows }] = await Promise.all([
    query(`SELECT * FROM public.profiles WHERE user_id = $1 ORDER BY created_at NULLS LAST LIMIT 1`, [user.id]),
    query(`SELECT role, store_id FROM public.user_roles WHERE user_id = $1`, [user.id]),
    query(`SELECT id FROM public.stores WHERE owner_user_id = $1`, [user.id]),
  ]);
  const roles = new Set<string>();
  if (profileRows[0]?.role) roles.add(profileRows[0].role);
  for (const row of roleRows) if (row.role) roles.add(row.role);
  const admin = roles.has("super_admin") || roles.has("admin") || user.email === "jvieira@vexortech.com.br";
  return {
    user,
    profile: profileRows[0] || null,
    roles,
    admin,
    ownedStoreIds: storeRows.map((row) => row.id),
  };
};

const ensureAuthSchema = async () => {
  await query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE NOT NULL,
      encrypted_password text,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
      raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
      email_confirmed_at timestamptz DEFAULT now(),
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      deleted_at timestamptz
    );
    CREATE TABLE IF NOT EXISTS auth.password_reset_tokens (
      token_hash text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      expires_at timestamptz NOT NULL,
      used_at timestamptz,
      created_at timestamptz DEFAULT now()
    );
  `);
};

export const signUp = async (email: string, password: string, metadata: Record<string, unknown> = {}) => {
  await ensureAuthSchema();
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || password.length < 6) return errorResult("E-mail e senha de no minimo 6 caracteres sao obrigatorios.");

  const encrypted = await hashPassword(password);
  const role = String(metadata.role || metadata.account_type || "customer");

  try {
    const { rows } = await query(
      `INSERT INTO auth.users (email, encrypted_password, raw_user_meta_data)
       VALUES ($1, $2, $3::jsonb)
       RETURNING id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at`,
      [normalizedEmail, encrypted, JSON.stringify(metadata)],
    );
    const user = userFromRow(rows[0]);
    await query(
      `INSERT INTO public.profiles (user_id, email, full_name, document, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [
        user.id,
        normalizedEmail,
        metadata.full_name ? String(metadata.full_name) : null,
        metadata.document ? String(metadata.document) : null,
        role,
      ],
    ).catch(() => null);
    await query(
      `INSERT INTO public.user_roles (user_id, role)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [user.id, role],
    ).catch(() => null);
    return { data: createSession(user), error: null };
  } catch (error: any) {
    if (String(error?.code) === "23505") return errorResult("Este e-mail ja esta cadastrado.", "email_exists");
    return errorResult(error?.message || "Erro ao criar usuario.");
  }
};

export const signInWithPassword = async (email: string, password: string) => {
  await ensureAuthSchema();
  const { rows } = await query(
    `SELECT id, email, encrypted_password, raw_user_meta_data, raw_app_meta_data, created_at, updated_at
     FROM auth.users
     WHERE lower(email) = lower($1) AND deleted_at IS NULL
     LIMIT 1`,
    [email.trim()],
  );
  const row = rows[0];
  if (!row || !(await verifyPassword(password, row.encrypted_password))) {
    return errorResult("E-mail ou senha invalidos.", "invalid_credentials");
  }
  const user = userFromRow(row);
  await query(`UPDATE public.profiles SET last_login = now() WHERE user_id = $1`, [user.id]).catch(() => null);
  return { data: createSession(user), error: null };
};

export const sessionFromToken = async (token: string) => {
  const user = await getUserByToken(token);
  if (!user) return errorResult("Sessao invalida ou expirada.", "invalid_token");
  return { data: createSession(user), error: null };
};

export const updateUser = async (token: string, input: { password?: string; data?: Record<string, unknown> }) => {
  const user = await getUserByToken(token);
  if (!user) return errorResult("Sessao invalida.", "unauthorized");
  const updates: string[] = ["updated_at = now()"];
  const params: unknown[] = [];
  if (input.password) {
    params.push(await hashPassword(input.password));
    updates.push(`encrypted_password = $${params.length}`);
  }
  if (input.data) {
    params.push(JSON.stringify({ ...(user.user_metadata || {}), ...input.data }));
    updates.push(`raw_user_meta_data = $${params.length}::jsonb`);
  }
  params.push(user.id);
  const { rows } = await query(
    `UPDATE auth.users SET ${updates.join(", ")} WHERE id = $${params.length}
     RETURNING id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at`,
    params,
  );
  return { data: createSession(userFromRow(rows[0])), error: null };
};

export const resetPasswordForEmail = async (email: string, redirectTo?: string) => {
  await ensureAuthSchema();
  const { rows } = await query(`SELECT id, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at FROM auth.users WHERE lower(email) = lower($1)`, [email.trim()]);
  if (!rows[0]) return { data: { sent: true }, error: null };

  const user = userFromRow(rows[0]);
  const session = createSession(user, RESET_TTL_SECONDS);
  const resetUrl = `${redirectTo || process.env.PUBLIC_APP_URL || ""}#access_token=${encodeURIComponent(session.access_token)}&type=recovery`;
  await sendPasswordResetEmail(user.email || email, resetUrl);
  return { data: { sent: true }, error: null };
};

const sendPasswordResetEmail = async (email: string, resetUrl: string) => {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) {
    console.warn(`[auth] SMTP_HOST ausente. Link de redefinicao para ${email}: ${resetUrl}`);
    return;
  }
  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@hypedelivery.com.br",
    to: email,
    subject: "Redefinicao de senha - Hype Delivery",
    text: `Use este link para redefinir sua senha: ${resetUrl}`,
    html: `<p>Use este link para redefinir sua senha:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
  });
};

export const getClaims = async (token?: string) => {
  const claims = verifyJwt(token);
  if (!claims) return errorResult("Token invalido.", "invalid_token");
  return { data: { claims }, error: null };
};

export const handleAuthAction = async (action: string, body: any, token?: string) => {
  switch (action) {
    case "signUp":
      return signUp(String(body.email || ""), String(body.password || ""), body.data || {});
    case "signInWithPassword":
      return signInWithPassword(String(body.email || ""), String(body.password || ""));
    case "sessionFromToken":
      return sessionFromToken(String(body.token || token || ""));
    case "updateUser":
      return updateUser(token || "", { password: body.password, data: body.data });
    case "resetPasswordForEmail":
      return resetPasswordForEmail(String(body.email || ""), body.redirectTo ? String(body.redirectTo) : undefined);
    case "getClaims":
      return getClaims(String(body.token || token || ""));
    default:
      return errorResult("Acao de autenticacao desconhecida.");
  }
};
