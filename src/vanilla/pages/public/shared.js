import { ensurePublicStyles } from "./styles.js";

export const STATUS_LABELS = Object.freeze({
  aguardando_pagamento: "Aguardando pagamento",
  novo: "Pedido recebido",
  confirmado: "Confirmado",
  em_preparo: "Em preparo",
  pronto_para_retirada: "Pronto para retirada",
  saiu_para_entrega: "Saiu para entrega",
  entregue: "Entregue",
  cancelado: "Cancelado",
  expirado: "Pagamento expirado",
});

export const PAYMENT_LABELS = Object.freeze({
  pix: "PIX",
  dinheiro: "Dinheiro",
  cartao_credito_entrega: "Cartão de crédito na entrega",
  cartao_debito_entrega: "Cartão de débito na entrega",
});

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "className") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "checked" || key === "disabled" || key === "selected" || key === "required" || key === "open") node[key] = Boolean(value);
    else if (key === "value") node.value = value;
    else if (key === "htmlFor") node.htmlFor = String(value);
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "ariaHidden") node.setAttribute("aria-hidden", String(value));
    else node.setAttribute(key, String(value));
  }
  append(node, ...children);
  return node;
}

export function append(parent, ...children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

export function icon(symbol) {
  return h("span", { className: "vxp-icon", ariaHidden: "true", text: symbol });
}

export function createPage(ctx, { className = "", label = "Conteúdo principal" } = {}) {
  ensurePublicStyles();
  const root = h("div", { className: `vxp-page ${className}`.trim() });
  const controller = new AbortController();
  const cleanups = [];
  root.cleanup = () => {
    controller.abort();
    while (cleanups.length) {
      try { cleanups.pop()?.(); } catch { /* cleanup must remain best effort */ }
    }
  };
  root.pageSignal = controller.signal;
  root.addCleanup = (fn) => cleanups.push(fn);
  root.append(h("a", { className: "vxp-skip", href: "#main-content", text: "Ir para o conteúdo" }));
  root.setAttribute("aria-label", label);
  return root;
}

export function shellHeader(ctx, { backPath = null, backLabel = "Voltar", title = "Hype Delivery", compact = false } = {}) {
  const inner = h("div", { className: "vxp-shell vxp-header__inner" });
  if (backPath) inner.append(navLink(ctx, backPath, `${backLabel}`, "vxp-btn vxp-btn--ghost vxp-back-link", "←", backLabel));
  const brand = brandLink(ctx, salesPath(ctx, "/lojas"), title, "vxp-brand vxp-grow");
  if (compact) brand.classList.add("vxp-brand--compact");
  inner.append(brand);
  return h("header", { className: "vxp-header" }, inner);
}

export function brandLink(ctx, href, label, className = "vxp-brand") {
  const link = navLink(ctx, href, label, className);
  link.prepend(h("img", {
    className: "vxp-brand__logo",
    src: "/brand/hype-icon.svg",
    alt: "",
    width: "36",
    height: "36",
    ariaHidden: "true",
  }));
  return link;
}

export function navLink(ctx, href, label, className = "", leading = null, ariaLabel = null) {
  const link = h("a", { href, className, ...(ariaLabel ? { "aria-label": ariaLabel } : {}) });
  if (leading) link.append(icon(leading));
  if (label) link.append(h("span", { text: label }));
  link.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (typeof ctx?.navigate !== "function") return;
    event.preventDefault();
    ctx.navigate(href);
  });
  return link;
}

export function salesPath(ctx, path) {
  const current = String(ctx?.location?.pathname || ctx?.pathname || globalThis.location?.pathname || "");
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (!current.startsWith("/vendas")) return clean;
  if (clean === "/") return "/vendas";
  return clean.startsWith("/vendas") ? clean : `/vendas${clean}`;
}

export function routeParam(ctx, key) {
  const raw = ctx?.params?.[key];
  if (typeof raw !== "string") return "";
  try { return decodeURIComponent(raw).trim(); } catch { return raw.trim(); }
}

export function queryParam(ctx, key) {
  const direct = ctx?.query?.get?.(key) ?? ctx?.query?.[key];
  if (direct !== undefined && direct !== null) return String(direct);
  try { return new URL(globalThis.location.href).searchParams.get(key) || ""; } catch { return ""; }
}

