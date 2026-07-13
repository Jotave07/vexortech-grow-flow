import {
  button,
  createPage,
  dataOf,
  field,
  getStoreId,
  h,
  requireMerchant,
  serializeForm,
  toast,
  withBusy,
} from "./core.js";
import { storageObjectUrl, validateProductImage } from "./product-assets.js";

export const BUSINESS_DAYS = Object.freeze([
  { key: "mon", label: "Segunda-feira" },
  { key: "tue", label: "Terça-feira" },
  { key: "wed", label: "Quarta-feira" },
  { key: "thu", label: "Quinta-feira" },
  { key: "fri", label: "Sexta-feira" },
  { key: "sat", label: "Sábado" },
  { key: "sun", label: "Domingo" },
]);

const DEFAULT_PRIMARY = "#b2d83f";
const DEFAULT_SECONDARY = "#303938";
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const digits = (value) => String(value ?? "").replace(/\D/g, "");
const text = (value) => String(value ?? "").trim();
const nullable = (value) => text(value) || null;
const finiteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const randomId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const imageExtension = (file) => {
  const byType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return byType[String(file?.type || "").toLowerCase()]
    || String(file?.name || "").toLowerCase().split(".").pop()?.replace("jpeg", "jpg");
};

export function settingsAssetPath(storeId, kind, file, createId = randomId) {
  const issue = validateProductImage(file);
  if (issue) throw new Error(issue);
  if (!storeId || !["logo", "cover"].includes(kind)) throw new Error("Destino da imagem inválido.");
  return `${storeId}/branding/${kind}/${createId()}.${imageExtension(file)}`;
}

export async function uploadSettingsAsset(ctx, { storeId, kind, file, createId }) {
  if (!ctx?.api?.upload) throw new Error("Upload de imagem indisponível.");
  const bucket = "store-assets";
  const objectPath = settingsAssetPath(storeId, kind, file, createId);
  const result = await ctx.api.upload(bucket, objectPath, file, { upsert: false });
  if (result?.error) throw new Error(result.error.message || "Não foi possível enviar a imagem.");
  const confirmedPath = result?.data?.path || objectPath;
  if (confirmedPath !== objectPath) throw new Error("O servidor retornou um caminho de imagem inesperado.");
  return storageObjectUrl(bucket, confirmedPath);
}

export function normalizeBusinessHours(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(BUSINESS_DAYS.map(({ key }) => {
    const day = source[key] && typeof source[key] === "object" ? source[key] : {};
    return [key, {
      enabled: Boolean(day.enabled),
      open: TIME_PATTERN.test(String(day.open || "")) ? String(day.open) : "09:00",
      close: TIME_PATTERN.test(String(day.close || "")) ? String(day.close) : "18:00",
    }];
  }));
}

export function buildBusinessHours(values) {
  const hours = Object.fromEntries(BUSINESS_DAYS.map(({ key }) => {
    const enabled = Boolean(values[`hours_${key}_enabled`]);
    const open = String(values[`hours_${key}_open`] || "09:00");
    const close = String(values[`hours_${key}_close`] || "18:00");
    if (enabled && (!TIME_PATTERN.test(open) || !TIME_PATTERN.test(close))) {
      throw new Error("Revise os horários de abertura e fechamento.");
    }
    if (enabled && open === close) {
      throw new Error("Abertura e fechamento não podem ser iguais.");
    }
    return [key, { enabled, open, close }];
  }));
  return hours;
}

export function normalizePixKey(type, value) {
  const normalizedType = String(type || "KEY").toUpperCase();
  const raw = text(value);
  if (normalizedType === "CPF") return digits(raw).slice(0, 11);
  if (normalizedType === "CNPJ") return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14);
  if (normalizedType === "PHONE") return digits(raw).slice(0, 13);
  if (normalizedType === "EMAIL") return raw.toLowerCase();
  return raw;
}

