import { query, withTransaction } from "./db";
import type { BackendError, BackendResult, LocalSession, LocalUser } from "@/integrations/backend/compat-types";
import {
  createSupabaseAuthUser,
  fetchSupabaseUserByToken,
  hasSupabaseAdminConfig,
  sendSupabasePasswordRecoveryEmail,
  signInSupabaseUser,
  refreshSupabaseSession,
  signOutSupabaseSession,
  createSupabaseOAuthUrl,
  exchangeSupabaseAuthCode,
  signUpSupabaseUser,
  updateSupabaseAuthUser,
} from "./supabase";

const PLATFORM_ADMIN_ROLES = new Set(["admin", "super_admin"]);

const userFromSupabaseAuthUser = (user: any): LocalUser => ({
  id: user.id,
  email: user.email,
  role: "authenticated",
  app_metadata: user.app_metadata || {},
  user_metadata: user.user_metadata || {},
  created_at: user.created_at,
  updated_at: user.updated_at,
});

const sessionEnvelope = (user: LocalUser, accessToken = ""): LocalSession => ({
  access_token: accessToken,
  token_type: "bearer",
  expires_at: accessToken ? Math.floor(Date.now() / 1000) + 60 * 60 : 0,
  expires_in: accessToken ? 60 * 60 : 0,
  user,
});

const sessionFromSupabasePayload = (payload: any): LocalSession => ({
  access_token: String(payload.access_token || ""),
  refresh_token: payload.refresh_token ? String(payload.refresh_token) : undefined,
  token_type: "bearer",
  expires_at: Number(payload.expires_at || Math.floor(Date.now() / 1000) + Number(payload.expires_in || 3600)),
  expires_in: Number(payload.expires_in || 3600),
  user: userFromSupabaseAuthUser(payload.user),
});

const errorResult = (message: string, code?: string): BackendResult => ({
  data: null,
  error: { message, code } satisfies BackendError,
});

const requireSupabaseAdmin = () => {
  if (!hasSupabaseAdminConfig()) {
    throw new Error("Supabase Admin nao configurado. Defina SUPABASE_SECRET_KEY no servidor.");
  }
};

const PUBLIC_SIGNUP_METADATA_FIELDS = ["full_name", "name", "document", "phone", "avatar_url"] as const;

export const sanitizePublicSignupMetadata = (metadata: Record<string, unknown> = {}): Record<string, unknown> => {
  const safe: Record<string, unknown> = {};
  for (const field of PUBLIC_SIGNUP_METADATA_FIELDS) {
    if (metadata[field] !== undefined) safe[field] = metadata[field];
  }
  return {
    ...safe,
    account_type: "customer",
    role: "customer",
  };
};

export const resolveActorAdmin = (input: {
  email?: string | null;
  profileRole?: string | null;
  profileStoreId?: string | null;
  roleRows?: Array<{ role?: string | null; store_id?: string | null }>;
}) => {
  if (PLATFORM_ADMIN_ROLES.has(String(input.profileRole || "")) && !input.profileStoreId) return true;
  if (input.roleRows?.some((row) => PLATFORM_ADMIN_ROLES.has(String(row.role || "")) && !row.store_id)) return true;
  // E-mail is identity data, not an authorization claim. ADMIN_EMAILS used to
  // turn any account registered with a configured address into platform admin.
  return false;
};

export const getUserByToken = async (token?: string) => {
  const supabaseUser = await fetchSupabaseUserByToken(token);
  return supabaseUser ? userFromSupabaseAuthUser(supabaseUser) : null;
};

