import "./styles.css";
import "./pages/auth/styles.css";
import "./pages/admin/styles.css";
import { api } from "./core/api.js";
import { auth } from "./core/auth.js";
import { ui } from "./core/ui.js";
import { createRouter } from "./core/router.js";
import { routes as publicRoutes } from "./pages/public/index.js";
import { routes as authRoutes } from "./pages/auth/index.js";
import { routes as merchantRoutes } from "./pages/merchant/index.js";
import { routes as adminRoutes } from "./pages/admin/index.js";
import { routes as sharedRoutes } from "./pages/shared.js";

const root = document.querySelector("#app");
root.replaceChildren(ui.loading("Preparando sua experiencia..."));

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled operation", { message: event.reason?.message || String(event.reason) });
  ui.toast("Nao foi possivel concluir uma operacao.", "error");
});

const routes = [
  ...publicRoutes.map((route) => ({ layout: "none", ...route })),
  ...authRoutes.map((route) => ({ layout: "none", ...route })),
  ...merchantRoutes.map((route) => ({ layout: "merchant", ...route })),
  ...adminRoutes.map((route) => ({ layout: "admin", ...route })),
  ...sharedRoutes,
];

const bootstrap = async () => {
  await auth.init();
  if (auth.callbackError) ui.toast(auth.callbackError, "error", 7000);
  const router = createRouter({ routes, root, baseContext: { api, auth, ui } });
  await router.render();
};

// Keep module evaluation synchronous. Route chunks can safely share modules
// with this entry without creating a top-level-await cycle in Rollup/Vite.
void bootstrap().catch((error) => {
  console.error("Application bootstrap failed", { message: error?.message });
  root.replaceChildren(ui.empty(
    "Nao foi possivel iniciar a plataforma",
    "Recarregue a pagina. Se o problema continuar, procure o suporte.",
    ui.button("Recarregar", { onClick: () => location.reload() }),
  ));
});
