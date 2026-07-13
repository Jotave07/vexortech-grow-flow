import {
  PAYMENT_LABELS,
  STATUS_LABELS,
  alertBox,
  createPage,
  dateTime,
  emptyState,
  errorState,
  h,
  imageOrFallback,
  loadingState,
  main,
  money,
  navLink,
  publicError,
  replaceMain,
  routeParam,
  safeExternalLink,
  salesPath,
  setButtonBusy,
  shellHeader,
  toast,
  unwrap,
  whatsappUrl,
} from "./shared.js";

const TRACKING_STEPS = [
  { id: "payment", label: "Pagamento", statuses: ["aguardando_pagamento"] },
  { id: "preparing", label: "Na cozinha", statuses: ["novo", "confirmado", "em_preparo"] },
  { id: "route", label: "Em rota", statuses: ["saiu_para_entrega", "pronto_para_retirada"] },
  { id: "delivered", label: "Entregue", statuses: ["entregue"] },
];

const TERMINAL_STATUSES = new Set(["entregue", "cancelado", "expirado"]);

function currentStep(status, history) {
  const direct = TRACKING_STEPS.findIndex((step) => step.statuses.includes(status));
  if (direct >= 0) return direct;
  return Math.max(0, ...(history || []).map((entry) => TRACKING_STEPS.findIndex((step) => step.statuses.includes(entry.status))));
}

function parseOptions(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function orderProgress(order, history) {
  const stepIndex = currentStep(order.status, history);
  return h("div", {
    className: "vxp-progress",
    role: "progressbar",
    "aria-label": "Progresso do pedido",
    "aria-valuemin": "0",
    "aria-valuemax": "100",
    "aria-valuenow": String(Math.round((stepIndex / (TRACKING_STEPS.length - 1)) * 100)),
    "aria-valuetext": order.status === "cancelado" ? `Pedido cancelado após ${TRACKING_STEPS[stepIndex].label}` : `Etapa atual: ${TRACKING_STEPS[stepIndex].label}`,
  }, TRACKING_STEPS.map((step, index) => {
    const label = step.id === "route" && order.delivery_type === "retirada" ? "Pronto" : step.label;
    return h("span", {
      className: "vxp-progress__step",
      dataset: { reached: String(index <= stepIndex) },
      ...(index === stepIndex && order.status !== "cancelado" ? { "aria-current": "step" } : {}),
      text: label,
    });
  }));
}

function itemsCard(ctx, order, items) {
  const list = h("ul", { className: "vxp-stack", "aria-label": "Itens do pedido" });
  items.forEach((item) => {
    const options = parseOptions(item.options);
    const extras = options.reduce((sum, option) => sum + Number(option.extra_price || 0), 0);
    const unit = Number(item.unit_price ?? item.price ?? 0) + extras;
    const total = Number(item.item_subtotal ?? unit * Number(item.quantity || 0));
    list.append(h("li", { className: "vxp-cart-line" },
      h("div", { className: "vxp-stack vxp-stack--xs" },
        h("strong", { text: `${item.quantity}× ${item.product_name || item.name || "Item"}` }),
        options.length ? h("ul", { className: "vxp-cart-line__options" }, options.map((option) => h("li", { text: `+ ${option.item_name || option.name}${Number(option.extra_price) ? ` (${money(ctx, option.extra_price)})` : ""}` }))) : null,
        item.notes ? h("span", { className: "vxp-small vxp-muted", text: `Observação: ${item.notes}` }) : null,
      ),
      h("strong", { text: money(ctx, total) }),
    ));
  });
  const totals = h("div", { className: "vxp-summary" },
    h("div", { className: "vxp-summary__line" }, h("span", { text: "Subtotal" }), h("span", { text: money(ctx, order.subtotal) })),
    order.delivery_type === "entrega" ? h("div", { className: "vxp-summary__line" }, h("span", { text: "Entrega" }), h("span", { text: Number(order.delivery_fee) ? money(ctx, order.delivery_fee) : "Grátis" })) : null,
    Number(order.discount_amount) > 0 ? h("div", { className: "vxp-summary__line" }, h("span", { text: "Desconto" }), h("span", { text: `− ${money(ctx, order.discount_amount)}` })) : null,
    h("div", { className: "vxp-summary__line" }, h("span", { text: "Pagamento" }), h("span", { text: PAYMENT_LABELS[order.payment_method] || order.payment_method || "—" })),
    order.payment_method === "dinheiro" && Number(order.change_for) > 0 ? h("div", { className: "vxp-summary__line" }, h("span", { text: "Troco para" }), h("span", { text: money(ctx, order.change_for) })) : null,
    h("div", { className: "vxp-summary__line vxp-summary__line--total" }, h("span", { text: "Total" }), h("span", { text: money(ctx, order.total) })),
  );
  return h("section", { className: "vxp-card vxp-card__body vxp-stack", "aria-labelledby": "items-title" },
    h("h2", { id: "items-title", className: "vxp-section__title", text: "Itens e valores" }),
    items.length ? list : h("p", { className: "vxp-muted", text: "Os itens ainda não estão disponíveis." }),
    totals,
  );
}

function pixCard(ctx, order, token, registerCleanup) {
  const section = h("section", { className: "vxp-card vxp-card--accent vxp-card__body vxp-stack", "aria-labelledby": "pix-title" },
    h("div", { className: "vxp-stack vxp-stack--xs" },
      h("p", { className: "vxp-eyebrow", text: "Pagamento pendente" }),
      h("h2", { id: "pix-title", className: "vxp-section__title", text: "Pague com PIX" }),
      h("p", { className: "vxp-small vxp-muted", text: "Após pagar, esta página atualizará o status automaticamente. Não envie o comprovante para desconhecidos." }),
    ),
  );
  const pixLoading = () => h("div", { className: "vxp-alert", role: "status" }, h("span", { className: "vxp-btn__spinner", ariaHidden: "true" }), h("span", { text: "Carregando PIX…" }));
  const content = h("div", null, pixLoading());
  section.append(content);
  let cancelled = false;
  registerCleanup(() => { cancelled = true; });

  const load = async () => {
    content.replaceChildren(pixLoading());
    try {
      const info = await unwrap(ctx.api.fn("get-order-payment-info", { orderId: order.id, storeId: order.store_id, publicToken: token }));
      if (cancelled || !section.isConnected) return;
      if (info?.error) throw new Error("PIX indisponível");
      const code = String(info?.pixCode || info?.copyPaste || "");
      const rawQr = String(info?.qrCodeUrl || info?.qrCode || "");
      const qr = rawQr && !rawQr.startsWith("data:") && !/^https?:/i.test(rawQr) ? `data:image/png;base64,${rawQr}` : rawQr;
      const block = h("div", { className: "vxp-stack" });
      if (qr) block.append(imageOrFallback({ src: qr, alt: "QR Code PIX", className: "vxp-pix-qr", fallback: "PIX", eager: true }));
      if (code) {
        const copy = h("button", { type: "button", className: "vxp-btn", text: "Copiar código PIX" });
        copy.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(code); toast(ctx, "Código PIX copiado.", "success"); }
          catch { toast(ctx, "Selecione o código e copie manualmente.", "warning"); }
        });
        block.append(h("div", { className: "vxp-copy" }, h("code", { text: code }), copy));
      } else block.append(alertBox("O código PIX ainda não foi gerado. Tente novamente em instantes.", "warning"));
      content.replaceChildren(block);
    } catch {
      if (cancelled || !section.isConnected) return;
      const retry = h("button", { type: "button", className: "vxp-btn vxp-btn--secondary", text: "Tentar carregar PIX novamente", onClick: load });
      content.replaceChildren(alertBox("Não foi possível carregar o PIX agora. Seu pedido continua salvo.", "warning"), retry);
    }
  };
  void load();
  return section;
}

