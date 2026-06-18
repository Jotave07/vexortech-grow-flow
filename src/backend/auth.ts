import { query } from "./db";
import type { BackendError, BackendResult, LocalSession, LocalUser } from "@/integrations/backend/compat-types";
import {
  createSupabaseAuthUser,
  fetchSupabaseUserByToken,
  hasSupabaseAdminConfig,
  sendSupabasePasswordRecoveryEmail,
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

const errorResult = (message: string, code?: string): BackendResult => ({
  data: null,
  error: { message, code } satisfies BackendError,
});

const configuredAdminEmails = () =>
  new Set(
    String(process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );

const requireSupabaseAdmin = () => {
  if (!hasSupabaseAdminConfig()) {
    throw new Error("Supabase Admin nao configurado. Defina SUPABASE_SECRET_KEY no servidor.");
  }
};

export const sanitizePublicSignupMetadata = (metadata: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...metadata,
  account_type: "customer",
  role: "customer",
});

export const resolveActorAdmin = (input: {
  email?: string | null;
  profileRole?: string | null;
  profileStoreId?: string | null;
  roleRows?: Array<{ role?: string | null; store_id?: string | null }>;
}) => {
  if (PLATFORM_ADMIN_ROLES.has(String(input.profileRole || "")) && !input.profileStoreId) return true;
  if (input.roleRows?.some((row) => PLATFORM_ADMIN_ROLES.has(String(row.role || "")) && !row.store_id)) return true;
  const email = String(input.email || "").trim().toLowerCase();
  return Boolean(email && configuredAdminEmails().has(email));
};

export const getUserByToken = async (token?: string) => {
  const supabaseUser = await fetchSupabaseUserByToken(token);
  return supabaseUser ? userFromSupabaseAuthUser(supabaseUser) : null;
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
    const safeMetadata = options.trustedRole ? metadata : sanitizePublicSignupMetadata(metadata);
    const role = String(safeMetadata.role || safeMetadata.account_type || "customer");
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

const ensureApplicationUserRows = async (
  user: LocalUser,
  metadata: Record<string, unknown>,
  role: string,
) => {
  const safeRole = ["customer", "store_owner"].includes(role) ? role : "customer";
  await query(
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
  ).catch(() => null);
  await query(
    `INSERT INTO public.user_roles (user_id, role)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [user.id, safeRole],
  ).catch(() => null);
};

export const signInWithPassword = async () =>
  errorResult("Login por senha e executado diretamente pelo Supabase Auth no navegador.", "supabase_auth_required");

export const sessionFromToken = async (token: string) => {
  const user = await getUserByToken(token);
  if (!user) return errorResult("Sessao invalida ou expirada.", "invalid_token");
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

export const resetPasswordForEmail = async (email: string, redirectTo?: string) => {
  try {
    await sendSupabasePasswordRecoveryEmail(email.trim().toLowerCase(), redirectTo);
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

export const handleAuthAction = async (action: string, body: any, token?: string) => {
  switch (action) {
    case "signUp":
      return signUp(String(body.email || ""), String(body.password || ""), body.data || {});
    case "signInWithPassword":
      return signInWithPassword();
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