export function safeAssetUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(raw)) return raw;
  try {
    const url = new URL(raw, globalThis.location?.origin || "http://localhost");
    return ["http:", "https:", "blob:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

export function imageOrFallback({ src, alt, className, fallback = "V", eager = false, width, height }) {
  const safe = safeAssetUrl(src);
  if (!safe) return h("span", { className, role: "img", "aria-label": alt, text: fallback });
  const img = h("img", {
    className,
    src: safe,
    alt,
    loading: eager ? "eager" : "lazy",
    decoding: "async",
    fetchpriority: eager ? "high" : "auto",
    width,
    height,
  });
  img.addEventListener("error", () => img.replaceWith(h("span", { className, role: "img", "aria-label": alt, text: fallback })), { once: true });
  return img;
}

export async function unwrap(request) {
  const result = await request;
  if (result?.error) throw new Error(publicError(result.error));
  return result?.data ?? result ?? null;
}

export function publicError(error, fallback = "Não foi possível concluir agora. Tente novamente.") {
  const original = String(error?.message || error || "").trim();
  const source = original.toLowerCase();
  if (!source) return fallback;
  if (/network|fetch|connection|offline|timeout|conex/.test(source)) return "Falha de conexão. Verifique sua internet e tente novamente.";
  if (/jwt|session|auth|unauth|401|403|permiss/.test(source)) return "Sua sessão expirou ou não tem permissão para esta ação.";
  if (/not found|não encontr|nao encontr|pgrst116/.test(source)) return "O conteúdo solicitado não foi encontrado.";
  if (/duplicate|already|idempoten/.test(source)) return "Esta ação já foi recebida. Aguarde a atualização antes de tentar novamente.";
  if (original.length <= 180 && /^(loja|produto|item|opção|carrinho|entrega|endereço|cep|pagamento|pix|pedido|troco|cupom|forma de pagamento)/i.test(original)) return original;
  return fallback;
}

export function toast(ctx, message, tone = "info") {
  if (typeof ctx?.ui?.toast === "function") {
    ctx.ui.toast({ message, tone });
    return;
  }
  const live = document.querySelector(".vxp-page [data-vxp-live]");
  if (live) live.textContent = message;
}

export function liveRegion() {
  return h("p", { className: "vxp-live", role: "status", "aria-live": "polite", "aria-atomic": "true", dataset: { vxpLive: "" } });
}

export function money(ctx, value) {
  if (typeof ctx?.ui?.money === "function") return ctx.ui.money(Number(value || 0));
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

export function dateTime(ctx, value) {
  if (!value) return "—";
  if (typeof ctx?.ui?.date === "function") return ctx.ui.date(value);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function onlyDigits(value) { return String(value || "").replace(/\D/g, ""); }
export function toCents(value) { return Math.round(Number(value || 0) * 100); }
export function normalizeText(value) { return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR"); }
export function clampInteger(value, min = 1, max = 99) { return Math.min(max, Math.max(min, Math.floor(Number(value) || min))); }

export function createId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  const bytes = new Uint32Array(4);
  globalThis.crypto?.getRandomValues?.(bytes);
  const entropy = [...bytes].map((part) => part.toString(16)).join("") || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${entropy}`;
}

export function debounce(fn, delay = 200) {
  let timer = 0;
  const wrapped = (...args) => {
    globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(() => fn(...args), delay);
  };
  wrapped.cancel = () => globalThis.clearTimeout(timer);
  return wrapped;
}

export function loadingState(label = "Carregando") {
  return h("div", { className: "vxp-state", role: "status", "aria-live": "polite" },
    h("div", { className: "vxp-state__inner" },
      h("span", { className: "vxp-btn__spinner", ariaHidden: "true" }),
      h("p", { className: "vxp-muted", text: label }),
    ),
  );
}

export function emptyState({ iconText = "○", title, message, action = null }) {
  return h("div", { className: "vxp-state" },
    h("div", { className: "vxp-state__inner" },
      h("span", { className: "vxp-state__icon", ariaHidden: "true", text: iconText }),
      h("h2", { className: "vxp-title vxp-title--sm", text: title }),
      h("p", { className: "vxp-muted", text: message }),
      action,
    ),
  );
}

export function errorState({ title = "Algo deu errado", message, retry = null }) {
  return h("div", { className: "vxp-state", role: "alert" },
    h("div", { className: "vxp-state__inner" },
      h("span", { className: "vxp-state__icon", ariaHidden: "true", text: "!" }),
      h("h2", { className: "vxp-title vxp-title--sm", text: title }),
      h("p", { className: "vxp-muted", text: message }),
      retry ? h("button", { type: "button", className: "vxp-btn vxp-btn--secondary", onClick: retry, text: "Tentar novamente" }) : null,
    ),
  );
}

export function alertBox(message, tone = "warning") {
  return h("div", { className: `vxp-alert vxp-alert--${tone}`, role: tone === "error" ? "alert" : "status" }, icon(tone === "error" ? "!" : tone === "success" ? "✓" : "i"), h("span", { text: message }));
}

export function setButtonBusy(button, busy, busyLabel = "Processando…") {
  if (!button) return;
  if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent || "Continuar";
  button.disabled = Boolean(busy);
  button.setAttribute("aria-busy", String(Boolean(busy)));
  button.replaceChildren();
  if (busy) button.append(h("span", { className: "vxp-btn__spinner", ariaHidden: "true" }), document.createTextNode(busyLabel));
  else button.textContent = button.dataset.idleLabel;
}

export function field({ id, label, input, hint = "", error = "", className = "" }) {
  const hintId = hint ? `${id}-hint` : "";
  const errorId = `${id}-error`;
  input.id = id;
  if (hint || error) input.setAttribute("aria-describedby", [hintId, error ? errorId : ""].filter(Boolean).join(" "));
  if (error) input.setAttribute("aria-invalid", "true");
  return h("div", { className: `vxp-field ${className}`.trim() },
    h("label", { htmlFor: id, text: label }),
    input,
    hint ? h("p", { id: hintId, className: "vxp-field__hint", text: hint }) : null,
    h("p", { id: errorId, className: "vxp-field__error", "aria-live": "polite", text: error }),
  );
}

export function setFieldError(input, message = "") {
  if (!input?.id) return;
  const error = document.getElementById(`${input.id}-error`);
  input.toggleAttribute("aria-invalid", Boolean(message));
  if (error) error.textContent = message;
}

export function openDialog(dialog, { initialFocus = null, onClose = null } = {}) {
  const activeBefore = document.activeElement;
  const close = () => {
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  };
  dialog.addEventListener("cancel", close);
  dialog.addEventListener("close", () => {
    onClose?.();
    if (activeBefore instanceof HTMLElement && activeBefore.isConnected) activeBefore.focus();
    dialog.remove();
  }, { once: true });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });
  document.body.append(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  queueMicrotask(() => (initialFocus || dialog.querySelector("button, input, select, textarea, [href]"))?.focus());
  return close;
}

export function isStoreOpen(businessHours, manualStatus) {
  if (manualStatus === true) return true;
  if (manualStatus === false || !businessHours) return false;
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (time) => {
    const [hour, minute] = String(time || "").split(":").map(Number);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
  };
  const within = (value, open, close) => close < open ? value >= open || value <= close : value >= open && value <= close;
  const today = businessHours[DAY_KEYS[now.getDay()]];
  const open = toMinutes(today?.open);
  const close = toMinutes(today?.close);
  if (today?.enabled && open !== null && close !== null && within(minutes, open, close)) return true;
  const yesterday = businessHours[DAY_KEYS[(now.getDay() + 6) % 7]];
  const oldOpen = toMinutes(yesterday?.open);
  const oldClose = toMinutes(yesterday?.close);
  return Boolean(yesterday?.enabled && oldOpen !== null && oldClose !== null && oldClose < oldOpen && minutes <= oldClose);
}

export function whatsappUrl(number, message) {
  const digits = onlyDigits(number);
  if (digits.length < 10) return "";
  const normalized = digits.startsWith("55") ? digits : `55${digits}`;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}

export function safeExternalLink(href, label, className = "vxp-btn vxp-btn--secondary") {
  let safe = "";
  try {
    const url = new URL(href);
    if (["https:", "http:"].includes(url.protocol)) safe = url.href;
  } catch { /* invalid links are omitted */ }
  return safe ? h("a", { href: safe, target: "_blank", rel: "noopener noreferrer", className, text: label }) : null;
}

export function replaceMain(root, content) {
  const current = root.querySelector("#main-content");
  if (current) current.replaceWith(content);
  else root.append(content);
}

export function main(content, className = "vxp-shell vxp-main") {
  return h("main", { id: "main-content", className, tabindex: "-1" }, content);
}