function historyCard(ctx, history) {
  const ordered = [...history].sort((a, b) => new Date(b.created_at || b.changed_at || 0) - new Date(a.created_at || a.changed_at || 0));
  return h("section", { className: "vxp-card vxp-card__body vxp-stack", "aria-labelledby": "history-title" },
    h("h2", { id: "history-title", className: "vxp-section__title", text: "Histórico" }),
    ordered.length
      ? h("ol", { className: "vxp-history" }, ordered.map((entry) => h("li", null,
        h("strong", { text: STATUS_LABELS[entry.status] || entry.status || "Atualização" }),
        h("div", { className: "vxp-small vxp-muted", text: dateTime(ctx, entry.created_at || entry.changed_at) }),
        entry.notes ? h("div", { className: "vxp-small vxp-muted", text: entry.notes }) : null,
      )))
      : h("p", { className: "vxp-muted", text: "A primeira atualização aparecerá aqui." }),
  );
}

function reviewCard(ctx, order, token) {
  const section = h("section", { className: "vxp-card vxp-card__body vxp-stack", "aria-labelledby": "review-title" },
    h("div", { className: "vxp-stack vxp-stack--xs" }, h("h2", { id: "review-title", className: "vxp-section__title", text: "Avalie sua experiência" }), h("p", { className: "vxp-small vxp-muted", text: "Sua nota ajuda outras pessoas a escolherem melhor." })),
  );
  let rating = 0;
  const buttons = h("div", { className: "vxp-rating", role: "group", "aria-label": "Nota de 1 a 5" });
  const ratingButtons = [1, 2, 3, 4, 5].map((value) => {
    const button = h("button", { type: "button", "aria-label": `Nota ${value}`, "aria-pressed": "false", text: "★" });
    button.addEventListener("click", () => {
      rating = value;
      ratingButtons.forEach((candidate, index) => candidate.setAttribute("aria-pressed", String(index < value)));
    });
    buttons.append(button);
    return button;
  });
  const comment = h("textarea", { maxlength: "500", rows: "3", placeholder: "Conte como foi seu pedido (opcional)", "aria-label": "Comentário da avaliação" });
  const feedback = h("div", { "aria-live": "polite" });
  const send = h("button", { type: "button", className: "vxp-btn", text: "Enviar avaliação" });
  send.addEventListener("click", async () => {
    const session = ctx.auth?.session;
    if (!session?.user && !session?.user_id && !session?.id) {
      toast(ctx, "Entre com a conta usada no pedido para avaliar.", "info");
      ctx.navigate(`/entrar?redirect=${encodeURIComponent(salesPath(ctx, `/pedido/${token}`))}`);
      return;
    }
    if (rating < 1) {
      feedback.replaceChildren(alertBox("Escolha uma nota de 1 a 5.", "warning"));
      ratingButtons[0].focus();
      return;
    }
    setButtonBusy(send, true, "Enviando…");
    try {
      await unwrap(
        ctx.api.from("store_reviews")
          .upsert({ store_id: order.store_id, order_id: order.id, rating, comment: comment.value.trim() || null, is_visible: true }, { onConflict: "order_id" })
          .select("id")
          .maybeSingle(),
      );
      ratingButtons.forEach((button) => { button.disabled = true; });
      comment.disabled = true;
      send.remove();
      feedback.replaceChildren(alertBox("Avaliação enviada. Obrigado!", "success"));
    } catch (error) {
      feedback.replaceChildren(alertBox(publicError(error, "Não foi possível enviar sua avaliação."), "error"));
    } finally { setButtonBusy(send, false); }
  });
  section.append(buttons, comment, send, feedback);
  return section;
}

