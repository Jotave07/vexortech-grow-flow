import { createCartStore, itemSubtotal } from "./cart.js";
import {
  alertBox,
  createPage,
  emptyState,
  errorState,
  h,
  imageOrFallback,
  isStoreOpen,
  loadingState,
  main,
  money,
  navLink,
  normalizeText,
  openDialog,
  publicError,
  replaceMain,
  routeParam,
  salesPath,
  shellHeader,
  toast,
  unwrap,
} from "./shared.js";

const STORE_COLUMNS = "id, name, public_name, slug, phone, whatsapp, whatsapp_number, address, city, state, logo_url, cover_url, description, is_active, is_suspended";
const SETTINGS_COLUMNS = "store_id, accept_orders_when_closed, accept_pix, accept_cash, accept_card_on_delivery, allow_delivery, allow_pickup, avg_prep_time_minutes, business_hours, delivery_fee, free_delivery_above, is_open, min_order_amount, min_order_value, next_opening_time, whatsapp_number";
const CATEGORY_COLUMNS = "id, store_id, name, sort_order, is_active";
const PRODUCT_COLUMNS = "id, store_id, category_id, name, description, price, promo_price, image_url, is_active, is_available, is_featured, prep_time_minutes, sort_order";

function productPrice(product) {
  return Number(product.promo_price ?? product.price ?? 0);
}

export function storeCanBuildCart(store) {
  return Boolean(store) && store.is_active !== false && !store.is_suspended;
}

function optionLimits(group) {
  const min = Math.max(group.is_required ? 1 : 0, Number(group.min_choices || 0));
  return { min, max: Math.max(min, Number(group.max_choices || 1)) };
}

function productCard(ctx, product, onOpen) {
  const available = product.is_available !== false;
  const button = h("button", {
    type: "button",
    className: "vxp-product",
    disabled: !available,
    "aria-label": `${product.name}, ${money(ctx, productPrice(product))}${available ? ", ver opções" : ", indisponível"}`,
    onClick: () => onOpen(product),
  });
  const copy = h("span", { className: "vxp-stack vxp-stack--xs" },
    h("strong", { className: "vxp-product__name", text: product.name }),
    product.description ? h("span", { className: "vxp-product__desc", text: product.description }) : null,
    !available ? h("span", { className: "vxp-badge vxp-badge--warning", text: "Indisponível" }) : null,
    h("span", { className: "vxp-price" },
      h("span", { text: money(ctx, productPrice(product)) }),
      product.promo_price !== null && product.promo_price !== undefined && Number(product.promo_price) < Number(product.price)
        ? h("del", { text: money(ctx, product.price) })
        : null,
    ),
  );
  button.append(
    copy,
    imageOrFallback({ src: product.image_url, alt: product.name, className: "vxp-product__image", fallback: "🍽" }),
  );
  return button;
}

