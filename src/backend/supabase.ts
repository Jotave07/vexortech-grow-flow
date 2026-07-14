import { Buffer } from "node:buffer";
import { fetchWithTimeout } from "@/server/http-timeout";

export const SUPABASE_AUTH_REQUEST_TIMEOUT_MS = 15_000;
export const SUPABASE_STORAGE_REQUEST_TIMEOUT_MS = 30_000;

type SupabaseRequestOptions = { signal?: AbortSignal };

const fetchSupabaseAuth = (input: RequestInfo | URL, init: RequestInit = {}) =>
  fetchWithTimeout(input, init, SUPABASE_AUTH_REQUEST_TIMEOUT_MS);

const fetchSupabaseStorage = (input: RequestInfo | URL, init: RequestInit = {}) =>
  fetchWithTimeout(input, init, SUPABASE_STORAGE_REQUEST_TIMEOUT_MS);

const clean = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : "";
};

const namedKey = (value?: string | null) => {
  const serialized = clean(value);
  if (!serialized) return "";
  try {
    const keys = JSON.parse(serialized) as Record<string, unknown>;
    return typeof keys.default === "string" ? clean(keys.default) : "";
  } catch {
    return "";
  }
};

export const getSupabaseServerConfig = () => {
  const url =
    clean(process.env.SUPABASE_URL) ||
    clean(process.env.NEXT_PUBLIC_SUPABASE_URL) ||
    clean(process.env.VITE_SUPABASE_URL);
  const publishableKey =
    namedKey(process.env.SUPABASE_PUBLISHABLE_KEYS) ||
    clean(process.env.SUPABASE_PUBLISHABLE_KEY) ||
    clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ||
    clean(process.env.VITE_SUPABASE_PUBLISHABLE_KEY) ||
    clean(process.env.SUPABASE_ANON_KEY) ||
    clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
    clean(process.env.VITE_SUPABASE_ANON_KEY);
  const secretKey =
    namedKey(process.env.SUPABASE_SECRET_KEYS) ||
    clean(process.env.SUPABASE_SECRET_KEY) ||
    clean(process.env.SUPABASE_SERVICE_ROLE_KEY) ||
    clean(process.env.SUPABASE_SERVICE_KEY);

  return {
    url: url.replace(/\/$/, ""),
    publishableKey,
    secretKey,
    apiKey: secretKey || publishableKey,
  };
};

export const hasSupabaseServerConfig = () => {
  const config = getSupabaseServerConfig();
  return Boolean(config.url && config.apiKey);
};

export const hasSupabaseAdminConfig = () => {
  const config = getSupabaseServerConfig();
  return Boolean(config.url && config.secretKey);
};

export const fetchSupabaseUserByToken = async (
  token?: string,
  options: SupabaseRequestOptions = {},
) => {
  if (!token) return null;
  const config = getSupabaseServerConfig();
  if (!config.url || !config.apiKey) return null;

  try {
    const response = await fetchSupabaseAuth(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.apiKey,
        Authorization: `Bearer ${token}`,
      },
      signal: options.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return null;
  }
};

/**
 * Public sign-up must go through the regular GoTrue endpoint. In particular, do
 * not fall back to the secret key here: `/admin/users` auto-confirms accounts
 * and a secret-key backed public route would let callers bypass e-mail proof.
 */
export const signUpSupabaseUser = async (
  email: string,
  password: string,
  metadata: Record<string, unknown>,
  redirectTo?: string,
  pkce?: { codeChallenge: string; codeChallengeMethod?: "s256" },
  options: SupabaseRequestOptions = {},
) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.publishableKey) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY obrigatoria para cadastro publico.");
  }

  const url = new URL(`${config.url}/auth/v1/signup`);
  if (redirectTo) url.searchParams.set("redirect_to", redirectTo);

  const response = await fetchSupabaseAuth(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.publishableKey,
    },
    body: JSON.stringify({
      email,
      password,
      data: metadata,
      code_challenge: pkce?.codeChallenge,
      code_challenge_method: pkce?.codeChallengeMethod || (pkce?.codeChallenge ? "s256" : undefined),
    }),
    signal: options.signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || "Erro ao criar usuario no Supabase Auth.");
  }
  return payload;
};

