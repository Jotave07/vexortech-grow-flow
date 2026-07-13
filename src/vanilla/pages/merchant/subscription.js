import { digitsOnly, isValidDocument, normalizeDocument } from "../auth/validation.js";
import {
  badge,
  button,
  confirmAction,
  createPage,
  dataOf,
  date,
  getStoreId,
  h,
  money,
  openDialog,
  requireMerchant,
  statusTone,
  toast,
  withBusy,
} from "./core.js";

export const SUBSCRIPTION_BILLING_TYPES = Object.freeze(["BOLETO", "CREDIT_CARD"]);
export const isSubscriptionPlanChangeBlocked = (subscription) =>
  ["bloqueada", "suspensa", "em_disputa"].includes(
    String(subscription?.status || "").toLowerCase(),
  );

const planPrice = (plan) => Number(plan.price_monthly ?? plan.monthly_price ?? plan.price ?? 0);
const planFeatures = (plan) => (Array.isArray(plan.features) ? plan.features : []);
const clean = (value) => String(value ?? "").trim();
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean(value));

export function isValidCardNumber(value) {
  const number = digitsOnly(value);
  if (number.length < 13 || number.length > 19 || /^(\d)\1+$/.test(number)) return false;
  let sum = 0;
  let doubleDigit = false;
  for (let index = number.length - 1; index >= 0; index -= 1) {
    let digit = Number(number[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

const normalizedExpiry = (monthValue, yearValue) => {
  const month = digitsOnly(monthValue).padStart(2, "0");
  const rawYear = digitsOnly(yearValue);
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  return { month, year };
};

const validExpiry = (month, year, now) => {
  if (!/^(0[1-9]|1[0-2])$/.test(month) || !/^20\d{2}$/.test(year)) return false;
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(current.getTime())) return false;
  return (
    Number(year) > current.getFullYear() ||
    (Number(year) === current.getFullYear() && Number(month) >= current.getMonth() + 1)
  );
};

export function buildSubscriptionRequest({
  storeId,
  planId,
  billingType,
  operation = "create",
  values = {},
  now = new Date(),
}) {
  const errors = [];
  const type = SUBSCRIPTION_BILLING_TYPES.includes(billingType) ? billingType : null;
  const updating = operation === "update";
  if (!type) errors.push("Escolha boleto ou cartao de credito.");
  if (!clean(storeId) || !clean(planId)) errors.push("Loja ou plano nao identificado.");

  const customer = {
    name: clean(values.customerName),
    email: clean(values.customerEmail).toLowerCase(),
    cpfCnpj: normalizeDocument(values.customerDocument),
    mobilePhone: digitsOnly(values.customerPhone) || undefined,
  };
  const customerRequired = !updating || type === "CREDIT_CARD";
  if (customerRequired) {
    if (customer.name.length < 2 || customer.name.length > 160)
      errors.push("Informe o nome do responsavel pela cobranca.");
    if (!validEmail(customer.email) || customer.email.length > 180)
      errors.push("Informe um e-mail de cobranca valido.");
    if (!isValidDocument(customer.cpfCnpj)) errors.push("Informe um CPF ou CNPJ valido.");
    if (customer.mobilePhone && customer.mobilePhone.length < 10)
      errors.push("Informe um telefone com DDD ou deixe o campo vazio.");
  }

  const body = { storeId: clean(storeId), planId: clean(planId), billingType: type };
  if (!updating) body.customerData = customer;

  if (type === "CREDIT_CARD") {
    const cardNumber = digitsOnly(values.cardNumber);
    const { month, year } = normalizedExpiry(values.expiryMonth, values.expiryYear);
    const ccv = digitsOnly(values.ccv);
    const holderName = clean(values.cardHolderName);
    const postalCode = digitsOnly(values.postalCode);
    const addressNumber = clean(values.addressNumber);
    if (holderName.length < 2 || holderName.length > 120)
      errors.push("Informe o nome impresso no cartao.");
    if (!isValidCardNumber(cardNumber)) errors.push("Informe um numero de cartao valido.");
    if (!validExpiry(month, year, now)) errors.push("Informe uma validade de cartao futura.");
    if (!/^\d{3,4}$/.test(ccv)) errors.push("Informe um codigo de seguranca com 3 ou 4 digitos.");
    if (postalCode.length !== 8) errors.push("Informe o CEP do titular com 8 digitos.");
    if (!addressNumber || addressNumber.length > 20)
      errors.push("Informe o numero do endereco do titular.");
    if (clean(values.addressComplement).length > 80)
      errors.push("O complemento deve ter no maximo 80 caracteres.");

    body.cardData = {
      creditCard: {
        holderName,
        number: cardNumber,
        expiryMonth: month,
        expiryYear: year,
        ccv,
      },
      creditCardHolderInfo: {
        name: customer.name,
        email: customer.email,
        cpfCnpj: customer.cpfCnpj,
        postalCode,
        addressNumber,
        addressComplement: clean(values.addressComplement) || null,
        mobilePhone: customer.mobilePhone,
      },
    };
  }

  if (errors.length) return { ok: false, errors, functionName: null, body: null };
  return {
    ok: true,
    errors: [],
    functionName: updating ? "update-subscription-plan" : "create-subscription-checkout",
    body,
  };
}

const paymentField = (
  ctx,
  {
    name,
    label,
    value = "",
    type = "text",
    required = false,
    autocomplete,
    inputmode,
    maxlength,
    placeholder,
  },
) => {
  const id = `subscription-${name}-${Math.random().toString(36).slice(2, 8)}`;
  return h(
    ctx,
    "label",
    { className: "merchant-field", htmlFor: id },
    h(ctx, "span", {}, label),
    h(ctx, "input", {
      id,
      name,
      type,
      value,
      required,
      autocomplete,
      inputmode,
      maxlength,
      placeholder,
      className: "merchant-input",
    }),
  );
};

const formValues = (form) => Object.fromEntries(new FormData(form).entries());

export function render(ctx) {
  const page = createPage(ctx, {
    title: "Assinatura",
    description: "Compare plano, forma de cobranca, acesso e proxima renovacao antes de confirmar.",
  });
  const state = { plans: [], subscription: null, store: null };

  const load = async () => {
    page.loading("Carregando assinatura...");
    try {
      await requireMerchant(ctx);
      [state.plans, state.subscription, state.store] = await Promise.all([
        dataOf(ctx.api.from("plans").select("*").eq("is_active", true).order("sort_order"), []),
        dataOf(
          ctx.api
            .from("subscriptions")
            .select("*, plans(*)")
            .eq("store_id", getStoreId(ctx))
            .maybeSingle(),
          null,
        ),
        dataOf(
          ctx.api
            .from("stores")
            .select(
              "id,name,document,email,whatsapp,whatsapp_number,phone,zip_code,address_number,address_complement",
            )
            .eq("id", getStoreId(ctx))
            .maybeSingle(),
          null,
        ),
      ]);
      renderPlans();
    } catch (error) {
      page.fail(error, load);
    }
  };

  const renderPlans = () => {
    const subscription = state.subscription;
    const currentPlanId = subscription?.plan_id;
    const status = subscription?.status ?? "sem_plano";
    const currentPrice = planPrice(subscription?.plans ?? {});
    const overview = h(
      ctx,
      "section",
      { className: "merchant-panel" },
      h(
        ctx,
        "div",
        { className: "merchant-page__header" },
        h(
          ctx,
          "div",
          {},
          h(ctx, "h2", { className: "merchant-panel__title" }, "Situacao atual"),
          badge(
            ctx,
            status.replaceAll("_", " "),
            statusTone(status === "ativa" ? "ativo" : status),
          ),
        ),
        h(
          ctx,
          "div",
          { className: "merchant-actions" },
          subscription && !["cancelada", "encerrada", "bloqueada", "suspensa"].includes(status)
            ? button(ctx, "Sincronizar pagamento", {
                onClick: (event) => sync(event.currentTarget),
              })
            : null,
          subscription && !["cancelada", "encerrada"].includes(status)
            ? button(ctx, "Cancelar renovacao", {
                danger: true,
                onClick: (event) => cancel(event.currentTarget),
              })
            : null,
        ),
      ),
      subscription
        ? h(
            ctx,
            "div",
            { className: "merchant-grid" },
            h(
              ctx,
              "div",
              { className: "merchant-stat" },
              h(ctx, "span", { className: "merchant-stat__label" }, "Plano"),
              h(
                ctx,
                "strong",
                { className: "merchant-stat__value" },
                subscription.plans?.name ?? "Plano atual",
              ),
            ),
            h(
              ctx,
              "div",
              { className: "merchant-stat" },
              h(ctx, "span", { className: "merchant-stat__label" }, "Forma de cobranca"),
              h(
                ctx,
                "strong",
                {},
                subscription.billing_type === "CREDIT_CARD"
                  ? "Cartao de credito"
                  : subscription.billing_type === "BOLETO"
                    ? "Boleto"
                    : "Nao informada",
              ),
            ),
            h(
              ctx,
              "div",
              { className: "merchant-stat" },
              h(ctx, "span", { className: "merchant-stat__label" }, "Proxima renovacao"),
              h(
                ctx,
                "strong",
                {},
                date(ctx, subscription.current_period_end ?? subscription.next_due_date, {
                  dateStyle: "long",
                }) || "Nao informada",
              ),
            ),
            h(
              ctx,
              "div",
              { className: "merchant-stat" },
              h(ctx, "span", { className: "merchant-stat__label" }, "Ultimo pagamento"),
              h(
                ctx,
                "strong",
                {},
                String(subscription.last_payment_status ?? "Nao informado").replaceAll("_", " "),
              ),
            ),
          )
        : h(
            ctx,
            "p",
            {},
            "Nenhuma assinatura ativa. Escolha um plano e a forma de cobranca para liberar a operacao.",
          ),
    );
    const plans = h(
      ctx,
      "div",
      { className: "merchant-grid", "aria-label": "Planos disponiveis" },
      state.plans.map((plan) => {
        const planChangesBlocked = isSubscriptionPlanChangeBlocked(subscription);
        const current = plan.id === currentPlanId && !["cancelada", "encerrada"].includes(status);
        const downgrade = Boolean(
          subscription?.status === "ativa" &&
          currentPrice > 0 &&
          plan.id !== currentPlanId &&
          planPrice(plan) < currentPrice,
        );
        return h(
          ctx,
          "article",
          { className: "merchant-panel" },
          h(
            ctx,
            "div",
            { className: "merchant-page__header" },
            h(ctx, "h2", { className: "merchant-panel__title" }, plan.name),
            current ? badge(ctx, "Plano atual", "success") : null,
          ),
          h(ctx, "p", { className: "merchant-stat__value" }, `${money(ctx, planPrice(plan))}/mes`),
          plan.description
            ? h(ctx, "p", { className: "merchant-page__description" }, plan.description)
            : null,
          planFeatures(plan).length
            ? h(
                ctx,
                "ul",
                { className: "merchant-list" },
                planFeatures(plan).map((feature) =>
                  h(ctx, "li", { className: "merchant-list__item" }, feature),
                ),
              )
            : null,
          downgrade
            ? h(
                ctx,
                "p",
                { className: "merchant-field__hint" },
                "Downgrade exige atendimento e nao pode ser concluido nesta tela.",
              )
            : null,
          planChangesBlocked
            ? h(
                ctx,
                "p",
                { className: "merchant-field__hint" },
                "A assinatura esta bloqueada ou em disputa. Regularize a situacao antes de trocar o plano.",
              )
            : null,
          button(
            ctx,
            current
              ? "Plano atual"
              : subscription
                ? "Trocar para este plano"
                : "Assinar este plano",
            {
              primary: !current && !downgrade,
              disabled: current || downgrade || planChangesBlocked,
              onClick: () => openCheckout(plan),
            },
          ),
        );
      }),
    );
    page.root.dataset.pageState = "ready";
    page.setContent(
      overview,
      h(ctx, "section", {}, h(ctx, "h2", { className: "merchant-panel__title" }, "Planos"), plans),
    );
    page.announce(
      `Assinatura ${status.replaceAll("_", " ")}. ${state.plans.length} planos disponiveis.`,
    );
  };

  const openCheckout = (plan) => {
    const profile = ctx.auth.profile ?? {};
    const store = state.store ?? {};
    const subscription = state.subscription;
    if (isSubscriptionPlanChangeBlocked(subscription)) {
      toast(ctx, "Regularize a assinatura antes de alterar o plano.", "error");
      return;
    }
    const canUpdate = Boolean(
      subscription?.asaas_subscription_id &&
      !["cancelada", "encerrada"].includes(subscription?.status),
    );
    const preferredType = SUBSCRIPTION_BILLING_TYPES.includes(subscription?.billing_type)
      ? subscription.billing_type
      : "BOLETO";
    const errorSummary = h(ctx, "div", {
      className: "merchant-alert",
      role: "alert",
      tabindex: "-1",
      hidden: true,
    });
    const cardSection = h(
      ctx,
      "fieldset",
      { className: "merchant-section merchant-payment-card" },
      h(ctx, "legend", { className: "merchant-panel__title" }, "Dados do cartao"),
      h(
        ctx,
        "div",
        { className: "merchant-form__grid" },
        paymentField(ctx, {
          name: "cardHolderName",
          label: "Nome impresso no cartao",
          value: profile.full_name ?? profile.name ?? store.name ?? "",
          required: true,
          autocomplete: "cc-name",
          maxlength: "120",
        }),
        paymentField(ctx, {
          name: "cardNumber",
          label: "Numero do cartao",
          required: true,
          autocomplete: "cc-number",
          inputmode: "numeric",
          maxlength: "23",
          placeholder: "Somente numeros",
        }),
        paymentField(ctx, {
          name: "expiryMonth",
          label: "Mes de validade",
          required: true,
          autocomplete: "cc-exp-month",
          inputmode: "numeric",
          maxlength: "2",
          placeholder: "MM",
        }),
        paymentField(ctx, {
          name: "expiryYear",
          label: "Ano de validade",
          required: true,
          autocomplete: "cc-exp-year",
          inputmode: "numeric",
          maxlength: "4",
          placeholder: "AAAA",
        }),
        paymentField(ctx, {
          name: "ccv",
          label: "Codigo de seguranca",
          type: "password",
          required: true,
          autocomplete: "cc-csc",
          inputmode: "numeric",
          maxlength: "4",
          placeholder: "3 ou 4 digitos",
        }),
        paymentField(ctx, {
          name: "postalCode",
          label: "CEP do titular",
          value: store.zip_code ?? "",
          required: true,
          autocomplete: "postal-code",
          inputmode: "numeric",
          maxlength: "9",
        }),
        paymentField(ctx, {
          name: "addressNumber",
          label: "Numero do endereco",
          value: store.address_number ?? "",
          required: true,
          autocomplete: "address-line2",
          maxlength: "20",
        }),
        paymentField(ctx, {
          name: "addressComplement",
          label: "Complemento (opcional)",
          value: store.address_complement ?? "",
          autocomplete: "address-line3",
          maxlength: "80",
        }),
      ),
      h(
        ctx,
        "p",
        { className: "merchant-field__hint" },
        "Os dados do cartao sao usados na validacao do gateway e nao sao exibidos novamente.",
      ),
    );
    const billingChoices = h(
      ctx,
      "fieldset",
      { className: "merchant-section" },
      h(ctx, "legend", { className: "merchant-panel__title" }, "Forma de cobranca mensal"),
      h(
        ctx,
        "div",
        { className: "merchant-payment-options" },
        paymentChoice(
          ctx,
          "BOLETO",
          "Boleto",
          "Uma cobranca e emitida mensalmente. O acesso depende da confirmacao do pagamento.",
          preferredType,
        ),
        paymentChoice(
          ctx,
          "CREDIT_CARD",
          "Cartao de credito",
          "Cobranca recorrente mensal. O gateway valida o cartao antes de ativar a assinatura.",
          preferredType,
        ),
      ),
    );
    const form = h(
      ctx,
      "form",
      { className: "merchant-form", "aria-label": `Cobranca do plano ${plan.name}` },
      h(
        ctx,
        "p",
        { className: "merchant-page__description" },
        `${plan.name}: ${money(ctx, planPrice(plan))} por mes. A forma escolhida sera usada na recorrencia mensal.`,
      ),
      billingChoices,
      h(
        ctx,
        "fieldset",
        { className: "merchant-section merchant-subscription-customer" },
        h(ctx, "legend", { className: "merchant-panel__title" }, "Responsavel pela cobranca"),
        h(
          ctx,
          "div",
          { className: "merchant-form__grid" },
          paymentField(ctx, {
            name: "customerName",
            label: "Nome completo",
            value: profile.full_name ?? profile.name ?? store.name ?? "",
            required: true,
            autocomplete: "name",
            maxlength: "160",
          }),
          paymentField(ctx, {
            name: "customerEmail",
            label: "E-mail",
            type: "email",
            value: ctx.auth.session?.user?.email ?? profile.email ?? store.email ?? "",
            required: true,
            autocomplete: "email",
            maxlength: "180",
          }),
          paymentField(ctx, {
            name: "customerDocument",
            label: "CPF ou CNPJ",
            value: profile.document ?? store.document ?? "",
            required: true,
            autocomplete: "off",
            maxlength: "18",
          }),
          paymentField(ctx, {
            name: "customerPhone",
            label: "Telefone com DDD (opcional)",
            value: profile.phone ?? store.whatsapp ?? store.whatsapp_number ?? store.phone ?? "",
            autocomplete: "tel",
            inputmode: "tel",
            maxlength: "20",
          }),
        ),
      ),
      cardSection,
      errorSummary,
    );
    const submit = button(ctx, "Revisar e confirmar", { primary: true });
    const modal = openDialog(ctx, {
      title: `Assinar ${plan.name}`,
      content: form,
      actions: [submit],
    });
    const customerSection = form.querySelector(".merchant-subscription-customer");
    const setBillingType = () => {
      const type = form.querySelector('input[name="billingType"]:checked')?.value;
      const showCard = type === "CREDIT_CARD";
      const showCustomer = !canUpdate || showCard;
      customerSection.hidden = !showCustomer;
      for (const control of customerSection.querySelectorAll("input"))
        control.disabled = !showCustomer;
      cardSection.hidden = !showCard;
      for (const control of cardSection.querySelectorAll("input")) control.disabled = !showCard;
      errorSummary.hidden = true;
      errorSummary.replaceChildren();
    };
    for (const radio of form.querySelectorAll('input[name="billingType"]'))
      radio.addEventListener("change", setBillingType);
    setBillingType();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const values = formValues(form);
      const request = buildSubscriptionRequest({
        storeId: getStoreId(ctx),
        planId: plan.id,
        billingType: values.billingType,
        operation: canUpdate ? "update" : "create",
        values,
      });
      if (!request.ok) {
        errorSummary.hidden = false;
        errorSummary.replaceChildren(
          h(ctx, "strong", {}, "Revise os dados antes de continuar."),
          h(
            ctx,
            "ul",
            {},
            request.errors.map((message) => h(ctx, "li", {}, message)),
          ),
        );
        errorSummary.focus();
        return;
      }
      const typeLabel = request.body.billingType === "CREDIT_CARD" ? "cartao de credito" : "boleto";
      const confirmed = await confirmAction(
        ctx,
        `Confirmar ${plan.name} por ${money(ctx, planPrice(plan))} ao mes via ${typeLabel}? A cobranca sera recorrente e a troca do plano nao pode ser desfeita nesta tela.`,
      );
      if (!confirmed) return;
      await withBusy(submit, async () => {
        try {
          const result = await dataOf(ctx.api.fn(request.functionName, request.body), {});
          modal.close();
          const checkoutUrl = safeCheckoutUrl(result.checkoutUrl ?? result.invoiceUrl);
          if (checkoutUrl) {
            openDialog(ctx, {
              title: "Cobranca pronta",
              content: h(
                ctx,
                "div",
                { className: "merchant-form" },
                h(
                  ctx,
                  "p",
                  {},
                  "Abra a cobranca em uma nova guia. A assinatura sera liberada apos a confirmacao do pagamento.",
                ),
                h(
                  ctx,
                  "a",
                  {
                    className: "merchant-button merchant-button--primary",
                    href: checkoutUrl,
                    target: "_blank",
                    rel: "noopener noreferrer",
                  },
                  "Abrir cobranca",
                ),
              ),
            });
          }
          toast(
            ctx,
            request.body.billingType === "CREDIT_CARD"
              ? "Cartao validado. Aguarde a confirmacao da assinatura."
              : "Boleto emitido. Aguarde a confirmacao do pagamento.",
            "success",
          );
          await load();
        } catch (error) {
          toast(ctx, error?.message || "Nao foi possivel iniciar a assinatura.", "error");
        }
      });
    });
    submit.addEventListener("click", () => form.requestSubmit());
    page.onCleanup(() => {
      if (modal.dialog.isConnected) modal.close();
    });
  };

  const sync = (control) =>
    withBusy(control, async () => {
      try {
        const result = await dataOf(
          ctx.api.fn("sync-subscription-status", { storeId: getStoreId(ctx) }),
        );
        if (result?.activationBlocked) {
          await load().catch(() => undefined);
          throw new Error(result.message || "A assinatura nao pode ser ativada por esta cobranca.");
        }
        toast(ctx, "Assinatura sincronizada.", "success");
        await load();
      } catch (error) {
        toast(ctx, error?.message || "Nao foi possivel sincronizar a assinatura.", "error");
      }
    });

  const cancel = async (control) => {
    if (
      !(await confirmAction(
        ctx,
        "Cancelar a renovacao da assinatura? O acesso segue ate o fim do periodo pago.",
      ))
    )
      return;
    await withBusy(control, async () => {
      try {
        await dataOf(ctx.api.fn("cancel-subscription", { storeId: getStoreId(ctx) }));
        toast(ctx, "Renovacao cancelada.", "success");
        await load();
      } catch (error) {
        toast(ctx, error?.message || "Nao foi possivel cancelar a renovacao.", "error");
      }
    });
  };

  page.root.ready = load();
  return page.root;
}

function paymentChoice(ctx, value, title, description, selected) {
  const id = `subscription-billing-${value.toLowerCase()}`;
  return h(
    ctx,
    "label",
    { className: "merchant-payment-option", htmlFor: id },
    h(ctx, "input", {
      id,
      type: "radio",
      name: "billingType",
      value,
      required: true,
      checked: selected === value,
    }),
    h(ctx, "span", {}, h(ctx, "strong", {}, title), h(ctx, "small", {}, description)),
  );
}

export function safeCheckoutUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, globalThis.location?.origin ?? "https://localhost");
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export default render;
