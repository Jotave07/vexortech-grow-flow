import { ensureMerchantStyles } from "./styles.js";

export const MERCHANT_ROLE = "store_owner";

const appendChild = (doc, parent, child) => {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) return child.forEach((item) => appendChild(doc, parent, item));
  parent.append(child?.nodeType ? child : doc.createTextNode(String(child)));
};

export function h(ctx, tag, attributes = {}, ...children) {
  const doc = ctx.ui?.document ?? globalThis.document;
  if (!doc) throw new Error("ctx.ui.document ou document global e obrigatorio para renderizar paginas.");
  const node = ctx.ui?.el?.(tag) ?? doc.createElement(tag);
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else if (key === "htmlFor") node.htmlFor = value;
    else if (key === "checked" || key === "disabled" || key === "selected" || key === "value") node[key] = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key !== "children") node.setAttribute(key, value === true ? "" : String(value));
  }
  children.forEach((child) => appendChild(doc, node, child));
  return node;
}

export function requireContext(ctx) {
  if (!ctx?.api?.from) throw new Error("ctx.api.from(table) e obrigatorio.");
  if (!ctx?.auth) throw new Error("ctx.auth e obrigatorio.");
  if (!ctx?.ui) throw new Error("ctx.ui e obrigatorio.");
  if (typeof ctx.navigate !== "function") throw new Error("ctx.navigate(path) e obrigatorio.");
  return ctx;
}

export async function requireMerchant(ctx) {
  requireContext(ctx);
  const granted = ctx.auth.require ? await ctx.auth.require(MERCHANT_ROLE) : true;
  if (granted === false) throw new Error("Acesso restrito ao lojista.");
  const role = ctx.auth.role ?? ctx.auth.profile?.role;
  if (role && ![MERCHANT_ROLE, "super_admin", "admin"].includes(role)) throw new Error("Acesso restrito ao lojista.");
  return ctx.auth.profile;
}

export function getStoreId(ctx) {
  const id = ctx.params?.storeId
    ?? ctx.auth.store?.id
    ?? ctx.auth.stores?.[0]?.id
    ?? ctx.auth.profile?.store_id
    ?? ctx.auth.profile?.storeId
    ?? ctx.auth.session?.store_id;
  if (!id) throw new Error("Loja nao vinculada ao perfil autenticado.");
  return id;
}

export function queryValue(ctx, key, fallback = "") {
  const value = typeof ctx.query?.get === "function" ? ctx.query.get(key) : ctx.query?.[key];
  return value === null || value === undefined ? fallback : value;
}

export async function dataOf(operation, fallback = null) {
  const result = await operation;
  if (result?.error) throw new Error(result.error.message || "Falha ao carregar dados.");
  return result?.data ?? fallback;
}

