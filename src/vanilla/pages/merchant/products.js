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
  toast,
  withBusy,
} from "./core.js";
import { uploadProductImage, validateProductImage } from "./product-assets.js";
import { openProductOptions } from "./product-options.js";

const valuesOf = (form) => {
  const values = Object.fromEntries(new FormData(form).entries());
  for (const checkbox of form.querySelectorAll('input[type="checkbox"]')) values[checkbox.name] = checkbox.checked;
  return values;
};

export function normalizeProductInput(input) {
  const name = String(input?.name || "").trim();
  const description = String(input?.description || "").trim();
  const price = Number(input?.price);
  const promoPrice = input?.promo_price === "" || input?.promo_price === null || input?.promo_price === undefined
    ? null
    : Number(input.promo_price);
  const prepTime = input?.prep_time_minutes === "" || input?.prep_time_minutes === null || input?.prep_time_minutes === undefined
    ? null
    : Number(input.prep_time_minutes);
  if (!name) throw new Error("Informe o nome do produto.");
  if (name.length > 160) throw new Error("O nome do produto deve ter ate 160 caracteres.");
  if (!Number.isFinite(price) || price <= 0) throw new Error("O preco precisa ser maior que zero.");
  if (promoPrice !== null && (!Number.isFinite(promoPrice) || promoPrice <= 0 || promoPrice >= price)) {
    throw new Error("O preco promocional deve ser positivo e menor que o preco normal.");
  }
  if (prepTime !== null && (!Number.isInteger(prepTime) || prepTime < 1 || prepTime > 1_440)) {
    throw new Error("O tempo de preparo deve ficar entre 1 e 1440 minutos.");
  }
  return {
    name: name.toLocaleUpperCase("pt-BR"),
    description: description || null,
    category_id: String(input?.category_id || "").trim() || null,
    price: Math.round((price + Number.EPSILON) * 100) / 100,
    promo_price: promoPrice === null ? null : Math.round((promoPrice + Number.EPSILON) * 100) / 100,
    prep_time_minutes: prepTime,
    is_featured: Boolean(input?.is_featured),
    is_available: Boolean(input?.is_available),
  };
}

export const filterProducts = (products, query) => {
  const normalized = normalizeSearch(query);
  if (!normalized) return products;
  return products.filter((product) => [product.name, product.description, product.categories?.name]
    .some((value) => normalizeSearch(value).includes(normalized)));
};

const imagePreview = (ctx, imageUrl, alt) => imageUrl
  ? h(ctx, "img", { className: "merchant-product-image", src: imageUrl, alt })
  : h(ctx, "span", { className: "merchant-product-image__empty" }, "Sem imagem");

