import "./public.css";

export { PUBLIC_SHELL_CONTRACT } from "./contracts.js";

const lazy = (load, exportName) => async (ctx) => {
  const module = await load();
  return module[exportName](ctx);
};

const home = (exportName) => lazy(() => import("./home.js"), exportName);
const store = lazy(() => import("./store.js"), "renderStore");
const checkout = lazy(() => import("./checkout.js"), "renderCheckout");
const tracking = lazy(() => import("./tracking.js"), "renderTracking");
const payment = (exportName) => lazy(() => import("./payment.js"), exportName);

export const routes = Object.freeze([
  { pattern: "/pedido/:token/sucesso", title: "Pagamento | Hype Delivery", render: payment("renderPaymentSuccess") },
  { pattern: "/vendas/pedido/:token/sucesso", title: "Pagamento | Hype Delivery", render: payment("renderPaymentSuccess") },
  { pattern: "/pedido/:token/cancelado", title: "Pagamento interrompido | Hype Delivery", render: payment("renderPaymentCancelled") },
  { pattern: "/vendas/pedido/:token/cancelado", title: "Pagamento interrompido | Hype Delivery", render: payment("renderPaymentCancelled") },
  { pattern: "/loja/:slug/checkout", auth: "customer", title: "Finalizar pedido | Hype Delivery", render: checkout },
  { pattern: "/vendas/loja/:slug/checkout", auth: "customer", title: "Finalizar pedido | Hype Delivery", render: checkout },
  { pattern: "/pedido/:token", title: "Acompanhar pedido | Hype Delivery", render: tracking },
  { pattern: "/vendas/pedido/:token", title: "Acompanhar pedido | Hype Delivery", render: tracking },
  { pattern: "/loja/:slug", title: "Cardápio | Hype Delivery", render: store },
  { pattern: "/vendas/loja/:slug", title: "Cardápio | Hype Delivery", render: store },
  { pattern: "/", title: "Hype Delivery", render: home("renderDomainHome") },
  { pattern: "/lojas", title: "Lojas | Hype Delivery", render: home("renderStores") },
  { pattern: "/vendas", title: "Parceiros | Hype Delivery", render: home("renderPartnerLanding") },
  { pattern: "/vendas/lojas", title: "Lojas | Hype Delivery", render: home("renderStores") },
]);

export default routes;
