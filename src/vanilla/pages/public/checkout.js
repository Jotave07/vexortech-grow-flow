import { createCartStore, itemSubtotal } from "./cart.js";
import {
  alertBox,
  createId,
  createPage,
  errorState,
  field,
  h,
  imageOrFallback,
  isStoreOpen,
  loadingState,
  main,
  money,
  navLink,
  onlyDigits,
  publicError,
  replaceMain,
  routeParam,
  salesPath,
  setButtonBusy,
  setFieldError,
  shellHeader,
  toast,
  toCents,
  unwrap,
} from "./shared.js";

const STORE_COLUMNS = "id, name, public_name, slug, city, state, logo_url, is_active, is_suspended";
const SETTINGS_COLUMNS = "store_id, accept_orders_when_closed, accept_pix, accept_cash, accept_card_on_delivery, allow_delivery, allow_pickup, avg_prep_time_minutes, business_hours, delivery_fee, free_delivery_above, is_open, min_order_amount, min_order_value";

const PAYMENT_METHODS = Object.freeze({
  pix: "PIX",
  dinheiro: "Dinheiro",
  cartao_credito_entrega: "Cartão de crédito na entrega",
  cartao_debito_entrega: "Cartão de débito na entrega",
});

function validDocument(value) {
  const normalized = normalizeDocument(value);
  if (!normalized) return true;
  const check = (base, factors) => {
    const sum = factors.reduce((total, factor, index) => total + (base.charCodeAt(index) - 48) * factor, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  if (/^\d{11}$/.test(normalized)) {
    if (/^(\d)\1+$/.test(normalized)) return false;
    const first = check(normalized, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
    const second = check(normalized, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
    return first === Number(normalized[9]) && second === Number(normalized[10]);
  }
  if (/^[A-Z0-9]{12}\d{2}$/.test(normalized)) {
    if (/^(\d)\1+$/.test(normalized)) return false;
    const first = check(normalized, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    const second = check(normalized, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
    return first === Number(normalized[12]) && second === Number(normalized[13]);
  }
  return false;
}

function normalizeDocument(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14);
}

function paymentChoices(settings) {
  const methods = [];
  if (settings?.accept_pix) methods.push("pix");
  if (settings?.accept_cash) methods.push("dinheiro");
  if (settings?.accept_card_on_delivery) methods.push("cartao_credito_entrega", "cartao_debito_entrega");
  return methods;
}

function makeRadioCard({ name, value, label, checked = false, hint = "" }) {
  const id = `${name}-${value}`;
  return h("label", { className: "vxp-radio-card", htmlFor: id },
    h("input", { id, type: "radio", name, value, checked }),
    h("strong", { text: label }),
    hint ? h("span", { className: "vxp-small vxp-muted", text: hint }) : null,
  );
}

async function lookupCep(ctx, cep) {
  const clean = onlyDigits(cep);
  if (clean.length !== 8) throw new Error("Informe os 8 números do CEP.");
  const address = await unwrap(ctx.api.fn("lookup-cep", { cep: clean }));
  return {
    zipCode: clean,
    street: String(address.street || ""),
    neighborhood: String(address.neighborhood || ""),
    city: String(address.city || ""),
    state: String(address.state || ""),
  };
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Este navegador não oferece geolocalização. Digite o endereço manualmente."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const lat = Number(coords.latitude);
        const lng = Number(coords.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
          reject(new Error("A localização recebida é inválida. Digite o endereço manualmente."));
          return;
        }
        resolve({ lat, lng });
      },
      (error) => {
        const messages = {
          1: "Permissão de localização negada. Digite o endereço manualmente ou permita o acesso no navegador.",
          2: "Sua localização está indisponível. Digite o endereço manualmente.",
          3: "A localização demorou demais. Tente novamente ou digite o endereço.",
        };
        reject(new Error(messages[error.code] || "Não foi possível obter sua localização."));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  });
}

async function validateCart(ctx, storeId, items) {
  if (!items.length) return "Seu carrinho está vazio.";
  if (items.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) return "Revise as quantidades do carrinho.";
  const productIds = [...new Set(items.map((item) => item.product_id))];
  const products = await unwrap(
    ctx.api.from("products")
      .select("id, store_id, name, price, promo_price, is_active, is_available")
      .eq("store_id", storeId)
      .in("id", productIds),
  );
  const productMap = new Map((products || []).map((product) => [product.id, product]));
  const groups = await unwrap(
    ctx.api.from("product_options")
      .select("id, product_id, name, is_required, min_choices, max_choices")
      .in("product_id", productIds),
  );
  const groupIds = (groups || []).map((group) => group.id);
  const optionItems = groupIds.length
    ? await unwrap(ctx.api.from("product_option_items").select("id, option_id, name, extra_price, is_active").in("option_id", groupIds))
    : [];

  for (const line of items) {
    const product = productMap.get(line.product_id);
    if (!product) return `“${line.product_name}” não pertence mais a este cardápio.`;
    if (product.is_active === false || product.is_available === false) return `“${product.name}” está indisponível no momento.`;
    if (toCents(product.promo_price ?? product.price) !== toCents(line.unit_price)) return `O preço de “${product.name}” mudou. Volte ao cardápio e adicione o item novamente.`;
    const productGroups = (groups || []).filter((group) => group.product_id === product.id);
    for (const group of productGroups) {
      const selected = line.options.filter((option) => option.option_id === group.id);
      const min = Math.max(group.is_required ? 1 : 0, Number(group.min_choices || 0));
      const max = Math.max(min, Number(group.max_choices || 1));
      if (selected.length < min) return `Falta escolher “${group.name}” em “${product.name}”.`;
      if (selected.length > max) return `O limite de “${group.name}” foi excedido em “${product.name}”.`;
    }
    for (const selected of line.options) {
      const group = productGroups.find((candidate) => candidate.id === selected.option_id);
      const current = (optionItems || []).find((candidate) => candidate.id === selected.item_id && candidate.option_id === selected.option_id);
      if (!group || !current || current.is_active === false) return `A opção “${selected.item_name}” não está mais disponível.`;
      if (toCents(current.extra_price) !== toCents(selected.extra_price)) return `O preço de “${selected.item_name}” mudou. Adicione o produto novamente.`;
    }
  }
  return "";
}

function orderSummary(ctx, cart, state, onEdit) {
  const wrapper = h("aside", { className: "vxp-card vxp-card__body vxp-stack vxp-checkout-summary", "aria-labelledby": "summary-title" });
  const itemsList = h("ul", { className: "vxp-stack vxp-stack--sm", "aria-label": "Itens do pedido" });
  cart.getItems().forEach((item) => {
    itemsList.append(h("li", { className: "vxp-row vxp-row--between" },
      h("span", { className: "vxp-small", text: `${item.quantity}× ${item.product_name}` }),
      h("strong", { className: "vxp-small", text: money(ctx, itemSubtotal(item)) }),
    ));
  });
  const edit = navLink(ctx, salesPath(ctx, `/loja/${encodeURIComponent(cart.slug)}`), "Editar carrinho", "vxp-btn vxp-btn--secondary vxp-btn--compact");
  if (onEdit) edit.addEventListener("click", onEdit, { capture: true });
  const lines = h("div", { className: "vxp-summary", "aria-live": "polite" });
  wrapper.append(
    h("div", { className: "vxp-row vxp-row--between" }, h("h2", { id: "summary-title", className: "vxp-section__title", text: "Resumo do pedido" }), edit),
    itemsList,
    lines,
  );
  const redraw = () => {
    const subtotal = cart.getTotals().subtotal;
    const delivery = state.orderType === "entrega" ? Number(state.quote?.fee || 0) : 0;
    state.total = subtotal + delivery;
    lines.replaceChildren(
      h("div", { className: "vxp-summary__line" }, h("span", { text: "Subtotal" }), h("span", { text: money(ctx, subtotal) })),
      state.orderType === "entrega" ? h("div", { className: "vxp-summary__line" }, h("span", { text: "Entrega" }), h("span", { text: state.quote?.available ? (delivery ? money(ctx, delivery) : "Grátis") : "A calcular" })) : null,
      h("div", { className: "vxp-summary__line vxp-summary__line--total" }, h("span", { text: "Total" }), h("span", { text: money(ctx, state.total) })),
      h("p", { className: "vxp-field__hint", text: "Disponibilidade, preços, desconto e frete serão validados novamente pelo servidor antes da criação." }),
    );
  };
  return { element: wrapper, redraw };
}

function pixSuccess(ctx, order, payment) {
  const token = String(order.publicToken || order.public_token || "");
  const trackPath = salesPath(ctx, `/pedido/${encodeURIComponent(token)}`);
  const code = String(payment?.pixCode || payment?.copyPaste || payment?.payload || "");
  const rawQr = String(payment?.qrCodeUrl || payment?.qrCode || "");
  const qr = rawQr && !rawQr.startsWith("data:") && !/^https?:/i.test(rawQr) ? `data:image/png;base64,${rawQr}` : rawQr;
  const content = h("section", { className: "vxp-shell--narrow vxp-stack vxp-stack--lg", "aria-labelledby": "order-created-title" },
    h("div", { className: "vxp-card vxp-card__body vxp-stack vxp-stack--lg" },
      h("div", { className: "vxp-state__inner" },
        h("span", { className: "vxp-state__icon", ariaHidden: "true", text: "✓" }),
        h("h1", { id: "order-created-title", className: "vxp-title", text: "Pedido criado" }),
        h("p", { className: "vxp-muted", text: `Pedido ${order.orderNumber ? `#${order.orderNumber}` : "recebido"}. Agora conclua o pagamento PIX.` }),
      ),
      qr ? imageOrFallback({ src: qr, alt: "QR Code PIX", className: "vxp-pix-qr", fallback: "PIX", eager: true }) : null,
      code ? h("div", { className: "vxp-copy" },
        h("code", { text: code }),
        h("button", {
          type: "button",
          className: "vxp-btn vxp-btn--secondary vxp-btn--compact",
          text: "Copiar PIX",
          onClick: async () => {
            try { await navigator.clipboard.writeText(code); toast(ctx, "Código PIX copiado.", "success"); }
            catch { toast(ctx, "Selecione e copie o código exibido.", "warning"); }
          },
        }),
      ) : alertBox("Os dados PIX ainda não estão disponíveis. Abra o acompanhamento para tentar novamente.", "warning"),
      navLink(ctx, trackPath, "Acompanhar pedido", "vxp-btn vxp-btn--wide"),
    ),
  );
  return main(content);
}

function renderCheckoutForm(ctx, root, store, settings, cart) {
  const profile = ctx.auth?.profile || {};
  const session = ctx.auth?.session || {};
  const availablePayments = paymentChoices(settings);
  const state = {
    orderType: settings.allow_delivery === false && settings.allow_pickup ? "retirada" : "entrega",
    paymentMethod: availablePayments[0] || "",
    customerCoordinates: null,
    quote: null,
    total: cart.getTotals().subtotal,
    dirty: false,
    submitted: false,
    submitting: false,
    quoteSequence: 0,
  };
  const form = h("form", { className: "vxp-stack vxp-stack--lg", novalidate: "" });
  const idempotencyKey = createId("checkout");

  const name = h("input", { type: "text", name: "name", autocomplete: "name", maxlength: "120", value: profile.full_name || "", required: true, placeholder: "Seu nome completo" });
  const documentInput = h("input", { type: "text", name: "document", inputmode: "text", autocapitalize: "characters", spellcheck: "false", autocomplete: "off", maxlength: "18", value: profile.document || "", placeholder: "CPF ou CNPJ" });
  const phone = h("input", { type: "tel", name: "phone", inputmode: "tel", autocomplete: "tel", maxlength: "20", value: profile.phone || "", required: true, placeholder: "(00) 00000-0000" });
  const zipCode = h("input", { type: "text", name: "zipCode", inputmode: "numeric", autocomplete: "postal-code", maxlength: "9", value: profile.zip_code || "", placeholder: "00000-000" });
  const street = h("input", { type: "text", name: "street", autocomplete: "address-line1", maxlength: "150", value: profile.street || "", placeholder: "Rua ou avenida" });
  const number = h("input", { type: "text", name: "number", autocomplete: "address-line2", maxlength: "20", value: profile.number || "", placeholder: "Número" });
  const complement = h("input", { type: "text", name: "complement", autocomplete: "address-line3", maxlength: "100", value: profile.complement || "", placeholder: "Apartamento, bloco…" });
  const neighborhood = h("input", { type: "text", name: "neighborhood", maxlength: "100", value: profile.neighborhood || "", placeholder: "Bairro" });
  const city = h("input", { type: "text", name: "city", autocomplete: "address-level2", maxlength: "100", value: profile.city || "", placeholder: "Cidade" });
  const stateInput = h("input", { type: "text", name: "state", autocomplete: "address-level1", maxlength: "2", value: profile.state || "", placeholder: "UF" });
  const reference = h("input", { type: "text", name: "reference", maxlength: "150", placeholder: "Portaria ou ponto de referência" });
  const changeFor = h("input", { type: "number", name: "changeFor", min: "0", step: "0.01", inputmode: "decimal", placeholder: "Ex.: 100,00" });
  const notes = h("textarea", { name: "notes", maxlength: "500", rows: "3", placeholder: "Observações gerais do pedido" });

  const steps = ["Seus dados", "Entrega", "Pagamento"].map((label, index) => h("span", { className: "vxp-step", dataset: { step: index + 1 }, ...(index === 0 ? { "aria-current": "step" } : {}), text: label }));
  const stepper = h("div", { className: "vxp-card vxp-stepper", "aria-label": "Etapas do checkout" }, steps);

  const identity = h("section", { className: "vxp-card vxp-card__body vxp-stack", dataset: { checkoutStep: "1" }, "aria-labelledby": "identity-title" },
    h("div", { className: "vxp-stack vxp-stack--xs" }, h("p", { className: "vxp-eyebrow", text: "Etapa 1 de 3" }), h("h2", { id: "identity-title", className: "vxp-section__title", text: "Seus dados" }), h("p", { className: "vxp-small vxp-muted", text: "A loja usa estes dados somente para identificar e atualizar seu pedido." })),
    h("div", { className: "vxp-form-grid" },
      field({ id: "checkout-name", label: "Nome completo", input: name, className: "vxp-col-12" }),
      field({ id: "checkout-document", label: "CPF ou CNPJ (opcional)", input: documentInput, hint: "Informe apenas se a loja precisar identificar o pagamento.", className: "vxp-col-6" }),
      field({ id: "checkout-phone", label: "WhatsApp", input: phone, hint: "A loja pode usar este número para avisos do pedido.", className: "vxp-col-6" }),
    ),
  );

  const deliveryRadios = h("div", { className: "vxp-radio-grid" });
  if (settings.allow_delivery !== false) deliveryRadios.append(makeRadioCard({ name: "orderType", value: "entrega", label: "Entrega", hint: "Receber no endereço", checked: state.orderType === "entrega" }));
  if (settings.allow_pickup) deliveryRadios.append(makeRadioCard({ name: "orderType", value: "retirada", label: "Retirada", hint: "Buscar na loja", checked: state.orderType === "retirada" }));
  const locationStatus = h("div", { "aria-live": "polite" });
  const quoteStatus = h("div", { "aria-live": "polite" });
  const cepButton = h("button", { type: "button", className: "vxp-btn vxp-btn--secondary", text: "Buscar CEP" });
  const locationButton = h("button", { type: "button", className: "vxp-btn vxp-btn--secondary", text: "Usar minha localização" });
  const addressFields = h("div", { className: "vxp-stack" },
    h("div", { className: "vxp-alert" }, h("span", { ariaHidden: "true", text: "⌖" }), h("span", { className: "vxp-small", text: "Ao tocar em “Usar minha localização”, o navegador pedirá permissão apenas para calcular a entrega. Você ainda deverá confirmar o endereço digitado." })),
    h("div", { className: "vxp-row vxp-row--wrap" }, locationButton),
    locationStatus,
    h("div", { className: "vxp-form-grid" },
      field({ id: "checkout-cep", label: "CEP", input: zipCode, className: "vxp-col-8" }),
      h("div", { className: "vxp-field vxp-col-4" }, h("span", { className: "vxp-field__label", text: "Localizar" }), cepButton),
      field({ id: "checkout-street", label: "Rua ou avenida", input: street, className: "vxp-col-8" }),
      field({ id: "checkout-number", label: "Número", input: number, className: "vxp-col-4" }),
      field({ id: "checkout-complement", label: "Complemento (opcional)", input: complement, className: "vxp-col-6" }),
      field({ id: "checkout-neighborhood", label: "Bairro", input: neighborhood, className: "vxp-col-6" }),
      field({ id: "checkout-city", label: "Cidade", input: city, className: "vxp-col-8" }),
      field({ id: "checkout-state", label: "UF", input: stateInput, className: "vxp-col-4" }),
      field({ id: "checkout-reference", label: "Referência (opcional)", input: reference, className: "vxp-col-12" }),
    ),
    quoteStatus,
  );
  const delivery = h("section", { className: "vxp-card vxp-card__body vxp-stack", dataset: { checkoutStep: "2" }, "aria-labelledby": "delivery-title" },
    h("div", { className: "vxp-stack vxp-stack--xs" }, h("p", { className: "vxp-eyebrow", text: "Etapa 2 de 3" }), h("h2", { id: "delivery-title", className: "vxp-section__title", text: "Como você quer receber?" })),
    deliveryRadios,
    addressFields,
  );

  const paymentRadios = h("div", { className: "vxp-radio-grid" });
  availablePayments.forEach((method, index) => paymentRadios.append(makeRadioCard({ name: "paymentMethod", value: method, label: PAYMENT_METHODS[method], checked: index === 0 })));
  const changeField = field({ id: "checkout-change", label: "Troco para quanto?", input: changeFor, hint: "Deixe em branco se não precisar de troco.", className: "vxp-col-12" });
  changeField.hidden = state.paymentMethod !== "dinheiro";
  const payment = h("section", { className: "vxp-card vxp-card__body vxp-stack", dataset: { checkoutStep: "3" }, "aria-labelledby": "payment-title" },
    h("div", { className: "vxp-stack vxp-stack--xs" }, h("p", { className: "vxp-eyebrow", text: "Etapa 3 de 3" }), h("h2", { id: "payment-title", className: "vxp-section__title", text: "Pagamento e revisão" })),
    availablePayments.length ? paymentRadios : alertBox("A loja não disponibilizou uma forma de pagamento. Entre em contato antes de pedir.", "error"),
    h("div", { className: "vxp-form-grid" }, changeField),
    field({ id: "checkout-notes", label: "Observações do pedido (opcional)", input: notes, hint: "Até 500 caracteres. Alterações de itens devem ser feitas no cardápio." }),
  );

  const errorArea = h("div", { "aria-live": "assertive" });
  const submit = h("button", { type: "submit", className: "vxp-btn vxp-btn--wide", disabled: !availablePayments.length, text: "Confirmar e enviar pedido" });
  const terms = h("p", { className: "vxp-field__hint", text: "Ao confirmar, o servidor recalcula valores e cria um único pedido. Não feche a página durante o envio." });
  form.append(stepper, identity, delivery, payment, errorArea, submit, terms);

  const summary = orderSummary(ctx, cart, state, null);
  const layout = h("div", { className: "vxp-checkout-layout" }, form, summary.element);

  const setOrderType = (value) => {
    state.orderType = value;
    addressFields.hidden = value !== "entrega";
    if (value !== "entrega") {
      state.quoteSequence += 1;
      state.quote = null;
      quoteStatus.replaceChildren();
    } else scheduleQuote();
    summary.redraw();
  };
  const selectedOrderType = form.querySelector('input[name="orderType"]:checked');
  state.orderType = selectedOrderType?.value || state.orderType;
  addressFields.hidden = state.orderType !== "entrega";
  form.addEventListener("change", (event) => {
    if (event.target.name === "orderType") setOrderType(event.target.value);
    if (event.target.name === "paymentMethod") {
      state.paymentMethod = event.target.value;
      changeField.hidden = state.paymentMethod !== "dinheiro";
    }
  });

  const updateStep = (event) => {
    const section = event.target.closest?.("[data-checkout-step]");
    if (!section) return;
    const current = Number(section.dataset.checkoutStep);
    steps.forEach((step, index) => {
      step.toggleAttribute("aria-current", index + 1 === current);
      step.dataset.complete = String(index + 1 < current);
    });
  };
  form.addEventListener("focusin", updateStep);
  form.addEventListener("input", () => { state.dirty = true; });
  documentInput.addEventListener("input", () => {
    const start = documentInput.selectionStart;
    documentInput.value = documentInput.value.toUpperCase().replace(/[^A-Z0-9./-]/g, "");
    if (start !== null) documentInput.setSelectionRange(Math.min(start, documentInput.value.length), Math.min(start, documentInput.value.length));
  });

  let quoteTimer = 0;
  let cepLookupTimer = 0;
  let cepController = null;
  const addressInputs = [zipCode, street, number, neighborhood, city, stateInput];
  const scheduleQuote = () => {
    globalThis.clearTimeout(quoteTimer);
    state.quoteSequence += 1;
    state.quote = null;
    summary.redraw();
    if (state.orderType !== "entrega") return;
    quoteTimer = globalThis.setTimeout(() => void quoteDelivery(false), 650);
  };
  addressInputs.forEach((input) => input.addEventListener("input", scheduleQuote));

  const quoteDelivery = async (force) => {
    if (state.orderType !== "entrega") return null;
    if (force) globalThis.clearTimeout(quoteTimer);
    const zip = onlyDigits(zipCode.value);
    if (zip.length !== 8 || !street.value.trim() || !number.value.trim() || !city.value.trim() || onlyDigits(stateInput.value).length > 0 || stateInput.value.trim().length !== 2) {
      if (force) quoteStatus.replaceChildren(alertBox("Complete CEP, rua, número, cidade e UF para calcular a entrega.", "warning"));
      return null;
    }
    const sequence = ++state.quoteSequence;
    quoteStatus.replaceChildren(h("div", { className: "vxp-alert", role: "status" }, h("span", { className: "vxp-btn__spinner", ariaHidden: "true" }), h("span", { text: "Calculando entrega…" })));
    try {
      const quote = await unwrap(ctx.api.fn("quote-delivery", {
        storeId: store.id,
        subtotal: cart.getTotals().subtotal,
        address: {
          cep: zip,
          street: street.value.trim(),
          number: number.value.trim(),
          neighborhood: neighborhood.value.trim(),
          city: city.value.trim(),
          state: stateInput.value.trim().toUpperCase(),
        },
        customerCoordinates: state.customerCoordinates,
      }));
      if (sequence !== state.quoteSequence || root.pageSignal.aborted) return null;
      state.quote = quote ? {
        ...quote,
        fee: Number(quote.fee || 0),
        available: Boolean(quote.available),
        region: quote.region || (quote.regionId ? { id: quote.regionId } : null),
      } : null;
      if (state.quote?.available) {
        const estimate = Number(quote.estimatedMin || quote.estimated_min || 0);
        quoteStatus.replaceChildren(alertBox(`Entrega disponível por ${state.quote.fee ? money(ctx, state.quote.fee) : "grátis"}${estimate ? `. Estimativa: ${estimate} min.` : "."}`, "success"));
      } else {
        quoteStatus.replaceChildren(alertBox(String(state.quote?.reason || "Entrega indisponível para este endereço."), "error"));
      }
      summary.redraw();
      return state.quote;
    } catch (error) {
      if (sequence !== state.quoteSequence) return null;
      state.quote = null;
      quoteStatus.replaceChildren(alertBox(publicError(error, "Não foi possível calcular a entrega."), "error"));
      summary.redraw();
      return null;
    }
  };

  const runCepLookup = async () => {
    cepController?.abort();
    cepController = new AbortController();
    setButtonBusy(cepButton, true, "Buscando…");
    try {
      const address = await lookupCep(ctx, zipCode.value);
      if (cepController.signal.aborted) return;
      zipCode.value = address.zipCode;
      street.value = address.street;
      neighborhood.value = address.neighborhood;
      city.value = address.city;
      stateInput.value = address.state;
      number.focus();
      toast(ctx, "Endereço localizado. Informe o número para calcular a entrega.", "success");
      scheduleQuote();
    } catch (error) {
      if (error?.name !== "AbortError") {
        setFieldError(zipCode, error.message || "CEP não encontrado.");
        zipCode.focus();
      }
    } finally { setButtonBusy(cepButton, false); }
  };
  cepButton.addEventListener("click", () => {
    globalThis.clearTimeout(cepLookupTimer);
    void runCepLookup();
  });
  zipCode.addEventListener("input", () => {
    setFieldError(zipCode, "");
    globalThis.clearTimeout(cepLookupTimer);
    if (onlyDigits(zipCode.value).length === 8) {
      cepLookupTimer = globalThis.setTimeout(() => void runCepLookup(), 300);
    }
  });
  locationButton.addEventListener("click", async () => {
    setButtonBusy(locationButton, true, "Solicitando…");
    locationStatus.replaceChildren();
    try {
      state.customerCoordinates = await getPosition();
      const address = await unwrap(ctx.api.fn("reverse-geocode", state.customerCoordinates));
      if (address?.cep) zipCode.value = onlyDigits(address.cep);
      if (address?.street) street.value = address.street;
      if (address?.neighborhood) neighborhood.value = address.neighborhood;
      if (address?.city) city.value = address.city;
      if (address?.state) stateInput.value = String(address.state).toUpperCase().slice(0, 2);
      locationStatus.replaceChildren(alertBox("Endereço aproximado preenchido. Confirme rua, número, bairro, cidade e CEP antes de calcular a entrega; as coordenadas não são colocadas na URL nem em logs.", "success"));
      number.focus();
      scheduleQuote();
    } catch (error) {
      state.customerCoordinates = null;
      locationStatus.replaceChildren(alertBox(error.message, "error"));
    } finally { setButtonBusy(locationButton, false); }
  });

  const validateForm = () => {
    let firstInvalid = null;
    const invalidate = (input, message) => {
      setFieldError(input, message);
      if (!firstInvalid) firstInvalid = input;
    };
    [name, documentInput, phone, zipCode, street, number, neighborhood, city, stateInput, changeFor].forEach((input) => setFieldError(input, ""));
    if (name.value.trim().length < 2) invalidate(name, "Informe seu nome completo.");
    if (!validDocument(documentInput.value)) invalidate(documentInput, "Informe um CPF ou CNPJ válido, ou deixe em branco.");
    const phoneDigits = onlyDigits(phone.value);
    if (phoneDigits.length < 10 || phoneDigits.length > 11) invalidate(phone, "Informe um telefone com DDD.");
    if (state.orderType === "entrega") {
      if (onlyDigits(zipCode.value).length !== 8) invalidate(zipCode, "Informe os 8 números do CEP.");
      if (!street.value.trim()) invalidate(street, "Informe a rua ou avenida.");
      if (!number.value.trim()) invalidate(number, "Informe o número ou “S/N”.");
      if (!neighborhood.value.trim()) invalidate(neighborhood, "Informe o bairro.");
      if (!city.value.trim()) invalidate(city, "Informe a cidade.");
      if (!/^[A-Za-z]{2}$/.test(stateInput.value.trim())) invalidate(stateInput, "Informe a UF com 2 letras.");
    }
    if (!availablePayments.includes(state.paymentMethod)) errorArea.replaceChildren(alertBox("Escolha uma forma de pagamento disponível.", "error"));
    const change = Number(changeFor.value || 0);
    if (state.paymentMethod === "dinheiro" && change > 0 && change < state.total) invalidate(changeFor, "O valor para troco deve ser igual ou maior que o total.");
    firstInvalid?.focus();
    return !firstInvalid && availablePayments.includes(state.paymentMethod);
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.submitting) return;
    errorArea.replaceChildren();
    if (!validateForm()) return;
    const open = isStoreOpen(settings.business_hours, settings.is_open);
    if (store.is_suspended || store.is_active === false) {
      errorArea.replaceChildren(alertBox("A loja não pode receber pedidos no momento.", "error"));
      return;
    }
    if (!open && !settings.accept_orders_when_closed) {
      errorArea.replaceChildren(alertBox("A loja fechou antes da confirmação. Volte ao cardápio para consultar o horário.", "error"));
      return;
    }
    const minimum = Number(settings.min_order_value ?? settings.min_order_amount ?? 0);
    if (cart.getTotals().subtotal < minimum) {
      errorArea.replaceChildren(alertBox(`O pedido mínimo desta loja é ${money(ctx, minimum)}.`, "error"));
      return;
    }
    state.submitting = true;
    setButtonBusy(submit, true, "Validando e enviando…");
    try {
      const currentItems = cart.getItems();
      const cartError = await validateCart(ctx, store.id, currentItems);
      if (cartError) {
        errorArea.replaceChildren(alertBox(cartError, "error"));
        return;
      }
      let quote = null;
      if (state.orderType === "entrega") {
        quote = await quoteDelivery(true);
        if (!quote?.available) {
          errorArea.replaceChildren(alertBox(String(quote?.reason || "Confirme um endereço atendido pela loja."), "error"));
          return;
        }
      }
      const payload = {
        storeId: store.id,
        idempotencyKey,
        items: currentItems.map((item) => ({
          productId: item.product_id,
          quantity: item.quantity,
          notes: item.notes || null,
          options: item.options.map((option) => ({ optionId: option.option_id, itemId: option.item_id })),
        })),
        customer: {
          name: name.value.trim(),
          phone: onlyDigits(phone.value),
          document: normalizeDocument(documentInput.value) || null,
          email: session?.user?.email || session?.email || null,
        },
        delivery: {
          type: state.orderType,
          zipCode: state.orderType === "entrega" ? onlyDigits(zipCode.value) : "",
          street: state.orderType === "entrega" ? street.value.trim() : "",
          number: state.orderType === "entrega" ? number.value.trim() : "",
          complement: state.orderType === "entrega" ? complement.value.trim() : "",
          neighborhood: state.orderType === "entrega" ? neighborhood.value.trim() : "",
          city: state.orderType === "entrega" ? city.value.trim() : "",
          state: state.orderType === "entrega" ? stateInput.value.trim().toUpperCase() : "",
          regionId: quote?.region?.id || quote?.regionId || null,
          reference: state.orderType === "entrega" ? reference.value.trim() || null : null,
          customerCoordinates: state.orderType === "entrega" ? state.customerCoordinates : null,
        },
        paymentMethod: state.paymentMethod,
        changeFor: state.paymentMethod === "dinheiro" && Number(changeFor.value) > 0 ? Number(changeFor.value) : null,
        couponCode: null,
        notes: notes.value.trim() || null,
        reference: state.orderType === "entrega" ? reference.value.trim() || null : null,
      };
      const checkout = await unwrap(ctx.api.fn("create-checkout-order", payload));
      if (!checkout?.publicToken || !checkout?.orderId) throw new Error("O pedido foi recebido sem código de acompanhamento.");
      state.submitted = true;
      state.dirty = false;
      cart.clear();
      toast(ctx, "Pedido criado com sucesso.", "success");
      if (state.paymentMethod === "pix") {
        replaceMain(root, pixSuccess(ctx, checkout, checkout.payment || {}));
        root.querySelector("h1")?.focus?.();
      } else {
        ctx.navigate(salesPath(ctx, `/pedido/${encodeURIComponent(checkout.publicToken)}`));
      }
    } catch (error) {
      errorArea.replaceChildren(alertBox(publicError(error), "error"));
      errorArea.scrollIntoView({ block: "center", behavior: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    } finally {
      state.submitting = false;
      setButtonBusy(submit, false);
    }
  });

  const beforeUnload = (event) => {
    if (state.submitted || (!state.dirty && !state.submitting)) return;
    event.preventDefault();
    event.returnValue = "";
  };
  globalThis.addEventListener("beforeunload", beforeUnload);
  const leaveGuard = (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link || !root.contains(link) || state.submitted) return;
    if (state.submitting) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toast(ctx, "Aguarde a confirmação do pedido antes de sair.", "warning");
      return;
    }
    if (!state.dirty) return;
    if (globalThis.confirm?.("Sair do checkout? Os dados ainda não enviados serão perdidos.")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  root.addEventListener("click", leaveGuard, true);
  root.addCleanup(() => {
    globalThis.removeEventListener("beforeunload", beforeUnload);
    root.removeEventListener("click", leaveGuard, true);
    globalThis.clearTimeout(quoteTimer);
    globalThis.clearTimeout(cepLookupTimer);
    cepController?.abort();
  });
  if (state.orderType === "entrega" && onlyDigits(zipCode.value).length === 8) globalThis.setTimeout(() => void runCepLookup(), 0);
  summary.redraw();
  return layout;
}

export function renderCheckout(ctx) {
  const slug = routeParam(ctx, "slug");
  const root = createPage(ctx, { label: "Finalizar pedido" });
  root.append(shellHeader(ctx, { backPath: salesPath(ctx, `/loja/${encodeURIComponent(slug)}`), backLabel: "Cardápio", title: "Finalizar pedido", compact: true }), main(loadingState("Preparando checkout seguro…")));
  if (!slug || slug.length > 120) {
    replaceMain(root, main(errorState({ title: "Checkout inválido", message: "Volte ao cardápio e tente novamente." })));
    return root;
  }
  const cart = createCartStore(slug);
  if (!cart.getItems().length) {
    replaceMain(root, main(errorState({
      title: "Seu carrinho está vazio",
      message: "Adicione itens antes de finalizar.",
      retry: () => ctx.navigate(salesPath(ctx, `/loja/${encodeURIComponent(slug)}`)),
    })));
    return root;
  }

  const load = async () => {
    try {
      const store = await unwrap(ctx.api.from("stores").select(STORE_COLUMNS).eq("slug", slug).eq("is_active", true).maybeSingle());
      if (!store) throw new Error("not found");
      const settings = await unwrap(ctx.api.from("store_settings").select(SETTINGS_COLUMNS).eq("store_id", store.id).maybeSingle());
      if (!settings) throw new Error("Configuração da loja indisponível.");
      if (root.pageSignal.aborted) return;
      const content = h("div", { className: "vxp-stack vxp-stack--lg" },
        h("div", { className: "vxp-row" },
          imageOrFallback({ src: store.logo_url, alt: `Logo de ${store.public_name || store.name}`, className: "vxp-avatar", fallback: String(store.public_name || store.name || "L").slice(0, 1) }),
          h("div", { className: "vxp-grow" }, h("p", { className: "vxp-eyebrow", text: "Seu pedido em" }), h("h1", { className: "vxp-title vxp-title--sm", text: store.public_name || store.name })),
        ),
        renderCheckoutForm(ctx, root, store, settings, cart),
      );
      replaceMain(root, main(content));
    } catch (error) {
      if (root.pageSignal.aborted) return;
      replaceMain(root, main(errorState({
        title: "Não foi possível abrir o checkout",
        message: publicError(error),
        retry: () => { replaceMain(root, main(loadingState("Preparando checkout…"))); void load(); },
      })));
    }
  };
  void load();
  return root;
}

export const routes = [
  { pattern: "/loja/:slug/checkout", auth: "customer", title: "Finalizar pedido | Hype Delivery", render: renderCheckout },
  { pattern: "/vendas/loja/:slug/checkout", auth: "customer", title: "Finalizar pedido | Hype Delivery", render: renderCheckout },
];

export { normalizeDocument, validDocument, validateCart };