export const signInSupabaseUser = async (
  email: string,
  password: string,
  options: SupabaseRequestOptions = {},
) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.publishableKey) {
    throw new Error("Supabase Auth nao configurado para login.");
  }
  const response = await fetchSupabaseAuth(`${config.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.publishableKey },
    body: JSON.stringify({ email, password }),
    signal: options.signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error_description || payload?.msg || payload?.message || "E-mail ou senha incorretos.");
  return payload;
};

export const refreshSupabaseSession = async (
  refreshToken: string,
  options: SupabaseRequestOptions = {},
) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.publishableKey) throw new Error("Supabase Auth nao configurado.");
  const response = await fetchSupabaseAuth(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.publishableKey },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: options.signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error_description || payload?.message || "Sessao expirada.");
  return payload;
};

export const signOutSupabaseSession = async (
  accessToken: string,
  options: SupabaseRequestOptions = {},
) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.publishableKey || !accessToken) return;
  const response = await fetchSupabaseAuth(`${config.url}/auth/v1/logout`, {
    method: "POST",
    headers: { apikey: config.publishableKey, Authorization: `Bearer ${accessToken}` },
    signal: options.signal,
  });
  if (!response.ok && response.status !== 401) throw new Error("Nao foi possivel encerrar a sessao.");
};

export const createSupabaseOAuthUrl = (
  provider: "google" | "apple",
  redirectTo: string,
  pkce?: { codeChallenge: string; codeChallengeMethod?: "s256" },
) => {
  const config = getSupabaseServerConfig();
  if (!config.url) throw new Error("Supabase Auth nao configurado.");
  const url = new URL(`${config.url}/auth/v1/authorize`);
  url.searchParams.set("provider", provider);
  url.searchParams.set("redirect_to", redirectTo);
  if (pkce?.codeChallenge) {
    url.searchParams.set("code_challenge", pkce.codeChallenge);
    url.searchParams.set("code_challenge_method", pkce.codeChallengeMethod || "s256");
  }
  return url.toString();
};

export const exchangeSupabaseAuthCode = async (
  authCode: string,
  codeVerifier: string,
  options: SupabaseRequestOptions = {},
) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.publishableKey) throw new Error("Supabase Auth nao configurado.");
  if (!authCode || !codeVerifier) throw new Error("Codigo de autenticacao ou verificador PKCE ausente.");
  const response = await fetchSupabaseAuth(`${config.url}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.publishableKey },
    body: JSON.stringify({ auth_code: authCode, code_verifier: codeVerifier }),
    signal: options.signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error_description || payload?.msg || payload?.message || "Codigo de autenticacao invalido ou expirado.");
  }
  return payload;
};

/** Server-only provisioning primitive. Never expose this function directly in a public action. */
export const createSupabaseAuthUser = async (
  email: string,
  password: string,
  metadata: Record<string, unknown>,
  options: SupabaseRequestOptions = {},
) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.secretKey) {
    throw new Error("SUPABASE_SECRET_KEY obrigatorio para criar usuarios pelo servidor.");
  }

  const response = await fetchSupabaseAuth(`${config.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: metadata,
    }),
    signal: options.signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || "Erro ao criar usuario no Supabase Auth.");
  }
  return payload;
};

export const updateSupabaseAuthUser = async (
  userId: string,
  input: { password?: string; user_metadata?: Record<string, unknown> },
  options: SupabaseRequestOptions = {},
) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.secretKey) {
    throw new Error("SUPABASE_SECRET_KEY obrigatorio para atualizar usuarios pelo servidor.");
  }

  const body: Record<string, unknown> = {};
  if (input.password) body.password = input.password;
  if (input.user_metadata) body.user_metadata = input.user_metadata;

  const response = await fetchSupabaseAuth(
    `${config.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        apikey: config.secretKey,
        Authorization: `Bearer ${config.secretKey}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || "Erro ao atualizar usuario no Supabase Auth.");
  }
  return payload;
};

export const deleteSupabaseAuthUser = async (
  userId: string,
  options: SupabaseRequestOptions = {},
) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.secretKey) {
    throw new Error("SUPABASE_SECRET_KEY obrigatorio para remover usuarios pelo servidor.");
  }

  const response = await fetchSupabaseAuth(
    `${config.url}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
      headers: {
        apikey: config.secretKey,
        Authorization: `Bearer ${config.secretKey}`,
      },
      signal: options.signal,
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || "Erro ao remover usuario no Supabase Auth.");
  }
  return payload;
};

