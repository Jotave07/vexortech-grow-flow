const append = (parent, child) => {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) return child.forEach((item) => append(parent, item));
  parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
};

export const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class" || key === "className") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style") throw new TypeError("Estilos inline nao sao permitidos; use uma classe CSS.");
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "checked" || key === "disabled" || key === "required" || key === "open" || key === "selected") node[key] = Boolean(value);
    else node.setAttribute(key, String(value));
  }
  children.forEach((child) => append(node, child));
  return node;
};

const toastRegion = () => {
  let region = document.querySelector("#toast-region");
  if (!region) {
    region = el("div", { id: "toast-region", class: "toast-region", "aria-live": "polite", "aria-atomic": "false" });
    document.body.append(region);
  }
  return region;
};

const toast = (message, type = "info", timeout = 4500) => {
  if (message && typeof message === "object") {
    ({ message, tone: type = "info", timeout = 4500 } = message);
  }
  if (type && typeof type === "object") type = type.tone || type.type || "info";
  const item = el("div", { class: `toast toast--${type}`, role: type === "error" ? "alert" : "status" },
    el("span", { class: "toast__message", text: message }),
    el("button", { type: "button", class: "icon-button", "aria-label": "Fechar mensagem", onclick: () => item.remove() }, "×"),
  );
  toastRegion().append(item);
  requestAnimationFrame(() => item.classList.add("is-visible"));
  setTimeout(() => { item.classList.remove("is-visible"); setTimeout(() => item.remove(), 180); }, timeout);
  return item;
};

const button = (label, options = {}) => el("button", {
  type: options.type || "button",
  class: `button button--${options.variant || "primary"}${options.className ? ` ${options.className}` : ""}`,
  disabled: options.disabled,
  "aria-label": options.ariaLabel,
  onclick: options.onClick,
}, label);

const formField = ({ label, name, type = "text", value = "", required = false, autocomplete, placeholder, help, options, min, max, step }) => {
  const id = `field-${name}-${Math.random().toString(36).slice(2, 8)}`;
  const control = options
    ? el("select", { id, name, required }, options.map((option) => el("option", { value: option.value, selected: String(option.value) === String(value) }, option.label)))
    : el("input", { id, name, type, value, required, autocomplete, placeholder, min, max, step });
  const error = el("p", { id: `${id}-error`, class: "field__error", "aria-live": "polite" });
  control.setAttribute("aria-describedby", [help ? `${id}-help` : "", `${id}-error`].filter(Boolean).join(" "));
  return el("div", { class: "field" },
    el("label", { for: id }, label, required ? el("span", { "aria-hidden": "true" }, " *") : null),
    control,
    help ? el("p", { id: `${id}-help`, class: "field__help", text: help }) : null,
    error,
  );
};

const setFieldError = (control, message = "") => {
  const error = control?.closest(".field")?.querySelector(".field__error");
  control?.setAttribute("aria-invalid", message ? "true" : "false");
  if (error) error.textContent = message;
};

const setBusy = (control, busy, busyLabel = "Processando...") => {
  if (!control) return;
  if (busy) {
    control.dataset.label = control.textContent;
    control.textContent = busyLabel;
    control.disabled = true;
    control.setAttribute("aria-busy", "true");
  } else {
    if (control.dataset.label) control.textContent = control.dataset.label;
    control.disabled = false;
    control.removeAttribute("aria-busy");
  }
};

const confirm = (options = {}) => new Promise((resolve) => {
  if (typeof options === "string") options = { message: options };
  const { title = "Confirmar acao", message, confirmLabel = "Confirmar", danger = false } = options;
  const dialog = el("dialog", { class: "dialog" });
  const close = (answer) => { dialog.close(); dialog.remove(); resolve(answer); };
  dialog.append(el("form", { method: "dialog", class: "dialog__content", onsubmit: (event) => event.preventDefault() },
    el("h2", { text: title }),
    el("p", { text: message || "Deseja continuar?" }),
    el("div", { class: "dialog__actions" },
      button("Cancelar", { variant: "secondary", onClick: () => close(false) }),
      button(confirmLabel, { variant: danger ? "danger" : "primary", onClick: () => close(true) }),
    ),
  ));
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(false); });
  document.body.append(dialog);
  dialog.showModal();
  dialog.querySelector("button")?.focus();
});

const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (value, options = false) => value ? new Intl.DateTimeFormat("pt-BR", typeof options === "object"
  ? options
  : options
    ? { dateStyle: "short", timeStyle: "short" }
    : { dateStyle: "short" }).format(new Date(value)) : "—";

const loading = (label = "Carregando...") => el("div", { class: "loading", role: "status", "aria-live": "polite" },
  el("span", { class: "spinner", "aria-hidden": "true" }), el("span", { text: label }),
);
const empty = (title, message, action) => {
  if (title && typeof title === "object") ({ title, description: message, action } = title);
  return el("section", { class: "empty-state" },
  el("h2", { text: title }), el("p", { text: message }), action || null,
  );
};
const card = (...children) => el("section", { class: "card" }, ...children);
const heading = (title, subtitle, actions) => el("header", { class: "page-heading" },
  el("div", {}, el("h1", { text: title }), subtitle ? el("p", { text: subtitle }) : null), actions || null,
);

export const ui = { document: globalThis.document, el, button, formField, setFieldError, setBusy, toast, confirm, money, date, loading, empty, card, heading };
