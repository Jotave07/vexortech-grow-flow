import {
  controlOf,
  createAuthPage,
  errorMessage,
  field,
  h,
  link,
  roleAfterAuth,
  setBusy,
  setFieldError,
  toast,
} from "./core.js";
import { nextPathForRole } from "./validation.js";

export function renderForgotPassword(ctx) {
  const page = createAuthPage(ctx, {
    title: "Recuperar senha",
    subtitle: "Enviaremos um link seguro para voce definir uma nova senha.",
  });
  const emailField = field(ctx, {
    label: "E-mail",
    name: "email",
    type: "email",
    required: true,
    autocomplete: "email",
  });
  const submit = h(ctx, "button", { type: "submit", className: "auth-button" }, "Enviar link");
  const form = h(ctx, "form", { className: "auth-form", noValidate: true }, emailField, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    setBusy(ctx, submit, true, "Enviando...");
    try {
      const origin = globalThis.location?.origin || "";
      const redirectTo = origin ? `${origin}/redefinir-senha` : "/redefinir-senha";
      const result = await ctx.auth.resetPassword(
        String(controlOf(emailField, "email")?.value ?? "")
          .trim()
          .toLowerCase(),
        redirectTo,
      );
      if (result?.error) throw new Error(result.error.message);
      const message = "Se o e-mail estiver cadastrado, voce recebera as instrucoes em instantes.";
      page.body.replaceChildren(
        h(ctx, "div", { className: "auth-alert auth-alert--success", role: "status" }, message),
        h(ctx, "p", { className: "auth-footer" }, link(ctx, "Voltar para o login", "/entrar")),
      );
      page.announce(message);
    } catch (error) {
      const message = errorMessage(error, "Nao foi possivel enviar o link agora.");
      toast(ctx, message, "error");
      page.announce(message);
    } finally {
      if (page.active()) setBusy(ctx, submit, false);
    }
  });
  page.body.replaceChildren(
    form,
    h(ctx, "p", { className: "auth-footer" }, link(ctx, "Voltar para o login", "/entrar")),
  );
  return page.root;
}

export function renderResetPassword(ctx) {
  const page = createAuthPage(ctx, {
    title: "Definir nova senha",
    subtitle: ctx.auth.session
      ? "Crie uma senha nova e exclusiva para esta conta."
      : "Abra esta pagina pelo link de recuperacao enviado ao seu e-mail.",
  });
  const passwordField = field(ctx, {
    label: "Nova senha",
    name: "password",
    type: "password",
    required: true,
    autocomplete: "new-password",
    min: 8,
    help: "Use pelo menos 8 caracteres.",
  });
  const confirmationField = field(ctx, {
    label: "Confirmar nova senha",
    name: "password_confirmation",
    type: "password",
    required: true,
    autocomplete: "new-password",
    min: 8,
  });
  controlOf(passwordField, "password").minLength = 8;
  controlOf(confirmationField, "password_confirmation").minLength = 8;
  const submit = h(
    ctx,
    "button",
    { type: "submit", className: "auth-button", disabled: !ctx.auth.session },
    "Atualizar senha",
  );
  const form = h(
    ctx,
    "form",
    { className: "auth-form", noValidate: true },
    !ctx.auth.session
      ? h(
          ctx,
          "div",
          { className: "auth-alert auth-alert--error", role: "alert" },
          "Sessao de recuperacao ausente ou expirada. Solicite um novo link.",
        )
      : null,
    passwordField,
    confirmationField,
    submit,
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = controlOf(passwordField, "password");
    const confirmation = controlOf(confirmationField, "password_confirmation");
    setFieldError(ctx, confirmation);
    if (!form.reportValidity()) return;
    if (password?.value !== confirmation?.value) {
      setFieldError(ctx, confirmation, "As senhas nao coincidem.");
      confirmation?.focus();
      return;
    }
    setBusy(ctx, submit, true, "Atualizando...");
    try {
      const result = await ctx.auth.updateUser({ password: password.value });
      if (result?.error) throw new Error(result.error.message);
      toast(ctx, "Senha atualizada com sucesso.", "success");
      ctx.navigate(nextPathForRole(roleAfterAuth(ctx)));
    } catch (error) {
      const message = errorMessage(error, "O link expirou ou nao foi possivel atualizar a senha.");
      toast(ctx, message, "error");
      page.announce(message);
    } finally {
      if (page.active()) setBusy(ctx, submit, false);
    }
  });
  page.body.replaceChildren(
    form,
    h(
      ctx,
      "p",
      { className: "auth-footer" },
      link(ctx, "Solicitar outro link", "/recuperar-senha"),
    ),
  );
  return page.root;
}
