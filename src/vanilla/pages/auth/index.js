const lazy = (load, exportName) => async (ctx) => {
  const module = await load();
  return module[exportName](ctx);
};

const login = (exportName) => lazy(() => import("./login.js"), exportName);
const signup = (exportName) => lazy(() => import("./signup.js"), exportName);
const password = (exportName) => lazy(() => import("./password.js"), exportName);

export const routes = Object.freeze([
  { pattern: "/entrar", layout: "none", title: "Entrar", render: login("renderCustomerLogin") },
  { pattern: "/cadastrar", layout: "none", title: "Criar conta", render: signup("renderCustomerSignup") },
  {
    pattern: "/recuperar-senha",
    layout: "none",
    title: "Recuperar senha",
    render: password("renderForgotPassword"),
  },
  {
    pattern: "/redefinir-senha",
    layout: "none",
    title: "Redefinir senha",
    render: password("renderResetPassword"),
  },
  {
    pattern: "/lojista/entrar",
    layout: "none",
    title: "Acesso do lojista",
    render: login("renderMerchantLogin"),
  },
  {
    pattern: "/cadastrar-loja",
    layout: "none",
    title: "Cadastrar loja",
    render: signup("renderMerchantSignup"),
  },
  {
    pattern: "/admin/entrar",
    layout: "none",
    title: "Acesso administrativo",
    render: login("renderAdminLogin"),
  },
  {
    pattern: "/onboarding",
    auth: "store_owner",
    layout: "none",
    title: "Configurar loja",
    render: lazy(() => import("./onboarding.js"), "renderOnboarding"),
  },
]);

export default routes;
