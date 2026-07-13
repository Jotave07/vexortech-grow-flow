import { createCollectionPage } from "./collection-page.js";
import {
  badge,
  button,
  confirmAction,
  createPage,
  dataOf,
  field,
  getStoreId,
  h,
  money,
  normalizeSearch,
  openDialog,
  requireMerchant,
  serializeForm,
  toast,
  withBusy,
} from "./core.js";

const digits = (value) => String(value ?? "").replace(/\D/g, "");
const text = (value) => String(value ?? "").trim();
const nullable = (value) => text(value) || null;
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const normalizeCep = (value) => digits(value).slice(0, 8);
export const formatCep = (value) => {
  const cep = normalizeCep(value);
  return cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;
};

export const zoneCoverageKind = (zone) => {
  if (normalizeCep(zone.zip_start) && normalizeCep(zone.zip_end)) return "Faixa de CEP";
  if (text(zone.neighborhood) && text(zone.neighborhood).toUpperCase() !== "GERAL") return "Bairro";
  return "Cidade/UF";
};

export const zoneCoverageLabel = (zone) => {
  const start = normalizeCep(zone.zip_start);
  const end = normalizeCep(zone.zip_end);
  if (start && end) return `${formatCep(start)} a ${formatCep(end)}`;
  const neighborhood = text(zone.neighborhood);
  const place = [text(zone.city), text(zone.state).toUpperCase()].filter(Boolean).join("/");
  if (neighborhood && neighborhood.toUpperCase() !== "GERAL") return [neighborhood, place].filter(Boolean).join(" · ");
  return place || "Cobertura não definida";
};

