import {
  controlOf,
  createAuthPage,
  errorMessage,
  expectResult,
  field,
  h,
  refreshIdentity,
  requireAuthContext,
  setBusy,
  setFieldError,
  toast,
} from "./core.js";
import { digitsOnly, normalizeDocument, slugify, validateOnboarding } from "./validation.js";

const readForm = (controls) => ({
  name: controls.name.value.trim(),
  slug: slugify(controls.slug.value),
  description: controls.description.value.trim(),
  whatsapp: controls.whatsapp.value.trim(),
  document: controls.document.value.trim(),
  city: controls.city.value.trim(),
  state: controls.state.value.trim().toUpperCase(),
});

export function renderOnboarding(ctx) {
  requireAuthContext(ctx, { api: true });
  const page = createAuthPage(ctx, {
    title: "Configure sua loja",
    subtitle:
      "Estes dados formam o perfil publico do estabelecimento. Voce podera completar as configuracoes no painel.",
    theme: "merchant",
    wide: true,
  });
  const sessionUser = ctx.auth.session?.user ?? ctx.auth.user;
  if (!sessionUser?.id) {
    page.body.replaceChildren(
      h(
        ctx,
        "div",
        { className: "auth-alert auth-alert--error", role: "alert" },
        "Sua sessao expirou. Entre novamente para continuar.",
      ),
    );
    return page.root;
  }
  if (ctx.auth.profile?.store_id || ctx.auth.store?.id) {
    page.body.replaceChildren(
      h(
        ctx,
        "div",
        { className: "auth-alert auth-alert--success", role: "status" },
        "Sua loja ja esta configurada. Redirecionando para o painel...",
      ),
    );
    queueMicrotask(() => ctx.navigate("/lojista"));
    return page.root;
  }

  const nameField = field(ctx, {
    label: "Nome do estabelecimento",
    name: "name",
    required: true,
    autocomplete: "organization",
  });
  const slugField = field(ctx, {
    label: "Endereco publico",
    name: "slug",
    required: true,
    autocomplete: "off",
    help: "Use letras minusculas, numeros e hifens.",
  });
  const whatsappField = field(ctx, {
    label: "WhatsApp",
    name: "whatsapp",
    type: "tel",
    required: true,
    autocomplete: "tel",
    placeholder: "(11) 99999-9999",
  });
  const documentField = field(ctx, {
    label: "CPF ou CNPJ",
    name: "document",
    required: true,
    autocomplete: "off",
    placeholder: "CPF ou CNPJ, com ou sem mascara",
  });
  const cityField = field(ctx, {
    label: "Cidade",
    name: "city",
    required: true,
    autocomplete: "address-level2",
  });
  const stateField = field(ctx, {
    label: "UF",
    name: "state",
    required: true,
    autocomplete: "address-level1",
    placeholder: "SP",
  });
  const descriptionId = `auth-description-${Math.random().toString(36).slice(2, 8)}`;
  const description = h(ctx, "textarea", {
    id: descriptionId,
    name: "description",
    maxlength: 500,
    rows: 4,
  });
  const descriptionField = h(
    ctx,
    "div",
    { className: "field" },
    h(ctx, "label", { htmlFor: descriptionId }, "Descricao curta"),
    description,
    h(ctx, "p", { className: "field__help" }, "Ate 500 caracteres. Nao inclua dados sensiveis."),
    h(ctx, "p", { className: "field__error", "aria-live": "polite" }),
  );
  const slugPreview = h(ctx, "p", { className: "auth-slug", "aria-live": "polite" }, "/loja/");
  const submit = h(
    ctx,
    "button",
    { type: "submit", className: "auth-button" },
    "Criar loja e continuar",
  );
  const form = h(
    ctx,
    "form",
    { className: "auth-form", noValidate: true },
    h(ctx, "div", { className: "auth-form__grid" }, nameField, slugField),
    slugPreview,
    descriptionField,
    h(ctx, "div", { className: "auth-form__grid" }, whatsappField, documentField),
    h(ctx, "div", { className: "auth-form__grid" }, cityField, stateField),
    h(
      ctx,
      "div",
      { className: "auth-alert" },
      "Ao continuar, a loja sera criada vinculada a sua conta. Confira o nome e o endereco publico antes de salvar.",
    ),
    submit,
  );

  const controls = {
    name: controlOf(nameField, "name"),
    slug: controlOf(slugField, "slug"),
    description,
    whatsapp: controlOf(whatsappField, "whatsapp"),
    document: controlOf(documentField, "document"),
    city: controlOf(cityField, "city"),
    state: controlOf(stateField, "state"),
  };
  let slugEdited = false;
  controls.document.autocapitalize = "characters";
  const updatePreview = () => {
    slugPreview.textContent = `/loja/${slugify(controls.slug.value)}`;
  };
  controls.name.addEventListener("input", () => {
    if (!slugEdited) controls.slug.value = slugify(controls.name.value);
    updatePreview();
  });
  controls.slug.addEventListener("input", () => {
    slugEdited = true;
    controls.slug.value = slugify(controls.slug.value);
    updatePreview();
  });
  controls.state.addEventListener("input", () => {
    controls.state.value = controls.state.value
      .replace(/[^A-Za-z]/g, "")
      .slice(0, 2)
      .toUpperCase();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    Object.values(controls).forEach((control) => setFieldError(ctx, control));
    if (!form.reportValidity()) return;
    const input = readForm(controls);
    const validation = validateOnboarding(input);
    if (validation) {
      setFieldError(ctx, controls[validation.field], validation.message);
      controls[validation.field]?.focus();
      return;
    }
    setBusy(ctx, submit, true, "Criando loja...");
    page.announce("Verificando o endereco e criando sua loja.");
    try {
      const existing = await expectResult(
        ctx.api.from("stores").select("id").eq("slug", input.slug).maybeSingle(),
      );
      if (existing) {
        setFieldError(ctx, controls.slug, "Este endereco ja esta em uso. Escolha outro.");
        controls.slug.focus();
        return;
      }
      const created = await expectResult(
        ctx.api.fn("create-own-store", {
          slug: input.slug,
          name: input.name.toUpperCase(),
          description: input.description ? input.description.toUpperCase() : null,
          whatsapp: digitsOnly(input.whatsapp),
          phone: digitsOnly(input.whatsapp),
          document: normalizeDocument(input.document),
          city: input.city.toUpperCase(),
          state: input.state,
          email:
            String(sessionUser.email ?? "")
              .trim()
              .toLowerCase() || null,
        }),
      );
      const storeId = created?.storeId ?? created?.store_id ?? created?.store?.id ?? created?.id;
      if (!storeId) throw new Error("A API nao retornou a loja criada.");
      await refreshIdentity(ctx);
      toast(ctx, "Loja criada com sucesso!", "success");
      ctx.navigate(ctx.auth.profile?.is_exempt ? "/lojista" : "/lojista/assinatura");
    } catch (error) {
      const message = errorMessage(error, "Nao foi possivel concluir a configuracao da loja.");
      toast(ctx, message, "error");
      page.announce(`${message} Seus dados permaneceram no formulario.`);
    } finally {
      if (page.active()) setBusy(ctx, submit, false);
    }
  });

  page.body.replaceChildren(form);
  return page.root;
}
