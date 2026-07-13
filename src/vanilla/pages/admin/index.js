const lazy = (load, exportName) => async (ctx) => {
  const module = await load();
  return module[exportName](ctx);
};

const adminRoute = (pattern, title, render) => Object.freeze({
  pattern,
  auth: "super_admin",
  title,
  render,
});

const dashboard = lazy(() => import("./dashboard.js"), "renderAdminDashboard");
const stores = lazy(() => import("./stores.js"), "renderAdminStores");
const registrations = lazy(() => import("./registrations.js"), "renderAdminRegistrations");
const plans = lazy(() => import("./plans.js"), "renderAdminPlans");
const orders = lazy(() => import("./orders.js"), "renderAdminOrders");
const finance = lazy(() => import("./finance.js"), "renderAdminFinance");
const platform = lazy(() => import("./platform.js"), "renderAdminPlatform");

export const routes = Object.freeze([
  adminRoute("/admin", "Visao geral", dashboard),
  adminRoute("/admin/lojas", "Lojas", stores),
  adminRoute("/admin/parceiros", "Parceiros", stores),
  adminRoute("/admin/cadastros", "Cadastros", registrations),
  adminRoute("/admin/planos", "Planos", plans),
  adminRoute("/admin/pedidos", "Pedidos", orders),
  adminRoute("/admin/financeiro", "Financeiro", finance),
  adminRoute("/admin/configuracoes", "Configuracoes e saude", platform),
]);

export default routes;
