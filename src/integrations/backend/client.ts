import type {
  AuthChangeEvent,
  AuthStateCallback,
  BackendResult,
  LocalSession,
  OAuthProvider,
  QueryPayload,
} from "./compat-types";
import { LocalQueryBuilder } from "./query-builder";
import {
  getSupabaseBrowserClient,
  getSupabasePublicStorageUrl,
  hasSupabaseBrowserConfig,
} from "@/integrations/supabase/client";

const SESSION_KEY = "hype_delivery.session";
const API_PATH = "/api/backend";
const REQUEST_TIMEOUT_MS = 70_000;

const authListeners = new Set<AuthStateCallback>();

const isBrowser = () => typeof window !== "undefined";

const readSession = (): LocalSession | null => {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as LocalSession;
    if (!session?.access_token || !session?.expires_at) return null;
    if (session.expires_at <= Math.floor(Date.now() / 1000)) {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
};

const writeSession = (session: LocalSession | null) => {
  if (!isBrowser()) return;
  if (session) window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else window.localStorage.removeItem(SESSION_KEY);
};

const emitAuth = (event: AuthChangeEvent, session: LocalSession | null) => {
  for (const listener of authListeners) listener(event, session);
};

const readAuthSession = async (): Promise<LocalSession | null> => {
  const supabase = getSupabaseBrowserClient();
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    return (data.session as LocalSession | null) ?? null;
  }
  return readSession();
};

const authHeader = async (): Promise<Record<string, string>> => {
  const token = (await readAuthSession())?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const createRequestTimeout = () => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeoutId),
  };
};

const jsonRequest = async <T = any>(payload: Record<string, unknown>): Promise<T> => {
  const timeout = createRequestTimeout();
  try {
    const response = await fetch(API_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(await authHeader()),
      },
      body: JSON.stringify(payload),
      signal: timeout.signal,
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        data: null,
        error: { message: body?.error || body?.message || "Erro na API local" },
      } as T;
    }
    return body as T;
  } catch (error: any) {
    return {
      data: null,
      error: {
        message:
          error?.name === "AbortError"
            ? "A API local demorou demais para responder. Tente novamente."
            : error?.message || "Falha ao comunicar com a API local.",
      },
    } as T;
  } finally {
    timeout.clear();
  }
};

const maybeRecoverSessionFromUrl = async () => {
  if (hasSupabaseBrowserConfig) return readAuthSession();
  if (!isBrowser()) return readSession();
  const current = readSession();
  if (current) return current;

  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search);
  const token = hashParams.get("access_token") || queryParams.get("access_token");
  if (!token) return null;

  const result = await jsonRequest<BackendResult<LocalSession>>({
    kind: "auth",
    action: "sessionFromToken",
    token,
  });

  if (result.data) {
    writeSession(result.data);
    emitAuth("PASSWORD_RECOVERY", result.data);
    window.history.replaceState({}, document.title, window.location.pathname);
    return result.data;
  }

  return null;
};

const normalizeAuthEvent = (event: string): AuthChangeEvent => {
  if (
    event === "INITIAL_SESSION" ||
    event === "SIGNED_IN" ||
    event === "SIGNED_OUT" ||
    event === "TOKEN_REFRESHED" ||
    event === "USER_UPDATED" ||
    event === "PASSWORD_RECOVERY"
  ) {
    return event;
  }
  return "SIGNED_IN";
};

class SupabaseAuthClient {
  private get client() {
    const client = getSupabaseBrowserClient();
    if (!client) throw new Error("Supabase nao configurado.");
    return client;
  }

  onAuthStateChange(callback: AuthStateCallback) {
    const { data } = this.client.auth.onAuthStateChange((event, session) => {
      callback(normalizeAuthEvent(event), (session as LocalSession | null) ?? null);
    });
    return { data };
  }

  async getSession() {
    const { data, error } = await this.client.auth.getSession();
    return {
      data: { session: (data.session as LocalSession | null) ?? null },
      error,
    };
  }

  async signInWithPassword(input: { email: string; password: string }) {
    const { data, error } = await this.client.auth.signInWithPassword(input);
    return {
      data: {
        user: (data.user as any) ?? null,
        session: (data.session as LocalSession | null) ?? null,
      },
      error,
    };
  }

