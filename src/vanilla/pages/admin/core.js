// A folha `styles.css` e carregada estaticamente pelo entrypoint para respeitar a CSP.
const ensureAdminStyles = () => {};

export const ADMIN_ROLE = "super_admin";

const appendChild = (doc, parent, child) => {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) return child.forEach((item) => appendChild(doc, parent, item));
  parent.append(child?.nodeType ? child : doc.createTextNode(String(child)));
};

export function h(ctx, tag, attributes = {}, ...children) {
  const doc = ctx.ui?.document ?? globalThis.document;
  if (!doc) throw new Error("Um document DOM e obrigatorio para renderizar o admin.");
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

export function requireAdminContext(ctx) {
  if (!ctx?.api?.from || !ctx.api?.fn) throw new Error("ctx.api e obrigatorio.");
  if (!ctx?.auth) throw new Error("ctx.auth e obrigatorio.");
  if (!ctx?.ui) throw new Error("ctx.ui e obrigatorio.");
  if (typeof ctx.navigate !== "function") throw new Error("ctx.navigate(path) e obrigatorio.");
  if (ctx.auth.require?.(ADMIN_ROLE) === false)
    throw new Error("Acesso restrito a administradores.");
  return ctx;
}

export async function dataOf(operation, fallback = null) {
  const result = await operation;
  if (result?.error) throw new Error(result.error.message || "Falha ao carregar dados.");
  return result?.data ?? fallback;
}

export async function resultOf(operation, fallback = null) {
  const result = await operation;
  if (result?.error) throw new Error(result.error.message || "Falha ao concluir a operacao.");
  return result ?? { data: fallback, error: null };
}

export function money(ctx, value) {
  return (
    ctx.ui.money?.(Number(value ?? 0)) ??
    Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
  );
}

export function date(ctx, value, withTime = false) {
  if (!value) return "—";
  return (
    ctx.ui.date?.(value, withTime) ??
    new Intl.DateTimeFormat(
      "pt-BR",
      withTime ? { dateStyle: "short", timeStyle: "short" } : { dateStyle: "short" },
    ).format(new Date(value))
  );
}

export function toast(ctx, message, tone = "info") {
  ctx.ui.toast?.(message, tone);
}

export async function confirmAction(ctx, options) {
  if (ctx.ui.confirm) return Boolean(await ctx.ui.confirm(options));
  return Boolean(
    globalThis.confirm?.(
      `${options.title || "Confirmar"}\n\n${options.message || "Deseja continuar?"}`,
    ),
  );
}

export function button(ctx, label, options = {}) {
  return h(
    ctx,
    "button",
    {
      type: options.type ?? "button",
      className: `admin-button${options.primary ? " admin-button--primary" : ""}${options.danger ? " admin-button--danger" : ""}${options.quiet ? " admin-button--quiet" : ""}`,
      disabled: options.disabled,
      "aria-label": options.ariaLabel,
      onClick: options.onClick,
    },
    label,
  );
}

export function badge(ctx, label, tone = "info") {
  return h(ctx, "span", { className: "admin-badge", dataset: { tone } }, label);
}

export function field(
  ctx,
  {
    name,
    label,
    type = "text",
    value = "",
    required = false,
    options,
    hint,
    min,
    max,
    step,
    rows,
    autocomplete,
  },
) {
  const id = `admin-${name}-${Math.random().toString(36).slice(2, 8)}`;
  let control;
  if (options) {
    control = h(
      ctx,
      "select",
      { id, name, required, className: "admin-select" },
      options.map((option) =>
        h(
          ctx,
          "option",
          { value: option.value, selected: String(option.value) === String(value) },
          option.label,
        ),
      ),
    );
  } else if (type === "textarea") {
    control = h(
      ctx,
      "textarea",
      { id, name, required, rows: rows ?? 4, className: "admin-textarea" },
      value,
    );
  } else if (type === "checkbox") {
    control = h(ctx, "input", { id, name, type, checked: Boolean(value), value: "true" });
  } else {
    control = h(ctx, "input", {
      id,
      name,
      type,
      value: value ?? "",
      required,
      min,
      max,
      step,
      autocomplete,
      className: "admin-input",
    });
  }
  return h(
    ctx,
    "label",
    { className: "admin-field", htmlFor: id },
    type === "checkbox"
      ? [control, h(ctx, "span", {}, label)]
      : [h(ctx, "span", {}, label), control],
    hint ? h(ctx, "small", { className: "admin-field__hint" }, hint) : null,
  );
}

export function serializeForm(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  for (const checkbox of form.querySelectorAll?.('input[type="checkbox"]') ?? [])
    values[checkbox.name] = checkbox.checked;
  return values;
}

export function createAdminPage(ctx, { title, description }) {
  requireAdminContext(ctx);
  ensureAdminStyles(ctx);
  const root = h(ctx, "section", { className: "admin-page", "data-page-state": "idle" });

  const actions = h(ctx, "div", { className: "admin-page__actions" });
  const header = h(
    ctx,
    "header",
    { className: "admin-page__header" },
    h(
      ctx,
      "div",
      { className: "admin-page__heading" },
      h(ctx, "h1", { className: "admin-page__title" }, title),
      description ? h(ctx, "p", { className: "admin-page__description" }, description) : null,
    ),
    actions,
  );
  const live = h(ctx, "p", {
    className: "admin-live",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
  });
  const content = h(ctx, "div", { className: "admin-page__content" });
  root.append(header, live, content);
  const controller = new AbortController();
  const cleanups = [];
  const setContent = (...nodes) => content.replaceChildren(...nodes.filter(Boolean));
  const announce = (message) => {
    live.textContent = message;
  };
  const loading = (message = "Carregando...") => {
    root.dataset.pageState = "loading";
    setContent(
      ctx.ui.loading?.(message) ??
        h(ctx, "div", { className: "admin-state", role: "status" }, h(ctx, "strong", {}, message)),
    );
    announce(message);
  };
  const empty = (titleText, message, action) => {
    root.dataset.pageState = "empty";
    setContent(
      ctx.ui.empty?.(titleText, message, action) ??
        h(
          ctx,
          "div",
          { className: "admin-state" },
          h(ctx, "strong", {}, titleText),
          h(ctx, "span", {}, message),
          action,
        ),
    );
    announce(titleText);
  };
  const fail = (error, retry) => {
    const message = error?.message || "Nao foi possivel carregar esta pagina.";
    root.dataset.pageState = "error";
    setContent(
      h(
        ctx,
        "div",
        { className: "admin-state", role: "alert" },
        h(ctx, "strong", {}, "Algo deu errado"),
        h(ctx, "span", {}, message),
        retry ? button(ctx, "Tentar novamente", { onClick: retry }) : null,
      ),
    );
    announce(message);
  };
  root.cleanup = () => {
    controller.abort();
    cleanups.splice(0).forEach((cleanup) => cleanup?.());
  };
  return {
    root,
    actions,
    content,
    setContent,
    announce,
    loading,
    empty,
    fail,
    signal: controller.signal,
    active: () => !controller.signal.aborted,
    onCleanup: (fn) => cleanups.push(fn),
  };
}

export function openDialog(ctx, { title, content, actions = [] }) {
  const doc = ctx.ui?.document ?? globalThis.document;
  const titleId = `admin-dialog-title-${Math.random().toString(36).slice(2, 8)}`;
  const dialog = h(ctx, "dialog", { className: "admin-dialog", "aria-labelledby": titleId });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    dialog.remove();
  };
  dialog.append(
    h(
      ctx,
      "div",
      { className: "admin-dialog__body" },
      h(
        ctx,
        "header",
        { className: "admin-dialog__header" },
        h(ctx, "h2", { id: titleId, className: "admin-dialog__title" }, title),
        button(ctx, "Fechar", { quiet: true, onClick: close }),
      ),
      content,
      actions.length ? h(ctx, "footer", { className: "admin-actions" }, actions) : null,
    ),
  );
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  doc.body.append(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  return { dialog, close };
}

export async function withBusy(control, task) {
  if (!control || control.disabled) return;
  control.disabled = true;
  control.setAttribute("aria-busy", "true");
  try {
    return await task();
  } finally {
    if (control.isConnected !== false) {
      control.disabled = false;
      control.removeAttribute("aria-busy");
    }
  }
}

export const normalizeSearch = (value) =>
  String(value ?? "")
    .trim()
    .toLocaleLowerCase("pt-BR");

export function statusTone(status) {
  const value = String(status ?? "").toLowerCase();
  if (
    [
      "ativa",
      "ativo",
      "active",
      "pago",
      "entregue",
      "confirmado",
      "enviado",
      "confirmado",
    ].includes(value)
  )
    return "success";
  if (
    [
      "cancelado",
      "cancelada",
      "suspenso",
      "falhou",
      "inadimplente",
      "bloqueado",
      "estornado",
    ].includes(value)
  )
    return "danger";
  if (
    ["pendente", "novo", "trial", "processando", "aguardando_pagamento", "liberado"].includes(value)
  )
    return "warning";
  return "info";
}