function renderProductDialog(ctx, product, cart, canBuildCart, onCartChange, registerCleanup) {
  const dialog = h("dialog", { className: "vxp-dialog", "aria-labelledby": "product-dialog-title" });
  const body = h("div", { className: "vxp-dialog__body" }, loadingState("Carregando opções…"));
  const closeButton = h("button", { type: "button", className: "vxp-btn vxp-btn--ghost vxp-btn--icon", "aria-label": "Fechar", text: "×" });
  const head = h("div", { className: "vxp-dialog__head" },
    h("div", { className: "vxp-stack vxp-stack--xs" },
      h("h2", { id: "product-dialog-title", className: "vxp-title vxp-title--sm", text: product.name }),
      h("span", { className: "vxp-price", text: money(ctx, productPrice(product)) }),
    ),
    closeButton,
  );
  dialog.append(head, body);
  const close = openDialog(dialog, { initialFocus: closeButton });
  registerCleanup?.(() => { if (dialog.isConnected) close(); });
  closeButton.addEventListener("click", close);

  const load = async () => {
    try {
      const groups = await unwrap(
        ctx.api.from("product_options")
          .select("id, product_id, name, is_required, min_choices, max_choices")
          .eq("product_id", product.id)
          .order("created_at", { ascending: true }),
      );
      const groupList = Array.isArray(groups) ? groups : [];
      const ids = groupList.map((group) => group.id);
      const items = ids.length
        ? await unwrap(
          ctx.api.from("product_option_items")
            .select("id, option_id, name, extra_price, is_active")
            .in("option_id", ids)
            .eq("is_active", true)
            .order("created_at", { ascending: true }),
        )
        : [];
      if (!dialog.isConnected) return;
      draw(groupList, Array.isArray(items) ? items : []);
    } catch (error) {
      if (!dialog.isConnected) return;
      body.replaceChildren(errorState({
        title: "Opções indisponíveis",
        message: publicError(error),
        retry: () => {
          body.replaceChildren(loadingState("Carregando opções…"));
          void load();
        },
      }));
    }
  };

  const draw = (groups, optionItems) => {
    const form = h("form", { className: "vxp-stack vxp-stack--lg", novalidate: "" });
    const optionArea = h("div", { className: "vxp-stack vxp-stack--lg" });
    let blockingReason = "";

    groups.forEach((group) => {
      const limits = optionLimits(group);
      const activeItems = optionItems.filter((item) => item.option_id === group.id && item.is_active !== false);
      if (activeItems.length < limits.min) blockingReason = `Não há escolhas suficientes disponíveis em “${group.name}”.`;
      const fieldset = h("fieldset", { className: "vxp-option-group", dataset: { groupId: group.id, min: limits.min, max: limits.max } });
      fieldset.append(h("legend", { text: `${group.name} · ${limits.min ? `escolha ${limits.min}` : "opcional"}${limits.max > 1 ? ` a ${limits.max}` : ""}` }));
      activeItems.forEach((item, index) => {
        const inputId = `option-${group.id}-${item.id}`;
        const input = h("input", {
          id: inputId,
          type: limits.max === 1 ? "radio" : "checkbox",
          name: `option-${group.id}`,
          value: item.id,
          dataset: {
            itemId: item.id,
            optionId: group.id,
            optionName: group.name,
            itemName: item.name,
            extraPrice: Number(item.extra_price || 0),
          },
        });
        if (limits.max === 1 && limits.min > 0 && index === 0 && activeItems.length === 1) input.checked = true;
        const row = h("label", { className: "vxp-choice", htmlFor: inputId },
          input,
          h("span", { text: item.name }),
          Number(item.extra_price || 0) > 0 ? h("span", { className: "vxp-small vxp-muted", text: `+ ${money(ctx, item.extra_price)}` }) : h("span", { className: "vxp-small vxp-muted", text: "Incluso" }),
        );
        input.addEventListener("change", () => {
          if (input.type === "checkbox") {
            const checked = fieldset.querySelectorAll("input:checked");
            if (checked.length > limits.max) {
              input.checked = false;
              toast(ctx, `Escolha no máximo ${limits.max} em ${group.name}.`, "warning");
            }
          }
          updateTotal();
        });
        fieldset.append(row);
      });
      optionArea.append(fieldset);
    });

    const notes = h("textarea", { maxlength: "200", rows: "3", placeholder: "Ex.: sem cebola" });
    const notesField = h("div", { className: "vxp-field" },
      h("label", { htmlFor: "product-notes", text: "Observação (opcional)" }),
      notes,
      h("p", { className: "vxp-field__hint", text: "Até 200 caracteres. Não use este campo para pedir itens cobrados à parte." }),
    );
    notes.id = "product-notes";
    let quantity = 1;
    const quantityOutput = h("output", { text: "1", "aria-live": "polite" });
    const decrement = h("button", { type: "button", "aria-label": "Diminuir quantidade", text: "−" });
    const increment = h("button", { type: "button", "aria-label": "Aumentar quantidade", text: "+" });
    const quantityControl = h("div", { className: "vxp-qty", role: "group", "aria-label": "Quantidade" }, decrement, quantityOutput, increment);
    const addButton = h("button", { type: "submit", className: "vxp-btn vxp-grow" });

    const selection = () => [...form.querySelectorAll(".vxp-option-group input:checked")].map((input) => ({
      option_id: input.dataset.optionId,
      option_name: input.dataset.optionName,
      item_id: input.dataset.itemId,
      item_name: input.dataset.itemName,
      extra_price: Number(input.dataset.extraPrice || 0),
    }));
    const updateTotal = () => {
      const extras = selection().reduce((sum, item) => sum + item.extra_price, 0);
      addButton.textContent = `Adicionar · ${money(ctx, (productPrice(product) + extras) * quantity)}`;
      decrement.disabled = quantity <= 1;
      increment.disabled = quantity >= 99;
    };
    decrement.addEventListener("click", () => { quantity = Math.max(1, quantity - 1); quantityOutput.value = String(quantity); quantityOutput.textContent = String(quantity); updateTotal(); });
    increment.addEventListener("click", () => { quantity = Math.min(99, quantity + 1); quantityOutput.value = String(quantity); quantityOutput.textContent = String(quantity); updateTotal(); });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!canBuildCart || blockingReason) {
        toast(ctx, blockingReason || "Não é possível adicionar itens desta loja agora.", "warning");
        return;
      }
      for (const fieldset of form.querySelectorAll(".vxp-option-group")) {
        const count = fieldset.querySelectorAll("input:checked").length;
        const min = Number(fieldset.dataset.min || 0);
        const max = Number(fieldset.dataset.max || 1);
        if (count < min || count > max) {
          fieldset.setAttribute("aria-invalid", "true");
          fieldset.querySelector("input")?.focus();
          toast(ctx, count < min ? `Complete a escolha “${fieldset.querySelector("legend")?.textContent?.split(" · ")[0]}”.` : `Revise o limite desta escolha.`, "warning");
          return;
        }
        fieldset.removeAttribute("aria-invalid");
      }
      cart.add({
        product_id: product.id,
        product_name: product.name,
        unit_price: productPrice(product),
        quantity,
        options: selection(),
        notes: notes.value,
      });
      toast(ctx, `${product.name} foi adicionado ao carrinho.`, "success");
      onCartChange();
      close();
    });

    if (product.description) form.append(h("p", { className: "vxp-muted", text: product.description }));
    form.append(optionArea);
    if (blockingReason) form.append(alertBox(blockingReason, "error"));
    form.append(notesField, h("div", { className: "vxp-row vxp-row--between" }, quantityControl, addButton));
    addButton.disabled = !canBuildCart || Boolean(blockingReason);
    updateTotal();
    body.replaceChildren(form);
  };
  void load();
}