  async signUp(input: {
    email: string;
    password: string;
    options?: { data?: Record<string, unknown>; emailRedirectTo?: string };
  }) {
    const { data, error } = await this.client.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: input.options?.data || {},
        emailRedirectTo:
          input.options?.emailRedirectTo ||
          (isBrowser() ? `${window.location.origin}/entrar` : undefined),
      },
    });
    return {
      data: {
        user: (data.user as any) ?? null,
        session: (data.session as LocalSession | null) ?? null,
      },
      error,
    };
  }

  async signInWithOAuth(input: {
    provider: OAuthProvider;
    options?: { redirectTo?: string; queryParams?: Record<string, string> };
  }) {
    return this.client.auth.signInWithOAuth({
      provider: input.provider,
      options: {
        redirectTo: input.options?.redirectTo,
        queryParams: input.options?.queryParams,
      },
    });
  }

  async signOut() {
    return this.client.auth.signOut();
  }

  async updateUser(input: { password?: string; data?: Record<string, unknown> }) {
    const { data, error } = await this.client.auth.updateUser(input);
    return { data: { user: (data.user as any) ?? null }, error };
  }

  async resetPasswordForEmail(email: string, options?: { redirectTo?: string }) {
    return this.client.auth.resetPasswordForEmail(email, {
      redirectTo: options?.redirectTo,
    });
  }

  async getClaims(token?: string) {
    const auth: any = this.client.auth;
    if (typeof auth.getClaims === "function") {
      const result = token ? await auth.getClaims(token) : await auth.getClaims();
      return {
        data: { claims: result.data?.claims ?? null },
        error: result.error,
      };
    }
    const { data, error } = await this.client.auth.getUser(token);
    return {
      data: { claims: data.user ? { sub: data.user.id, email: data.user.email } : null },
      error,
    };
  }
}

class LocalAuthClient {
  onAuthStateChange(callback: AuthStateCallback) {
    authListeners.add(callback);
    setTimeout(() => callback("INITIAL_SESSION", readSession()), 0);
    return {
      data: {
        subscription: {
          unsubscribe: () => authListeners.delete(callback),
        },
      },
    };
  }

  async getSession() {
    const session = await maybeRecoverSessionFromUrl();
    return { data: { session }, error: null };
  }

  async signInWithPassword(input: { email: string; password: string }) {
    const result = await jsonRequest<BackendResult<LocalSession>>({
      kind: "auth",
      action: "signInWithPassword",
      email: input.email,
      password: input.password,
    });
    if (result.data) {
      writeSession(result.data);
      emitAuth("SIGNED_IN", result.data);
    }
    return {
      data: { user: result.data?.user ?? null, session: result.data ?? null },
      error: result.error,
    };
  }

  async signUp(input: {
    email: string;
    password: string;
    options?: { data?: Record<string, unknown> };
  }) {
    const result = await jsonRequest<BackendResult<LocalSession>>({
      kind: "auth",
      action: "signUp",
      email: input.email,
      password: input.password,
      data: input.options?.data || {},
    });
    if (result.data) {
      writeSession(result.data);
      emitAuth("SIGNED_IN", result.data);
    }
    return {
      data: { user: result.data?.user ?? null, session: result.data ?? null },
      error: result.error,
    };
  }

  async signOut() {
    writeSession(null);
    emitAuth("SIGNED_OUT", null);
    return { error: null };
  }

  async updateUser(input: { password?: string; data?: Record<string, unknown> }) {
    const result = await jsonRequest<BackendResult<LocalSession>>({
      kind: "auth",
      action: "updateUser",
      ...input,
    });
    if (result.data) {
      writeSession(result.data);
      emitAuth("USER_UPDATED", result.data);
    }
    return { data: { user: result.data?.user ?? null }, error: result.error };
  }

  async resetPasswordForEmail(email: string, options?: { redirectTo?: string }) {
    return jsonRequest<BackendResult<{ sent: boolean }>>({
      kind: "auth",
      action: "resetPasswordForEmail",
      email,
      redirectTo: options?.redirectTo,
    });
  }

  async getClaims(token?: string) {
    return jsonRequest<BackendResult<{ claims: Record<string, unknown> }>>({
      kind: "auth",
      action: "getClaims",
      token,
    });
  }

  async signInWithOAuth(_input: {
    provider: OAuthProvider;
    options?: { redirectTo?: string; queryParams?: Record<string, string> };
  }) {
    return {
      data: null,
      error: { message: "Login social requer Supabase configurado." },
    };
  }
}

class LocalStorageBucket {
  constructor(private readonly bucket: string) {}

