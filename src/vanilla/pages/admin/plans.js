import {
  badge,
  button,
  confirmAction,
  createAdminPage,
  dataOf,
  field,
  h,
  money,
  openDialog,
  serializeForm,
  statusTone,
  toast,
  withBusy,
} from "./core.js";

export const parseFeatures = (value) =>
  String(value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

export function planPayload(values) {
  return {
    name: String(values.name ?? "").trim(),
    slug: String(values.slug ?? "")
      .trim()
      .toLowerCase(),
    description: String(values.description ?? "").trim() || null,
    price_monthly: Math.max(0, Number(values.price_monthly) || 0),
    max_products: values.max_products === "" ? null : Math.max(0, Number(values.max_products) || 0),
    max_orders_per_month:
      values.max_orders_per_month === ""
        ? null
        : Math.max(0, Number(values.max_orders_per_month) || 0),
    features: parseFeatures(values.features),
    allows_coupons: Boolean(values.allows_coupons),
    allows_advanced_reports: Boolean(values.allows_advanced_reports),
    allows_custom_branding: Boolean(values.allows_custom_branding),
    is_active: Boolean(values.is_active),
    sort_order: Number(values.sort_order) || 0,
  };
}

export function renderAdminPlans(ctx) {
  const page = createAdminPage(ctx, {
    title: "Planos",
    description:
      "Gerencie catalogo, limites e recursos. Planos em uso sao arquivados para preservar assinaturas existentes.",
  });
  let plans = [];

  const load = async () => {
    page.loading("Carregando planos...");
    try {
      plans = await dataOf(ctx.api.from("plans").select("*").order("sort_order").limit(500), []);
      if (page.active()) renderContent();
    } catch (error) {
      if (page.active()) page.fail(error, load);
    }
  };

  const saveDialog = (plan = null) => {
    const form = h(
      ctx,
      "form",
      { className: "admin-form" },
      h(
        ctx,
        "div",
        { className: "admin-form__grid" },
        field(ctx, { name: "name", label: "Nome", value: plan?.name || "", required: true }),
        field(ctx, {
          name: "slug",
          label: "Slug",
          value: plan?.slug || "",
          required: true,
          hint: "Letras minusculas, numeros e hifens.",
        }),
      ),
      field(ctx, {
        name: "description",
        label: "Descricao",
        type: "textarea",
        value: plan?.description || "",
      }),
      h(
        ctx,
        "div",
        { className: "admin-form__grid" },
        field(ctx, {
          name: "price_monthly",
          label: "Preco mensal",
          type: "number",
          min: 0,
          step: 0.01,
          value: plan?.price_monthly ?? 0,
          required: true,
        }),
        field(ctx, {
          name: "max_products",
          label: "Maximo de produtos",
          type: "number",
          min: 0,
          value: plan?.max_products ?? "",
          hint: "Vazio = ilimitado",
        }),
        field(ctx, {
          name: "max_orders_per_month",
          label: "Pedidos por mes",
          type: "number",
          min: 0,
          value: plan?.max_orders_per_month ?? "",
          hint: "Vazio = ilimitado",
        }),
        field(ctx, {
          name: "sort_order",
          label: "Ordem",
          type: "number",
          min: 0,
          value: plan?.sort_order ?? plans.length,
        }),
      ),
      field(ctx, {
        name: "features",
        label: "Recursos exibidos",
        type: "textarea",
        value: Array.isArray(plan?.features) ? plan.features.join("\n") : "",
        hint: "Um recurso por linha.",
      }),
      h(
        ctx,
        "div",
        { className: "admin-form__grid" },
        field(ctx, {
          name: "allows_coupons",
          label: "Permite cupons",
          type: "checkbox",
          value: plan?.allows_coupons,
        }),
        field(ctx, {
          name: "allows_advanced_reports",
          label: "Relatorios avancados",
          type: "checkbox",
          value: plan?.allows_advanced_reports,
        }),
        field(ctx, {
          name: "allows_custom_branding",
          label: "Marca personalizada",
          type: "checkbox",
          value: plan?.allows_custom_branding,
        }),
        field(ctx, {
          name: "is_active",
          label: "Plano publico e ativo",
          type: "checkbox",
          value: plan?.is_active ?? true,
        }),
      ),
      h(
        ctx,
        "div",
        { className: "admin-alert" },
        "Alterar preco ou recursos nao modifica cobrancas ja emitidas. Revise a assinatura da loja quando necessario.",
      ),
    );
    const save = button(ctx, "Salvar plano", { primary: true, type: "submit" });
    const modal = openDialog(ctx, {
      title: plan ? `Editar ${plan.name}` : "Novo plano",
      content: form,
      actions: [save],
    });
    page.onCleanup(modal.close);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      await withBusy(save, async () => {
        const payload = planPayload(serializeForm(form));
        if (!payload.name || !/^[a-z0-9-]{2,60}$/.test(payload.slug))
          return toast(ctx, "Informe nome e um slug valido.", "error");
        const result = plan
          ? await ctx.api.from("plans").update(payload).eq("id", plan.id)
          : await ctx.api.from("plans").insert(payload);
        if (result.error) return toast(ctx, result.error.message, "error");
        modal.close();
        toast(ctx, "Plano salvo.", "success");
        await load();
      });
    });
    save.addEventListener("click", () => form.requestSubmit());
  };

  const remove = async (plan, control) =>
    withBusy(control, async () => {
      if (
        !(await confirmAction(ctx, {
          title: `Excluir o plano ${plan.name}?`,
          message:
            "Se houver loja ou assinatura vinculada, o plano sera apenas arquivado. Caso contrario, sera excluido permanentemente.",
          confirmLabel: "Excluir ou arquivar",
          danger: true,
        }))
      )
        return;
      const [storeRows, subscriptionRows] = await Promise.all([
        dataOf(ctx.api.from("stores").select("id").eq("plan_id", plan.id).limit(1), []),
        dataOf(ctx.api.from("subscriptions").select("id").eq("plan_id", plan.id).limit(1), []),
      ]);
      const inUse = Boolean(storeRows.length || subscriptionRows.length);
      const result = inUse
        ? await ctx.api.from("plans").update({ is_active: false }).eq("id", plan.id)
        : await ctx.api.from("plans").delete().eq("id", plan.id);
      if (result.error) return toast(ctx, result.error.message, "error");
      toast(ctx, inUse ? "Plano arquivado porque possui vinculos." : "Plano excluido.", "success");
      await load();
    });

  function renderContent() {
    const active = plans.filter((plan) => plan.is_active);
    const prices = active.map((plan) => Number(plan.price_monthly) || 0);
    const stats = h(
      ctx,
      "section",
      { className: "admin-grid", "aria-label": "Resumo dos planos" },
      [
        ["Planos ativos", active.length],
        ["Planos pagos", active.filter((plan) => Number(plan.price_monthly) > 0).length],
        ["Arquivados", plans.length - active.length],
        ["Menor mensalidade", prices.length ? money(ctx, Math.min(...prices)) : "—"],
      ].map(([label, value]) =>
        h(
          ctx,
          "section",
          { className: "admin-panel admin-stat" },
          h(ctx, "span", { className: "admin-stat__label" }, label),
          h(ctx, "strong", { className: "admin-stat__value" }, String(value)),
        ),
      ),
    );
    const rows = plans.map((plan) => {
      const edit = button(ctx, "Editar", { onClick: () => saveDialog(plan) });
      const removeButton = button(ctx, "Excluir", {
        danger: true,
        onClick: () => remove(plan, removeButton),
      });
      return h(
        ctx,
        "tr",
        {},
        h(
          ctx,
          "td",
          {},
          h(ctx, "strong", {}, plan.name),
          h(ctx, "div", { className: "admin-field__hint" }, `/${plan.slug || "—"}`),
        ),
        h(
          ctx,
          "td",
          {},
          money(ctx, plan.price_monthly),
          h(ctx, "div", { className: "admin-field__hint" }, "por mes"),
        ),
        h(ctx, "td", {}, plan.max_products || "Ilimitado"),
        h(ctx, "td", {}, plan.max_orders_per_month || "Ilimitado"),
        h(
          ctx,
          "td",
          {},
          badge(
            ctx,
            plan.is_active ? "Ativo" : "Arquivado",
            statusTone(plan.is_active ? "ativo" : "inativo"),
          ),
        ),
        h(ctx, "td", {}, h(ctx, "div", { className: "admin-actions" }, edit, removeButton)),
      );
    });
    const table = h(
      ctx,
      "div",
      { className: "admin-table-wrap" },
      h(
        ctx,
        "table",
        { className: "admin-table" },
        h(ctx, "caption", {}, `${plans.length} planos cadastrados`),
        h(
          ctx,
          "thead",
          {},
          h(
            ctx,
            "tr",
            {},
            ["Plano", "Mensalidade", "Produtos", "Pedidos/mes", "Status", "Acoes"].map((label) =>
              h(ctx, "th", { scope: "col" }, label),
            ),
          ),
        ),
        h(ctx, "tbody", {}, rows),
      ),
    );
    page.root.dataset.pageState = plans.length ? "ready" : "empty";
    page.setContent(
      stats,
      plans.length
        ? table
        : (ctx.ui.empty?.(
            "Nenhum plano",
            "Crie o primeiro plano para iniciar o catalogo.",
            button(ctx, "Criar plano", { primary: true, onClick: () => saveDialog() }),
          ) ?? h(ctx, "div", { className: "admin-state" }, "Nenhum plano cadastrado.")),
    );
    page.announce(`${plans.length} planos carregados.`);
  }

  page.actions.append(
    button(ctx, "Novo plano", { primary: true, onClick: () => saveDialog() }),
    button(ctx, "Atualizar", { onClick: load }),
  );
  void load();
  return page.root;
}