async function confirmClearCart(ctx) {
  if (typeof ctx?.ui?.confirm === "function") {
    return Boolean(await ctx.ui.confirm({
      title: "Limpar carrinho?",
      message: "Todos os itens desta loja serão removidos.",
      confirmLabel: "Limpar",
      tone: "danger",
    }));
  }
  return globalThis.confirm?.("Limpar todos os itens do carrinho?") ?? false;
}

function renderCartDialog(ctx, cart, slug, acceptOrders, onCartChange, registerCleanup) {
  const dialog = h("dialog", { className: "vxp-dialog", "aria-labelledby": "cart-title" });
  const closeButton = h("button", { type: "button", className: "vxp-btn vxp-btn--ghost vxp-btn--icon", "aria-label": "Fechar carrinho", text: "×" });
  const body = h("div", { className: "vxp-dialog__body" });
  const foot = h("div", { className: "vxp-dialog__foot" });
  dialog.append(
    h("div", { className: "vxp-dialog__head" }, h("h2", { id: "cart-title", className: "vxp-title vxp-title--sm", text: "Seu carrinho" }), closeButton),
    body,
    foot,
  );
  const close = openDialog(dialog, { initialFocus: closeButton });
  registerCleanup?.(() => { if (dialog.isConnected) close(); });
  closeButton.addEventListener("click", close);

  const redraw = () => {
    const items = cart.getItems();
    const totals = cart.getTotals();
    body.replaceChildren();
    foot.replaceChildren();
    if (!items.length) {
      body.append(emptyState({ iconText: "🛒", title: "Carrinho vazio", message: "Escolha um item do cardápio para começar." }));
      return;
    }
    const list = h("div", { className: "vxp-stack", role: "list" });
    items.forEach((item) => {
      const minus = h("button", { type: "button", "aria-label": `Diminuir ${item.product_name}`, text: "−" });
      const plus = h("button", { type: "button", "aria-label": `Aumentar ${item.product_name}`, text: "+" });
      const output = h("output", { text: item.quantity, "aria-label": `Quantidade de ${item.product_name}` });
      minus.addEventListener("click", () => { cart.updateQuantity(item.uid, item.quantity - 1); redraw(); onCartChange(); });
      plus.addEventListener("click", () => { cart.updateQuantity(item.uid, item.quantity + 1); redraw(); onCartChange(); });
      const remove = h("button", { type: "button", className: "vxp-btn vxp-btn--ghost vxp-btn--compact", text: "Remover" });
      remove.addEventListener("click", () => { cart.remove(item.uid); toast(ctx, `${item.product_name} removido.`, "info"); redraw(); onCartChange(); });
      const options = item.options?.length
        ? h("ul", { className: "vxp-cart-line__options" }, item.options.map((option) => h("li", { text: `+ ${option.item_name}${Number(option.extra_price) ? ` (${money(ctx, option.extra_price)})` : ""}` })))
        : null;
      list.append(h("div", { className: "vxp-cart-line", role: "listitem" },
        h("div", { className: "vxp-stack vxp-stack--xs" },
          h("strong", { text: item.product_name }),
          options,
          item.notes ? h("span", { className: "vxp-small vxp-muted", text: `Observação: ${item.notes}` }) : null,
          h("span", { className: "vxp-price", text: money(ctx, itemSubtotal(item)) }),
          remove,
        ),
        h("div", { className: "vxp-qty", role: "group", "aria-label": `Quantidade de ${item.product_name}` }, minus, output, plus),
      ));
    });
    const clear = h("button", { type: "button", className: "vxp-btn vxp-btn--danger vxp-btn--compact", text: "Limpar carrinho" });
    clear.addEventListener("click", async () => {
      if (!await confirmClearCart(ctx)) return;
      cart.clear();
      redraw();
      onCartChange();
      toast(ctx, "Carrinho limpo.", "success");
    });
    body.append(list, h("div", { className: "vxp-row vxp-row--between vxp-row--wrap" }, h("strong", { text: `Subtotal: ${money(ctx, totals.subtotal)}` }), clear));

    const checkout = h("button", {
      type: "button",
      className: "vxp-btn vxp-grow",
      disabled: !acceptOrders,
      text: acceptOrders ? `Continuar · ${money(ctx, totals.subtotal)}` : "Loja indisponível para pedidos",
    });
    checkout.addEventListener("click", () => {
      close();
      ctx.navigate(salesPath(ctx, `/loja/${encodeURIComponent(slug)}/checkout`));
    });
    foot.append(checkout);
  };
  redraw();
}