  async upload(path: string, file: File | Blob, options?: { upsert?: boolean }) {
    const form = new FormData();
    form.set("kind", "storage");
    form.set("action", "upload");
    form.set("bucket", this.bucket);
    form.set("path", path);
    form.set("upsert", options?.upsert ? "true" : "false");
    form.set("file", file);

    const timeout = createRequestTimeout();
    try {
      const response = await fetch(API_PATH, {
        method: "POST",
        headers: await authHeader(),
        body: form,
        signal: timeout.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        return { data: null, error: { message: body?.error || "Falha ao enviar arquivo" } };
      return body;
    } catch (error: any) {
      return {
        data: null,
        error: {
          message:
            error?.name === "AbortError"
              ? "O envio demorou demais para responder. Tente novamente."
              : error?.message || "Falha ao enviar arquivo",
        },
      };
    } finally {
      timeout.clear();
    }
  }

  getPublicUrl(path: string) {
    const supabaseUrl = getSupabasePublicStorageUrl(this.bucket, path);
    if (supabaseUrl) return { data: { publicUrl: supabaseUrl } };

    const cleanPath = path.split("/").map(encodeURIComponent).join("/");
    const origin = isBrowser() ? window.location.origin : "";
    return {
      data: { publicUrl: `${origin}/storage/${encodeURIComponent(this.bucket)}/${cleanPath}` },
    };
  }
}

class LocalRealtimeChannel {
  private handlers: Array<{ filter: any; callback: (payload: any) => void }> = [];
  private source?: EventSource;

  constructor(private readonly name: string) {}

  on(_event: "postgres_changes", filter: any, callback: (payload: any) => void) {
    this.handlers.push({ filter, callback });
    return this;
  }

  subscribe(callback?: (status: string) => void) {
    if (!isBrowser()) return this;
    void (async () => {
      const token = (await readAuthSession())?.access_token || "";
      const url = new URL(`${window.location.origin}${API_PATH}`);
      url.searchParams.set("stream", "realtime");
      url.searchParams.set("channel", this.name);
      const firstFilter = this.handlers[0]?.filter;
      if (firstFilter?.table) url.searchParams.set("table", String(firstFilter.table));
      if (firstFilter?.event) url.searchParams.set("event", String(firstFilter.event));
      if (firstFilter?.filter) url.searchParams.set("filter", String(firstFilter.filter));
      if (token) url.searchParams.set("token", token);
      this.source = new EventSource(url.toString());
      this.source.onopen = () => callback?.("SUBSCRIBED");
      this.source.onerror = () => callback?.("CHANNEL_ERROR");
      this.source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          for (const handler of this.handlers) {
            if (matchesRealtimeFilter(handler.filter, payload)) handler.callback(payload);
          }
        } catch {
          // Ignore malformed heartbeat/event frames.
        }
      };
    })();
    return this;
  }

  close() {
    this.source?.close();
  }
}

const matchesRealtimeFilter = (filter: any, payload: any) => {
  if (!filter) return true;
  if (filter.schema && filter.schema !== payload.schema) return false;
  if (filter.table && filter.table !== payload.table) return false;
  if (filter.event && filter.event !== "*" && filter.event !== payload.eventType) return false;
  if (filter.filter) {
    const [column, value] = String(filter.filter).split("=eq.");
    if (column && value && String(payload.new?.[column] ?? payload.old?.[column]) !== value)
      return false;
  }
  return true;
};

const executeQuery = (payload: QueryPayload) =>
  jsonRequest<BackendResult<any>>({
    kind: "query",
    query: payload,
  });

const backendClient = {
  auth: hasSupabaseBrowserConfig ? new SupabaseAuthClient() : new LocalAuthClient(),
  from(table: string) {
    return new LocalQueryBuilder(table, executeQuery);
  },
  rpc(name: string, args?: Record<string, unknown>) {
    return jsonRequest<BackendResult<any>>({ kind: "rpc", name, args: args || {} });
  },
  storage: {
    from(bucket: string) {
      return new LocalStorageBucket(bucket);
    },
  },
  functions: {
    invoke(name: string, options?: { body?: unknown }) {
      return jsonRequest<BackendResult<any>>({
        kind: "function",
        name,
        body: options?.body || {},
      });
    },
  },
  channel(name: string) {
    return new LocalRealtimeChannel(name);
  },
  removeChannel(channel: LocalRealtimeChannel) {
    channel.close();
    return Promise.resolve("ok");
  },
};

export const backend = backendClient;