const validatePixKey = (type, value) => {
  if (!value) return;
  if (type === "CPF" && !/^\d{11}$/.test(value)) throw new Error("A chave Pix CPF deve ter 11 dígitos.");
  if (type === "CNPJ" && !/^[A-Z0-9]{14}$/.test(value)) throw new Error("A chave Pix CNPJ deve ter 14 caracteres.");
  if (type === "PHONE" && !/^\d{10,13}$/.test(value)) throw new Error("A chave Pix celular deve ter DDD e número.");
  if (type === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("Informe um e-mail Pix válido.");
  if (["EVP", "RANDOM"].includes(type) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("Informe uma chave Pix aleatória válida.");
  }
  if (type === "COPY_PASTE" && (!value.startsWith("000201") || value.length < 20)) {
    throw new Error("O Pix Copia e Cola deve começar com 000201.");
  }
};

export function buildSettingsRequest(values, businessHours = buildBusinessHours(values)) {
  const publicName = text(values.public_name);
  const whatsapp = digits(values.whatsapp);
  const zipCode = digits(values.zip_code);
  const state = text(values.state).toUpperCase();
  const primaryColor = text(values.primary_color).toLowerCase();
  const secondaryColor = text(values.secondary_color).toLowerCase();
  if (publicName.length < 2) throw new Error("Informe o nome público da loja.");
  if (whatsapp.length < 10 || whatsapp.length > 13) throw new Error("Informe um WhatsApp válido, com DDD.");
  if (zipCode.length !== 8) throw new Error("Informe um CEP válido com 8 dígitos.");
  if (!text(values.address) || !text(values.address_number) || !text(values.neighborhood) || !text(values.city)) {
    throw new Error("Complete rua, número, bairro e cidade da loja.");
  }
  if (!/^[A-Z]{2}$/.test(state)) throw new Error("Informe a UF com 2 letras.");
  if (!COLOR_PATTERN.test(primaryColor) || !COLOR_PATTERN.test(secondaryColor)) throw new Error("Revise as cores da loja.");
  if (!values.allow_delivery && !values.allow_pickup) throw new Error("Ative entrega ou retirada.");
  if (!values.accept_pix && !values.accept_cash && !values.accept_card_on_delivery) throw new Error("Ative ao menos uma forma de pagamento.");

  const prepTime = finiteNumber(values.avg_prep_time_minutes, NaN);
  const minimumOrder = finiteNumber(values.min_order_value, NaN);
  const radius = text(values.delivery_radius_km) ? finiteNumber(values.delivery_radius_km, NaN) : null;
  if (!Number.isFinite(prepTime) || prepTime < 1 || prepTime > 240) throw new Error("O preparo médio deve ficar entre 1 e 240 minutos.");
  if (!Number.isFinite(minimumOrder) || minimumOrder < 0) throw new Error("O pedido mínimo não pode ser negativo.");
  if (radius !== null && (!Number.isFinite(radius) || radius <= 0 || radius > 500)) throw new Error("O raio deve ficar entre 0,1 e 500 km.");

  const pixType = String(values.pix_key_type || "KEY").toUpperCase();
  const pixKey = normalizePixKey(pixType, values.pix_key);
  if (values.accept_pix) validatePixKey(pixType, pixKey);

  return {
    store: {
      public_name: publicName,
      whatsapp,
      logo_url: nullable(values.logo_url),
      cover_url: nullable(values.cover_url),
      description: nullable(values.description),
      zip_code: zipCode,
      address: text(values.address),
      address_number: text(values.address_number),
      address_complement: nullable(values.address_complement),
      neighborhood: text(values.neighborhood),
      city: text(values.city),
      state,
      primary_color: primaryColor,
      secondary_color: secondaryColor,
    },
    settings: {
      avg_prep_time_minutes: prepTime,
      min_order_value: minimumOrder,
      is_open: Boolean(values.is_open),
      allow_delivery: Boolean(values.allow_delivery),
      allow_pickup: Boolean(values.allow_pickup),
      accept_orders_when_closed: Boolean(values.accept_orders_when_closed),
      accept_pix: Boolean(values.accept_pix),
      pix_key: pixKey || null,
      pix_key_type: pixType,
      payment_instructions: nullable(values.payment_instructions),
      accept_cash: Boolean(values.accept_cash),
      accept_card_on_delivery: Boolean(values.accept_card_on_delivery),
      delivery_radius_km: radius,
      business_hours: businessHours,
    },
  };
}

const controlField = (ctx, options, attributes = {}) => {
  const wrapper = field(ctx, options);
  const control = wrapper.querySelector("input, select, textarea");
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null) control?.setAttribute(key, String(value));
  });
  return wrapper;
};

