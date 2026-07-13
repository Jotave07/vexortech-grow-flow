import {
  badge,
  button,
  confirmAction,
  dataOf,
  h,
  openDialog,
  toast,
  withBusy,
} from "./core.js";

const integer = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
};

export function normalizeGroupInput(input) {
  const name = String(input?.name || "").trim();
  const isRequired = Boolean(input?.is_required);
  const minChoices = integer(input?.min_choices, Number.NaN);
  const maxChoices = integer(input?.max_choices, Number.NaN);
  const sortOrder = integer(input?.sort_order, 0);
  if (!name) throw new Error("Informe o nome do grupo.");
  if (name.length > 120) throw new Error("O nome do grupo deve ter ate 120 caracteres.");
  if (!Number.isInteger(minChoices) || minChoices < 0) throw new Error("O minimo deve ser um numero inteiro maior ou igual a zero.");
  if (!Number.isInteger(maxChoices) || maxChoices < 1) throw new Error("O maximo deve ser um numero inteiro maior que zero.");
  if (maxChoices > 50) throw new Error("O maximo permitido por grupo e 50 escolhas.");
  if (minChoices > maxChoices) throw new Error("O minimo nao pode ser maior que o maximo.");
  if (isRequired && minChoices < 1) throw new Error("Um grupo obrigatorio precisa exigir pelo menos uma escolha.");
  if (!isRequired && minChoices !== 0) throw new Error("Um grupo opcional deve ter minimo igual a zero.");
  if (sortOrder < 0 || sortOrder > 10_000) throw new Error("A ordem deve ficar entre 0 e 10000.");
  return {
    name,
    is_required: isRequired,
    min_choices: minChoices,
    max_choices: maxChoices,
    sort_order: sortOrder,
  };
}

export function normalizeOptionItemInput(input) {
  const name = String(input?.name || "").trim();
  const extraPrice = Number(String(input?.extra_price ?? "0").replace(",", "."));
  const sortOrder = integer(input?.sort_order, 0);
  if (!name) throw new Error("Informe o nome do adicional.");
  if (name.length > 120) throw new Error("O nome do adicional deve ter ate 120 caracteres.");
  if (!Number.isFinite(extraPrice) || extraPrice < 0 || extraPrice > 999_999.99) {
    throw new Error("Informe um preco adicional valido e nao negativo.");
  }
  if (sortOrder < 0 || sortOrder > 10_000) throw new Error("A ordem deve ficar entre 0 e 10000.");
  return {
    name,
    extra_price: Math.round((extraPrice + Number.EPSILON) * 100) / 100,
    is_active: input?.is_active !== false,
    sort_order: sortOrder,
  };
}

export function canRemoveActiveItem(group, items, item) {
  if (item?.is_active === false) return true;
  const remaining = items.filter((candidate) => candidate.id !== item.id && candidate.is_active !== false).length;
  return remaining >= Number(group?.min_choices || 0);
}

export async function loadProductOptionTree(ctx, { productId, storeId }) {
  const product = await dataOf(
    ctx.api.from("products").select("id, store_id").eq("id", productId).eq("store_id", storeId).maybeSingle(),
    null,
  );
  if (!product) throw new Error("Produto nao encontrado nesta loja.");
  const groups = await dataOf(
    ctx.api.from("product_options")
      .select("id, product_id, name, is_required, min_choices, max_choices, sort_order")
      .eq("product_id", productId)
      .order("sort_order", { ascending: true }),
    [],
  );
  const groupIds = groups.map((group) => group.id).filter(Boolean);
  const items = groupIds.length
    ? await dataOf(
      ctx.api.from("product_option_items")
        .select("id, option_id, name, extra_price, is_active, sort_order")
        .in("option_id", groupIds)
        .order("sort_order", { ascending: true }),
      [],
    )
    : [];
  return groups.map((group) => ({
    ...group,
    items: items.filter((item) => item.option_id === group.id),
  }));
}

