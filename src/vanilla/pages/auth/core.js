// A folha `styles.css` e carregada estaticamente pelo entrypoint para respeitar a CSP.
const ensureAuthStyles = () => {};

const appendChild = (doc, parent, child) => {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) return child.forEach((item) => appendChild(doc, parent, item));
  parent.append(child?.nodeType ? child : doc.createTextNode(String(child)));
};

export function h(ctx, tag, attributes = {}, ...children) {
  const doc = ctx.ui?.document ?? globalThis.document;
  if (!doc) throw new Error("Um document DOM e obrigatorio para renderizar autenticacao.");
  const node = ctx.ui?.el?.(tag) ?? doc.createElement(tag);
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "htmlFor") node.htmlFor = value;
    else if (["checked", "disabled", "required", "selected", "value"].includes(key))
      node[key] = value;
    else if (key.startsWith("on") && typeof value === "function")
      node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  children.forEach((child) => appendChild(doc, node, child));
  return node;
}

export function requireAuthContext(ctx, { api = false } = {}) {
  if (!ctx?.auth) throw new Error("ctx.auth e obrigatorio.");
  if (!ctx?.ui) throw new Error("ctx.ui e obrigatorio.");
  if (typeof ctx.navigate !== "function") throw new Error("ctx.navigate(path) e obrigatorio.");
  if (api && !ctx.api?.from) throw new Error("ctx.api.from(table) e obrigatorio.");
  return ctx;
}

export function link(ctx, label, path, className = "auth-link") {
  return h(
    ctx,
    "a",
    {
      href: path,
      className,
      onClick: (event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        ctx.navigate(path);
      },
    },
    label,
  );
}

export function field(ctx, options) {
  const wrapper = ctx.ui.formField?.(options);
  if (wrapper) return wrapper;
  const id = `auth-${options.name}-${Math.random().toString(36).slice(2, 8)}`;
  const input = h(ctx, "input", { id, ...options });
  return h(
    ctx,
    "div",
    { className: "field" },
    h(ctx, "label", { htmlFor: id }, options.label),
    input,
    options.help ? h(ctx, "p", { className: "field__help" }, options.help) : null,
    h(ctx, "p", { className: "field__error", "aria-live": "polite" }),
  );
}

export function controlOf(wrapper, name) {
  return wrapper.querySelector(`[name="${name}"]`);
}

export function setFieldError(ctx, control, message = "") {
  if (ctx.ui.setFieldError) return ctx.ui.setFieldError(control, message);
  control?.setAttribute("aria-invalid", message ? "true" : "false");
  const error = control?.closest?.(".field")?.querySelector?.(".field__error");
  if (error) error.textContent = message;
}

export function setBusy(ctx, control, busy, label = "Processando...") {
  if (ctx.ui.setBusy) return ctx.ui.setBusy(control, busy, label);
  if (!control) return;
  control.disabled = busy;
  if (busy) control.setAttribute("aria-busy", "true");
  else control.removeAttribute("aria-busy");
}

export function toast(ctx, message, tone = "info") {
  ctx.ui.toast?.(message, tone);
}

export function absoluteUrl(path = "/") {
  const origin = globalThis.location?.origin;
  if (!origin) return path;
  return new URL(path, origin).toString();
}

export function oauthButtons(ctx, { redirectTo, context = "customer" } = {}) {
  if (typeof ctx.auth.oauth !== "function") return null;
  const providers = [
    ["google", "Continuar com Google"],
    ["apple", "Continuar com Apple"],
  ];
  const controls = providers.map(([provider, label]) => {
    const control = h(
      ctx,
      "button",
      {
        type: "button",
        className: `auth-button auth-button--secondary auth-oauth__button auth-oauth__button--${provider}`,
        "aria-label": label,
      },
      label,
    );
    control.addEventListener("click", async () => {
      controls.forEach((button) => {
        button.disabled = true;
      });
      control.setAttribute("aria-busy", "true");
      try {
        const result = await ctx.auth.oauth(provider, redirectTo, context);
        if (result?.error) throw new Error(result.error.message);
      } catch (error) {
        toast(
          ctx,
          errorMessage(
            error,
            `Nao foi possivel entrar com ${provider === "google" ? "Google" : "Apple"}.`,
          ),
          "error",
        );
        controls.forEach((button) => {
          button.disabled = false;
        });
        control.removeAttribute("aria-busy");
      }
    });
    return control;
  });
  return h(
    ctx,
    "section",
    { className: "auth-oauth", "aria-label": "Outras formas de acesso" },
    h(ctx, "div", { className: "auth-oauth__separator" }, h(ctx, "span", {}, "ou continue com")),
    h(ctx, "div", { className: "auth-oauth__actions" }, controls),
  );
}

export function queryValue(ctx, name) {
  if (typeof ctx.query?.get === "function") return ctx.query.get(name);
  const value = ctx.query?.[name];
  return Array.isArray(value) ? value[0] : (value ?? null);
}

export async function expectResult(operation, fallback = null) {
  const result = await operation;
  if (result?.error)
    throw new Error(result.error.message || "Nao foi possivel concluir a solicitacao.");
  return result?.data ?? fallback;
}

export function createAuthPage(ctx, { title, subtitle, theme = "customer", wide = false }) {
  requireAuthContext(ctx);
  ensureAuthStyles(ctx);
  const root = h(ctx, "main", { id: "main-content", tabindex: "-1", className: "auth-page", dataset: { theme } });
  const card = h(ctx, "section", {
    className: `auth-card${wide ? " auth-card--wide" : ""}`,
    "aria-labelledby": "auth-page-title",
  });
  const brand = link(ctx, "Hype Delivery", "/", "auth-brand");
  brand.prepend(h(ctx, "span", { className: "auth-brand__mark", "aria-hidden": "true" }, "H"));
  const heading = h(
    ctx,
    "header",
    { className: "auth-heading" },
    h(ctx, "h1", { id: "auth-page-title" }, title),
    subtitle ? h(ctx, "p", {}, subtitle) : null,
  );
  const body = h(ctx, "div");
  const live = h(ctx, "p", {
    className: "auth-live",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
  });
  card.append(brand, heading, body, live);
  root.append(card);
  let disposed = false;
  root.cleanup = () => {
    disposed = true;
  };
  return {
    root,
    body,
    announce(message) {
      if (!disposed) live.textContent = message;
    },
    active() {
      return !disposed && root.isConnected !== false;
    },
  };
}

export function errorMessage(error, fallback = "Nao foi possivel concluir. Tente novamente.") {
  const message = String(error?.message || "");
  if (/invalid login credentials|credenciais|email or password/i.test(message))
    return "E-mail ou senha incorretos.";
  return message || fallback;
}

export function roleAfterAuth(ctx) {
  return ctx.auth.role ?? ctx.auth.profile?.role ?? null;
}

export async function refreshIdentity(ctx) {
  if (typeof ctx.auth.refresh === "function") return ctx.auth.refresh();
  if (typeof ctx.auth.init === "function") return ctx.auth.init();
  return null;
}