const numberInRange = (label, value, minimum, maximum, { nullableValue = false } = {}) => {
  if (nullableValue && text(value) === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} deve ficar entre ${minimum} e ${maximum}.`);
  }
  return parsed;
};

export function buildZonePayload(values) {
  const name = text(values.name);
  const neighborhood = text(values.neighborhood).toUpperCase();
  const city = text(values.city).toUpperCase();
  const state = text(values.state).toUpperCase();
  const zipStart = normalizeCep(values.zip_start);
  const zipEnd = normalizeCep(values.zip_end);
  if (!name) throw new Error("Informe um nome para a região.");
  if ((zipStart && !zipEnd) || (!zipStart && zipEnd)) throw new Error("Informe o CEP inicial e o final da faixa.");
  if ((zipStart && zipStart.length !== 8) || (zipEnd && zipEnd.length !== 8)) throw new Error("A faixa deve usar CEPs com 8 dígitos.");
  if (zipStart && zipEnd && zipStart > zipEnd) throw new Error("O CEP inicial não pode ser maior que o final.");
  if (!zipStart && (!city || !state)) throw new Error("Sem faixa de CEP, informe cidade e UF.");
  if (state && !/^[A-Z]{2}$/.test(state)) throw new Error("Informe a UF com 2 letras.");

  const fee = numberInRange("A taxa base", values.fee, 0, 100_000);
  const feePerKm = numberInRange("A taxa por km", values.fee_per_km, 0, 10_000);
  const minFee = numberInRange("A taxa mínima", values.min_fee, 0, 100_000, { nullableValue: true });
  const maxFee = numberInRange("A taxa máxima", values.max_fee, 0, 100_000, { nullableValue: true });
  if (minFee !== null && maxFee !== null && minFee > maxFee) throw new Error("A taxa mínima não pode superar a máxima.");
  const minOrder = numberInRange("O pedido mínimo", values.min_order, 0, 1_000_000);
  const maxRadius = numberInRange("O raio da região", values.max_radius_km, 0.1, 500, { nullableValue: true });
  const basePrep = numberInRange("O preparo base", values.base_prep_time, 1, 240);
  const minutesPerKm = numberInRange("Os minutos por km", values.minutes_per_km, 0, 120);
  const additionalTime = numberInRange("O tempo extra", values.additional_region_time, 0, 240);
  const priority = numberInRange("A prioridade", values.priority, 0, 1000);
  if (!Number.isInteger(priority)) throw new Error("A prioridade deve ser um número inteiro.");

  return {
    name: name.slice(0, 160),
    neighborhood: (neighborhood || "GERAL").slice(0, 120),
    city: city ? city.slice(0, 120) : null,
    state: state || null,
    zip_start: zipStart || null,
    zip_end: zipEnd || null,
    max_radius_km: maxRadius,
    fee,
    fee_per_km: feePerKm,
    min_fee: minFee,
    max_fee: maxFee,
    min_order: minOrder,
    base_prep_time: basePrep,
    minutes_per_km: minutesPerKm,
    additional_region_time: additionalTime,
    estimated_minutes: Math.round(basePrep + additionalTime),
    priority,
    is_active: Boolean(values.is_active),
    internal_notes: nullable(values.internal_notes)?.slice(0, 500) || null,
  };
}

export const quoteAddressLabel = (address) => {
  if (!address || typeof address !== "object") return "Endereço não normalizado";
  const first = [text(address.street), text(address.number)].filter(Boolean).join(", ");
  const second = [text(address.neighborhood), [text(address.city), text(address.state).toUpperCase()].filter(Boolean).join("/")].filter(Boolean).join(" · ");
  return [first, second, formatCep(address.cep)].filter(Boolean).join(" — ");
};

const controlField = (ctx, options, attributes = {}) => {
  const wrapper = field(ctx, options);
  const control = wrapper.querySelector("input, select, textarea");
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null) control?.setAttribute(key, String(value));
  });
  return wrapper;
};

const sectionHeading = (ctx, title, description) => h(ctx, "div", { className: "merchant-section__heading" },
  h(ctx, "h3", { className: "merchant-panel__title" }, title),
  h(ctx, "p", { className: "merchant-page__description" }, description));

const queryDelivery = async (ctx, input) => dataOf(ctx.api.fn("quote-delivery", {
  storeId: getStoreId(ctx),
  subtotal: Math.max(0, asNumber(input.subtotal, 0)),
  address: {
    cep: normalizeCep(input.cep),
    street: text(input.street),
    number: text(input.number),
    neighborhood: text(input.neighborhood),
    city: text(input.city),
    state: text(input.state).toUpperCase(),
  },
}), {});

const applyNormalizedAddress = (form, quote, { includeZipEnd = false } = {}) => {
  const address = quote?.normalizedAddress;
  if (!address) throw new Error(quote?.reason || "O servidor não conseguiu normalizar este CEP.");
  const set = (name, value) => {
    const control = form.elements.namedItem(name);
    if (control && value) control.value = value;
  };
  set("cep", formatCep(address.cep));
  set("zip_start", formatCep(address.cep));
  if (includeZipEnd && !form.elements.namedItem("zip_end")?.value) set("zip_end", formatCep(address.cep));
  set("street", address.street);
  set("neighborhood", address.neighborhood);
  set("city", address.city);
  set("state", address.state);
  const name = form.elements.namedItem("name");
  if (name && !text(name.value)) name.value = text(address.neighborhood) || text(address.city) || `CEP ${formatCep(address.cep)}`;
  return address;
};

const renderQuoteResult = (ctx, container, result) => {
  const available = Boolean(result?.available);
  const estimateStart = Number(result?.estimatedMin ?? result?.estimated_min);
  const estimateEnd = Number(result?.estimatedMax ?? result?.estimated_max);
  const distance = Number(result?.distanceKm ?? result?.distance_km);
  const details = [];
  if (result?.regionName || result?.region?.name) details.push(["Região aplicada", result.regionName || result.region.name]);
  if (Number.isFinite(distance)) details.push(["Distância validada", `${distance.toFixed(1).replace(".", ",")} km`]);
  if (available || Number.isFinite(Number(result?.fee))) details.push(["Taxa", money(ctx, result?.fee || 0)]);
  if (Number.isFinite(estimateStart) && estimateStart > 0) {
    details.push(["Previsão", `${estimateStart}${Number.isFinite(estimateEnd) && estimateEnd > estimateStart ? `–${estimateEnd}` : ""} min`]);
  }
  if (result?.normalizedAddress) details.push(["Endereço confirmado", quoteAddressLabel(result.normalizedAddress)]);
  container.className = `merchant-quote-result merchant-quote-result--${available ? "success" : "danger"}`;
  container.replaceChildren(
    h(ctx, "strong", {}, available ? "Entrega disponível" : "Entrega indisponível"),
    h(ctx, "p", {}, result?.reason || (available ? "O endereço passou pelas regras ativas." : "O endereço não passou pelas regras ativas.")),
    details.length ? h(ctx, "dl", { className: "merchant-definition-list" }, details.map(([label, value]) => [
      h(ctx, "dt", {}, label), h(ctx, "dd", {}, value),
    ])) : null,
  );
};

export function render(ctx) {
  const page = createPage(ctx, {
    title: "Entregas",
    description: "Defina cobertura, preço e prazo; depois valide um endereço exatamente como o checkout fará.",
  });
  const state = { zones: [], store: null, settings: null, query: "", disposed: false, dialogs: new Set() };
  page.onCleanup(() => {
    state.disposed = true;
    state.dialogs.forEach((dialog) => dialog.remove());
    state.dialogs.clear();
  });

  const registerDialog = (modal) => {
    state.dialogs.add(modal.dialog);
    return modal;
  };
  const add = button(ctx, "Adicionar região", { primary: true, onClick: () => openEditor() });
  const testAddress = button(ctx, "Testar endereço", { onClick: () => openQuoteTester() });
  page.actions.append(testAddress, add);

  const load = async () => {
    page.loading("Carregando regras de entrega…");
    try {
      await requireMerchant(ctx);
      const storeId = getStoreId(ctx);
      [state.zones, state.store, state.settings] = await Promise.all([
        dataOf(ctx.api.from("delivery_zones").select("*").eq("store_id", storeId).order("priority", { ascending: false }), []),
        dataOf(ctx.api.from("stores").select("id, city, state, zip_code, address, address_number, neighborhood").eq("id", storeId).maybeSingle(), {}),
        dataOf(ctx.api.from("store_settings").select("store_id, allow_delivery, delivery_radius_km").eq("store_id", storeId).maybeSingle(), {}),
      ]);
      if (!state.disposed) renderView();
    } catch (error) {
      if (!state.disposed) page.fail(error, load);
    }
  };

  const filteredZones = () => {
    const query = normalizeSearch(state.query);
    if (!query) return state.zones;
    return state.zones.filter((zone) => normalizeSearch([
      zone.name, zone.neighborhood, zone.city, zone.state, zone.zip_start, zone.zip_end,
    ].join(" ")).includes(query));
  };

  const renderView = ({ restoreSearch = false, caret = null } = {}) => {
    const zones = filteredZones();
    const active = state.zones.filter((zone) => zone.is_active !== false);
    const radii = active.map((zone) => asNumber(zone.max_radius_km, 0)).filter((value) => value > 0);
    const globalRadius = asNumber(state.settings?.delivery_radius_km, 0);
    const maxScale = Math.max(globalRadius, ...radii, 1);
    const search = h(ctx, "input", {
      type: "search",
      className: "merchant-input",
      value: state.query,
      placeholder: "Buscar região, bairro, cidade ou CEP…",
      "aria-label": "Buscar regras de entrega",
      dataset: { deliverySearch: "true" },
      onInput: (event) => {
        state.query = event.currentTarget.value;
        renderView({ restoreSearch: true, caret: event.currentTarget.selectionStart });
      },
    });
    const summary = h(ctx, "section", { className: "merchant-delivery-summary", "aria-label": "Resumo das entregas" },
      h(ctx, "article", { className: "merchant-panel merchant-stat" },
        h(ctx, "span", { className: "merchant-stat__label" }, "Regiões ativas"),
        h(ctx, "strong", { className: "merchant-stat__value" }, String(active.length)),
        h(ctx, "span", { className: "merchant-stat__hint" }, `${state.zones.length - active.length} inativa(s)`)),
      h(ctx, "article", { className: "merchant-panel merchant-stat" },
        h(ctx, "span", { className: "merchant-stat__label" }, "Raio global"),
        h(ctx, "strong", { className: "merchant-stat__value" }, globalRadius > 0 ? `${globalRadius.toFixed(1).replace(".", ",")} km` : "—"),
        h(ctx, "span", { className: "merchant-stat__hint" }, globalRadius > 0 ? "Limite aplicado a todas as regiões" : "Sem limite global configurado")),
      h(ctx, "article", { className: "merchant-panel merchant-stat" },
        h(ctx, "span", { className: "merchant-stat__label" }, "Entrega no checkout"),
        h(ctx, "strong", { className: "merchant-stat__value merchant-stat__value--small" }, state.settings?.allow_delivery === false ? "Pausada" : "Ativa"),
        h(ctx, "span", { className: "merchant-stat__hint" }, state.settings?.allow_delivery === false ? "Ative em Configurações" : "Validação no servidor")));

    const explanation = h(ctx, "section", { className: "merchant-panel merchant-delivery-priority" },
      sectionHeading(ctx, "Como uma regra vence", "O servidor escolhe por precisão; a prioridade desempata apenas regras do mesmo nível."),
      h(ctx, "ol", {},
        h(ctx, "li", {}, h(ctx, "strong", {}, "1. Faixa de CEP"), " — correspondência mais precisa"),
        h(ctx, "li", {}, h(ctx, "strong", {}, "2. Bairro"), " — dentro da cidade e UF"),
        h(ctx, "li", {}, h(ctx, "strong", {}, "3. Cidade/UF"), " — cobertura geral")),
      h(ctx, "p", { className: "merchant-page__description" }, "Depois da escolha, os raios global e da região ainda podem bloquear o endereço. A taxa final é taxa base + valor por km, limitada por mínimo/máximo."));

    const toolbar = h(ctx, "div", { className: "merchant-panel merchant-toolbar" },
      h(ctx, "label", { className: "merchant-field" }, h(ctx, "span", {}, "Buscar regras"), search),
      h(ctx, "p", { role: "status" }, `${zones.length} de ${state.zones.length} região(ões)`));

    let list;
    if (!state.zones.length) {
      list = h(ctx, "div", { className: "merchant-state" },
        h(ctx, "strong", {}, "Nenhuma região configurada"),
        h(ctx, "span", {}, "Crie uma regra e teste um CEP antes de abrir as entregas."),
        button(ctx, "Criar primeira região", { primary: true, onClick: () => openEditor() }));
    } else if (!zones.length) {
      list = h(ctx, "div", { className: "merchant-state" }, h(ctx, "strong", {}, "Nenhuma regra encontrada"), h(ctx, "span", {}, "Revise o termo da busca."));
    } else {
      list = h(ctx, "div", { className: "merchant-zone-list" }, zones.map((zone) => renderZoneCard(zone, maxScale)));
    }
    page.root.dataset.pageState = state.zones.length ? "ready" : "empty";
    page.setContent(summary, explanation, toolbar, list);
    page.announce(`${zones.length} regras de entrega exibidas.`);
    if (restoreSearch) {
      const next = page.content.querySelector("[data-delivery-search]");
      next?.focus();
      if (Number.isInteger(caret)) next?.setSelectionRange(caret, caret);
    }
  };

  const renderZoneCard = (zone, maxScale) => {
    const radius = asNumber(zone.max_radius_km, 0);
    const baseTime = asNumber(zone.base_prep_time, 30);
    const perKm = asNumber(zone.minutes_per_km, 5);
    const extraTime = asNumber(zone.additional_region_time, 0);
    const pricing = `${money(ctx, zone.fee || 0)}${asNumber(zone.fee_per_km, 0) > 0 ? ` + ${money(ctx, zone.fee_per_km)}/km` : ""}`;
    const limits = [
      zone.min_fee !== null && zone.min_fee !== undefined ? `mín. ${money(ctx, zone.min_fee)}` : "",
      zone.max_fee !== null && zone.max_fee !== undefined ? `máx. ${money(ctx, zone.max_fee)}` : "",
    ].filter(Boolean).join(" · ") || "sem limite de taxa";
    const actions = h(ctx, "div", { className: "merchant-actions" },
      button(ctx, "Editar", { quiet: true, onClick: () => openEditor(zone) }),
      button(ctx, zone.is_active === false ? "Ativar" : "Desativar", { quiet: true, onClick: (event) => void toggleZone(zone, event.currentTarget) }),
      button(ctx, "Excluir", { danger: true, onClick: (event) => void removeZone(zone, event.currentTarget) }));
    return h(ctx, "article", { className: "merchant-panel merchant-zone", dataset: { active: zone.is_active === false ? "false" : "true" } },
      h(ctx, "header", { className: "merchant-zone__header" },
        h(ctx, "div", {},
          h(ctx, "div", { className: "merchant-zone__title" }, h(ctx, "h3", {}, zone.name || "Região sem nome"), badge(ctx, zone.is_active === false ? "Inativa" : "Ativa", zone.is_active === false ? "danger" : "success"), badge(ctx, `Prioridade ${asNumber(zone.priority, 0)}`, "info")),
          h(ctx, "p", { className: "merchant-page__description" }, `${zoneCoverageKind(zone)}: ${zoneCoverageLabel(zone)}`)),
        actions),
      h(ctx, "dl", { className: "merchant-zone__facts" },
        h(ctx, "div", {}, h(ctx, "dt", {}, "Preço"), h(ctx, "dd", {}, pricing), h(ctx, "small", {}, limits)),
        h(ctx, "div", {}, h(ctx, "dt", {}, "Pedido mínimo"), h(ctx, "dd", {}, money(ctx, zone.min_order || 0))),
        h(ctx, "div", {}, h(ctx, "dt", {}, "Prazo"), h(ctx, "dd", {}, `${baseTime} min + ${perKm} min/km + ${extraTime} min extras`))),
      h(ctx, "div", { className: "merchant-zone__radius" },
        h(ctx, "span", {}, radius > 0 ? `Raio próprio: ${radius.toFixed(1).replace(".", ",")} km` : "Sem raio próprio; usa os demais limites"),
        radius > 0 ? h(ctx, "meter", { min: 0, max: maxScale, value: radius, "aria-label": `Raio de ${zone.name}: ${radius} quilômetros` }, `${radius} km`) : null),
      zone.internal_notes ? h(ctx, "p", { className: "merchant-zone__notes" }, `Nota interna: ${zone.internal_notes}`) : null);
  };

  const openEditor = (zone = null) => {
    const form = h(ctx, "form", { className: "merchant-form", novalidate: "" });
    const zipStartField = controlField(ctx, { name: "zip_start", label: "CEP inicial", value: formatCep(zone?.zip_start) }, { maxlength: 9, inputmode: "numeric" });
    const zipEndField = controlField(ctx, { name: "zip_end", label: "CEP final", value: formatCep(zone?.zip_end) }, { maxlength: 9, inputmode: "numeric" });
    const cepStatus = h(ctx, "p", { className: "merchant-field__hint", role: "status", "aria-live": "polite" }, "O preenchimento consulta o mesmo serviço seguro usado pelo checkout.");
    const lookupCepButton = button(ctx, "Preencher pelo CEP inicial", { onClick: (event) => void withBusy(event.currentTarget, async () => {
      try {
        const cep = form.elements.namedItem("zip_start")?.value;
        if (normalizeCep(cep).length !== 8) throw new Error("Informe um CEP inicial com 8 dígitos.");
        cepStatus.textContent = "Validando CEP no servidor…";
        const quote = await queryDelivery(ctx, { cep, subtotal: 0 });
        const address = applyNormalizedAddress(form, quote, { includeZipEnd: true });
        cepStatus.textContent = `CEP confirmado: ${quoteAddressLabel(address)}. Revise antes de salvar.`;
      } catch (error) {
        cepStatus.textContent = error.message;
        toast(ctx, error.message, "error");
      }
    }) });

    const coverage = h(ctx, "fieldset", { className: "merchant-section" },
      h(ctx, "legend", { className: "merchant-visually-hidden" }, "Cobertura"),
      sectionHeading(ctx, "Cobertura", "Use faixa de CEP para precisão; bairro ou cidade/UF como alternativa."),
      h(ctx, "div", { className: "merchant-form__grid" },
        controlField(ctx, { name: "name", label: "Nome da região", value: zone?.name ?? "", required: true }, { maxlength: 160 }),
        controlField(ctx, { name: "neighborhood", label: "Bairro", value: zone?.neighborhood === "GERAL" ? "" : zone?.neighborhood ?? "", hint: "Vazio significa todos os bairros da cidade." }, { maxlength: 120 }),
        controlField(ctx, { name: "city", label: "Cidade", value: zone?.city ?? state.store?.city ?? "" }, { maxlength: 120 }),
        controlField(ctx, { name: "state", label: "UF", value: zone?.state ?? state.store?.state ?? "" }, { maxlength: 2 }),
        zipStartField, zipEndField,
        controlField(ctx, { name: "max_radius_km", label: "Raio máximo próprio (km)", type: "number", value: zone?.max_radius_km ?? "", min: 0.1, max: 500, step: 0.1, hint: "Opcional e nunca amplia o raio global." }, { inputmode: "decimal" }),
        controlField(ctx, { name: "priority", label: "Prioridade", type: "number", value: zone?.priority ?? 0, min: 0, max: 1000, step: 1, hint: "Maior vence somente entre regras igualmente precisas." }, { inputmode: "numeric" })),
      h(ctx, "div", { className: "merchant-actions" }, lookupCepButton), cepStatus,
      field(ctx, { name: "is_active", label: "Região ativa no checkout", type: "checkbox", value: zone?.is_active ?? true }));

    const pricing = h(ctx, "fieldset", { className: "merchant-section" },
      h(ctx, "legend", { className: "merchant-visually-hidden" }, "Preço"),
      sectionHeading(ctx, "Preço", "Taxa final = base + valor por km, respeitando os limites abaixo."),
      h(ctx, "div", { className: "merchant-form__grid" },
        controlField(ctx, { name: "fee", label: "Taxa base", type: "number", value: zone?.fee ?? 0, min: 0, step: 0.01, required: true }, { inputmode: "decimal" }),
        controlField(ctx, { name: "fee_per_km", label: "Taxa por km", type: "number", value: zone?.fee_per_km ?? 0, min: 0, step: 0.01 }, { inputmode: "decimal" }),
        controlField(ctx, { name: "min_fee", label: "Taxa mínima", type: "number", value: zone?.min_fee ?? "", min: 0, step: 0.01 }, { inputmode: "decimal" }),
        controlField(ctx, { name: "max_fee", label: "Taxa máxima", type: "number", value: zone?.max_fee ?? "", min: 0, step: 0.01 }, { inputmode: "decimal" }),
        controlField(ctx, { name: "min_order", label: "Pedido mínimo", type: "number", value: zone?.min_order ?? 0, min: 0, step: 0.01 }, { inputmode: "decimal" })));

    const timing = h(ctx, "fieldset", { className: "merchant-section" },
      h(ctx, "legend", { className: "merchant-visually-hidden" }, "Prazo"),
      sectionHeading(ctx, "Prazo", "Estimativa = preparo base + minutos por km + tempo extra da região."),
      h(ctx, "div", { className: "merchant-form__grid" },
        controlField(ctx, { name: "base_prep_time", label: "Preparo base (min)", type: "number", value: zone?.base_prep_time ?? 30, min: 1, max: 240, step: 1 }, { inputmode: "numeric" }),
        controlField(ctx, { name: "minutes_per_km", label: "Minutos por km", type: "number", value: zone?.minutes_per_km ?? 5, min: 0, max: 120, step: 1 }, { inputmode: "numeric" }),
        controlField(ctx, { name: "additional_region_time", label: "Tempo extra (min)", type: "number", value: zone?.additional_region_time ?? 0, min: 0, max: 240, step: 1 }, { inputmode: "numeric" })),
      controlField(ctx, { name: "internal_notes", label: "Nota interna", type: "textarea", value: zone?.internal_notes ?? "", hint: "Não aparece para o cliente." }, { maxlength: 500 }));

    form.append(coverage,
      h(ctx, "details", { className: "merchant-disclosure", open: "" }, h(ctx, "summary", {}, "Taxas e pedido mínimo"), h(ctx, "div", { className: "merchant-disclosure__content" }, pricing)),
      h(ctx, "details", { className: "merchant-disclosure" }, h(ctx, "summary", {}, "Prazo e nota interna"), h(ctx, "div", { className: "merchant-disclosure__content" }, timing)));
    let modal;
    const save = button(ctx, zone ? "Salvar alterações" : "Criar região", { primary: true, onClick: () => form.requestSubmit() });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void withBusy(save, async () => {
        try {
          const payload = buildZonePayload(serializeForm(form));
          const operation = zone
            ? ctx.api.from("delivery_zones").update(payload).eq("id", zone.id).eq("store_id", getStoreId(ctx))
            : ctx.api.from("delivery_zones").insert({ store_id: getStoreId(ctx), ...payload });
          await dataOf(operation);
          toast(ctx, `Região ${zone ? "atualizada" : "criada"}.`, "success");
          modal.close();
          await load();
        } catch (error) {
          toast(ctx, error.message, "error");
        }
      });
    });
    modal = registerDialog(openDialog(ctx, { title: zone ? `Editar ${zone.name}` : "Nova região de entrega", content: form, actions: [save] }));
    modal.dialog.classList.add("merchant-dialog--wide");
  };

  const toggleZone = async (zone, control) => withBusy(control, async () => {
    try {
      await dataOf(ctx.api.from("delivery_zones").update({ is_active: zone.is_active === false }).eq("id", zone.id).eq("store_id", getStoreId(ctx)));
      toast(ctx, "Status da região atualizado.", "success");
      await load();
    } catch (error) {
      toast(ctx, error.message, "error");
    }
  });

  const removeZone = async (zone, control) => {
    if (!await confirmAction(ctx, `Excluir a região ${zone.name}? Pedidos futuros deixarão de usar esta regra.`)) return;
    await withBusy(control, async () => {
      try {
        await dataOf(ctx.api.from("delivery_zones").delete().eq("id", zone.id).eq("store_id", getStoreId(ctx)));
        toast(ctx, "Região excluída.", "success");
        await load();
      } catch (error) {
        toast(ctx, error.message, "error");
      }
    });
  };

  const openQuoteTester = () => {
    const form = h(ctx, "form", { className: "merchant-form", novalidate: "" },
      h(ctx, "p", { className: "merchant-page__description" }, "A simulação consulta o servidor, normaliza o CEP e aplica as mesmas regras do checkout. Não cria pedido nem altera configurações."),
      h(ctx, "div", { className: "merchant-form__grid" },
        controlField(ctx, { name: "cep", label: "CEP", value: "", required: true }, { maxlength: 9, inputmode: "numeric", autocomplete: "postal-code" }),
        controlField(ctx, { name: "subtotal", label: "Subtotal do pedido", type: "number", value: 100, min: 0, step: 0.01, required: true }, { inputmode: "decimal" }),
        controlField(ctx, { name: "street", label: "Rua", value: "" }, { maxlength: 200, autocomplete: "address-line1" }),
        controlField(ctx, { name: "number", label: "Número", value: "" }, { maxlength: 40, autocomplete: "address-line2" }),
        controlField(ctx, { name: "neighborhood", label: "Bairro", value: "" }, { maxlength: 120 }),
        controlField(ctx, { name: "city", label: "Cidade", value: "" }, { maxlength: 120, autocomplete: "address-level2" }),
        controlField(ctx, { name: "state", label: "UF", value: "" }, { maxlength: 2, autocomplete: "address-level1" })),
      h(ctx, "div", { className: "merchant-quote-result", role: "status", "aria-live": "polite", "aria-atomic": "true" },
        h(ctx, "strong", {}, "Pronto para testar"), h(ctx, "p", {}, "Informe o CEP; os demais campos podem ser preenchidos automaticamente pelo servidor.")));
    const resultBox = form.lastElementChild;
    const run = button(ctx, "Calcular entrega", { primary: true, onClick: () => form.requestSubmit() });
    const fill = button(ctx, "Preencher pelo CEP", { onClick: (event) => void withBusy(event.currentTarget, async () => {
      try {
        const values = serializeForm(form);
        if (normalizeCep(values.cep).length !== 8) throw new Error("Informe um CEP com 8 dígitos.");
        resultBox.className = "merchant-quote-result";
        resultBox.replaceChildren(h(ctx, "strong", {}, "Validando CEP…"), h(ctx, "p", {}, "Aguarde a resposta do servidor."));
        const result = await queryDelivery(ctx, values);
        const address = applyNormalizedAddress(form, result);
        resultBox.replaceChildren(h(ctx, "strong", {}, "CEP confirmado"), h(ctx, "p", {}, quoteAddressLabel(address)));
      } catch (error) {
        resultBox.className = "merchant-quote-result merchant-quote-result--danger";
        resultBox.replaceChildren(h(ctx, "strong", {}, "Não foi possível preencher"), h(ctx, "p", {}, error.message));
      }
    }) });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void withBusy(run, async () => {
        try {
          const values = serializeForm(form);
          if (normalizeCep(values.cep).length !== 8) throw new Error("Informe um CEP com 8 dígitos.");
          const subtotal = Number(values.subtotal);
          if (!Number.isFinite(subtotal) || subtotal < 0) throw new Error("Informe um subtotal válido.");
          resultBox.className = "merchant-quote-result";
          resultBox.replaceChildren(h(ctx, "strong", {}, "Calculando…"), h(ctx, "p", {}, "Validando CEP, cobertura, raio, preço e prazo."));
          const result = await queryDelivery(ctx, values);
          applyNormalizedAddress(form, result);
          renderQuoteResult(ctx, resultBox, result);
        } catch (error) {
          resultBox.className = "merchant-quote-result merchant-quote-result--danger";
          resultBox.replaceChildren(h(ctx, "strong", {}, "Teste não concluído"), h(ctx, "p", {}, error.message));
        }
      });
    });
    const modal = registerDialog(openDialog(ctx, { title: "Testar área de entrega", content: form, actions: [fill, run] }));
    modal.dialog.classList.add("merchant-dialog--wide");
  };

  page.root.ready = load();
  return page.root;
}

export const renderDrivers = createCollectionPage({
  title: "Entregadores",
  singular: "entregador",
  description: "Mantenha a equipe de entrega ativa e com contato atualizado.",
  emptyDescription: "Cadastre entregadores próprios quando a loja operar com frota interna.",
  table: "delivery_drivers",
  orderBy: "name",
  searchKeys: ["name", "phone", "vehicle_type"],
  toggleField: "is_active",
  columns: [
    { key: "name", label: "Nome" }, { key: "phone", label: "Telefone" },
    { key: "vehicle_type", label: "Veículo" }, { key: "is_active", label: "Status", render: (item) => item.is_active ? "Ativo" : "Inativo" },
  ],
  fields: [
    { name: "name", label: "Nome", required: true }, { name: "phone", label: "Telefone" },
    { name: "vehicle_type", label: "Veículo", options: [{ value: "moto", label: "Moto" }, { value: "carro", label: "Carro" }, { value: "bicicleta", label: "Bicicleta" }, { value: "outro", label: "Outro" }], defaultValue: "moto" },
  ],
  validate: (values) => !values.name ? "Informe o nome do entregador." : null,
  mapPayload: (values) => ({ ...values, phone: values.phone ? values.phone.replace(/\D/g, "") : null }),
  describe: (item) => `o entregador ${item.name}`,
});

export default render;