export function render(ctx) {
  const page = createPage(ctx, {
    title: "Cardapio",
    description: "Cadastre produtos, envie fotos e organize grupos de escolhas e adicionais.",
  });
  const state = { products: [], categories: [], optionCounts: new Map(), query: "", storeId: null };
  let editorModal = null;
  let optionsModal = null;

  const add = button(ctx, "Adicionar produto", { primary: true, onClick: () => openEditor() });
  page.actions.append(add);
  page.onCleanup(() => {
    editorModal?.close?.();
    optionsModal?.close?.();
  });

  const load = async ({ quiet = false } = {}) => {
    if (!quiet) page.loading("Carregando cardapio...");
    try {
      await requireMerchant(ctx);
      state.storeId = getStoreId(ctx);
      const [products, categories] = await Promise.all([
        dataOf(ctx.api.from("products").select("*, categories(name)").eq("store_id", state.storeId).order("sort_order", { ascending: true }).limit(500), []),
        dataOf(ctx.api.from("categories").select("id, name").eq("store_id", state.storeId).eq("is_active", true).order("sort_order", { ascending: true }), []),
      ]);
      state.products = products;
      state.categories = categories;
      const ids = products.map((product) => product.id).filter(Boolean);
      const groups = ids.length
        ? await dataOf(ctx.api.from("product_options").select("id, product_id").in("product_id", ids), [])
        : [];
      state.optionCounts = groups.reduce((counts, group) => counts.set(group.product_id, (counts.get(group.product_id) || 0) + 1), new Map());
      draw();
    } catch (error) {
      if (!quiet) page.fail(error, load);
      else toast(ctx, error?.message || "Nao foi possivel atualizar o cardapio.", "error");
    }
  };

  const draw = ({ restoreSearch = false, caret = null } = {}) => {
    const products = filterProducts(state.products, state.query);
    const search = h(ctx, "input", {
      className: "merchant-input",
      type: "search",
      value: state.query,
      placeholder: "Buscar produto ou categoria...",
      "aria-label": "Buscar no cardapio",
      dataset: { productSearch: "true" },
      onInput: (event) => {
        state.query = event.currentTarget.value;
        draw({ restoreSearch: true, caret: event.currentTarget.selectionStart });
      },
    });
    const activeCount = state.products.filter((product) => product.is_available !== false).length;
    const toolbar = h(ctx, "section", { className: "merchant-panel merchant-product-toolbar" },
      h(ctx, "label", { className: "merchant-field" }, h(ctx, "span", {}, "Busca"), search),
      h(ctx, "div", { className: "merchant-product-summary", role: "status" },
        h(ctx, "strong", {}, `${products.length} produto${products.length === 1 ? "" : "s"}`),
        h(ctx, "span", {}, `${activeCount} disponiveis no cardapio`)),
    );

    if (!state.products.length) {
      page.empty("Nenhum produto cadastrado", "Cadastre o primeiro item que seus clientes poderao pedir.",
        button(ctx, "Adicionar produto", { primary: true, onClick: () => openEditor() }));
      return;
    }
    if (!products.length) {
      page.root.dataset.pageState = "empty";
      page.setContent(toolbar, h(ctx, "div", { className: "merchant-state" },
        h(ctx, "strong", {}, "Nenhum resultado"), h(ctx, "span", {}, "Revise o termo informado.")));
      restoreSearchControl();
      return;
    }

    const table = h(ctx, "table", { className: "merchant-table merchant-product-table" },
      h(ctx, "caption", {}, "Produtos da loja. Use Adicionais para configurar escolhas do cliente."),
      h(ctx, "thead", {}, h(ctx, "tr", {},
        ["Produto", "Categoria", "Preco", "Preparo", "Status", "Adicionais", "Acoes"]
          .map((label) => h(ctx, "th", { scope: "col" }, label)))),
      h(ctx, "tbody", {}, products.map((product) => h(ctx, "tr", {},
        h(ctx, "td", {}, h(ctx, "div", { className: "merchant-product-cell" },
          imagePreview(ctx, product.image_url, ""),
          h(ctx, "div", {}, h(ctx, "strong", {}, product.name),
            product.description ? h(ctx, "span", { className: "merchant-product-cell__description" }, product.description) : null))),
        h(ctx, "td", {}, product.categories?.name || "Sem categoria"),
        h(ctx, "td", {}, h(ctx, "strong", {}, money(ctx, product.promo_price ?? product.price)),
          product.promo_price ? h(ctx, "span", { className: "merchant-product-old-price" }, money(ctx, product.price)) : null),
        h(ctx, "td", {}, product.prep_time_minutes ? `${product.prep_time_minutes} min` : "Padrao da loja"),
        h(ctx, "td", {}, badge(ctx, product.is_available !== false ? "Disponivel" : "Indisponivel", product.is_available !== false ? "success" : "danger")),
        h(ctx, "td", {}, badge(ctx, `${state.optionCounts.get(product.id) || 0} grupo${state.optionCounts.get(product.id) === 1 ? "" : "s"}`, "info")),
        h(ctx, "td", {}, h(ctx, "div", { className: "merchant-actions" },
          button(ctx, "Editar", { quiet: true, onClick: () => openEditor(product) }),
          button(ctx, "Adicionais", { quiet: true, onClick: () => openOptions(product) }),
          button(ctx, product.is_available !== false ? "Desativar" : "Ativar", { quiet: true, onClick: (event) => toggleProduct(product, event.currentTarget) }),
          button(ctx, "Excluir", { danger: true, onClick: (event) => removeProduct(product, event.currentTarget) })))))));
    page.root.dataset.pageState = "ready";
    page.setContent(toolbar, h(ctx, "div", { className: "merchant-table-wrap" }, table));
    page.announce(`${products.length} produtos exibidos.`);
    restoreSearchControl();

    function restoreSearchControl() {
      if (!restoreSearch) return;
      const next = page.content.querySelector?.("[data-product-search]");
      next?.focus();
      if (Number.isInteger(caret)) next?.setSelectionRange?.(caret, caret);
    }
  };

  const openOptions = (product) => {
    optionsModal?.close?.();
    const opened = openProductOptions(ctx, {
      product,
      storeId: state.storeId,
      onChanged: () => load({ quiet: true }),
    });
    optionsModal = opened;
    opened.dialog.addEventListener("close", () => {
      if (optionsModal === opened) optionsModal = null;
    }, { once: true });
  };

  const openEditor = (product = null) => {
    editorModal?.close?.();
    let currentProduct = product;
    let selectedFile = null;
    let removeCurrentImage = false;
    let objectUrl = null;

    const form = h(ctx, "form", { className: "merchant-form merchant-product-form" });
    const preview = h(ctx, "div", { className: "merchant-product-preview", "aria-live": "polite" });
    const fileInput = h(ctx, "input", {
      className: "merchant-input",
      type: "file",
      name: "product_image",
      accept: "image/jpeg,image/png,image/webp,image/gif",
    });
    const imageStatus = h(ctx, "p", { className: "merchant-field__hint", role: "status" }, "JPG, PNG, WebP ou GIF, ate 5 MB. O envio ocorre ao salvar.");
    const removeImage = button(ctx, "Remover imagem", { quiet: true, onClick: () => {
      selectedFile = null;
      fileInput.value = "";
      removeCurrentImage = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      preview.replaceChildren(imagePreview(ctx, null, ""));
      imageStatus.textContent = "A imagem atual sera removida ao salvar.";
    } });
    const drawPreview = (url) => preview.replaceChildren(imagePreview(ctx, url, `Previa de ${currentProduct?.name || "novo produto"}`));
    drawPreview(currentProduct?.image_url || null);
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0] || null;
      const issue = validateProductImage(file);
      if (issue) {
        selectedFile = null;
        fileInput.value = "";
        toast(ctx, issue, "error");
        drawPreview(removeCurrentImage ? null : currentProduct?.image_url || null);
        return;
      }
      selectedFile = file;
      removeCurrentImage = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = file && URL.createObjectURL ? URL.createObjectURL(file) : null;
      drawPreview(objectUrl || currentProduct?.image_url || null);
      imageStatus.textContent = file ? `${file.name} selecionado. A imagem sera enviada ao salvar.` : "Nenhuma imagem nova selecionada.";
    });

    const imageSection = h(ctx, "section", { className: "merchant-product-upload" },
      h(ctx, "div", {}, h(ctx, "h3", { className: "merchant-panel__title" }, "Imagem do produto"),
        h(ctx, "p", { className: "merchant-page__description" }, "Uma foto clara ajuda o cliente a decidir com mais seguranca.")),
      preview,
      h(ctx, "label", { className: "merchant-field" }, h(ctx, "span", {}, "Escolher arquivo"), fileInput, imageStatus),
      currentProduct?.image_url ? h(ctx, "div", { className: "merchant-actions" }, removeImage) : null,
    );
    const categoryOptions = [{ value: "", label: "Sem categoria" }, ...state.categories.map((category) => ({ value: category.id, label: category.name }))];
    const fields = h(ctx, "div", { className: "merchant-form__grid" },
      field(ctx, { name: "name", label: "Nome", value: currentProduct?.name || "", required: true }),
      field(ctx, { name: "category_id", label: "Categoria", value: currentProduct?.category_id || "", options: categoryOptions }),
      field(ctx, { name: "price", label: "Preco", type: "number", value: currentProduct?.price ?? "", required: true, min: 0.01, step: 0.01 }),
      field(ctx, { name: "promo_price", label: "Preco promocional", type: "number", value: currentProduct?.promo_price ?? "", min: 0.01, step: 0.01 }),
      field(ctx, { name: "prep_time_minutes", label: "Tempo de preparo (min)", type: "number", value: currentProduct?.prep_time_minutes ?? "", min: 1, max: 1_440, step: 1 }),
      field(ctx, { name: "is_featured", label: "Produto em destaque", type: "checkbox", value: Boolean(currentProduct?.is_featured) }),
      field(ctx, { name: "is_available", label: "Disponivel para venda", type: "checkbox", value: currentProduct ? currentProduct.is_available !== false : true }),
    );
    form.append(fields, field(ctx, { name: "description", label: "Descricao", type: "textarea", value: currentProduct?.description || "" }), imageSection);
    const save = button(ctx, currentProduct ? "Salvar alteracoes" : "Criar produto", { primary: true, onClick: () => form.requestSubmit() });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void withBusy(save, async () => {
        try {
          const payload = normalizeProductInput(valuesOf(form));
          if (removeCurrentImage && !selectedFile) payload.image_url = null;
          let saved;
          if (currentProduct) {
            saved = await dataOf(
              ctx.api.from("products").update(payload).eq("id", currentProduct.id).eq("store_id", state.storeId).select("*").single(),
              null,
            );
          } else {
            saved = await dataOf(
              ctx.api.from("products").insert({ store_id: state.storeId, ...payload }).select("*").single(),
              null,
            );
          }
          if (!saved?.id) throw new Error("O servidor nao confirmou o produto salvo.");
          currentProduct = saved;
          save.textContent = "Salvar alteracoes";
          if (selectedFile) {
            try {
              const imageUrl = await uploadProductImage(ctx, { file: selectedFile, storeId: state.storeId, productId: saved.id });
              saved = await dataOf(
                ctx.api.from("products").update({ image_url: imageUrl }).eq("id", saved.id).eq("store_id", state.storeId).select("*").single(),
                saved,
              );
              currentProduct = saved;
            } catch (error) {
              toast(ctx, `Produto salvo sem a nova imagem: ${error?.message || "falha no upload"}`, "warning");
              await load({ quiet: true });
              return;
            }
          }
          toast(ctx, product ? "Produto atualizado." : "Produto criado.", "success");
          editorModal?.close?.();
          await load({ quiet: true });
        } catch (error) {
          toast(ctx, error?.message || "Nao foi possivel salvar o produto.", "error");
        }
      });
    });

    const opened = openDialog(ctx, {
      title: currentProduct ? `Editar ${currentProduct.name}` : "Novo produto",
      content: form,
      actions: [save],
    });
    editorModal = opened;
    opened.dialog.classList.add("merchant-dialog--wide");
    opened.dialog.addEventListener("close", () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
      if (editorModal === opened) editorModal = null;
    }, { once: true });
  };

  const toggleProduct = async (product, control) => withBusy(control, async () => {
    try {
      await dataOf(ctx.api.from("products").update({ is_available: product.is_available === false }).eq("id", product.id).eq("store_id", state.storeId));
      toast(ctx, "Disponibilidade atualizada.", "success");
      await load({ quiet: true });
    } catch (error) { toast(ctx, error?.message || "Nao foi possivel atualizar o produto.", "error"); }
  });

  const removeProduct = async (product, control) => {
    const groups = state.optionCounts.get(product.id) || 0;
    const suffix = groups ? ` e seus ${groups} grupos de adicionais` : "";
    if (!await confirmAction(ctx, `Excluir ${product.name}${suffix}? Esta acao nao pode ser desfeita.`)) return;
    await withBusy(control, async () => {
      try {
        await dataOf(ctx.api.from("products").delete().eq("id", product.id).eq("store_id", state.storeId));
        toast(ctx, "Produto excluido.", "success");
        await load({ quiet: true });
      } catch (error) { toast(ctx, error?.message || "Nao foi possivel excluir o produto.", "error"); }
    });
  };

  page.root.ready = load();
  return page.root;
}

export default render;
