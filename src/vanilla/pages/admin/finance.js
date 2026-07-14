import {
  badge,
  button,
  confirmAction,
  createAdminPage,
  dataOf,
  date,
  field,
  h,
  money,
  openDialog,
  serializeForm,
  statusTone,
  toast,
  withBusy,
} from "./core.js";

export const FINANCIAL_BUCKETS = Object.freeze([
  ["aguardando_entrega", "Aguardando entrega"],
  ["aguardando_repasse", "Aguardando repasse"],
  ["repasse_falho", "Repasse com falha"],
  ["reembolso_falho", "Reembolso com falha"],
]);

export function subscriptionSummary(subscriptions) {
  const active = subscriptions.filter((item) => ["ativa", "trial"].includes(item.status));
  const billable = active.filter((item) => item.asaas_subscription_id);
  return {
    active: active.length,
    risk: subscriptions.filter((item) =>
      ["inadimplente", "pendente_pagamento"].includes(item.status),
    ).length,
    mrr: billable.reduce((sum, item) => sum + Number(item.plans?.price_monthly || 0), 0),
  };
}

const ADMIN_BLOCKABLE_TRANSFER_STATUSES = new Set([
  "NAO_LIBERADO",
  "AGUARDANDO_ENTREGA",
  "LIBERADO",
  "FALHOU",
]);

export function financialOrderActions(order) {
  const transferLedgerLocked = ["PROCESSANDO", "CONFIRMADO"].includes(
    order.transfer_movement_status,
  );
  return {
    releaseTransfer: order.transfer_status === "LIBERADO" && !transferLedgerLocked,
    retryTransfer:
      order.transfer_status === "FALHOU" && order.transfer_movement_status === "FALHOU",
    retryRefund: order.refund_status === "FALHOU" && order.refund_movement_status === "FALHOU",
    blockTransfer:
      ADMIN_BLOCKABLE_TRANSFER_STATUSES.has(order.transfer_status) && !transferLedgerLocked,
  };
}