export const getActor = async (token?: string) => {
  const user = await getUserByToken(token);
  if (!user) return null;
  const [{ rows: profileRows }, { rows: roleRows }, { rows: storeRows }] = await Promise.all([
    query(
      `SELECT id, user_id, store_id, role, email, full_name, name, phone, is_exempt, created_at, updated_at
       FROM public.profiles
       WHERE user_id = $1
       ORDER BY created_at NULLS LAST
       LIMIT 1`,
      [user.id],
    ),
    query(`SELECT role, store_id FROM public.user_roles WHERE user_id = $1`, [user.id]),
    query(`SELECT id FROM public.stores WHERE owner_user_id = $1`, [user.id]),
  ]);
  const roles = new Set<string>();
  if (profileRows[0]?.role) roles.add(profileRows[0].role);
  for (const row of roleRows) if (row.role) roles.add(row.role);
  const admin = resolveActorAdmin({
    email: user.email,
    profileRole: profileRows[0]?.role,
    profileStoreId: profileRows[0]?.store_id,
    roleRows,
  });
  return {
    user,
    profile: profileRows[0] || null,
    roles,
    admin,
    ownedStoreIds: storeRows.map((row) => row.id),
  };
};

export const signUp = async (
  email: string,
  password: string,
  metadata: Record<string, unknown> = {},
  options: { trustedRole?: boolean } = {},
) => {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || password.length < 6) return errorResult("E-mail e senha de no minimo 6 caracteres sao obrigatorios.");

  try {
    requireSupabaseAdmin();
    // This function is retained for authenticated, server-side provisioning
    // (for example, an admin creating a merchant). Public requests use
    // publicSignUp below and can never reach the Admin API.
    const requestedRole = options.trustedRole === false
      ? "customer"
      : String(metadata.role || metadata.account_type || "customer");
    const role = ["customer", "store_owner"].includes(requestedRole) ? requestedRole : "customer";
    const safeMetadata = {
      ...metadata,
      account_type: role,
      role,
    };
    const supabaseUser = await createSupabaseAuthUser(normalizedEmail, password, safeMetadata);
    const user = userFromSupabaseAuthUser(supabaseUser);
    await ensureApplicationUserRows(user, safeMetadata, role);
    return { data: sessionEnvelope(user), error: null };
  } catch (error: any) {
    if (String(error?.message || "").toLowerCase().includes("already")) {
      return errorResult("Este e-mail ja esta cadastrado.", "email_exists");
    }
    return errorResult(error?.message || "Erro ao criar usuario no Supabase.");
  }
};

export const assertActiveMerchantSubscription = async (
  actor: Awaited<ReturnType<typeof getActor>>,
  requestedStoreId?: string | null,
) => {
  if (!actor) throw new Error("Nao autenticado.");
  if (actor.admin) return;
  if (!actor.roles.has("store_owner")) return;
  const storeId = String(requestedStoreId || actor.profile?.store_id || actor.ownedStoreIds[0] || "");
  if (!storeId || !actor.ownedStoreIds.includes(storeId)) throw new Error("Loja fora do escopo do usuario.");
  const { rows } = await query(
    `SELECT s.is_active, s.is_suspended,
            sub.status, sub.last_payment_status, sub.current_period_end,
            pl.id AS plan_id
     FROM public.stores s
     LEFT JOIN LATERAL (
       SELECT status, last_payment_status, current_period_end, plan_id
       FROM public.subscriptions
       WHERE store_id = s.id
       ORDER BY created_at DESC
       LIMIT 1
     ) sub ON true
     LEFT JOIN public.plans pl ON pl.id = sub.plan_id
     WHERE s.id = $1
     LIMIT 1`,
    [storeId],
  );
  const state = rows[0];
  if (!state || state.is_active === false || state.is_suspended) {
    throw new Error("Loja inativa ou suspensa.");
  }
  if (actor.profile?.is_exempt) return;
  const paidPeriod = state?.status === "cancelada"
    && state.current_period_end
    && new Date(state.current_period_end).getTime() > Date.now();
  const active = state?.plan_id
    && !state.is_suspended
    && (state.status === "ativa" || state.status === "trial" || paidPeriod)
    && !["failed", "past_due"].includes(String(state.last_payment_status || ""));
  if (!active) throw new Error("Assinatura inativa. Regularize o plano para continuar.");
};

