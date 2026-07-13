import {
  absoluteUrl,
  controlOf,
  createAuthPage,
  errorMessage,
  field,
  h,
  link,
  oauthButtons,
  queryValue,
  setBusy,
  setFieldError,
  toast,
} from "./core.js";
import { isValidDocument, normalizeDocument, safeInternalRedirect } from "./validation.js";

function renderSignup(ctx, mode) {
  const merchant = mode === "merchant";
  const redirect = merchant ? null : safeInternalRedirect(queryValue(ctx, "redirect"));
  const page = createAuthPage(ctx, {
    title: merchant ? "Cadastre sua loja" : "Criar conta",
    subtitle: merchant
      ? "Primeiro crie o acesso do responsavel; em seguida voce configura o estabelecimento."
      : "Cadastre-se para pedir com mais agilidade e acompanhar suas compras.",
    theme: merchant ? "merchant" : "customer",
  });

  const fullNameField = field(ctx, {
    label: "Nome completo",
    name: "full_name",
    required: true,
    autocomplete: "name",
  });
  const documentField = field(ctx, {
    label: "CPF ou CNPJ",
    name: "document",
    required: true,
    autocomplete: "off",
    placeholder: "CPF ou CNPJ, com ou sem mascara",
  });
  const emailField = field(ctx, {
    label: merchant ? "E-mail profissional" : "E-mail",
    name: "email",
    type: "email",
    required: true,
    autocomplete: "email",
  });
  const passwordField = field(ctx, {
    label: "Senha",
    name: "password",
    type: "password",
    required: true,
    autocomplete: "new-password",
    min: 8,
    help: "Use pelo menos 8 caracteres.",
  });
  const confirmationField = field(ctx, {
    label: "Confirmar senha",
    name: "password_confirmation",
    type: "password",
    required: true,
    autocomplete: "new-password",
    min: 8,
  });
  const documentControl = controlOf(documentField, "document");
  const passwordControl = controlOf(passwordField, "password");
  const confirmationControl = controlOf(confirmationField, "password_confirmation");
  documentControl.autocapitalize = "characters";
  passwordControl.minLength = 8;
  confirmationControl.minLength = 8;
  const consent = h(
    ctx,
    "label",
    { className: "auth-checkbox" },
    h(ctx, "input", { name: "consent", type: "checkbox", required: true }),
    h(ctx, "span", {}, "Li e concordo com os Termos de Uso e a Politica de Privacidade."),
  );
  const submit = h(
    ctx,
    "button",
    { type: "submit", className: "auth-button" },
    merchant ? "Criar acesso de parceiro" : "Criar minha conta",
  );
  const form = h(
    ctx,
    "form",
    { className: "auth-form", noValidate: true },
    fullNameField,
    documentField,
    emailField,
    passwordField,
    confirmationField,
    consent,
    submit,
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFieldError(ctx, documentControl);
    setFieldError(ctx, confirmationControl);
    if (!form.reportValidity()) return;
    if (!isValidDocument(documentControl?.value)) {
      setFieldError(ctx, documentControl, "Informe um CPF ou CNPJ valido.");
      documentControl?.focus();
      return;
    }
    if (passwordControl?.value !== confirmationControl?.value) {
      setFieldError(ctx, confirmationControl, "As senhas nao coincidem.");
      confirmationControl?.focus();
      return;
    }

    setBusy(ctx, submit, true, "Criando conta...");
    page.announce("Criando sua conta.");
    try {
      const input = {
        email: String(controlOf(emailField, "email")?.value ?? "")
          .trim()
          .toLowerCase(),
        password: String(passwordControl?.value ?? ""),
        data: {
          full_name: String(controlOf(fullNameField, "full_name")?.value ?? "")
            .trim()
            .toUpperCase(),
          document: normalizeDocument(documentControl?.value),
          account_type: merchant ? "store_owner" : "customer",
        },
      };
      const signup = merchant ? ctx.auth.signUpMerchant : ctx.auth.signUp;
      if (typeof signup !== "function")
        throw new Error("Cadastro de lojista indisponivel no momento.");
      const result = await signup.call(ctx.auth, input);
      if (result?.error) throw new Error(result.error.message);
      if (!result?.data?.session) {
        toast(ctx, "Conta criada. Verifique seu e-mail para ativar o acesso.", "success");
        ctx.navigate(
          merchant
            ? "/lojista/entrar"
            : redirect
              ? `/entrar?redirect=${encodeURIComponent(redirect)}`
              : "/entrar",
        );
        return;
      }
      toast(ctx, "Conta criada com sucesso!", "success");
      ctx.navigate(merchant ? "/onboarding" : redirect || "/");
    } catch (error) {
      const message = errorMessage(error, "Nao foi possivel criar a conta.");
      toast(ctx, message, "error");
      page.announce(message);
    } finally {
      if (page.active()) setBusy(ctx, submit, false);
    }
  });

  const loginPath = merchant
    ? "/lojista/entrar"
    : redirect
      ? `/entrar?redirect=${encodeURIComponent(redirect)}`
      : "/entrar";
  page.body.replaceChildren(
    form,
    oauthButtons(ctx, {
      context: merchant ? "merchant_signup" : "customer",
      redirectTo: absoluteUrl(merchant ? "/onboarding" : redirect || "/"),
    }),
    h(
      ctx,
      "p",
      { className: "auth-footer" },
      "Ja possui uma conta? ",
      link(ctx, "Entrar", loginPath),
    ),
  );
  return page.root;
}

export const renderCustomerSignup = (ctx) => renderSignup(ctx, "customer");
export const renderMerchantSignup = (ctx) => renderSignup(ctx, "merchant");