function orderContent(ctx, order, items, history, token, root) {
  const cancelled = order.status === "cancelado";
  const statusTone = cancelled || order.status === "expirado" ? "danger" : order.status === "entregue" ? "success" : order.status === "aguardando_pagamento" ? "warning" : "success";
  const wrapper = h("div", { className: "vxp-shell--narrow vxp-stack vxp-stack--lg" });
  const header = h("section", { className: "vxp-card vxp-card__body vxp-stack", "aria-labelledby": "tracking-title" },
    h("div", { className: "vxp-row" },
      imageOrFallback({ src: order.store_logo_url, alt: `Logo de ${order.store_name}`, className: "vxp-avatar", fallback: String(order.store_name || "L").slice(0, 1), eager: true }),
      h("div", { className: "vxp-grow" }, h("p", { className: "vxp-eyebrow", text: `Pedido #${order.order_number || "—"}` }), h("h1", { id: "tracking-title", className: "vxp-title vxp-title--sm", text: order.store_name || "Acompanhe seu pedido" })),
      h("span", { className: `vxp-badge vxp-badge--${statusTone}`, text: STATUS_LABELS[order.status] || order.status }),
    ),
    orderProgress(order, history),
    cancelled ? alertBox("O preparo foi interrompido. Fale com a loja se precisar de ajuda sobre pagamento ou reembolso.", "error") : null,
    order.status === "expirado" ? alertBox("O prazo deste pagamento terminou. Fale com a loja antes de tentar pagar novamente.", "error") : null,
  );
  wrapper.append(header);
  if (order.payment_method === "pix" && order.status === "aguardando_pagamento") wrapper.append(pixCard(ctx, order, token, root.addCleanup));

  if (order.delivery_type === "entrega") {
    const address = [order.delivery_address, order.neighborhood, [order.city, order.state].filter(Boolean).join(" / "), order.zip_code ? `CEP ${order.zip_code}` : ""].filter(Boolean);
    wrapper.append(h("section", { className: "vxp-card vxp-card__body vxp-stack vxp-stack--sm", "aria-labelledby": "delivery-address-title" },
      h("h2", { id: "delivery-address-title", className: "vxp-section__title", text: "Endereço de entrega" }),
      h("address", { className: "vxp-small", text: address.join(" · ") || "Endereço confirmado com a loja" }),
      order.delivery_reference ? h("p", { className: "vxp-small vxp-muted", text: `Referência: ${order.delivery_reference}` }) : null,
    ));
  } else {
    wrapper.append(alertBox("Este pedido será retirado na loja. Aguarde o status “Pronto para retirada” antes de sair.", "warning"));
  }
  wrapper.append(itemsCard(ctx, order, items), historyCard(ctx, history));
  if (order.status === "entregue") wrapper.append(reviewCard(ctx, order, token));
  const whatsapp = whatsappUrl(order.store_whatsapp, `Olá! Gostaria de saber sobre meu pedido #${order.order_number || ""}`);
  const contact = whatsapp ? safeExternalLink(whatsapp, "Falar com a loja no WhatsApp", "vxp-btn vxp-btn--secondary vxp-btn--wide") : null;
  if (contact) wrapper.append(contact);
  return main(wrapper, "vxp-main");
}

