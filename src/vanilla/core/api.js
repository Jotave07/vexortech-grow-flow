const API_PATH = "/api/backend";
const REQUEST_TIMEOUT_MS = 30_000;

let tokenProvider = () => null;
let sessionExpiredHandler = () => undefined;
let refreshPromise = null;
export const setTokenProvider = (provider) => { tokenProvider = provider; };
export const setSessionExpiredHandler = (handler) => { sessionExpiredHandler = handler || (() => undefined); };

const messageOf = (body, fallback = "Erro na API.") => {
  const candidate = body?.error?.message || body?.error || body?.message;
  return typeof candidate === "string" && candidate.trim() ? candidate : fallback;
};

const requiresRefresh = (body) => /sess[aãa]o.*expir|n[aãa]o autenticad|invalid_token|jwt|token inv[aáa]lid/i.test(messageOf(body, ""));

const errorEnvelope = (error) => ({
  data: null,
  error: {
    message: error?.name === "AbortError"
      ? "A solicitacao demorou demais. Tente novamente."
      : error?.message || "Falha ao comunicar com o servidor.",
  },
});

const request = async (payload, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || REQUEST_TIMEOUT_MS);
  try {
    const token = tokenProvider();
    const response = await fetch(API_PATH, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!options.skipRefresh && payload.kind !== "auth" && requiresRefresh(body)) {
      refreshPromise ||= request({ kind: "auth", action: "refreshSession" }, { skipRefresh: true })
        .finally(() => { refreshPromise = null; });
      const refreshed = await refreshPromise;
      if (!refreshed?.error) return request(payload, { ...options, skipRefresh: true });
      sessionExpiredHandler();
    }
    if (!response.ok) return { data: null, error: { message: messageOf(body) } };
    return body;
  } catch (error) {
    return errorEnvelope(error);
  } finally {
    clearTimeout(timeout);
  }
};

class QueryBuilder {
  constructor(table) {
    this.payload = { table, operation: "select", select: "*", filters: [], orders: [] };
  }
  select(columns = "*", selectOptions) { this.payload.select = columns; this.payload.selectOptions = selectOptions; this.payload.returning = true; return this; }
  insert(values) { this.payload.operation = "insert"; this.payload.values = values; return this; }
  update(values) { this.payload.operation = "update"; this.payload.values = values; return this; }
  delete() { this.payload.operation = "delete"; return this; }
  upsert(values, upsertOptions) { this.payload.operation = "upsert"; this.payload.values = values; this.payload.upsertOptions = upsertOptions; return this; }
  eq(column, value) { this.payload.filters.push({ op: "eq", column, value }); return this; }
  neq(column, value) { this.payload.filters.push({ op: "neq", column, value }); return this; }
  gt(column, value) { this.payload.filters.push({ op: "gt", column, value }); return this; }
  gte(column, value) { this.payload.filters.push({ op: "gte", column, value }); return this; }
  lt(column, value) { this.payload.filters.push({ op: "lt", column, value }); return this; }
  lte(column, value) { this.payload.filters.push({ op: "lte", column, value }); return this; }
  is(column, value) { this.payload.filters.push({ op: "is", column, value }); return this; }
  in(column, values) { this.payload.filters.push({ op: "in", column, values: [...values] }); return this; }
  ilike(column, pattern) { this.payload.filters.push({ op: "ilike", column, pattern }); return this; }
  or(filters) { if (!Array.isArray(filters) || !filters.length) throw new TypeError("Filtro OR invalido."); this.payload.filters.push({ op: "or", filters: [...filters] }); return this; }
  and(filters) { if (!Array.isArray(filters) || !filters.length) throw new TypeError("Filtro AND invalido."); this.payload.filters.push({ op: "and", filters: [...filters] }); return this; }
  order(column, options = {}) { this.payload.orders.push({ column, ...options }); return this; }
  limit(limit) { this.payload.limit = Math.max(1, Number(limit)); return this; }
  single() { this.payload.single = "single"; return this; }
  maybeSingle() { this.payload.single = "maybeSingle"; return this; }
  execute() { return request({ kind: "query", query: this.payload }); }
  then(resolve, reject) { return this.execute().then(resolve, reject); }
}

const upload = async (bucket, path, file, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const form = new FormData();
    form.set("kind", "storage");
    form.set("action", "upload");
    form.set("bucket", bucket);
    form.set("path", path);
    form.set("upsert", options.upsert ? "true" : "false");
    form.set("file", file);
    const token = tokenProvider();
    const response = await fetch(API_PATH, {
      method: "POST",
      credentials: "same-origin",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    return response.ok ? body : { data: null, error: { message: body.error || "Falha no upload." } };
  } catch (error) {
    return errorEnvelope(error);
  } finally {
    clearTimeout(timeout);
  }
};

const stream = ({ table, event = "*", filter, publicToken, onMessage, onStatus }) => {
  const controller = new AbortController();
  const url = new URL(API_PATH, window.location.origin);
  url.searchParams.set("stream", "realtime");
  if (table) url.searchParams.set("table", table);
  if (event) url.searchParams.set("event", event);
  if (filter) url.searchParams.set("filter", filter);
  void (async () => {
    try {
      const token = tokenProvider();
      const response = await fetch(url, {
        credentials: "same-origin",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(publicToken ? { "X-Realtime-Public-Token": publicToken } : {}),
        },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error("Canal indisponivel.");
      onStatus?.("connected");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || "";
        for (const frame of frames) {
          const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
          if (data) try { onMessage?.(JSON.parse(data)); } catch { /* malformed server frame */ }
        }
      }
    } catch (error) {
      if (error?.name !== "AbortError") onStatus?.("error", error);
    }
  })();
  return () => controller.abort();
};

export const api = {
  from: (table) => new QueryBuilder(table),
  fn: (name, body = {}) => request({ kind: "function", name, body }, { timeout: 70_000 }),
  rpc: (name, args = {}) => request({ kind: "rpc", name, args }),
  auth: (action, body = {}) => request({ kind: "auth", action, ...body }),
  upload,
  stream,
};