const sectionHeading = (ctx, title, description) => h(ctx, "div", { className: "merchant-section__heading" },
  h(ctx, "h2", { className: "merchant-panel__title" }, title),
  h(ctx, "p", { className: "merchant-page__description" }, description));

const imagePreview = (ctx, url, alt, kind) => {
  const preview = h(ctx, "div", { className: `merchant-brand-image merchant-brand-image--${kind}` });
  if (!url) {
    preview.append(h(ctx, "span", {}, kind === "logo" ? "Sem logo" : "Sem capa"));
    return preview;
  }
  const image = h(ctx, "img", {
    src: url,
    alt,
    loading: "lazy",
    referrerpolicy: "no-referrer",
    onError: () => preview.replaceChildren(h(ctx, "span", {}, "Imagem indisponível")),
  });
  preview.append(image);
  return preview;
};

const createAssetControl = (ctx, { storeId, kind, label, value, alt, onChange, isDisposed }) => {
  const hidden = h(ctx, "input", { type: "hidden", name: `${kind}_url`, value: value || "" });
  const previewSlot = h(ctx, "div", { className: "merchant-brand-upload__preview" }, imagePreview(ctx, value, alt, kind));
  const status = h(ctx, "p", { className: "merchant-field__hint", role: "status", "aria-live": "polite" },
    value ? "Imagem atual configurada." : "Envie JPG, PNG, WebP ou GIF de até 5 MB.");
  const fileInput = h(ctx, "input", {
    type: "file",
    accept: ".jpg,.jpeg,.png,.webp,.gif",
    className: "merchant-visually-hidden",
  });
  const picker = h(ctx, "label", { className: "merchant-button merchant-brand-upload__picker" },
    "Escolher imagem", fileInput);
  const clear = button(ctx, "Remover", {
    quiet: true,
    disabled: !value,
    onClick: () => {
      hidden.value = "";
      previewSlot.replaceChildren(imagePreview(ctx, "", alt, kind));
      clear.disabled = true;
      status.textContent = "A imagem será removida quando você salvar.";
      onChange();
    },
  });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    fileInput.disabled = true;
    picker.setAttribute("aria-busy", "true");
    status.textContent = "Enviando imagem com segurança…";
    try {
      const url = await uploadSettingsAsset(ctx, { storeId, kind, file });
      if (isDisposed()) return;
      hidden.value = url;
      previewSlot.replaceChildren(imagePreview(ctx, url, alt, kind));
      clear.disabled = false;
      status.textContent = "Upload concluído. Salve as configurações para publicar a imagem.";
      toast(ctx, `${label} enviado. Agora salve as configurações.`, "success");
      onChange();
    } catch (error) {
      if (!isDisposed()) {
        status.textContent = error.message;
        toast(ctx, error.message, "error");
      }
    } finally {
      fileInput.value = "";
      fileInput.disabled = false;
      picker.removeAttribute("aria-busy");
    }
  });
  return h(ctx, "article", { className: "merchant-brand-upload" },
    h(ctx, "h3", {}, label), previewSlot, hidden,
    h(ctx, "div", { className: "merchant-actions" }, picker, clear), status);
};

const contrastColor = (hex) => {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  const luminance = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
  return luminance > 145 ? "#101414" : "#ffffff";
};

