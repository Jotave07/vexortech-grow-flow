import {
  badge,
  button,
  confirmAction,
  createPage,
  dataOf,
  field,
  getStoreId,
  h,
  normalizeSearch,
  openDialog,
  requireMerchant,
  serializeForm,
  statusTone,
  toast,
  withBusy,
} from "./core.js";

const coerce = (fieldConfig, value) => {
  if (fieldConfig.type === "number") return value === "" ? null : Number(value);
  if (fieldConfig.type === "checkbox") return Boolean(value);
  return typeof value === "string" ? value.trim() : value;
};

export function createCollectionPage(config) {
  return function render(ctx) {
    const page = createPage(ctx, { title: config.title, description: config.description });
    const state = { items: [], query: "", editing: null, meta: {} };
    const add = button(ctx, config.addLabel ?? `Adicionar ${config.singular}`, { primary: true, onClick: () => openEditor() });
    page.actions.append(add);

    const load = async () => {
      page.loading(`Carregando ${config.title.toLocaleLowerCase("pt-BR")}...`);
      try {
        await requireMerchant(ctx);
        if (config.loadOptions) state.meta = await config.loadOptions(ctx, state);
        let query = ctx.api.from(config.table).select(config.select ?? "*").eq("store_id", getStoreId(ctx));
        if (config.orderBy) query = query.order(config.orderBy, { ascending: config.ascending ?? true });
        state.items = await dataOf(query, []);
        renderList();
      } catch (error) { page.fail(error, load); }
    };

    const filteredItems = () => {
      const query = normalizeSearch(state.query);
      if (!query) return state.items;
      return state.items.filter((item) => config.searchKeys.some((key) => normalizeSearch(item[key]).includes(query)));
    };

    const renderList = ({ restoreSearch = false, caret = null } = {}) => {
      const items = filteredItems();
      const search = h(ctx, "input", {
        className: "merchant-input", type: "search", value: state.query,
        placeholder: `Buscar ${config.title.toLocaleLowerCase("pt-BR")}...`, "aria-label": `Buscar em ${config.title}`,
        dataset: { merchantSearch: "true" },
        onInput: (event) => {
          state.query = event.currentTarget.value;
          renderList({ restoreSearch: true, caret: event.currentTarget.selectionStart });
        },
      });
      const toolbar = h(ctx, "div", { className: "merchant-panel merchant-toolbar" },
        h(ctx, "label", { className: "merchant-field" }, h(ctx, "span", {}, "Busca"), search),
        h(ctx, "p", { role: "status" }, `${items.length} registro${items.length === 1 ? "" : "s"}`));
      if (!state.items.length) {
        page.empty(`Nenhum ${config.singular} cadastrado`, config.emptyDescription,
          button(ctx, config.addLabel ?? `Adicionar ${config.singular}`, { primary: true, onClick: () => openEditor() }));
        return;
      }
      if (!items.length) {
        page.root.dataset.pageState = "empty";
        page.setContent(toolbar, h(ctx, "div", { className: "merchant-state" },
          h(ctx, "strong", {}, "Nenhum resultado"),
          h(ctx, "span", {}, "Revise o termo informado.")));
        restoreSearchControl();
        return;
      }
      const table = h(ctx, "table", { className: "merchant-table" },
        h(ctx, "caption", {}, `${config.title}: use Editar para revisar cada registro.`),
        h(ctx, "thead", {}, h(ctx, "tr", {},
          config.columns.map((column) => h(ctx, "th", { scope: "col" }, column.label)),
          h(ctx, "th", { scope: "col" }, "Acoes"))),
        h(ctx, "tbody", {}, items.map((item) => h(ctx, "tr", {},
          config.columns.map((column) => h(ctx, "td", {}, column.render
            ? column.render(item, ctx)
            : column.status
              ? badge(ctx, config.statusLabel?.(item[column.key]) ?? String(item[column.key] ?? ""), statusTone(item[column.key]))
              : String(item[column.key] ?? "—"))),
          h(ctx, "td", {}, h(ctx, "div", { className: "merchant-actions" },
            button(ctx, "Editar", { quiet: true, onClick: () => openEditor(item) }),
            config.toggleField ? button(ctx, item[config.toggleField] ? "Desativar" : "Ativar", { quiet: true, onClick: (event) => toggle(item, event.currentTarget) }) : null,
            config.allowDelete !== false ? button(ctx, "Excluir", { danger: true, onClick: (event) => remove(item, event.currentTarget) }) : null))))));
      page.root.dataset.pageState = "ready";
      page.setContent(toolbar, h(ctx, "div", { className: "merchant-table-wrap" }, table));
      page.announce(`${items.length} registros exibidos.`);
      restoreSearchControl();

      function restoreSearchControl() {
        if (!restoreSearch) return;
        const nextSearch = page.content.querySelector?.("[data-merchant-search]");
        nextSearch?.focus();
        if (Number.isInteger(caret)) nextSearch?.setSelectionRange?.(caret, caret);
      }
    };

    const openEditor = (item = null) => {
      state.editing = item;
      const form = h(ctx, "form", { className: "merchant-form" },
        h(ctx, "div", { className: "merchant-form__grid" }, config.fields.map((definition) => field(ctx, {
          ...definition,
          value: item?.[definition.name] ?? definition.defaultValue ?? (definition.type === "checkbox" ? false : ""),
          options: typeof definition.options === "function" ? definition.options(state, ctx) : definition.options,
        }))));
      let modal;
      const save = button(ctx, item ? "Salvar alteracoes" : "Criar", { primary: true, onClick: () => form.requestSubmit() });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        void withBusy(save, async () => {
          try {
            const values = serializeForm(form);
            const payload = Object.fromEntries(config.fields.map((definition) => [definition.name, coerce(definition, values[definition.name])]));
            const issue = config.validate?.(payload, item);
            if (issue) throw new Error(issue);
            const operation = item
              ? ctx.api.from(config.table).update(config.mapPayload?.(payload, item) ?? payload).eq("id", item.id).eq("store_id", getStoreId(ctx))
              : ctx.api.from(config.table).insert({ store_id: getStoreId(ctx), ...(config.mapPayload?.(payload, item) ?? payload) });
            await dataOf(operation);
            toast(ctx, `${config.singular} ${item ? "atualizado" : "criado"}.`, "success");
            modal.close();
            await load();
          } catch (error) { toast(ctx, error.message, "error"); }
        });
      });
      modal = openDialog(ctx, { title: item ? `Editar ${config.singular}` : `Novo ${config.singular}`, content: form, actions: [save] });
    };

    const toggle = async (item, control) => withBusy(control, async () => {
      try {
        await dataOf(ctx.api.from(config.table).update({ [config.toggleField]: !item[config.toggleField] }).eq("id", item.id).eq("store_id", getStoreId(ctx)));
        toast(ctx, "Status atualizado.", "success");
        await load();
      } catch (error) { toast(ctx, error.message, "error"); }
    });

    const remove = async (item, control) => {
      if (!await confirmAction(ctx, `Excluir ${config.describe(item)}? Esta acao nao pode ser desfeita.`)) return;
      await withBusy(control, async () => {
        try {
          await dataOf(ctx.api.from(config.table).delete().eq("id", item.id).eq("store_id", getStoreId(ctx)));
          toast(ctx, `${config.singular} excluido.`, "success");
          await load();
        } catch (error) { toast(ctx, error.message, "error"); }
      });
    };

    page.root.ready = load();
    return page.root;
  };
}
