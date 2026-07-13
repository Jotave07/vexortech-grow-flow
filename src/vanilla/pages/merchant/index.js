import "./merchant.css";
import { requireActiveSubscription } from "./access.js";

const lazy = (load, exportName = "render") => async (ctx) => {
  const module = await load();
  return module[exportName](ctx);
};

const merchantRoute = (pattern, title, render) => Object.freeze({
  pattern,
  auth: "store_owner",
  layout: "merchant",
  title,
  render,
  beforeEnter: pattern === "/lojista/assinatura" ? undefined : requireActiveSubscription,
});

export const routes = Object.freeze([
  merchantRoute("/lojista/assinatura", "Assinatura", lazy(() => import("./subscription.js"))),
  merchantRoute("/lojista/pedidos", "Pedidos", lazy(() => import("./orders.js"))),
  merchantRoute("/lojista/cardapio", "Produtos", lazy(() => import("./products.js"))),
  merchantRoute("/lojista/categorias", "Categorias", lazy(() => import("./categories.js"))),
  merchantRoute("/lojista/clientes", "Clientes", lazy(() => import("./customers.js"))),
  merchantRoute("/lojista/cupons", "Cupons", lazy(() => import("./coupons.js"))),
  merchantRoute("/lojista/entregas", "Entregas", lazy(() => import("./deliveries.js"))),
  merchantRoute("/lojista/entregadores", "Entregadores", lazy(() => import("./deliveries.js"), "renderDrivers")),
  merchantRoute("/lojista/relatorios", "Relatórios", lazy(() => import("./reports.js"))),
  merchantRoute("/lojista/configuracoes", "Configurações", lazy(() => import("./settings.js"))),
  merchantRoute("/lojista/usuarios", "Usuários", lazy(() => import("./team.js"))),
  merchantRoute("/lojista", "Visão geral", lazy(() => import("./dashboard.js"))),
]);

export const MERCHANT_ROUTE_INVENTORY = Object.freeze(routes.map(({ pattern, title }) => Object.freeze({ pattern, title })));

export default routes;