function renderStoreContent(ctx, state, cart, root) {
  const { store, settings, categories, products, reviews } = state;
  const name = String(store.public_name || store.name || "Loja");
  const open = isStoreOpen(settings?.business_hours, settings?.is_open);
  const canBuildCart = storeCanBuildCart(store);
  const acceptOrders = canBuildCart && (open || settings?.accept_orders_when_closed);
  let searchTerm = "";
  let activeCategory = "all";

  const mainElement = main(null);
  const shell = h("div", { className: "vxp-stack vxp-stack--lg" });
  mainElement.append(shell);
  const cover = store.cover_url
    ? imageOrFallback({ src: store.cover_url, alt: `Capa de ${name}`, className: "vxp-hero__cover", fallback: "" , eager: true })
    : h("div", { className: "vxp-hero__cover", role: "presentation" });
  const location = [store.city, store.state].filter(Boolean).join(" / ");
  const minimum = Number(settings?.min_order_value ?? settings?.min_order_amount ?? store.min_order_amount ?? 0);
  const rating = reviews.length ? (reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length).toFixed(1) : "";
  const statusTone = store.is_suspended ? "danger" : open ? "success" : settings?.accept_orders_when_closed ? "warning" : "danger";
  const statusText = store.is_suspended ? "Loja temporariamente suspensa" : open ? "Aberta agora" : settings?.accept_orders_when_closed ? "Fechada · ainda aceita pedidos" : "Fechada agora";

  const hero = h("section", { className: "vxp-hero", "aria-labelledby": "store-name" },
    cover,
    h("div", { className: "vxp-shell vxp-hero__content" },
      imageOrFallback({ src: store.logo_url, alt: `Logo de ${name}`, className: "vxp-hero__logo", fallback: name.slice(0, 1).toUpperCase(), eager: true }),
      h("div", { className: "vxp-stack vxp-stack--xs" },
        h("span", { className: `vxp-badge vxp-badge--${statusTone}`, text: statusText }),
        h("h1", { id: "store-name", className: "vxp-title", text: name }),
        store.description ? h("p", { className: "vxp-subtitle", text: store.description }) : null,
        h("div", { className: "vxp-meta" },
          location ? h("span", { text: `📍 ${location}` }) : null,
          settings?.avg_prep_time_minutes ? h("span", { text: `◷ Preparo médio: ${settings.avg_prep_time_minutes} min` }) : null,
          minimum > 0 ? h("span", { text: `🛒 Pedido mínimo: ${money(ctx, minimum)}` }) : null,
          rating ? h("span", { text: `★ ${rating} (${reviews.length})` }) : null,
        ),
      ),
    ),
  );
  const loadingMain = root.querySelector("#main-content");
  if (loadingMain) root.insertBefore(hero, loadingMain);
  else root.append(hero);

  if (!acceptOrders) shell.append(alertBox(store.is_suspended
    ? "Esta loja não pode receber pedidos no momento."
    : `A loja está fechada. Você pode montar sua sacola agora e finalizar quando ela voltar a aceitar pedidos.${settings?.next_opening_time ? ` Próxima abertura: ${settings.next_opening_time}.` : ""}`,
  "warning"));

  const search = h("input", { className: "vxp-input", type: "search", autocomplete: "off", placeholder: "Buscar no cardápio", "aria-label": "Buscar produtos" });
  const chips = h("div", { className: "vxp-chip-list", role: "group", "aria-label": "Categorias" });
  const menu = h("div", { className: "vxp-stack vxp-stack--lg", "aria-live": "polite" });
  const resultCount = h("p", { className: "vxp-small vxp-muted", role: "status" });

  const categoryButtons = [{ id: "all", name: "Todos" }, ...categories].map((category) => {
    const button = h("button", { type: "button", className: "vxp-chip", "aria-pressed": String(category.id === "all"), text: category.name });
    button.addEventListener("click", () => {
      activeCategory = category.id;
      categoryButtons.forEach((candidate) => candidate.setAttribute("aria-pressed", String(candidate === button)));
      drawMenu();
    });
    chips.append(button);
    return button;
  });

  const openProduct = (product) => renderProductDialog(ctx, product, cart, canBuildCart, updateCartBar, root.addCleanup);
  const drawMenu = () => {
    const normalized = normalizeText(searchTerm);
    const filtered = products.filter((product) => {
      const matchesCategory = activeCategory === "all" || product.category_id === activeCategory;
      return matchesCategory && (!normalized || normalizeText(`${product.name} ${product.description || ""}`).includes(normalized));
    });
    resultCount.textContent = `${filtered.length} ${filtered.length === 1 ? "item" : "itens"}`;
    menu.replaceChildren();
    if (!filtered.length) {
      menu.append(emptyState({ iconText: "⌕", title: "Nenhum item encontrado", message: "Tente outra busca ou categoria." }));
      return;
    }
    const categoryIds = new Set(categories.map((category) => category.id));
    const sections = categories.map((category) => ({ ...category, items: filtered.filter((product) => product.category_id === category.id) })).filter((section) => section.items.length);
    const other = filtered.filter((product) => !product.category_id || !categoryIds.has(product.category_id));
    if (other.length) sections.push({ id: "other", name: "Outros", items: other });
    sections.forEach((section) => {
      menu.append(h("section", { className: "vxp-section", "aria-labelledby": `category-${section.id}` },
        h("div", { className: "vxp-section__head" }, h("h2", { id: `category-${section.id}`, className: "vxp-section__title", text: section.name }), h("span", { className: "vxp-small vxp-muted", text: `${section.items.length} ${section.items.length === 1 ? "item" : "itens"}` })),
        h("div", { className: "vxp-product-grid" }, section.items.map((product) => productCard(ctx, product, openProduct))),
      ));
    });
  };
  let searchTimer = 0;
  search.addEventListener("input", () => {
    globalThis.clearTimeout(searchTimer);
    searchTimer = globalThis.setTimeout(() => { searchTerm = search.value; drawMenu(); }, 160);
  });
  root.addCleanup(() => globalThis.clearTimeout(searchTimer));

  shell.append(
    h("section", { className: "vxp-card vxp-card__body vxp-stack vxp-stack--sm", "aria-label": "Filtros do cardápio" },
      h("div", { className: "vxp-search" }, h("span", { className: "vxp-search__icon", ariaHidden: "true", text: "⌕" }), search),
      chips,
      resultCount,
    ),
    menu,
  );

  if (reviews.length) {
    shell.append(h("section", { className: "vxp-section", "aria-labelledby": "reviews-title" },
      h("div", { className: "vxp-section__head" }, h("h2", { id: "reviews-title", className: "vxp-section__title", text: "Avaliações recentes" }), h("span", { className: "vxp-badge", text: `★ ${rating}` })),
      h("div", { className: "vxp-grid" }, reviews.slice(0, 6).map((review) => h("article", { className: "vxp-card vxp-card__body vxp-stack vxp-stack--xs" },
        h("strong", { text: `${"★".repeat(Math.max(1, Math.min(5, Number(review.rating || 0))))} ${review.rating}/5` }),
        review.comment ? h("p", { className: "vxp-small vxp-muted", text: review.comment }) : h("p", { className: "vxp-small vxp-muted", text: "Avaliação sem comentário." }),
      ))),
    ));
  }

  const cartBar = h("div", { className: "vxp-cartbar", hidden: true });
  const cartButton = h("button", { type: "button", className: "vxp-cartbar__button", "aria-label": "Abrir carrinho" });
  cartButton.addEventListener("click", () => renderCartDialog(ctx, cart, store.slug, acceptOrders, updateCartBar, root.addCleanup));
  cartBar.append(cartButton);
  root.append(cartBar);

  function updateCartBar() {
    const totals = cart.getTotals();
    cartBar.hidden = totals.count === 0;
    cartButton.replaceChildren(
      h("span", { className: "vxp-cart-count", text: totals.count }),
      h("span", { className: "vxp-grow", text: "Ver carrinho" }),
      h("span", { text: money(ctx, totals.subtotal) }),
    );
    cartButton.setAttribute("aria-label", `Abrir carrinho com ${totals.count} ${totals.count === 1 ? "item" : "itens"}, subtotal ${money(ctx, totals.subtotal)}`);
  }
  updateCartBar();
  const unsubscribe = cart.subscribe(updateCartBar);
  root.addCleanup(unsubscribe);
  drawMenu();
  return mainElement;
}