export const listSupabaseAuthUsers = async (options: SupabaseRequestOptions = {}) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.secretKey) {
    throw new Error("SUPABASE_SECRET_KEY obrigatorio para listar usuarios pelo servidor.");
  }

  const response = await fetchSupabaseAuth(`${config.url}/auth/v1/admin/users?per_page=1000`, {
    headers: {
      apikey: config.secretKey,
      Authorization: `Bearer ${config.secretKey}`,
    },
    signal: options.signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || "Erro ao listar usuarios no Supabase Auth.");
  }
  return Array.isArray(payload?.users) ? payload.users : [];
};

export const sendSupabasePasswordRecoveryEmail = async (
  email: string,
  redirectTo?: string,
  pkce?: { codeChallenge: string; codeChallengeMethod?: "s256" },
  options: SupabaseRequestOptions = {},
) => {
  const config = getSupabaseServerConfig();
  const apiKey = config.publishableKey || config.secretKey;
  if (!config.url || !apiKey) {
    throw new Error("Supabase Auth nao configurado para recuperacao de senha.");
  }

  const url = new URL(`${config.url}/auth/v1/recover`);
  if (redirectTo) url.searchParams.set("redirect_to", redirectTo);

  const response = await fetchSupabaseAuth(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify({
      email,
      code_challenge: pkce?.codeChallenge,
      code_challenge_method: pkce?.codeChallengeMethod || (pkce?.codeChallenge ? "s256" : undefined),
    }),
    signal: options.signal,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || "Erro ao enviar recuperacao de senha pelo Supabase.");
  }
  return payload;
};

export const uploadObjectToSupabaseStorage = async (input: {
  bucket: string;
  path: string;
  bytes: Buffer;
  contentType: string;
  upsert?: boolean;
  signal?: AbortSignal;
}) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.secretKey) return null;

  const cleanPath = input.path.replace(/^\/+/, "");
  const body = input.bytes.buffer.slice(
    input.bytes.byteOffset,
    input.bytes.byteOffset + input.bytes.byteLength,
  ) as ArrayBuffer;

  const response = await fetchSupabaseStorage(
    `${config.url}/storage/v1/object/${encodeURIComponent(input.bucket)}/${cleanPath
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    {
      method: "POST",
      headers: {
        "Content-Type": input.contentType,
        apikey: config.secretKey,
        Authorization: `Bearer ${config.secretKey}`,
        "x-upsert": input.upsert ? "true" : "false",
      },
      body,
      signal: input.signal,
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || "Falha ao enviar arquivo para o Supabase Storage.");
  }
  return payload;
};

export const downloadObjectFromSupabaseStorage = async (
  bucket: string,
  objectPath: string,
  options: SupabaseRequestOptions = {},
) => {
  const config = getSupabaseServerConfig();
  if (!config.url || !config.secretKey) {
    throw new Error("SUPABASE_SECRET_KEY obrigatorio para ler arquivos privados.");
  }

  const cleanPath = objectPath
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const response = await fetchSupabaseStorage(
    `${config.url}/storage/v1/object/${encodeURIComponent(bucket)}/${cleanPath}`,
    {
      headers: {
        apikey: config.secretKey,
        Authorization: `Bearer ${config.secretKey}`,
      },
      signal: options.signal,
    },
  );

  if (!response.ok) return null;
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
};

export const getSupabasePublicObjectUrl = (bucket: string, objectPath: string) => {
  const config = getSupabaseServerConfig();
  if (!config.url) return "";
  const cleanPath = objectPath
    .replace(/^\/+/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `${config.url}/storage/v1/object/public/${encodeURIComponent(bucket)}/${cleanPath}`;
};