export function drawBrandPreview(canvas, { primaryColor, secondaryColor, name, description }) {
  if (!canvas?.getContext || !COLOR_PATTERN.test(primaryColor) || !COLOR_PATTERN.test(secondaryColor)) return false;
  const context = canvas.getContext("2d");
  if (!context) return false;
  const { width, height } = canvas;
  const gradient = context.createLinearGradient(0, 0, width, height * 0.6);
  gradient.addColorStop(0, primaryColor);
  gradient.addColorStop(1, secondaryColor);
  context.clearRect(0, 0, width, height);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, Math.round(height * 0.48));
  context.fillStyle = secondaryColor;
  context.fillRect(0, Math.round(height * 0.48), width, height);
  context.fillStyle = primaryColor;
  context.beginPath();
  context.arc(92, Math.round(height * 0.51), 54, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = contrastColor(primaryColor);
  context.font = "800 36px system-ui";
  context.textAlign = "center";
  context.fillText(String(name || "H").slice(0, 1).toUpperCase(), 92, Math.round(height * 0.55));
  context.textAlign = "left";
  context.fillStyle = contrastColor(secondaryColor);
  context.font = "800 28px system-ui";
  context.fillText(String(name || "Nome da loja").slice(0, 34), 168, Math.round(height * 0.65));
  context.font = "400 17px system-ui";
  context.fillText(String(description || "Sua identidade no Hype Delivery").slice(0, 66), 168, Math.round(height * 0.77));
  canvas.setAttribute("aria-label", `Prévia da loja ${name || "sem nome"}, com cor principal ${primaryColor} e secundária ${secondaryColor}.`);
  return true;
}

const createHoursEditor = (ctx, businessHours) => h(ctx, "div", { className: "merchant-hours" },
  BUSINESS_DAYS.map(({ key, label }) => {
    const current = businessHours[key];
    const enabled = h(ctx, "input", { type: "checkbox", name: `hours_${key}_enabled`, checked: current.enabled });
    const open = h(ctx, "input", { type: "time", name: `hours_${key}_open`, value: current.open, className: "merchant-input", disabled: !current.enabled, "aria-label": `Abertura de ${label}` });
    const close = h(ctx, "input", { type: "time", name: `hours_${key}_close`, value: current.close, className: "merchant-input", disabled: !current.enabled, "aria-label": `Fechamento de ${label}` });
    const sync = () => {
      open.disabled = !enabled.checked;
      close.disabled = !enabled.checked;
    };
    enabled.addEventListener("change", sync);
    return h(ctx, "div", { className: "merchant-hours__row" },
      h(ctx, "label", { className: "merchant-check" }, enabled, h(ctx, "span", {}, label)),
      h(ctx, "label", { className: "merchant-hours__time" }, h(ctx, "span", {}, "Abre"), open),
      h(ctx, "label", { className: "merchant-hours__time" }, h(ctx, "span", {}, "Fecha"), close));
  }));

const readFormValues = (form) => {
  const values = serializeForm(form);
  for (const { key } of BUSINESS_DAYS) {
    values[`hours_${key}_enabled`] = Boolean(form.elements.namedItem(`hours_${key}_enabled`)?.checked);
    values[`hours_${key}_open`] = form.elements.namedItem(`hours_${key}_open`)?.value || "09:00";
    values[`hours_${key}_close`] = form.elements.namedItem(`hours_${key}_close`)?.value || "18:00";
  }
  return values;
};