export function renderStore(ctx) {
  const slug = routeParam(ctx, "slug");
  const root = createPage(ctx, { label: "Cardápio da loja" });
  root.append(shellHeader(ctx, { backPath: salesPath(ctx, "/lojas"), backLabel: "Lojas", title: "Cardápio", compact: true }), main(loadingState("Abrindo o cardápio…")));
  if (!slug || slug.length > 120) {
    replaceMain(root, main(errorState({ title: "Link de loja inválido", message: "Volte à lista de lojas e escolha um cardápio." })));
    return root;
  }
  const cart = createCartStore(slug);

  const load = async () => {
    try {
      const store = await unwrap(
        ctx.api.from("stores").select(STORE_COLUMNS).eq("slug", slug).eq("is_active", true).maybeSingle(),
      );
      if (!store) {
        replaceMain(root, main(emptyState({
          iconText: "🏪",
          title: "Loja não encontrada",
          message: "O endereço pode ter mudado ou a loja não está disponível.",
          action: navLink(ctx, salesPath(ctx, "/lojas"), "Ver lojas", "vxp-btn"),
        })));
        return;
      }
      const [settings, categories, products, reviews] = await Promise.all([
        unwrap(ctx.api.from("store_settings").select(SETTINGS_COLUMNS).eq("store_id", store.id).maybeSingle()),
        unwrap(ctx.api.from("categories").select(CATEGORY_COLUMNS).eq("store_id", store.id).eq("is_active", true).order("sort_order", { ascending: true })),
        unwrap(ctx.api.from("products").select(PRODUCT_COLUMNS).eq("store_id", store.id).eq("is_active", true).order("sort_order", { ascending: true })),
        unwrap(ctx.api.from("store_reviews").select("id, store_id, rating, comment, created_at, is_visible").eq("store_id", store.id).eq("is_visible", true).order("created_at", { ascending: false }).limit(10)),
      ]);
      if (root.pageSignal.aborted) return;
      const existingMain = root.querySelector("#main-content");
      const content = renderStoreContent(ctx, {
        store,
        settings: settings || {},
        categories: Array.isArray(categories) ? categories : [],
        products: Array.isArray(products) ? products : [],
        reviews: Array.isArray(reviews) ? reviews : [],
      }, cart, root);
      existingMain?.replaceWith(content);
    } catch (error) {
      if (root.pageSignal.aborted) return;
      replaceMain(root, main(errorState({
        title: "Não foi possível abrir o cardápio",
        message: publicError(error),
        retry: () => {
          replaceMain(root, main(loadingState("Abrindo o cardápio…")));
          void load();
        },
      })));
    }
  };
  void load();
  return root;
}

export const routes = [
  { pattern: "/loja/:slug", title: "Cardápio | Hype Delivery", render: renderStore },
  { pattern: "/vendas/loja/:slug", title: "Cardápio | Hype Delivery", render: renderStore },
];
