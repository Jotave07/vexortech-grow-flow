import { applyLayout } from "./layout.js";

const normalizePath = (value) => {
  const path = String(value || "/").split(/[?#]/)[0].replace(/\/{2,}/g, "/");
  return path.length > 1 ? path.replace(/\/$/, "") : "/";
};

const compile = (pattern) => {
  const names = [];
  const source = normalizePath(pattern).split("/").map((part) => {
    if (!part) return "";
    if (part === "*") { names.push("wildcard"); return "(.*)"; }
    if (part.startsWith(":")) { names.push(part.slice(1)); return "([^/]+)"; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("/");
  return { regex: new RegExp(`^${source || "/"}$`), names };
};

export const createRouter = ({ routes, root, baseContext }) => {
  const compiled = routes.map((route) => ({ ...route, ...compile(route.pattern) }));
  let cleanup = null;
  let navigationId = 0;

  const navigate = (href, options = {}) => {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return;
    history[options.replace ? "replaceState" : "pushState"]({}, "", `${url.pathname}${url.search}${url.hash}`);
    void render();
  };

  const render = async () => {
    const currentId = ++navigationId;
    try { cleanup?.(); } catch (error) { console.warn("Route cleanup failed", { message: error?.message }); }
    cleanup = null;
    const path = normalizePath(location.pathname);
    const route = compiled.find((candidate) => candidate.regex.test(path)) || compiled.find((candidate) => candidate.pattern === "*");
    if (!route) return;
    const match = path.match(route.regex);
    let params;
    try {
      params = Object.fromEntries(route.names.map((name, index) => [name, decodeURIComponent(match?.[index + 1] || "")]));
    } catch {
      history.replaceState({}, "", "/");
      return render();
    }
    const ctx = {
      ...baseContext,
      path,
      pathname: path,
      location: window.location,
      params,
      query: new URLSearchParams(location.search),
      navigate,
      route,
    };
    if (route.auth && !ctx.auth.require(route.auth)) {
      const loginPath = route.auth === "store_owner" ? "/lojista/entrar" : route.auth === "super_admin" ? "/admin/entrar" : "/entrar";
      navigate(`${loginPath}?redirect=${encodeURIComponent(path + location.search)}`, { replace: true });
      return;
    }
    if (typeof route.beforeEnter === "function") {
      root.replaceChildren(baseContext.ui.loading("Validando acesso..."));
      try {
        const decision = await route.beforeEnter(ctx);
        if (currentId !== navigationId) return;
        if (decision !== true) {
          navigate(typeof decision === "string" ? decision : "/", { replace: true });
          return;
        }
      } catch {
        navigate("/lojista/assinatura?state=verification_failed", { replace: true });
        return;
      }
    }
    const title = route.title || "Hype Delivery";
    document.title = title.includes("Hype Delivery") ? title : `${title} · Hype Delivery`;
    root.replaceChildren(baseContext.ui.loading("Carregando pagina..."));
    try {
      const content = await route.render(ctx);
      if (currentId !== navigationId) {
        try { content?.cleanup?.(); } catch { /* stale route cleanup is best effort */ }
        return;
      }
      const node = content instanceof Node ? content : baseContext.ui.empty("Pagina indisponivel", "O modulo nao retornou conteudo valido.");
      root.replaceChildren(applyLayout(ctx, node, route));
      cleanup = typeof node.cleanup === "function" ? node.cleanup : null;
      requestAnimationFrame(() => root.querySelector("#main-content, main[tabindex='-1']")?.focus({ preventScroll: true }));
      window.scrollTo({ top: 0, behavior: "instant" });
    } catch (error) {
      console.error("Route render failed", { path, message: error?.message });
      root.replaceChildren(applyLayout(ctx, baseContext.ui.empty("Nao foi possivel abrir esta pagina", "Tente novamente em instantes.",
        baseContext.ui.button("Tentar novamente", { onClick: () => void render() })), route));
    }
  };

  document.addEventListener("click", (event) => {
    const anchor = event.target.closest?.("a[href]");
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || anchor.target || anchor.hasAttribute("download")) return;
    const url = new URL(anchor.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
    event.preventDefault();
    navigate(`${url.pathname}${url.search}${url.hash}`);
  });
  window.addEventListener("popstate", () => void render());
  return { navigate, render };
};