export function render(ctx) {
  const page = createPage(ctx, {
    title: "Configurações",
    description: "Publique identidade, operação, entrega e recebimento em uma única atualização segura.",
  });
  const state = { store: null, settings: null, disposed: false, dirty: false, saving: false };
  page.onCleanup(() => { state.disposed = true; });

  const beforeUnload = (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  };
  globalThis.addEventListener?.("beforeunload", beforeUnload);
  page.onCleanup(() => globalThis.removeEventListener?.("beforeunload", beforeUnload));

  const load = async () => {
    page.loading("Carregando configurações…");
    try {
      await requireMerchant(ctx);
      const storeId = getStoreId(ctx);
      [state.store, state.settings] = await Promise.all([
        dataOf(ctx.api.from("stores")
          .select("id, name, public_name, whatsapp, whatsapp_number, phone, logo_url, cover_url, description, zip_code, address, address_number, address_complement, neighborhood, city, state, primary_color, secondary_color")
          .eq("id", storeId).maybeSingle(), null),
        dataOf(ctx.api.from("store_settings")
          .select("store_id, avg_prep_time_minutes, min_order_value, is_open, allow_delivery, allow_pickup, accept_orders_when_closed, accept_pix, pix_key, pix_key_type, payment_instructions, accept_cash, accept_card_on_delivery, delivery_radius_km, business_hours")
          .eq("store_id", storeId).maybeSingle(), null),
      ]);
      if (!state.store) throw new Error("Loja não encontrada.");
      state.settings ||= {};
      state.dirty = false;
      renderForm();
    } catch (error) {
      if (!state.disposed) page.fail(error, load);
    }
  };

  const renderForm = () => {
    const store = state.store;
    const settings = state.settings;
    const businessHours = normalizeBusinessHours(settings.business_hours);
    const form = h(ctx, "form", { className: "merchant-form merchant-settings", novalidate: "" });
    const markDirty = () => { state.dirty = true; };

    const publicNameField = controlField(ctx, { name: "public_name", label: "Nome público", value: store.public_name ?? store.name ?? "", required: true }, { maxlength: 160, autocomplete: "organization" });
    const whatsappField = controlField(ctx, { name: "whatsapp", label: "WhatsApp", type: "tel", value: store.whatsapp ?? store.whatsapp_number ?? store.phone ?? "", required: true, hint: "Inclua DDD. Este número aparece nos canais de atendimento." }, { maxlength: 20, autocomplete: "tel", inputmode: "tel" });
    const descriptionField = controlField(ctx, { name: "description", label: "Descrição curta", type: "textarea", value: store.description ?? "" }, { maxlength: 1500 });
    const identity = h(ctx, "fieldset", { className: "merchant-panel merchant-section" },
      h(ctx, "legend", { className: "merchant-visually-hidden" }, "Identidade e contato"),
      sectionHeading(ctx, "Identidade e contato", "O cliente reconhece a loja por estes dados."),
      h(ctx, "div", { className: "merchant-form__grid" }, publicNameField, whatsappField),
      descriptionField);

    const zip = controlField(ctx, { name: "zip_code", label: "CEP", value: store.zip_code ?? "", required: true }, { maxlength: 9, autocomplete: "postal-code", inputmode: "numeric" });
    const address = controlField(ctx, { name: "address", label: "Rua ou avenida", value: store.address ?? "", required: true }, { maxlength: 200, autocomplete: "address-line1" });
    const number = controlField(ctx, { name: "address_number", label: "Número", value: store.address_number ?? "", required: true }, { maxlength: 30, autocomplete: "address-line2" });
    const complement = controlField(ctx, { name: "address_complement", label: "Complemento", value: store.address_complement ?? "" }, { maxlength: 120, autocomplete: "address-line3" });
    const neighborhood = controlField(ctx, { name: "neighborhood", label: "Bairro", value: store.neighborhood ?? "", required: true }, { maxlength: 120 });
    const city = controlField(ctx, { name: "city", label: "Cidade", value: store.city ?? "", required: true }, { maxlength: 120, autocomplete: "address-level2" });
    const stateField = controlField(ctx, { name: "state", label: "UF", value: store.state ?? "", required: true }, { maxlength: 2, autocomplete: "address-level1" });
    const addressSection = h(ctx, "fieldset", { className: "merchant-panel merchant-section" },
      h(ctx, "legend", { className: "merchant-visually-hidden" }, "Endereço da loja"),
      sectionHeading(ctx, "Endereço da loja", "Usado pelo servidor para validar o raio e as regras de entrega."),
      h(ctx, "div", { className: "merchant-form__grid" }, zip, address, number, complement, neighborhood, city, stateField));

    const operation = h(ctx, "fieldset", { className: "merchant-panel merchant-section" },
      h(ctx, "legend", { className: "merchant-visually-hidden" }, "Operação"),
      sectionHeading(ctx, "Operação", "Deixe explícito quando e como a loja recebe pedidos."),
      h(ctx, "div", { className: "merchant-form__grid" },
        controlField(ctx, { name: "avg_prep_time_minutes", label: "Preparo médio (min)", type: "number", value: settings.avg_prep_time_minutes ?? 30, min: 1, max: 240, required: true }, { inputmode: "numeric" }),
        controlField(ctx, { name: "min_order_value", label: "Pedido mínimo", type: "number", value: settings.min_order_value ?? 0, min: 0, step: 0.01 }, { inputmode: "decimal" }),
        controlField(ctx, { name: "delivery_radius_km", label: "Raio máximo (km)", type: "number", value: settings.delivery_radius_km ?? "", min: 0.1, max: 500, step: 0.1, hint: "Limite global. Regiões podem definir um raio menor em Entregas." }, { inputmode: "decimal" })),
      h(ctx, "div", { className: "merchant-choice-grid" },
        field(ctx, { name: "is_open", label: "Loja aberta agora", type: "checkbox", value: settings.is_open ?? true, hint: "O status manual prevalece sobre os horários informativos." }),
        field(ctx, { name: "allow_delivery", label: "Oferecer entrega", type: "checkbox", value: settings.allow_delivery ?? true }),
        field(ctx, { name: "allow_pickup", label: "Oferecer retirada", type: "checkbox", value: settings.allow_pickup ?? true }),
        field(ctx, { name: "accept_orders_when_closed", label: "Aceitar pedidos com loja fechada", type: "checkbox", value: settings.accept_orders_when_closed ?? false })));

    const payments = h(ctx, "fieldset", { className: "merchant-panel merchant-section" },
      h(ctx, "legend", { className: "merchant-visually-hidden" }, "Pagamentos"),
      sectionHeading(ctx, "Pagamentos", "Ative apenas meios que sua equipe consegue receber e conciliar."),
      h(ctx, "div", { className: "merchant-choice-grid" },
        field(ctx, { name: "accept_pix", label: "Aceitar Pix", type: "checkbox", value: settings.accept_pix ?? true }),
        field(ctx, { name: "accept_cash", label: "Aceitar dinheiro", type: "checkbox", value: settings.accept_cash ?? true }),
        field(ctx, { name: "accept_card_on_delivery", label: "Cartão na entrega", type: "checkbox", value: settings.accept_card_on_delivery ?? true })),
      h(ctx, "details", { className: "merchant-disclosure", open: settings.accept_pix ? "" : null },
        h(ctx, "summary", {}, "Configuração avançada do Pix"),
        h(ctx, "div", { className: "merchant-disclosure__content" },
          h(ctx, "div", { className: "merchant-form__grid" },
            field(ctx, { name: "pix_key_type", label: "Tipo de chave", value: String(settings.pix_key_type || "KEY").toUpperCase(), options: [
              { value: "CPF", label: "CPF" }, { value: "CNPJ", label: "CNPJ" },
              { value: "PHONE", label: "Celular" }, { value: "EMAIL", label: "E-mail" },
              { value: "EVP", label: "Chave aleatória" }, { value: "KEY", label: "Outra chave" },
              { value: "COPY_PASTE", label: "Pix Copia e Cola" },
            ] }),
            controlField(ctx, { name: "pix_key", label: "Chave ou código Pix", type: "textarea", value: settings.pix_key ?? "", hint: "Se houver gateway financeiro ativo, a chave manual pode ficar vazia." }, { maxlength: 500, spellcheck: "false" })),
          controlField(ctx, { name: "payment_instructions", label: "Instruções ao cliente", type: "textarea", value: settings.payment_instructions ?? "", hint: "Ex.: envie o comprovante pelo WhatsApp e aguarde a confirmação." }, { maxlength: 1000 }))));

    const hours = h(ctx, "details", { className: "merchant-panel merchant-disclosure" },
      h(ctx, "summary", {}, "Horários de funcionamento"),
      h(ctx, "div", { className: "merchant-disclosure__content" },
        h(ctx, "p", { className: "merchant-page__description" }, "A agenda fica salva para comunicação ao cliente. No contrato atual, o botão “Loja aberta agora” continua sendo o estado operacional decisivo."),
        createHoursEditor(ctx, businessHours)));

    const logoControl = createAssetControl(ctx, {
      storeId: getStoreId(ctx), kind: "logo", label: "Logotipo", value: store.logo_url,
      alt: `Logotipo de ${store.public_name || store.name || "loja"}`, onChange: markDirty,
      isDisposed: () => state.disposed,
    });
    const coverControl = createAssetControl(ctx, {
      storeId: getStoreId(ctx), kind: "cover", label: "Capa", value: store.cover_url,
      alt: `Capa de ${store.public_name || store.name || "loja"}`, onChange: markDirty,
      isDisposed: () => state.disposed,
    });
    const primary = field(ctx, { name: "primary_color", label: "Cor principal", type: "color", value: store.primary_color || DEFAULT_PRIMARY });
    const secondary = field(ctx, { name: "secondary_color", label: "Cor secundária", type: "color", value: store.secondary_color || DEFAULT_SECONDARY });
    const canvas = h(ctx, "canvas", { className: "merchant-brand-preview", width: 800, height: 300, role: "img" });
    const appearance = h(ctx, "fieldset", { className: "merchant-panel merchant-section" },
      h(ctx, "legend", { className: "merchant-visually-hidden" }, "Aparência"),
      sectionHeading(ctx, "Aparência", "Envie imagens e revise a combinação de cores antes de publicar."),
      h(ctx, "div", { className: "merchant-brand-grid" }, logoControl, coverControl),
      h(ctx, "div", { className: "merchant-form__grid" }, primary, secondary),
      h(ctx, "div", { className: "merchant-brand-preview-wrap" },
        h(ctx, "h3", {}, "Prévia da identidade"), canvas));

    const headerSave = button(ctx, "Salvar configurações", { primary: true, onClick: () => form.requestSubmit() });
    page.actions.replaceChildren(headerSave);
    const actions = h(ctx, "div", { className: "merchant-actions merchant-settings__actions" });
    const save = button(ctx, "Salvar configurações", { primary: true, onClick: () => form.requestSubmit() });
    actions.append(save, button(ctx, "Gerenciar assinatura", { onClick: () => ctx.navigate("/lojista/assinatura") }));
    form.append(identity, addressSection, operation, payments, hours, appearance, actions);

    const updatePreview = () => {
      drawBrandPreview(canvas, {
        primaryColor: form.elements.namedItem("primary_color")?.value || DEFAULT_PRIMARY,
        secondaryColor: form.elements.namedItem("secondary_color")?.value || DEFAULT_SECONDARY,
        name: form.elements.namedItem("public_name")?.value,
        description: form.elements.namedItem("description")?.value,
      });
    };
    ["primary_color", "secondary_color", "public_name", "description"].forEach((name) => {
      form.elements.namedItem(name)?.addEventListener("input", updatePreview);
    });
    form.addEventListener("input", markDirty);
    form.addEventListener("change", markDirty);
    updatePreview();

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (state.saving) return;
      void withBusy(save, async () => {
        state.saving = true;
        headerSave.disabled = true;
        headerSave.setAttribute("aria-busy", "true");
        try {
          const values = readFormValues(form);
          const payload = buildSettingsRequest(values);
          await dataOf(ctx.api.fn("merchant-update-settings", {
            storeId: getStoreId(ctx),
            store: payload.store,
            settings: payload.settings,
          }));
          state.dirty = false;
          page.announce("Configurações salvas com sucesso.");
          toast(ctx, "Configurações publicadas em uma única atualização.", "success");
          await load();
        } catch (error) {
          page.announce(error.message);
          toast(ctx, error.message, "error");
        } finally {
          state.saving = false;
          if (headerSave.isConnected) {
            headerSave.disabled = false;
            headerSave.removeAttribute("aria-busy");
          }
        }
      });
    });

    page.root.dataset.pageState = "ready";
    page.setContent(form);
    page.announce("Configurações prontas para edição.");
  };

  page.root.ready = load();
  return page.root;
}

export default render;