export const publicSignUp = async (
  email: string,
  password: string,
  metadata: Record<string, unknown> = {},
  redirectTo?: string,
  pkce?: { codeChallenge: string; codeChallengeMethod?: "s256" },
) => {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || password.length < 6) {
    return errorResult("E-mail e senha de no minimo 6 caracteres sao obrigatorios.");
  }

  try {
    const safeMetadata = sanitizePublicSignupMetadata(metadata);
    const payload = await signUpSupabaseUser(normalizedEmail, password, safeMetadata, redirectTo, pkce);
    const supabaseUser = payload?.user || (payload?.id ? payload : null);
    if (!supabaseUser?.id) throw new Error("Supabase Auth nao retornou o usuario criado.");
    const user = userFromSupabaseAuthUser(supabaseUser);
    await ensureApplicationUserRows(user, safeMetadata, "customer");
    const accessToken = typeof payload?.access_token === "string" ? payload.access_token : "";
    return {
      data: {
        user,
        session: accessToken ? sessionFromSupabasePayload(payload) : null,
      },
      error: null,
    };
  } catch (error: any) {
    if (String(error?.message || "").toLowerCase().includes("already")) {
      return errorResult("Este e-mail ja esta cadastrado.", "email_exists");
    }
    return errorResult(error?.message || "Erro ao criar usuario no Supabase.");
  }
};

export const publicMerchantSignUp = async (
  email: string,
  password: string,
  metadata: Record<string, unknown> = {},
  redirectTo?: string,
  pkce?: { codeChallenge: string; codeChallengeMethod?: "s256" },
) => {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || password.length < 8) {
    return errorResult("E-mail e senha de no minimo 8 caracteres sao obrigatorios.");
  }
  try {
    const safeMetadata: Record<string, unknown> = {};
    for (const field of PUBLIC_SIGNUP_METADATA_FIELDS) {
      if (metadata[field] !== undefined) safeMetadata[field] = metadata[field];
    }
    safeMetadata.account_type = "store_owner";
    safeMetadata.role = "store_owner";
    const payload = await signUpSupabaseUser(normalizedEmail, password, safeMetadata, redirectTo, pkce);
    const supabaseUser = payload?.user || (payload?.id ? payload : null);
    if (!supabaseUser?.id) throw new Error("Supabase Auth nao retornou o usuario criado.");
    const user = userFromSupabaseAuthUser(supabaseUser);
    await ensureApplicationUserRows(user, safeMetadata, "store_owner");
    const accessToken = typeof payload?.access_token === "string" ? payload.access_token : "";
    return { data: { user, session: accessToken ? sessionFromSupabasePayload(payload) : null }, error: null };
  } catch (error: any) {
    return errorResult(error?.message || "Erro ao criar conta de lojista.");
  }
};

