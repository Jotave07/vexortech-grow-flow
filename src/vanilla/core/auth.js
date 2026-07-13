import { api, setSessionExpiredHandler, setTokenProvider } from "./api.js";

const listeners = new Set();

const state = {
  session: null,
  profile: null,
  roles: new Set(),
  stores: [],
  identityReady: false,
  callbackError: null,
  ready: false,
};

const notify = () => listeners.forEach((listener) => listener(auth));

const loadIdentity = async () => {
  state.profile = null;
  state.roles = new Set();
  state.stores = [];
  state.identityReady = false;
  const userId = state.session?.user?.id;
  if (!userId) { state.identityReady = true; return; }
  const [profileResult, roleResult, storesResult] = await Promise.all([
    api.from("profiles").select("*").eq("user_id", userId).maybeSingle(),
    api.from("user_roles").select("role,store_id").eq("user_id", userId),
    api.from("stores").select("*").eq("owner_user_id", userId),
  ]);
  const identityError = profileResult.error || roleResult.error || storesResult.error;
  if (identityError) throw new Error(identityError.message || "Nao foi possivel validar as permissoes da conta.");
  state.profile = profileResult.data || null;
  for (const row of roleResult.data || []) if (row.role) state.roles.add(row.role);
  if (state.profile?.role) state.roles.add(state.profile.role);
  state.stores = storesResult.data || [];
  state.identityReady = true;
};

const setSession = async (session) => {
  state.session = session || null;
  await loadIdentity();
  notify();
};

// Authentication is carried by same-origin HttpOnly cookies. Tokens are never
// persisted in Web Storage or exposed through the public auth state.
setTokenProvider(() => null);
setSessionExpiredHandler(() => { void setSession(null); });

const safeNext = (value, fallback = "/") => {
  try {
    const target = new URL(value || fallback, location.origin);
    return target.origin === location.origin ? `${target.pathname}${target.search}${target.hash}` : fallback;
  } catch { return fallback; }
};

const clearLegacyBrowserSessions = () => {
  try {
    sessionStorage.removeItem("hype.session.v1");
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key && /^sb-.*-auth-token$/i.test(key)) localStorage.removeItem(key);
    }
    localStorage.removeItem("hype_delivery.oauth_context");
  } catch { /* storage may be disabled; cookie auth still works */ }
};

export const auth = {
  get session() { return state.session; },
  get user() { return state.session?.user || null; },
  get profile() { return state.profile; },
  get roles() { return new Set(state.roles); },
  get role() {
    if (state.roles.has("super_admin") || state.roles.has("admin")) return "super_admin";
    if (state.roles.has("store_owner")) return "store_owner";
    if (state.roles.has("customer")) return "customer";
    return null;
  },
  get stores() { return [...state.stores]; },
  get store() { return state.stores[0] || null; },
  get callbackError() { return state.callbackError; },
  get ready() { return state.ready; },
  async init() {
    clearLegacyBrowserSessions();
    state.session = null;
    state.callbackError = null;
    const callbackUrl = new URL(location.href);
    const callbackCode = callbackUrl.searchParams.get("code");
    const providerError = callbackUrl.searchParams.get("error_description") || callbackUrl.searchParams.get("error");
    if (callbackCode || providerError || /(?:^|&)access_token=|(?:^|&)refresh_token=/.test(location.hash.slice(1))) {
      for (const key of ["code", "error", "error_code", "error_description"]) callbackUrl.searchParams.delete(key);
      history.replaceState({}, "", `${callbackUrl.pathname}${callbackUrl.search}`);
    }
    if (providerError) state.callbackError = "A autenticacao externa foi cancelada ou expirou. Tente novamente.";
    if (callbackCode) {
      const checked = await api.auth("exchangeOAuthCode", { code: callbackCode });
      if (!checked.error && checked.data?.session) {
        state.session = checked.data.session;
        history.replaceState({}, "", safeNext(checked.data.next, "/"));
      } else {
        state.callbackError = checked.error?.message || "Nao foi possivel concluir a autenticacao externa.";
        history.replaceState({}, "", "/entrar");
      }
    }
    if (!state.session) {
      const checked = await api.auth("sessionFromToken");
      if (!checked.error && checked.data?.session) state.session = checked.data.session;
    }
    try { await loadIdentity(); }
    catch (error) { state.callbackError ||= error?.message || "Nao foi possivel validar esta sessao."; }
    state.ready = true;
    notify();
    return auth;
  },
  hasRole(role) {
    if (!role) return true;
    if (!state.session || !state.identityReady) return false;
    if (role === "super_admin") return state.roles.has("super_admin") || state.roles.has("admin");
    if (role === "store_owner") return state.roles.has("store_owner") || state.roles.has("super_admin") || state.roles.has("admin");
    if (role === "customer") return state.roles.has("customer");
    return false;
  },
  require(role) { return auth.hasRole(role); },
  async signIn(email, password) {
    const result = await api.auth("signInWithPassword", { email, password });
    if (!result.error) await setSession(result.data?.session || null);
    return result;
  },
  async signUp(input) {
    const result = await api.auth("signUp", input);
    if (!result.error && result.data?.session) await setSession(result.data.session);
    return result;
  },
  async signUpMerchant(input) {
    const result = await api.auth("signUpMerchant", input);
    if (!result.error && result.data?.session) await setSession(result.data.session);
    return result;
  },
  resetPassword(email, redirectTo) { return api.auth("resetPasswordForEmail", { email, redirectTo }); },
  async oauth(provider, redirectTo = location.origin, context = "customer") {
    const result = await api.auth("getOAuthUrl", { provider, redirectTo, context });
    if (!result.error && result.data?.url) location.assign(result.data.url);
    return result;
  },
  async updateUser(input) {
    const result = await api.auth("updateUser", input);
    if (!result.error && result.data) await setSession({ ...state.session, ...result.data });
    return result;
  },
  async refresh() {
    const result = await api.auth("refreshSession");
    if (result.error || !result.data?.session) {
      await setSession(null);
      return auth;
    }
    state.session = result.data.session;
    await loadIdentity();
    notify();
    return auth;
  },
  async signOut() {
    const result = await api.auth("signOut");
    if (result.error) return result;
    await setSession(null);
    return result;
  },
  subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
};
