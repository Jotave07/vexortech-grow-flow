import {
  badge,
  button,
  confirmAction,
  createAdminPage,
  dataOf,
  h,
  money,
  normalizeSearch,
  statusTone,
  toast,
  withBusy,
} from "./core.js";

export function filterStores(stores, { search = "", status = "all", plan = "all" } = {}) {
  const term = normalizeSearch(search);
  return stores.filter((store) => {
    const subscription = store.subscriptions?.[0];
    const haystack = normalizeSearch(
      `${store.name || ""} ${store.slug || ""} ${store.email || ""} ${store.document || ""}`,
    );
    if (term && !haystack.includes(term)) return false;
    if (status === "active" && (!store.is_active || store.is_suspended)) return false;
    if (status === "suspended" && !store.is_suspended) return false;
    if (status === "review" && (store.is_active || store.is_suspended)) return false;
    if (plan === "none" && subscription?.plan_id) return false;
    if (!new Set(["all", "none"]).has(plan) && subscription?.plan_id !== plan) return false;
    return true;
  });
}

const storeStatus = (store) =>
  store.is_suspended ? "Suspensa" : store.is_active ? "Ativa" : "Em analise";

export function renderAdminStores(ctx) {
  const page = createAdminPage(ctx, {
    title: "Lojas",
    description:
      "Consulte, suspenda, reative e administre assinaturas. O arquivamento preserva o historico e exige confirmacao explicita.",
  });
  let stores = [];
  let plans = [];
  let filters = { search: "", status: "all", plan: "all" };
  const results = h(ctx, "section");
  const search = h(ctx, "input", {
    className: "admin-input",
    type: "search",
    placeholder: "Nome, slug, e-mail ou documento",
    "aria-label": "Pesquisar lojas",
  });
  const statusFilter = h(
    ctx,
    "select",
    { className: "admin-select", "aria-label": "Filtrar por status" },
    [
      ["all", "Todos os status"],
      ["active", "Ativas"],
      ["suspended", "Suspensas"],
      ["review", "Em analise"],
    ].map(([value, label]) => h(ctx, "option", { value }, label)),
  );
  const planFilter = h(ctx, "select", {
    className: "admin-select",
    "aria-label": "Filtrar por plano",
  });
  const toolbar = h(
    ctx,
    "section",
    { className: "admin-panel admin-toolbar", "aria-label": "Filtros de lojas" },
    search,
    statusFilter,
    planFilter,
  );

  const load = async () => {
    results.replaceChildren(
      ctx.ui.loading?.("Carregando lojas...") ??
        h(ctx, "div", { className: "admin-state" }, "Carregando lojas..."),
    );
    try {
      const [storeRows, planRows] = await Promise.all([
        dataOf(
          ctx.api
            .from("stores")
            .select(
              "*,subscriptions(status,plan_id,asaas_subscription_id,billing_type,plans(name,price_monthly))",
            )
            .order("created_at", { ascending: false })
            .limit(10_000),
          [],
        ),
        dataOf(ctx.api.from("plans").select("*").order("sort_order").limit(500), []),
      ]);
      const ownerIds = [...new Set(storeRows.map((store) => store.owner_user_id).filter(Boolean))];
      const profiles = ownerIds.length
        ? await dataOf(
            ctx.api
              .from("profiles")
              .select("id,user_id,store_id,is_exempt,email")
              .in("user_id", ownerIds),
            [],
          )
        : [];
      const profileByUser = new Map(profiles.map((profile) => [profile.user_id, profile]));
      stores = storeRows.map((store) => ({
        ...store,
        owner_profile: profileByUser.get(store.owner_user_id) ?? null,
      }));
      plans = planRows;
      planFilter.replaceChildren(
        h(ctx, "option", { value: "all", selected: filters.plan === "all" }, "Todos os planos"),
        h(ctx, "option", { value: "none", selected: filters.plan === "none" }, "Sem plano"),
        ...plans.map((item) =>
          h(ctx, "option", { value: item.id, selected: filters.plan === item.id }, item.name),
        ),
      );
      if (page.active()) renderContent();
    } catch (error) {
      if (page.active())
        results.replaceChildren(
          h(
            ctx,
            "div",
            { className: "admin-state", role: "alert" },
            h(ctx, "strong", {}, "Nao foi possivel carregar lojas"),
            h(ctx, "span", {}, error.message),
            button(ctx, "Tentar novamente", { onClick: load }),
          ),
        );
    }
  };

  const suspend = async (store, control) =>
    withBusy(control, async () => {
      const suspending = !store.is_suspended;
      if (
        suspending &&
        !(await confirmAction(ctx, {
          title: `Suspender ${store.name}?`,
          message:
            "A loja deixara de operar no marketplace ate ser reativada. Pedidos existentes e historico serao preservados.",
          confirmLabel: "Suspender loja",
          danger: true,
        }))
      )
        return;
      const result = await ctx.api.fn("admin-set-store-suspension", {
        storeId: store.id,
        suspended: suspending,
      });
      if (result.error || result.data?.error) {
        return toast(
          ctx,
          result.error?.message || result.data?.error || "Nao foi possivel alterar a suspensao.",
          "error",
        );
      }
      toast(ctx, suspending ? "Loja suspensa." : "Loja reativada.", "success");
      await load();
    });

  const toggleExemption = async (store, control) =>
    withBusy(control, async () => {
      const profile = store.owner_profile;
      if (!profile?.id) return toast(ctx, "Perfil do responsavel nao encontrado.", "error");
      const next = !profile.is_exempt;
      if (
        !(await confirmAction(ctx, {
          title: next ? "Conceder cortesia?" : "Remover cortesia?",
          message: next
            ? "O responsavel ficara isento da mensalidade e a recorrencia atual sera cancelada no gateway. Cobrancas ja liquidadas nao sao estornadas."
            : "A isencao local sera removida. Confirme tambem a situacao da assinatura no financeiro.",
          confirmLabel: next ? "Conceder cortesia" : "Remover cortesia",
          danger: false,
        }))
      )
        return;
      const result = await ctx.api.fn("admin-set-store-exemption", {
        storeId: store.id,
        profileId: profile.id,
        exempt: next,
      });
      if (result.error || result.data?.error) {
        return toast(
          ctx,
          result.error?.message || result.data?.error || "Nao foi possivel alterar a cortesia.",
          "error",
        );
      }
      toast(ctx, next ? "Cortesia concedida." : "Cortesia removida.", "success");
      await load();
    });

  const changePlan = async (store, planId, control) =>
    withBusy(control, async () => {
      const current = store.subscriptions?.[0]?.plan_id;
      if (!planId || planId === current) return;
      const target = plans.find((item) => item.id === planId);
      if (
        !(await confirmAction(ctx, {
          title: `Alterar plano de ${store.name}?`,
          message: `O plano sera alterado para ${target?.name || "o selecionado"}. A operacao pode atualizar a assinatura no gateway e nao altera cobrancas ja emitidas.`,
          confirmLabel: "Alterar plano",
        }))
      ) {
        control.value = current || "";
        return;
      }
      const result = await ctx.api.fn("update-subscription-plan", { storeId: store.id, planId });
      if (result.error || result.data?.error) {
        control.value = current || "";
        return toast(
          ctx,
          result.error?.message || result.data?.error || "Nao foi possivel alterar o plano.",
          "error",
        );
      }
      toast(ctx, "Plano sincronizado.", "success");
      await load();
    });

  const remove = async (store, control) =>
    withBusy(control, async () => {
      if (
        !(await confirmAction(ctx, {
          title: `Arquivar ${store.name}?`,
          message:
            "A loja sera desativada e suspensa, mas pedidos, produtos, configuracoes e historico serao preservados. Lojas com pedidos em andamento nao podem ser arquivadas.",
          confirmLabel: "Arquivar loja",
          danger: true,
        }))
      )
        return;
      const result = await ctx.api.fn("admin-delete-store", {
        store_id: store.id,
        reason: "Arquivada pelo painel administrativo",
      });
      if (result.error || result.data?.error)
        return toast(
          ctx,
          result.error?.message || result.data?.error || "Falha ao arquivar loja.",
          "error",
        );
      toast(ctx, "Loja arquivada com historico preservado.", "success");
      await load();
    });

  function renderContent() {
    const visible = filterStores(stores, filters);
    const rows = visible.map((store) => {
      const subscription = store.subscriptions?.[0];
      const suspendButton = button(ctx, store.is_suspended ? "Reativar" : "Suspender", {
        onClick: () => suspend(store, suspendButton),
      });
      const exemptionButton = button(
        ctx,
        store.owner_profile?.is_exempt ? "Remover cortesia" : "Cortesia",
        {
          quiet: true,
          disabled: !store.owner_profile?.id,
          onClick: () => toggleExemption(store, exemptionButton),
        },
      );
      const removeButton = button(ctx, "Arquivar", {
        danger: true,
        onClick: () => remove(store, removeButton),
      });
      const planSelect = h(
        ctx,
        "select",
        {
          className: "admin-select",
          disabled: !subscription?.asaas_subscription_id,
          "aria-label": `Plano de ${store.name}`,
        },
        !subscription?.asaas_subscription_id
          ? h(ctx, "option", { value: "", selected: true }, "Sem assinatura ativa")
          : null,
        plans
          .filter((item) => item.is_active || item.id === subscription?.plan_id)
          .map((item) =>
            h(
              ctx,
              "option",
              { value: item.id, selected: item.id === subscription?.plan_id },
              item.name,
            ),
          ),
      );
      planSelect.addEventListener("change", () => changePlan(store, planSelect.value, planSelect));
      const publicLink = h(
        ctx,
        "a",
        {
          href: `/loja/${store.slug}`,
          onClick: (event) => {
            event.preventDefault();
            ctx.navigate(`/loja/${store.slug}`);
          },
        },
        store.name || "Loja sem nome",
      );
      return h(
        ctx,
        "tr",
        {},
        h(
          ctx,
          "td",
          {},
          publicLink,
          h(ctx, "div", { className: "admin-field__hint" }, `/${store.slug || "—"}`),
        ),
        h(
          ctx,
          "td",
          {},
          badge(
            ctx,
            storeStatus(store),
            statusTone(store.is_suspended ? "suspenso" : store.is_active ? "ativo" : "pendente"),
          ),
        ),
        h(
          ctx,
          "td",
          {},
          planSelect,
          subscription?.plans?.price_monthly != null
            ? h(
                ctx,
                "small",
                { className: "admin-field__hint" },
                money(ctx, subscription.plans.price_monthly),
              )
            : null,
        ),
        h(
          ctx,
          "td",
          {},
          store.owner_profile?.is_exempt ? badge(ctx, "Cortesia", "success") : "Mensalidade",
        ),
        h(
          ctx,
          "td",
          {},
          h(
            ctx,
            "div",
            { className: "admin-actions" },
            suspendButton,
            exemptionButton,
            removeButton,
          ),
        ),
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
        h(ctx, "caption", {}, `${visible.length} de ${stores.length} lojas`),
        h(
          ctx,
          "thead",
          {},
          h(
            ctx,
            "tr",
            {},
            ["Loja", "Status", "Plano", "Cobranca", "Acoes"].map((label) =>
              h(ctx, "th", { scope: "col" }, label),
            ),
          ),
        ),
        h(ctx, "tbody", {}, rows),
      ),
    );
    page.root.dataset.pageState = visible.length ? "ready" : "empty";
    results.replaceChildren(
      visible.length
        ? table
        : (ctx.ui.empty?.("Nenhuma loja encontrada", "Ajuste os filtros para ampliar a busca.") ??
            h(ctx, "div", { className: "admin-state" }, "Nenhuma loja encontrada.")),
    );
    page.announce(`${visible.length} lojas exibidas.`);
  }

  const updateFilters = () => {
    filters = { search: search.value, status: statusFilter.value, plan: planFilter.value || "all" };
    renderContent();
  };
  search.addEventListener("input", updateFilters);
  statusFilter.addEventListener("change", updateFilters);
  planFilter.addEventListener("change", updateFilters);
  page.actions.append(button(ctx, "Atualizar", { primary: true, onClick: load }));
  page.setContent(toolbar, results);
  void load();
  return page.root;
}