const ensureApplicationUserRows = async (
  user: LocalUser,
  metadata: Record<string, unknown>,
  role: string,
) => {
  const safeRole = ["customer", "store_owner"].includes(role) ? role : "customer";
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO public.profiles (user_id, email, full_name, document, role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       email = COALESCE(public.profiles.email, EXCLUDED.email),
       full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
       document = COALESCE(NULLIF(public.profiles.document, ''), EXCLUDED.document),
       role = CASE
         WHEN public.profiles.role IN ('super_admin', 'admin', 'store_owner') THEN public.profiles.role
         ELSE EXCLUDED.role
       END,
       updated_at = now()`,
    [
      user.id,
      user.email || null,
      metadata.full_name ? String(metadata.full_name) : null,
      metadata.document ? String(metadata.document) : null,
      safeRole,
      ],
    );
    await client.query(
      `INSERT INTO public.user_roles (user_id, role)
     SELECT $1, $2
     WHERE NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = $1)
     ON CONFLICT DO NOTHING`,
      [user.id, safeRole],
    );
  });
};

export const signInWithPassword = async (email: string, password: string) => {
  try {
    if (!email.trim() || !password) return errorResult("Informe e-mail e senha.");
    const payload = await signInSupabaseUser(email.trim().toLowerCase(), password);
    const user = userFromSupabaseAuthUser(payload.user);
    await ensureApplicationUserRows(user, user.user_metadata || {}, "customer");
    return { data: { user, session: sessionFromSupabasePayload(payload) }, error: null };
  } catch (error: any) {
    return errorResult(error?.message || "E-mail ou senha incorretos.", "invalid_credentials");
  }
};

export const refreshSession = async (refreshToken: string) => {
  try {
    if (!refreshToken) return errorResult("Refresh token ausente.", "invalid_token");
    const payload = await refreshSupabaseSession(refreshToken);
    return { data: { user: userFromSupabaseAuthUser(payload.user), session: sessionFromSupabasePayload(payload) }, error: null };
  } catch (error: any) {
    return errorResult(error?.message || "Sessao expirada.", "invalid_token");
  }
};

export const signOut = async (token: string) => {
  try {
    await signOutSupabaseSession(token);
    return { data: { signedOut: true }, error: null };
  } catch (error: any) {
    return errorResult(error?.message || "Erro ao sair.");
  }
};

const configuredAppOrigins = () => {
  const values = [
    process.env.PUBLIC_APP_URL || "http://localhost:3000",
    process.env.PARTNER_APP_URL,
    ...(process.env.APP_ALLOWED_ORIGINS || "").split(","),
  ].filter(Boolean) as string[];
  return new Set(values.map((value) => new URL(value).origin));
};

const safeAppRedirect = (value: string, fallbackPath = "/") => {
  const configured = new URL(process.env.PUBLIC_APP_URL || "http://localhost:3000");
  const candidate = new URL(value || fallbackPath, configured.origin);
  const loopback = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(candidate.hostname);
  if (!configuredAppOrigins().has(candidate.origin) && !loopback) throw new Error("Redirect de autenticacao invalido.");
  if (!candidate.pathname.startsWith("/") || candidate.username || candidate.password) throw new Error("Redirect de autenticacao invalido.");
  return candidate.toString();
};

type PkceContext = {
  codeChallenge: string;
  callbackUrl: string;
  codeVerifier?: string;
};

export const getOAuthUrl = (provider: string, redirectTo: string, pkce?: PkceContext) => {
  if (provider !== "google" && provider !== "apple") return errorResult("Provedor OAuth invalido.");
  try {
    if (!pkce?.codeChallenge) throw new Error("Fluxo PKCE obrigatorio para OAuth.");
    return {
      data: {
        url: createSupabaseOAuthUrl(provider, safeAppRedirect(pkce.callbackUrl), {
          codeChallenge: pkce.codeChallenge,
          codeChallengeMethod: "s256",
        }),
        next: safeAppRedirect(redirectTo),
      },
      error: null,
    };
  } catch (error: any) {
    return errorResult(error?.message || "OAuth indisponivel.");
  }
};

export const exchangeOAuthCode = async (code: string, pkce?: PkceContext, intentRole: "customer" | "store_owner" = "customer") => {
  try {
    if (!pkce?.codeVerifier) return errorResult("Fluxo de autenticacao ausente ou expirado.", "invalid_pkce_flow");
    const payload = await exchangeSupabaseAuthCode(code, pkce.codeVerifier);
    const user = userFromSupabaseAuthUser(payload.user);
    await ensureApplicationUserRows(user, user.user_metadata || {}, intentRole);
    return { data: { user, session: sessionFromSupabasePayload(payload) }, error: null };
  } catch (error: any) {
    return errorResult(error?.message || "Codigo de autenticacao invalido ou expirado.", "invalid_auth_code");
  }
};

export const sessionFromToken = async (token: string) => {
  const user = await getUserByToken(token);
  if (!user) return errorResult("Sessao invalida ou expirada.", "invalid_token");
  await ensureApplicationUserRows(user, user.user_metadata || {}, "customer");
  return { data: sessionEnvelope(user, token), error: null };
};

export const updateUser = async (token: string, input: { password?: string; data?: Record<string, unknown> }) => {
  try {
    requireSupabaseAdmin();
    const user = await getUserByToken(token);
    if (!user) return errorResult("Sessao invalida.", "unauthorized");
    const updated = await updateSupabaseAuthUser(user.id, {
      password: input.password,
      user_metadata: input.data ? { ...(user.user_metadata || {}), ...input.data } : undefined,
    });
    return { data: sessionEnvelope(userFromSupabaseAuthUser(updated), token), error: null };
  } catch (error: any) {
    return errorResult(error?.message || "Erro ao atualizar usuario no Supabase.");
  }
};

export const resetPasswordForEmail = async (email: string, redirectTo?: string, pkce?: PkceContext) => {
  try {
    const safeRedirect = redirectTo ? safeAppRedirect(redirectTo, "/redefinir-senha") : undefined;
    await sendSupabasePasswordRecoveryEmail(
      email.trim().toLowerCase(),
      safeRedirect,
      pkce?.codeChallenge ? { codeChallenge: pkce.codeChallenge, codeChallengeMethod: "s256" } : undefined,
    );
    return { data: { sent: true }, error: null };
  } catch (error: any) {
    return errorResult(error?.message || "Erro ao enviar recuperacao de senha.");
  }
};

export const getClaims = async (token?: string) => {
  const user = await getUserByToken(token);
  if (!user) return errorResult("Token invalido.", "invalid_token");
  return {
    data: {
      claims: {
        sub: user.id,
        email: user.email,
        role: "authenticated",
        user_metadata: user.user_metadata || {},
        app_metadata: user.app_metadata || {},
      },
    },
    error: null,
  };
};

export type AuthActionContext = { pkce?: PkceContext; intentRole?: "customer" | "store_owner" };

export const handleAuthAction = async (action: string, body: any, token?: string, context: AuthActionContext = {}) => {
  switch (action) {
    case "signUp":
      return publicSignUp(
        String(body.email || ""),
      String(body.password || ""),
      body.data || {},
      context.pkce?.callbackUrl,
      context.pkce?.codeChallenge ? { codeChallenge: context.pkce.codeChallenge, codeChallengeMethod: "s256" } : undefined,
      );
    case "signUpMerchant":
      return publicMerchantSignUp(
        String(body.email || ""),
        String(body.password || ""),
        body.data || {},
        context.pkce?.callbackUrl,
        context.pkce?.codeChallenge ? { codeChallenge: context.pkce.codeChallenge, codeChallengeMethod: "s256" } : undefined,
      );
    case "signInWithPassword":
      return signInWithPassword(String(body.email || ""), String(body.password || ""));
    case "refreshSession":
      return refreshSession(String(body.refreshToken || ""));
    case "signOut":
      return signOut(String(token || body.token || ""));
    case "getOAuthUrl":
      return getOAuthUrl(String(body.provider || ""), String(body.redirectTo || ""), context.pkce);
    case "exchangeOAuthCode":
      return exchangeOAuthCode(String(body.code || ""), context.pkce, context.intentRole);
    case "sessionFromToken":
      return sessionFromToken(String(token || ""));
    case "updateUser":
      return updateUser(token || "", { password: body.password, data: body.data });
    case "resetPasswordForEmail":
      return resetPasswordForEmail(String(body.email || ""), context.pkce?.callbackUrl, context.pkce);
    case "getClaims":
      return getClaims(String(body.token || token || ""));
    default:
      return errorResult("Acao de autenticacao desconhecida.");
  }
};