export function renderAdminFinance(ctx) {
  const page = createAdminPage(ctx, {
    title: "Financeiro",
    description:
      "Monitore assinaturas, repasses e reembolsos. Operacoes corretivas sao executadas no servidor com autorizacao e idempotencia.",
  });
  let bucket = "repasse_falho";
  let financialOrders = [];
  let stores = [];
  let subscriptions = [];
  const financialResults = h(ctx, "section");
  const subscriptionResults = h(ctx, "section");

  const runAction = async (name, order, control, copy) =>
    withBusy(control, async () => {
      if (!(await confirmAction(ctx, copy))) return;
      const result = await ctx.api.fn(name, { orderId: order.id, reason: copy.reason });
      if (result.error || result.data?.error || result.data?.ok === false)
        return toast(
          ctx,
          result.error?.message ||
            result.data?.error ||
            result.data?.reason ||
            "Operacao financeira falhou.",
          "error",
        );
      toast(ctx, "Operacao financeira solicitada com sucesso.", "success");
      await loadFinancial();
    });

  function renderFinancial() {
    const rows = financialOrders.map((order) => {
      const actions = [];
      const allowedActions = financialOrderActions(order);
      if (allowedActions.releaseTransfer) {
        const release = button(ctx, "Liberar repasse", {
          primary: true,
          onClick: () =>
            runAction("admin-release-transfer", order, release, {
              title: `Liberar repasse do pedido #${order.order_number}?`,
              message:
                "O servidor exigira pagamento PIX Asaas central e entrada confirmada no ledger antes de iniciar o repasse.",
              confirmLabel: "Liberar repasse",
            }),
        });
        actions.push(release);
      }
      if (allowedActions.retryTransfer) {
        const retry = button(ctx, "Reprocessar repasse", {
          onClick: () =>
            runAction("admin-retry-transfer", order, retry, {
              title: `Reprocessar repasse do pedido #${order.order_number}?`,
              message:
                "O servidor validara pagamento, entrega, reembolso e idempotencia antes de enviar novamente ao gateway.",
              confirmLabel: "Reprocessar repasse",
            }),
        });
        actions.push(retry);
      }
      if (allowedActions.retryRefund) {
        const retry = button(ctx, "Reprocessar reembolso", {
          onClick: () =>
            runAction("admin-retry-refund", order, retry, {
              title: `Reprocessar reembolso do pedido #${order.order_number}?`,
              message:
                "Uma nova tentativa sera feita no gateway. O servidor impede duplicidade para reembolsos ja concluidos ou em andamento.",
              confirmLabel: "Reprocessar reembolso",
            }),
        });
        actions.push(retry);
      }
      if (allowedActions.blockTransfer) {
        const block = button(ctx, "Bloquear repasse", {
          danger: true,
          onClick: () =>
            runAction("admin-block-transfer", order, block, {
              title: `Bloquear repasse do pedido #${order.order_number}?`,
              message:
                "O repasse sera marcado como bloqueado e o movimento pendente sera cancelado. Use apenas durante analise de risco ou disputa.",
              confirmLabel: "Bloquear repasse",
              danger: true,
              reason: "Bloqueado manualmente pelo administrador",
            }),
        });
        actions.push(block);
      }
      return h(
        ctx,
        "tr",
        {},
        h(
          ctx,
          "td",
          {},
          h(ctx, "strong", {}, `#${order.order_number}`),
          h(ctx, "div", { className: "admin-field__hint" }, date(ctx, order.created_at, true)),
        ),
        h(
          ctx,
          "td",
          {},
          order.store_name || "Loja",
          order.pix_key
            ? h(
                ctx,
                "div",
                { className: "admin-field__hint" },
                `PIX ${order.pix_key_type || ""} configurado`,
              )
            : h(ctx, "div", { className: "admin-alert" }, "PIX ausente"),
        ),
        h(ctx, "td", {}, money(ctx, order.total)),
        h(
          ctx,
          "td",
          {},
          badge(ctx, order.transfer_status || "—", statusTone(order.transfer_status)),
        ),
        h(ctx, "td", {}, badge(ctx, order.refund_status || "—", statusTone(order.refund_status))),
        h(
          ctx,
          "td",
          {},
          h(
            ctx,
            "div",
            { className: "admin-actions" },
            actions.length ? actions : "Sem acao pendente",
          ),
        ),
      );
    });
    financialResults.replaceChildren(
      financialOrders.length
        ? h(
            ctx,
            "div",
            { className: "admin-table-wrap" },
            h(
              ctx,
              "table",
              { className: "admin-table" },
              h(ctx, "caption", {}, `${financialOrders.length} pedidos na fila selecionada`),
              h(
                ctx,
                "thead",
                {},
                h(
                  ctx,
                  "tr",
                  {},
                  ["Pedido", "Loja", "Total", "Repasse", "Reembolso", "Acoes"].map((label) =>
                    h(ctx, "th", { scope: "col" }, label),
                  ),
                ),
              ),
              h(ctx, "tbody", {}, rows),
            ),
          )
        : (ctx.ui.empty?.("Fila em dia", "Nenhum pedido exige atencao nesta categoria.") ??
            h(ctx, "div", { className: "admin-state" }, "Nenhuma pendencia nesta fila.")),
    );
    page.announce(`${financialOrders.length} pedidos na fila financeira.`);
  }

  function renderSubscriptions() {
    const summary = subscriptionSummary(subscriptions);
    const stats = h(
      ctx,
      "section",
      { className: "admin-grid", "aria-label": "Resumo de assinaturas" },
      [
        ["MRR ativo", money(ctx, summary.mrr)],
        ["Assinaturas ativas", summary.active],
        ["Assinaturas em risco", summary.risk],
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
    const risk = subscriptions
      .filter((item) => ["inadimplente", "pendente_pagamento"].includes(item.status))
      .slice(0, 20);
    const list = h(
      ctx,
      "section",
      { className: "admin-panel" },
      h(
        ctx,
        "div",
        { className: "admin-panel__header" },
        h(ctx, "h2", { className: "admin-panel__title" }, "Assinaturas que precisam de atencao"),
      ),
      risk.length
        ? h(
            ctx,
            "ul",
            { className: "admin-list" },
            risk.map((item) =>
              h(
                ctx,
                "li",
                { className: "admin-list__item" },
                h(
                  ctx,
                  "span",
                  {},
                  h(ctx, "strong", {}, item.stores?.name || "Loja"),
                  h(
                    ctx,
                    "div",
                    { className: "admin-field__hint" },
                    item.plans?.name || "Sem plano",
                  ),
                ),
                badge(ctx, item.status, statusTone(item.status)),
              ),
            ),
          )
        : h(ctx, "p", {}, "Nenhuma assinatura pendente ou inadimplente."),
    );
    subscriptionResults.replaceChildren(stats, list);
  }

  const loadFinancial = async () => {
    financialResults.replaceChildren(
      ctx.ui.loading?.("Consultando fila financeira...") ??
        h(ctx, "div", { className: "admin-state" }, "Consultando fila..."),
    );
    const result = await ctx.api.fn("admin-financial-orders", { bucket, limit: 200 });
    if (result.error || result.data?.error) {
      financialResults.replaceChildren(
        h(
          ctx,
          "div",
          { className: "admin-alert", role: "alert" },
          result.error?.message || result.data?.error || "Falha ao consultar financeiro.",
        ),
      );
      return;
    }
    financialOrders = result.data?.orders ?? [];
    if (page.active()) renderFinancial();
  };

  const loadSubscriptions = async () => {
    subscriptionResults.replaceChildren(
      ctx.ui.loading?.("Carregando assinaturas...") ??
        h(ctx, "div", { className: "admin-state" }, "Carregando assinaturas..."),
    );
    try {
      [subscriptions, stores] = await Promise.all([
        dataOf(
          ctx.api
            .from("subscriptions")
            .select(
              "id,store_id,status,asaas_subscription_id,last_payment_status,updated_at,stores(name),plans(name,price_monthly)",
            )
            .order("updated_at", { ascending: false })
            .limit(500),
          [],
        ),
        dataOf(ctx.api.from("stores").select("id,name").order("name").limit(10_000), []),
      ]);
      if (page.active()) renderSubscriptions();
    } catch (error) {
      subscriptionResults.replaceChildren(
        h(ctx, "div", { className: "admin-alert", role: "alert" }, error.message),
      );
    }
  };

  const openAdjustment = () => {
    const form = h(
      ctx,
      "form",
      { className: "admin-form" },
      field(ctx, {
        name: "storeId",
        label: "Loja",
        required: true,
        options: [
          { value: "", label: "Selecione" },
          ...stores.map((store) => ({ value: store.id, label: store.name })),
        ],
      }),
      field(ctx, {
        name: "orderId",
        label: "ID do pedido (opcional)",
        hint: "Quando informado, o servidor valida se o pedido pertence a loja.",
      }),
      h(
        ctx,
        "div",
        { className: "admin-form__grid" },
        field(ctx, {
          name: "nature",
          label: "Natureza",
          required: true,
          options: [
            { value: "CREDITO", label: "Credito" },
            { value: "DEBITO", label: "Debito" },
          ],
        }),
        field(ctx, {
          name: "amount",
          label: "Valor",
          type: "number",
          min: 0.01,
          step: 0.01,
          required: true,
        }),
      ),
      field(ctx, {
        name: "description",
        label: "Justificativa",
        type: "textarea",
        required: true,
        hint: "Descreva o motivo de forma auditavel, sem dados sensiveis.",
      }),
      h(
        ctx,
        "div",
        { className: "admin-alert" },
        "Ajustes nao apagam movimentos anteriores: um novo lancamento auditavel sera criado no ledger.",
      ),
    );
    const submit = button(ctx, "Registrar ajuste", { danger: true, type: "submit" });
    const modal = openDialog(ctx, {
      title: "Ajuste financeiro manual",
      content: form,
      actions: [submit],
    });
    page.onCleanup(modal.close);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = serializeForm(form);
      if (
        !(await confirmAction(ctx, {
          title: "Confirmar ajuste no ledger?",
          message: `${values.nature === "DEBITO" ? "Debito" : "Credito"} de ${money(ctx, values.amount)} sera registrado para a loja selecionada. O lancamento e auditavel e nao deve ser usado para corrigir cadastro.`,
          confirmLabel: "Registrar ajuste",
          danger: values.nature === "DEBITO",
        }))
      )
        return;
      await withBusy(submit, async () => {
        const random =
          globalThis.crypto?.randomUUID?.() ||
          `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const result = await ctx.api.fn("admin-manual-adjustment", {
          storeId: values.storeId,
          orderId: values.orderId || undefined,
          nature: values.nature,
          amount: Number(values.amount),
          description: String(values.description).trim(),
          idempotencyKey: random,
        });
        if (result.error || result.data?.error)
          return toast(
            ctx,
            result.error?.message || result.data?.error || "Falha ao registrar ajuste.",
            "error",
          );
        modal.close();
        toast(ctx, "Ajuste registrado no ledger.", "success");
      });
    });
    submit.addEventListener("click", () => form.requestSubmit());
  };

  const bucketSelect = h(
    ctx,
    "select",
    { className: "admin-select", "aria-label": "Fila financeira" },
    FINANCIAL_BUCKETS.map(([value, label]) =>
      h(ctx, "option", { value, selected: value === bucket }, label),
    ),
  );
  bucketSelect.addEventListener("change", () => {
    bucket = bucketSelect.value;
    void loadFinancial();
  });
  page.actions.append(
    button(ctx, "Ajuste manual", { danger: true, onClick: openAdjustment }),
    button(ctx, "Atualizar", {
      primary: true,
      onClick: () => {
        void loadFinancial();
        void loadSubscriptions();
      },
    }),
  );
  page.setContent(
    h(
      ctx,
      "section",
      { className: "admin-panel" },
      h(
        ctx,
        "div",
        { className: "admin-panel__header" },
        h(ctx, "h2", { className: "admin-panel__title" }, "Fila operacional"),
        bucketSelect,
      ),
      financialResults,
    ),
    h(
      ctx,
      "section",
      {},
      h(ctx, "h2", { className: "admin-panel__title" }, "Assinaturas da plataforma"),
      subscriptionResults,
    ),
  );
  void loadFinancial();
  void loadSubscriptions();
  return page.root;
}