const valuesOf = (form) => {
  const values = Object.fromEntries(new FormData(form).entries());
  for (const checkbox of form.querySelectorAll('input[type="checkbox"]')) values[checkbox.name] = checkbox.checked;
  return values;
};

const numberField = (ctx, { name, label, value, min = 0, max, step = 1 }) => h(ctx, "label", { className: "merchant-field" },
  h(ctx, "span", {}, label),
  h(ctx, "input", { className: "merchant-input", name, type: "number", value, min, max, step, required: true }),
);

const checkField = (ctx, { name, label, checked }) => h(ctx, "label", { className: "merchant-check" },
  h(ctx, "input", { name, type: "checkbox", checked, value: "true" }),
  h(ctx, "span", {}, label),
);

export function openProductOptions(ctx, { product, storeId, onChanged }) {
  let active = true;
  let tree = [];
  const content = h(ctx, "div", { className: "merchant-option-manager" });
  const modal = openDialog(ctx, { title: `Adicionais de ${product.name}`, content });
  modal.dialog.classList.add("merchant-dialog--wide");
  modal.dialog.addEventListener("close", () => { active = false; }, { once: true });

  const alert = (message) => h(ctx, "div", { className: "merchant-alert", role: "alert" }, message);
  const loading = (message) => content.replaceChildren(h(ctx, "div", { className: "merchant-state", role: "status" }, message));

  const run = async (control, task, successMessage) => withBusy(control, async () => {
    try {
      await task();
      if (!active || !modal.dialog.isConnected) return;
      toast(ctx, successMessage, "success");
      await refresh();
      onChanged?.();
    } catch (error) {
      if (active) toast(ctx, error?.message || "Nao foi possivel concluir a operacao.", "error");
    }
  });

  const createGroupForm = () => {
    const form = h(ctx, "form", { className: "merchant-option-create merchant-panel" },
      h(ctx, "div", { className: "merchant-option-create__heading" },
        h(ctx, "div", {}, h(ctx, "h3", { className: "merchant-panel__title" }, "Novo grupo de escolhas"),
          h(ctx, "p", { className: "merchant-page__description" }, "Ex.: tamanho, borda ou acompanhamentos."))),
      h(ctx, "div", { className: "merchant-form__grid" },
        h(ctx, "label", { className: "merchant-field merchant-field--wide" },
          h(ctx, "span", {}, "Nome do grupo"),
          h(ctx, "input", { className: "merchant-input", name: "name", required: true, maxlength: 120, placeholder: "Ex.: Escolha a borda" })),
        numberField(ctx, { name: "min_choices", label: "Minimo", value: 0, min: 0, max: 50 }),
        numberField(ctx, { name: "max_choices", label: "Maximo", value: 1, min: 1, max: 50 }),
        numberField(ctx, { name: "sort_order", label: "Ordem", value: tree.length, min: 0, max: 10_000 }),
        checkField(ctx, { name: "is_required", label: "Escolha obrigatoria", checked: false })),
    );
    const submit = button(ctx, "Criar grupo", { primary: true, onClick: () => form.requestSubmit() });
    form.append(h(ctx, "div", { className: "merchant-actions" }, submit));
    form.addEventListener("change", (event) => {
      if (event.target?.name !== "is_required") return;
      const min = form.elements.namedItem("min_choices");
      if (min) min.value = event.target.checked ? String(Math.max(1, Number(min.value || 0))) : "0";
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void run(submit, async () => {
        const payload = normalizeGroupInput(valuesOf(form));
        await dataOf(ctx.api.from("product_options").insert({ product_id: product.id, ...payload }).select("id").single());
      }, "Grupo criado. Agora adicione as escolhas disponiveis.");
    });
    return form;
  };

  const itemEditor = (group, item) => {
    const form = h(ctx, "form", { className: "merchant-option-item" },
      h(ctx, "label", { className: "merchant-field merchant-field--wide" },
        h(ctx, "span", {}, "Adicional"),
        h(ctx, "input", { className: "merchant-input", name: "name", value: item.name, maxlength: 120, required: true })),
      numberField(ctx, { name: "extra_price", label: "Preco extra", value: Number(item.extra_price || 0), min: 0, max: 999_999.99, step: 0.01 }),
      numberField(ctx, { name: "sort_order", label: "Ordem", value: item.sort_order ?? 0, min: 0, max: 10_000 }),
      checkField(ctx, { name: "is_active", label: "Disponivel", checked: item.is_active !== false }),
    );
    const save = button(ctx, "Salvar item", { quiet: true, onClick: () => form.requestSubmit() });
    const remove = button(ctx, "Excluir item", { danger: true, onClick: async () => {
      if (!canRemoveActiveItem(group, group.items, item)) {
        toast(ctx, `Mantenha ao menos ${group.min_choices} escolhas ativas neste grupo.`, "error");
        return;
      }
      if (!await confirmAction(ctx, `Excluir o adicional ${item.name}? Esta acao nao pode ser desfeita.`)) return;
      await run(remove, () => dataOf(
        ctx.api.from("product_option_items").delete().eq("id", item.id).eq("option_id", group.id),
      ), "Adicional excluido.");
    } });
    form.append(h(ctx, "div", { className: "merchant-actions" }, save, remove));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void run(save, async () => {
        const payload = normalizeOptionItemInput(valuesOf(form));
        if (item.is_active !== false && payload.is_active === false && !canRemoveActiveItem(group, group.items, item)) {
          throw new Error(`Mantenha ao menos ${group.min_choices} escolhas ativas neste grupo.`);
        }
        await dataOf(ctx.api.from("product_option_items").update(payload).eq("id", item.id).eq("option_id", group.id));
      }, "Adicional atualizado.");
    });
    return form;
  };

  const newItemForm = (group) => {
    const form = h(ctx, "form", { className: "merchant-option-item merchant-option-item--new" },
      h(ctx, "label", { className: "merchant-field merchant-field--wide" },
        h(ctx, "span", {}, "Novo adicional"),
        h(ctx, "input", { className: "merchant-input", name: "name", maxlength: 120, required: true, placeholder: "Ex.: Bacon extra" })),
      numberField(ctx, { name: "extra_price", label: "Preco extra", value: 0, min: 0, max: 999_999.99, step: 0.01 }),
      numberField(ctx, { name: "sort_order", label: "Ordem", value: group.items.length, min: 0, max: 10_000 }),
    );
    const submit = button(ctx, "Adicionar item", { primary: true, onClick: () => form.requestSubmit() });
    form.append(h(ctx, "div", { className: "merchant-actions" }, submit));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void run(submit, async () => {
        const payload = normalizeOptionItemInput({ ...valuesOf(form), is_active: true });
        await dataOf(ctx.api.from("product_option_items").insert({ option_id: group.id, ...payload }).select("id").single());
      }, "Adicional criado.");
    });
    return form;
  };

  const groupCard = (group) => {
    const activeCount = group.items.filter((item) => item.is_active !== false).length;
    const form = h(ctx, "form", { className: "merchant-option-group__form" },
      h(ctx, "div", { className: "merchant-form__grid" },
        h(ctx, "label", { className: "merchant-field merchant-field--wide" },
          h(ctx, "span", {}, "Nome do grupo"),
          h(ctx, "input", { className: "merchant-input", name: "name", value: group.name, maxlength: 120, required: true })),
        numberField(ctx, { name: "min_choices", label: "Minimo", value: group.min_choices ?? 0, min: 0, max: 50 }),
        numberField(ctx, { name: "max_choices", label: "Maximo", value: group.max_choices ?? 1, min: 1, max: 50 }),
        numberField(ctx, { name: "sort_order", label: "Ordem", value: group.sort_order ?? 0, min: 0, max: 10_000 }),
        checkField(ctx, { name: "is_required", label: "Escolha obrigatoria", checked: Boolean(group.is_required) })),
    );
    const save = button(ctx, "Salvar grupo", { quiet: true, onClick: () => form.requestSubmit() });
    const remove = button(ctx, "Excluir grupo", { danger: true, onClick: async () => {
      if (!await confirmAction(ctx, `Excluir o grupo ${group.name} e seus ${group.items.length} itens? Esta acao nao pode ser desfeita.`)) return;
      await run(remove, () => dataOf(
        ctx.api.from("product_options").delete().eq("id", group.id).eq("product_id", product.id),
      ), "Grupo e adicionais excluidos.");
    } });
    form.append(h(ctx, "div", { className: "merchant-actions" }, save, remove));
    form.addEventListener("change", (event) => {
      if (event.target?.name !== "is_required") return;
      const min = form.elements.namedItem("min_choices");
      if (min) min.value = event.target.checked ? String(Math.max(1, Number(min.value || 0))) : "0";
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void run(save, async () => {
        const payload = normalizeGroupInput(valuesOf(form));
        if (activeCount && payload.min_choices > activeCount) {
          throw new Error(`O minimo nao pode superar as ${activeCount} escolhas ativas.`);
        }
        await dataOf(ctx.api.from("product_options").update(payload).eq("id", group.id).eq("product_id", product.id));
      }, "Grupo atualizado.");
    });

    const warning = activeCount < Number(group.min_choices || 0)
      ? alert(`Ative ou cadastre pelo menos ${group.min_choices} escolhas. Enquanto isso, este produto nao pode ser comprado.`)
      : null;
    const items = group.items.length
      ? h(ctx, "div", { className: "merchant-option-items" }, group.items.map((item) => itemEditor(group, item)))
      : h(ctx, "div", { className: "merchant-state merchant-state--compact" }, "Nenhum adicional neste grupo.");
    return h(ctx, "section", { className: "merchant-option-group merchant-panel", "aria-label": group.name },
      h(ctx, "header", { className: "merchant-option-group__header" },
        h(ctx, "div", {}, h(ctx, "h3", { className: "merchant-panel__title" }, group.name),
          h(ctx, "p", { className: "merchant-page__description" }, `${activeCount} ativo${activeCount === 1 ? "" : "s"} de ${group.items.length}`)),
        badge(ctx, group.is_required ? `Obrigatorio: ${group.min_choices} a ${group.max_choices}` : `Opcional: ate ${group.max_choices}`, group.is_required ? "warning" : "info")),
      form,
      warning,
      h(ctx, "div", { className: "merchant-option-group__items" },
        h(ctx, "h4", { className: "merchant-option-group__subtitle" }, "Escolhas e adicionais"),
        items,
        newItemForm(group)),
    );
  };

  const draw = () => {
    const summary = h(ctx, "section", { className: "merchant-option-summary" },
      h(ctx, "p", {}, "Organize o que o cliente pode escolher e quanto cada adicional custa."),
      badge(ctx, `${tree.length} grupo${tree.length === 1 ? "" : "s"}`, "info"));
    const groups = tree.length
      ? h(ctx, "div", { className: "merchant-option-groups" }, tree.map(groupCard))
      : h(ctx, "div", { className: "merchant-state" },
        h(ctx, "strong", {}, "Produto simples"),
        h(ctx, "span", {}, "Crie um grupo para oferecer tamanhos, sabores ou adicionais."));
    content.replaceChildren(summary, createGroupForm(), groups);
  };

  async function refresh() {
    loading("Carregando grupos e adicionais...");
    try {
      tree = await loadProductOptionTree(ctx, { productId: product.id, storeId });
      if (active && modal.dialog.isConnected) draw();
    } catch (error) {
      if (!active || !modal.dialog.isConnected) return;
      const retry = button(ctx, "Tentar novamente", { onClick: () => refresh() });
      content.replaceChildren(h(ctx, "div", { className: "merchant-state", role: "alert" },
        h(ctx, "strong", {}, "Adicionais indisponiveis"),
        h(ctx, "span", {}, error?.message || "Nao foi possivel carregar os adicionais."),
        retry));
    }
  }

  void refresh();
  return { dialog: modal.dialog, close: modal.close, refresh };
}
