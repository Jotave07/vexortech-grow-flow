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
  roleAfterAuth,
  setBusy,
  toast,
} from "./core.js";
import { nextPathForRole, safeInternalRedirect } from "./validation.js";

const LOGIN_COPY = {
  customer: {
    title: "Entrar",
    subtitle: "Acesse sua conta para acompanhar e fazer pedidos.",
    email: "E-mail",
    password: "Senha",
    submit: "Entrar na conta",
    theme: "customer",
  },
  merchant: {
    title: "Acesso do lojista",
    subtitle: "Entre para gerenciar sua loja, pedidos e resultados.",
    email: "E-mail corporativo",
    password: "Senha de acesso",
    submit: "Entrar no painel",
    theme: "merchant",
  },
  admin: {
    title: "Terminal administrativo",
    subtitle: "Acesso restrito a administradores da plataforma.",
    email: "E-mail administrativo",
    password: "Chave de acesso",
    submit: "Validar credenciais",
    theme: "admin",
  },
};

function renderLogin(ctx, mode) {
  const copy = LOGIN_COPY[mode];
  const page = createAuthPage(ctx, copy);
  const requested = safeInternalRedirect(queryValue(ctx, "redirect"));
  const redirect =
    mode === "merchant" ? safeInternalRedirect(requested, null, "/lojista") : requested;
  const emailField = field(ctx, {
    label: copy.email,
    name: "email",
    type: "email",
    required: true,
    autocomplete: "email",
    placeholder: "voce@exemplo.com",
  });
  const passwordField = field(ctx, {
    label: copy.password,
    name: "password",
    type: "password",
    required: true,
    autocomplete: "current-password",
  });
  const submit = h(ctx, "button", { type: "submit", className: "auth-button" }, copy.submit);
  const form = h(
    ctx,
    "form",
    { className: "auth-form", noValidate: true },
    emailField,
    passwordField,
    h(
      ctx,
      "div",
      { className: "auth-actions" },
      link(ctx, "Esqueci minha senha", "/recuperar-senha"),
      submit,
    ),
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    setBusy(ctx, submit, true, "Validando...");
    page.announce("Validando credenciais.");
    try {
      const email = String(controlOf(emailField, "email")?.value ?? "")
        .trim()
        .toLowerCase();
      const password = String(controlOf(passwordField, "password")?.value ?? "");
      const result = await ctx.auth.signIn(email, password);
      if (result?.error) throw new Error(result.error.message);
      const role = roleAfterAuth(ctx);
      const destination = nextPathForRole(role, redirect, mode);
      if (!destination) {
        await ctx.auth.signOut();
        toast(
          ctx,
          mode === "admin"
            ? "Acesso permitido somente a administradores."
            : "Esta conta nao possui acesso de lojista.",
          "error",
        );
        page.announce("Acesso negado para esta area.");
        return;
      }
      toast(ctx, "Bem-vindo!", "success");
      ctx.navigate(destination);
    } catch (error) {
      const message = errorMessage(error, "Nao foi possivel entrar.");
      toast(ctx, message, "error");
      page.announce(message);
    } finally {
      if (page.active()) setBusy(ctx, submit, false);
    }
  });

  const footer =
    mode === "customer"
      ? h(
          ctx,
          "p",
          { className: "auth-footer" },
          "Ainda nao tem conta? ",
          link(
            ctx,
            "Cadastre-se",
            redirect ? `/cadastrar?redirect=${encodeURIComponent(redirect)}` : "/cadastrar",
          ),
        )
      : mode === "merchant"
        ? h(
            ctx,
            "p",
            { className: "auth-footer" },
            "Ainda nao tem uma loja? ",
            link(ctx, "Comece agora", "/cadastrar-loja"),
          )
        : h(ctx, "p", { className: "auth-footer" }, link(ctx, "Voltar ao inicio", "/"));
  const oauth =
    mode === "admin"
      ? null
      : oauthButtons(ctx, {
          context: mode === "merchant" ? "merchant" : "customer",
          redirectTo: absoluteUrl(mode === "merchant" ? redirect || "/lojista" : redirect || "/"),
        });
  page.body.replaceChildren(...[form, oauth, footer].filter(Boolean));
  return page.root;
}

export const renderCustomerLogin = (ctx) => renderLogin(ctx, "customer");
export const renderMerchantLogin = (ctx) => renderLogin(ctx, "merchant");
export const renderAdminLogin = (ctx) => renderLogin(ctx, "admin");