export function money(ctx, value) {
  return ctx.ui.money?.(Number(value ?? 0))
    ?? Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function date(ctx, value, options) {
  if (!value) return "";
  return ctx.ui.date?.(value, options)
    ?? new Date(value).toLocaleString("pt-BR", options);
}

export function toast(ctx, message, tone = "info") {
  ctx.ui.toast?.(message, { tone });
}

export async function confirmAction(ctx, message) {
  if (ctx.ui.confirm) return Boolean(await ctx.ui.confirm(message));
  return Boolean(globalThis.confirm?.(message));
}

export function badge(ctx, label, tone = "info") {
  return h(ctx, "span", { className: "merchant-badge", dataset: { tone }, text: label });
}

export function button(ctx, label, options = {}) {
  return h(ctx, "button", {
    type: options.type ?? "button",
    className: `merchant-button${options.primary ? " merchant-button--primary" : ""}${options.danger ? " merchant-button--danger" : ""}${options.quiet ? " merchant-button--quiet" : ""}`,
    disabled: options.disabled,
    "aria-label": options.ariaLabel,
    onClick: options.onClick,
  }, label);
}

export function field(ctx, { name, label, type = "text", value = "", required = false, options, hint, min, max, step, rows }) {
  const id = `merchant-${name}-${Math.random().toString(36).slice(2, 8)}`;
  let control;
  if (options) {
    control = h(ctx, "select", { id, name, required, className: "merchant-select" },
      options.map((option) => h(ctx, "option", { value: option.value, selected: String(option.value) === String(value) }, option.label)));
  } else if (type === "textarea") {
    control = h(ctx, "textarea", { id, name, required, rows: rows ?? 4, className: "merchant-textarea", text: value });
  } else if (type === "checkbox") {
    control = h(ctx, "input", { id, name, type, checked: Boolean(value), value: "true" });
  } else {
    const normalizedValue = type === "date" && value ? String(value).slice(0, 10) : value;
    control = h(ctx, "input", { id, name, type, value: normalizedValue ?? "", required, min, max, step, className: "merchant-input" });
  }
  const content = type === "checkbox"
    ? [control, h(ctx, "span", {}, label)]
    : [h(ctx, "span", {}, label), control];
  return h(ctx, "label", { className: "merchant-field", htmlFor: id }, content,
    hint ? h(ctx, "small", { className: "merchant-field__hint" }, hint) : null);
}

export function serializeForm(form) {
  const values = Object.fromEntries(new FormData(form).entries());
  for (const checkbox of form.querySelectorAll?.('input[type="checkbox"]') ?? []) {
    values[checkbox.name] = checkbox.checked;
  }
  return values;
}

export function createPage(ctx, { title, description }) {
  requireContext(ctx);
  ensureMerchantStyles(ctx);
  const root = h(ctx, "section", { className: "merchant-page", "data-page-state": "idle", "aria-label": title });
  const actions = h(ctx, "div", { className: "merchant-page__actions" });
  const heading = h(ctx, "div", { className: "merchant-page__heading" },
    h(ctx, "h1", { className: "merchant-page__title" }, title),
    description ? h(ctx, "p", { className: "merchant-page__description" }, description) : null);
  const header = h(ctx, "header", { className: "merchant-page__header" }, heading, actions);
  const live = h(ctx, "p", { className: "merchant-live", role: "status", "aria-live": "polite", "aria-atomic": "true" });
  const content = h(ctx, "div", { className: "merchant-page__content" });
  root.append(header, live, content);
  const controller = new AbortController();
  const cleanups = [];
  const setContent = (...nodes) => content.replaceChildren(...nodes.filter(Boolean));
  const announce = (message) => { live.textContent = message; };
  const loading = (message = "Carregando...") => {
    root.dataset.pageState = "loading";
    const custom = ctx.ui.loading?.(message);
    setContent(custom ?? h(ctx, "div", { className: "merchant-state", role: "status" }, h(ctx, "strong", {}, message)));
    announce(message);
  };
  const empty = (titleText, descriptionText, action) => {
    root.dataset.pageState = "empty";
    const custom = ctx.ui.empty?.({ title: titleText, description: descriptionText, action });
    setContent(custom ?? h(ctx, "div", { className: "merchant-state" },
      h(ctx, "strong", {}, titleText),
      descriptionText ? h(ctx, "span", {}, descriptionText) : null,
      action ?? null));
    announce(titleText);
  };
  const fail = (error, retry) => {
    const message = error?.message || "Nao foi possivel carregar esta pagina.";
    root.dataset.pageState = "error";
    setContent(h(ctx, "div", { className: "merchant-state", role: "alert" },
      h(ctx, "strong", {}, "Algo deu errado"), h(ctx, "span", {}, message),
      retry ? button(ctx, "Tentar novamente", { onClick: retry }) : null));
    announce(message);
  };
  root.cleanup = () => {
    controller.abort();
    cleanups.splice(0).forEach((cleanup) => cleanup?.());
  };
  return { root, actions, content, setContent, announce, loading, empty, fail, signal: controller.signal, onCleanup: (fn) => cleanups.push(fn) };
}

export function openDialog(ctx, { title, content, actions = [] }) {
  const doc = ctx.ui?.document ?? globalThis.document;
  const titleId = `merchant-dialog-title-${Math.random().toString(36).slice(2, 8)}`;
  const dialog = h(ctx, "dialog", { className: "merchant-dialog", "aria-labelledby": titleId });
  const close = () => {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    dialog.remove();
  };
  const body = h(ctx, "div", { className: "merchant-dialog__body" },
    h(ctx, "header", { className: "merchant-dialog__header" },
      h(ctx, "h2", { id: titleId, className: "merchant-dialog__title" }, title),
      button(ctx, "Fechar", { quiet: true, ariaLabel: "Fechar janela", onClick: close })),
    content,
    actions.length ? h(ctx, "footer", { className: "merchant-actions" }, actions) : null);
  dialog.append(body);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  doc.body.append(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  return { dialog, close };
}

export async function withBusy(control, task) {
  if (control?.disabled) return;
  if (control) {
    control.disabled = true;
    control.setAttribute("aria-busy", "true");
  }
  try { return await task(); }
  finally {
    if (control?.isConnected !== false) {
      control.disabled = false;
      control.removeAttribute("aria-busy");
    }
  }
}

export function statusTone(status) {
  if (["entregue", "pago", "ativo", "active", "confirmado"].includes(status)) return "success";
  if (["cancelado", "estornado", "suspenso", "inactive"].includes(status)) return "danger";
  if (["novo", "em_preparo", "pendente", "aguardando_pagamento"].includes(status)) return "warning";
  return "info";
}

export const normalizeSearch = (value) => String(value ?? "").trim().toLocaleLowerCase("pt-BR");