export function renderTracking(ctx) {
  const token = routeParam(ctx, "token");
  const root = createPage(ctx, { label: "Acompanhamento do pedido" });
  root.append(shellHeader(ctx, { title: "Acompanhar pedido", compact: true }), main(loadingState("Buscando seu pedido…")));
  if (!token || token === "undefined" || token.length > 180) {
    replaceMain(root, main(emptyState({
      iconText: "○",
      title: "Link de pedido incompleto",
      message: "Abra novamente o link recebido após o checkout.",
      action: navLink(ctx, salesPath(ctx, "/lojas"), "Ver lojas", "vxp-btn"),
    })));
    return root;
  }
  let timer = 0;
  let inFlight = false;
  let lastStatus = "";
  let cachedItems = null;
  let cachedHistory = null;
  let currentOrder = null;
  let lastPresentation = "";

  const schedule = () => {
    globalThis.clearTimeout(timer);
    if (!currentOrder || TERMINAL_STATUSES.has(currentOrder.status) || root.pageSignal.aborted) return;
    const delay = currentOrder.status === "aguardando_pagamento" ? 8000 : 20000;
    timer = globalThis.setTimeout(() => void load(true), delay);
  };

  const load = async (automatic = false) => {
    if (inFlight || root.pageSignal.aborted || (automatic && document.hidden)) { schedule(); return; }
    inFlight = true;
    try {
      const orderRows = await unwrap(ctx.api.rpc("get_public_order", { _token: token }));
      const order = Array.isArray(orderRows) ? orderRows[0] : orderRows;
      if (!order) {
        currentOrder = null;
        replaceMain(root, main(emptyState({
          iconText: "○",
          title: "Pedido não encontrado",
          message: "Verifique se o link está completo ou fale com a loja.",
          action: h("button", { type: "button", className: "vxp-btn vxp-btn--secondary", text: "Tentar novamente", onClick: () => void load(false) }),
        })));
        return;
      }
      const statusChanged = lastStatus && lastStatus !== order.status;
      const presentation = `${order.status || ""}|${order.payment_status || ""}`;
      const presentationChanged = !lastPresentation || lastPresentation !== presentation;
      const needsDetails = !cachedItems || !cachedHistory || statusChanged;
      if (needsDetails) {
        const [items, history] = await Promise.all([
          cachedItems ? Promise.resolve(cachedItems) : unwrap(ctx.api.rpc("get_public_order_items", { _token: token })),
          unwrap(ctx.api.rpc("get_public_order_status_history", { _token: token })),
        ]);
        cachedItems = Array.isArray(items) ? items : [];
        cachedHistory = Array.isArray(history) ? history : [];
      }
      if (root.pageSignal.aborted) return;
      currentOrder = order;
      if (automatic && !presentationChanged) return;
      if (statusChanged) toast(ctx, `Pedido atualizado: ${STATUS_LABELS[order.status] || order.status}.`, "success");
      lastStatus = order.status;
      lastPresentation = presentation;
      replaceMain(root, orderContent(ctx, order, cachedItems || [], cachedHistory || [], token, root));
      const live = root.querySelector("[data-vxp-order-live]") || h("p", { className: "vxp-live", role: "status", "aria-live": "polite", dataset: { vxpOrderLive: "" } });
      live.textContent = `Status atual do pedido: ${STATUS_LABELS[order.status] || order.status}.`;
      if (!live.isConnected) root.append(live);
    } catch (error) {
      if (!automatic && !root.pageSignal.aborted) {
        replaceMain(root, main(errorState({
          title: "Não foi possível atualizar o pedido",
          message: publicError(error),
          retry: () => { replaceMain(root, main(loadingState("Atualizando pedido…"))); void load(false); },
        })));
      }
    } finally {
      inFlight = false;
      schedule();
    }
  };

  const onVisibility = () => { if (!document.hidden && currentOrder && !TERMINAL_STATUSES.has(currentOrder.status)) void load(true); };
  document.addEventListener("visibilitychange", onVisibility);
  root.addCleanup(() => { globalThis.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); });
  void load(false);
  return root;
}

export const routes = [
  { pattern: "/pedido/:token", title: "Acompanhar pedido | Hype Delivery", render: renderTracking },
  { pattern: "/vendas/pedido/:token", title: "Acompanhar pedido | Hype Delivery", render: renderTracking },
];

export { currentStep, parseOptions };
